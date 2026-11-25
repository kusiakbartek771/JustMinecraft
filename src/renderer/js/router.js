// Prosty router widoków z czyszczeniem (każdy widok może zwrócić funkcję sprzątającą).
import { emit } from './state.js';

const views = new Map();
let current = { name: null, param: null, cleanup: null };
const history = [];

export function registerView(name, render) { views.set(name, render); }

export function navigate(name, param = null, o = {}) {
  const root = document.getElementById('view');
  if (!views.has(name)) name = 'home';
  if (!o.replace && current.name && !(current.name === name && JSON.stringify(current.param) === JSON.stringify(param))) history.push({ name: current.name, param: current.param });
  if (history.length > 30) history.shift();
  try { current.cleanup?.(); } catch (e) { console.error(e); }
  root.replaceChildren();
  root.scrollTop = 0;
  root.classList.remove('enter', 'back');
  void root.offsetWidth;
  root.classList.add('enter');
  if (o.back) root.classList.add('back');
  current = { name, param, cleanup: null };
  try {
    const r = views.get(name)(root, param);
    if (r instanceof Promise) r.then((c) => { if (current.name === name) current.cleanup = typeof c === 'function' ? c : null; }).catch((e) => console.error(e));
    else current.cleanup = typeof r === 'function' ? r : null;
  } catch (e) {
    console.error(e);
    root.textContent = `Błąd widoku: ${e.message}`;
  }
  emit('route', { name, param });
}

export function back() {
  const prev = history.pop();
  if (prev) navigate(prev.name, prev.param, { replace: true, back: true });
  else navigate('home', null, { replace: true, back: true });
}

export const route = () => current;
export const rerender = () => navigate(current.name, current.param, { replace: true });
