// Admin console (lazy chunk, staff only, noindex; spec F). Plain staff layout, not the public design.
// /admin/me decides: signed in -> sidebar + screens; 401 -> two-step sign-in. Screens hide write buttons for
// lower roles, but the API is what enforces roles.
import { useCallback, useEffect, useRef, useState } from 'react';
// Only router exports the public site already uses (Link, useLocation...), so this chunk adds 0 KB to main.js.
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Sidebar, { MenuToggle, saveCollapsed, savedCollapsed, useNarrow } from './Sidebar';
import useLeadPulse from './useLeadPulse';
import { api } from './adminApi';
import { mediaUrl } from '../utils/api';
import { AdminContext, ConfirmProvider, Need, Notice, UploadGuard } from './ui';
import { can } from '../shared/permissions';
import Roles from './Roles';
import Approvals from './Approvals';
import CommerceSettings from './CommerceSettings';
import Notifications from './Notifications';
import Login from './Login';
import Dashboard from './Dashboard';
import Leads from './Leads';
import Products from './Products';
import ImportExport from './ImportExport';
import Translations from './Translations';
import EntityPage from './EntityPage';
import Languages from './Languages';
import Brochures from './Brochures';
import CommerceSkus from './CommerceSkus';
import CommerceStock from './CommerceStock';
import CommerceOrders from './CommerceOrders';
import CommerceReturns from './CommerceReturns';
import CommerceReports from './CommerceReports';
import MyFollowUps from './MyFollowUps';
import CommerceCustomers from './CommerceCustomers';
import CommercePromotions from './CommercePromotions';
import CommerceOps from './CommerceOps';
import Prices from './Prices';
import CommercePacking from './CommercePacking';
import CommerceDelivery, { MyTrips } from './CommerceDelivery';
import Settings from './Settings';
import Users from './Users';
import AuditLog from './AuditLog';
import css from './adminStyles';
import ScreenBoundary from './ScreenBoundary';

const LOGO_ON_DARK = '/media/logo/dfresh-logo-on-dark.webp';

// The site's favicon links (index.html), added if a page ever lacks them.
function ensureFavicon() {
  if (document.querySelector('link[rel~="icon"]')) return null;
  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = mediaUrl('/media/logo/favicon-32.png');
  document.head.appendChild(link);
  return link;
}

