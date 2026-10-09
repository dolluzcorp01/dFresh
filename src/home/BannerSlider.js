// "dFresh moods" banner slider (spec B2): active banners in sort order, <picture> mobile / desktop files,
// HTML overlay (eyebrow, headline, CTA), cross-fade + slow zoom, auto-advance every 6 s with dot progress
// bars, paused on hover / focus / touch and while off screen or the tab is hidden, arrows, swipe.
// Reduced motion: no auto-advance. GA4 banner_click.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../i18n/useT';
import { useOpenForm } from '../forms/FormsProvider';
import { useOpenProducts } from '../products/useOpenProducts';
import { linkTarget } from '../components/navLinks';
import { mediaUrl } from '../utils/api';
import { afterLoad, watchActive } from '../utils/loop';
import { track } from '../utils/track';
import useReducedMotion from '../utils/useReducedMotion';
import './BannerSlider.css';

const DURATION = 6000; // keep in step with the bnfill animation in BannerSlider.css

function BannerCta({ banner, lang, tabIndex }) {
  const openProducts = useOpenProducts();
  const openForm = useOpenForm();
  const { key, theme, ctaAction, ctaTarget, ctaLabel } = banner;
  const cls = `btn ${theme === 'dark' ? 'b-gold' : 'b-ink'}`;
  const label = <><span>{ctaLabel}</span> <span aria-hidden="true">→</span></>;
  const onTrack = () => track('banner_click', { banner: key });

  if (ctaAction === 'section') {
    return <Link className={cls} to={linkTarget(lang, { hash: ctaTarget })} tabIndex={tabIndex} onClick={onTrack}>{label}</Link>;
  }
  const onClick = (e) => {
    onTrack();
    if (ctaAction === 'form') openForm(ctaTarget);
    else if (ctaAction === 'products_home') openProducts({ filter: 'home' }, e.currentTarget);
    else if (ctaAction === 'products_category') openProducts({ category: ctaTarget }, e.currentTarget);
    else openProducts({}, e.currentTarget);
  };
  return <button className={cls} type="button" tabIndex={tabIndex} onClick={onClick}>{label}</button>;
}

export default function BannerSlider() {
  const { t, lang, data } = useI18n();
  const banners = data.banners;
  const n = banners.length;
  const reduced = useReducedMotion();
  const secRef = useRef(null);
  // `cycle` restarts the timer and the dot's progress bar, also when the same banner is picked again
  const [{ i, cycle }, setPos] = useState({ i: 0, cycle: 0 });
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [touch, setTouch] = useState(false);
  const [active, setActive] = useState(true);
  const remaining = useRef(DURATION);
  const cycleRef = useRef(0); // the cycle `remaining` belongs to
  const x0 = useRef(null);
  // Hidden slides share the visible slide's box, so loading="lazy" would fetch them all at once. A slide
  // gets its <picture> when it is shown; the next one is fetched ahead, but only after the page has loaded.
  const mounted = useRef(new Set([0]));
  const [pageLoaded, setPageLoaded] = useState(false);
  useEffect(() => afterLoad(() => setPageLoaded(true), 1000), []);
  const paused = hover || focus || touch || !active;

  const go = useCallback((to) => {
    remaining.current = DURATION;
    cycleRef.current += 1;
    const c = cycleRef.current;
    setPos({ i: ((to % n) + n) % n, cycle: c });
  }, [n]);

  // a different banner list (language switch, admin edit) never leaves the index out of range
  useEffect(() => {
    if (i >= n) go(0);
  }, [i, n, go]);

  useEffect(() => watchActive(secRef.current, setActive), []);

  // Auto-advance: the time left survives a pause, so the timer matches the paused progress bar.
  useEffect(() => {
    if (reduced || paused || n < 2) return undefined;
    const started = performance.now();
    const id = setTimeout(() => go(i + 1), remaining.current);
    return () => {
      clearTimeout(id);
      // a pause keeps the time left; a new banner (go) already reset it
      if (cycleRef.current === cycle) remaining.current = Math.max(0, remaining.current - (performance.now() - started));
    };
  }, [i, cycle, paused, reduced, n, go]);

  if (!n) return null;

  // keyboard focus pauses; a tap or click on a dot / arrow does not (it would never resume on a phone)
  const onBlur = (e) => {
    if (!secRef.current.contains(e.relatedTarget)) setFocus(false);
  };
  const onTouchStart = (e) => {
    x0.current = e.touches[0].clientX;
    setTouch(true);
  };
  const onTouchEnd = (e) => {
    setTouch(false);
    if (x0.current == null) return;
    const dx = e.changedTouches[0].clientX - x0.current;
    x0.current = null;
    if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
  };

  return (
    <section
      ref={secRef}
      className={`bnr${paused ? ' paused' : ''}`}
      id="moods"
      aria-roledescription="carousel"
      aria-label={t('bn_label')}
      onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
      onFocus={(e) => setFocus(e.target.matches(':focus-visible'))}
      onBlur={onBlur}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => setTouch(false)}
    >
      <div className="bnr-slides">
        {banners.map((b, k) => {
          const on = k === i;
          if (on || (pageLoaded && k === (i + 1) % n)) mounted.current.add(k);
          const show = mounted.current.has(k);
          return (
            <div
              key={b.key}
              className={`bs${b.theme === 'dark' ? ' dark' : ''}${on ? ' on' : ''}`}
              role="group"
              aria-roledescription="slide"
              aria-label={`${k + 1} / ${n}`}
              aria-hidden={!on}
              inert={!on}
            >
              {show ? (
                <picture>
                  <source media="(max-width: 700px)" srcSet={mediaUrl(b.mobile)} width="1080" height="1350" />
                  <img
                    src={mediaUrl(b.desktop)}
                    alt=""
                    width="1920"
                    height="800"
                    draggable="false"
                    loading={k === 0 ? 'lazy' : 'eager'}
                    decoding="async"
                  />
                </picture>
              ) : <div className="bs-ph" />}
              <div className="cap">
                <div className="wrap">
                  <div className="ci">
                    <p className="k">{t('bn_k')}</p>
                    <h2>{b.headline}</h2>
                    <BannerCta banner={b} lang={lang} tabIndex={on ? 0 : -1} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {n > 1 && (
        <div className="bnr-ui">
          <div className="wrap">
            <div className="bnr-dots" role="tablist" aria-label={t('bn_label')}>
              {banners.map((b, k) => (
                <button
                  key={b.key}
                  type="button"
                  role="tab"
                  aria-label={t('bn_goto', { n: k + 1 })}
                  aria-selected={k === i}
                  onClick={() => go(k)}
                >
                  <i key={k === i ? cycle : 'idle'} />
                </button>
              ))}
            </div>
            <div className="bnr-arrows">
              <button type="button" aria-label={t('bn_prev')} onClick={() => go(i - 1)}>←</button>
              <button type="button" aria-label={t('bn_next')} onClick={() => go(i + 1)}>→</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
