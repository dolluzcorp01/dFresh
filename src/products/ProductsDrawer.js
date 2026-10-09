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

export default function ProductsDrawer({ open, animate = true, origin, cat, onCat, onClose, onExited }) {
  const { t, data } = useI18n();
  const reduced = useReducedMotion();
  const hId = useId();
  const ref = useRef(null);
  const searchRef = useRef(null);
  const [shown, setShown] = useState(!animate);
  const [q, setQ] = useState('');
  const filter = filterKey(cat, data.categories);
  const list = filterProducts(data.products, filter, q);
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

  return createPortal(
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
          <button className="xbtn" type="button" aria-label={t('close')} onClick={onClose}>×</button>
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
            ? list.map((p, i) => <FlipCard key={p.id} product={p} index={i} />)
            : <p className="empty" role="status">{t('none')}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
