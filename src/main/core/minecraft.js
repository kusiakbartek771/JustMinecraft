// Wersje Minecrafta: manifest Mojang, JSON wersji (z dziedziczeniem loaderów), biblioteki, natywne, assety.
const fsp = require('fs/promises');
const path = require('path');
const net = require('./net');
const zip = require('./zip');
const { rulesAllow, parseMaven, libKey, nativesKey, bits, OS } = require('./platform');

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const LIBS_URL = 'https://libraries.minecraft.net/';
const RESOURCES_URL = 'https://resources.download.minecraft.net/';
const MAVEN_MIRRORS = ['https://repo1.maven.org/maven2/', 'https://maven.minecraftforge.net/', 'https://libraries.minecraft.net/'];

const dirs = (root) => ({
  root,
  versions: path.join(root, 'versions'),
  libraries: path.join(root, 'libraries'),
  assets: path.join(root, 'assets'),
  runtime: path.join(root, 'runtime'),
  natives: path.join(root, 'natives'),
  cache: path.join(root, 'cache'),
});

async function readJson(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return null; }
}

async function writeJson(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2));
  await fsp.rename(tmp, file);
}

let manifestMem = null;
/** Manifest wersji – z sieci, a gdy jej nie ma, z pamięci podręcznej (tryb offline). */
async function getManifest(root, { force = false } = {}) {
  if (manifestMem && !force && Date.now() - manifestMem.at < 10 * 60 * 1000) return manifestMem.data;
  const cacheFile = path.join(dirs(root).cache, 'version_manifest_v2.json');
  try {
    const data = await net.json(MANIFEST_URL, { retries: 2 });
    await writeJson(cacheFile, data);
    manifestMem = { at: Date.now(), data };
    return data;
  } catch (e) {
    const cached = await readJson(cacheFile);
    if (cached) { manifestMem = { at: Date.now() - 9 * 60 * 1000, data: cached }; return cached; }
    throw new Error(`Nie udało się pobrać listy wersji Minecrafta – sprawdź połączenie z internetem (${e.message})`);
  }
}

/** Pobiera (jeśli trzeba) JSON wersji vanilla. */
async function ensureVanillaJson(root, id) {
  const file = path.join(dirs(root).versions, id, `${id}.json`);
  const local = await readJson(file);
  let entry = null;
  try { entry = (await getManifest(root)).versions.find((v) => v.id === id); } catch (e) { if (!local) throw e; }
  if (local && (!entry || !entry.sha1)) return local;
  if (!entry) {
    if (local) return local;
    throw new Error(`Nieznana wersja Minecrafta: ${id}`);
  }
  await net.download({ url: entry.url, file, sha1: entry.sha1, verify: true });
  return readJson(file);
}

/** Czyta JSON wersji (vanilla albo zainstalowany loader) i scala łańcuch inheritsFrom. */
async function resolveVersion(root, id, depth = 0) {
  if (depth > 5) throw new Error('Zbyt głęboki łańcuch inheritsFrom');
  let json = await readJson(path.join(dirs(root).versions, id, `${id}.json`));
  if (!json || (!json.inheritsFrom && !json.downloads?.client)) json = await ensureVanillaJson(root, id);
  if (!json) throw new Error(`Brak wersji ${id}`);
  if (!json.inheritsFrom) return { ...json, _chain: [id], _jarId: json.jar || id };
  const parent = await resolveVersion(root, json.inheritsFrom, depth + 1);
  return mergeVersions(parent, json);
}

function mergeVersions(parent, child) {
  const out = { ...parent, ...child };
  out.libraries = [...(child.libraries || []), ...(parent.libraries || [])];
  if (child.minecraftArguments) {
    out.minecraftArguments = child.minecraftArguments;
    delete out.arguments;
    if (parent.arguments?.jvm) out.arguments = { jvm: parent.arguments.jvm };
  } else if (parent.arguments || child.arguments) {
    out.arguments = {
      game: [...(parent.arguments?.game || []), ...(child.arguments?.game || [])],
      jvm: [...(parent.arguments?.jvm || []), ...(child.arguments?.jvm || [])],
    };
    if (parent.minecraftArguments && !child.arguments?.game) out.minecraftArguments = parent.minecraftArguments;
  }
  for (const k of ['assetIndex', 'assets', 'downloads', 'javaVersion', 'logging']) if (!child[k] && parent[k]) out[k] = parent[k];
  out.mainClass = child.mainClass || parent.mainClass;
  out.type = parent.type || child.type;
  out._chain = [child.id, ...parent._chain];
  out._jarId = child.jar || parent._jarId;
  out._vanilla = parent._vanilla || parent._chain[parent._chain.length - 1];
  delete out.inheritsFrom;
  return out;
}

