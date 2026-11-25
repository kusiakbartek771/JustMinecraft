// Wspólne elementy: ikony instancji, okładki, avatary, etykiety loaderów.
import { h } from './ui.js';
import { LOADER_COLORS, LOADER_NAMES } from './theme.js';

function hash(s) {
  let x = 2166136261;
  for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); }
  return x >>> 0;
}

export function instColor(inst) {
  if (inst.color) return inst.color;
  return LOADER_COLORS[inst.loader] || '#7c5cff';
}

/** Okładka instancji: obraz użytkownika albo wygenerowany gradient „z bloczków”. */
export function coverStyle(inst) {
  if (inst.cover) return `url("${inst.cover}") center/cover`;
  const c = instColor(inst);
  const n = hash(inst.name || inst.id);
  const a = n % 360;
  return `radial-gradient(120% 140% at ${20 + (n % 50)}% 0%, ${c}cc, transparent 60%), linear-gradient(${a}deg, ${c}55, #0b0d14 85%)`;
}

export function instIcon(inst, size = '') {
  const el = h(`div.inst-icon${size ? `.${size}` : ''}`);
  const ic = inst.icon;
  if (ic && /^data:|^https?:/.test(ic)) el.style.backgroundImage = `url("${ic}")`;
  else if (ic) { el.classList.add('emoji'); el.textContent = ic; el.style.background = `linear-gradient(135deg, ${instColor(inst)}55, ${instColor(inst)}22)`; }
  else {
    el.textContent = (inst.name || '?').trim().charAt(0).toUpperCase();
    const c = instColor(inst);
    el.style.background = `linear-gradient(135deg, ${c}, color-mix(in srgb, ${c} 45%, #000))`;
  }
  if (inst.running) el.append(h('span.run-dot', { title: 'Gra działa' }));
  return el;
}

export function loaderChip(loader, version) {
  const c = LOADER_COLORS[loader] || '#888';
  return h('span.chip', { style: { background: `${c}2e`, color: 'var(--text)' } },
    h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: c, display: 'inline-block' } }),
    `${LOADER_NAMES[loader] || loader}${version ? ` ${shortLoaderVersion(loader, version)}` : ''}`);
}

export function shortLoaderVersion(loader, v) {
  if (!v) return '';
  if (loader === 'forge') return v.replace(/^[^-]+-/, '').replace(/-[\d.]+$/, '');
  return v;
}

/** Avatar konta – inicjał (albo twarz ze skórki, jeśli konto ją ma). */
export function avatar(acc, size = 34) {
  const el = h('div.avatar', { style: { width: `${size}px`, height: `${size}px` } });
  if (!acc) { el.textContent = '?'; return el; }
  const fallback = () => {
    el.replaceChildren();
    el.textContent = acc.name.charAt(0).toUpperCase();
    const c = `hsl(${hash(acc.name) % 360} 55% 45%)`;
    el.style.background = c;
    el.style.color = '#fff';
  };
  if (!acc.skin) { fallback(); return el; }
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 8;
    const g = cv.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(img, 8, 8, 8, 8, 0, 0, 8, 8);
    g.drawImage(img, 40, 8, 8, 8, 0, 0, 8, 8);
    el.replaceChildren(cv);
  };
  img.onerror = fallback;
  img.src = acc.skin;
  fallback();
  return el;
}

export const EMOJIS = ['⛏️', '🗡️', '🏹', '🛡️', '🧱', '🌲', '🌋', '🏰', '🐉', '🧟', '💎', '🔥', '❄️', '🌊', '🍄', '🐺', '🐝', '🌸', '⚙️', '🚀', '🧪', '🔮', '🪄', '🏝️', '🌙', '⭐', '🎮', '🧭', '🗺️', '🪓', '🏹', '🐟', '🌵', '🍖', '🧲', '🪐', '👾', '🤖', '🏠', '⚡'];
