// Aktualizacje aplikacji z GitHub Releases (electron-updater): sprawdzanie, pobieranie w tle
// i instalacja jednym kliknięciem.
const { app } = require('electron');

let autoUpdater = null;
let state = { status: 'idle', version: null, progress: 0, error: null, notes: null };
let send = () => {};
let opts = { auto: true };

function set(patch) {
  state = { ...state, ...patch };
  send(state);
}

function supported() {
  if (!app.isPackaged) return false;
  if (process.platform === 'linux' && !process.env.APPIMAGE && !require('fs').existsSync('/usr/bin/pacman') && !require('fs').existsSync('/usr/bin/dpkg')) return false;
  return true;
}

function init(sender, o = {}) {
  send = sender;
  opts = { ...opts, ...o };
  if (!supported()) { set({ status: 'unsupported' }); return; }
  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = !!opts.auto;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = opts.channel === 'beta';
  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: null }));
  autoUpdater.on('update-available', (i) => set({ status: opts.auto ? 'downloading' : 'available', version: i.version, notes: typeof i.releaseNotes === 'string' ? i.releaseNotes : null }));
  autoUpdater.on('update-not-available', () => set({ status: 'latest' }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', progress: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => set({ status: 'ready', version: i.version, progress: 100 }));
  autoUpdater.on('error', (e) => set({ status: 'error', error: String(e?.message || e).split('\n')[0] }));
  if (opts.checkOnStart !== false) setTimeout(check, 4000);
  setInterval(check, 4 * 60 * 60 * 1000).unref();
}

function configure(o) {
  opts = { ...opts, ...o };
  if (autoUpdater) {
    autoUpdater.autoDownload = !!opts.auto;
    autoUpdater.allowPrerelease = opts.channel === 'beta';
  }
}

async function check() {
  if (!autoUpdater) return state;
  try { await autoUpdater.checkForUpdates(); } catch (e) { set({ status: 'error', error: e.message }); }
  return state;
}

/** Jedno kliknięcie: pobierz (jeśli trzeba) i zainstaluj z ponownym uruchomieniem. */
async function installNow() {
  if (!autoUpdater) throw new Error('Aktualizacje działają tylko w zainstalowanej wersji aplikacji');
  if (state.status === 'ready') { setImmediate(() => autoUpdater.quitAndInstall(false, true)); return; }
  if (!['available', 'downloading'].includes(state.status)) {
    const r = await autoUpdater.checkForUpdates();
    if (!r?.isUpdateAvailable && !(r?.updateInfo?.version && r.updateInfo.version !== app.getVersion())) throw new Error('Masz najnowszą wersję');
  }
  if (state.status === 'ready') { setImmediate(() => autoUpdater.quitAndInstall(false, true)); return; }
  set({ status: 'downloading', progress: 0 });
  autoUpdater.once('update-downloaded', () => setImmediate(() => autoUpdater.quitAndInstall(false, true)));
  await autoUpdater.downloadUpdate();
}

const get = () => state;

module.exports = { init, configure, check, installNow, get };
