// Integracja z JustMusic (https://github.com/kusiakbartek771/JustMusic).
// Launcher wystawia lokalny most HTTP (tylko 127.0.0.1). Wtyczka „Minecraft” w JustMusic łączy się z nim:
// • JustMusic wysyła stan odtwarzacza (utwór, okładka, playlisty) → launcher pokazuje „teraz gra” z przyciskami,
// • launcher wysyła polecenia (graj playlistę przy starcie gry, pauza po wyjściu, przyciszanie, sterowanie),
// • JustMusic może uruchomić instancję Minecrafta jednym kliknięciem.
const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const PLUGIN_ID = 'minecraft';

class JustMusicBridge extends EventEmitter {
  constructor() {
    super();
    this.server = null;
    this.port = 0;
    this.clients = new Set();
    this.state = null; // ostatni stan z JustMusic
    this.handlers = {}; // { listInstances(), launch(id) }
    this.game = null;
  }

  get connected() { return this.clients.size > 0; }

  allowedOrigin(origin) {
    if (!origin || origin === 'null') return true;
    return /^jm:\/\/|^file:\/\//.test(origin);
  }

  async start(port = 47851) {
    if (this.server && this.port === port) return this.port;
    this.stop();
    const server = http.createServer((req, res) => this.handle(req, res).catch((e) => {
      try { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); } catch {}
    }));
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    this.server = server;
    this.port = port;
    return port;
  }

  stop() {
    for (const c of this.clients) { try { c.end(); } catch {} }
    this.clients.clear();
    if (this.server) { this.server.close(); this.server = null; }
    this.emit('connection', false);
  }

  cors(req, res) {
    const origin = req.headers.origin;
    if (origin && this.allowedOrigin(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-JustLauncher');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
  }

  async body(req) {
    let s = '';
    for await (const c of req) { s += c; if (s.length > 2e6) throw new Error('Za duże żądanie'); }
    return s ? JSON.parse(s) : {};
  }

  async handle(req, res) {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost'].includes(host)) { res.writeHead(403); return res.end(); }
    if (req.headers.origin && !this.allowedOrigin(req.headers.origin)) { res.writeHead(403); return res.end(); }
    this.cors(req, res);
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); res.end(JSON.stringify(obj)); };
    // zapisujące żądania muszą mieć nagłówek (wymusza preflight CORS – strony WWW go nie przejdą)
    if (req.method === 'POST' && req.headers['x-justlauncher'] !== '1') return json(403, { error: 'brak nagłówka' });

    if (url.pathname === '/hello') return json(200, { app: 'JustMinecraft', version: require('../../package.json').version, plugin: PLUGIN_ID });
    if (url.pathname === '/events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 3000\n\n');
      this.clients.add(res);
      this.send({ type: 'hello', game: this.game }, res);
      const ping = setInterval(() => res.write(': ping\n\n'), 15000);
      this.emit('connection', true);
      req.on('close', () => {
        clearInterval(ping);
        this.clients.delete(res);
        if (!this.clients.size) { this.state = null; this.emit('state', null); this.emit('connection', false); }
      });
      return;
    }
    // mod JustHUD w grze: stan muzyki (bez okładki – lżej) i sterowanie
    if (url.pathname === '/game/nowplaying' && req.method === 'GET') {
      const st = this.state;
      return json(200, {
        connected: this.clients.size > 0,
        track: st?.track ? { title: st.track.title, artist: st.track.artist } : null,
        playing: !!st?.playing, time: st?.time || 0, duration: st?.duration || 0, volume: st?.volume ?? 1, at: this.stateAt || 0, now: Date.now(),
      });
    }
    if (url.pathname === '/game/cmd' && req.method === 'POST') {
      const { cmd, value } = await this.body(req);
      if (!['toggle', 'next', 'prev', 'shuffle', 'volume'].includes(cmd)) return json(400, { error: 'nieznane polecenie' });
      if (!this.clients.size) return json(409, { error: 'JustMusic nie jest połączony' });
      this.command(cmd, cmd === 'volume' ? { value: Math.max(0, Math.min(1, Number(value) || 0)) } : {});
      return json(200, { ok: true });
    }
    if (url.pathname === '/state' && req.method === 'POST') {
      this.state = await this.body(req);
      this.stateAt = Date.now();
      this.emit('state', this.state);
      return json(200, { ok: true });
    }
    if (url.pathname === '/instances' && req.method === 'GET') {
      return json(200, { instances: (await this.handlers.listInstances?.()) || [], game: this.game });
    }
    if (url.pathname === '/launch' && req.method === 'POST') {
      const { id } = await this.body(req);
      try { await this.handlers.launch?.(id); return json(200, { ok: true }); } catch (e) { return json(400, { error: e.message }); }
    }
    res.writeHead(404); res.end();
  }

  send(msg, only) {
    const line = `data: ${JSON.stringify(msg)}\n\n`;
    for (const c of only ? [only] : this.clients) { try { c.write(line); } catch {} }
    return this.clients.size;
  }

  command(cmd, args = {}) { return this.send({ type: 'cmd', cmd, ...args }); }

  setGame(game) {
    this.game = game;
    this.send({ type: 'game', game });
  }
}

