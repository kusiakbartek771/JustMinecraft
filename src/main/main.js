// JustMinecraft – proces główny: okno, IPC, zadania w tle (instalacje, pobieranie), uruchamianie gry.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, screen, protocol, nativeImage, clipboard } = require('electron');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const store = require('./store');
const net = require('./core/net');
const mc = require('./core/minecraft');
const loaders = require('./core/loaders');
const launcher = require('./core/launch');
const java = require('./core/java');
const { Instances } = require('./instances');
const content = require('./content');
const modrinth = require('./modrinth');
const curseforge = require('./curseforge');
const drive = require('./drive');
const justhud = require('./justhud');
const modcheck = require('./modcheck');
const worlds = require('./worlds');
const packshare = require('./packshare');
const accounts = require('./accounts');
const jm = require('./justmusic');
const updater = require('./updater');

const PKG = require('../../package.json');
const DEV = process.argv.includes('--dev');
const ROOT = path.join(__dirname, '..', '..');

app.setName('JustMinecraft');
// do wersji 1.1.0 aplikacja nazywała się JustLauncher – istniejące dane (ustawienia, konta, instancje) zostają w starym folderze
{
  const legacy = path.join(app.getPath('appData'), 'JustLauncher');
  if (!fs.existsSync(path.join(app.getPath('userData'), 'settings.json')) && fs.existsSync(path.join(legacy, 'settings.json'))) app.setPath('userData', legacy);
}
// testy/rozwój: osobny folder danych i automatyczne zrzuty ekranu (JL_SHOT=plik.png, JL_SHOT_JS=kod do wykonania)
if (process.env.JL_USERDATA) app.setPath('userData', path.resolve(process.env.JL_USERDATA));
if (process.platform === 'win32') app.setAppUserModelId('app.justlauncher.minecraft');
if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }
// zrzuty ekranu z instancji w galerii: jmshot://thumb|full/<instancja>/<plik>
protocol.registerSchemesAsPrivileged([{ scheme: 'jmshot', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

let win = null;
const S = () => store.get();
const dataDir = () => S().dataDir;
const instances = new Instances(dataDir);
const bridge = new jm.JustMusicBridge();

const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
const toast = (msg, opts = {}) => send('toast', { msg, ...opts });
const trash = (p) => shell.trashItem(p);

// ---------- zadania w tle ----------
const tasks = new Map();
function publicTask(t) {
  const { ctrl, ...rest } = t;
  return rest;
}
function startTask(title, fn, o = {}) {
  const id = crypto.randomUUID();
  const ctrl = new AbortController();
  const t = { id, title, status: 'Przygotowanie…', progress: null, state: 'running', error: null, kind: o.kind || 'task', instanceId: o.instanceId || null, started: Date.now(), ctrl };
  tasks.set(id, t);
  let last = 0;
  const emit = (force) => {
    const now = Date.now();
    if (!force && now - last < 120) return;
    last = now;
    send('tasks:update', publicTask(t));
  };
  const ctx = {
    signal: ctrl.signal,
    onStatus: (s) => { t.status = s; t.progress = null; emit(true); },
    onProgress: (p) => { t.progress = p; emit(); },
    onLog: (l) => send('task:log', { id, line: l }),
  };
  emit(true);
  const promise = (async () => {
    try {
      const r = await fn(ctx, t);
      t.state = 'done'; t.status = o.doneText || 'Gotowe'; t.progress = null;
      emit(true);
      return r;
    } catch (e) {
      t.state = ctrl.signal.aborted ? 'cancelled' : 'error';
      t.error = ctrl.signal.aborted ? 'Anulowano' : friendlyError(e);
      t.status = t.error;
      emit(true);
      throw e;
    } finally {
      setTimeout(() => { tasks.delete(id); send('tasks:remove', id); }, t.state === 'done' ? 6000 : 20000);
    }
  })();
  promise.catch(() => {});
  return { id, promise };
}

function friendlyError(e) {
  const m = String(e?.message || e);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|fetch failed|ETIMEDOUT|network/i.test(m)) return `Brak połączenia z internetem albo serwer nie odpowiada (${m.split('\n')[0]})`;
  if (/ENOSPC/.test(m)) return 'Brak miejsca na dysku';
  if (/EACCES|EPERM/.test(m)) return `Brak uprawnień do zapisu: ${m.split(': ').pop()}`;
  return m;
}

// ---------- okno ----------
function createWindow() {
  const s = S();
  const b = s.window || {};
  const area = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width: Math.min(b.width || 1280, area.width), height: Math.min(b.height || 800, area.height), x: b.x, y: b.y,
    minWidth: 960, minHeight: 600,
    frame: process.platform === 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    backgroundColor: '#0b0d12',
    show: false,
    icon: path.join(ROOT, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: true },
  });
  if (b.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.on('maximize', () => send('win:state', { maximized: true }));
  win.on('unmaximize', () => send('win:state', { maximized: false }));
  const saveBounds = () => {
    if (!win || win.isDestroyed() || win.isMinimized()) return;
    const max = win.isMaximized();
    store.set({ window: { ...(max ? S().window : win.getBounds()), maximized: max } });
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); if (/^https?:\/\//.test(url)) shell.openExternal(url); } });
  if ((DEV || S().advanced.devtools) && !process.env.JL_SHOT) win.webContents.openDevTools({ mode: 'detach' });
  if (process.env.JL_SHOT) {
    win.webContents.on('console-message', (e) => { const m = e.message ?? e; if (e.level === 'error' || e.level === 3) console.log('[renderer]', m); });
    win.webContents.once('did-finish-load', async () => {
      const steps = (process.env.JL_SHOT_JS || '').split('||');
      const shots = process.env.JL_SHOT.split('||');
      await new Promise((r) => setTimeout(r, 2500));
      for (let i = 0; i < shots.length; i++) {
        if (steps[i]) { try { await win.webContents.executeJavaScript(steps[i]); } catch (e) { console.log('[shot js]', e.message); } }
        await new Promise((r) => setTimeout(r, Number(process.env.JL_SHOT_WAIT || 2500)));
        const img = await win.webContents.capturePage();
        fs.writeFileSync(shots[i], img.toPNG());
      }
      app.exit(0);
    });
  }
}

// ---------- IPC ----------
const handle = (ch, fn) => ipcMain.handle(ch, async (_e, ...args) => {
  try { return { ok: true, data: await fn(...args) }; } catch (e) {
    console.error(`[ipc ${ch}]`, e);
    return { ok: false, error: friendlyError(e), code: e.code, url: e.url };
  }
});

handle('app:info', () => ({
  version: PKG.version, platform: process.platform, arch: process.arch, totalMem: Math.floor(os.totalmem() / 1048576),
  cpus: os.cpus().length, userData: app.getPath('userData'), dev: DEV, repo: PKG.justminecraft.repo,
  issuesUrl: PKG.justminecraft.issuesUrl, electron: process.versions.electron, packaged: app.isPackaged,
}));

handle('settings:get', () => S());
handle('settings:set', (patch) => {
  const before = S();
  const oldPort = before.justmusic.port;
  const next = store.set(patch);
  if (patch.downloads?.concurrency) net.cfg.concurrency = Math.max(2, Math.min(64, Number(patch.downloads.concurrency) || 16));
  if (patch.updates) updater.configure(next.updates);
  if (patch.justmusic && (patch.justmusic.enabled !== undefined || patch.justmusic.port !== undefined)) {
    if (next.justmusic.enabled) bridge.start(next.justmusic.port).catch((e) => toast(`JustMusic: port ${next.justmusic.port} jest zajęty (${e.code || e.message})`, { error: true }));
    else bridge.stop();
    if (oldPort !== next.justmusic.port) setTimeout(() => send('jm:connection', bridge.connected), 300);
  }
  if (patch.advanced?.devtools !== undefined && win) { if (next.advanced.devtools) win.webContents.openDevTools({ mode: 'detach' }); else win.webContents.closeDevTools(); }
  return next;
});
handle('settings:reset', (section) => store.reset(section));
handle('settings:export', async () => {
  const r = await dialog.showSaveDialog(win, { defaultPath: 'justminecraft-ustawienia.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
  if (r.canceled) return false;
  const { window: _w, ...rest } = S();
  await fsp.writeFile(r.filePath, JSON.stringify(rest, null, 2));
  return true;
});
handle('settings:import', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  const j = JSON.parse(await fsp.readFile(r.filePaths[0], 'utf8'));
  delete j.dataDir; delete j.selectedAccount;
  return store.set(j);
});

/** Wybór / zmiana folderu instalacji (z opcją przeniesienia danych). */
handle('data:choose', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Folder na gry, wersje i mody', properties: ['openDirectory', 'createDirectory'], defaultPath: dataDir() });
  return r.canceled ? null : r.filePaths[0];
});
handle('data:set', async (dir, move) => {
  const old = dataDir();
  dir = path.resolve(dir);
  if (dir === path.resolve(old)) return S();
  if (launcher.runningList().length) throw new Error('Zamknij grę przed zmianą folderu');
  await fsp.mkdir(dir, { recursive: true });
  await fsp.access(dir, fs.constants.W_OK);
  if (move && fs.existsSync(old)) {
    if (dir.startsWith(path.resolve(old) + path.sep)) throw new Error('Nowy folder nie może być wewnątrz starego');
    const { promise } = startTask('Przenoszenie danych launchera', async (ctx) => {
      const items = await fsp.readdir(old);
      let i = 0;
      for (const it of items) {
        ctx.onStatus(`Przenoszenie: ${it}`);
        ctx.onProgress({ done: i++, total: items.length });
        const from = path.join(old, it); const to = path.join(dir, it);
        try { await fsp.rename(from, to); } catch (e) {
          if (e.code !== 'EXDEV' && e.code !== 'ENOTEMPTY' && e.code !== 'EEXIST') throw e;
          await fsp.cp(from, to, { recursive: true, force: false, errorOnExist: false });
          await fsp.rm(from, { recursive: true, force: true });
        }
      }
    });
    await promise;
  }
  instances.cache = null;
  return store.set({ dataDir: dir });
});
handle('data:usage', async () => {
  const sizeOf = async (p) => {
    let total = 0;
    const stack = [p];
    while (stack.length) {
      const cur = stack.pop();
      let ents;
      try { ents = await fsp.readdir(cur, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const f = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(f);
        else if (e.isFile()) total += (await fsp.stat(f).catch(() => ({ size: 0 }))).size;
      }
    }
    return total;
  };
  const d = mc.dirs(dataDir());
  const out = {};
  for (const k of ['versions', 'libraries', 'assets', 'runtime', 'cache']) out[k] = await sizeOf(d[k]);
  out.instances = await sizeOf(path.join(dataDir(), 'instances'));
  return out;
});
handle('data:clearCache', async () => { await fsp.rm(mc.dirs(dataDir()).cache, { recursive: true, force: true }); return true; });

// --- wersje i loadery ---
handle('versions:list', async (force) => {
  const m = await mc.getManifest(dataDir(), { force });
  return { latest: m.latest, versions: m.versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })) };
});
handle('loaders:versions', (loader, mcv) => loaders.loaderVersions(loader, mcv));
handle('loaders:supported', async (loader) => { const s = await loaders.supportedGameVersions(loader); return s ? [...s] : null; });

