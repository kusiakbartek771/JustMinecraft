// Java: automatyczne pobieranie właściwego środowiska (Mojang, a gdy go brak – Eclipse Temurin)
// oraz wykrywanie Javy zainstalowanej w systemie.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { execFile, spawn } = require('child_process');
const net = require('./net');
const zip = require('./zip');
const { OS, ARCH, javaExecutable } = require('./platform');

const RUNTIME_INDEX = 'https://piston-meta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json';
const COMPONENT_MAJOR = { 'jre-legacy': 8, 'java-runtime-alpha': 16, 'java-runtime-beta': 17, 'java-runtime-gamma': 17, 'java-runtime-gamma-snapshot': 17, 'java-runtime-delta': 21, 'java-runtime-epsilon': 25 };

function mojangPlatform() {
  if (OS === 'windows') return ARCH === 'arm64' ? 'windows-arm64' : ARCH === 'ia32' ? 'windows-x86' : 'windows-x64';
  if (OS === 'osx') return ARCH === 'arm64' ? 'mac-os-arm64' : 'mac-os';
  return ARCH === 'ia32' ? 'linux-i386' : ARCH === 'arm64' ? 'linux-arm64' : 'linux';
}

function javaHomeIn(dir) {
  const mac = path.join(dir, 'jre.bundle', 'Contents', 'Home');
  if (fs.existsSync(path.join(mac, 'bin', 'java'))) return mac;
  if (fs.existsSync(javaExecutable(dir, false))) return dir;
  // archiwum Temurin: jeden katalog główny (na macOS z Contents/Home)
  try {
    for (const d of fs.readdirSync(dir)) {
      for (const cand of [path.join(dir, d, 'Contents', 'Home'), path.join(dir, d)]) {
        if (fs.existsSync(javaExecutable(cand, false))) return cand;
      }
    }
  } catch {}
  return null;
}

/** Wymagania Javy dla wersji gry. */
function requirement(version) {
  const jv = version.javaVersion || { component: 'jre-legacy', majorVersion: 8 };
  return { component: jv.component || 'jre-legacy', major: jv.majorVersion || COMPONENT_MAJOR[jv.component] || 8 };
}

async function installMojangRuntime(runtimeDir, component, ctx) {
  const index = await net.json(RUNTIME_INDEX);
  const list = index[mojangPlatform()]?.[component];
  if (!list?.length) return null;
  const meta = list[0];
  const dir = path.join(runtimeDir, component);
  const marker = path.join(dir, '.justlauncher-version');
  const done = await fsp.readFile(marker, 'utf8').catch(() => '');
  if (done.trim() === meta.manifest.sha1 && javaHomeIn(dir)) return javaHomeIn(dir);

  ctx.onStatus?.(`Java ${meta.version?.name || component}`);
  const manifest = await net.json(meta.manifest.url);
  const files = Object.entries(manifest.files);
  for (const [name, f] of files) if (f.type === 'directory') await fsp.mkdir(path.join(dir, name), { recursive: true });
  const tasks = [];
  for (const [name, f] of files) {
    if (f.type !== 'file') continue;
    const raw = f.downloads.raw;
    tasks.push({ url: raw.url, file: path.join(dir, name), sha1: raw.sha1, size: raw.size, exec: f.executable });
  }
  await net.downloadAll(tasks, { onProgress: ctx.onProgress, signal: ctx.signal });
  for (const t of tasks) if (t.exec && OS !== 'windows') await fsp.chmod(t.file, 0o755);
  for (const [name, f] of files) {
    if (f.type !== 'link' || OS === 'windows') continue;
    const p = path.join(dir, name);
    await fsp.rm(p, { force: true });
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.symlink(f.target, p).catch(() => {});
  }
  await fsp.writeFile(marker, meta.manifest.sha1);
  return javaHomeIn(dir);
}

async function installTemurin(runtimeDir, major, ctx) {
  const osName = OS === 'osx' ? 'mac' : OS;
  const arch = ARCH === 'arm64' ? 'aarch64' : ARCH === 'ia32' ? 'x32' : 'x64';
  const dir = path.join(runtimeDir, `temurin-${major}`);
  const existing = javaHomeIn(dir);
  if (existing && fs.existsSync(path.join(dir, '.justlauncher-version'))) return existing;
  ctx.onStatus?.(`Java ${major} (Eclipse Temurin)`);
  const info = await net.json(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jre&os=${osName}&vendor=eclipse`).catch(() => null);
  let pkg = info?.[0]?.binary?.package;
  if (!pkg) {
    const jdk = await net.json(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=${arch}&image_type=jdk&os=${osName}&vendor=eclipse`).catch(() => null);
    pkg = jdk?.[0]?.binary?.package;
  }
  if (!pkg) throw new Error(`Brak Javy ${major} dla ${osName}/${arch}. Zainstaluj ją ręcznie i wskaż w ustawieniach instancji.`);
  const archive = path.join(runtimeDir, pkg.name);
  await net.download({ url: pkg.link, file: archive, size: pkg.size, signal: ctx.signal, onBytes: () => {} });
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.mkdir(dir, { recursive: true });
  if (pkg.name.endsWith('.zip')) await zip.extract(archive, dir);
  else await new Promise((res, rej) => execFile('tar', ['-xzf', archive, '-C', dir], (e) => (e ? rej(e) : res())));
  await fsp.rm(archive, { force: true });
  await fsp.writeFile(path.join(dir, '.justlauncher-version'), pkg.name);
  const home = javaHomeIn(dir);
  if (!home) throw new Error('Pobrana Java ma nieoczekiwaną strukturę');
  return home;
}

