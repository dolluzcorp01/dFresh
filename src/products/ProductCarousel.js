// Card photo carousel (spec C1): the product's 3 photos + a dark spec slide (logo, name, first 4 parts of
// the spec). Auto-advance every ~3 s, staggered per card (index) so a grid does not tick together; paused
// on hover, on touch (resumes 4 s after), while focused, while the card is flipped, off screen, in a hidden tab,
// and never with reduced motion. Dots to jump. A colour change fades the new photos in and starts at photo 1.
// Drag (mouse) / swipe (touch, pen) with Pointer Events: the photo follows the pointer once the move is
// clearly horizontal (vertical moves stay page scrolls: touch-action pan-y), then snaps to the next / previous
// photo past 40 px or on a quick flick, else back; wrap-around both ways. A drag never becomes a click (no dot
// jump, no flip). With reduced motion the photo does not follow, it just switches on release.
// Keyboard: the photo area is focusable, Left / Right change photo; "Photo 2 of 4" is announced for changes the
// visitor makes (not for the auto-advance).
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/useT';
import { mediaSrcSet, mediaUrl } from '../utils/api';
import useReducedMotion from '../utils/useReducedMotion';

const SIZES = '(max-width: 560px) min(360px, 92vw), (max-width: 900px) 46vw, (max-width: 1100px) 31vw, 300px';
const SLOP = 6; // px: less is a tap
const SWITCH = 40; // px: further is a photo change
const FLICK = 0.3; // px per ms over the last ~100 ms (300 px/s): faster is a photo change even when short
const EDGE = 0.35; // drag resistance past the first / last photo

// First n characters of a name as the reader sees them (grapheme clusters, so Tamil / Hindi never break).
function clip(text, n) {
  const parts = typeof Intl !== 'undefined' && Intl.Segmenter
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].map((s) => s.segment)
    : Array.from(text);
  return parts.length > n ? `${parts.slice(0, n - 1).join('')}…` : text;
}