// --- instancje ---
handle('instances:list', async () => {
  const list = await instances.list();
  const run = new Set(launcher.runningList().map((r) => r.instanceId));
  return list.map((i) => ({ ...i, running: run.has(i.id) }));
});
handle('instances:create', async (o) => {
  const inst = await instances.create(o);
  store.set({ selectedInstance: inst.id });
  send('instances:changed');
  if (o.preinstall !== false) installTask(inst);
  return inst;
});
handle('instances:update', async (id, patch) => { const r = await instances.update(id, patch); send('instances:changed'); return r; });
handle('instances:remove', async (id) => {
  if (launcher.running.has(id)) throw new Error('Najpierw zamknij grę');
  await instances.remove(id, trash);
  if (S().selectedInstance === id) store.set({ selectedInstance: null });
  send('instances:changed');
  return true;
});
handle('instances:duplicate', async (id, name) => { const r = await instances.duplicate(id, name); send('instances:changed'); return r; });
handle('instances:open', async (id, sub) => {
  const inst = await instances.get(id);
  const p = sub ? path.join(inst.dir, sub) : inst.dir;
  await fsp.mkdir(p, { recursive: true });
  const err = await shell.openPath(p);
  if (err) throw new Error(err);
  return true;
});
handle('instances:worlds', (id) => instances.worlds(id));
handle('instances:importFolder', async (o) => {
  const r = await dialog.showOpenDialog(win, { title: 'Folder z grą (np. .minecraft albo instancja innego launchera)', properties: ['openDirectory'] });
  if (r.canceled) return null;
  const inst = await instances.importFolder(r.filePaths[0], o);
  send('instances:changed');
  installTask(inst);
  return inst;
});
handle('instances:repair', async (id) => {
  const inst = await instances.get(id);
  return installTask(inst, { repair: true }).id;
});
handle('instances:logs', async (id) => {
  const inst = await instances.get(id);
  const out = [];
  for (const f of ['logs/justminecraft-latest.log', 'logs/justlauncher-latest.log', 'logs/latest.log']) {
    try { out.push({ name: f, text: (await fsp.readFile(path.join(inst.dir, f), 'utf8')).slice(-400000) }); } catch {}
  }
  let crashes = [];
  try { crashes = (await fsp.readdir(path.join(inst.dir, 'crash-reports'))).filter((f) => f.endsWith('.txt')).sort().reverse().slice(0, 10); } catch {}
  return { logs: out, crashes };
});
handle('instances:crash', async (id, name) => {
  const inst = await instances.get(id);
  return fsp.readFile(path.join(inst.dir, 'crash-reports', path.basename(name)), 'utf8');
});
handle('instances:shortcut', async (id) => {
  const inst = await instances.get(id);
  if (process.platform !== 'win32') throw new Error('Skróty na pulpicie są dostępne na Windowsie');
  const lnk = path.join(app.getPath('desktop'), `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}.lnk`);
  const ok = shell.writeShortcutLink(lnk, { target: process.execPath, args: `${app.isPackaged ? '' : `"${ROOT}" `}--launch=${inst.id}`, icon: process.execPath, iconIndex: 0, description: `Minecraft – ${inst.name}` });
  if (!ok) throw new Error('Nie udało się utworzyć skrótu');
  return lnk;
});

