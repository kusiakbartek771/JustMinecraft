// Powłoka: pasek tytułu, panel boczny (nawigacja, ostatnie instancje, „teraz gra”, konto), zadania w tle.
import { S, api, on, selectedInstance, currentAccount } from './state.js';
import { h, iconBtn, contextMenu, progressBar, setProgress, toast, toastError } from './ui.js';
import { icon } from './icons.js';
import { t } from './i18n.js';
import { navigate, route } from './router.js';
import { instIcon, avatar } from './components.js';
import { openAccounts } from './accounts.js';
import { LOADER_NAMES } from './theme.js';

const NAV = [
  ['home', 'home', 'Strona główna'],
  ['instances', 'grid', 'Instancje'],
  ['browse', 'compass', 'Odkrywaj'],
  ['packs', 'drive', 'Paczki i Drive'],
  ['gallery', 'image', 'Galeria'],
  ['justmusic', 'music', 'JustMusic'],
  ['settings', 'settings', 'Ustawienia'],
];

export function buildShell() {
  document.documentElement.dataset.platform = window.jl.platform;
  // przyciski okna (na macOS są natywne)
  const wc = document.getElementById('win-controls');
  if (window.jl.platform !== 'darwin') {
    const max = h('button', { title: t('Maksymalizuj'), html: icon('maximize'), onClick: () => window.jl.win.maximize() });
    wc.append(
      h('button', { title: t('Minimalizuj'), html: icon('minimize'), onClick: () => window.jl.win.minimize() }),
      max,
      h('button.close', { title: t('Zamknij'), html: icon('close'), onClick: () => window.jl.win.close() }));
    window.jl.on('win:state', (s) => { max.innerHTML = icon(s.maximized ? 'restore' : 'maximize'); });
    document.getElementById('titlebar').addEventListener('dblclick', (e) => { if (e.target.closest('.tb-drag, .tb-brand')) window.jl.win.maximize(); });
  }
  drawTitlebar();
  drawSidebar();
  on('route', () => markNav());
  on('instances', () => drawRecent());
  on('settings', () => drawRecent());
  on('accounts', () => drawAccount());
  on('tasks', () => drawTitlebar());
  on('update', () => drawTitlebar());
  on('jm', () => drawNowPlaying());
}

// ---------- pasek tytułu ----------
let tasksPop = null;
function drawTitlebar() {
  const r = document.getElementById('tb-right');
  r.replaceChildren();
  const u = S.update;
  if (u && ['available', 'downloading', 'ready'].includes(u.status)) {
    const label = u.status === 'ready' ? t('Zainstaluj aktualizację {v}', { v: u.version }) : u.status === 'downloading' ? `${t('Pobieranie aktualizacji')} ${u.progress || 0}%` : t('Aktualizacja {v}', { v: u.version });
    r.append(h('button.tb-pill.accent', { title: t('Kliknij, aby zaktualizować i uruchomić ponownie'), onClick: () => installUpdate() }, h('span', { html: icon('download') }), h('span', { text: label })));
  }
  const running = [...S.tasks.values()].filter((x) => x.state === 'running');
  const all = [...S.tasks.values()];
  if (all.length) {
    const pill = h('button.tb-pill', { onClick: () => toggleTasks() },
      running.length ? h('div.spinner.small') : h('span', { html: icon(all.some((x) => x.state === 'error') ? 'alert' : 'check') }),
      h('span', { text: running.length ? t('Zadania') : t('Gotowe') }),
      running.length ? h('span.count', { text: String(running.length) }) : null);
    r.append(pill);
  }
  if (tasksPop) renderTasks();
}

export async function installUpdate() {
  try {
    toast(t('Instaluję aktualizację – aplikacja uruchomi się ponownie…'), { icon: 'download' });
    await api('update:install');
  } catch (e) { toastError(e); }
}

function toggleTasks() {
  if (tasksPop) { tasksPop.remove(); tasksPop = null; return; }
  tasksPop = h('div.tasks-pop.card');
  document.body.append(tasksPop);
  renderTasks();
  setTimeout(() => document.addEventListener('mousedown', outside), 0);
}
function outside(e) {
  if (tasksPop && !tasksPop.contains(e.target) && !e.target.closest('.tb-pill')) { tasksPop.remove(); tasksPop = null; document.removeEventListener('mousedown', outside); }
}
function renderTasks() {
  if (!tasksPop) return;
  tasksPop.replaceChildren();
  const list = [...S.tasks.values()].sort((a, b) => b.started - a.started);
  if (!list.length) { tasksPop.append(h('p.muted', { style: { padding: '10px' }, text: t('Brak zadań') })); return; }
  for (const x of list) {
    const p = x.progress && x.progress.total ? (x.progress.done / x.progress.total) * 100 : null;
    tasksPop.append(h(`div.task.${x.state}`, null,
      h('div.t-head', null, h('b', { text: x.title }), x.state === 'running' ? iconBtn('x', t('Anuluj'), () => api('tasks:cancel', x.id)) : null),
      x.state === 'running' ? progressBar(p) : null,
      h('small', { text: x.status + (x.progress?.total && x.state === 'running' ? ` · ${x.progress.done}/${x.progress.total}` : '') })));
  }
}

