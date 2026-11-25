// Test zawartości bez GUI: Modrinth (mod + zależności, shader, resource pack, datapack), lista, aktualizacje, .mrpack.
import { createRequire } from 'module';
import path from 'path';
import fs from 'fs';
const require = createRequire(import.meta.url);
const modrinth = require('../src/main/modrinth.js');
const content = require('../src/main/content.js');
const drive = require('../src/main/drive.js');

const root = path.resolve('test-data/content-test');
fs.rmSync(root, { recursive: true, force: true });
const inst = { id: 'x', dir: path.join(root, 'inst'), mc: '1.21.1', loader: 'fabric' };
fs.mkdirSync(inst.dir, { recursive: true });
const log = (...a) => console.log('•', ...a);

let r = await modrinth.install({ inst, projectId: 'sodium-extra', type: 'mod', onStatus: () => {} });
log('sodium-extra + deps:', r.map((x) => x.title).join(', '));
r = await modrinth.install({ inst, projectId: 'complementary-reimagined', type: 'shader' });
log('shader:', r.map((x) => x.file).join(', '));
r = await modrinth.install({ inst, projectId: 'fresh-animations', type: 'resourcepack' });
log('resourcepack:', r.map((x) => x.file).join(', '));
r = await modrinth.install({ inst, projectId: 'terralith', type: 'datapack', world: '*' });
log('datapack (global):', r.map((x) => x.file).join(', '));

const mods = await content.list(inst, 'mod');
log('mods listed:', mods.map((m) => `${m.name} ${m.version} [${m.modId}] icon:${!!m.icon}`).join(' | '));
// starsza wersja Sodium → sprawdzenie aktualizacji
const old = (await modrinth.versions('sodium', { mc: '1.21.1', loader: 'fabric', type: 'mod' })).at(-1);
await modrinth.install({ inst, projectId: 'sodium', versionId: old.id, type: 'mod', deps: false });
const mods2 = await content.list(inst, 'mod');
log('sodium after downgrade:', mods2.filter((m) => /sodium/i.test(m.file)).map((m) => m.file).join(', '));
const ups = await modrinth.checkUpdates(inst, mods2, 'mod');
log('updates found:', Object.values(ups).map((u) => u.number).join(', ') || 'none');
// ręcznie dodany plik → identyfikacja po SHA1
const lith = (await modrinth.versions('lithium', { mc: '1.21.1', loader: 'fabric', type: 'mod' }))[0].files[0];
const net = require('../src/main/core/net.js');
await net.download({ url: lith.url, file: path.join(inst.dir, 'mods', lith.filename), sha1: lith.sha1 });
const n = await modrinth.identify(inst, await content.list(inst, 'mod'));
log('identified manual files:', n);
// toggle
const f = (await content.list(inst, 'mod'))[0];
const nf = await content.setEnabled(inst, 'mod', null, f.file, false);
log('disabled ->', nf, (await content.list(inst, 'mod')).find((m) => m.file === nf)?.enabled === false ? 'OK' : 'FAIL');
// global datapacks sync into a fake world
fs.mkdirSync(path.join(inst.dir, 'saves', 'Swiat', 'datapacks'), { recursive: true });
fs.writeFileSync(path.join(inst.dir, 'saves', 'Swiat', 'level.dat'), 'x');
log('global datapacks copied:', await drive.syncGlobalDatapacks(inst));
// detectKind
for (const dir of ['shaderpacks', 'resourcepacks', 'datapacks']) {
  for (const file of fs.readdirSync(path.join(inst.dir, dir))) log(`detectKind ${dir}/${file}:`, await content.detectKind(path.join(inst.dir, dir, file)));
}
// mrpack
const packV = (await modrinth.versions('fabulously-optimized', { mc: '1.21.1' }))[0];
const { file } = await modrinth.downloadPackVersion(packV.id, path.join(root, 'cache'));
const info = await modrinth.readMrpack(file);
log('mrpack:', info.name, info.mc, info.loader, info.loaderVersion);
const inst2 = { id: 'y', dir: path.join(root, 'pack'), mc: info.mc, loader: info.loader };
const cnt = await modrinth.applyMrpack(inst2, file, { onStatus: () => {} });
log('mrpack files:', cnt, 'mods dir:', fs.readdirSync(path.join(inst2.dir, 'mods')).length, 'config:', fs.existsSync(path.join(inst2.dir, 'config')));
// Drive link parsing
log('drive parse:', JSON.stringify(drive.parseLink('https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUv?usp=sharing')), JSON.stringify(drive.parseLink('https://drive.google.com/file/d/1ZyXwVuTsRqPoNmLkJiHg/view')));
