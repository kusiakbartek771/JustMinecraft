// Konsola gry: logi na żywo z kolorami poziomów, filtr, kopiowanie, raporty awarii.
import { S, api, on } from '../state.js';
import { h, btn, toast, toastError, select, modal } from '../ui.js';
import { t } from '../i18n.js';

const MAX = 5000;

export function pushLog(instanceId, line) {
  if (!S.logs.has(instanceId)) S.logs.set(instanceId, []);
  const arr = S.logs.get(instanceId);
  arr.push(line);
  if (arr.length > MAX) arr.splice(0, arr.length - MAX);
}

function cls(line) {
  if (/\[JustMinecraft\]/.test(line)) return 'l-jl';
  if (/\/(ERROR|FATAL)\]|ERROR|Exception|^\s+at |Caused by/.test(line)) return 'l-error';
  if (/\/WARN\]|WARN/.test(line)) return 'l-warn';
  if (/\/DEBUG\]|\/TRACE\]/.test(line)) return 'l-debug';
  return '';
}

// log4j XML (wersje vanilla) → czytelny tekst
function clean(line) {
  if (!line.includes('<log4j:') && !line.includes('CDATA')) return line;
  const m = line.match(/<!\[CDATA\[(.*)\]\]>/);
  if (m) return m[1];
  if (/^\s*<\/?log4j:(Event|Message|Throwable)/.test(line)) return null;
  return line;
}

export function consoleView(box, inst) {
  let filter = '';
  let level = 'all';
  let follow = true;
  const out = h('div.console');
  const search = h('input.input', { placeholder: t('Filtruj…'), style: { width: '220px' }, onInput: (e) => { filter = e.target.value.toLowerCase(); render(); } });
  box.append(h('div.content-toolbar', null,
    search,
    select([['all', t('Wszystko')], ['warn', t('Ostrzeżenia i błędy')], ['error', t('Tylko błędy')]], level, (v) => { level = v; render(); }),
    h('div.spacer'),
    btn(t('Wczytaj ostatni log'), loadFile, { icon: 'file', small: true }),
    btn(t('Raporty awarii'), crashes, { icon: 'alert', small: true }),
    btn(t('Kopiuj'), () => { navigator.clipboard.writeText(lines().join('\n')); toast(t('Skopiowano')); }, { icon: 'copy', small: true }),
    btn(t('Wyczyść'), () => { S.logs.set(inst.id, []); render(); }, { icon: 'trash', small: true }),
    btn(t('Folder logów'), () => api('instances:open', inst.id, 'logs'), { icon: 'folder', small: true })), out);

  const lines = () => (S.logs.get(inst.id) || []).map(clean).filter((l) => l != null);

  function accept(l) {
    if (filter && !l.toLowerCase().includes(filter)) return false;
    const c = cls(l);
    if (level === 'warn' && c !== 'l-warn' && c !== 'l-error') return false;
    if (level === 'error' && c !== 'l-error') return false;
    return true;
  }

  function render() {
    const frag = document.createDocumentFragment();
    const ls = lines().filter(accept).slice(-2500);
    if (!ls.length) frag.append(h('span.muted', { text: S.running.has(inst.id) ? t('Czekam na logi…') : t('Uruchom grę, aby zobaczyć logi na żywo, albo wczytaj ostatni log.') }));
    for (const l of ls) frag.append(h(`div${cls(l) ? `.${cls(l)}` : ''}`, { text: l }));
    out.replaceChildren(frag);
    if (follow) out.scrollTop = out.scrollHeight;
  }

  out.addEventListener('scroll', () => { follow = out.scrollTop + out.clientHeight >= out.scrollHeight - 30; });

  async function loadFile() {
    try {
      const r = await api('instances:logs', inst.id);
      const f = r.logs[0];
      if (!f) { toast(t('Brak plików logów')); return; }
      S.logs.set(inst.id, f.text.split(/\r?\n/));
      render();
    } catch (e) { toastError(e); }
  }

  async function crashes() {
    const r = await api('instances:logs', inst.id).catch(() => ({ crashes: [] }));
    if (!r.crashes.length) { toast(t('Brak raportów awarii – świetnie!'), { success: true }); return; }
    modal((body) => {
      const pre = h('pre.console', { style: { height: '50vh' } });
      const sel = select(r.crashes.map((c) => [c, c]), r.crashes[0], (v) => show(v));
      const show = async (name) => { pre.textContent = await api('instances:crash', inst.id, name).catch((e) => e.message); };
      body.append(sel, h('div', { style: { height: '10px' } }), pre);
      show(r.crashes[0]);
    }, { title: t('Raporty awarii'), icon: 'alert', wide: true });
  }

  render();
  let pending = false;
  const off = on('log', (p) => {
    if (p.instanceId !== inst.id || pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  });
  return off;
}
