// Google Drive: import modów / paczek z publicznego folderu albo pliku (dla każdego, bez logowania).
// Bez klucza API lista folderu jest czytana z publicznego widoku „embeddedfolderview”;
// z kluczem (Ustawienia → Pobieranie) używane jest oficjalne Drive API v3.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const net = require('./core/net');
const zip = require('./core/zip');
const content = require('./content');

const FOLDER_MIME = 'application/vnd.google-apps.folder';
const KNOWN_DIRS = ['mods', 'resourcepacks', 'shaderpacks', 'config', 'datapacks', 'saves', 'kubejs', 'defaultconfigs', 'scripts', 'schematics', 'emotes', 'screenshots'];
const ROOT_FILES = ['options.txt', 'servers.dat', 'optionsshaders.txt', 'optionsof.txt'];

/** Rozpoznaje link: { kind: 'folder'|'file', id } */
function parseLink(input) {
  const s = String(input || '').trim();
  let m = s.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (m) return { kind: 'folder', id: m[1] };
  m = s.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/) || s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return { kind: s.includes('folderview') ? 'folder' : 'file', id: m[1] };
  if (/^[a-zA-Z0-9_-]{20,}$/.test(s)) return { kind: 'unknown', id: s };
  throw new Error('To nie wygląda na link do Google Drive. Wklej link „Udostępnij → Każda osoba mająca link”.');
}

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

async function listFolderPublic(id) {
  const html = await net.text(`https://drive.google.com/embeddedfolderview?id=${encodeURIComponent(id)}`);
  if (/ServiceLogin|accounts\.google\.com/.test(html) && !html.includes('flip-entry')) throw new Error('Folder nie jest publiczny – ustaw „Każda osoba mająca link” w udostępnianiu.');
  const out = [];
  const parts = html.split(/<div class="flip-entry"/).slice(1);
  for (const p of parts) {
    const idm = p.match(/id="entry-([a-zA-Z0-9_-]+)"/);
    const title = p.match(/<div class="flip-entry-title">([\s\S]*?)<\/div>/);
    if (!idm || !title) continue;
    const href = p.match(/href="([^"]+)"/)?.[1] || '';
    out.push({ id: idm[1], name: decode(title[1].trim()), folder: /\/folders\//.test(href) });
  }
  return out;
}

async function listFolderApi(id, key) {
  const out = [];
  let pageToken = '';
  do {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`'${id}' in parents and trashed=false`)}&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime)')}&pageSize=1000&key=${encodeURIComponent(key)}${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const r = await net.json(url);
    for (const f of r.files || []) out.push({ id: f.id, name: f.name, folder: f.mimeType === FOLDER_MIME, size: f.size ? Number(f.size) : null, modified: f.modifiedTime });
    pageToken = r.nextPageToken || '';
  } while (pageToken);
  return out;
}

/** Rekurencyjna lista plików folderu: [{ id, name, rel (ścieżka względna), size? }] */
async function walk(id, key, rel = '', depth = 0, acc = []) {
  if (depth > 6) return acc;
  const items = key ? await listFolderApi(id, key) : await listFolderPublic(id);
  for (const it of items) {
    const r = rel ? `${rel}/${it.name}` : it.name;
    if (it.folder) await walk(it.id, key, r, depth + 1, acc);
    else acc.push({ ...it, rel: r });
  }
  return acc;
}

