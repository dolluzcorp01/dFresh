// Inventory (docs/COMMERCE-SPEC.md 4.4; migration 20261020_commerce_stock.sql): shared by the admin routes, the order
// logic (commerce.js) and the demo seed, so every stock change is made the same way.
// - Stock on hand = SUM(stock_movements.delta) per SKU, kind (good / returned / damaged / expired: returned packs found
//   expired at inspection, blocked until written off) and batch. Nothing is typed in.
// - Available = good stock - expired batches - active reservations of other orders (phase 3).
// - Stock in (production from the Kanchipuram unit, or purchase from a supplier): lines in packs with a cost per pack;
//   each line updates the SKU's weighted average cost: (on hand x old average + qty x cost) / (on hand + qty).
// - Batches (products.track_batches): a stock in of such a SKU needs batch no., manufacture and expiry date; dispatch
//   takes the earliest expiry first (FEFO), never an expired batch, and records which batch went out.
// - Write-off (damaged / expired / lost / sample): above the Commerce setting thresholds it waits for approval, then
//   posts; below them it posts at once.
// - Stock count: all SKUs or a category (batch-tracked SKUs per batch); on submit the differences (counted - system)
//   go to approval and post as "count" movements when approved.
// Every action writes the audit log.
const { audit } = require('./audit');
const approvals = require('./approvals');
const commerceSettings = require('./commerce-settings');
const pricing = require('./pricing');

const MOVE_LABEL = {
  production: 'Stock in (production)', purchase: 'Stock in (purchase)', out: 'Dispatched', return: 'Back in', damaged: 'Moved to damaged',
  write_off: 'Write-off', count: 'Count difference', in: 'In', adjust: 'Adjust', recheck: 'Recheck (R) to good',
};
const KIND_LABEL = { good: 'Good', returned: 'Returned (R)', damaged: 'Damaged', expired: 'Expired (blocked)' };
const WRITE_OFF_TYPES = { damaged: 'Damaged', expired: 'Expired', lost: 'Lost', sample: 'Sample' };
const round2 = (n) => Math.round(n * 100) / 100;
const IST_TODAY = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))";

class StockError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function tracked(q, skuCodes) {
  if (!skuCodes.length) return new Set();
  const [rows] = await q.query('SELECT s.sku_code FROM skus s JOIN products p ON p.product_id = s.product_id WHERE p.track_batches = 1 AND s.sku_code IN (?)', [skuCodes]);
  return new Set(rows.map((r) => r.sku_code));
}

/** good stock, expired (batches past expiry), reserved by other orders, available -> Map sku -> {...} */
async function availability(q, skuCodes, exceptOrderId = 0) {
  const out = new Map();
  if (!skuCodes.length) return out;
  const [good] = await q.query("SELECT sku_code, COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE stock_kind = 'good' AND sku_code IN (?) GROUP BY sku_code", [skuCodes]);
  const [exp] = await q.query(
    `SELECT m.sku_code, SUM(m.delta) AS n FROM stock_movements m JOIN batches b ON b.batch_id = m.batch_id
      WHERE m.stock_kind = 'good' AND b.expiry_date < ${IST_TODAY} AND m.sku_code IN (?) GROUP BY m.sku_code, m.batch_id HAVING n > 0`, [skuCodes]
  );
  const [res] = await q.query("SELECT sku_code, COALESCE(SUM(qty), 0) AS n FROM stock_reservations WHERE status = 'active' AND sku_code IN (?) AND order_id <> ? GROUP BY sku_code", [skuCodes, exceptOrderId || 0]);
  const g = new Map(good.map((r) => [r.sku_code, Number(r.n)]));
  const e = new Map();
  for (const r of exp) e.set(r.sku_code, (e.get(r.sku_code) || 0) + Number(r.n));
  const rv = new Map(res.map((r) => [r.sku_code, Number(r.n)]));
  for (const s of skuCodes) {
    const x = { good: g.get(s) || 0, expired: e.get(s) || 0, reserved: rv.get(s) || 0 };
    out.set(s, { ...x, available: x.good - x.expired - x.reserved });
  }
  return out;
}