/** Instalacja wersji/loadera instancji w tle (bez uruchamiania). */
function installTask(inst, o = {}) {
  return startTask(`${o.repair ? 'Naprawa' : 'Instalacja'}: ${inst.name}`, async (ctx) => {
    const p = await launcher.prepare({
      root: dataDir(), instance: inst, settings: S(),
      ctx: { ...ctx, repair: o.repair, verify: o.repair && S().downloads.verifyOnRepair, onVersionId: (vid) => instances.update(inst.id, { versionId: vid }).catch(() => {}) },
    });
    await instances.update(inst.id, { versionId: p.versionId, installed: true });
    send('instances:changed');
    return p.versionId;
  }, { kind: 'install', instanceId: inst.id, doneText: o.repair ? 'Naprawiono' : 'Zainstalowano' });
}

// --- zawartość ---
handle('content:list', async (id, type, world) => content.list(await instances.get(id), type, world));
handle('content:toggle', async (id, type, world, file, enabled) => content.setEnabled(await instances.get(id), type, world, file, enabled));
handle('content:remove', async (id, type, world, files) => {
  const inst = await instances.get(id);
  for (const f of [].concat(files)) await content.remove(inst, type, world, f, trash);
  return true;
});
handle('content:identify', async (id, type, world) => {
  const inst = await instances.get(id);
  return modrinth.identify(inst, await content.list(inst, type, world));
});
handle('content:checkUpdates', async (id, type, world) => {
  const inst = await instances.get(id);
  return modrinth.checkUpdates(inst, await content.list(inst, type, world), type);
});
handle('content:update', async (id, type, world, list) => {
  const inst = await instances.get(id);
  const { promise } = startTask(`Aktualizacja (${list.length}): ${inst.name}`, async (ctx) => {
    let i = 0;
    for (const u of list) {
      ctx.onProgress({ done: i++, total: list.length });
      await modrinth.install({ inst, projectId: u.projectId, versionId: u.versionId, type, world, deps: false, onStatus: ctx.onStatus, signal: ctx.signal });
    }
  }, { instanceId: id });
  await promise;
  return true;
});
handle('content:addFiles', async (id, files, type, world) => {
  const inst = await instances.get(id);
  if (!files) {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mody i paczki', extensions: ['jar', 'zip', 'mrpack'] }] });
    if (r.canceled) return [];
    files = r.filePaths;
  }
  const out = [];
  for (const f of files) {
    if (f.toLowerCase().endsWith('.mrpack')) { out.push({ file: path.basename(f), kind: 'modpack', added: false }); continue; }
    const r = await content.addFile(inst, f, { type: type === 'datapack' ? 'datapack' : undefined, world });
    out.push({ file: path.basename(f), ...r });
  }
  return out;
});

