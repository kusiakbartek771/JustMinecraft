// Sprawdzanie modów przed startem gry: brakujące zależności, mody na inny loader albo inną wersję gry,
// duplikaty i znane niezgodne pary. Wynik to lista problemów z propozycją naprawy.
const fsp = require('fs/promises');
const path = require('path');
const zip = require('./core/zip');
const modrinth = require('./modrinth');
const content = require('./content');
const net = require('./core/net');

// id, które zapewnia sam loader / gra
const BUILTIN = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt_base', 'forge', 'neoforge', 'javafml', 'lowcodefml', 'mixinextras', 'fml']);

// znane pary, które się wykluczają: [a, b, opis] – a zostaje, b wyłączamy
const INCOMPATIBLE = [
  ['sodium', 'embeddium', 'Sodium i Embeddium robią to samo – zostaw jeden.'],
  ['sodium', 'rubidium', 'Sodium i Rubidium robią to samo – zostaw jeden.'],
  ['embeddium', 'rubidium', 'Embeddium i Rubidium robią to samo – zostaw jeden.'],
  ['iris', 'oculus', 'Iris i Oculus robią to samo – zostaw jeden.'],
  ['sodium', 'optifine', 'OptiFine nie działa z Sodium – zostaw Sodium (z Iris do shaderów).'],
  ['iris', 'optifine', 'OptiFine nie działa z Iris – zostaw Iris.'],
  ['embeddium', 'optifine', 'OptiFine nie działa z Embeddium.'],
  ['modernfix', 'smoothboot', 'ModernFix zawiera już przyspieszenie startu ze Smooth Boot.'],
  ['lithium', 'canary', 'Lithium i Canary robią to samo – zostaw jeden.'],
  ['starlight', 'phosphor', 'Starlight i Phosphor robią to samo – zostaw jeden.'],
];

// ---------- wersje ----------
const parts = (v) => String(v).replace(/[-+].*$/, '').split('.').map((x) => parseInt(x, 10) || 0);
function cmp(a, b) {
  const A = parts(a), B = parts(b);
  for (let i = 0; i < Math.max(A.length, B.length, 3); i++) { const d = (A[i] || 0) - (B[i] || 0); if (d) return d; }
  return 0;
}

/** Zakres w stylu Fabric (">=1.20 <1.21", "~1.20.1", "1.20.x", "*", tablica = LUB). null = nie umiem ocenić. */
function fabricMatches(range, v) {
  if (range == null) return null;
  if (Array.isArray(range)) { const r = range.map((x) => fabricMatches(x, v)); return r.includes(true) ? true : r.includes(null) ? null : false; }
  range = String(range).trim();
  if (!range || range === '*') return true;
  if (range.includes('||')) return fabricMatches(range.split('||'), v);
  let ok = true;
  for (const tok of range.split(/\s+/)) {
    const m = tok.match(/^(>=|<=|>|<|=|~|\^)?\s*([0-9][0-9a-zA-Z.\-+]*?)(?:\.x|\.\*)?$/);
    if (!m) return null;
    const op = m[1] || (/\.(x|\*)$/.test(tok) ? 'x' : '='), ver = m[2];
    if (/[a-zA-Z]/.test(ver.replace(/[-+].*$/, ''))) return null; // snapshoty itp.
    const c = cmp(v, ver);
    if (op === '>=') ok = ok && c >= 0;
    else if (op === '<=') ok = ok && c <= 0;
    else if (op === '>') ok = ok && c > 0;
    else if (op === '<') ok = ok && c < 0;
    else if (op === '~' || op === 'x') { const p = parts(ver); const n = op === 'x' ? p.length : Math.max(2, p.length - 1); ok = ok && c >= 0 && parts(v).slice(0, n).join('.') === p.slice(0, n).join('.'); }
    else if (op === '^') ok = ok && c >= 0 && parts(v)[0] === parts(ver)[0];
    else ok = ok && c === 0;
  }
  return ok;
}

