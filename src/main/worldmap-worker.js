// Wątek rysujący mapę świata z plików regionów (.mca) – 1 piksel = 1 blok, widok z góry z cieniowaniem wysokości.
// Uruchamiany jako new Worker(kod, { eval: true }) – plik jest samowystarczalny (działa też z archiwum asar).
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function parseNbt(buf) {
  let o = 0;
  const u8 = () => buf[o++];
  const i32 = () => { const v = buf.readInt32BE(o); o += 4; return v; };
  const u16 = () => { const v = buf.readUInt16BE(o); o += 2; return v; };
  const str = () => { const n = u16(); const s = buf.toString('utf8', o, o + n); o += n; return s; };
  function payload(t) {
    switch (t) {
      case 1: return buf.readInt8(o++);
      case 2: { const v = buf.readInt16BE(o); o += 2; return v; }
      case 3: return i32();
      case 4: { const v = buf.readBigInt64BE(o); o += 8; return v; }
      case 5: { o += 4; return 0; }
      case 6: { o += 8; return 0; }
      case 7: { const n = i32(); o += n; return null; }
      case 8: return str();
      case 9: { const et = u8(); const n = i32(); const a = new Array(Math.max(0, n)); for (let i = 0; i < n; i++) a[i] = payload(et); return a; }
      case 10: { const obj = {}; for (;;) { const tt = u8(); if (tt === 0) break; const name = str(); obj[name] = payload(tt); } return obj; }
      case 11: { const n = i32(); o += n * 4; return null; }
      case 12: { const n = i32(); const a = new BigInt64Array(n); for (let i = 0; i < n; i++) { a[i] = buf.readBigInt64BE(o); o += 8; } return a; }
      default: throw new Error('nbt ' + t);
    }
  }
  if (u8() !== 10) return null;
  str();
  return payload(10);
}

// kolory bloków (wybrane) + reguły dla reszty
const COLORS = {
  grass_block: [109, 153, 64], water: [52, 92, 196], sand: [219, 207, 163], red_sand: [190, 102, 33], snow: [248, 248, 248], snow_block: [248, 248, 248],
  ice: [160, 190, 245], packed_ice: [141, 180, 250], blue_ice: [116, 167, 253], stone: [125, 125, 125], deepslate: [80, 80, 82], gravel: [136, 126, 126],
  dirt: [134, 96, 67], coarse_dirt: [119, 85, 59], podzol: [91, 63, 24], mycelium: [111, 99, 105], clay: [160, 166, 179], lava: [207, 92, 15],
  netherrack: [111, 54, 52], soul_sand: [81, 62, 50], soul_soil: [75, 57, 46], basalt: [80, 80, 86], blackstone: [42, 35, 40], end_stone: [219, 222, 158],
  terracotta: [152, 94, 67], mud: [60, 57, 61], moss_block: [89, 109, 45], calcite: [223, 224, 220], tuff: [108, 109, 102], andesite: [136, 136, 136],
  diorite: [188, 188, 188], granite: [149, 103, 85], obsidian: [20, 18, 30], bedrock: [85, 85, 85], farmland: [143, 102, 70], dirt_path: [148, 122, 65],
  oak_planks: [162, 130, 78], cobblestone: [122, 122, 122], glass: [200, 220, 230], white_wool: [233, 236, 236], crimson_nylium: [130, 31, 31], warped_nylium: [43, 114, 101],
};
const RULES = [
  [/leaves/, [60, 110, 40]], [/log|wood|stem/, [102, 81, 49]], [/planks|fence|door|stairs|slab/, [160, 128, 80]], [/water|kelp|seagrass/, [52, 92, 196]],
  [/lava|magma/, [207, 92, 15]], [/snow|powder_snow/, [248, 248, 248]], [/ice/, [150, 185, 245]], [/sand/, [219, 207, 163]], [/terracotta/, [152, 94, 67]],
  [/deepslate/, [80, 80, 82]], [/stone|cobble|brick|ore/, [125, 125, 125]], [/grass|fern|flower|tulip|poppy|dandelion|bush|vine|lily|sapling|azalea/, [92, 140, 52]],
  [/wool|carpet|concrete/, [200, 200, 200]], [/nether/, [111, 54, 52]], [/mushroom/, [150, 110, 90]], [/glass/, [200, 220, 230]],
];
const cache = new Map();
function colorOf(name) {
  let c = cache.get(name);
  if (c) return c;
  const n = name.replace(/^[a-z0-9_.-]+:/, '');
  c = COLORS[n] || (RULES.find(([re]) => re.test(n)) || [null, [128, 128, 128]])[1];
  cache.set(name, c);
  return c;
}
const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);
const TRANSPARENT = /^(minecraft:)?(short_grass|grass|tall_grass|fern|large_fern|dead_bush|torch|wall_torch|snow|vine|glow_lichen|seagrass|tall_seagrass|kelp|kelp_plant|bubble_column|sugar_cane|.*_flower|dandelion|poppy|.*_tulip|cornflower|oxeye_daisy|azure_bluet|allium|blue_orchid|lily_of_the_valley|.*_button|.*_pressure_plate|rail|.*_rail|redstone_wire|tripwire|.*_carpet|light)$/;