/** stock of one SKU and kind per batch -> [{ batch_id, batch_no, mfg_date, expiry_date, qty, expired }] (batch_id null = no batch) */
async function batchStock(q, sku, kind = 'good') {
  const [rows] = await q.query(
    `SELECT m.batch_id, b.batch_no, DATE_FORMAT(b.mfg_date, '%Y-%m-%d') AS mfg_date, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
            SUM(m.delta) AS qty, (b.expiry_date < ${IST_TODAY}) AS expired
       FROM stock_movements m LEFT JOIN batches b ON b.batch_id = m.batch_id
      WHERE m.sku_code = ? AND m.stock_kind = ? GROUP BY m.batch_id, b.batch_no, b.mfg_date, b.expiry_date HAVING qty <> 0
      ORDER BY b.expiry_date IS NULL, b.expiry_date, m.batch_id`, [sku, kind]
  );
  return rows.map((r) => ({ ...r, qty: Number(r.qty), expired: Number(r.expired) === 1 }));
}

async function move(q, m, empId) {
  await q.query(
    `INSERT INTO stock_movements (sku_code, stock_kind, move_type, delta, batch_id, unit_cost, ref_type, ref_id, note, emp_id${m.at ? ', created_at' : ''})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${m.at ? ', ?' : ''})`,
    [m.sku, m.kind || 'good', m.type, m.delta, m.batchId || null, m.unitCost ?? null, m.refType || null, m.refId === undefined || m.refId === null ? null : String(m.refId),
      m.note ? String(m.note).slice(0, 255) : null, empId, ...(m.at ? [m.at] : [])]
  );
}

const isDate = (s) => pricing.isDate(String(s || ''));

// ---------------------------------------------------------------- stock in
/**
 * data = { kind: production | purchase, supplier_id, received_on, reference, note,
 *          lines: [{ sku_code, qty (packs), unit_cost (per pack), batch_no, mfg_date, expiry_date }] }
 * opts.allowPast (seed: any date; the admin allows up to 60 days back). -> { stock_in_id, lines: [{ sku_code, qty, avg_before, avg_after }] }
 */
async function stockIn(q, data, empId, opts = {}) {
  const kind = data.kind;
  if (!['production', 'purchase'].includes(kind)) throw new StockError('Choose Production (our Kanchipuram unit) or Purchase (from a supplier)');
  let supplierId = null;
  if (kind === 'purchase') {
    supplierId = Number(data.supplier_id);
    const [[s]] = await q.query('SELECT supplier_id, is_active FROM suppliers WHERE supplier_id = ?', [supplierId]);
    if (!s || !Number(s.is_active)) throw new StockError('Choose the supplier');
  }
  const today = pricing.istToday();
  const day = String(data.received_on || today);
  if (!isDate(day) || day > today) throw new StockError('Date: today or earlier');
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
  const [ins] = await q.query('INSERT INTO stock_ins (kind, supplier_id, received_on, reference, note, emp_id) VALUES (?, ?, ?, ?, ?, ?)',
    [kind, supplierId, day, reference, String(data.note || '').trim().slice(0, 255) || null, empId]);
  const id = ins.insertId;
  const done = [];
  for (const l of lines) {
    const [[s]] = await q.query('SELECT avg_cost FROM skus WHERE sku_code = ? FOR UPDATE', [l.sku_code]);
    const [[st]] = await q.query("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND stock_kind = 'good'", [l.sku_code]);
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
    await move(q, { sku: l.sku_code, type: kind, delta: l.qty, batchId, unitCost: l.unit_cost, refType: 'stock_in', refId: id, note: reference, at: opts.at }, empId);
    done.push({ sku_code: l.sku_code, qty: l.qty, batch_no: l.batch_no || null, avg_before: before, avg_after: after });
  }
  await audit(q, { empId, action: 'stock_in', entity: 'stock', entityId: `SI-${id}`, after: { kind, supplier_id: supplierId, received_on: day, reference, lines: done.map((d) => `${d.qty} x ${d.sku_code}${d.batch_no ? ` (${d.batch_no})` : ''}`) } });
  return { stock_in_id: id, lines: done };
}

