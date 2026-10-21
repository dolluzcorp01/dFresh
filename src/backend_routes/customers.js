// Customers (CRM, docs/COMMERCE-SPEC.md 4.5; migration 20261021_commerce_customers.sql). Shared by the admin routes,
// the order logic (default and chosen addresses, status, price list), the Excel import and the demo seed. Every change
// is audited.
// - CUS-0001 numbers (setting customer_prefix; never DFC, the credit note series). Status: active, on hold (a new order
//   waits for the customer_hold approval), inactive (no new orders). A sales owner (admin user); with the setting
//   own_customers_only the listed roles see only their own customers and those customers' orders.
// - Duplicates: the same mobile (last 10 digits), e-mail or GSTIN (any billing address) as another customer is refused
//   on create and edit with that customer named; Merge moves everything of one customer to another (approval).
// - Addresses: billing ones (each with its own GSTIN, which must belong to its state) and shipping ones (contact,
//   phone, delivery area); one default of each kind; an order picks one of each.
// - A price list of its own (not the type's) through the price_list approval (setting approve_price_list).
// - Timeline: what was typed (calls, WhatsApp, visits, mails, notes) and what happened (lead, orders, payments,
//   returns, wallet, follow-ups). Statement of account with ageing.
const { audit } = require('./audit');
const approvals = require('./approvals');
const commerceSettings = require('./commerce-settings');
const numbering = require('./numbering');
const { checkSetting } = require('../shared/settingRules');
const { isStateCode, stateName } = require('../shared/gstStates');
const { indianMobile, phoneDigits, SOURCES } = require('../shared/customerRules');

const STATUS = { active: 'Active', on_hold: 'On hold', inactive: 'Inactive' };
const ACTIVITY = { call: 'Call', whatsapp: 'WhatsApp', visit: 'Visit', mail: 'Mail', note: 'Note' };
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const round2 = (n) => Math.round(n * 100) / 100;
const IST_TODAY = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))";
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const t = (raw, k) => String((raw || {})[k] ?? '').trim();

class CustomerError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}
const fail = (errors) => { throw new CustomerError(Object.values(errors)[0], 400, { code: 'fields', fields: errors }); };

// ---------------------------------------------------------------- checks
async function types(q) {
  const [rows] = await q.query('SELECT type_key, label, default_credit_days, default_credit_limit FROM customer_types WHERE is_active = 1 ORDER BY sort_order, label');
  return rows;
}
async function adminUsers(q) {
  const [rows] = await q.query('SELECT emp_id FROM admin_users WHERE is_active = 1 ORDER BY emp_id');
  return rows.map((r) => r.emp_id);
}

/** the customer itself -> { values, errors } (only the keys given when partial) */
async function checkCore(q, raw, { partial = false } = {}) {
  const has = (k) => !partial || (raw && k in raw);
  const values = {};
  const errors = {};
  if (has('name')) { values.name = t(raw, 'name'); if (!values.name) errors.name = 'Name is required.'; else if (values.name.length > 120) errors.name = 'At most 120 characters.'; }
  if (has('business_name')) { values.business_name = t(raw, 'business_name') || null; if (values.business_name && values.business_name.length > 150) errors.business_name = 'At most 150 characters.'; }
  if (has('type_key')) {
    values.type_key = t(raw, 'type_key').toLowerCase();
    const ty = await types(q);
    const hit = ty.find((x) => x.type_key === values.type_key || x.label.toLowerCase() === values.type_key);
    if (!hit) errors.type_key = `Type: ${ty.map((x) => x.label).join(', ')}.`; else values.type_key = hit.type_key;
  }
  if (has('phone')) {
    const p = indianMobile(t(raw, 'phone'));
    if (!t(raw, 'phone')) errors.phone = 'Phone is required.'; else if (!p) errors.phone = 'A 10-digit Indian mobile number, e.g. 98765 43210.';
    else { values.phone = p; values.phone_digits = phoneDigits(p); }
  }
  if (has('email')) { values.email = t(raw, 'email').toLowerCase() || null; if (values.email && !EMAIL.test(values.email)) errors.email = 'A plain e-mail address, e.g. name@example.com.'; }
  if (has('source')) { values.source = t(raw, 'source') || null; if (values.source && !SOURCES.includes(values.source) && values.source !== 'Lead' && values.source !== 'Import') errors.source = `One of ${SOURCES.join(', ')}.`; }
  if (has('owner_emp_id')) {
    values.owner_emp_id = t(raw, 'owner_emp_id').toUpperCase() || null;
    if (values.owner_emp_id && !(await adminUsers(q)).includes(values.owner_emp_id)) errors.owner_emp_id = 'The sales owner must be an admin user (emp id).';
  }
  return { values, errors };
}