const vanillaId = (v) => v._vanilla || v._chain[v._chain.length - 1];

function fixUrl(u) {
  if (!u) return u;
  return u.replace(/^https?:\/\/files\.minecraftforge\.net\/maven\//, 'https://maven.minecraftforge.net/')
    .replace(/^http:\/\//, 'https://');
}

/**
 * Rozwiązuje biblioteki dla bieżącego systemu: { classpath:[{file,...}], natives:[{file, exclude}], downloads:[task] }.
 */
function resolveLibraries(root, version, features = {}) {
  const libDir = dirs(root).libraries;
  const seen = new Set();
  const classpath = [];
  const natives = [];
  const downloads = [];
  for (const lib of version.libraries || []) {
    if (!lib?.name) continue;
    if (!rulesAllow(lib.rules, features)) continue;
    if (lib.clientreq === false) continue;

    // natywne w starym formacie (lwjgl-platform itp.)
    if (lib.natives) {
      const tpl = lib.natives[OS];
      if (!tpl) continue;
      const classifier = tpl.replace('${arch}', bits());
      const key = `${libKey(lib.name)}:${classifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const art = lib.downloads?.classifiers?.[classifier];
      const m = parseMaven(`${lib.name}:${classifier}`);
      const rel = art?.path || m.path;
      const file = path.join(libDir, rel);
      const url = art?.url || `${fixUrl(lib.url) || LIBS_URL}${rel}`;
      natives.push({ file, exclude: lib.extract?.exclude || ['META-INF/'] });
      downloads.push({ url, file, sha1: art?.sha1, size: art?.size });
      continue;
    }

    const key = libKey(lib.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const m = parseMaven(lib.name);
    const art = lib.downloads?.artifact;
    if (lib.downloads && !art) continue; // tylko klasyfikatory bez natywnych dla tego systemu
    const rel = art?.path || m.path;
    const file = path.join(libDir, rel);
    classpath.push({ name: lib.name, file });
    if (art) {
      if (art.url) downloads.push({ url: fixUrl(art.url), file, sha1: art.sha1, size: art.size });
      else downloads.push({ local: true, file, name: lib.name });
    } else {
      const base = fixUrl(lib.url) || LIBS_URL;
      const urls = [base + rel, ...MAVEN_MIRRORS.filter((u) => u !== base).map((u) => u + rel)];
      downloads.push({ url: urls, file, sha1: lib.checksums?.length === 1 ? lib.checksums[0] : lib.sha1, size: lib.size, optional: lib.serverreq && lib.clientreq === undefined });
    }
  }
  return { classpath, natives, downloads };
}

async function installLibraries(root, version, ctx = {}) {
  const { downloads } = resolveLibraries(root, version);
  const missingLocal = [];
  for (const d of downloads.filter((x) => x.local)) if (!(await net.exists(d.file))) missingLocal.push(d.name);
  if (missingLocal.length) {
    const e = new Error(`Brakuje bibliotek loadera (${missingLocal.slice(0, 3).join(', ')}) – zainstaluj loader ponownie (Instancja → Napraw).`);
    e.code = 'MISSING_LOCAL_LIBS';
    throw e;
  }
  ctx.onStatus?.('Biblioteki');
  await net.downloadAll(downloads.filter((x) => !x.local), { onProgress: ctx.onProgress, signal: ctx.signal, verify: ctx.verify });
}

async function installClientJar(root, version, ctx = {}) {
  const id = version._jarId;
  const file = path.join(dirs(root).versions, id, `${id}.jar`);
  let client = version.downloads?.client;
  if (!client && id !== vanillaId(version)) client = (await ensureVanillaJson(root, id)).downloads?.client;
  if (!client) {
    if (await net.exists(file)) return file;
    throw new Error(`Brak pliku gry dla wersji ${id}`);
  }
  ctx.onStatus?.('Plik gry');
  await net.download({ url: client.url, file, sha1: client.sha1, size: client.size, verify: ctx.verify, signal: ctx.signal });
  return file;
}

/** Assety: indeks + obiekty, w tym stare formaty (virtual / map_to_resources). */
async function installAssets(root, version, gameDir, ctx = {}) {
  const ai = version.assetIndex;
  if (!ai) return { id: 'legacy', dir: dirs(root).assets };
  const assetsDir = dirs(root).assets;
  const indexFile = path.join(assetsDir, 'indexes', `${ai.id}.json`);
  ctx.onStatus?.('Indeks zasobów');
  await net.download({ url: ai.url, file: indexFile, sha1: ai.sha1, size: ai.size, verify: true, signal: ctx.signal });
  const index = JSON.parse(await fsp.readFile(indexFile, 'utf8'));
  const objects = Object.entries(index.objects || {});
  const tasks = [];
  const uniq = new Set();
  for (const [, o] of objects) {
    if (uniq.has(o.hash)) continue;
    uniq.add(o.hash);
    const sub = `${o.hash.slice(0, 2)}/${o.hash}`;
    tasks.push({ url: RESOURCES_URL + sub, file: path.join(assetsDir, 'objects', sub), sha1: o.hash, size: o.size });
  }
  ctx.onStatus?.('Zasoby gry (dźwięki, języki)');
  await net.downloadAll(tasks, { onProgress: ctx.onProgress, signal: ctx.signal, verify: ctx.verify });

  let legacyDir = null;
  if (index.virtual || index.map_to_resources) {
    legacyDir = index.map_to_resources ? path.join(gameDir, 'resources') : path.join(assetsDir, 'virtual', ai.id);
    ctx.onStatus?.('Zasoby (stary format)');
    for (const [name, o] of objects) {
      const target = path.join(legacyDir, name);
      const st = await fsp.stat(target).catch(() => null);
      if (st && st.size === o.size) continue;
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(path.join(assetsDir, 'objects', o.hash.slice(0, 2), o.hash), target);
    }
  }
  return { id: ai.id, dir: assetsDir, legacyDir };
}

async function installLogging(root, version, ctx = {}) {
  const lc = version.logging?.client;
  if (!lc?.file?.url) return null;
  const file = path.join(dirs(root).assets, 'log_configs', lc.file.id);
  try {
    await net.download({ url: lc.file.url, file, sha1: lc.file.sha1, size: lc.file.size, signal: ctx.signal });
    return { file, argument: lc.argument };
  } catch { return null; }
}

/** Wypakowuje biblioteki natywne (stary format) do katalogu wersji. */
async function extractNatives(root, version) {
  const { natives } = resolveLibraries(root, version);
  const dir = path.join(dirs(root).natives, version.id);
  await fsp.mkdir(dir, { recursive: true });
  for (const n of natives) {
    await zip.extract(n.file, dir, (name) => {
      if (name.endsWith('/')) return false;
      if (n.exclude.some((ex) => name.startsWith(ex))) return false;
      return true;
    }).catch(async (e) => {
      // na Windowsie plik może być zablokowany przez działającą grę tej samej wersji – wtedy już tam jest
      if (e.code !== 'EBUSY' && e.code !== 'EPERM') throw e;
    });
  }
  // LWJGL 3 (1.19+): natywne są w zwykłych bibliotekach – szuka ich też w java.library.path, więc dla
  // pewności wypakowujemy pliki .so/.dll/.dylib dla bieżącej architektury.
  const keys = nativesKey();
  const best = new Map(); // artefakt -> najlepiej pasujący klasyfikator (np. arm64 przed x64)
  for (const lib of resolveLibraries(root, version).classpath) {
    const m = parseMaven(lib.name);
    const idx = m.classifier ? keys.indexOf(m.classifier) : -1;
    if (idx < 0) continue;
    const k = `${m.group}:${m.artifact}`;
    if (!best.has(k) || best.get(k).idx > idx) best.set(k, { idx, lib });
  }
  for (const { lib } of best.values()) {
    await zip.extract(lib.file, dir, (name) => {
      if (name.endsWith('/') || name.startsWith('META-INF/')) return false;
      if (!/\.(so|dll|dylib|jnilib)$/.test(name)) return false;
      return path.basename(name);
    }).catch(() => {});
  }
  return dir;
}

module.exports = {
  dirs, readJson, writeJson, getManifest, ensureVanillaJson, resolveVersion, mergeVersions, vanillaId,
  resolveLibraries, installLibraries, installClientJar, installAssets, installLogging, extractNatives, fixUrl,
  LIBS_URL, MAVEN_MIRRORS,
};
