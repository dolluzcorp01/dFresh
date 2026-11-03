// Admin > Organisation > Company (phase 13 step 1; v23 Company page, tests 0.21, 0.37, 0.41 to 0.45, fix proof F4).
// Sections, each with its own Change: Profile, Tax and compliance, Address and contact, Bank accounts, Invoice
// preferences, System. Only the Super admin and an Admin open it (v23 "Admin only"); a Sub-admin is refused.
// Data (migration 20261103_stage2_13_01_company.sql):
// - the `company` row (brand, type, PAN, GST type, TAN, Udyam, registered office, invoice preferences,
//   signature, date format);
// - the facts the public site shows keep ONE source, site_settings (company_name, cin, gstin, office_phone,
//   public_email, whatsapp_display and its whatsapp_number): this page writes those rows, so the site prints exactly
//   what it printed for the same values;
// - company_bank_accounts: never deleted (active / inactive), one default. Adding, changing (any field, the UPI ID
//   too), making default, making inactive and bringing back wait for a second Admin: a company_bank approval
//   (second-admin.js), never overridden (approval-engine NEVER_OVERRIDE). The waiting change is only in the approval's
//   payload, so invoices keep the old account until it is signed. The audit log shows an account number as XXXX1234.
// - "Books closed up to" stays the Commerce setting books_closed_to (phase 12b, PUT /commerce-settings/books_closed_to).
// facts(q) is the seller every invoice, PDF and statement prints (and what commerce-settings.js still gives as
// invoice_seller_* / invoice_round_off).
// The website is not typed here: it is the server's PUBLIC_SITE_URL (config/urls.js siteBase), the same address the
// e-mails, links and SEO use. The page shows it read only; company.website is kept in step by migration only.
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const { audit } = require('./audit');
const secondAdmin = require('./second-admin');
const photoCheck = require('./photo-check');
const { GST_STATES, stateName, isStateCode } = require('../shared/gstStates');
const { checkSetting, whatsappNumber } = require('../shared/settingRules');
const { siteBase } = require('../../config/urls');

const SITE_KEYS = ['company_name', 'cin', 'gstin', 'office_phone', 'public_email', 'whatsapp_display'];
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;
const TAN_RE = /^[A-Z]{4}\d{5}[A-Z]$/;
const UDYAM_RE = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;
const CIN_RE = /^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/;
const PIN_RE = /^[1-9]\d{5}$/;
const ACC_RE = /^\d{9,18}$/;
const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const UPI_RE = /^[A-Za-z0-9._-]{2,}@[A-Za-z]{2,}$/;
const TYPES = ['One Person Company (OPC) Private Limited', 'Private Limited', 'Limited Liability Partnership (LLP)', 'Partnership', 'Proprietorship'];
const ACCOUNT_TYPES = ['Current', 'Savings', 'Cash credit / OD'];
const COPIES = ['Original', 'Duplicate', 'Triplicate'];
const DATE_FORMATS = ['DD-MM-YYYY', 'DD/MM/YYYY'];
const SIGN_MAX = 500 * 1024;
const WEBSITE_FROM = 'Set on the server by the developer';
const ADMIN_ONLY = 'Admin only: Company holds the legal details and the bank account printed on every invoice, so only the Super admin or an Admin opens it.';

const mask = (a) => (a ? `XXXX${String(a).slice(-4)}` : '');
const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const bool = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);

const COMPANY_COLS = `company_id, brand, company_type, pan, gst_type, tan, udyam, addr_line1, addr_line2, city, pin, state_code, map_query,
  show_bank, show_upi, signatory, (signature_png IS NOT NULL) AS has_signature, declaration, terms, round_off, copies, date_format, updated_by, updated_at`;
const BANK_COLS = 'bank_id, holder_name, bank_name, branch, account_no, ifsc, account_type, upi_id, old_text, status, is_default, created_by, created_at, updated_by, updated_at';