/** Zwraca ścieżkę do pliku wykonywalnego Javy dla wersji gry (pobiera ją w razie potrzeby). */
async function ensureJava(runtimeDir, version, ctx = {}) {
  const req = requirement(version);
  let home = null;
  try { home = await installMojangRuntime(runtimeDir, req.component, ctx); } catch (e) {
    if (ctx.signal?.aborted) throw e;
    console.warn('[java] runtime Mojang niedostępny:', e.message);
  }
  if (!home) home = await installTemurin(runtimeDir, req.major, ctx);
  return { java: javaExecutable(home, ctx.windowed !== false), javaCli: javaExecutable(home, false), home, major: req.major };
}

/** Wersja Javy: { version, major, arch, vendor } */
function probe(javaPath) {
  return new Promise((resolve) => {
    let cli = javaPath;
    if (OS === 'windows' && /javaw\.exe$/i.test(cli)) cli = cli.replace(/javaw\.exe$/i, 'java.exe');
    execFile(cli, ['-XshowSettings:properties', '-version'], { timeout: 8000, windowsHide: true }, (err, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`;
      const get = (k) => (out.match(new RegExp(`${k.replace('.', '\\.')} = (.*)`)) || [])[1]?.trim();
      const v = get('java.version');
      if (!v) return resolve(null);
      const major = v.startsWith('1.') ? Number(v.split('.')[1]) : parseInt(v, 10);
      resolve({ path: javaPath, version: v, major, arch: get('os.arch'), vendor: get('java.vendor') });
    });
  });
}

/** Szuka Javy zainstalowanej w systemie. */
async function detect() {
  const cands = new Set();
  const add = (home) => { if (home) cands.add(javaExecutable(home, false)); };
  if (process.env.JAVA_HOME) add(process.env.JAVA_HOME);
  for (const p of (process.env.PATH || '').split(path.delimiter)) {
    const exe = path.join(p, OS === 'windows' ? 'java.exe' : 'java');
    if (fs.existsSync(exe)) { try { cands.add(fs.realpathSync(exe)); } catch { cands.add(exe); } }
  }
  const roots = OS === 'windows'
    ? ['Java', 'Eclipse Adoptium', 'Eclipse Foundation', 'Zulu', 'Microsoft', 'BellSoft', 'Amazon Corretto'].flatMap((d) => [path.join(process.env.ProgramFiles || 'C:\\Program Files', d), path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', d)])
    : OS === 'osx' ? ['/Library/Java/JavaVirtualMachines', path.join(os.homedir(), 'Library/Java/JavaVirtualMachines')]
      : ['/usr/lib/jvm', '/usr/lib64/jvm', '/usr/java', '/opt/java', '/opt/jdk', path.join(os.homedir(), '.sdkman/candidates/java'), path.join(os.homedir(), '.jdks')];
  for (const r of roots) {
    let entries = [];
    try { entries = fs.readdirSync(r); } catch { continue; }
    for (const e of entries) {
      const base = path.join(r, e);
      for (const home of [path.join(base, 'Contents', 'Home'), base, path.join(base, 'jre')]) {
        if (fs.existsSync(javaExecutable(home, false))) { add(home); break; }
      }
    }
  }
  const realSeen = new Set();
  const out = [];
  for (const c of cands) {
    let real = c;
    try { real = fs.realpathSync(c); } catch {}
    if (realSeen.has(real)) continue;
    realSeen.add(real);
    const info = await probe(c);
    if (info) out.push(info);
  }
  return out.sort((a, b) => b.major - a.major);
}

/** Szybki test, czy Java się uruchamia (przed startem gry). */
function quickCheck(javaPath) {
  return new Promise((resolve) => {
    const p = spawn(javaPath.replace(/javaw\.exe$/i, 'java.exe'), ['-version'], { windowsHide: true });
    p.on('error', (e) => resolve(e.message));
    p.on('exit', (code) => resolve(code === 0 ? null : `kod wyjścia ${code}`));
  });
}

module.exports = { ensureJava, requirement, probe, detect, quickCheck, javaHomeIn };