// odczyt wartości z tablicy upakowanej (1.16+: wpisy nie przechodzą między longami)
function packed(data, bits, index, spanning) {
  if (!data) return 0;
  if (spanning) {
    const bit = index * bits, li = Math.floor(bit / 64), off = bit % 64;
    let v = data[li] >> BigInt(off);
    if (off + bits > 64 && li + 1 < data.length) v |= data[li + 1] << BigInt(64 - off);
    return Number(BigInt.asUintN(bits, v));
  }
  const per = Math.floor(64 / bits);
  const li = Math.floor(index / per), off = (index % per) * bits;
  if (li >= data.length) return 0;
  return Number(BigInt.asUintN(bits, data[li] >> BigInt(off)));
}

function chunkColumns(chunk, out, ox, oz, W) {
  const level = chunk.Level || chunk; // 1.18+: dane w korzeniu
  const sectionsRaw = level.sections || level.Sections || [];
  const sections = new Map();
  for (const s of sectionsRaw) {
    let palette, data;
    if (s.block_states) { palette = s.block_states.palette; data = s.block_states.data; } else { palette = s.Palette; data = s.BlockStates; }
    if (!palette || !palette.length) continue;
    const names = palette.map((p) => p.Name);
    sections.set(s.Y, { names, data, bits: Math.max(4, Math.ceil(Math.log2(names.length))) });
  }
  const dv = Number(chunk.DataVersion || 0);
  const spanning = dv > 0 && dv < 2556; // przed 1.16
  const ys = [...sections.keys()].sort((a, b) => b - a);
  for (let z = 0; z < 16; z++) {
    for (let x = 0; x < 16; x++) {
      let found = null, y = 0, water = 0;
      for (const sy of ys) {
        const s = sections.get(sy);
        for (let ly = 15; ly >= 0; ly--) {
          const idx = (ly * 16 + z) * 16 + x;
          const name = s.names.length === 1 ? s.names[0] : s.names[packed(s.data, s.bits, idx, spanning)] || 'minecraft:air';
          if (AIR.has(name) || TRANSPARENT.test(name)) continue;
          if (/water|bubble_column/.test(name)) { if (!water) { water = 1; y = sy * 16 + ly; } else water++; if (water < 12) continue; }
          found = name; if (!water) y = sy * 16 + ly; break;
        }
        if (found) break;
      }
      const p = ((oz + z) * W + (ox + x)) * 4;
      if (!found && !water) continue;
      let c = colorOf(found || 'minecraft:water');
      if (water) { const k = Math.min(1, water / 12); c = [52 * (1 - k * 0.4), 92 * (1 - k * 0.4), 196 * (1 - k * 0.25)]; }
      out.rgb[p] = c[0]; out.rgb[p + 1] = c[1]; out.rgb[p + 2] = c[2]; out.rgb[p + 3] = 255;
      out.h[(oz + z) * W + (ox + x)] = y;
    }
  }
}

