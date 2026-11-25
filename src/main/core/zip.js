// Odczyt archiwów ZIP/JAR (yauzl – asynchronicznie, czyta tylko katalog centralny).
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const yauzl = require('yauzl');
const { pipeline } = require('stream/promises');

function open(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(file, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true }, (err, zf) => (err ? reject(err) : resolve(zf)));
  });
}

function openStream(zf, entry) {
  return new Promise((resolve, reject) => zf.openReadStream(entry, (err, s) => (err ? reject(err) : resolve(s))));
}

/** Iteruje po wpisach; fn(entry, zf) może zwrócić 'stop'. */
async function each(file, fn) {
  const zf = await open(file);
  try {
    await new Promise((resolve, reject) => {
      zf.on('error', reject);
      zf.on('end', resolve);
      zf.on('entry', async (entry) => {
        try {
          const r = await fn(entry, zf);
          if (r === 'stop') { resolve(); return; }
          zf.readEntry();
        } catch (e) { reject(e); }
      });
      zf.readEntry();
    });
  } finally {
    zf.close();
  }
}

async function entryBuffer(zf, entry) {
  const s = await openStream(zf, entry);
  const chunks = [];
  for await (const c of s) chunks.push(c);
  return Buffer.concat(chunks);
}

/** Lista nazw plików w archiwum. */
async function list(file) {
  const names = [];
  await each(file, (e) => { names.push(e.fileName); });
  return names;
}

/** Czyta wybrane pliki: names = tablica nazw lub funkcja-filtr. Zwraca Map(nazwa -> Buffer). */
async function read(file, names) {
  const want = typeof names === 'function' ? names : (n) => names.includes(n);
  const out = new Map();
  const limit = Array.isArray(names) ? names.length : Infinity;
  await each(file, async (e, zf) => {
    if (!e.fileName.endsWith('/') && want(e.fileName)) {
      out.set(e.fileName, await entryBuffer(zf, e));
      if (out.size >= limit) return 'stop';
    }
  });
  return out;
}

async function readText(file, name) {
  const m = await read(file, [name]);
  return m.has(name) ? m.get(name).toString('utf8') : null;
}

/**
 * Wypakowuje archiwum do katalogu. filter(name) -> false pomija, -> string zmienia ścieżkę docelową.
 * Chroni przed „zip slip” (ścieżki poza katalogiem docelowym).
 */
async function extract(file, dest, filter = () => true) {
  const root = path.resolve(dest);
  let count = 0;
  await each(file, async (e, zf) => {
    let name = e.fileName;
    const f = filter(name, e);
    if (f === false) return;
    if (typeof f === 'string') name = f;
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) return;
    if (name.endsWith('/')) { await fsp.mkdir(target, { recursive: true }); return; }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const s = await openStream(zf, e);
    await pipeline(s, fs.createWriteStream(target));
    const mode = (e.externalFileAttributes >>> 16) & 0o777;
    if (mode & 0o111) await fsp.chmod(target, mode | 0o600).catch(() => {});
    count++;
  });
  return count;
}

module.exports = { list, read, readText, extract, each };