/** Zakres Mavena (Forge): "[1.20,1.21)", "[1.20.1]", "1.20.1". */
function mavenMatches(range, v) {
  if (!range) return null;
  range = String(range).trim();
  if (range === '*' || range === '') return true;
  return range.split(/(?<=[\])]),/).some((r) => {
    r = r.trim();
    const m = r.match(/^([[(])\s*([^,\])]*)\s*(?:,\s*([^\])]*))?\s*([\])])$/);
    if (!m) return cmp(v, r) >= 0;
    const [, lo, a, b, hi] = m;
    if (b === undefined) return cmp(v, a) === 0;
    if (a && (lo === '[' ? cmp(v, a) < 0 : cmp(v, a) <= 0)) return false;
    if (b && (hi === ']' ? cmp(v, b) > 0 : cmp(v, b) >= 0)) return false;
    return true;
  });
}

// ---------- metadane ----------
function tomlDeps(toml, modId) {
  const out = [];
  const re = new RegExp(`\\[\\[dependencies\\.${modId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]\\]([\\s\\S]*?)(?=\\n\\s*\\[|$)`, 'g');
  let m;
  while ((m = re.exec(toml))) {
    const b = m[1];
    const val = (k) => b.match(new RegExp(`^\\s*${k}\\s*=\\s*["']?([^"'\\n]+)["']?`, 'm'))?.[1]?.trim();
    const mandatory = val('mandatory') === 'true' || val('type') === 'required';
    const side = (val('side') || 'BOTH').toUpperCase();
    if (val('modId')) out.push({ id: val('modId'), range: val('versionRange'), required: mandatory && side !== 'SERVER' });
  }
  return out;
}

