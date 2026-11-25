// JustHUD – widżety w grze (JustMusic, wytrzymałość zbroi, współrzędne, FPS, zegar), wbudowane w launcher.
// Jary leżą w assets/justhud/ (budowane z mod/ – python3 mod/build.py). Przy starcie gry launcher dokłada właściwy
// plik do mods/ albo go usuwa, gdy JustHUD jest wyłączony w instancji.
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const DIR = path.join(__dirname, '..', '..', 'assets', 'justhud');
const PREFIX = 'justhud-';

function index() {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, 'index.json'), 'utf8')); } catch { return { version: null, jars: [] }; }
}

const parts = (v) => String(v).split(/[.\-+ ]/).map((x) => parseInt(x, 10) || 0);
function cmp(a, b) {
  const A = parts(a), B = parts(b);
  for (let i = 0; i < Math.max(A.length, B.length); i++) { const d = (A[i] || 0) - (B[i] || 0); if (d) return d; }
  return 0;
}

/** Jar dla wersji gry i loadera (Quilt używa wersji Fabric, NeoForge 1.20.1 – wersji Forge). */
function pick(mc, loader) {
  const jars = index().jars || [];
  const fits = (j) => cmp(mc, j.min) >= 0 && cmp(mc, j.max) < 0;
  const order = loader === 'quilt' ? ['fabric'] : loader === 'neoforge' ? ['neoforge', 'forge'] : [loader];
  for (const l of order) { const j = jars.find((x) => x.loader === l && fits(x)); if (j) return j; }
  return null;
}

/** Czy JustHUD może działać w tej instancji (i dlaczego nie). */
function support(inst) {
  if (!inst || inst.loader === 'vanilla') return { ok: false, reason: 'JustHUD wymaga loadera (Fabric, Quilt, Forge albo NeoForge).' };
  const j = pick(inst.mc, inst.loader);
  if (!j) return { ok: false, reason: `JustHUD nie ma jeszcze wersji dla Minecrafta ${inst.mc} (${inst.loader}).` };
  return { ok: true, jar: j };
}

/** Dokłada albo usuwa JustHUD w folderze mods/ instancji. Zwraca nazwę pliku albo null. */
async function sync(inst, enabled) {
  const mods = path.join(inst.dir, 'mods');
  const s = support(inst);
  const want = enabled && s.ok ? s.jar.file : null;
  let have = [];
  try { have = (await fsp.readdir(mods)).filter((f) => f.startsWith(PREFIX) && /\.jar(\.disabled)?$/.test(f)); } catch {}
  for (const f of have) if (f !== want) await fsp.rm(path.join(mods, f), { force: true });
  if (!want) return null;
  const src = await fsp.readFile(path.join(DIR, want));
  const cur = have.includes(want) ? await fsp.readFile(path.join(mods, want)).catch(() => null) : null;
  if (!cur || !cur.equals(src)) {
    await fsp.mkdir(mods, { recursive: true });
    await fsp.writeFile(path.join(mods, want), src);
  }
  return want;
}

const isJustHud = (file) => path.basename(file).startsWith(PREFIX);

module.exports = { pick, support, sync, index, isJustHud, cmp };