// --- Modrinth ---
handle('modrinth:search', (o) => modrinth.search(o));
// --- CurseForge ---
curseforge.configure({ getKey: () => S().curseforge?.apiKey || '' });
handle('cf:status', () => ({ hasKey: curseforge.hasKey() }));
handle('cf:search', (o) => curseforge.search(o));
handle('cf:project', (id) => curseforge.project(id));
handle('cf:versions', (id, o) => curseforge.versions(id, o));
handle('cf:installModpack', async (o) => {
  const { file } = await curseforge.downloadPackVersion(o.projectId, o.versionId, mc.dirs(dataDir()).cache);
  return installCfPackFile(file, { name: o.title, icon: o.icon, source: { type: 'curseforge', projectId: o.projectId, versionId: o.versionId || null } });
});
handle('modrinth:project', (id) => modrinth.project(id));
handle('modrinth:versions', (id, o) => modrinth.versions(id, o));
handle('modrinth:install', async (o) => {
  const inst = await instances.get(o.instanceId);
  const { promise } = startTask(`${o.title || 'Instalacja'} → ${inst.name}`, async (ctx) => {
    const warnings = [];
    const src = o.source === 'curseforge' ? curseforge : modrinth;
    const installed = await src.install({ inst, projectId: o.projectId, versionId: o.versionId, type: o.type, world: o.world, deps: S().downloads.autoDependencies, onStatus: ctx.onStatus, signal: ctx.signal, onWarn: (w) => warnings.push(w) });
    // shadery potrzebują Iris/Oculus
    if (o.type === 'shader' && S().downloads.autoShaderLoader && inst.loader !== 'vanilla') {
      const idx = await content.loadIndex(inst);
      const have = new Set(Object.values(idx.files).map((f) => f.slug));
      const mods = await content.list(inst, 'mod').catch(() => []);
      const hasLocal = mods.some((m) => /^(iris|oculus)$/i.test(m.modId || ''));
      const opts = modrinth.SHADER_LOADERS[inst.loader] || [];
      if (!hasLocal && !opts.some((s) => have.has(s))) {
        for (const slug of opts) {
          try {
            ctx.onStatus(`Instalacja ${slug} (potrzebny do shaderów)`);
            installed.push(...(await modrinth.install({ inst, projectId: slug, type: 'mod', deps: true, onStatus: ctx.onStatus, signal: ctx.signal })));
            break;
          } catch (e) { warnings.push(`${slug}: ${e.message}`); }
        }
      }
    }
    return { installed, warnings };
  }, { instanceId: inst.id, doneText: 'Zainstalowano' });
  return promise;
});
handle('modrinth:performance', async (id) => {
  const inst = await instances.get(id);
  const list = modrinth.PERFORMANCE[inst.loader];
  if (!list) throw new Error('Mody wydajnościowe wymagają loadera (Fabric, Quilt, Forge albo NeoForge) – zmień go w ustawieniach instancji.');
  const { promise } = startTask(`Pakiet wydajności → ${inst.name}`, async (ctx) => {
    const ok = []; const skipped = [];
    const idx = await content.loadIndex(inst);
    const have = new Set(Object.values(idx.files).map((f) => f.slug));
    let i = 0;
    for (const slug of list) {
      ctx.onProgress({ done: i++, total: list.length });
      if (have.has(slug)) { ok.push(slug); continue; }
      try { await modrinth.install({ inst, projectId: slug, type: 'mod', deps: true, onStatus: ctx.onStatus, signal: ctx.signal }); ok.push(slug); } catch { skipped.push(slug); }
    }
    return { ok, skipped };
  }, { instanceId: id });
  return promise;
});

/** Modpack z Modrinth albo plik .mrpack → nowa instancja. */
async function installMrpackFile(file, o = {}) {
  const info = await modrinth.readMrpack(file);
  const inst = await instances.create({ name: o.name || info.name, mc: info.mc, loader: info.loader, loaderVersion: info.loaderVersion, icon: o.icon, source: o.source || { type: 'mrpack', name: info.name, version: info.version } });
  send('instances:changed');
  const { promise } = startTask(`Modpack: ${info.name}`, async (ctx) => {
    await modrinth.applyMrpack(inst, file, ctx);
    const p = await launcher.prepare({ root: dataDir(), instance: inst, settings: S(), ctx: { ...ctx, onVersionId: (vid) => instances.update(inst.id, { versionId: vid }).catch(() => {}) } });
    await instances.update(inst.id, { versionId: p.versionId, installed: true });
    send('instances:changed');
  }, { instanceId: inst.id, doneText: 'Modpack gotowy' });
  promise.then(() => toast(`Modpack „${info.name}” jest gotowy do gry`)).catch(() => {});
  store.set({ selectedInstance: inst.id });
  return inst;
}
handle('modrinth:installModpack', async (o) => {
  let versionId = o.versionId;
  if (!versionId) {
    const list = await modrinth.versions(o.projectId, {});
    const pick = list.find((v) => v.type === 'release') || list[0];
    if (!pick) throw new Error('Ten modpack nie ma wersji do pobrania');
    versionId = pick.id;
  }
  const { file } = await modrinth.downloadPackVersion(versionId, mc.dirs(dataDir()).cache);
  return installMrpackFile(file, { name: o.title, icon: o.icon, source: { type: 'modrinth', projectId: o.projectId, versionId } });
});
/** Modpack CurseForge (.zip z manifest.json) → nowa instancja. */
async function installCfPackFile(file, o = {}) {
  const info = await curseforge.readPack(file);
  const inst = await instances.create({ name: o.name || info.name, mc: info.mc, loader: info.loader, loaderVersion: info.loaderVersion, icon: o.icon, source: o.source || { type: 'cfpack', name: info.name, version: info.version } });
  send('instances:changed');
  const { promise } = startTask(`Modpack: ${info.name}`, async (ctx) => {
    const r = await curseforge.applyPack(inst, file, ctx);
    const p = await launcher.prepare({ root: dataDir(), instance: inst, settings: S(), ctx: { ...ctx, onVersionId: (vid) => instances.update(inst.id, { versionId: vid }).catch(() => {}) } });
    await instances.update(inst.id, { versionId: p.versionId, installed: true });
    send('instances:changed');
    if (r.blocked.length) {
      ctx.onLog?.(`Pliki do pobrania ręcznie (autorzy nie pozwalają na pobieranie w launcherach):\n${r.blocked.map((b) => `• ${b.name} → ${b.folder}/  ${b.url || ''}`).join('\n')}`);
      toast(`Modpack „${info.name}”: ${r.blocked.length} plików trzeba pobrać ręcznie ze strony CurseForge i wrzucić do instancji (lista w konsoli zadania).`, { error: true });
    }
  }, { instanceId: inst.id, doneText: 'Modpack gotowy' });
  promise.then(() => toast(`Modpack „${info.name}” jest gotowy do gry`)).catch(() => {});
  store.set({ selectedInstance: inst.id });
  return inst;
}
// --- eksport i kody udostępniania ---
handle('instances:export', async (id, kind, o = {}) => {
  const inst = await instances.get(id);
  const ext = kind === 'mrpack' ? 'mrpack' : 'zip';
  const r = await dialog.showSaveDialog(win, { defaultPath: `${inst.name.replace(/[\\/:*?"<>|]/g, '_')}.${ext}`, filters: [{ name: kind === 'mrpack' ? 'Modpack Modrinth' : 'Instancja JustMinecraft', extensions: [ext] }] });
  if (r.canceled || !r.filePath) return null;
  const { promise } = startTask(`Eksport: ${inst.name}`, async (ctx) => {
    const res = kind === 'mrpack' ? await packshare.exportMrpack(inst, r.filePath, o, ctx) : await packshare.exportZip(inst, r.filePath, o, ctx);
    shell.showItemInFolder(r.filePath);
    return { file: r.filePath, ...(res || {}) };
  }, { instanceId: id, doneText: 'Wyeksportowano' });
  return promise;
});
handle('share:code', async (id) => packshare.makeCode(await instances.get(id)));
handle('share:preview', (code) => packshare.readCode(code));
handle('share:import', async (code) => {
  const d = packshare.readCode(code);
  const inst = await instances.create({ name: d.name, mc: d.mc, loader: d.loader, loaderVersion: d.loaderVersion, source: { type: 'code' } });
  send('instances:changed');
  const { promise } = startTask(`Paczka z kodu: ${d.name}`, async (ctx) => {
    const r = await packshare.applyCode(inst, d, ctx);
    const p = await launcher.prepare({ root: dataDir(), instance: inst, settings: S(), ctx: { ...ctx, onVersionId: (vid) => instances.update(inst.id, { versionId: vid }).catch(() => {}) } });
    await instances.update(inst.id, { versionId: p.versionId, installed: true });
    send('instances:changed');
    if (r.failed.length) toast(`Nie udało się pobrać ${r.failed.length} plików z kodu`, { error: true });
    return r;
  }, { instanceId: inst.id, doneText: 'Paczka gotowa' });
  promise.catch(() => {});
  return inst;
});
handle('pack:isCurseForge', async (file) => !!(await curseforge.readPack(file).catch(() => null)) || !!(await packshare.readZipManifest(file).catch(() => null)));
handle('mrpack:import', async (file) => {
  if (!file) {
    const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Modpack (Modrinth .mrpack, CurseForge .zip)', extensions: ['mrpack', 'zip'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    file = r.filePaths[0];
  }
  if (file.toLowerCase().endsWith('.zip')) {
    const own = await packshare.readZipManifest(file);
    if (own) {
      const inst = await instances.create({ name: own.name, mc: own.mc, loader: own.loader, loaderVersion: own.loaderVersion, icon: own.icon, color: own.color, source: { type: 'zip' } });
      send('instances:changed');
      const { promise } = startTask(`Import: ${own.name}`, async (ctx) => {
        await packshare.applyZip(inst, file);
        const p = await launcher.prepare({ root: dataDir(), instance: inst, settings: S(), ctx: { ...ctx, onVersionId: (vid) => instances.update(inst.id, { versionId: vid }).catch(() => {}) } });
        await instances.update(inst.id, { versionId: p.versionId, installed: true });
        send('instances:changed');
      }, { instanceId: inst.id, doneText: 'Zaimportowano' });
      promise.catch(() => {});
      return inst;
    }
    return installCfPackFile(file);
  }
  return installMrpackFile(file);
});

