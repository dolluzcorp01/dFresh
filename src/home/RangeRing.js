// Spin the range (spec B4): the six categories on a 3D ring. Slow auto-rotation, drag to spin with
// inertia, prev / next buttons, front tile clickable, a focused tile turns to the front, a drag never
// counts as a click. Click -> products filtered to that category.
// One rAF loop: runs while the ring is on screen, the tab is visible and something moves; with reduced
// motion there is no auto-rotation and no inertia (it stops as soon as it settles).
import { useEffect, useRef } from 'react';
import { useI18n } from '../i18n/useT';
import Kicker from '../components/Kicker';
import { useOpenProducts } from '../products/useOpenProducts';
import { mediaSrcSet, mediaUrl } from '../utils/api';
import { createLoop, watchActive } from '../utils/loop';
import useReducedMotion from '../utils/useReducedMotion';
import { productImage } from './productImage';
import './RangeRing.css';

const AUTO = 0.15; // degrees per frame at 60 fps
const HOLD_MS = 1800; // after turning to a tile, wait before auto-rotation resumes

export default function RangeRing() {
  const { t, data } = useI18n();
  const openProducts = useOpenProducts();
  const reduced = useReducedMotion();
  const cats = data.categories;
  const n = cats.length;
  const wrapRef = useRef(null);
  const ringRef = useRef(null);
  const api = useRef(null); // { turnTo(index), step(dir) } from the effect

  useEffect(() => {
    const wrap = wrapRef.current;
    const ring = ringRef.current;
    if (!wrap || !ring || !n) return undefined;
    const base = reduced ? 0 : AUTO;
    const S = { ang: 0, vel: base, drag: false, lx: 0, moved: 0, target: null, holdUntil: 0, active: false };
    const slot = 360 / n;

    const place = () => {
      const items = ring.children;
      const W = wrap.clientWidth;
      const RX = Math.min(W * 0.38, 520);
      for (let i = 0; i < items.length; i += 1) {
        const it = items[i];
        const a = ((i * slot - S.ang) * Math.PI) / 180;
        const x = Math.sin(a) * RX;
        const d = (Math.cos(a) + 1) / 2; // 1 = front, 0 = back
        it.style.transform = `translate3d(${x.toFixed(1)}px, ${((1 - d) * -30).toFixed(1)}px, 0) scale(${(0.55 + 0.45 * d).toFixed(3)}) rotateY(${(Math.sin(a) * -25).toFixed(1)}deg)`;
        it.style.zIndex = String(Math.round(d * 100));
        it.style.opacity = String(0.35 + 0.65 * d);
        it.style.filter = d < 0.5 ? `blur(${((0.5 - d) * 4).toFixed(2)}px)` : 'none';
        const front = d > 0.55;
        it.style.pointerEvents = front ? 'auto' : 'none';
        it.tabIndex = front ? 0 : -1;
      }
    };

    const loop = createLoop('ring', (dt, now) => {
      const f = dt * 60; // frame-rate independent
      if (S.target !== null) {
        if (reduced) S.ang = S.target;
        else S.ang += (S.target - S.ang) * Math.min(1, 0.12 * f);
        if (Math.abs(S.target - S.ang) < 0.1) {
          S.ang = S.target;
          S.target = null;
          S.vel = 0;
          S.holdUntil = now + HOLD_MS;
        }
      } else if (!S.drag) {
        if (now >= S.holdUntil) S.vel += (base - S.vel) * Math.min(1, 0.02 * f);
        if (reduced) S.vel = 0; // no inertia
        S.ang += S.vel * f;
      }
      place();
      // nothing left to move (reduced motion, settled): stop until the next interaction
      const idle = !S.drag && S.target === null && base === 0 && Math.abs(S.vel) < 0.001;
      return !idle;
    });
    const wake = () => { if (S.active) loop.start(); };

    api.current = {
      turnTo(i) {
        // the nearest equivalent angle, so focus never spins the long way round
        const goal = i * slot;
        S.target = goal + Math.round((S.ang - goal) / 360) * 360;
        S.vel = 0;
        wake();
      },
      step(dir) {
        S.target = (Math.round(S.ang / slot) + dir) * slot;
        S.vel = 0;
        wake();
      },
    };

    const onDown = (e) => {
      if (e.target.closest('.ringctl') || (e.pointerType === 'mouse' && e.button !== 0)) return;
      S.drag = true;
      S.lx = e.clientX;
      S.moved = 0;
      S.target = null;
      wake();
    };
    const onMove = (e) => {
      if (!S.drag) return;
      const dx = e.clientX - S.lx;
      S.lx = e.clientX;
      S.moved += Math.abs(dx);
      S.ang -= dx * 0.3;
      S.vel = -dx * 0.05 || S.vel;
    };
    const onUp = () => {
      if (!S.drag) return;
      S.drag = false;
      S.vel = reduced ? 0 : Math.max(-2, Math.min(2, S.vel));
    };
    // a drag is never a click on the tile under the pointer
    const onClickCapture = (e) => {
      if (S.moved > 6) {
        e.stopPropagation();
        e.preventDefault();
      }
      S.moved = 0;
    };

    wrap.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    wrap.addEventListener('click', onClickCapture, true);
    const ro = new ResizeObserver(place);
    ro.observe(wrap);
    place();
    const stopWatch = watchActive(wrap, (active) => {
      S.active = active;
      if (active) loop.start();
      else loop.stop();
    });

    return () => {
      loop.stop();
      stopWatch();
      ro.disconnect();
      api.current = null;
      wrap.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      wrap.removeEventListener('click', onClickCapture, true);
    };
  }, [n, reduced]);

  return (
    <section className="sec ringsec" id="range" aria-labelledby="range-h">
      <div className="wrap">
        <div className="sh">
          <Kicker>{t('range_k')}</Kicker>
          <h2 id="range-h">{t('range_h')}</h2>
          <p>{t('range_p')}</p>
        </div>
      </div>
      <div className="ringwrap" ref={wrapRef}>
        <div className="ring3" ref={ringRef}>
          {cats.map((c, i) => {
            const img = productImage(data.products, c.repProductId);
            return (
              <button
                key={c.key}
                className="ri"
                type="button"
                onFocus={() => api.current && api.current.turnTo(i)}
                onClick={(e) => openProducts({ category: c.key }, e.currentTarget)}
              >
                <div className="pa">
                  {img && (
                    <img
                      className="ph"
                      src={mediaUrl(img.src)}
                      srcSet={mediaSrcSet(img.srcset)}
                      sizes="(max-width: 620px) 150px, 210px"
                      width={img.width || undefined}
                      height={img.height || undefined}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      draggable="false"
                    />
                  )}
                </div>
                <b>{c.name}</b>
                <small>{t(c.count === 1 ? 'n_product' : 'n_products', { n: c.count })}</small>
              </button>
            );
          })}
        </div>
        <div className="ringctl">
          <button type="button" aria-label={t('ring_prev')} onClick={() => api.current && api.current.step(-1)}>‹</button>
          <span>{t('ring_hint')}</span>
          <button type="button" aria-label={t('ring_next')} onClick={() => api.current && api.current.step(1)}>›</button>
        </div>
      </div>
    </section>
  );
}
