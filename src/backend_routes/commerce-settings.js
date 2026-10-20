// Commerce settings (docs/COMMERCE-SPEC.md section 3; table commerce_settings, migration 20261020_commerce_settings.sql).
// read(q) -> { key: typed value }; check(row, raw) -> { value, error } (the stored text) for the admin PUT.
// The lists (customer types, return reasons, delivery methods and areas, locations) are described in LISTS and edited
// through the generic list routes in Admin_server.js.
const { checkSetting } = require('../shared/settingRules');

const GSTIN_PLACEHOLDER = 'TO-BE-CONFIRMED';

function typed(row) {
  const v = row.value;
  switch (row.value_type) {
    case 'bool': return v === '1';
    case 'int': return Number.parseInt(v, 10) || 0;
    case 'decimal': return Number(v) || 0;
    case 'roles': try { return JSON.parse(v); } catch { return []; }
    default: return v;
  }
}

/** every setting, typed */
async function read(q) {
  const [rows] = await q.query('SELECT setting_key, value, value_type FROM commerce_settings');
  return Object.fromEntries(rows.map((r) => [r.setting_key, typed(r)]));
}

/** a value typed in the admin -> { value (text to store), error } */
function check(row, raw, roleIds = []) {
  const s = String(raw ?? '').trim();
  const bad = (error) => ({ value: s, error });
  switch (row.value_type) {
    case 'bool': return s === '1' || s === '0' || s === 'true' || s === 'false' ? { value: s === '1' || s === 'true' ? '1' : '0', error: null } : bad('On or off');
    case 'int': return /^\d{1,7}$/.test(s) ? { value: String(Number(s)), error: null } : bad('A whole number, 0 or more');
    case 'decimal': return /^\d{1,9}(\.\d{1,2})?$/.test(s) ? { value: String(Number(s)), error: null } : bad('A number, 0 or more (2 decimals at most)');
    case 'select': {
      const opts = JSON.parse(row.options || '[]').map((o) => o[0]);
      return opts.includes(s) ? { value: s, error: null } : bad(`One of: ${opts.join(', ')}`);
    }
    case 'roles': {
      let ids;
      try { ids = JSON.parse(s); } catch { return bad('A list of roles'); }
      if (!Array.isArray(ids) || !ids.length) return bad('Choose at least one approver role');
      if (ids.some((id) => !roleIds.includes(Number(id)))) return bad('Unknown role');
      return { value: JSON.stringify([...new Set(ids.map(Number))].sort((a, b) => a - b)), error: null };
    }
    default: {
      if (s.length > 1000) return bad('At most 1000 characters');
      if (row.setting_key === 'invoice_seller_gstin' && s !== GSTIN_PLACEHOLDER) {
        const g = checkSetting('gstin', s);
        if (!s || g.error) return bad(`A GSTIN like 33ABCDE1234F1Z5, or ${GSTIN_PLACEHOLDER} until it is known`);
        return { value: g.value, error: null };
      }
      if (row.setting_key === 'invoice_seller_state_code' && !/^\d{2}$/.test(s)) return bad('Two digits, e.g. 33 for Tamil Nadu');
      if (/_prefix$/.test(row.setting_key) && !/^[A-Z]{2,5}$/.test(s)) return bad('2 to 5 capital letters');
      return { value: s, error: null };
    }
  }
}

/** true while the invoice must say "DEMO - not a tax invoice" (the seller GSTIN is not a real one yet) */
function invoiceIsDemo(settings) {
  return !!checkSetting('gstin', settings.invoice_seller_gstin || '').error || !settings.invoice_seller_gstin
    || settings.invoice_seller_gstin === GSTIN_PLACEHOLDER;
}

// List editors on the Commerce settings page. type: text | int | decimal | bool; req = required; null = may be empty
const LISTS = {
  customer_types: {
    label: 'Customer types', table: 'customer_types', pk: 'type_key', auto: false,
    cols: { type_key: { label: 'Key', type: 'key', req: true }, label: { label: 'Name', type: 'text', req: true }, min_order_value: { label: 'Minimum order (Rs)', type: 'decimal' },
      default_credit_days: { label: 'Credit days', type: 'int' }, default_credit_limit: { label: 'Credit limit (Rs)', type: 'decimal' }, sort_order: { label: 'Order', type: 'int' }, is_active: { label: 'On', type: 'bool' } },
  },
  return_reasons: {
    label: 'Return reasons', table: 'return_reasons', pk: 'reason_id', auto: true,
    cols: { label: { label: 'Reason', type: 'text', req: true }, needs_photo: { label: 'Photo needed', type: 'bool' }, sort_order: { label: 'Order', type: 'int' }, is_active: { label: 'On', type: 'bool' } },
  },
  delivery_methods: {
    label: 'Delivery methods', table: 'delivery_methods', pk: 'method_id', auto: true,
    cols: { label: { label: 'Method', type: 'text', req: true }, needs_tracking_no: { label: 'Tracking no. needed', type: 'bool' }, sort_order: { label: 'Order', type: 'int' }, is_active: { label: 'On', type: 'bool' } },
  },
  delivery_areas: {
    label: 'Delivery areas and charges', table: 'delivery_areas', pk: 'area_id', auto: true,
    cols: { label: { label: 'Area', type: 'text', req: true }, towns: { label: 'Towns / pincodes (comma separated)', type: 'text' }, charge: { label: 'Charge (Rs)', type: 'decimal' },
      free_above: { label: 'Free above (Rs, empty = never)', type: 'decimal', nullable: true }, sort_order: { label: 'Order', type: 'int' }, is_active: { label: 'On', type: 'bool' } },
  },
  locations: {
    label: 'Stock locations', table: 'locations', pk: 'location_id', auto: true,
    cols: { name: { label: 'Location', type: 'text', req: true }, address: { label: 'Address', type: 'text' }, sort_order: { label: 'Order', type: 'int' }, is_active: { label: 'On', type: 'bool' } },
  },
};

/** one list row from the admin -> { values, errors } */
function checkListRow(list, raw, { creating }) {
  const values = {};
  const errors = {};
  for (const [col, def] of Object.entries(list.cols)) {
    if (col === list.pk && !creating) continue;
    const v = raw[col];
    const s = String(v ?? '').trim();
    if (def.type === 'bool') { values[col] = v === true || v === 1 || s === '1' || s === 'true' ? 1 : 0; continue; }
    if (!s) {
      if (def.req) errors[col] = `${def.label} is required`;
      else values[col] = def.nullable ? null : (def.type === 'text' ? '' : 0);
      continue;
    }
    if (def.type === 'key' && !/^[a-z][a-z0-9_]{1,19}$/.test(s)) errors[col] = 'Small letters, digits and _ (2 to 20)';
    else if (def.type === 'int' && !/^\d{1,7}$/.test(s)) errors[col] = 'A whole number';
    else if (def.type === 'decimal' && !/^\d{1,9}(\.\d{1,2})?$/.test(s)) errors[col] = 'A number (2 decimals at most)';
    else if (def.type === 'text' && s.length > (col === 'towns' ? 1000 : 255)) errors[col] = 'Too long';
    values[col] = def.type === 'int' || def.type === 'decimal' ? Number(s) : s;
  }
  return { values, errors };
}

module.exports = { read, check, typed, invoiceIsDemo, LISTS, checkListRow, GSTIN_PLACEHOLDER };
