// Konta: Microsoft (kod urządzenia → Xbox Live → XSTS → Minecraft) i konta offline.
// Tokeny są szyfrowane przez safeStorage (Keychain / DPAPI / libsecret), jeśli system to umożliwia.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, safeStorage } = require('electron');
const net = require('./core/net');

const file = () => path.join(app.getPath('userData'), 'accounts.json');
let data = null;

function enc(s) {
  if (!s) return s;
  try { if (safeStorage.isEncryptionAvailable()) return `enc:${safeStorage.encryptString(s).toString('base64')}`; } catch {}
  return `b64:${Buffer.from(s).toString('base64')}`;
}
function dec(s) {
  if (!s) return s;
  if (s.startsWith('enc:')) { try { return safeStorage.decryptString(Buffer.from(s.slice(4), 'base64')); } catch { return null; } }
  if (s.startsWith('b64:')) return Buffer.from(s.slice(4), 'base64').toString();
  return s;
}

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
const list = () => load().accounts.map(publicView);

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

// ---------- Microsoft ----------
const SCOPE = 'XboxLive.signin offline_access';

async function form(url, body) {
  const res = await net.request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(), allowStatus: [400, 401],
  });
  return res.json();
}

async function postJson(url, body, headers = {}) {
  const res = await net.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers }, body: JSON.stringify(body), allowStatus: [401, 403] });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.errorMessage || j.Message || `HTTP ${res.status}`), { status: res.status, body: j });
  return j;
}

/** Krok 1: kod urządzenia – użytkownik wpisuje go na microsoft.com/link */
async function startDeviceCode(clientId) {
  if (!clientId) throw new Error('Logowanie Microsoft wymaga „Client ID” aplikacji Azure (Ustawienia → Zaawansowane). Instrukcja jest w README.');
  const r = await form('https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode', { client_id: clientId, scope: SCOPE });
  if (r.error) throw new Error(r.error_description || r.error);
  return { userCode: r.user_code, verificationUri: r.verification_uri, deviceCode: r.device_code, interval: r.interval || 5, expiresIn: r.expires_in };
}

/** Krok 2: czeka, aż użytkownik się zaloguje. */
async function pollDeviceCode(clientId, deviceCode, interval, signal) {
  let wait = interval * 1000;
  for (;;) {
    if (signal?.aborted) throw new Error('Anulowano logowanie');
    await net.sleep(wait);
    const r = await form('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: deviceCode,
    });
    if (r.access_token) return r;
    if (r.error === 'authorization_pending') continue;
    if (r.error === 'slow_down') { wait += 5000; continue; }
    if (r.error === 'expired_token') throw new Error('Kod wygasł – spróbuj ponownie');
    if (r.error === 'authorization_declined') throw new Error('Odmówiono dostępu');
    throw new Error(r.error_description || r.error || 'Logowanie nie powiodło się');
  }
}

async function minecraftFromMsToken(msAccess) {
  const xbl = await postJson('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccess}` },
    RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT',
  });
  let xsts;
  try {
    xsts = await postJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] }, RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT',
    });
  } catch (e) {
    const code = e.body?.XErr;
    const msg = { 2148916233: 'To konto Microsoft nie ma profilu Xbox – zaloguj się raz na xbox.com i spróbuj ponownie.', 2148916235: 'Xbox Live nie jest dostępny w Twoim kraju.', 2148916238: 'Konto dziecka – dodaj je do rodziny Microsoft, aby grać.' }[code];
    throw new Error(msg || `Błąd Xbox Live (${code || e.message})`);
  }
  const uhs = xsts.DisplayClaims.xui[0].uhs;
  let mcAuth;
  try {
    mcAuth = await postJson('https://api.minecraftservices.com/authentication/login_with_xbox', { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` });
  } catch (e) {
    if (e.status === 403) throw new Error('Minecraft odrzucił logowanie: ta aplikacja Azure nie ma jeszcze zgody Mojang na dostęp do API Minecrafta (formularz: aka.ms/mce-reviewappid).');
    throw e;
  }
  const profRes = await net.request('https://api.minecraftservices.com/minecraft/profile', { headers: { Authorization: `Bearer ${mcAuth.access_token}` }, allowStatus: [404] });
  if (profRes.status === 404) throw new Error('To konto nie ma kupionego Minecraft: Java Edition (albo nie ma jeszcze utworzonego profilu – uruchom raz oficjalny launcher).');
  const profile = await profRes.json();
  const skin = profile.skins?.find((s) => s.state === 'ACTIVE')?.url || null;
  const xuid = JSON.parse(Buffer.from(mcAuth.access_token.split('.')[1] || '', 'base64').toString() || '{}').xuid || '';
  return { name: profile.name, uuid: profile.id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5'), accessToken: mcAuth.access_token, expiresAt: Date.now() + (mcAuth.expires_in - 120) * 1000, skin, xuid };
}

async function finishMicrosoft(clientId, tokenResponse) {
  const mc = await minecraftFromMsToken(tokenResponse.access_token);
  const d = load();
  let acc = d.accounts.find((a) => a.type === 'msa' && a.uuid === mc.uuid);
  if (!acc) { acc = { id: crypto.randomUUID(), type: 'msa', added: Date.now() }; d.accounts.push(acc); }
  Object.assign(acc, { name: mc.name, uuid: mc.uuid, skin: mc.skin, xuid: mc.xuid, clientId, refresh: enc(tokenResponse.refresh_token), mcToken: enc(mc.accessToken), expiresAt: mc.expiresAt, expired: false });
  save();
  return publicView(acc);
}

/** Dane do uruchomienia gry (odświeża token Microsoft w razie potrzeby). */
async function forLaunch(id, clientIdFallback) {
  const d = load();
  const acc = d.accounts.find((a) => a.id === id) || d.accounts[0];
  if (!acc) throw new Error('Dodaj konto (lewy dolny róg → Konta), aby grać');
  if (acc.type === 'offline') return { type: 'offline', name: acc.name, uuid: acc.uuid, accessToken: null };
  let token = dec(acc.mcToken);
  if (!token || Date.now() > (acc.expiresAt || 0)) {
    const clientId = acc.clientId || clientIdFallback;
    const refresh = dec(acc.refresh);
    if (!refresh || !clientId) { acc.expired = true; save(); throw new Error('Sesja Microsoft wygasła – zaloguj się ponownie (Konta)'); }
    const r = await form('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', { grant_type: 'refresh_token', client_id: clientId, refresh_token: refresh, scope: SCOPE });
    if (!r.access_token) { acc.expired = true; save(); throw new Error('Sesja Microsoft wygasła – zaloguj się ponownie (Konta)'); }
    const mc = await minecraftFromMsToken(r.access_token);
    Object.assign(acc, { name: mc.name, skin: mc.skin, xuid: mc.xuid, refresh: enc(r.refresh_token || refresh), mcToken: enc(mc.accessToken), expiresAt: mc.expiresAt, expired: false });
    save();
    token = mc.accessToken;
  }
  return { type: 'msa', name: acc.name, uuid: acc.uuid, accessToken: token, xuid: acc.xuid, clientId: acc.clientId };
}

module.exports = { list, addOffline, remove, startDeviceCode, pollDeviceCode, finishMicrosoft, forLaunch, offlineUuid };
