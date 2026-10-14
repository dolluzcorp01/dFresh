// Products drawer (spec C2). One component, two hosts:
// - overlay: /:lang/products pushed over the current page (ProductsOverlay in PublicApp); opens with a
//   growing circle from the clicked element, browser Back / Esc / X close it with the same circle.
// - page: a direct visit to /:lang/products (shared link); X goes to the home page.
// Page scroll is locked while open, focus is trapped inside and returns to the opener on close.
// Filter chips with counts (?cat= deep links), search, a grid of flip cards, empty message.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n/useT';
import { isModalOpen } from '../components/Modal';
import { lockScroll, unlockScroll } from '../utils/scrollLock';
import { track } from '../utils/track';
import useReducedMotion from '../utils/useReducedMotion';
import { filterChips, filterKey, filterProducts } from './filterProducts';
import FlipCard from './FlipCard';
import './ProductsDrawer.css';

const MS = 750; // circle transition (CSS .drawer)
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

let opener = null; // the element that opened the drawer, focused again on close
export function rememberOpener(el) {
  opener = el || null;
}

// inline: rendered in place instead of a portal into <body> (the products page: the server pre-renders it and
// the browser hydrates it, which a portal cannot do). It is position: fixed either way, so it looks the same.
export default function ProductsDrawer({ open, animate = true, inline = false, origin, cat, onCat, onClose, onExited }) {
  const { t, data } = useI18n();
  const reduced = useReducedMotion();
  const hId = useId();
  const ref = useRef(null);
  const searchRef = useRef(null);
  const [shown, setShown] = useState(!animate);
  const [q, setQ] = useState('');
  const filter = filterKey(cat, data.categories);
  const list = filterProducts(data.products, filter, q, data.categories);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Open: next frame, so the circle grows from 0. Close: shrink, then let the host unmount.
  useLayoutEffect(() => {
    if (!open) {
      setShown(false);
      const id = setTimeout(() => onExited && onExited(), animate && !reduced ? MS : 0);
      return () => clearTimeout(id);
    }
    if (!animate || reduced) {
      setShown(true);
      return undefined;
    }
    let id = requestAnimationFrame(() => { id = requestAnimationFrame(() => setShown(true)); });
    return () => cancelAnimationFrame(id);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // New list (filter chip, ?cat= category, search, also on first show): if the first card's top is under the
  // sticky bar (title + search + filter chips, its real height: Tamil chips can wrap to two lines), scroll up
  // until it sits fully visible just below it, with the grid's own top padding as the gap. Instant with
  // reduced motion, smooth otherwise. Nothing moves when the first card is already visible.
  // Layout positions (offsetTop), not getBoundingClientRect: new cards rise in with a transform. Next frame,
  // and instant for a search change: while typing, the browser scrolls to show the caret after each key,
  // which cancels any smooth scroll (measured: the first card stayed 66 px under the bar).
  const lastQ = useRef(q);
  useEffect(() => {
    const typing = lastQ.current !== q;
    lastQ.current = q;
    const id = requestAnimationFrame(() => {
      const el = ref.current;
      const bar = el && el.querySelector('.dh');
      const grid = el && el.querySelector('.grid4');
      if (!bar || !grid) return;
      let top = 0; // the first card's top in the drawer's scrolled content (the drawer is fixed = offsetParent)
      let n = grid.firstElementChild || grid;
      for (; n && n !== el; n = n.offsetParent) top += n.offsetTop;
      if (n !== el) return;
      const gap = parseFloat(getComputedStyle(grid).paddingTop) || 0;
      const target = Math.max(0, top - bar.offsetHeight - gap);
      if (el.scrollTop <= target + 1) return;
      el.scrollTo({ top: target, behavior: reduced || typing ? 'auto' : 'smooth' });
    });
    return () => cancelAnimationFrame(id);
  }, [filter, q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll lock, Esc, focus trap and focus in / out, for as long as the drawer is mounted.
  useEffect(() => {
    lockScroll();
    const back = opener;
    const el = ref.current;
    // A phone keyboard popping up over the grid on every open helps nobody: focus the search box only
    // where there is a mouse; on touch, the dialog itself takes focus.
    const focusId = setTimeout(() => {
      const target = window.matchMedia('(hover: hover)').matches ? searchRef.current : el;
      if (target && el && !el.contains(document.activeElement)) target.focus({ preventScroll: true });
    }, animate && !reduced ? 400 : 0);
    const onKey = (e) => {
      if (isModalOpen()) return; // a form over the drawer handles its own keys
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll(FOCUSABLE)].filter((x) => x.offsetParent !== null && !x.closest('[inert]'));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(focusId);
      document.removeEventListener('keydown', onKey);
      unlockScroll();
      if (back && document.contains(back)) back.focus({ preventScroll: true });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // GA4 search: once the visitor stops typing.
  useEffect(() => {
    if (!q.trim()) return undefined;
    const id = setTimeout(() => track('search', { query_length: q.trim().length }), 800);
    return () => clearTimeout(id);
  }, [q]);

  const pickFilter = (key) => {
    if (key === filter) return;
    track('filter_use', { filter: key });
    onCat(key);
  };

  const style = origin ? { '--ox': `${origin.x}px`, '--oy': `${origin.y}px` } : undefined;

  const drawer = (
    <div
      ref={ref}
      className={`drawer${shown ? ' open' : ''}${animate ? '' : ' still'}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={hId}
      tabIndex={-1}
      style={style}
    >
      <div className="dh">
        <div className="wrap">
          <h2 id={hId}>{t('all_h')}</h2>
          <label className="search">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
            <input
              ref={searchRef}
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search_label')}
              enterKeyHint="search"
              autoComplete="off"
            />
          </label>
          <button className="xbtn" type="button" aria-label={t('close')} onClick={onClose}>
            {/* a drawn cross (same as the modals): a text "×" sits on the font's baseline, a little off centre */}
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" /></svg>
          </button>
        </div>
        <div className="wrap">
          <div className="filters">
            {filterChips(data.products, data.categories, t).map((c) => (
              <button key={c.key} type="button" aria-pressed={c.key === filter} onClick={() => pickFilter(c.key)}>
                {c.label}<span>{c.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="wrap">
        <div className="grid4">
          {list.length
            ? list.map((p, i) => <FlipCard key={p.id} product={p} index={i} eager={inline && i === 0} />)
            : <p className="empty" role="status">{t('none')}</p>}
        </div>
      </div>
    </div>
  );
  return inline ? drawer : createPortal(drawer, document.body);
}
