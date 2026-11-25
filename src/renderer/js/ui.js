// Małe narzędzia do budowania interfejsu bez frameworka.
import { icon } from './icons.js';
import { t } from './i18n.js';

/** h('div.klasa#id', { onClick, html, style, ... }, ...dzieci) */
export function h(sel, props, ...children) {
  const m = sel.match(/^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i);
  const el = document.createElement(m?.[1] || 'div');
  for (const part of (m?.[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1)); else el.id = part.slice(1);
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k === 'class') el.className += ` ${v}`;
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k in el && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function btn(label, onClick, o = {}) {
  const b = h(`button.btn${o.kind ? `.${o.kind}` : ''}${o.small ? '.small' : ''}`, { type: 'button', onClick, title: o.title, disabled: o.disabled });
  if (o.icon) b.append(h('span.ic', { html: icon(o.icon) }));
  if (label) b.append(h('span', { text: label }));
  return b;
}

export function iconBtn(name, title, onClick, o = {}) {
  return h(`button.icon-btn${o.kind ? `.${o.kind}` : ''}`, { type: 'button', title, 'aria-label': title, onClick, html: icon(name), disabled: o.disabled });
}

export function switchEl(value, onChange) {
  const el = h('button.switch', { type: 'button', role: 'switch', 'aria-checked': String(!!value) });
  el.classList.toggle('on', !!value);
  el.addEventListener('click', () => {
    const v = !el.classList.contains('on');
    el.classList.toggle('on', v);
    el.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return el;
}

export function select(options, value, onChange, o = {}) {
  const s = h('select.select', { onChange: () => onChange(s.value) });
  for (const opt of options) {
    const [v, label, extra] = Array.isArray(opt) ? opt : [opt.value, opt.label, opt];
    const op = h('option', { value: v, text: label });
    if (extra?.disabled) op.disabled = true;
    s.append(op);
  }
  s.value = value ?? '';
  if (o.width) s.style.width = o.width;
  return s;
}

export function input(value, onChange, o = {}) {
  const i = h('input.input', { type: o.type || 'text', value: value ?? '', placeholder: o.placeholder || '', spellcheck: false });
  if (o.min != null) i.min = o.min;
  if (o.max != null) i.max = o.max;
  if (o.width) i.style.width = o.width;
  i.addEventListener(o.live ? 'input' : 'change', () => onChange(o.type === 'number' ? Number(i.value) : i.value));
  if (o.onEnter) i.addEventListener('keydown', (e) => { if (e.key === 'Enter') o.onEnter(i.value); });
  return i;
}

/** Suwak z wartością i opcjonalną jednostką */
export function slider(value, { min, max, step = 1, unit = '', format, onChange, onInput }) {
  const out = h('span.slider-val');
  const fmt = format || ((v) => `${v}${unit}`);
  const r = h('input.range', { type: 'range', min, max, step, value });
  const paint = () => {
    const p = ((r.value - min) / (max - min)) * 100;
    r.style.setProperty('--p', `${p}%`);
    out.textContent = fmt(Number(r.value));
  };
  r.addEventListener('input', () => { paint(); onInput?.(Number(r.value)); });
  r.addEventListener('change', () => onChange?.(Number(r.value)));
  paint();
  return h('div.slider', null, r, out);
}

export function segmented(options, value, onChange) {
  const el = h('div.segmented');
  for (const [v, label, ic] of options) {
    const b = h('button', { type: 'button', class: v === value ? 'active' : '' });
    if (ic) b.append(h('span.ic', { html: icon(ic) }));
    if (label) b.append(h('span', { text: label }));
    b.addEventListener('click', () => {
      el.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      onChange(v);
    });
    el.append(b);
  }
  return el;
}

// ---------- toasty ----------
export function toast(msg, o = {}) {
  const root = document.getElementById('toasts');
  const el = h(`div.toast${o.error ? '.error' : ''}${o.success ? '.success' : ''}`, null,
    h('span.ic', { html: icon(o.error ? 'alert' : o.success ? 'check' : o.icon || 'info') }),
    h('div.toast-body', null, h('div', { text: msg }), o.action ? h('button.toast-action', { text: o.action.label, onClick: () => { o.action.run(); close(); } }) : null),
    h('button.toast-x', { html: icon('x'), onClick: () => close() }));
  root.append(el);
  requestAnimationFrame(() => el.classList.add('show'));
  let timer = setTimeout(close, o.duration || (o.error ? 8000 : 4000));
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', () => { timer = setTimeout(close, 2500); });
  function close() {
    clearTimeout(timer);
    el.classList.remove('show');
    setTimeout(() => el.remove(), 250);
  }
  return close;
}

export const toastError = (e) => toast(e?.message || String(e), { error: true });

// ---------- okna modalne ----------
const modalStack = [];
export function modal(content, o = {}) {
  const root = document.getElementById('modals');
  const card = h(`div.modal${o.wide ? '.wide' : ''}${o.full ? '.full' : ''}`, { role: 'dialog' });
  if (o.title) {
    card.append(h('div.modal-head', null,
      o.icon ? h('span.ic.head-ic', { html: icon(o.icon) }) : null,
      h('h2', { text: o.title }),
      h('div.spacer'),
      o.dismissable === false ? null : iconBtn('x', t('Zamknij'), () => close())));
  }
  const body = h('div.modal-body');
  card.append(body);
  if (typeof content === 'function') content(body, () => close());
  else if (content) body.append(content);
  if (o.actions) {
    const foot = h('div.modal-foot');
    for (const a of o.actions) foot.append(btn(a.label, async () => { if ((await a.run?.()) !== false) close(); }, { kind: a.kind, icon: a.icon }));
    card.append(foot);
  }
  const back = h('div.modal-back', null, card);
  back.addEventListener('mousedown', (e) => { if (e.target === back && o.dismissable !== false) close(); });
  root.append(back);
  requestAnimationFrame(() => back.classList.add('show'));
  const entry = { close, back };
  modalStack.push(entry);
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    back.classList.remove('show');
    setTimeout(() => back.remove(), 200);
    modalStack.splice(modalStack.indexOf(entry), 1);
    o.onClose?.();
  }
  return { close, card, body };
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) { modalStack[modalStack.length - 1].close(); e.stopPropagation(); }
});

