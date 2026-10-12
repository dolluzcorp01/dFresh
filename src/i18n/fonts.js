// Script fonts are served by the site itself (backend font-manager.js): their @font-face rules arrive inlined in
// the page (<style id="dfresh-fonts">, seo.js). A page without them (the React dev server, or a shell page) loads
// the same rules once from /api/dfresh/fonts.css. Saira and Open Sans (Latin) are in the build
// (src/styles/fonts.css). Nothing is loaded from Google; a font is only downloaded when text needs it.
import { API_BASE } from '../utils/api';

let requested = false;

function ensureFontCss() {
  if (requested || document.getElementById('dfresh-fonts')) return;
  requested = true;
  fetch(`${API_BASE}/api/dfresh/fonts.css`)
    .then((r) => (r.ok ? r.text() : ''))
    .then((css) => {
      if (!css || document.getElementById('dfresh-fonts')) return;
      const style = document.createElement('style');
      style.id = 'dfresh-fonts';
      // the font files live on the API's origin (the same origin in production)
      style.textContent = API_BASE ? css.replace(/url\(\/media\//g, `url(${API_BASE}/media/`) : css;
      document.head.appendChild(style);
    })
    .catch(() => { requested = false; }); // offline: system fonts; tried again on the next language change
}

// A language's script font (languages.font_family): the rules above cover every active language.
export function loadFont(family) {
  if (family) ensureFontCss();
}

// CSS value for --f-lang (family names are checked, so quoting is safe).
export function fontVar(family) {
  return family && /^[A-Za-z0-9 ]+$/.test(family) ? `"${family}"` : '';
}

// The language switch shows each label in its own script from a tiny label font ("dFresh label <font>", also in
// the rules above), so a page never loads another script's full font just for the switch.
export function labelFamily(family) {
  return `dFresh label ${family}`;
}

export function loadLabelFont(family) {
  if (family) ensureFontCss();
}
