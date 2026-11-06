// Inventory (docs/COMMERCE-SPEC.md 4.4; migrations 20261021_commerce_05_stock.sql, 20261102_stage2_12a_01 / 02): shared
// by the admin routes, the order logic (commerce.js), returns.js and the demo seed, so every stock change is made the
// same way: through moveStock(), the one stock mover.
// - Stock on hand = SUM(stock_movements.delta) per godown (location_id), SKU, shelf (stock_kind) and batch. Shelves
//   (v23): good, hold (QC hold), dmg (damaged), ret (returned), rej (rejected, back to the supplier), disp (disputed).
//   Expired is not a shelf: it is the batch's date (expired lots are blocked). Nothing is typed in.
// - Available (per godown) = good stock - expired batches - active reservations of other orders.
// - Every stock-out (dispatch) keeps the average cost at that moment (unit_cost): the margin uses it, never today's cost.
//   The average cost is per SKU across every godown.
// - Stock in (production or purchase) is only for the demo seed and the stock-ins of before: bought goods come in through
//   Purchase > Goods in (phase 16, buying.js), made packs through a production run (phase 17, production.js); lines in packs
//   with a cost per pack; each line updates the SKU's weighted average cost: (on hand x old average + qty x cost) /
//   (on hand + qty).
// - Batches (products.track_batches): a stock in of such a SKU needs batch no., manufacture and expiry date; dispatch
//   takes the earliest expiry first (FEFO), never an expired batch, and records which batch went out.
// - Write-off (from any shelf): above the approval rule (Rs value or packs) it waits for approval, then posts; below
//   it posts at once.
// - Stock count of one godown: all SKUs or a category (batch-tracked SKUs per batch); on submit the differences
//   (counted - system) go to approval and post as "count" movements when approved.
// Every action writes the audit log.
const { audit } = require('./audit');
const approvals = require('./approvals');
const commerceSettings = require('./commerce-settings');
const pricing = require('./pricing');
const books = require('./books');
const { storable } = require('./photo-check');

const MOVE_LABEL = {
  production: 'Stock in (production)', purchase: 'Stock in (purchase)', out: 'Dispatched', return: 'Back in', damaged: 'Moved to damaged',
  write_off: 'Write-off', count: 'Count difference', in: 'In', adjust: 'Adjust', recheck: 'Recheck (R) to good', shelf: 'Shelf move',
  grn_hold: 'Goods in, QC hold', qc: 'Quality check', grn: 'Goods in, accepted', qc_reject: 'Rejected at QC', sent_back: 'Sent back to the supplier', late_claim: 'Found faulty after QC', // phase 16
  prod_issue: 'Issued to production', prod_return: 'Returned from production', made: 'Made, QC hold', prod_qc: 'Production QC', prod_pass: 'Passed production QC', prod_reject: 'Rejected at production QC', recheck_hold: 'Back to QC hold (check again)', // phase 17
  transfer: 'Loaded on the lorry', tr_in: 'Received from a transfer', tr_short: 'Short on a transfer', tr_back: 'Transfer loss rejected: to the sender', found: 'Found: back to Good', // phase 18
};
const SHELVES = ['good', 'hold', 'dmg', 'ret', 'rej', 'disp', 'road'];
const KIND_LABEL = { good: 'Good', hold: 'QC hold', dmg: 'Damaged', ret: 'Returned (R)', rej: 'Rejected (to go back)', disp: 'Disputed', road: 'On the road' };
// v23 WO_REASONS (phase 18): what happens next depends on the reason. prodqc: set by a production run only (phase 17);
// lost: also a transfer short decided Lost
const WRITE_OFF_TYPES = { damaged: 'Damaged in our godown', arrival: 'Damaged when it arrived', sample: 'Given as a sample', expired: 'Expired', custret: 'Customer return, not resellable',
  lost: 'Lost', other: 'Other', prodqc: 'Rejected at production QC' };
const WRITE_OFF_NEXT = { damaged: 'We absorb the cost. Nothing to claim.', arrival: 'A claim on the supplier: start it from Claims and purchase returns.', sample: 'Not a loss: reported as a marketing cost.',
  expired: 'Blocked from sale; written off and disposed of, never sold cheap.', custret: 'Tied to the return, so the customer is still refunded.', lost: 'Gone: nobody knows where.', other: 'Say what happened in the note.',
  prodqc: 'Made but not good enough. The run cost is carried by the packs that passed.' };
// leaving Good for these, an expired lot is never taken (it stays blocked on the shelf)
const SALE_OUT = ['out', 'transfer', 'prod_issue']; // phase 17: material issued to a run is never from an expired lot
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => Math.round(n * 1000) / 1000; // phase 17: quantities in kg have up to 3 decimals
const IST_TODAY = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))";

class StockError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const needGodown = (g) => {
  const id = Number(g);
  if (!Number.isInteger(id) || id < 1) throw new Error('stock: the godown is required');
  return id;
};

async function tracked(q, skuCodes) {
  if (!skuCodes.length) return new Set();
  const [rows] = await q.query('SELECT s.sku_code FROM skus s JOIN products p ON p.product_id = s.product_id WHERE p.track_batches = 1 AND s.sku_code IN (?)', [skuCodes]);
  return new Set(rows.map((r) => r.sku_code));
}

/**
 * good stock, expired (batches past expiry), reserved by other orders, available in one godown -> Map sku -> {...}
 * lock: the caller holds the SKUs' row locks (lockSkus); the sums then read the latest committed rows (FOR SHARE), not
 * the transaction's older snapshot, so two orders at the same moment never both take the last packs (security review M4)
 */
async function availability(q, skuCodes, exceptOrderId = 0, { lock = false, godown } = {}) {
  const g = needGodown(godown);
  const out = new Map();
  if (!skuCodes.length) return out;
  const L = lock ? ' FOR SHARE' : '';
  const [good] = await q.query(`SELECT sku_code, COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE location_id = ? AND stock_kind = 'good' AND sku_code IN (?) GROUP BY sku_code${L}`, [g, skuCodes]);
  const [exp] = await q.query(
    `SELECT m.sku_code, SUM(m.delta) AS n FROM stock_movements m JOIN batches b ON b.batch_id = m.batch_id
      WHERE m.location_id = ? AND m.stock_kind = 'good' AND b.expiry_date < ${IST_TODAY} AND m.sku_code IN (?) GROUP BY m.sku_code, m.batch_id HAVING n > 0${L}`, [g, skuCodes]
  );
  const [res] = await q.query(`SELECT sku_code, COALESCE(SUM(qty), 0) AS n FROM stock_reservations WHERE location_id = ? AND status = 'active' AND sku_code IN (?) AND order_id <> ? GROUP BY sku_code${L}`,
    [g, skuCodes, exceptOrderId || 0]);
  const gm = new Map(good.map((r) => [r.sku_code, Number(r.n)]));
  const e = new Map();
  for (const r of exp) e.set(r.sku_code, (e.get(r.sku_code) || 0) + Number(r.n));
  const rv = new Map(res.map((r) => [r.sku_code, Number(r.n)]));
  for (const s of skuCodes) {
    const x = { good: gm.get(s) || 0, expired: e.get(s) || 0, reserved: rv.get(s) || 0 };
    out.set(s, { ...x, available: x.good - x.expired - x.reserved });
  }
  return out;
}

