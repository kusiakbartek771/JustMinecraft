// Konta offline (nick + UUID jak w Javie). Logowanie Microsoft usunięte w 1.1.1.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const file = () => path.join(app.getPath('userData'), 'accounts.json');
let data = null;

function load() {
  if (data) return data;
  try { data = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch { data = { accounts: [] }; }
  return data;
}
function save() {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(`${file()}.tmp`, JSON.stringify(data, null, 2));
  fs.renameSync(`${file()}.tmp`, file());
}

const publicView = (a) => ({ id: a.id, type: a.type, name: a.name, uuid: a.uuid, skin: a.skin || null, added: a.added, expired: !!a.expired });
const list = () => load().accounts.filter((a) => a.type === 'offline').map(publicView);

/** UUID offline jak w Javie: UUID.nameUUIDFromBytes("OfflinePlayer:" + nick) */
function offlineUuid(name) {
  const h = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x30;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

function addOffline(name) {
  name = String(name || '').trim();
  if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) throw new Error('Nick: 3–16 znaków, tylko litery, cyfry i _');
  const d = load();
  const ex = d.accounts.find((a) => a.type === 'offline' && a.name.toLowerCase() === name.toLowerCase());
  if (ex) return publicView(ex);
  const acc = { id: crypto.randomUUID(), type: 'offline', name, uuid: offlineUuid(name), added: Date.now() };
  d.accounts.push(acc);
  save();
  return publicView(acc);
}

function remove(id) {
  const d = load();
  d.accounts = d.accounts.filter((a) => a.id !== id);
  save();
}

/** Dane do uruchomienia gry (odświeża token Microsoft w razie potrzeby). */
async function forLaunch(id) {
  const d = load();
  const acc = d.accounts.find((a) => a.id === id && a.type === 'offline') || d.accounts.find((a) => a.type === 'offline');
  if (!acc) throw new Error('Dodaj konto (lewy dolny róg → Konta), aby grać');
  return { type: 'offline', name: acc.name, uuid: acc.uuid, accessToken: null };
}

module.exports = { list, addOffline, remove, forLaunch, offlineUuid };
