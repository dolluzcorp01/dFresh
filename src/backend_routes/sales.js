// Phase 19: sections 6 and 7 Leads, customers, quotes and orders (v23 working file). The rules here; the screens' API in
// sales-routes.js. Orders themselves stay in commerce.js (drafts, back-orders, hold time, revisions are there).
// - Quotes (DFQ/26-27/0001, the document series): for a customer or an enquiry not yet a customer, shipped from a godown,
//   valid until a date. Prices come from the customer's list (an enquiry: the list of its business type), quantity slabs
//   and special prices (pricing.quote), are kept on the quote, and stay until it expires; moving the valid-until date
//   later prices it again from today's list (a typed discount keeps its % off). A kit is one line (its parts priced by
//   the kit's price). "Save and send" asks for what it needs first (discount above the limit, below the lowest allowed
//   price, below cost plus margin: a "Price check" for someone without See cost); one rejection sends it back to draft
//   and closes the other checks. A sent quote shows Expired after its date; a change of a sent quote is its next
//   revision. Make order (one press) makes the order as a draft with the quoted prices; confirming it wins the quote.
// - Standing orders (STO-0001): a customer's repeat order, every week, every 2 weeks (on a weekday) or every month (on a
//   date); each cycle makes an order with today's prices and stock, as a draft or confirmed (switch standing_confirm,
//   with the same checks as any order).
// - Calls and follow-ups on an enquiry or a customer (Log a call: how, what was said, the next call, a sample to send);
//   the first call on an enquiry is its first reply and makes a new one Contacted. Samples: to send, sent, ordered or not.
// - Credit limits page, customer types page: the rows (rules in customers.js and prices.js).
const pricing = require('./pricing');
const commerce = require('./commerce');
const approvals = require('./approvals');
const numbering = require('./numbering');
const commerceSettings = require('./commerce-settings');
const customers = require('./customers');
const { audit } = require('./audit');
const auth = require('./auth');

/** staff names (dadmin employee) -> Map emp_id -> name */
async function staffNames(q, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const [rows] = await q.query(`SELECT emp_id, TRIM(CONCAT(COALESCE(emp_first_name, ''), ' ', COALESCE(emp_last_name, ''))) AS name FROM \`${auth.DADMIN}\`.employee WHERE emp_id IN (?)`, [list]);
  return new Map(rows.map((r) => [r.emp_id, r.name || r.emp_id]));
}

class SalesError extends Error {
  constructor(message, status = 400, fields = null) { super(message); this.status = status; if (fields) { this.code = 'fields'; this.fields = fields; } }
}
const round2 = (n) => Math.round(n * 100) / 100;
const today = () => pricing.istToday();
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);
const fail = (fields) => { throw new SalesError(Object.values(fields)[0], 400, fields); };
const QT_STATUS = { draft: 'Draft', approval: 'Waiting for approval', sent: 'Sent', won: 'Won', lost: 'Lost', expired: 'Expired' };
const QT_LOST = ['Price too high', 'Bought elsewhere', 'No reply', 'Delivery too far or slow', 'Plan dropped', 'Other'];
const QT_KINDS = ['discount', 'price_floor', 'margin_floor'];
const qState = (r) => (r.status === 'sent' && r.valid_until < today() ? 'expired' : r.status);
const CALL_HOW = { call: 'Phone call', whatsapp: 'WhatsApp', visit: 'Visit', sample: 'Sample sent', mail: 'E-mail' };
const LOST_WHY = ['Price too high', 'Too far to deliver', 'Quality or sample not liked', 'No reply after 3 tries', 'Buys elsewhere', 'Other'];
const EVERY = { week: 'Every week', '2week': 'Every 2 weeks', month: 'Every month' };
const DAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/** an enquiry's business type -> a customer type (the same guess as Make customer) */
function leadType(l) {
  const bt = `${l.business_type || ''} ${l.business_name || ''}`.toLowerCase();
  return l.form_type === 'distributor' ? 'distributor' : /hotel|restaurant|cafe|caterer|lodge|resort|food/.test(bt) ? 'hotel'
    : /hospital|clinic|health|medical/.test(bt) ? 'hospital' : /office|corporate|school|college|bank|it/.test(bt) ? 'office' : 'home';
}

/** who a document is for -> { customer, lead, typeKey, name, gstType } (a blocked or merged customer refused) */
async function whoOf(q, customerId, leadId) {
  const co = await require('./company').facts(q); // eslint-disable-line global-require
  if (customerId) {
    const [[c]] = await q.query(`SELECT c.customer_id, c.customer_no, c.name, c.type_key, c.status, c.hold_reason, c.godown_id, c.owner_emp_id, c.merged_into,
        (SELECT a.state_code FROM customer_addresses a WHERE a.customer_id = c.customer_id AND a.kind = 'shipping' AND a.is_active = 1 ORDER BY a.is_default DESC, a.address_id LIMIT 1) AS state
        FROM customers c WHERE c.customer_id = ?`, [Number(customerId)]);
    if (!c) throw new SalesError('Customer not found', 404);
    if (c.merged_into) throw new SalesError(`${c.customer_no} was merged into another customer: choose that one`);
    return { customer: c, lead: null, typeKey: c.type_key, name: c.name, gstType: !c.state || c.state === co.state_code ? 'intra' : 'inter' };
  }
  const [[l]] = await q.query('SELECT lead_id, lead_ref, full_name, business_name, business_type, form_type, status, assigned_to, email, town FROM leads WHERE lead_id = ?', [Number(leadId)]);
  if (!l) throw new SalesError('Choose who it is for', 400, { who: 'Choose who it is for.' });
  const [[cust]] = await q.query('SELECT customer_id FROM customers WHERE lead_id = ? AND merged_into IS NULL', [l.lead_id]);
  if (cust) return whoOf(q, cust.customer_id, null);
  return { customer: null, lead: l, typeKey: leadType(l), name: `${l.business_name || l.full_name} (enquiry)`, gstType: 'intra' };
}