/** the SKUs' row locks, in one order (no deadlock between two transactions): stock decisions on them wait for each other */
async function lockSkus(q, skuCodes) {
  if (skuCodes.length) await q.query('SELECT sku_code FROM skus WHERE sku_code IN (?) ORDER BY sku_code FOR UPDATE', [[...new Set(skuCodes)].sort()]);
}

/** stock of one SKU on one shelf of one godown, per batch -> [{ batch_id, batch_no, mfg_date, expiry_date, qty, expired }] (batch_id null = no batch) */
async function batchStock(q, sku, kind = 'good', { lock = false, godown } = {}) {
  const g = needGodown(godown);
  const [rows] = await q.query(
    `SELECT m.batch_id, b.batch_no, DATE_FORMAT(b.mfg_date, '%Y-%m-%d') AS mfg_date, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
            SUM(m.delta) AS qty, (b.expiry_date < ${IST_TODAY}) AS expired
       FROM stock_movements m LEFT JOIN batches b ON b.batch_id = m.batch_id
      WHERE m.location_id = ? AND m.sku_code = ? AND m.stock_kind = ? GROUP BY m.batch_id, b.batch_no, b.mfg_date, b.expiry_date HAVING qty <> 0
      ORDER BY b.expiry_date IS NULL, b.expiry_date, m.batch_id${lock ? ' FOR SHARE' : ''}`, [g, sku, kind]
  );
  return rows.map((r) => ({ ...r, qty: Number(r.qty), expired: Number(r.expired) === 1 }));
}

/** packs of one SKU on one shelf of one godown (one batch, or every batch) */
async function onShelf(q, { sku, godown, shelf = 'good', batch = null, lock = false }) {
  const [[st]] = await q.query(`SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE location_id = ? AND sku_code = ? AND stock_kind = ? AND ${batch ? 'batch_id = ?' : '1 = 1'}${lock ? ' FOR SHARE' : ''}`,
    batch ? [needGodown(godown), sku, shelf, batch] : [needGodown(godown), sku, shelf]);
  return Number(st.n);
}

async function insertMove(q, m, empId) {
  await q.query(
    `INSERT INTO stock_movements (sku_code, location_id, stock_kind, move_type, delta, batch_id, unit_cost, ref_type, ref_id, note, emp_id${m.at ? ', created_at' : ''})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${m.at ? ', ?' : ''})`,
    [m.sku, m.godown, m.shelf, m.what, m.delta, m.batch || null, m.unitCost ?? null, m.doc && m.doc.type ? m.doc.type : null,
      m.doc && m.doc.id !== undefined && m.doc.id !== null ? String(m.doc.id) : null, m.note ? String(m.note).slice(0, 255) : null, empId, ...(m.at ? [m.at] : [])]
  );
  if (m.shelf === 'good' && Number(m.delta) > 0 && goodInHooks.length) {
    // phase 19: back-orders are held from new Good stock after the action has finished: inside a transaction the
    // connection remembers it until the commit (flushGoodIn), otherwise at once
    if (typeof q.beginTransaction === 'function') (q.goodIn || (q.goodIn = new Set())).add(`${m.sku}|${m.godown}`);
    else goodInHooks.forEach((fn) => fn(m.sku, Number(m.godown)));
  }
}
const goodInHooks = [];
/** fn(sku, godown) runs after stock came onto a Good shelf (commerce.js: back-orders, oldest first) */
function onGoodIn(fn) { goodInHooks.push(fn); }
/** after a commit: tell the hooks what came in on Good in that transaction; after a rollback: forget it */
function flushGoodIn(conn, committed = true) {
  const s = conn.goodIn; conn.goodIn = null;
  if (s && committed) for (const k of s) { const [sku, g] = k.split('|'); goodInHooks.forEach((fn) => fn(sku, Number(g))); }
}

/**
 * The one stock mover: every module moves stock through it.
 * { sku, godown, shelf = 'good', qty (+ in, - out), batch = null, strict (default: true when a batch is named),
 *   doc: { type, id } (the record it belongs to), what (the move type: out, write_off, return...), unitCost, note, at }
 * -> [{ batch_id, batch_no, expiry_date, qty }] the lots it moved (qty > 0 in each)
 * - In: one movement (on the named batch, if any). A recheck never brings an expired batch back to Good.
 * - Out: never below zero. A named batch is strict: only that batch, all of it there, else refused (strict false: that
 *   batch first, then the others). No batch named: lots by batch, earliest expiry first, lots without a batch last.
 *   Out of Good for a sale or transfer an expired lot is never taken (it stays blocked on the shelf). last: batch ids
 *   taken only after the others (phase 17: batches other write-offs wait on).
 */
async function moveStock(q, { sku, godown, shelf = 'good', qty, batch = null, strict, doc = null, what, unitCost = null, note = null, at = null, last = [], noScanned = false }, empId) {
  const g = needGodown(godown);
  if (!SHELVES.includes(shelf)) throw new Error(`stock: unknown shelf ${shelf}`);
  const n = round3(Number(qty));
  // packs are whole (every caller checks it); a raw material counted in kg moves with decimals (phase 17)
  if (!Number.isFinite(n) || n === 0) throw new StockError('Quantity: a whole number of packs');
  if (!what) throw new Error('stock: what moves the stock (move type) is required');
  await books.assertOpen(q, at ? new Date(new Date(at).getTime() + 5.5 * 3600e3).toISOString().slice(0, 10) : pricing.istToday()); // phase 12b month lock
  // phase 18: a stock take freezes the Good shelf it counts: nothing comes in or goes out until it is submitted or cancelled
  if (shelf === 'good' && what !== 'count' && !at) {
    const f = await frozenBy(q, g, sku);
    if (f) throw new StockError(f, 409);
  }
  const batchId = batch ? Number(batch) : null;
  const isStrict = strict === undefined ? Boolean(batchId) : Boolean(strict);
  const base = { sku, godown: g, shelf, what, unitCost, note, at, doc };
  if (n > 0) {
    if (batchId && shelf === 'good' && what === 'recheck') {
      const [[b]] = await q.query(`SELECT batch_no, (expiry_date < ${IST_TODAY}) AS expired FROM batches WHERE batch_id = ?`, [batchId]);
      if (b && Number(b.expired) === 1) throw new StockError(`${sku} batch ${b.batch_no} has expired: it cannot go back to Good`, 409);
    }
    await insertMove(q, { ...base, delta: n, batch: batchId }, empId);
    return [{ batch_id: batchId, qty: n }];
  }
  const need = -n;
  await q.query('SELECT sku_code FROM skus WHERE sku_code = ? FOR UPDATE', [sku]);
  const lots = (await batchStock(q, sku, shelf, { lock: true, godown: g })).filter((b) => b.qty > 0);
  const saleOut = shelf === 'good' && SALE_OUT.includes(what);
  let usable;
  if (batchId) {
    const mine = lots.filter((b) => b.batch_id === batchId);
    if (saleOut && mine.some((b) => b.expired)) throw new StockError(`${sku}: that batch has expired, it cannot leave Good`, 409);
    usable = isStrict ? mine : [...mine, ...lots.filter((b) => b.batch_id !== batchId && !(saleOut && b.expired))];
  } else usable = lots.filter((b) => !(saleOut && b.expired));
  if (last.length) usable = [...usable.filter((b) => !last.includes(b.batch_id)), ...usable.filter((b) => last.includes(b.batch_id))]; // phase 17 (N3)
  // phase 18 (v23 PK1, N7, N8): packs a packer has scanned for another order stay for the packer: every other mover
  // takes the rest of the batch first; a transfer (noScanned) never takes them
  const scanned = shelf === 'good' && what !== 'out' ? await scannedLots(q, g, sku, doc && doc.type === 'order' ? doc.id : null) : new Map();
  const spare = (b) => Math.max(0, round3(b.qty - (scanned.get(b.batch_id || 0) || 0)));
  const total = round3(usable.reduce((a, b) => a + (noScanned ? spare(b) : b.qty), 0));
  if (total < need) {
    const blocked = saleOut ? lots.filter((b) => b.expired).reduce((a, b) => a + b.qty, 0) : 0;
    const held = noScanned ? round3(usable.reduce((a, b) => a + b.qty - spare(b), 0)) : 0;
    throw new StockError(`Not enough ${sku}${batchId && isStrict ? ' in that batch' : ''} on the ${KIND_LABEL[shelf]} shelf: ${total} there${blocked ? ` (${blocked} expired, blocked)` : ''}${held ? ` (${held} scanned by a packer)` : ''}, ${need} needed`, 409);
  }
  const moved = [];
  let left = need;
  const takeFrom = async (b, room) => {
    const take = round3(Math.min(left, room));
    if (take <= 0) return;
    await insertMove(q, { ...base, delta: -take, batch: b.batch_id }, empId);
    const m = moved.find((x) => x.batch_id === b.batch_id);
    if (m) m.qty = round3(m.qty + take);
    else moved.push({ batch_id: b.batch_id, batch_no: b.batch_no || null, expiry_date: b.expiry_date || null, qty: take });
    left = round3(left - take);
    b.qty = round3(b.qty - take);
  };
  for (const b of usable) { if (left) await takeFrom(b, spare(b)); }
  if (!noScanned) for (const b of usable) { if (left) await takeFrom(b, b.qty); }
  return moved;
}

