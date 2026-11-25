// Most między interfejsem a procesem głównym (contextIsolation + sandbox).
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const invoke = async (ch, ...args) => {
  const r = await ipcRenderer.invoke(ch, ...args);
  if (!r.ok) { const e = new Error(r.error); e.code = r.code; if (r.url) e.url = r.url; throw e; }
  return r.data;
};
const listen = (ch) => (fn) => {
  const h = (_e, p) => fn(p);
  ipcRenderer.on(ch, h);
  return () => ipcRenderer.removeListener(ch, h);
};

contextBridge.exposeInMainWorld('jl', {
  invoke,
  // surowa odpowiedź { ok, data | error, code, url } – błędy przechodzące przez contextBridge tracą własne pola
  invokeRaw: (ch, ...args) => ipcRenderer.invoke(ch, ...args),
  on: (ch, fn) => {
    const allowed = ['tasks:update', 'tasks:remove', 'task:log', 'game:log', 'game:state', 'instances:changed', 'toast', 'jm:state', 'jm:connection', 'update:status', 'win:state', 'worlds:mapProgress', 'game:e4mc', 'game:bench'];
    if (!allowed.includes(ch)) throw new Error(`Nieznany kanał ${ch}`);
    return listen(ch)(fn);
  },
  win: {
    minimize: () => ipcRenderer.send('win:minimize'),
    maximize: () => ipcRenderer.send('win:maximize'),
    close: () => ipcRenderer.send('win:close'),
  },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
  platform: process.platform,
});