function SpecSlide({ product: d }) {
  return (
    <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${d.name} - ${d.spec}`}>
      <rect width="400" height="400" fill="#121214" />
      <circle cx="200" cy="420" r="210" fill="#1E1D20" />
      <image href={mediaUrl('/media/logo/dfresh-logo-on-dark.webp')} x="140" y="46" width="120" height="66" />
      <text className="ss-name" x="200" y="150" textAnchor="middle">{clip(d.name, 26)}</text>
      {String(d.spec || '').split(' · ').slice(0, 4).map((line, i) => (
        <text key={line} className="ss-line" x="200" y={198 + i * 36} textAnchor="middle">{line}</text>
      ))}
    </svg>
  );
}

export default function ProductCarousel({ product: d, index, eager = false, paused: flipped }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const ref = useRef(null);
  const trackRef = useRef(null);
  const [k, setK] = useState(0);
  const [said, setSaid] = useState(''); // live region text, set only by the visitor's own changes
  const [dragging, setDragging] = useState(false);
  const hover = useRef(false);
  const touchUntil = useRef(0);
  const drag = useRef(null); // { id, type, x0, y0, axis, dx, trail: [[time, x]] of the last ~100 ms }
  const noClick = useRef(false);
  const imgs = d.images.slice(0, 3);
  const n = imgs.length + 1;
  const wrap = (i) => ((i % n) + n) % n;
  const go = (i, announce = true) => {
    const next = wrap(i);
    setK(next);
    if (announce) setSaid(t('card_photo_of', { n: next + 1, total: n }));
  };
  const rtl = () => typeof document !== 'undefined' && document.documentElement.dir === 'rtl';

  // Auto-advance: one interval, only while the card is on screen.
  useEffect(() => {
    const el = ref.current;
    if (reduced || flipped || !el || !('IntersectionObserver' in window)) return undefined;
    let id = 0;
    const tick = () => {
      if (hover.current || drag.current || document.hidden || Date.now() < touchUntil.current) return;
      if (el.contains(document.activeElement)) return; // focused (keyboard): the visitor is looking at it
      setK((v) => (v + 1) % n);
    };
    const io = new IntersectionObserver(([e]) => {
      clearInterval(id);
      id = e.isIntersecting ? setInterval(tick, 3000 + (index % 5) * 170) : 0;
    });
    io.observe(el);
    return () => { io.disconnect(); clearInterval(id); };
  }, [reduced, flipped, index, n]);

  // Hover anywhere on the card pauses (preview: mouseenter on the card).
  useEffect(() => {
    const card = ref.current && ref.current.closest('.card');
    if (!card) return undefined;
    const on = () => { hover.current = true; };
    const off = () => { hover.current = false; };
    card.addEventListener('mouseenter', on);
    card.addEventListener('mouseleave', off);
    return () => { card.removeEventListener('mouseenter', on); card.removeEventListener('mouseleave', off); };
  }, []);

  // Colour change: back to photo 1 of the new set, the new photos fade in (not on first render, not with
  // reduced motion).
  const shown = useRef(d.id);
  useEffect(() => {
    if (shown.current === d.id) return;
    shown.current = d.id;
    setK(0);
    if (reduced || !ref.current) return;
    ref.current.querySelectorAll('.slide img').forEach((im) => {
      if (im.animate) {
        im.animate([{ opacity: 0.2, transform: 'scale(1.03)' }, { opacity: 1, transform: 'none' }],
          { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
    });
  }, [d.id, reduced]);

  const setOffset = (px) => { if (trackRef.current) trackRef.current.style.setProperty('--dx', `${px}px`); };

  const onPointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target.closest('.dots')) return; // dots are buttons: a plain click
    drag.current = { id: e.pointerId, type: e.pointerType, x0: e.clientX, y0: e.clientY, axis: null, dx: 0, trail: [[performance.now(), e.clientX]] };
    noClick.current = false;
    if (e.pointerType !== 'mouse') touchUntil.current = Infinity;
  };

  const onPointerMove = (e) => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    const now = performance.now();
    g.trail.push([now, e.clientX]);
    while (g.trail.length > 2 && now - g.trail[0][0] > 100) g.trail.shift();
    if (!g.axis) {
      if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
      if (Math.abs(dy) >= Math.abs(dx)) { // a vertical move: the page scrolls, no photo change
        drag.current = null;
        return;
      }
      g.axis = 'x';
      noClick.current = true;
      setDragging(true);
      try { ref.current.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    }
    g.dx = dx;
    if (reduced) return; // no following, the photo switches on release
    const towardNext = rtl() ? dx > 0 : dx < 0;
    const atEdge = towardNext ? k === n - 1 : k === 0;
    setOffset(atEdge ? dx * EDGE : dx);
  };

  const endDrag = (e, cancelled) => {
    const g = drag.current;
    if (!g || g.id !== e.pointerId) return;
    drag.current = null;
    if (g.type !== 'mouse') touchUntil.current = Date.now() + 4000;
    if (!g.axis) return; // a tap: whatever was tapped gets its click
    setDragging(false);
    setOffset(0);
    if (cancelled) return;
    const [t0, x0] = g.trail[0];
    const speed = Math.abs(e.clientX - x0) / Math.max(1, performance.now() - t0);
    if (Math.abs(g.dx) >= SWITCH || (speed >= FLICK && Math.abs(g.dx) >= SLOP * 2)) {
      const towardNext = rtl() ? g.dx > 0 : g.dx < 0;
      go(k + (towardNext ? 1 : -1));
    }
  };

  // After a drag the browser still fires a click on whatever is under the pointer: swallow it.
  const onClickCapture = (e) => {
    if (!noClick.current) return;
    noClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  const onKeyDown = (e) => {
    if (e.target !== e.currentTarget || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const towardNext = (e.key === 'ArrowRight') !== rtl();
    go(k + (towardNext ? 1 : -1));
  };

  return (
    <div
      className={`car${dragging ? ' dragging' : ''}`}
      ref={ref}
      tabIndex={0}
      role="group"
      aria-roledescription="carousel"
      aria-label={d.alt}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
      onClickCapture={onClickCapture}
      onKeyDown={onKeyDown}
    >
      <div className="track" ref={trackRef} style={{ '--k': k }}>
        {imgs.map((im, i) => (
          <div className="slide" key={im.pos} aria-hidden={i !== k}>
            <img
              className="ph"
              src={mediaUrl(im.src)}
              srcSet={mediaSrcSet(im.srcset)}
              sizes={SIZES}
              width={im.width || undefined}
              height={im.height || undefined}
              alt={i === 0 ? d.alt : `${d.alt} - ${t('card_photo', { n: i + 1 })}`}
              // First photo of the products page's first card (its LCP image): not lazy, high priority.
              loading={eager && i === 0 ? 'eager' : 'lazy'}
              fetchPriority={eager && i === 0 ? 'high' : undefined}
              decoding="async"
              draggable="false"
            />
          </div>
        ))}
        <div className="slide" aria-hidden={k !== n - 1}><SpecSlide product={d} /></div>
      </div>
      <div className="dots">
        {Array.from({ length: n }, (_, i) => (
          <button
            key={i}
            type="button"
            aria-label={t('card_photo', { n: i + 1 })}
            aria-current={i === k}
            onClick={() => go(i)}
          />
        ))}
      </div>
      <span className="car-live" aria-live="polite">{said}</span>
    </div>
  );
}
