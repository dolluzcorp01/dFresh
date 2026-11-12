// Section 3 Suppliers and buying (phase 16, v23 "SECTION 3 SUPPLIERS AND BUYING - RULES"): the rules every buying
// screen shares. The routes are in buying-routes.js (suppliers, indents, POs, goods in, QC, bills, claims) and
// supplier-pay.js (Money > Payments > Supplier payments). Rights: the roles grid rows "Suppliers and buying" (buying)
// and "Payments" (money); purchase rates and values are costs, shown only to See cost or Buying Edit (v22 RP1).
// - What can be bought: raw materials, and packs set as Bought or Both in Products (not archived, not discontinued).
// - Tax: the supplier's state against the godown's: same state CGST + SGST, else IGST; a supplier not registered for GST
//   charges none. GST per line from the HSN rate on the day (a pack: its product's HSN; a raw material: its own HSN);
//   freight is taxed at 18%; the total is rounded to the rupee.
// - A PO's value for the approval rule is without GST (GST comes back as input credit), with freight; orders to one
//   supplier within "Days that count together" add up (approvals.js split counting, target sup:<id>).
// - Goods in and bills use only the last APPROVED revision of a PO (po_lines); an amendment waits in po_amendments.
// - Received on a PO line = accepted after QC, plus what is still in QC hold or waiting; rejected goods do not count;
//   packs sent back on a late claim for replacement are open again. Open = ordered - credited - received.
// - Landed cost per unit = rate less discount, plus the line's share of the PO freight by value (switch "Freight goes
//   into the average cost"). The PO estimate stays in cost until the PO's last bill; then the freight is trued up to
//   what was billed (a "transporter bills the freight separately" tick keeps the estimate until that bill is recorded:
//   Expenses, phase 23). A bill rate different from the PO moves the average too. The part of any difference on packs
//   already sold goes to cost of sales (v22 B1).
// - Due date: the supplier's terms from the bill date; a micro or small (MSME) supplier never later than 45 days from
//   the day we accepted the goods (MSMED Act).
// - A supplier credit note is set against their bills (the bill of those goods first, then the oldest due); anything
//   left waits as credit for their next bill, shown as "credit", never as a minus (v23 Low).
const commerceSettings = require('./commerce-settings');
const tax = require('./tax');
const pricing = require('./pricing');
const stock = require('./stock');
const { SKU_NAME, SKU_JOIN } = require('./catalogue');
const { GST_STATES } = require('../shared/gstStates');

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const STATE_CODE = Object.fromEntries(GST_STATES.map(([c, n]) => [n, c]));
const today = () => pricing.istToday();
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const dayDiff = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400e3);
const ymd = (v) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);
const rs = (n) => `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rs0 = (n) => `Rs ${Math.round(Number(n)).toLocaleString('en-IN')}`;

class BuyError extends Error {
  constructor(message, status = 400, fields = null) { super(message); this.status = status; this.fields = fields; }
}
/** throw a form error: { field: message } */
const bad = (fields, msg = 'Fix the fields marked in red') => { throw new BuyError(msg, 400, fields); };

/** the Stock switches of section 3 */
async function settings(q) {
  const s = await commerceSettings.read(q);
  const on = (v) => v === undefined || v === null || v === true || v === 1 || v === '1' || v === 'true'; // read() types bool settings
  return { quarantine: on(s.quarantine), freightCost: on(s.freight_cost), claimDays: Number(s.claim_days ?? 15) };
}

// ---------------------------------------------------------------- items
/**
 * facts of these SKUs -> Map sku -> { sku_code, name, type, unit, source, status, hsn, track, life, near, per_carton,
 * buyable, product_status }
 */
async function items(q, codes = null) {
  const [rows] = await q.query(`SELECT s.sku_code, ${SKU_NAME} AS name, s.size_label, s.sku_type, s.unit_code, s.source, s.status, s.packs_per_carton,
      COALESCE(p.hsn_code, s.raw_hsn) AS hsn, COALESCE(p.track_batches, 0) AS track, COALESCE(p.shelf_life_months, 0) AS life, p.near_expiry_days AS near,
      p.status AS product_status, s.avg_cost
      FROM skus s ${SKU_JOIN} ${codes ? 'WHERE s.sku_code IN (?)' : ''} ORDER BY s.sku_type DESC, s.sku_code`, codes ? [codes.length ? codes : ['']] : []);
  return new Map(rows.map((r) => {
    const raw = r.sku_type === 'raw';
    const live = !['archived', 'discontinued', 'draft'].includes(r.status) && (raw || !['archived', 'discontinued'].includes(r.product_status));
    return [r.sku_code, { sku_code: r.sku_code, name: raw ? r.name : `${r.name} ${r.size_label}`.trim(), type: r.sku_type, unit: raw ? r.unit_code : 'pack', source: r.source,
      status: r.status, hsn: r.hsn || null, track: Number(r.track) === 1, life: Number(r.life) || 0, near: r.near === null ? null : Number(r.near),
      per_carton: raw ? null : Number(r.packs_per_carton) || null, buyable: live && (raw || r.source === 'bought' || r.source === 'both'), avg_cost: r.avg_cost === null ? null : Number(r.avg_cost) }];
  }));
}
/** "1,200 kg" / "240 packs" / "1 piece" */
function qtyText(it, n) {
  const u = it ? it.unit : 'pack';
  const word = u === 'kg' ? 'kg' : u === 'pieces' ? (n === 1 ? 'piece' : 'pieces') : n === 1 ? u : `${u}s`;
  return `${Number(n).toLocaleString('en-IN')} ${word}`;
}
/** GST rate of each SKU on a day (from its HSN code) -> Map sku -> rate | null (no HSN or no rate) */
async function gstRates(q, its, day) {
  const rates = await tax.ratesOn(q, day);
  return new Map([...its.values()].map((it) => [it.sku_code, it.hsn && rates.has(it.hsn) ? rates.get(it.hsn) : null]));
}

// ---------------------------------------------------------------- suppliers and godowns
async function supplierOf(q, id, lock = false) {
  const [[s]] = await q.query(`SELECT supplier_id, code, name, kinds, status, block_reason, gstin, state_code, msme_type, udyam, addr_l1, addr_l2, city, pin, map_query, pickup,
      terms_days, opening_owed, credit, notes, bank_holder, bank_name, bank_branch, bank_acc, bank_ifsc, bank_type, DATE_FORMAT(since, '%Y-%m-%d') AS since
      FROM suppliers WHERE supplier_id = ?${lock ? ' FOR UPDATE' : ''}`, [Number(id)]);
  if (!s) return null;
  return { ...s, kinds: String(s.kinds || '').split(',').filter(Boolean), terms_days: Number(s.terms_days), opening_owed: Number(s.opening_owed), credit: Number(s.credit) };
}
async function godownOf(q, id) {
  const [[g]] = await q.query('SELECT location_id AS godown_id, code, name, state, address, addr_line2, city, pin FROM locations WHERE location_id = ?', [Number(id)]);
  return g ? { ...g, state_code: STATE_CODE[g.state] || null } : null;
}
/** the supplier is in another state than the godown: IGST */
const interState = (sup, g) => Boolean(sup && g && sup.state_code && g.state_code && sup.state_code !== g.state_code);
const msmeSmall = (sup) => Boolean(sup && (sup.msme_type === 'Micro' || sup.msme_type === 'Small'));

// ---------------------------------------------------------------- money of a set of lines
const lineVal = (l) => r2(Number(l.qty) * Number(l.rate) * (1 - (Number(l.disc) || 0) / 100));
/**
 * lines [{ sku, qty, rate, disc, gst (rate %) }], freight (taxed at 18%), registered (the supplier has a GSTIN), inter
 * -> { taxable, freight, gst, cgst, sgst, igst, round, total, inter }
 */
function totals(lines, freight, { registered, inter }) {
  const t = { taxable: 0, gst: 0, cgst: 0, sgst: 0, igst: 0, freight: Number(freight) || 0, round: 0, total: 0, inter };
  for (const l of lines) { const v = lineVal(l); t.taxable += v; t.gst += registered ? (v * (Number(l.gst) || 0)) / 100 : 0; }
  const g = t.gst + (registered ? t.freight * 0.18 : 0);
  if (inter) t.igst = r2(g); else { t.cgst = r2(g / 2); t.sgst = r2(g / 2); }
  t.taxable = r2(t.taxable);
  t.gst = r2(g);
  const raw = t.taxable + t.freight + t.gst;
  t.total = Math.round(raw);
  t.round = r2(t.total - raw);
  t.raw = r2(raw);
  return t;
}

// ---------------------------------------------------------------- purchase orders
async function poOf(q, id, lock = false) {
  const [[p]] = await q.query(`SELECT po_id, po_no, draft_no, supplier_id, godown_id, status, rev, DATE_FORMAT(po_date, '%Y-%m-%d') AS po_date, DATE_FORMAT(expected_on, '%Y-%m-%d') AS expected_on,
      freight, terms, indent_id, approval_id, raised_by, raised_at, approved_by, sent_at, end_by, end_reason, ended_at, freight_cost, freight_billed, freight_sep, created_by, created_at
      FROM purchase_orders WHERE po_id = ?${lock ? ' FOR UPDATE' : ''}`, [Number(id)]);
  if (!p) return null;
  const [lines] = await q.query('SELECT sku_code, qty, rate, disc_pct, credited FROM po_lines WHERE po_id = ? ORDER BY line_no', [p.po_id]);
  return { ...p, freight: Number(p.freight), freight_cost: Number(p.freight_cost), freight_billed: Number(p.freight_billed) === 1, freight_sep: Number(p.freight_sep) === 1,
    lines: lines.map((l) => ({ sku: l.sku_code, qty: Number(l.qty), rate: Number(l.rate), disc: Number(l.disc_pct), credited: Number(l.credited) })) };
}
const poRef = (p) => p.po_no || `Draft ${p.draft_no}`;
/** PO value for the approval rule: without GST, with freight, rounded to the rupee */
const poValue = (lines, freight) => Math.round(lines.reduce((a, l) => a + lineVal(l), 0) + (Number(freight) || 0));
const unitRate = (l) => r2(lineVal(l) / l.qty);

/** received per SKU on a PO -> Map sku -> qty (accepted, plus QC hold and waiting; late replacement claims open again) */
async function received(q, poId) {
  const [rows] = await q.query(`SELECT l.sku_code, SUM(CASE WHEN g.status = 'done' THEN COALESCE(l.acc, 0) ELSE l.recv END) AS n
      FROM goods_in_lines l JOIN goods_ins g ON g.grn_id = l.grn_id WHERE g.po_id = ? AND g.status <> 'rejected' GROUP BY l.sku_code`, [Number(poId)]);
  const out = new Map(rows.map((r) => [r.sku_code, Number(r.n)]));
  const [late] = await q.query(`SELECT cl.sku_code, SUM(cl.qty) AS n FROM claim_lines cl JOIN claims c ON c.claim_id = cl.claim_id
      WHERE c.po_id = ? AND c.is_late = 1 AND c.outcome = 'replace' AND c.status IN ('issued', 'returned', 'settled') GROUP BY cl.sku_code`, [Number(poId)]);
  for (const r of late) out.set(r.sku_code, Math.max(0, (out.get(r.sku_code) || 0) - Number(r.n)));
  return out;
}
const openOf = (l, got) => Math.max(0, l.qty - (l.credited || 0) - (got.get(l.sku) || 0));
/** the PO's state for the screens: draft, waiting, open, part, received, closed, cancelled, rejected */
async function poState(q, p, got = null) {
  if (['draft', 'waiting', 'cancelled', 'closed', 'rejected'].includes(p.status)) return p.status;
  const [[am]] = await q.query('SELECT po_id FROM po_amendments WHERE po_id = ?', [p.po_id]);
  if (am) return 'waiting';
  const g = got || (await received(q, p.po_id));
  const open = p.lines.reduce((a, l) => a + openOf(l, g), 0);
  const any = p.lines.reduce((a, l) => a + (g.get(l.sku) || 0), 0);
  return open <= 0 ? 'received' : any > 0 ? 'part' : 'open';
}
/** last price paid to this supplier for this item (newest other raised PO), else their item list price */
async function lastPrice(q, supplierId, sku, exceptPo = 0) {
  const [[h]] = await q.query(`SELECT l.rate, DATE_FORMAT(p.po_date, '%Y-%m-%d') AS po_date, p.po_no FROM po_lines l JOIN purchase_orders p ON p.po_id = l.po_id
      WHERE p.supplier_id = ? AND l.sku_code = ? AND p.po_id <> ? AND p.status NOT IN ('draft', 'cancelled', 'rejected') ORDER BY p.po_date DESC, p.po_id DESC LIMIT 1`, [supplierId, sku, Number(exceptPo) || 0]);
  if (h) return { rate: Number(h.rate), date: h.po_date, po: h.po_no };
  const [[it]] = await q.query('SELECT price FROM supplier_items WHERE supplier_id = ? AND sku_code = ?', [supplierId, sku]);
  return it ? { rate: Number(it.price), date: null, po: null } : null;
}

/** freight per unit of a PO line into the cost (0 when the switch is off, no freight, or the freight is already billed) */
function freightShare(p, sku, freightCost) {
  const l = p.lines.find((x) => x.sku === sku);
  if (!l || !freightCost || !p.freight || p.freight_billed) return 0;
  const tot = p.lines.reduce((a, x) => a + lineVal(x), 0);
  return tot ? (p.freight * (lineVal(l) / tot)) / l.qty : 0;
}

// ---------------------------------------------------------------- stock at QC
/** good stock of a SKU across every godown (the average cost is per SKU across godowns, like stock.stockIn) */
async function goodAll(q, sku) {
  const [[st]] = await q.query("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND stock_kind = 'good'", [sku]);
  return Math.max(0, Number(st.n));
}
/** n units into Good at `unit` cost: moves the weighted average (as stock.stockIn) -> { before, after } */
async function addStock(q, { sku, godown, n, unit, batch, doc, what, note }, empId) {
  const [[s]] = await q.query('SELECT avg_cost FROM skus WHERE sku_code = ? FOR UPDATE', [sku]);
  const onHand = await goodAll(q, sku);
  const before = s.avg_cost === null ? null : Number(s.avg_cost);
  const after = unit === null ? before : before === null || onHand === 0 ? r2(unit) : r2((onHand * before + n * unit) / (onHand + n));
  if (after !== before) await q.query('UPDATE skus SET avg_cost = ? WHERE sku_code = ?', [after, sku]);
  await stock.moveStock(q, { sku, godown, shelf: 'good', qty: n, batch, what, unitCost: unit === null ? null : r2(unit), doc, note }, empId);
  return { before, after };
}
/**
 * Quality check of a goods in (also the automatic pass when QC hold is off): every line accepted or rejected.
 * res = [{ acc, rej, reason, gsm, deviation }] in line order (null: everything accepted) -> { moved, claim }
 */
async function passQc(q, grnId, res, empId, { auto = false, note = null } = {}) {
  const [[g]] = await q.query('SELECT grn_id, grn_no, godown_id, supplier_id, po_id, status FROM goods_ins WHERE grn_id = ? FOR UPDATE', [grnId]);
  const [lines] = await q.query('SELECT line_id, sku_code, recv, batch_id, batch_no, rate FROM goods_in_lines WHERE grn_id = ? ORDER BY line_id', [grnId]);
  const st = await settings(q);
  const p = g.po_id ? await poOf(q, g.po_id, true) : null;
  const doc = { type: 'goods_in', id: g.grn_no };
  const moved = [];
  const rejLines = [];
  for (const [i, l] of lines.entries()) {
    const x = res ? res[i] : { acc: l.recv, rej: 0 };
    await stock.moveStock(q, { sku: l.sku_code, godown: g.godown_id, shelf: 'hold', qty: -l.recv, batch: l.batch_id, strict: Boolean(l.batch_id), doc, what: 'qc', note: auto ? 'Passed (QC hold off)' : 'Quality check' }, empId);
    let unit = null; let av = { before: null, after: null };
    if (x.acc > 0) {
      const pl = p ? p.lines.find((y) => y.sku === l.sku_code) : null;
      const f = pl ? freightShare(p, l.sku_code, st.freightCost) : 0;
      unit = pl ? r2(unitRate(pl) + f) : l.rate === null ? null : Number(l.rate);
      if (pl && f) await q.query('UPDATE purchase_orders SET freight_cost = freight_cost + ? WHERE po_id = ?', [r2(f * x.acc), p.po_id]);
      av = await addStock(q, { sku: l.sku_code, godown: g.godown_id, n: x.acc, unit, batch: l.batch_id, doc, what: 'grn', note: auto ? 'Goods in, passed' : 'Accepted at QC' }, empId);
      moved.push({ sku: l.sku_code, qty: x.acc, unit, before: av.before, after: av.after });
    }
    if (x.rej > 0) {
      await stock.moveStock(q, { sku: l.sku_code, godown: g.godown_id, shelf: 'rej', qty: x.rej, batch: l.batch_id, doc, what: 'qc_reject', note: x.reason }, empId);
      const pl = p ? p.lines.find((y) => y.sku === l.sku_code) : null;
      rejLines.push({ sku: l.sku_code, qty: x.rej, rate: pl ? unitRate(pl) : Number(l.rate), reason: x.reason, batch: l.batch_id });
    }
    await q.query('UPDATE goods_in_lines SET acc = ?, rej = ?, reason = ?, gsm = ?, deviation = ?, unit_cost = ?, avg_before = ?, avg_after = ? WHERE line_id = ?',
      [x.acc, x.rej, x.reason || null, x.gsm ?? null, x.deviation || null, unit, av.before, av.after, l.line_id]);
  }
  await q.query("UPDATE goods_ins SET status = 'done', qc_by = ?, qc_at = UTC_TIMESTAMP(), qc_note = ? WHERE grn_id = ?", [auto ? 'auto' : empId, note, grnId]);
  let claim = null;
  if (rejLines.length) claim = await newClaim(q, { supplierId: g.supplier_id, grnId, poId: g.po_id, godownId: g.godown_id, outcome: g.po_id ? 'replace' : 'credit', lines: rejLines, note, late: false }, empId);
  return { moved, claim };
}
async function newClaim(q, { supplierId, grnId, poId, godownId, outcome, lines, note, late }, empId) {
  const numbering = require('./numbering');
  const no = await numbering.issue(q, 'claim');
  const [ins] = await q.query('INSERT INTO claims (claim_no, supplier_id, grn_id, po_id, godown_id, outcome, status, is_late, note, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [no, supplierId, grnId, poId, godownId, outcome, 'draft', late ? 1 : 0, note ? String(note).slice(0, 255) : null, empId]);
  for (const [i, l] of lines.entries()) await q.query('INSERT INTO claim_lines (claim_id, line_no, sku_code, qty, rate, reason, batch_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [ins.insertId, i + 1, l.sku, l.qty, l.rate, String(l.reason || '').slice(0, 80), l.batch || null]);
  return { claim_id: ins.insertId, claim_no: no };
}

// ---------------------------------------------------------------- bills: what is billed, freight, cost
/** qty of a goods-in line already billed (bills not rejected), except one bill */
async function billedQty(q, grnId, sku, exceptBill = 0) {
  const [[r]] = await q.query(`SELECT COALESCE(SUM(l.qty), 0) AS n FROM supplier_bill_lines l JOIN supplier_bills b ON b.bill_id = l.bill_id
      WHERE l.grn_id = ? AND l.sku_code = ? AND b.status <> 'rejected' AND b.bill_id <> ?`, [grnId, sku, Number(exceptBill) || 0]);
  return Number(r.n);
}
/** accepted and not billed yet, per line of a checked goods in */
async function unbilled(q, grnId, exceptBill = 0) {
  const [lines] = await q.query('SELECT sku_code, SUM(COALESCE(acc, 0)) AS acc FROM goods_in_lines WHERE grn_id = ? GROUP BY sku_code', [grnId]);
  const out = [];
  for (const l of lines) { const n = Number(l.acc) - (await billedQty(q, grnId, l.sku_code, exceptBill)); if (n > 0) out.push({ sku: l.sku_code, qty: n }); }
  return out;
}
/**
 * freight billed on a PO so far (bills not rejected, except one): a bill's freight is shared over its POs by the value of
 * its lines. (A transporter's freight bill, recorded as a Freight in expense on the PO, adds here from phase 23.)
 */
async function freightBilled(q, poId, exceptBill = 0) {
  const [rows] = await q.query(`SELECT b.bill_id, b.freight, SUM(IF(g.po_id = ?, l.qty * l.rate, 0)) AS mine, SUM(l.qty * l.rate) AS allv
      FROM supplier_bills b JOIN supplier_bill_lines l ON l.bill_id = b.bill_id JOIN goods_ins g ON g.grn_id = l.grn_id
      WHERE b.status <> 'rejected' AND b.freight > 0 AND b.bill_id <> ? GROUP BY b.bill_id, b.freight HAVING mine > 0`, [Number(poId), Number(exceptBill) || 0]);
  // phase 23 (v23 Y6): a transporter's freight bill on the PO (expense head "Freight in", recorded), without its GST
  const [[t]] = await q.query("SELECT COALESCE(SUM(e.amount), 0) AS n FROM expenses e JOIN expense_heads h ON h.head_key = e.head_key WHERE e.po_id = ? AND e.status = 'done' AND h.for_po = 1", [Number(poId)])
    .catch((e) => { if (e.code === 'ER_NO_SUCH_TABLE') return [[{ n: 0 }]]; throw e; });
  return r2(rows.reduce((a, r) => a + (Number(r.freight) * Number(r.mine)) / Number(r.allv), 0) + Number(t.n));
}
/** is this bill the PO's last (the PO is fully received or closed, and every accepted pack is billed with it)? */
async function poLastBill(q, p, billId, billLines) {
  const st = await poState(q, p);
  if (!['received', 'closed'].includes(st)) return false;
  const [ls] = await q.query(`SELECT l.grn_id, l.sku_code, SUM(COALESCE(l.acc, 0)) AS acc FROM goods_in_lines l JOIN goods_ins g ON g.grn_id = l.grn_id
      WHERE g.po_id = ? AND g.status = 'done' GROUP BY l.grn_id, l.sku_code`, [p.po_id]);
  for (const l of ls) {
    const here = billLines.filter((x) => x.grn_id === l.grn_id && x.sku === l.sku_code).reduce((a, x) => a + x.qty, 0);
    if (Number(l.acc) > (await billedQty(q, l.grn_id, l.sku_code, billId)) + here) return false;
  }
  return true;
}
/**
 * packs of these goods-ins still in stock (any shelf): by their batch when the line has one; otherwise first in, first
 * out: what is in stock now less everything that came into Good after these goods (that newer stock is what is left)
 */
async function grnLeft(q, grnIds, sku) {
  const [ls] = await q.query('SELECT l.batch_id, COALESCE(l.acc, 0) AS acc, g.qc_at FROM goods_in_lines l JOIN goods_ins g ON g.grn_id = l.grn_id WHERE l.grn_id IN (?) AND l.sku_code = ?', [grnIds, sku]);
  let left = 0;
  const batches = [...new Set(ls.filter((l) => l.batch_id).map((l) => Number(l.batch_id)))];
  if (batches.length) {
    const [[b]] = await q.query('SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND batch_id IN (?)', [sku, batches]);
    left += Math.max(0, Number(b.n));
  }
  const plain = ls.filter((l) => !l.batch_id && l.qc_at);
  if (plain.length) {
    const acc = plain.reduce((a, l) => a + Number(l.acc), 0);
    const since = plain.map((l) => l.qc_at).sort((a, b) => a - b)[0];
    const have = await goodAll(q, sku);
    const [[later]] = await q.query(`SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND stock_kind = 'good' AND delta > 0 AND created_at > ?
        AND NOT (ref_type = 'goods_in' AND ref_id IN (SELECT grn_no FROM goods_ins WHERE grn_id IN (?)))`, [sku, since, grnIds]);
    left += Math.max(0, Math.min(acc, have - Number(later.n)));
  }
  return left;
}
/**
 * spread cost differences: adj = [{ sku, v (Rs), q (the packs it is on), grns, why }]; the part on packs of these goods
 * still in stock moves the average; the rest goes to cost of sales -> [{ sku, before, after, stock, cos }]
 */
async function costApply(q, src, adj, empId) {
  const out = [];
  for (const x of adj) {
    const v = r2(x.v);
    if (Math.abs(v) < 0.005 || !x.q) continue;
    const [[s]] = await q.query('SELECT avg_cost FROM skus WHERE sku_code = ? FOR UPDATE', [x.sku]);
    const have = await goodAll(q, x.sku);
    const old = s.avg_cost === null ? null : Number(s.avg_cost);
    const left = x.grns && x.grns.length ? Math.min(await grnLeft(q, x.grns, x.sku), have) : have;
    const part = old === null || have <= 0 ? 0 : Math.min(left, x.q) / x.q;
    let now = old;
    if (part > 0) { now = r2(old + (v * part) / have); await q.query('UPDATE skus SET avg_cost = ? WHERE sku_code = ?', [now, x.sku]); }
    const row = { sku: x.sku, before: old, after: now, stock: r2(v * part), cos: r2(v * (1 - part)), why: x.why };
    await q.query('INSERT INTO cost_adjustments (src_type, src_id, sku_code, godown_id, adj_date, why, avg_before, avg_after, value_stock, value_cos, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [src.type, src.id, x.sku, src.godown, src.date, x.why.slice(0, 80), old, now, row.stock, row.cos, empId]);
    out.push(row);
  }
  return out;
}
/** share a freight difference over a PO's accepted goods, by value */
async function poFreightAdj(q, p, extra) {
  const [acc] = await q.query(`SELECT l.sku_code, SUM(COALESCE(l.acc, 0)) AS n FROM goods_in_lines l JOIN goods_ins g ON g.grn_id = l.grn_id
      WHERE g.po_id = ? AND g.status = 'done' GROUP BY l.sku_code HAVING n > 0`, [p.po_id]);
  const [grns] = await q.query("SELECT grn_id FROM goods_ins WHERE po_id = ? AND status = 'done'", [p.po_id]);
  const val = (r) => { const pl = p.lines.find((x) => x.sku === r.sku_code); return pl ? unitRate(pl) * Number(r.n) : 0; };
  const tv = acc.reduce((a, r) => a + val(r), 0);
  if (!tv) return [];
  return acc.filter((r) => val(r) > 0).map((r) => ({ sku: r.sku_code, v: (extra * val(r)) / tv, q: Number(r.n), why: 'freight billed against the PO estimate', grns: grns.map((g) => g.grn_id) }));
}
/**
 * when a bill posts (matched, or its difference approved): the average cost moves by what the bill really charged
 * against the PO (rate difference), and on the PO's last bill by the freight billed against the estimate in cost; freight
 * on goods with no PO goes into their cost by value -> the cost adjustments made
 */
async function billCost(q, billId, empId) {
  const [[b]] = await q.query("SELECT bill_id, godown_id, DATE_FORMAT(bill_date, '%Y-%m-%d') AS bill_date, freight, freight_sep, cost_done FROM supplier_bills WHERE bill_id = ? FOR UPDATE", [billId]);
  if (Number(b.cost_done)) return [];
  await q.query('UPDATE supplier_bills SET cost_done = 1 WHERE bill_id = ?', [billId]);
  const [ls] = await q.query('SELECT l.grn_id, l.sku_code AS sku, l.qty, l.rate, l.po_rate, g.po_id FROM supplier_bill_lines l JOIN goods_ins g ON g.grn_id = l.grn_id WHERE l.bill_id = ? ORDER BY l.line_no', [billId]);
  const lines = ls.map((l) => ({ ...l, qty: Number(l.qty), rate: Number(l.rate), po_rate: l.po_rate === null ? null : Number(l.po_rate) }));
  const adj = [];
  const bySku = new Map();
  for (const l of lines) {
    if (l.po_rate === null) continue;
    const a = bySku.get(l.sku) || { sku: l.sku, v: 0, q: 0, why: 'bill rate against the PO', grns: [] };
    a.v += (l.rate - l.po_rate) * l.qty; a.q += l.qty; if (!a.grns.includes(l.grn_id)) a.grns.push(l.grn_id);
    bySku.set(l.sku, a);
  }
  adj.push(...bySku.values());
  const st = await settings(q);
  const freight = Number(b.freight) || 0;
  if (st.freightCost) {
    const pos = [...new Set(lines.filter((l) => l.po_id).map((l) => l.po_id))];
    const allV = lines.reduce((a, l) => a + l.rate * l.qty, 0);
    for (const pid of pos) {
      if (Number(b.freight_sep)) await q.query('UPDATE purchase_orders SET freight_sep = 1 WHERE po_id = ?', [pid]);
      const p = await poOf(q, pid, true);
      if (!(await poLastBill(q, p, billId, lines.map((l) => ({ grn_id: l.grn_id, sku: l.sku, qty: l.qty }))))) continue; // v23 Y6: the estimate stays until the last bill
      if (p.freight_sep) continue; // the transporter's bill is still to come (Expenses, phase 23): the estimate stays
      const mineV = lines.filter((l) => l.po_id === pid).reduce((a, l) => a + l.rate * l.qty, 0);
      const billed = r2((await freightBilled(q, pid, billId)) + (allV ? (freight * mineV) / allV : 0));
      const extra = r2(billed - p.freight_cost);
      await q.query('UPDATE purchase_orders SET freight_billed = 1, freight_cost = ? WHERE po_id = ?', [billed, pid]);
      if (Math.abs(extra) >= 0.005) adj.push(...(await poFreightAdj(q, p, extra)));
    }
    // v23 Low: freight billed on goods with no PO goes into their cost, by value
    const np = lines.filter((l) => !l.po_id);
    const npV = np.reduce((a, l) => a + l.rate * l.qty, 0);
    if (freight && npV > 0 && allV > 0) {
      const npF = (freight * npV) / allV;
      for (const l of np) adj.push({ sku: l.sku, v: (npF * l.rate * l.qty) / npV, q: l.qty, why: 'freight on goods with no PO', grns: [l.grn_id] });
    }
  }
  return costApply(q, { type: 'bill', id: billId, godown: b.godown_id, date: b.bill_date }, adj, empId);
}

// ---------------------------------------------------------------- what we owe, credit, due dates
/** terms from the bill date; a micro or small supplier: never later than 45 days from accepting the goods */
function dueFor(sup, billDate, acceptedOn) {
  let d = addDays(billDate, sup.terms_days);
  if (msmeSmall(sup)) { const m = addDays(acceptedOn || billDate, 45); if (m < d) d = m; }
  return d;
}
/** the earliest QC date of these goods-ins */
async function acceptedOn(q, grnIds) {
  const [[r]] = await q.query("SELECT DATE_FORMAT(MIN(CONVERT_TZ(qc_at, '+00:00', '+05:30')), '%Y-%m-%d') AS d FROM goods_ins WHERE grn_id IN (?)", [grnIds.length ? grnIds : [0]]);
  return r.d || null;
}
/** what we owe a supplier (bills unpaid, part paid or waiting, plus the opening amount, less credit), on these godowns (null = all) */
async function payable(q, supplierId, scope = null) {
  const [[b]] = await q.query(`SELECT COALESCE(SUM(total - paid), 0) AS n FROM supplier_bills WHERE supplier_id = ? AND status IN ('unpaid', 'part', 'waiting')${scope ? ' AND godown_id IN (?)' : ''}`,
    scope ? [supplierId, scope.length ? scope : [0]] : [supplierId]);
  const [[s]] = await q.query('SELECT opening_owed, credit FROM suppliers WHERE supplier_id = ?', [supplierId]);
  return r2(Number(b.n) + (scope ? 0 : Number(s.opening_owed) - Number(s.credit)));
}
/** we owe / credit text: a supplier credit is a credit, never a minus */
const oweText = (v) => (v < -0.004 ? `${rs(-v)} credit` : rs(v));

async function setBillPaid(q, billId) {
  const [[r]] = await q.query(`SELECT b.total, (SELECT COALESCE(SUM(pl.amount), 0) FROM supplier_payment_lines pl JOIN supplier_payments p ON p.pay_id = pl.pay_id WHERE pl.bill_id = b.bill_id AND p.status = 'paid')
      + (SELECT COALESCE(SUM(c.amount), 0) FROM bill_credits c WHERE c.bill_id = b.bill_id) AS paid, b.status FROM supplier_bills b WHERE b.bill_id = ?`, [billId]);
  const paid = r2(r.paid);
  const status = ['waiting', 'rejected'].includes(r.status) ? r.status : Number(r.total) - paid <= 0.004 ? 'paid' : paid > 0.004 ? 'part' : 'unpaid';
  await q.query('UPDATE supplier_bills SET paid = ?, status = ? WHERE bill_id = ?', [paid, status, billId]);
}
/**
 * a supplier credit note: set against their open bills (the bill of those goods first, then the oldest due); what is
 * left waits as credit -> { used: ['DFB/26-27/0003 Rs 684.40'], left }
 */
async function supplierCredit(q, supplierId, amount, ref, { grnId = null, claimId = null }, empId) {
  let left = r2(amount);
  const [bills] = await q.query(`SELECT b.bill_id, b.bill_no, b.total - b.paid AS open, EXISTS (SELECT 1 FROM supplier_bill_lines l WHERE l.bill_id = b.bill_id AND l.grn_id = ?) AS mine
      FROM supplier_bills b WHERE b.supplier_id = ? AND b.status IN ('unpaid', 'part') AND b.total - b.paid > 0.004 ORDER BY mine DESC, b.due_date, b.bill_id`, [grnId || 0, supplierId]);
  const used = [];
  for (const b of bills) {
    if (left <= 0.004) break;
    const t = r2(Math.min(left, Number(b.open)));
    await q.query('INSERT INTO bill_credits (bill_id, ref, claim_id, amount, emp_id) VALUES (?, ?, ?, ?, ?)', [b.bill_id, ref, claimId, t, empId]);
    await setBillPaid(q, b.bill_id);
    used.push(`${b.bill_no} ${rs(t)}`);
    left = r2(left - t);
  }
  if (left > 0.004) await q.query('UPDATE suppliers SET credit = credit + ? WHERE supplier_id = ?', [left, supplierId]);
  return { used, left };
}
/** a bill that can now be paid takes any credit waiting with the supplier */
async function billCreditWait(q, billId, empId) {
  const [[b]] = await q.query('SELECT bill_id, supplier_id, total - paid AS open, status FROM supplier_bills WHERE bill_id = ?', [billId]);
  if (!['unpaid', 'part'].includes(b.status)) return 0;
  const [[s]] = await q.query('SELECT credit FROM suppliers WHERE supplier_id = ? FOR UPDATE', [b.supplier_id]);
  const t = r2(Math.min(Number(s.credit), Number(b.open)));
  if (t <= 0.004) return 0;
  await q.query('INSERT INTO bill_credits (bill_id, ref, amount, emp_id) VALUES (?, ?, ?, ?)', [billId, 'Credit waiting', t, empId]);
  await q.query('UPDATE suppliers SET credit = credit - ? WHERE supplier_id = ?', [t, b.supplier_id]);
  await setBillPaid(q, billId);
  return t;
}

/** a supplier's record: on time = goods in on or before the PO's expected date; rejected = rejected / checked */
async function rating(q, supplierId) {
  const [[r]] = await q.query(`SELECT COUNT(p.po_id) AS n, SUM(g.received_on <= p.expected_on) AS ontime FROM goods_ins g JOIN purchase_orders p ON p.po_id = g.po_id WHERE g.supplier_id = ?`, [supplierId]);
  const [[c]] = await q.query(`SELECT COALESCE(SUM(COALESCE(l.acc, 0) + COALESCE(l.rej, 0)), 0) AS chk, COALESCE(SUM(COALESCE(l.rej, 0)), 0) AS rej
      FROM goods_in_lines l JOIN goods_ins g ON g.grn_id = l.grn_id WHERE g.supplier_id = ? AND g.status = 'done'`, [supplierId]);
  const n = Number(r.n);
  return { n, ontime: n ? Math.round((Number(r.ontime) / n) * 100) : null, rej_pct: Number(c.chk) ? Math.round((Number(c.rej) / Number(c.chk)) * 1000) / 10 : null };
}

// ---------------------------------------------------------------- reorder
/** (phase 18: shared with Inventory > Reorder) what is in QC hold, ordered (open PO quantity; whole lines of drafts and waiting POs) and asked for */
async function incoming(q, sku, gid) {
  const [[h]] = await q.query("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND location_id = ? AND stock_kind = 'hold'", [sku, gid]);
  let n = Number(h.n);
  const [pos] = await q.query("SELECT po_id FROM purchase_orders WHERE godown_id = ? AND status IN ('draft', 'waiting', 'open') AND po_id IN (SELECT po_id FROM po_lines WHERE sku_code = ?)", [gid, sku]);
  for (const r of pos) {
    const p = await poOf(q, r.po_id); const l = p.lines.find((x) => x.sku === sku);
    if (['draft', 'waiting'].includes(p.status)) n += l.qty;
    else { const got = await received(q, p.po_id); n += openOf(l, got); }
  }
  const [[ind]] = await q.query("SELECT COALESCE(SUM(l.qty), 0) AS n FROM indent_lines l JOIN indents i ON i.indent_id = l.indent_id WHERE l.sku_code = ? AND i.godown_id = ? AND i.status IN ('open', 'approved')", [sku, gid]);
  return n + Number(ind.n);
}
/** the cheapest active supplier with this item on their list */
async function bestItem(q, sku) {
  const [[r]] = await q.query("SELECT i.supplier_id, i.price, i.moq FROM supplier_items i JOIN suppliers s ON s.supplier_id = i.supplier_id WHERE i.sku_code = ? AND s.status = 'active' ORDER BY i.price, s.supplier_id LIMIT 1", [sku]);
  return r ? { supplier_id: r.supplier_id, price: Number(r.price), moq: Number(r.moq) } : null;
}
module.exports = {
  BuyError, bad, r2, rs, rs0, today, addDays, addMonths, dayDiff, ymd, STATE_CODE, settings, items, qtyText, gstRates, supplierOf, godownOf, interState, msmeSmall,
  lineVal, unitRate, totals, poOf, poRef, poValue, received, openOf, poState, lastPrice, freightShare, goodAll, addStock, passQc, newClaim,
  billedQty, unbilled, freightBilled, poLastBill, grnLeft, costApply, poFreightAdj, billCost, dueFor, acceptedOn, payable, oweText, setBillPaid,
  supplierCredit, billCreditWait, rating, incoming, bestItem,
};
