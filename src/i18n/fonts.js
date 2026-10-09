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

// Just the glyphs of a language's switch label (Google Fonts `text=` subset, a few hundred bytes), so the
// language pill shows every label in its own script font before that language's full font is ever needed.
// The subset is renamed to labelFamily(): Google's subset CSS has no unicode-range, so under the real family
// name it would capture every character of that weight (e.g. all Open Sans 600 text) and break the page.
export function labelFamily(family) {
  return `dFresh label ${family}`;
}

export function loadLabelFont(family, text) {
  const key = `${family}|${text}`;
  if (!family || !text || !/^[A-Za-z0-9 ]+$/.test(family) || requested.has(key)) return;
  requested.add(key);
  const url = `https://fonts.googleapis.com/css2?family=${family.trim().replace(/ +/g, '+')}:wght@600&text=${encodeURIComponent(text)}&display=swap`;
  fetch(url)
    .then((r) => (r.ok ? r.text() : ''))
    .then((css) => {
      if (!css.includes('@font-face')) return;
      const style = document.createElement('style');
      style.textContent = css.replace(/font-family:\s*['"][^'"]*['"]/g, `font-family: '${labelFamily(family)}'`);
      document.head.appendChild(style);
    })
    .catch(() => {}); // offline: the label falls back to the full font (if loaded) or the body font
}