async function readMeta(file) {
  const want = ['fabric.mod.json', 'quilt.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml'];
  let m;
  try { m = await zip.read(file, (n) => want.includes(n) || /^META-INF\/jars(in-?jar)?\/.+\.jar$/i.test(n) || /^META-INF\/jarjar\/.+\.jar$/i.test(n)); } catch { return null; }
  const meta = { ids: new Set(), deps: [], breaks: [], loaders: new Set(), mc: null, mcKind: null, id: null, version: null };
  const fab = m.get('fabric.mod.json');
  if (fab) {
    try {
      const j = JSON.parse(fab.toString('utf8').replace(/[\u0000-\u001f]+/g, ' '));
      meta.id = j.id; meta.version = j.version; meta.ids.add(j.id); meta.loaders.add('fabric');
      for (const p of j.provides || []) meta.ids.add(typeof p === 'string' ? p : p.id);
      for (const [id, r] of Object.entries(j.depends || {})) {
        if (id === 'minecraft') { meta.mc = r; meta.mcKind = 'fabric'; continue; }
        meta.deps.push({ id, range: r, required: true });
      }
      for (const [id, r] of Object.entries(j.breaks || {})) meta.breaks.push({ id, range: r });
    } catch {}
  }
  const qu = m.get('quilt.mod.json');
  if (qu) {
    try {
      const q = JSON.parse(qu.toString('utf8')).quilt_loader || {};
      meta.id = meta.id || q.id; meta.ids.add(q.id); meta.loaders.add('quilt');
      for (const p of q.provides || []) meta.ids.add(typeof p === 'string' ? p : p.id);
      for (const d of q.depends || []) {
        const id = typeof d === 'string' ? d : d.id;
        if (id === 'minecraft') { meta.mc = typeof d === 'string' ? '*' : d.versions; meta.mcKind = 'fabric'; continue; }
        if (!(typeof d === 'object' && d.optional)) meta.deps.push({ id, range: d.versions, required: true });
      }
    } catch {}
  }
  for (const name of ['META-INF/neoforge.mods.toml', 'META-INF/mods.toml']) {
    const t = m.get(name)?.toString('utf8');
    if (!t) continue;
    meta.loaders.add(name.includes('neoforge') ? 'neoforge' : 'forge');
    for (const block of t.split(/^\s*\[\[mods\]\]\s*$/m).slice(1)) {
      const id = block.match(/^\s*modId\s*=\s*["']([^"']+)/m)?.[1];
      if (!id) continue;
      meta.id = meta.id || id; meta.ids.add(id);
      for (const d of tomlDeps(t, id)) {
        if (d.id === 'minecraft') { if (!meta.mc) { meta.mc = d.range; meta.mcKind = 'maven'; } continue; }
        meta.deps.push(d);
      }
    }
  }
  // zagnieżdżone jary (biblioteki dołączone do moda) też dostarczają id
  for (const [name, buf] of m) {
    if (!name.endsWith('.jar')) continue;
    try {
      const inner = await zip.read(buf, ['fabric.mod.json', 'quilt.mod.json', 'META-INF/mods.toml', 'META-INF/neoforge.mods.toml']);
      const f = inner.get('fabric.mod.json');
      if (f) { const j = JSON.parse(f.toString('utf8').replace(/[\u0000-\u001f]+/g, ' ')); meta.ids.add(j.id); for (const p of j.provides || []) meta.ids.add(typeof p === 'string' ? p : p.id); }
      const q = inner.get('quilt.mod.json');
      if (q) meta.ids.add(JSON.parse(q.toString('utf8')).quilt_loader?.id);
      for (const tn of ['META-INF/mods.toml', 'META-INF/neoforge.mods.toml']) {
        const tt = inner.get(tn)?.toString('utf8');
        if (tt) for (const mm of tt.matchAll(/^\s*modId\s*=\s*["']([^"']+)/gm)) meta.ids.add(mm[1]);
      }
    } catch {}
    meta.ids.add(path.basename(name).replace(/-\d.*$/, '').toLowerCase());
  }
  meta.ids.delete(undefined);
  return meta;
}

function loaderOk(meta, loader, mc) {
  if (!meta.loaders.size) return true;
  if (loader === 'fabric') return meta.loaders.has('fabric');
  if (loader === 'quilt') return meta.loaders.has('fabric') || meta.loaders.has('quilt');
  if (loader === 'forge') return meta.loaders.has('forge');
  if (loader === 'neoforge') return meta.loaders.has('neoforge') || (meta.loaders.has('forge') && cmp(mc, '1.20.2') < 0);
  return true;
}

const LOADER_NAME = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };

/** Sprawdza mody instancji. Zwraca { problems: [{ kind, text, file?, fix? }] }. */
async function check(inst) {
  const problems = [];
  if (!inst.loader || inst.loader === 'vanilla') return { problems };
  const dir = path.join(inst.dir, 'mods');
  let files = [];
  try { files = (await fsp.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.jar')); } catch { return { problems }; }
  const mods = [];
  for (const f of files) {
    const full = path.join(dir, f);
    const meta = await readMeta(full);
    if (!meta) { problems.push({ kind: 'broken', file: f, text: `${f} jest uszkodzony (to nie jest poprawny plik .jar).`, fix: { action: 'disable', file: f } }); continue; }
    const st = await fsp.stat(full).catch(() => ({ mtimeMs: 0 }));
    mods.push({ file: f, meta, mtime: st.mtimeMs });
  }
  const provided = new Set(BUILTIN);
  for (const m of mods) for (const id of m.meta.ids) provided.add(id);
  const hasFabricApi = provided.has('fabric-api') || provided.has('fabric');
  const byId = new Map();
  for (const m of mods) if (m.meta.id) byId.set(m.meta.id, [...(byId.get(m.meta.id) || []), m]);

  // duplikaty
  for (const [id, list] of byId) {
    if (list.length < 2) continue;
    const keep = list.slice().sort((a, b) => b.mtime - a.mtime)[0];
    for (const m of list) if (m !== keep) problems.push({ kind: 'duplicate', file: m.file, text: `Mod „${id}” jest zainstalowany dwa razy (${list.map((x) => x.file).join(', ')}).`, fix: { action: 'disable', file: m.file } });
  }
  for (const m of mods) {
    const name = m.meta.id || m.file;
    // loader
    if (!loaderOk(m.meta, inst.loader, inst.mc)) {
      problems.push({ kind: 'loader', file: m.file, text: `${name} jest dla ${[...m.meta.loaders].map((l) => LOADER_NAME[l] || l).join('/')}, a ta instancja używa ${LOADER_NAME[inst.loader]}.`, fix: { action: 'disable', file: m.file } });
      continue;
    }
    // wersja gry
    const okMc = m.meta.mcKind === 'fabric' ? fabricMatches(m.meta.mc, inst.mc) : m.meta.mcKind === 'maven' ? mavenMatches(m.meta.mc, inst.mc) : null;
    if (okMc === false) problems.push({ kind: 'version', file: m.file, text: `${name} jest dla Minecrafta ${String(m.meta.mc)}, a instancja ma ${inst.mc}.`, fix: { action: 'update', file: m.file, id: m.meta.id } });
    // zależności
    for (const d of m.meta.deps) {
      if (!d.required || provided.has(d.id)) continue;
      if (hasFabricApi && /^fabric(-|$)/.test(d.id)) continue;
      if (/^fabric(-|$)/.test(d.id) && !hasFabricApi) { problems.push({ kind: 'missing', file: m.file, dep: 'fabric-api', text: `${name} wymaga Fabric API.`, fix: { action: 'install', id: 'fabric-api' } }); continue; }
      problems.push({ kind: 'missing', file: m.file, dep: d.id, text: `${name} wymaga moda „${d.id}”, którego brakuje.`, fix: { action: 'install', id: d.id } });
    }
    for (const b of m.meta.breaks) {
      const other = byId.get(b.id)?.[0];
      if (!other) continue;
      // „breaks” zwykle dotyczy tylko starych wersji – sprawdzamy zakres
      if (fabricMatches(b.range, other.meta.version || '0') !== true) continue;
      problems.push({ kind: 'conflict', file: other.file, text: `${name} nie działa z tą wersją „${b.id}” (${other.meta.version}) – zaktualizuj ją albo wyłącz.`, fix: { action: 'update', file: other.file, id: b.id } });
    }
  }
  // znane niezgodne pary
  for (const [a, b, why] of INCOMPATIBLE) {
    if (byId.has(a) && byId.has(b)) problems.push({ kind: 'conflict', file: byId.get(b)[0].file, text: why, fix: { action: 'disable', file: byId.get(b)[0].file } });
  }
  // jedna propozycja instalacji na zależność
  const seen = new Set();
  return { problems: problems.filter((p) => { const k = p.fix?.action === 'install' ? `install:${p.fix.id}` : `${p.kind}:${p.file}:${p.text}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
}

/** Naprawia, co się da: wyłącza złe pliki, doinstalowuje brakujące zależności z Modrinth, aktualizuje mody do wersji gry. */
async function fix(inst, problems, ctx = {}) {
  const done = [], failed = [];
  const dir = path.join(inst.dir, 'mods');
  for (const p of problems) {
    const f = p.fix;
    if (!f) continue;
    try {
      if (f.action === 'disable') {
        await fsp.rename(path.join(dir, f.file), path.join(dir, `${f.file}.disabled`));
        done.push(`Wyłączono ${f.file}`);
      } else if (f.action === 'install') {
        ctx.onStatus?.(`Instalacja zależności: ${f.id}`);
        await modrinth.install({ inst, projectId: f.id, type: 'mod', deps: true, signal: ctx.signal });
        done.push(`Zainstalowano ${f.id}`);
      } else if (f.action === 'update') {
        // wersja z Modrinth dla tej wersji gry: projekt z indeksu, rozpoznany po SHA1 albo po id moda
        const idx = await content.loadIndex(inst).catch(() => ({ files: {} }));
        let pid = idx.files[`mods/${f.file}`]?.projectId;
        if (!pid) {
          try {
            const sha1 = await net.sha1File(path.join(dir, f.file));
            pid = (await net.json(`https://api.modrinth.com/v2/version_file/${sha1}?algorithm=sha1`))?.project_id;
          } catch {}
        }
        const ids = [pid, f.id].filter(Boolean);
        let ok = false;
        for (const id of ids) {
          try {
            await modrinth.install({ inst, projectId: id, type: 'mod', deps: true, signal: ctx.signal });
            await fsp.rename(path.join(dir, f.file), path.join(dir, `${f.file}.disabled`)).catch(() => {});
            ok = true; break;
          } catch {}
        }
        if (!ok) { await fsp.rename(path.join(dir, f.file), path.join(dir, `${f.file}.disabled`)); done.push(`Wyłączono ${f.file} (brak wersji dla ${inst.mc})`); }
        else done.push(`Zaktualizowano ${f.id}`);
      }
    } catch (e) { failed.push(`${f.id || f.file}: ${e.message}`); }
  }
  return { done, failed };
}

module.exports = { check, fix, fabricMatches, mavenMatches };
