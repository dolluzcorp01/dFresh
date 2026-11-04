// Section 3 Suppliers and buying, the screens' API (phase 16, v23 "SECTION 3 ... ACTIONS"; rules in buying.js).
// Rights (roles grid row "Suppliers and buying"): view = every page; create = a new indent, goods in, Reorder check;
// edit = suppliers, approve / reject an indent (never your own), purchase orders (raise, amend, print, mail), Quality
// check, supplier bills, claims; cancel = cancel or close short a PO; export = the CSV files. Rates and values are
// costs: sent only to See cost or Buying Edit (v22 RP1), else null ("hidden" on the screen). Every record belongs to a
// godown: people see the godowns they work at (the header picker narrows it), records elsewhere answer 404.
// Approvals go through the one request engine (approvals.js): po (orders to one supplier add up), excess_in, no_po_in,
// bill_diff; a supplier's bank account waits for a second Admin (supplier_bank, never overridden; second-admin.js).
// Each approval is checked again when it is signed (onRecheck). Dated records check the month lock (books.js).
const buy = require('./buying');
const { audit } = require('./audit');
const approvals = require('./approvals');
const engine = require('./approval-engine');
const secondAdmin = require('./second-admin');
const numbering = require('./numbering');
const stock = require('./stock');
const books = require('./books');
const godowns = require('./godowns');
const catalogue = require('./catalogue');
const auth = require('./auth');
const rules = require('../shared/buyRules');
const { stateName, isStateCode } = require('../shared/gstStates');

