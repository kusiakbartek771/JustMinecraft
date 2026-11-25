// Stan aplikacji w interfejsie + prosta szyna zdarzeń.
export async function api(ch, ...args) {
  const r = await window.jl.invokeRaw(ch, ...args);
  if (!r.ok) {
    const e = new Error(r.error);
    if (r.code !== undefined) e.code = r.code;
    if (r.url) e.url = r.url;
    throw e;
  }
  return r.data;
}

export const S = {
  info: null,
  settings: null,
  instances: [],
  accounts: [],
  selectedAccount: null,
  tasks: new Map(),
  running: new Set(),
  logs: new Map(), // instanceId -> [linie]
  jm: { connected: false, state: null },
  update: null,
  versions: null,
};

const listeners = new Map();
export function on(ev, fn) {
  if (!listeners.has(ev)) listeners.set(ev, new Set());
  listeners.get(ev).add(fn);
  return () => listeners.get(ev)?.delete(fn);
}
export function emit(ev, payload) {
  for (const fn of listeners.get(ev) || []) { try { fn(payload); } catch (e) { console.error(e); } }
}

/** Zapis ustawień (częściowy) – od razu lokalnie, potem w procesie głównym. */
export async function saveSettings(patch) {
  S.settings = deepMerge(S.settings, patch);
  emit('settings', S.settings);
  S.settings = await api('settings:set', patch);
  return S.settings;
}

function deepMerge(a, b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return b;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = a && typeof a[k] === 'object' && a[k] && !Array.isArray(a[k]) ? deepMerge(a[k], v) : v;
  return out;
}

export async function refreshInstances() {
  S.instances = await api('instances:list');
  for (const i of S.instances) { if (i.running) S.running.add(i.id); }
  emit('instances', S.instances);
  return S.instances;
}

export async function refreshAccounts() {
  const r = await api('accounts:list');
  S.accounts = r.accounts;
  S.selectedAccount = r.selected && r.accounts.some((a) => a.id === r.selected) ? r.selected : r.accounts[0]?.id || null;
  emit('accounts', S.accounts);
  return S.accounts;
}

export async function getVersions(force) {
  if (!S.versions || force) S.versions = await api('versions:list', !!force);
  return S.versions;
}

export const selectedInstance = () => S.instances.find((i) => i.id === S.settings?.selectedInstance) || S.instances[0] || null;
export const currentAccount = () => S.accounts.find((a) => a.id === S.selectedAccount) || null;
