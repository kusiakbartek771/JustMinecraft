// Test JustHUD w prawdziwej grze: instaluje loader, dokłada jar JustHUD, uruchamia grę z -Djusthud.selftest=true
// (mod sam otwiera edytor na ekranie tytułowym i po chwili zamyka grę) i robi zrzut okna gry.
// Użycie: node scripts/test-justhud.mjs <loader> <mc> [zrzut.png]
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
import fs from 'fs';
const require = createRequire(import.meta.url);
const launch = require('../src/main/core/launch.js');
const justhud = require('../src/main/justhud.js');

const [loader = 'fabric', mcv = '1.21.1', shot] = process.argv.slice(2);
const root = path.resolve('test-data');
const instance = {
  id: `hud-${loader}-${mcv}`, dir: path.join(root, 'instances', `hud-${loader}-${mcv}`), loader, mc: mcv,
  memory: { min: 512, max: 3072 }, jvmArgs: '-Djusthud.selftest=true -Djusthud.selftestMs=9000',
};
const account = { name: 'Tester', uuid: crypto.randomUUID(), type: 'offline' };
const ctx = { onStatus: (s) => console.log('•', s), onProgress: () => {}, onVersionId: (id) => { instance.versionId = id; } };

const jar = await justhud.sync(instance, true);
console.log('JustHUD:', jar);
if (!jar) { console.log('brak jara dla', loader, mcv); process.exit(1); }

let opened = false, ok = false, crashed = false;
const errors = [];
const t0 = Date.now();
await launch.launch({ root, instance, account, ctx }, {
  onLog: (l) => {
    if (process.env.VERBOSE) console.log('  |', l);
    if (/JustHUD|justhud/.test(l) && /(Exception|Error|Błąd)/.test(l)) errors.push(l.trim());
    if (/\[JustHUD\] start/.test(l)) console.log('mod wczytany', `${((Date.now() - t0) / 1000).toFixed(1)}s`);
    if (!opened && /selftest: edytor otwarty/.test(l)) {
      opened = true;
      console.log('edytor otwarty', `${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
    if (/selftest: zrzut/.test(l)) console.log(l.trim().slice(0, 200));
    if (/selftest: OK/.test(l)) ok = true;
  },
  onExit: (e) => {
    crashed = e.crashed;
    console.log(ok && !crashed ? 'JUSTHUD OK' : 'JUSTHUD FAILED', 'kod', e.code);
    if (!ok || crashed) console.log(e.tail.slice(-40).join('\n'));
    if (errors.length) console.log('Błędy JustHUD w logu:\n' + errors.slice(0, 10).join('\n'));
    if (shot) {
      const dir = path.join(instance.dir, 'screenshots');
      const last = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] : null;
      if (last) { fs.copyFileSync(last, shot); console.log('zrzut:', shot); } else console.log('brak zrzutu');
    }
    process.exitCode = ok && !crashed && !errors.length ? 0 : 1;
  },
});
setTimeout(() => { if (!ok) { console.log('TIMEOUT'); launch.kill(instance.id); process.exitCode = 1; } }, 300000).unref();
