// Home page, sections in spec order (docs/05_FEATURES_SPEC.md B1-B10).
import { startTransition, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { glideToSection, landOnSection } from '../utils/scrollToSection';
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
  // Always false in the first render: the server pre-renders hero + footer and cannot see the #hash.
  const [below, setBelow] = useState(false);
  useEffect(() => {
    if (below) return undefined;
    if (location.hash || window.location.hash) {
      setBelow(true);
      return undefined;
    }
    const id = requestAnimationFrame(() => startTransition(() => setBelow(true)));
    return () => cancelAnimationFrame(id);
  }, [below]); // eslint-disable-line react-hooks/exhaustive-deps

  // #section links, once the sections exist (utils/scrollToSection.js): the hash this page was opened with (shared URL,
  // reload, a link from another page) lands in one instant move; a link clicked here glides there. A language switch
  // keeps the scroll position. A #section link clicked while the app was still starting changes the address bar
  // before the router listens, so the router's location has no hash: the address bar's hash is used then.
  const openedWith = useRef(null); // the location key the page was opened with (an effect may run twice for it)
  useEffect(() => {
    const hash = location.hash || window.location.hash;
    if (!below) return undefined;
    if (openedWith.current === null) openedWith.current = location.key;
    const first = openedWith.current === location.key;
    if (!hash || (location.state && location.state.keepScroll)) {
      if (first) document.documentElement.classList.remove('hash-load');
      return undefined;
    }
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (!el) {
      document.documentElement.classList.remove('hash-load');
      return undefined;
    }
    return first ? landOnSection(el) : glideToSection(el);
  }, [location.key, below]); // eslint-disable-line react-hooks/exhaustive-deps

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
