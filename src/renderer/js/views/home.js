// Strona główna: wybrana instancja z dużym przyciskiem „Graj”, statystyki i szybkie akcje.
import { S, api, on, selectedInstance, saveSettings } from '../state.js';
import { h, btn, empty, fmtDuration, fmtAgo, progressBar, setProgress, contextMenu, select } from '../ui.js';
import { icon } from '../icons.js';
import { t } from '../i18n.js';
import { navigate, registerView } from '../router.js';
import { instIcon, coverStyle, loaderChip } from '../components.js';
import { play, launchTask } from '../actions.js';
import { openCreate } from './create.js';

registerView('home', (root) => {
  const draw = () => {
    root.replaceChildren();
    const inst = selectedInstance();
    if (!S.instances.length) {
      root.append(h('div.hero', null,
        h('div.hero-art', { style: { background: 'radial-gradient(100% 120% at 20% 0%, rgba(var(--accent-rgb), .55), transparent 60%), linear-gradient(135deg, var(--g1), var(--g2))' } }),
        blocks(),
        h('h2', { text: t('Witaj w JustMinecraft!') }),
        h('p.muted', { style: { maxWidth: '560px', marginBottom: 0 }, text: t('Stwórz pierwszą instancję – wybierz wersję Minecrafta i loader (Vanilla, Fabric, Quilt, Forge albo NeoForge). Wszystko pobierze się samo, łącznie z Javą.') }),
        h('div.hero-actions', null,
          btn(t('Nowa instancja'), () => openCreate(), { kind: 'primary', icon: 'plus' }),
          btn(t('Paczki z Google Drive'), () => navigate('packs'), { icon: 'drive' }),
          btn(t('Modpacki z Modrinth'), () => navigate('browse', { type: 'modpack' }), { icon: 'package' }))));
      root.append(quick());
      return;
    }
    root.append(hero(inst));
    const totalPlay = S.instances.reduce((s, i) => s + (i.playTime || 0), 0);
    root.append(h('div.stats', null,
      stat('grid', String(S.instances.length), t('instancji')),
      stat('clock', fmtDuration(totalPlay), t('łącznie w grze')),
      stat('memory', `${Math.round((S.settings.game.memory.auto ? 0 : S.settings.game.memory.max) / 1024 * 10) / 10 || t('auto')}${S.settings.game.memory.auto ? '' : ' GB'}`, t('pamięci dla gry')),
      stat('music', S.jm.connected ? t('połączono') : t('rozłączono'), 'JustMusic')));
    const grid = h('div.home-grid');
    const left = h('div.card.card-pad', null, h('h3.card-title', null, h('span', { html: icon('zap') }), t('Szybkie akcje')), quick());
    const recent = h('div.card.card-pad', null, h('h3.card-title', null, h('span', { html: icon('clock') }), t('Ostatnio grane')));
    const list = [...S.instances].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, 5);
    for (const i of list) {
      recent.append(h('div.recent-item', { onClick: () => saveSettings({ selectedInstance: i.id }).then(draw), onDblclick: () => play(i) },
        instIcon({ ...i, running: S.running.has(i.id) }, 'sm'),
        h('div.ri-meta.grow', null, h('b', { text: i.name }), h('small', { text: `${i.mc} · ${fmtAgo(i.lastPlayed)}` })),
        h('button.icon-btn', { title: t('Graj'), html: icon(S.running.has(i.id) ? 'stop' : 'play'), onClick: (e) => { e.stopPropagation(); play(i); } })));
    }
    grid.append(left, recent);
    root.append(grid);
  };
  draw();
  const offs = [on('instances', draw), on('tasks', () => updatePlay()), on('running', draw), on('jm', () => {})];
  return () => offs.forEach((f) => f());
});

function blocks() {
  return h('div.hero-blocks', null, Array.from({ length: 24 }, (_, i) => h('span', { style: { animationDelay: `${(i % 6) * 0.4}s`, opacity: String(0.25 + ((i * 37) % 10) / 14) } })));
}