// ---------------------------------------------------------------- dispatch (FEFO) and goods back
/**
 * take an order's packs out of good stock -> [{ sku_code, batch_no, expiry_date, qty }]. The batches picked at packing
 * (order_picks) when there are any and they are still there and not expired; else earliest expiry first, never expired.
 */
async function dispatchOut(q, orderId, orderNo, empId) {
  const [sums] = await q.query('SELECT sku_code, SUM(qty) AS qty FROM order_items WHERE order_id = ? GROUP BY sku_code ORDER BY sku_code', [orderId]); // a free line (buy X get Y) may repeat a SKU
  const items = sums.map((x) => ({ sku_code: x.sku_code, qty: Number(x.qty) }));
  const tr = await tracked(q, items.map((i) => i.sku_code));
  const [picked] = await q.query('SELECT sku_code, batch_id, qty FROM order_picks WHERE order_id = ? ORDER BY pick_id', [orderId]);
  const plan = [];
  if (picked.length) {
    let ok = true;
    for (const pk of picked.filter((x) => x.batch_id)) {
      const b = (await batchStock(q, pk.sku_code)).find((x) => x.batch_id === pk.batch_id);
      if (!b || b.expired || b.qty < pk.qty) ok = false;
    }
    const sums = new Map();
    picked.forEach((pk) => sums.set(pk.sku_code, (sums.get(pk.sku_code) || 0) + pk.qty));
    if (ok && items.every((i) => sums.get(i.sku_code) === i.qty)) {
      for (const pk of picked) {
        await q.query('SELECT sku_code FROM skus WHERE sku_code = ? FOR UPDATE', [pk.sku_code]);
        if (!pk.batch_id) {
          const [[st]] = await q.query("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND stock_kind = 'good'", [pk.sku_code]);
          if (Number(st.n) < pk.qty) throw new StockError(`Not enough ${pk.sku_code} in the godown: ${Number(st.n)} good, ${pk.qty} needed`, 409);
        }
        const [[b]] = pk.batch_id ? await q.query("SELECT batch_no, DATE_FORMAT(expiry_date, '%Y-%m-%d') AS expiry_date FROM batches WHERE batch_id = ?", [pk.batch_id]) : [[{}]];
        plan.push({ sku_code: pk.sku_code, batch_id: pk.batch_id, batch_no: b.batch_no, expiry_date: b.expiry_date, qty: pk.qty });
      }
      for (const p of plan) await move(q, { sku: p.sku_code, type: 'out', delta: -p.qty, batchId: p.batch_id, refType: 'order', refId: orderNo, note: `Dispatched ${orderNo}` }, empId);
      return plan.map((p) => ({ sku_code: p.sku_code, batch_no: p.batch_no || null, expiry_date: p.expiry_date || null, qty: p.qty }));
    }
  }
  for (const i of items) {
    await q.query('SELECT sku_code FROM skus WHERE sku_code = ? FOR UPDATE', [i.sku_code]);
    if (!tr.has(i.sku_code)) {
      const [[st]] = await q.query("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND stock_kind = 'good'", [i.sku_code]);
      if (Number(st.n) < i.qty) throw new StockError(`Not enough ${i.sku_code} in the godown: ${Number(st.n)} good, ${i.qty} needed`, 409);
      plan.push({ sku_code: i.sku_code, batch_id: null, qty: i.qty });
      continue;
    }
    const batches = (await batchStock(q, i.sku_code)).filter((b) => b.qty > 0);
    const usable = batches.filter((b) => !b.expired); // FEFO: ordered by expiry, the ones without a batch last
    const total = usable.reduce((a, b) => a + b.qty, 0);
    if (total < i.qty) {
      const exp = batches.filter((b) => b.expired).reduce((a, b) => a + b.qty, 0);
      throw new StockError(`Not enough ${i.sku_code} that has not expired: ${total} usable${exp ? ` (${exp} expired, blocked)` : ''}, ${i.qty} needed`, 409);
    }
    let left = i.qty;
    for (const b of usable) {
      if (!left) break;
      const take = Math.min(left, b.qty);
      plan.push({ sku_code: i.sku_code, batch_id: b.batch_id, batch_no: b.batch_no, expiry_date: b.expiry_date, qty: take });
      left -= take;
    }
  }
  for (const p of plan) await move(q, { sku: p.sku_code, type: 'out', delta: -p.qty, batchId: p.batch_id, refType: 'order', refId: orderNo, note: `Dispatched ${orderNo}` }, empId);
  return plan.map((p) => ({ sku_code: p.sku_code, batch_no: p.batch_no || null, expiry_date: p.expiry_date || null, qty: p.qty }));
}

