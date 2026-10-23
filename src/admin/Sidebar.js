// Admin sidebar, in the order of the business: Dashboard, Operations and Approvals on top (no group), then the groups
// Products and prices, Stock, Sales, Fulfilment, Reports, Website content, Setup, a divider and the User Interface link
// to the public site. Items a role cannot open are not shown at all (the API enforces roles); a group left empty is not
// shown. With Commerce switched off the commerce items are gone and the menu is the live site's (Commerce settings and
// Roles stay: they are where Commerce is prepared and switched on). My trips only for a user linked to a driver.
// - The group of the current page opens by itself and its item is highlighted.
// - Which groups are open is remembered per user (and per browser); whether the sidebar is collapsed to icons, per
//   browser (localStorage, in try / catch: a private window or blocked storage just starts with the defaults).
// - Collapsed (desktop): icons only, every item visible, name as a tooltip (and still read by screen readers).
// - Under 900px: a slide-in drawer with the same groups (never collapsed); a link, the backdrop or Esc closes it.
// - Group headers are buttons with aria-expanded / aria-controls, so Tab + Enter / Space open and close them.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from './icons';
import { can } from '../shared/permissions';

// Each item names the section whose "view" (or `action`) it needs (src/shared/permissions.js); null = every signed-in user.
// commerce: shown only while Commerce settings commerce_enabled is on (me.commerce_enabled); driver: only for a user
// linked to a driver (me.is_driver).
export const DASHBOARD = { path: '', label: 'Dashboard', section: null, icon: 'dashboard' };
const item = (path, label, section, icon, extra = {}) => ({ path, label, section, icon, ...extra });
const C = { commerce: true };
/** the items above the groups */
export const TOP = [
  DASHBOARD,
  item('commerce/ops', 'Operations', null, 'dashboard', C),
  item('approvals', 'Approvals', null, 'audit', C),
];
export const GROUPS = [
  {
    key: 'products', label: 'Products and prices', icon: 'catalogue', items: [
      item('categories', 'Categories', 'products', 'categories'), item('products', 'Products', 'products', 'products'),
      item('kits', 'Business kits', 'products', 'kits'), item('size-picker', 'Size picker', 'products', 'ruler'),
      item('import-export', 'Excel import / export', 'products', 'sheet'),
      item('commerce/skus', 'SKUs and labels', 'inventory', 'ruler', C),
      item('commerce/prices', 'Products and prices', 'products', 'sheet', C),
      item('commerce/promotions', 'Promotions', 'promotions', 'options', C),
    ],
  },
  { key: 'stock', label: 'Stock', icon: 'products', items: [item('commerce/stock', 'Inventory', 'inventory', 'products', C)] },
  {
    key: 'sales', label: 'Sales', icon: 'sales', items: [
      item('leads', 'Leads', 'leads', 'leads'),
      item('commerce/customers', 'Customers', 'customers', 'users', C),
      item('commerce/follow-ups', 'My follow-ups', 'customers', 'leads', C),
      item('commerce/orders', 'Orders', 'orders', 'sales', C),
    ],
  },
  {
    key: 'fulfilment', label: 'Fulfilment', icon: 'towns', items: [
      item('commerce/packing', 'Packing', 'packing', 'products', C),
      item('commerce/delivery', 'Delivery', 'delivery', 'towns', { ...C, action: 'create' }),
      item('commerce/my-trips', 'My trips', 'delivery', 'towns', { ...C, driver: true }),
      item('commerce/returns', 'Returns', 'returns', 'leads', C),
    ],
  },
  { key: 'reports', label: 'Reports', icon: 'sheet', items: [item('commerce/reports', 'Reports', null, 'sheet', C)] }, // each report checks its own section
  {
    key: 'content', label: 'Website content', icon: 'content', items: [
      item('banners', 'Banners', 'content', 'banners'), item('translations', 'Translations', 'content', 'translations'),
      item('towns', 'Towns', 'content', 'towns'), item('form-options', 'Form options', 'content', 'options'),
      item('brochures', 'Brochures', 'content', 'brochures'),
    ],
  },
  {
    key: 'setup', label: 'Setup', icon: 'setup', items: [
      item('settings', 'Settings', 'settings', 'settings'),
      item('commerce-settings', 'Commerce settings', 'settings', 'settings'), // stays while Commerce is off: it is switched on here
      item('notifications', 'Notifications', 'settings', 'mail', C),
      item('languages', 'Languages', 'content', 'languages'),
      item('users', 'Admin users', 'users', 'users'), item('roles', 'Roles', 'users', 'users'), // Roles: staff get their roles before go-live
      item('audit', 'Audit log', 'audit', 'audit'),
    ],
  },
];

/** may this user see this item? (Commerce on for commerce items, linked to a driver for My trips, the section's permission) */
const visible = (me, i) => (!i.commerce || Boolean(me && me.commerce_enabled)) && (!i.driver || Boolean(me && me.is_driver))
  && (!i.section || can(me && me.perms, i.section, i.action || 'view'));
/** the top items this user may open */
export const topFor = (me) => TOP.filter((i) => visible(me, i));
/** The groups with only the items this user may open (a group with none left is dropped). */
export const groupsFor = (me) => GROUPS
  .map((g) => ({ ...g, items: g.items.filter((i) => visible(me, i)) }))
  .filter((g) => g.items.length);

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

const isActive = (pathname, path) => (path === '' ? /^\/admin\/?$/.test(pathname)
  : pathname === `/admin/${path}` || pathname.startsWith(`/admin/${path}/`));

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

