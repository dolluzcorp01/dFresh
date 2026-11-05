// Section 5 Inventory (phase 18, v23 "SECTION 5 INVENTORY - THE STOCK ENGINE"): the rules the Inventory pages share
// (routes: inventory-routes.js). Stock still moves only through stock.moveStock (stock.js), which also refuses a move on
// a Good shelf that a stock take is counting and leaves packs a packer has scanned for the packer.
// - Shelves: Good, QC hold, Damaged, Returned (R), Rejected (to go back), Disputed (a transfer short), On the road (in a
//   lorry between godowns). In production = material issued to runs that are running (it has left the shelf).
// - Free to sell = Good less held for orders less expired batches (stock.availability). Value = Good x average cost.
// - Transfers: only free stock goes (never an expired batch, never packs a packer scanned); it leaves the sender's Good
//   shelf for On the road (the company total does not move). Somebody else, at the receiving godown, counts it in:
//   what arrived goes to their Good shelf with its batches; a short goes to their Disputed shelf and its loss waits
//   for approval (rule transit_loss; the sender and the receiver never sign it). Approved: written off. Rejected: the
//   packs go to the sender's Disputed shelf and the sender answers for them: Found (back to Good, a second person
//   signs, rule restock) or Lost (a write-off under its rule, never signed by the sender or the receiver). Found and
//   Lost are not offered while one of them waits.
// - Shelf moves inside a godown are not a loss: Good, Damaged and Returned; Damaged or Returned back to Good needs a
//   second person (rule restock). QC hold is cleared only by Quality check, Disputed only by its transfer.
// - Reorder: packs and raw materials below their level per godown, counting free stock and what is coming (QC hold,
//   open POs, indents, planned and running runs); made packs suggest a run, bought ones an indent.
const { audit } = require('./audit');
const stock = require('./stock');
const approvals = require('./approvals');
const numbering = require('./numbering');
const books = require('./books');
const pricing = require('./pricing');
const buy = require('./buying');
const prod = require('./production');
const commerceSettings = require('./commerce-settings');
const { SKU_NAME, SKU_JOIN } = require('./catalogue');

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const r3 = stock.round3;
const today = () => pricing.istToday();
const rs = (n) => `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const SHELF_ORDER = ['good', 'hold', 'dmg', 'ret', 'rej', 'disp', 'road'];
const MOVE_SHELVES = ['good', 'dmg', 'ret'];
const TR_ST = { transit: 'In a lorry', received: 'Received', short: 'Received short' };

class InvError extends Error {
  constructor(message, status = 400, fields = null) { super(message); this.status = status; this.fields = fields; }
}
const bad = (fields, msg = 'Fix the fields marked in red') => { throw new InvError(msg, 400, fields); };

// ---------------------------------------------------------------- items
/** SKU facts -> Map sku -> { sku_code, name, type, unit, category, per_carton, avg_cost, std_cost, image, near, track, live, made, bought } */
async function items(q, codes = null) {
  const [rows] = await q.query(`SELECT s.sku_code, ${SKU_NAME} AS name, s.size_label, s.sku_type, s.unit_code, s.source, s.status, s.packs_per_carton, s.avg_cost, s.std_cost,
      p.category_key, p.status AS product_status, p.near_expiry_days, COALESCE(p.track_batches, 0) AS track,
      (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1) AS image
      FROM skus s ${SKU_JOIN} ${codes ? 'WHERE s.sku_code IN (?)' : ''} ORDER BY s.sku_type DESC, s.sku_code`, codes ? [codes.length ? codes : ['']] : []);
  return new Map(rows.map((r) => {
    const raw = r.sku_type === 'raw';
    return [r.sku_code, { sku_code: r.sku_code, name: raw ? r.name : `${r.name} ${r.size_label || ''}`.trim(), type: r.sku_type, raw, unit: raw ? r.unit_code : 'pack', category: r.category_key || null,
      per_carton: raw ? null : Number(r.packs_per_carton) || 1, avg_cost: r.avg_cost === null ? null : Number(r.avg_cost), std_cost: r.std_cost === null ? null : Number(r.std_cost),
      image: raw ? null : r.image || null, near: r.near_expiry_days === null ? null : Number(r.near_expiry_days), track: Number(r.track) === 1, status: r.status,
      live: !['archived'].includes(r.status) && (raw || r.product_status !== 'archived'), made: !raw && ['made', 'both'].includes(r.source), bought: raw || ['bought', 'both'].includes(r.source) }];
  }));
}
/** the value of a quantity: average cost, else the standard cost (v23 valOf) */
const unitOf = (it) => (it && it.avg_cost !== null ? it.avg_cost : it && it.std_cost !== null ? it.std_cost : 0);
const valOf = (it, n) => r2(unitOf(it) * n);
const qtyText = (it, n) => prod.qtyText(it ? it.unit : 'pack', n);

// ---------------------------------------------------------------- stock status
/**
 * per item, summed over the godowns in view: good, held, expired, free, near expiry, every other shelf, in production
 * (issued to running runs), reorder level; value = good x average cost. godowns: [ids]
 */
async function stockRows(q, godowns, { kind = 'pack' } = {}) {
  const its = await items(q);
  const list = [...its.values()].filter((x) => x.live && (kind === 'raw' ? x.raw : !x.raw));
  if (!list.length || !godowns.length) return [];
  const codes = list.map((x) => x.sku_code);
  const [sh] = await q.query('SELECT sku_code, stock_kind, SUM(delta) AS n FROM stock_movements WHERE location_id IN (?) AND sku_code IN (?) GROUP BY sku_code, stock_kind', [godowns, codes]);
  const [inProd] = await q.query("SELECT m.sku_code, SUM(m.issued) AS n FROM run_materials m JOIN production_runs r ON r.run_id = m.run_id WHERE r.status = 'started' AND r.godown_id IN (?) GROUP BY m.sku_code", [godowns]);
  const [lv] = await q.query('SELECT sku_code, SUM(reorder_level) AS n FROM stock_levels WHERE location_id IN (?) GROUP BY sku_code', [godowns]);
  const [near] = await q.query(`SELECT m.sku_code, SUM(m.delta) AS n, MIN(DATEDIFF(b.expiry_date, ${stock.IST_TODAY})) AS d, p.near_expiry_days AS w
      FROM stock_movements m JOIN batches b ON b.batch_id = m.batch_id JOIN skus s ON s.sku_code = m.sku_code LEFT JOIN products p ON p.product_id = s.product_id
      WHERE m.location_id IN (?) AND m.stock_kind = 'good' AND b.expiry_date >= ${stock.IST_TODAY} AND DATEDIFF(b.expiry_date, ${stock.IST_TODAY}) < COALESCE(p.near_expiry_days, ?)
      GROUP BY m.sku_code, m.batch_id, p.near_expiry_days HAVING n > 0`, [godowns, Number((await commerceSettings.read(q)).expiry_warn_days) || 60]);
  const av = new Map();
  for (const g of godowns) {
    const a = await stock.availability(q, codes, 0, { godown: g });
    for (const [c, x] of a) { const t = av.get(c) || { good: 0, expired: 0, reserved: 0, available: 0 }; av.set(c, { good: t.good + x.good, expired: t.expired + x.expired, reserved: t.reserved + x.reserved, available: t.available + Math.max(0, x.available) }); }
  }
  const num = (rows, c, k = 'n') => Number((rows.find((r) => r.sku_code === c) || {})[k] || 0);
  return list.map((it) => {
    const s = (k) => r3(Number((sh.find((r) => r.sku_code === it.sku_code && r.stock_kind === k) || {}).n || 0));
    const a = av.get(it.sku_code);
    const level = num(lv, it.sku_code);
    const free = r3(Math.max(0, a.good - a.reserved - a.expired));
    const nearN = r3(near.filter((r) => r.sku_code === it.sku_code).reduce((t, r) => t + Number(r.n), 0));
    return { sku_code: it.sku_code, name: it.name, image: it.image, unit: it.unit, raw: it.raw, category: it.category, per_carton: it.per_carton,
      good: s('good'), held: r3(a.reserved), expired: r3(a.expired), free, near: nearN, hold: s('hold'), dmg: s('dmg'), ret: s('ret'), rej: s('rej'), disp: s('disp'), road: s('road'),
      in_production: r3(num(inProd, it.sku_code)), level, low: level > 0 && free < level, avg_cost: it.avg_cost, value: it.avg_cost === null ? null : r2(s('good') * it.avg_cost) };
  });
}

/** one item: per godown its lots on every shelf (batch, made, expiry, state), and the last moves */
async function itemDetail(q, sku, godowns) {
  const its = await items(q, [sku]);
  const it = its.get(sku);
  if (!it) throw new InvError('No such item', 404);
  const [gs] = await q.query('SELECT location_id AS godown_id, name FROM locations WHERE location_id IN (?) ORDER BY sort_order, location_id', [godowns.length ? godowns : [0]]);
  const warn = it.near !== null ? it.near : Number((await commerceSettings.read(q)).expiry_warn_days) || 60;
  const out = [];
  for (const g of gs) {
    const [lots] = await q.query(`SELECT m.stock_kind, m.batch_id, b.batch_no, DATE_FORMAT(b.mfg_date, '%Y-%m-%d') AS mfg, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS exp,
        DATEDIFF(b.expiry_date, ${stock.IST_TODAY}) AS days, SUM(m.delta) AS n
        FROM stock_movements m LEFT JOIN batches b ON b.batch_id = m.batch_id WHERE m.location_id = ? AND m.sku_code = ?
        GROUP BY m.stock_kind, m.batch_id, b.batch_no, b.mfg_date, b.expiry_date HAVING n <> 0`, [g.godown_id, sku]);
    const a = (await stock.availability(q, [sku], 0, { godown: g.godown_id })).get(sku);
    out.push({ godown_id: g.godown_id, godown: g.name, good: r3(a.good), held: r3(a.reserved), expired: r3(a.expired), free: r3(Math.max(0, a.good - a.reserved - a.expired)),
      lots: lots.map((l) => ({ shelf: l.stock_kind, shelf_label: stock.KIND_LABEL[l.stock_kind], batch_no: l.batch_no || '-', mfg: l.mfg, exp: l.exp, qty: r3(l.n),
        state: !l.exp ? 'none' : Number(l.days) < 0 ? 'expired' : Number(l.days) < warn ? 'near' : 'ok', days: l.days === null ? null : Number(l.days) }))
        .sort((x, y) => SHELF_ORDER.indexOf(x.shelf) - SHELF_ORDER.indexOf(y.shelf) || String(x.exp || '9').localeCompare(String(y.exp || '9'))) });
  }
  const moves = await ledger(q, godowns, { sku, limit: 8 });
  return { sku_code: sku, name: it.name, image: it.image, unit: it.unit, raw: it.raw, per_carton: it.per_carton, avg_cost: it.avg_cost, godowns: out, moves: moves.rows };
}

// ---------------------------------------------------------------- ledger
/** every movement, newest first: { from (day), shelf, q (item, document, batch, person, what), sku, limit } */
async function ledger(q, godowns, f = {}) {
  const where = ['m.location_id IN (?)']; const p = [godowns.length ? godowns : [0]];
  if (f.sku) { where.push('m.sku_code = ?'); p.push(f.sku); }
  if (f.shelf && stock.SHELVES.includes(f.shelf)) { where.push('m.stock_kind = ?'); p.push(f.shelf); }
  if (f.from && pricing.isDate(f.from)) { where.push("m.created_at >= CONVERT_TZ(?, '+05:30', '+00:00')"); p.push(f.from); }
  if (f.q) {
    const like = `%${String(f.q).trim()}%`;
    where.push(`(m.sku_code LIKE ? OR m.ref_id LIKE ? OR m.note LIKE ? OR b.batch_no LIKE ? OR m.move_type LIKE ? OR TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) LIKE ?)`);
    p.push(like, like, like, like, like, like);
  }
  const auth = require('./auth'); // eslint-disable-line global-require
  const [[c]] = await q.query(`SELECT COUNT(*) AS n FROM stock_movements m LEFT JOIN batches b ON b.batch_id = m.batch_id LEFT JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = m.emp_id WHERE ${where.join(' AND ')}`, p);
  const [rows] = await q.query(`SELECT m.move_id, m.created_at, m.sku_code, m.location_id AS godown_id, g.name AS godown, m.stock_kind, m.move_type, m.delta, b.batch_no, m.unit_cost, m.ref_type, m.ref_id, m.note, m.emp_id,
      TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS who
      FROM stock_movements m JOIN locations g ON g.location_id = m.location_id LEFT JOIN batches b ON b.batch_id = m.batch_id LEFT JOIN \`${auth.DADMIN}\`.employee e ON e.emp_id = m.emp_id
      WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC, m.move_id DESC LIMIT ?`, [...p, f.limit || 200]);
  return { total: Number(c.n), rows: rows.map((r) => ({ move_id: r.move_id, at: r.created_at, sku_code: r.sku_code, godown: r.godown, shelf: r.stock_kind, shelf_label: stock.KIND_LABEL[r.stock_kind],
    batch_no: r.batch_no || '-', qty: r3(r.delta), what: stock.MOVE_LABEL[r.move_type] || r.move_type, doc: r.ref_id ? `${r.ref_type === 'write_off' ? 'WO-' : r.ref_type === 'count' ? 'ST-' : ''}${r.ref_id}` : '-',
    note: r.note, unit_cost: r.unit_cost === null ? null : Number(r.unit_cost), who: r.who || r.emp_id, emp_id: r.emp_id })) };
}