// --- Google Drive ---
let packsCache = null;
handle('drive:packs', async (force) => {
  if (packsCache && !force && Date.now() - packsCache.at < 10 * 60e3) return packsCache.data;
  let data = null;
  try { data = await net.json(`${PKG.justminecraft.packsUrl}?t=${Date.now()}`, { retries: 1 }); } catch {}
  if (!data) data = JSON.parse(await fsp.readFile(path.join(ROOT, 'packs', 'packs.json'), 'utf8').catch(() => '{"packs":[]}'));
  packsCache = { at: Date.now(), data };
  return data;
});
async function driveImport(inst, link, title) {
  const { promise } = startTask(`Google Drive → ${inst.name}`, async (ctx) => {
    const prev = inst.drive?.files || {};
    let r;
    try {
      r = await drive.importToInstance(inst, link, { cacheDir: mc.dirs(dataDir()).cache, apiKey: S().drive.apiKey, previous: prev, removeMissing: !!inst.drive, ...ctx });
    } catch (e) {
      // część plików się pobrała – zapamiętaj je, żeby ponowna próba dociągnęła tylko resztę
      if (e.partial) await instances.update(inst.id, { drive: { link, title: title || inst.drive?.title || null, files: { ...prev, ...e.partial.files }, synced: Date.now() } }).catch(() => {});
      throw e;
    }
    for (const sp of r.report.special) {
      if (sp.kind === 'modpack') { ctx.onStatus(`Modpack z Drive: ${sp.name}`); await modrinth.applyMrpack(inst, sp.file, ctx); }
    }
    await instances.update(inst.id, { drive: { link, title: title || inst.drive?.title || null, files: r.files, synced: Date.now() } });
    send('instances:changed');
    return r.report;
  }, { instanceId: inst.id, doneText: 'Zaimportowano' });
  return promise;
}
handle('drive:import', async (o) => {
  drive.parseLink(o.link);
  let inst;
  if (o.instanceId) inst = await instances.get(o.instanceId);
  else {
    inst = await instances.create({ name: o.name || 'Paczka z Google Drive', mc: o.mc, loader: o.loader, loaderVersion: o.loaderVersion, icon: o.icon, source: { type: 'drive', packId: o.packId || null } });
    send('instances:changed');
    store.set({ selectedInstance: inst.id });
  }
  const report = await driveImport(inst, o.link, o.name);
  if (!o.instanceId) installTask(await instances.get(inst.id));
  return { instanceId: inst.id, report };
});
handle('drive:sync', async (id) => {
  const inst = await instances.get(id);
  if (!inst.drive?.link) throw new Error('Ta instancja nie jest połączona z Google Drive');
  return driveImport(inst, inst.drive.link);
});