/**
 * packs scanned for orders still being packed (or packed, not yet dispatched) at a godown, per batch (0 = no batch):
 * in the book figure, but in a packer's hands (v23 PK1). exceptOrderNo: that order's own scans do not count.
 */
async function scannedLots(q, godown, sku, exceptOrderNo = null) {
  const [rows] = await q.query(`SELECT COALESCE(ps.batch_id, 0) AS b, SUM(ps.qty) AS n FROM pack_scans ps JOIN orders o ON o.order_id = ps.order_id
      WHERE o.godown_id = ? AND ps.sku_code = ? AND ps.result = 'ok' AND o.status = 'packing' AND o.stock_out_at IS NULL AND o.order_no <> ? GROUP BY b`,
  [godown, sku, exceptOrderNo || '']);
  return new Map(rows.map((r) => [Number(r.b) || 0, Number(r.n)]));
}

/**
 * phase 18: the stock take counting this SKU's Good shelf at this godown (scope the whole godown, its category, or raw
 * materials), as the refusal message, or ''
 */
async function frozenBy(q, godown, sku) {
  const [[c]] = await q.query(`SELECT c.count_id, l.name AS godown FROM stock_counts c JOIN locations l ON l.location_id = c.godown_id
      JOIN skus s ON s.sku_code = ? LEFT JOIN products p ON p.product_id = s.product_id
     WHERE c.godown_id = ? AND c.status = 'open' AND (c.scope = 'all' OR (c.scope = 'raw' AND s.sku_type = 'raw') OR (s.sku_type <> 'raw' AND c.scope = p.category_key)) LIMIT 1`, [sku, godown]);
  return c ? `${sku} at ${c.godown} is frozen by stock take ST-${c.count_id}. Finish or cancel the count first.` : '';
}

/** packs from one shelf to another in the same godown (lot by lot, the same batches) -> the lots moved */
async function moveShelf(q, { sku, godown, from, to, qty, batch = null, doc = null, what = 'shelf', note = null }, empId) {
  const lots = await moveStock(q, { sku, godown, shelf: from, qty: -Math.abs(qty), batch, doc, what, note }, empId);
  for (const l of lots) await moveStock(q, { sku, godown, shelf: to, qty: l.qty, batch: l.batch_id, doc, what, note }, empId);
  return lots;
}

const isDate = (s) => pricing.isDate(String(s || ''));

// ---------------------------------------------------------------- stock in
/**
 * data = { godown_id, kind: production | purchase, supplier_id, received_on, reference, note,
 *          lines: [{ sku_code, qty (packs), unit_cost (per pack), batch_no, mfg_date, expiry_date }] }
 * opts.allowPast (seed: any date; the admin allows up to 60 days back). -> { stock_in_id, lines: [{ sku_code, qty, avg_before, avg_after }] }
 */
