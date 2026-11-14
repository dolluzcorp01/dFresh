// Admin console (lazy chunk, staff only, noindex; spec F): the v23 back office look (docs/reference/dFresh_Back_Office_v23.html),
// not the public design. Header: menu button, godown picker, website link, approvals count, alerts bell, who is signed in
// (sign out in their menu); the left menu (Sidebar.js, 148 entries from docs/STAGE2-MENU-GUIDE.txt); the page.
// /admin/me decides: signed in -> sidebar + screens; 401 -> two-step sign-in. Screens hide write buttons for
// lower roles, but the API is what enforces roles.
import { useCallback, useEffect, useRef, useState } from 'react';
// Only router exports the public site already uses (Link, useLocation...), so this chunk adds 0 KB to main.js.
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Sidebar, { MenuToggle, saveCollapsed, savedCollapsed, useNarrow } from './Sidebar';
import Placeholder from './Placeholder';
import HeaderBar from './HeaderBar';
import useLeadPulse from './useLeadPulse';
import { api, setGodown } from './adminApi';
import { savedGodown } from './HeaderBar';
import { mediaUrl } from '../utils/api';
import { AdminContext, ConfirmProvider, Need, Notice, ToastProvider, UploadGuard } from './ui';
import { can } from '../shared/permissions';
import Roles from './Roles';
import Approvals from './Approvals';
import Godowns from './Godowns';
import Company from './Company';
import ApprovalRules from './ApprovalRules';
import StandIns from './StandIns';
import CommerceSettings from './CommerceSettings';
import Numbering from './Numbering';
import Switches from './Switches';
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
import Categories from './Categories';
import Kits from './Kits';
import Units from './Units';
import RawMaterials from './RawMaterials';
import CommerceStock from './CommerceStock';
import CommerceOrders from './CommerceOrders';
import CommerceReturns from './CommerceReturns';
import CommerceReports from './CommerceReports';
import FollowUps from './FollowUps';
import Quotes from './Quotes';
import StandingOrders from './StandingOrders';
import BackOrders from './BackOrders';
import CreditLimits from './CreditLimits';
import CustomerTypes from './CustomerTypes';
import CustomerLedger from './CustomerLedger';
import CommerceCustomers from './CommerceCustomers';
import CommercePromotions from './CommercePromotions';
import { CashbackRules, Coupons, CustomerWallets, Offers } from './Marketing';
import { Inspection, ReturnRequests } from './ReturnsPages';
import { ExportHistory, ExportToAccountant, Expenses, PettyCash } from './Expenses';
import Alerts from './Alerts';
import { GstAndDelivery, MoneyOwed, SalesAndPurchases, StockReport } from './Reports23';
import CommerceOps from './CommerceOps';
import Prices from './Prices';
import QuantitySlabs from './QuantitySlabs';
import SpecialPrices from './SpecialPrices';
import HsnRates from './HsnRates';
import Brand from './Brand';
import Suppliers from './Suppliers';
import Indents from './Indents';
import PurchaseOrders from './PurchaseOrders';
import GoodsIn from './GoodsIn';
import QualityCheck from './QualityCheck';
import Recipes from './Recipes';
import ProductionRuns from './ProductionRuns';
import Wastage from './Wastage';
import StockStatus from './StockStatus';
import BatchesExpiry from './BatchesExpiry';
import Transfers from './Transfers';
import StockTake from './StockTake';
import InvWriteOffs from './InvWriteOffs';
import Reorder from './Reorder';
import StockLedger from './StockLedger';
import SupplierBills from './SupplierBills';
import Claims from './Claims';
import SupplierPayments from './SupplierPayments';
import { Challans, CreditNotes, DebitNotes, Invoices } from './Billing';
import { Cheques, Receipts, Refunds } from './MoneyIn';
import { EInvoice, EwayBill, GstMonth } from './Gst';
import { PackedWaiting, PackingPage, ToPick } from './Packing';
import Trips, { CashOnDelivery, CourierPickup, FailedShort, MyTrips, ProofOfDelivery } from './CommerceDelivery';
import { Couriers, DeliveryAreas, Vehicles } from './DeliveryMasters';
import { FormRules, GoogleSharing, HomeDoors, MenuLinks, MostLoved, SiteSettings, VisitCards, WhereMap } from './Website'; // phase 24: section 18
import Users from './Users';
import AuditLog from './AuditLog';
import css from './adminStyles';
import ScreenBoundary from './ScreenBoundary';

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
  const [alertCount, setAlertCount] = useState(0); // phase 23: unread alerts (the bell)
  const refreshCounts = useCallback(() => { api.get('/nav-counts').then((d) => { setNewLeads(d.newLeads || 0); setApprovalCount(d.approvals || 0); setAlertCount(d.alerts || 0); }, () => {}); }, []);
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
    document.title = 'dFresh Back Office';
    // Fonts: Saira and Open Sans (the admin is English only) are self-hosted in the main CSS (styles/fonts.css).
    const icon = ensureFavicon();
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    styleRef.current = style;
    return () => { meta.remove(); style.remove(); if (icon) icon.remove(); styleRef.current = null; };
  }, []);
  // phase 15: an uploaded square logo (Logo and brand images) is the admin's tab icon too
  useEffect(() => {
    if (!me || !me.logo_square) return;
    const link = document.querySelector('link[rel~="icon"]');
    if (link) link.href = mediaUrl(me.logo_square);
  }, [me]);
  // Dev hot reload re-runs adminStyles.js but not the effect above: without this an open tab keeps the old CSS
  // under new markup (e.g. unstyled rows). Same string = nothing to do.
  useEffect(() => {
    if (styleRef.current && styleRef.current.textContent !== css) styleRef.current.textContent = css;
  });

  const loadLanguages = useCallback(() => api.get('/languages').then(setLanguages, (e) => setError(e.message)), []);

  const check = useCallback(() => {
    api.get('/me').then(
      (data) => { setGodown(savedGodown(data)); setMe(data); loadLanguages(); }, // the picked godown before any screen loads
      (err) => { if (err.status === 401) setMe(null); else setError(err.message); }
    );
  }, [loadLanguages]);
  useEffect(check, [check]);

  // Leads badge: New leads, refreshed on every page change (cheap: one COUNT).
  useEffect(() => {
    if (!me) return;
    api.get('/nav-counts').then((d) => { setNewLeads(d.newLeads || 0); setApprovalCount(d.approvals || 0); setAlertCount(d.alerts || 0); }, () => {});
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
        <ToastProvider>
        <UploadGuard />
        <Sidebar me={me} drawerOpen={menuOpen} onCloseDrawer={closeDrawer} collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed} newLeads={newLeads} approvals={approvalCount} />
        <div className="a-mainwrap">
        <HeaderBar me={me} newLeads={newLeads} approvals={approvalCount} alertCount={alertCount} onCounts={refreshCounts} onLogout={logout}>
          <MenuToggle className="a-iconbtn" buttonRef={burgerRef} narrow={narrow} collapsed={collapsed} drawerOpen={menuOpen}
            onToggleCollapsed={toggleCollapsed} onOpenDrawer={() => setMenuOpen(true)} onCloseDrawer={() => setMenuOpen(false)} />
        </HeaderBar>
        <main className="a-main">
          <ScreenBoundary key={pathname}>
          <Routes>
            <Route index element={<Dashboard />} />
            <Route path="leads" element={<Need section="leads"><Leads /></Need>} />
            <Route path="products" element={<Need section="products"><Products /></Need>} />
            <Route path="import-export" element={<Need section="products"><ImportExport /></Need>} />
            <Route path="translations" element={<Need section="content"><Translations /></Need>} />
            <Route path="banners" element={<Need section="content"><EntityPage key="banners" name="banners" /></Need>} />
            <Route path="kits" element={<Need section="products"><Kits /></Need>} />
            {/* phase 24: section 18 Website pages (docs/claude-tasks/done/phase-24-field-map.md) */}
            <Route path="home-doors" element={<Need section="content"><HomeDoors /></Need>} />
            <Route path="most-loved" element={<Need section="content"><MostLoved /></Need>} />
            <Route path="form-rules" element={<Need section="content"><FormRules /></Need>} />
            <Route path="where-we-deliver-map" element={<Need section="content"><WhereMap /></Need>} />
            <Route path="towns" element={<Navigate to="/admin/where-we-deliver-map" replace />} />
            <Route path="menu-links" element={<Need section="content"><MenuLinks /></Need>} />
            <Route path="visit-cards" element={<Need section="content"><VisitCards /></Need>} />
            <Route path="google-and-sharing" element={<Need section="settings"><GoogleSharing /></Need>} />
            <Route path="site-settings" element={<Need section="settings"><SiteSettings /></Need>} />
            <Route path="categories" element={<Need section="products"><Categories /></Need>} />
            <Route path="units" element={<Need section="products"><Units /></Need>} />
            <Route path="raw-materials" element={<Need section="products"><RawMaterials /></Need>} />
            <Route path="size-picker" element={<Need section="products"><EntityPage key="size-picker" name="size-picker" /></Need>} />
            <Route path="form-options" element={<Need section="content"><EntityPage key="form-options" name="form-options" /></Need>} />
            <Route path="languages" element={<Need section="content"><Languages /></Need>} />
            <Route path="brochures" element={<Need section="content"><Brochures /></Need>} />
            <Route path="commerce/skus" element={<Need section={['products', 'inventory', 'packing']} commerce><CommerceSkus /></Need>} />
            <Route path="commerce/stock" element={<Need section="inventory" commerce><CommerceStock /></Need>} />
            <Route path="commerce/orders" element={<Need section="orders" commerce><CommerceOrders /></Need>} />
            <Route path="commerce/returns" element={<Need section="returns" commerce><CommerceReturns /></Need>} />
            <Route path="commerce/reports" element={<Need commerce><CommerceReports /></Need>} />
            <Route path="commerce/follow-ups" element={<Need section="customers" commerce><FollowUps /></Need>} />
            <Route path="customer-types" element={<Need section="customers" commerce><CustomerTypes /></Need>} />
            <Route path="credit-limits" element={<Need section="customers" commerce><CreditLimits /></Need>} />
            <Route path="customer-ledger" element={<Need section="customers" commerce><CustomerLedger /></Need>} />
            <Route path="quotes" element={<Need section="orders" commerce><Quotes /></Need>} />
            <Route path="standing-orders" element={<Need section="orders" commerce><StandingOrders /></Need>} />
            <Route path="back-orders" element={<Need section="orders" commerce><BackOrders /></Need>} />
            <Route path="commerce/customers" element={<Need section="customers" commerce><CommerceCustomers /></Need>} />
            <Route path="commerce/promotions" element={<Need section="promotions" commerce><CommercePromotions /></Need>} />
            <Route path="commerce/ops" element={<Need commerce><CommerceOps /></Need>} />
            <Route path="prices" element={<Need section="prices" commerce><Prices /></Need>} />
            <Route path="commerce/prices" element={<Navigate to="/admin/prices" replace />} />
            <Route path="quantity-slabs" element={<Need section="prices" commerce><QuantitySlabs /></Need>} />
            <Route path="special-prices" element={<Need section="prices" commerce><SpecialPrices /></Need>} />
            <Route path="hsn-rates" element={<Need section="prices" commerce><HsnRates /></Need>} />
            <Route path="brand" element={<Need section="content"><Brand /></Need>} />
            {/* phase 16: section 3 Suppliers and buying, and Money > Payments > Supplier payments */}
            <Route path="suppliers" element={<Need section="buying" commerce><Suppliers /></Need>} />
            <Route path="indents" element={<Need section="buying" commerce><Indents /></Need>} />
            <Route path="purchase-orders" element={<Need section="buying" commerce><PurchaseOrders /></Need>} />
            <Route path="goods-in" element={<Need section="buying" commerce><GoodsIn /></Need>} />
            <Route path="quality-check" element={<Need section={['buying', 'production']} commerce><QualityCheck /></Need>} />
            <Route path="supplier-bills" element={<Need section="buying" commerce><SupplierBills /></Need>} />
            <Route path="claims" element={<Need section="buying" commerce><Claims /></Need>} />
            <Route path="supplier-payments" element={<Need section="money" commerce><SupplierPayments /></Need>} />
            <Route path="alerts" element={<Alerts />} />
            {/* phase 23: section 16 the v23 report pages */}
            <Route path="sales-and-purchases" element={<Need section="reports" commerce><SalesAndPurchases /></Need>} />
            <Route path="stock-report" element={<Need section="reports" commerce><StockReport /></Need>} />
            <Route path="money-owed" element={<Need section="reports" commerce><MoneyOwed /></Need>} />
            <Route path="gst-and-delivery" element={<Need section="reports" commerce><GstAndDelivery /></Need>} />
            {/* phase 23: section 17 Expenses and accounting export */}
            <Route path="expenses" element={<Need section="expenses" commerce><Expenses /></Need>} />
            <Route path="petty-cash" element={<Need section="expenses" commerce><PettyCash /></Need>} />
            <Route path="export-to-accountant" element={<Need section="expenses" commerce><ExportToAccountant /></Need>} />
            <Route path="export-history" element={<Need section="expenses" commerce><ExportHistory /></Need>} />
            {/* phase 22: sections 12 to 14 Returns, promotions and wallet */}
            <Route path="return-requests" element={<Need section="returns" commerce><ReturnRequests /></Need>} />
            <Route path="inspection" element={<Need section="returns" commerce><Inspection /></Need>} />
            <Route path="offers" element={<Need section="promotions" commerce><Offers /></Need>} />
            <Route path="coupons" element={<Need section="promotions" commerce><Coupons /></Need>} />
            <Route path="cashback-rules" element={<Need section="promotions" commerce><CashbackRules /></Need>} />
            <Route path="customer-wallets" element={<Need section="promotions" commerce><CustomerWallets /></Need>} />
            {/* phase 21: sections 10 and 11 Invoicing, GST and payments */}
            <Route path="invoices" element={<Need section="invoicing" commerce><Invoices /></Need>} />
            <Route path="credit-notes" element={<Need section="invoicing" commerce><CreditNotes /></Need>} />
            <Route path="debit-notes" element={<Need section="invoicing" commerce><DebitNotes /></Need>} />
            <Route path="delivery-challans" element={<Need section="invoicing" commerce><Challans /></Need>} />
            <Route path="gst-data" element={<Need section="invoicing" commerce><GstMonth /></Need>} />
            <Route path="e-invoice" element={<Need section="invoicing" commerce><EInvoice /></Need>} />
            <Route path="e-way-bill" element={<Need section="invoicing" commerce><EwayBill /></Need>} />
            <Route path="receipts" element={<Need section="money" commerce><Receipts /></Need>} />
            <Route path="refunds" element={<Need section="money" commerce><Refunds /></Need>} />
            <Route path="cheque-register" element={<Need section="money" commerce><Cheques /></Need>} />
            {/* phase 17: section 4 Production */}
            <Route path="recipes" element={<Need section="production" commerce><Recipes /></Need>} />
            <Route path="production-runs" element={<Need section="production" commerce><ProductionRuns /></Need>} />
            <Route path="wastage" element={<Need section="production" commerce><Wastage /></Need>} />
            {/* phase 18: section 5 Inventory */}
            <Route path="stock-status" element={<Need section="inventory" commerce><StockStatus /></Need>} />
            <Route path="batches-and-expiry" element={<Need section="inventory" commerce><BatchesExpiry /></Need>} />
            <Route path="transfers" element={<Need section="inventory" commerce><Transfers /></Need>} />
            <Route path="stock-take" element={<Need section="inventory" commerce><StockTake /></Need>} />
            <Route path="write-offs" element={<Need section="inventory" commerce><InvWriteOffs /></Need>} />
            <Route path="reorder" element={<Need section="inventory" commerce><Reorder /></Need>} />
            <Route path="stock-ledger" element={<Need section="inventory" commerce><StockLedger /></Need>} />
            <Route path="to-pick" element={<Need section="packing" commerce><ToPick /></Need>} />
            <Route path="packing" element={<Need section="packing" commerce><PackingPage /></Need>} />
            <Route path="packed-waiting" element={<Need section="packing" commerce><PackedWaiting /></Need>} />
            <Route path="trips" element={<Need section="delivery" action="create" commerce><Trips /></Need>} />
            <Route path="courier-and-pickup" element={<Need section="delivery" commerce><CourierPickup /></Need>} />
            <Route path="proof-of-delivery" element={<Need section="delivery" commerce><ProofOfDelivery /></Need>} />
            <Route path="failed-deliveries" element={<Need section="delivery" commerce><FailedShort /></Need>} />
            <Route path="cash-on-delivery" element={<Need section="delivery" commerce><CashOnDelivery /></Need>} />
            <Route path="vehicles" element={<Need section="delivery" commerce><Vehicles /></Need>} />
            <Route path="couriers" element={<Need section="delivery" commerce><Couriers /></Need>} />
            <Route path="delivery-areas" element={<Need section="delivery" commerce><DeliveryAreas /></Need>} />
            <Route path="commerce/packing" element={<OldLink to={{ pick: 'to-pick', packing: 'packing', packed: 'packed-waiting' }} fallback="to-pick" />} />
            <Route path="commerce/delivery" element={<OldLink to={{ ready: 'trips', trips: 'trips', other: 'courier-and-pickup', failed: 'failed-deliveries' }} fallback="trips" />} />
            <Route path="commerce/my-trips" element={<Need section="delivery" commerce><MyTrips /></Need>} />
            <Route path="settings" element={<SettingsMoved />} />
            <Route path="commerce-settings" element={<Need section="settings"><CommerceSettings /></Need>} />
            <Route path="numbering" element={<Need section="settings" commerce><Numbering /></Need>} />
            <Route path="switches" element={<Need section="settings"><Switches /></Need>} />
            <Route path="notifications" element={<Need section="settings"><Notifications /></Need>} />
            <Route path="users" element={<Need section="users"><Users /></Need>} />
            <Route path="roles" element={<Need section="users"><Roles /></Need>} />
            <Route path="approvals" element={<Approvals onChanged={refreshCounts} />} />
            <Route path="company" element={<Need section="settings"><Company /></Need>} />
            <Route path="godowns" element={<Need section="settings" commerce><Godowns /></Need>} />
            <Route path="approval-rules" element={<Need section={['settings', 'users']} commerce><ApprovalRules /></Need>} />
            <Route path="stand-ins" element={<Need section="users" commerce><StandIns /></Need>} />
            <Route path="audit" element={<Need><AuditLog /></Need>} />
            <Route path="p/*" element={<Placeholder />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </Routes>
          </ScreenBoundary>
        </main>
        </div>
        {pulse.toast && (
          <div className="a-toast" role="status" aria-live="polite">
            <Link to="/admin/leads" onClick={pulse.dismissToast}>{pulse.toast}</Link>
            <button type="button" className="a-x" onClick={pulse.dismissToast} aria-label="Dismiss">×</button>
          </div>
        )}
        </ToastProvider>
        </ConfirmProvider>
      </div>
    </AdminContext.Provider>
  );
}