// --- konta ---
handle('accounts:list', () => ({ accounts: accounts.list(), selected: S().selectedAccount }));
handle('accounts:addOffline', (name) => { const a = accounts.addOffline(name); if (!S().selectedAccount) store.set({ selectedAccount: a.id }); return a; });
handle('accounts:remove', (id) => { accounts.remove(id); if (S().selectedAccount === id) store.set({ selectedAccount: accounts.list()[0]?.id || null }); return true; });
handle('accounts:select', (id) => { store.set({ selectedAccount: id }); return true; });

// --- Java ---
handle('java:detect', () => java.detect());
handle('java:probe', (p) => java.probe(p));
handle('java:choose', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Wskaż plik java / javaw.exe', properties: ['openFile'] });
  if (r.canceled) return null;
  const info = await java.probe(r.filePaths[0]);
  if (!info) throw new Error('To nie jest działająca Java');
  return info;
});
handle('system:memory', () => ({ total: Math.floor(os.totalmem() / 1048576), free: Math.floor(os.freemem() / 1048576), suggest: launcher.suggestMemory(50) }));
handle('jvm:presets', () => Object.fromEntries(Object.entries(launcher.JVM_PRESETS).map(([k, v]) => [k, v.name])));

// --- gra ---
const pendingJm = [];
async function onGameStarted(inst) {
  const j = S().justmusic;
  bridge.setGame({ instanceId: inst.id, name: inst.name, mc: inst.mc, loader: inst.loader, startedAt: Date.now() });
  if (!j.enabled) return;
  const cmds = [];
  if (j.onGameStart === 'playlist' && j.playlistId) cmds.push(['play-playlist', { id: j.playlistId, shuffle: true }]);
  else if (j.onGameStart === 'resume') cmds.push(['resume', {}]);
  if (j.volumeInGame > 0) cmds.push(['volume', { value: j.volumeInGame / 100, remember: true }]);
  if (!cmds.length) return;
  if (bridge.connected) for (const [c, a] of cmds) bridge.command(c, a);
  else if (j.autostart) {
    try { jm.launchApp(j.path); pendingJm.push(...cmds); } catch (e) { toast(e.message, { error: true }); }
  }
}
function onGameStopped() {
  const j = S().justmusic;
  bridge.setGame(null);
  if (!j.enabled || !bridge.connected) return;
  if (j.volumeInGame > 0) bridge.command('volume-restore');
  if (j.onGameExit === 'pause') bridge.command('pause');
}

