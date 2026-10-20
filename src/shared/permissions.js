// Roles and permissions (docs/COMMERCE-SPEC.md section 1), shared by the API (route guards, roles screen data) and
// the admin (menus, buttons). CommonJS: the server requires it, the admin imports it.
// A role is a grid of SECTIONS x ACTIONS. Built-in roles are defined HERE and are not editable: Admin (everything),
// Sub-admin (everything except Roles and users and Settings). Custom roles live in role_permissions.
const ACTIONS = ['view', 'create', 'edit', 'approve', 'delete'];

// key, label, commerce (hidden and 404 while Settings commerce_enabled is off), what it covers (Roles screen help)
const SECTIONS = [
  { key: 'leads', label: 'Leads', covers: 'Leads list, drawer, status and notes, exports (export needs edit)' },
  { key: 'orders', label: 'Orders', commerce: true, covers: 'Orders, New order, edit, cancel, invoice, payments' },
  { key: 'packing', label: 'Packing', commerce: true, covers: 'Packing queue, pick list, scan-to-pack' },
  { key: 'delivery', label: 'Delivery', commerce: true, covers: 'Dispatch, delivery runs, proof of delivery' },
  { key: 'inventory', label: 'Inventory', commerce: true, covers: 'Stock, movements, adjustments, write-off, SKUs and labels' },
  { key: 'returns', label: 'Returns', commerce: true, covers: 'Returns, inspection, refunds, credit notes' },
  { key: 'customers', label: 'Customers', commerce: true, covers: 'Customers, addresses, notes, follow-ups, credit, wallet history' },
  { key: 'promotions', label: 'Promotions', commerce: true, covers: 'Coupons, cashback rules, manual wallet credit' },
  { key: 'products', label: 'Products and prices', covers: 'Products, categories, kits, size picker, photos, Excel import / export, price lists' },
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
const BUILTIN = {
  [ADMIN_ROLE_ID]: { name: 'Admin', description: 'Everything, in every section.', grants: () => true },
  [SUBADMIN_ROLE_ID]: { name: 'Sub-admin', description: 'Everything except Roles and users and Settings.', grants: (section) => !['users', 'settings'].includes(section) },
};

const empty = () => Object.fromEntries(ACTIONS.map((a) => [a, false]));

/** { section: { view, create, edit, approve, delete } } for a built-in role, or from role_permissions rows. */
function permsFor(roleId, rows = []) {
  const out = {};
  const builtin = BUILTIN[roleId];
  for (const s of SECTION_KEYS) {
    if (builtin) {
      const on = builtin.grants(s);
      out[s] = Object.fromEntries(ACTIONS.map((a) => [a, on && (!VIEW_ONLY.includes(s) || a === 'view')]));
    } else out[s] = empty();
  }
  if (!builtin) {
    for (const r of rows) {
      if (!out[r.section]) continue;
      for (const a of ACTIONS) out[r.section][a] = Boolean(Number(r[`can_${a}`]));
      // create / edit / approve / delete imply view
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

module.exports = { ACTIONS, SECTIONS, SECTION_KEYS, VIEW_ONLY, ADMIN_ROLE_ID, SUBADMIN_ROLE_ID, BUILTIN, permsFor, parsePerm, can };
