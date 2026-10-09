// Home page, sections in spec order (docs/05_FEATURES_SPEC.md B1-B10). Phase 3: hero, banners, doors,
// range ring. The rest are placeholders (real headings from the DB) until Phases 4-5 replace them.
import { startTransition, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useT } from '../i18n/useT';
import Reveal from '../components/Reveal';
import Hero from '../home/Hero';
import BannerSlider from '../home/BannerSlider';
import Doors from '../home/Doors';
import RangeRing from '../home/RangeRing';
import './HomePage.css';

const PLACEHOLDERS = [
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
  // The hero paints first; the sections below the fold mount right after, as an interruptible
  // transition, so the first screen is not one long blocking task. A #section link needs them at once.
  const [below, setBelow] = useState(() => Boolean(location.hash));
  useEffect(() => {
    if (below) return undefined;
    const id = requestAnimationFrame(() => startTransition(() => setBelow(true)));
    return () => cancelAnimationFrame(id);
  }, [below]);

  // #section links (header, menu, footer, shared URLs). A language switch keeps the scroll position.
  useEffect(() => {
    if (!location.hash || (location.state && location.state.keepScroll)) return;
    const el = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (el) el.scrollIntoView();
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Hero />
      {below && <BannerSlider />}
      {below && <Doors />}
      {below && <RangeRing />}
      {below && PLACEHOLDERS.map((s) => (
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
