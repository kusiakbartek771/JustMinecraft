// Instancje (instalacje) gry: każda ma własny folder z modami, światami i ustawieniami.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./core/minecraft');

const META = '.justlauncher';
const metaFile = (dir) => path.join(dir, META, 'instance.json');

function slug(name) {
  return String(name || 'instancja').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L')
    .replace(/[^a-zA-Z0-9._ -]/g, '').trim().replace(/\s+/g, '-').slice(0, 48) || 'instancja';
}

/** Czyta instance.json; gdy plik jest uszkodzony – kopia .bak albo odzyskanie poprawnego początku pliku. */
async function readMeta(dir) {
  const f = metaFile(dir);
  const j = await readJson(f);
  if (j) return j;
  const bak = await readJson(`${f}.bak`);
  if (bak) { await writeJson(f, bak).catch(() => {}); return bak; }
  let text = '';
  try { text = await fsp.readFile(f, 'utf8'); } catch { return null; }
  for (let i = text.lastIndexOf('}'); i > 0; i = text.lastIndexOf('}', i - 1)) {
    try {
      const fixed = JSON.parse(text.slice(0, i + 1));
      if (fixed?.id) { await writeJson(f, fixed).catch(() => {}); return fixed; }
    } catch {}
  }
  return null;
}

class Instances {
  constructor(getDataDir) { this.getDataDir = getDataDir; this.cache = null; }

  get root() { return path.join(this.getDataDir(), 'instances'); }

