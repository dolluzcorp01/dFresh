// The admin header (v23 .head): sticky, 60 px. Left: the menu button (children) and the godown picker; right: the
// website link, the approvals count, the alerts bell and who is signed in (their menu has Sign out).
// - Godown picker (phase 12a): the godowns the person works at; "All godowns" (all of theirs) when they work at more than
//   one. The choice is remembered per person (localStorage) and sent with every API call (adminApi setGodown, header
//   X-Godown), which narrows every list and figure; changing it reloads the page so everything on it follows.
// - Alerts bell: what needs a look today from the counts the admin already loads (new enquiries, approvals waiting);
//   phase 23: plus the unread alerts of Home > Alerts, and "Mark all alerts read" (the Alerts page itself is the list only, as v23).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import LIcon from './ui/LIcon';
import { Avatar } from './ui';
import { can } from '../shared/permissions';
import { api, setGodown } from './adminApi';

const GODOWN_KEY = 'dfresh-admin-godown:'; // + emp_id
const savedRaw = (emp) => { try { return window.localStorage.getItem(GODOWN_KEY + emp); } catch { return null; } };
/** the godown picked before (still one the person works at), their only godown, or null = all of theirs */
export function savedGodown(me) {
  const list = (me && me.godown_list) || [];
  const id = Number(savedRaw(me && me.emp_id));
  if (id && list.some((g) => Number(g.godown_id) === id)) return id;
  return me && me.godowns !== 'ALL' && list.length === 1 ? Number(list[0].godown_id) : null;
}

function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return { open, setOpen, ref };
}

const Dot = ({ n }) => (n > 0 ? <span className="a-dot2" aria-hidden="true">{n > 99 ? '99+' : n}</span> : null);

function GodownPicker({ me }) {
  const list = me.godown_list || [];
  const all = me.godowns === 'ALL' || list.length > 1;
  const now = savedGodown(me);
  const pick = (v) => {
    try { if (v) window.localStorage.setItem(GODOWN_KEY + me.emp_id, v); else window.localStorage.removeItem(GODOWN_KEY + me.emp_id); } catch { /* storage off: this tab only */ }
    setGodown(v || null);
    window.location.reload();
  };
  return (
    <label className="a-hchip a-no-phone" title="Which godown you are working in">
      <LIcon name="warehouse" size="sm" />
      <select aria-label="Godown" value={now ? String(now) : ''} onChange={(e) => pick(e.target.value)} disabled={!all && list.length <= 1}>
        {all && <option value="">All godowns</option>}
        {list.map((g) => <option key={g.godown_id} value={String(g.godown_id)}>{g.name}</option>)}
        {!list.length && <option value="">No godown</option>}
      </select>
    </label>
  );
}

export default function HeaderBar({ me, newLeads, approvals, alertCount = 0, onCounts, onLogout, children }) {
  const bell = useDropdown();
  const who = useDropdown();
  const seesLeads = can(me.perms, 'leads', 'view');
  const seesApprovals = Boolean(me.commerce_enabled);
  const alerts = [
    seesLeads && newLeads > 0 && { to: '/admin/leads', icon: 'inbox', text: `${newLeads} new ${newLeads === 1 ? 'enquiry' : 'enquiries'}`, sub: 'Sales / Leads / Enquiries' },
    seesApprovals && approvals > 0 && { to: '/admin/approvals', icon: 'clipboard-check', text: `${approvals} ${approvals === 1 ? 'request waits' : 'requests wait'} for your decision`, sub: 'Home / Approvals' },
    // phase 23: Home > Alerts (worked out live; unread ones counted)
    seesApprovals && alertCount > 0 && { to: '/admin/alerts', icon: 'bell', text: `${alertCount} unread alert${alertCount === 1 ? '' : 's'}`, sub: 'Home / Alerts' },
  ].filter(Boolean);
  const count = (seesLeads ? newLeads : 0) + (seesApprovals ? alertCount : 0);
  return (
    <header className="a-head">
      {children}
      <GodownPicker me={me} />
      <span className="a-sp" />
      <a className="a-iconbtn" href="/en" target="_blank" rel="noopener noreferrer" aria-label="User Interface - opens the website in a new tab" title="User Interface (opens the website in a new tab)">
        <LIcon name="globe" />
      </a>
      {seesApprovals && (
        <Link className="a-iconbtn" to="/admin/approvals" aria-label={`Approvals: ${approvals} waiting for you`} title="Approvals waiting for you">
          <LIcon name="clipboard-check" /><Dot n={approvals} />
        </Link>
      )}
      <div className="a-dd" ref={bell.ref}>
        <button type="button" className="a-iconbtn" aria-label={`Alerts: ${count}`} aria-expanded={bell.open} aria-haspopup="menu" onClick={() => bell.setOpen(!bell.open)}>
          <LIcon name="bell" /><Dot n={count} />
        </button>
        {bell.open && (
          <div className="a-menu a-menu-right" role="menu" aria-label="Alerts">
            <div className="a-menu-h">Alerts</div>
            {alerts.length ? alerts.map((a) => (
              <Link key={a.to} role="menuitem" className="a-note2" to={a.to} onClick={() => bell.setOpen(false)}>
                <span className="a-note2-i a-tone-warn"><LIcon name={a.icon} size="sm" /></span>
                <span><b>{a.text}</b><span>{a.sub}</span></span>
              </Link>
            )) : <p className="a-menu-empty">Nothing needs a look right now.</p>}
            {seesApprovals && alertCount > 0 && (
              <button type="button" role="menuitem" className="a-menu-item" onClick={() => api.send('POST', '/alerts/read-all').then(() => { bell.setOpen(false); if (onCounts) onCounts(); }, () => {})}>
                <LIcon name="check" size="sm" />Mark all alerts read
              </button>
            )}
          </div>
        )}
      </div>
      <div className="a-dd" ref={who.ref}>
        <button type="button" className="a-me" aria-label={`Signed in as ${me.name}, ${me.role_name}`} aria-expanded={who.open} aria-haspopup="menu" onClick={() => who.setOpen(!who.open)}>
          <Avatar name={me.name} photo={me.photo} size={36} />
          <span className="a-me-t"><b>{me.name}</b><span>{me.role_name}</span></span>
          <LIcon name="chevron-down" size="sm" />
        </button>
        {who.open && (
          <div className="a-menu a-menu-right" role="menu" aria-label="My account">
            <div className="a-menu-h">{me.name} <code>{me.emp_id}</code></div>
            <p className="a-menu-empty">{me.role_name}</p>
            <hr />
            <button type="button" role="menuitem" className="a-menu-item a-menu-danger" onClick={onLogout}><LIcon name="log-out" size="sm" />Sign out</button>
          </div>
        )}
      </div>
    </header>
  );
}
