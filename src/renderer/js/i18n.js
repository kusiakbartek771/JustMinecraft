// Tłumaczenia: teksty w kodzie są po polsku, a słowniki mapują je na inne języki.
import EN from './lang/en.js';

const DICTS = { en: EN };
let lang = 'pl';

export const LANGS = [['pl', 'Polski'], ['en', 'English']];

export function setLang(l) {
  lang = DICTS[l] || l === 'pl' ? l : 'pl';
  document.documentElement.lang = lang;
}

export function t(s, vars) {
  let out = lang === 'pl' ? s : (DICTS[lang]?.[s] ?? s);
  if (vars) out = out.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? ''));
  return out;
}

export const currentLang = () => lang;