async function stockIn(q, data, empId, opts = {}) {
  const kind = data.kind;
  const godown = needGodown(data.godown_id);
  if (!['production', 'purchase'].includes(kind)) throw new StockError('Choose Production (our Kanchipuram unit) or Purchase (from a supplier)');
  let supplierId = null;
  if (kind === 'purchase') {
    supplierId = Number(data.supplier_id);
    const [[s]] = await q.query('SELECT supplier_id, status FROM suppliers WHERE supplier_id = ?', [supplierId]);
    if (!s || s.status === 'blocked') throw new StockError('Choose the supplier');
  }
  const today = pricing.istToday();
  const day = String(data.received_on || today);
  if (!isDate(day) || day > today) throw new StockError('Date: today or earlier');
  await books.assertOpen(q, day);
  if (!opts.allowPast && day < new Date(Date.now() + 5.5 * 3600e3 - 60 * 86400e3).toISOString().slice(0, 10)) throw new StockError('Date: at most 60 days back');
  const reference = String(data.reference || '').trim().slice(0, 60) || null;
  if (kind === 'purchase' && !reference) throw new StockError("Reference: the supplier's bill number");
  const raw = Array.isArray(data.lines) ? data.lines : [];
  if (!raw.length) throw new StockError('Add at least one line (scan or type a SKU)');
  const codes = [...new Set(raw.map((l) => String(l.sku_code || '').trim().toUpperCase()))];
  const [known] = await q.query('SELECT sku_code FROM skus WHERE sku_code IN (?)', [codes]);
  const knownSet = new Set(known.map((k) => k.sku_code));
  const tr = await tracked(q, codes);
  const problems = [];
  const lines = raw.map((l, n) => {
    const sku = String(l.sku_code || '').trim().toUpperCase();
    const at = `Line ${n + 1} (${sku || 'no SKU'})`;
    const qty = Number(l.qty);
    const cost = String(l.unit_cost ?? '').trim();
    if (!knownSet.has(sku)) problems.push(`${at}: unknown SKU`);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) problems.push(`${at}: quantity in packs, a whole number from 1`);
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(cost) || Number(cost) <= 0) problems.push(`${at}: cost per pack, e.g. 24.50`);
    const out = { sku_code: sku, qty, unit_cost: Number(cost) };
    if (tr.has(sku)) {
      out.batch_no = String(l.batch_no || '').trim().toUpperCase();
      out.mfg_date = String(l.mfg_date || '');
      out.expiry_date = String(l.expiry_date || '');
      if (!/^[A-Z0-9][A-Z0-9/-]{0,29}$/.test(out.batch_no)) problems.push(`${at}: batch no. (letters, digits, - or /) is required for this product`);
      if (!isDate(out.mfg_date) || out.mfg_date > today) problems.push(`${at}: manufacture date, today or earlier`);
      if (!isDate(out.expiry_date) || out.expiry_date <= out.mfg_date) problems.push(`${at}: expiry date after the manufacture date`);
    }
    return out;
  });
  if (problems.length) throw new StockError(problems.join('. '));
  const [ins] = await q.query('INSERT INTO stock_ins (kind, godown_id, supplier_id, received_on, reference, note, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [kind, godown, supplierId, day, reference, String(data.note || '').trim().slice(0, 255) || null, empId]);
  const id = ins.insertId;
  const done = [];
  for (const l of lines) {
    const [[s]] = await q.query('SELECT avg_cost FROM skus WHERE sku_code = ? FOR UPDATE', [l.sku_code]);
    const [[st]] = await q.query("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND stock_kind = 'good'", [l.sku_code]); // the average is across every godown
    const onHand = Math.max(Number(st.n), 0);
    const before = s.avg_cost === null ? null : Number(s.avg_cost);
    const after = before === null || onHand === 0 ? l.unit_cost : round2((onHand * before + l.qty * l.unit_cost) / (onHand + l.qty));
    await q.query('UPDATE skus SET avg_cost = ? WHERE sku_code = ?', [after, l.sku_code]);
    let batchId = null;
    if (l.batch_no) {
      const [[b]] = await q.query("SELECT batch_id, DATE_FORMAT(mfg_date, '%Y-%m-%d') AS mfg, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS exp FROM batches WHERE sku_code = ? AND batch_no = ?", [l.sku_code, l.batch_no]);
      if (b && (b.mfg !== l.mfg_date || b.exp !== l.expiry_date)) throw new StockError(`${l.sku_code} batch ${l.batch_no} exists already with other dates (made ${b.mfg}, expires ${b.exp})`);
      batchId = b ? b.batch_id : (await q.query('INSERT INTO batches (sku_code, batch_no, mfg_date, expiry_date, created_by) VALUES (?, ?, ?, ?, ?)', [l.sku_code, l.batch_no, l.mfg_date, l.expiry_date, empId]))[0].insertId;
    }
    await q.query('INSERT INTO stock_in_lines (stock_in_id, sku_code, qty, unit_cost, batch_id, avg_before, avg_after) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, l.sku_code, l.qty, l.unit_cost, batchId, before, after]);
    await moveStock(q, { sku: l.sku_code, godown, shelf: 'good', qty: l.qty, batch: batchId, what: kind, unitCost: l.unit_cost, doc: { type: 'stock_in', id }, note: reference, at: opts.at }, empId);
    done.push({ sku_code: l.sku_code, qty: l.qty, batch_no: l.batch_no || null, avg_before: before, avg_after: after });
  }
  await audit(q, { empId, action: 'stock_in', entity: 'stock', entityId: `SI-${id}`, after: { kind, godown, supplier_id: supplierId, received_on: day, reference, lines: done.map((d) => `${d.qty} x ${d.sku_code}${d.batch_no ? ` (${d.batch_no})` : ''}`) } });
  return { stock_in_id: id, lines: done };
}

// ---------------------------------------------------------------- dispatch (FEFO) and goods back
/** the SKU's weighted average cost now: kept on every stock-out movement (the cost of what was sold, for the margin) */
async function costNow(q, sku) {
  const [[s]] = await q.query('SELECT avg_cost FROM skus WHERE sku_code = ?', [sku]);
  return s && s.avg_cost !== null ? Number(s.avg_cost) : null;
}

/**
 * the average cost valid at `at` (the last stock-in of the SKU up to then: its avg_after) - for the demo seed, whose
 * dispatches are dated back after they are made
 */
async function costAt(q, sku, at) {
  const [[r]] = await q.query(`SELECT l.avg_after FROM stock_in_lines l JOIN stock_movements m ON m.ref_type = 'stock_in' AND m.ref_id = l.stock_in_id AND m.sku_code = l.sku_code
      WHERE l.sku_code = ? AND m.created_at <= ? ORDER BY m.created_at DESC, l.stock_in_id DESC LIMIT 1`, [sku, at]);
  return r ? Number(r.avg_after) : null;
}

/**
 * take an order's packs out of good stock of its godown -> [{ sku_code, batch_no, expiry_date, qty }]. The batches picked
 * at packing (order_picks) when there are any and they are still there and not expired; else earliest expiry first,
 * never expired (moveStock).
 */
async function dispatchOut(q, orderId, orderNo, empId) {
  const [[o]] = await q.query('SELECT godown_id FROM orders WHERE order_id = ?', [orderId]);
  const godown = needGodown(o && o.godown_id);
  const [sums] = await q.query('SELECT sku_code, SUM(qty) AS qty FROM order_items WHERE order_id = ? GROUP BY sku_code ORDER BY sku_code', [orderId]); // a free line (buy X get Y) may repeat a SKU
  const items = sums.map((x) => ({ sku_code: x.sku_code, qty: Number(x.qty) }));
  await lockSkus(q, items.map((i) => i.sku_code)); // the stock sums below read the latest rows (FOR SHARE): two dispatches never both take the last packs
  const [picked] = await q.query('SELECT sku_code, batch_id, qty FROM order_picks WHERE order_id = ? ORDER BY pick_id', [orderId]);
  const doc = { type: 'order', id: orderNo };
  const out = [];
  if (picked.length) {
    let ok = true;
    for (const pk of picked.filter((x) => x.batch_id)) {
      const b = (await batchStock(q, pk.sku_code, 'good', { lock: true, godown })).find((x) => x.batch_id === pk.batch_id);
      if (!b || b.expired || b.qty < pk.qty) ok = false;
    }
    const sumsPicked = new Map();
    picked.forEach((pk) => sumsPicked.set(pk.sku_code, (sumsPicked.get(pk.sku_code) || 0) + pk.qty));
    if (ok && items.every((i) => sumsPicked.get(i.sku_code) === i.qty)) {
      for (const pk of picked) {
        const lots = await moveStock(q, { sku: pk.sku_code, godown, shelf: 'good', qty: -pk.qty, batch: pk.batch_id, what: 'out', unitCost: await costNow(q, pk.sku_code), doc, note: `Dispatched ${orderNo}` }, empId);
        lots.forEach((l) => out.push({ sku_code: pk.sku_code, ...l }));
      }
      return out.map((p) => ({ sku_code: p.sku_code, batch_no: p.batch_no || null, expiry_date: p.expiry_date || null, qty: p.qty }));
    }
  }
  for (const i of items) {
    const lots = await moveStock(q, { sku: i.sku_code, godown, shelf: 'good', qty: -i.qty, what: 'out', unitCost: await costNow(q, i.sku_code), doc, note: `Dispatched ${orderNo}` }, empId);
    lots.forEach((l) => out.push({ sku_code: i.sku_code, ...l }));
  }
  return out.map((p) => ({ sku_code: p.sku_code, batch_no: p.batch_no || null, expiry_date: p.expiry_date || null, qty: p.qty }));
}

/** an order cancelled after dispatch: its packs come back into good stock of the godown they left, each to its batch */
async function goodsBack(q, orderNo, empId, unpacked = false) {
  const [rows] = await q.query("SELECT location_id, sku_code, batch_id, -SUM(delta) AS qty FROM stock_movements WHERE ref_type = 'order' AND ref_id = ? AND move_type = 'out' GROUP BY location_id, sku_code, batch_id HAVING qty > 0", [orderNo]);
  for (const r of rows) await moveStock(q, { sku: r.sku_code, godown: r.location_id, shelf: 'good', qty: Number(r.qty), batch: r.batch_id, what: 'return', doc: { type: 'order', id: orderNo }, note: unpacked ? `Unpacked: order cancelled ${orderNo}` : `Cancelled after dispatch, goods back: ${orderNo}` }, empId); // phase 20: packed, not yet gone
  return rows.length;
}

/** which batches an order took (for the order drawer) */
async function batchesOfOrder(q, orderNo) {
  const [rows] = await q.query(
    `SELECT m.sku_code, b.batch_no, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date, -SUM(m.delta) AS qty
       FROM stock_movements m JOIN batches b ON b.batch_id = m.batch_id
      WHERE m.ref_type = 'order' AND m.ref_id = ? AND m.move_type = 'out' GROUP BY m.sku_code, b.batch_no, b.expiry_date ORDER BY m.sku_code, b.expiry_date`, [orderNo]
  );
  return rows.map((r) => ({ ...r, qty: Number(r.qty) }));
}

// ---------------------------------------------------------------- write-off
async function postWriteOff(q, id, empId) {
  const [[w]] = await q.query('SELECT write_off_id, godown_id, sku_code, stock_kind, batch_id, qty, reason_type, reason, status FROM write_offs WHERE write_off_id = ? FOR UPDATE', [id]);
  if (!w || w.status !== 'pending') return false;
  // v23 N3: a write-off naming no batch takes other batches first, the ones other write-offs wait on last
  const last = w.batch_id ? [] : (await pendingWriteOffs(q, { sku: w.sku_code, godown: w.godown_id, shelf: w.stock_kind }, id)).batches;
  try {
    await moveStock(q, { sku: w.sku_code, godown: w.godown_id, shelf: w.stock_kind, qty: -w.qty, batch: w.batch_id, what: 'write_off', doc: { type: 'write_off', id }, note: `${WRITE_OFF_TYPES[w.reason_type]}: ${w.reason}`, last }, empId);
  } catch (e) {
    if (e instanceof StockError) throw new StockError(`Write-off #${id}: ${e.message}`, 409);
    throw e;
  }
  await q.query("UPDATE write_offs SET status = 'posted', posted_at = UTC_TIMESTAMP() WHERE write_off_id = ?", [id]);
  await audit(q, { empId, action: 'write_off', entity: 'stock', entityId: w.sku_code, after: { write_off: id, godown: w.godown_id, qty: w.qty, shelf: w.stock_kind, batch_id: w.batch_id, type: w.reason_type } });
  return true;
}

/** is this batch past its expiry? */
async function expiredBatch(q, batchId) {
  if (!batchId) return false;
  const [[b]] = await q.query(`SELECT (expiry_date < ${IST_TODAY}) AS x FROM batches WHERE batch_id = ?`, [batchId]);
  return Boolean(b && Number(b.x) === 1);
}
/**
 * what may leave the Good shelf of a godown other than for an order (phase 18, v23 woRoom): good less held for orders
 * less write-offs and moves waiting; with a batch named (not an expired one), the expired packs cannot fill the orders
 */
async function goodRoom(q, sku, godown, batchId = null) {
  const a = (await availability(q, [sku], 0, { godown })).get(sku);
  const waiting = (await pendingWriteOffs(q, { sku, godown, shelf: 'good' })).n;
  const base = batchId ? a.good - a.expired : a.good;
  return { room: Math.max(0, round3(base - a.reserved - waiting)), held: a.reserved, waiting };
}

/**
 * packs of a shelf already claimed by write-offs waiting for approval (v23 N3): batch = that batch only; no batch = every
 * write-off waiting on the shelf -> { n, batches: [batch ids they name] }
 */
async function pendingWriteOffs(q, { sku, godown, shelf, batch = null }, exceptId = 0) {
  const [rows] = await q.query(`SELECT batch_id, SUM(qty) AS n FROM write_offs WHERE status = 'pending' AND sku_code = ? AND godown_id = ? AND stock_kind = ?
      AND write_off_id <> ? ${batch ? 'AND batch_id = ?' : ''} GROUP BY batch_id`, batch ? [sku, godown, shelf, exceptId, batch] : [sku, godown, shelf, exceptId]);
  return { n: rows.reduce((a, r) => a + Number(r.n), 0), batches: rows.map((r) => r.batch_id).filter(Boolean) };
}
// phase 17: what happens when a write-off of a production run is rejected (production.js registers it)
const writeOffClosedHooks = [];
const onWriteOffClosed = (fn) => writeOffClosedHooks.push(fn);

/**
 * data = { godown_id, sku_code, stock_kind (shelf), batch_id, qty, reason_type, reason }, photo = { buffer, mimetype } | null
 * -> { write_off_id, status: posted | pending, approval_id, value }
 */
async function requestWriteOff(q, data, empId, photo = null, opts = {}) {
  const godown = needGodown(data.godown_id);
  const sku = String(data.sku_code || '').trim().toUpperCase();
  const kind = KIND_LABEL[data.stock_kind] ? data.stock_kind : null;
  const qty = Number(data.qty);
  const type = WRITE_OFF_TYPES[data.reason_type] ? data.reason_type : null;
  const reason = String(data.reason || '').trim().slice(0, 255);
  const [[s]] = await q.query('SELECT s.sku_code, s.avg_cost, s.sku_type, p.track_batches FROM skus s LEFT JOIN products p ON p.product_id = s.product_id WHERE s.sku_code = ?', [sku]);
  if (!s) throw new StockError('Choose the SKU');
  if (!kind) throw new StockError('From: the shelf (Good, Damaged, Returned or Rejected)');
  // phase 18 (v23 Low2 d): QC hold is cleared only by Quality check; Disputed and On the road only by the transfer
  if (kind === 'hold') throw new StockError('QC hold is cleared only by Quality check: reject it there.');
  if ((kind === 'disp' || kind === 'road') && !opts.transfer) throw new StockError(`The ${KIND_LABEL[kind]} shelf is only for transfers. Decide it on the transfer (Found / Lost).`);
  if (!Number.isInteger(qty) || qty < 1) throw new StockError('Quantity: packs, a whole number from 1');
  if (!type || type === 'prodqc') throw new StockError('Why: choose the reason'); // prodqc: production QC only (phase 17)
  if (!reason) throw new StockError('Say what happened');
  const pic = photo ? await storable(photo) : null; // checked by its bytes and made small (photo-check.js)
  if (photo && !pic) throw new StockError('Photo: a JPEG, PNG or WebP picture');
  let batchId = data.batch_id ? Number(data.batch_id) : null;
  if (Number(s.track_batches) && kind === 'good' && !batchId && !opts.transfer) throw new StockError('This product is tracked by batch: choose the batch');
  if (batchId) {
    const [[b]] = await q.query('SELECT batch_id FROM batches WHERE batch_id = ? AND sku_code = ?', [batchId, sku]);
    if (!b) throw new StockError('That batch is not of this SKU');
  } else batchId = null;
  // phase 17 (v23 N3): the room is counted per batch: write-offs already waiting on the same batch count against it, and
  // on the whole shelf every write-off waiting there does
  for (const b of batchId ? [batchId, null] : [null]) {
    const there = await onShelf(q, { sku, godown, shelf: kind, batch: b });
    const waiting = (await pendingWriteOffs(q, { sku, godown, shelf: kind, batch: b })).n;
    if (there - waiting < qty) throw new StockError(`Only ${Math.max(0, there - waiting)} ${KIND_LABEL[kind].toLowerCase()} packs of ${sku}${b ? ' in that batch' : ''} at this godown${waiting ? ` (${waiting} more wait in other write-offs)` : ''}`);
  }
  if (kind === 'good' && !(await expiredBatch(q, batchId))) { // phase 18 (v23 5.9): packs held for orders are protected (an expired batch can fill no order)
    const room = await goodRoom(q, sku, godown, batchId);
    if (qty > room.room) throw new StockError(`${room.held} are held for orders${room.waiting ? ` and ${room.waiting} wait in other write-offs` : ''}. Only ${room.room} can be written off from Good.`);
  }
  const f = await frozenBy(q, godown, sku);
  if (f && kind === 'good') throw new StockError(f, 409);
  const value = s.avg_cost === null ? null : round2(qty * Number(s.avg_cost));
  await books.assertOpen(q, pricing.istToday());
  // the packs limit counts all of one person's write-offs today, so splitting slips does not beat it (v21)
  const [[today]] = await q.query(`SELECT COALESCE(SUM(qty), 0) AS n FROM write_offs WHERE emp_id = ? AND kind = 'write_off' AND run_id IS NULL AND status IN ('pending', 'posted')
      AND DATE(CONVERT_TZ(created_at, '+00:00', '+05:30')) = ${IST_TODAY}`, [empId]);
  const packsToday = Number(today.n);
  const check = opts.always ? { needs: true } : await approvals.check(q, 'write_off', { amount: value || 0, qty: qty + packsToday, by: empId });
  const [ins] = await q.query(
    'INSERT INTO write_offs (sku_code, godown_id, stock_kind, batch_id, qty, reason_type, reason, value, photo, photo_type, status, transfer_id, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [sku, godown, kind, batchId, qty, type, reason, value, pic ? pic.buffer : null, pic ? pic.mimetype : null, 'pending', opts.transfer || null, empId]
  );
  const id = ins.insertId;
  await audit(q, { empId, action: 'request', entity: 'write_off', entityId: String(id), after: { sku, godown, qty, shelf: kind, batch_id: batchId, type, reason, value, needs_approval: check.needs, photo: Boolean(photo) } });
  if (!check.needs) {
    await postWriteOff(q, id, empId);
    await approvals.direct(q, 'write_off', { amount: value || 0 }, empId);
    return { write_off_id: id, status: 'posted', approval_id: null, value };
  }
  const approvalId = await approvals.request(q, { kind: 'write_off', godownId: godown, refType: 'write_off', refId: String(id), excluded: opts.excluded || null,
    summary: `Write off ${qty} ${KIND_LABEL[kind].toLowerCase()} packs of ${sku} (${WRITE_OFF_TYPES[type].toLowerCase()}): ${reason}`, amount: value, payload: { write_off_id: id } }, empId);
  await q.query('UPDATE write_offs SET approval_id = ? WHERE write_off_id = ?', [approvalId, id]);
  return { write_off_id: id, status: 'pending', approval_id: approvalId, value };
}

approvals.onApproved('write_off', async (q, p, empId) => { if (p && p.write_off_id) await postWriteOff(q, p.write_off_id, empId); });
approvals.onRecheck('write_off', async (q, p) => {
  const [[w]] = await q.query('SELECT godown_id, sku_code, stock_kind, batch_id, qty, status FROM write_offs WHERE write_off_id = ?', [p.write_off_id]);
  if (!w || w.status !== 'pending') return 'the write-off is no longer waiting';
  if (w.stock_kind === 'good') { const f = await frozenBy(q, w.godown_id, w.sku_code); if (f) return f; }
  const there = await onShelf(q, { sku: w.sku_code, godown: w.godown_id, shelf: w.stock_kind, batch: w.batch_id });
  return there < w.qty ? `only ${there} ${KIND_LABEL[w.stock_kind].toLowerCase()} packs of ${w.sku_code} are there now, ${w.qty} to write off` : '';
});
// Send again (phase 12b): an expired write-off waits again, while the packs are still there
approvals.onAgain('write_off', async (q, p) => {
  const [[w]] = await q.query('SELECT godown_id, sku_code, stock_kind, batch_id, qty, status FROM write_offs WHERE write_off_id = ? FOR UPDATE', [p.write_off_id]);
  if (!w) return 'the write-off is gone';
  if (w.status !== 'rejected') return `the write-off is ${w.status}`;
  const there = await onShelf(q, { sku: w.sku_code, godown: w.godown_id, shelf: w.stock_kind, batch: w.batch_id });
  if (there < w.qty) return `only ${there} ${KIND_LABEL[w.stock_kind].toLowerCase()} packs of ${w.sku_code} are there now, ${w.qty} to write off`;
  await q.query("UPDATE write_offs SET status = 'pending' WHERE write_off_id = ?", [p.write_off_id]);
  return '';
});
approvals.onClosed('write_off', async (q, p, status, empId) => {
  if (!p || !p.write_off_id) return;
  await q.query("UPDATE write_offs SET status = 'rejected' WHERE write_off_id = ? AND status = 'pending'", [p.write_off_id]);
  await audit(q, { empId, action: status, entity: 'write_off', entityId: String(p.write_off_id) });
  for (const fn of writeOffClosedHooks) await fn(q, p.write_off_id, status, empId);
});

/** good -> damaged (found damaged in the godown) or -> returned (R); from the Record form. data.godown_id required */
async function recordMove(q, data, empId) {
  const godown = needGodown(data.godown_id);
  const sku = String(data.sku_code || '').trim().toUpperCase();
  const qty = Number(data.qty);
  const type = data.move_type;
  if (!['damaged', 'return'].includes(type)) throw new StockError('Type: damaged (good -> damaged) or return (to Returned stock)');
  if (!Number.isInteger(qty) || qty < 1 || qty > 100000) throw new StockError('Quantity: a whole number above 0');
  const [[s]] = await q.query('SELECT s.sku_code, p.track_batches FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.sku_code = ? FOR UPDATE', [sku]);
  if (!s) throw new StockError(`No SKU ${sku}`, 404);
  const batchId = data.batch_id ? Number(data.batch_id) : null;
  if (type === 'damaged' && Number(s.track_batches) && !batchId) throw new StockError('This product is tracked by batch: choose the batch');
  const note = String(data.note || '').trim().slice(0, 255) || null;
  if (type === 'damaged') await moveShelf(q, { sku, godown, from: 'good', to: 'dmg', qty, batch: batchId, what: 'damaged', note }, empId);
  else await moveStock(q, { sku, godown, shelf: 'ret', qty, what: 'return', doc: { type: 'return', id: null }, note }, empId);
  await audit(q, { empId, action: type, entity: 'stock', entityId: sku, after: { godown, qty, batch_id: batchId, note } });
  return { sku_code: sku };
}

// ---------------------------------------------------------------- stock counts
/** start a count in one godown (data: scope = all | a category key, godown_id) */
async function startCount(q, scope, empId, godownId) {
  const godown = needGodown(godownId);
  const sc = String(scope || 'all');
  if (sc !== 'all' && sc !== 'raw') {
    const [[c]] = await q.query('SELECT category_key FROM categories WHERE category_key = ?', [sc]);
    if (!c) throw new StockError('Choose the whole godown, a category or raw materials');
  }
  // one count at a time for the same SKUs of a godown (a category count overlaps an all-SKU count)
  const [[open]] = await q.query(`SELECT count_id, scope FROM stock_counts WHERE godown_id = ? AND status IN ('open', 'pending') ${sc === 'all' ? '' : "AND scope IN (?, 'all')"} LIMIT 1`, sc === 'all' ? [godown] : [godown, sc]);
  if (open) throw new StockError(`ST-${open.count_id} (${open.scope === 'all' ? 'the whole godown' : open.scope === 'raw' ? 'raw materials' : open.scope}) is ${open.status === 'open' ? 'still being counted' : 'waiting for approval'} at this godown. Only one count per shelf at a time: finish it first.`, 409);
  // phase 18: raw materials too; every SKU of the scope with stock on Good, one line per batch (v23)
  const [skus] = await q.query(`SELECT s.sku_code, COALESCE(p.track_batches, 0) AS track_batches FROM skus s LEFT JOIN products p ON p.product_id = s.product_id
      WHERE (s.is_active = 1 OR s.sku_type = 'raw') AND s.status NOT IN ('archived') ${sc === 'all' ? '' : sc === 'raw' ? "AND s.sku_type = 'raw'" : "AND s.sku_type <> 'raw' AND p.category_key = ?"} ORDER BY s.sku_code`, sc === 'all' || sc === 'raw' ? [] : [sc]);
  if (!skus.length) throw new StockError('Nothing to count in that scope');
  const [ins] = await q.query('INSERT INTO stock_counts (scope, godown_id, started_by) VALUES (?, ?, ?)', [sc, godown, empId]);
  const id = ins.insertId;
  for (const s of skus) {
    const bs = (await batchStock(q, s.sku_code, 'good', { godown })).filter((b) => b.qty > 0);
    if (bs.some((b) => b.batch_id)) {
      for (const b of bs) await q.query('INSERT INTO stock_count_lines (count_id, sku_code, batch_id) VALUES (?, ?, ?)', [id, s.sku_code, b.batch_id]);
    } else if (bs.length || sc !== 'all') await q.query('INSERT INTO stock_count_lines (count_id, sku_code) VALUES (?, ?)', [id, s.sku_code]);
  }
  await audit(q, { empId, action: 'count_start', entity: 'stock_count', entityId: String(id), after: { scope: sc, godown, lines: skus.length } });
  return { count_id: id };
}

/** the count with its lines, the live system stock (its godown's Good shelf) and the difference */
async function countDetail(q, id) {
  const [[c]] = await q.query('SELECT count_id, scope, godown_id, status, note, approval_id, started_by, started_at, submitted_by, submitted_at, closed_at FROM stock_counts WHERE count_id = ?', [id]);
  if (!c) throw new StockError('No such count', 404);
  const [lines] = await q.query(
    `SELECT l.line_id, l.sku_code, l.batch_id, b.batch_no, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date, l.expected, l.counted, l.counted_by, l.counted_at,
            COALESCE(t.name, pt.name, s.product_id) AS name, s.size_label,
            (SELECT COALESCE(SUM(m.delta), 0) FROM stock_movements m WHERE m.location_id = ? AND m.sku_code = l.sku_code AND m.stock_kind = 'good' AND (l.batch_id IS NULL OR m.batch_id = l.batch_id)) AS system_qty
       FROM stock_count_lines l JOIN skus s ON s.sku_code = l.sku_code JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
       LEFT JOIN batches b ON b.batch_id = l.batch_id
      WHERE l.count_id = ? ORDER BY l.sku_code, b.expiry_date`, [c.godown_id, id]
  );
  return { ...c, lines: lines.map((l) => {
    const sys = c.status === 'open' ? Number(l.system_qty) : (l.expected === null ? Number(l.system_qty) : Number(l.expected));
    return { ...l, system_qty: sys, diff: l.counted === null ? null : Number(l.counted) - sys };
  }) };
}

/** save counted quantities (open counts): lines = [{ line_id, counted (null = not counted) }] */
async function saveCount(q, id, lines, empId) {
  const [[c]] = await q.query('SELECT status FROM stock_counts WHERE count_id = ? FOR UPDATE', [id]);
  if (!c) throw new StockError('No such count', 404);
  if (c.status !== 'open') throw new StockError(`Count #${id} is ${c.status}: it can no longer be changed`, 409);
  let n = 0;
  for (const l of Array.isArray(lines) ? lines : []) {
    const v = l.counted === '' || l.counted === null || l.counted === undefined ? null : round3(Number(l.counted));
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 1000000)) throw new StockError('Counted: 0 or more');
    const [r] = await q.query('UPDATE stock_count_lines SET counted = ?, counted_by = ?, counted_at = UTC_TIMESTAMP() WHERE line_id = ? AND count_id = ?', [v, empId, Number(l.line_id), id]);
    n += r.affectedRows;
  }
  return { saved: n };
}