function region(file, out, ox, oz, W) {
  let buf;
  try { buf = fs.readFileSync(file); } catch { return 0; }
  if (buf.length < 8192) return 0;
  let n = 0;
  for (let i = 0; i < 1024; i++) {
    const loc = buf.readUInt32BE(i * 4);
    const off = (loc >>> 8) * 4096;
    if (!off || off + 5 > buf.length) continue;
    const len = buf.readUInt32BE(off);
    const comp = buf[off + 4];
    if (comp & 0x80) continue; // chunk w osobnym pliku .mcc – pomijamy
    try {
      const raw = buf.subarray(off + 5, off + 4 + len);
      const data = comp === 1 ? zlib.gunzipSync(raw) : comp === 2 ? zlib.inflateSync(raw) : comp === 3 ? raw : null;
      if (!data) continue;
      const chunk = parseNbt(data);
      if (!chunk) continue;
      const lvl = chunk.Level || chunk;
      const status = String(lvl.Status || lvl.status || 'full').replace('minecraft:', '');
      if (!/full|spawn|light|heightmaps|features/.test(status)) continue;
      chunkColumns(chunk, out, ox + (i % 32) * 16, oz + Math.floor(i / 32) * 16, W);
      n++;
    } catch { /* uszkodzony chunk – pomijamy */ }
  }
  return n;
}

// ---- główna praca ----
const { dir, centerX, centerZ, maxRegions } = workerData;
let files = [];
try { files = fs.readdirSync(dir).filter((f) => /^r\.-?\d+\.-?\d+\.mca$/.test(f)); } catch {}
const regs = files.map((f) => { const m = f.match(/^r\.(-?\d+)\.(-?\d+)\.mca$/); return { f, x: +m[1], z: +m[2] }; })
  .filter((r) => fs.statSync(path.join(dir, r.f)).size > 8192);
const cx = Math.floor(centerX / 512), cz = Math.floor(centerZ / 512);
regs.sort((a, b) => Math.hypot(a.x - cx, a.z - cz) - Math.hypot(b.x - cx, b.z - cz));
const pick = regs.slice(0, maxRegions);
if (!pick.length) { parentPort.postMessage({ empty: true }); process.exit(0); }
const minX = Math.min(...pick.map((r) => r.x)), maxX = Math.max(...pick.map((r) => r.x));
const minZ = Math.min(...pick.map((r) => r.z)), maxZ = Math.max(...pick.map((r) => r.z));
const W = (maxX - minX + 1) * 512, H = (maxZ - minZ + 1) * 512;
const out = { rgb: new Uint8ClampedArray(W * H * 4), h: new Int16Array(W * H).fill(-32768) };
let chunks = 0, done = 0;
for (const r of pick) {
  chunks += region(path.join(dir, r.f), out, (r.x - minX) * 512, (r.z - minZ) * 512, W);
  parentPort.postMessage({ progress: ++done / pick.length });
}
// cieniowanie rzeźby terenu (porównanie z sąsiadem od północy i zachodu)
for (let z = 1; z < H; z++) {
  for (let x = 1; x < W; x++) {
    const i = z * W + x;
    if (out.h[i] === -32768) continue;
    const n = out.h[i - W] === -32768 ? out.h[i] : out.h[i - W], w = out.h[i - 1] === -32768 ? out.h[i] : out.h[i - 1];
    const d = (out.h[i] - n) + (out.h[i] - w) * 0.5;
    const k = d > 0 ? 1.12 : d < 0 ? 0.86 : 1;
    const p = i * 4;
    out.rgb[p] *= k; out.rgb[p + 1] *= k; out.rgb[p + 2] *= k;
  }
}
// BGRA dla nativeImage.createFromBitmap
const bgra = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) {
  const p = i * 4;
  if (!out.rgb[p + 3]) { bgra[p] = 0x12; bgra[p + 1] = 0x0e; bgra[p + 2] = 0x0d; bgra[p + 3] = 255; continue; }
  bgra[p] = out.rgb[p + 2]; bgra[p + 1] = out.rgb[p + 1]; bgra[p + 2] = out.rgb[p]; bgra[p + 3] = 255;
}
parentPort.postMessage({ width: W, height: H, minX: minX * 512, minZ: minZ * 512, chunks, regions: pick.length, totalRegions: regs.length, bgra }, [bgra.buffer]);