export function confirmDialog({ title, text, ok = t('OK'), danger = false, icon: ic }) {
  return new Promise((resolve) => {
    let done = false;
    modal(h('p.muted', { text }), {
      title, icon: ic || (danger ? 'alert' : 'info'),
      onClose: () => { if (!done) resolve(false); },
      actions: [
        { label: t('Anuluj'), run: () => { done = true; resolve(false); } },
        { label: ok, kind: danger ? 'danger' : 'primary', run: () => { done = true; resolve(true); } },
      ],
    });
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', ok = t('Zapisz') }) {
  return new Promise((resolve) => {
    let done = false;
    const i = h('input.input', { value, placeholder, spellcheck: false });
    const m = modal(h('div.form', null, label ? h('label.lbl', { text: label }) : null, i), {
      title,
      onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: t('Anuluj'), run: () => { done = true; resolve(null); } },
        { label: ok, kind: 'primary', run: () => { done = true; resolve(i.value.trim()); } },
      ],
    });
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { done = true; resolve(i.value.trim()); m.close(); } });
    setTimeout(() => { i.focus(); i.select(); }, 50);
  });
}

// ---------- menu kontekstowe ----------
let openMenu = null;
export function contextMenu(e, items) {
  e.preventDefault();
  e.stopPropagation();
  openMenu?.remove();
  const m = h('div.ctx-menu');
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { m.append(h('div.ctx-sep')); continue; }
    m.append(h(`button.ctx-item${it.danger ? '.danger' : ''}`, { disabled: it.disabled, onClick: () => { m.remove(); openMenu = null; it.run(); } },
      h('span.ic', { html: icon(it.icon || 'dot') }), h('span', { text: it.label })));
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  const x = e.clientX ?? e.target.getBoundingClientRect().left;
  const y = e.clientY ?? e.target.getBoundingClientRect().bottom;
  m.style.left = `${Math.min(x, innerWidth - r.width - 8)}px`;
  m.style.top = `${Math.min(y, innerHeight - r.height - 8)}px`;
  openMenu = m;
}
document.addEventListener('mousedown', (e) => { if (openMenu && !openMenu.contains(e.target)) { openMenu.remove(); openMenu = null; } });
window.addEventListener('blur', () => { openMenu?.remove(); openMenu = null; });

// ---------- formatowanie ----------
export function fmtBytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function fmtNum(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')} mln`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace('.0', '')} tys.`;
  return String(n);
}

export function fmtDuration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return t('< 1 min');
  if (m < 60) return `${m} min`;
  const hh = Math.floor(m / 60);
  return `${hh} h ${m % 60} min`;
}

export function fmtAgo(ts) {
  if (!ts) return t('nigdy');
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t('przed chwilą');
  if (s < 3600) return `${Math.floor(s / 60)} ${t('min temu')}`;
  if (s < 86400) return `${Math.floor(s / 3600)} ${t('godz. temu')}`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} ${t('dni temu')}`;
  return new Date(ts).toLocaleDateString();
}

export function debounce(fn, ms) {
  let tmr;
  return (...a) => { clearTimeout(tmr); tmr = setTimeout(() => fn(...a), ms); };
}

/** Wiersz ustawień: etykieta + opis + kontrolka */
export function setting(label, hint, ...ctl) {
  return h('div.setting', null,
    h('div.setting-lbl', null, h('b', { text: label }), hint ? h('small', { html: hint }) : null),
    h('div.setting-ctl', null, ...ctl));
}

export function section(title, ...rows) {
  return h('section.card.settings-card', null, title ? h('h3.card-title', { text: title }) : null, ...rows);
}

export function empty(ic, title, text, ...actions) {
  return h('div.empty', null, h('div.empty-ic', { html: icon(ic) }), h('h3', { text: title }), text ? h('p', { text }) : null, actions.length ? h('div.row.center', null, ...actions) : null);
}

export function spinner(small) { return h(`div.spinner${small ? '.small' : ''}`); }

export function progressBar(p) {
  const el = h('div.progress', null, h('div.progress-fill'));
  setProgress(el, p);
  return el;
}
export function setProgress(el, p) {
  const fill = el.firstChild;
  if (p == null || !isFinite(p)) { el.classList.add('indeterminate'); fill.style.width = ''; } else { el.classList.remove('indeterminate'); fill.style.width = `${Math.max(0, Math.min(100, p))}%`; }
}