const e4mcDomains = new Map();
/** Czeka na wynik testu wydajności z JustHUD i przekazuje go do okna. */
function watchBench(id, file) {
  const started = Date.now();
  const timer = setInterval(async () => {
    try {
      const r = JSON.parse(await fsp.readFile(file, 'utf8'));
      clearInterval(timer);
      await instances.update(id, { bench: { ...r, at: Date.now() } });
      send('game:bench', { instanceId: id, result: r });
      if (win) { if (!win.isVisible()) win.show(); win.flashFrame?.(true); }
    } catch {
      if (Date.now() - started > 60 * 60e3 || (!launcher.running.has(id) && Date.now() - started > 120e3)) clearInterval(timer);
    }
  }, 2000);
}
handle('e4mc:domain', (id) => e4mcDomains.get(id) || null);
async function launchInstance(id, o = {}) {
  const inst = await instances.get(id);
  if (launcher.running.has(id)) throw new Error(`${inst.name} już działa`);
  if ([...tasks.values()].some((t) => t.instanceId === id && t.state === 'running' && t.kind === 'launch')) throw new Error('Gra właśnie się uruchamia');
  const account = await accounts.forLaunch(S().selectedAccount);
  await drive.syncGlobalDatapacks(inst).catch(() => 0);
  store.set({ selectedInstance: id });
  const { promise } = startTask(`Uruchamianie: ${inst.name}`, async (ctx) => {
    const settings = S();
    if (settings.game.memory.auto && !inst.memory) {
      const mods = await fsp.readdir(path.join(inst.dir, 'mods')).catch(() => []);
      settings.game = { ...settings.game, memory: { ...settings.game.memory, max: launcher.suggestMemory(mods.filter((m) => m.endsWith('.jar')).length) } };
    }
    // JustHUD (widżety w grze) – dołóż albo usuń właściwy plik
    const hudOn = o.bench ? true : inst.justhud ?? settings.game.justhud ?? true;
    const hud = await justhud.sync(inst, hudOn).catch((e) => { ctx.onLog?.(`[JustMinecraft] JustHUD: ${e.message}`); return null; });
    if (hud) {
      await content.remember(inst, path.join('mods', hud), { source: 'justminecraft', title: 'JustHUD', description: 'Widżety w grze (JustMusic, zbroja, współrzędne, FPS, zegar). Edytor: klawisz J. Wbudowany w launcher.', type: 'mod', builtin: true }).catch(() => {});
    }
    const port = settings.justmusic?.port || 47851;
    let benchArgs = '';
    if (o.bench) {
      if (!hud) throw new Error('Test wydajności wymaga JustHUD (Fabric, Quilt, Forge albo NeoForge w obsługiwanej wersji).');
      const out = path.join(inst.dir, '.justlauncher', 'bench.json');
      await fsp.rm(out, { force: true });
      benchArgs = ` -Djusthud.bench=${Number(o.bench) || 60} "-Djusthud.benchOut=${out}"`;
      watchBench(id, out);
    }
    const instance = { ...inst, quickJoin: o.server || inst.quickJoin, jvmArgs: `${inst.jvmArgs || ''} -Djusthud.port=${port}${benchArgs}`.trim() };
    const r = await launcher.launch({
      root: dataDir(), instance, account, settings,
      ctx: { ...ctx, onVersionId: (vid) => instances.update(id, { versionId: vid }).catch(() => {}) },
    }, {
      onLog: (line) => {
        send('game:log', { instanceId: id, line });
        // e4mc: adres serwera dla znajomych po „Otwórz w sieci LAN”
        const m = /hosted on domain \[([^\]\s]+)\]/i.exec(line) || /\b((?!broker\.)[a-z0-9-]+(?:\.[a-z0-9-]+)+\.e4mc\.link)\b/i.exec(line);
        if (m && e4mcDomains.get(id) !== m[1]) { e4mcDomains.set(id, m[1]); send('game:e4mc', { instanceId: id, domain: m[1] }); }
      },
      onStart: () => {
        e4mcDomains.delete(id);
        instances.update(id, { lastPlayed: Date.now(), installed: true }).then(() => send('instances:changed')).catch(() => {});
        send('game:state', { instanceId: id, running: true });
        const after = S().game.afterLaunch;
        if (win && after === 'minimize') win.minimize();
        if (win && after === 'hide') win.hide();
        onGameStarted(inst);
      },
      onExit: async (e) => {
        await instances.recordPlay(id, e.playedMs).catch(() => {});
        // automatyczne kopie zmienionych światów
        if (S().backups?.auto !== false) {
          worlds.autoBackup(inst, S().backups?.keep || 5, (l) => send('game:log', { instanceId: id, line: `[JustMinecraft] ${l}` }))
            .then((list) => { if (list.length) toast(`Kopia zapasowa: ${list.join(', ')}`, { icon: 'shield' }); }).catch(() => {});
        }
        send('game:state', { instanceId: id, running: false, ...e });
        send('instances:changed');
        if (win && (S().game.afterLaunch !== 'keep' || e.crashed)) { if (!win.isVisible()) win.show(); if (e.crashed) { win.restore(); win.focus(); } }
        if (!launcher.runningList().length) onGameStopped();
      },
    });
    await instances.update(id, { versionId: r.versionId });
    return r;
  }, { kind: 'launch', instanceId: id, doneText: 'Gra uruchomiona' });
  return promise;
}
handle('game:launch', (id, o) => launchInstance(id, o));
handle('mods:check', async (id) => modcheck.check(await instances.get(id)));
// --- światy ---
const noGame = (id) => { if (launcher.running.has(id)) throw new Error('Zamknij grę, zanim zmienisz kopie świata'); };
handle('worlds:info', async (id, w) => worlds.info(await instances.get(id), w));
handle('worlds:backup', async (id, w) => {
  const inst = await instances.get(id);
  const { promise } = startTask(`Kopia świata „${w}”`, (ctx) => worlds.backup(inst, w, { onStatus: ctx.onStatus }), { instanceId: id, doneText: 'Kopia gotowa' });
  return promise;
});
handle('worlds:restore', async (id, w, file) => {
  noGame(id);
  const inst = await instances.get(id);
  const { promise } = startTask(`Przywracanie „${w}”`, () => worlds.restore(inst, w, file), { instanceId: id, doneText: 'Przywrócono' });
  return promise;
});
handle('worlds:removeBackup', async (id, w, file) => worlds.removeBackup(await instances.get(id), w, file));
handle('worlds:showBackups', async (id, w) => { const inst = await instances.get(id); const d = path.join(inst.dir, '.justlauncher', 'backups', w); await fsp.mkdir(d, { recursive: true }); shell.openPath(d); return true; });
handle('worlds:map', async (id, w, o = {}) => {
  const inst = await instances.get(id);
  const dimension = o.dimension || 'overworld';
  const cacheDir = path.join(inst.dir, '.justlauncher', 'maps');
  const base = path.join(cacheDir, `${w.replace(/[^\w\-]+/g, '_')}-${dimension}`);
  const lvl = await fsp.stat(path.join(inst.dir, 'saves', w, 'level.dat')).catch(() => null);
  try {
    const meta = JSON.parse(await fsp.readFile(`${base}.json`, 'utf8'));
    if (!o.force && lvl && meta.levelMtime === lvl.mtimeMs) return { ...meta, url: `data:image/png;base64,${(await fsp.readFile(`${base}.png`)).toString('base64')}`, cached: true };
  } catch {}
  const info = await worlds.info(inst, w).catch(() => ({}));
  const c = info.player || info.spawn || { x: 0, z: 0 };
  const r = await worlds.renderMap(inst, w, { x: c.x, z: c.z, dimension, maxRegions: o.maxRegions || 16, onProgress: (p) => send('worlds:mapProgress', { id, world: w, p }) });
  if (r.empty) return { empty: true };
  const { nativeImage } = require('electron');
  const png = nativeImage.createFromBitmap(Buffer.from(r.bgra), { width: r.width, height: r.height }).toPNG();
  const meta = { width: r.width, height: r.height, minX: r.minX, minZ: r.minZ, chunks: r.chunks, regions: r.regions, totalRegions: r.totalRegions, player: info.player || null, spawn: info.spawn || null, levelMtime: lvl?.mtimeMs || 0 };
  await fsp.mkdir(cacheDir, { recursive: true });
  await fsp.writeFile(`${base}.png`, png);
  await fsp.writeFile(`${base}.json`, JSON.stringify(meta));
  return { ...meta, url: `data:image/png;base64,${png.toString('base64')}` };
});
handle('mods:fix', async (id, problems) => {
  const inst = await instances.get(id);
  const { promise } = startTask(`Naprawa modów → ${inst.name}`, (ctx) => modcheck.fix(inst, problems, ctx), { instanceId: id, doneText: 'Naprawiono' });
  return promise;
});
handle('justhud:support', async (id) => { const s = justhud.support(await instances.get(id)); return { ok: s.ok, reason: s.reason || null, file: s.jar?.file || null }; });
handle('game:kill', (id) => launcher.kill(id));
handle('game:running', () => launcher.runningList());
handle('tasks:list', () => [...tasks.values()].map(publicTask));
handle('tasks:cancel', (id) => { tasks.get(id)?.ctrl.abort(new Error('Anulowano')); return true; });

