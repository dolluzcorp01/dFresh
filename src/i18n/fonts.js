// Loads a language's script font (languages.font_family) from Google Fonts, once, on demand.
const requested = new Set();

export function loadFont(family) {
  if (!family || !/^[A-Za-z0-9 ]+$/.test(family) || requested.has(family)) return;
  requested.add(family);
  const base = `https://fonts.googleapis.com/css2?family=${family.trim().replace(/ +/g, '+')}`;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  // The weight range covers the site's 300-800; a family without that axis range falls back to its default.
  link.href = `${base}:wght@300..800&display=swap`;
  link.onerror = () => {
    link.onerror = null;
    link.href = `${base}&display=swap`;
  };
  document.head.appendChild(link);
}

// CSS value for --f-lang (family names are checked above, so quoting is safe).
export function fontVar(family) {
  return family && /^[A-Za-z0-9 ]+$/.test(family) ? `"${family}"` : '';
}
