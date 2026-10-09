// Language-prefixed URLs (docs/04_I18N.md): /en, /ta/products?cat=napkins, /hi/privacy ...
export const SAVED_LANG_KEY = 'dfresh-lang';

// Page segments that are never a language code, so /products (no prefix) becomes /<default>/products.
const PAGES = new Set(['products', 'privacy', 'terms']);

export function readSavedLang() {
  try {
    return localStorage.getItem(SAVED_LANG_KEY);
  } catch {
    return null; // storage blocked (private mode, settings)
  }
}

export function saveLang(code) {
  try {
    localStorage.setItem(SAVED_LANG_KEY, code);
  } catch {
    // storage blocked: the URL prefix still carries the language
  }
}

// '/ta/products' -> { first: 'ta', rest: '/products' }
export function splitPath(pathname) {
  const m = /^\/([^/]*)(.*)$/.exec(pathname) || [];
  return { first: decodeURIComponent(m[1] || ''), rest: m[2] || '' };
}

// For `/`: saved language, else the first browser language that is active, else the default.
export function pickStartLang(languages, defaultCode) {
  const active = (code) => languages.find((l) => l.code === code);
  const saved = readSavedLang();
  if (saved && active(saved)) return saved;
  for (const tag of navigator.languages || [navigator.language || '']) {
    const t = String(tag).toLowerCase();
    const hit = languages.find((l) => l.htmlLang.toLowerCase() === t)
      || languages.find((l) => l.code === t.split('-')[0]);
    if (hit) return hit.code;
  }
  return defaultCode;
}

// Where an unknown / inactive / wrongly cased prefix should go: same path in the default language.
export function fixLangPath(pathname, languages, defaultCode) {
  const { first, rest } = splitPath(pathname);
  if (PAGES.has(first.toLowerCase())) return `/${defaultCode}${pathname}`;
  const lower = first.toLowerCase();
  const code = languages.some((l) => l.code === lower) ? lower : defaultCode;
  return `/${code}${rest}`;
}

// Same page in another language (keeps the rest of the path; the caller adds search + hash).
export function swapLang(pathname, code) {
  return `/${code}${splitPath(pathname).rest}`;
}