/** submit: system stock is fixed now; differences go to approval (none: the count is closed) */
async function submitCount(q, id, empId) {
  const [[c]] = await q.query('SELECT count_id, scope, godown_id, status FROM stock_counts WHERE count_id = ? FOR UPDATE', [id]);
  if (!c) throw new StockError('No such count', 404);
  if (c.status !== 'open') throw new StockError(`Count #${id} is ${c.status} already`, 409);
  const [all] = await q.query('SELECT line_id, sku_code, batch_id, counted FROM stock_count_lines WHERE count_id = ?', [id]);
  const lines = all.filter((l) => l.counted !== null);
  if (!lines.length) throw new StockError('Nothing counted yet: count every batch on the sheet');
  if (lines.length < all.length) throw new StockError(`Count every batch: ${all.length - lines.length} left empty.`); // v23: every line, without the book figure
  const diffs = [];
  for (const l of lines) {
    const sys = await onShelf(q, { sku: l.sku_code, godown: c.godown_id, shelf: 'good', batch: l.batch_id });
    await q.query('UPDATE stock_count_lines SET expected = ? WHERE line_id = ?', [sys, l.line_id]);
    if (round3(Number(l.counted)) !== round3(sys)) diffs.push({ ...l, expected: sys, diff: round3(Number(l.counted) - sys) });
  }
  await q.query('UPDATE stock_counts SET submitted_by = ?, submitted_at = UTC_TIMESTAMP() WHERE count_id = ?', [empId, id]);
  if (!diffs.length) {
    await q.query("UPDATE stock_counts SET status = 'closed', closed_at = UTC_TIMESTAMP() WHERE count_id = ?", [id]);
    await audit(q, { empId, action: 'count_submit', entity: 'stock_count', entityId: String(id), after: { counted: lines.length, differences: 0 } });
    return { status: 'closed', differences: 0 };
  }
  const [costs] = await q.query('SELECT sku_code, avg_cost FROM skus WHERE sku_code IN (?)', [diffs.map((d) => d.sku_code)]);
  const cost = new Map(costs.map((x) => [x.sku_code, Number(x.avg_cost) || 0]));
  const value = round2(diffs.reduce((a, d) => a + Math.abs(d.diff) * (cost.get(d.sku_code) || 0), 0));
  const approvalId = await approvals.request(q, { kind: 'stock_count', godownId: c.godown_id, refType: 'stock_count', refId: String(id),
    summary: `Count #${id} (${c.scope === 'all' ? 'all SKUs' : c.scope}): ${diffs.length} difference${diffs.length === 1 ? '' : 's'} - ${diffs.slice(0, 4).map((d) => `${d.sku_code} ${d.diff > 0 ? '+' : ''}${d.diff}`).join(', ')}${diffs.length > 4 ? ' ...' : ''}`,
    amount: value, payload: { count_id: id } }, empId);
  await q.query("UPDATE stock_counts SET status = 'pending', approval_id = ? WHERE count_id = ?", [approvalId, id]);
  await audit(q, { empId, action: 'count_submit', entity: 'stock_count', entityId: String(id), after: { counted: lines.length, differences: diffs.map((d) => `${d.sku_code} ${d.diff}`), approval: approvalId } });
  return { status: 'pending', differences: diffs.length, approval_id: approvalId };
}

