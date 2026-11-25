// Światy: informacje z level.dat i statystyk, kopie zapasowe (auto po wyjściu z gry), przywracanie i mapa z góry.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Worker } = require('worker_threads');
const nbt = require('./nbt');
const zip = require('./core/zip');
const { ZipWriter } = require('./core/zipwrite');

const META = '.justlauncher';
const savesDir = (inst) => path.join(inst.dir, 'saves');
const backupsDir = (inst, world) => path.join(inst.dir, META, 'backups', world);
const safeName = (w) => { if (!w || /[\\/]|^\.\.?$/.test(w)) throw new Error('Zła nazwa świata'); return w; };

async function dirSize(dir) {
  let total = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(p);
    else if (e.isFile()) total += (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

const GAMEMODES = ['Przetrwanie', 'Kreatywny', 'Przygoda', 'Obserwator'];

/** Szczegóły świata: seed, tryb, wersja, czas gry, statystyki gracza, rozmiar, kopie. */
async function info(inst, world) {
  const dir = path.join(savesDir(inst), safeName(world));
  const out = { name: world, size: await dirSize(dir), backups: await listBackups(inst, world) };
  try {
    const d = nbt.parse(await fsp.readFile(path.join(dir, 'level.dat'))).Data || {};
    const seed = d.WorldGenSettings?.seed ?? d.RandomSeed ?? d.world_gen_settings?.seed;
    const p = d.Player?.Pos;
    Object.assign(out, {
      levelName: d.LevelName || world,
      seed: seed != null ? String(seed) : null,
      gameMode: GAMEMODES[d.GameType] || null,
      hardcore: !!d.hardcore,
      cheats: !!d.allowCommands,
      version: d.Version?.Name || null,
      lastPlayed: d.LastPlayed != null ? Number(d.LastPlayed) : null,
      days: d.DayTime != null ? Math.floor(Number(d.DayTime) / 24000) + 1 : d.Time != null ? Math.floor(Number(d.Time) / 24000) + 1 : null,
      spawn: d.SpawnX != null ? { x: d.SpawnX, y: d.SpawnY, z: d.SpawnZ } : d.spawn?.pos ? { x: d.spawn.pos[0], y: d.spawn.pos[1], z: d.spawn.pos[2] } : null,
      player: p ? { x: Math.round(p[0]), y: Math.round(p[1]), z: Math.round(p[2]) } : null,
    });
  } catch (e) { out.error = `Nie udało się odczytać level.dat: ${e.message}`; }
  // statystyki (pierwszy gracz – w singleplayerze jedyny)
  try {
    const sd = path.join(dir, 'stats');
    const f = (await fsp.readdir(sd)).find((x) => x.endsWith('.json'));
    if (f) {
      const s = JSON.parse(await fsp.readFile(path.join(sd, f), 'utf8')).stats || {};
      const c = s['minecraft:custom'] || {};
      const sum = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0);
      const cm = ['walk_one_cm', 'sprint_one_cm', 'swim_one_cm', 'fly_one_cm', 'boat_one_cm', 'horse_one_cm', 'minecart_one_cm', 'aviate_one_cm', 'crouch_one_cm', 'walk_on_water_one_cm', 'walk_under_water_one_cm']
        .reduce((a, k) => a + (c[`minecraft:${k}`] || 0), 0);
      out.stats = {
        playTicks: c['minecraft:play_time'] || c['minecraft:play_one_minute'] || 0,
        deaths: c['minecraft:deaths'] || 0,
        mobKills: c['minecraft:mob_kills'] || 0,
        jumps: c['minecraft:jump'] || 0,
        distanceKm: Math.round(cm / 1000) / 100,
        blocksMined: sum(s['minecraft:mined']),
        itemsCrafted: sum(s['minecraft:crafted']),
      };
    }
  } catch {}
  return out;
}

// ---------------- kopie zapasowe ----------------
async function listBackups(inst, world) {
  const dir = backupsDir(inst, world);
  const out = [];
  for (const f of await fsp.readdir(dir).catch(() => [])) {
    if (!f.endsWith('.zip')) continue;
    const st = await fsp.stat(path.join(dir, f)).catch(() => null);
    if (st) out.push({ file: f, size: st.size, date: st.mtimeMs, auto: f.includes('-auto'), note: f.includes('-before-restore') ? 'przed przywróceniem' : null });
  }
  return out.sort((a, b) => b.date - a.date);
}

const stamp = () => {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

/** Kopia świata do .justlauncher/backups/<świat>/<data>.zip (bez session.lock). */
async function backup(inst, world, o = {}) {
  safeName(world);
  const src = path.join(savesDir(inst), world);
  if (!fs.existsSync(path.join(src, 'level.dat'))) throw new Error(`Świat „${world}” nie istnieje`);
  const file = path.join(backupsDir(inst, world), `${stamp()}${o.suffix || ''}.zip`);
  const z = await new ZipWriter(file).open();
  let n = 0;
  try {
    await z.addDir(world, src, (rel) => !/session\.lock$/.test(rel), () => { n++; if (n % 50 === 0) o.onStatus?.(`Kopia „${world}”: ${n} plików`); });
    await z.close();
  } catch (e) { await z.abort(); throw e; }
  await prune(inst, world, o.keep);
  return { file: path.basename(file), files: n };
}

/** Zostawia `keep` najnowszych automatycznych kopii (ręcznych nie rusza). */
async function prune(inst, world, keep = 5) {
  const list = (await listBackups(inst, world)).filter((b) => b.auto);
  for (const b of list.slice(Math.max(1, keep))) await fsp.rm(path.join(backupsDir(inst, world), b.file), { force: true });
}

/** Po wyjściu z gry: kopia każdego świata zmienionego od ostatniej kopii. */
async function autoBackup(inst, keep, onLog) {
  const done = [];
  for (const w of await fsp.readdir(savesDir(inst), { withFileTypes: true }).catch(() => [])) {
    if (!w.isDirectory()) continue;
    const lvl = path.join(savesDir(inst), w.name, 'level.dat');
    const st = await fsp.stat(lvl).catch(() => null);
    if (!st) continue;
    const last = (await listBackups(inst, w.name))[0];
    if (last && last.date >= st.mtimeMs) continue;
    try {
      const size = await dirSize(path.join(savesDir(inst), w.name));
      if (size > 3.5 * 1024 ** 3) { onLog?.(`Świat „${w.name}” jest za duży na automatyczną kopię (${(size / 1024 ** 3).toFixed(1)} GB)`); continue; }
      await backup(inst, w.name, { suffix: '-auto', keep });
      done.push(w.name);
    } catch (e) { onLog?.(`Kopia „${w.name}” nie powiodła się: ${e.message}`); }
  }
  return done;
}

/** Przywraca kopię: najpierw robi kopię obecnego stanu, potem podmienia folder świata. */
async function restore(inst, world, file) {
  safeName(world);
  if (!/^[\w\-]+\.zip$/.test(file)) throw new Error('Zła nazwa kopii');
  const zipFile = path.join(backupsDir(inst, world), file);
  if (!fs.existsSync(zipFile)) throw new Error('Kopia nie istnieje');
  const dir = path.join(savesDir(inst), world);
  if (fs.existsSync(path.join(dir, 'level.dat'))) await backup(inst, world, { suffix: '-before-restore' });
  const tmp = path.join(savesDir(inst), `.${world}.restoring`);
  await fsp.rm(tmp, { recursive: true, force: true });
  await fsp.mkdir(tmp, { recursive: true });
  const prefix = `${world}/`;
  await zip.extract(zipFile, tmp, (n) => (n.startsWith(prefix) && n.length > prefix.length ? n.slice(prefix.length) : false));
  if (!fs.existsSync(path.join(tmp, 'level.dat'))) { await fsp.rm(tmp, { recursive: true, force: true }); throw new Error('Kopia jest uszkodzona (brak level.dat)'); }
  await fsp.rm(dir, { recursive: true, force: true });
  await fsp.rename(tmp, dir);
}

async function removeBackup(inst, world, file) {
  safeName(world);
  if (!/^[\w\-]+\.zip$/.test(file)) throw new Error('Zła nazwa kopii');
  await fsp.rm(path.join(backupsDir(inst, world), file), { force: true });
}

// ---------------- mapa ----------------
let workerCode = null;
/** Renderuje mapę (regiony najbliżej gracza/spawnu). Zwraca { png (Buffer), width, height, minX, minZ, ... }. */
function renderMap(inst, world, o = {}) {
  safeName(world);
  workerCode ||= fs.readFileSync(path.join(__dirname, 'worldmap-worker.js'), 'utf8');
  const dim = o.dimension === 'nether' ? 'DIM-1/region' : o.dimension === 'end' ? 'DIM1/region' : 'region';
  return new Promise((resolve, reject) => {
    const w = new Worker(workerCode, { eval: true, workerData: { dir: path.join(savesDir(inst), world, dim), centerX: o.x || 0, centerZ: o.z || 0, maxRegions: o.maxRegions || 16 } });
    w.on('message', (m) => {
      if (m.progress != null) { o.onProgress?.(m.progress); return; }
      resolve(m);
    });
    w.on('error', reject);
    w.on('exit', (c) => { if (c !== 0) reject(new Error(`Mapa: wątek zakończył się kodem ${c}`)); });
  });
}

module.exports = { info, backup, autoBackup, restore, listBackups, removeBackup, renderMap, dirSize };
