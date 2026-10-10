// Card photo carousel (spec C1): the product's 3 photos + a dark spec slide (logo, name, first 4 parts of
// the spec). Auto-advance every ~3 s, staggered per card (index) so a grid does not tick together; paused
// on hover, on touch (resumes 4 s after), while the card is flipped, off screen, in a hidden tab, and never
// with reduced motion. Swipe on touch, dots to jump. A colour change fades the new photos in.
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../i18n/useT';
import { mediaSrcSet, mediaUrl } from '../utils/api';
import useReducedMotion from '../utils/useReducedMotion';

const SIZES = '(max-width: 560px) min(360px, 92vw), (max-width: 900px) 46vw, (max-width: 1100px) 31vw, 300px';

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
  const [k, setK] = useState(0);
  const hover = useRef(false);
  const touchUntil = useRef(0);
  const x0 = useRef(null);
  const imgs = d.images.slice(0, 3);
  const n = imgs.length + 1;
  const go = (i) => setK(((i % n) + n) % n);

  // Auto-advance: one interval, only while the card is on screen.
  useEffect(() => {
    const el = ref.current;
    if (reduced || flipped || !el || !('IntersectionObserver' in window)) return undefined;
    let id = 0;
    const tick = () => {
      if (hover.current || document.hidden || Date.now() < touchUntil.current) return;
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

  // Colour change: the new photos fade in (not on first render, not with reduced motion).
  const shown = useRef(d.id);
  useEffect(() => {
    if (shown.current === d.id) return;
    shown.current = d.id;
    if (reduced || !ref.current) return;
    ref.current.querySelectorAll('.slide img').forEach((im) => {
      if (im.animate) {
        im.animate([{ opacity: 0.2, transform: 'scale(1.03)' }, { opacity: 1, transform: 'none' }],
          { duration: 420, easing: 'cubic-bezier(.22,1,.36,1)' });
      }
    });
  }, [d.id, reduced]);

  const onTouchStart = (e) => {
    touchUntil.current = Infinity;
    x0.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e) => {
    if (x0.current != null) {
      const dx = e.changedTouches[0].clientX - x0.current;
      if (Math.abs(dx) > 30) go(k + ((dx < 0) !== (document.dir === 'rtl') ? 1 : -1));
    }
    x0.current = null;
    touchUntil.current = Date.now() + 4000;
  };

  return (
    <div className="car" ref={ref} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className="track" style={{ '--k': k }}>
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
    </div>
  );
}
