// Toasts (v23): short messages bottom right after an action, in four tones, read by screen readers (aria-live).
// They close by themselves (good / info after 5 s, warn / bad after 8 s, a long text 10 s; hovering keeps them) or
// with their X. Messages belong to the page they came from: changing page clears them.
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import LIcon from './LIcon';

const ToastContext = createContext(null);
/** toast(tone, title, text?) -> shows a toast; null outside the admin shell (callers then show the message inline). */
export const useToast = () => useContext(ToastContext);

const ICON = { good: 'circle-check', bad: 'circle-x', warn: 'triangle-alert', info: 'info' };
let seq = 0;

function ToastItem({ t, onClose }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return undefined;
    const long = `${t.title} ${t.text || ''}`.length > 90;
    const ms = long ? 10000 : t.tone === 'bad' || t.tone === 'warn' ? 8000 : 5000;
    const id = setTimeout(() => onClose(t.id), ms);
    return () => clearTimeout(id);
  }, [paused, t, onClose]);
  return (
    <div className={`a-tst a-tst-${t.tone}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <LIcon name={ICON[t.tone] || 'info'} />
      <div className="a-tst-tx"><b>{t.title}</b>{t.text && <span>{t.text}</span>}</div>
      <button type="button" className="a-iconbtn a-iconbtn-28" onClick={() => onClose(t.id)} aria-label="Dismiss"><LIcon name="x" size="sm" /></button>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [list, setList] = useState([]);
  const { pathname } = useLocation();
  const first = useRef(true);
  const toast = useCallback((tone, title, text) => {
    seq += 1;
    const t = { id: seq, tone: ICON[tone] ? tone : tone === 'ok' ? 'good' : tone === 'error' ? 'bad' : 'info', title: String(title), text: text ? String(text) : '' };
    setList((l) => [...l.slice(-3), t]); // at most 4 on screen
  }, []);
  const close = useCallback((id) => setList((l) => l.filter((x) => x.id !== id)), []);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setList([]);
  }, [pathname]);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="a-toasts" aria-live="polite" role="status">
        {list.map((t) => <ToastItem key={t.id} t={t} onClose={close} />)}
      </div>
    </ToastContext.Provider>
  );
}