// ---------- panel boczny ----------
let navEls = new Map();
function drawSidebar() {
  const sb = document.getElementById('sidebar');
  sb.replaceChildren();
  navEls = new Map();
  for (const [id, ic, label] of NAV) {
    const el = h('button.nav-item', { title: t(label), onClick: () => navigate(id) }, h('span', { html: icon(ic) }), h('span.nav-label', { text: t(label) }));
    navEls.set(id, el);
    sb.append(el);
  }
  sb.append(h('div.side-title', { text: t('Ostatnio grane') }), h('div.recent-list#recent'), h('div.side-spacer'), h('div#np-slot'), h('div#acc-slot'));
  drawRecent();
  drawNowPlaying();
  drawAccount();
  markNav();
}

function markNav() {
  const r = route().name;
  const map = { instance: 'instances' };
  for (const [id, el] of navEls) el.classList.toggle('active', id === (map[r] || r));
}

function drawRecent() {
  const box = document.getElementById('recent');
  if (!box) return;
  box.replaceChildren();
  const sel = selectedInstance();
  const list = [...S.instances].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0)).slice(0, 6);
  for (const i of list) {
    box.append(h(`div.recent-item${sel?.id === i.id ? '.active' : ''}`, {
      title: i.name,
      onClick: () => navigate('instance', { id: i.id }),
      onContextmenu: (e) => contextMenu(e, [{ label: t('Graj'), icon: 'play', run: () => import('./actions.js').then((m) => m.play(i)) }, { label: t('Otwórz folder'), icon: 'folder', run: () => api('instances:open', i.id) }]),
    }, instIcon({ ...i, running: S.running.has(i.id) }, 'sm'), h('div.ri-meta', null, h('b', { text: i.name }), h('small', { text: `${LOADER_NAMES[i.loader] || ''} ${i.mc}` }))));
  }
}

function drawAccount() {
  const slot = document.getElementById('acc-slot');
  if (!slot) return;
  const a = currentAccount();
  slot.replaceChildren(h('div.account-chip', { onClick: () => openAccounts(), title: t('Konta') },
    avatar(a),
    h('div.acc-meta', null, h('b', { text: a ? a.name : t('Dodaj konto') }), h('small', { text: a ? t('Offline') : t('Kliknij, aby dodać') })),
    h('span.acc-meta', { html: icon('chevronRight') })));
}

// ---------- JustMusic: teraz gra ----------
let npKey = null;
function drawNowPlaying() {
  const slot = document.getElementById('np-slot');
  if (!slot) return;
  slot.replaceChildren();
  const s = S.jm.state;
  if (!S.settings?.justmusic?.enabled || !S.settings.justmusic.showNowPlaying || !S.jm.connected || !s?.track) return;
  const pct = s.duration ? Math.min(100, ((s.time || 0) / s.duration) * 100) : 0;
  const art = h('div.np-art', { style: s.track.thumb ? { backgroundImage: `url("${s.track.thumb}")` } : null, html: s.track.thumb ? '' : icon('music') });
  const key = `${s.track.title}|${s.track.artist || ''}`;
  const changed = npKey !== null && npKey !== key;
  npKey = key;
  slot.append(h(`div.now-playing${changed ? '.np-change' : ''}`, { title: `${s.track.title} – ${s.track.artist || ''}` },
    art,
    h('div.np-meta', { style: { cursor: 'pointer' }, onClick: () => navigate('justmusic') }, h('b', { text: s.track.title }), h('small', { text: s.track.artist || 'JustMusic' })),
    h('div.np-ctl', null,
      iconBtn('prev', t('Poprzedni'), () => api('jm:cmd', 'prev').catch(toastError)),
      iconBtn(s.playing ? 'pause' : 'play', s.playing ? t('Pauza') : t('Graj'), () => api('jm:cmd', 'toggle').catch(toastError)),
      iconBtn('next', t('Następny'), () => api('jm:cmd', 'next').catch(toastError))),
    h('div.np-bar', { style: { width: `${pct}%` } })));
}

export { drawSidebar, drawTitlebar };
