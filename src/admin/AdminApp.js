// Admin console (lazy chunk, staff only, noindex; spec F). Plain staff layout, not the public design.
// /admin/me decides: signed in -> sidebar + screens; 401 -> two-step sign-in. Screens hide write buttons for
// lower roles, but the API is what enforces roles.
import { useCallback, useEffect, useRef, useState } from 'react';
// Only router exports the public site already uses (Link, useLocation...), so this chunk adds 0 KB to main.js.
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Sidebar, { saveCollapsed, savedCollapsed } from './Sidebar';
import { api } from './adminApi';
import { mediaUrl } from '../utils/api';
import { AdminContext, Notice } from './ui';
import Login from './Login';
import Dashboard from './Dashboard';
import Leads from './Leads';
import Products from './Products';
import ImportExport from './ImportExport';
import Translations from './Translations';
import EntityPage from './EntityPage';
import Languages from './Languages';
import Brochures from './Brochures';
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
  const burgerRef = useRef(null);
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
    return () => { meta.remove(); style.remove(); if (icon) icon.remove(); };
  }, []);

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
    api.get('/nav-counts').then((d) => setNewLeads(d.newLeads || 0), () => {});
  }, [me, pathname]);

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

  const ctx = { me, languages, reloadLanguages: loadLanguages };

  return (
    <AdminContext.Provider value={ctx}>
      <div className={`adm a-shell${collapsed ? ' collapsed' : ''}`}>
        <header className="a-top">
          <button type="button" ref={burgerRef} className="a-burger" aria-expanded={menuOpen} aria-controls="a-nav" onClick={() => setMenuOpen((o) => !o)}>Menu</button>
          <Link to="/admin" className="a-brand" aria-label="dFresh admin - dashboard">
            <img src={mediaUrl(LOGO_ON_DARK)} alt="" width="900" height="498" />
            <span className="a-brand-tag" aria-hidden="true">Admin</span>
          </Link>
          <span className="a-who">{me.name} <code>{me.emp_id}</code> · {me.role}</span>
          <button type="button" className="a-btn a-btn-ghost" onClick={logout}>Sign out</button>
        </header>
        <Sidebar role={me.role} drawerOpen={menuOpen} onCloseDrawer={closeDrawer} collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed} newLeads={newLeads} />
        <main className="a-main">
          <ScreenBoundary key={pathname}>
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="leads" element={<Leads />} />
            <Route path="products" element={<Products />} />
            <Route path="import-export" element={<ImportExport />} />
            <Route path="translations" element={<Translations />} />
            <Route path="banners" element={<EntityPage key="banners" name="banners" />} />
            <Route path="kits" element={<EntityPage key="kits" name="kits" />} />
            <Route path="towns" element={<EntityPage key="towns" name="towns" />} />
            <Route path="categories" element={<EntityPage key="categories" name="categories" />} />
            <Route path="size-picker" element={<EntityPage key="size-picker" name="size-picker" />} />
            <Route path="form-options" element={<EntityPage key="form-options" name="form-options" />} />
            <Route path="languages" element={<Languages />} />
            <Route path="brochures" element={<Brochures />} />
            <Route path="settings" element={<Settings />} />
            <Route path="users" element={<Users />} />
            <Route path="audit" element={<AuditLog />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
          </ScreenBoundary>
        </main>
      </div>
    </AdminContext.Provider>
  );
}
