// Falling tissue petals behind the hero (spec B1): ~16 pieces on a canvas at 30 fps, only while the
// hero is on screen and the tab is visible, starting after the page has loaded. Nothing with reduced motion.
import { useEffect, useRef } from 'react';
import { afterLoad, createLoop, watchActive } from '../utils/loop';
import useReducedMotion from '../utils/useReducedMotion';

export default function Petals() {
  const ref = useRef(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const cv = ref.current;
    if (!cv || reduced) return undefined;
    const cx = cv.getContext('2d');
    const PD = Math.min(1.5, window.devicePixelRatio || 1);
    const fit = () => {
      cv.width = cv.offsetWidth * PD;
      cv.height = cv.offsetHeight * PD;
    };
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    fit();
    const ps = [...Array(16)].map(() => ({
      x: Math.random(), y: Math.random(), s: 8 + Math.random() * 13, r: Math.random() * 6,
      vr: (Math.random() - 0.5) * 0.02, vy: 0.0006 + Math.random() * 0.001, sw: Math.random() * 6, g: Math.random() < 0.3,
    }));
    let fr = 0;
    const loop = createLoop('petals', () => {
      if ((fr++ & 1) !== 0) return true; // 30 fps
      cx.clearRect(0, 0, cv.width, cv.height);
      for (const p of ps) {
        p.y += p.vy;
        p.sw += 0.01;
        p.r += p.vr;
        if (p.y > 1.05) {
          p.y = -0.05;
          p.x = Math.random();
        }
        cx.save();
        cx.translate((p.x + Math.sin(p.sw) * 0.02) * cv.width, p.y * cv.height);
        cx.rotate(p.r);
        cx.fillStyle = p.g ? 'rgba(244,207,44,.55)' : 'rgba(255,255,255,.95)';
        cx.strokeStyle = 'rgba(150,110,0,.12)';
        cx.lineWidth = PD;
        const s = p.s * PD;
        cx.beginPath();
        cx.moveTo(-s / 2, -s / 2);
        cx.quadraticCurveTo(0, -s * 0.7, s / 2, -s / 2);
        cx.lineTo(s / 2, s / 2);
        cx.quadraticCurveTo(0, s * 0.3, -s / 2, s / 2);
        cx.closePath();
        cx.fill();
        cx.stroke();
        cx.restore();
      }
      return true;
    });
    let stopWatch = () => {};
    const cancelStart = afterLoad(() => {
      stopWatch = watchActive(cv, (active) => (active ? loop.start() : loop.stop()));
    });
    return () => {
      loop.stop();
      cancelStart();
      stopWatch();
      ro.disconnect();
    };
  }, [reduced]);

  if (reduced) return null;
  return <canvas ref={ref} className="petals" aria-hidden="true" />;
}