async function postCount(q, id, empId) {
  const [[c]] = await q.query('SELECT status, godown_id FROM stock_counts WHERE count_id = ? FOR UPDATE', [id]);
  if (!c || c.status !== 'pending') return;
  const [lines] = await q.query('SELECT sku_code, batch_id, expected, counted FROM stock_count_lines WHERE count_id = ? AND counted IS NOT NULL AND counted <> expected', [id]);
  for (const l of lines) { // phase 18: at the average cost (the value it moves is on the ledger line)
    await moveStock(q, { sku: l.sku_code, godown: c.godown_id, shelf: 'good', qty: round3(Number(l.counted) - Number(l.expected)), batch: l.batch_id, what: 'count', doc: { type: 'count', id },
      unitCost: await costNow(q, l.sku_code), note: `ST-${id}: counted ${Number(l.counted)}, book ${Number(l.expected)}` }, empId);
  }
  await q.query("UPDATE stock_counts SET status = 'posted', closed_at = UTC_TIMESTAMP() WHERE count_id = ?", [id]);
  await audit(q, { empId, action: 'count_post', entity: 'stock_count', entityId: String(id), after: { adjusted: lines.map((l) => `${l.sku_code} ${Number(l.counted) - Number(l.expected)}`) } });
}
approvals.onApproved('stock_count', async (q, p, empId) => { if (p && p.count_id) await postCount(q, p.count_id, empId); });
approvals.onAgain('stock_count', async (q, p) => {
  const [[c]] = await q.query('SELECT status FROM stock_counts WHERE count_id = ? FOR UPDATE', [p.count_id]);
  if (!c) return 'the stock take is gone';
  if (c.status !== 'rejected') return `the stock take is ${c.status}`;
  await q.query("UPDATE stock_counts SET status = 'pending', closed_at = NULL WHERE count_id = ?", [p.count_id]);
  return '';
});
approvals.onClosed('stock_count', async (q, p, status, empId) => {
  if (!p || !p.count_id) return;
  await q.query("UPDATE stock_counts SET status = 'rejected', closed_at = UTC_TIMESTAMP() WHERE count_id = ? AND status = 'pending'", [p.count_id]);
  await audit(q, { empId, action: status, entity: 'stock_count', entityId: String(p.count_id) });
});

