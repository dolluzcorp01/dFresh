// Jump to a home section (#business, #where ...) so its top sits right under the sticky header, and keep it there
// while the page is still settling: the sections above mount late (HomePage renders them after the hero), lazy images
// and fonts arrive, and after a reload the browser may restore an old scroll position. Every frame the section's place
// is measured again (with the header's measured height) and the scroll corrected when it moved; this stops once the
// place has held for 1.5 s with the web fonts loaded (a script font arriving late rewraps the text above; at most 5 s),
// or at once when the visitor scrolls (wheel, touch, keys, mouse).
// Reduced motion: every move is instant (no smooth scrolling).
const SETTLE_MS = 1500;
const MAX_MS = 5000;
const USER = ['wheel', 'touchstart', 'keydown', 'mousedown'];

let running = null; // the stop function of the jump in progress (a new jump replaces it)

export function scrollToSection(el) {
  if (running) running();
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const header = document.querySelector('header.top');
  const want = () => {
    const top = el.getBoundingClientRect().top + window.scrollY - (header ? header.getBoundingClientRect().height : 0);
    const max = document.documentElement.scrollHeight - window.innerHeight; // a section near the end cannot reach the top
    return Math.max(0, Math.round(Math.min(top, max)));
  };
  let goal = want();
  window.scrollTo({ top: goal, behavior: reduced ? 'instant' : 'smooth' });

  const start = performance.now();
  let settledAt = start;
  let lastY = window.scrollY;
  let still = 0; // frames without scroll movement (a smooth scroll has arrived or was interrupted)
  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    USER.forEach((t) => window.removeEventListener(t, stop, true));
    if (running === stop) running = null;
  };
  const tick = (now) => {
    const g = want();
    const y = window.scrollY;
    still = Math.abs(y - lastY) < 1 ? still + 1 : 0;
    lastY = y;
    if (Math.abs(g - goal) > 1) {
      // the layout above changed: aim at the new place (retarget a smooth scroll still on its way)
      goal = g;
      settledAt = now;
      window.scrollTo({ top: g, behavior: reduced || still > 2 ? 'instant' : 'smooth' });
    } else if (still > 3 && Math.abs(y - g) > 2) {
      // arrived somewhere else (e.g. the browser restored an old position): put it right
      settledAt = now;
      window.scrollTo({ top: g, behavior: 'instant' });
    }
    const fontsDone = !document.fonts || document.fonts.status === 'loaded';
    if ((fontsDone && now - settledAt > SETTLE_MS && Math.abs(window.scrollY - g) <= 2) || now - start > MAX_MS) { stop(); return; }
    raf = requestAnimationFrame(tick);
  };
  USER.forEach((t) => window.addEventListener(t, stop, { capture: true, passive: true }));
  raf = requestAnimationFrame(tick);
  running = stop;
  return stop;
}
