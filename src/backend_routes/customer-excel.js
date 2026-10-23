// Customers Excel (Sales > Customers > Excel): export the customers (the list's filters) with their default
// billing and shipping address; import = dry run first (every new customer, every change and every error), Apply only
// for the exact file (fingerprint) that passed with 0 errors, checked again inside the transaction - the same rules as
// the product and price imports, and the same checks as the customer drawer (customers.js: mobile, e-mail, GSTIN of its
// state, duplicates by phone / e-mail / GSTIN, also between rows of the file).
// A row without Customer_no is a new customer; with one, that customer is changed. Price list, credit terms and the
// figures are read-only here (a price list of its own and a higher credit limit go through approval in the drawer).
const ExcelJS = require('exceljs');
const theme = require('./excel-theme');
const { sheetRows } = require('./product-excel');
const customers = require('./customers');
const { InputError } = require('./admin-entities');

const SHEET = 'Customers';
const COLS = ['Customer_no', 'Name', 'Business_name', 'Type', 'Status', 'Status_reason', 'Phone', 'Email', 'Owner', 'Tags', 'Source',
  'Bill_label', 'Bill_name', 'Bill_GSTIN', 'Bill_phone', 'Bill_address', 'Bill_town', 'Bill_state', 'Bill_PIN',
  'Ship_label', 'Ship_name', 'Ship_contact', 'Ship_phone', 'Ship_address', 'Ship_town', 'Ship_state', 'Ship_PIN',
  'Price_list', 'Credit_days', 'Credit_limit', 'Outstanding', 'Wallet', 'Last_order'];
const READ_ONLY = ['Price_list', 'Credit_days', 'Credit_limit', 'Outstanding', 'Wallet', 'Last_order'];
const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const txt = (v) => (blank(v) ? '' : String(v).trim());

/** rows = the Customers list rows (already filtered and limited to what the user may see) */
async function buildWorkbook(q, rows, { who = 'dFresh admin', filters = null } = {}) {
  const ids = rows.map((r) => r.customer_id);
  const [addr] = ids.length ? await q.query('SELECT * FROM customer_addresses WHERE customer_id IN (?) AND is_default = 1 AND is_active = 1', [ids]) : [[]];
  const of = (id, kind) => addr.find((a) => a.customer_id === id && a.kind === kind) || {};
  const wb = theme.newWorkbook('dFresh Customers');
  const meta = { exportedBy: who, filters };
  theme.notesSheet(wb, 'Read_Me', {
    ...meta,
    title: 'dFresh Customers',
    lines: [
      [`${rows.length} customers`, true],
      [''],
      ['How to use', true],
      ['• Customers sheet: one row per customer with its default billing and shipping address. Edit, then import in the admin (Customers > Excel): a dry run shows every change first.'],
      ['• A row without Customer_no is a new customer. Phone: a 10-digit Indian mobile. Type: Home, Hotel, Hospital, Office or Distributor.'],
      ['• Status: active, on_hold or inactive (Status_reason is required for on_hold and inactive). Owner: the emp id of an admin user. Tags: comma separated.'],
      ['• Bill_GSTIN must belong to Bill_state (2-digit state code, e.g. 33 Tamil Nadu, 29 Karnataka). Empty Ship_name = shipped to the billing address (new customers).'],
      ['• Duplicates (same phone, e-mail or GSTIN as another customer or another row) are refused: merge in the admin instead.'],
      ['• Read-only: Price_list, Credit_days, Credit_limit, Outstanding, Wallet, Last_order (change them in the customer drawer; some need approval).'],
      ['• Keep the column names in the dark header row as they are: the import finds its columns by these names.'],
    ],
  });
  theme.tableSheet(wb, SHEET, {
    ...meta,
    title: 'dFresh Customers',
    freezeCols: 2,
    columns: COLS.map((h) => ({ header: h, width: /address|Name|name/.test(h) ? 26 : 14, type: ['Credit_days', 'Credit_limit', 'Outstanding', 'Wallet'].includes(h) ? 'number' : undefined })),
    rows: rows.map((r) => {
      const b = of(r.customer_id, 'billing'); const s = of(r.customer_id, 'shipping');
      return [r.customer_no, r.name, r.business_name, r.type_label, r.status, r.hold_reason, r.phone, r.email, r.owner_emp_id, (r.tags || []).join(', '), r.source,
        b.label, b.name, b.gstin, b.phone, b.address, b.town, b.state_code, b.pincode, s.label, s.name, s.contact_person, s.phone, s.address, s.town, s.state_code, s.pincode,
        r.price_list || '', r.credit_days, r.credit_limit, r.outstanding, r.wallet, r.last_order ? theme.istStamp(r.last_order, false) : ''];
    }),
  });
  return wb;
}