/**
 * price the lines of a quote (the same rules as an order: pricing.quote, the price guard, MRP)
 * items: [{ sku_code | kit_key, qty, price ('' = list), is_free, free_why }]; old: the quote's lines when kept
 * -> { lines, fields (errors by line), holds }
 */
async function priceLines(q, who, items, { day, old = [], keep = false, what = 'quote' }) {
  const fields = {};
  const lines = [];
  const rule = await pricing.marginRule(q);
  const seen = new Set();
  const ask = (sku, qty) => pricing.quote(q, { customerId: who.customer ? who.customer.customer_id : null, typeKey: who.typeKey, sku, qty, date: day });
  for (const [n, it] of (Array.isArray(items) ? items : []).entries()) {
    const kitKey = String(it.kit_key || '').trim();
    const sku = String(it.sku_code || '').trim().toUpperCase();
    if (!sku && !kitKey) continue;
    const qty = Number(it.qty);
    const free = it.is_free === true || it.is_free === 1 || it.is_free === '1';
    if (!Number.isInteger(qty) || qty < 1) { fields[`items.${n}.qty`] = 'A whole number, at least 1.'; continue; }
    const key = `${kitKey || sku}${free ? '#f' : ''}`;
    if (seen.has(key)) { fields[`items.${n}.sku_code`] = `Already on this ${what}. Change the quantity there.`; continue; }
    seen.add(key);
    const typed = String(it.price ?? '').trim() === '' ? null : Number(it.price);
    if (typed !== null && !(typed >= 0)) { fields[`items.${n}.price`] = 'Give the price.'; continue; }
    if (!free && typed === 0) { fields[`items.${n}.price`] = 'Zero? Tick Free instead and say why.'; continue; }
    const why = String(it.free_why || '').trim().slice(0, 80);
    if (free && why.length < 3) { fields[`items.${n}.free_why`] = 'Say why it is free.'; continue; }
    if (kitKey) {
      const k = await commerce.kitOf(q, kitKey);
      if (!k || k.status !== 'active') { fields[`items.${n}.sku_code`] = 'Choose a kit that is sold now.'; continue; }
      const parts = [];
      for (const pt of k.parts) {
        const pq = await ask(pt.sku_code, pt.qty * qty);
        if (pq.ex === null) { fields[`items.${n}.sku_code`] = `${pt.sku_code} (part of ${k.kit_code}) has no price on this list.`; break; }
        parts.push({ ...pt, per: pt.qty, list: pq.ex, rate: pq.rate });
      }
      if (fields[`items.${n}.sku_code`]) continue;
      const kitList = k.price !== null ? k.price : round2(parts.reduce((a, x) => a + x.list * x.per, 0));
      const was = old.find((x) => x.kit_key === k.kit_key && Number(x.kit_qty) === qty);
      const unit = free ? 0 : keep && was && typed !== null && Math.abs(typed - was.kit_price) < 0.005 ? was.kit_price : typed !== null ? typed : kitList;
      const prices = commerce.spreadKit(unit, parts);
      parts.forEach((pt, i) => lines.push({ sku_code: pt.sku_code, kit_key: k.kit_key, kit_qty: qty, kit_code: k.kit_code, qty: pt.qty * qty, price: prices[i], list_price: pt.list, gst_rate: pt.rate, is_free: free ? 1 : 0, free_why: free ? why : null, n }));
      continue;
    }
    const facts = await pricing.packFacts(q, sku);
    const [[s]] = await q.query('SELECT sku_code, packs_per_carton, min_order_qty, step_qty, sell_unit, status, is_active FROM skus WHERE sku_code = ?', [sku]);
    if (!facts || !s || facts.sku_type === 'raw') { fields[`items.${n}.sku_code`] = 'Choose a pack.'; continue; }
    if (!Number(s.is_active) || !['active', 'discontinued'].includes(s.status) || !['active', 'hidden', 'discontinued'].includes(facts.product_status || 'active')) {
      fields[`items.${n}.sku_code`] = `${sku} is not for sale (${facts.product_status === 'draft' ? 'its product is still a draft' : s.status}).`; continue;
    }
    const bad = pricing.qtyProblem(s, qty);
    if (bad) { fields[`items.${n}.qty`] = bad; continue; }
    const pq = await ask(sku, qty);
    if (pq.ex === null || pq.rate === null) { fields[`items.${n}.sku_code`] = `${sku} has no price on this list.`; continue; }
    const was = old.find((x) => x.sku_code === sku && !x.kit_key && Number(x.qty) === qty && Boolean(x.is_free) === free);
    const kept = keep && was && typed !== null && Math.abs(typed - Number(was.price)) < 0.005;
    const listP = kept ? Number(was.list_price) : pq.ex;
    const price = free ? 0 : kept ? Number(was.price) : typed !== null ? typed : pq.ex;
    if (!free) {
      const g = await pricing.guard(q, facts, price, day, { rule });
      if (g.mrp) { fields[`items.${n}.price`] = g.mrp; continue; }
    }
    lines.push({ sku_code: sku, kit_key: null, kit_qty: null, qty, price: round2(price), list_price: listP, gst_rate: pq.rate, is_free: free ? 1 : 0, free_why: free ? why : null, kept: kept ? 'kept' : null, typed: typed !== null && !kept, n });
  }
  if (!lines.length && !Object.keys(fields).length) fields['items.0.sku_code'] = 'Add at least one item.';
  return { lines, fields };
}