async function siteFacts(q) {
  const [rows] = await q.query(`SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN (${SITE_KEYS.map(() => '?').join(', ')})`, SITE_KEYS);
  const s = Object.fromEntries(SITE_KEYS.map((k) => [k, '']));
  rows.forEach((r) => { s[r.setting_key] = r.setting_value || ''; });
  return s;
}
async function companyRow(q, lock = false) {
  const [[c]] = await q.query(`SELECT ${COMPANY_COLS} FROM company WHERE company_id = 1${lock ? ' FOR UPDATE' : ''}`);
  if (!c) throw new Error('company row missing (migration 20261103_stage2_13_01_company.sql)');
  return { ...c, has_signature: Number(c.has_signature) === 1, show_bank: Number(c.show_bank), show_upi: Number(c.show_upi), round_off: Number(c.round_off),
    copies: String(c.copies || 'Original').split(',').filter((x) => COPIES.includes(x)) };
}
/** the registered office as one line, the state printed from its code: "Kanchipuram, Tamil Nadu" */
const addressText = (c) => [c.addr_line1, c.addr_line2, [c.city, c.pin].filter(Boolean).join(' '), stateName(c.state_code)].filter(Boolean).join(', ');
/** the GST state: from the GSTIN when there is one, else the office state */
const gstState = (gstin, c) => (gstin && isStateCode(gstin.slice(0, 2)) ? gstin.slice(0, 2) : c.state_code);

/** the "Pay to" line of an account (an account moved from the old free text prints that text until it is changed) */
function bankLine(b) {
  if (!b) return null;
  if (!b.account_no && b.old_text) return b.old_text;
  return `${b.holder_name}, ${b.bank_name}${b.branch ? ` (${b.branch})` : ''}, ${b.account_type} account ${b.account_no}, IFSC ${b.ifsc}`;
}
async function defaultBank(q) {
  const [[b]] = await q.query(`SELECT ${BANK_COLS} FROM company_bank_accounts WHERE status = 'active' AND is_default = 1 ORDER BY bank_id LIMIT 1`);
  return b || null;
}

/**
 * The seller every document prints, read now (an invoice keeps its own copy from the day it was issued):
 * { name, brand, gstin, pan, cin, state_code (the GST state), state, address, gst_type, round_off (bool), phone, email,
 *   bank (the "Pay to" line of the default approved account, null when none or switched off), upi (its UPI ID for the
 *   QR, null when none or switched off), signatory, declaration, terms, copies, has_signature, website (PUBLIC_SITE_URL) }
 */
async function facts(q) {
  const [c, s, b] = [await companyRow(q), await siteFacts(q), await defaultBank(q)];
  const code = gstState(s.gstin, c);
  return {
    name: s.company_name, brand: c.brand, gstin: s.gstin, pan: c.pan || '', cin: s.cin, state_code: code, state: stateName(code), address: addressText(c),
    gst_type: c.gst_type, round_off: c.round_off === 1, phone: s.office_phone, email: s.public_email,
    bank: c.show_bank && b ? bankLine(b) : null, upi: c.show_upi && b && b.upi_id ? b.upi_id : null,
    signatory: c.signatory || '', declaration: c.declaration || '', terms: c.terms || '', copies: c.copies, has_signature: c.has_signature,
    website: siteBase(),
  };
}
/** the signature as PNG (null when none) */
async function signaturePng(q) {
  const [[r]] = await q.query('SELECT signature_png FROM company WHERE company_id = 1');
  return r && r.signature_png ? r.signature_png : null;
}

// ---------------------------------------------------------------- what is missing (red on the page, counted on the left)
function missingOf(c, s, banks) {
  const m = { profile: [], tax: [], address: [], bank: [], invoice: [], system: [] };
  if (!s.company_name) m.profile.push('Legal name');
  if (!c.brand) m.profile.push('Brand');
  if (!c.company_type) m.profile.push('Company type');
  if (!s.cin) m.profile.push('CIN');
  if (!s.gstin) m.tax.push('GSTIN');
  if (!c.pan) m.tax.push('PAN');
  if (!c.addr_line1) m.address.push('Address line 1');
  if (!c.city) m.address.push('Town or city');
  if (!s.public_email) m.address.push('E-mail on documents');
  if (!s.office_phone) m.address.push('Phone on documents');
  if (!banks.some((b) => b.status === 'active' && b.account_no)) m.bank.push('bank account');
  return m;
}

