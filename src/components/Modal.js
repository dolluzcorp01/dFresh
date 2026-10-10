// Modal shell: portal, scrim, focus trap, Esc closes the top-most only, focus returns to the opener,
// page scroll locked while any modal is open. Modals stack (a legal overlay over a form).
import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n/useT';
import { lockScroll, unlockScroll } from '../utils/scrollLock';
import './Modal.css';

const stack = []; // open modal ids, top-most last
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// true while any modal is open (the products drawer leaves Esc and Tab to the modal on top of it)
export function isModalOpen() {
  return stack.length > 0;
}

// `before`: shown above the title (e.g. the logo).
export default function Modal({ open, onClose, title, className = '', before = null, children }) {
  const t = useT();
  const id = useId();
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const opener = document.activeElement;
    stack.push(id);
    lockScroll();
    const dialog = dialogRef.current;
    const first = dialog.querySelector('[data-autofocus]') || dialog.querySelector(FOCUSABLE) || dialog;
    first.focus({ preventScroll: true });

    const onKey = (e) => {
      if (stack[stack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        const items = [...dialog.querySelectorAll(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) {
          e.preventDefault();
          return;
        }
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && (document.activeElement === firstEl || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && (document.activeElement === lastEl || !dialog.contains(document.activeElement))) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      stack.splice(stack.indexOf(id), 1);
      unlockScroll();
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [open, id]);

  if (!open) return null;
  const depth = stack.includes(id) ? stack.indexOf(id) : stack.length; // modals already open below this one
  return createPortal(
    <div
      className="scrim"
      style={{ zIndex: 70 + depth * 2 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className={`modal${className ? ` ${className}` : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-h`}
        tabIndex={-1}
      >
        <button type="button" className="btn b-line xbtn" onClick={onClose} aria-label={t('close')}>×</button>
        {before}
        <h3 id={`${id}-h`}>{title}</h3>
        {children}
      </div>
    </div>,
    document.body
  );
}
