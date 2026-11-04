// Admin left menu (Stage 2, v23 look): the brand box, "Find a page...", the 13 groups and Online store of
// docs/STAGE2-MENU-GUIDE.txt (menu.js, built by scripts/admin-check/menu-build.py) with their sub-groups and pages, and
// who is signed in at the foot. What a user sees comes from menuAccess.js: entries their role cannot open are not shown
// (the API enforces roles anyway), a sub-group or group left empty is not shown, and with Commerce switched off only
// the live site's screens are listed.
// - The group (and sub-group) of the current page opens by itself and its page is highlighted.
// - Which groups and sub-groups are open is remembered per user (and per browser); whether the menu is collapsed to
//   icons, per browser (localStorage, in try / catch: a private window or blocked storage just starts with defaults).
// - Collapsed (desktop): the group icons only, names as tooltips (and still read by screen readers); a click on a group
//   expands the menu with that group open.
// - Under 900px: a slide-in drawer with the same groups (never collapsed); a link, the backdrop or Esc closes it.
// - Group and sub-group headers are buttons with aria-expanded / aria-controls (Tab + Enter / Space).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import LIcon from './ui/LIcon';
import { Avatar } from './ui';
import { GROUP_ICON, activeEntry, flatEntries, hrefOf, menuFor } from './menuAccess';
import { mediaUrl } from '../utils/api';

const GROUPS_KEY = 'dfresh-admin-nav-groups'; // + ':' + emp_id: remembered per user
const COLLAPSED_KEY = 'dfresh-admin-nav-collapsed';
export const saved = {
  get(key, fallback) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage off: not remembered */ }
  },
};
export const savedCollapsed = () => saved.get(COLLAPSED_KEY, false) === true;
export const saveCollapsed = (v) => saved.set(COLLAPSED_KEY, Boolean(v));

const NARROW = '(max-width: 900px)';
export function useNarrow() {
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return narrow;
}

const Badge = ({ n, what }) => (n > 0 ? <span className="a-ncount">{n}<span className="a-sr"> {what}</span></span> : null);