// ---------------------------------------------------------------- the waiting bank changes (approval payloads)
async function waitingBank(q) {
  const [rows] = await q.query("SELECT approval_id, payload, requested_by FROM approvals WHERE kind = 'company_bank' AND status = 'pending' ORDER BY approval_id");
  const out = [];
  for (const r of rows) {
    const p = typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload;
    if (!p || p.t !== 'cobank') continue;
    out.push({ approval_id: r.approval_id, requested_by: r.requested_by, op: p.op, bank_id: p.bank_id || null, x: p.x || null, waiting: await secondAdmin.waitingLine(q, r.approval_id) });
  }
  return out;
}
const OP_TEXT = { add: 'New, waiting for approval', edit: 'Change waiting for approval', default: 'Default change waiting', inactive: 'Inactive waiting for approval', back: 'Bring back waiting' };
const FIELD_TEXT = [['holder_name', 'holder'], ['bank_name', 'bank'], ['branch', 'branch'], ['account_no', 'account'], ['ifsc', 'IFSC'], ['account_type', 'account type'], ['upi_id', 'UPI ID (invoice QR)']];
/** "UPI ID (invoice QR) dfresh@sbi to x@okaxis, account XXXX9012 to XXXX3456" (account numbers masked) */
function changesText(o, x) {
  return FIELD_TEXT.filter(([k]) => String(o[k] || '') !== String(x[k] || ''))
    .map(([k, l]) => (k === 'account_no' ? `${l} ${mask(o[k]) || 'none'} to ${mask(x[k])}` : `${l} ${o[k] || 'none'} to ${x[k] || 'none'}`)).join(', ');
}
const maskedBank = (b) => ({ holder: b.holder_name, bank: b.bank_name, branch: b.branch || null, account: mask(b.account_no), ifsc: b.ifsc || null, type: b.account_type, upi: b.upi_id || null });

// ---------------------------------------------------------------- the change a second Admin signs (t 'cobank')
async function applyBank(q, p, empId) {
  const { GateError } = secondAdmin;
  if (p.op === 'add') {
    const x = p.x;
    const [[dup]] = await q.query('SELECT bank_id FROM company_bank_accounts WHERE account_no = ?', [x.account_no]);
    if (dup) throw new GateError('This account is already added.', 409);
    const def = await defaultBank(q);
    const [ins] = await q.query(`INSERT INTO company_bank_accounts (holder_name, bank_name, branch, account_no, ifsc, account_type, upi_id, status, is_default, created_by, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)`, [x.holder_name, x.bank_name, x.branch || null, x.account_no, x.ifsc, x.account_type, x.upi_id || null, def ? 0 : 1, p.by || empId, empId]);
    await audit(q, { empId, action: 'create', entity: 'company_bank', entityId: String(ins.insertId), after: { ...maskedBank(x), default: !def, approved: true, asked_by: p.by || null } });
    return;
  }
  const [[b]] = await q.query(`SELECT ${BANK_COLS} FROM company_bank_accounts WHERE bank_id = ? FOR UPDATE`, [Number(p.bank_id)]);
  if (!b) throw new GateError('That bank account is not there any more.', 409);
  const name = `${b.bank_name} ${mask(b.account_no)}`.trim();
  if (p.op === 'edit') {
    if (b.status !== 'active') throw new GateError(`${name} is inactive now: bring it back first, then ask again.`, 409);
    const x = p.x;
    const [[dup]] = await q.query('SELECT bank_id FROM company_bank_accounts WHERE account_no = ? AND bank_id <> ?', [x.account_no, b.bank_id]);
    if (dup) throw new GateError('That account number is already on another account.', 409);
    await q.query(`UPDATE company_bank_accounts SET holder_name = ?, bank_name = ?, branch = ?, account_no = ?, ifsc = ?, account_type = ?, upi_id = ?, old_text = NULL, updated_by = ?
       WHERE bank_id = ?`, [x.holder_name, x.bank_name, x.branch || null, x.account_no, x.ifsc, x.account_type, x.upi_id || null, empId, b.bank_id]);
    await audit(q, { empId, action: 'update', entity: 'company_bank', entityId: String(b.bank_id), before: maskedBank(b), after: { ...maskedBank(x), approved: true, asked_by: p.by || null } });
    return;
  }
  if (p.op === 'default') {
    if (b.status !== 'active') throw new GateError(`${name} is inactive now: bring it back first.`, 409);
    const old = await defaultBank(q);
    await q.query('UPDATE company_bank_accounts SET is_default = (bank_id = ?), updated_by = ? WHERE is_default = 1 OR bank_id = ?', [b.bank_id, empId, b.bank_id]);
    await audit(q, { empId, action: 'update', entity: 'company_bank', entityId: String(b.bank_id), before: { default_on_invoices: old ? `${old.bank_name} ${mask(old.account_no)}`.trim() : 'none' },
      after: { default_on_invoices: name, approved: true, asked_by: p.by || null } });
    return;
  }
  if (p.op === 'inactive') {
    if (b.status !== 'active') return;
    const [[other]] = await q.query("SELECT COUNT(*) AS n FROM company_bank_accounts WHERE status = 'active' AND bank_id <> ?", [b.bank_id]);
    if (Number(b.is_default) === 1 && Number(other.n) > 0) throw new GateError('This is the default on invoices. Make another account the default first.', 409);
    await q.query("UPDATE company_bank_accounts SET status = 'inactive', is_default = 0, updated_by = ? WHERE bank_id = ?", [empId, b.bank_id]);
    await audit(q, { empId, action: 'deactivate', entity: 'company_bank', entityId: String(b.bank_id), before: { account: name, status: 'active' }, after: { status: 'inactive', approved: true, asked_by: p.by || null } });
    return;
  }
  if (p.op === 'back') {
    if (b.status === 'active') return;
    const def = await defaultBank(q);
    await q.query("UPDATE company_bank_accounts SET status = 'active', is_default = ?, updated_by = ? WHERE bank_id = ?", [def ? 0 : 1, empId, b.bank_id]);
    await audit(q, { empId, action: 'reactivate', entity: 'company_bank', entityId: String(b.bank_id), before: { account: name, status: 'inactive' }, after: { status: 'active', default: !def, approved: true, asked_by: p.by || null } });
  }
}
secondAdmin.on('cobank', { apply: applyBank });

