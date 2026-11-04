// Roles and permissions (docs/COMMERCE-SPEC.md section 1), shared by the API (route guards, roles screen data) and
// the admin (menus, buttons). CommonJS: the server requires it, the admin imports it.
// A role is a grid of SECTIONS x ACTIONS (gap map D5: view, create, edit, approve, cancel, export; delete where it is
// used). Super admin (the owner) and Admin are built in HERE and never change (everything). Sub-admin is built in (it
// always exists, nobody deletes it) but its grid is rows like any role: everything, Roles and users and Settings view
// only (migration 12b_01), and an Admin may change it (a widening waits for a second Admin, as v23). Custom roles live
// in role_permissions. Rights that are
// not a section (See cost, Own customers only) and the approval limit are columns of the role (roles table).
const ACTIONS = ['view', 'create', 'edit', 'approve', 'cancel', 'export', 'delete'];

// key, label, commerce (hidden and 404 while Settings commerce_enabled is off), what it covers (Roles screen help)
const SECTIONS = [
  { key: 'leads', label: 'Leads', covers: 'Leads list, drawer, status and notes, exports (Export)' },
  { key: 'orders', label: 'Orders', commerce: true, covers: 'Orders, New order, edit, cancel (Cancel), invoice, payments, Excel (Export)' },
  { key: 'packing', label: 'Packing', commerce: true, covers: 'Packing queue, pick list, scan-to-pack' },
  { key: 'delivery', label: 'Delivery', commerce: true, covers: 'Dispatch, delivery runs, proof of delivery' },
  { key: 'inventory', label: 'Inventory', commerce: true, covers: 'Stock, movements, adjustments, write-off, SKUs and labels' },
  { key: 'returns', label: 'Returns', commerce: true, covers: 'Returns, inspection, refunds, credit notes' },
  { key: 'customers', label: 'Customers', commerce: true, covers: 'Customers, addresses, notes, follow-ups, credit, wallet history' },
  { key: 'promotions', label: 'Promotions', commerce: true, covers: 'Coupons, cashback rules, manual wallet credit' },
  { key: 'products', label: 'Products and catalogue', covers: 'Products, SKUs, categories, kits, raw materials, units, barcodes and labels, photos, size picker, Excel import / export' },
  { key: 'prices', label: 'Prices and tax', commerce: true, covers: 'Price lists, quantity slabs, special prices (Approve: price changes and special prices), HSN and GST rates (v23 section 2)' },
  { key: 'reports', label: 'Reports', commerce: true, covers: 'Sales, GST, stock, returns, wallet and customer reports' },
  { key: 'content', label: 'Content', covers: 'Banners, translations, towns, form options, brochures, languages' },
  { key: 'settings', label: 'Settings', covers: 'Site settings, Commerce settings' },
  { key: 'users', label: 'Roles and users', covers: 'Roles and their permissions, Admin users' },
  { key: 'audit', label: 'Audit log', covers: 'Audit log (view only)' },
];
const SECTION_KEYS = SECTIONS.map((s) => s.key);
const VIEW_ONLY = ['audit']; // sections where only "view" means anything

const ADMIN_ROLE_ID = 1;
const SUBADMIN_ROLE_ID = 2;
const SUPERADMIN_ROLE_ID = 8;
const BUILTIN = {
  [SUPERADMIN_ROLE_ID]: { name: 'Super admin', description: 'The owner. Everything, everywhere. Cannot be changed.', fixed: true },
  [ADMIN_ROLE_ID]: { name: 'Admin', description: 'Everything, in every section.', fixed: true },
  [SUBADMIN_ROLE_ID]: { name: 'Sub-admin', description: 'Everything; Roles and users and Settings view only, unless an Admin gives more.' },
};

const empty = () => Object.fromEntries(ACTIONS.map((a) => [a, false]));

/** { section: { view, create, edit, approve, cancel, export, delete } } for a built-in role, or from role_permissions rows. */
function permsFor(roleId, rows = []) {
  const out = {};
  const fixed = isAdminRole(roleId); // Super admin and Admin: every right, always
  for (const s of SECTION_KEYS) {
    if (fixed) out[s] = Object.fromEntries(ACTIONS.map((a) => [a, !VIEW_ONLY.includes(s) || a === 'view']));
    else out[s] = empty();
  }
  if (!fixed) {
    for (const r of rows) {
      if (!out[r.section]) continue;
      for (const a of ACTIONS) out[r.section][a] = Boolean(Number(r[`can_${a}`]));
      // every other action implies view
      if (ACTIONS.slice(1).some((a) => out[r.section][a])) out[r.section].view = true;
    }
  }
  return out;
}

/** "section:action" -> { section, action }; "any" = any signed-in user */
function parsePerm(perm) {
  if (perm === 'any') return { any: true };
  const [section, action] = String(perm).split(':');
  if (!SECTION_KEYS.includes(section) || !ACTIONS.includes(action)) throw new Error(`unknown permission "${perm}"`);
  return { section, action };
}

const can = (perms, section, action = 'view') => Boolean(perms && perms[section] && perms[section][action]);
/** Super admin or Admin (every right, always; they sign anything) */
const isAdminRole = (roleId) => Number(roleId) === SUPERADMIN_ROLE_ID || Number(roleId) === ADMIN_ROLE_ID;

module.exports = { ACTIONS, SECTIONS, SECTION_KEYS, VIEW_ONLY, ADMIN_ROLE_ID, SUBADMIN_ROLE_ID, SUPERADMIN_ROLE_ID, BUILTIN, permsFor, parsePerm, can, isAdminRole };
