// Home page, sections in spec order (docs/05_FEATURES_SPEC.md B1-B10).
import { startTransition, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import Hero from '../home/Hero';
import BannerSlider from '../home/BannerSlider';
import Doors from '../home/Doors';
import RangeRing from '../home/RangeRing';
import FeaturedRail from '../products/FeaturedRail';
import TryIt from '../home/TryIt';
import BusinessKits from '../home/BusinessKits';
import WhereMap from '../home/WhereMap';
import About from '../home/About';
import ContactBand from '../home/ContactBand';

export default function HomePage() {
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
      {below && <FeaturedRail />}
      {below && <TryIt />}
      {below && <BusinessKits />}
      {below && <WhereMap />}
      {below && <About />}
      {below && <ContactBand />}
    </>
  );
}