/** an order cancelled after dispatch: its packs come back into good stock, each to the batch it left */
async function goodsBack(q, orderNo, empId) {
  const [rows] = await q.query("SELECT sku_code, batch_id, -SUM(delta) AS qty FROM stock_movements WHERE ref_type = 'order' AND ref_id = ? AND move_type = 'out' GROUP BY sku_code, batch_id HAVING qty > 0", [orderNo]);
  for (const r of rows) await move(q, { sku: r.sku_code, type: 'return', delta: Number(r.qty), batchId: r.batch_id, refType: 'order', refId: orderNo, note: `Cancelled after dispatch, goods back: ${orderNo}` }, empId);
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
  const [[w]] = await q.query('SELECT write_off_id, sku_code, stock_kind, batch_id, qty, reason_type, reason, status FROM write_offs WHERE write_off_id = ? FOR UPDATE', [id]);
  if (!w || w.status !== 'pending') return false;
  await q.query('SELECT sku_code FROM skus WHERE sku_code = ? FOR UPDATE', [w.sku_code]);
  const [[st]] = await q.query(`SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND stock_kind = ? AND ${w.batch_id ? 'batch_id = ?' : '1 = 1'}`,
    w.batch_id ? [w.sku_code, w.stock_kind, w.batch_id] : [w.sku_code, w.stock_kind]);
  if (Number(st.n) < w.qty) throw new StockError(`Write-off #${id}: only ${Number(st.n)} ${KIND_LABEL[w.stock_kind].toLowerCase()} ${w.sku_code} left, ${w.qty} to write off`, 409);
  await move(q, { sku: w.sku_code, kind: w.stock_kind, type: 'write_off', delta: -w.qty, batchId: w.batch_id, refType: 'write_off', refId: id, note: `${WRITE_OFF_TYPES[w.reason_type]}: ${w.reason}` }, empId);
  await q.query("UPDATE write_offs SET status = 'posted', posted_at = UTC_TIMESTAMP() WHERE write_off_id = ?", [id]);
  await audit(q, { empId, action: 'write_off', entity: 'stock', entityId: w.sku_code, after: { write_off: id, qty: w.qty, kind: w.stock_kind, batch_id: w.batch_id, type: w.reason_type } });
  return true;
}

/**
 * data = { sku_code, stock_kind, batch_id, qty, reason_type, reason }, photo = { buffer, mimetype } | null
 * -> { write_off_id, status: posted | pending, approval_id, value }
 */
