// Sticky header (spec A1): transparent over the hero, solid after 10px of scroll (always solid off home).
// Compact layout (menu sheet + icon brochure button) at <= 900px AND whenever the full nav does not fit,
// which depends on the language's text length, so it is measured, never decided per language.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useI18n } from '../i18n/useT';
import { useOpenForm } from '../forms/FormsProvider';
import { mediaUrl } from '../utils/api';
import { DownloadIcon } from './Icons';
import LanguageSwitch from './LanguageSwitch';
import MobileMenu from './MobileMenu';
import { MAIN_LINKS, linkTarget } from './navLinks';
import './Header.css';

const MENU_ID = 'msheet';
const NARROW = 900;

function contentWidth(el) {
  const cs = getComputedStyle(el);
  return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
}

// Width the header items take (direction-neutral) when it exceeds the content box, else 0.
function overflowSpan(wrap) {
  const boxes = [...wrap.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
  const span = Math.max(...boxes.map((r) => r.right)) - Math.min(...boxes.map((r) => r.left));
  return span > contentWidth(wrap) + 1 ? span : 0;
}

export default function Header({ overHero }) {
  const { lang, t } = useI18n();
  const openForm = useOpenForm();
  const location = useLocation();
  const navigate = useNavigate();
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef(null);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const wrapRef = useRef(null);
  const needed = useRef(0); // wrap width the full nav needed when it last overflowed (0 = unknown)
  const [compact, setCompact] = useState(() => window.innerWidth <= NARROW);

  const [measureTick, setMeasureTick] = useState(0);

  // New text widths: start from the full layout again and re-measure.
  const remeasure = useCallback(() => {
    needed.current = 0;
    setCompact(window.innerWidth <= NARROW);
    setMeasureTick((n) => n + 1);
  }, []);

  useLayoutEffect(remeasure, [lang, remeasure]);

  // The script type tuning (<html data-script>, --f-lang) is applied by I18nProvider after this component
  // has measured, and the script font arrives later still: both change the nav width, so measure again.
  useEffect(() => {
    const mo = new MutationObserver(remeasure);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['lang', 'data-script', 'style'] });
    document.fonts?.addEventListener('loadingdone', remeasure);
    return () => {
      mo.disconnect();
      document.fonts?.removeEventListener('loadingdone', remeasure);
    };
  }, [remeasure]);

  // Runs before paint after every layout change, so an overflowing full nav is never shown.
  useLayoutEffect(() => {
    if (compact) return;
    const span = overflowSpan(wrapRef.current);
    if (span) {
      needed.current = span;
      setCompact(true);
    }
  }, [compact, lang, measureTick]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const onResize = () => {
      if (window.innerWidth <= NARROW) {
        setCompact(true);
      } else if (wrap.closest('.compact')) {
        if (!needed.current || contentWidth(wrap) >= needed.current) setCompact(false);
      } else {
        const span = overflowSpan(wrap);
        if (span) {
          needed.current = span;
          setCompact(true);
        }
      }
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrolled(window.scrollY > 10);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(frame);
    };
  }, []);

  // Logo on the home page: back to the top instead of a no-op navigation.
  const onLogo = (e) => {
    if (location.pathname !== `/${lang}`) return;
    e.preventDefault();
    if (location.hash) {
      navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: { keepScroll: true } });
    }
    window.scrollTo({ top: 0 });
  };

  return (
    <>
      <header className={`top${scrolled || !overHero ? ' solid' : ''}${compact ? ' compact' : ''}`}>
        <div className="wrap" ref={wrapRef}>
          <Link className="brand" to={`/${lang}`} aria-label={t('home_link')} onClick={onLogo}>
            <img src={mediaUrl('/media/logo/dfresh-logo-on-light.webp')} alt="" width="900" height="498" />
          </Link>
          <nav className="nav" aria-label={t('menu')}>
            {MAIN_LINKS.map((l) => (
              <Link key={l.key} to={linkTarget(lang, l)}>{t(l.key)}</Link>
            ))}
          </nav>
          <LanguageSwitch />
          <button className="btn b-ink b-sm bro" type="button" onClick={() => openForm('brochure')}>
            <DownloadIcon />
            <span className="lb-long">{t('brochure')}</span>
          </button>
          <button
            ref={menuButton}
            className="mnav"
            type="button"
            aria-label={t('menu')}
            aria-expanded={menuOpen}
            aria-controls={MENU_ID}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span />
          </button>
        </div>
      </header>
      <MobileMenu id={MENU_ID} open={menuOpen && compact} onClose={closeMenu} buttonRef={menuButton} compact={compact} />
    </>
  );
}
