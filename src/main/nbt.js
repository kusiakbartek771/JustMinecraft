// Minimalny czytnik NBT (format zapisu Minecrafta) – level.dat i chunki z plików regionów.
const zlib = require('zlib');

function parse(buf) {
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
  else if (buf[0] === 0x78) buf = zlib.inflateSync(buf);
  let o = 0;
  const u8 = () => buf[o++];
  const i16 = () => { const v = buf.readInt16BE(o); o += 2; return v; };
  const u16 = () => { const v = buf.readUInt16BE(o); o += 2; return v; };
  const i32 = () => { const v = buf.readInt32BE(o); o += 4; return v; };
  const i64 = () => { const v = buf.readBigInt64BE(o); o += 8; return v; };
  const str = () => { const n = u16(); const s = buf.toString('utf8', o, o + n); o += n; return s; };
  function payload(t) {
    switch (t) {
      case 1: return buf.readInt8(o++);
      case 2: return i16();
      case 3: return i32();
      case 4: return i64();
      case 5: { const v = buf.readFloatBE(o); o += 4; return v; }
      case 6: { const v = buf.readDoubleBE(o); o += 8; return v; }
      case 7: { const n = i32(); const v = buf.subarray(o, o + n); o += n; return v; }
      case 8: return str();
      case 9: { const et = u8(); const n = i32(); const a = new Array(Math.max(0, n)); for (let i = 0; i < n; i++) a[i] = payload(et); return a; }
      case 10: { const obj = {}; for (;;) { const tt = u8(); if (tt === 0) break; const name = str(); obj[name] = payload(tt); } return obj; }
      case 11: { const n = i32(); const a = new Int32Array(n); for (let i = 0; i < n; i++) a[i] = i32(); return a; }
      case 12: { const n = i32(); const a = new BigInt64Array(n); for (let i = 0; i < n; i++) a[i] = i64(); return a; }
      default: throw new Error(`Nieznany znacznik NBT ${t}`);
    }
  }
  const t = u8();
  if (t !== 10) throw new Error('To nie jest plik NBT');
  str();
  return payload(10);
}

module.exports = { parse };
