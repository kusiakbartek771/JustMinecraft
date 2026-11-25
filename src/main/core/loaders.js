// Loadery modów: Fabric, Quilt, Forge, NeoForge – listy wersji i instalacja.
// Forge/NeoForge instalujemy sami z instalatora (install_profile + procesory), bez okna instalatora.
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const net = require('./net');
const zip = require('./zip');
const mc = require('./minecraft');
const java = require('./java');
const { parseMaven, SEP } = require('./platform');

const LOADERS = ['vanilla', 'fabric', 'quilt', 'forge', 'neoforge'];
const LOADER_NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

const cache = new Map();
async function cached(key, ttl, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

// ---------- listy wersji ----------

async function fabricVersions(mcv) {
  const list = await cached(`fabric:${mcv}`, 15 * 60e3, () => net.json(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(mcv)}`));
  return list.map((x) => ({ version: x.loader.version, stable: !!x.loader.stable }));
}

async function quiltVersions(mcv) {
  const list = await cached(`quilt:${mcv}`, 15 * 60e3, () => net.json(`https://meta.quiltmc.org/v3/versions/loader/${encodeURIComponent(mcv)}`).catch((e) => (e.status === 404 ? [] : Promise.reject(e))));
  return list.map((x) => ({ version: x.loader.version, stable: !/beta|pre|rc/i.test(x.loader.version) }));
}

function parseMavenMetadata(xml) {
  return [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
}

async function forgeVersions(mcv) {
  const all = await cached('forge:meta', 30 * 60e3, async () => parseMavenMetadata(await net.text('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml')));
  const promos = await cached('forge:promos', 30 * 60e3, () => net.json('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json').catch(() => ({ promos: {} })));
  const rec = promos.promos?.[`${mcv}-recommended`];
  const latest = promos.promos?.[`${mcv}-latest`];
  return all.filter((v) => v.startsWith(`${mcv}-`)).reverse().map((full) => {
    const short = full.slice(mcv.length + 1).replace(new RegExp(`-${mcv.replace(/\./g, '\\.')}$`), '');
    return { version: full, label: short, stable: short === rec, recommended: short === rec, latest: short === latest };
  });
}

/** Wersja Minecrafta dla wersji NeoForge: 21.1.77 -> 1.21.1, 20.4.x -> 1.20.4, 26.1.0.x -> 26.1 */
function neoforgeMc(v) {
  const p = v.split(/[.-]/);
  const major = Number(p[0]);
  if (major >= 25) return p[2] && p[2] !== '0' ? `${p[0]}.${p[1]}.${p[2]}` : `${p[0]}.${p[1]}`;
  return p[1] === '0' ? `1.${p[0]}` : `1.${p[0]}.${p[1]}`;
}

async function neoforgeVersions(mcv) {
  const list = await cached('neoforge:meta', 30 * 60e3, () => net.json('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'));
  const out = list.versions.filter((v) => neoforgeMc(v) === mcv).reverse().map((v) => ({ version: v, stable: !/beta|alpha/i.test(v) }));
  if (mcv === '1.20.1') {
    const legacy = await cached('neoforge:legacy', 30 * 60e3, () => net.json('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/forge').catch(() => ({ versions: [] })));
    out.push(...legacy.versions.filter((v) => v.startsWith('1.20.1-')).reverse().map((v) => ({ version: v, stable: true, legacy: true })));
  }
  return out;
}

async function loaderVersions(loader, mcv) {
  switch (loader) {
    case 'fabric': return fabricVersions(mcv);
    case 'quilt': return quiltVersions(mcv);
    case 'forge': return forgeVersions(mcv);
    case 'neoforge': return neoforgeVersions(mcv);
    default: return [];
  }
}

/** Domyślna (zalecana) wersja loadera. */
async function defaultLoaderVersion(loader, mcv) {
  const list = await loaderVersions(loader, mcv);
  if (!list.length) throw new Error(`${LOADER_NAMES[loader]} nie jest dostępny dla Minecrafta ${mcv}`);
  return (list.find((v) => v.recommended) || list.find((v) => v.stable) || list[0]).version;
}

/** Wersje Minecrafta, dla których loader jest dostępny (do filtrowania listy). */
async function supportedGameVersions(loader) {
  return cached(`games:${loader}`, 30 * 60e3, async () => {
    if (loader === 'fabric') return new Set((await net.json('https://meta.fabricmc.net/v2/versions/game')).map((x) => x.version));
    if (loader === 'quilt') return new Set((await net.json('https://meta.quiltmc.org/v3/versions/game')).map((x) => x.version));
    if (loader === 'forge') {
      const all = parseMavenMetadata(await net.text('https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml'));
      return new Set(all.map((v) => v.split('-')[0]));
    }
    if (loader === 'neoforge') {
      const list = await net.json('https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge');
      const s = new Set(list.versions.map(neoforgeMc));
      s.add('1.20.1');
      return s;
    }
    return null;
  });
}

// ---------- instalacja ----------

async function installFabricLike(root, loader, mcv, lv, ctx) {
  const base = loader === 'fabric' ? 'https://meta.fabricmc.net/v2' : 'https://meta.quiltmc.org/v3';
  ctx.onStatus?.(`${LOADER_NAMES[loader]} ${lv}`);
  const profile = await net.json(`${base}/versions/loader/${encodeURIComponent(mcv)}/${encodeURIComponent(lv)}/profile/json`);
  const id = profile.id;
  await mc.writeJson(path.join(mc.dirs(root).versions, id, `${id}.json`), profile);
  return id;
}

function installerInfo(loader, v) {
  if (loader === 'forge') return { url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${v}/forge-${v}-installer.jar`, name: `forge-${v}-installer.jar` };
  if (/^1\.20\.1-/.test(v)) return { url: `https://maven.neoforged.net/releases/net/neoforged/forge/${v}/forge-${v}-installer.jar`, name: `neoforge-legacy-${v}-installer.jar` };
  return { url: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${v}/neoforge-${v}-installer.jar`, name: `neoforge-${v}-installer.jar` };
}

async function jarMainClass(jar) {
  const mf = await zip.readText(jar, 'META-INF/MANIFEST.MF');
  const m = mf && mf.match(/^Main-Class:\s*(.+)$/m);
  if (!m) throw new Error(`Brak Main-Class w ${path.basename(jar)}`);
  return m[1].trim();
}

function runJava(javaExe, args, cwd, onLine) {
  return new Promise((resolve, reject) => {
    const p = spawn(javaExe, args, { cwd, windowsHide: true });
    const tail = [];
    const push = (d) => {
      for (const line of d.toString().split(/\r?\n/)) {
        if (!line.trim()) continue;
        tail.push(line);
        if (tail.length > 40) tail.shift();
        onLine?.(line);
      }
    };
    p.stdout.on('data', push);
    p.stderr.on('data', push);
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Procesor instalatora zakończył się błędem (kod ${code}):\n${tail.slice(-12).join('\n')}`))));
  });
}