async function requestWriteOff(q, data, empId, photo = null) {
  const sku = String(data.sku_code || '').trim().toUpperCase();
  const kind = KIND_LABEL[data.stock_kind] ? data.stock_kind : null;
  const qty = Number(data.qty);
  const type = WRITE_OFF_TYPES[data.reason_type] ? data.reason_type : null;
  const reason = String(data.reason || '').trim().slice(0, 255);
  const [[s]] = await q.query('SELECT s.sku_code, s.avg_cost, p.track_batches FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.sku_code = ?', [sku]);
  if (!s) throw new StockError('Choose the SKU');
  if (!kind) throw new StockError('From: good, damaged, returned or expired stock');
  if (!Number.isInteger(qty) || qty < 1) throw new StockError('Quantity: packs, a whole number from 1');
  if (!type) throw new StockError('Why: damaged, expired, lost or sample');
  if (!reason) throw new StockError('Say what happened');
  if (photo && !/^image\/(jpeg|png|webp)$/.test(photo.mimetype)) throw new StockError('Photo: a JPEG, PNG or WebP picture');
  let batchId = data.batch_id ? Number(data.batch_id) : null;
  if (Number(s.track_batches) && kind === 'good' && !batchId) throw new StockError('This product is tracked by batch: choose the batch');
  if (batchId) {
    const [[b]] = await q.query('SELECT batch_id FROM batches WHERE batch_id = ? AND sku_code = ?', [batchId, sku]);
    if (!b) throw new StockError('That batch is not of this SKU');
  } else batchId = null;
  const [[st]] = await q.query(`SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND stock_kind = ? AND ${batchId ? 'batch_id = ?' : '1 = 1'}`, batchId ? [sku, kind, batchId] : [sku, kind]);
  if (Number(st.n) < qty) throw new StockError(`Only ${Number(st.n)} ${KIND_LABEL[kind].toLowerCase()} packs of ${sku}${batchId ? ' in that batch' : ''}`);
  const value = s.avg_cost === null ? null : round2(qty * Number(s.avg_cost));
  const needs = await approvals.needed(q, 'write_off', { amount: value || 0, qty });
  const [ins] = await q.query(
    'INSERT INTO write_offs (sku_code, stock_kind, batch_id, qty, reason_type, reason, value, photo, photo_type, status, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [sku, kind, batchId, qty, type, reason, value, photo ? photo.buffer : null, photo ? photo.mimetype : null, 'pending', empId]
  );
  const id = ins.insertId;
  await audit(q, { empId, action: 'request', entity: 'write_off', entityId: String(id), after: { sku, qty, kind, batch_id: batchId, type, reason, value, needs_approval: needs, photo: Boolean(photo) } });
  if (!needs) { await postWriteOff(q, id, empId); return { write_off_id: id, status: 'posted', approval_id: null, value }; }
  const approvalId = await approvals.request(q, { kind: 'write_off', refType: 'write_off', refId: String(id),
    summary: `Write off ${qty} ${KIND_LABEL[kind].toLowerCase()} packs of ${sku} (${WRITE_OFF_TYPES[type].toLowerCase()}): ${reason}`, amount: value, payload: { write_off_id: id } }, empId);
  await q.query('UPDATE write_offs SET approval_id = ? WHERE write_off_id = ?', [approvalId, id]);
  return { write_off_id: id, status: 'pending', approval_id: approvalId, value };
}

approvals.onApproved('write_off', async (q, p, empId) => { if (p && p.write_off_id) await postWriteOff(q, p.write_off_id, empId); });
approvals.onClosed('write_off', async (q, p, status, empId) => {
  if (!p || !p.write_off_id) return;
  await q.query("UPDATE write_offs SET status = 'rejected' WHERE write_off_id = ? AND status = 'pending'", [p.write_off_id]);
  await audit(q, { empId, action: status, entity: 'write_off', entityId: String(p.write_off_id) });
});