export default function Sidebar({ me, drawerOpen, onCloseDrawer, collapsed, onToggleCollapsed, newLeads, approvals }) {
  const { pathname, search, hash } = useLocation();
  const narrow = useNarrow();
  const compact = collapsed && !narrow;
  const menu = useMemo(() => menuFor(me), [me]);
  const at = activeEntry(menu, pathname, search, hash);
  const groupsKey = `${GROUPS_KEY}:${(me && me.emp_id) || ''}`;
  const [open, setOpen] = useState(() => saved.get(groupsKey, {}));
  const [q, setQ] = useState('');
  const findRef = useRef(null);

  // The current page's group and sub-group open by themselves (and stay open, like a click would).
  const curGroup = at ? at.group.key : null;
  const curSub = at && at.sub ? at.sub.key : null;
  useEffect(() => {
    if (!curGroup) return;
    setOpen((o) => {
      if (o[curGroup] && (!curSub || o[curSub])) return o;
      const next = { ...o, [curGroup]: true, ...(curSub ? { [curSub]: true } : {}) };
      saved.set(groupsKey, next);
      return next;
    });
  }, [curGroup, curSub, groupsKey]);

  const toggle = (key) => setOpen((o) => {
    const next = { ...o, [key]: !o[key] };
    saved.set(groupsKey, next);
    return next;
  });

  // Drawer (narrow screens): Esc closes it. "/" anywhere outside a field: Find a page.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && drawerOpen) onCloseDrawer(true);
      const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]');
      if (e.key === '/' && !typing && !compact && findRef.current) { e.preventDefault(); findRef.current.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, onCloseDrawer, compact]);

  const navigate = () => { setQ(''); if (narrow) onCloseDrawer(false); };
  const badgeFor = (e) => (e.id === 'sales/leads/enquiries' ? newLeads : e.id === 'home/approvals' ? approvals : 0);
  const isOn = (e) => Boolean(at && at.entry.id === e.id);

  const page = (e, extra) => (
    <Link key={e.id} to={hrefOf(e.target)} className={`a-np${isOn(e) ? ' on' : ''}`} aria-current={isOn(e) ? 'page' : undefined} onClick={navigate}>
      <span className="a-np-l">{e.label}{extra}</span>
      {e.tag === 'later' && <span className="a-tg a-tg-later">Later</span>}
      {e.tag === 'not built yet' && <span className="a-tg a-tg-later">Not built</span>}
      <Badge n={badgeFor(e)} what={e.id === 'home/approvals' ? 'waiting' : 'new'} />
    </Link>
  );

  const query = q.trim().toLowerCase();
  const hits = query ? flatEntries(menu).filter(({ group, sub, entry }) => `${entry.label} ${entry.see || ''} ${group.label} ${sub ? sub.label : ''}`.toLowerCase().includes(query)) : null;

  return (
    <>
      {narrow && drawerOpen && <div className="a-nav-backdrop" onClick={() => onCloseDrawer(false)} aria-hidden="true" />}
      <aside id="a-nav" className={`a-side${drawerOpen ? ' open' : ''}${compact ? ' mini' : ''}`} aria-label="Main menu">
        <Link to="/admin" className="a-brand2" onClick={navigate} aria-label="dFresh Back Office - home">
          <span className="a-logo"><img src={mediaUrl((me && me.logo_square) || '/media/logo/favicon-32.png')} alt="" width="24" height="24" /></span>
          <span className="a-brand2-t"><b>dFresh</b><small>Back Office</small></span>
        </Link>
        {!compact && (
          <div className="a-side-search">
            <label>
              <LIcon name="search" size="sm" />
              <input ref={findRef} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a page..."
                aria-label="Find a page in the menu" autoComplete="off" />
              <kbd aria-hidden="true">/</kbd>
            </label>
          </div>
        )}
        <nav className="a-navlist" aria-label="Admin">
          {hits ? (
            hits.length ? hits.map(({ group, sub, entry }) => page(entry, <small className="a-np-where">{group.label}{sub ? ` / ${sub.label}` : ''}</small>))
              : <div className="a-nores">No page called &quot;{q}&quot;.</div>
          ) : menu.map((g) => {
            const icon = <LIcon name={GROUP_ICON[g.key] || 'list-todo'} />;
            if (g.solo) {
              return (
                <Link key={g.key} to={hrefOf(g.target)} className={`a-ng a-ng-solo${isOn(g) ? ' on' : ''}`} onClick={navigate}
                  title={compact ? g.label : undefined} aria-current={isOn(g) ? 'page' : undefined}>
                  {icon}<span className="a-lbl">{g.label}</span>{!compact && g.tag === 'later' && <span className="a-tg a-tg-later">Later</span>}
                </Link>
              );
            }
            const shown = !compact && Boolean(open[g.key]);
            const id = `a-grp-${g.key}`;
            const sum = flatEntries([g]).reduce((n, x) => n + (badgeFor(x.entry) || 0), 0);
            return (
              <div key={g.key} className={`a-grp2${shown ? ' open' : ''}`}>
                <button type="button" className={`a-ng${curGroup === g.key ? ' cur' : ''}`} aria-expanded={shown} aria-controls={id}
                  title={compact ? g.label : undefined}
                  onClick={() => { if (compact) { onToggleCollapsed(); if (!open[g.key]) toggle(g.key); } else toggle(g.key); }}>
                  {icon}<span className="a-lbl">{g.label}</span>
                  {!shown && <Badge n={sum} what="waiting" />}
                  <LIcon name="chevron-right" size="sm" className="a-chev" />
                </button>
                {shown && (
                  <div id={id} className="a-kids">
                    {g.kids.map((k) => {
                      if (!k.kids) return page(k);
                      const so = Boolean(open[k.key]);
                      const sid = `a-sub-${k.key.replace(/\W+/g, '-')}`;
                      const ssum = k.kids.reduce((n, e) => n + (badgeFor(e) || 0), 0);
                      return (
                        <div key={k.key} className={`a-sub${so ? ' open' : ''}`}>
                          <button type="button" className="a-nsg" aria-expanded={so} aria-controls={sid} onClick={() => toggle(k.key)}>
                            <span className="a-lbl">{k.label}</span>
                            {k.tag === 'not built yet' && <span className="a-tg a-tg-later">Not built</span>}
                            {!so && <Badge n={ssum} what="waiting" />}
                            <LIcon name="chevron-right" size="sm" className="a-chev" />
                          </button>
                          {so && <div id={sid} className="a-kids">{k.kids.map((e) => page(e))}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
        <div className="a-side-foot">
          <Avatar name={me && me.name} photo={me && me.photo} size={36} />
          <span className="a-who2"><b>{me && me.name}</b><span>{me && me.role_name}</span></span>
        </div>
      </aside>
    </>
  );
}

/**
 * The menu button in the header: desktop collapses / expands the menu to icons (remembered per browser); under 900px it
 * opens / closes the drawer. aria-label "Collapse menu" / "Expand menu", aria-expanded = menu shown.
 */
export function MenuToggle({ className, narrow, collapsed, drawerOpen, onToggleCollapsed, onOpenDrawer, onCloseDrawer, buttonRef }) {
  const expanded = narrow ? Boolean(drawerOpen) : !collapsed;
  const label = narrow ? (drawerOpen ? 'Close menu' : 'Open menu') : (expanded ? 'Collapse menu' : 'Expand menu');
  const onClick = () => {
    if (!narrow) onToggleCollapsed();
    else if (drawerOpen) onCloseDrawer();
    else if (onOpenDrawer) onOpenDrawer();
  };
  return (
    <button type="button" ref={buttonRef} className={className} onClick={onClick} aria-label={label} aria-expanded={expanded}
      aria-controls="a-nav" title={label}>
      <LIcon name="panel-left" />
    </button>
  );
}
