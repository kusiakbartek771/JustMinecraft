// Ustawienia aplikacji (JSON z zapisem atomowym i kopią zapasową).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const file = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = () => ({
  version: 1,
  onboarded: false,
  dataDir: path.join(app.getPath('userData'), 'minecraft'),
  language: 'pl',
  selectedInstance: null,
  selectedAccount: null,
  appearance: {
    theme: 'midnight', accent: '#7c5cff', customAccent: false, background: 'gradient', backgroundImage: '', backgroundBlur: 18, backgroundDim: 55,
    glass: true, radius: 14, font: 'Inter', fontScale: 100, density: 'comfortable', animations: true, sidebar: 'left', sidebarCompact: false,
    cardStyle: 'cover', instanceView: 'grid', customCss: '', showNews: true,
  },
  game: {
    memory: { min: 512, max: 4096, auto: true }, jvmPreset: 'balanced', jvmArgs: '', wrapper: '', gamemode: false, dedicatedGpu: false,
    resolution: { width: 0, height: 0, fullscreen: false }, afterLaunch: 'minimize', showConsoleOnCrash: true, versionTypeLabel: 'JustLauncher',
  },
  java: { path: '' },
  downloads: { concurrency: 16, autoShaderLoader: true, autoDependencies: true, showSnapshots: false, verifyOnRepair: true },
  drive: { apiKey: '' },
  justmusic: {
    enabled: true, path: '', autostart: false, onGameStart: 'resume', playlistId: '', playlistName: '', onGameExit: 'pause',
    volumeInGame: 0, port: 47851, showNowPlaying: true,
  },
  updates: { auto: true, channel: 'latest', checkOnStart: true },
  advanced: { msClientId: '', devtools: false },
});

let data = null;

function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over === undefined ? base : over;
  const out = { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = base && typeof base[k] === 'object' && base[k] && !Array.isArray(base[k]) ? merge(base[k], v) : v;
  }
  return out;
}

function load() {
  if (data) return data;
  let raw = null;
  for (const f of [file(), `${file()}.bak`]) {
    try { raw = JSON.parse(fs.readFileSync(f, 'utf8')); break; } catch {}
  }
  data = merge(DEFAULTS(), raw || {});
  return data;
}

let timer = null;
function saveNow() {
  clearTimeout(timer);
  timer = null;
  const f = file();
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const json = JSON.stringify(data, null, 2);
  try { if (fs.existsSync(f)) fs.copyFileSync(f, `${f}.bak`); } catch {}
  fs.writeFileSync(`${f}.tmp`, json);
  fs.renameSync(`${f}.tmp`, f);
}

function save() {
  clearTimeout(timer);
  timer = setTimeout(saveNow, 300);
}

function get() { return load(); }

function set(patch) {
  data = merge(load(), patch);
  save();
  return data;
}

function reset(section) {
  const d = DEFAULTS();
  if (section && d[section]) data[section] = d[section];
  else data = { ...d, onboarded: true, dataDir: load().dataDir, selectedInstance: data.selectedInstance, selectedAccount: data.selectedAccount };
  save();
  return data;
}

module.exports = { get, set, save, saveNow, reset, DEFAULTS };