const { r2, rs, rs0, BuyError } = buy;
const SUP_ST = { active: 'Active', hold: 'On hold', blocked: 'Blocked' };
const PO_ST = { draft: 'Draft', waiting: 'Waiting for approval', open: 'Sent to supplier', part: 'Part received', received: 'Received', closed: 'Closed short', cancelled: 'Cancelled', rejected: 'Rejected' };
const IND_ST = { open: 'Open', approved: 'Approved', po: 'Turned into PO', rejected: 'Rejected' };
const GI_ST = { waiting: 'Waiting for approval', qc: 'In QC hold', done: 'Checked', rejected: 'Not taken in' };
const BILL_ST = { waiting: 'Waiting for approval', unpaid: 'Unpaid', part: 'Part paid', paid: 'Paid', rejected: 'Rejected' };
const CL_ST = { draft: 'To send', issued: 'Debit note sent', returned: 'Goods sent back', settled: 'Settled' };
const KIND_LABEL = Object.fromEntries(rules.SUP_KINDS);
const whole = (v, min = 0) => /^\d+$/.test(String(v ?? '').trim()) && Number(v) >= min;
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const csvCell = (c) => { const s = c === null || c === undefined ? '' : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** emp id -> "First Last" (dAdmin), for the names on the screens */
async function namesOf(q, ids) {
  const list = [...new Set(ids.filter((x) => x && x !== 'auto'))];
  if (!list.length) return new Map();
  const [rows] = await q.query(`SELECT emp_id, TRIM(CONCAT(COALESCE(emp_first_name, ''), ' ', COALESCE(emp_last_name, ''))) AS name FROM \`${auth.DADMIN}\`.employee WHERE emp_id IN (?)`, [list]);
  return new Map(rows.map((r) => [r.emp_id, r.name || r.emp_id]));
}
const nm = (names, id) => (id === 'auto' ? 'Passed straight away (QC hold is off)' : names.get(id) || id || '');

function register({ route, tx, db, by, InputError, canDo, commerceGate, seesCost }) {
  const G = { before: [commerceGate] };
  const asErr = (e) => {
    if (e instanceof BuyError || e instanceof stock.StockError || e instanceof books.BooksError || e instanceof godowns.GodownError || e instanceof secondAdmin.GateError) {
      const x = new InputError(e.message, e.status || 400); if (e.fields) { x.code = 'fields'; x.fields = e.fields; } return x;
    }
    return e;
  };
  const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (e) { throw asErr(e); } };
  const seeBuy = (req) => seesCost(req) || canDo(req, 'buying', 'edit');
  const hide = (req, v) => (seeBuy(req) ? v : null);
  const scope = (req) => godowns.viewScope(req);
  const sees = (req, gid) => godowns.assertSees(req, gid, 'Not found');
  const works = (req, gid) => godowns.assertWorks(req.admin, gid);
  const myGodowns = async (q, req) => (await godowns.list(q)).filter((g) => g.is_active && godowns.covers(req.admin, g.godown_id));
  const waitLine = (q, id) => (id ? secondAdmin.waitingLine(q, id) : '');

  // ============================================================================================ options shared by the forms
  route('get', '/buying/options', 'buying:view', wrap(async (req) => {
    const its = await buy.items(db);
    const [sups] = await db.query("SELECT supplier_id, code, name, status, block_reason, gstin FROM suppliers ORDER BY status = 'active' DESC, name");
    const st = await buy.settings(db);
    const rule = (k) => approvals.rule(db, k);
    const [po, ex] = [await rule('po'), await rule('excess_in')];
    return {
      today: buy.today(), godowns: (await myGodowns(db, req)).map((g) => ({ godown_id: g.godown_id, code: g.code, name: g.name })),
      items: [...its.values()].filter((i) => i.buyable).map((i) => ({ sku_code: i.sku_code, name: i.name, type: i.type, unit: i.unit, per_carton: i.per_carton, track: i.track, life: i.life, hsn: i.hsn })),
      suppliers: sups.map((s) => ({ supplier_id: s.supplier_id, code: s.code, name: s.name, status: s.status, why: s.block_reason, registered: Boolean(s.gstin) })),
      kinds: rules.SUP_KINDS, bank_types: rules.BANK_TYPES, qc_reasons: rules.QC_REASONS, states: Object.entries(buy.STATE_CODE).map(([n, c]) => ({ code: c, name: n })).sort((a, b) => a.name.localeCompare(b.name)),
      switches: st, rules: { po: { on: po.is_on, above: po.limit_value }, excess: { on: ex.is_on, pct: ex.limit_value } },
      can: { create: canDo(req, 'buying', 'create'), edit: canDo(req, 'buying', 'edit'), cancel: canDo(req, 'buying', 'cancel'), export: canDo(req, 'buying', 'export'), seeBuy: seeBuy(req) },
    };
  }), G);

  // ============================================================================================ find (v23 Ctrl K)
  // suppliers, purchase orders and goods in matching the text, on the godowns the person sees (the menu's Find a page)
  route('get', '/buying/find', 'buying:view', wrap(async (req) => {
    const t = `%${String(req.query.q || '').trim().slice(0, 40)}%`;
    if (t.length < 4) return { rows: [] };
    const [gw, gp] = godowns.where('p.godown_id', scope(req));
    const [gw2, gp2] = godowns.where('g.godown_id', scope(req));
    const [sups] = await db.query("SELECT supplier_id, code, name, status FROM suppliers WHERE name LIKE ? OR code LIKE ? OR gstin LIKE ? ORDER BY name LIMIT 8", [t, t, t]);
    const [pos] = await db.query(`SELECT p.po_id, p.po_no, p.status, s.name FROM purchase_orders p JOIN suppliers s ON s.supplier_id = p.supplier_id
        WHERE p.po_no IS NOT NULL AND (p.po_no LIKE ? OR s.name LIKE ?) AND ${gw} ORDER BY p.po_id DESC LIMIT 8`, [t, t, ...gp]);
    const [gis] = await db.query(`SELECT g.grn_id, g.grn_no, g.status, s.name FROM goods_ins g JOIN suppliers s ON s.supplier_id = g.supplier_id
        WHERE (g.grn_no LIKE ? OR g.challan_no LIKE ?) AND ${gw2} ORDER BY g.grn_id DESC LIMIT 8`, [t, t, ...gp2]);
    const out = sups.map((x) => ({ k: 'Supplier', t: x.name, s: `${x.code}${x.status !== 'active' ? ` · ${SUP_ST[x.status].toLowerCase()}` : ''}`, href: `/admin/suppliers?open=${x.supplier_id}` }));
    for (const x of pos) { const p = await buy.poOf(db, x.po_id); out.push({ k: 'Purchase order', t: x.po_no, s: `${x.name} · ${PO_ST[await buy.poState(db, p)]}`, href: `/admin/purchase-orders?open=${x.po_id}` }); }
    out.push(...gis.map((x) => ({ k: 'Goods in', t: x.grn_no, s: `${x.name} · ${GI_ST[x.status]}`, href: `/admin/goods-in?open=${x.grn_id}` })));
    return { rows: out };
  }), G);

  // ============================================================================================ suppliers
  async function supplierRows(q, req) {
    const [rows] = await q.query(`SELECT s.supplier_id, s.code, s.name, s.kinds, s.status, s.block_reason, s.gstin, s.state_code, s.msme_type, s.terms_days, s.city,
        (SELECT COUNT(*) FROM purchase_orders p WHERE p.supplier_id = s.supplier_id AND p.status IN ('waiting', 'open')) AS open_pos
        FROM suppliers s ORDER BY s.name`);
    const [waits] = await q.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.supplier_id')) AS sid FROM approvals WHERE kind = 'supplier_bank' AND status = 'pending'");
    const waiting = new Set(waits.map((w) => Number(w.sid)));
    const out = [];
    for (const s of rows) {
      const owe = await buy.payable(q, s.supplier_id);
      const rt = await buy.rating(q, s.supplier_id);
      out.push({ supplier_id: s.supplier_id, code: s.code, name: s.name, kinds: String(s.kinds).split(',').filter(Boolean).map((k) => KIND_LABEL[k] || k), status: s.status, status_label: SUP_ST[s.status],
        why: s.block_reason, gstin: s.gstin, state: stateName(s.state_code), msme: s.msme_type, terms: Number(s.terms_days), city: s.city, open_pos: Number(s.open_pos),
        owe: hide(req, owe), owe_text: seeBuy(req) ? (owe ? buy.oweText(owe) : null) : null, rating: rt, bank_waiting: waiting.has(s.supplier_id) });
    }
    return out;
  }
  route('get', '/buying/suppliers', 'buying:view', wrap(async (req) => {
    const all = await supplierRows(db, req);
    const qq = String(req.query.q || '').trim().toLowerCase();
    const tab = req.query.tab === 'blocked' ? 'blocked' : 'active';
    return { counts: { active: all.filter((s) => s.status === 'active').length, blocked: all.filter((s) => s.status !== 'active').length },
      rows: all.filter((s) => (tab === 'active' ? s.status === 'active' : s.status !== 'active') && (!qq || `${s.name} ${s.code} ${s.gstin || ''} ${s.city || ''}`.toLowerCase().includes(qq))),
      can: { edit: canDo(req, 'buying', 'edit'), export: canDo(req, 'buying', 'export') } };
  }), G);
  route('get', '/buying/suppliers-export', 'buying:export', wrap(async (req, res) => {
    const all = await supplierRows(db, req);
    const head = ['code', 'name', 'supplies', 'gstin', 'state', 'msme', 'terms_days', 'we_owe', 'status'];
    const lines = [head.join(','), ...all.map((s) => [s.code, s.name, s.kinds.join(' / '), s.gstin || '', s.state, s.msme || '', s.terms, s.owe === null ? 'hidden' : s.owe, s.status].map(csvCell).join(','))];
    await audit(db, { empId: by(req), action: 'export', entity: 'supplier', entityId: 'csv', after: { rows: all.length, note: 'Bank accounts are not in the file' } });
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="dfresh-suppliers-${buy.today()}.csv"`).send(`﻿${lines.join('\n')}\n`);
  }), G);

  route('get', '/buying/suppliers/:id', 'buying:view', wrap(async (req) => {
    const s = await buy.supplierOf(db, req.params.id);
    if (!s) throw new InputError('No such supplier', 404);
    const [contacts] = await db.query('SELECT pos, name, role, phone, email, whatsapp FROM supplier_contacts WHERE supplier_id = ? ORDER BY pos', [s.supplier_id]);
    const [its] = await db.query('SELECT sku_code, their_code, price, lead_days, moq, spec_gsm, spec_ply, spec_width FROM supplier_items WHERE supplier_id = ? ORDER BY sku_code', [s.supplier_id]);
    const names = await buy.items(db, its.map((i) => i.sku_code));
    const [[w]] = await db.query("SELECT approval_id, payload FROM approvals WHERE kind = 'supplier_bank' AND status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = ?", [`supbank:${s.supplier_id}`]);
    const wp = w ? (typeof w.payload === 'string' ? JSON.parse(w.payload) : w.payload) : null;
    const [pos] = await db.query("SELECT po_id, po_no, DATE_FORMAT(po_date, '%Y-%m-%d') AS po_date, status FROM purchase_orders WHERE supplier_id = ? AND po_no IS NOT NULL ORDER BY po_id DESC LIMIT 20", [s.supplier_id]);
    const [bills] = await db.query("SELECT bill_id, supplier_bill_no, DATE_FORMAT(bill_date, '%Y-%m-%d') AS bill_date, total, status FROM supplier_bills WHERE supplier_id = ? ORDER BY bill_id DESC LIMIT 20", [s.supplier_id]);
    const [hist] = await db.query("SELECT emp_id, action, after_json, created_at FROM audit_log WHERE entity_type = 'supplier' AND entity_id = ? ORDER BY audit_id DESC LIMIT 8", [String(s.supplier_id)]).catch(() => [[]]);
    const nms = await namesOf(db, hist.map((h) => h.emp_id));
    const owe = await buy.payable(db, s.supplier_id);
    const poRows = [];
    for (const p of pos) { const full = await buy.poOf(db, p.po_id); const g = await buy.godownOf(db, full.godown_id); const t = buy.totals(full.lines.map((l) => ({ ...l, gst: 0 })), full.freight, { registered: false, inter: buy.interState(s, g) }); poRows.push({ po_id: p.po_id, po_no: p.po_no, po_date: p.po_date, state: PO_ST[await buy.poState(db, full)], value: hide(req, buy.poValue(full.lines, full.freight)), t }); }
    return {
      supplier: { ...s, bank_acc: undefined, pan: rules.panOf(s.gstin), state: stateName(s.state_code), status_label: SUP_ST[s.status],
        bank: s.bank_acc ? { holder: s.bank_holder, name: s.bank_name, branch: s.bank_branch, acc: rules.maskAcc(s.bank_acc), ifsc: s.bank_ifsc, type: s.bank_type } : null,
        opening_owed: hide(req, s.opening_owed), credit: hide(req, s.credit) },
      bank_waiting: wp ? { holder: wp.bank.holder, name: wp.bank.name, acc: rules.maskAcc(wp.bank.acc), ifsc: wp.bank.ifsc, line: await waitLine(db, w.approval_id) } : null,
      contacts, items: its.map((i) => ({ sku_code: i.sku_code, name: (names.get(i.sku_code) || {}).name, their_code: i.their_code, price: hide(req, Number(i.price)), lead_days: i.lead_days, moq: i.moq,
        spec: i.spec_gsm === null ? null : { gsm: Number(i.spec_gsm), ply: i.spec_ply, width: i.spec_width } })),
      record: { rating: await buy.rating(db, s.supplier_id), owe: hide(req, owe), owe_text: seeBuy(req) ? buy.oweText(owe) : null, credit_with_them: owe < -0.004,
        pos: poRows.map(({ t, ...p }) => p), bills: bills.map((b) => ({ ...b, total: hide(req, Number(b.total)), status: BILL_ST[b.status] })),
        changes: hist.map((h) => ({ at: h.created_at, who: nm(nms, h.emp_id), action: h.action })) },
      can: { edit: canDo(req, 'buying', 'edit') },
    };
  }), G);

  /** read and check the supplier form -> { v, contacts, items, bank } (throws field errors) */
  async function readSupplier(q, b, s) {
    const e = {};
    const v = {};
    v.name = String(b.name || '').trim().slice(0, 80);
    if (!v.name) e.name = 'A supplier needs a name.';
    else {
      const [[d]] = await q.query('SELECT name FROM suppliers WHERE LOWER(name) = LOWER(?) AND supplier_id <> ?', [v.name, s ? s.supplier_id : 0]);
      if (d) e.name = `Another supplier is already called ${d.name}.`;
    }
    const kinds = (Array.isArray(b.kinds) ? b.kinds : []).filter((k) => KIND_LABEL[k]);
    if (!kinds.length) e.kinds = 'Tick at least one.';
    v.kinds = [...new Set(kinds)].join(',');
    if (!whole(b.terms_days, 0) || Number(b.terms_days) > 180) e.terms_days = 'Whole days, 0 to 180.'; else v.terms_days = Number(b.terms_days);
    v.status = SUP_ST[b.status] ? b.status : 'active';
    v.block_reason = v.status === 'active' ? null : String(b.block_reason || '').trim().slice(0, 120);
    if (v.status !== 'active' && !v.block_reason) e.block_reason = 'Say why, so whoever tries to order from them knows.';
    v.notes = String(b.notes || '').trim().slice(0, 300) || null;
    // contacts: the main contact needs a name and a phone
    const contacts = [];
    const raw = Array.isArray(b.contacts) ? b.contacts.slice(0, 3) : [];
    for (let i = 0; i < 3; i += 1) {
      const c = raw[i] || {};
      const x = { name: String(c.name || '').trim().slice(0, 60), role: String(c.role || '').trim().slice(0, 40), phone: String(c.phone || '').trim(), email: String(c.email || '').trim().slice(0, 120), whatsapp: String(c.whatsapp || '').trim() };
      if (!x.name && !x.phone && !x.email && !x.whatsapp && !x.role) { if (i === 0) { e['contacts.0.name'] = 'The main contact needs a name.'; e['contacts.0.phone'] = 'And a phone number.'; } continue; }
      if (!x.name) e[`contacts.${i}.name`] = 'A name for this contact.';
      const pn = rules.phoneNorm(x.phone);
      if (!pn) e[`contacts.${i}.phone`] = x.phone ? '10 digits, like 98400 12345.' : 'A phone number.';
      if (x.email && !rules.emailOk(x.email)) e[`contacts.${i}.email`] = 'Not an e-mail address.';
      const wn = x.whatsapp ? rules.phoneNorm(x.whatsapp) : '';
      if (x.whatsapp && !wn) e[`contacts.${i}.whatsapp`] = '10 digits, like 98400 12345.';
      contacts.push({ pos: i, ...x, phone: pn || x.phone, whatsapp: wn || null, email: x.email || null, role: x.role || null });
    }
    // tax and address
    v.state_code = String(b.state_code || '').trim();
    if (!isStateCode(v.state_code)) e.state_code = 'Choose the state.';
    const noGst = Boolean(b.no_gst);
    v.gstin = noGst ? null : String(b.gstin || '').trim().toUpperCase();
    if (!noGst) {
      const gp = rules.gstinProblem(v.gstin, isStateCode(v.state_code) ? v.state_code : null);
      if (gp) e.gstin = gp;
      else {
        const [[d]] = await q.query('SELECT name FROM suppliers WHERE gstin = ? AND supplier_id <> ?', [v.gstin, s ? s.supplier_id : 0]);
        if (d) e.gstin = `Same GSTIN as ${d.name}. One supplier, one record.`;
      }
    }
    v.msme_type = ['Micro', 'Small', 'Medium'].includes(b.msme_type) ? b.msme_type : null;
    v.udyam = String(b.udyam || '').trim().toUpperCase() || null;
    if (v.msme_type && !rules.udyamOk(v.udyam || '')) e.udyam = 'Like UDYAM-TN-03-0045121.';
    if (!v.msme_type && v.udyam) e.msme_type = 'Choose the type for this Udyam number.';
    v.addr_l1 = String(b.addr_l1 || '').trim().slice(0, 100);
    v.addr_l2 = String(b.addr_l2 || '').trim().slice(0, 100) || null;
    v.city = String(b.city || '').trim().slice(0, 40);
    v.pin = String(b.pin || '').trim();
    if (!v.addr_l1) e.addr_l1 = 'The street address.';
    if (!v.city) e.city = 'The town or city.';
    if (!/^[1-9]\d{5}$/.test(v.pin)) e.pin = '6 digits, not starting with 0.';
    v.map_query = String(b.map_query || '').trim().slice(0, 80) || null;
    v.pickup = String(b.pickup || '').trim().slice(0, 120) || null;
    // bank: typed only to add or change it (it waits for a second Admin)
    const bk = b.bank || {};
    const acc = String(bk.acc || '').replace(/\s/g, ''); const acc2 = String(bk.acc2 || '').replace(/\s/g, '');
    const ifsc = String(bk.ifsc || '').trim().toUpperCase(); const holder = String(bk.holder || '').trim().slice(0, 80); const bname = String(bk.name || '').trim().slice(0, 60);
    let bank = null;
    if (acc || acc2 || ifsc || holder || bname) {
      if (!/^\d{9,18}$/.test(acc)) e['bank.acc'] = '9 to 18 digits.'; else if (acc !== acc2) e['bank.acc2'] = 'Does not match. Type the account number again.';
      if (!rules.ifscOk(ifsc)) e['bank.ifsc'] = '11 characters: 4 letters, 0, then 6 letters or digits.';
      if (!holder) e['bank.holder'] = 'The name on the account.';
      if (!bname) e['bank.name'] = 'The bank.';
      bank = { holder, name: bname, branch: String(bk.branch || '').trim().slice(0, 60) || null, acc, ifsc, type: rules.BANK_TYPES.includes(bk.type) ? bk.type : 'Current' };
    }
    // items and prices
    const items = [];
    const seen = new Set();
    const its = await buy.items(q, (Array.isArray(b.items) ? b.items : []).map((x) => String(x.sku_code || '')).filter(Boolean));
    (Array.isArray(b.items) ? b.items : []).forEach((x, i) => {
      const sku = String(x.sku_code || '').trim();
      if (!sku && !x.price && !x.lead_days && !x.moq && !x.their_code) return;
      const it = its.get(sku);
      if (!it || !it.buyable) { e[`items.${i}.sku_code`] = it ? `${sku} is set as Made only in Products. Set it to Bought or Both there first.` : 'Choose the item.'; return; }
      if (seen.has(sku)) { e[`items.${i}.sku_code`] = 'Already on the list.'; return; }
      seen.add(sku);
      if (!(Number(x.price) > 0)) e[`items.${i}.price`] = 'A price above 0.';
      if (!whole(x.lead_days, 0)) e[`items.${i}.lead_days`] = 'Whole days.';
      if (!whole(x.moq, 1)) e[`items.${i}.moq`] = 'At least 1.';
      const gsm = x.spec_gsm === '' || x.spec_gsm === null || x.spec_gsm === undefined ? null : Number(x.spec_gsm);
      if (gsm !== null && !(gsm > 0)) e[`items.${i}.spec_gsm`] = 'A GSM above 0, or leave it empty.';
      items.push({ sku, their: String(x.their_code || '').trim().slice(0, 24) || null, price: r2(x.price), lead: Number(x.lead_days), moq: Number(x.moq), gsm,
        ply: gsm === null ? null : Number(x.spec_ply) || null, width: gsm === null ? null : Number(x.spec_width) || null });
    });
    if (Object.keys(e).length) buy.bad(e);
    return { v, contacts, items, bank };
  }
  async function saveChildren(q, id, contacts, items) {
    await q.query('DELETE FROM supplier_contacts WHERE supplier_id = ?', [id]);
    for (const c of contacts) await q.query('INSERT INTO supplier_contacts (supplier_id, pos, name, role, phone, email, whatsapp) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, c.pos, c.name, c.role, c.phone, c.email, c.whatsapp]);
    await q.query('DELETE FROM supplier_items WHERE supplier_id = ?', [id]);
    for (const x of items) await q.query('INSERT INTO supplier_items (supplier_id, sku_code, their_code, price, lead_days, moq, spec_gsm, spec_ply, spec_width) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [id, x.sku, x.their, x.price, x.lead, x.moq, x.gsm, x.ply, x.width]);
  }
  async function askBank(q, s, bank, empId) {
    const summary = `${s.isNew ? 'Bank account of new supplier' : 'New bank account for'} ${s.name}: ${bank.name} ${rules.maskAcc(bank.acc)} (${bank.ifsc}), holder ${bank.holder}`;
    return secondAdmin.ask(q, { kind: 'supplier_bank', t: 'supbank', dk: `supbank:${s.supplier_id}`, summary, payload: { supplier_id: s.supplier_id, bank } }, empId);
  }
  route('post', '/buying/suppliers', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const b = req.body || {};
    const { v, contacts, items, bank } = await readSupplier(q, b, null);
    const opening = Number(b.opening_owed) || 0;
    if (opening < 0) buy.bad({ opening_owed: '0 or more.' });
    const code = await numbering.issue(q, 'supplier');
    const [ins] = await q.query(`INSERT INTO suppliers (code, name, kinds, status, block_reason, gstin, state_code, msme_type, udyam, addr_l1, addr_l2, city, pin, map_query, pickup, terms_days,
        opening_owed, notes, since, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [code, v.name, v.kinds, v.status, v.block_reason, v.gstin, v.state_code, v.msme_type, v.udyam, v.addr_l1, v.addr_l2, v.city, v.pin, v.map_query, v.pickup, v.terms_days, r2(opening), v.notes, buy.today(), by(req)]);
    const id = ins.insertId;
    await saveChildren(q, id, contacts, items);
    await audit(q, { empId: by(req), action: 'create', entity: 'supplier', entityId: String(id), after: { code, ...v, contacts: contacts.length, items: items.map((x) => `${x.sku} ${x.price}`), opening: opening || undefined } });
    const gs = (await myGodowns(q, req))[0];
    const g = gs ? await buy.godownOf(q, gs.godown_id) : null;
    let msg = `${v.name} added as ${code}. ${v.gstin ? (buy.interState({ state_code: v.state_code }, g) ? 'Another state: IGST on their bills.' : 'Same state: CGST + SGST on their bills.') : 'Not registered: no GST on their bills.'}`;
    if (bank) { const w = await askBank(q, { supplier_id: id, name: v.name, isNew: true }, bank, by(req)); msg += ` Their bank account waits for a second Admin; they cannot be paid until it is signed. ${w.message.split('. Until')[1] ? (await waitLine(q, w.approval_id)) : ''}`; }
    else msg += ' No bank account yet: they cannot be paid until one is added.';
    return { supplier_id: id, code, message: msg.trim() };
  })), { ...G, status: 201 });
  route('put', '/buying/suppliers/:id', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const s = await buy.supplierOf(q, req.params.id, true);
    if (!s) throw new InputError('No such supplier', 404);
    const { v, contacts, items, bank } = await readSupplier(q, req.body || {}, s);
    const [oldC] = await q.query('SELECT pos, name, role, phone, email, whatsapp FROM supplier_contacts WHERE supplier_id = ? ORDER BY pos', [s.supplier_id]);
    const [oldI] = await q.query('SELECT sku_code, their_code, price, lead_days, moq, spec_gsm FROM supplier_items WHERE supplier_id = ? ORDER BY sku_code', [s.supplier_id]);
    const before = {}; const after = {};
    for (const k of Object.keys(v)) {
      const o = k === 'kinds' ? s.kinds.join(',') : s[k];
      if (String(o ?? '') !== String(v[k] ?? '')) { before[k] = o ?? null; after[k] = v[k] ?? null; }
    }
    const cNow = JSON.stringify(oldC.map((c) => [c.name, c.role, c.phone, c.email, c.whatsapp]));
    const cNew = JSON.stringify(contacts.map((c) => [c.name, c.role, c.phone, c.email, c.whatsapp]));
    if (cNow !== cNew) { before.contacts = oldC.map((c) => `${c.name || '-'} ${c.phone || ''}`); after.contacts = contacts.map((c) => `${c.name} ${c.phone}`); }
    const iNow = oldI.map((x) => `${x.sku_code} ${Number(x.price)} ${x.lead_days} ${x.moq} ${x.their_code || ''} ${x.spec_gsm === null ? '' : Number(x.spec_gsm)}`).join(', ');
    const iNew = [...items].sort((a, b) => a.sku.localeCompare(b.sku)).map((x) => `${x.sku} ${x.price} ${x.lead} ${x.moq} ${x.their || ''} ${x.gsm === null ? '' : x.gsm}`).join(', ');
    if (iNow !== iNew) { before.items = iNow; after.items = iNew; }
    let bankMsg = '';
    if (bank) {
      if (s.bank_acc === bank.acc && s.bank_ifsc === bank.ifsc) bankMsg = ' The account typed is the one already on file; nothing to change.';
      else {
        const w = await askBank(q, s, bank, by(req));
        bankMsg = w.already ? ` A bank change is already waiting: ${w.message.replace(/^Already waiting: /, '')}`
          : ` New bank account sent for approval. ${await waitLine(q, w.approval_id)} Until then payments go only to the approved account${s.bank_acc ? ` (ending ${s.bank_acc.slice(-4)})` : ''}, never to the new one.`;
      }
    }
    if (!Object.keys(after).length && !bankMsg) return { message: 'Nothing changed', nothing: true };
    if (Object.keys(after).length) {
      await q.query(`UPDATE suppliers SET name = ?, kinds = ?, status = ?, block_reason = ?, gstin = ?, state_code = ?, msme_type = ?, udyam = ?, addr_l1 = ?, addr_l2 = ?, city = ?, pin = ?,
          map_query = ?, pickup = ?, terms_days = ?, notes = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE supplier_id = ?`,
      [v.name, v.kinds, v.status, v.block_reason, v.gstin, v.state_code, v.msme_type, v.udyam, v.addr_l1, v.addr_l2, v.city, v.pin, v.map_query, v.pickup, v.terms_days, v.notes, by(req), s.supplier_id]);
      await saveChildren(q, s.supplier_id, contacts, items);
      await audit(q, { empId: by(req), action: 'update', entity: 'supplier', entityId: String(s.supplier_id), before, after });
    }
    const labels = { name: 'Name', kinds: 'Supplies', terms_days: 'Terms', status: 'Status', block_reason: 'Status', gstin: 'GSTIN', state_code: 'State', msme_type: 'MSME', udyam: 'MSME', addr_l1: 'Address', addr_l2: 'Address', city: 'Address', pin: 'Address', map_query: 'Map', pickup: 'Pickup', notes: 'Notes', contacts: 'Contacts', items: 'Items' };
    const changed = [...new Set(Object.keys(after).map((k) => labels[k]))];
    return { message: `${changed.length ? `${changed.join(', ')} saved, each in the audit log.` : ''}${bankMsg}`.trim() };
  })), G);
  // a supplier's bank account, once a second Admin signs (the payload carries the account; the audit log has it masked)
  secondAdmin.on('supbank', {
    async apply(q, p, empId) {
      const [[s]] = await q.query('SELECT supplier_id, name, bank_acc FROM suppliers WHERE supplier_id = ? FOR UPDATE', [p.supplier_id]);
      if (!s) return;
      const b = p.bank;
      await q.query('UPDATE suppliers SET bank_holder = ?, bank_name = ?, bank_branch = ?, bank_acc = ?, bank_ifsc = ?, bank_type = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE supplier_id = ?',
        [b.holder, b.name, b.branch, b.acc, b.ifsc, b.type, empId, s.supplier_id]);
      await audit(q, { empId, action: 'update', entity: 'supplier', entityId: String(s.supplier_id), before: { bank: s.bank_acc ? rules.maskAcc(s.bank_acc) : 'none' }, after: { bank: `${b.name} ${rules.maskAcc(b.acc)} ${b.ifsc}`, approved: true } });
    },
  });

  // ============================================================================================ indents
  async function indentRows(q, where, params) {
    const [rows] = await q.query(`SELECT i.indent_id, i.indent_no, i.godown_id, g.name AS godown, DATE_FORMAT(i.need_by, '%Y-%m-%d') AS need_by, i.reason, i.status, i.is_auto, i.po_id, p.po_no,
        i.requested_by, i.requested_at, i.decided_by, i.decided_at, i.reject_reason FROM indents i JOIN locations g ON g.location_id = i.godown_id LEFT JOIN purchase_orders p ON p.po_id = i.po_id
        WHERE ${where} ORDER BY i.indent_id DESC`, params);
    const ids = rows.map((r) => r.indent_id);
    const [lines] = ids.length ? await q.query('SELECT indent_id, sku_code, qty FROM indent_lines WHERE indent_id IN (?) ORDER BY line_no', [ids]) : [[]];
    const its = await buy.items(q, [...new Set(lines.map((l) => l.sku_code))]);
    const names = await namesOf(q, rows.flatMap((r) => [r.requested_by, r.decided_by]));
    return rows.map((r) => ({ ...r, is_auto: Number(r.is_auto) === 1, status_label: IND_ST[r.status], late: r.need_by < buy.today() && ['open', 'approved'].includes(r.status), by_name: nm(names, r.requested_by), decided_name: nm(names, r.decided_by),
      lines: lines.filter((l) => l.indent_id === r.indent_id).map((l) => ({ sku_code: l.sku_code, qty: l.qty, name: (its.get(l.sku_code) || {}).name, qty_text: buy.qtyText(its.get(l.sku_code), l.qty) })) }));
  }
  route('get', '/buying/indents', 'buying:view', wrap(async (req) => {
    const [gw, gp] = godowns.where('i.godown_id', scope(req));
    const all = await indentRows(db, gw, gp);
    const tab = IND_ST[req.query.tab] ? req.query.tab : 'open';
    return { counts: Object.fromEntries(Object.keys(IND_ST).map((k) => [k, all.filter((x) => x.status === k).length])), rows: all.filter((x) => x.status === tab),
      can: { create: canDo(req, 'buying', 'create'), edit: canDo(req, 'buying', 'edit') } };
  }), G);
  route('get', '/buying/indents/:id', 'buying:view', wrap(async (req) => {
    const [x] = await indentRows(db, 'i.indent_id = ?', [Number(req.params.id)]);
    if (!x) throw new InputError('No such indent', 404);
    sees(req, x.godown_id);
    for (const l of x.lines) {
      const [[st]] = await db.query("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND location_id = ? AND stock_kind = 'good'", [l.sku_code, x.godown_id]);
      const [[lv]] = await db.query('SELECT reorder_level FROM stock_levels WHERE sku_code = ? AND location_id = ?', [l.sku_code, x.godown_id]);
      const it = (await buy.items(db, [l.sku_code])).get(l.sku_code);
      l.in_stock = buy.qtyText(it, Number(st.n)); l.reorder = buy.qtyText(it, lv ? Number(lv.reorder_level) : 0);
    }
    const mayDecide = canDo(req, 'buying', 'edit') && x.requested_by !== by(req) && godowns.covers(req.admin, x.godown_id);
    return { indent: x, can: { decide: mayDecide, mine: x.requested_by === by(req), edit: canDo(req, 'buying', 'edit') && godowns.covers(req.admin, x.godown_id) } };
  }), G);
  /** lines [{ sku_code, qty }] of an indent form -> checked lines */
  async function readQtyLines(q, raw, e, pre = 'lines') {
    const out = []; const seen = new Set();
    const its = await buy.items(q, (Array.isArray(raw) ? raw : []).map((l) => String(l.sku_code || '')).filter(Boolean));
    (Array.isArray(raw) ? raw : []).forEach((l, i) => {
      const sku = String(l.sku_code || '').trim(); const qty = String(l.qty ?? '').trim();
      if (!sku && !qty) return;
      const it = its.get(sku);
      if (!it || !it.buyable) { e[`${pre}.${i}.sku_code`] = 'Choose the item.'; return; }
      if (seen.has(sku)) { e[`${pre}.${i}.sku_code`] = 'Already asked above.'; return; }
      seen.add(sku);
      if (!whole(qty, 1)) { e[`${pre}.${i}.qty`] = 'A whole number, at least 1.'; return; }
      out.push({ sku, qty: Number(qty) });
    });
    return out;
  }
  route('post', '/buying/indents', 'buying:create', wrap(async (req) => tx(async (q) => {
    const b = req.body || {};
    const gid = await godowns.resolve(q, req, b.godown_id);
    const e = {};
    if (!isDay(b.need_by) || b.need_by < buy.today()) e.need_by = 'Today or later.';
    const why = String(b.reason || '').trim().slice(0, 120);
    if (!why) e.reason = 'Say what it is for.';
    const lines = await readQtyLines(q, b.lines, e);
    if (!lines.length && !Object.keys(e).length) e['lines.0.sku_code'] = 'Ask for at least one item.';
    if (Object.keys(e).length) buy.bad(e);
    const no = await numbering.issue(q, 'indent', gid);
    const [ins] = await q.query('INSERT INTO indents (indent_no, godown_id, need_by, reason, requested_by) VALUES (?, ?, ?, ?, ?)', [no, gid, b.need_by, why, by(req)]);
    for (const [i, l] of lines.entries()) await q.query('INSERT INTO indent_lines (indent_id, line_no, sku_code, qty) VALUES (?, ?, ?, ?)', [ins.insertId, i + 1, l.sku, l.qty]);
    await audit(q, { empId: by(req), action: 'create', entity: 'indent', entityId: no, after: { lines: lines.map((l) => `${l.sku} ${l.qty}`), need_by: b.need_by, reason: why } });
    return { indent_id: ins.insertId, indent_no: no, message: 'Waiting for someone with edit rights on Suppliers and buying to approve it.' };
  })), { ...G, status: 201 });
  async function decideIndent(req, ok) {
    return tx(async (q) => {
      const [[x]] = await q.query('SELECT indent_id, indent_no, godown_id, status, requested_by FROM indents WHERE indent_id = ? FOR UPDATE', [Number(req.params.id)]);
      if (!x) throw new InputError('No such indent', 404);
      sees(req, x.godown_id); works(req, x.godown_id);
      if (x.status !== 'open') throw new InputError(`It is ${IND_ST[x.status].toLowerCase()} already.`, 409);
      if (x.requested_by === by(req)) throw new InputError(`You asked for it. Somebody else ${ok ? 'approves it' : 'decides'}.`, 403);
      const why = String((req.body || {}).reason || '').trim().slice(0, 120);
      if (!ok && !why) buy.bad({ reason: 'Say why, so the person who asked knows.' });
      await q.query('UPDATE indents SET status = ?, decided_by = ?, decided_at = UTC_TIMESTAMP(), reject_reason = ? WHERE indent_id = ?', [ok ? 'approved' : 'rejected', by(req), ok ? null : why, x.indent_id]);
      await audit(q, { empId: by(req), action: ok ? 'approve' : 'reject', entity: 'indent', entityId: x.indent_no, before: { status: 'open' }, after: { status: ok ? 'approved' : 'rejected', reason: why || undefined } });
      return { message: ok ? 'Approved. Now Make purchase order turns it into a PO.' : 'Rejected. The person who asked sees why.' };
    });
  }
  route('post', '/buying/indents/:id/approve', 'buying:edit', wrap((req) => decideIndent(req, true)), G);
  route('post', '/buying/indents/:id/reject', 'buying:edit', wrap((req) => decideIndent(req, false)), G);
  /** what is on the shelf, in QC hold, ordered (open PO quantity; whole lines of drafts and waiting POs) and asked for */
  async function incoming(q, sku, gid) {
    const [[h]] = await q.query("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND location_id = ? AND stock_kind = 'hold'", [sku, gid]);
    let n = Number(h.n);
    const [pos] = await q.query("SELECT po_id FROM purchase_orders WHERE godown_id = ? AND status IN ('draft', 'waiting', 'open') AND po_id IN (SELECT po_id FROM po_lines WHERE sku_code = ?)", [gid, sku]);
    for (const r of pos) {
      const p = await buy.poOf(q, r.po_id); const l = p.lines.find((x) => x.sku === sku);
      if (['draft', 'waiting'].includes(p.status)) n += l.qty;
      else { const got = await buy.received(q, p.po_id); n += buy.openOf(l, got); }
    }
    const [[ind]] = await q.query("SELECT COALESCE(SUM(l.qty), 0) AS n FROM indent_lines l JOIN indents i ON i.indent_id = l.indent_id WHERE l.sku_code = ? AND i.godown_id = ? AND i.status IN ('open', 'approved')", [sku, gid]);
    return n + Number(ind.n);
  }
  /** the cheapest active supplier with this item on their list */
  async function bestItem(q, sku) {
    const [[r]] = await q.query("SELECT i.supplier_id, i.price, i.moq FROM supplier_items i JOIN suppliers s ON s.supplier_id = i.supplier_id WHERE i.sku_code = ? AND s.status = 'active' ORDER BY i.price, s.supplier_id LIMIT 1", [sku]);
    return r ? { supplier_id: r.supplier_id, price: Number(r.price), moq: Number(r.moq) } : null;
  }
  // an approved indent as a new PO: the cheapest active supplier of its first item, each line at the last price paid
  route('get', '/buying/indents/:id/po-draft', 'buying:edit', wrap(async (req) => {
    const [x] = await indentRows(db, 'i.indent_id = ?', [Number(req.params.id)]);
    if (!x) throw new InputError('No such indent', 404);
    sees(req, x.godown_id); works(req, x.godown_id);
    if (x.status !== 'approved') throw new InputError('Only an approved indent becomes a purchase order.', 409);
    const best = await bestItem(db, x.lines[0].sku_code);
    const lines = [];
    for (const l of x.lines) { const lp = best ? await buy.lastPrice(db, best.supplier_id, l.sku_code) : null; lines.push({ sku_code: l.sku_code, qty: String(l.qty), rate: lp ? String(lp.rate) : '', disc: '0' }); }
    return { indent_id: x.indent_id, indent_no: x.indent_no, supplier_id: best ? best.supplier_id : '', godown_id: x.godown_id, lines };
  }), G);
  route('post', '/buying/indents/reorder-check', 'buying:create', wrap(async (req) => tx(async (q) => {
    const gs = (await myGodowns(q, req)).filter((g) => { const p = godowns.picked(req); return !p || p === g.godown_id; });
    const its = await buy.items(q);
    const made = [];
    for (const g of gs) {
      const [lv] = await q.query('SELECT sku_code, reorder_level FROM stock_levels WHERE location_id = ? AND reorder_level > 0', [g.godown_id]);
      const lines = [];
      for (const r of lv) {
        const it = its.get(r.sku_code);
        if (!it || !it.buyable) continue;
        const [[st]] = await q.query("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND location_id = ? AND stock_kind = 'good'", [r.sku_code, g.godown_id]);
        const have = Number(st.n) + (await incoming(q, r.sku_code, g.godown_id));
        const level = Number(r.reorder_level);
        if (have >= level) continue;
        let qty = level * 2 - have;
        const best = await bestItem(q, r.sku_code);
        if (best && qty < best.moq) qty = best.moq;
        lines.push({ sku: r.sku_code, qty });
      }
      if (!lines.length) continue;
      const no = await numbering.issue(q, 'indent', g.godown_id);
      const [ins] = await q.query('INSERT INTO indents (indent_no, godown_id, need_by, reason, is_auto, requested_by) VALUES (?, ?, ?, ?, 1, ?)', [no, g.godown_id, buy.addDays(buy.today(), 7), 'Reorder check: below the reorder level', by(req)]);
      for (const [i, l] of lines.entries()) await q.query('INSERT INTO indent_lines (indent_id, line_no, sku_code, qty) VALUES (?, ?, ?, ?)', [ins.insertId, i + 1, l.sku, l.qty]);
      await audit(q, { empId: by(req), action: 'create', entity: 'indent', entityId: no, after: { reorder_check: true, lines: lines.map((l) => `${l.sku} ${l.qty}`) } });
      made.push(`${no} (${lines.map((l) => `${l.sku} ${l.qty}`).join(', ')})`);
    }
    return made.length ? { made, message: `${made.join('; ')}. Each asks for twice the reorder level less what is there or coming, rounded up to the supplier's minimum order.` }
      : { made, message: 'Everything is at or above its reorder level, counting QC hold, open orders and open indents.' };
  })), G);

  // ============================================================================================ purchase orders
  /** the PO as the screens show it (rates and values only for See cost or Buying Edit) */
  async function poView(q, req, p, full = false) {
    const sup = await buy.supplierOf(q, p.supplier_id);
    const g = await buy.godownOf(q, p.godown_id);
    const got = await buy.received(q, p.po_id);
    const state = await buy.poState(q, p, got);
    const its = await buy.items(q, p.lines.map((l) => l.sku));
    const rates = await buy.gstRates(q, its, p.po_date || buy.today());
    const t = buy.totals(p.lines.map((l) => ({ ...l, gst: rates.get(l.sku) })), p.freight, { registered: Boolean(sup.gstin), inter: buy.interState(sup, g) });
    const ord = p.lines.reduce((a, l) => a + l.qty, 0);
    const recv = p.lines.reduce((a, l) => a + Math.min(l.qty, got.get(l.sku) || 0), 0);
    const out = { po_id: p.po_id, po_no: p.po_no, ref: buy.poRef(p), status: p.status, state, state_label: PO_ST[state], rev: p.rev, po_date: p.po_date, expected_on: p.expected_on,
      late: ['open', 'part'].includes(state) && p.expected_on < buy.today(), supplier: { supplier_id: sup.supplier_id, code: sup.code, name: sup.name, status: sup.status, gstin: sup.gstin },
      godown_id: g.godown_id, godown: g.name, received_pct: ord ? Math.round((recv / ord) * 100) : 0, total: hide(req, t.total), value: hide(req, buy.poValue(p.lines, p.freight)),
      items_text: p.lines.length ? `${(its.get(p.lines[0].sku) || {}).name || p.lines[0].sku}${p.lines.length > 1 ? ` +${p.lines.length - 1} more` : ''}` : '' };
    if (!full) return out;
    const names = await namesOf(q, [p.raised_by, p.approved_by, p.end_by, p.created_by]);
    const [grns] = await q.query("SELECT grn_id, grn_no, DATE_FORMAT(received_on, '%Y-%m-%d') AS received_on, status FROM goods_ins WHERE po_id = ? ORDER BY grn_id", [p.po_id]);
    const [cls] = await q.query('SELECT claim_id, claim_no, debit_no, status FROM claims WHERE po_id = ? ORDER BY claim_id', [p.po_id]);
    const [revs] = await q.query("SELECT rev, kind, rev_lines, freight, DATE_FORMAT(expected_on, '%Y-%m-%d') AS expected_on, terms, emp_id, created_at FROM po_revisions WHERE po_id = ? ORDER BY rev_id DESC", [p.po_id]);
    const rn = await namesOf(q, revs.map((r) => r.emp_id));
    const [[am]] = await q.query("SELECT rev, rev_lines, freight, DATE_FORMAT(expected_on, '%Y-%m-%d') AS expected_on, approval_id FROM po_amendments WHERE po_id = ?", [p.po_id]);
    const asLines = (j) => (typeof j === 'string' ? JSON.parse(j) : j).map((l) => ({ sku: l.sku, qty: l.qty, rate: hide(req, l.rate), disc: l.disc }));
    const [[ind]] = p.indent_id ? await q.query('SELECT indent_no FROM indents WHERE indent_id = ?', [p.indent_id]) : [[null]];
    return { ...out, terms: p.terms, freight: hide(req, p.freight), tax: t.inter ? 'IGST (another state)' : 'CGST + SGST (same state)', supplier_terms: sup.terms_days,
      totals: seeBuy(req) ? t : null, raised_by: nm(names, p.raised_by), raised_at: p.raised_at, approved_by: p.approved_by ? nm(names, p.approved_by) : null, sent_at: p.sent_at,
      ended: p.end_by ? { by: nm(names, p.end_by), why: p.end_reason, at: p.ended_at } : null, indent_no: ind ? ind.indent_no : null,
      waiting: p.status === 'waiting' && p.approval_id ? await waitLine(q, p.approval_id) : null,
      amendment: am ? { rev: am.rev, lines: asLines(am.rev_lines), freight: hide(req, Number(am.freight)), expected_on: am.expected_on, line: await waitLine(q, am.approval_id) } : null,
      lines: p.lines.map((l) => { const it = its.get(l.sku) || {}; return { sku_code: l.sku, name: it.name, unit: it.unit, qty: l.qty, qty_text: buy.qtyText(it, l.qty), credited: l.credited, credited_text: l.credited ? buy.qtyText(it, l.credited) : null,
        received: got.get(l.sku) || 0, received_text: buy.qtyText(it, got.get(l.sku) || 0), open: buy.openOf(l, got), open_text: buy.qtyText(it, buy.openOf(l, got)), rate: hide(req, l.rate), disc: l.disc, amount: hide(req, buy.lineVal(l)), gst: rates.get(l.sku) }; }),
      goods_in: grns.map((x) => ({ ...x, status_label: GI_ST[x.status] })), claims: cls.map((c) => ({ ...c, status_label: CL_ST[c.status] })),
      revisions: revs.filter((r) => r.kind === 'old').map((r) => ({ rev: r.rev, until: r.created_at, by: nm(rn, r.emp_id), lines: asLines(r.rev_lines), freight: hide(req, Number(r.freight)), expected_on: r.expected_on })),
      rejected: revs.filter((r) => r.kind === 'rejected').map((r) => ({ rev: r.rev, at: r.created_at, by: nm(rn, r.emp_id), lines: asLines(r.rev_lines) })),
      can: { edit: canDo(req, 'buying', 'edit') && godowns.covers(req.admin, p.godown_id), create: canDo(req, 'buying', 'create') && godowns.covers(req.admin, p.godown_id), cancel: canDo(req, 'buying', 'cancel') } };
  }
  const PO_TABS = { draft: ['draft'], waiting: ['waiting'], open: ['open', 'part'], received: ['received'], closed: ['closed', 'cancelled', 'rejected'] };
  route('get', '/buying/pos', 'buying:view', wrap(async (req) => {
    const [gw, gp] = godowns.where('godown_id', scope(req));
    const [ids] = await db.query(`SELECT po_id FROM purchase_orders WHERE ${gw} ORDER BY po_id DESC`, gp);
    const all = [];
    for (const r of ids) all.push(await poView(db, req, await buy.poOf(db, r.po_id)));
    const tab = PO_TABS[req.query.tab] ? req.query.tab : 'open';
    const po = await approvals.rule(db, 'po');
    return { counts: Object.fromEntries(Object.entries(PO_TABS).map(([k, v]) => [k, all.filter((x) => v.includes(x.state)).length])), rows: all.filter((x) => PO_TABS[tab].includes(x.state)),
      rule: { on: po.is_on, above: po.limit_value }, can: { edit: canDo(req, 'buying', 'edit'), export: canDo(req, 'buying', 'export') } };
  }), G);
  route('get', '/buying/pos/:id', 'buying:view', wrap(async (req) => {
    const p = await buy.poOf(db, req.params.id);
    if (!p) throw new InputError('No such purchase order', 404);
    sees(req, p.godown_id);
    return poView(db, req, p, true);
  }), G);
  route('get', '/buying/pos-export', 'buying:export', wrap(async (req, res) => {
    const [gw, gp] = godowns.where('godown_id', godowns.scopeOf(req.admin));
    const [ids] = await db.query(`SELECT po_id FROM purchase_orders WHERE status <> 'draft' AND ${gw} ORDER BY po_id`, gp);
    const rows = [['po', 'godown', 'supplier', 'date', 'expected', 'item', 'qty', 'rate', 'disc_pct', 'received', 'open', 'status']];
    for (const r of ids) {
      const p = await buy.poOf(db, r.po_id); const v = await poView(db, req, p, true);
      for (const l of v.lines) rows.push([p.po_no, v.godown, v.supplier.name, p.po_date, p.expected_on, l.sku_code, l.qty, l.rate === null ? 'hidden' : l.rate, l.disc, l.received, l.open, v.state_label]);
    }
    await audit(db, { empId: by(req), action: 'export', entity: 'purchase_order', entityId: 'csv', after: { lines: rows.length - 1 } });
    res.set('Content-Type', 'text/csv; charset=utf-8').set('Content-Disposition', `attachment; filename="dfresh-purchase-orders-${buy.today()}.csv"`).send(`﻿${rows.map((r) => r.map(csvCell).join(',')).join('\n')}\n`);
  }), G);

  /**
   * read and check a PO form. amend: the PO being amended (its supplier and godown never change) -> { sup, gid, expected,
   * freight, terms, lines } (throws field errors)
   */
  async function readPo(q, req, b, amend = null) {
    const e = {};
    const supId = amend ? amend.supplier_id : Number(b.supplier_id);
    const sup = supId ? await buy.supplierOf(q, supId) : null;
    if (!sup) e.supplier_id = 'Choose the supplier.';
    else if (sup.status !== 'active' && !amend) e.supplier_id = `${sup.name} is ${SUP_ST[sup.status].toLowerCase()}: ${sup.block_reason}`;
    let gid = amend ? amend.godown_id : null;
    if (!amend) { try { gid = await godowns.resolve(q, req, b.godown_id); } catch { e.godown_id = 'Choose the godown.'; } }
    const exp = String(b.expected_on || '');
    if (!isDay(exp) || (exp < buy.today() && !(amend && exp === amend.expected_on))) e.expected_on = 'Today or later.';
    const fr = String(b.freight ?? '').trim();
    if (fr !== '' && !(Number(fr) >= 0)) e.freight = '0 or more.';
    const raw = Array.isArray(b.lines) ? b.lines : [];
    const its = await buy.items(q, raw.map((l) => String(l.sku_code || '')).filter(Boolean));
    const got = amend ? await buy.received(q, amend.po_id) : new Map();
    const lines = []; const seen = new Set();
    raw.forEach((x, i) => {
      const sku = String(x.sku_code || '').trim(); const qty = String(x.qty ?? '').trim(); const rate = String(x.rate ?? '').trim(); const disc = String(x.disc ?? '').trim() || '0';
      if (!sku && !qty && !rate) return;
      const it = its.get(sku);
      if (!it) { e[`lines.${i}.sku_code`] = 'Choose the item.'; return; }
      if (!it.buyable) { e[`lines.${i}.sku_code`] = `${sku} is set as Made only in Products. Set it to Bought or Both there first.`; return; }
      if (seen.has(sku)) { e[`lines.${i}.sku_code`] = 'Already on this order. Change the quantity above instead.'; return; }
      seen.add(sku);
      if (!whole(qty, 1)) { e[`lines.${i}.qty`] = 'A whole number, at least 1.'; return; }
      if (!(Number(rate) > 0)) { e[`lines.${i}.rate`] = 'A rate above 0.'; return; }
      if (!(Number(disc) >= 0 && Number(disc) < 100)) { e[`lines.${i}.disc`] = '0 to 99.'; return; }
      if (amend && Number(qty) < (got.get(sku) || 0)) { e[`lines.${i}.qty`] = `${buy.qtyText(it, got.get(sku))} has already come in. It cannot go below that.`; return; }
      lines.push({ sku, qty: Number(qty), rate: r2(rate), disc: r2(disc) });
    });
    if (amend) { const gone = amend.lines.find((l) => !seen.has(l.sku) && (got.get(l.sku) || 0) > 0); if (gone) e.lines = `${gone.sku} has goods in against it, so it cannot be taken off the order. Set its quantity to what came in instead.`; }
    if (!lines.length && !Object.keys(e).length) e['lines.0.sku_code'] = 'Add at least one item.';
    if (Object.keys(e).length) buy.bad(e);
    return { sup, gid, expected: exp, freight: r2(Number(fr) || 0), terms: String(b.terms || '').trim().slice(0, 300) || null, lines };
  }
  /** v23 L1: the other raised orders to this supplier within the days that count together (amendments count in the total) */
  async function othersToSupplier(q, supId, exceptPo) {
    const { from } = await approvals.splitFrom(q);
    const [rows] = await q.query("SELECT po_id FROM purchase_orders WHERE supplier_id = ? AND po_id <> ? AND po_date >= ? AND status NOT IN ('draft', 'cancelled', 'rejected')", [supId, exceptPo, from]);
    let t = 0;
    for (const r of rows) { const p = await buy.poOf(q, r.po_id); t += buy.poValue(p.lines, p.freight); }
    return t;
  }
  route('get', '/buying/last-price', 'buying:edit', wrap(async (req) => ({ last: await buy.lastPrice(db, Number(req.query.supplier), String(req.query.sku || ''), Number(req.query.po) || 0) })), G);
  /** what the PO form shows while typing: per line last price, price up, minimum order, GST; the totals; approval */
  route('post', '/buying/pos/check', 'buying:edit', wrap(async (req) => {
    const b = req.body || {};
    const amend = b.po_id ? await buy.poOf(db, b.po_id) : null;
    const isAmend = amend && amend.status !== 'draft';
    const sup = await buy.supplierOf(db, isAmend ? amend.supplier_id : b.supplier_id);
    const gid = isAmend ? amend.godown_id : Number(b.godown_id) || (await myGodowns(db, req)).map((g) => g.godown_id)[0];
    const g = gid ? await buy.godownOf(db, gid) : null;
    const raw = (Array.isArray(b.lines) ? b.lines : []).map((l) => ({ sku: String(l.sku_code || ''), qty: l.qty, rate: l.rate, disc: Number(l.disc) || 0 }));
    const its = await buy.items(db, raw.map((l) => l.sku).filter(Boolean));
    const rates = await buy.gstRates(db, its, buy.today());
    const notes = [];
    const hints = [];
    for (const l of raw) {
      const it = its.get(l.sku);
      if (!it || !sup) { hints.push({ text: '', amount: null }); continue; }
      const parts = [];
      const lp = await buy.lastPrice(db, sup.supplier_id, l.sku, amend ? amend.po_id : 0);
      if (lp) parts.push(`Last ${rs(lp.rate)}${lp.date ? ` on ${lp.date} (${lp.po})` : ' (their price list)'}`);
      if (lp && l.rate !== '' && Number(l.rate) > lp.rate + 0.004) { const up = Math.round((Number(l.rate) / lp.rate - 1) * 1000) / 10; parts.push(`up ${up}%`); notes.push(`${it.name} costs ${up}% more than last time.`); }
      const [[si]] = await db.query('SELECT moq FROM supplier_items WHERE supplier_id = ? AND sku_code = ?', [sup.supplier_id, l.sku]);
      if (si && l.qty !== '' && Number(l.qty) < Number(si.moq)) { parts.push(`below their minimum of ${buy.qtyText(it, Number(si.moq))}`); notes.push(`${it.name}: ${sup.name} usually takes at least ${buy.qtyText(it, Number(si.moq))}.`); }
      if (!si) parts.push(`not on ${sup.name}'s item list`);
      parts.push(`GST ${sup.gstin ? (rates.get(l.sku) === null ? 'no rate: set its HSN' : `${rates.get(l.sku)}%`) : 'none (not registered)'}`);
      hints.push({ text: parts.join(' · '), up: lp && l.rate !== '' && Number(l.rate) > lp.rate + 0.004, last_rate: lp ? lp.rate : null, amount: l.qty !== '' && l.rate !== '' ? buy.lineVal({ qty: Number(l.qty), rate: Number(l.rate), disc: l.disc }) : null });
    }
    const good = raw.filter((l) => its.get(l.sku) && Number(l.qty) > 0 && l.rate !== '' && l.rate !== undefined).map((l) => ({ sku: l.sku, qty: Number(l.qty), rate: Number(l.rate), disc: l.disc, gst: rates.get(l.sku) }));
    if (!sup || !good.length) return { hints, totals: null, notes };
    const t = buy.totals(good, b.freight, { registered: Boolean(sup.gstin), inter: buy.interState(sup, g) });
    const v = buy.poValue(good, b.freight);
    const rule = await approvals.rule(db, 'po');
    let need; let before = 0;
    if (isAmend) {
      const oldV = buy.poValue(amend.lines, amend.freight);
      const others = await othersToSupplier(db, sup.supplier_id, amend.po_id);
      const up = good.filter((l) => { const o = amend.lines.find((x) => x.sku === l.sku); return !o || buy.unitRate(l) > buy.unitRate(o) + 0.004; });
      need = (v > oldV && engine.needs(rule, { amount: v + others }).needs) || (up.length > 0 && rule.is_on);
      before = others;
    } else {
      const c = await approvals.check(db, 'po', { amount: v, target: `sup:${sup.supplier_id}` });
      need = c.needs; before = c.total - v;
    }
    return { hints, notes, totals: t, value: v, before, need, rule: { on: rule.is_on, above: rule.limit_value }, amend: Boolean(isAmend), see: seeBuy(req) };
  }), G);

  async function lineText(q, lines) { const its = await buy.items(q, lines.map((l) => l.sku)); return lines.map((l) => `${buy.qtyText(its.get(l.sku), l.qty)} ${((its.get(l.sku) || {}).name || l.sku).toLowerCase()}`).join(', '); }
  async function writeLines(q, poId, lines) {
    await q.query('DELETE FROM po_lines WHERE po_id = ?', [poId]);
    for (const [i, l] of lines.entries()) await q.query('INSERT INTO po_lines (po_id, line_no, sku_code, qty, rate, disc_pct, credited) VALUES (?, ?, ?, ?, ?, ?, ?)', [poId, i + 1, l.sku, l.qty, l.rate, l.disc, l.credited || 0]);
  }
  // save a draft (no number) or raise it (numbered now; above the limit it waits)
  route('post', '/buying/pos', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const b = req.body || {};
    const draft = b.po_id ? await buy.poOf(q, b.po_id, true) : null;
    if (b.po_id && (!draft || draft.status !== 'draft')) throw new InputError('Only a draft can be saved or raised here.', 409);
    if (draft) { sees(req, draft.godown_id); works(req, draft.godown_id); }
    const x = await readPo(q, req, b, null);
    const indentId = draft ? draft.indent_id : Number(b.indent_id) || null;
    if (indentId) {
      const [[ind]] = await q.query('SELECT status, godown_id FROM indents WHERE indent_id = ? FOR UPDATE', [indentId]);
      if (!ind || !['approved', 'po'].includes(ind.status) || (ind.status === 'po' && !draft)) throw new InputError('That indent is not approved (or is already a purchase order).', 409);
    }
    let poId = draft ? draft.po_id : null;
    if (!poId) {
      // a draft gets "Draft n" (no number from the series); an order raised at once never was a draft
      const [[d]] = await q.query('SELECT COALESCE(MAX(draft_no), 0) + 1 AS n FROM purchase_orders');
      const [ins] = await q.query('INSERT INTO purchase_orders (draft_no, supplier_id, godown_id, status, expected_on, freight, terms, indent_id, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [b.action === 'raise' ? null : d.n, x.sup.supplier_id, x.gid, 'draft', x.expected, x.freight, x.terms, indentId, by(req)]);
      poId = ins.insertId;
    } else await q.query('UPDATE purchase_orders SET supplier_id = ?, godown_id = ?, expected_on = ?, freight = ?, terms = ? WHERE po_id = ?', [x.sup.supplier_id, x.gid, x.expected, x.freight, x.terms, poId]);
    await writeLines(q, poId, x.lines);
    if (b.action !== 'raise') {
      const p = await buy.poOf(q, poId);
      await audit(q, { empId: by(req), action: draft ? 'update' : 'create', entity: 'purchase_order', entityId: `Draft ${p.draft_no}`, after: { supplier: x.sup.name, lines: x.lines.map((l) => `${l.sku} ${l.qty}`) } });
      return { po_id: poId, message: `Draft ${p.draft_no} saved. A draft has no number and goes nowhere until it is raised.`, draft: true };
    }
    const no = await numbering.issue(q, 'po', x.gid);
    const v = buy.poValue(x.lines, x.freight);
    const target = `sup:${x.sup.supplier_id}`;
    const c = await approvals.check(q, 'po', { amount: v, target });
    const before = c.total - v;
    let msg; let status;
    if (c.needs) {
      status = 'waiting';
      const aid = await approvals.request(q, { kind: 'po', godownId: x.gid, refType: 'purchase_order', refId: no, target, amount: v, summary: `PO ${no} to ${x.sup.name}, ${await lineText(q, x.lines)}`, payload: { t: 'po', po_id: poId } }, by(req));
      await q.query("UPDATE purchase_orders SET po_no = ?, status = 'waiting', po_date = ?, raised_by = ?, raised_at = UTC_TIMESTAMP(), approval_id = ? WHERE po_id = ?", [no, buy.today(), by(req), aid, poId]);
      msg = `${before > 0 ? `With ${rs0(before)} of other orders to ${x.sup.name} in the last ${c.days} days, that is ${rs0(v + before)}. ` : ''}${await waitLine(q, aid)} The supplier gets it after approval.`;
    } else {
      status = 'open';
      await q.query("UPDATE purchase_orders SET po_no = ?, status = 'open', po_date = ?, raised_by = ?, raised_at = UTC_TIMESTAMP(), sent_at = UTC_TIMESTAMP() WHERE po_id = ?", [no, buy.today(), by(req), poId]);
      await approvals.direct(q, 'po', { amount: v, target }, by(req));
      msg = `${rs0(v)} without GST needs no approval. It is ready to print or mail to ${x.sup.name}.`;
    }
    if (indentId) await q.query("UPDATE indents SET status = 'po', po_id = ? WHERE indent_id = ?", [poId, indentId]);
    await audit(q, { empId: by(req), action: 'create', entity: 'purchase_order', entityId: no, before: draft ? { draft: `Draft ${draft.draft_no}` } : null, after: { supplier: x.sup.name, value: v, status, lines: x.lines.map((l) => `${l.sku} ${l.qty} @ ${l.rate}`) } });
    return { po_id: poId, po_no: no, waiting: status === 'waiting', message: msg };
  })), { ...G, status: 201 });
  route('delete', '/buying/pos/:id', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const p = await buy.poOf(q, req.params.id, true);
    if (!p) throw new InputError('No such purchase order', 404);
    sees(req, p.godown_id);
    if (p.status !== 'draft') throw new InputError('Only a draft can be deleted. A raised order is cancelled instead.', 409);
    await q.query('DELETE FROM purchase_orders WHERE po_id = ?', [p.po_id]);
    await audit(q, { empId: by(req), action: 'delete', entity: 'purchase_order', entityId: `Draft ${p.draft_no}` });
    return { message: 'Draft deleted. A draft has no number yet, so nothing is lost from the series.' };
  })), G);
  // amend an open order: a new revision; a higher value (with the supplier's other orders) or a higher rate / new line waits
  route('post', '/buying/pos/:id/amend', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const p = await buy.poOf(q, req.params.id, true);
    if (!p) throw new InputError('No such purchase order', 404);
    sees(req, p.godown_id); works(req, p.godown_id);
    const st = await buy.poState(q, p);
    if (!['open', 'part'].includes(st)) throw new InputError(st === 'waiting' ? 'An amendment or the order itself is waiting for approval. Decide it first.' : `It is ${PO_ST[st].toLowerCase()}: it cannot be amended.`, 409);
    const x = await readPo(q, req, req.body || {}, p);
    const same = JSON.stringify(x.lines) === JSON.stringify(p.lines.map((l) => ({ sku: l.sku, qty: l.qty, rate: l.rate, disc: l.disc }))) && x.freight === p.freight && x.expected === p.expected_on && (x.terms || null) === (p.terms || null);
    if (same) return { message: `Nothing changed. The order stays Rev ${p.rev}.`, nothing: true };
    const oldV = buy.poValue(p.lines, p.freight); const v = buy.poValue(x.lines, x.freight);
    const up = x.lines.filter((l) => { const o = p.lines.find((y) => y.sku === l.sku); return !o || buy.unitRate(l) > buy.unitRate(o) + 0.004; })
      .map((l) => { const o = p.lines.find((y) => y.sku === l.sku); return o ? `${l.sku} ${rs(buy.unitRate(o))} to ${rs(buy.unitRate(l))}` : `new line ${l.sku} at ${rs(buy.unitRate(l))}`; });
    const others = await othersToSupplier(q, p.supplier_id, p.po_id);
    const rule = await approvals.rule(q, 'po');
    const sup = await buy.supplierOf(q, p.supplier_id);
    const credited = new Map(p.lines.map((l) => [l.sku, l.credited]));
    const rev = p.rev + 1;
    if ((v > oldV && engine.needs(rule, { amount: v + others }).needs) || (up.length && rule.is_on)) {
      const aid = await approvals.request(q, { kind: 'po', godownId: p.godown_id, refType: 'purchase_order', refId: p.po_no, amount: v,
        summary: `PO ${p.po_no} Rev ${rev} to ${sup.name}: ${rs0(oldV)} to ${rs0(v)}${up.length ? `. Rate up: ${up.join(', ')}` : ''}`, payload: { t: 'amend', po_id: p.po_id, rev } }, by(req));
      await q.query('INSERT INTO po_amendments (po_id, rev, rev_lines, freight, expected_on, terms, approval_id, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [p.po_id, rev, JSON.stringify(x.lines), x.freight, x.expected, x.terms, aid, by(req)]);
      await audit(q, { empId: by(req), action: 'update', entity: 'purchase_order', entityId: p.po_no, before: { rev: p.rev, value: oldV }, after: { rev, value: v, waiting: true } });
      return { waiting: true, message: `${up.length ? `A rate went up (${up.join(', ')})` : `The value went up to ${rs0(v)}${others ? ` (with ${rs0(others)} of other orders to this supplier in the last ${(await approvals.splitFrom(q)).days} days)` : ''}`}, so it waits for approval again. If it is rejected, Rev ${p.rev} stays in force. ${await waitLine(q, aid)}` };
    }
    await q.query('INSERT INTO po_revisions (po_id, rev, kind, rev_lines, freight, expected_on, terms, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [p.po_id, p.rev, 'old', JSON.stringify(p.lines), p.freight, p.expected_on, p.terms, by(req)]);
    await writeLines(q, p.po_id, x.lines.map((l) => ({ ...l, credited: credited.get(l.sku) || 0 })));
    await q.query('UPDATE purchase_orders SET rev = ?, freight = ?, expected_on = ?, terms = ? WHERE po_id = ?', [rev, x.freight, x.expected, x.terms, p.po_id]);
    await audit(q, { empId: by(req), action: 'update', entity: 'purchase_order', entityId: p.po_no, before: { rev: p.rev, value: oldV }, after: { rev, value: v } });
    return { message: `Rev ${rev} is ready to print or mail. Rev ${p.rev} stays in the history.` };
  })), G);
  // cancel (nothing came in) or close short (the rest will not come): a reason, the Cancel right, and a confirmation
  route('post', '/buying/pos/:id/end', 'buying:cancel', wrap(async (req) => tx(async (q) => {
    const p = await buy.poOf(q, req.params.id, true);
    if (!p) throw new InputError('No such purchase order', 404);
    sees(req, p.godown_id); works(req, p.godown_id);
    const kind = (req.body || {}).kind === 'close' ? 'closed' : 'cancelled';
    const why = String((req.body || {}).reason || '').trim().slice(0, 120);
    if (!why) buy.bad({ reason: 'Give a reason.' });
    const st = await buy.poState(q, p);
    if (!['open', 'part', 'waiting'].includes(st)) throw new InputError(`It is ${PO_ST[st].toLowerCase()} already.`, 409);
    const [[gi]] = await q.query("SELECT COUNT(*) AS n FROM goods_ins WHERE po_id = ? AND status <> 'rejected'", [p.po_id]);
    if (kind === 'cancelled' && Number(gi.n)) throw new InputError('Goods have come in against it. Close it short instead.', 409);
    if (kind === 'closed' && !Number(gi.n)) throw new InputError('Nothing has come in yet. Cancel it instead.', 409);
    await q.query('UPDATE purchase_orders SET status = ?, end_by = ?, end_reason = ?, ended_at = UTC_TIMESTAMP() WHERE po_id = ?', [kind, by(req), why, p.po_id]);
    const [waits] = await q.query("SELECT approval_id FROM approvals WHERE kind = 'po' AND status = 'pending' AND ref_type = 'purchase_order' AND ref_id = ?", [p.po_no]);
    for (const w of waits) await q.query("UPDATE approvals SET status = 'withdrawn', decided_by = ?, decided_at = UTC_TIMESTAMP(), note = ? WHERE approval_id = ?", [by(req), `Order ${kind}: ${why}`.slice(0, 500), w.approval_id]);
    await q.query('DELETE FROM po_amendments WHERE po_id = ?', [p.po_id]);
    await audit(q, { empId: by(req), action: kind === 'closed' ? 'close' : 'cancel', entity: 'purchase_order', entityId: p.po_no, before: { status: st }, after: { status: kind, reason: why } });
    return { message: `${p.po_no}: ${why}` };
  })), G);

  // the request engine decides a PO or an amendment
  approvals.onApproved('po', async (q, p, empId) => {
    const po = await buy.poOf(q, p.po_id, true);
    if (!po) return;
    if (p.t === 'po') {
      if (po.status !== 'waiting') return;
      await q.query("UPDATE purchase_orders SET status = 'open', approved_by = ?, sent_at = UTC_TIMESTAMP() WHERE po_id = ?", [empId, po.po_id]);
      await audit(q, { empId, action: 'approve', entity: 'purchase_order', entityId: po.po_no, before: { status: 'waiting' }, after: { status: 'open', sent: true } });
      return;
    }
    const [[am]] = await q.query('SELECT rev, rev_lines, freight, DATE_FORMAT(expected_on, \'%Y-%m-%d\') AS expected_on, terms FROM po_amendments WHERE po_id = ?', [po.po_id]);
    if (!am) return;
    const lines = typeof am.rev_lines === 'string' ? JSON.parse(am.rev_lines) : am.rev_lines;
    const credited = new Map(po.lines.map((l) => [l.sku, l.credited]));
    await q.query('INSERT INTO po_revisions (po_id, rev, kind, rev_lines, freight, expected_on, terms, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [po.po_id, po.rev, 'old', JSON.stringify(po.lines), po.freight, po.expected_on, po.terms, empId]);
    await writeLines(q, po.po_id, lines.map((l) => ({ ...l, credited: credited.get(l.sku) || 0 })));
    await q.query('UPDATE purchase_orders SET rev = ?, freight = ?, expected_on = ?, terms = ?, approved_by = ? WHERE po_id = ?', [am.rev, am.freight, am.expected_on, am.terms, empId, po.po_id]);
    await q.query('DELETE FROM po_amendments WHERE po_id = ?', [po.po_id]);
    await audit(q, { empId, action: 'approve', entity: 'purchase_order', entityId: po.po_no, before: { rev: po.rev }, after: { rev: am.rev } });
  });
  approvals.onClosed('po', async (q, p, status, empId) => {
    if (status === 'expired') return; // it can be sent again (onAgain); the PO stays as it is
    const po = await buy.poOf(q, p.po_id, true);
    if (!po) return;
    if (p.t === 'po') {
      if (po.status !== 'waiting') return;
      await q.query("UPDATE purchase_orders SET status = 'rejected', end_by = ?, ended_at = UTC_TIMESTAMP() WHERE po_id = ?", [empId, po.po_id]);
      if (po.indent_id) await q.query("UPDATE indents SET status = 'approved', po_id = NULL WHERE indent_id = ? AND po_id = ?", [po.indent_id, po.po_id]);
      await audit(q, { empId, action: 'reject', entity: 'purchase_order', entityId: po.po_no, before: { status: 'waiting' }, after: { status: 'rejected' } });
      return;
    }
    // v23: a rejected amendment stays in the history; the approved revision (with its terms) stays in force
    const [[am]] = await q.query('SELECT rev, rev_lines, freight, DATE_FORMAT(expected_on, \'%Y-%m-%d\') AS expected_on, terms FROM po_amendments WHERE po_id = ?', [po.po_id]);
    if (!am) return;
    await q.query('INSERT INTO po_revisions (po_id, rev, kind, rev_lines, freight, expected_on, terms, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [po.po_id, am.rev, 'rejected', typeof am.rev_lines === 'string' ? am.rev_lines : JSON.stringify(am.rev_lines), am.freight, am.expected_on, am.terms, empId]);
    await q.query('DELETE FROM po_amendments WHERE po_id = ?', [po.po_id]);
    await audit(q, { empId, action: 'reject', entity: 'purchase_order', entityId: po.po_no, before: { amendment: `Rev ${am.rev}` }, after: { rev: po.rev, still: 'open' } });
  });
  approvals.onRecheck('po', async (q, p) => {
    const po = await buy.poOf(q, p.po_id);
    if (!po) return 'The purchase order is gone.';
    if (['cancelled', 'closed'].includes(po.status)) return `${po.po_no} is ${po.status} now.`;
    const sup = await buy.supplierOf(q, po.supplier_id);
    if (p.t === 'po' && sup.status !== 'active') return `${sup.name} is ${SUP_ST[sup.status].toLowerCase()} now.`;
    return '';
  });
  approvals.onAgain('po', async () => '');

  // print and mail
  async function poPrint(q, p) {
    const sup = await buy.supplierOf(q, p.supplier_id); const g = await buy.godownOf(q, p.godown_id);
    const [contacts] = await q.query('SELECT name, phone, email FROM supplier_contacts WHERE supplier_id = ? ORDER BY pos', [sup.supplier_id]);
    const its = await buy.items(q, p.lines.map((l) => l.sku));
    const rates = await buy.gstRates(q, its, p.po_date || buy.today());
    const [their] = await q.query('SELECT sku_code, their_code FROM supplier_items WHERE supplier_id = ?', [sup.supplier_id]);
    const t = buy.totals(p.lines.map((l) => ({ ...l, gst: rates.get(l.sku) })), p.freight, { registered: Boolean(sup.gstin), inter: buy.interState(sup, g) });
    return { p, sup, g, contact: contacts[0] || {}, email: (contacts.find((c) => c.email) || {}).email || null, t,
      lines: p.lines.map((l) => { const it = its.get(l.sku) || {}; return { sku: l.sku, name: it.name, hsn: it.hsn, their: (their.find((x) => x.sku_code === l.sku) || {}).their_code || '-', qty_text: buy.qtyText(it, l.qty), rate: l.rate, disc: l.disc, gst: sup.gstin ? rates.get(l.sku) : null, amount: buy.lineVal(l) }; }) };
  }
  route('get', '/buying/pos/:id/print', 'buying:view', wrap(async (req) => {
    if (!seeBuy(req)) throw new InputError('A purchase order shows purchase rates: See cost or Buying Edit is needed to print it.', 403);
    const p = await buy.poOf(db, req.params.id);
    if (!p || !p.po_no) throw new InputError('No such purchase order', 404);
    sees(req, p.godown_id);
    const d = await poPrint(db, p);
    return { po_no: p.po_no, rev: p.rev, po_date: p.po_date, expected_on: p.expected_on, terms: p.terms, godown: { name: d.g.name, address: [d.g.address, d.g.city].filter(Boolean).join(', ') },
      supplier: { name: d.sup.name, address: [d.sup.addr_l1, d.sup.addr_l2, `${d.sup.city || ''}${d.sup.pin ? ` - ${d.sup.pin}` : ''}`, stateName(d.sup.state_code)].filter(Boolean).join(', '), gstin: d.sup.gstin, terms_days: d.sup.terms_days },
      contact: d.contact, email: d.email, lines: d.lines, totals: d.t };
  }), G);
  route('get', '/buying/pos/:id/pdf', 'buying:view', wrap(async (req, res) => {
    if (!seeBuy(req)) throw new InputError('A purchase order shows purchase rates: See cost or Buying Edit is needed.', 403);
    const p = await buy.poOf(db, req.params.id);
    if (!p || !p.po_no) throw new InputError('No such purchase order', 404);
    sees(req, p.godown_id);
    const f = await poPdf(db, p.po_id);
    res.set('Content-Type', 'application/pdf').set('Content-Disposition', `inline; filename="${f.filename}"`).send(f.buffer);
  }), G);
  route('post', '/buying/pos/:id/mail', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const p = await buy.poOf(q, req.params.id);
    if (!p || !p.po_no) throw new InputError('No such purchase order', 404);
    sees(req, p.godown_id);
    if (!['open'].includes(p.status)) throw new InputError('Only an order sent to the supplier (approved) can be mailed.', 409);
    const d = await poPrint(q, p);
    if (!d.email) throw new InputError(`Add an e-mail for a contact of ${d.sup.name} first.`, 409);
    const mailer = require('./mailer');
    const subject = `Purchase order ${p.po_no}${p.rev > 1 ? ` (Rev ${p.rev})` : ''} from dFresh`;
    const text = `Dear ${d.contact.name || d.sup.name},\n\nPlease find our purchase order ${p.po_no} attached. Deliver by ${p.expected_on} to our ${d.g.name}. Quote this PO number on your challan and bill.\n\ndFresh (Dolluz Corporation)`;
    const html = mailer.shell({ title: subject, body: `<p style="margin:0 0 12px">Dear ${mailer.esc(d.contact.name || d.sup.name)},</p><p style="margin:0 0 12px">Please find our purchase order <b>${mailer.esc(p.po_no)}</b> attached. Deliver by ${mailer.esc(p.expected_on)} to our ${mailer.esc(d.g.name)}. Quote this PO number on your challan and bill.</p><p style="margin:0">dFresh (Dolluz Corporation)</p>` });
    await q.query('INSERT INTO mail_outbox (to_email, subject, html_body, text_body, attachments, purpose, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [d.email, subject, html, text, JSON.stringify([{ kind: 'po', id: p.po_id }]), 'po_sent']);
    await audit(q, { empId: by(req), action: 'mail', entity: 'purchase_order', entityId: p.po_no, after: { to: d.email } });
    return { message: `Queued in the mail outbox to ${d.email} with ${p.po_no} as a PDF.` };
  })), G);

  // ============================================================================================ goods in
  async function grnView(q, req, g, full = false) {
    const [lines] = await q.query(`SELECT line_id, sku_code, ordered, recv, cartons, reels, batch_id, batch_no, DATE_FORMAT(mfg_date, '%Y-%m-%d') AS mfg_date, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date,
        rate, acc, rej, reason, gsm, deviation, unit_cost, avg_before, avg_after FROM goods_in_lines WHERE grn_id = ? ORDER BY line_id`, [g.grn_id]);
    const its = await buy.items(q, lines.map((l) => l.sku_code));
    const [[sup]] = await q.query('SELECT supplier_id, code, name, status FROM suppliers WHERE supplier_id = ?', [g.supplier_id]);
    const [[po]] = g.po_id ? await q.query('SELECT po_no FROM purchase_orders WHERE po_id = ?', [g.po_id]) : [[null]];
    const out = { grn_id: g.grn_id, grn_no: g.grn_no, godown_id: g.godown_id, godown: g.godown, supplier: sup, po_id: g.po_id, po_no: po ? po.po_no : null, challan_no: g.challan_no, vehicle_no: g.vehicle_no,
      received_on: g.received_on, status: g.status, status_label: GI_ST[g.status], created_at: g.created_at,
      items_text: lines.length ? `${(its.get(lines[0].sku_code) || {}).name || lines[0].sku_code}${lines.length > 1 ? ` +${lines.length - 1} more` : ''}` : '',
      qty_text: lines.map((l) => buy.qtyText(its.get(l.sku_code), l.recv)).join(', '), acc: lines.reduce((a, l) => a + Number(l.acc || 0), 0), rej: lines.reduce((a, l) => a + Number(l.rej || 0), 0) };
    if (!full) return out;
    const names = await namesOf(q, [g.emp_id, g.qc_by]);
    const st = await buy.settings(q);
    const left = g.status === 'done' && g.qc_at ? st.claimDays - buy.dayDiff(buy.ymd(new Date(new Date(g.qc_at).getTime() + 5.5 * 3600e3)), buy.today()) : -1;
    return { ...out, why: g.why, waiting: g.status === 'waiting' && g.approval_id ? await waitLine(q, g.approval_id) : null, taken_by: nm(names, g.emp_id), qc_by: g.qc_by ? nm(names, g.qc_by) : null, qc_at: g.qc_at, qc_note: g.qc_note,
      lines: lines.map((l) => { const it = its.get(l.sku_code) || {}; return { sku_code: l.sku_code, name: it.name, unit: it.unit, recv: l.recv, recv_text: buy.qtyText(it, l.recv), cartons: l.cartons, reels: l.reels, batch_no: l.batch_no,
        mfg_date: l.mfg_date, expiry_date: l.expiry_date, acc: l.acc, rej: l.rej, acc_text: l.acc === null ? null : buy.qtyText(it, l.acc), rej_text: l.rej ? buy.qtyText(it, l.rej) : null, reason: l.reason, gsm: l.gsm === null ? null : Number(l.gsm),
        deviation: l.deviation, rate: hide(req, l.rate === null ? null : Number(l.rate)), unit_cost: hide(req, l.unit_cost === null ? null : Number(l.unit_cost)), avg_before: hide(req, l.avg_before === null ? null : Number(l.avg_before)), avg_after: hide(req, l.avg_after === null ? null : Number(l.avg_after)) }; }),
      claim: left >= 0 && canDo(req, 'buying', 'edit') ? { days_left: left, days: st.claimDays, lines: lines.filter((l) => Number(l.acc) > 0).map((l) => ({ sku_code: l.sku_code, acc: l.acc })) } : null,
      can: { qc: g.status === 'qc' && canDo(req, 'buying', 'edit') && godowns.covers(req.admin, g.godown_id) } };
  }
  const grnRow = async (q, where, params) => {
    const [rows] = await q.query(`SELECT g.grn_id, g.grn_no, g.godown_id, l.name AS godown, g.supplier_id, g.po_id, g.challan_no, g.vehicle_no, DATE_FORMAT(g.received_on, '%Y-%m-%d') AS received_on, g.status, g.approval_id,
        g.why, g.qc_by, g.qc_at, g.qc_note, g.emp_id, g.created_at FROM goods_ins g JOIN locations l ON l.location_id = g.godown_id WHERE ${where} ORDER BY g.grn_id DESC`, params);
    return rows;
  };
  const GI_TABS = { waiting: 'waiting', qc: 'qc', done: 'done', rejected: 'rejected' };
  route('get', '/buying/goods-in', 'buying:view', wrap(async (req) => {
    const [gw, gp] = godowns.where('g.godown_id', scope(req));
    const rows = await grnRow(db, gw, gp);
    const tab = GI_TABS[req.query.tab] || 'qc';
    const out = [];
    for (const g of rows.filter((x) => x.status === tab)) out.push(await grnView(db, req, g));
    const ex = await approvals.rule(db, 'excess_in');
    return { counts: Object.fromEntries(Object.keys(GI_TABS).map((k) => [k, rows.filter((x) => x.status === k).length])), rows: out, tolerance: ex.is_on ? ex.limit_value : null,
      quarantine: (await buy.settings(db)).quarantine, can: { create: canDo(req, 'buying', 'create') } };
  }), G);
  route('get', '/buying/goods-in/:id', 'buying:view', wrap(async (req) => {
    const [g] = await grnRow(db, 'g.grn_id = ?', [Number(req.params.id)]);
    if (!g) throw new InputError('No such goods in', 404);
    sees(req, g.godown_id);
    return grnView(db, req, g, true);
  }), G);
  // the POs goods can come in against (open, part received, or with an amendment waiting: the approved revision counts)
  route('get', '/buying/goods-in-form', 'buying:create', wrap(async (req) => {
    const [gw, gp] = godowns.where('godown_id', godowns.scopeOf(req.admin));
    const [ids] = await db.query(`SELECT po_id FROM purchase_orders WHERE status = 'open' AND ${gw} ORDER BY po_id`, gp);
    const pos = [];
    for (const r of ids) {
      const p = await buy.poOf(db, r.po_id); const st = await buy.poState(db, p);
      if (st === 'received') continue;
      const sup = await buy.supplierOf(db, p.supplier_id); const g = await buy.godownOf(db, p.godown_id);
      pos.push({ po_id: p.po_id, po_no: p.po_no, supplier: sup.name, godown: g.name, godown_id: g.godown_id });
    }
    let lines = [];
    if (req.query.po) {
      const p = await buy.poOf(db, req.query.po);
      if (!p || p.status !== 'open') throw new InputError('Choose an open purchase order.', 409);
      godowns.assertWorks(req.admin, p.godown_id);
      const got = await buy.received(db, p.po_id);
      const its = await buy.items(db, p.lines.map((l) => l.sku));
      lines = p.lines.filter((l) => buy.openOf(l, got) > 0).map((l) => { const it = its.get(l.sku) || {}; return { sku_code: l.sku, name: it.name, unit: it.unit, per_carton: it.per_carton, track: it.track, life: it.life, needs_batch: it.track || it.type === 'raw',
        ordered: l.qty, open: buy.openOf(l, got), ordered_text: buy.qtyText(it, l.qty), open_text: buy.qtyText(it, buy.openOf(l, got)), reels: it.unit === 'kg' }; });
    }
    const ex = await approvals.rule(db, 'excess_in');
    return { pos, lines, tolerance: ex.is_on ? ex.limit_value : null, quarantine: (await buy.settings(db)).quarantine, today: buy.today() };
  }), G);
  // a scan in the goods in form: a carton barcode adds one carton; anything else finds the line
  route('post', '/buying/scan', 'buying:create', wrap(async (req) => {
    const hit = await catalogue.resolve(db, (req.body || {}).code);
    if (!hit || hit.unknown || hit.bad) return { found: false, message: `${(req.body || {}).code} is not a known barcode.` };
    return { found: true, sku_code: hit.sku, kind: hit.kind, packs: hit.packs };
  }), G);
  route('post', '/buying/goods-in', 'buying:create', wrap(async (req) => tx(async (q) => {
    const b = req.body || {};
    const e = {};
    const p = b.po_id ? await buy.poOf(q, b.po_id, true) : null;
    if (b.po_id && (!p || p.status !== 'open')) throw new InputError('That purchase order is not open.', 409);
    let supId; let gid;
    if (p) { supId = p.supplier_id; gid = p.godown_id; works(req, gid); } else {
      supId = Number(b.supplier_id);
      const sup = supId ? await buy.supplierOf(q, supId) : null;
      if (!sup || sup.status !== 'active') e.supplier_id = 'Choose the supplier.';
      try { gid = await godowns.resolve(q, req, b.godown_id); } catch { e.godown_id = 'Choose the godown.'; }
    }
    const ch = String(b.challan_no || '').trim().slice(0, 30);
    if (!ch) e.challan_no = 'The number on their challan or bill.';
    else if (supId) {
      const [[d]] = await q.query("SELECT grn_no FROM goods_ins WHERE supplier_id = ? AND status <> 'rejected' AND LOWER(challan_no) = LOWER(?)", [supId, ch]);
      if (d) e.challan_no = `Already taken in from this supplier (${d.grn_no}). The same challan cannot come in twice.`;
    }
    const veh = String(b.vehicle_no || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (veh && !rules.vehicleOk(veh)) e.vehicle_no = 'Like TN 21 AX 4402.';
    const raw = Array.isArray(b.lines) ? b.lines : [];
    const its = await buy.items(q, raw.map((l) => String(l.sku_code || '')).filter(Boolean));
    const got = p ? await buy.received(q, p.po_id) : new Map();
    const cs = await require('./commerce-settings').read(q);
    const td = buy.today();
    const lines = []; const over = []; let overVal = 0; const near = [];
    const ex = await approvals.rule(q, 'excess_in');
    raw.forEach((l, i) => {
      const sku = String(l.sku_code || ''); const it = its.get(sku);
      const qs = String(l.recv ?? '').trim();
      if (!it || !it.buyable) { e[`lines.${i}.sku_code`] = 'Choose the item.'; return; }
      if (qs === '' || Number(qs) === 0) { if (!p && qs === '') e[`lines.${i}.recv`] = 'How many came, or remove the row.'; return; }
      if (!whole(qs, 1)) { e[`lines.${i}.recv`] = 'A whole number.'; return; }
      const n = Number(qs);
      const x = { sku, recv: n, cartons: whole(l.cartons, 1) ? Number(l.cartons) : null, reels: whole(l.reels, 1) ? Number(l.reels) : null, batch_no: String(l.batch_no || '').trim().toUpperCase().slice(0, 30) || null, mfg: null, exp: null, ordered: null, rate: null, track: it.track };
      if ((it.track || it.type === 'raw') && !x.batch_no) e[`lines.${i}.batch_no`] = 'This item is tracked by batch.';
      if (x.batch_no && !/^[A-Z0-9][A-Z0-9/-]{0,29}$/.test(x.batch_no)) e[`lines.${i}.batch_no`] = 'Letters, digits, - or /.';
      if (it.track) {
        const mfg = String(l.mfg_date || '');
        if (it.life > 0) {
          if (!isDay(mfg)) e[`lines.${i}.mfg_date`] = 'The date it was made.';
          else if (mfg > td) e[`lines.${i}.mfg_date`] = 'Cannot be in the future.';
          else {
            x.mfg = mfg; x.exp = buy.addMonths(mfg, it.life);
            if (x.exp <= td) e[`lines.${i}.mfg_date`] = `Made on ${mfg} with ${it.life} months shelf life: expired on ${x.exp}. Refuse it at the gate.`;
            else { const left = buy.dayDiff(td, x.exp); const win = it.near ?? Number(cs.expiry_warn_days) ?? 60; if (left < win) near.push(`${sku} expires in ${left} days (near expiry is ${win}).`); }
          }
        } else {
          const exp = String(l.expiry_date || '');
          if (!isDay(mfg) || mfg > td) e[`lines.${i}.mfg_date`] = 'The date it was made (today or earlier).';
          if (!isDay(exp) || exp <= td) e[`lines.${i}.expiry_date`] = 'The expiry date, after today.';
          x.mfg = mfg; x.exp = exp;
        }
      }
      if (p) {
        const pl = p.lines.find((y) => y.sku === sku);
        if (!pl) { e[`lines.${i}.sku_code`] = `${sku} is not on ${p.po_no}.`; return; }
        const open = buy.openOf(pl, got); x.ordered = pl.qty;
        if (n > open) { const pct = open ? Math.round(((n - open) / open) * 1000) / 10 : 100; if (engine.needs(ex, { pct }).needs) { over.push(`${sku}: ${n} against ${open} open (+${pct}%)`); overVal += (n - open) * pl.rate; } }
      } else {
        const rt = String(l.rate ?? '').trim();
        if (!(Number(rt) > 0)) e[`lines.${i}.rate`] = 'The rate on their paper.'; else x.rate = r2(rt);
      }
      lines.push(x);
    });
    if (!lines.length && !Object.keys(e).length) throw new InputError('Nothing received. Type a count, or scan a carton.');
    if (Object.keys(e).length) buy.bad(e);
    await books.assertOpen(q, td);
    const no = await numbering.issue(q, 'grn', gid);
    const [ins] = await q.query('INSERT INTO goods_ins (grn_no, godown_id, supplier_id, po_id, challan_no, vehicle_no, received_on, status, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [no, gid, supId, p ? p.po_id : null, ch, veh || null, td, 'qc', by(req)]);
    const grnId = ins.insertId;
    for (const x of lines) {
      let batchId = null;
      if (x.track && x.batch_no) {
        const [[bt]] = await q.query("SELECT batch_id, DATE_FORMAT(mfg_date, '%Y-%m-%d') AS mfg, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS exp FROM batches WHERE sku_code = ? AND batch_no = ?", [x.sku, x.batch_no]);
        if (bt && (bt.mfg !== x.mfg || bt.exp !== x.exp)) throw new InputError(`${x.sku} batch ${x.batch_no} exists already with other dates (made ${bt.mfg}, expires ${bt.exp})`, 409);
        batchId = bt ? bt.batch_id : (await q.query('INSERT INTO batches (sku_code, batch_no, mfg_date, expiry_date, created_by) VALUES (?, ?, ?, ?, ?)', [x.sku, x.batch_no, x.mfg, x.exp, by(req)]))[0].insertId;
      }
      x.batch_id = batchId;
      await q.query('INSERT INTO goods_in_lines (grn_id, sku_code, ordered, recv, cartons, reels, batch_id, batch_no, mfg_date, expiry_date, rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [grnId, x.sku, x.ordered, x.recv, x.cartons, x.reels, batchId, x.batch_no, x.mfg, x.exp, x.rate]);
    }
    const supName = (await buy.supplierOf(q, supId)).name;
    let kind = null; let why = null; let amount = 0;
    if (!p && (await approvals.needed(q, 'no_po_in', {}))) { kind = 'no_po_in'; why = 'No purchase order.'; amount = lines.reduce((a, x) => a + x.recv * x.rate, 0); }
    else if (over.length) { kind = 'excess_in'; why = `More than the order: ${over.join('; ')}.`; amount = overVal; }
    let msg;
    if (kind) {
      const aid = await approvals.request(q, { kind, godownId: gid, refType: 'goods_in', refId: no, amount: r2(amount), summary: `Goods in ${no} from ${supName}: ${why}`, payload: { t: 'grn', grn_id: grnId } }, by(req));
      await q.query("UPDATE goods_ins SET status = 'waiting', approval_id = ?, why = ? WHERE grn_id = ?", [aid, why, grnId]);
      msg = `${why} ${await waitLine(q, aid)} Nothing goes into stock until then.`;
    } else msg = await takeIn(q, grnId, by(req));
    if (near.length) msg += ` Note: ${near.join(' ')}`;
    await audit(q, { empId: by(req), action: 'create', entity: 'goods_in', entityId: no, after: { po: p ? p.po_no : null, challan: ch, lines: lines.map((x) => `${x.sku} ${x.recv}`), waiting: Boolean(kind) } });
    return { grn_id: grnId, grn_no: no, waiting: Boolean(kind), message: msg };
  })), { ...G, status: 201 });
  /** into QC hold; with QC hold switched off, passed at once (at landed cost) -> the message */
  async function takeIn(q, grnId, empId) {
    const [[g]] = await q.query('SELECT grn_id, grn_no, godown_id FROM goods_ins WHERE grn_id = ?', [grnId]);
    const [lines] = await q.query('SELECT sku_code, recv, batch_id FROM goods_in_lines WHERE grn_id = ? ORDER BY line_id', [grnId]);
    for (const l of lines) await stock.moveStock(q, { sku: l.sku_code, godown: g.godown_id, shelf: 'hold', qty: l.recv, batch: l.batch_id, doc: { type: 'goods_in', id: g.grn_no }, what: 'grn_hold', note: 'Goods in, QC hold' }, empId);
    await q.query("UPDATE goods_ins SET status = 'qc' WHERE grn_id = ?", [grnId]);
    const gd = await buy.godownOf(q, g.godown_id);
    if ((await buy.settings(q)).quarantine) return `In QC hold at ${gd.name}. It cannot be sold or used until Quality check passes it.`;
    const r = await buy.passQc(q, grnId, null, empId, { auto: true });
    return `QC hold is switched off, so it is in stock now.${r.moved.length ? ` ${r.moved.map((m) => `${m.sku} average cost ${m.before === null ? 'none' : rs(m.before)} to ${rs(m.after)}`).join('; ')}.` : ''}`;
  }
  for (const kind of ['excess_in', 'no_po_in']) {
    approvals.onApproved(kind, async (q, p, empId) => {
      const [[g]] = await q.query('SELECT grn_id, status FROM goods_ins WHERE grn_id = ? FOR UPDATE', [p.grn_id]);
      if (!g || g.status !== 'waiting') return;
      await takeIn(q, g.grn_id, empId);
      await audit(q, { empId, action: 'approve', entity: 'goods_in', entityId: String(g.grn_id), after: { taken_in: true } });
    });
    approvals.onClosed(kind, async (q, p, status, empId) => {
      if (status === 'expired') return;
      const [[g]] = await q.query('SELECT grn_id, grn_no, status FROM goods_ins WHERE grn_id = ? FOR UPDATE', [p.grn_id]);
      if (!g || g.status !== 'waiting') return;
      await q.query("UPDATE goods_ins SET status = 'rejected' WHERE grn_id = ?", [g.grn_id]);
      await audit(q, { empId, action: 'reject', entity: 'goods_in', entityId: g.grn_no, after: { status: 'not taken in' } });
    });
    approvals.onRecheck(kind, async (q, p) => {
      const [[g]] = await q.query('SELECT po_id, status FROM goods_ins WHERE grn_id = ?', [p.grn_id]);
      if (!g || g.status !== 'waiting') return 'It is no longer waiting.';
      if (g.po_id) { const [[po]] = await q.query('SELECT status, po_no FROM purchase_orders WHERE po_id = ?', [g.po_id]); if (po && po.status !== 'open') return `${po.po_no} is ${po.status} now.`; }
      return '';
    });
    approvals.onAgain(kind, async () => '');
  }

  // ============================================================================================ quality check
  route('get', '/buying/qc', 'buying:view', wrap(async (req) => {
    const [gw, gp] = godowns.where('g.godown_id', scope(req));
    const waiting = await grnRow(db, `g.status = 'qc' AND ${gw}`, gp);
    const done = (await grnRow(db, `g.status = 'done' AND g.qc_by <> 'auto' AND ${gw}`, gp)).slice(0, 5);
    const w = []; for (const g of waiting.reverse()) w.push(await grnView(db, req, g));
    const names = await namesOf(db, done.map((g) => g.qc_by));
    const d = []; for (const g of done) d.push({ ...(await grnView(db, req, g)), qc_by: nm(names, g.qc_by), qc_at: g.qc_at });
    return { waiting: w, done: d, quarantine: (await buy.settings(db)).quarantine, can: { edit: canDo(req, 'buying', 'edit') } };
  }), G);
  route('get', '/buying/goods-in/:id/qc', 'buying:edit', wrap(async (req) => {
    const [g] = await grnRow(db, 'g.grn_id = ?', [Number(req.params.id)]);
    if (!g || g.status !== 'qc') throw new InputError('Nothing to check: it is not in QC hold.', 409);
    sees(req, g.godown_id); works(req, g.godown_id);
    const v = await grnView(db, req, g, true);
    const [specs] = await db.query('SELECT sku_code, spec_gsm, spec_ply, spec_width FROM supplier_items WHERE supplier_id = ? AND spec_gsm IS NOT NULL', [g.supplier_id]);
    return { ...v, lines: v.lines.map((l) => { const s = specs.find((x) => x.sku_code === l.sku_code); return { ...l, spec: s ? { gsm: Number(s.spec_gsm), ply: s.spec_ply, width: s.spec_width } : null }; }), reasons: rules.QC_REASONS };
  }), G);
  route('post', '/buying/goods-in/:id/qc', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const [[g]] = await q.query('SELECT grn_id, grn_no, godown_id, supplier_id, status FROM goods_ins WHERE grn_id = ? FOR UPDATE', [Number(req.params.id)]);
    if (!g) throw new InputError('No such goods in', 404);
    sees(req, g.godown_id); works(req, g.godown_id);
    if (g.status !== 'qc') throw new InputError('It is not in QC hold (checked already, or waiting for approval).', 409);
    const [lines] = await q.query('SELECT sku_code, recv FROM goods_in_lines WHERE grn_id = ? ORDER BY line_id', [g.grn_id]);
    const [specs] = await q.query('SELECT sku_code, spec_gsm FROM supplier_items WHERE supplier_id = ? AND spec_gsm IS NOT NULL', [g.supplier_id]);
    const b = req.body || {};
    const raw = Array.isArray(b.lines) ? b.lines : [];
    const e = {};
    const res = lines.map((l, i) => {
      const x = raw[i] || {};
      const a = String(x.acc ?? '').trim(); const r = String(x.rej ?? '').trim(); const w = String(x.reason || '').trim();
      if (!whole(a, 0)) e[`lines.${i}.acc`] = 'A whole number, 0 or more.';
      if (!whole(r, 0)) e[`lines.${i}.rej`] = 'A whole number, 0 or more.';
      if (whole(a, 0) && whole(r, 0) && Number(a) + Number(r) !== l.recv) e[`lines.${i}.acc`] = `Accepted + rejected must be ${l.recv}, what came in. Now ${Number(a) + Number(r)}.`;
      if (Number(r) > 0 && !rules.QC_REASONS.includes(w)) e[`lines.${i}.reason`] = 'Why it was rejected.';
      const sp = specs.find((s) => s.sku_code === l.sku_code);
      const gsm = String(x.gsm ?? '').trim(); const dev = String(x.deviation || '').trim().slice(0, 120);
      if (sp) {
        if (gsm === '' || !(Number(gsm) > 0)) e[`lines.${i}.gsm`] = 'Weigh a sample and type the GSM.';
        else if (Math.abs(Number(gsm) - Number(sp.spec_gsm)) > 1 && Number(a) > 0 && !dev) e[`lines.${i}.deviation`] = `GSM ${gsm} is outside ${Number(sp.spec_gsm)} +/- 1. Say why it is accepted, or reject it.`;
      }
      return { acc: Number(a), rej: Number(r), reason: Number(r) > 0 ? w : null, gsm: sp && gsm !== '' ? Number(gsm) : null, deviation: dev || null };
    });
    if (Object.keys(e).length) buy.bad(e);
    const note = String(b.note || '').trim().slice(0, 160) || null;
    const r = await buy.passQc(q, g.grn_id, res, by(req), { note });
    await audit(q, { empId: by(req), action: 'update', entity: 'quality_check', entityId: g.grn_no, before: { status: 'QC hold' },
      after: { accepted: r.moved.map((m) => `${m.sku} +${m.qty}`), rejected: res.filter((x) => x.rej).length ? lines.map((l, i) => (res[i].rej ? `${l.sku_code} ${res[i].rej}` : null)).filter(Boolean) : undefined, claim: r.claim ? r.claim.claim_no : undefined } });
    const moved = r.moved.map((m) => `${m.sku} +${m.qty}${seeBuy(req) ? ` (average cost ${m.before === null ? 'none' : rs(m.before)} to ${rs(m.after)})` : ''}`);
    return { claim: r.claim, message: `${moved.length ? `Into stock: ${moved.join('; ')}. ` : 'Nothing accepted. '}${r.claim ? `Rejected goods are set aside and claim ${r.claim.claim_no} is started in Claims and purchase returns.` : ''}`.trim() };
  })), G);
  // faulty goods found after QC passed them: a claim within the days of the switch (v21), never more than accepted, the
  // same batch, still on the Good shelf and not held (v22 B3)
  route('post', '/buying/goods-in/:id/late-claim', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const [[g]] = await q.query('SELECT grn_id, grn_no, godown_id, supplier_id, po_id, status, qc_at FROM goods_ins WHERE grn_id = ? FOR UPDATE', [Number(req.params.id)]);
    if (!g) throw new InputError('No such goods in', 404);
    sees(req, g.godown_id); works(req, g.godown_id);
    if (g.status !== 'done') throw new InputError('Only checked goods can be claimed after QC.', 409);
    const st = await buy.settings(q);
    const days = buy.dayDiff(buy.ymd(new Date(new Date(g.qc_at).getTime() + 5.5 * 3600e3)), buy.today());
    if (days > st.claimDays) throw new InputError(`Too late: more than ${st.claimDays} days since QC passed it.`, 409);
    const b = req.body || {};
    const [[l]] = await q.query('SELECT sku_code, acc, batch_id, batch_no FROM goods_in_lines WHERE grn_id = ? AND sku_code = ? AND acc > 0', [g.grn_id, String(b.sku_code || '')]);
    const why = String(b.reason || '').trim().slice(0, 80);
    const e = {};
    if (!l) e.sku_code = 'Choose the item.';
    let room = 0; let lateDone = 0;
    if (l) {
      const [[ld]] = await q.query('SELECT COALESCE(SUM(cl.qty), 0) AS n FROM claim_lines cl JOIN claims c ON c.claim_id = cl.claim_id WHERE c.grn_id = ? AND c.is_late = 1 AND cl.sku_code = ?', [g.grn_id, l.sku_code]);
      lateDone = Number(ld.n);
      const shelf = await stock.onShelf(q, { sku: l.sku_code, godown: g.godown_id, shelf: 'good', batch: l.batch_id || null });
      const av = (await stock.availability(q, [l.sku_code], 0, { godown: g.godown_id })).get(l.sku_code);
      room = Math.min(Number(l.acc) - lateDone, shelf, av ? av.available : shelf);
      if (!whole(b.qty, 1)) e.qty = 'A whole number, at least 1.';
      else if (Number(b.qty) > room) e.qty = `Only ${Math.max(0, room)} can go back: accepted on this goods in less what was claimed already (${lateDone}), still on the Good shelf${l.batch_no ? ` in batch ${l.batch_no}` : ''} and not held.`;
    }
    if (why.length < 3) e.reason = 'Say what is wrong.';
    if (Object.keys(e).length) buy.bad(e);
    const n = Number(b.qty);
    await stock.moveShelf(q, { sku: l.sku_code, godown: g.godown_id, from: 'good', to: 'rej', qty: n, batch: l.batch_id || null, doc: { type: 'goods_in', id: g.grn_no }, what: 'late_claim', note: why }, by(req));
    const p = g.po_id ? await buy.poOf(q, g.po_id) : null;
    const pl = p ? p.lines.find((x) => x.sku === l.sku_code) : null;
    const [[gl]] = await q.query('SELECT rate FROM goods_in_lines WHERE grn_id = ? AND sku_code = ? LIMIT 1', [g.grn_id, l.sku_code]);
    const c = await buy.newClaim(q, { supplierId: g.supplier_id, grnId: g.grn_id, poId: g.po_id, godownId: g.godown_id, outcome: 'credit', late: true,
      lines: [{ sku: l.sku_code, qty: n, rate: pl ? buy.unitRate(pl) : Number(gl.rate), reason: why, batch: l.batch_id }], note: `Found faulty after QC passed it (${days} days later). ${why}` }, by(req));
    await audit(q, { empId: by(req), action: 'create', entity: 'claim', entityId: c.claim_no, after: { goods_in: g.grn_no, late: true, line: `${l.sku_code} ${n}: ${why}` } });
    return { claim: c, message: `${c.claim_no} started: ${n} moved to Rejected, to go back. Issue the debit note from Claims and purchase returns.` };
  })), G);

  // ============================================================================================ supplier bills
  async function billView(q, req, b, full = false) {
    const [[sup]] = await q.query('SELECT supplier_id, code, name, msme_type, gstin, state_code, terms_days FROM suppliers WHERE supplier_id = ?', [b.supplier_id]);
    const [lines] = await q.query('SELECT l.line_no, l.grn_id, g.grn_no, l.sku_code, l.qty, l.rate, l.po_rate, l.gst_rate FROM supplier_bill_lines l JOIN goods_ins g ON g.grn_id = l.grn_id WHERE l.bill_id = ? ORDER BY l.line_no', [b.bill_id]);
    const open = ['unpaid', 'part'].includes(b.status);
    const d = buy.dayDiff(buy.today(), b.due_date);
    const out = { bill_id: b.bill_id, bill_no: b.bill_no, supplier_bill_no: b.supplier_bill_no, supplier: { supplier_id: sup.supplier_id, code: sup.code, name: sup.name, msme: sup.msme_type }, godown_id: b.godown_id,
      bill_date: b.bill_date, due_date: b.due_date, due_in: d, overdue: open && d < 0, status: b.status, status_label: BILL_ST[b.status], total: hide(req, Number(b.total)), paid: hide(req, Number(b.paid)),
      grns: [...new Set(lines.map((l) => l.grn_no))] };
    if (!full) return out;
    const its = await buy.items(q, lines.map((l) => l.sku_code));
    const t = buy.totals(lines.map((l) => ({ sku: l.sku_code, qty: l.qty, rate: Number(l.rate), disc: 0, gst: Number(l.gst_rate) })), b.freight, { registered: Boolean(sup.gstin), inter: Number(b.inter_state) === 1 });
    const names = await namesOf(q, [b.emp_id]);
    const [cr] = await q.query('SELECT ref, amount FROM bill_credits WHERE bill_id = ? ORDER BY credit_id', [b.bill_id]);
    const [pays] = await q.query("SELECT p.pay_no, pl.amount FROM supplier_payment_lines pl JOIN supplier_payments p ON p.pay_id = pl.pay_id WHERE pl.bill_id = ? AND p.status = 'paid'", [b.bill_id]);
    const [adj] = await q.query('SELECT sku_code, why, avg_before, avg_after, value_stock, value_cos FROM cost_adjustments WHERE src_type = ? AND src_id = ? ORDER BY adj_id', ['bill', b.bill_id]);
    return { ...out, freight: hide(req, Number(b.freight)), freight_sep: Number(b.freight_sep) === 1, round_off: hide(req, Number(b.round_off)), totals: seeBuy(req) ? { ...t, round: Number(b.round_off), total: Number(b.total) } : null,
      entered_by: nm(names, b.emp_id), created_at: b.created_at, waiting: b.status === 'waiting' && b.approval_id ? await waitLine(q, b.approval_id) : null,
      lines: lines.map((l) => { const it = its.get(l.sku_code) || {}; return { sku_code: l.sku_code, name: it.name, grn_no: l.grn_no, qty: l.qty, qty_text: buy.qtyText(it, l.qty), rate: hide(req, Number(l.rate)), po_rate: hide(req, l.po_rate === null ? null : Number(l.po_rate)),
        differs: l.po_rate !== null && Math.abs(Number(l.rate) - Number(l.po_rate)) > 0.004, amount: hide(req, r2(l.qty * Number(l.rate))), gst: Number(l.gst_rate) }; }),
      settled: seeBuy(req) ? [...pays.map((x) => ({ ref: x.pay_no, amount: Number(x.amount) })), ...cr.map((x) => ({ ref: x.ref, amount: Number(x.amount) }))] : [],
      cost: seeBuy(req) ? adj.map((a) => ({ sku: a.sku_code, why: a.why, before: a.avg_before === null ? null : Number(a.avg_before), after: a.avg_after === null ? null : Number(a.avg_after), stock: Number(a.value_stock), cos: Number(a.value_cos) })) : [] };
  }
  const billRows = async (q, where, params) => (await q.query(`SELECT bill_id, bill_no, supplier_bill_no, supplier_id, godown_id, DATE_FORMAT(bill_date, '%Y-%m-%d') AS bill_date, DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date,
      taxable, freight, gst, inter_state, round_off, total, paid, freight_sep, status, approval_id, emp_id, created_at FROM supplier_bills WHERE ${where} ORDER BY bill_id DESC`, params))[0];
  const BILL_TABS = { waiting: ['waiting'], unpaid: ['unpaid', 'part'], paid: ['paid'], rejected: ['rejected'] };
  route('get', '/buying/bills', 'buying:view', wrap(async (req) => {
    const [gw, gp] = godowns.where('godown_id', scope(req));
    const rows = await billRows(db, gw, gp);
    const tab = BILL_TABS[req.query.tab] ? req.query.tab : 'unpaid';
    const out = []; for (const b of rows.filter((x) => BILL_TABS[tab].includes(x.status))) out.push(await billView(db, req, b));
    const soon = [];
    for (const b of rows.filter((x) => ['unpaid', 'part'].includes(x.status))) {
      const [[s]] = await db.query('SELECT name, msme_type FROM suppliers WHERE supplier_id = ?', [b.supplier_id]);
      const d = buy.dayDiff(buy.today(), b.due_date);
      if (buy.msmeSmall(s) && d <= 7) soon.push({ supplier: s.name, bill: b.supplier_bill_no, left: hide(req, r2(b.total - b.paid)), due: b.due_date, days: d });
    }
    return { counts: Object.fromEntries(Object.entries(BILL_TABS).map(([k, v]) => [k, rows.filter((x) => v.includes(x.status)).length])), rows: out, msme_soon: soon, can: { edit: canDo(req, 'buying', 'edit') } };
  }), G);
  route('get', '/buying/bills/:id', 'buying:view', wrap(async (req) => {
    const [b] = await billRows(db, 'bill_id = ?', [Number(req.params.id)]);
    if (!b) throw new InputError('No such bill', 404);
    sees(req, b.godown_id);
    return billView(db, req, b, true);
  }), G);
  // a new bill: the checked goods of this supplier not billed yet, each with the approved PO rate
  route('get', '/buying/bill-form', 'buying:edit', wrap(async (req) => {
    const sup = await buy.supplierOf(db, req.query.supplier);
    if (!sup) return { supplier: null, lines: [] };
    const [gw, gp] = godowns.where('godown_id', godowns.scopeOf(req.admin));
    const [gs] = await db.query(`SELECT grn_id, grn_no, po_id, godown_id FROM goods_ins WHERE supplier_id = ? AND status = 'done' AND ${gw} ORDER BY grn_id`, [sup.supplier_id, ...gp]);
    const lines = [];
    for (const g of gs) {
      const p = g.po_id ? await buy.poOf(db, g.po_id) : null;
      for (const u of await buy.unbilled(db, g.grn_id)) {
        const it = (await buy.items(db, [u.sku])).get(u.sku) || {};
        const pl = p ? p.lines.find((x) => x.sku === u.sku) : null;
        const [[gl]] = await db.query('SELECT rate FROM goods_in_lines WHERE grn_id = ? AND sku_code = ? LIMIT 1', [g.grn_id, u.sku]);
        lines.push({ grn_id: g.grn_id, grn_no: g.grn_no, godown_id: g.godown_id, sku_code: u.sku, name: it.name, max: u.qty, max_text: buy.qtyText(it, u.qty), po_rate: pl ? buy.unitRate(pl) : null, rate: pl ? buy.unitRate(pl) : gl && gl.rate !== null ? Number(gl.rate) : null, no_po: !p });
      }
    }
    return { supplier: { supplier_id: sup.supplier_id, name: sup.name, terms_days: sup.terms_days, msme: sup.msme_type, registered: Boolean(sup.gstin) }, lines, today: buy.today() };
  }), G);
  /** read and check a bill -> { sup, lines, totals, raw, diff, dv, freight, ... } (throws field errors); check = preview only */
  async function readBill(q, req, b, check = false) {
    const sup = await buy.supplierOf(q, b.supplier_id);
    if (!sup) buy.bad({ supplier_id: 'Choose the supplier.' });
    const e = {};
    const no = String(b.supplier_bill_no || '').trim().slice(0, 30);
    const dt = String(b.bill_date || '');
    if (!check) {
      if (!no) e.supplier_bill_no = 'Their bill number.';
      else { const [[d]] = await q.query("SELECT bill_no FROM supplier_bills WHERE supplier_id = ? AND status <> 'rejected' AND LOWER(supplier_bill_no) = LOWER(?)", [sup.supplier_id, no]); if (d) e.supplier_bill_no = `${sup.name} bill ${no} is already entered (${d.bill_no}). The same bill twice would pay twice.`; }
      if (!isDay(dt)) e.bill_date = 'The date on the bill.'; else if (dt > buy.today()) e.bill_date = 'A bill cannot be dated in the future.'; else { const lw = await books.lockWhy(q, dt); if (lw) e.bill_date = lw; }
    }
    const day = isDay(dt) && dt <= buy.today() ? dt : buy.today();
    const fr = String(b.freight ?? '').trim();
    if (fr !== '' && !(Number(fr) >= 0)) e.freight = '0 or more.';
    const raw = Array.isArray(b.lines) ? b.lines : [];
    const lines = [];
    const its = await buy.items(q, raw.map((l) => String(l.sku_code || '')));
    const rates = await buy.gstRates(q, its, day);
    for (const [i, x] of raw.entries()) {
      const qs = String(x.qty ?? '').trim();
      if (qs === '' || Number(qs) === 0) continue;
      const [[g]] = await q.query('SELECT grn_id, grn_no, supplier_id, po_id, godown_id, status FROM goods_ins WHERE grn_id = ?', [Number(x.grn_id)]);
      if (!g || g.supplier_id !== sup.supplier_id || g.status !== 'done') { e[`lines.${i}.qty`] = 'Not a checked goods in of this supplier.'; continue; }
      godowns.assertWorks(req.admin, g.godown_id);
      const sku = String(x.sku_code || '');
      const max = (await buy.unbilled(q, g.grn_id)).filter((u) => u.sku === sku).reduce((a, u) => a + u.qty, 0) - lines.filter((l) => l.grn_id === g.grn_id && l.sku === sku).reduce((a, l) => a + l.qty, 0);
      if (!whole(qs, 1)) { e[`lines.${i}.qty`] = 'A whole number.'; continue; }
      if (Number(qs) > max) { e[`lines.${i}.qty`] = `Only ${max} accepted and not billed. Billing more than Quality check accepted is refused.`; continue; }
      if (!(Number(x.rate) > 0)) { e[`lines.${i}.rate`] = 'The rate on the bill.'; continue; }
      const p = g.po_id ? await buy.poOf(q, g.po_id) : null;
      const pl = p ? p.lines.find((y) => y.sku === sku) : null;
      const gst = sup.gstin ? rates.get(sku) : 0;
      if (gst === null || gst === undefined) { e[`lines.${i}.rate`] = `${sku} has no GST rate on ${day}: set its HSN code first.`; continue; }
      lines.push({ grn_id: g.grn_id, grn_no: g.grn_no, po_id: g.po_id, godown_id: g.godown_id, sku, qty: Number(qs), rate: r2(x.rate), po_rate: pl ? buy.unitRate(pl) : null, gst, disc: 0 });
    }
    if (!lines.length && !Object.keys(e).length && raw.length && !check) e['lines.0.qty'] = 'Bill at least one line.';
    let t = null; let raw2 = 0;
    if (lines.length) {
      const g0 = await buy.godownOf(q, lines[0].godown_id);
      t = buy.totals(lines, fr, { registered: Boolean(sup.gstin), inter: buy.interState(sup, g0) });
      raw2 = t.raw;
      // v21: freight on bills never passes the PO's freight, and is charged once per PO across all its bills
      const pos = [...new Set(lines.filter((l) => l.po_id).map((l) => l.po_id))];
      if (Number(fr) > 0 && pos.length) {
        let allowed = 0; const nos = [];
        for (const pid of pos) { const p = await buy.poOf(q, pid); allowed += p.freight - (await buy.freightBilled(q, pid)); nos.push(p.po_no); }
        allowed = r2(allowed);
        if (Number(fr) > allowed + 0.5 && lines.every((l) => l.po_id)) e.freight = allowed > 0 ? `The PO allows ${rs(allowed)} more freight (${nos.join(', ')}). Freight is charged once per PO.` : `No freight is left on ${nos.join(', ')} (none on the PO, or already billed).`;
      }
    }
    if (!check) {
      const typed = String(b.total ?? '').trim();
      if (typed === '' || !(Number(typed) > 0)) e.total = 'The total printed on the bill.';
      else if (t && Math.abs(Number(typed) - raw2) > 1) e.total = `The lines, GST and freight add to ${rs(raw2)}; the bill says ${rs(Number(typed))}. Check the quantities and rates.`;
    }
    if (Object.keys(e).length && !check) buy.bad(e);
    const diff = lines.filter((l) => l.po_rate !== null && Math.abs(l.rate - l.po_rate) > 0.004);
    const dv = r2(diff.reduce((a, l) => a + Math.abs(l.rate - l.po_rate) * l.qty, 0));
    const noPoFreight = Number(fr) > 0 && lines.some((l) => !l.po_id);
    return { sup, no, dt, lines, t, raw: raw2, diff, dv, freight: r2(Number(fr) || 0), noPoFreight, errors: e };
  }
  route('post', '/buying/bills/check', 'buying:edit', wrap(async (req) => {
    const x = await readBill(db, req, req.body || {}, true);
    return { totals: x.t, diff: x.diff.map((l) => ({ sku: l.sku, rate: l.rate, po_rate: l.po_rate })), dv: x.dv, no_po_freight: x.noPoFreight, errors: x.errors };
  }), G);
  route('post', '/buying/bills', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const b = req.body || {};
    const x = await readBill(q, req, b, false);
    const g0 = x.lines[0].godown_id;
    const grnIds = [...new Set(x.lines.map((l) => l.grn_id))];
    const due = buy.dueFor(x.sup, x.dt, await buy.acceptedOn(q, grnIds));
    const no = await numbering.issue(q, 'pbill', null, new Date(`${x.dt}T12:00:00+05:30`));
    const total = r2(b.total);
    const [ins] = await q.query(`INSERT INTO supplier_bills (bill_no, supplier_bill_no, supplier_id, godown_id, bill_date, due_date, taxable, freight, gst, inter_state, round_off, total, freight_sep, status, emp_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unpaid', ?)`, [no, x.no, x.sup.supplier_id, g0, x.dt, due, x.t.taxable, x.freight, x.t.gst, x.t.inter ? 1 : 0, r2(total - x.raw), total, b.freight_sep ? 1 : 0, by(req)]);
    const billId = ins.insertId;
    for (const [i, l] of x.lines.entries()) await q.query('INSERT INTO supplier_bill_lines (bill_id, line_no, grn_id, sku_code, qty, rate, po_rate, gst_rate) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [billId, i + 1, l.grn_id, l.sku, l.qty, l.rate, l.po_rate, l.gst]);
    const rule = await approvals.rule(q, 'bill_diff');
    const needDiff = x.diff.length > 0 && engine.needs(rule, { amount: x.dv }).needs;
    const needFr = x.noPoFreight && rule.is_on;
    let msg;
    if (needDiff || needFr) {
      const what = [needDiff ? `price differs from the PO on ${x.diff.map((l) => `${l.sku} ${rs(l.rate)} vs ${rs(l.po_rate)}`).join(', ')}` : null, needFr ? `freight ${rs(x.freight)} on goods that came in without a PO` : null].filter(Boolean).join('; and ');
      const aid = await approvals.request(q, { kind: 'bill_diff', godownId: g0, refType: 'supplier_bill', refId: no, recordDate: x.dt, amount: needDiff ? x.dv : x.freight, summary: `${x.sup.name} bill ${x.no}: ${what}`, payload: { t: 'bill', bill_id: billId } }, by(req));
      await q.query("UPDATE supplier_bills SET status = 'waiting', approval_id = ? WHERE bill_id = ?", [aid, billId]);
      msg = needDiff ? `The price differs from the PO by ${rs(x.dv)} in all. ${await waitLine(q, aid)} It cannot be paid until then.` : `Freight on goods with no PO is approved first. ${await waitLine(q, aid)} It cannot be paid until then.`;
    } else {
      const adj = await buy.billCost(q, billId, by(req));
      await buy.billCreditWait(q, billId, by(req));
      msg = `Matched. Due ${due}${buy.msmeSmall(x.sup) ? ' (MSME, 45 days from accepting the goods)' : ''}. It is paid in Money > Payments > Supplier payments.${adj.length && seeBuy(req) ? ` Average cost moved: ${adj.filter((a) => a.stock).map((a) => `${a.sku} ${a.before === null ? 'none' : rs(a.before)} to ${rs(a.after)}`).join(', ')}${adj.some((a) => a.cos) ? `; to cost of sales ${adj.filter((a) => a.cos).map((a) => `${a.sku} ${rs(a.cos)}`).join(', ')}` : ''}.` : ''}`;
    }
    await audit(q, { empId: by(req), action: 'create', entity: 'supplier_bill', entityId: no, after: { supplier: x.sup.name, their_no: x.no, total, waiting: needDiff || needFr } });
    return { bill_id: billId, bill_no: no, waiting: needDiff || needFr, message: `${x.no} saved as ${no}. ${msg}` };
  })), { ...G, status: 201 });
  approvals.onApproved('bill_diff', async (q, p, empId) => {
    const [[b]] = await q.query('SELECT bill_id, bill_no, status FROM supplier_bills WHERE bill_id = ? FOR UPDATE', [p.bill_id]);
    if (!b || b.status !== 'waiting') return;
    await q.query("UPDATE supplier_bills SET status = 'unpaid' WHERE bill_id = ?", [b.bill_id]);
    await buy.billCost(q, b.bill_id, empId);
    await buy.billCreditWait(q, b.bill_id, empId);
    await audit(q, { empId, action: 'approve', entity: 'supplier_bill', entityId: b.bill_no, before: { status: 'waiting' }, after: { status: 'unpaid' } });
  });
  approvals.onClosed('bill_diff', async (q, p, status, empId) => {
    if (status === 'expired') return;
    const [[b]] = await q.query('SELECT bill_id, bill_no, status FROM supplier_bills WHERE bill_id = ? FOR UPDATE', [p.bill_id]);
    if (!b || b.status !== 'waiting') return;
    await q.query("UPDATE supplier_bills SET status = 'rejected' WHERE bill_id = ?", [b.bill_id]);
    await audit(q, { empId, action: 'reject', entity: 'supplier_bill', entityId: b.bill_no, before: { status: 'waiting' }, after: { status: 'rejected' } });
  });
  approvals.onAgain('bill_diff', async () => '');

  // ============================================================================================ claims
  async function claimView(q, req, c, full = false) {
    const [lines] = await q.query('SELECT sku_code, qty, rate, reason FROM claim_lines WHERE claim_id = ? ORDER BY line_no', [c.claim_id]);
    const its = await buy.items(q, lines.map((l) => l.sku_code));
    const [[sup]] = await q.query('SELECT supplier_id, code, name, gstin FROM suppliers WHERE supplier_id = ?', [c.supplier_id]);
    const rates = await buy.gstRates(q, its, buy.today());
    const value = r2(lines.reduce((a, l) => a + l.qty * Number(l.rate), 0));
    const gst = sup.gstin ? r2(lines.reduce((a, l) => a + (l.qty * Number(l.rate) * (rates.get(l.sku_code) || 0)) / 100, 0)) : 0;
    const out = { claim_id: c.claim_id, claim_no: c.claim_no, ref: c.debit_no || c.claim_no, supplier: { supplier_id: sup.supplier_id, name: sup.name, code: sup.code }, grn_no: c.grn_no, po_no: c.po_no, godown_id: c.godown_id,
      outcome: c.outcome, outcome_label: c.outcome === 'replace' ? 'Replacement' : 'Credit note', status: c.status, status_label: CL_ST[c.status], value: hide(req, value), is_late: Number(c.is_late) === 1,
      items_text: lines.length ? `${(its.get(lines[0].sku_code) || {}).name || lines[0].sku_code}${lines.length > 1 ? ` +${lines.length - 1} more` : ''}` : '',
      lines_text: lines.map((l) => `${buy.qtyText(its.get(l.sku_code), l.qty)}, ${l.reason}`).join('; ') };
    if (!full) return out;
    const names = await namesOf(q, [c.emp_id]);
    return { ...out, gst: hide(req, gst), debit_total: hide(req, r2(value + gst)), debit_no: c.debit_no, challan_no: c.challan_no, cn: c.cn_no ? { no: c.cn_no, amount: hide(req, Number(c.cn_amount)), set: c.cn_set } : null,
      note: c.note, started_by: nm(names, c.emp_id), created_at: c.created_at, grn_id: c.grn_id, po_id: c.po_id,
      lines: lines.map((l) => { const it = its.get(l.sku_code) || {}; return { sku_code: l.sku_code, name: it.name, qty: l.qty, qty_text: buy.qtyText(it, l.qty), reason: l.reason, rate: hide(req, Number(l.rate)), value: hide(req, r2(l.qty * Number(l.rate))) }; }),
      can: { edit: canDo(req, 'buying', 'edit') && godowns.covers(req.admin, c.godown_id), replace: Boolean(c.po_id) } };
  }
  const claimRows = async (q, where, params) => (await q.query(`SELECT c.*, g.grn_no, p.po_no FROM claims c JOIN goods_ins g ON g.grn_id = c.grn_id LEFT JOIN purchase_orders p ON p.po_id = c.po_id WHERE ${where} ORDER BY c.claim_id DESC`, params))[0];
  route('get', '/buying/claims', 'buying:view', wrap(async (req) => {
    const [gw, gp] = godowns.where('c.godown_id', scope(req));
    const rows = await claimRows(db, gw, gp);
    const tab = req.query.tab === 'settled' ? 'settled' : 'open';
    const out = []; for (const c of rows.filter((x) => (tab === 'settled' ? x.status === 'settled' : x.status !== 'settled'))) out.push(await claimView(db, req, c));
    return { counts: { open: rows.filter((x) => x.status !== 'settled').length, settled: rows.filter((x) => x.status === 'settled').length }, rows: out, can: { edit: canDo(req, 'buying', 'edit') } };
  }), G);
  route('get', '/buying/claims/:id', 'buying:view', wrap(async (req) => {
    const [c] = await claimRows(db, 'c.claim_id = ?', [Number(req.params.id)]);
    if (!c) throw new InputError('No such claim', 404);
    sees(req, c.godown_id);
    return claimView(db, req, c, true);
  }), G);
  async function claimFor(q, req, status) {
    const [[c]] = await q.query('SELECT * FROM claims WHERE claim_id = ? FOR UPDATE', [Number(req.params.id)]);
    if (!c) throw new InputError('No such claim', 404);
    sees(req, c.godown_id); works(req, c.godown_id);
    if (c.status !== status) throw new InputError(`It is ${CL_ST[c.status].toLowerCase()} already.`, 409);
    return c;
  }
  route('post', '/buying/claims/:id/issue', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const c = await claimFor(q, req, 'draft');
    const outcome = (req.body || {}).outcome === 'replace' && c.po_id ? 'replace' : (req.body || {}).outcome === 'credit' ? 'credit' : c.outcome;
    await books.assertOpen(q, buy.today());
    const dn = await numbering.issue(q, 'debit', c.godown_id);
    await q.query("UPDATE claims SET status = 'issued', outcome = ?, debit_no = ? WHERE claim_id = ?", [outcome, dn, c.claim_id]);
    await audit(q, { empId: by(req), action: 'update', entity: 'claim', entityId: c.claim_no, before: { status: 'draft' }, after: { status: 'issued', debit_note: dn, outcome } });
    return { message: `Debit note ${dn} issued. Send it with the goods. Next: Goods sent back, when they leave the godown.` };
  })), G);
  route('post', '/buying/claims/:id/returned', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const c = await claimFor(q, req, 'issued');
    const ch = await numbering.issue(q, 'challan', c.godown_id);
    const [lines] = await q.query('SELECT sku_code, qty, batch_id FROM claim_lines WHERE claim_id = ? ORDER BY line_no', [c.claim_id]);
    for (const l of lines) await stock.moveStock(q, { sku: l.sku_code, godown: c.godown_id, shelf: 'rej', qty: -l.qty, batch: l.batch_id || null, strict: Boolean(l.batch_id), doc: { type: 'claim', id: c.claim_no }, what: 'sent_back', note: `Sent back on ${ch}` }, by(req));
    await q.query("UPDATE claims SET status = 'returned', challan_no = ?, returned_at = UTC_TIMESTAMP() WHERE claim_id = ?", [ch, c.claim_id]);
    await audit(q, { empId: by(req), action: 'update', entity: 'claim', entityId: c.claim_no, before: { status: 'issued' }, after: { status: 'returned', challan: ch } });
    return { message: `Sent back on ${ch}. ${c.outcome === 'replace' ? 'The purchase order stays open for the replacement.' : 'Record their credit note when it comes.'}` };
  })), G);
  // settled by a replacement: goods in on the same PO after the goods went back, not used for another claim (v22 B3)
  route('post', '/buying/claims/:id/settle', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const c = await claimFor(q, req, 'returned');
    if (!c.po_id) throw new InputError('A replacement needs goods in against a purchase order. Settle it by their credit note instead.', 409);
    if (c.outcome !== 'replace') throw new InputError('This claim asks for a credit note: record it instead.', 409);
    const p = await buy.poOf(q, c.po_id);
    const got = await buy.received(q, p.po_id);
    const [lines] = await q.query('SELECT sku_code, qty FROM claim_lines WHERE claim_id = ?', [c.claim_id]);
    const its = await buy.items(q, lines.map((l) => l.sku_code));
    const still = lines.filter((l) => { const pl = p.lines.find((x) => x.sku === l.sku_code); return pl && buy.openOf(pl, got) > 0; });
    if (still.length) throw new InputError(`${p.po_no} still waits for ${still.map((l) => `${buy.qtyText(its.get(l.sku_code), buy.openOf(p.lines.find((x) => x.sku === l.sku_code), got))} of ${l.sku_code}`).join(', ')}. Take the replacement in through Goods in first.`, 409);
    const need = new Map(); for (const l of lines) need.set(l.sku_code, (need.get(l.sku_code) || 0) + l.qty);
    const [gs] = await q.query("SELECT grn_id, grn_no FROM goods_ins WHERE po_id = ? AND status = 'done' AND created_at >= ? AND (for_claim_id IS NULL OR for_claim_id = ?) ORDER BY grn_id", [c.po_id, c.returned_at, c.claim_id]);
    const have = new Map(); const used = [];
    for (const g of gs) {
      const [gl] = await q.query('SELECT sku_code, COALESCE(acc, 0) AS acc FROM goods_in_lines WHERE grn_id = ?', [g.grn_id]);
      let hit = false;
      for (const l of gl) if (need.has(l.sku_code) && (have.get(l.sku_code) || 0) < need.get(l.sku_code) && Number(l.acc) > 0) { have.set(l.sku_code, (have.get(l.sku_code) || 0) + Number(l.acc)); hit = true; }
      if (hit) used.push(g);
    }
    const short = [...need.entries()].filter(([k, n]) => (have.get(k) || 0) < n).map(([k, n]) => `${n - (have.get(k) || 0)} of ${k}`);
    if (short.length) throw new InputError(`No replacement in yet: goods in on ${p.po_no} after the goods went back must bring ${short.join(', ')}. Take the replacement in through Goods in first.`, 409);
    for (const g of used) await q.query('UPDATE goods_ins SET for_claim_id = ? WHERE grn_id = ?', [c.claim_id, g.grn_id]);
    await q.query("UPDATE claims SET status = 'settled', settled_by = ?, settled_at = UTC_TIMESTAMP() WHERE claim_id = ?", [by(req), c.claim_id]);
    await audit(q, { empId: by(req), action: 'update', entity: 'claim', entityId: c.claim_no, before: { status: 'returned' }, after: { status: 'settled', replacement: used.map((g) => g.grn_no) } });
    return { message: `Settled: the replacement came in and was checked (${used.map((g) => g.grn_no).join(', ')}).` };
  })), G);
  // settled by their credit note: it must equal our debit note; the PO line no longer waits for these goods
  route('post', '/buying/claims/:id/credit', 'buying:edit', wrap(async (req) => tx(async (q) => {
    const c = await claimFor(q, req, 'returned');
    const b = req.body || {};
    const [cv] = await claimRows(q, 'c.claim_id = ?', [c.claim_id]);
    const v = await claimView(q, { ...req, admin: { ...req.admin, seesCost: true } }, cv, true);
    const due = r2(Number(v.debit_total));
    const no = String(b.cn_no || '').trim().slice(0, 30);
    const e = {};
    if (!no) e.cn_no = 'Their credit note number.';
    if (!(Number(b.amount) > 0)) e.amount = 'The amount on it.'; else if (Math.abs(Number(b.amount) - due) > 1) e.amount = `Our debit note is ${rs(due)}. Ask them for the right credit note.`;
    if (Object.keys(e).length) buy.bad(e);
    await books.assertOpen(q, buy.today());
    const amt = r2(b.amount);
    const before = await buy.payable(q, c.supplier_id);
    if (c.po_id) { const [lines] = await q.query('SELECT sku_code, qty FROM claim_lines WHERE claim_id = ?', [c.claim_id]); for (const l of lines) await q.query('UPDATE po_lines SET credited = credited + ? WHERE po_id = ? AND sku_code = ?', [l.qty, c.po_id, l.sku_code]); }
    const sc = await buy.supplierCredit(q, c.supplier_id, amt, no, { grnId: c.grn_id, claimId: c.claim_id }, by(req));
    await q.query("UPDATE claims SET status = 'settled', cn_no = ?, cn_amount = ?, cn_date = ?, cn_set = ?, settled_by = ?, settled_at = UTC_TIMESTAMP() WHERE claim_id = ?",
      [no, amt, buy.today(), [sc.used.join(', '), sc.left > 0.004 ? `${rs(sc.left)} kept as credit` : ''].filter(Boolean).join('; ').slice(0, 255) || null, by(req), c.claim_id]);
    const after = await buy.payable(q, c.supplier_id);
    const [[sup]] = await q.query('SELECT name FROM suppliers WHERE supplier_id = ?', [c.supplier_id]);
    const [[po]] = c.po_id ? await q.query('SELECT po_no FROM purchase_orders WHERE po_id = ?', [c.po_id]) : [[null]];
    await audit(q, { empId: by(req), action: 'update', entity: 'claim', entityId: c.claim_no, before: { status: 'returned' }, after: { status: 'settled', credit_note: `${no} ${amt}`, set_against: sc.used, credit_left: sc.left || undefined } });
    return { message: `${po ? `${po.po_no} no longer waits for these goods. ` : ''}We owe ${sup.name} ${rs(Math.max(0, before))} before, ${rs(Math.max(0, after))} now${sc.used.length ? ` (set against ${sc.used.join(', ')})` : ''}${sc.left > 0.004 ? `; ${rs(sc.left)} waits as credit for their next bill` : ''}.` };
  })), G);
}

