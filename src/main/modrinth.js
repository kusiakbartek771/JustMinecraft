// Modrinth: wyszukiwanie i instalacja modów, resource packów, shaderów, datapacków i modpacków,
// zależności, aktualizacje (po SHA1) oraz paczki .mrpack.
const fsp = require('fs/promises');
const path = require('path');
const net = require('./core/net');
const zip = require('./core/zip');
const content = require('./content');

const API = 'https://api.modrinth.com/v2';
const PROJECT_TYPE = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader', datapack: 'datapack', modpack: 'modpack' };

const api = (p, opts) => net.json(API + p, opts);
const q = (o) => Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(typeof v === 'string' ? v : JSON.stringify(v))}`).join('&');

/** Loadery Modrinth zgodne z loaderem instancji (Quilt uruchamia mody Fabric). */
function compatLoaders(loader) {
  if (loader === 'quilt') return ['quilt', 'fabric'];
  if (loader === 'neoforge') return ['neoforge'];
  if (loader === 'forge') return ['forge'];
  if (loader === 'fabric') return ['fabric'];
  return [];
}

async function search({ query = '', type = 'mod', mc, loader, sort = 'relevance', offset = 0, limit = 24, categories = [] }) {
  const facets = [[`project_type:${PROJECT_TYPE[type] || 'mod'}`]];
  if (mc) facets.push([`versions:${mc}`]);
  if (type === 'mod' && loader && loader !== 'vanilla') facets.push(compatLoaders(loader).map((l) => `categories:${l}`));
  if (type === 'modpack' && loader && loader !== 'vanilla') facets.push([`categories:${loader}`]);
  for (const c of categories) facets.push([`categories:${c}`]);
  const r = await api(`/search?${q({ query, facets, index: sort, offset, limit })}`);
  return {
    total: r.total_hits,
    offset: r.offset,
    hits: r.hits.map((h) => ({
      id: h.project_id, slug: h.slug, title: h.title, description: h.description, icon: h.icon_url, author: h.author,
      downloads: h.downloads, follows: h.follows, categories: h.display_categories || h.categories, type: h.project_type,
      gallery: h.featured_gallery || h.gallery?.[0] || null, updated: h.date_modified, color: h.color, versions: h.versions,
    })),
  };
}

async function project(idOrSlug) {
  const p = await api(`/project/${encodeURIComponent(idOrSlug)}`);
  return {
    id: p.id, slug: p.slug, title: p.title, description: p.description, body: p.body, icon: p.icon_url, type: p.project_type,
    downloads: p.downloads, followers: p.followers, categories: p.categories, loaders: p.loaders, gameVersions: p.game_versions,
    gallery: (p.gallery || []).map((g) => ({ url: g.url, title: g.title })), license: p.license?.id, source: p.source_url, issues: p.issues_url,
    wiki: p.wiki_url, discord: p.discord_url, updated: p.updated, team: p.team, color: p.color,
  };
}

async function versions(id, { mc, loader, type } = {}) {
  const params = {};
  if (mc) params.game_versions = [mc];
  if (type === 'mod' && loader && loader !== 'vanilla') params.loaders = compatLoaders(loader);
  if (type === 'datapack') params.loaders = ['datapack'];
  const list = await api(`/project/${encodeURIComponent(id)}/version?${q(params)}`);
  return list.map(mapVersion);
}

function mapVersion(v) {
  return {
    id: v.id, projectId: v.project_id, name: v.name, number: v.version_number, type: v.version_type, date: v.date_published,
    loaders: v.loaders, gameVersions: v.game_versions, downloads: v.downloads, changelog: v.changelog,
    dependencies: v.dependencies || [], files: v.files.map((f) => ({ url: f.url, filename: f.filename, sha1: f.hashes.sha1, size: f.size, primary: f.primary })),
  };
}

const primaryFile = (v) => v.files.find((f) => f.primary) || v.files[0];

/** Najlepsza wersja projektu dla instancji (najpierw wydania, potem beta/alfa). */
async function bestVersion(projectId, inst, type) {
  const list = await versions(projectId, { mc: inst.mc, loader: inst.loader, type });
  const rank = { release: 0, beta: 1, alpha: 2 };
  // Quilt: woli wersje dla Quilta, ale przyjmie Fabric
  const score = (v) => (rank[v.type] ?? 3) * 10 + (inst.loader === 'quilt' && !v.loaders.includes('quilt') ? 1 : 0);
  return list.sort((a, b) => score(a) - score(b) || new Date(b.date) - new Date(a.date))[0] || null;
}

/**
 * Instaluje projekt do instancji (z zależnościami dla modów). Zwraca listę zainstalowanych plików.
 * @param {object} o { inst, projectId, versionId?, type, world?, deps?, onStatus?, signal? }
 */
async function install(o, seen = new Set()) {
  const { inst, type } = o;
  if (seen.has(o.projectId)) return [];
  seen.add(o.projectId);
  const v = o.versionId ? mapVersion(await api(`/version/${o.versionId}`)) : await bestVersion(o.projectId, inst, type);
  if (!v) throw new Error(`Brak wersji zgodnej z Minecraftem ${inst.mc}${type === 'mod' ? ` i loaderem ${inst.loader}` : ''}`);
  const proj = o.project || (await project(v.projectId).catch(() => null));
  const file = primaryFile(v);
  const dir = content.dirFor(inst, type, o.world);
  await fsp.mkdir(dir, { recursive: true });

  // usuń starszą wersję tego samego projektu (aktualizacja / zmiana wersji)
  const idx = await content.loadIndex(inst);
  for (const [rel, info] of Object.entries(idx.files)) {
    if (info.projectId !== v.projectId) continue;
    const old = path.join(inst.dir, rel);
    if (path.dirname(old) !== dir) continue;
    if (path.basename(old) !== file.filename) {
      await fsp.rm(old, { force: true });
      await fsp.rm(`${old}.disabled`, { force: true });
    }
    delete idx.files[rel];
  }
  await content.saveIndex(inst, idx);

  o.onStatus?.(`Pobieranie: ${proj?.title || file.filename}`);
  const target = path.join(dir, file.filename);
  await net.download({ url: file.url, file: target, sha1: file.sha1, size: file.size, signal: o.signal });
  const rel = path.relative(inst.dir, target);
  await content.remember(inst, rel, {
    source: 'modrinth', projectId: v.projectId, versionId: v.id, versionNumber: v.number, title: proj?.title, icon: proj?.icon,
    slug: proj?.slug, description: proj?.description, type,
  });
  const installed = [{ title: proj?.title || file.filename, file: file.filename, projectId: v.projectId }];

  if (type === 'mod' && o.deps !== false) {
    for (const d of v.dependencies) {
      if (d.dependency_type !== 'required') continue;
      let pid = d.project_id;
      let vid = null;
      if (!pid && d.version_id) {
        const dv = await api(`/version/${d.version_id}`).catch(() => null);
        pid = dv?.project_id; vid = d.version_id;
      }
      if (!pid || seen.has(pid)) continue;
      if (Object.values((await content.loadIndex(inst)).files).some((f) => f.projectId === pid)) continue;
      try {
        installed.push(...(await install({ ...o, projectId: pid, versionId: vid, project: null }, seen)));
      } catch (e) {
        o.onWarn?.(`Nie udało się zainstalować zależności (${pid}): ${e.message}`);
      }
    }
  }
  return installed;
}

/** Rozpoznaje pliki w instancji po SHA1 (np. mody dodane ręcznie) i uzupełnia indeks. */
async function identify(inst, items) {
  const unknown = items.filter((i) => i.sha1 && !i.projectId);
  if (!unknown.length) return 0;
  const map = await net.json(`${API}/version_files`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: unknown.map((i) => i.sha1), algorithm: 'sha1' }) });
  const pids = [...new Set(Object.values(map).map((v) => v.project_id))];
  if (!pids.length) return 0;
  const projects = new Map();
  for (let i = 0; i < pids.length; i += 100) {
    const chunk = await api(`/projects?${q({ ids: pids.slice(i, i + 100) })}`);
    for (const p of chunk) projects.set(p.id, p);
  }
  const idx = await content.loadIndex(inst);
  let n = 0;
  for (const it of unknown) {
    const v = map[it.sha1];
    if (!v) continue;
    const p = projects.get(v.project_id);
    idx.files[it.rel] = { source: 'modrinth', projectId: v.project_id, versionId: v.id, versionNumber: v.version_number, title: p?.title, icon: p?.icon_url, slug: p?.slug, description: p?.description, at: Date.now() };
    n++;
  }
  await content.saveIndex(inst, idx);
  return n;
}

/** Sprawdza aktualizacje dla listy zawartości: zwraca { [sha1]: {versionId, number, file} } */
async function checkUpdates(inst, items, type) {
  const hashes = items.filter((i) => i.sha1 && i.source === 'modrinth').map((i) => i.sha1);
  if (!hashes.length) return {};
  const body = { hashes, algorithm: 'sha1', game_versions: [inst.mc] };
  if (type === 'mod') body.loaders = compatLoaders(inst.loader);
  if (type === 'datapack') body.loaders = ['datapack'];
  const r = await net.json(`${API}/version_files/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const cands = items.filter((it) => { const v = r[it.sha1]; return v && v.id !== it.versionId && !v.files.some((f) => f.hashes.sha1 === it.sha1); });
  if (!cands.length) return {};
  // zainstalowane wersje (typ i data) – stabilnym modom nie proponujemy bet
  const cur = new Map();
  const ids = cands.map((c) => c.versionId).filter(Boolean);
  if (ids.length) for (const v of await api(`/versions?${q({ ids })}`).catch(() => [])) cur.set(v.id, v);
  const rank = { release: 0, beta: 1, alpha: 2 };
  const out = {};
  for (const it of cands) {
    let v = r[it.sha1];
    const installed = cur.get(it.versionId);
    const allowed = installed ? rank[installed.version_type] ?? 0 : 0;
    if ((rank[v.version_type] ?? 0) > allowed) {
      const list = await versions(v.project_id, { mc: inst.mc, loader: inst.loader, type }).catch(() => []);
      const best = list.filter((x) => (rank[x.type] ?? 0) <= allowed).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      if (!best || best.id === it.versionId || (installed && new Date(best.date) <= new Date(installed.date_published))) continue;
      if (best.files.some((f) => f.sha1 === it.sha1)) continue;
      v = { id: best.id, version_number: best.number, project_id: best.projectId };
    }
    out[it.sha1] = { versionId: v.id, number: v.version_number, projectId: v.project_id };
  }
  return out;
}

