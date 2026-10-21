// Admin sidebar: Dashboard, then collapsible groups (Sales, Catalogue, Website content, Setup), a divider and the
// User Interface link to the public site. Items a role cannot open are not shown at all (the API enforces roles).
// - The group of the current page opens by itself and its item is highlighted.
// - Which groups are open, and whether the sidebar is collapsed to icons, is remembered per browser (localStorage,
//   in try / catch: a private window or blocked storage just starts with the defaults).
// - Collapsed (desktop): icons only, every item visible, name as a tooltip (and still read by screen readers).
// - Under 900px: a slide-in drawer with the same groups (never collapsed); a link, the backdrop or Esc closes it.
// - Group headers are buttons with aria-expanded / aria-controls, so Tab + Enter / Space open and close them.
import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import Icon from './icons';
import { can } from '../shared/permissions';

// Each item names the section whose "view" (or `action`) it needs (src/shared/permissions.js); null = every signed-in user.
// Commerce items also need Commerce settings commerce_enabled (me.commerce_enabled).
export const DASHBOARD = { path: '', label: 'Dashboard', section: null, icon: 'dashboard' };
const item = (path, label, section, icon, extra = {}) => ({ path, label, section, icon, ...extra });
export const GROUPS = [
  { key: 'sales', label: 'Sales', icon: 'sales', items: [item('leads', 'Leads', 'leads', 'leads')] },
  {
    key: 'catalogue', label: 'Catalogue', icon: 'catalogue', items: [
      item('categories', 'Categories', 'products', 'categories'), item('products', 'Products', 'products', 'products'),
      item('kits', 'Business kits', 'products', 'kits'), item('size-picker', 'Size picker', 'products', 'ruler'),
      item('import-export', 'Excel import / export', 'products', 'sheet'),
    ],
  },
  {
    key: 'commerce', label: 'Commerce', icon: 'sheet', commerce: true, items: [
      item('commerce/ops', 'Operations', null, 'dashboard'),
      item('commerce/orders', 'Orders', 'orders', 'sales'),
      item('commerce/packing', 'Packing', 'packing', 'products'),
      item('commerce/delivery', 'Delivery', 'delivery', 'towns', { action: 'create' }),
      item('commerce/my-trips', 'My trips', 'delivery', 'towns'),
      item('commerce/returns', 'Returns', 'returns', 'leads'),
      item('commerce/customers', 'Customers', 'customers', 'users'),
      item('commerce/follow-ups', 'My follow-ups', 'customers', 'leads'),
      item('commerce/promotions', 'Promotions', 'promotions', 'options'),
      item('commerce/prices', 'Products and prices', 'products', 'sheet'),
      item('commerce/skus', 'SKUs and labels', 'inventory', 'ruler'),
      item('commerce/stock', 'Inventory', 'inventory', 'products'),
      item('commerce/reports', 'Reports', null, 'sheet'), // each report checks its own section
    ],
  },
  {
    key: 'content', label: 'Website content', icon: 'content', items: [
      item('banners', 'Banners', 'content', 'banners'), item('translations', 'Translations', 'content', 'translations'),
      item('towns', 'Towns', 'content', 'towns'), item('form-options', 'Form options', 'content', 'options'),
      item('brochures', 'Brochures', 'content', 'brochures'),
    ],
  },
  {
    key: 'setup', label: 'Setup', icon: 'setup', items: [
      item('approvals', 'Approvals', null, 'audit'),
      item('languages', 'Languages', 'content', 'languages'), item('settings', 'Settings', 'settings', 'settings'),
      item('commerce-settings', 'Commerce settings', 'settings', 'settings'),
      item('users', 'Admin users', 'users', 'users'), item('roles', 'Roles', 'users', 'users'), item('audit', 'Audit log', 'audit', 'audit'),
    ],
  },
];

/** The groups with only the items this user may open (a group with none left is dropped). */
export const groupsFor = (me) => GROUPS
  .filter((g) => !g.commerce || (me && me.commerce_enabled))
  .map((g) => ({ ...g, items: g.items.filter((i) => !i.section || can(me && me.perms, i.section, i.action || 'view')) }))
  .filter((g) => g.items.length && (!g.commerce || g.items.some((i) => i.section)));

const GROUPS_KEY = 'dfresh-admin-nav-groups';
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
  const [open, setOpen] = useState(() => saved.get(GROUPS_KEY, { sales: true }));

  // The current page's group opens by itself (and stays open, like a click would).
  const currentKey = current ? current.key : null;
  useEffect(() => {
    if (!currentKey) return;
    setOpen((o) => {
      if (o[currentKey]) return o;
      const next = { ...o, [currentKey]: true };
      saved.set(GROUPS_KEY, next);
      return next;
    });
  }, [currentKey]);

  const toggle = (key) => setOpen((o) => {
    const next = { ...o, [key]: !o[key] };
    saved.set(GROUPS_KEY, next);
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
        <NavItem it={DASHBOARD} pathname={pathname} compact={compact} onNavigate={navigate} />
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
