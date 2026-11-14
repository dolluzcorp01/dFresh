// Section 17 Expenses and petty cash (phase 23, v23 "SECTION 17 EXPENSES AND ACCOUNTING EXPORT - RULES"; migration
// 20261113_stage2_23_02_expenses_export.sql; the screens' API in expenses-routes.js).
// - An expense: date, godown, head, payee, amount without GST, GST %, the payee's GSTIN, how it was paid, reference, note,
//   a bill photo. Its GST is input credit only with a GSTIN and a head that allows it (an IGST bill when the GSTIN is of
//   another state than the godown). Above the rule "Expense above the limit" (counted per payee within the split days)
//   it waits for a second person; so does a new payee, once. It posts when every request on it is signed.
// - Payees (v23 L1): one per tax ID (the PAN, or the PAN inside a GSTIN); a name already on the list, or a PAN known
//   under another name, is that payee. A new name close to one on the list (two letters apart, or sharing a name word
//   such as "Ravi" in "Sri Ravi Traders") is refused: pick the one on the list. A new payee is on the list once approved.
// - A month exported to the CA is locked (books.js): no expense is dated in it; cancelling one there needs "Change after
//   export" first (v23 17.4).
// - Petty cash: a box per godown. A petty cash expense is spent from it when it posts; what waits for approval is kept
//   aside (it cannot be spent twice). Top-ups wait for approval; a count records the difference (above Rs 100 an alert).
// - Freight in (v23 Y6): an expense on the head "Freight in on a purchase" names its PO. When it posts, the freight billed
//   on the PO (supplier bills and transporter bills, part bills too) replaces the estimate in cost, spread over the PO's
//   goods in by value (switch "Freight goes into the average cost"); a cancelled transporter bill is taken out again.
// - Repeating expenses make drafts when they fall due ("Make the drafts"); a draft is checked, saved, then posts as above.
const { audit } = require('./audit');
const approvals = require('./approvals');
const books = require('./books');
const istDates = require('../shared/istDate'); // India dates in one place (src/shared/istDate.js)
const buying = require('./buying');
const numbering = require('./numbering');
const pricing = require('./pricing');

class ExpenseError extends Error {
  constructor(message, status = 400, fields = null) { super(message); this.status = status; if (fields) { this.code = 'fields'; this.fields = fields; } }
}
const fail = (fields) => { throw new ExpenseError(Object.values(fields)[0], 400, fields); };
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const MODES = { bank: 'Bank transfer', upi: 'UPI', cash: 'Cash', cheque: 'Cheque', petty: 'From petty cash' };
const GST_RATES = [0, 5, 12, 18, 28];
const STATUS = { draft: 'Draft', waiting: 'Waiting for approval', done: 'Recorded', rejected: 'Sent back', cancelled: 'Cancelled' };
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}\d{4}[A-Z]$/;

// ---------------------------------------------------------------- payees
const payeeKey = (n) => String(n || '').toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(es|s)$/, '');
const GENERIC = ['traders', 'trader', 'enterprises', 'enterprise', 'stores', 'store', 'agency', 'agencies', 'services', 'service', 'company', 'pvt', 'ltd', 'limited',
  'and', 'the', 'sri', 'shri', 'chennai', 'kanchipuram', 'india', 'industries', 'works', 'mart', 'centre', 'center', 'co'];
const words = (n) => String(n || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !GENERIC.includes(w) && !GENERIC.includes(w.replace(/s$/, '')));
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const panOf = (gstin, pan) => (pan ? String(pan).toUpperCase() : (gstin && String(gstin).length === 15 ? String(gstin).toUpperCase().slice(2, 12) : '')) || null;