async function installForgeLike(root, loader, mcv, lv, ctx) {
  const d = mc.dirs(root);
  const info = installerInfo(loader, lv);
  const installer = path.join(d.cache, 'installers', info.name);
  ctx.onStatus?.(`Instalator ${LOADER_NAMES[loader]} ${lv}`);
  await net.download({ url: info.url, file: installer, signal: ctx.signal });
  let profileText = await zip.readText(installer, 'install_profile.json').catch(() => null);
  if (!profileText) {
    await fsp.rm(installer, { force: true });
    await net.download({ url: info.url, file: installer, signal: ctx.signal });
    profileText = await zip.readText(installer, 'install_profile.json');
  }
  if (!profileText) throw new Error('Uszkodzony instalator (brak install_profile.json)');
  const profile = JSON.parse(profileText);

  // --- stary format (≤ 1.12.2) ---
  if (profile.install && profile.versionInfo) {
    const vj = profile.versionInfo;
    const id = vj.id;
    vj.inheritsFrom ||= profile.install.minecraft || mcv;
    vj.jar ||= vj.inheritsFrom;
    const libPath = path.join(d.libraries, parseMaven(profile.install.path).path);
    if (!(await net.exists(libPath))) {
      const m = await zip.read(installer, [profile.install.filePath]);
      if (!m.size) throw new Error('Instalator nie zawiera pliku Forge');
      await fsp.mkdir(path.dirname(libPath), { recursive: true });
      await fsp.writeFile(libPath, m.get(profile.install.filePath));
    }
    // biblioteka Forge jest już lokalnie – nie pobieramy jej z sieci
    for (const l of vj.libraries) if (l.name === profile.install.path) { delete l.url; l.downloads = { artifact: { path: parseMaven(l.name).path, url: '' } }; }
    await mc.writeJson(path.join(d.versions, id, `${id}.json`), vj);
    return id;
  }

  // --- nowy format (1.13+) ---
  const versionText = await zip.readText(installer, (profile.json || '/version.json').replace(/^\//, ''));
  const vj = JSON.parse(versionText);
  const id = vj.id;
  const marker = path.join(d.versions, id, '.installed');
  const installerSha = await net.sha1File(installer);
  if ((await fsp.readFile(marker, 'utf8').catch(() => '')) === installerSha && await net.exists(path.join(d.versions, id, `${id}.json`))) return id;

  // gra vanilla + jej Java (procesory jej potrzebują)
  const vanilla = await mc.resolveVersion(root, mcv);
  const clientJar = await mc.installClientJar(root, vanilla, ctx);
  const { javaCli } = await java.ensureJava(d.runtime, vanilla, { ...ctx, windowed: false });

  // biblioteki zapakowane w instalatorze (maven/...)
  ctx.onStatus?.('Biblioteki z instalatora');
  await zip.extract(installer, d.libraries, (name) => {
    if (!name.startsWith('maven/') || name.endsWith('/')) return false;
    return name.slice('maven/'.length);
  });

  // biblioteki instalatora i wersji
  const libs = [...(profile.libraries || []), ...(vj.libraries || [])];
  const tasks = [];
  const seen = new Set();
  const localOnly = []; // pliki z instalatora albo tworzone przez procesory – sprawdzamy na końcu
  for (const l of libs) {
    const m = parseMaven(l.name);
    const art = l.downloads?.artifact;
    const rel = art?.path || m.path;
    if (seen.has(rel)) continue;
    seen.add(rel);
    const file = path.join(d.libraries, rel);
    const url = art ? art.url : (l.url ? mc.fixUrl(l.url) + rel : null);
    if (!url) { localOnly.push({ file, name: l.name }); continue; }
    tasks.push({ url: [mc.fixUrl(url), ...mc.MAVEN_MIRRORS.map((u) => u + rel)], file, sha1: art?.sha1, size: art?.size });
  }
  ctx.onStatus?.(`Biblioteki ${LOADER_NAMES[loader]}`);
  await net.downloadAll(tasks, { onProgress: ctx.onProgress, signal: ctx.signal });

  // zmienne procesorów
  const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'justminecraft-forge-'));
  try {
    const vars = {
      SIDE: 'client', MINECRAFT_JAR: clientJar, MINECRAFT_VERSION: mcv, ROOT: root,
      INSTALLER: installer, LIBRARY_DIR: d.libraries,
    };
    const libFile = (coord) => path.join(d.libraries, parseMaven(coord).path);
    for (const [k, v] of Object.entries(profile.data || {})) {
      const val = v.client;
      if (val == null) continue;
      if (/^\[.+\]$/.test(val)) vars[k] = libFile(val.slice(1, -1));
      else if (/^'.*'$/.test(val)) vars[k] = val.slice(1, -1);
      else if (val.startsWith('/')) {
        const entry = val.slice(1);
        const out = path.join(tmp, entry);
        await fsp.mkdir(path.dirname(out), { recursive: true });
        const m = await zip.read(installer, [entry]);
        if (!m.size) throw new Error(`Instalator nie zawiera ${entry}`);
        await fsp.writeFile(out, m.get(entry));
        vars[k] = out;
      } else vars[k] = val;
    }
    const subst = (s) => {
      if (/^\[.+\]$/.test(s)) return libFile(s.slice(1, -1));
      return s.replace(/\{([A-Z_]+)\}/g, (all, k) => (k in vars ? vars[k] : all));
    };

    const procs = (profile.processors || []).filter((p) => !p.sides || p.sides.includes('client'));
    let i = 0;
    for (const p of procs) {
      i++;
      ctx.onStatus?.(`Przygotowanie ${LOADER_NAMES[loader]} (${i}/${procs.length})`);
      ctx.onProgress?.({ done: i - 1, total: procs.length });
      const outputs = Object.entries(p.outputs || {}).map(([f, h]) => [subst(f), subst(h).replace(/^'|'$/g, '')]);
      if (outputs.length) {
        let ok = true;
        for (const [f, h] of outputs) if (!(await net.isValid(f, { sha1: h, verify: true }))) { ok = false; break; }
        if (ok) continue;
      }
      const jar = libFile(p.jar);
      const cp = [jar, ...(p.classpath || []).map(libFile)];
      const main = await jarMainClass(jar);
      const args = (p.args || []).map(subst);
      await runJava(javaCli, ['-cp', cp.join(SEP), main, ...args], tmp, ctx.onLog);
      for (const [f, h] of outputs) {
        if (!(await net.exists(f))) throw new Error(`Procesor ${p.jar} nie utworzył pliku ${path.basename(f)}`);
        // suma może się różnić przez inną implementację zlib w Javie (np. zlib-ng) – plik i tak jest poprawny
        if (h && !(await net.isValid(f, { sha1: h, verify: true }))) ctx.onLog?.(`[JustMinecraft] Uwaga: inna suma SHA1 pliku ${path.basename(f)} niż w instalatorze (to normalne przy innej wersji zlib)`);
      }
    }
  } finally {
    await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }

  for (const l of localOnly) if (!(await net.exists(l.file))) throw new Error(`Instalacja niekompletna – brak biblioteki ${l.name}`);
  vj.inheritsFrom ||= mcv;
  await mc.writeJson(path.join(d.versions, id, `${id}.json`), vj);
  await fsp.writeFile(marker, installerSha);
  return id;
}

/** Instaluje loader i zwraca id wersji do uruchomienia. */
async function installLoader(root, loader, mcv, lv, ctx = {}) {
  if (!loader || loader === 'vanilla') return mcv;
  if (!lv) lv = await defaultLoaderVersion(loader, mcv);
  if (loader === 'fabric' || loader === 'quilt') return installFabricLike(root, loader, mcv, lv, ctx);
  if (loader === 'forge' || loader === 'neoforge') return installForgeLike(root, loader, mcv, lv, ctx);
  throw new Error(`Nieznany loader: ${loader}`);
}

module.exports = { LOADERS, LOADER_NAMES, loaderVersions, defaultLoaderVersion, supportedGameVersions, installLoader, neoforgeMc };
