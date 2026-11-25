// CurseForge: wyszukiwanie, strona projektu, wersje, instalacja z zależnościami i modpacki (.zip z manifest.json).
// Oficjalne API wymaga klucza (console.curseforge.com) – z ustawień, zmiennej CURSEFORGE_API_KEY albo pliku cf-key.json
// dopisywanego przy budowaniu wydania z sekretu GitHuba.
const fsp = require('fs/promises');
const path = require('path');
const net = require('./core/net');
const zip = require('./core/zip');
const content = require('./content');

const API = 'https://api.curseforge.com/v1';
const GAME = 432;
const CLASS = { mod: 6, modpack: 4471, resourcepack: 12, shader: 6552, datapack: 6945 };
const CLASS_TYPE = Object.fromEntries(Object.entries(CLASS).map(([k, v]) => [v, k]));
const LOADER_ID = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const LOADER_NAME = { forge: 'Forge', fabric: 'Fabric', quilt: 'Quilt', neoforge: 'NeoForge' };
const SORT = { relevance: 1, downloads: 6, follows: 2, newest: 11, updated: 3 };
const RELEASE = { 1: 'release', 2: 'beta', 3: 'alpha' };

let settingsKey = () => '';
function configure({ getKey }) { settingsKey = getKey; }

function bundledKey() {
  try { return require('./cf-key.json').key || ''; } catch { return ''; }
}
const apiKey = () => (settingsKey() || process.env.CURSEFORGE_API_KEY || bundledKey() || '').trim();
const hasKey = () => !!apiKey();

class NoKeyError extends Error {
  constructor() {
    super('CurseForge wymaga klucza API. Wpisz go w Ustawienia → Pobieranie → CurseForge (klucz za darmo na console.curseforge.com).');
    this.code = 'CF_NO_KEY';
  }
}