// ---------------------------------------------------------------- routes
function register({ route, tx, db, by, InputError, canDo }) { // eslint-disable-line no-unused-vars
  const adminOnly = (req) => { if (!req.admin.is_admin) throw new InputError(ADMIN_ONLY, 403); };
  const fieldErrors = (errors) => {
    const keys = Object.keys(errors);
    if (!keys.length) return;
    const err = new InputError(keys.length === 1 ? errors[keys[0]] : 'Fix the fields marked in red.');
    err.code = 'fields';
    err.fields = errors;
    throw err;
  };
  const commerce = () => require('./commerce-settings'); // eslint-disable-line global-require

  route('get', '/company', 'settings:view', async (req) => {
    adminOnly(req);
    const c = await companyRow(db);
    const s = await siteFacts(db);
    const [banks] = await db.query(`SELECT ${BANK_COLS} FROM company_bank_accounts ORDER BY status = 'active' DESC, is_default DESC, bank_id`);
    const waits = await waitingBank(db);
    const cs = await commerce().read(db);
    const def = banks.find((b) => b.status === 'active' && Number(b.is_default) === 1) || null;
    const missing = missingOf(c, s, banks);
    const code = gstState(s.gstin, c);
    const warnInvoice = [];
    if (c.show_bank && !def) warnInvoice.push('Bank details are switched on, but there is no approved bank account yet, so nothing prints.');
    if (c.show_upi && !(def && def.upi_id)) warnInvoice.push('The UPI QR is switched on, but the default account has no UPI ID, so no QR prints.');
    return {
      can_edit: true,
      profile: { name: s.company_name, brand: c.brand, company_type: c.company_type, cin: s.cin, website: siteBase(), website_from: WEBSITE_FROM },
      tax: { gstin: s.gstin, gst_state_code: s.gstin ? code : null, gst_state: s.gstin ? stateName(code) : null, pan: c.pan || '', gst_type: c.gst_type, tan: c.tan || '', udyam: c.udyam || '',
        einvoice: cs.einvoice_mode === 'on', eway: Boolean(cs.eway_bill_required), eway_limit: Number(cs.eway_bill_above) || 0 },
      address: { line1: c.addr_line1 || '', line2: c.addr_line2 || '', city: c.city || '', pin: c.pin || '', state_code: c.state_code, state: stateName(c.state_code), text: addressText(c),
        map_query: c.map_query || '', email: s.public_email, phone: s.office_phone, whatsapp: s.whatsapp_display, state_fixed: Boolean(s.gstin) },
      banks: banks.map((b) => {
        const w = waits.find((x) => x.bank_id === b.bank_id);
        return { bank_id: b.bank_id, holder_name: b.holder_name, bank_name: b.bank_name, branch: b.branch || '', account_no: b.account_no || '', ifsc: b.ifsc || '', account_type: b.account_type,
          upi_id: b.upi_id || '', old_text: b.account_no ? null : b.old_text, status: b.status, is_default: Number(b.is_default) === 1,
          qr: b.upi_id ? `upi://pay?pa=${b.upi_id}&pn=${c.brand}` : null,
          pending: w ? { op: w.op, label: OP_TEXT[w.op], approval_id: w.approval_id, waiting: w.waiting, changes: w.op === 'edit' ? changesText(b, w.x) : null } : null };
      }),
      banks_waiting: waits.filter((w) => w.op === 'add').map((w) => ({ approval_id: w.approval_id, label: OP_TEXT.add, waiting: w.waiting, ...maskedBank(w.x) })),
      invoice: { show_bank: c.show_bank === 1, show_upi: c.show_upi === 1, signatory: c.signatory || '', has_signature: c.has_signature, declaration: c.declaration || '', terms: c.terms || '',
        round_off: c.round_off === 1, copies: c.copies, default_bank: def ? `${def.bank_name} ${mask(def.account_no)}`.trim() : null, warnings: warnInvoice },
      system: { currency: 'Indian rupee (Rs)', time_zone: 'India (IST, UTC+05:30)', fy_start: 'April', date_format: c.date_format, books_closed_to: cs.books_closed_to || '' },
      missing,
      options: { types: TYPES, states: GST_STATES.map(([v, l]) => ({ value: v, label: `${l} (${v})` })), account_types: ACCOUNT_TYPES, copies: COPIES, date_formats: DATE_FORMATS },
    };
  });

  // one section's Change -> { message, changes }
  route('put', '/company/:section', 'settings:edit', async (req) => tx(async (q) => {
    adminOnly(req);
    const sec = req.params.section;
    if (!['profile', 'tax', 'address', 'invoice', 'system'].includes(sec)) throw new InputError('Unknown section', 404);
    const b = req.body || {};
    const c = await companyRow(q, true);
    const s = await siteFacts(q);
    const errors = {};
    const set = {}; // company columns
    const site = {}; // site_settings rows
    if (sec === 'profile') {
      const name = txt(b.name, 80); const brand = txt(b.brand, 30); const cin = txt(b.cin, 30).replace(/\s/g, '').toUpperCase();
      if (!name) errors.name = 'The legal name is needed.';
      if (!brand) errors.brand = 'The brand is needed.';
      if (!TYPES.includes(b.company_type)) errors.company_type = `One of: ${TYPES.join(', ')}.`;
      if (cin && !CIN_RE.test(cin)) errors.cin = 'A CIN is 21 characters, like U72501TN2018OPC120419.';
      fieldErrors(errors);
      Object.assign(site, { company_name: name, cin });
      Object.assign(set, { brand, company_type: b.company_type }); // b.website is ignored: it comes from PUBLIC_SITE_URL
    }
    if (sec === 'tax') {
      const g = txt(b.gstin, 20).replace(/\s/g, '').toUpperCase(); const pan = txt(b.pan, 12).toUpperCase(); const tan = txt(b.tan, 12).toUpperCase(); const ud = txt(b.udyam, 22).toUpperCase();
      const gt = b.gst_type;
      if (g && !GSTIN_RE.test(g)) errors.gstin = 'Not the right shape: 2 digits, the 10-character PAN, then 3 more, like 33ABCDE1234F1Z5.';
      else if (g && g.slice(0, 2) !== c.state_code) errors.gstin = `The company is registered in ${stateName(c.state_code)}, so its GSTIN starts with ${c.state_code}.`;
      if (pan && !PAN_RE.test(pan)) errors.pan = 'A PAN is 5 letters, 4 digits, 1 letter, like ABCDE1234F.';
      else if (g && pan && !errors.gstin && g.slice(2, 12) !== pan) errors.pan = `The PAN inside the GSTIN (${g.slice(2, 12)}) does not match the PAN typed (${pan}).`;
      if (tan && !TAN_RE.test(tan)) errors.tan = 'A TAN is 4 letters, 5 digits, 1 letter, like CHEA12345B.';
      if (ud && !UDYAM_RE.test(ud)) errors.udyam = 'An Udyam number looks like UDYAM-TN-02-1234567.';
      if (!['regular', 'composition'].includes(gt)) errors.gst_type = 'Regular or composition.';
      else if (gt === 'composition' && (await commerce().read(q)).einvoice_mode === 'on') errors.gst_type = 'A composition dealer makes bills of supply, so e-invoice stays off: switch e-invoice off first (Admin > Switches).';
      fieldErrors(errors);
      site.gstin = g;
      Object.assign(set, { pan: pan || null, tan: tan || null, udyam: ud || null, gst_type: gt });
    }
    if (sec === 'address') {
      const l1 = txt(b.line1, 150); const l2 = txt(b.line2, 150); const city = txt(b.city, 60); const pin = txt(b.pin, 10); const mp = txt(b.map_query, 120);
      const em = checkSetting('public_email', b.email); const ph = checkSetting('office_phone', b.phone); const wa = checkSetting('whatsapp_display', b.whatsapp);
      const st = s.gstin ? s.gstin.slice(0, 2) : String(b.state_code || '');
      if (!l1) errors.line1 = 'Address line 1 is needed.';
      if (!city) errors.city = 'The town or city is needed.';
      if (pin && !PIN_RE.test(pin)) errors.pin = 'A PIN code is 6 digits and does not start with 0.';
      if (!isStateCode(st)) errors.state_code = 'Choose the state.';
      if (!em.value || em.error) errors.email = 'Give a working e-mail address, like info@dolluzcorp.com.';
      if (!ph.value || ph.error) errors.phone = '+91 and 10 digits, like +91 77790 39666.';
      if (wa.value && wa.error) errors.whatsapp = '+91 and 10 digits, like +91 93302 59330.';
      fieldErrors(errors);
      Object.assign(set, { addr_line1: l1, addr_line2: l2 || null, city, pin: pin || null, state_code: st, map_query: mp || null });
      Object.assign(site, { public_email: em.value, office_phone: ph.value, whatsapp_display: wa.value });
    }
    if (sec === 'invoice') {
      const copies = Array.isArray(b.copies) ? b.copies : [];
      if (copies.some((x) => !COPIES.includes(x))) errors.copies = `Copies: ${COPIES.join(', ')}.`;
      const decl = txt(b.declaration, 400); const terms = txt(b.terms, 400);
      if (decl.length > 300) errors.declaration = 'At most 300 characters.';
      if (terms.length > 300) errors.terms = 'At most 300 characters.';
      fieldErrors(errors);
      Object.assign(set, { show_bank: bool(b.show_bank), show_upi: bool(b.show_upi), signatory: txt(b.signatory, 60) || null, declaration: decl || null, terms: terms || null,
        round_off: bool(b.round_off), copies: COPIES.filter((x) => x === 'Original' || copies.includes(x)).join(',') }); // Original is always printed
    }
    if (sec === 'system') {
      if (!DATE_FORMATS.includes(b.date_format)) errors.date_format = `One of: ${DATE_FORMATS.join(', ')}.`;
      fieldErrors(errors);
      set.date_format = b.date_format;
    }
    // what changed, old and new, in the audit log (entity company: the Super admin and Admins only see it)
    const before = {}; const after = {};
    const cmp = { ...c, copies: c.copies.join(',') };
    Object.entries(set).forEach(([k, v]) => { if (String(cmp[k] ?? '') !== String(v ?? '')) { before[k] = cmp[k] ?? null; after[k] = v; } });
    Object.entries(site).forEach(([k, v]) => { if (String(s[k] ?? '') !== String(v ?? '')) { before[k] = s[k] || null; after[k] = v; } });
    const n = Object.keys(after).length;
    if (!n) return { message: 'Nothing changed.', changes: 0 };
    const cols = Object.keys(set).filter((k) => k in after);
    if (cols.length) await q.query(`UPDATE company SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_by = ? WHERE company_id = 1`, [...cols.map((k) => set[k]), by(req)]);
    for (const k of Object.keys(site).filter((x) => x in after)) {
      await q.query('UPDATE site_settings SET setting_value = ?, updated_by = ? WHERE setting_key = ?', [site[k], by(req), k]);
      if (k === 'whatsapp_display') await q.query("UPDATE site_settings SET setting_value = ?, updated_by = ? WHERE setting_key = 'whatsapp_number'", [whatsappNumber(site[k]), by(req)]);
    }
    await audit(q, { empId: by(req), action: 'update', entity: 'company', entityId: sec, before, after });
    return { message: `${n} change${n === 1 ? '' : 's'} in the audit log.`, changes: n };
  }), { content: true });

  // ---------------------------------------------------------------- bank accounts: everything waits for a second Admin
  const bankInput = async (q, b, id) => {
    const x = { holder_name: txt(b.holder_name, 80), bank_name: txt(b.bank_name, 60), branch: txt(b.branch, 60), account_no: String(b.account_no ?? '').replace(/\s/g, ''),
      ifsc: txt(b.ifsc, 11).toUpperCase(), account_type: b.account_type, upi_id: txt(b.upi_id, 60) };
    const errors = {};
    if (!x.holder_name) errors.holder_name = 'The account holder name is needed.';
    if (!x.bank_name) errors.bank_name = 'The bank name is needed.';
    if (!ACC_RE.test(x.account_no)) errors.account_no = 'An account number is 9 to 18 digits.';
    else if (String(b.account_no2 ?? '').replace(/\s/g, '') !== x.account_no) errors.account_no2 = 'The two account numbers do not match. Check every digit.';
    else {
      const [[dup]] = await q.query('SELECT bank_id FROM company_bank_accounts WHERE account_no = ? AND bank_id <> ?', [x.account_no, id || 0]);
      if (dup) errors.account_no = 'This account is already added.';
    }
    if (!IFSC_RE.test(x.ifsc)) errors.ifsc = 'An IFSC is 11 characters: 4 letters, 0, then 6 letters or digits, like SBIN0001234.';
    if (!ACCOUNT_TYPES.includes(x.account_type)) errors.account_type = `One of: ${ACCOUNT_TYPES.join(', ')}.`;
    if (x.upi_id && !UPI_RE.test(x.upi_id)) errors.upi_id = 'A UPI ID looks like dfresh@sbi.';
    fieldErrors(errors);
    return x;
  };
  const ask = async (q, req, { dk, summary, payload, auditAfter, bankId = null }) => {
    const w = await secondAdmin.ask(q, { kind: 'company_bank', t: 'cobank', dk, summary, payload: { ...payload, by: by(req) } }, by(req));
    if (w.already) return { waiting: true, message: `A change to this account is already waiting. ${w.message.replace(/^Already waiting: /, '')}` };
    await audit(q, { empId: by(req), action: 'request', entity: 'company_bank', entityId: bankId ? String(bankId) : 'new', after: { ...auditAfter, approval: w.approval_id } });
    return { waiting: true, approval_id: w.approval_id, message: `${w.message} A bank change is never overridden; invoices keep the account they print today until it is signed.` };
  };
  const bankRow = async (q, id) => {
    const [[b]] = await q.query(`SELECT ${BANK_COLS} FROM company_bank_accounts WHERE bank_id = ? FOR UPDATE`, [Number(id)]);
    if (!b) throw new InputError('No such bank account', 404);
    return b;
  };

  route('post', '/company/banks', 'settings:edit', async (req) => tx(async (q) => {
    adminOnly(req);
    const x = await bankInput(q, req.body || {}, 0);
    const dk = `cobank:new:${crypto.createHash('sha256').update(x.account_no).digest('hex').slice(0, 16)}`;
    return ask(q, req, { dk, summary: `New company bank account ${x.bank_name} ${mask(x.account_no)} (${x.ifsc}), holder ${x.holder_name}${x.upi_id ? `, UPI ${x.upi_id}` : ''}`,
      payload: { op: 'add', x }, auditAfter: { op: 'add', ...maskedBank(x) } });
  }), { status: 201 });

  route('put', '/company/banks/:id', 'settings:edit', async (req) => tx(async (q) => {
    adminOnly(req);
    const o = await bankRow(q, req.params.id);
    if (o.status !== 'active') throw new InputError('This account is inactive: bring it back first.', 409);
    const x = await bankInput(q, req.body || {}, o.bank_id);
    const ch = changesText(o, x);
    if (!ch) return { message: 'Nothing changed.' };
    return ask(q, req, { dk: `cobank:${o.bank_id}`, bankId: o.bank_id, summary: `Change company bank ${o.bank_name} ${mask(o.account_no)}: ${ch}`.slice(0, 255),
      payload: { op: 'edit', bank_id: o.bank_id, x }, auditAfter: { op: 'edit', changes: ch } });
  }));

  route('post', '/company/banks/:id/:op', 'settings:edit', async (req) => tx(async (q) => {
    adminOnly(req);
    const op = req.params.op;
    if (!['default', 'inactive', 'back'].includes(op)) throw new InputError('Unknown action', 404);
    const o = await bankRow(q, req.params.id);
    const name = `${o.bank_name} ${mask(o.account_no)}`.trim();
    const def = await defaultBank(q);
    let summary;
    if (op === 'default') {
      if (o.status !== 'active') throw new InputError('Not active: bring the account back first.', 409);
      if (Number(o.is_default) === 1) throw new InputError('This account is already the default on invoices.', 409);
      summary = `Print ${name} on invoices instead of ${def ? `${def.bank_name} ${mask(def.account_no)}`.trim() : 'none'}`;
    } else if (op === 'inactive') {
      if (o.status !== 'active') throw new InputError('This account is inactive already.', 409);
      const [[other]] = await q.query("SELECT COUNT(*) AS n FROM company_bank_accounts WHERE status = 'active' AND bank_id <> ?", [o.bank_id]);
      if (Number(o.is_default) === 1 && Number(other.n) > 0) throw new InputError('This is the default on invoices. Make another account the default first.', 409);
      summary = `Make company bank ${name} inactive${Number(o.is_default) === 1 ? ' (the only account: invoices print no bank details)' : ''}`;
    } else {
      if (o.status === 'active') throw new InputError('This account is active already.', 409);
      summary = `Bring back company bank ${name}${o.ifsc ? ` (${o.ifsc})` : ''}`;
    }
    return ask(q, req, { dk: `cobank:${o.bank_id}`, bankId: o.bank_id, summary, payload: { op, bank_id: o.bank_id }, auditAfter: { op, account: name } });
  }));

  // ---------------------------------------------------------------- the signature printed on invoices
  const upSign = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } }).single('file');
  route('post', '/company/signature', 'settings:edit', async (req) => {
    adminOnly(req);
    const f = req.file;
    if (!f) throw new InputError('Choose a picture of the signature.');
    if (!photoCheck.imageType(f)) throw new InputError('The signature must be PNG, JPG or WebP.');
    if (f.size > SIGN_MAX) throw new InputError('The signature is over 500 KB. Make it smaller first.', 413);
    let png;
    try {
      png = await sharp(f.buffer, { failOn: 'error' }).rotate().resize({ width: 900, height: 300, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    } catch {
      throw new InputError('This picture cannot be read. Save it again as PNG or JPG.');
    }
    return tx(async (q) => {
      const c = await companyRow(q, true);
      await q.query('UPDATE company SET signature_png = ?, updated_by = ? WHERE company_id = 1', [png, by(req)]);
      await audit(q, { empId: by(req), action: 'update', entity: 'company', entityId: 'invoice', before: { signature: c.has_signature ? 'old image' : null }, after: { signature: f.originalname ? String(f.originalname).slice(0, 80) : 'image' } });
      return { message: 'Signature saved.' };
    });
  }, { before: [upSign] });
  route('delete', '/company/signature', 'settings:edit', async (req) => tx(async (q) => {
    adminOnly(req);
    const c = await companyRow(q, true);
    if (!c.has_signature) return { message: 'No signature to remove.' };
    await q.query('UPDATE company SET signature_png = NULL, updated_by = ? WHERE company_id = 1', [by(req)]);
    await audit(q, { empId: by(req), action: 'update', entity: 'company', entityId: 'invoice', before: { signature: 'image' }, after: { signature: null } });
    return { message: 'Signature removed.' };
  }));
  // anyone signed in: printed invoices show it
  route('get', '/company/signature', 'any', async (req, res) => {
    const png = await signaturePng(db);
    if (!png) throw new InputError('No signature', 404);
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
    res.send(png);
  });
}

module.exports = { register, facts, signaturePng, addressText, mask, ADMIN_ONLY };
