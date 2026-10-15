// Drag-to-reorder never saves by itself. A drag changes a local order (per list, "scope"); a sticky bar at the bottom
// says "Order changed" with Save order / Cancel (Cancel = the last saved order). While an order is unsaved:
// - opening a drawer (guard) or following an admin link asks "Save or discard?" (Save order / Discard / Keep editing);
// - reloading or closing the tab gets the browser's own warning.
// Save posts each changed list (the server writes the audit log entry) and shows a short "Order saved" toast.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

const ASK = 'You have an unsaved order. Save or discard?';

/** saveOne(scope, ids) posts one list; onSaved() reloads the page data. */
export default function useOrderDraft(saveOne, onSaved) {
  const navigate = useNavigate();
  const [pending, setPending] = useState({}); // scope -> ids in the new order
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [toast, setToast] = useState(false);
  const [ask, setAsk] = useState(null); // { then } while the "save or discard" question is open
  const dirty = Object.keys(pending).length > 0;
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;

  const order = useCallback((scope, savedIds) => pending[scope] || savedIds, [pending]);
  const set = (scope, ids, savedIds) => {
    setError(null);
    setPending((p) => {
      const next = { ...p };
      if (savedIds && ids.join('\u0000') === savedIds.join('\u0000')) delete next[scope]; // dragged back: nothing to save
      else next[scope] = ids;
      return next;
    });
  };
  const cancel = () => { setPending({}); setError(null); };
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const [scope, ids] of Object.entries(pending)) await saveOne(scope, ids);
      setPending({});
      await onSaved();
      setToast(true);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  /** Runs `then` now, or after the visitor saved / discarded the unsaved order. */
  const guard = (then) => (dirtyRef.current ? setAsk({ then }) : then());

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(false), 2500);
    return () => clearTimeout(id);
  }, [toast]);

  // leaving: the tab (browser warning) and admin links (our question, then follow the link)
  useEffect(() => {
    if (!dirty) return undefined;
    const onUnload = (e) => { e.preventDefault(); e.returnValue = ''; };
    const onClick = (e) => {
      const a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      setAsk({ then: () => navigate(url.pathname + url.search + url.hash) });
    };
    window.addEventListener('beforeunload', onUnload);
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, navigate]);

  const answer = async (choice) => {
    const then = ask && ask.then;
    setAsk(null);
    if (choice === 'keep') return;
    if (choice === 'save' && !(await save())) return; // a failed save stays on the page with its error
    if (choice === 'discard') cancel();
    if (then) then();
  };

  const ui = (
    <>
      {dirty && (
        <div className="a-orderbar" role="region" aria-label="Unsaved order">
          <strong>Order changed</strong>
          <span className="a-muted">{error ? '' : 'Not saved yet: the site still shows the old order.'}</span>
          {error && <span className="a-bad">{error}</span>}
          <span className="a-orderbar-btns">
            <button type="button" className="a-btn" onClick={save} disabled={busy}>{busy ? 'Saving...' : 'Save order'}</button>
            <button type="button" className="a-btn a-btn-ghost" onClick={cancel} disabled={busy}>Cancel</button>
          </span>
        </div>
      )}
      {toast && <div className="a-toast" role="status">Order saved</div>}
      {ask && <AskDialog onAnswer={answer} busy={busy} />}
    </>
  );
  return { order, set, dirty, guard, ui };
}

function AskDialog({ onAnswer, busy }) {
  const first = useRef(null);
  const answerRef = useRef(onAnswer);
  answerRef.current = onAnswer;
  useEffect(() => {
    if (first.current) first.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); answerRef.current('keep'); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return (
    <div className="a-ask-wrap" role="presentation">
      <div className="a-ask" role="alertdialog" aria-modal="true" aria-labelledby="a-ask-q">
        <p id="a-ask-q">{ASK}</p>
        <div className="a-row">
          <button ref={first} type="button" className="a-btn" disabled={busy} onClick={() => onAnswer('save')}>Save order</button>
          <button type="button" className="a-btn a-btn-ghost" disabled={busy} onClick={() => onAnswer('discard')}>Discard</button>
          <button type="button" className="a-link" onClick={() => onAnswer('keep')}>Keep editing</button>
        </div>
      </div>
    </div>
  );
}