/** good -> damaged (found damaged in the godown) or -> returned (R); from the Record form */
async function recordMove(q, data, empId) {
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
  if (type === 'damaged') {
    const [[st]] = await q.query(`SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND stock_kind = 'good' AND ${batchId ? 'batch_id = ?' : '1 = 1'}`, batchId ? [sku, batchId] : [sku]);
    if (Number(st.n) < qty) throw new StockError(`Only ${Number(st.n)} in good stock for ${sku}`, 409);
    await move(q, { sku, kind: 'good', type: 'damaged', delta: -qty, batchId, note }, empId);
    await move(q, { sku, kind: 'damaged', type: 'damaged', delta: qty, batchId, note }, empId);
  } else await move(q, { sku, kind: 'returned', type: 'return', delta: qty, refType: 'return', note }, empId);
  await audit(q, { empId, action: type, entity: 'stock', entityId: sku, after: { qty, batch_id: batchId, note } });
  return { sku_code: sku };
}

// ---------------------------------------------------------------- stock counts
async function startCount(q, scope, empId) {
  const sc = String(scope || 'all');
  if (sc !== 'all') {
    const [[c]] = await q.query('SELECT category_key FROM categories WHERE category_key = ?', [sc]);
    if (!c) throw new StockError('Choose all SKUs or a category');
  }
  // one count at a time for the same SKUs (a category count overlaps an all-SKU count)
  const [[open]] = await q.query(`SELECT count_id, scope FROM stock_counts WHERE status IN ('open', 'pending') ${sc === 'all' ? '' : "AND scope IN (?, 'all')"} LIMIT 1`, sc === 'all' ? [] : [sc]);
  if (open) throw new StockError(`Count #${open.count_id} (${open.scope === 'all' ? 'all SKUs' : open.scope}) is still open or waiting for approval: finish it first`, 409);
  const [skus] = await q.query(`SELECT s.sku_code, p.track_batches FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.is_active = 1 ${sc === 'all' ? '' : 'AND p.category_key = ?'} ORDER BY s.sku_code`, sc === 'all' ? [] : [sc]);
  if (!skus.length) throw new StockError('No SKU to count in that category');
  const [ins] = await q.query('INSERT INTO stock_counts (scope, started_by) VALUES (?, ?)', [sc, empId]);
  const id = ins.insertId;
  for (const s of skus) {
    if (Number(s.track_batches)) {
      const bs = (await batchStock(q, s.sku_code)).filter((b) => b.batch_id);
      for (const b of bs) await q.query('INSERT INTO stock_count_lines (count_id, sku_code, batch_id) VALUES (?, ?, ?)', [id, s.sku_code, b.batch_id]);
      if (!bs.length) await q.query('INSERT INTO stock_count_lines (count_id, sku_code) VALUES (?, ?)', [id, s.sku_code]);
    } else await q.query('INSERT INTO stock_count_lines (count_id, sku_code) VALUES (?, ?)', [id, s.sku_code]);
  }
  await audit(q, { empId, action: 'count_start', entity: 'stock_count', entityId: String(id), after: { scope: sc, lines: skus.length } });
  return { count_id: id };
}

async function lineSystem(q, line) {
  const [[st]] = await q.query(`SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND stock_kind = 'good' AND ${line.batch_id ? 'batch_id = ?' : '1 = 1'}`,
    line.batch_id ? [line.sku_code, line.batch_id] : [line.sku_code]);
  return Number(st.n);
}

