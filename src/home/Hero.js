// Hero (spec B1): headline whose letters (words for long scripts) rise in on load and lift / tint gold near
// the pointer, lede, WhatsApp + all-products buttons, the tissue sheet (lazy chunk), falling petals,
// a leaf-icon trail on hover devices, and the stats strip from bootstrap.stats.
import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react';
import { useI18n } from '../i18n/useT';
import { useOpenProducts } from '../products/useOpenProducts';
import { mediaUrl } from '../utils/api';
import { trackWhatsApp, waHref } from '../utils/whatsapp';
import useReducedMotion from '../utils/useReducedMotion';
import useSpringField from '../utils/useSpringField';
import { WhatsAppIcon } from '../components/Icons';
import Petals from './Petals';
import './Hero.css';

const TissueSheet = lazy(() => import(/* webpackChunkName: "sheet" */ './TissueSheet'));

const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
const graphemes = (w) => (segmenter ? [...segmenter.segment(w)].map((s) => s.segment) : [...w]);

let introPlayed = false; // the rise-in plays once per page load, not on every language switch

function Line({ text, cls, byChar }) {
  return (
    <span className={`ln ${cls}`} aria-hidden="true">
      {text.split(' ').map((w, wi) => (
        <Fragment key={wi}>
          {wi > 0 && ' '}
          <span className="w">
            {byChar ? graphemes(w).map((c, ci) => <span className="ch" key={ci}>{c}</span>) : <span className="ch">{w}</span>}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

function LeafTrail({ heroRef }) {
  const reduced = useReducedMotion();
  useEffect(() => {
    const hero = heroRef.current;
    if (reduced || !hero || !window.matchMedia('(hover: hover)').matches || !Element.prototype.animate) return undefined;
    const src = mediaUrl('/media/logo/dfresh-icon.webp');
    let last = 0;
    let lx = 0;
    let ly = 0;
    const onMove = (e) => {
      const now = performance.now();
      if (now - last < 90 || Math.hypot(e.clientX - lx, e.clientY - ly) < 40) return;
      last = now;
      lx = e.clientX;
      ly = e.clientY;
      const im = document.createElement('img');
      im.src = src;
      im.className = 'trail';
      im.alt = '';
      document.body.appendChild(im);
      im.animate(
        [
          { transform: `translate(${e.clientX}px, ${e.clientY}px) scale(.4)`, opacity: 0.9 },
          { transform: `translate(${e.clientX + (Math.random() - 0.5) * 60}px, ${e.clientY + 50}px) scale(1.1) rotate(${(Math.random() - 0.5) * 120}deg)`, opacity: 0 },
        ],
        { duration: 1300, easing: 'cubic-bezier(.22, 1, .36, 1)' }
      ).onfinish = () => im.remove();
    };
    hero.addEventListener('pointermove', onMove);
    return () => hero.removeEventListener('pointermove', onMove);
  }, [heroRef, reduced]);
  return null;
}

export default function Hero() {
  const { t, settings, data, longScript } = useI18n();
  const openProducts = useOpenProducts();
  const reduced = useReducedMotion();
  const heroRef = useRef(null);
  const h1Ref = useRef(null);
  const l1 = t('hero_l1');
  const l2 = t('hero_l2');
  const byChar = !longScript;

  useSpringField(h1Ref, '.ch', { lift: 0.22, reach: 0.9, gold: true }, [l1, l2, byChar]);

  useLayoutEffect(() => {
    if (introPlayed) return;
    introPlayed = true;
    if (reduced || !Element.prototype.animate) return;
    h1Ref.current.querySelectorAll('.ch').forEach((el, i) => el.animate(
      [{ transform: 'translateY(70%) rotate(8deg)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 900, delay: 150 + i * 40, easing: 'cubic-bezier(.22, 1, .36, 1)', fill: 'backwards' }
    ));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const { stats } = data;
  const STATS = [[stats.products, 'st_p'], [stats.categories, 'st_c'], [stats.towns, 'st_t'], [stats.languages, 'st_l']];

  return (
    <section className="hero" id="top" aria-labelledby="h1" ref={heroRef}>
      <Petals />
      <LeafTrail heroRef={heroRef} />
      <div className="wrap">
        <div className="copy">
          <p className="k">{t('eyebrow')}</p>
          <h1 id="h1" ref={h1Ref} aria-label={`${l1} ${l2}`}>
            <Line text={l1} cls="ln1" byChar={byChar} />
            <Line text={l2} cls="ln2" byChar={byChar} />
          </h1>
          <p className="lede">{t('lede')}</p>
          <div className="ctas">
            <a
              className="btn b-wa"
              href={waHref(settings.whatsapp_number, t('wa_general'))}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => trackWhatsApp('general', 'hero')}
            >
              <WhatsAppIcon />
              <span>{t('whatsapp_us')}</span>
            </a>
            <button className="btn b-line" type="button" onClick={(e) => openProducts({}, e.currentTarget)}>
              {t('see_all_products')}
            </button>
          </div>
        </div>
        <Suspense fallback={<div className="sheet" aria-hidden="true"><div className="floor" /></div>}>
          <TissueSheet />
        </Suspense>
      </div>
      <div className="stats">
        <div className="wrap">
          {STATS.map(([n, key]) => (
            <div className="stat" key={key}><b>{n}</b><span>{t(key)}</span></div>
          ))}
        </div>
      </div>
    </section>
  );
}
