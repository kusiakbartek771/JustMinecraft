// Test rdzenia bez GUI: instaluje wersję/loader i (opcjonalnie) uruchamia grę aż do wczytania okna.
// Użycie: node scripts/test-install.mjs <loader> <mc> [--launch] [--root dir]
import { createRequire } from 'module';
import path from 'path';
import crypto from 'crypto';
const require = createRequire(import.meta.url);
const launch = require('../src/main/core/launch.js');

const [loader = 'vanilla', mcv = '1.21.1', ...rest] = process.argv.slice(2);
const root = path.resolve(rest.includes('--root') ? rest[rest.indexOf('--root') + 1] : 'test-data');
const doLaunch = rest.includes('--launch');
const instance = { id: `test-${loader}-${mcv}`, dir: path.join(root, 'instances', `test-${loader}-${mcv}`), loader, mc: mcv, memory: { min: 512, max: 2048 } };
const account = { name: 'Tester', uuid: crypto.randomUUID(), type: 'offline' };
let last = '';
const ctx = {
  onStatus: (s) => { if (s !== last) { last = s; console.log('•', s); } },
  onProgress: () => {},
  onVersionId: (id) => { instance.versionId = id; },
};
const t0 = Date.now();
try {
  if (!doLaunch) {
    const p = await launch.prepare({ root, instance, account, ctx });
    console.log('OK', p.versionId, 'java', p.javaExe, `${((Date.now() - t0) / 1000).toFixed(1)}s`);
    console.log(launch.buildArgs(p, { root, instance, account }).slice(-12).join(' '));
  } else {
    let ok = false;
    await launch.launch({ root, instance, account, ctx }, {
      onLog: (l) => {
        if (process.env.VERBOSE) console.log('  |', l);
        if (!ok && /Backend library|Sound engine started|OpenAL initialized|Created: \d+x\d+x\d+/.test(l)) {
          ok = true;
          console.log('GAME OK:', l.trim().slice(0, 160), `${((Date.now() - t0) / 1000).toFixed(1)}s`);
          setTimeout(() => launch.kill(instance.id), 1500);
        }
      },
      onExit: (e) => {
        if (!ok) { console.log('GAME FAILED code', e.code); console.log(e.tail.slice(-40).join('\n')); process.exitCode = 1; }
      },
    });
    setTimeout(() => { if (!ok) { console.log('TIMEOUT'); launch.kill(instance.id); process.exitCode = 1; } }, 240000).unref();
  }
} catch (e) {
  console.error('ERROR', e.stack || e.message);
  process.exitCode = 1;
}
