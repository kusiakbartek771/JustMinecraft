// Motywy, kolor akcentu, tło, zaokrąglenia, czcionki, gęstość – wszystko jako zmienne CSS.

export const THEMES = {
  midnight: { name: 'Północ', bg: '#0b0d14', surface: '#131722', surface2: '#1a1f2e', elevated: '#222839', text: '#e8ebf4', dim: '#8d95ab', border: 'rgba(255,255,255,.07)', accent: '#7c5cff', dark: true, g1: '#2a1f6b', g2: '#0f3d5c' },
  obsidian: { name: 'Obsydian', bg: '#0a0a0c', surface: '#121216', surface2: '#19191f', elevated: '#212129', text: '#ececf1', dim: '#8a8a99', border: 'rgba(255,255,255,.07)', accent: '#a78bfa', dark: true, g1: '#26173f', g2: '#101018' },
  creeper: { name: 'Creeper', bg: '#0a120c', surface: '#111b14', surface2: '#16241a', elevated: '#1e3023', text: '#e6f4e9', dim: '#86a38d', border: 'rgba(160,255,180,.08)', accent: '#4ade80', dark: true, g1: '#0f4a24', g2: '#16301d' },
  ocean: { name: 'Ocean', bg: '#07111a', surface: '#0d1a26', surface2: '#122333', elevated: '#182d42', text: '#e3f1fb', dim: '#7f9bb3', border: 'rgba(140,200,255,.08)', accent: '#38bdf8', dark: true, g1: '#0b3b63', g2: '#062a3a' },
  nether: { name: 'Nether', bg: '#140909', surface: '#1e0f0f', surface2: '#281414', elevated: '#341a1a', text: '#fbe9e7', dim: '#b48a85', border: 'rgba(255,140,120,.09)', accent: '#f97316', dark: true, g1: '#5a1410', g2: '#2b0c18' },
  end: { name: 'End', bg: '#0d0a14', surface: '#15101f', surface2: '#1d162b', elevated: '#261d38', text: '#f1ebfb', dim: '#9d8fb7', border: 'rgba(210,170,255,.08)', accent: '#d946ef', dark: true, g1: '#3d1a5c', g2: '#1a2a4a' },
  sakura: { name: 'Sakura', bg: '#140c11', surface: '#1e1219', surface2: '#281822', elevated: '#331f2b', text: '#fbe9f1', dim: '#b68ca2', border: 'rgba(255,170,210,.09)', accent: '#f472b6', dark: true, g1: '#5a1f42', g2: '#2a1530' },
  sunset: { name: 'Zachód', bg: '#130d0a', surface: '#1d1410', surface2: '#271a14', elevated: '#32221a', text: '#fcefe5', dim: '#b89a86', border: 'rgba(255,200,150,.09)', accent: '#fb923c', dark: true, g1: '#5c2a12', g2: '#3a1530' },
  amoled: { name: 'AMOLED', bg: '#000000', surface: '#0a0a0a', surface2: '#121212', elevated: '#1a1a1a', text: '#f5f5f5', dim: '#8a8a8a', border: 'rgba(255,255,255,.08)', accent: '#22d3ee', dark: true, g1: '#000', g2: '#000' },
  mocha: { name: 'Mocha', bg: '#1e1e2e', surface: '#252536', surface2: '#2d2d41', elevated: '#36364d', text: '#cdd6f4', dim: '#9399b2', border: 'rgba(205,214,244,.08)', accent: '#cba6f7', dark: true, g1: '#45305c', g2: '#1e3a4f' },
  snow: { name: 'Śnieg (jasny)', bg: '#eef1f6', surface: '#ffffff', surface2: '#f4f6fa', elevated: '#ffffff', text: '#161a23', dim: '#5f6779', border: 'rgba(15,23,42,.09)', accent: '#6d4aff', dark: false, g1: '#c9d6ff', g2: '#e7ccff' },
  sand: { name: 'Piasek (jasny)', bg: '#f3efe6', surface: '#fffdf8', surface2: '#f7f2e8', elevated: '#ffffff', text: '#2a241b', dim: '#6f6556', border: 'rgba(60,40,10,.1)', accent: '#c2410c', dark: false, g1: '#f7d9a8', g2: '#e8c7b0' },
};

export const FONTS = [['Inter', 'Inter'], ['System', 'Systemowa'], ['Nunito', 'Zaokrąglona'], ['JetBrains Mono', 'Pikselowa / mono'], ['Serif', 'Szeryfowa']];
export const ACCENTS = ['#7c5cff', '#4ade80', '#38bdf8', '#f97316', '#f472b6', '#facc15', '#ef4444', '#22d3ee', '#a3e635', '#e879f9'];

function hexToRgb(hex) {
  let x = hex.replace('#', '');
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const n = parseInt(x, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function contrastText(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.45 ? '#0b0d12' : '#ffffff';
}

let styleEl = null;

export function applyAppearance(a) {
  const th = THEMES[a.theme] || THEMES.midnight;
  const accent = a.customAccent && a.accent ? a.accent : th.accent;
  const root = document.documentElement;
  const [r, g, b] = hexToRgb(accent);
  const vars = {
    '--bg': th.bg, '--surface': th.surface, '--surface-2': th.surface2, '--elevated': th.elevated, '--text': th.text, '--text-dim': th.dim,
    '--border': th.border, '--accent': accent, '--accent-rgb': `${r}, ${g}, ${b}`, '--accent-text': contrastText(accent),
    '--g1': th.g1, '--g2': th.g2, '--radius': `${a.radius ?? 14}px`, '--radius-sm': `${Math.max(4, Math.round((a.radius ?? 14) * 0.6))}px`,
    '--font-scale': String((a.fontScale || 100) / 100), '--bg-blur': `${a.backgroundBlur ?? 18}px`, '--bg-dim': String((a.backgroundDim ?? 55) / 100),
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  root.dataset.theme = th.dark ? 'dark' : 'light';
  root.dataset.density = a.density || 'comfortable';
  root.dataset.glass = a.glass ? 'on' : 'off';
  root.dataset.anim = a.animations === false ? 'off' : 'on';
  root.dataset.sidebar = a.sidebar || 'left';
  root.dataset.compact = a.sidebarCompact ? 'on' : 'off';
  root.dataset.font = (a.font || 'Inter').replace(/\s+/g, '-').toLowerCase();
  root.dataset.bg = a.background || 'gradient';

  const bgImg = document.getElementById('bg-image');
  if (bgImg) {
    bgImg.style.backgroundImage = a.background === 'image' && a.backgroundImage ? `url("${a.backgroundImage}")` : '';
  }
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'custom-css'; document.head.append(styleEl); }
  styleEl.textContent = a.customCss || '';
}

export const LOADER_COLORS = { vanilla: '#5fbf4a', fabric: '#d7b98a', quilt: '#a970ff', forge: '#5b8def', neoforge: '#f0883e' };
export const LOADER_NAMES = { vanilla: 'Vanilla', fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
