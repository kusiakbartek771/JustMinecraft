// Zapis archiwów ZIP (deflate) bez zewnętrznych bibliotek – kopie światów i eksport instancji.
// Pliki są czytane i kompresowane po kolei, więc pamięć zależy od największego pliku, a nie od całego archiwum.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const zlib = require('zlib');

const crc32 = zlib.crc32 || ((buf) => {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
});

function dosTime(d) {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

class ZipWriter {
  constructor(file) {
    this.file = file;
    this.tmp = `${file}.${process.pid}.part`;
    this.fd = null;
    this.offset = 0;
    this.entries = [];
  }

  async open() {
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    this.fd = await fsp.open(this.tmp, 'w');
    return this;
  }

  async write(buf) { await this.fd.write(buf); this.offset += buf.length; }

  /** Dodaje plik z bufora. name = ścieżka w archiwum (z „/”). */
  async add(name, data, mtime = new Date()) {
    name = name.replace(/\\/g, '/');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    // małe lub już skompresowane pliki zapisujemy bez kompresji
    const store = data.length < 64 || /\.(png|jpg|jpeg|ogg|zip|jar|gz|mca)$/i.test(name);
    const body = store ? data : zlib.deflateRawSync(data, { level: 6 });
    const method = store ? 0 : 8;
    const { time, date } = dosTime(mtime);
    if (data.length >= 0xffffffff || this.offset >= 0xffffffff) throw new Error('Archiwum przekracza 4 GB – za duże dla tego formatu.');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(method, 8);
    h.writeUInt16LE(time, 10); h.writeUInt16LE(date, 12); h.writeUInt32LE(crc, 14); h.writeUInt32LE(body.length, 18);
    h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nameBuf.length, 26); h.writeUInt16LE(0, 28);
    this.entries.push({ nameBuf, crc, csize: body.length, size: data.length, method, time, date, offset: this.offset });
    await this.write(h); await this.write(nameBuf); await this.write(body);
  }

  async addFile(name, file) {
    const st = await fsp.stat(file);
    await this.add(name, await fsp.readFile(file), st.mtime);
  }

  /** Dodaje folder rekurencyjnie (prefix = ścieżka w archiwum). filter(rel) może pominąć plik. */
  async addDir(prefix, dir, filter = () => true, onFile) {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (!filter(rel, e)) continue;
      if (e.isDirectory()) await this.addDir(rel, full, filter, onFile);
      else if (e.isFile()) {
        try { await this.addFile(rel, full); onFile?.(rel); } catch (err) { if (err.code !== 'EBUSY' && err.code !== 'ENOENT') throw err; }
      }
    }
  }

  async close() {
    const start = this.offset;
    for (const e of this.entries) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(e.method, 10);
      c.writeUInt16LE(e.time, 12); c.writeUInt16LE(e.date, 14); c.writeUInt32LE(e.crc, 16); c.writeUInt32LE(e.csize, 20); c.writeUInt32LE(e.size, 24);
      c.writeUInt16LE(e.nameBuf.length, 28); c.writeUInt32LE(e.offset, 42);
      await this.write(c); await this.write(e.nameBuf);
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(this.entries.length, 8); end.writeUInt16LE(this.entries.length, 10);
    end.writeUInt32LE(this.offset - start, 12); end.writeUInt32LE(start, 16);
    await this.write(end);
    await this.fd.close();
    await fsp.rename(this.tmp, this.file);
  }

  async abort() {
    try { await this.fd?.close(); } catch {}
    await fsp.rm(this.tmp, { force: true });
  }
}

async function zipDir(file, dir, o = {}) {
  const z = await new ZipWriter(file).open();
  try {
    await z.addDir(o.prefix || '', dir, o.filter, o.onFile);
    await z.close();
  } catch (e) { await z.abort(); throw e; }
}

module.exports = { ZipWriter, zipDir };