// ---------------------------------------------------------------- shelf moves
/**
 * a shelf move inside a godown (not a loss): data = { godown_id, sku_code, from, to, qty, batch_id, note }.
 * Damaged or Returned back to Good waits for a second person (rule restock). -> { move_id, status, approval_id }
 */
async function shelfMove(q, data, empId) {
  const godown = Number(data.godown_id);
  const sku = String(data.sku_code || '').trim().toUpperCase();
  const from = String(data.from || ''); const to = String(data.to || '');
  const qty = Number(data.qty); const note = String(data.note || '').trim().slice(0, 140);
  const e = {};
  const its = await items(q, [sku]);
  const it = its.get(sku);
  if (!it) e.sku_code = 'Choose the item.';
  if (from === 'hold' || to === 'hold') e[from === 'hold' ? 'from' : 'to'] = 'QC hold is cleared only by Quality check.';
  else if (from === 'disp' || to === 'disp' || from === 'road' || to === 'road') e[from === 'disp' || from === 'road' ? 'from' : 'to'] = 'The Disputed shelf is only for transfer shorts. Decide it on the transfer (Found / Lost).';
  else if (!MOVE_SHELVES.includes(from)) e.from = 'Choose the shelf.';
  else if (!MOVE_SHELVES.includes(to)) e.to = 'Choose the shelf.';
  else if (to === from) e.to = 'Pick two different shelves.';
  if (!Number.isInteger(qty) || qty < 1) e.qty = 'A whole number, at least 1.';
  if (!note) e.note = 'Say what happened.';
  if (Object.keys(e).length) bad(e);
  const batchId = data.batch_id ? Number(data.batch_id) : null;
  // room: on the shelf (that batch: only that batch), less other write-offs and moves waiting, less held for orders (Good)
  const have = await stock.onShelf(q, { sku, godown, shelf: from, batch: batchId });
  const waiting = (await stock.pendingWriteOffs(q, { sku, godown, shelf: from, batch: batchId })).n;
  let room = have - waiting;
  if (from === 'good' && !(await stock.expiredBatch(q, batchId))) room = Math.min(room, (await stock.goodRoom(q, sku, godown, batchId)).room);
  if (qty > have) bad({ qty: `Only ${r3(have)} on the ${stock.KIND_LABEL[from].toLowerCase()} shelf${batchId ? ' in that batch' : ''}. Stock never goes below zero.` });
  if (qty > room) bad({ qty: `Only ${Math.max(0, r3(room))} can go: the rest are held for orders or in write-offs and moves waiting for approval.` });
  if (from === 'good' || to === 'good') { const f = await stock.frozenBy(q, godown, sku); if (f) throw new InvError(f, 409); }
  const value = valOf(it, qty);
  const [ins] = await q.query(`INSERT INTO write_offs (sku_code, godown_id, stock_kind, batch_id, qty, reason_type, reason, value, status, kind, to_kind, emp_id)
      VALUES (?, ?, ?, ?, ?, 'other', ?, ?, 'pending', 'move', ?, ?)`, [sku, godown, from, batchId, qty, note, value, to, empId]);
  const id = ins.insertId;
  if (to === 'good' && (await approvals.check(q, 'restock', { amount: value })).needs) {
    const aid = await approvals.request(q, { kind: 'restock', godownId: godown, refType: 'write_off', refId: String(id), amount: value, payload: { move_id: id },
      summary: `${stock.KIND_LABEL[from]} ${sku} x${qty} back to Good: ${note}` }, empId);
    await q.query('UPDATE write_offs SET approval_id = ? WHERE write_off_id = ?', [aid, id]);
    await audit(q, { empId, action: 'request', entity: 'write_off', entityId: String(id), after: { move: `${stock.KIND_LABEL[from]} to Good`, sku, qty, godown, approval: aid } });
    return { move_id: id, status: 'pending', approval_id: aid };
  }
  await postMove(q, id, empId);
  return { move_id: id, status: 'posted', approval_id: null };
}
/** a shelf move (or a Found) takes effect: the same batches, from one shelf to the other */
async function postMove(q, id, empId) {
  const [[w]] = await q.query('SELECT write_off_id, sku_code, godown_id, stock_kind, to_kind, batch_id, qty, reason, transfer_id, status FROM write_offs WHERE write_off_id = ? FOR UPDATE', [id]);
  if (!w || w.status !== 'pending') return false;
  await stock.moveShelf(q, { sku: w.sku_code, godown: w.godown_id, from: w.stock_kind, to: w.to_kind, qty: Number(w.qty), batch: w.batch_id, doc: { type: 'write_off', id },
    what: w.transfer_id ? 'found' : 'shelf', note: w.transfer_id ? `Found after the transfer: ${w.reason}` : `Shelf move: ${w.reason}` }, empId);
  await q.query("UPDATE write_offs SET status = 'posted', posted_at = UTC_TIMESTAMP() WHERE write_off_id = ?", [id]);
  await audit(q, { empId, action: 'move', entity: 'stock', entityId: w.sku_code, after: { move: `WO-${id}`, from: stock.KIND_LABEL[w.stock_kind], to: stock.KIND_LABEL[w.to_kind], qty: Number(w.qty), godown: w.godown_id } });
  return true;
}
async function moveRecheck(q, id) {
  const [[w]] = await q.query('SELECT godown_id, sku_code, stock_kind, batch_id, qty, status FROM write_offs WHERE write_off_id = ?', [id]);
  if (!w || w.status !== 'pending') return 'the move is no longer waiting';
  const there = await stock.onShelf(q, { sku: w.sku_code, godown: w.godown_id, shelf: w.stock_kind, batch: w.batch_id });
  if (there < Number(w.qty)) return `only ${r3(there)} of ${w.sku_code} are on the ${stock.KIND_LABEL[w.stock_kind].toLowerCase()} shelf now, ${Number(w.qty)} to move`;
  return stock.frozenBy(q, w.godown_id, w.sku_code);
}
async function moveClosed(q, id, status, empId) {
  await q.query("UPDATE write_offs SET status = 'rejected' WHERE write_off_id = ? AND status = 'pending'", [id]);
  await audit(q, { empId, action: status, entity: 'write_off', entityId: String(id), after: { move: 'stays where it is' } });
}