/** an address -> { values, errors }; billing: GSTIN of its state; shipping: contact person and delivery area */
async function checkAddress(q, raw, kind) {
  const errors = {};
  const v = { kind, label: t(raw, 'label') || null, name: t(raw, 'name'), gstin: kind === 'billing' ? t(raw, 'gstin').toUpperCase() || null : null,
    contact_person: kind === 'shipping' ? t(raw, 'contact_person') || null : null, phone: t(raw, 'phone') || null, address: t(raw, 'address') || null, town: t(raw, 'town') || null,
    state_code: t(raw, 'state_code'), pincode: t(raw, 'pincode') || null, delivery_area_id: kind === 'shipping' && t(raw, 'delivery_area_id') ? Number(t(raw, 'delivery_area_id')) : null };
  const what = kind === 'billing' ? 'Billing address' : 'Shipping address';
  if (!v.name) errors.name = `${what}: the name is required.`;
  if ((v.name || '').length > 150 || (v.address || '').length > 255 || (v.town || '').length > 80 || (v.label || '').length > 80) errors.address = `${what}: a value is too long.`;
  if (!isStateCode(v.state_code)) errors.state_code = `${what}: choose the state (it decides CGST + SGST or IGST).`;
  if (v.pincode && !/^[1-9]\d{5}$/.test(v.pincode)) errors.pincode = `${what}: PIN code is 6 digits.`;
  if (v.phone) { const p = indianMobile(v.phone); if (!p) errors.phone = `${what}: a 10-digit mobile number.`; else v.phone = p; }
  if (v.gstin) {
    const g = checkSetting('gstin', v.gstin);
    if (g.error) errors.gstin = `GSTIN: ${g.error}`;
    else { v.gstin = g.value; if (v.gstin.slice(0, 2) !== v.state_code) errors.gstin = `GSTIN ${v.gstin} is registered in ${stateName(v.gstin.slice(0, 2))}, not ${stateName(v.state_code) || 'the state chosen'}.`; }
  }
  if (v.delivery_area_id) {
    const [[a]] = await q.query('SELECT area_id FROM delivery_areas WHERE area_id = ?', [v.delivery_area_id]);
    if (!a) errors.delivery_area_id = 'Unknown delivery area.';
  }
  return { values: v, errors };
}

function checkContact(raw) {
  const errors = {};
  const v = { name: t(raw, 'name'), role: t(raw, 'role') || null, phone: t(raw, 'phone') || null, email: t(raw, 'email').toLowerCase() || null,
    whatsapp: raw && (raw.whatsapp === true || raw.whatsapp === 1 || raw.whatsapp === '1') ? 1 : 0, gets_invoices: raw && (raw.gets_invoices === true || raw.gets_invoices === 1 || raw.gets_invoices === '1') ? 1 : 0 };
  if (!v.name) errors.contact = 'Contact: the name is required.';
  if (v.phone) { const p = indianMobile(v.phone); if (!p) errors.contact_phone = `Contact ${v.name}: a 10-digit mobile number.`; else v.phone = p; }
  if (v.email && !EMAIL.test(v.email)) errors.contact_email = `Contact ${v.name}: a plain e-mail address.`;
  if (v.gets_invoices && !v.email) errors.contact_email = `Contact ${v.name}: invoices go by e-mail - give the e-mail address.`;
  return { values: v, errors };
}

/** other customers with this phone, e-mail or GSTIN -> [{ customer_id, customer_no, name, by }] */
async function duplicates(q, { phone_digits: pd, email, gstins = [] }, exceptId = 0) {
  const out = [];
  const add = (rows, by) => rows.forEach((r) => { if (!out.some((x) => x.customer_id === r.customer_id && x.by === by)) out.push({ ...r, by }); });
  if (pd) add((await q.query('SELECT customer_id, customer_no, name FROM customers WHERE phone_digits = ? AND customer_id <> ? AND merged_into IS NULL', [pd, exceptId]))[0], 'phone');
  if (email) add((await q.query('SELECT customer_id, customer_no, name FROM customers WHERE email = ? AND customer_id <> ? AND merged_into IS NULL', [email, exceptId]))[0], 'e-mail');
  const g = gstins.filter(Boolean);
  if (g.length) {
    add((await q.query(`SELECT DISTINCT c.customer_id, c.customer_no, c.name FROM customer_addresses a JOIN customers c ON c.customer_id = a.customer_id
        WHERE a.gstin IN (?) AND a.is_active = 1 AND c.customer_id <> ? AND c.merged_into IS NULL`, [g, exceptId]))[0], 'GSTIN');
  }
  return out;
}
const dupError = (d) => new CustomerError(`Already a customer: ${d[0].customer_no} ${d[0].name} (same ${d[0].by})`, 409, { code: 'duplicate', fields: { customer_id: d[0].customer_id, customer_no: d[0].customer_no, name: d[0].name, by: d[0].by } });

