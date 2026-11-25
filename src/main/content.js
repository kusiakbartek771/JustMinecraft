// Zawartość instancji: mody, resource packi, shadery, datapacki – lista z metadanymi, włączanie/wyłączanie.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zip = require('./core/zip');
const net = require('./core/net');
const { readJson, writeJson } = require('./core/minecraft');
const { META } = require('./instances');

const TYPES = {
  mod: { dir: 'mods', ext: /\.(jar|zip)$/i },
  resourcepack: { dir: 'resourcepacks', ext: /\.zip$/i, folders: true },
  shader: { dir: 'shaderpacks', ext: /\.zip$/i, folders: true },
  datapack: { dir: null, ext: /\.(zip|jar)$/i, folders: true },
};

const indexFile = (inst) => path.join(inst.dir, META, 'content.json');
const cacheFile = (inst) => path.join(inst.dir, META, 'meta-cache.json');

async function loadIndex(inst) { return (await readJson(indexFile(inst))) || { files: {} }; }
async function saveIndex(inst, idx) { await writeJson(indexFile(inst), idx); }

/** Zapisuje informację o pliku pobranym z Modrinth/Drive (nazwa, ikona, id projektu do aktualizacji). */
async function remember(inst, rel, info) {
  const idx = await loadIndex(inst);
  idx.files[rel.replace(/\\/g, '/')] = { ...info, at: Date.now() };
  await saveIndex(inst, idx);
}

async function forget(inst, rel) {
  const idx = await loadIndex(inst);
  delete idx.files[rel.replace(/\\/g, '/')];
  await saveIndex(inst, idx);
}

function dirFor(inst, type, world) {
  if (type === 'datapack') {
    if (!world) throw new Error('Wybierz świat dla datapacka');
    if (world === '*') return path.join(inst.dir, 'datapacks'); // globalne – kopiowane do każdego świata przy starcie
    return path.join(inst.dir, 'saves', world, 'datapacks');
  }
  return path.join(inst.dir, TYPES[type].dir);
}

function tomlValue(block, key) {
  const m = block.match(new RegExp(`^\\s*${key}\\s*=\\s*(?:"""([\\s\\S]*?)"""|"([^"]*)"|'([^']*)')`, 'm'));
  return m ? (m[1] ?? m[2] ?? m[3]).trim() : null;
}