// ---------- wykrywanie i uruchamianie JustMusic ----------

function userDataDir() {
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'JustMusic');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'JustMusic');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'JustMusic');
}

function candidates() {
  const h = os.homedir();
  if (process.platform === 'win32') {
    const la = process.env.LOCALAPPDATA || path.join(h, 'AppData', 'Local');
    return [path.join(la, 'Programs', 'JustMusic', 'JustMusic.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'JustMusic', 'JustMusic.exe')];
  }
  if (process.platform === 'darwin') return ['/Applications/JustMusic.app', path.join(h, 'Applications', 'JustMusic.app')];
  const out = [path.join(h, 'Applications', 'JustMusic.AppImage'), '/opt/JustMusic/justmusic', '/usr/bin/justmusic', path.join(h, '.local', 'bin', 'justmusic')];
  try {
    for (const dir of [path.join(h, 'Applications'), path.join(h, 'Downloads'), path.join(h, 'Pobrane')]) {
      for (const f of fs.readdirSync(dir)) if (/^JustMusic.*\.AppImage$/i.test(f)) out.push(path.join(dir, f));
    }
  } catch {}
  // instalator JustMusic tworzy plik .desktop – stamtąd bierzemy ścieżkę
  for (const dir of [path.join(process.env.XDG_DATA_HOME || path.join(h, '.local', 'share'), 'applications'), '/usr/share/applications']) {
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!/justmusic/i.test(f) || !f.endsWith('.desktop')) continue;
        const exec = fs.readFileSync(path.join(dir, f), 'utf8').match(/^Exec=(?:"([^"]+)"|(\S+))/m);
        const p = exec && (exec[1] || exec[2]);
        if (p && path.isAbsolute(p)) out.push(p);
      }
    } catch {}
  }
  return out;
}

function detect(custom) {
  const list = custom ? [custom, ...candidates()] : candidates();
  const found = list.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || null;
  return { path: found, installed: !!found || fs.existsSync(userDataDir()), pluginInstalled: fs.existsSync(path.join(userDataDir(), 'plugins', PLUGIN_ID, 'manifest.json')) };
}

function launchApp(custom) {
  const { path: exe } = detect(custom);
  if (!exe) throw new Error('Nie znaleziono JustMusic – wskaż plik aplikacji w Ustawienia → JustMusic albo pobierz ją z GitHuba.');
  const opts = { detached: true, stdio: 'ignore' };
  const p = process.platform === 'darwin' ? spawn('open', ['-a', exe], opts) : spawn(exe, [], opts);
  p.on('error', () => {});
  p.unref();
  return exe;
}

/** Kopiuje wtyczkę „Minecraft” do folderu pluginów JustMusic. */
async function installPlugin(srcDir) {
  const dest = path.join(userDataDir(), 'plugins', PLUGIN_ID);
  await fsp.mkdir(dest, { recursive: true });
  for (const f of await fsp.readdir(srcDir)) await fsp.copyFile(path.join(srcDir, f), path.join(dest, f));
  return dest;
}

module.exports = { JustMusicBridge, detect, launchApp, installPlugin, userDataDir, PLUGIN_ID };
