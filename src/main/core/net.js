// Sieć: JSON z ponawianiem, pobieranie plików z weryfikacją SHA1, pula równoległych pobrań.
// Nie zależy od Electrona – rdzeń da się testować zwykłym Node (scripts/test-install.mjs).
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const UA = `JustLauncher/${require('../../../package.json').version} (+https://github.com/kusiakbartek771/JustLauncher)`;
const cfg = { concurrency: 16, retries: 4, timeout: 30000 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status}: ${url}`);
    this.status = status;
    this.url = url;
  }
}

async function request(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`Przekroczono czas połączenia: ${url}`)), opts.timeout || cfg.timeout);
  try {
    const res = await fetch(url, {
      method: opts.method || 'GET',
      headers: { 'User-Agent': UA, ...(opts.headers || {}) },
      body: opts.body,
      redirect: 'follow',
      signal: opts.signal ? AbortSignal.any([opts.signal, ctrl.signal]) : ctrl.signal,
    });
    if (!res.ok && !opts.allowStatus?.includes(res.status)) {
      const err = new HttpError(res.status, url);
      try { err.body = (await res.text()).slice(0, 2000); } catch {}
      throw err;
    }
    return res;
  } finally {
    clearTimeout(timer);
  }
}

const retriable = (e) => !(e instanceof HttpError) || e.status >= 500 || e.status === 429 || e.status === 408;

async function withRetry(fn, retries = cfg.retries, signal) {
  let last;
  for (let i = 0; i <= retries; i++) {
    if (signal?.aborted) throw signal.reason || new Error('Anulowano');
    try { return await fn(i); } catch (e) {
      last = e;
      if (signal?.aborted || !retriable(e) || i === retries) break;
      await sleep(400 * 2 ** i + Math.random() * 300);
    }
  }
  throw last;
}

async function json(url, opts = {}) {
  return withRetry(async () => {
    const res = await request(url, { ...opts, headers: { Accept: 'application/json', ...(opts.headers || {}) } });
    return res.json();
  }, opts.retries ?? cfg.retries, opts.signal);
}

async function text(url, opts = {}) {
  return withRetry(async () => (await request(url, opts)).text(), opts.retries ?? cfg.retries, opts.signal);
}

async function sha1File(file) {
  const h = crypto.createHash('sha1');
  await pipeline(fs.createReadStream(file), h);
  return h.digest('hex');
}

async function exists(p) {
  try { await fsp.access(p); return true; } catch { return false; }
}

/**
 * Czy plik jest już poprawny. Domyślnie szybka ścieżka – rozmiar; z verify=true liczymy SHA1.
 */
async function isValid(file, { sha1, size, verify }) {
  let st;
  try { st = await fsp.stat(file); } catch { return false; }
  if (!st.isFile()) return false;
  if (size != null && st.size !== size) return false;
  if (sha1 && (verify || size == null)) return (await sha1File(file)) === sha1.toLowerCase();
  return true;
}

/**
 * Pobiera plik atomowo (plik .part + rename), liczy SHA1 w locie.
 * @param {{url:string, file:string, sha1?:string, size?:number, verify?:boolean, onBytes?:(n:number)=>void, signal?:AbortSignal, headers?:object}} t
 */
async function download(t) {
  if (await isValid(t.file, t)) return false;
  await fsp.mkdir(path.dirname(t.file), { recursive: true });
  const urls = Array.isArray(t.url) ? t.url : [t.url];
  let lastErr;
  for (const url of urls) {
    try {
      await withRetry(async () => {
        const tmp = `${t.file}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.part`;
        let got = 0;
        try {
          const res = await request(url, { signal: t.signal, timeout: 60000, headers: t.headers });
          const hash = crypto.createHash('sha1');
          const body = Readable.fromWeb(res.body);
          body.on('data', (c) => { hash.update(c); got += c.length; t.onBytes?.(c.length); });
          await pipeline(body, fs.createWriteStream(tmp));
          const digest = hash.digest('hex');
          if (t.sha1 && digest !== t.sha1.toLowerCase()) throw Object.assign(new Error(`Błędna suma SHA1 pliku ${path.basename(t.file)} (pobrano uszkodzony plik)`), { status: 500 });
          if (t.size != null && got !== t.size) throw Object.assign(new Error(`Niepełny plik ${path.basename(t.file)} (${got}/${t.size} B)`), { status: 500 });
          await fsp.rename(tmp, t.file);
        } catch (e) {
          t.onBytes?.(-got);
          await fsp.rm(tmp, { force: true });
          throw e;
        }
      }, cfg.retries, t.signal);
      return true;
    } catch (e) { lastErr = e; if (t.signal?.aborted) break; }
  }
  throw lastErr;
}

/**
 * Pobiera wiele plików równolegle. Zwraca liczbę pobranych. Rzuca pierwszy błąd po zakończeniu reszty
 * (żeby nie zostawiać w połowie zapisanych plików).
 * @param {Array} tasks
 * @param {{onProgress?:(p:{done:number,total:number,bytes:number,totalBytes:number})=>void, signal?:AbortSignal, verify?:boolean, optional?:boolean}} o
 */
async function downloadAll(tasks, o = {}) {
  const total = tasks.length;
  const totalBytes = tasks.reduce((s, t) => s + (t.size || 0), 0);
  let done = 0; let bytes = 0; let fetched = 0; let i = 0;
  const errors = [];
  let lastEmit = 0;
  const emit = (force) => {
    const now = Date.now();
    if (!force && now - lastEmit < 100) return;
    lastEmit = now;
    o.onProgress?.({ done, total, bytes, totalBytes });
  };
  async function worker() {
    while (i < tasks.length) {
      if (o.signal?.aborted) return;
      const t = tasks[i++];
      try {
        if (await download({ ...t, verify: o.verify || t.verify, signal: o.signal, onBytes: (n) => { bytes += n; emit(); } })) fetched++;
        else bytes += t.size || 0;
      } catch (e) {
        if (t.optional) console.warn('[net] pominięto opcjonalny plik', t.url, e.message);
        else errors.push(e);
      }
      done++;
      emit();
    }
  }
  const n = Math.max(1, Math.min(cfg.concurrency, tasks.length));
  await Promise.all(Array.from({ length: n }, worker));
  emit(true);
  if (o.signal?.aborted) throw o.signal.reason || new Error('Anulowano');
  if (errors.length) {
    const e = errors[0];
    if (errors.length > 1) e.message += ` (i ${errors.length - 1} innych błędów pobierania)`;
    throw e;
  }
  return fetched;
}

module.exports = { cfg, UA, HttpError, request, json, text, download, downloadAll, sha1File, isValid, exists, sleep, withRetry };