/** phase 20: an old Fulfilment link (commerce/packing?tab=..., commerce/delivery?tab=...) opens the page that replaced it */
function OldLink({ to, fallback }) {
  const loc = useLocation();
  const p = new URLSearchParams(loc.search);
  const tab = p.get('tab'); p.delete('tab');
  const rest = p.toString();
  return <Navigate replace to={`/admin/${to[tab] || fallback}${rest ? `?${rest}` : ''}`} />;
}

/** phase 24: the old Settings page became the Website pages; an old link (#setting-<key>) opens the page that has it */
const SETTING_PAGE = { site_indexing: 'google-and-sharing', share_image: 'google-and-sharing', ga4_measurement_id: 'google-and-sharing',
  door_home_product: 'home-doors', door_biz_product: 'home-doors', brochure_download_enabled: 'brochures', two_step_login: 'users' };
function SettingsMoved() {
  const loc = useLocation();
  const key = (/^#setting-(.+)$/.exec(loc.hash) || [])[1];
  const hashPage = { '#cs-s-home-page': 'home-doors', '#cs-s-sharing-and-seo': 'google-and-sharing' }[loc.hash];
  return <Navigate replace to={`/admin/${SETTING_PAGE[key] || hashPage || 'site-settings'}${key && !SETTING_PAGE[key] ? loc.hash : ''}`} />;
}
