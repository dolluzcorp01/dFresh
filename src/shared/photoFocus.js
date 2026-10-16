// Focus point of a cropped photo ("70% 50%": where the subject is, as % of the photo's width / height). A photo that is
// cropped to fill a box (object-fit: cover) is positioned so that point sits in the middle of the box, as far as the
// photo's edges allow; so the subject stays in view at every width as long as the box keeps its shape.
// Used by the About section (home/About.js) and its admin preview (Settings), which draws the part that will show.
// CommonJS: also read by the API (settingRules.js validates the value).
const DEFAULT_FOCUS = { x: 70, y: 50 };
const clamp = (n) => Math.min(100, Math.max(0, n));

/** "70% 50%" -> { x: 70, y: 50 }; anything else -> null */
function parseFocus(v) {
  const m = /^(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%$/.exec(String(v == null ? '' : v).trim());
  if (!m) return null;
  const x = Number(m[1]);
  const y = Number(m[2]);
  return x <= 100 && y <= 100 ? { x, y } : null;
}

const formatFocus = (f) => `${Math.round(f.x)}% ${Math.round(f.y)}%`;

/** The visible part of the photo, in % of the photo: { left, top, width, height } (and the object-position used). */
function visibleWindow(focus, imgAspect, boxAspect) {
  const f = focus || DEFAULT_FOCUS;
  const w = imgAspect > boxAspect ? boxAspect / imgAspect : 1; // share of the width that shows
  const h = imgAspect < boxAspect ? imgAspect / boxAspect : 1; // share of the height that shows
  const px = w < 1 ? clamp(((f.x / 100 - w / 2) / (1 - w)) * 100) : 50;
  const py = h < 1 ? clamp(((f.y / 100 - h / 2) / (1 - h)) * 100) : 50;
  return {
    left: (1 - w) * px, top: (1 - h) * py, width: w * 100, height: h * 100,
    position: `${px.toFixed(1)}% ${py.toFixed(1)}%`,
  };
}

/** CSS object-position for a cover-cropped photo. */
const objectPosition = (focus, imgAspect, boxAspect) => visibleWindow(focus, imgAspect, boxAspect).position;

// The About photo: 1920 x 800 (uploads are cropped to it), shown in a 5:4 box (home/About.css .about .pic).
const ABOUT = { imgAspect: 1920 / 800, boxAspect: 5 / 4 };

module.exports = { DEFAULT_FOCUS, parseFocus, formatFocus, visibleWindow, objectPosition, ABOUT };
