// Live admin: every 15 s while the tab is visible (and at once when it becomes visible again) ask the API whether
// leads arrived since the newest one seen (GET /leads/changes?since=<lead_id>). New leads bump `version` (the Leads list
// and the Dashboard refresh quietly when it changes) and give a short toast; `newLeads` feeds the sidebar badge.
// Errors (server down, signed out) are ignored: the next try comes at the same 15 s pace, no popup.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './adminApi';

const EVERY_MS = 15000;
const TOAST_MS = 6000;

export default function useLeadPulse(enabled) {
  const [version, setVersion] = useState(0);
  const [newLeads, setNewLeads] = useState(null); // null until the first answer
  const [toast, setToast] = useState(null);
  const last = useRef(null); // newest lead_id seen
  const busy = useRef(false);

  const check = useCallback(async () => {
    if (busy.current || document.visibilityState !== 'visible') return;
    busy.current = true;
    try {
      const d = await api.get(`/leads/changes${last.current === null ? '' : `?since=${last.current}`}`);
      setNewLeads(d.newLeads);
      if (last.current !== null && d.added > 0) {
        setVersion((v) => v + 1);
        setToast(`${d.added} new lead${d.added === 1 ? '' : 's'}`);
      }
      last.current = d.lastId;
    } catch {
      // unreachable or signed out: try again on the next tick
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    check();
    const id = setInterval(check, EVERY_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible); };
  }, [enabled, check]);

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  return { version, newLeads, toast, dismissToast: () => setToast(null) };
}
