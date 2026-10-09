// Home page. Phase 2: placeholder sections (real headings from the DB, in spec order) so routing, the
// header states, #section links and reveal-on-scroll can be checked. Phases 3-5 replace each section.
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useT } from '../i18n/useT';
import Reveal from '../components/Reveal';
import './HomePage.css';

const SECTIONS = [
  { k: 'doors_k', h: 'doors_h' },
  { id: 'range', k: 'range_k', h: 'range_h' },
  { id: 'featured', k: 'feat_k', h: 'feat_h' },
  { id: 'play', k: 'tryit', h: 'ur_h' },
  { id: 'business', k: 'for_business', h: 'biz_h' },
  { id: 'where', k: 'where_k', h: 'where_h' },
  { id: 'about', k: 'ab_k', h: 'ab_h' },
  { id: 'contact', h: 'band_h' },
];

export default function HomePage() {
  const t = useT();
  const location = useLocation();

  // #section links (header, menu, footer, shared URLs). A language switch keeps the scroll position.
  useEffect(() => {
    if (!location.hash || (location.state && location.state.keepScroll)) return;
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (el) el.scrollIntoView();
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <section className="hero ph-hero" aria-labelledby="h1">
        <div className="wrap">
          <p className="k">{t('eyebrow')}</p>
          <h1 id="h1">
            <span className="ln">{t('hero_l1')}</span>
            <span className="ln ln2">{t('hero_l2')}</span>
          </h1>
          <p className="lede">{t('lede')}</p>
        </div>
      </section>
      {SECTIONS.map((s) => (
        <section key={s.h} className="sec ph" id={s.id}>
          <Reveal className="wrap sh">
            {s.k && <span className="k">{t(s.k)}</span>}
            <h2>{t(s.h)}</h2>
          </Reveal>
        </section>
      ))}
    </>
  );
}