// ---------------------------------------------------------------- reorder and batches
/** SKUs whose available stock in a godown is below its reorder level, with a suggested quantity (full cartons); godowns: [ids] */
async function reorderList(q, godownIds) {
  const cs = await commerceSettings.read(q);
  const [gs] = await q.query('SELECT location_id, code, name FROM locations WHERE is_active = 1 AND location_id IN (?) ORDER BY sort_order, location_id', [godownIds.length ? godownIds : [0]]);
  const out = [];
  for (const g of gs) {
    const [skus] = await q.query(
      `SELECT s.sku_code, s.size_label, s.packs_per_carton, COALESCE(t.name, pt.name, s.product_id) AS name,
              COALESCE(l.reorder_level, ?) AS reorder_level, COALESCE(l.reorder_qty, ?) AS reorder_qty
         FROM skus s JOIN products p ON p.product_id = s.product_id
         LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
         LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
         LEFT JOIN stock_levels l ON l.sku_code = s.sku_code AND l.location_id = ?
        WHERE s.is_active = 1 ORDER BY s.sku_code`, [Number(cs.low_level_default) || 20, Number(cs.reorder_qty_default) || 0, g.location_id]
    );
    const av = await availability(q, skus.map((s) => s.sku_code), 0, { godown: g.location_id });
    for (const s of skus) {
      const a = av.get(s.sku_code);
      const ppc = Number(s.packs_per_carton) || 1;
      const level = Number(s.reorder_level);
      if (a.available >= level) continue;
      const raw = Number(s.reorder_qty) > 0 ? Number(s.reorder_qty) : Math.max(level * 2 - a.available, ppc);
      out.push({ ...s, godown_id: g.location_id, godown: g.name, godown_code: g.code, reorder_level: level, reorder_qty: Number(s.reorder_qty), ...a, suggested: Math.ceil(raw / ppc) * ppc, cartons: Math.ceil(raw / ppc) });
    }
  }
  return out;
}

