// Home sections (#business, #where ...): the section's top lands right under the sticky header.
// Why it used to step: the home sections use content-visibility: auto (styles/base.css), so a section only got its
// real height when it came near the screen, i.e. during the scroll, and every one that grew pushed the target away.
// Now the sections from the top down to the target (and down to where the visitor is) are rendered first (class
// "cv-on"), so the target does not move while we travel. No repeated correction loop.
// - landOnSection(el): a #hash in the URL on load. Render, wait for the web fonts (at most 2 s) and a frame, then one
//   instant move. Once the fonts are all in (or 600 ms later), one silent correction if the place moved at all.
// - glideToSection(el): a menu / footer link. One eased scroll (ease-in-out, 500-800 ms by distance) aimed at the
//   section's current place on every frame, so a late layout change bends the same motion instead of restarting it.
// Reduced motion: both are instant. Any wheel / touch / key / pointer press by the visitor stops the motion at once.
const USER = ['wheel', 'touchstart', 'keydown', 'pointerdown'];
let stopCurrent = null; // stops the move in progress (a new one replaces it)

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const later = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const jump = (top) => window.scrollTo({ top, behavior: 'instant' }); // html has scroll-behavior: smooth

/** Where the window must scroll so el's top sits under the sticky header (clamped to the page end). */
function goalFor(el) {
  const header = document.querySelector('header.top');
  const top = el.getBoundingClientRect().top + window.scrollY - (header ? header.getBoundingClientRect().height : 0);
  const max = document.documentElement.scrollHeight - window.innerHeight; // a section near the end cannot reach the top
  return Math.max(0, Math.round(Math.min(top, max)));
}

/** Gives every home section from the top down to the target, or down to the one on screen if that is lower, its
 * real height now (no content-visibility estimate), so nothing between here and there grows during the move. */
export function renderSectionsFor(el) {
  const all = [...document.querySelectorAll('#main > .sec')];
  const target = all.findIndex((s) => s === el || s.contains(el));
  const here = all.findIndex((s) => s.getBoundingClientRect().bottom > 0);
  const last = Math.max(target, here);
  all.slice(0, last + 1).forEach((s) => s.classList.add('cv-on'));
}

function begin(onStop = null) {
  if (stopCurrent) stopCurrent();
  let stopped = false;
  let raf = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    USER.forEach((t) => window.removeEventListener(t, stop, true));
    if (stopCurrent === stop) stopCurrent = null;
    if (onStop) onStop();
  };
  USER.forEach((t) => window.addEventListener(t, stop, { capture: true, passive: true }));
  stopCurrent = stop;
  return { stop, isStopped: () => stopped, setRaf: (id) => { raf = id; } };
}

/** One silent correction after landing: only if the place moved (a late font rewrapped the text above). */
function settle(el, run) {
  const fontsPending = document.fonts && document.fonts.status !== 'loaded';
  const wait = fontsPending ? Promise.race([document.fonts.ready, later(3000)]) : later(600);
  wait.then(frame).then(() => {
    if (run.isStopped()) return;
    const goal = goalFor(el);
    if (Math.abs(window.scrollY - goal) > 1) jump(goal);
    run.stop();
  });
}

export function landOnSection(el) {
  const run = begin(() => document.documentElement.classList.remove('hash-load')); // smooth scrolling back on
  renderSectionsFor(el);
  // a frame for the style + layout of the newly rendered sections (their script fonts start loading), then the fonts
  frame()
    .then(() => (document.fonts ? Promise.race([document.fonts.ready, later(2000)]) : null))
    .then(frame)
    .then(() => {
      if (run.isStopped()) return;
      jump(goalFor(el));
      settle(el, run);
    });
  return run.stop;
}

export function glideToSection(el) {
  const run = begin();
  renderSectionsFor(el);
  const from = window.scrollY;
  const first = goalFor(el);
  const distance = Math.abs(first - from);
  if (reducedMotion() || distance < 2) {
    jump(first);
    settle(el, run);
    return run.stop;
  }
  const duration = Math.min(800, Math.max(500, 500 + distance / 20)); // 500 ms nearby, 800 ms across the page
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2);
  let start = 0;
  const tick = (now) => {
    if (run.isStopped()) return;
    if (!start) start = now;
    const p = Math.min(1, (now - start) / duration);
    // aim at where the section is now: a layout change bends the same motion
    jump(Math.round(from + (goalFor(el) - from) * ease(p)));
    if (p < 1) run.setRaf(requestAnimationFrame(tick));
    else settle(el, run);
  };
  run.setRaf(requestAnimationFrame(tick));
  return run.stop;
}