export default function AdminApp() {
  const [me, setMe] = useState(undefined); // undefined = checking, null = signed out
  const [languages, setLanguages] = useState([]);
  const [menuOpen, setMenuOpen] = useState(false); // the drawer on narrow screens
  const [collapsed, setCollapsed] = useState(savedCollapsed);
  const [newLeads, setNewLeads] = useState(0);
  const [approvalCount, setApprovalCount] = useState(0);
  // the approvals badge after deciding a request (the counts otherwise refresh on every page change)
  const refreshCounts = useCallback(() => { api.get('/nav-counts').then((d) => { setNewLeads(d.newLeads || 0); setApprovalCount(d.approvals || 0); }, () => {}); }, []);
  const burgerRef = useRef(null);
  const styleRef = useRef(null); // the admin <style> tag
  const narrow = useNarrow();
  const [error, setError] = useState(null);
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    document.title = 'dFresh admin';
    // Fonts: Saira and Open Sans (the admin is English only) are self-hosted in the main CSS (styles/fonts.css).
    const icon = ensureFavicon();
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    styleRef.current = style;
    return () => { meta.remove(); style.remove(); if (icon) icon.remove(); styleRef.current = null; };
  }, []);
  // Dev hot reload re-runs adminStyles.js but not the effect above: without this an open tab keeps the old CSS
  // under new markup (e.g. unstyled rows). Same string = nothing to do.
  useEffect(() => {
    if (styleRef.current && styleRef.current.textContent !== css) styleRef.current.textContent = css;
  });

  const loadLanguages = useCallback(() => api.get('/languages').then(setLanguages, (e) => setError(e.message)), []);

  const check = useCallback(() => {
    api.get('/me').then(
      (data) => { setMe(data); loadLanguages(); },
      (err) => { if (err.status === 401) setMe(null); else setError(err.message); }
    );
  }, [loadLanguages]);
  useEffect(check, [check]);

  // Leads badge: New leads, refreshed on every page change (cheap: one COUNT).
  useEffect(() => {
    if (!me) return;
    api.get('/nav-counts').then((d) => { setNewLeads(d.newLeads || 0); setApprovalCount(d.approvals || 0); }, () => {});
  }, [me, pathname]);

  // Live: new leads every 15 s (badge, toast, quiet refresh of the Leads list and the Dashboard via leadsVersion)
  const pulse = useLeadPulse(Boolean(me) && can(me.perms, 'leads', 'view')); // only for roles that see Leads
  useEffect(() => { if (pulse.newLeads !== null) setNewLeads(pulse.newLeads); }, [pulse.newLeads]);

  const toggleCollapsed = () => setCollapsed((c) => { saveCollapsed(!c); return !c; });
  const closeDrawer = useCallback((returnFocus) => {
    setMenuOpen(false);
    if (returnFocus && burgerRef.current) burgerRef.current.focus();
  }, []);

  const logout = async () => {
    await api.send('POST', '/logout').catch(() => {});
    setMe(null);
  };

  if (error && me === undefined) return <main className="adm a-center"><Notice kind="error">{error}</Notice></main>;
  if (me === undefined) return <main className="adm a-center"><p className="a-muted">Loading...</p></main>;
  if (me === null) return <Login onSignedIn={check} />;

  const ctx = { me, languages, reloadLanguages: loadLanguages, leadsVersion: pulse.version };

  return (
    <AdminContext.Provider value={ctx}>
      <div className={`adm a-shell${collapsed ? ' collapsed' : ''}`}>
        <ConfirmProvider>
        <UploadGuard />
        <header className="a-top">
          {/* Under 900px only: the button left of the logo opens / closes the drawer. On desktop the sidebar's pinned
              toggle collapses / expands it. */}
          {narrow && (
            <MenuToggle className="a-burger" buttonRef={burgerRef} narrow={narrow} collapsed={collapsed} drawerOpen={menuOpen}
              onToggleCollapsed={toggleCollapsed} onOpenDrawer={() => setMenuOpen(true)} onCloseDrawer={() => setMenuOpen(false)} />
          )}
          <Link to="/admin" className="a-brand" aria-label="dFresh admin - dashboard">
            <img src={mediaUrl(LOGO_ON_DARK)} alt="" width="900" height="498" />
            <span className="a-brand-tag" aria-hidden="true">Admin</span>
          </Link>
          <span className="a-who">{me.name} <code>{me.emp_id}</code> · {me.role_name}</span>
          <button type="button" className="a-btn a-btn-ghost" onClick={logout}>Sign out</button>
        </header>
        <Sidebar me={me} drawerOpen={menuOpen} onCloseDrawer={closeDrawer} collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed} newLeads={newLeads} approvals={approvalCount} />
        <main className="a-main">
          <ScreenBoundary key={pathname}>
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="leads" element={<Need section="leads"><Leads /></Need>} />
            <Route path="products" element={<Need section="products"><Products /></Need>} />
            <Route path="import-export" element={<Need section="products"><ImportExport /></Need>} />
            <Route path="translations" element={<Need section="content"><Translations /></Need>} />
            <Route path="banners" element={<Need section="content"><EntityPage key="banners" name="banners" /></Need>} />
            <Route path="kits" element={<Need section="products"><EntityPage key="kits" name="kits" /></Need>} />
            <Route path="towns" element={<Need section="content"><EntityPage key="towns" name="towns" /></Need>} />
            <Route path="categories" element={<Need section="products"><EntityPage key="categories" name="categories" /></Need>} />
            <Route path="size-picker" element={<Need section="products"><EntityPage key="size-picker" name="size-picker" /></Need>} />
            <Route path="form-options" element={<Need section="content"><EntityPage key="form-options" name="form-options" /></Need>} />
            <Route path="languages" element={<Need section="content"><Languages /></Need>} />
            <Route path="brochures" element={<Need section="content"><Brochures /></Need>} />
            <Route path="commerce/skus" element={<Need section="inventory" commerce><CommerceSkus /></Need>} />
            <Route path="commerce/stock" element={<Need section="inventory" commerce><CommerceStock /></Need>} />
            <Route path="commerce/orders" element={<Need section="orders" commerce><CommerceOrders /></Need>} />
            <Route path="commerce/returns" element={<Need section="returns" commerce><CommerceReturns /></Need>} />
            <Route path="commerce/reports" element={<Need commerce><CommerceReports /></Need>} />
            <Route path="commerce/follow-ups" element={<Need section="customers" commerce><MyFollowUps /></Need>} />
            <Route path="commerce/customers" element={<Need section="customers" commerce><CommerceCustomers /></Need>} />
            <Route path="commerce/promotions" element={<Need section="promotions" commerce><CommercePromotions /></Need>} />
            <Route path="commerce/ops" element={<Need commerce><CommerceOps /></Need>} />
            <Route path="commerce/prices" element={<Need section="products" commerce><Prices /></Need>} />
            <Route path="commerce/packing" element={<Need section="packing" commerce><CommercePacking /></Need>} />
            <Route path="commerce/delivery" element={<Need section="delivery" action="create" commerce><CommerceDelivery /></Need>} />
            <Route path="commerce/my-trips" element={<Need section="delivery" commerce><MyTrips /></Need>} />
            <Route path="settings" element={<Need section="settings"><Settings /></Need>} />
            <Route path="commerce-settings" element={<Need section="settings"><CommerceSettings /></Need>} />
            <Route path="notifications" element={<Need section="settings"><Notifications /></Need>} />
            <Route path="users" element={<Need section="users"><Users /></Need>} />
            <Route path="roles" element={<Need section="users"><Roles /></Need>} />
            <Route path="approvals" element={<Approvals onChanged={refreshCounts} />} />
            <Route path="audit" element={<Need section="audit"><AuditLog /></Need>} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
          </ScreenBoundary>
        </main>
        {pulse.toast && (
          <div className="a-toast" role="status" aria-live="polite">
            <Link to="/admin/leads" onClick={pulse.dismissToast}>{pulse.toast}</Link>
            <button type="button" className="a-x" onClick={pulse.dismissToast} aria-label="Dismiss">×</button>
          </div>
        )}
        </ConfirmProvider>
      </div>
    </AdminContext.Provider>
  );
}