/** the count with its lines, the live system stock and the difference */
async function countDetail(q, id) {
  const [[c]] = await q.query('SELECT count_id, scope, status, note, approval_id, started_by, started_at, submitted_by, submitted_at, closed_at FROM stock_counts WHERE count_id = ?', [id]);
  if (!c) throw new StockError('No such count', 404);
  const [lines] = await q.query(
    `SELECT l.line_id, l.sku_code, l.batch_id, b.batch_no, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date, l.expected, l.counted, l.counted_by, l.counted_at,
            COALESCE(t.name, pt.name, s.product_id) AS name, s.size_label,
            (SELECT COALESCE(SUM(m.delta), 0) FROM stock_movements m WHERE m.sku_code = l.sku_code AND m.stock_kind = 'good' AND (l.batch_id IS NULL OR m.batch_id = l.batch_id)) AS system_qty
       FROM stock_count_lines l JOIN skus s ON s.sku_code = l.sku_code JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
       LEFT JOIN batches b ON b.batch_id = l.batch_id
      WHERE l.count_id = ? ORDER BY l.sku_code, b.expiry_date`, [id]
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
    const v = l.counted === '' || l.counted === null || l.counted === undefined ? null : Number(l.counted);
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 1000000)) throw new StockError('Counted: a whole number, 0 or more');
    const [r] = await q.query('UPDATE stock_count_lines SET counted = ?, counted_by = ?, counted_at = UTC_TIMESTAMP() WHERE line_id = ? AND count_id = ?', [v, empId, Number(l.line_id), id]);
    n += r.affectedRows;
  }
  return { saved: n };
}