/** batches with good stock in these godowns (null = every godown): expired, near expiry (the product's warn days, else the Switches default) or ok */
async function batchList(q, godownIds = null) {
  const cs = await commerceSettings.read(q);
  const warn = Number(cs.expiry_warn_days) || 60;
  const gw = godownIds === null ? ['1 = 1', []] : [godownIds.length ? 'm.location_id IN (?)' : '1 = 0', godownIds.length ? [godownIds] : []];
  const [rows] = await q.query(
    `SELECT b.batch_id, b.sku_code, b.batch_no, DATE_FORMAT(b.mfg_date, '%Y-%m-%d') AS mfg_date, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
            DATEDIFF(b.expiry_date, ${IST_TODAY}) AS days_left, COALESCE(t.name, pt.name, s.product_id) AS name, s.size_label, p.near_expiry_days,
            COALESCE(SUM(CASE WHEN m.stock_kind = 'good' THEN m.delta END), 0) AS good,
            COALESCE(SUM(CASE WHEN m.stock_kind = 'dmg' THEN m.delta END), 0) AS damaged
       FROM batches b JOIN skus s ON s.sku_code = b.sku_code JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
       LEFT JOIN stock_movements m ON m.batch_id = b.batch_id AND ${gw[0]}
      GROUP BY b.batch_id, b.sku_code, b.batch_no, b.mfg_date, b.expiry_date, t.name, pt.name, s.product_id, s.size_label, p.near_expiry_days
      ORDER BY b.expiry_date`, gw[1]
  );
  return { warnDays: warn, rows: rows.map(({ near_expiry_days: own, ...r }) => {
    const d = Number(r.days_left);
    const w = own === null || own === undefined ? warn : Number(own); // phase 14: per product; the Switches value is the default
    return { ...r, days_left: d, warn_days: w, good: Number(r.good), damaged: Number(r.damaged), state: d < 0 ? 'expired' : d <= w ? 'near' : 'ok' };
  }) };
}

module.exports = {
  onGoodIn, flushGoodIn, MOVE_LABEL, KIND_LABEL, SHELVES, WRITE_OFF_TYPES, WRITE_OFF_NEXT, StockError, pendingWriteOffs, onWriteOffClosed, round3, frozenBy, scannedLots, goodRoom, expiredBatch, availability, batchStock, onShelf, tracked, lockSkus, moveStock, moveShelf, stockIn, dispatchOut,
  goodsBack, batchesOfOrder, costNow, costAt, requestWriteOff, postWriteOff, recordMove, startCount, countDetail, saveCount, submitCount, reorderList, batchList, IST_TODAY,
};
