// Animation loops (spec A5). Every effect owns ONE requestAnimationFrame loop made here, started when its
// element is on screen and the tab is visible, stopped otherwise and on unmount. Development builds count
// the running loops (window.__dfreshLoops()) so leaks show up when switching language.
const running = new Map(); // name -> count

function count(name, d) {
  if (process.env.NODE_ENV === 'production') return;
  const n = (running.get(name) || 0) + d;
  if (n) running.set(name, n);
  else running.delete(name);
  const total = [...running.values()].reduce((a, b) => a + b, 0);
  console.debug(`[loops] ${total} running`, Object.fromEntries(running));
}

if (process.env.NODE_ENV !== 'production') {
  window.__dfreshLoops = () => ({
    total: [...running.values()].reduce((a, b) => a + b, 0),
    byName: Object.fromEntries(running),
  });
}

// tick(dt seconds, capped at 50 ms; now ms) runs once per frame; returning false stops the loop.
export function createLoop(name, tick) {
  let id = 0;
  let last = 0;
  let on = false;

  const frame = (now) => {
    const dt = Math.min(0.05, Math.max(0, now - last) / 1000);
    last = now;
    if (tick(dt, now) === false) {
      stop();
      return;
    }
    if (on) id = requestAnimationFrame(frame);
  };

  function start() {
    if (on) return;
    on = true;
    last = performance.now();
    id = requestAnimationFrame(frame);
    count(name, 1);
  }

  function stop() {
    if (!on) return;
    on = false;
    cancelAnimationFrame(id);
    id = 0;
    count(name, -1);
  }

  return { start, stop, isRunning: () => on };
}

// cb() once the page has finished loading (and a moment more), so decorative loops never compete with
// the first screen. Returns a cancel function.
export function afterLoad(cb, delay = 200) {
  let timer = 0;
  const go = () => { timer = setTimeout(cb, delay); };
  if (document.readyState === 'complete') go();
  else window.addEventListener('load', go, { once: true });
  return () => {
    window.removeEventListener('load', go);
    clearTimeout(timer);
  };
}

// cb(active) whenever "element on screen AND tab visible" changes; returns the cleanup.
export function watchActive(el, cb, rootMargin = '0px') {
  let onScreen = !('IntersectionObserver' in window);
  let active = null;
  const update = () => {
    const next = onScreen && !document.hidden;
    if (next !== active) {
      active = next;
      cb(next);
    }
  };
  let io = null;
  if ('IntersectionObserver' in window) {
    io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      update();
    }, { rootMargin });
    io.observe(el);
  } else {
    update();
  }
  document.addEventListener('visibilitychange', update);
  return () => {
    if (io) io.disconnect();
    document.removeEventListener('visibilitychange', update);
  };
}
