// Start interfejsu: ustawienia, motyw, zdarzenia z procesu głównego, widoki, przeciąganie plików, skróty.
import { S, api, emit, on, refreshInstances, refreshAccounts, selectedInstance } from './state.js';
import { applyAppearance } from './theme.js';
import { setLang, t } from './i18n.js';
import { toast, toastError, debounce } from './ui.js';
import { icon } from './icons.js';
import { navigate, route } from './router.js';
import { buildShell } from './shell.js';
import { pushLog } from './views/console.js';
import { showCrash } from './actions.js';
import { onboarding } from './views/onboarding.js';
import { openCreate } from './views/create.js';
import './views/home.js';
import './views/instances.js';
import './views/instance.js';
import './views/browse.js';
import './views/project.js';
import './views/packs.js';
import './views/justmusic.js';
import './views/settings.js';

window.addEventListener('error', (e) => console.error(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => console.error(e.reason));

async function init() {
  [S.info, S.settings] = await Promise.all([api('app:info'), api('settings:get')]);
  setLang(S.settings.language);
  applyAppearance(S.settings.appearance);
  await Promise.all([refreshInstances().catch(() => {}), refreshAccounts().catch(() => {})]);
  for (const x of await api('tasks:list').catch(() => [])) S.tasks.set(x.id, x);
  for (const r of await api('game:running').catch(() => [])) S.running.add(r.instanceId);
  try { const st = await api('jm:status'); S.jm.connected = st.connected; S.jm.state = st.state; } catch {}
  S.update = await api('update:get').catch(() => null);

  buildShell();
  wireEvents();
  wireDragDrop();
  wireShortcuts();
  navigate('home');
  if (!S.settings.onboarded) onboarding(() => navigate('home', null, { replace: true }));
}

function wireEvents() {
  const refresh = debounce(() => refreshInstances().catch(() => {}), 150);
  window.jl.on('tasks:update', (x) => {
    const prev = S.tasks.get(x.id);
    S.tasks.set(x.id, x);
    emit('tasks');
    if (prev?.state === 'running' && x.state !== 'running') {
      if (x.state === 'error' && x.kind !== 'launch') toast(`${x.title}: ${x.error}`, { error: true });
      if (x.state === 'error' && x.kind === 'launch') toast(x.error, { error: true, action: x.instanceId ? { label: t('Konsola'), run: () => navigate('instance', { id: x.instanceId, tab: 'console' }) } : null });
      if (x.state === 'done' && x.kind === 'install') toast(`${x.title} – ${t('gotowe')}`, { success: true });
      refresh();
    }
  });
  window.jl.on('tasks:remove', (id) => { S.tasks.delete(id); emit('tasks'); });
  window.jl.on('task:log', (p) => {
    const x = S.tasks.get(p.id);
    if (x?.instanceId) { pushLog(x.instanceId, `[JustMinecraft] ${p.line}`); emit('log', { instanceId: x.instanceId }); }
  });
  window.jl.on('game:log', (p) => { pushLog(p.instanceId, p.line); emit('log', p); });
  window.jl.on('game:state', (p) => {
    if (p.running) { S.running.add(p.instanceId); S.logs.set(p.instanceId, S.logs.get(p.instanceId)?.slice(-50) || []); } else S.running.delete(p.instanceId);
    emit('running', p);
    refresh();
    if (!p.running && p.crashed && S.settings.game.showConsoleOnCrash) {
      const inst = S.instances.find((i) => i.id === p.instanceId);
      if (inst) showCrash(inst, p);
    }
  });
  window.jl.on('instances:changed', refresh);
  window.jl.on('toast', (p) => toast(p.msg, p));
  window.jl.on('jm:state', (s) => { S.jm.state = s; emit('jm'); });
  window.jl.on('jm:connection', (c) => {
    const was = S.jm.connected;
    S.jm.connected = c;
    if (!c) S.jm.state = null;
    emit('jm'); emit('jm-connection');
    if (c && !was) toast(t('Połączono z JustMusic'), { icon: 'music' });
  });
  window.jl.on('update:status', (u) => {
    const prev = S.update?.status;
    S.update = u;
    emit('update');
    if (u.status === 'ready' && prev !== 'ready') toast(t('Aktualizacja {v} jest gotowa', { v: u.version }), { icon: 'download', duration: 10000, action: { label: t('Zainstaluj teraz'), run: () => api('update:install').catch(toastError) } });
    if (u.status === 'available' && prev !== 'available') toast(t('Dostępna nowa wersja: {v}', { v: u.version }), { icon: 'download', duration: 10000, action: { label: t('Zaktualizuj'), run: () => api('update:install').catch(toastError) } });
  });
}

function wireDragDrop() {
  const ov = document.getElementById('drop-overlay');
  document.getElementById('drop-ic').innerHTML = icon('upload');
  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  window.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; depth++; ov.classList.add('show'); });
  window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) ov.classList.remove('show'); });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    depth = 0;
    ov.classList.remove('show');
    const paths = [...e.dataTransfer.files].map((f) => window.jl.pathForFile(f)).filter(Boolean);
    if (!paths.length) return;
    const packs = paths.filter((p) => p.toLowerCase().endsWith('.mrpack'));
    for (const p of packs) {
      try { const inst = await api('mrpack:import', p); await refreshInstances(); toast(t('Importuję modpack „{n}”', { n: inst.name })); } catch (er) { toastError(er); }
    }
    const rest = paths.filter((p) => !packs.includes(p));
    if (!rest.length) return;
    const r = route();
    const inst = r.name === 'instance' ? S.instances.find((i) => i.id === r.param?.id) : selectedInstance();
    if (!inst) { toast(t('Najpierw utwórz instancję'), { error: true }); return; }
    try {
      const res = await api('content:addFiles', inst.id, rest);
      const ok = res.filter((x) => x.added);
      const kinds = { mod: t('mod'), resourcepack: t('resource pack'), shader: t('shader'), datapack: t('datapack') };
      if (ok.length) toast(t('Dodano do „{n}”: {list}', { n: inst.name, list: ok.map((x) => `${x.file} (${kinds[x.kind] || x.kind})`).join(', ') }), { success: true, duration: 6000 });
      for (const x of res.filter((y) => !y.added)) toast(`${x.file}: ${x.kind === 'datapack' ? t('przeciągnij datapack w zakładce Datapacki konkretnej instancji') : t('nieznany typ pliku')}`, { error: true });
      emit('content-changed', inst.id);
    } catch (er) { toastError(er); }
  });
}

function wireShortcuts() {
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); openCreate(); }
    else if (mod && e.key === ',') { e.preventDefault(); navigate('settings'); }
    else if (mod && e.key.toLowerCase() === 'f') { const i = document.querySelector('#view .search-box input'); if (i) { e.preventDefault(); i.focus(); } }
    else if (mod && e.key === '1') navigate('home');
    else if (mod && e.key === '2') navigate('instances');
    else if (mod && e.key === '3') navigate('browse');
    else if (mod && e.key === '4') navigate('packs');
    else if (mod && e.key === '5') navigate('justmusic');
    else if (e.key === 'F5' && !mod) { e.preventDefault(); refreshInstances(); }
  });
}

window.__jl = { navigate, S, api, emit };

init().catch((e) => {
  console.error(e);
  document.getElementById('view').textContent = `Błąd startu: ${e.message}`;
});