// ---------- modpacki .mrpack ----------

function mrpackLoader(deps) {
  if (deps['fabric-loader']) return ['fabric', deps['fabric-loader']];
  if (deps['quilt-loader']) return ['quilt', deps['quilt-loader']];
  if (deps.neoforge) return ['neoforge', deps.neoforge];
  if (deps.forge) return ['forge', `${deps.minecraft}-${deps.forge}`];
  return ['vanilla', null];
}

async function readMrpack(file) {
  const t = await zip.readText(file, 'modrinth.index.json');
  if (!t) throw new Error('To nie jest paczka Modrinth (.mrpack)');
  const index = JSON.parse(t);
  const [loader, loaderVersion] = mrpackLoader(index.dependencies || {});
  return { index, name: index.name, version: index.versionId, mc: index.dependencies?.minecraft, loader, loaderVersion, summary: index.summary };
}

/** Wypakowuje .mrpack do (nowej) instancji: pliki z linków + overrides. */
async function applyMrpack(inst, file, ctx = {}) {
  const { index } = await readMrpack(file);
  const tasks = [];
  const root = path.resolve(inst.dir);
  for (const f of index.files || []) {
    if (f.env?.client === 'unsupported') continue;
    const target = path.resolve(root, f.path);
    if (!target.startsWith(root + path.sep)) continue;
    tasks.push({ url: f.downloads, file: target, sha1: f.hashes?.sha1, size: f.fileSize, rel: f.path });
  }
  ctx.onStatus?.(`Pobieranie plików paczki (${tasks.length})`);
  await net.downloadAll(tasks, { onProgress: ctx.onProgress, signal: ctx.signal });
  ctx.onStatus?.('Wypakowywanie ustawień paczki');
  for (const prefix of ['overrides/', 'client-overrides/']) {
    await zip.extract(file, root, (n) => (n.startsWith(prefix) && n.length > prefix.length ? n.slice(prefix.length) : false));
  }
  // oznacz pliki z paczki, żeby dało się je aktualizować i rozpoznać
  const idx = await content.loadIndex(inst);
  for (const t of tasks) idx.files[t.rel.replace(/\\/g, '/')] = { ...(idx.files[t.rel] || {}), source: 'mrpack', at: Date.now() };
  await content.saveIndex(inst, idx);
  return tasks.length;
}

async function downloadPackVersion(versionId, cacheDir, signal) {
  const v = mapVersion(await api(`/version/${versionId}`));
  const f = primaryFile(v);
  const file = path.join(cacheDir, 'modpacks', f.filename);
  await net.download({ url: f.url, file, sha1: f.sha1, size: f.size, signal });
  return { file, version: v };
}

// mody poprawiające wydajność – instalowane jednym kliknięciem
const PERFORMANCE = {
  fabric: ['sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modernfix', 'dynamic-fps', 'moreculling'],
  quilt: ['sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modernfix', 'dynamic-fps'],
  neoforge: ['sodium', 'lithium', 'ferrite-core', 'entityculling', 'immediatelyfast', 'modernfix', 'dynamic-fps'],
  forge: ['embeddium', 'ferrite-core', 'entityculling', 'modernfix', 'immediatelyfast', 'dynamic-fps'],
};

const SHADER_LOADERS = { fabric: ['iris'], quilt: ['iris'], neoforge: ['iris', 'oculus'], forge: ['oculus'] };

module.exports = { search, project, versions, bestVersion, install, identify, checkUpdates, readMrpack, applyMrpack, downloadPackVersion, compatLoaders, PERFORMANCE, SHADER_LOADERS };
