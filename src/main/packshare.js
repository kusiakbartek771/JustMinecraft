// Eksport instancji (.mrpack dla Modrinth / każdego launchera, .zip z całą instancją) i kody udostępniania.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const net = require('./core/net');
const zip = require('./core/zip');
const { ZipWriter } = require('./core/zipwrite');
const content = require('./content');
const modrinth = require('./modrinth');

const isBuiltin = (f) => /^justhud-/i.test(path.basename(f));
const MANIFEST = 'justminecraft-instance.json';

/** Dokładna wersja loadera instancji (z ustawień albo z zainstalowanej wersji gry). */
function loaderVersion(inst) {
  let v = inst.loaderVersion || '';
  const id = inst.versionId || '';
  if (!v) {
    const m = inst.loader === 'fabric' ? id.match(/fabric-loader-([^-]+)-/) : inst.loader === 'quilt' ? id.match(/quilt-loader-([^-]+)-/)
      : inst.loader === 'forge' ? id.match(/forge-([\d.]+)/) : inst.loader === 'neoforge' ? id.match(/neoforge-([\w.-]+)/) : null;
    v = m ? m[1] : '';
  }
  if (inst.loader === 'forge' && v.startsWith(`${inst.mc}-`)) v = v.slice(inst.mc.length + 1);
  return v || null;
}

async function hashFile(file) {
  const b = await fsp.readFile(file);
  return { sha1: crypto.createHash('sha1').update(b).digest('hex'), sha512: crypto.createHash('sha512').update(b).digest('hex'), size: b.length };
}

/** Pliki zawartości (mody, resource packi, shadery) z rozpoznaniem na Modrinth po SHA1. */
async function contentFiles(inst) {
  const out = [];
  for (const [type, dir] of [['mod', 'mods'], ['resourcepack', 'resourcepacks'], ['shader', 'shaderpacks']]) {
    let names = [];
    try { names = await fsp.readdir(path.join(inst.dir, dir)); } catch {}
    for (const n of names) {
      if (n.endsWith('.disabled') || isBuiltin(n)) continue;
      const full = path.join(inst.dir, dir, n);
      const st = await fsp.stat(full).catch(() => null);
      if (!st?.isFile() || !/\.(jar|zip)$/i.test(n)) continue;
      out.push({ type, rel: `${dir}/${n}`, full, ...(await hashFile(full)) });
    }
  }
  if (out.length) {
    try {
      const r = await net.json('https://api.modrinth.com/v2/version_files', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: out.map((f) => f.sha1), algorithm: 'sha1' }),
      });
      for (const f of out) {
        const v = r[f.sha1];
        const file = v?.files?.find((x) => x.hashes.sha1 === f.sha1);
        if (v && file) Object.assign(f, { versionId: v.id, projectId: v.project_id, url: file.url });
      }
    } catch { /* bez internetu – wszystko trafi do overrides */ }
  }
  return out;
}

const DEP_KEY = { fabric: 'fabric-loader', quilt: 'quilt-loader', forge: 'forge', neoforge: 'neoforge' };

/** .mrpack: mody z Modrinth jako linki, reszta (i konfiguracja) w overrides/. */
async function exportMrpack(inst, file, o = {}, ctx = {}) {
  ctx.onStatus?.('Rozpoznawanie modów na Modrinth…');
  const files = await contentFiles(inst);
  const deps = { minecraft: inst.mc };
  if (DEP_KEY[inst.loader]) {
    const lv = loaderVersion(inst);
    if (!lv) throw new Error('Nie znam wersji loadera – uruchom instancję raz, zanim ją wyeksportujesz.');
    deps[DEP_KEY[inst.loader]] = lv;
  }
  const index = {
    formatVersion: 1, game: 'minecraft', versionId: o.version || '1.0.0', name: o.name || inst.name,
    summary: o.summary || `Wyeksportowano z JustMinecraft`,
    files: files.filter((f) => f.url).map((f) => ({ path: f.rel, hashes: { sha1: f.sha1, sha512: f.sha512 }, env: { client: 'required', server: f.type === 'mod' ? 'optional' : 'unsupported' }, downloads: [f.url], fileSize: f.size })),
    dependencies: deps,
  };
  const z = await new ZipWriter(file).open();
  try {
    await z.add('modrinth.index.json', Buffer.from(JSON.stringify(index, null, 2)));
    for (const f of files.filter((x) => !x.url)) await z.addFile(`overrides/${f.rel}`, f.full);
    for (const d of ['config', 'defaultconfigs', 'kubejs', 'scripts', ...(o.saves ? ['saves'] : [])]) {
      const p = path.join(inst.dir, d);
      if (fs.existsSync(p)) await z.addDir(`overrides/${d}`, p, (rel) => !/session\.lock$/.test(rel));
    }
    if (o.options !== false && fs.existsSync(path.join(inst.dir, 'options.txt'))) await z.addFile('overrides/options.txt', path.join(inst.dir, 'options.txt'));
    await z.close();
  } catch (e) { await z.abort(); throw e; }
  return { linked: index.files.length, included: files.filter((f) => !f.url).length };
}