async function iconData(file, entry) {
  if (!entry) return null;
  try {
    const m = await zip.read(file, [entry.replace(/^\.?\//, '')]);
    const b = [...m.values()][0];
    if (!b || b.length > 200000) return null;
    const ext = entry.toLowerCase().endsWith('.jpg') ? 'jpeg' : 'png';
    return `data:image/${ext};base64,${b.toString('base64')}`;
  } catch { return null; }
}

/** Metadane moda z pliku jar: fabric.mod.json, quilt.mod.json, (neoforge.)mods.toml, mcmod.info */
async function modMeta(file) {
  const want = ['fabric.mod.json', 'quilt.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml', 'mcmod.info', 'pack.mcmeta'];
  let m;
  try { m = await zip.read(file, want); } catch { return { broken: true }; }
  const txt = (n) => m.get(n)?.toString('utf8');
  try {
    if (m.has('fabric.mod.json')) {
      const j = JSON.parse(txt('fabric.mod.json').replace(/[\u0000-\u001f]+/g, ' '));
      const icon = typeof j.icon === 'string' ? j.icon : j.icon ? Object.values(j.icon).pop() : null;
      return { id: j.id, name: j.name || j.id, version: j.version, description: j.description, authors: (j.authors || []).map((a) => (typeof a === 'string' ? a : a.name)), loader: 'fabric', icon: await iconData(file, icon) };
    }
    if (m.has('quilt.mod.json')) {
      const q = JSON.parse(txt('quilt.mod.json')).quilt_loader || {};
      const md = q.metadata || {};
      const icon = typeof md.icon === 'string' ? md.icon : md.icon ? Object.values(md.icon).pop() : null;
      return { id: q.id, name: md.name || q.id, version: q.version, description: md.description, authors: Object.keys(md.contributors || {}), loader: 'quilt', icon: await iconData(file, icon) };
    }
    const toml = txt('META-INF/neoforge.mods.toml') || txt('META-INF/mods.toml');
    if (toml) {
      const block = toml.split(/^\s*\[\[mods\]\]\s*$/m)[1] || toml;
      let version = tomlValue(block, 'version');
      if (version === '${file.jarVersion}') {
        const mf = await zip.readText(file, 'META-INF/MANIFEST.MF').catch(() => null);
        version = mf?.match(/^Implementation-Version:\s*(.+)$/m)?.[1]?.trim() || null;
      }
      const logo = tomlValue(toml, 'logoFile') || tomlValue(block, 'logoFile');
      return {
        id: tomlValue(block, 'modId'), name: tomlValue(block, 'displayName') || tomlValue(block, 'modId'), version,
        description: tomlValue(block, 'description'), authors: [tomlValue(block, 'authors') || tomlValue(toml, 'authors')].filter(Boolean),
        loader: m.has('META-INF/neoforge.mods.toml') ? 'neoforge' : 'forge', icon: await iconData(file, logo),
      };
    }
    if (m.has('mcmod.info')) {
      let j = JSON.parse(txt('mcmod.info'));
      if (!Array.isArray(j)) j = j.modList || [];
      const x = j[0] || {};
      return { id: x.modid, name: x.name || x.modid, version: x.version, description: x.description, authors: x.authorList || x.authors || [], loader: 'forge', icon: await iconData(file, x.logoFile) };
    }
    if (m.has('pack.mcmeta')) {
      const j = JSON.parse(txt('pack.mcmeta').replace(/^﻿/, ''));
      const d = j.pack?.description;
      return { description: typeof d === 'string' ? d.replace(/§./g, '') : Array.isArray(d) ? d.map((x) => x.text || x).join('') : d?.text || '', icon: await iconData(file, 'pack.png') };
    }
  } catch (e) { return { broken: false, parseError: e.message }; }
  return {};
}

/** Lista zawartości danego typu (z pamięcią podręczną metadanych i SHA1). */
async function list(inst, type, world) {
  const dir = dirFor(inst, type, world);
  await fsp.mkdir(dir, { recursive: true });
  const idx = await loadIndex(inst);
  const cache = (await readJson(cacheFile(inst))) || {};
  let dirty = false;
  const out = [];
  for (const d of await fsp.readdir(dir, { withFileTypes: true })) {
    const name = d.name;
    const disabled = name.endsWith('.disabled');
    const base = disabled ? name.slice(0, -9) : name;
    const isFolder = d.isDirectory();
    if (isFolder && !TYPES[type].folders) continue;
    if (!isFolder && !TYPES[type].ext.test(base)) continue;
    const full = path.join(dir, name);
    const st = await fsp.stat(full).catch(() => null);
    if (!st) continue;
    const rel = path.relative(inst.dir, path.join(dir, base)).replace(/\\/g, '/');
    const key = `${rel}|${st.size}|${Math.floor(st.mtimeMs)}`;
    let c = cache[rel];
    if (!c || c.key !== key) {
      c = { key, meta: isFolder ? {} : await modMeta(full), sha1: isFolder ? null : await net.sha1File(full) };
      cache[rel] = c;
      dirty = true;
    }
    const info = idx.files[rel] || null;
    out.push({
      file: name, rel, path: full, enabled: !disabled, folder: isFolder, size: st.size, mtime: st.mtimeMs, sha1: c.sha1,
      name: info?.title || c.meta.name || base.replace(/\.(jar|zip)$/i, ''),
      version: info?.versionNumber || c.meta.version || '', description: info?.description || c.meta.description || '',
      authors: c.meta.authors || [], icon: info?.icon || c.meta.icon || null, modId: c.meta.id || null,
      source: info?.source || null, projectId: info?.projectId || null, versionId: info?.versionId || null, slug: info?.slug || null,
      broken: !!c.meta.broken,
    });
  }
  if (dirty) await writeJson(cacheFile(inst), cache).catch(() => {});
  return out.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
}

async function setEnabled(inst, type, world, file, enabled) {
  const dir = dirFor(inst, type, world);
  const cur = path.join(dir, file);
  const base = file.endsWith('.disabled') ? file.slice(0, -9) : file;
  const target = path.join(dir, enabled ? base : `${base}.disabled`);
  if (cur !== target) await fsp.rename(cur, target);
  return path.basename(target);
}

async function remove(inst, type, world, file, trash) {
  const full = path.join(dirFor(inst, type, world), file);
  if (!full.startsWith(inst.dir)) throw new Error('Nieprawidłowa ścieżka');
  if (trash) await trash(full).catch(() => fsp.rm(full, { recursive: true, force: true }));
  else await fsp.rm(full, { recursive: true, force: true });
  const base = file.replace(/\.disabled$/, '');
  await forget(inst, path.relative(inst.dir, path.join(dirFor(inst, type, world), base)));
}

/** Rozpoznaje typ archiwum (mod / resource pack / shader / datapack / modpack). */
async function detectKind(file) {
  const lower = file.toLowerCase();
  if (lower.endsWith('.mrpack')) return 'modpack';
  if (lower.endsWith('.jar')) return 'mod';
  let names = [];
  try { names = await zip.list(file); } catch { return null; }
  const has = (p) => names.some((n) => n === p || n.startsWith(p));
  const top = (p) => names.some((n) => new RegExp(`^(?:[^/]+/)?${p}`).test(n));
  if (has('modrinth.index.json')) return 'modpack';
  if (has('fabric.mod.json') || has('META-INF/mods.toml') || has('META-INF/neoforge.mods.toml') || has('quilt.mod.json')) return 'mod';
  if (top('shaders/')) return 'shader';
  if (has('pack.mcmeta') && has('data/') && !has('assets/')) return 'datapack';
  if (top('pack.mcmeta') || top('assets/')) return 'resourcepack';
  if (has('mods/') || has('overrides/') || has('config/')) return 'overlay';
  return null;
}

/** Dodaje plik z dysku (przeciągnięty do okna albo wybrany) do instancji. */
async function addFile(inst, src, { type, world } = {}) {
  const kind = type || (await detectKind(src));
  if (!kind || kind === 'modpack' || kind === 'overlay') return { kind, added: false };
  const dir = dirFor(inst, kind, world);
  await fsp.mkdir(dir, { recursive: true });
  const target = path.join(dir, path.basename(src));
  if (path.resolve(src) !== path.resolve(target)) await fsp.copyFile(src, target);
  return { kind, added: true, file: path.basename(target) };
}

module.exports = { TYPES, list, setEnabled, remove, remember, forget, loadIndex, saveIndex, dirFor, detectKind, addFile, modMeta };
