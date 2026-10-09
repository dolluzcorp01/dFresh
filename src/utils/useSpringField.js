// Spring field (preview "springField"): the items inside `boxRef` (selector `itemSelector`) lift smoothly
// near the pointer at any speed, with a little tilt and squash, optionally tinting toward a dark gold.
// One rAF loop that runs only while something moves; nothing at all with reduced motion.
// `deps` re-reads the items (new text = new letters).
import { useEffect } from 'react';
import { createLoop } from './loop';
import useReducedMotion from './useReducedMotion';

// Tint target on LIGHT backgrounds (CLAUDE.md rule 12: hover tints keep 4.5:1). #8A6A0C, mixed in at most
// 90% (below), stays >= 4.57:1 on the hero's lightest-to-darkest backgrounds (#FFFFFF / #FCFBF6 / #F3EBDB)
// for both headline colours (ink 4.92-5.83, ink-2 4.57-5.42). Do not raise the 0.9 cap.
const GOLD = [138, 106, 12];

function rgb(color) {
  const m = color.match(/\d+(\.\d+)?/g);
  return m ? m.slice(0, 3).map(Number) : [18, 18, 20];
}

export default function useSpringField(boxRef, itemSelector, opts, deps) {
  const reduced = useReducedMotion();
  const { lift = 0.24, reach = 0.85, k = 170, c = 15, tilt = 7, gold = false } = opts || {};

  useEffect(() => {
    const box = boxRef.current;
    if (!box || reduced) return undefined;
    const items = [...box.querySelectorAll(itemSelector)];
    const st = items.map(() => ({ y: 0, v: 0, t: 0 }));
    const base = items.map((el) => rgb(getComputedStyle(el).color));
    let pos = [];
    let em = 16;
    let px = null;
    let py = null;
    let lastX = 0;
    let lastT = 0;
    let speed = 0;

    const measure = () => {
      em = parseFloat(getComputedStyle(box).fontSize) || 16;
      const br = box.getBoundingClientRect();
      pos = items.map((el) => {
        const r = el.getBoundingClientRect();
        // the transform is ours, so subtract the current lift to get the resting centre
        const i = items.indexOf(el);
        return { x: r.left - br.left + r.width / 2, y: r.top - br.top + r.height / 2 - (st[i] ? st[i].y : 0) };
      });
    };

    const reset = () => items.forEach((el) => {
      el.style.transform = '';
      el.style.color = '';
    });

    const loop = createLoop('spring', (dt) => {
      let moving = false;
      for (let i = 0; i < items.length; i += 1) {
        const s = st[i];
        const p = pos[i];
        if (!p) continue;
        let target = 0;
        if (px !== null) {
          const dx = (p.x - px) / (em * reach);
          const dy = (p.y - py) / (em * 1.1);
          target = -lift * em * Math.exp(-(dx * dx + dy * dy)) * (1 + 0.35 * speed);
        }
        s.t += (target - s.t) * Math.min(1, dt * 14);
        const a = k * (s.t - s.y) - c * s.v;
        s.v += a * dt;
        s.y += s.v * dt;
        const rot = Math.max(-tilt, Math.min(tilt, s.v * 0.012 * (i % 2 ? 1 : -1)));
        const sq = Math.max(-0.06, Math.min(0.06, s.v * -0.00018));
        items[i].style.transform = `translate3d(0, ${s.y.toFixed(2)}px, 0) rotate(${rot.toFixed(2)}deg) scale(${(1 - sq).toFixed(3)}, ${(1 + sq).toFixed(3)})`;
        if (gold) {
          const m = Math.min(1, Math.abs(s.y) / (lift * em * 0.9));
          const b = base[i];
          items[i].style.color = m > 0.02 ? `rgb(${b.map((v, j) => Math.round(v + (GOLD[j] - v) * m * 0.9)).join(',')})` : '';
        }
        if (Math.abs(s.y) > 0.05 || Math.abs(s.v) > 0.05 || Math.abs(s.t) > 0.05) moving = true;
      }
      if (moving || px !== null) return true;
      reset();
      return false;
    });

    const onEnter = () => measure();
    const onMove = (e) => {
      const br = box.getBoundingClientRect();
      const x = e.clientX - br.left;
      const now = performance.now();
      speed = Math.min(1.6, Math.abs(x - lastX) / Math.max(8, now - (lastT || now - 16)) / 1.2);
      lastT = now;
      lastX = x;
      px = x;
      py = e.clientY - br.top;
      if (!pos.length) measure();
      loop.start();
    };
    const onLeave = () => {
      px = null;
      py = null;
      loop.start();
    };
    const onResize = () => { pos = []; };

    box.addEventListener('pointerenter', onEnter);
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerleave', onLeave);
    window.addEventListener('resize', onResize);
    return () => {
      loop.stop();
      reset();
      box.removeEventListener('pointerenter', onEnter);
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('resize', onResize);
    };
  }, [reduced, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
}