let playEls = null;
function hero(inst) {
  const running = S.running.has(inst.id);
  const playBtn = btn(running ? t('Zatrzymaj') : t('Graj'), () => play(inst), { kind: 'primary', icon: running ? 'stop' : 'play' });
  playBtn.classList.add('play-btn');
  if (running) playBtn.classList.add('running');
  const prog = h('div.play-progress.hidden', null, progressBar(null), h('span'));
  playEls = { inst, playBtn, prog };
  const sel = select(S.instances.map((i) => [i.id, i.name]), inst.id, (id) => saveSettings({ selectedInstance: id }).then(() => navigate('home', null, { replace: true })));
  sel.style.maxWidth = '240px';
  const el = h('div.hero', null,
    h('div.hero-art', { style: { background: coverStyle(inst) } }),
    blocks(),
    h('div.hero-top', null, instIcon({ ...inst, running }, 'lg'),
      h('div', null,
        h('h2', { text: inst.name }),
        h('div.meta', null,
          h('span.chip', null, h('span', { html: icon('cube') }), `Minecraft ${inst.mc}`),
          loaderChip(inst.loader, inst.loaderVersion),
          inst.playTime ? h('span.chip', null, h('span', { html: icon('clock') }), fmtDuration(inst.playTime)) : null,
          h('span.chip', null, h('span', { html: icon('calendar') }), `${t('ostatnio')}: ${fmtAgo(inst.lastPlayed)}`)))),
    h('div.hero-actions', null,
      h('div.play-wrap', null, h('div.row.nowrap', null, playBtn,
        h('button.icon-btn', { title: t('Więcej'), html: icon('chevronDown'), onClick: (e) => contextMenu(e, [
          { label: t('Dołącz do serwera…'), icon: 'server', run: () => quickJoin(inst) },
          { label: t('Otwórz folder gry'), icon: 'folder', run: () => api('instances:open', inst.id) },
          { label: t('Konsola'), icon: 'terminal', run: () => navigate('instance', { id: inst.id, tab: 'console' }) },
          { label: t('Napraw instalację'), icon: 'wrench', run: () => api('instances:repair', inst.id) },
        ]) })), prog),
      h('div.spacer'),
      h('div.row', null,
        sel,
        btn(t('Zarządzaj'), () => navigate('instance', { id: inst.id }), { icon: 'sliders' }),
        btn(t('Dodaj mody'), () => navigate('browse', { instanceId: inst.id }), { icon: 'plus' }))));
  updatePlay();
  return el;
}

function updatePlay() {
  if (!playEls || !playEls.prog.isConnected) return;
  const tk = launchTask(playEls.inst.id);
  playEls.prog.classList.toggle('hidden', !tk);
  playEls.playBtn.disabled = !!tk;
  if (tk) {
    const p = tk.progress?.total ? (tk.progress.done / tk.progress.total) * 100 : null;
    setProgress(playEls.prog.firstChild, p);
    playEls.prog.lastChild.textContent = tk.status + (tk.progress?.total ? ` · ${Math.round(p)}%` : '');
  }
}

async function quickJoin(inst) {
  const { promptDialog } = await import('../ui.js');
  const addr = await promptDialog({ title: t('Dołącz do serwera'), label: t('Adres serwera (np. play.example.com:25565)'), value: inst.quickJoin || '', ok: t('Graj') });
  if (addr) play(inst, { server: addr });
}

function stat(ic, val, label) {
  return h('div.card.stat', null, h('div.ic', { html: icon(ic) }), h('div', null, h('b', { text: val }), h('small', { text: label })));
}

function quick() {
  const qa = (ic, title, sub, run) => h('button.qa', { onClick: run }, h('span.ic', { html: icon(ic) }), h('b', { text: title }), h('small', { text: sub }));
  return h('div.quick-actions', null,
    qa('plus', t('Nowa instancja'), t('dowolna wersja i loader'), () => openCreate()),
    qa('compass', t('Mody'), t('tysiące modów z Modrinth'), () => navigate('browse', { type: 'mod' })),
    qa('package', t('Modpacki'), t('gotowe zestawy jednym kliknięciem'), () => navigate('browse', { type: 'modpack' })),
    qa('sun', t('Shadery'), t('Iris/Oculus instaluje się sam'), () => navigate('browse', { type: 'shader' })),
    qa('image', t('Resource packi'), t('tekstury i dźwięki'), () => navigate('browse', { type: 'resourcepack' })),
    qa('map', t('Datapacki'), t('do światów'), () => navigate('browse', { type: 'datapack' })),
    qa('drive', t('Google Drive'), t('import modów z folderu'), () => navigate('packs')),
    qa('music', 'JustMusic', t('muzyka do grania'), () => navigate('justmusic')));
}