/** .zip z całą instancją (do kopii albo przeniesienia na inny komputer z JustMinecraft). */
async function exportZip(inst, file, parts = {}, ctx = {}) {
  const want = { mods: true, config: true, resourcepacks: true, shaderpacks: true, saves: false, options: true, ...parts };
  const z = await new ZipWriter(file).open();
  try {
    await z.add(MANIFEST, Buffer.from(JSON.stringify({ format: 1, name: inst.name, mc: inst.mc, loader: inst.loader, loaderVersion: loaderVersion(inst), icon: inst.icon || null, color: inst.color || null }, null, 2)));
    const dirs = [['mods', 'mods'], ['config', 'config'], ['config', 'defaultconfigs'], ['config', 'kubejs'], ['resourcepacks', 'resourcepacks'], ['shaderpacks', 'shaderpacks'], ['saves', 'saves']];
    for (const [k, d] of dirs) {
      if (!want[k]) continue;
      const p = path.join(inst.dir, d);
      if (fs.existsSync(p)) { ctx.onStatus?.(`Pakowanie: ${d}`); await z.addDir(d, p, (rel) => !/session\.lock$/.test(rel) && !isBuiltin(rel)); }
    }
    if (want.options) for (const f of ['options.txt', 'servers.dat']) if (fs.existsSync(path.join(inst.dir, f))) await z.addFile(f, path.join(inst.dir, f));
    await z.close();
  } catch (e) { await z.abort(); throw e; }
}

async function readZipManifest(file) {
  const t = await zip.readText(file, MANIFEST).catch(() => null);
  return t ? JSON.parse(t) : null;
}

async function applyZip(inst, file) {
  await zip.extract(file, inst.dir, (n) => (n === MANIFEST ? false : n));
}

// ---------------- kody udostępniania ----------------
// JUST1-<base64url(deflate(JSON))> – lista wersji z Modrinth + wersja gry i loadera. Nie wymaga serwera.
const PREFIX = 'JUST1-';

async function makeCode(inst) {
  const files = await contentFiles(inst);
  const pick = (type) => files.filter((f) => f.type === type && f.versionId).map((f) => f.versionId);
  const data = { n: inst.name, m: inst.mc, l: inst.loader, v: loaderVersion(inst), p: pick('mod'), r: pick('resourcepack'), s: pick('shader') };
  const code = PREFIX + zlib.deflateRawSync(Buffer.from(JSON.stringify(data)), { level: 9 }).toString('base64url');
  return { code, mods: data.p.length, resourcepacks: data.r.length, shaders: data.s.length, skipped: files.filter((f) => !f.versionId).map((f) => path.basename(f.rel)) };
}

function readCode(code) {
  code = String(code || '').trim().replace(/\s+/g, '');
  if (!code.startsWith(PREFIX)) throw new Error('To nie jest kod JustMinecraft (powinien zaczynać się od „JUST1-”).');
  let d;
  try { d = JSON.parse(zlib.inflateRawSync(Buffer.from(code.slice(PREFIX.length), 'base64url')).toString('utf8')); } catch { throw new Error('Kod jest uszkodzony albo niepełny – skopiuj go jeszcze raz w całości.'); }
  if (!d.m || !d.l) throw new Error('Kod nie zawiera wersji gry.');
  return { name: d.n || 'Paczka znajomego', mc: d.m, loader: d.l, loaderVersion: d.v || null, mods: d.p || [], resourcepacks: d.r || [], shaders: d.s || [] };
}

/** Instaluje zawartość z kodu do (nowej) instancji – dokładnie te wersje, bez dobierania zależności. */
async function applyCode(inst, data, ctx = {}) {
  const all = [...data.mods.map((v) => ['mod', v]), ...data.resourcepacks.map((v) => ['resourcepack', v]), ...data.shaders.map((v) => ['shader', v])];
  const failed = [];
  let i = 0;
  for (const [type, versionId] of all) {
    ctx.onProgress?.({ done: i++, total: all.length });
    try {
      const v = await net.json(`https://api.modrinth.com/v2/version/${versionId}`);
      await modrinth.install({ inst, projectId: v.project_id, versionId, type, deps: false, onStatus: ctx.onStatus, signal: ctx.signal });
    } catch (e) { failed.push(`${versionId}: ${e.message}`); }
  }
  return { installed: all.length - failed.length, failed };
}

module.exports = { exportMrpack, exportZip, readZipManifest, applyZip, makeCode, readCode, applyCode, loaderVersion, MANIFEST };