// ---------------------------------------------------------------- create / edit
async function insertAddress(q, customerId, v, isDefault) {
  if (isDefault) await q.query('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ? AND kind = ?', [customerId, v.kind]);
  const [ins] = await q.query(`INSERT INTO customer_addresses (customer_id, kind, label, name, gstin, contact_person, phone, address, town, state_code, pincode, delivery_area_id, is_default)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [customerId, v.kind, v.label, v.name, v.gstin, v.contact_person, v.phone, v.address, v.town, v.state_code, v.pincode, v.delivery_area_id, isDefault ? 1 : 0]);
  return ins.insertId;
}

/**
 * data = { name, business_name, type_key, phone, email, source, owner_emp_id, bill: address, ship: address | null (= the
 * billing one), contacts: [contact], tags: [tag], lead_id } -> { customer_id, customer_no, name }
 */
async function createCustomer(q, data, empId, { allowDuplicate = false } = {}) {
  const core = await checkCore(q, { source: 'Phone', ...data });
  const errors = { ...core.errors };
  const bill = await checkAddress(q, data.bill || {}, 'billing');
  Object.assign(errors, bill.errors);
  const shipRaw = data.ship && t(data.ship, 'name') ? data.ship : { ...(data.bill || {}), contact_person: (data.bill || {}).contact_person || core.values.name, phone: (data.bill || {}).phone || core.values.phone };
  const ship = await checkAddress(q, shipRaw, 'shipping');
  Object.assign(errors, ship.errors);
  const contacts = (Array.isArray(data.contacts) ? data.contacts : []).filter((c) => t(c, 'name') || t(c, 'phone')).map(checkContact);
  contacts.forEach((c) => Object.assign(errors, c.errors));
  if (Object.keys(errors).length) fail(errors);
  if (!allowDuplicate) {
    const d = await duplicates(q, { phone_digits: core.values.phone_digits, email: core.values.email, gstins: [bill.values.gstin] });
    if (d.length) throw dupError(d);
  }
  const s = await commerceSettings.read(q);
  const [[ct]] = await q.query('SELECT default_credit_days, default_credit_limit FROM customer_types WHERE type_key = ?', [core.values.type_key]);
  const no = `${s.customer_prefix || 'CUS'}-${numbering.pad(await numbering.next(q, s.customer_prefix || 'CUS', 1))}`;
  const v = core.values;
  const [ins] = await q.query(`INSERT INTO customers (customer_no, name, business_name, type_key, phone, phone_digits, email, source, owner_emp_id, credit_days, credit_limit, lead_id, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [no, v.name, v.business_name, v.type_key, v.phone, v.phone_digits, v.email, v.source, v.owner_emp_id, ct ? ct.default_credit_days : 0, ct ? ct.default_credit_limit : 0, data.lead_id || null, empId]);
  const id = ins.insertId;
  await insertAddress(q, id, bill.values, true);
  await insertAddress(q, id, ship.values, true);
  for (const c of contacts) {
    await q.query('INSERT INTO customer_contacts (customer_id, name, role, phone, email, whatsapp, gets_invoices) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, c.values.name, c.values.role, c.values.phone, c.values.email, c.values.whatsapp, c.values.gets_invoices]);
  }
  await setTags(q, id, data.tags || [], null);
  await audit(q, { empId, action: 'create', entity: 'customer', entityId: no, after: { name: v.name, type: v.type_key, owner: v.owner_emp_id, source: v.source, gstin: bill.values.gstin, state: ship.values.state_code, lead_id: data.lead_id || null, contacts: contacts.length } });
  return { customer_id: id, customer_no: no, name: v.name, type_key: v.type_key, phone: v.phone };
}

async function lockCustomer(q, id) {
  const [[c]] = await q.query('SELECT * FROM customers WHERE customer_id = ? FOR UPDATE', [Number(id)]);
  if (!c) throw new CustomerError('Customer not found', 404);
  if (c.merged_into) throw new CustomerError(`${c.customer_no} was merged into another customer: open that one`, 409);
  return c;
}
const CORE_COLS = ['name', 'business_name', 'type_key', 'phone', 'phone_digits', 'email', 'source', 'owner_emp_id'];

/** edit the customer itself (duplicates checked against the others) */
async function updateCore(q, id, raw, empId) {
  const c = await lockCustomer(q, id);
  const { values, errors } = await checkCore(q, raw, { partial: true });
  if (Object.keys(errors).length) fail(errors);
  const changed = Object.fromEntries(Object.entries(values).filter(([k, v]) => CORE_COLS.includes(k) && String(c[k] ?? '') !== String(v ?? '')));
  if (!Object.keys(changed).length) return { customer_id: c.customer_id, changed: 0 };
  const d = await duplicates(q, { phone_digits: changed.phone_digits, email: changed.email }, c.customer_id);
  if (d.length) throw dupError(d);
  await q.query(`UPDATE customers SET ${Object.keys(changed).map((k) => `${k} = ?`).join(', ')}, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE customer_id = ?`, [...Object.values(changed), empId, c.customer_id]);
  await audit(q, { empId, action: 'update', entity: 'customer', entityId: c.customer_no, before: Object.fromEntries(Object.keys(changed).map((k) => [k, c[k]])), after: changed });
  return { customer_id: c.customer_id, changed: Object.keys(changed).length };
}

/** status: active / on_hold (reason) / inactive */
async function setStatus(q, id, status, reason, empId) {
  const c = await lockCustomer(q, id);
  if (!STATUS[status]) throw new CustomerError('Status: active, on hold or inactive');
  const why = String(reason || '').trim().slice(0, 255) || null;
  if (status !== 'active' && !why) throw new CustomerError(`Say why ${c.name} is ${STATUS[status].toLowerCase()}`);
  await q.query('UPDATE customers SET status = ?, hold_reason = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE customer_id = ?', [status, status === 'active' ? null : why, empId, c.customer_id]);
  await audit(q, { empId, action: 'status', entity: 'customer', entityId: c.customer_no, before: { status: c.status }, after: { status, reason: why } });
  return { status };
}

/** add (addressId null) or change an address; default = the one orders take first; is_active false = removed */
async function saveAddress(q, id, addressId, raw, empId) {
  const c = await lockCustomer(q, id);
  const kind = raw.kind === 'shipping' ? 'shipping' : 'billing';
  let before = null;
  if (addressId) {
    [[before]] = await q.query('SELECT * FROM customer_addresses WHERE address_id = ? AND customer_id = ?', [addressId, c.customer_id]);
    if (!before) throw new CustomerError('No such address of this customer', 404);
    if (raw.is_active === false) {
      if (before.is_default) throw new CustomerError('Make another address the default first');
      await q.query('UPDATE customer_addresses SET is_active = 0, is_default = 0 WHERE address_id = ?', [addressId]);
      await audit(q, { empId, action: 'remove_address', entity: 'customer', entityId: c.customer_no, before: { address_id: addressId, label: before.label, name: before.name } });
      return { address_id: addressId, removed: true };
    }
  }
  const { values: v, errors } = await checkAddress(q, raw, before ? before.kind : kind);
  if (Object.keys(errors).length) fail(errors);
  if (v.gstin) { const d = await duplicates(q, { gstins: [v.gstin] }, c.customer_id); if (d.length) throw dupError(d); }
  const makeDefault = Boolean(raw.is_default);
  if (!addressId) {
    const [[n]] = await q.query('SELECT COUNT(*) AS n FROM customer_addresses WHERE customer_id = ? AND kind = ? AND is_active = 1', [c.customer_id, v.kind]);
    const newId = await insertAddress(q, c.customer_id, v, makeDefault || !Number(n.n));
    await audit(q, { empId, action: 'add_address', entity: 'customer', entityId: c.customer_no, after: { address_id: newId, ...v, is_default: makeDefault } });
    return { address_id: newId };
  }
  if (makeDefault) await q.query('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ? AND kind = ?', [c.customer_id, before.kind]);
  await q.query(`UPDATE customer_addresses SET label = ?, name = ?, gstin = ?, contact_person = ?, phone = ?, address = ?, town = ?, state_code = ?, pincode = ?, delivery_area_id = ?,
      is_default = IF(?, 1, is_default) WHERE address_id = ?`, [v.label, v.name, v.gstin, v.contact_person, v.phone, v.address, v.town, v.state_code, v.pincode, v.delivery_area_id, makeDefault ? 1 : 0, addressId]);
  await audit(q, { empId, action: 'update_address', entity: 'customer', entityId: c.customer_no, before: { ...before, created_at: undefined }, after: { ...v, is_default: makeDefault || Boolean(before.is_default) } });
  return { address_id: addressId };
}

async function saveContact(q, id, contactId, raw, empId) {
  const c = await lockCustomer(q, id);
  if (contactId && raw.is_active === false) {
    await q.query('UPDATE customer_contacts SET is_active = 0 WHERE contact_id = ? AND customer_id = ?', [contactId, c.customer_id]);
    await audit(q, { empId, action: 'remove_contact', entity: 'customer', entityId: c.customer_no, before: { contact_id: contactId } });
    return { contact_id: contactId, removed: true };
  }
  const { values: v, errors } = checkContact(raw);
  if (Object.keys(errors).length) fail(errors);
  if (contactId) {
    const [r] = await q.query('UPDATE customer_contacts SET name = ?, role = ?, phone = ?, email = ?, whatsapp = ?, gets_invoices = ? WHERE contact_id = ? AND customer_id = ?',
      [v.name, v.role, v.phone, v.email, v.whatsapp, v.gets_invoices, contactId, c.customer_id]);
    if (!r.affectedRows) throw new CustomerError('No such contact of this customer', 404);
  } else {
    const [ins] = await q.query('INSERT INTO customer_contacts (customer_id, name, role, phone, email, whatsapp, gets_invoices) VALUES (?, ?, ?, ?, ?, ?, ?)', [c.customer_id, v.name, v.role, v.phone, v.email, v.whatsapp, v.gets_invoices]);
    contactId = ins.insertId;
  }
  await audit(q, { empId, action: 'save_contact', entity: 'customer', entityId: c.customer_no, after: { contact_id: contactId, ...v } });
  return { contact_id: contactId };
}

async function setTags(q, id, tags, empId) {
  const clean = [...new Set((Array.isArray(tags) ? tags : String(tags || '').split(',')).map((x) => String(x).trim().toLowerCase().replace(/\s+/g, ' ')).filter(Boolean))];
  if (clean.some((x) => x.length > 40)) throw new CustomerError('A tag is at most 40 characters');
  const [before] = await q.query('SELECT tag FROM customer_tags WHERE customer_id = ? ORDER BY tag', [id]);
  await q.query('DELETE FROM customer_tags WHERE customer_id = ?', [id]);
  for (const x of clean) await q.query('INSERT INTO customer_tags (customer_id, tag) VALUES (?, ?)', [id, x]);
  if (empId) await audit(q, { empId, action: 'tags', entity: 'customer', entityId: String(id), before: { tags: before.map((r) => r.tag) }, after: { tags: clean } });
  return clean;
}

// ---------------------------------------------------------------- activity and follow-ups
async function addActivity(q, id, raw, empId) {
  const c = await lockCustomer(q, id);
  if (!ACTIVITY[raw.kind]) throw new CustomerError(`What: ${Object.values(ACTIVITY).join(', ')}`);
  const note = String(raw.note || '').trim().slice(0, 2000);
  if (!note) throw new CustomerError('Write what was said or done');
  const when = String(raw.happened_at || '').trim();
  // a date (noon) or a date and time from the form (India time)
  const at = when ? new Date(`${/^\d{4}-\d{2}-\d{2}$/.test(when) ? `${when}T12:00` : when.slice(0, 16)}:00+05:30`) : new Date();
  if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 60e3) throw new CustomerError('When: a date and time, not in the future');
  const [ins] = await q.query('INSERT INTO customer_activity (customer_id, kind, happened_at, note, emp_id) VALUES (?, ?, ?, ?, ?)', [c.customer_id, raw.kind, at, note, empId]);
  await audit(q, { empId, action: 'activity', entity: 'customer', entityId: c.customer_no, after: { kind: raw.kind, happened_at: at.toISOString(), note: note.slice(0, 120) } });
  return { activity_id: ins.insertId };
}

async function addFollowUp(q, id, raw, empId) {
  const c = await lockCustomer(q, id);
  const due = String(raw.due_on || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new CustomerError('Due on: a date');
  const assignee = String(raw.assignee || empId).toUpperCase();
  if (!(await adminUsers(q)).includes(assignee)) throw new CustomerError('Assign it to an admin user');
  const note = String(raw.note || '').trim().slice(0, 255);
  if (!note) throw new CustomerError('What is the follow-up about?');
  const [ins] = await q.query('INSERT INTO follow_ups (customer_id, assignee, due_on, note, created_by) VALUES (?, ?, ?, ?, ?)', [c.customer_id, assignee, due, note, empId]);
  await audit(q, { empId, action: 'follow_up', entity: 'customer', entityId: c.customer_no, after: { follow_up_id: ins.insertId, assignee, due_on: due, note } });
  return { follow_up_id: ins.insertId };
}

/** b = { action: done | snooze, days (snooze), note } */
async function updateFollowUp(q, fid, b, empId) {
  const [[f]] = await q.query('SELECT f.*, c.customer_no FROM follow_ups f JOIN customers c ON c.customer_id = f.customer_id WHERE f.follow_up_id = ? FOR UPDATE', [fid]);
  if (!f) throw new CustomerError('No such follow-up', 404);
  if (f.status !== 'open') throw new CustomerError('This follow-up is done already', 409);
  if (b.action === 'snooze') {
    const days = Number(b.days);
    if (![1, 2, 3, 7, 14, 30].includes(days)) throw new CustomerError('Snooze: 1, 2, 3, 7, 14 or 30 days');
    const due = new Date(Date.now() + 5.5 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
    await q.query('UPDATE follow_ups SET due_on = ?, snoozes = snoozes + 1 WHERE follow_up_id = ?', [due, fid]);
    await audit(q, { empId, action: 'snooze', entity: 'follow_up', entityId: String(fid), before: { due_on: f.due_on }, after: { due_on: due, customer: f.customer_no } });
    return { due_on: due };
  }
  const note = String(b.note || '').trim().slice(0, 255) || null;
  await q.query("UPDATE follow_ups SET status = 'done', done_at = UTC_TIMESTAMP(), done_by = ?, done_note = ? WHERE follow_up_id = ?", [empId, note, fid]);
  await audit(q, { empId, action: 'done', entity: 'follow_up', entityId: String(fid), after: { customer: f.customer_no, note } });
  return { status: 'done' };
}

// ---------------------------------------------------------------- price list of its own (approval)
async function applyPriceList(q, id, listKey, empId) {
  const [[c]] = await q.query('SELECT customer_no, price_list FROM customers WHERE customer_id = ? FOR UPDATE', [id]);
  await q.query('UPDATE customers SET price_list = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE customer_id = ?', [listKey, empId, id]);
  await audit(q, { empId, action: 'price_list', entity: 'customer', entityId: c.customer_no, before: { price_list: c.price_list }, after: { price_list: listKey } });
}
approvals.onApproved('price_list', async (q, p, empId) => applyPriceList(q, p.customer_id, p.price_list, empId));

/** listKey '' = back to the type's list -> { pending, approval_id } */
async function requestPriceList(q, id, listKey, empId) {
  const c = await lockCustomer(q, id);
  const key = listKey ? String(listKey) : null;
  if (key) {
    const [[ok]] = await q.query("SELECT type_key FROM customer_types WHERE type_key = ? UNION SELECT 'default' FROM DUAL WHERE ? = 'default'", [key, key]);
    if (!ok) throw new CustomerError('Unknown price list');
  }
  if ((c.price_list || null) === key) return { pending: false };
  const [[had]] = await q.query("SELECT approval_id FROM approvals WHERE kind = 'price_list' AND ref_type = 'customer' AND ref_id = ? AND status = 'pending'", [String(c.customer_id)]);
  if (had) throw new CustomerError(`A price list change for ${c.name} already waits for approval (#${had.approval_id})`, 409);
  if (key && await approvals.needed(q, 'price_list')) {
    const id2 = await approvals.request(q, { kind: 'price_list', refType: 'customer', refId: String(c.customer_id),
      summary: `${c.customer_no} ${c.name} (${c.type_key}): prices from the ${key} list instead of the ${c.type_key} list`, payload: { customer_id: c.customer_id, price_list: key } }, empId);
    return { pending: true, approval_id: id2 };
  }
  await applyPriceList(q, c.customer_id, key, empId);
  return { pending: false };
}

// ---------------------------------------------------------------- merge (approval)
async function requestMerge(q, keepId, mergeId, reason, empId) {
  if (Number(keepId) === Number(mergeId)) throw new CustomerError('Choose two different customers');
  const keep = await lockCustomer(q, keepId);
  const gone = await lockCustomer(q, mergeId);
  const why = String(reason || '').trim().slice(0, 200);
  if (!why) throw new CustomerError('Say why they are the same customer');
  const [[had]] = await q.query("SELECT approval_id FROM approvals WHERE kind = 'customer_merge' AND status = 'pending' AND (ref_id = ? OR ref_id = ?)", [String(keep.customer_id), String(gone.customer_id)]);
  if (had) throw new CustomerError(`A merge of one of them already waits for approval (#${had.approval_id})`, 409);
  const id = await approvals.request(q, { kind: 'customer_merge', refType: 'customer', refId: String(keep.customer_id),
    summary: `Merge ${gone.customer_no} ${gone.name} into ${keep.customer_no} ${keep.name}: ${why}`, payload: { keep_id: keep.customer_id, merge_id: gone.customer_id, reason: why } }, empId);
  return { approval_id: id };
}
const MERGE_TABLES = ['orders', 'customer_addresses', 'customer_contacts', 'customer_activity', 'follow_ups', 'wallet_entries', 'coupon_redemptions'];
async function doMerge(q, keepId, mergeId, reason, empId) {
  const keep = await lockCustomer(q, keepId);
  const gone = await lockCustomer(q, mergeId);
  const moved = {};
  await q.query('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?', [gone.customer_id]); // the kept customer's defaults stay
  for (const tbl of MERGE_TABLES) {
    const [r] = await q.query(`UPDATE ${tbl} SET customer_id = ? WHERE customer_id = ?`, [keep.customer_id, gone.customer_id]);
    moved[tbl] = r.affectedRows;
  }
  await q.query("UPDATE coupon_scope SET customer_id = ? WHERE customer_id = ? AND scope = 'customer'", [keep.customer_id, gone.customer_id]);
  await q.query('INSERT IGNORE INTO customer_tags (customer_id, tag) SELECT ?, tag FROM customer_tags WHERE customer_id = ?', [keep.customer_id, gone.customer_id]);
  await q.query('DELETE FROM customer_tags WHERE customer_id = ?', [gone.customer_id]);
  if (!keep.lead_id && gone.lead_id) await q.query('UPDATE customers SET lead_id = ? WHERE customer_id = ?', [gone.lead_id, keep.customer_id]);
  await q.query("UPDATE customers SET status = 'inactive', merged_into = ?, hold_reason = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE customer_id = ?",
    [keep.customer_id, `Merged into ${keep.customer_no}`, empId, gone.customer_id]);
  await q.query("INSERT INTO customer_activity (customer_id, kind, happened_at, note, emp_id) VALUES (?, 'note', UTC_TIMESTAMP(), ?, ?)",
    [keep.customer_id, `${gone.customer_no} ${gone.name} merged into this customer (${reason}): ${Object.entries(moved).filter(([, n]) => n).map(([k, n]) => `${n} ${k.replace('customer_', '').replace('_', ' ')}`).join(', ') || 'nothing to move'}`, empId]);
  await audit(q, { empId, action: 'merge', entity: 'customer', entityId: keep.customer_no, after: { merged: gone.customer_no, reason, moved } });
  return { keep: keep.customer_no, merged: gone.customer_no, moved };
}
approvals.onApproved('customer_merge', async (q, p, empId) => { await doMerge(q, p.keep_id, p.merge_id, p.reason, empId); });

// ---------------------------------------------------------------- visibility, defaults for orders
/** the emp_id a user is limited to (own customers only), or null when they see everyone */
function ownScope(admin, settings) {
  if (!settings.own_customers_only || !admin) return null;
  const roles = Array.isArray(settings.own_customers_role_ids) ? settings.own_customers_role_ids.map(Number) : [];
  return roles.includes(Number(admin.role_id)) ? admin.emp_id : null;
}

/** the addresses of a customer (active ones; defaults first) */
async function addressesOf(q, id) {
  const [rows] = await q.query(`SELECT a.address_id, a.kind, a.label, a.name, a.gstin, a.contact_person, a.phone, a.address, a.town, a.state_code, a.pincode, a.delivery_area_id, a.is_default, d.label AS area
      FROM customer_addresses a LEFT JOIN delivery_areas d ON d.area_id = a.delivery_area_id WHERE a.customer_id = ? AND a.is_active = 1 ORDER BY a.kind, a.is_default DESC, a.address_id`, [id]);
  return rows.map((r) => ({ ...r, is_default: Number(r.is_default) === 1, state: stateName(r.state_code) }));
}

// ---------------------------------------------------------------- timeline, statement
/** typed activity and what happened, newest first */
async function timeline(q, id) {
  const [rows] = await q.query(
    `SELECT 'activity' AS src, a.kind, a.happened_at AS at, a.note AS text, a.emp_id, NULL AS ref FROM customer_activity a WHERE a.customer_id = ?
     UNION ALL SELECT 'order', 'order', o.created_at, CONCAT('Order ', o.order_no, ' - Rs ', FORMAT(o.total, 2), ' (', o.status, ')'), o.emp_id, o.order_no FROM orders o WHERE o.customer_id = ?
     UNION ALL SELECT 'order', 'delivered', o.delivered_at, CONCAT(o.order_no, ' delivered', IF(o.received_by IS NULL, '', CONCAT(' to ', o.received_by))), NULL, o.order_no FROM orders o WHERE o.customer_id = ? AND o.delivered_at IS NOT NULL
     UNION ALL SELECT 'order', 'cancelled', o.cancelled_at, CONCAT(o.order_no, ' cancelled: ', COALESCE(o.cancel_reason, '')), o.updated_by, o.order_no FROM orders o WHERE o.customer_id = ? AND o.cancelled_at IS NOT NULL
     UNION ALL SELECT 'payment', p.kind, p.created_at, CONCAT(IF(p.kind = 'refund', 'Refund ', 'Payment '), 'Rs ', FORMAT(p.amount, 2), ' (', p.mode, IF(p.reference IS NULL, '', CONCAT(', ', p.reference)), ') on ', o.order_no), p.emp_id, o.order_no
       FROM payments p JOIN orders o ON o.order_id = p.order_id WHERE o.customer_id = ?
     UNION ALL SELECT 'return', r.status, r.created_at, CONCAT('Return ', r.return_no, ' on ', o.order_no, ' (', r.status, ')'), r.requested_by, r.return_no FROM returns r JOIN orders o ON o.order_id = r.order_id WHERE o.customer_id = ?
     UNION ALL SELECT 'wallet', w.source, w.created_at, CONCAT('Wallet ', IF(w.amount >= 0, '+', '-'), ' Rs ', FORMAT(ABS(w.amount), 2), ': ', w.reason), w.emp_id, NULL FROM wallet_entries w WHERE w.customer_id = ?
     UNION ALL SELECT 'follow_up', f.status, f.created_at, CONCAT('Follow-up for ', f.assignee, ' due ', DATE_FORMAT(f.due_on, '%d %b %Y'), ': ', f.note, IF(f.status = 'done', CONCAT(' - done', IF(f.done_note IS NULL, '', CONCAT(': ', f.done_note))), '')), f.created_by, NULL
       FROM follow_ups f WHERE f.customer_id = ?
     ORDER BY at DESC LIMIT 300`, [id, id, id, id, id, id, id, id]);
  return rows;
}

/**
 * Statement of account (India dates): invoices and refunds (debit), payments, wallet used as payment and credit notes
 * (credit), refunds to the wallet (debit: the money went to the wallet), running balance; ageing of what is open by the
 * invoice date: 0-30 / 31-60 / 61-90 / 90+ days.
 */
async function statement(q, id, { from = null, to = null } = {}) {
  const day = (col) => `DATE_FORMAT(CONVERT_TZ(${col}, '+00:00', '+05:30'), '%Y-%m-%d')`;
  const [rows] = await q.query(
    `SELECT ${day('i.issued_at')} AS day, i.issued_at AS at, 'invoice' AS kind, CONCAT('Invoice ', i.invoice_no, ' (', o.order_no, ')', IF(i.status = 'cancelled', ' - cancelled', '')) AS text, i.total AS debit, 0 AS credit
       FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE o.customer_id = ?
     UNION ALL SELECT ${day('cn.issued_at')}, cn.issued_at, 'credit_note', CONCAT('Credit note ', cn.credit_note_no, ' against ', i.invoice_no, IF(r.return_no IS NULL, '', CONCAT(' (return ', r.return_no, ')'))), 0, cn.total
       FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id JOIN orders o ON o.order_id = i.order_id LEFT JOIN returns r ON r.return_id = cn.return_id WHERE o.customer_id = ?
     UNION ALL SELECT DATE_FORMAT(p.received_on, '%Y-%m-%d'), p.created_at, p.kind, CONCAT(IF(p.kind = 'refund', 'Refund paid ', 'Payment '), p.mode, IF(p.reference IS NULL, '', CONCAT(' ', p.reference)), ' (', o.order_no, ')'),
       IF(p.kind = 'refund', p.amount, 0), IF(p.kind = 'refund', 0, p.amount) FROM payments p JOIN orders o ON o.order_id = p.order_id WHERE o.customer_id = ?
     UNION ALL SELECT ${day('i.issued_at')}, i.issued_at, 'wallet', CONCAT('Paid from the wallet (', o.order_no, ')'), 0, o.wallet_used - o.wallet_discount
       FROM orders o JOIN invoices i ON i.order_id = o.order_id AND i.status = 'issued' WHERE o.customer_id = ? AND o.wallet_used - o.wallet_discount > 0.005
     UNION ALL SELECT ${day('f.paid_at')}, f.paid_at, 'refund_wallet', CONCAT('Refund to the wallet (', r.return_no, ')'), f.amount, 0
       FROM refunds f JOIN returns r ON r.return_id = f.return_id JOIN orders o ON o.order_id = f.order_id WHERE o.customer_id = ? AND f.method = 'wallet' AND f.status = 'paid'
     ORDER BY day, at`, [id, id, id, id, id]);
  let bal = 0;
  let opening = 0;
  const lines = [];
  for (const r of rows) {
    const d = Number(r.debit) || 0; const c = Number(r.credit) || 0;
    if (from && r.day < from) { opening = round2(opening + d - c); bal = opening; continue; }
    if (to && r.day > to) continue;
    bal = round2(bal + d - c);
    lines.push({ day: r.day, kind: r.kind, text: r.text, debit: round2(d), credit: round2(c), balance: bal });
  }
  const [open] = await q.query(
    `SELECT i.invoice_no, o.order_no, ${day('i.issued_at')} AS day, DATE_FORMAT(i.due_on, '%Y-%m-%d') AS due_on, o.amount_due,
            DATEDIFF(${IST_TODAY}, DATE(CONVERT_TZ(i.issued_at, '+00:00', '+05:30'))) AS age
       FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE o.customer_id = ? AND i.status = 'issued' AND o.status <> 'cancelled' AND o.amount_due > 0.005 ORDER BY i.issued_at`, [id]);
  const ageing = { d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
  const openRows = open.map((o) => {
    const a = Number(o.age); const due = Number(o.amount_due);
    const b = a <= 30 ? 'd0_30' : a <= 60 ? 'd31_60' : a <= 90 ? 'd61_90' : 'd90';
    ageing[b] = round2(ageing[b] + due);
    return { ...o, amount_due: due, age: a, bucket: b, overdue: o.due_on < istToday() };
  });
  return { opening, lines, closing: bal, open: openRows, ageing, outstanding: round2(openRows.reduce((x, o) => x + o.amount_due, 0)) };
}

// ---------------------------------------------------------------- leads
/** a lead becomes a customer (once): name, phone, e-mail, town, the contact person; type from the form */
async function fromLead(q, leadId, raw, empId) {
  const [[l]] = await q.query('SELECT lead_id, lead_ref, form_type, full_name, business_name, business_type, town, phone, email, details_json, assigned_to FROM leads WHERE lead_id = ?', [leadId]);
  if (!l) throw new CustomerError('Lead not found', 404);
  const [[had]] = await q.query('SELECT customer_id, customer_no, name FROM customers WHERE lead_id = ? AND merged_into IS NULL', [l.lead_id]);
  if (had) return { ...had, existed: true };
  const bt = `${l.business_type || ''} ${l.business_name || ''}`.toLowerCase();
  const type = l.form_type === 'distributor' ? 'distributor'
    : /hotel|restaurant|cafe|caterer|lodge|resort|food/.test(bt) ? 'hotel'
      : /hospital|clinic|health|medical/.test(bt) ? 'hospital'
        : /office|corporate|school|college|bank|it/.test(bt) ? 'office' : 'home';
  const det = typeof l.details_json === 'string' ? JSON.parse(l.details_json || '{}') : (l.details_json || {});
  const gstin = det && det.gst_no ? String(det.gst_no).toUpperCase() : null;
  const name = l.business_name || l.full_name || l.lead_ref;
  const state = raw.state_code || (gstin ? gstin.slice(0, 2) : '33');
  const addr = { name, gstin, address: raw.address || null, town: l.town, state_code: state, pincode: raw.pincode || null, phone: l.phone };
  const r = await createCustomer(q, {
    name, business_name: l.business_name || null, type_key: raw.type_key || type, phone: l.phone, email: l.email, source: 'Lead', owner_emp_id: raw.owner_emp_id || l.assigned_to || null, lead_id: l.lead_id,
    bill: addr, ship: { ...addr, gstin: null, contact_person: l.full_name || name },
    contacts: l.full_name ? [{ name: l.full_name, role: l.business_name ? 'Contact from the website' : null, phone: l.phone, email: l.email, whatsapp: true, gets_invoices: Boolean(l.email) }] : [],
  }, empId);
  return { ...r, existed: false };
}

module.exports = { STATUS, ACTIVITY, CustomerError, types, checkCore, checkAddress, checkContact, duplicates, createCustomer, updateCore, setStatus, saveAddress, saveContact,
  setTags, addActivity, addFollowUp, updateFollowUp, requestPriceList, requestMerge, doMerge, ownScope, addressesOf, timeline, statement, fromLead, lockCustomer };