  async list() {
    await fsp.mkdir(this.root, { recursive: true });
    const out = [];
    for (const d of await fsp.readdir(this.root, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const dir = path.join(this.root, d.name);
      const j = await readMeta(dir);
      if (!j) continue;
      out.push({ ...j, dir, folder: d.name });
    }
    this.cache = new Map(out.map((i) => [i.id, i]));
    return out.sort((a, b) => (b.favorite - a.favorite) || ((b.lastPlayed || b.created || 0) - (a.lastPlayed || a.created || 0)));
  }

  async get(id) {
    if (!this.cache?.has(id)) await this.list();
    const i = this.cache.get(id);
    if (!i) throw new Error('Nie ma takiej instancji (mogła zostać usunięta)');
    return i;
  }

  async create(o) {
    if (!o.mc) throw new Error('Wybierz wersję Minecrafta');
    const name = String(o.name || `${o.loader && o.loader !== 'vanilla' ? `${o.loader} ` : ''}${o.mc}`).trim().slice(0, 64);
    await fsp.mkdir(this.root, { recursive: true });
    let folder = slug(name);
    let n = 1;
    while (fs.existsSync(path.join(this.root, folder))) folder = `${slug(name)}-${++n}`;
    const dir = path.join(this.root, folder);
    const inst = {
      id: crypto.randomUUID(),
      name,
      mc: o.mc,
      loader: o.loader || 'vanilla',
      loaderVersion: o.loaderVersion || null,
      versionId: null,
      icon: o.icon || null,
      color: o.color || null,
      group: o.group || '',
      created: Date.now(),
      lastPlayed: 0,
      playTime: 0,
      favorite: false,
      notes: '',
      source: o.source || null,
    };
    for (const sub of ['mods', 'resourcepacks', 'shaderpacks', 'saves', 'config']) await fsp.mkdir(path.join(dir, sub), { recursive: true });
    await writeJson(metaFile(dir), inst);
    this.cache = null;
    return { ...inst, dir, folder };
  }

  /** Zapisy jednej instancji idą po kolei (bez gubienia równoległych zmian). */
  update(id, patch) {
    this.queues ||= new Map();
    const prev = this.queues.get(id) || Promise.resolve();
    const run = prev.catch(() => {}).then(() => this._update(id, patch));
    this.queues.set(id, run);
    run.finally(() => { if (this.queues.get(id) === run) this.queues.delete(id); }).catch(() => {});
    return run;
  }

  async _update(id, patch) {
    const cur = await this.get(id);
    const next = { ...cur, ...patch };
    // zmiana wersji gry lub loadera = nowa instalacja wersji przy następnym uruchomieniu
    if (patch.mc !== undefined && patch.mc !== cur.mc) next.versionId = null;
    if (patch.loader !== undefined && patch.loader !== cur.loader) next.versionId = null;
    if (patch.loaderVersion !== undefined && patch.loaderVersion !== cur.loaderVersion) next.versionId = null;
    const { dir, folder, ...save } = next;
    await fsp.copyFile(metaFile(cur.dir), `${metaFile(cur.dir)}.bak`).catch(() => {});
    await writeJson(metaFile(cur.dir), save);
    this.cache?.set(id, next);
    return next;
  }

  async duplicate(id, name) {
    const src = await this.get(id);
    const copy = await this.create({ name: name || `${src.name} (kopia)`, mc: src.mc, loader: src.loader, loaderVersion: src.loaderVersion, icon: src.icon, color: src.color, group: src.group });
    await fsp.cp(src.dir, copy.dir, { recursive: true, force: true, filter: (s) => !s.includes(`${path.sep}logs`) && !s.endsWith(`${META}${path.sep}instance.json`) });
    const keep = { ...src, id: copy.id, name: copy.name, created: Date.now(), lastPlayed: 0, playTime: 0 };
    delete keep.dir; delete keep.folder;
    await writeJson(metaFile(copy.dir), keep);
    this.cache = null;
    return this.get(copy.id);
  }

  async remove(id, trash) {
    const inst = await this.get(id);
    if (trash) await trash(inst.dir).catch(() => fsp.rm(inst.dir, { recursive: true, force: true }));
    else await fsp.rm(inst.dir, { recursive: true, force: true });
    this.cache?.delete(id);
  }

  async recordPlay(id, ms) {
    const i = await this.get(id);
    return this.update(id, { playTime: (i.playTime || 0) + Math.max(0, ms || 0) });
  }

  /** Import folderu (np. .minecraft albo instancji z innego launchera): kopiuje mody, configi, światy itd. */
  async importFolder(src, o) {
    const inst = await this.create(o);
    let base = src;
    for (const sub of ['.minecraft', 'minecraft']) if (fs.existsSync(path.join(src, sub, 'mods')) || fs.existsSync(path.join(src, sub, 'saves'))) base = path.join(src, sub);
    const items = ['mods', 'config', 'resourcepacks', 'shaderpacks', 'saves', 'options.txt', 'servers.dat', 'defaultconfigs', 'kubejs', 'scripts', 'schematics', 'optionsshaders.txt', 'datapacks'];
    for (const it of items) {
      const from = path.join(base, it);
      if (fs.existsSync(from)) await fsp.cp(from, path.join(inst.dir, it), { recursive: true, force: true });
    }
    return inst;
  }

  async worlds(id) {
    const inst = await this.get(id);
    const saves = path.join(inst.dir, 'saves');
    const out = [];
    let dirs = [];
    try { dirs = await fsp.readdir(saves, { withFileTypes: true }); } catch {}
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const wdir = path.join(saves, d.name);
      if (!fs.existsSync(path.join(wdir, 'level.dat'))) continue;
      const st = await fsp.stat(path.join(wdir, 'level.dat')).catch(() => null);
      let icon = null;
      try { const b = await fsp.readFile(path.join(wdir, 'icon.png')); icon = `data:image/png;base64,${b.toString('base64')}`; } catch {}
      let datapacks = 0;
      try { datapacks = (await fsp.readdir(path.join(wdir, 'datapacks'))).length; } catch {}
      out.push({ name: d.name, dir: wdir, lastPlayed: st?.mtimeMs || 0, icon, datapacks });
    }
    return out.sort((a, b) => b.lastPlayed - a.lastPlayed);
  }
}

module.exports = { Instances, META, slug };