function NavItem({ it, pathname, compact, badge, onNavigate }) {
  const active = isActive(pathname, it.path);
  return (
    <Link to={`/admin/${it.path}`} className={`a-nav-item${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined}
      title={compact ? `${it.label}${badge ? ` (${badge} new)` : ''}` : undefined} onClick={onNavigate}>
      <Icon name={it.icon} />
      <span className="a-lbl">{it.label}</span>
      {badge > 0 && <span className="a-badge">{badge}<span className="a-sr"> new</span></span>}
    </Link>
  );
}

export default function Sidebar({ me, drawerOpen, onCloseDrawer, collapsed, onToggleCollapsed, newLeads, approvals }) {
  const { pathname } = useLocation();
  const narrow = useNarrow();
  const compact = collapsed && !narrow;
  const groups = groupsFor(me);
  const current = groups.find((g) => g.items.some((i) => isActive(pathname, i.path)));
  const groupsKey = `${GROUPS_KEY}:${(me && me.emp_id) || ''}`;
  const [open, setOpen] = useState(() => saved.get(groupsKey, { sales: true }));

  // The current page's group opens by itself (and stays open, like a click would).
  const currentKey = current ? current.key : null;
  useEffect(() => {
    if (!currentKey) return;
    setOpen((o) => {
      if (o[currentKey]) return o;
      const next = { ...o, [currentKey]: true };
      saved.set(groupsKey, next);
      return next;
    });
  }, [currentKey, groupsKey]);

  const toggle = (key) => setOpen((o) => {
    const next = { ...o, [key]: !o[key] };
    saved.set(groupsKey, next);
    return next;
  });

  // Drawer (narrow screens): Esc closes it.
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onCloseDrawer(true); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen, onCloseDrawer]);

  const navigate = () => { if (narrow) onCloseDrawer(false); };
  const badgeFor = (it) => (it.path === 'leads' ? newLeads : it.path === 'approvals' ? approvals : 0);

  return (
    <>
      {narrow && drawerOpen && <div className="a-nav-backdrop" onClick={() => onCloseDrawer(false)} aria-hidden="true" />}
      <nav id="a-nav" className={`a-nav${drawerOpen ? ' open' : ''}${compact ? ' collapsed' : ''}`} aria-label="Admin">
        {/* Only this list scrolls (thin ink scrollbar); the menu toggle below it never moves. */}
        <div className="a-nav-list">
        {topFor(me).map((it) => <NavItem key={it.path || 'dashboard'} it={it} pathname={pathname} compact={compact} badge={badgeFor(it)} onNavigate={navigate} />)}
        {groups.map((g) => {
          const shown = compact || Boolean(open[g.key]);
          const id = `a-grp-${g.key}`;
          const sum = g.items.reduce((n, it) => n + (badgeFor(it) || 0), 0);
          return (
            <div className={`a-grp${current && current.key === g.key ? ' current' : ''}`} key={g.key}>
              {compact ? (
                <div className="a-grp-sep" role="separator" aria-label={g.label} />
              ) : (
                <button type="button" className="a-grp-h" aria-expanded={shown} aria-controls={id} onClick={() => toggle(g.key)}>
                  <Icon name={g.icon} />
                  <span className="a-lbl">{g.label}</span>
                  {!shown && sum > 0 && <span className="a-badge">{sum}<span className="a-sr"> new</span></span>}
                  <Icon name="chevron" className="a-chev" />
                </button>
              )}
              <div id={id} className="a-grp-items" hidden={!shown}>
                {g.items.map((it) => (
                  <NavItem key={it.path} it={it} pathname={pathname} compact={compact} badge={badgeFor(it)} onNavigate={navigate} />
                ))}
              </div>
            </div>
          );
        })}
        <div className="a-nav-sep" role="separator" />
        {/* The public site, same origin as the admin (relative /en: localhost, staging, production), in a new tab;
            for every role, never "active". */}
        <a className="a-nav-item a-nav-ext" href="/en" target="_blank" rel="noopener noreferrer"
          aria-label="User Interface - opens the website in a new tab" title={compact ? 'User Interface (opens the website in a new tab)' : undefined}>
          <Icon name="external" />
          <span className="a-lbl">User Interface</span>
        </a>
        </div>
        {/* Pinned menu toggle (the header has the same one): desktop collapses / expands the sidebar, the drawer closes. */}
        <MenuToggle className="a-collapse" narrow={narrow} collapsed={collapsed} drawerOpen={drawerOpen}
          onToggleCollapsed={onToggleCollapsed} onCloseDrawer={() => onCloseDrawer(true)} withLabel />
      </nav>
    </>
  );
}

/**
 * The menu toggle: pinned at the bottom of the sidebar (desktop: collapses / expands it, remembered per browser; in the
 * drawer: closes it) and, under 900px only, in the header left of the logo (opens / closes the drawer). aria-label "Collapse menu" / "Expand menu", aria-expanded = menu shown.
 */
export function MenuToggle({ className, narrow, collapsed, drawerOpen, onToggleCollapsed, onOpenDrawer, onCloseDrawer, withLabel, buttonRef }) {
  const expanded = narrow ? Boolean(drawerOpen) : !collapsed;
  const label = expanded ? 'Collapse menu' : 'Expand menu';
  const onClick = () => {
    if (!narrow) onToggleCollapsed();
    else if (drawerOpen) onCloseDrawer();
    else if (onOpenDrawer) onOpenDrawer();
  };
  return (
    <button type="button" ref={buttonRef} className={className} onClick={onClick} aria-label={label} aria-expanded={expanded}
      aria-controls="a-nav" title={label}>
      <Icon name={narrow ? (drawerOpen ? 'collapse' : 'menu') : (collapsed ? 'expand' : 'collapse')} />
      {withLabel && <span className="a-lbl">{narrow ? 'Close menu' : (collapsed ? 'Expand' : 'Collapse')}</span>}
    </button>
  );
}