/** Pobiera plik z Drive (obsługuje stronę „nie można przeskanować pod kątem wirusów”). Zwraca nazwę pliku. */
async function downloadFile(id, destDir, { key, name, signal, onBytes } = {}) {
  await fsp.mkdir(destDir, { recursive: true });
  const urls = key
    ? [`https://www.googleapis.com/drive/v3/files/${id}?alt=media&key=${encodeURIComponent(key)}`]
    : [`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`];
  return net.withRetry(async () => {
    let res = await net.request(urls[0], { signal, timeout: 60000 });
    let ct = res.headers.get('content-type') || '';
    if (ct.includes('text/html')) {
      const html = await res.text();
      const action = html.match(/action="([^"]+)"/)?.[1];
      if (!action) throw Object.assign(new Error('Plik nie jest publiczny albo przekroczono limit pobrań Google Drive – spróbuj później.'), { status: 403 });
      const params = [...html.matchAll(/<input type="hidden" name="([^"]+)" value="([^"]*)"/g)].map(([, k, v]) => `${k}=${encodeURIComponent(decode(v))}`).join('&');
      res = await net.request(`${decode(action)}?${params}`, { signal, timeout: 60000 });
      ct = res.headers.get('content-type') || '';
      if (ct.includes('text/html')) throw Object.assign(new Error('Google Drive nie udostępnił pliku (limit pobrań albo brak dostępu).'), { status: 403 });
    }
    const cd = res.headers.get('content-disposition') || '';
    let fname = name;
    const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
    const plain = cd.match(/filename="([^"]+)"/i);
    if (!fname) fname = star ? decodeURIComponent(star[1]) : plain ? plain[1] : `${id}.bin`;
    fname = path.basename(fname.replace(/[\\/:*?"<>|]/g, '_'));
    const target = path.join(destDir, fname);
    const tmp = `${target}.${crypto.randomBytes(3).toString('hex')}.part`;
    try {
      const body = Readable.fromWeb(res.body);
      if (onBytes) body.on('data', (c) => onBytes(c.length));
      await pipeline(body, fs.createWriteStream(tmp));
      await fsp.rename(tmp, target);
    } catch (e) {
      await fsp.rm(tmp, { force: true });
      throw e;
    }
    return fname;
  }, 3, signal);
}

/** Gdzie trafia plik z paczki – na podstawie folderu na Drive lub zawartości archiwum. */
async function placeFile(inst, tmpFile, rel) {
  let parts = rel.split('/');
  // folder paczki może mieć na górze „overrides” / „.minecraft” / „minecraft”
  while (parts.length > 1 && ['overrides', '.minecraft', 'minecraft', 'client-overrides'].includes(parts[0].toLowerCase())) parts = parts.slice(1);
  const top = parts[0].toLowerCase();
  if (parts.length > 1 && KNOWN_DIRS.includes(top)) return path.join(inst.dir, top, ...parts.slice(1));
  const base = path.basename(tmpFile);
  if (ROOT_FILES.includes(base.toLowerCase())) return path.join(inst.dir, base);
  const kind = await content.detectKind(tmpFile);
  if (kind === 'mod') return path.join(inst.dir, 'mods', base);
  if (kind === 'resourcepack') return path.join(inst.dir, 'resourcepacks', base);
  if (kind === 'shader') return path.join(inst.dir, 'shaderpacks', base);
  if (kind === 'datapack') return path.join(inst.dir, 'datapacks', base);
  if (kind === 'modpack' || kind === 'overlay') return { special: kind };
  // luźne pliki w nieznanych podfolderach pomijamy (np. rozpakowany resource pack) – lepiej spakować go do .zip
  return null;
}

/**
 * Importuje folder/plik z Drive do instancji. Przy ponownym imporcie (aktualizacja paczki) pobiera tylko nowe pliki
 * i usuwa te, które autor usunął z folderu.
 */
async function importToInstance(inst, link, o = {}) {
  const { kind, id } = parseLink(link);
  const key = o.apiKey || '';
  const tmpDir = path.join(o.cacheDir, 'drive', crypto.randomBytes(4).toString('hex'));
  await fsp.mkdir(tmpDir, { recursive: true });
  const prev = o.previous || {}; // fileId -> rel w instancji
  const now = {};
  const report = { added: [], removed: [], skipped: [], special: [] };
  try {
    let files;
    if (kind === 'file') files = [{ id, name: null, rel: '' }];
    else {
      o.onStatus?.('Czytanie folderu Google Drive');
      try { files = await walk(id, key); } catch (e) {
        if (kind === 'unknown') files = [{ id, name: null, rel: '' }];
        else throw e;
      }
      if (!files.length && !key) throw new Error('Folder jest pusty albo nie jest publiczny (Udostępnij → „Każda osoba mająca link”).');
    }
    let i = 0;
    for (const f of files) {
      i++;
      o.onProgress?.({ done: i - 1, total: files.length });
      if (prev[f.id] && fs.existsSync(path.join(inst.dir, prev[f.id]))) { now[f.id] = prev[f.id]; report.skipped.push(prev[f.id]); continue; }
      o.onStatus?.(`Pobieranie ${f.name || 'pliku'} (${i}/${files.length})`);
      const fname = await downloadFile(f.id, tmpDir, { key, name: f.name, signal: o.signal });
      const tmpFile = path.join(tmpDir, fname);
      const rel = f.rel ? f.rel.replace(/[^/]+$/, fname) : fname;
      const target = await placeFile(inst, tmpFile, rel);
      if (!target) { report.skipped.push(fname); continue; }
      if (target.special) {
        report.special.push({ kind: target.special, file: tmpFile, name: fname });
        if (target.special === 'overlay') {
          await zip.extract(tmpFile, inst.dir, (n) => {
            const stripped = n.replace(/^(overrides|\.minecraft|minecraft)\//, '');
            return stripped || false;
          });
          now[f.id] = `.justlauncher/overlay-${f.id}`;
        }
        continue;
      }
      if (!path.resolve(target).startsWith(path.resolve(inst.dir) + path.sep)) continue;
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.rename(tmpFile, target).catch(async () => { await fsp.copyFile(tmpFile, target); await fsp.rm(tmpFile, { force: true }); });
      const relInst = path.relative(inst.dir, target).replace(/\\/g, '/');
      now[f.id] = relInst;
      report.added.push(relInst);
      await content.remember(inst, relInst, { source: 'drive', driveId: f.id, title: null });
    }
    // pliki usunięte przez autora paczki
    if (o.removeMissing !== false) {
      for (const [fid, rel] of Object.entries(prev)) {
        if (now[fid] || rel.startsWith('.justlauncher/')) continue;
        const full = path.join(inst.dir, rel);
        if (!path.resolve(full).startsWith(path.resolve(inst.dir) + path.sep)) continue;
        await fsp.rm(full, { force: true });
        await fsp.rm(`${full}.disabled`, { force: true });
        await content.forget(inst, rel);
        report.removed.push(rel);
      }
    }
    o.onProgress?.({ done: files.length, total: files.length });
    return { files: now, report };
  } finally {
    // pliki specjalne (modpacki) są potrzebne wywołującemu – usuwamy resztę
    if (!report.special.some((s) => s.kind === 'modpack')) await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Kopiuje globalne datapacki instancji (folder datapacks/) do wszystkich światów. */
async function syncGlobalDatapacks(inst) {
  const src = path.join(inst.dir, 'datapacks');
  let packs = [];
  try { packs = (await fsp.readdir(src)).filter((n) => !n.endsWith('.disabled')); } catch { return 0; }
  if (!packs.length) return 0;
  let n = 0;
  let worlds = [];
  try { worlds = await fsp.readdir(path.join(inst.dir, 'saves'), { withFileTypes: true }); } catch { return 0; }
  for (const w of worlds) {
    if (!w.isDirectory()) continue;
    const dst = path.join(inst.dir, 'saves', w.name, 'datapacks');
    if (!fs.existsSync(path.join(inst.dir, 'saves', w.name, 'level.dat'))) continue;
    await fsp.mkdir(dst, { recursive: true });
    for (const p of packs) {
      const to = path.join(dst, p);
      if (fs.existsSync(to)) continue;
      await fsp.cp(path.join(src, p), to, { recursive: true });
      n++;
    }
  }
  return n;
}

module.exports = { parseLink, walk, downloadFile, importToInstance, syncGlobalDatapacks, listFolderPublic };