// ---------------------------------------------------------------- transfers
async function transferOf(q, id, lock = false) {
  const [[t]] = await q.query(`SELECT t.*, gf.name AS from_name, gt.name AS to_name FROM transfers t JOIN locations gf ON gf.location_id = t.from_godown JOIN locations gt ON gt.location_id = t.to_godown
      WHERE t.transfer_id = ?${lock ? ' FOR UPDATE' : ''}`, [Number(id)]);
  if (!t) return null;
  const [lines] = await q.query('SELECT line_no, sku_code, qty, recv, lots FROM transfer_lines WHERE transfer_id = ? ORDER BY line_no', [t.transfer_id]);
  t.lines = lines.map((l) => ({ line_no: l.line_no, sku_code: l.sku_code, qty: r3(l.qty), recv: l.recv === null ? null : r3(l.recv), lots: typeof l.lots === 'string' ? JSON.parse(l.lots) : l.lots }));
  return t;
}
/** the e-way bill limit (Company: e-way bills, the value above which one is needed) */
async function ewayRule(q) {
  const cs = await commerceSettings.read(q);
  return { on: Boolean(cs.eway_bill_required), above: Number(cs.eway_bill_above) || 50000 };
}

/**
 * dispatch a transfer: data = { from, to, vehicle_no, driver, ewb_no, lines: [{ sku_code, qty }] } -> { transfer }
 * Only free stock goes, earliest expiry first, never expired, never packs a packer scanned; Good -> On the road.
 */