/** the payee list: approved payees and the suppliers whose bank account is approved -> [{ payee_id, supplier_id, name, pan }] */
async function payeeList(q) {
  const [p] = await q.query("SELECT payee_id, NULL AS supplier_id, name, pan, gstin FROM payees WHERE status = 'approved'");
  const [s] = await q.query("SELECT NULL AS payee_id, supplier_id, name, NULL AS pan, gstin FROM suppliers WHERE status <> 'blocked'");
  const seen = new Set(); const out = [];
  for (const x of [...p, ...s.map((y) => ({ ...y, pan: panOf(y.gstin) }))]) { const k = payeeKey(x.name); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
/**
 * who is paid: { name, isNew (ticked "New payee"), pan, gstin } -> { payee (a row on the list) } or { fresh: true } for a
 * new payee; throws for a look-alike (v23 L1) or a new name not ticked as new
 */
async function payeeOf(q, { name, isNew, pan, gstin }) {
  const n = String(name || '').trim().replace(/\s+/g, ' ');
  if (n.length < 3) fail({ payee: 'Who was paid? (at least 3 letters)' });
  const list = await payeeList(q);
  const k = payeeKey(n);
  const same = list.find((x) => payeeKey(x.name) === k);
  if (same) return { payee: same };
  const p = panOf(gstin, pan);
  if (p) {
    const byPan = list.find((x) => x.pan === p);
    if (byPan) fail({ payee: `That PAN (${p}) is "${byPan.name}" on the list: pick it.` });
  }
  const [[waiting]] = await q.query("SELECT name FROM payees WHERE status = 'pending' AND (name_key = ? OR (pan IS NOT NULL AND pan = ?))", [k, p || '-']);
  if (waiting) fail({ payee: `"${waiting.name}" is waiting for its first approval: it can be paid once a second person signs it.` });
  const near = list.find((x) => { const kx = payeeKey(x.name); return kx.length > 3 && k.length > 3 && lev(kx, k) <= 2; });
  const w = words(n);
  // a name sharing a word with one on the list is that payee, unless it brings its own tax ID (another business)
  const like = near || (p ? null : list.find((x) => words(x.name).some((y) => w.includes(y))));
  if (!isNew) fail({ payee: `Not on the list. Pick a payee, or tick "New payee" to add one.${like ? ` (Looks like "${like.name}" on the list: pick it if it is the same.)` : ''}` });
  if (like) fail({ payee: `Looks like "${like.name}" on the list. One payee, one name: pick it.${near ? '' : ' (A different business sharing a name word: give its PAN or GSTIN.)'}` });
  return { fresh: true, name: n, pan: p };
}

// ---------------------------------------------------------------- expenses
async function headOf(q, key) {
  const [[h]] = await q.query('SELECT head_key, name, itc, ledger, for_po FROM expense_heads WHERE head_key = ? AND is_active = 1', [String(key || '')]);
  return h ? { ...h, itc: Number(h.itc) === 1, for_po: Number(h.for_po) === 1 } : null;
}
async function pettyBalance(q, godownId) {
  const [[b]] = await q.query("SELECT COALESCE(SUM(amount), 0) AS n FROM petty_moves WHERE godown_id = ? AND status = 'done'", [Number(godownId)]);
  return r2(b.n);
}
/** the box less petty cash expenses still waiting (never spent twice) */
async function pettyFree(q, godownId, exceptId = 0) {
  const [[w]] = await q.query("SELECT COALESCE(SUM(total), 0) AS n FROM expenses WHERE godown_id = ? AND mode = 'petty' AND status = 'waiting' AND expense_id <> ?", [Number(godownId), Number(exceptId) || 0]);
  return r2((await pettyBalance(q, godownId)) - Number(w.n));
}

/** the form -> checked values (fields errors as v23's form) */
async function valuesOf(q, b, scope) {
  const errs = {};
  const today = pricing.istToday();
  const date = String(b.date || '').slice(0, 10);
  if (!pricing.isDate(date) || date > today) errs.date = 'Today or earlier.';
  else { const why = await books.lockWhy(q, date); if (why) errs.date = /exported/.test(why) ? `${date.slice(0, 7)} is exported to the CA. Use a date in an open month.` : why; }
  const godown = Number(b.godown_id);
  const [[g]] = godown ? await q.query('SELECT location_id FROM locations WHERE location_id = ? AND is_active = 1', [godown]) : [[null]];
  if (!g && !errs.godown_id) errs.godown_id = 'Choose the godown.';
  else if (scope !== 'ALL' && Array.isArray(scope) && !scope.includes(godown)) errs.godown_id = 'You do not work at that godown.';
  const head = await headOf(q, b.head_key);
  if (!head) errs.head_key = 'Choose the head.';
  let poId = null;
  if (head && head.for_po) {
    const [[po]] = b.po_no ? await q.query("SELECT po_id FROM purchase_orders WHERE po_no = ? AND status NOT IN ('draft', 'cancelled', 'rejected')", [String(b.po_no)]) : [[null]];
    if (!po) errs.po_no = 'Pick the purchase order this freight was for.'; else poId = po.po_id;
  }
  const amtS = String(b.amount ?? '').trim();
  const amount = r2(Number(amtS));
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(amtS) || amount <= 0) errs.amount = 'More than 0, like 1200 or 1200.50.';
  const gstRate = Number(b.gst_rate || 0);
  if (!GST_RATES.includes(gstRate)) errs.gst_rate = 'GST: 0, 5, 12, 18 or 28 %.';
  const gstin = String(b.gstin || '').trim().toUpperCase() || null;
  if (gstin && !GSTIN_RE.test(gstin)) errs.gstin = 'A GSTIN has 15 characters, like 33ABCDE1234F1Z5.';
  const pan = String(b.pan || '').trim().toUpperCase() || null;
  if (pan && !PAN_RE.test(pan)) errs.pan = 'A PAN has 10 characters, like ABCDE1234F.';
  if (pan && gstin && GSTIN_RE.test(gstin) && gstin.slice(2, 12) !== pan) errs.pan = 'The PAN does not match the GSTIN.';
  const mode = MODES[b.mode] ? b.mode : null;
  if (!mode) errs.mode = 'How was it paid?';
  const reference = String(b.reference || '').trim().slice(0, 40) || null;
  if (['bank', 'upi', 'cheque'].includes(mode) && (!reference || reference.length < 4)) errs.reference = 'The UTR, UPI or cheque number.';
  let payee = null;
  try { payee = await payeeOf(q, { name: b.payee, isNew: Boolean(b.new_payee), pan, gstin }); } catch (e) { if (e.fields) Object.assign(errs, e.fields); else throw e; }
  if (Object.keys(errs).length) fail(errs);
  const gstAmount = r2((amount * gstRate) / 100);
  const gd = await buying.godownOf(q, godown);
  return { date, godown, head, poId, amount, gstRate, gstAmount, total: r2(amount + gstAmount), gstin, pan, mode, reference, payee,
    itc: gstRate > 0 && Boolean(gstin) && head.itc, inter: Boolean(gstin && gd && gd.state_code && gstin.slice(0, 2) !== gd.state_code),
    note: String(b.note || '').trim().slice(0, 120) || null };
}

/** the requests an expense needs: a new payee, and above the money limit -> [kinds] */
async function needs(q, v, empId) {
  const out = [];
  if (v.payee.fresh && await approvals.needed(q, 'payee_new', {})) out.push('payee_new');
  if (await approvals.needed(q, 'expense', { amount: v.total, target: `payee:${payeeKey(v.payee.fresh ? v.payee.name : v.payee.payee.name)}`, by: empId })) out.push('expense');
  return out;
}

/**
 * save a new expense, or a draft / sent back one again -> { expense_no, status, message }
 * b: { date, godown_id, head_key, po_no, payee, new_payee, pan, gstin, amount, gst_rate, mode, reference, note }
 */
async function save(q, b, empId, { scope = 'ALL', expenseId = null, photo = null } = {}) {
  let before = null;
  if (expenseId) {
    [[before]] = await q.query('SELECT expense_id, expense_no, status, repeat_id FROM expenses WHERE expense_id = ? FOR UPDATE', [Number(expenseId)]);
    if (!before) throw new ExpenseError('No such expense', 404);
    if (!['draft', 'rejected'].includes(before.status)) throw new ExpenseError(`${before.expense_no || 'This expense'} is ${STATUS[before.status]}: only a draft or one sent back is changed`, 409);
  }
  const v = await valuesOf(q, b, scope);
  if (v.mode === 'petty') {
    const free = await pettyFree(q, v.godown, expenseId || 0);
    if (v.total > free + 0.004) fail({ mode: `Petty cash at this godown has only ${rs(free)} free now, not ${rs(v.total)}. Ask for a top-up first.` });
  }
  let payeeId = v.payee.fresh ? null : v.payee.payee.payee_id;
  if (v.payee.fresh) {
    const [p] = await q.query('INSERT INTO payees (name, name_key, pan, gstin, status, created_by) VALUES (?, ?, ?, ?, ?, ?)', [v.payee.name, payeeKey(v.payee.name), v.payee.pan, v.gstin, 'pending', empId]);
    payeeId = p.insertId;
  }
  const payeeName = v.payee.fresh ? v.payee.name : v.payee.payee.name;
  const cols = { exp_date: v.date, godown_id: v.godown, head_key: v.head.head_key, payee_id: payeeId, payee_name: payeeName, amount: v.amount, gst_rate: v.gstRate, gst_amount: v.gstAmount,
    total: v.total, gstin: v.gstin, itc: v.itc ? 1 : 0, inter_state: v.inter ? 1 : 0, mode: v.mode, reference: v.reference, note: v.note, po_id: v.poId };
  let id = expenseId ? Number(expenseId) : null;
  if (id) await q.query(`UPDATE expenses SET ${Object.keys(cols).map((k) => `${k} = ?`).join(', ')}, status = 'waiting', rej_note = NULL WHERE expense_id = ?`, [...Object.values(cols), id]);
  else {
    const [ins] = await q.query(`INSERT INTO expenses (${Object.keys(cols).join(', ')}, status, created_by) VALUES (${Object.keys(cols).map(() => '?').join(', ')}, 'waiting', ?)`, [...Object.values(cols), empId]);
    id = ins.insertId;
  }
  if (photo) await q.query('UPDATE expenses SET photo = ?, photo_type = ? WHERE expense_id = ?', [photo.buffer, photo.mimetype, id]);
  const no = (before && before.expense_no) || await numbering.issue(q, 'expense', null, new Date(`${v.date}T06:30:00Z`));
  await q.query('UPDATE expenses SET expense_no = ? WHERE expense_id = ?', [no, id]);
  const kinds = await needs(q, v, empId);
  const ids = [];
  for (const k of kinds) {
    const summary = k === 'payee_new' ? `New payee "${payeeName}"${v.pan ? ` (PAN ${v.pan})` : ''} on ${no}: ${v.head.name}, ${rs(v.total)}`
      : `${no}: ${v.head.name}, ${payeeName}, ${rs(v.total)}${v.gstAmount ? ` (GST ${rs(v.gstAmount)})` : ''} by ${MODES[v.mode].toLowerCase()}`;
    const aid = await approvals.request(q, { kind: k, godownId: v.godown, target: k === 'expense' ? `payee:${payeeKey(payeeName)}` : null, refType: 'expense', refId: no, recordDate: v.date,
      amount: k === 'expense' ? v.total : null, summary, payload: { expense_id: id, payee_id: payeeId } }, empId);
    ids.push(aid);
    if (k === 'payee_new') await q.query('UPDATE payees SET approval_id = ? WHERE payee_id = ?', [aid, payeeId]);
  }
  await q.query('UPDATE expenses SET approval_id = ? WHERE expense_id = ?', [ids[ids.length - 1] || null, id]);
  await audit(q, { empId, action: expenseId ? 'update' : 'create', entity: 'expense', entityId: no, after: { ...cols, waits: kinds } });
  if (!kinds.length) {
    if (v.payee.fresh) await q.query("UPDATE payees SET status = 'approved', approved_by = ? WHERE payee_id = ?", [empId, payeeId]);
    await approvals.direct(q, 'expense', { amount: v.total, target: `payee:${payeeKey(payeeName)}` }, empId);
    await post(q, id, empId);
    return { expense_id: id, expense_no: no, status: 'done', total: v.total, message: `${no} recorded: ${rs(v.total)}.` };
  }
  const labels = kinds.map((k) => approvals.KINDS[k].label);
  return { expense_id: id, expense_no: no, status: 'waiting', total: v.total, approval_ids: ids, message: `${no} saved, ${rs(v.total)}. Waiting for approval: ${labels.join(', ')}.` };
}

/** the expense goes into the books: petty cash spent, freight in into the PO's cost */
async function post(q, expenseId, empId) {
  const [[e]] = await q.query("SELECT expense_id, expense_no, exp_date, godown_id, mode, total, po_id, status FROM expenses WHERE expense_id = ? FOR UPDATE", [expenseId]);
  if (!e || e.status === 'done') return;
  await books.assertOpen(q, istDates.ymd(e.exp_date));
  await q.query("UPDATE expenses SET status = 'done', done_at = UTC_TIMESTAMP(), done_by = ? WHERE expense_id = ?", [empId, expenseId]);
  if (e.mode === 'petty') {
    await q.query("INSERT INTO petty_moves (godown_id, move_date, kind, amount, ref, expense_id, emp_id) VALUES (?, ?, 'spend', ?, ?, ?, ?)", [e.godown_id, e.exp_date, -Number(e.total), e.expense_no, e.expense_id, empId]);
  }
  if (e.po_id) await freightTrueUp(q, e.po_id, { type: 'expense', id: e.expense_id, godown: e.godown_id, date: istDates.ymd(e.exp_date) }, empId);
  await audit(q, { empId, action: 'post', entity: 'expense', entityId: e.expense_no, after: { total: Number(e.total), mode: e.mode } });
}

/**
 * v23 Y6: the freight billed on a PO (supplier bills + transporter bills, without GST) replaces what is in cost, spread
 * over the PO's accepted goods by value (only with the switch "Freight goes into the average cost")
 */
async function freightTrueUp(q, poId, src, empId) {
  const st = await buying.settings(q);
  if (!st.freightCost) return [];
  const p = await buying.poOf(q, poId, true);
  const billed = r2(await buying.freightBilled(q, poId));
  const extra = r2(billed - Number(p.freight_cost));
  await q.query('UPDATE purchase_orders SET freight_billed = 1, freight_sep = 1, freight_cost = ? WHERE po_id = ?', [billed, poId]);
  if (Math.abs(extra) < 0.005) return [];
  const adj = (await buying.poFreightAdj(q, p, extra)).map((x) => ({ ...x, why: 'transporter freight bill against the PO' }));
  return buying.costApply(q, src, adj, empId);
}

/** cancel a recorded expense (Cancel right); a month with the CA asks "Change after export" first */
async function cancel(q, expenseId, reason, empId) {
  const why = String(reason || '').trim().slice(0, 120);
  if (why.length < 4) fail({ reason: 'Say why (at least 4 letters).' });
  const [[e]] = await q.query("SELECT expense_id, expense_no, exp_date, godown_id, mode, total, po_id, status FROM expenses WHERE expense_id = ? FOR UPDATE", [Number(expenseId)]);
  if (!e) throw new ExpenseError('No such expense', 404);
  if (e.status !== 'done') throw new ExpenseError(`${e.expense_no} is ${STATUS[e.status]}: only a recorded expense is cancelled`, 409);
  const d = istDates.ymd(e.exp_date);
  await books.guardRecord(q, { date: d, key: `expense:${e.expense_no}`, label: `Cancel expense ${e.expense_no}`, godownId: e.godown_id }, empId);
  await q.query("UPDATE expenses SET status = 'cancelled', cancel_reason = ? WHERE expense_id = ?", [why, e.expense_id]);
  if (e.mode === 'petty') await q.query("INSERT INTO petty_moves (godown_id, move_date, kind, amount, ref, expense_id, emp_id) VALUES (?, ?, 'spend', ?, ?, ?, ?)", [e.godown_id, pricing.istToday(), Number(e.total), `${e.expense_no} cancelled`, e.expense_id, empId]);
  if (e.po_id) await freightTrueUp(q, e.po_id, { type: 'expense', id: e.expense_id, godown: e.godown_id, date: pricing.istToday() }, empId);
  await audit(q, { empId, action: 'cancel', entity: 'expense', entityId: e.expense_no, after: { reason: why } });
  return { expense_no: e.expense_no, status: 'cancelled', message: `${e.expense_no} cancelled.` };
}

// approvals: the expense posts when every request on it is signed; one not signed sends it back
async function decided(q, p, empId) {
  if (!p || !p.expense_id) return;
  if (p.payee_id) {
    const [[pend]] = await q.query("SELECT 1 FROM approvals WHERE kind = 'payee_new' AND status = 'approved' AND JSON_EXTRACT(payload, '$.payee_id') = ?", [p.payee_id]);
    if (pend) await q.query("UPDATE payees SET status = 'approved', approved_by = ? WHERE payee_id = ? AND status = 'pending'", [empId, p.payee_id]);
  }
  const [[e]] = await q.query('SELECT expense_no, status FROM expenses WHERE expense_id = ?', [p.expense_id]);
  if (!e || e.status !== 'waiting') return;
  const [[left]] = await q.query("SELECT COUNT(*) AS n FROM approvals WHERE ref_type = 'expense' AND ref_id = ? AND status = 'pending'", [e.expense_no]);
  if (Number(left.n) === 0) await post(q, p.expense_id, empId);
}
async function closed(q, p, status, empId) {
  if (!p || !p.expense_id) return;
  const [[e]] = await q.query('SELECT expense_no, status FROM expenses WHERE expense_id = ?', [p.expense_id]);
  if (!e || e.status !== 'waiting') return;
  const [others] = await q.query("SELECT approval_id FROM approvals WHERE ref_type = 'expense' AND ref_id = ? AND status = 'pending'", [e.expense_no]);
  for (const o of others) await q.query("UPDATE approvals SET status = 'withdrawn', decided_by = ?, decided_at = UTC_TIMESTAMP(), note = 'Closed with the other check' WHERE approval_id = ?", [empId, o.approval_id]);
  const name = await require('./inventory').nameOf(q, empId); // eslint-disable-line global-require
  await q.query("UPDATE expenses SET status = 'rejected', rej_note = ? WHERE expense_id = ?", [`Not approved: ${status} by ${name}`.slice(0, 255), p.expense_id]);
  if (p.payee_id) await q.query("UPDATE payees SET status = 'rejected' WHERE payee_id = ? AND status = 'pending'", [p.payee_id]);
}
for (const k of ['expense', 'payee_new']) { approvals.onApproved(k, decided); approvals.onClosed(k, closed); }
approvals.onRecheck('expense', async (q, p) => {
  const [[e]] = await q.query('SELECT godown_id, mode, total, exp_date FROM expenses WHERE expense_id = ?', [p.expense_id]);
  if (!e) return 'the expense is gone';
  if (e.mode === 'petty') { const free = await pettyFree(q, e.godown_id, p.expense_id); if (Number(e.total) > free + 0.004) return `Petty cash has only ${rs(free)} free now, not ${rs(e.total)}. Top it up first.`; }
  return books.lockWhy(q, istDates.ymd(e.exp_date));
});

// ---------------------------------------------------------------- repeating expenses
function nextMonthDay(d, day) {
  let y = Number(d.slice(0, 4)); let m = Number(d.slice(5, 7)) + 1;
  if (m > 12) { m = 1; y += 1; }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}
async function repeatsDue(q, scope = 'ALL') {
  const [rows] = await q.query(`SELECT r.repeat_id, r.head_key, h.name AS head, r.payee_id, r.payee_name, r.amount, r.gst_rate, r.gstin, r.mode, r.godown_id, r.day_of_month,
      DATE_FORMAT(r.next_date, '%Y-%m-%d') AS next_date FROM expense_repeats r JOIN expense_heads h ON h.head_key = r.head_key WHERE r.is_active = 1 AND r.next_date <= ? ORDER BY r.next_date, r.repeat_id`, [pricing.istToday()]);
  return rows.filter((r) => scope === 'ALL' || scope.includes(Number(r.godown_id))).map((r) => ({ ...r, code: `REP-${String(r.repeat_id).padStart(2, '0')}`, amount: Number(r.amount), gst_rate: Number(r.gst_rate) }));
}
/** a draft for each repeating expense that is due; the repeat moves to its next date -> [{ expense_no, ... }] */
async function makeDrafts(q, scope, empId) {
  const out = [];
  for (const r of await repeatsDue(q, scope)) {
    const gst = r2((r.amount * r.gst_rate) / 100);
    const [h] = await q.query('SELECT itc FROM expense_heads WHERE head_key = ?', [r.head_key]);
    const [ins] = await q.query(`INSERT INTO expenses (exp_date, godown_id, head_key, payee_id, payee_name, amount, gst_rate, gst_amount, total, gstin, itc, mode, note, repeat_id, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`, [r.next_date, r.godown_id, r.head_key, r.payee_id, r.payee_name, r.amount, r.gst_rate, gst, r2(r.amount + gst), r.gstin,
      r.gst_rate > 0 && r.gstin && h[0] && Number(h[0].itc) ? 1 : 0, r.mode, `Repeats every month (${r.code})`, r.repeat_id, empId]);
    const no = await numbering.issue(q, 'expense', null, new Date(`${r.next_date}T06:30:00Z`));
    await q.query('UPDATE expenses SET expense_no = ? WHERE expense_id = ?', [no, ins.insertId]);
    const next = nextMonthDay(r.next_date, r.day_of_month);
    await q.query('UPDATE expense_repeats SET next_date = ? WHERE repeat_id = ?', [next, r.repeat_id]);
    out.push({ expense_no: no, head: r.head, total: r2(r.amount + gst), repeat: r.code, next });
  }
  return out;
}
async function saveRepeat(q, b, empId, scope) {
  const errs = {};
  const head = await headOf(q, b.head_key);
  if (!head) errs.head_key = 'Choose the head.';
  const amount = r2(Number(b.amount));
  if (!(amount > 0)) errs.amount = 'More than 0.';
  const day = Number(b.day_of_month);
  if (!Number.isInteger(day) || day < 1 || day > 31) errs.day_of_month = 'A day of the month, 1 to 31.';
  const next = String(b.next_date || '').slice(0, 10);
  if (!pricing.isDate(next)) errs.next_date = 'The first date.';
  const godown = Number(b.godown_id);
  if (!godown || (scope !== 'ALL' && !scope.includes(godown))) errs.godown_id = 'Choose your godown.';
  if (!MODES[b.mode]) errs.mode = 'How is it paid?';
  const gstRate = Number(b.gst_rate || 0); if (!GST_RATES.includes(gstRate)) errs.gst_rate = 'GST: 0, 5, 12, 18 or 28 %.';
  let payee = null;
  try { payee = await payeeOf(q, { name: b.payee, isNew: false, gstin: b.gstin }); } catch (e) { if (e.fields) Object.assign(errs, e.fields); else throw e; }
  if (Object.keys(errs).length) fail(errs);
  const [ins] = await q.query(`INSERT INTO expense_repeats (head_key, payee_id, payee_name, amount, gst_rate, gstin, mode, godown_id, day_of_month, next_date, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [head.head_key, payee.payee.payee_id, payee.payee.name, amount, gstRate, String(b.gstin || '').toUpperCase() || null, b.mode, godown, day, next, empId]);
  await audit(q, { empId, action: 'create', entity: 'expense_repeat', entityId: String(ins.insertId), after: { head: head.head_key, amount, day } });
  return { repeat_id: ins.insertId, code: `REP-${String(ins.insertId).padStart(2, '0')}` };
}

// ---------------------------------------------------------------- petty cash
/** set a box's float (first time: the opening float goes in) */
async function setFloat(q, godownId, amount, empId) {
  const a = r2(Number(amount));
  if (!(a > 0)) fail({ float: 'The float: more than 0.' });
  const [[b]] = await q.query('SELECT float_amount FROM petty_boxes WHERE godown_id = ? FOR UPDATE', [godownId]);
  if (b) await q.query('UPDATE petty_boxes SET float_amount = ? WHERE godown_id = ?', [a, godownId]);
  else {
    await q.query('INSERT INTO petty_boxes (godown_id, float_amount) VALUES (?, ?)', [godownId, a]);
    await q.query("INSERT INTO petty_moves (godown_id, move_date, kind, amount, ref, emp_id) VALUES (?, ?, 'open', ?, 'Opening float', ?)", [godownId, pricing.istToday(), a, empId]);
  }
  await audit(q, { empId, action: 'float', entity: 'petty', entityId: String(godownId), after: { float: a } });
  return { godown_id: godownId, float: a };
}
async function topUp(q, godownId, amount, empId) {
  const a = r2(Number(amount));
  if (!(a >= 1)) fail({ amount: 'A top-up of Rs 1 or more.' });
  const [[b]] = await q.query('SELECT float_amount FROM petty_boxes WHERE godown_id = ?', [godownId]);
  if (!b) throw new ExpenseError('This godown has no petty cash box yet: set its float first', 409);
  const [[w]] = await q.query("SELECT move_id FROM petty_moves WHERE godown_id = ? AND kind = 'topup' AND status = 'waiting'", [godownId]);
  if (w) throw new ExpenseError('A top-up for this box already waits for approval', 409);
  const today = pricing.istToday();
  const [ins] = await q.query("INSERT INTO petty_moves (godown_id, move_date, kind, amount, ask_amount, status, ref, emp_id) VALUES (?, ?, 'topup', 0, ?, 'waiting', 'Top-up from bank', ?)", [godownId, today, a, empId]);
  const [[g]] = await q.query('SELECT name FROM locations WHERE location_id = ?', [godownId]);
  if (await approvals.needed(q, 'petty_topup', {})) {
    const id = await approvals.request(q, { kind: 'petty_topup', godownId, refType: 'petty', refId: String(ins.insertId), recordDate: today, amount: a,
      summary: `Petty cash top-up at ${g ? g.name : godownId}: ${rs(a)} (box ${rs(await pettyBalance(q, godownId))}, float ${rs(b.float_amount)})`, payload: { move_id: ins.insertId } }, empId);
    await q.query('UPDATE petty_moves SET approval_id = ? WHERE move_id = ?', [id, ins.insertId]);
    return { move_id: ins.insertId, waiting: true, message: `Top-up of ${rs(a)} waits for approval.` };
  }
  await q.query("UPDATE petty_moves SET status = 'done', amount = ask_amount WHERE move_id = ?", [ins.insertId]);
  return { move_id: ins.insertId, waiting: false, message: `Topped up ${rs(a)}.` };
}
approvals.onApproved('petty_topup', async (q, p) => { if (p && p.move_id) await q.query("UPDATE petty_moves SET status = 'done', amount = ask_amount WHERE move_id = ? AND status = 'waiting'", [p.move_id]); });
approvals.onClosed('petty_topup', async (q, p) => { if (p && p.move_id) await q.query("UPDATE petty_moves SET status = 'rejected' WHERE move_id = ? AND status = 'waiting'", [p.move_id]); });

/** the day close: counted cash against the book; the difference is kept (above Rs 100 an alert) */
async function count(q, godownId, counted, empId) {
  const c = r2(Number(counted));
  if (String(counted ?? '').trim() === '' || !(c >= 0)) fail({ counted: 'What is in the box (Rs).' });
  const book = await pettyBalance(q, godownId);
  const diff = r2(c - book);
  await q.query("INSERT INTO petty_moves (godown_id, move_date, kind, amount, book, counted, ref, emp_id) VALUES (?, ?, 'count', ?, ?, ?, 'Count', ?)", [godownId, pricing.istToday(), diff, book, c, empId]);
  await audit(q, { empId, action: 'count', entity: 'petty', entityId: String(godownId), after: { book, counted: c, difference: diff } });
  return { book, counted: c, difference: diff, alert: Math.abs(diff) > 100,
    message: Math.abs(diff) < 0.005 ? 'Matches the book.' : `Difference ${rs(diff)}.${Math.abs(diff) > 100 ? ' More than Rs 100: it shows in Alerts.' : ''}` };
}
async function boxes(q, scope) {
  const [g] = await q.query('SELECT location_id AS godown_id, name FROM locations WHERE is_active = 1 ORDER BY sort_order, location_id');
  const out = [];
  for (const x of g.filter((y) => scope === 'ALL' || scope.includes(Number(y.godown_id)))) {
    const [[b]] = await q.query('SELECT float_amount FROM petty_boxes WHERE godown_id = ?', [x.godown_id]);
    const [moves] = await q.query(`SELECT move_id, DATE_FORMAT(move_date, '%Y-%m-%d') AS date, kind, amount, ask_amount, book, counted, status, ref, emp_id FROM petty_moves WHERE godown_id = ? ORDER BY move_id DESC LIMIT 100`, [x.godown_id]);
    const bal = await pettyBalance(q, x.godown_id);
    const fl = b ? Number(b.float_amount) : null;
    out.push({ ...x, float: fl, balance: bal, free: await pettyFree(q, x.godown_id), low: fl !== null && bal < fl * 0.25,
      moves: moves.map((m) => ({ ...m, amount: Number(m.amount), ask_amount: m.ask_amount === null ? null : Number(m.ask_amount), book: m.book === null ? null : Number(m.book), counted: m.counted === null ? null : Number(m.counted) })) });
  }
  return out;
}

module.exports = { ExpenseError, MODES, GST_RATES, STATUS, payeeKey, payeeList, payeeOf, headOf, pettyBalance, pettyFree, save, post, cancel, freightTrueUp, repeatsDue, makeDrafts, saveRepeat, setFloat, topUp, count, boxes, nextMonthDay };