const addrOf = (r, p) => ({ label: txt(r[`${p}_label`]), name: txt(r[`${p}_name`]), gstin: p === 'Bill' ? txt(r.Bill_GSTIN) : '', contact_person: p === 'Ship' ? txt(r.Ship_contact) : '',
  phone: txt(r[`${p}_phone`]), address: txt(r[`${p}_address`]), town: txt(r[`${p}_town`]), state_code: txt(r[`${p}_state`]).padStart(2, '0'), pincode: txt(r[`${p}_PIN`]) });
const hasAddr = (r, p) => ['label', 'name', 'address', 'town', 'state', 'PIN'].some((k) => !blank(r[`${p}_${k}`])) || (p === 'Bill' && !blank(r.Bill_GSTIN));

/** -> { ok, summary, errors, notes, unknownColumns, creates, changes, plan } (nothing is written) */
async function diffWorkbook(q, buffer, opts = {}) { // opts.own: a user limited to their own customers (security review H1)
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new InputError('This is not an Excel (.xlsx) file this tool can read'); }
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new InputError(`The workbook has no "${SHEET}" sheet (use the exported customer list)`);
  if (ws.rowCount > 5001) throw new InputError(`At most 5,000 rows in one import (this sheet has ${ws.rowCount - 1})`); // security review L3
  const { header, rows } = sheetRows(ws, 'Customer_no');
  if (!header.includes('Name') || !header.includes('Phone')) throw new InputError(`The ${SHEET} sheet needs at least the Name and Phone columns`);
  const unknownColumns = header.filter((h) => !COLS.includes(h)).map((h) => `${SHEET}!${h}`);
  const errors = []; const notes = []; const creates = []; const changes = [];
  const plan = { creates: [], updates: [] };
  const inFile = { phone: new Map(), email: new Map(), gstin: new Map() };
  const seenNo = new Set();
  const claim = (key, val, at) => { if (!val) return null; const m = inFile[key]; if (m.has(val)) return m.get(val); m.set(val, at); return null; };
  for (const r of rows) {
    const at = `${SHEET} row ${r._row}`;
    const no = txt(r.Customer_no).toUpperCase();
    const core = await customers.checkCore(q, { name: txt(r.Name), business_name: txt(r.Business_name), type_key: txt(r.Type) || 'home', phone: txt(r.Phone), email: txt(r.Email),
      source: txt(r.Source) || 'Import', owner_emp_id: txt(r.Owner) });
    const errs = Object.values(core.errors);
    const tags = txt(r.Tags).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    const status = txt(r.Status).toLowerCase().replace(' ', '_') || 'active';
    if (!customers.STATUS[status]) errs.push('Status: active, on_hold or inactive');
    if (status !== 'active' && !txt(r.Status_reason) && header.includes('Status')) errs.push(`Status ${status}: give the Status_reason`);
    const bill = hasAddr(r, 'Bill') ? await customers.checkAddress(q, addrOf(r, 'Bill'), 'billing') : null;
    const ship = hasAddr(r, 'Ship') ? await customers.checkAddress(q, addrOf(r, 'Ship'), 'shipping') : null;
    if (bill) errs.push(...Object.values(bill.errors));
    if (ship) errs.push(...Object.values(ship.errors));
    // duplicates between rows of the file
    for (const [k, v] of [['phone', core.values.phone_digits], ['email', core.values.email], ['gstin', bill && bill.values.gstin]]) {
      const other = claim(k, v, r._row);
      if (other) errs.push(`same ${k === 'gstin' ? 'GSTIN' : k} as row ${other}`);
    }
    if (!no) {
      if (!bill) errs.push('a new customer needs its billing address (Bill_name and Bill_state at least)');
      if (!errs.length) {
        const d = await customers.duplicates(q, { phone_digits: core.values.phone_digits, email: core.values.email, gstins: [bill.values.gstin] });
        if (d.length) errs.push(`already a customer: ${d[0].customer_no} ${d[0].name} (same ${d[0].by})`);
      }
      if (errs.length) { errors.push(`${at} (new ${txt(r.Name) || 'customer'}): ${errs.join('; ')}`); continue; }
      plan.creates.push({ data: { ...core.values, ...(opts.own ? { owner_emp_id: opts.own } : {}), phone: core.values.phone, bill: addrOf(r, 'Bill'), ship: ship ? addrOf(r, 'Ship') : null, tags }, status, reason: txt(r.Status_reason) });
      creates.push({ row: r._row, name: core.values.name, type: core.values.type_key, phone: core.values.phone, gstin: bill.values.gstin, state: bill.values.state_code });
      continue;
    }
    if (seenNo.has(no)) { errors.push(`${at}: ${no} appears twice`); continue; }
    seenNo.add(no);
    const [[c]] = await q.query('SELECT * FROM customers WHERE customer_no = ?', [no]);
    if (!c) { errors.push(`${at}: there is no customer ${no}`); continue; }
    if (opts.own && c.owner_emp_id !== opts.own) { errors.push(`${at}: ${no} belongs to another sales owner`); continue; } // nothing of it is shown or changed
    if (c.merged_into) { errors.push(`${at}: ${no} was merged into another customer`); continue; }
    if (!errs.length) {
      const d = await customers.duplicates(q, { phone_digits: core.values.phone_digits, email: core.values.email, gstins: bill ? [bill.values.gstin] : [] }, c.customer_id);
      if (d.length) errs.push(`same ${d[0].by} as ${d[0].customer_no} ${d[0].name}`);
    }
    if (errs.length) { errors.push(`${at} (${no}): ${errs.join('; ')}`); continue; }
    const u = { customer_id: c.customer_id, customer_no: no, core: {}, status: null, tags: null, addresses: [] };
    if (opts.own) core.values.owner_emp_id = opts.own; // a user limited to their own customers keeps them (the Owner column is not theirs to change)
    const fields = { name: 'Name', business_name: 'Business_name', type_key: 'Type', phone: 'Phone', email: 'Email', owner_emp_id: 'Owner', source: 'Source' };
    for (const [k, h] of Object.entries(fields)) {
      if (!header.includes(h)) continue;
      const nv = core.values[k] ?? null;
      if (k === 'source' && !txt(r.Source)) continue;
      if (String(c[k] ?? '') !== String(nv ?? '')) { u.core[k] = k === 'type_key' ? txt(r.Type) : nv; changes.push({ customer_no: no, name: c.name, field: h, before: c[k], after: nv }); }
    }
    if (header.includes('Status') && status !== c.status) { u.status = { status, reason: txt(r.Status_reason) }; changes.push({ customer_no: no, name: c.name, field: 'Status', before: c.status, after: status }); }
    if (header.includes('Tags')) {
      const [had] = await q.query('SELECT tag FROM customer_tags WHERE customer_id = ? ORDER BY tag', [c.customer_id]);
      const before = had.map((x) => x.tag).join(', '); const after = [...new Set(tags)].sort().join(', ');
      if (before !== after) { u.tags = tags; changes.push({ customer_no: no, name: c.name, field: 'Tags', before, after }); }
    }
    for (const [p, kind] of [['Bill', 'billing'], ['Ship', 'shipping']]) {
      const x = kind === 'billing' ? bill : ship;
      if (!x) continue;
      const [[cur]] = await q.query('SELECT * FROM customer_addresses WHERE customer_id = ? AND kind = ? AND is_default = 1 AND is_active = 1', [c.customer_id, kind]);
      const keys = ['label', 'name', 'gstin', 'contact_person', 'phone', 'address', 'town', 'state_code', 'pincode'];
      const diff = keys.filter((k) => String((cur || {})[k] ?? '') !== String(x.values[k] ?? ''));
      if (diff.length) {
        u.addresses.push({ address_id: cur ? cur.address_id : null, raw: { ...addrOf(r, p), kind, is_default: true, delivery_area_id: cur ? cur.delivery_area_id : null } });
        diff.forEach((k) => changes.push({ customer_no: no, name: c.name, field: `${p}_${k}`, before: cur ? cur[k] : null, after: x.values[k] }));
      }
    }
    if (Object.keys(u.core).length || u.status || u.tags || u.addresses.length) plan.updates.push(u);
  }
  const ro = READ_ONLY.filter((h) => header.includes(h));
  if (ro.length) notes.push(`Read-only columns are not imported: ${ro.join(', ')}`);
  const summary = { new: creates.length, changed: plan.updates.length, changes: changes.length, errors: errors.length };
  return { ok: errors.length === 0, summary, errors, notes, unknownColumns, creates, changes, plan };
}

/** apply a dry-run plan inside the caller's transaction (every step through customers.js, audited there) */
async function applyPlan(q, plan, empId) {
  const made = [];
  for (const c of plan.creates) {
    const r = await customers.createCustomer(q, c.data, empId);
    if (c.status !== 'active') await customers.setStatus(q, r.customer_id, c.status, c.reason || 'Set by the Excel import', empId);
    made.push(r.customer_no);
  }
  for (const u of plan.updates) {
    if (Object.keys(u.core).length) await customers.updateCore(q, u.customer_id, u.core, empId);
    if (u.status) await customers.setStatus(q, u.customer_id, u.status.status, u.status.reason || 'Set by the Excel import', empId);
    if (u.tags) await customers.setTags(q, u.customer_id, u.tags, empId);
    for (const a of u.addresses) await customers.saveAddress(q, u.customer_id, a.address_id, a.raw, empId);
  }
  return { created: made, changed: plan.updates.length };
}

module.exports = { buildWorkbook, diffWorkbook, applyPlan, SHEET };