async function cf(p, opts = {}) {
  const key = apiKey();
  if (!key) throw new NoKeyError();
  try {
    const r = await net.json(API + p, {
      ...opts,
      method: opts.body ? 'POST' : 'GET',
      headers: { 'x-api-key': key, ...(opts.body ? { 'Content-Type': 'application/json' } : {}), ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return r.data;
  } catch (e) {
    if (e.status === 403 || e.status === 401) throw Object.assign(new Error('CurseForge odrzucił klucz API – sprawdź go w Ustawienia → Pobieranie.'), { code: 'CF_BAD_KEY' });
    throw e;
  }
}
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

/** Loadery CurseForge zgodne z loaderem instancji (Quilt uruchamia mody Fabric). */
function compatLoaders(loader) {
  if (loader === 'quilt') return ['quilt', 'fabric'];
  return LOADER_ID[loader] ? [loader] : [];
}

function mapMod(m) {
  return {
    id: String(m.id), slug: m.slug, title: m.name, description: m.summary, icon: m.logo?.thumbnailUrl || m.logo?.url || null,
    author: m.authors?.[0]?.name || '', downloads: m.downloadCount, follows: m.thumbsUpCount || 0,
    categories: (m.categories || []).map((c) => c.name), type: CLASS_TYPE[m.classId] || 'mod', updated: m.dateModified,
    platform: 'curseforge', website: m.links?.websiteUrl, allowDistribution: m.allowModDistribution !== false,
  };
}

async function search({ query = '', type = 'mod', mc, loader, sort = 'relevance', offset = 0, limit = 20 }) {
  const params = { gameId: GAME, classId: CLASS[type] || 6, searchFilter: query, sortField: SORT[sort] || 1, sortOrder: 'desc', index: offset, pageSize: Math.min(50, limit) };
  if (mc) params.gameVersion = mc;
  // jeden loader na zapytanie; dla Quilta szukamy modów Fabric (większość działa)
  if (type === 'mod' && loader && LOADER_ID[loader]) params.modLoaderType = LOADER_ID[loader === 'quilt' ? 'fabric' : loader];
  const key = apiKey();
  if (!key) throw new NoKeyError();
  const r = await net.json(`${API}/mods/search?${q(params)}`, { headers: { 'x-api-key': key } }).catch((e) => {
    if (e.status === 403 || e.status === 401) throw Object.assign(new Error('CurseForge odrzucił klucz API – sprawdź go w Ustawienia → Pobieranie.'), { code: 'CF_BAD_KEY' });
    throw e;
  });
  return { total: Math.min(r.pagination?.totalCount || 0, 10000 - 50), offset, hits: (r.data || []).map(mapMod) };
}

async function project(id) {
  const [m, desc] = await Promise.all([cf(`/mods/${id}`), cf(`/mods/${id}/description`).catch(() => '')]);
  return {
    ...mapMod(m), html: desc || '', body: null, followers: m.thumbsUpCount || 0,
    gallery: (m.screenshots || []).map((g) => ({ url: g.url, title: g.title })), license: null,
    source: m.links?.sourceUrl || null, wiki: m.links?.wikiUrl || null, issues: m.links?.issuesUrl || null,
  };
}

function mapFile(f) {
  const gv = f.gameVersions || [];
  const loaders = Object.entries(LOADER_NAME).filter(([, n]) => gv.includes(n)).map(([k]) => k);
  return {
    id: String(f.id), projectId: String(f.modId), name: f.displayName, number: f.fileName, type: RELEASE[f.releaseType] || 'release', date: f.fileDate,
    loaders, gameVersions: gv.filter((v) => /^\d/.test(v)), downloads: f.downloadCount,
    dependencies: (f.dependencies || []).map((d) => ({ projectId: String(d.modId), required: d.relationType === 3 })),
    files: [{ url: f.downloadUrl, filename: f.fileName, sha1: f.hashes?.find((x) => x.algo === 1)?.value, size: f.fileLength, primary: true }],
    blocked: !f.downloadUrl,
  };
}

async function versions(id, { mc, loader, type } = {}) {
  const loaders = type === 'mod' && loader && loader !== 'vanilla' ? compatLoaders(loader) : [null];
  const out = new Map();
  for (const l of loaders) {
    const params = { pageSize: 50, gameVersion: mc, modLoaderType: l ? LOADER_ID[l] : undefined };
    for (const f of await cf(`/mods/${id}/files?${q(params)}`)) out.set(f.id, mapFile(f));
  }
  return [...out.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
}

async function bestVersion(projectId, inst, type) {
  const list = await versions(projectId, { mc: inst.mc, loader: inst.loader, type });
  const rank = { release: 0, beta: 1, alpha: 2 };
  const score = (v) => (rank[v.type] ?? 3) * 10 + (inst.loader === 'quilt' && !v.loaders.includes('quilt') ? 1 : 0);
  return list.sort((a, b) => score(a) - score(b) || new Date(b.date) - new Date(a.date))[0] || null;
}

function blockedError(proj, v) {
  const url = proj?.website ? `${proj.website}/files/${v.id}` : 'https://www.curseforge.com/minecraft';
  return Object.assign(new Error(`Autor „${proj?.title || v.number}” nie pozwala pobierać tego pliku poza stroną CurseForge. Pobierz go ręcznie: ${url}`), { code: 'CF_BLOCKED', url });
}

/** Instaluje projekt CurseForge do instancji (z wymaganymi zależnościami dla modów). */
async function install(o, seen = new Set()) {
  const { inst, type } = o;
  const pid = String(o.projectId);
  if (seen.has(pid)) return [];
  seen.add(pid);
  const v = o.versionId ? mapFile(await cf(`/mods/${pid}/files/${o.versionId}`)) : await bestVersion(pid, inst, type);
  if (!v) throw new Error(`Brak wersji zgodnej z Minecraftem ${inst.mc}${type === 'mod' ? ` i loaderem ${inst.loader}` : ''}`);
  const proj = o.project || mapMod(await cf(`/mods/${pid}`));
  if (v.blocked) throw blockedError(proj, v);
  const file = v.files[0];
  const dir = content.dirFor(inst, type, o.world);
  await fsp.mkdir(dir, { recursive: true });

  // usuń starszą wersję tego samego projektu
  const idx = await content.loadIndex(inst);
  for (const [rel, info] of Object.entries(idx.files)) {
    if (info.source !== 'curseforge' || String(info.projectId) !== pid) continue;
    const old = path.join(inst.dir, rel);
    if (path.dirname(old) !== dir) continue;
    if (path.basename(old) !== file.filename) {
      await fsp.rm(old, { force: true });
      await fsp.rm(`${old}.disabled`, { force: true });
    }
    delete idx.files[rel];
  }
  await content.saveIndex(inst, idx);

  o.onStatus?.(`Pobieranie: ${proj.title || file.filename}`);
  const target = path.join(dir, file.filename);
  await net.download({ url: file.url, file: target, sha1: file.sha1, size: file.size, signal: o.signal });
  await content.remember(inst, path.relative(inst.dir, target), {
    source: 'curseforge', projectId: pid, versionId: v.id, versionNumber: v.name, title: proj.title, icon: proj.icon,
    slug: proj.slug, description: proj.description, type, website: proj.website,
  });
  const installed = [{ title: proj.title || file.filename, file: file.filename, projectId: pid }];

  if (type === 'mod' && o.deps !== false) {
    for (const d of v.dependencies) {
      if (!d.required || seen.has(d.projectId)) continue;
      if (Object.values((await content.loadIndex(inst)).files).some((f) => String(f.projectId) === d.projectId)) continue;
      try {
        installed.push(...(await install({ ...o, projectId: d.projectId, versionId: null, project: null }, seen)));
      } catch (e) {
        o.onWarn?.(`Nie udało się zainstalować zależności (${d.projectId}): ${e.message}`);
      }
    }
  }
  return installed;
}

// ---------- modpacki CurseForge (.zip z manifest.json) ----------

function packLoader(mcVersion, modLoaders = []) {
  const l = (modLoaders.find((x) => x.primary) || modLoaders[0])?.id || '';
  const m = l.match(/^(forge|neoforge|fabric|quilt)-(.+)$/);
  if (!m) return ['vanilla', null];
  if (m[1] === 'forge') return ['forge', m[2].startsWith(mcVersion) ? m[2] : `${mcVersion}-${m[2]}`];
  return [m[1], m[2]];
}

async function readPack(file) {
  const t = await zip.readText(file, 'manifest.json');
  if (!t) throw new Error('To nie jest modpack CurseForge (brak manifest.json)');
  const manifest = JSON.parse(t);
  if (manifest.manifestType !== 'minecraftModpack') throw new Error('To nie jest modpack CurseForge');
  const mc = manifest.minecraft?.version;
  const [loader, loaderVersion] = packLoader(mc, manifest.minecraft?.modLoaders);
  return { manifest, name: manifest.name, version: manifest.version, author: manifest.author, mc, loader, loaderVersion };
}

/** Wypakowuje modpack CurseForge do instancji. Zwraca listę plików, których autorzy nie pozwalają pobierać automatycznie. */
async function applyPack(inst, file, ctx = {}) {
  const { manifest } = await readPack(file);
  const wanted = (manifest.files || []).filter((f) => f.required !== false);
  const root = path.resolve(inst.dir);
  const tasks = [];
  const blocked = [];
  if (wanted.length) {
    ctx.onStatus?.(`Sprawdzanie plików paczki (${wanted.length})`);
    const files = [];
    for (let i = 0; i < wanted.length; i += 500) files.push(...(await cf('/mods/files', { body: { fileIds: wanted.slice(i, i + 500).map((f) => f.fileID) } })));
    const modIds = [...new Set(files.map((f) => f.modId))];
    const mods = new Map();
    for (let i = 0; i < modIds.length; i += 500) for (const m of await cf('/mods', { body: { modIds: modIds.slice(i, i + 500) } })) mods.set(m.id, m);
    for (const f of files) {
      const m = mods.get(f.modId);
      const type = CLASS_TYPE[m?.classId] || 'mod';
      const folder = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks', datapack: 'datapacks' }[type] || 'mods';
      const rel = `${folder}/${f.fileName}`;
      const target = path.resolve(root, rel);
      if (!target.startsWith(root + path.sep)) continue;
      if (!f.downloadUrl) { blocked.push({ name: m?.name || f.fileName, file: f.fileName, folder, url: m?.links?.websiteUrl ? `${m.links.websiteUrl}/files/${f.id}` : null }); continue; }
      tasks.push({ url: f.downloadUrl, file: target, sha1: f.hashes?.find((x) => x.algo === 1)?.value, size: f.fileLength, rel, meta: { projectId: String(f.modId), versionId: String(f.id), title: m?.name, icon: m?.logo?.thumbnailUrl, slug: m?.slug, type } });
    }
  }
  ctx.onStatus?.(`Pobieranie plików paczki (${tasks.length})`);
  await net.downloadAll(tasks, { onProgress: ctx.onProgress, signal: ctx.signal });
  ctx.onStatus?.('Wypakowywanie ustawień paczki');
  const ov = `${(manifest.overrides || 'overrides').replace(/\/+$/, '')}/`;
  await zip.extract(file, root, (n) => (n.startsWith(ov) && n.length > ov.length ? n.slice(ov.length) : false));
  const idx = await content.loadIndex(inst);
  for (const t of tasks) idx.files[t.rel] = { ...(idx.files[t.rel] || {}), source: 'curseforge', ...t.meta, at: Date.now() };
  await content.saveIndex(inst, idx);
  return { count: tasks.length, blocked };
}

async function downloadPackVersion(projectId, fileId, cacheDir, signal) {
  const proj = mapMod(await cf(`/mods/${projectId}`));
  const v = fileId ? mapFile(await cf(`/mods/${projectId}/files/${fileId}`)) : (await versions(projectId, {})).find((x) => x.type === 'release') || (await versions(projectId, {}))[0];
  if (!v) throw new Error('Ten modpack nie ma wersji do pobrania');
  if (v.blocked) throw blockedError(proj, v);
  const f = v.files[0];
  const file = path.join(cacheDir, 'modpacks', f.filename);
  await net.download({ url: f.url, file, sha1: f.sha1, size: f.size, signal });
  return { file, version: v, project: proj };
}

module.exports = { configure, hasKey, search, project, versions, bestVersion, install, readPack, applyPack, downloadPackVersion, packLoader, mapFile, mapMod, CLASS };