async function sendTransfer(q, data, empId, admin) {
  const godowns = require('./godowns'); // eslint-disable-line global-require
  const from = Number(data.from); const to = Number(data.to);
  const veh = String(data.vehicle_no || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const e = {};
  const gs = await godowns.list(q);
  const gf = gs.find((g) => g.godown_id === from && g.is_active); const gt = gs.find((g) => g.godown_id === to && g.is_active);
  if (!gf || !godowns.covers(admin, from)) e.from = 'Choose a godown you work at.';
  if (!gt) e.to = 'Choose where it goes.'; else if (to === from) e.to = 'Pick two different godowns.';
  if (!/^[A-Z]{2} ?\d{1,2} ?[A-Z]{0,3} ?\d{4}$/.test(veh)) e.vehicle_no = 'Like TN 21 BC 4417. The lorry is a place: it needs a number.';
  const raw = Array.isArray(data.lines) ? data.lines : [];
  const codes = raw.map((l) => String(l.sku_code || '').trim().toUpperCase()).filter(Boolean);
  const its = await items(q, codes);
  const lines = []; const seen = new Set();
  await stock.lockSkus(q, codes);
  for (const [i, l] of raw.entries()) {
    const sku = String(l.sku_code || '').trim().toUpperCase(); const qn = String(l.qty ?? '').trim();
    if (!sku && !qn) continue;
    const it = its.get(sku);
    if (!it) { e[`lines.${i}.sku_code`] = 'Choose the item.'; continue; }
    if (seen.has(sku)) { e[`lines.${i}.sku_code`] = 'Already on this note.'; continue; }
    seen.add(sku);
    const n = Number(qn);
    const okQty = it.unit === 'kg' ? n > 0 && /^\d+(\.\d{1,3})?$/.test(qn) : Number.isInteger(n) && n >= 1;
    if (!okQty) { e[`lines.${i}.qty`] = it.unit === 'kg' ? 'More than 0.' : 'A whole number, at least 1.'; continue; }
    if (gf) {
      const a = (await stock.availability(q, [sku], 0, { godown: from, lock: true })).get(sku);
      const free = r3(Math.max(0, a.good - a.reserved - a.expired));
      if (n > free) { e[`lines.${i}.qty`] = `Only ${free} free at ${gf.name} (held for orders and expired batches cannot go).`; continue; }
    }
    lines.push({ sku, qty: r3(n), it });
  }
  if (!lines.length && !Object.keys(e).some((k) => k.startsWith('lines.'))) e['lines.0.sku_code'] = 'Add at least one item.';
  if (Object.keys(e).length) bad(e);
  for (const l of lines) { const f = await stock.frozenBy(q, from, l.sku); if (f) throw new InvError(f, 409); }
  // e-way bill: goods worth more than the limit (at cost, with GST) need its number before the lorry leaves
  const rates = await buy.gstRates(q, await buy.items(q, lines.map((l) => l.sku)), today());
  const value = r2(lines.reduce((a, l) => a + valOf(l.it, l.qty) * (1 + (Number(rates.get(l.sku)) || 0) / 100), 0));
  const ewb = String(data.ewb_no || '').replace(/\s/g, '');
  const ew = await ewayRule(q);
  if (ewb && !/^\d{12}$/.test(ewb)) bad({ ewb_no: 'E-way bill number: 12 digits.' });
  if (ew.on && value > ew.above && !ewb) bad({ ewb_no: `These goods are worth ${rs(value)}, above ${rs(ew.above)}: the 12-digit e-way bill number is needed before the lorry leaves.` });
  await books.assertOpen(q, today());
  const no = await numbering.issue(q, 'challan', from);
  const [ins] = await q.query('INSERT INTO transfers (transfer_no, from_godown, to_godown, vehicle_no, driver, ewb_no, value, sent_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [no, from, to, veh, data.driver ? String(data.driver).slice(0, 20) : null, ewb || null, value, empId]);
  const id = ins.insertId;
  for (const [i, l] of lines.entries()) {
    const lots = await stock.moveStock(q, { sku: l.sku, godown: from, shelf: 'good', qty: -l.qty, what: 'transfer', noScanned: true, unitCost: l.it.avg_cost === null ? null : r2(l.it.avg_cost),
      doc: { type: 'transfer', id: no }, note: `Loaded on the lorry ${veh} to ${gt.name}` }, empId);
    for (const x of lots) await stock.moveStock(q, { sku: l.sku, godown: from, shelf: 'road', qty: x.qty, batch: x.batch_id, what: 'transfer', doc: { type: 'transfer', id: no }, note: `In the lorry ${veh} to ${gt.name}` }, empId);
    await q.query('INSERT INTO transfer_lines (transfer_id, line_no, sku_code, qty, lots) VALUES (?, ?, ?, ?, ?)',
      [id, i + 1, l.sku, l.qty, JSON.stringify(lots.map((x) => ({ batch_id: x.batch_id, batch_no: x.batch_no, qty: x.qty })))]);
  }
  await audit(q, { empId, action: 'dispatch', entity: 'transfer', entityId: no, after: { from: gf.name, to: gt.name, vehicle: veh, lines: lines.map((l) => `${l.sku} ${l.qty}`), value } });
  return { transfer_id: id, transfer_no: no, from: gf.name, to: gt.name, vehicle: veh };
}

/**
 * count a transfer in at the receiving godown: recv = [qty per line]. Somebody at the receiving godown, never the
 * sender. A short goes to the receiver's Disputed shelf and its loss waits for approval (transit_loss).
 */
async function receiveTransfer(q, id, recv, empId, admin) {
  const godowns = require('./godowns'); // eslint-disable-line global-require
  const t = await transferOf(q, id, true);
  if (!t) throw new InvError('No such transfer', 404);
  if (t.status !== 'transit') throw new InvError(`${t.transfer_no} is ${TR_ST[t.status].toLowerCase()} already.`, 409);
  if (!godowns.covers(admin, t.to_godown)) throw new InvError(`Somebody at ${t.to_name} counts it in.`, 403);
  if (t.sent_by === empId) throw new InvError(`You sent ${t.transfer_no}. A different person receives it, so a loss is never decided by one person.`, 403);
  const e = {}; const got = [];
  t.lines.forEach((l, i) => {
    const v = String((recv || [])[i] ?? '').trim();
    if (v === '' || !Number.isFinite(Number(v)) || Number(v) < 0) { e[`recv.${i}`] = 'A whole number.'; return; }
    if (Number(v) > l.qty) { e[`recv.${i}`] = `More than was sent (${l.qty}). Check the count.`; return; }
    got.push(r3(Number(v)));
  });
  if (Object.keys(e).length) bad(e);
  for (const l of t.lines) { const f = await stock.frozenBy(q, t.to_godown, l.sku_code); if (f) throw new InvError(`Goods from ${t.transfer_no} cannot land now. ${f}`, 409); }
  await books.assertOpen(q, today());
  const its = await items(q, t.lines.map((l) => l.sku_code));
  const doc = { type: 'transfer', id: t.transfer_no };
  const short = []; let lossValue = 0;
  for (const [i, l] of t.lines.entries()) {
    let left = got[i];
    for (const x of l.lots) {
      await stock.moveStock(q, { sku: l.sku_code, godown: t.from_godown, shelf: 'road', qty: -x.qty, batch: x.batch_id, strict: true, what: 'tr_in', doc, note: `Unloaded at ${t.to_name}` }, empId);
      const inn = r3(Math.min(left, x.qty));
      if (inn > 0) await stock.moveStock(q, { sku: l.sku_code, godown: t.to_godown, shelf: 'good', qty: inn, batch: x.batch_id, what: 'tr_in', doc, note: `Received from ${t.from_name}` }, empId);
      const miss = r3(x.qty - inn);
      if (miss > 0) await stock.moveStock(q, { sku: l.sku_code, godown: t.to_godown, shelf: 'disp', qty: miss, batch: x.batch_id, what: 'tr_short', doc, note: `Short receipt: ${miss} missing, on the Disputed shelf until decided` }, empId);
      left = r3(left - inn);
    }
    await q.query('UPDATE transfer_lines SET recv = ? WHERE transfer_id = ? AND line_no = ?', [got[i], t.transfer_id, l.line_no]);
    if (got[i] < l.qty) { short.push(`${l.sku_code} ${r3(l.qty - got[i])}`); lossValue += unitOf(its.get(l.sku_code)) * (l.qty - got[i]); } // rounded once, below
  }
  lossValue = r2(lossValue);
  let msg = `Counted in at ${t.to_name}.`; let aid = null;
  if (short.length) {
    const text = `${short.join(', ')} missing`;
    if ((await approvals.check(q, 'transit_loss', { amount: lossValue })).needs) {
      aid = await approvals.request(q, { kind: 'transit_loss', godownId: t.to_godown, refType: 'transfer', refId: t.transfer_no, amount: lossValue, excluded: [t.sent_by, empId],
        summary: `Transfer ${t.transfer_no} short: ${short.join(', ')} (sent by ${await nameOf(q, t.sent_by)}, received by ${await nameOf(q, empId)})`, payload: { transfer_id: t.transfer_id } }, empId);
      await q.query("UPDATE transfers SET status = 'short', recv_by = ?, recv_at = UTC_TIMESTAMP(), loss = 'waiting', loss_text = ?, loss_value = ?, loss_approval_id = ? WHERE transfer_id = ?",
        [empId, text, lossValue, aid, t.transfer_id]);
      msg += ` Short: ${short.join(', ')}.`;
    } else {
      await q.query("UPDATE transfers SET status = 'short', recv_by = ?, recv_at = UTC_TIMESTAMP(), loss_text = ?, loss_value = ? WHERE transfer_id = ?", [empId, text, lossValue, t.transfer_id]);
      await lossPost(q, t.transfer_id, true, empId);
      msg += ` Short: ${short.join(', ')}, written off (rule switched off).`;
    }
  } else await q.query("UPDATE transfers SET status = 'received', recv_by = ?, recv_at = UTC_TIMESTAMP() WHERE transfer_id = ?", [empId, t.transfer_id]);
  await audit(q, { empId, action: 'receive', entity: 'transfer', entityId: t.transfer_no, before: { status: 'In a lorry' }, after: { counted: t.lines.map((l, i) => `${l.sku_code} ${got[i]} of ${l.qty}`), short: short.length ? short : undefined, approval: aid || undefined } });
  return { short, approval_id: aid, message: msg, loss_value: lossValue };
}
async function nameOf(q, empId) {
  const auth = require('./auth'); // eslint-disable-line global-require
  const [[e]] = await q.query(`SELECT TRIM(CONCAT(COALESCE(emp_first_name, ''), ' ', COALESCE(emp_last_name, ''))) AS n FROM \`${auth.DADMIN}\`.employee WHERE emp_id = ?`, [empId]);
  return (e && e.n) || empId;
}
/** the packs of a transfer short on a Disputed shelf (the receiver's, or the sender's after a rejected loss), per batch */
async function disputedOf(q, t, godown) {
  const [rows] = await q.query("SELECT sku_code, batch_id, SUM(delta) AS n FROM stock_movements WHERE location_id = ? AND stock_kind = 'disp' AND ref_type = 'transfer' AND ref_id = ? GROUP BY sku_code, batch_id HAVING n > 0",
    [godown, t.transfer_no]);
  return rows.map((r) => ({ sku_code: r.sku_code, batch_id: r.batch_id, qty: r3(r.n) }));
}
/** the loss is decided: approved = written off from the receiver's Disputed shelf; rejected = to the sender's Disputed shelf */
async function lossPost(q, transferId, ok, empId) {
  const t = await transferOf(q, transferId, true);
  const doc = { type: 'transfer', id: t.transfer_no };
  for (const x of await disputedOf(q, t, t.to_godown)) {
    await stock.moveStock(q, { sku: x.sku_code, godown: t.to_godown, shelf: 'disp', qty: -x.qty, batch: x.batch_id, strict: true, what: ok ? 'write_off' : 'tr_back', doc,
      unitCost: await stock.costNow(q, x.sku_code), note: ok ? 'Transfer loss written off' : `Loss rejected: back to ${t.from_name}` }, empId);
    if (!ok) await stock.moveStock(q, { sku: x.sku_code, godown: t.from_godown, shelf: 'disp', qty: x.qty, batch: x.batch_id, what: 'tr_back', doc, note: 'Loss rejected: the sender answers for it; on the Disputed shelf until found or lost' }, empId);
  }
}
approvals.onRecheck('transit_loss', async (q, p) => {
  const t = await transferOf(q, p.transfer_id);
  if (!t || t.loss !== 'waiting') return 'the loss is no longer waiting';
  return (await stock.frozenBy(q, t.to_godown, t.lines[0].sku_code)) || '';
});
approvals.onApproved('transit_loss', async (q, p, empId) => {
  const t = await transferOf(q, p.transfer_id, true);
  if (!t || t.loss !== 'waiting') return;
  await lossPost(q, t.transfer_id, true, empId);
  await q.query("UPDATE transfers SET loss = 'approved', loss_by = ? WHERE transfer_id = ?", [empId, t.transfer_id]);
  await audit(q, { empId, action: 'approve', entity: 'transfer', entityId: t.transfer_no, before: { loss: 'waiting' }, after: { loss: 'written off from the Disputed shelf', value: Number(t.loss_value) } });
});
approvals.onClosed('transit_loss', async (q, p, status, empId) => {
  const t = await transferOf(q, p.transfer_id, true);
  if (!t || t.loss !== 'waiting' || status === 'expired') return; // expired: Send again asks once more
  await lossPost(q, t.transfer_id, false, empId);
  await q.query("UPDATE transfers SET loss = 'rejected', loss_by = ? WHERE transfer_id = ?", [empId, t.transfer_id]);
  await audit(q, { empId, action: status, entity: 'transfer', entityId: t.transfer_no, before: { loss: 'waiting' }, after: { loss: `${status}: the packs go back to ${t.from_name}, the sender answers for them` } });
});
approvals.onAgain('transit_loss', async (q, p) => {
  const t = await transferOf(q, p.transfer_id);
  return t && t.loss === 'waiting' ? '' : 'the loss is no longer waiting';
});

/** Found or Lost decision waiting on a transfer (a move or write-off of its Disputed packs) */
async function settling(q, transferId) {
  const [[w]] = await q.query("SELECT write_off_id FROM write_offs WHERE transfer_id = ? AND status = 'pending' LIMIT 1", [transferId]);
  return Boolean(w);
}
/** after a rejected loss: Found (back to the sender's Good shelf, rule restock) or Lost (a write-off; never the sender or the receiver) */
async function settleTransfer(q, id, found, empId) {
  const t = await transferOf(q, id, true);
  if (!t) throw new InvError('No such transfer', 404);
  if (t.loss !== 'rejected') throw new InvError('Found and Lost are for a short whose loss was not approved.', 409);
  if (await settling(q, t.transfer_id)) throw new InvError(`A Found or Lost decision for ${t.transfer_no} already waits.`, 409);
  const mis = await disputedOf(q, t, t.from_godown);
  if (!mis.length) throw new InvError('Nothing of this transfer is missing any more.', 409);
  const its = await items(q, mis.map((x) => x.sku_code));
  const made = [];
  for (const x of mis) {
    const it = its.get(x.sku_code);
    const value = valOf(it, x.qty);
    if (found) {
      const [ins] = await q.query(`INSERT INTO write_offs (sku_code, godown_id, stock_kind, batch_id, qty, reason_type, reason, value, status, kind, to_kind, transfer_id, emp_id)
          VALUES (?, ?, 'disp', ?, ?, 'other', ?, ?, 'pending', 'move', 'good', ?, ?)`, [x.sku_code, t.from_godown, x.batch_id, x.qty, `Found after transfer ${t.transfer_no}`, value, t.transfer_id, empId]);
      const aid = await approvals.request(q, { kind: 'restock', godownId: t.from_godown, refType: 'write_off', refId: String(ins.insertId), amount: value, excluded: [t.sent_by, t.recv_by].filter(Boolean),
        summary: `Found ${x.qty} ${x.sku_code} of transfer ${t.transfer_no}: back to Good at ${t.from_name}`, payload: { move_id: ins.insertId } }, empId);
      await q.query('UPDATE write_offs SET approval_id = ? WHERE write_off_id = ?', [aid, ins.insertId]);
      made.push(`WO-${ins.insertId}`);
    } else {
      const r = await stock.requestWriteOff(q, { godown_id: t.from_godown, sku_code: x.sku_code, stock_kind: 'disp', batch_id: x.batch_id, qty: x.qty, reason_type: 'lost', reason: `Lost on transfer ${t.transfer_no}` },
        empId, null, { transfer: t.transfer_id, always: true, excluded: [t.sent_by, t.recv_by].filter(Boolean) });
      made.push(`WO-${r.write_off_id}`);
    }
  }
  await audit(q, { empId, action: found ? 'found' : 'lost', entity: 'transfer', entityId: t.transfer_no, after: { asked: made } });
  return { made, message: `${found ? 'Back to Good' : 'Write-off'} asked: ${made.join(', ')}. The packs stay on the Disputed shelf until it is signed.` };
}

// ---------------------------------------------------------------- stock take
/** the count sheet: book figure hidden while counting; scanned and packed packs listed; a repeat shortage flagged */
async function takeView(q, id, { canSeeBook = true } = {}) {
  const c = await stock.countDetail(q, id);
  const counting = c.status === 'open';
  const its = await items(q, [...new Set(c.lines.map((l) => l.sku_code))]);
  // packs scanned (or packed) for orders not yet dispatched: in the book figure, perhaps on the packing table
  const [scan] = counting ? await q.query(`SELECT o.order_no, ps.sku_code, SUM(ps.qty) AS n, o.status FROM pack_scans ps JOIN orders o ON o.order_id = ps.order_id
      WHERE o.godown_id = ? AND ps.result = 'ok' AND o.status IN ('packing', 'packed') AND o.dispatched_at IS NULL GROUP BY o.order_no, ps.sku_code, o.status ORDER BY o.order_no`, [c.godown_id]) : [[]];
  const codes = new Set(c.lines.map((l) => l.sku_code));
  // a shortage that repeats one in an earlier posted count (any godown, v23 shortBefore) is a theft signal
  const [before] = await q.query(`SELECT DISTINCT l.sku_code FROM stock_count_lines l JOIN stock_counts c ON c.count_id = l.count_id
      WHERE c.status = 'posted' AND c.count_id < ? AND l.counted < l.expected`, [id]);
  const shortBefore = new Set(before.map((r) => r.sku_code));
  const lines = c.lines.map((l) => {
    const it = its.get(l.sku_code) || {};
    const d = l.counted === null || counting ? null : r3(Number(l.counted) - Number(l.system_qty));
    return { line_id: l.line_id, sku_code: l.sku_code, name: it.name || l.name, image: it.image || null, unit: it.unit || 'pack', batch_no: l.batch_no || '-', expiry_date: l.expiry_date,
      counted: l.counted === null ? null : r3(l.counted), book: counting || !canSeeBook ? null : r3(l.system_qty), diff: d, again: d !== null && d < 0 && shortBefore.has(l.sku_code) };
  });
  const value = r2(lines.reduce((a, l) => a + (l.diff ? Math.abs(l.diff) * unitOf(its.get(l.sku_code)) : 0), 0));
  return { ...c, lines, counting, value, diffs: counting ? null : lines.filter((l) => l.diff).length,
    scanned: scan.filter((s) => codes.has(s.sku_code)).map((s) => ({ order_no: s.order_no, sku_code: s.sku_code, qty: Number(s.n), packed: s.status === 'packed' })) };
}

// ---------------------------------------------------------------- reorder
/** below the reorder level per godown, counting free stock and what is coming; suggestion rounded up (cartons, supplier minimum) */
async function reorderRows(q, godowns) {
  const its = await items(q);
  const [lv] = await q.query('SELECT l.sku_code, l.location_id, l.reorder_level, g.name AS godown FROM stock_levels l JOIN locations g ON g.location_id = l.location_id WHERE l.location_id IN (?) AND l.reorder_level > 0 ORDER BY g.sort_order, l.sku_code',
    [godowns.length ? godowns : [0]]);
  const rows = [];
  for (const r of lv) {
    const it = its.get(r.sku_code);
    if (!it || !it.live) continue;
    const a = (await stock.availability(q, [r.sku_code], 0, { godown: r.location_id })).get(r.sku_code);
    const free = r3(Math.max(0, a.good - a.reserved - a.expired));
    const [[runs]] = await q.query("SELECT COALESCE(SUM(qty), 0) AS n FROM production_runs WHERE godown_id = ? AND sku_code = ? AND status IN ('planned', 'started')", [r.location_id, r.sku_code]);
    const make = it.made && (!it.bought || Boolean(await prod.recipeOn(q, r.sku_code)));
    const coming = r3((it.bought ? await buy.incoming(q, r.sku_code, r.location_id) : (await stock.onShelf(q, { sku: r.sku_code, godown: r.location_id, shelf: 'hold' }))) + Number(runs.n));
    const level = Number(r.reorder_level);
    if (free + coming >= level) continue;
    let n = level * 2 - free - coming;
    if (!it.raw) n = Math.ceil(n / it.per_carton) * it.per_carton;
    if (!make) { const b = await buy.bestItem(q, r.sku_code); if (b && n < b.moq) n = b.moq; }
    const recipe = make ? Boolean(await prod.recipeOn(q, r.sku_code)) : false;
    rows.push({ sku_code: r.sku_code, name: it.name, image: it.image, unit: it.unit, godown_id: r.location_id, godown: r.godown, free, coming, level, suggest: r3(n),
      cartons: it.raw ? null : n / it.per_carton, how: make ? 'make' : 'buy', recipe });
  }
  return rows;
}

module.exports = { InvError, TR_ST, MOVE_SHELVES, items, valOf, unitOf, qtyText, stockRows, itemDetail, ledger, shelfMove, postMove, moveRecheck, moveClosed, transferOf, ewayRule,
  sendTransfer, receiveTransfer, disputedOf, settling, settleTransfer, takeView, reorderRows };