/** a purchase order as a PDF (mailed to the supplier from the outbox, or opened in the admin) */
async function poPdf(q, poId) {
  const { Doc, money, day } = require('./doc-pdf');
  const p = await buy.poOf(q, poId);
  if (!p || !p.po_no) return null;
  const company = require('./company');
  const f = await company.facts(q);
  const sup = await buy.supplierOf(q, p.supplier_id); const g = await buy.godownOf(q, p.godown_id);
  const [contacts] = await q.query('SELECT name, phone, email FROM supplier_contacts WHERE supplier_id = ? ORDER BY pos', [sup.supplier_id]);
  const its = await buy.items(q, p.lines.map((l) => l.sku));
  const rates = await buy.gstRates(q, its, p.po_date);
  const [their] = await q.query('SELECT sku_code, their_code FROM supplier_items WHERE supplier_id = ?', [sup.supplier_id]);
  const t = buy.totals(p.lines.map((l) => ({ ...l, gst: rates.get(l.sku) })), p.freight, { registered: Boolean(sup.gstin), inter: buy.interState(sup, g) });
  const ct = contacts[0] || {};
  const d = await new Doc(`Purchase order ${p.po_no}${p.rev > 1 ? ` (Rev ${p.rev})` : ''}`, false).start();
  d.columns([[f.name, true], [f.address || ''], [`GSTIN: ${f.gstin || 'to be provided'}`], [[f.phone, f.email].filter(Boolean).join(' - ')]],
    [[`Purchase order ${p.po_no}`, true], [`Date: ${day(p.po_date)}`], [`Deliver by ${day(p.expected_on)} to ${g.name}`], [[g.address, g.city].filter(Boolean).join(', ')], [t.inter ? 'IGST (another state)' : 'CGST + SGST (same state)']]);
  d.columns([['To', true], [sup.name], [[sup.addr_l1, sup.addr_l2].filter(Boolean).join(', ')], [`${sup.city || ''}${sup.pin ? ` - ${sup.pin}` : ''}, ${stateName(sup.state_code)}`], [`GSTIN ${sup.gstin || 'not registered'}`]],
    [['Contact', true], [ct.name || '-'], [ct.phone || ''], [ct.email || '']]);
  d.table([{ label: '#', w: 3 }, { label: 'Item', w: 30 }, { label: 'Your code', w: 11 }, { label: 'Quantity', w: 12, align: 'right' }, { label: 'Rate', w: 10, align: 'right' }, { label: 'Disc.', w: 7, align: 'right' }, { label: 'GST', w: 7, align: 'right' }, { label: 'Amount', w: 13, align: 'right' }],
    p.lines.map((l, i) => { const it = its.get(l.sku) || {}; return [i + 1, `${it.name}\n${l.sku}${it.hsn ? ` - HSN ${it.hsn}` : ''}`, (their.find((x) => x.sku_code === l.sku) || {}).their_code || '-', buy.qtyText(it, l.qty), money(l.rate), l.disc ? `${l.disc}%` : '-', sup.gstin ? `${rates.get(l.sku) ?? '-'}%` : '-', money(buy.lineVal(l))]; }));
  d.totals([['Value without GST', money(t.taxable)], ...(t.freight ? [['Freight', money(t.freight)]] : []), ...(t.inter ? [['IGST', money(t.igst)]] : [['CGST', money(t.cgst)], ['SGST', money(t.sgst)]]),
    ...(t.round ? [['Round off', money(t.round)]] : []), ['Total', `Rs ${money(t.total)}`, true]]);
  d.para(`${p.terms ? `${p.terms} ` : ''}Payment: ${sup.terms_days} days from your bill. Quote this PO number on your challan and bill.`);
  d.para(`For ${f.name} - Authorised signatory`);
  return { filename: `${p.po_no.replace(/\//g, '-')}.pdf`, buffer: await d.finish() };
}

module.exports = { register, poPdf, PO_ST, GI_ST, BILL_ST, CL_ST, SUP_ST };