/** submit: system stock is fixed now; differences go to approval (none: the count is closed) */
async function submitCount(q, id, empId) {
  const [[c]] = await q.query('SELECT count_id, scope, status FROM stock_counts WHERE count_id = ? FOR UPDATE', [id]);
  if (!c) throw new StockError('No such count', 404);
  if (c.status !== 'open') throw new StockError(`Count #${id} is ${c.status} already`, 409);
  const [lines] = await q.query('SELECT line_id, sku_code, batch_id, counted FROM stock_count_lines WHERE count_id = ? AND counted IS NOT NULL', [id]);
  if (!lines.length) throw new StockError('Nothing counted yet: enter or scan at least one quantity');
  const diffs = [];
  for (const l of lines) {
    const sys = await lineSystem(q, l);
    await q.query('UPDATE stock_count_lines SET expected = ? WHERE line_id = ?', [sys, l.line_id]);
    if (Number(l.counted) !== sys) diffs.push({ ...l, expected: sys, diff: Number(l.counted) - sys });
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
  const approvalId = await approvals.request(q, { kind: 'stock_count', refType: 'stock_count', refId: String(id),
    summary: `Count #${id} (${c.scope === 'all' ? 'all SKUs' : c.scope}): ${diffs.length} difference${diffs.length === 1 ? '' : 's'} - ${diffs.slice(0, 4).map((d) => `${d.sku_code} ${d.diff > 0 ? '+' : ''}${d.diff}`).join(', ')}${diffs.length > 4 ? ' ...' : ''}`,
    amount: value, payload: { count_id: id } }, empId);
  await q.query("UPDATE stock_counts SET status = 'pending', approval_id = ? WHERE count_id = ?", [approvalId, id]);
  await audit(q, { empId, action: 'count_submit', entity: 'stock_count', entityId: String(id), after: { counted: lines.length, differences: diffs.map((d) => `${d.sku_code} ${d.diff}`), approval: approvalId } });
  return { status: 'pending', differences: diffs.length, approval_id: approvalId };
}

async function postCount(q, id, empId) {
  const [[c]] = await q.query('SELECT status FROM stock_counts WHERE count_id = ? FOR UPDATE', [id]);
  if (!c || c.status !== 'pending') return;
  const [lines] = await q.query('SELECT sku_code, batch_id, expected, counted FROM stock_count_lines WHERE count_id = ? AND counted IS NOT NULL AND counted <> expected', [id]);
  for (const l of lines) {
    await move(q, { sku: l.sku_code, type: 'count', delta: Number(l.counted) - Number(l.expected), batchId: l.batch_id, refType: 'count', refId: id, note: `Count #${id}: counted ${l.counted}, system ${l.expected}` }, empId);
  }
  await q.query("UPDATE stock_counts SET status = 'posted', closed_at = UTC_TIMESTAMP() WHERE count_id = ?", [id]);
  await audit(q, { empId, action: 'count_post', entity: 'stock_count', entityId: String(id), after: { adjusted: lines.map((l) => `${l.sku_code} ${Number(l.counted) - Number(l.expected)}`) } });
}
approvals.onApproved('stock_count', async (q, p, empId) => { if (p && p.count_id) await postCount(q, p.count_id, empId); });
approvals.onClosed('stock_count', async (q, p, status, empId) => {
  if (!p || !p.count_id) return;
  await q.query("UPDATE stock_counts SET status = 'rejected', closed_at = UTC_TIMESTAMP() WHERE count_id = ? AND status = 'pending'", [p.count_id]);
  await audit(q, { empId, action: status, entity: 'stock_count', entityId: String(p.count_id) });
});

// ---------------------------------------------------------------- reorder and batches
/** SKUs whose available stock is below the reorder level, with a suggested quantity (full cartons) */
async function reorderList(q) {
  const cs = await commerceSettings.read(q);
  const [skus] = await q.query(
    `SELECT s.sku_code, s.size_label, s.packs_per_carton, COALESCE(t.name, pt.name, s.product_id) AS name,
            COALESCE(l.reorder_level, ?) AS reorder_level, COALESCE(l.reorder_qty, ?) AS reorder_qty
       FROM skus s JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
       LEFT JOIN stock_levels l ON l.sku_code = s.sku_code AND l.location_id = 1
      WHERE s.is_active = 1 ORDER BY s.sku_code`, [Number(cs.low_level_default) || 20, Number(cs.reorder_qty_default) || 0]
  );
  const av = await availability(q, skus.map((s) => s.sku_code));
  return skus.map((s) => {
    const a = av.get(s.sku_code);
    const ppc = Number(s.packs_per_carton) || 1;
    const level = Number(s.reorder_level);
    const raw = Number(s.reorder_qty) > 0 ? Number(s.reorder_qty) : Math.max(level * 2 - a.available, ppc);
    return { ...s, reorder_level: level, reorder_qty: Number(s.reorder_qty), ...a, suggested: Math.ceil(raw / ppc) * ppc, cartons: Math.ceil(raw / ppc) };
  }).filter((s) => s.available < s.reorder_level);
}

/** batches with good stock: expired, near expiry (Commerce setting days) or ok */
async function batchList(q) {
  const cs = await commerceSettings.read(q);
  const warn = Number(cs.expiry_warn_days) || 60;
  const [rows] = await q.query(
    `SELECT b.batch_id, b.sku_code, b.batch_no, DATE_FORMAT(b.mfg_date, '%Y-%m-%d') AS mfg_date, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date,
            DATEDIFF(b.expiry_date, ${IST_TODAY}) AS days_left, COALESCE(t.name, pt.name, s.product_id) AS name, s.size_label,
            COALESCE(SUM(CASE WHEN m.stock_kind = 'good' THEN m.delta END), 0) AS good,
            COALESCE(SUM(CASE WHEN m.stock_kind = 'damaged' THEN m.delta END), 0) AS damaged
       FROM batches b JOIN skus s ON s.sku_code = b.sku_code JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'
       LEFT JOIN stock_movements m ON m.batch_id = b.batch_id
      GROUP BY b.batch_id, b.sku_code, b.batch_no, b.mfg_date, b.expiry_date, t.name, pt.name, s.product_id, s.size_label
      ORDER BY b.expiry_date`
  );
  return { warnDays: warn, rows: rows.map((r) => {
    const d = Number(r.days_left);
    return { ...r, days_left: d, good: Number(r.good), damaged: Number(r.damaged), state: d < 0 ? 'expired' : d <= warn ? 'near' : 'ok' };
  }) };
}

module.exports = {
  MOVE_LABEL, KIND_LABEL, WRITE_OFF_TYPES, StockError, availability, batchStock, tracked, stockIn, dispatchOut, goodsBack, batchesOfOrder,
  requestWriteOff, postWriteOff, recordMove, startCount, countDetail, saveCount, submitCount, reorderList, batchList, IST_TODAY,
};