/** the totals of a quote (lines, delivery charge taxed at the highest line rate, round off) */
async function quoteTotals(q, lines, gstType, dc) {
  const co = await require('./company').facts(q); // eslint-disable-line global-require
  const top = lines.reduce((a, l) => Math.max(a, Number(l.gst_rate)), 0) || 18;
  const t = commerce.taxTotals(lines.map((l) => ({ ...l, is_free: Boolean(l.is_free), offer_discount: 0 })), gstType, co.round_off, { charge: Number(dc) || 0, rate: top });
  const list = round2(lines.reduce((a, l) => a + (Number(l.list_price) || 0) * l.qty, 0));
  const goods = round2(t.taxable - t.delivery_charge);
  return { ...t, list_value: list, off_pct: list > 0 ? Math.round(((list - goods) / list) * 1000) / 10 : 0 };
}

/** what a quote needs a second person for (worked out the same on screen and on save) */
async function quoteNeeds(q, lines, totals, admin, day) {
  const out = [];
  const off = round2(totals.list_value - (totals.taxable - totals.delivery_charge));
  if (off > 0.004 && await approvals.needed(q, 'discount', { pct: totals.off_pct })) out.push({ kind: 'discount', amount: off, what: `all discounts together are ${totals.off_pct}% (Rs ${off} off the list${lines.some((l) => l.is_free) ? ', free items included' : ''})` });
  const rule = await pricing.marginRule(q);
  const lowF = []; const lowM = [];
  for (const l of lines.filter((x) => !x.is_free)) {
    const g = await pricing.guard(q, await pricing.packFacts(q, l.sku_code), l.price, day, { rule });
    if (g.floor) lowF.push(`${l.sku_code} at Rs ${l.price}: ${g.floor}`); else if (g.margin) lowM.push(l.sku_code);
  }
  if (lowF.length && await approvals.needed(q, 'price_floor')) out.push({ kind: 'price_floor', amount: null, what: lowF.join('; ') });
  if (lowM.length && rule.on) {
    const blind = admin && !admin.seesCost;
    out.push({ kind: 'margin_floor', amount: null, label: blind ? 'Price check' : null, what: blind ? `price check on ${[...new Set(lowM)].join(', ')}` : `${[...new Set(lowM)].join(', ')} below cost plus the margin floor` });
  }
  return out;
}

const QUOTE_COLS = `q.quote_id, q.quote_no, q.customer_id, q.lead_id, q.godown_id, q.status, q.rev, DATE_FORMAT(q.quote_date, '%Y-%m-%d') AS quote_date, DATE_FORMAT(q.valid_until, '%Y-%m-%d') AS valid_until,
  q.delivery_charge, q.notes, q.gst_type, q.list_value, q.taxable, q.gst, q.round_off, q.total, q.order_id, q.lost_reason, q.rej_note, q.sent_at, q.ok_by, q.version, q.emp_id, q.created_at`;