// --- JustMusic ---
bridge.handlers = {
  listInstances: async () => (await instances.list()).map((i) => ({ id: i.id, name: i.name, mc: i.mc, loader: i.loader, icon: i.icon, lastPlayed: i.lastPlayed, running: launcher.running.has(i.id) })),
  launch: async (id) => { await launchInstance(id); },
};
bridge.on('state', (s) => send('jm:state', s));
bridge.on('connection', (c) => {
  send('jm:connection', c);
  if (c && pendingJm.length) setTimeout(() => { for (const [cmd, a] of pendingJm.splice(0)) bridge.command(cmd, a); }, 1500);
});
handle('jm:status', () => ({ ...jm.detect(S().justmusic.path), connected: bridge.connected, port: bridge.port, state: bridge.state }));
handle('jm:launch', () => jm.launchApp(S().justmusic.path));
handle('jm:cmd', (cmd, args) => { if (!bridge.connected) throw new Error('JustMusic nie jest połączony'); return bridge.command(cmd, args); });
handle('jm:installPlugin', async () => jm.installPlugin(path.join(ROOT, 'justmusic-plugin')));
handle('jm:choosePath', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Wskaż aplikację JustMusic', properties: ['openFile'] });
  if (r.canceled) return null;
  store.set({ justmusic: { path: r.filePaths[0] } });
  return r.filePaths[0];
});

// --- aktualizacje ---
handle('update:get', () => updater.get());
handle('update:check', () => updater.check());
handle('update:install', () => updater.installNow());

// --- system ---
handle('shell:open', (url) => { if (!/^https?:\/\//.test(url)) throw new Error('Nieprawidłowy link'); return shell.openExternal(url); });
handle('shell:showItem', (p) => { shell.showItemInFolder(p); return true; });
handle('dialog:image', async () => {
  const r = await dialog.showOpenDialog(win, { filters: [{ name: 'Obrazy', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  const buf = await fsp.readFile(r.filePaths[0]);
  if (buf.length > 8 * 1048576) throw new Error('Obraz jest za duży (maks. 8 MB)');
  const ext = path.extname(r.filePaths[0]).slice(1).toLowerCase().replace('jpg', 'jpeg');
  return `data:image/${ext};base64,${buf.toString('base64')}`;
});
ipcMain.on('win:minimize', () => win?.minimize());
ipcMain.on('win:maximize', () => { if (!win) return; if (win.isMaximized()) win.unmaximize(); else win.maximize(); });
ipcMain.on('win:close', () => win?.close());

// ---------- start ----------
function argLaunch(argv) {
  const a = argv.find((x) => x.startsWith('--launch='));
  return a ? a.slice('--launch='.length) : null;
}

app.on('second-instance', (_e, argv) => {
  const id = argLaunch(argv);
  if (id) launchInstance(id).catch((e) => toast(e.message, { error: true }));
  if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
});

// ---------- galeria zrzutów ----------
const thumbs = new Map();
async function shotPath(instId, file) {
  if (!/^[^\\/]+\.(png|jpe?g)$/i.test(file)) throw new Error('Zła nazwa pliku');
  const inst = await instances.get(instId);
  return { inst, file: path.join(inst.dir, 'screenshots', file) };
}
handle('gallery:list', async () => {
  const out = [];
  for (const inst of await instances.list()) {
    let files = [];
    try { files = await fsp.readdir(path.join(inst.dir, 'screenshots')); } catch { continue; }
    for (const f of files) {
      if (!/\.(png|jpe?g)$/i.test(f)) continue;
      const st = await fsp.stat(path.join(inst.dir, 'screenshots', f)).catch(() => null);
      if (st) out.push({ instanceId: inst.id, instance: inst.name, file: f, size: st.size, date: st.mtimeMs });
    }
  }
  return out.sort((a, b) => b.date - a.date);
});
handle('gallery:cover', async (instId, file) => {
  const { file: p } = await shotPath(instId, file);
  const img = nativeImage.createFromPath(p);
  const small = img.getSize().width > 1280 ? img.resize({ width: 1280, quality: 'best' }) : img;
  await instances.update(instId, { cover: `data:image/jpeg;base64,${small.toJPEG(85).toString('base64')}` });
  send('instances:changed');
  return true;
});
handle('gallery:copy', async (instId, file) => { const { file: p } = await shotPath(instId, file); clipboard.writeImage(nativeImage.createFromPath(p)); return true; });
handle('gallery:show', async (instId, file) => { const { file: p } = await shotPath(instId, file); shell.showItemInFolder(p); return true; });
handle('gallery:remove', async (instId, file) => { const { file: p } = await shotPath(instId, file); await shell.trashItem(p); thumbs.delete(`${instId}/${file}`); return true; });

app.whenReady().then(async () => {
  protocol.handle('jmshot', async (req) => {
    try {
      const u = new URL(req.url);
      const [, instId, file] = decodeURIComponent(u.pathname).split('/');
      const { file: p } = await shotPath(instId, file);
      if (u.hostname === 'full') return new Response(await fsp.readFile(p), { headers: { 'Content-Type': /\.png$/i.test(p) ? 'image/png' : 'image/jpeg' } });
      const st = await fsp.stat(p);
      const key = `${instId}/${file}`;
      let c = thumbs.get(key);
      if (!c || c.mtime !== st.mtimeMs) {
        const img = nativeImage.createFromPath(p);
        c = { mtime: st.mtimeMs, buf: img.resize({ width: 360, quality: 'good' }).toJPEG(80) };
        thumbs.set(key, c);
      }
      return new Response(c.buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' } });
    } catch (e) { return new Response('not found', { status: 404 }); }
  });
  Menu.setApplicationMenu(process.platform === 'darwin' ? Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]) : null);
  nativeTheme.themeSource = 'dark';
  const s = S();
  net.cfg.concurrency = Math.max(2, Math.min(64, Number(s.downloads.concurrency) || 16));
  createWindow();
  if (s.justmusic.enabled) bridge.start(s.justmusic.port).catch((e) => console.warn('[justmusic] most nie wystartował:', e.message));
  updater.init((st) => send('update:status', st), s.updates);
  const id = argLaunch(process.argv);
  if (id) win.webContents.once('did-finish-load', () => launchInstance(id).catch((e) => toast(e.message, { error: true })));
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); else win?.show(); });
});

app.on('window-all-closed', () => {
  // gra działa dalej jako osobny proces potomny – launcher czeka na jej zakończenie
  if (launcher.runningList().length) return;
  store.saveNow();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => { store.saveNow(); bridge.stop(); });
