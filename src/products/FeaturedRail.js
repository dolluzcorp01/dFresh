// Bestsellers (spec B5): the is_featured products in featured_order as flip cards in a horizontal snap rail
// with prev / next buttons (preview: scroll by 320px, smooth unless reduced motion).
import { useRef } from 'react';
import { useI18n } from '../i18n/useT';
import Kicker from '../components/Kicker';
import useReducedMotion from '../utils/useReducedMotion';
import FlipCard from './FlipCard';
import './FeaturedRail.css';

export default function FeaturedRail() {
  const { t, data } = useI18n();
  const reduced = useReducedMotion();
  const railRef = useRef(null);
  const items = data.products.filter((p) => p.featured)
    .sort((a, b) => (a.featuredOrder ?? 999) - (b.featuredOrder ?? 999));
  if (!items.length) return null;

  const scroll = (dir) => {
    const rtl = document.dir === 'rtl' ? -1 : 1;
    railRef.current.scrollBy({ left: dir * rtl * 320, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <section className="sec featured" id="featured" aria-labelledby="feat-h">
      <div className="wrap">
        <div className="sh">
          <Kicker>{t('feat_k')}</Kicker>
          <h2 id="feat-h">{t('feat_h')}</h2>
          <p>{t('feat_p')}</p>
        </div>
        <div className="rail" ref={railRef}>
          {items.map((p, i) => <FlipCard key={p.id} product={p} index={i} />)}
        </div>
        <div className="rail-ctrl">
          <button type="button" aria-label={t('feat_prev')} onClick={() => scroll(-1)}><span aria-hidden="true">←</span></button>
          <button type="button" aria-label={t('feat_next')} onClick={() => scroll(1)}><span aria-hidden="true">→</span></button>
        </div>
      </div>
    </section>
  );
}
