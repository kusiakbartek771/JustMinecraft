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

// ---- motywy z JustMusic (wbudowane + wtyczka EvenMoreColors), przeliczone na format launchera ----
function jmHsl(hh, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + hh / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}
function jmPalette(hue, { light = false, sat = 70, accentHue = hue, tint = 22, name } = {}) {
  const accent = light ? jmHsl(accentHue, Math.min(95, sat + 15), 48) : jmHsl(accentHue, Math.min(95, sat + 15), 64);
  const v = light
    ? { bg: jmHsl(hue, tint, 95), surface: jmHsl(hue, tint, 99), 'surface-2': jmHsl(hue, tint, 93), elevated: '#ffffff', text: jmHsl(hue, 25, 12), 'text-dim': jmHsl(hue, 10, 42), border: jmHsl(hue, tint, 87) }
    : { bg: jmHsl(hue, tint, 6), surface: jmHsl(hue, tint, 9), 'surface-2': jmHsl(hue, tint - 2, 13), elevated: jmHsl(hue, tint - 4, 17), text: jmHsl(hue, 25, 94), 'text-dim': jmHsl(hue, 12, 62), border: jmHsl(hue, tint - 4, 16) };
  return { name, ...v, accent };
}
const JM_PRESETS = {
  midnight: { name: 'Midnight', bg: '#0d0e12', surface: '#15171d', 'surface-2': '#1c1f27', elevated: '#252935', text: '#eef0f6', 'text-dim': '#8b91a3', accent: '#7c5cff', border: '#262a35' },
  oled: { name: 'OLED Black', bg: '#000000', surface: '#08080a', 'surface-2': '#121215', elevated: '#1c1c21', text: '#ffffff', 'text-dim': '#8a8a94', accent: '#00e0a4', border: '#1d1d22' },
  fjord: { name: 'Fjord', bg: '#1d222b', surface: '#242a35', 'surface-2': '#2b3240', elevated: '#353d4d', text: '#e5e9f0', 'text-dim': '#97a2b4', accent: '#88c0d0', border: '#343c4b' },
  grape: { name: 'Neon Grape', bg: '#120e1c', surface: '#1a1528', 'surface-2': '#231c35', elevated: '#2d2443', text: '#f3eefe', 'text-dim': '#9e92bc', accent: '#ff4fd8', border: '#2e2544' },
  forest: { name: 'Forest', bg: '#0e1411', surface: '#141c18', 'surface-2': '#1b2620', elevated: '#22302a', text: '#e8f2ec', 'text-dim': '#8ca497', accent: '#4ade80', border: '#23312a' },
  sunset: { name: 'Sunset', bg: '#18110f', surface: '#211715', 'surface-2': '#2b1e1b', elevated: '#362522', text: '#fdf0ea', 'text-dim': '#b39a91', accent: '#ff7a45', border: '#3a2a26' },
  ocean: { name: 'Ocean', bg: '#09131f', surface: '#0e1b2a', 'surface-2': '#142435', elevated: '#1a2d42', text: '#e6f1fb', 'text-dim': '#86a0b8', accent: '#38bdf8', border: '#1b2f44' },
  crimson: { name: 'Crimson', bg: '#130c0e', surface: '#1b1214', 'surface-2': '#25181b', elevated: '#301f23', text: '#fbecef', 'text-dim': '#a98e94', accent: '#ff3d5e', border: '#332226' },
  daylight: { name: 'Daylight', bg: '#eef0f5', surface: '#ffffff', 'surface-2': '#f3f4f8', elevated: '#ffffff', text: '#15171c', 'text-dim': '#636a7a', accent: '#5b4bff', border: '#e1e4eb' },
  rose: { name: 'Rosé', bg: '#f8eeee', surface: '#fffafa', 'surface-2': '#f6e8e7', elevated: '#ffffff', text: '#2b1d1f', 'text-dim': '#8a6f73', accent: '#e0457b', border: '#ecdad8' },
  sand: { name: 'Sand', bg: '#f3efe6', surface: '#fbf8f1', 'surface-2': '#efe9dc', elevated: '#ffffff', text: '#2a261e', 'text-dim': '#7c7465', accent: '#c2410c', border: '#e3dccb' },
};
const JM_EXTRA = {
  aurora: jmPalette(165, { name: 'Aurora', accentHue: 150, sat: 70 }),
  nebula: jmPalette(265, { name: 'Nebula', accentHue: 290, sat: 75 }),
  volcano: jmPalette(10, { name: 'Volcano', accentHue: 18, sat: 85, tint: 18 }),
  glacier: jmPalette(205, { name: 'Glacier', accentHue: 195, sat: 70 }),
  matcha: jmPalette(95, { name: 'Matcha', accentHue: 85, sat: 55, tint: 16 }),
  amber: jmPalette(35, { name: 'Amber', accentHue: 40, sat: 90, tint: 16 }),
  sakura: jmPalette(335, { name: 'Sakura Night', accentHue: 340, sat: 75 }),
  deepsea: jmPalette(220, { name: 'Deep Sea', accentHue: 175, sat: 70, tint: 35 }),
  royal: jmPalette(240, { name: 'Royal', accentHue: 48, sat: 80, tint: 30 }),
  citrus: jmPalette(60, { name: 'Citrus', accentHue: 75, sat: 85, tint: 10 }),
  cyberpunk: { name: 'Cyberpunk', bg: '#0a0612', surface: '#120b1f', 'surface-2': '#1a1030', elevated: '#22163f', text: '#f8f0ff', 'text-dim': '#9b8ab8', accent: '#fcee0a', border: '#2a1b48' },
  synthwave: { name: 'Synthwave', bg: '#140b22', surface: '#1c1030', 'surface-2': '#26163f', elevated: '#301d4f', text: '#ffe9ff', 'text-dim': '#b48fc9', accent: '#ff2e97', border: '#3a2259' },
  matrix: { name: 'Matrix', bg: '#000400', surface: '#020a03', 'surface-2': '#051307', elevated: '#08200c', text: '#c8ffc8', 'text-dim': '#4f9a57', accent: '#00ff41', border: '#0b2a10' },
  coffee: { name: 'Espresso', bg: '#14100d', surface: '#1c1612', 'surface-2': '#251d17', elevated: '#2f251e', text: '#f3e9df', 'text-dim': '#a8968a', accent: '#d4a373', border: '#33281f' },
  slate: { name: 'Slate', bg: '#0f1115', surface: '#161a20', 'surface-2': '#1d222a', elevated: '#252b35', text: '#e6e9ef', 'text-dim': '#8a93a3', accent: '#94a3b8', border: '#272d38' },
  rosegold: { name: 'Rose Gold', bg: '#1a1213', surface: '#22181a', 'surface-2': '#2c1f22', elevated: '#36272a', text: '#fbeff0', 'text-dim': '#b8999d', accent: '#e8a598', border: '#3a2a2d' },
  contrast: { name: 'Wysoki kontrast', bg: '#000000', surface: '#000000', 'surface-2': '#0d0d0d', elevated: '#1a1a1a', text: '#ffffff', 'text-dim': '#d0d0d0', accent: '#ffff00', border: '#ffffff' },
  mint: jmPalette(160, { name: 'Mint Cream', light: true, accentHue: 165, sat: 60, tint: 30 }),
  lavender: jmPalette(260, { name: 'Lavender', light: true, accentHue: 265, sat: 60, tint: 35 }),
  peach: jmPalette(22, { name: 'Peach', light: true, accentHue: 14, sat: 75, tint: 40 }),
  sky: jmPalette(205, { name: 'Sky', light: true, accentHue: 210, sat: 75, tint: 40 }),
  paper: jmPalette(45, { name: 'Paper', light: true, accentHue: 220, sat: 55, tint: 18 }),
  lagoon: jmPalette(190, { name: 'Lagoon', light: true, accentHue: 185, sat: 80, tint: 45 }),
  contrastlight: { name: 'Wysoki kontrast (jasny)', bg: '#ffffff', surface: '#ffffff', 'surface-2': '#f2f2f2', elevated: '#ffffff', text: '#000000', 'text-dim': '#333333', accent: '#0040ff', border: '#000000' },
};
function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
function fromJM(d, group) {
  const dark = relLum(d.bg) < 0.5;
  // poświata tła: akcent wmieszany w tło (jak w motywach launchera)
  return { name: d.name, group, bg: d.bg, surface: d.surface, surface2: d['surface-2'], elevated: d.elevated, text: d.text, dim: d['text-dim'], border: d.border, accent: d.accent, dark,
    g1: mixHex(d.bg, d.accent, dark ? 0.32 : 0.28), g2: mixHex(d.bg, d['text-dim'], dark ? 0.18 : 0.22) };
}
for (const [id, d] of Object.entries(JM_PRESETS)) THEMES[`jm_${id}`] = fromJM(d, 'JustMusic');
for (const [id, d] of Object.entries(JM_EXTRA)) THEMES[`jm_emc_${id}`] = fromJM(d, 'JustMusic · EvenMoreColors');

export const THEME_GROUPS = ['JustMinecraft', 'JustMusic', 'JustMusic · EvenMoreColors'];

export const FONTS = [['Inter', 'Inter'], ['System', 'Systemowa'], ['Nunito', 'Zaokrąglona'], ['JetBrains Mono', 'Pikselowa / mono'], ['Serif', 'Szeryfowa']];
export const ACCENTS = ['#7c5cff', '#4ade80', '#38bdf8', '#f97316', '#f472b6', '#facc15', '#ef4444', '#22d3ee', '#a3e635', '#e879f9'];

function hexToRgb(hex) {
  let x = hex.replace('#', '');
  if (x.length === 3) x = x.split('').map((c) => c + c).join('');
  const n = parseInt(x, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relLum(hex) {
  const [r, g, b] = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
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