async function quoteRow(q, id, lock = false) {
  const [[r]] = await q.query(`SELECT ${QUOTE_COLS} FROM quotes q WHERE ${/^\d+$/.test(String(id)) ? 'q.quote_id' : 'q.quote_no'} = ?${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!r) throw new SalesError('Quote not found', 404);
  return r;
}
async function quoteLines(q, quoteId) {
  const [rows] = await q.query('SELECT sku_code, kit_key, kit_qty, qty, price, list_price, gst_rate, is_free, free_why FROM quote_lines WHERE quote_id = ? ORDER BY sort_order, line_id', [quoteId]);
  return rows.map((l) => ({ ...l, qty: Number(l.qty), price: Number(l.price), list_price: l.list_price === null ? null : Number(l.list_price), gst_rate: Number(l.gst_rate), is_free: Number(l.is_free) === 1,
    kit_price: null }));
}
/** a kit's price per kit, from its part lines */
function kitPrices(lines) {
  const by = new Map();
  lines.filter((l) => l.kit_key).forEach((l) => by.set(l.kit_key, round2((by.get(l.kit_key) || 0) + (l.price * l.qty) / (l.kit_qty || 1))));
  return lines.map((l) => (l.kit_key ? { ...l, kit_price: by.get(l.kit_key) } : l));
}

/**
 * Save a quote (new: id null). b = { customer_id | lead_id, godown_id, valid_until, delivery_charge, notes, items, send }.
 * -> { quote_no, status, rev, waits, total }
 */
async function saveQuote(q, id, b, empId, admin) {
  const day = today();
  const was = id ? await quoteRow(q, id, true) : null;
  if (was && ['won', 'lost'].includes(was.status)) throw new SalesError(`${was.quote_no} is ${QT_STATUS[was.status]}: it cannot be changed`, 409);
  if (was && was.status === 'approval') throw new SalesError(`${was.quote_no} waits for approval: it can be changed once it is decided`, 409);
  if (was && b.version !== undefined && Number(b.version) !== Number(was.version)) throw new SalesError(`${was.quote_no} changed since you opened it: reload it`, 409);
  const fields = {};
  const custId = b.customer_id ? Number(b.customer_id) : null;
  const leadId = !custId && b.lead_id ? Number(b.lead_id) : null;
  if (!custId && !leadId) fields.who = 'Choose who it is for.';
  const valid = String(b.valid_until || '');
  if (!pricing.isDate(valid) || valid < day) fields.valid_until = 'Today or later.';
  const dc = String(b.delivery_charge ?? '').trim() === '' ? 0 : Number(b.delivery_charge);
  if (!(dc >= 0)) fields.delivery_charge = '0 or more.';
  if (Object.keys(fields).length) fail(fields);
  const who = await whoOf(q, custId, leadId);
  if (who.customer && who.customer.status === 'blocked') fail({ who: `Blocked: ${who.customer.hold_reason || 'no quotes or orders'}` });
  const godown = Number(b.godown_id) || (was ? was.godown_id : who.customer ? who.customer.godown_id : null);
  if (!godown) fail({ godown_id: 'Choose the godown it ships from.' });
  // prices are kept while it is valid; a later valid-until date (or an expired quote) prices it again from today's list
  const old = was ? kitPrices(await quoteLines(q, was.quote_id)) : [];
  const keep = Boolean(was) && qState(was) !== 'expired' && !(valid > was.valid_until);
  const { lines, fields: lf } = await priceLines(q, who, b.items, { day, old, keep });
  if (Object.keys(lf).length) fail(lf);
  const t = await quoteTotals(q, lines, who.gstType, dc);
  let quoteNo = was ? was.quote_no : null;
  let quoteId = was ? was.quote_id : null;
  let rev = was ? Number(was.rev) : 1;
  if (was && was.status !== 'draft') {
    await q.query('INSERT INTO quote_revisions (quote_id, rev, valid_until, delivery_charge, total, `lines`, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [was.quote_id, rev, was.valid_until, Number(was.delivery_charge), Number(was.total), JSON.stringify(old.map((l) => ({ sku_code: l.sku_code, kit_key: l.kit_key, qty: l.qty, price: l.price, is_free: l.is_free }))), empId]);
    rev += 1;
  }
  const vals = [who.customer ? who.customer.customer_id : null, who.lead ? who.lead.lead_id : null, godown, valid, dc, String(b.notes || '').trim().slice(0, 300) || null, who.gstType, t.list_value, t.taxable, t.gst, t.round_off, t.total];
  if (!was) {
    quoteNo = await numbering.issue(q, 'quote', godown);
    const [ins] = await q.query(`INSERT INTO quotes (quote_no, customer_id, lead_id, godown_id, valid_until, delivery_charge, notes, gst_type, list_value, taxable, gst, round_off, total, quote_date, status, emp_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`, [quoteNo, ...vals, day, empId]);
    quoteId = ins.insertId;
  } else {
    await q.query(`UPDATE quotes SET customer_id = ?, lead_id = ?, godown_id = ?, valid_until = ?, delivery_charge = ?, notes = ?, gst_type = ?, list_value = ?, taxable = ?, gst = ?, round_off = ?, total = ?,
        status = 'draft', rev = ?, rej_note = NULL, lost_reason = NULL, version = version + 1, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE quote_id = ?`, [...vals, rev, empId, quoteId]);
    await q.query('DELETE FROM quote_lines WHERE quote_id = ?', [quoteId]);
  }
  for (const [i, l] of lines.entries()) {
    await q.query('INSERT INTO quote_lines (quote_id, sort_order, sku_code, kit_key, kit_qty, qty, price, list_price, gst_rate, is_free, free_why) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [quoteId, i, l.sku_code, l.kit_key, l.kit_qty, l.qty, l.price, l.list_price, l.gst_rate, l.is_free, l.free_why]);
  }
  let status = 'draft';
  let waits = [];
  if (b.send) {
    const needs = await quoteNeeds(q, lines, t, admin, day);
    if (needs.length) {
      for (const n of needs) {
        await approvals.request(q, { kind: n.kind, godownId: godown, target: who.customer ? `cust:${who.customer.customer_id}` : null, refType: 'quote', refId: quoteNo,
          summary: `Quote ${quoteNo} for ${who.name}: ${n.what}`, amount: n.amount, payload: { quote_no: quoteNo, label: n.label || null } }, empId);
      }
      status = 'approval'; waits = needs.map((n) => n.label || approvals.KINDS[n.kind].label);
    } else status = 'sent';
    await q.query(`UPDATE quotes SET status = ?, sent_at = ${status === 'sent' ? 'UTC_TIMESTAMP()' : 'sent_at'} WHERE quote_id = ?`, [status, quoteId]);
  }
  await audit(q, { empId, action: was ? (rev > Number(was.rev) ? 'revise' : 'update') : 'create', entity: 'quote', entityId: quoteNo,
    after: { for: who.name, status, rev, valid_until: valid, total: t.total, lines: lines.map((l) => `${l.qty} x ${l.sku_code} @ ${l.price}${l.is_free ? ' (free)' : ''}${l.kit_key ? ` (${l.kit_key})` : ''}`), repriced: Boolean(was) && !keep } });
  return { quote_no: quoteNo, quote_id: quoteId, status, status_label: QT_STATUS[status], rev, waits, total: t.total, repriced: Boolean(was) && !keep };
}

/** the form as typed, before it is saved: the same prices and checks the save will use */
async function previewQuote(q, id, b, admin) {
  const day = today();
  const was = id ? await quoteRow(q, id) : null;
  const custId = b.customer_id ? Number(b.customer_id) : null;
  const leadId = !custId && b.lead_id ? Number(b.lead_id) : null;
  if (!custId && !leadId) return { lines: [], fields: {}, totals: null, needs: [] };
  const who = await whoOf(q, custId, leadId);
  const valid = String(b.valid_until || '');
  const old = was ? kitPrices(await quoteLines(q, was.quote_id)) : [];
  const keep = Boolean(was) && qState(was) !== 'expired' && !(pricing.isDate(valid) && valid > was.valid_until);
  const { lines, fields } = await priceLines(q, who, b.items, { day, old, keep });
  const t = lines.length ? await quoteTotals(q, lines, who.gstType, Number(b.delivery_charge) || 0) : null;
  let needs = t ? await quoteNeeds(q, lines, t, admin, day) : [];
  const blind = admin && !admin.seesCost;
  if (blind) needs = needs.filter((n) => n.kind !== 'margin_floor');
  return { lines, fields, totals: t, needs: needs.map((n) => ({ kind: n.kind, label: n.label || approvals.KINDS[n.kind].label, what: n.what })), repriced: Boolean(was) && !keep,
    expired: was ? qState(was) === 'expired' : false, price_note: blind && lines.some((l) => !l.is_free) ? 'Prices are also checked against cost when you save. It may then wait for a price check.' : null,
    who: { name: who.name, type: who.typeKey, gst_type: who.gstType } };
}

async function lostQuote(q, id, reason, empId) {
  const r = await quoteRow(q, id, true);
  if (!['draft', 'sent'].includes(r.status)) throw new SalesError(`${r.quote_no} is ${QT_STATUS[qState(r)]}`, 409);
  const why = String(reason || '').trim();
  if (!QT_LOST.includes(why)) fail({ lost_reason: 'Say why. It shows in the sales report.' });
  await q.query("UPDATE quotes SET status = 'lost', lost_reason = ?, version = version + 1, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE quote_id = ?", [why, empId, r.quote_id]);
  await audit(q, { empId, action: 'lost', entity: 'quote', entityId: r.quote_no, after: { reason: why } });
  return { status: 'lost' };
}

/** Make order: the quote becomes a draft order with its prices (one press); an enquiry is made a customer first */
async function quoteToOrder(q, id, empId, admin) {
  const r = await quoteRow(q, id, true);
  if (qState(r) !== 'sent') throw new SalesError(qState(r) === 'expired' ? `${r.quote_no} expired on ${r.valid_until}. Revise it with a new date before it can become an order.` : 'Only a sent quote that has not expired becomes an order.', 409);
  if (!r.customer_id) throw new SalesError('First, make them a customer. Everything from the enquiry is filled in; after you add the customer, press Make order again.', 409, { need_customer: `${r.lead_id}` });
  const [[c]] = await q.query('SELECT status, hold_reason FROM customers WHERE customer_id = ?', [r.customer_id]);
  if (c.status === 'blocked') throw new SalesError(`Blocked customer: ${c.hold_reason || ''}`.trim(), 409);
  const lines = kitPrices(await quoteLines(q, r.quote_id));
  const items = []; const kits = new Set();
  for (const l of lines) {
    if (l.kit_key) { if (!kits.has(l.kit_key)) { kits.add(l.kit_key); items.push({ kit_key: l.kit_key, qty: l.kit_qty, price: l.kit_price }); } continue; }
    if (l.is_free) continue; // a free item on a quote is typed again on the order (it needs its reason there)
    items.push({ sku_code: l.sku_code, qty: l.qty, price: l.price, kept: true });
  }
  try {
    const o = await commerce.createOrder(q, { customer_id: r.customer_id, quote_no: r.quote_no, items, draft: true, note: `From quote ${r.quote_no}` }, empId, { admin });
    await audit(q, { empId, action: 'to_order', entity: 'quote', entityId: r.quote_no, after: { order: o.order_no } });
    return { order_no: o.order_no, status: o.status };
  } catch (e) { if (e instanceof commerce.CommerceError) throw new SalesError(e.message, e.status); throw e; }
}

// the checks on a quote are decided: all approved -> sent; one rejected (or expired) -> back to draft, the others close
async function quotePending(q, quoteNo) {
  const [rows] = await q.query("SELECT approval_id FROM approvals WHERE ref_type = 'quote' AND ref_id = ? AND status = 'pending' AND kind IN (?)", [quoteNo, QT_KINDS]);
  return rows;
}
for (const k of QT_KINDS) {
  approvals.onApproved(k, async (q, p, empId) => {
    if (!p || !p.quote_no) return;
    const [[r]] = await q.query("SELECT quote_id, status FROM quotes WHERE quote_no = ? FOR UPDATE", [p.quote_no]);
    if (!r || r.status !== 'approval' || (await quotePending(q, p.quote_no)).length) return;
    await q.query("UPDATE quotes SET status = 'sent', sent_at = UTC_TIMESTAMP(), ok_by = ?, version = version + 1 WHERE quote_id = ?", [empId, r.quote_id]);
  });
  approvals.onClosed(k, async (q, p, status, empId) => {
    if (!p || !p.quote_no) return;
    const [[r]] = await q.query("SELECT quote_id, status FROM quotes WHERE quote_no = ? FOR UPDATE", [p.quote_no]);
    if (!r || r.status !== 'approval') return;
    const [[a]] = await q.query("SELECT a.kind, a.note, a.decided_by, JSON_UNQUOTE(JSON_EXTRACT(a.payload, '$.label')) AS label FROM approvals a WHERE a.ref_type = 'quote' AND a.ref_id = ? AND a.status = ? ORDER BY a.decided_at DESC, a.approval_id DESC LIMIT 1", [p.quote_no, status]);
    if (a) a.name = (await staffNames(q, [a.decided_by])).get(a.decided_by) || null;
    const label = a ? (a.label && a.label !== 'null' ? a.label : approvals.KINDS[a.kind].label) : 'A check';
    for (const x of await quotePending(q, p.quote_no)) await q.query("UPDATE approvals SET status = 'withdrawn', decided_by = ?, decided_at = UTC_TIMESTAMP(), note = ? WHERE approval_id = ? AND status = 'pending'", [empId, `Closed: another check on ${p.quote_no} was ${status}`, x.approval_id]);
    await q.query("UPDATE quotes SET status = 'draft', rej_note = ?, version = version + 1 WHERE quote_id = ?", [`${label}: ${status}${a && a.name ? ` by ${a.name}` : ''}${a && a.note ? ` (${a.note})` : ''}`.slice(0, 255), r.quote_id]);
  });
  approvals.onRecheck(k, async (q, p) => {
    if (!p || !p.quote_no) return '';
    const [[r]] = await q.query("SELECT quote_no, DATE_FORMAT(valid_until, '%Y-%m-%d') AS v, customer_id FROM quotes WHERE quote_no = ?", [p.quote_no]);
    if (!r) return 'The quote is gone.';
    if (r.v < today()) return `${r.quote_no} is valid only to ${r.v}. Move the date (it prices again) and send it again.`;
    const [[c]] = r.customer_id ? await q.query('SELECT name, status, hold_reason FROM customers WHERE customer_id = ?', [r.customer_id]) : [[null]];
    if (c && c.status === 'blocked') return `${c.name} is blocked now (${c.hold_reason || 'blocked'}).`;
    return '';
  });
}

// ---------------------------------------------------------------- standing orders
const stoNo = (id) => `STO-${String(id).padStart(4, '0')}`;
/** the first run on or after the start (not before today) on the chosen day */
function firstRun(every, runDay, from) {
  let d = new Date(`${from > today() ? from : today()}T00:00:00Z`);
  for (let i = 0; i < 62; i += 1) {
    const wd = d.getUTCDay() || 7; const md = d.getUTCDate();
    if (every === 'month' ? md === runDay : wd === runDay) return d.toISOString().slice(0, 10);
    d = new Date(d.getTime() + 86400e3);
  }
  return from;
}
function nextRun(every, runDay, from) {
  const d = new Date(`${from}T00:00:00Z`);
  if (every === 'week') d.setUTCDate(d.getUTCDate() + 7);
  else if (every === '2week') d.setUTCDate(d.getUTCDate() + 14);
  else { d.setUTCMonth(d.getUTCMonth() + 1, Math.min(runDay, 28)); }
  return d.toISOString().slice(0, 10);
}
const stoWhen = (s) => (s.every === 'month' ? `Every month on the ${s.run_day}${['', 'st', 'nd', 'rd'][s.run_day] || 'th'}` : `${s.every === 'week' ? 'Every ' : 'Every 2nd '}${DAYS[s.run_day]}`);

async function saveStanding(q, id, b, empId) {
  const fields = {};
  const custId = Number(b.customer_id);
  if (!custId) fields.customer_id = 'Choose the customer.';
  const every = EVERY[b.every] ? b.every : null;
  if (!every) fields.every = 'Choose how often.';
  const runDay = Number(b.run_day);
  if (!Number.isInteger(runDay) || runDay < 1 || runDay > (every === 'month' ? 28 : 7)) fields.run_day = every === 'month' ? 'A date from 1 to 28.' : '1 (Monday) to 7 (Sunday).';
  const from = String(b.starts_on || '');
  if (!pricing.isDate(from)) fields.starts_on = 'Give the start date.';
  const until = String(b.ends_on || '') || null;
  if (until && (!pricing.isDate(until) || until < from)) fields.ends_on = 'After the start.';
  const lines = [];
  const seen = new Set();
  (Array.isArray(b.items) ? b.items : []).forEach((it, n) => {
    const sku = String(it.sku_code || '').trim().toUpperCase(); const kit = String(it.kit_key || '').trim();
    if (!sku && !kit) return;
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1) { fields[`items.${n}.qty`] = 'A whole number, at least 1.'; return; }
    if (seen.has(kit || sku)) { fields[`items.${n}.sku_code`] = 'Already on this standing order. Change the quantity there.'; return; }
    seen.add(kit || sku); lines.push({ sku_code: kit ? null : sku, kit_key: kit || null, qty });
  });
  if (!lines.length) fields['items.0.sku_code'] = 'Add at least one item.';
  if (Object.keys(fields).length) fail(fields);
  const who = await whoOf(q, custId, null);
  if (who.customer.status === 'blocked') fail({ customer_id: `Blocked: ${who.customer.hold_reason || ''}`.trim() });
  for (const [n, l] of lines.entries()) {
    if (l.sku_code) {
      const [[s]] = await q.query("SELECT s.packs_per_carton, s.min_order_qty, s.sell_unit, s.sku_code, s.status, s.is_active FROM skus s WHERE s.sku_code = ? AND s.sku_type <> 'raw'", [l.sku_code]);
      if (!s || !Number(s.is_active) || s.status !== 'active') { fields[`items.${n}.sku_code`] = `${l.sku_code} is not for sale.`; continue; }
      const bad = pricing.qtyProblem(s, l.qty); if (bad) fields[`items.${n}.qty`] = bad;
    } else if (!(await commerce.kitOf(q, l.kit_key))) fields[`items.${n}.sku_code`] = 'Unknown kit.';
  }
  if (Object.keys(fields).length) fail(fields);
  const godown = Number(b.godown_id) || who.customer.godown_id;
  const status = id && b.status === 'paused' ? 'paused' : 'active';
  const next = firstRun(every, runDay, from);
  let sid = id ? Number(id) : null;
  if (sid) {
    const [[had]] = await q.query('SELECT standing_id FROM standing_orders WHERE standing_id = ? FOR UPDATE', [sid]);
    if (!had) throw new SalesError('Standing order not found', 404);
    await q.query('UPDATE standing_orders SET customer_id = ?, godown_id = ?, every = ?, run_day = ?, starts_on = ?, ends_on = ?, next_on = ?, status = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE standing_id = ?',
      [custId, godown, every, runDay, from, until, next, status, empId, sid]);
    await q.query('DELETE FROM standing_order_lines WHERE standing_id = ?', [sid]);
  } else {
    const [ins] = await q.query('INSERT INTO standing_orders (customer_id, godown_id, every, run_day, starts_on, ends_on, next_on, status, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [custId, godown, every, runDay, from, until, next, status, empId]);
    sid = ins.insertId;
  }
  for (const [i, l] of lines.entries()) await q.query('INSERT INTO standing_order_lines (standing_id, sort_order, sku_code, kit_key, qty) VALUES (?, ?, ?, ?, ?)', [sid, i, l.sku_code, l.kit_key, l.qty]);
  const when = stoWhen({ every, run_day: runDay });
  await audit(q, { empId, action: id ? 'update' : 'create', entity: 'standing_order', entityId: stoNo(sid), after: { customer: who.customer.customer_no, when, from, until, next, status, lines: lines.map((l) => `${l.qty} x ${l.sku_code || l.kit_key}`) } });
  return { standing_id: sid, sto_no: stoNo(sid), next_on: next, when };
}

/** every standing order due today or earlier: an order each (draft or confirmed: switch), the next date moved on */
async function runStanding(q, empId, { scope = null, admin = null } = {}) {
  const sw = await commerce.orderSwitches(q);
  const [due] = await q.query(`SELECT s.standing_id, s.customer_id, s.godown_id, s.every, s.run_day, DATE_FORMAT(s.next_on, '%Y-%m-%d') AS next_on, DATE_FORMAT(s.ends_on, '%Y-%m-%d') AS ends_on, c.status AS cstatus, c.name
      FROM standing_orders s JOIN customers c ON c.customer_id = s.customer_id WHERE s.status = 'active' AND s.next_on <= ? AND (s.ends_on IS NULL OR s.next_on <= s.ends_on) ${scope ? `AND ${scope}` : ''} ORDER BY s.next_on, s.standing_id FOR UPDATE`, [today()]);
  const made = []; const skipped = [];
  for (const s of due) {
    let next = nextRun(s.every, s.run_day, s.next_on);
    while (next <= today()) next = nextRun(s.every, s.run_day, next);
    await q.query('UPDATE standing_orders SET next_on = ? WHERE standing_id = ?', [next, s.standing_id]);
    if (s.cstatus === 'blocked' || s.cstatus === 'merged') { skipped.push(`${stoNo(s.standing_id)} ${s.name} (blocked)`); continue; }
    const [ls] = await q.query('SELECT sku_code, kit_key, qty FROM standing_order_lines WHERE standing_id = ? ORDER BY sort_order', [s.standing_id]);
    const items = ls.map((l) => (l.kit_key ? { kit_key: l.kit_key, qty: Number(l.qty) } : { sku_code: l.sku_code, qty: Number(l.qty) }));
    try {
      const o = await commerce.createOrder(q, { customer_id: s.customer_id, items, draft: !sw.standingConfirm, standing_id: s.standing_id, note: `From standing order ${stoNo(s.standing_id)}` }, empId, { admin });
      made.push({ order_no: o.order_no, status: o.status, sto_no: stoNo(s.standing_id), next_on: next });
      await audit(q, { empId, action: 'run', entity: 'standing_order', entityId: stoNo(s.standing_id), before: { next_on: s.next_on }, after: { order: o.order_no, status: o.status, next_on: next } });
    } catch (e) {
      if (!(e instanceof commerce.CommerceError)) throw e;
      skipped.push(`${stoNo(s.standing_id)} ${s.name}: ${e.message}`);
      await audit(q, { empId, action: 'run_failed', entity: 'standing_order', entityId: stoNo(s.standing_id), after: { reason: e.message, next_on: next } });
    }
  }
  return { made, skipped };
}

// ---------------------------------------------------------------- calls, follow-ups and samples (enquiries and customers)
/**
 * Log a call. b = { lead_id | customer_id, how, note, next_on (empty: nothing more), sample_sku }.
 * An enquiry: the first call is its first reply; New becomes Contacted; nobody's becomes yours.
 */
async function logCall(q, b, empId) {
  const fields = {};
  const leadId = b.lead_id ? Number(b.lead_id) : null;
  let custId = b.customer_id ? Number(b.customer_id) : null;
  if (!leadId && !custId) fields.who = 'Choose the enquiry or customer.';
  if (!CALL_HOW[b.how]) fields.how = 'Choose how.';
  const note = String(b.note || '').trim().slice(0, 300);
  if (note.length < 3) fields.note = 'Write what was said, so the next person knows.';
  const next = String(b.next_on || '') || null;
  if (next && (!pricing.isDate(next) || next < today())) fields.next_on = 'The next call cannot be in the past.';
  if (Object.keys(fields).length) fail(fields);
  let lead = null;
  if (leadId) {
    [[lead]] = await q.query('SELECT lead_id, lead_ref, status, assigned_to, first_reply_at FROM leads WHERE lead_id = ? FOR UPDATE', [leadId]);
    if (!lead) throw new SalesError('Enquiry not found', 404);
    const [[c]] = await q.query('SELECT customer_id FROM customers WHERE lead_id = ? AND merged_into IS NULL', [leadId]);
    if (c) custId = c.customer_id;
  }
  const kind = { call: 'call', whatsapp: 'whatsapp', visit: 'visit', sample: 'note', mail: 'mail' }[b.how];
  const [ins] = await q.query('INSERT INTO customer_activity (customer_id, lead_id, kind, happened_at, note, emp_id) VALUES (?, ?, ?, UTC_TIMESTAMP(), ?, ?)', [custId, leadId, kind, `${CALL_HOW[b.how]}: ${note}`.slice(0, 2000), empId]);
  // the next call: the open follow-up of this enquiry or customer is done, a new one is due
  await q.query(`UPDATE follow_ups SET status = 'done', done_at = UTC_TIMESTAMP(), done_by = ?, done_note = ? WHERE status = 'open' AND ${leadId ? 'lead_id = ?' : 'customer_id = ? AND lead_id IS NULL'}`, [empId, note.slice(0, 255), leadId || custId]);
  if (next) await q.query('INSERT INTO follow_ups (customer_id, lead_id, assignee, due_on, note, created_by) VALUES (?, ?, ?, ?, ?, ?)', [custId, leadId, lead && lead.assigned_to ? lead.assigned_to : empId, next, note.slice(0, 255), empId]);
  if (lead) {
    await q.query(`UPDATE leads SET first_reply_at = COALESCE(first_reply_at, UTC_TIMESTAMP()), status = IF(status = 'new', 'contacted', status), assigned_to = COALESCE(assigned_to, ?), updated_at = UTC_TIMESTAMP() WHERE lead_id = ?`, [empId, leadId]);
  }
  let sample = null;
  if (b.sample_sku) {
    const [[s]] = await q.query("SELECT sku_code FROM skus WHERE sku_code = ? AND sku_type <> 'raw' AND is_active = 1", [String(b.sample_sku)]);
    if (!s) fail({ sample_sku: 'Choose a pack.' });
    const [si] = await q.query('INSERT INTO samples (lead_id, customer_id, sku_code, qty, emp_id) VALUES (?, ?, ?, 1, ?)', [leadId, custId, s.sku_code, empId]);
    sample = `SMP-${String(si.insertId).padStart(4, '0')}`;
  }
  await audit(q, { empId, action: 'call', entity: leadId ? 'lead' : 'customer', entityId: lead ? lead.lead_ref : String(custId), after: { how: b.how, note: note.slice(0, 120), next_on: next, sample } });
  return { activity_id: ins.insertId, next_on: next, sample, how: CALL_HOW[b.how] };
}

async function sampleStep(q, id, to, feedback, empId) {
  const [[s]] = await q.query('SELECT sample_id, status FROM samples WHERE sample_id = ? FOR UPDATE', [Number(id)]);
  if (!s) throw new SalesError('Sample not found', 404);
  const ok = { sent: ['to_send'], ordered: ['sent'], no: ['sent'] };
  if (!ok[to] || !ok[to].includes(s.status)) throw new SalesError('Not at this step', 409);
  await q.query(`UPDATE samples SET status = ?, ${to === 'sent' ? 'sent_on = ?,' : ''} feedback = COALESCE(?, feedback), updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE sample_id = ?`,
    to === 'sent' ? [to, today(), feedback || null, empId, s.sample_id] : [to, feedback || null, empId, s.sample_id]);
  await audit(q, { empId, action: `sample_${to}`, entity: 'sample', entityId: `SMP-${String(s.sample_id).padStart(4, '0')}`, before: { status: s.status }, after: { status: to, feedback: feedback || null } });
  return { status: to };
}

/** an enquiry is lost (a reason from the list) or spam */
async function leadClose(q, leadId, how, reason, empId) {
  const [[l]] = await q.query('SELECT lead_id, lead_ref, status FROM leads WHERE lead_id = ? FOR UPDATE', [Number(leadId)]);
  if (!l) throw new SalesError('Enquiry not found', 404);
  if (!['new', 'contacted', 'qualified'].includes(l.status)) throw new SalesError(`${l.lead_ref} is ${l.status}`, 409);
  if (how === 'lost' && !LOST_WHY.includes(String(reason || ''))) fail({ lost_reason: 'Say why it was lost. It shows in the sales report.' });
  await q.query("UPDATE leads SET status = ?, lost_reason = ?, updated_at = UTC_TIMESTAMP() WHERE lead_id = ?", [how === 'lost' ? 'lost' : 'spam', how === 'lost' ? reason : null, l.lead_id]);
  await q.query("UPDATE follow_ups SET status = 'done', done_at = UTC_TIMESTAMP(), done_by = ?, done_note = ? WHERE lead_id = ? AND status = 'open'", [empId, how === 'lost' ? `Lost: ${reason}` : 'Spam', l.lead_id]);
  await audit(q, { empId, action: how, entity: 'lead', entityId: l.lead_ref, before: { status: l.status }, after: { status: how === 'lost' ? 'lost' : 'spam', reason: how === 'lost' ? reason : null } });
  return { status: how === 'lost' ? 'lost' : 'spam' };
}

module.exports = {
  staffNames, SalesError, QT_STATUS, QT_LOST, QT_KINDS, CALL_HOW, LOST_WHY, EVERY, DAYS, qState, leadType, whoOf, priceLines, quoteTotals, quoteNeeds, quoteRow, quoteLines, kitPrices,
  saveQuote, previewQuote, lostQuote, quoteToOrder, stoNo, firstRun, nextRun, stoWhen, saveStanding, runStanding, logCall, sampleStep, leadClose, addDays, customers, commerceSettings,
};
