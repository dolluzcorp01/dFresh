// Phase 20: the API of the Fulfilment screens (sections 8 and 9, v23) and the delivery masters. Rules in fulfil.js and
// delivery.js; scanning, trips, stops, courier and pickup keep their routes in Admin_server.js. Every list follows the
// godowns a person works at (the header picker). Every change is audited.
const fulfil = require('./fulfil');
const stock = require('./stock');
const delivery = require('./delivery');
const godowns = require('./godowns');
const pricing = require('./pricing');
const { audit } = require('./audit');
const auth = require('./auth');

const SKU_NAME = 'COALESCE(t.name, pt.name, s.product_id)';
const SKU_JOIN = `JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'`;
const IMG = '(SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1)';
const num = (v) => (v === null || v === undefined ? null : Number(v));
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function register({ route, tx, db, by, InputError, canDo, commerceGate }) {
  const G = { before: [commerceGate] };
  const asErr = (e) => {
    if (e instanceof fulfil.FulfilError || e instanceof delivery.DeliveryError || e instanceof godowns.GodownError) {
      const x = new InputError(e.message, e.status || 400); if (e.fields) { x.code = 'fields'; x.fields = e.fields; } return x;
    }
    return e;
  };
  const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (e) { throw asErr(e); } };
  const scope = (req, col) => godowns.where(col, godowns.viewScope(req));
  const fail = (fields) => { const x = new InputError(Object.values(fields)[0]); x.code = 'fields'; x.fields = fields; throw x; };
  async function names(q, ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return new Map();
    const [rows] = await q.query(`SELECT emp_id, TRIM(CONCAT(COALESCE(emp_first_name, ''), ' ', COALESCE(emp_last_name, ''))) AS name FROM \`${auth.DADMIN}\`.employee WHERE emp_id IN (?)`, [list]);
    return new Map(rows.map((r) => [r.emp_id, r.name || r.emp_id]));
  }
  const ORD = `o.order_no, DATE_FORMAT(CONVERT_TZ(o.created_at, '+00:00', '+05:30'), '%Y-%m-%d') AS order_day, o.godown_id, g.name AS godown, o.status, o.delivery_kind, o.cartons, o.weight_kg, o.packed_at, o.payment_terms, o.amount_due, o.total, o.ship_name, o.ship_address, o.ship_town, o.ship_pincode,
    c.customer_no, c.name AS customer, o.parent_id, (SELECT x.order_no FROM orders x WHERE x.order_id = o.parent_id) AS parent_no,
    (SELECT it.sku_code FROM order_items it WHERE it.order_id = o.order_id ORDER BY it.line_id LIMIT 1) AS first_sku, (SELECT COUNT(*) FROM order_items it WHERE it.order_id = o.order_id) AS n_lines`;
  const ORD_FROM = 'orders o JOIN customers c ON c.customer_id = o.customer_id JOIN locations g ON g.location_id = o.godown_id';
  async function withNames(rows) {
    const [nm] = rows.length ? await db.query(`SELECT s.sku_code, ${SKU_NAME} AS name, ${IMG} AS image FROM skus s ${SKU_JOIN} WHERE s.sku_code IN (?)`, [[...new Set(rows.map((r) => r.first_sku).filter(Boolean)), '']]) : [[]];
    const m = new Map(nm.map((x) => [x.sku_code, x]));
    return rows.map((r) => ({ ...r, first_name: (m.get(r.first_sku) || {}).name || r.first_sku, first_image: (m.get(r.first_sku) || {}).image || null, n_lines: Number(r.n_lines), amount_due: num(r.amount_due), total: num(r.total), weight_kg: num(r.weight_kg) }));
  }

  // ============================================================================================ packing
  route('get', '/fulfil/to-pick', 'packing:view', wrap(async (req) => {
    const [gw, gp] = scope(req, 'o.godown_id');
    const [rows] = await db.query(`SELECT ${ORD}, (SELECT COALESCE(SUM(r.qty), 0) FROM stock_reservations r WHERE r.order_id = o.order_id AND r.status = 'active') AS held,
        (SELECT COALESCE(SUM(i.back_qty), 0) FROM order_items i WHERE i.order_id = o.order_id) AS back
        FROM ${ORD_FROM} WHERE o.status = 'new' AND ${gw}
          AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.ref_type = 'order' AND a.ref_id = o.order_no AND a.status = 'pending')
        HAVING held > 0 ORDER BY o.order_id`, gp);
    const [pw, pp] = scope(req, 'l.godown_id');
    const [lists] = await db.query(`SELECT l.pick_id, l.pick_no, l.godown_id, g.name AS godown, l.packer, l.status, l.created_at, l.emp_id,
        (SELECT GROUP_CONCAT(o.order_no ORDER BY o.order_id SEPARATOR ', ') FROM orders o WHERE o.pick_id = l.pick_id) AS orders,
        (SELECT COALESCE(SUM(pk.qty), 0) FROM order_picks pk JOIN orders o ON o.order_id = pk.order_id WHERE o.pick_id = l.pick_id AND o.status = 'packing') AS packs
        FROM pick_lists l JOIN locations g ON g.location_id = l.godown_id WHERE ${pw} ORDER BY l.pick_id DESC LIMIT 100`, pp);
    const nm = await names(db, lists.map((l) => l.packer));
    return { ready: (await withNames(rows)).map((r) => ({ ...r, held: Number(r.held), back: Number(r.back) })), lists: lists.map((l) => ({ ...l, packer_name: nm.get(l.packer) || null, packs: Number(l.packs) })),
      can: { create: canDo(req, 'packing', 'create'), edit: canDo(req, 'packing', 'edit'), approve: canDo(req, 'packing', 'approve') } };
  }), G);
  route('post', '/fulfil/pick-lists', 'packing:create', wrap(async (req) => tx(async (q) => {
    const nos = ((req.body || {}).order_nos || []).map(String);
    for (const no of nos) { const [[o]] = await q.query('SELECT godown_id FROM orders WHERE order_no = ?', [no]); if (o) godowns.assertSees(req, o.godown_id, 'Order not found'); }
    const out = await fulfil.makePickList(q, nos, by(req), req.admin);
    await delivery.startPacking(q, nos, by(req)); // the batches are fixed (oldest first) and the orders are Packing
    return out;
  })), { ...G, status: 201 });
  route('get', '/fulfil/pick-lists/:id', 'packing:view', wrap(async (req) => {
    const [[l]] = await db.query('SELECT l.pick_id, l.pick_no, l.godown_id, g.name AS godown, l.packer, l.status, l.created_at, l.emp_id FROM pick_lists l JOIN locations g ON g.location_id = l.godown_id WHERE l.pick_id = ?', [Number(req.params.id)]);
    if (!l) throw new InputError('Pick list not found', 404);
    godowns.assertSees(req, l.godown_id, 'Pick list not found');
    const [take] = await db.query(`SELECT pk.sku_code, b.batch_no, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS expiry_date, SUM(pk.qty) AS qty, ${SKU_NAME} AS name, ${IMG} AS image, s.bin_location
        FROM order_picks pk JOIN orders o ON o.order_id = pk.order_id JOIN skus s ON s.sku_code = pk.sku_code ${SKU_JOIN} LEFT JOIN batches b ON b.batch_id = pk.batch_id
        WHERE o.pick_id = ? AND o.status = 'packing' GROUP BY pk.sku_code, b.batch_no, b.expiry_date, t.name, pt.name, s.product_id, s.bin_location ORDER BY pk.sku_code, b.expiry_date`, [l.pick_id]);
    const [orders] = await db.query(`SELECT o.order_no, o.status, c.name AS customer,
        (SELECT COALESCE(SUM(qty), 0) FROM order_picks x WHERE x.order_id = o.order_id) AS need,
        (SELECT COALESCE(SUM(qty), 0) FROM pack_scans x WHERE x.order_id = o.order_id AND x.result = 'ok') AS scanned
        FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.pick_id = ? ORDER BY o.order_id`, [l.pick_id]);
    const [packers] = await db.query("SELECT a.emp_id FROM admin_users a WHERE a.is_active = 1 AND a.left_at IS NULL ORDER BY a.emp_id");
    const people = await require('./approvals').people(db); // eslint-disable-line global-require
    const can = people.filter((p) => p.active && !p.pending && require('../shared/permissions').can(p.perms, 'packing', 'edit') && godowns.covers(p, l.godown_id)); // eslint-disable-line global-require
    const nm = await names(db, [l.packer, l.emp_id, ...packers.map((x) => x.emp_id)]);
    return { ...l, packer_name: nm.get(l.packer) || null, made_by: nm.get(l.emp_id) || l.emp_id, take: take.map((x) => ({ ...x, qty: Number(x.qty) })),
      orders: orders.map((o) => ({ ...o, need: Number(o.need), scanned: Number(o.scanned) })), packers: (can.length ? can : packers.map((x) => ({ emp_id: x.emp_id }))).map((p) => ({ emp_id: p.emp_id, name: p.name || nm.get(p.emp_id) || p.emp_id })),
      can: { create: canDo(req, 'packing', 'create') } };
  }), G);
  route('put', '/fulfil/pick-lists/:id/packer', 'packing:create', wrap(async (req) => tx((q) => fulfil.givePacker(q, req.params.id, (req.body || {}).packer, by(req)))), G);
  route('get', '/fulfil/packing', 'packing:view', wrap(async (req) => {
    const [gw, gp] = scope(req, 'o.godown_id');
    const [rows] = await db.query(`SELECT ${ORD}, pl.pick_no, pl.packer,
        (SELECT COALESCE(SUM(qty), 0) FROM order_picks x WHERE x.order_id = o.order_id) AS need,
        (SELECT COALESCE(SUM(qty), 0) FROM pack_scans x WHERE x.order_id = o.order_id AND x.result = 'ok') AS scanned
        FROM ${ORD_FROM} LEFT JOIN pick_lists pl ON pl.pick_id = o.pick_id WHERE o.status = 'packing' AND ${gw} ORDER BY o.order_id`, gp);
    const nm = await names(db, rows.map((r) => r.packer));
    return { rows: (await withNames(rows)).map((r) => ({ ...r, need: Number(r.need), scanned: Number(r.scanned), packer_name: nm.get(r.packer) || null })), can: { edit: canDo(req, 'packing', 'edit'), approve: canDo(req, 'packing', 'approve') } };
  }), G);
  route('get', '/fulfil/packed', 'packing:view', wrap(async (req) => {
    const [gw, gp] = scope(req, 'o.godown_id');
    const [rows] = await db.query(`SELECT ${ORD}, TIMESTAMPDIFF(HOUR, o.packed_at, UTC_TIMESTAMP()) AS hours,
        (SELECT t.trip_id FROM trip_stops s JOIN delivery_trips t ON t.trip_id = s.trip_id WHERE s.order_id = o.order_id AND t.status = 'planned' AND s.status = 'pending' LIMIT 1) AS trip_id
        FROM ${ORD_FROM} WHERE o.status = 'packed' AND ${gw} ORDER BY o.packed_at`, gp);
    return { rows: (await withNames(rows)).map((r) => ({ ...r, hours: Number(r.hours) || 0 })) };
  }), G);
  // the lines of a pack drawer with each pack's photo
  route('get', '/fulfil/packing/:no', 'packing:view', wrap(async (req) => {
    const [[o]] = await db.query(`SELECT o.order_id, o.order_no, o.godown_id, (SELECT gx.name FROM locations gx WHERE gx.location_id = o.godown_id) AS godown_name, o.status, o.note, o.delivery_kind, o.cartons, o.weight_kg, o.packed_at, o.packed_by, c.name AS customer, pl.pick_no FROM orders o JOIN customers c ON c.customer_id = o.customer_id LEFT JOIN pick_lists pl ON pl.pick_id = o.pick_id WHERE o.order_no = ?`, [req.params.no]);
    if (!o) throw new InputError('Order not found', 404);
    godowns.assertSees(req, o.godown_id, 'Order not found');
    const st = await delivery.packState(db, o.order_id);
    const [img] = st.lines.length ? await db.query(`SELECT s.sku_code, ${IMG} AS image FROM skus s WHERE s.sku_code IN (?)`, [[...new Set(st.lines.map((l) => l.sku_code))]]) : [[]];
    const im = new Map(img.map((x) => [x.sku_code, x.image]));
    const [out] = await db.query("SELECT m.sku_code, b.batch_no, -SUM(m.delta) AS qty FROM stock_movements m LEFT JOIN batches b ON b.batch_id = m.batch_id WHERE m.ref_type = 'order' AND m.ref_id = ? AND m.move_type = 'out' GROUP BY m.sku_code, b.batch_no", [o.order_no]);
    const [owed] = await db.query('SELECT order_no FROM orders WHERE parent_id = ?', [o.order_id]);
    const nm = await names(db, [o.packed_by]);
    // v23: the batches each item can pack from, oldest expiry first (never an expired one), less what other packers scanned
    const lots = {};
    if (o.status === 'packing') {
      const [tb] = st.lines.length ? await db.query('SELECT s.sku_code FROM skus s JOIN products p ON p.product_id = s.product_id WHERE p.track_batches = 1 AND s.sku_code IN (?)', [[...new Set(st.lines.map((l) => l.sku_code))]]) : [[]];
      for (const x of tb) {
        const others = await stock.scannedLots(db, o.godown_id, x.sku_code, o.order_no);
        lots[x.sku_code] = (await stock.batchStock(db, x.sku_code, 'good', { godown: o.godown_id })).filter((l) => !l.expired)
          .map((l) => ({ batch_no: l.batch_no, expiry_date: l.expiry_date, qty: l.qty - (others.get(Number(l.batch_id)) || 0), locked: others.get(Number(l.batch_id)) || 0 })).filter((l) => l.qty > 0);
      }
    }
    const [scans] = await db.query("SELECT ps.scan_id, ps.sku_code, b.batch_no, ps.qty, ps.off_plan, ps.result, ps.message, ps.created_at FROM pack_scans ps LEFT JOIN batches b ON b.batch_id = ps.batch_id WHERE ps.order_id = ? ORDER BY ps.scan_id", [o.order_id]);
    return { ...o, packed_by_name: nm.get(o.packed_by) || o.packed_by, lines: st.lines.map((l) => ({ ...l, image: im.get(l.sku_code) || null })), complete: st.complete, off: Boolean(st.off), lots,
      scans: scans.filter((x) => x.result === 'ok' && x.qty > 0).map((x) => ({ ...x, off_plan: Number(x.off_plan) === 1 })), refused: scans.filter((x) => x.result !== 'ok').slice(-5).map((x) => ({ result: x.result, message: x.message })),
      packed: out.map((x) => ({ ...x, qty: Number(x.qty) })),
      balances: owed.map((x) => x.order_no), short_why: fulfil.SHORT_WHY, can: { edit: canDo(req, 'packing', 'edit') && o.status === 'packing', approve: canDo(req, 'packing', 'approve') } };
  }), G);

  // ============================================================================================ delivery lists
  route('get', '/fulfil/pod', 'delivery:view', wrap(async (req) => {
    const [gw, gp] = scope(req, 'o.godown_id');
    const [rows] = await db.query(`SELECT 'trip' AS how, s.stop_id, s.trip_id, s.status, s.receiver_name, s.photo IS NOT NULL AS has_photo, s.signed, s.done_at, s.done_by, s.kept_json, o.order_no, o.godown_id, c.name AS customer, d.name AS driver
        FROM trip_stops s JOIN orders o ON o.order_id = s.order_id JOIN customers c ON c.customer_id = o.customer_id JOIN delivery_trips t ON t.trip_id = s.trip_id JOIN drivers d ON d.driver_id = t.driver_id
        WHERE s.kind = 'delivery' AND s.status IN ('delivered', 'refused') AND ${gw}
        UNION ALL SELECT IF(o.delivery_kind = 'courier', 'courier', 'pickup'), NULL, NULL, o.status, o.received_by, 0, 0, o.delivered_at, NULL, NULL, o.order_no, o.godown_id, c.name, cr.name
        FROM orders o JOIN customers c ON c.customer_id = o.customer_id LEFT JOIN couriers cr ON cr.courier_id = o.courier_id
        WHERE o.status = 'delivered' AND o.delivery_kind IN ('courier', 'pickup') AND ${gw} ORDER BY done_at DESC LIMIT 300`, [...gp, ...gp]);
    return { rows: rows.map((r) => ({ ...r, has_photo: Number(r.has_photo) === 1, signed: Number(r.signed) === 1, kept: r.kept_json ? (typeof r.kept_json === 'string' ? JSON.parse(r.kept_json) : r.kept_json) : null })) };
  }), G);
  route('get', '/fulfil/failed', 'delivery:view', wrap(async (req) => {
    const [gw, gp] = scope(req, 'o.godown_id');
    const [rows] = await db.query(`SELECT s.stop_id, s.trip_id, s.status, s.failed_reason, s.kept_json, s.done_at, o.order_no, o.status AS order_status, o.godown_id, g.name AS godown, c.name AS customer, r.return_no,
        (SELECT cn.credit_note_no FROM credit_notes cn WHERE cn.return_id = s.return_back_id LIMIT 1) AS credit_note_no, (SELECT cn.total FROM credit_notes cn WHERE cn.return_id = s.return_back_id LIMIT 1) AS credit
        FROM trip_stops s JOIN orders o ON o.order_id = s.order_id JOIN customers c ON c.customer_id = o.customer_id JOIN locations g ON g.location_id = o.godown_id LEFT JOIN returns r ON r.return_id = s.return_back_id
        WHERE s.kind = 'delivery' AND (s.status IN ('failed', 'refused') OR s.kept_json IS NOT NULL) AND ${gw} ORDER BY s.done_at DESC LIMIT 200`, gp);
    return { rows: rows.map((r) => ({ ...r, credit: num(r.credit), kind: r.status === 'failed' ? 'failed' : r.status === 'refused' ? 'refused' : 'short', back: r.kept_json ? (typeof r.kept_json === 'string' ? JSON.parse(r.kept_json) : r.kept_json) : null })),
      can: { edit: canDo(req, 'delivery', 'create') } };
  }), G);
  route('get', '/fulfil/cod', 'delivery:view', wrap(async (req) => {
    const [gw, gp] = scope(req, 't.godown_id');
    const [trips] = await db.query(`SELECT t.trip_id, DATE_FORMAT(t.trip_date, '%Y-%m-%d') AS trip_date, t.status, t.cash_expected, t.cash_collected, t.cash_handed, t.end_note, d.name AS driver, v.number AS vehicle, g.name AS godown
        FROM delivery_trips t JOIN drivers d ON d.driver_id = t.driver_id JOIN vehicles v ON v.vehicle_id = t.vehicle_id JOIN locations g ON g.location_id = t.godown_id
        WHERE t.status IN ('out', 'ended') AND ${gw} ORDER BY t.trip_id DESC LIMIT 100`, gp);
    const [ow, op] = scope(req, 'o.godown_id');
    const [pickups] = await db.query(`SELECT o.order_no, c.name AS customer, o.delivered_at, o.total,
        (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.order_id = o.order_id AND p.kind = 'payment' AND p.mode = 'cash') AS cash
        FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.delivery_kind = 'pickup' AND o.status = 'delivered' AND o.payment_terms = 'cod' AND ${ow} ORDER BY o.delivered_at DESC LIMIT 100`, op);
    return { trips: trips.map((t) => ({ ...t, cash_expected: num(t.cash_expected), cash_collected: num(t.cash_collected), cash_handed: num(t.cash_handed),
      difference: t.cash_handed === null ? null : Math.round((Number(t.cash_handed) - Number(t.cash_collected)) * 100) / 100 })), pickups: pickups.map((x) => ({ ...x, total: num(x.total), cash: num(x.cash) })) };
  }), G);

  // ============================================================================================ masters
  const mayEdit = (req) => canDo(req, 'delivery', 'create');
  route('get', '/fulfil/vehicles', 'delivery:view', wrap(async (req) => {
    const t = pricing.istToday();
    const soon = (d) => d && d >= t && (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${t}T00:00:00Z`)) / 864e5 <= 30;
    const [vs] = await db.query(`SELECT v.vehicle_id, v.number, v.type, v.godown_id, g.name AS godown, v.max_kg, v.max_boxes, DATE_FORMAT(v.insurance_until, '%Y-%m-%d') AS insurance_until, DATE_FORMAT(v.fitness_until, '%Y-%m-%d') AS fitness_until, v.notes, v.is_active
        FROM vehicles v LEFT JOIN locations g ON g.location_id = v.godown_id ORDER BY v.sort_order, v.vehicle_id`);
    const [ds] = await db.query("SELECT driver_id, name, phone, emp_id, licence_no, DATE_FORMAT(licence_until, '%Y-%m-%d') AS licence_until, is_active FROM drivers ORDER BY sort_order, driver_id");
    const all = (await godowns.list(db)).filter((x) => x.is_active).map((x) => ({ godown_id: x.godown_id, name: x.name }));
    return { vehicles: vs.map((v) => { const p = []; if (!Number(v.is_active)) p.push('not in use'); if (v.insurance_until && v.insurance_until < t) p.push(`insurance ended ${v.insurance_until}`); if (v.fitness_until && v.fitness_until < t) p.push(`fitness certificate ended ${v.fitness_until}`);
      return { ...v, max_kg: num(v.max_kg), is_active: Number(v.is_active) === 1, problems: p, ins_soon: soon(v.insurance_until), fc_soon: soon(v.fitness_until) }; }),
    drivers: ds.map((d) => ({ ...d, is_active: Number(d.is_active) === 1, problem: !d.licence_no ? 'no licence on record' : d.licence_until && d.licence_until < t ? `licence ended ${d.licence_until}` : '' })), godowns: all, can: { edit: mayEdit(req) } };
  }), G);
  const saveVehicle = (isNew) => wrap(async (req) => tx(async (q) => {
    if (!mayEdit(req)) throw new InputError('This needs create on Delivery', 403);
    const b = req.body || {}; const f = {};
    const number = String(b.number || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (isNew && !/^[A-Z]{2} ?\d{1,2} ?[A-Z]{0,3} ?\d{1,4}$/.test(number)) f.number = 'Like TN 21 BC 4417.';
    const type = String(b.type || '').trim().slice(0, 40); if (type.length < 2) f.type = 'Give the type.';
    const kg = Number(b.max_kg); if (!(kg > 0)) f.max_kg = 'How many kg it carries.';
    const boxes = Number(b.max_boxes); if (!Number.isInteger(boxes) || boxes < 1) f.max_boxes = 'How many boxes it carries.';
    const ins = String(b.insurance_until || ''); if (!pricing.isDate(ins)) f.insurance_until = 'The date the insurance runs to.';
    const fc = String(b.fitness_until || '') || null; if (fc && !pricing.isDate(fc)) f.fitness_until = 'A date, or empty for a two-wheeler.';
    const g = Number(b.godown_id) || null; if (!g) f.godown_id = 'Choose the godown.';
    if (Object.keys(f).length) fail(f);
    if (isNew) {
      const [[dup]] = await q.query('SELECT vehicle_id FROM vehicles WHERE number = ?', [number]); if (dup) fail({ number: 'Already saved.' });
      const [ins2] = await q.query('INSERT INTO vehicles (number, type, godown_id, max_kg, max_boxes, insurance_until, fitness_until, notes, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [number, type, g, kg, boxes, ins, fc, String(b.notes || '').slice(0, 100) || null, b.is_active === false ? 0 : 1]);
      await audit(q, { empId: by(req), action: 'create', entity: 'vehicle', entityId: number, after: { type, godown: g, kg, boxes, ins, fc } });
      return { vehicle_id: ins2.insertId };
    }
    const [[v]] = await q.query('SELECT vehicle_id, number, type, max_kg, max_boxes, insurance_until, fitness_until, godown_id, notes, is_active FROM vehicles WHERE vehicle_id = ? FOR UPDATE', [Number(req.params.id)]);
    if (!v) throw new InputError('Vehicle not found', 404);
    await q.query('UPDATE vehicles SET type = ?, godown_id = ?, max_kg = ?, max_boxes = ?, insurance_until = ?, fitness_until = ?, notes = ?, is_active = ? WHERE vehicle_id = ?', [type, g, kg, boxes, ins, fc, String(b.notes || '').slice(0, 100) || null, b.is_active === false ? 0 : 1, v.vehicle_id]);
    await audit(q, { empId: by(req), action: 'update', entity: 'vehicle', entityId: v.number, before: { type: v.type, kg: num(v.max_kg), boxes: v.max_boxes, ins: v.insurance_until, fc: v.fitness_until, active: v.is_active }, after: { type, kg, boxes, ins, fc, active: b.is_active !== false } });
    return { vehicle_id: v.vehicle_id };
  }));
  route('post', '/fulfil/vehicles', 'delivery:create', saveVehicle(true), { ...G, status: 201 });
  route('put', '/fulfil/vehicles/:id', 'delivery:create', saveVehicle(false), G);
  route('put', '/fulfil/drivers/:id', 'delivery:create', wrap(async (req) => tx(async (q) => {
    const b = req.body || {}; const f = {};
    const lic = String(b.licence_no || '').trim().toUpperCase().slice(0, 20); if (lic.length < 6) f.licence_no = 'The licence number.';
    const until = String(b.licence_until || ''); if (!pricing.isDate(until)) f.licence_until = 'The date it is valid until.';
    if (Object.keys(f).length) fail(f);
    const [[d]] = await q.query('SELECT driver_id, name, licence_no, licence_until FROM drivers WHERE driver_id = ? FOR UPDATE', [Number(req.params.id)]);
    if (!d) throw new InputError('Driver not found', 404);
    await q.query('UPDATE drivers SET licence_no = ?, licence_until = ? WHERE driver_id = ?', [lic, until, d.driver_id]);
    await audit(q, { empId: by(req), action: 'update', entity: 'driver', entityId: d.name, before: { licence_no: d.licence_no, until: d.licence_until }, after: { licence_no: lic, until } });
    return { driver_id: d.driver_id };
  })), G);
  route('get', '/fulfil/couriers', 'delivery:view', wrap(async (req) => {
    const [rows] = await db.query('SELECT courier_id, name, phone, tracking_url, per_kg, min_charge, is_active FROM couriers ORDER BY sort_order, courier_id');
    return { rows: rows.map((c) => ({ ...c, per_kg: num(c.per_kg), min_charge: num(c.min_charge), is_active: Number(c.is_active) === 1 })), can: { edit: mayEdit(req) } };
  }), G);
  const saveCourier = (isNew) => wrap(async (req) => tx(async (q) => {
    const b = req.body || {}; const f = {};
    const name = String(b.name || '').trim().slice(0, 80); if (name.length < 2) f.name = 'Give the name.';
    const per = Number(b.per_kg); if (!(per >= 0) || String(b.per_kg ?? '') === '') f.per_kg = 'Charge per kg (Rs).';
    const min = Number(b.min_charge); if (!(min >= 0) || String(b.min_charge ?? '') === '') f.min_charge = 'Minimum charge (Rs).';
    const url = String(b.tracking_url || '').trim().slice(0, 255); if (url && !/^https:\/\/.+\{awb\}/.test(url)) f.tracking_url = 'An https link with {awb} in it.';
    if (Object.keys(f).length) fail(f);
    const vals = [name, String(b.phone || '').trim().slice(0, 20) || null, url || null, per, min, b.is_active === false ? 0 : 1];
    if (isNew) { const [i] = await q.query('INSERT INTO couriers (name, phone, tracking_url, per_kg, min_charge, is_active) VALUES (?, ?, ?, ?, ?, ?)', vals); await audit(q, { empId: by(req), action: 'create', entity: 'courier', entityId: name, after: { per, min } }); return { courier_id: i.insertId }; }
    const [[c]] = await q.query('SELECT courier_id, name, phone, tracking_url, per_kg, min_charge, is_active FROM couriers WHERE courier_id = ? FOR UPDATE', [Number(req.params.id)]);
    if (!c) throw new InputError('Courier not found', 404);
    await q.query('UPDATE couriers SET name = ?, phone = ?, tracking_url = ?, per_kg = ?, min_charge = ?, is_active = ? WHERE courier_id = ?', [...vals, c.courier_id]);
    await audit(q, { empId: by(req), action: 'update', entity: 'courier', entityId: name, before: { per: num(c.per_kg), min: num(c.min_charge), active: c.is_active }, after: { per, min, active: b.is_active !== false } });
    return { courier_id: c.courier_id };
  }));
  route('post', '/fulfil/couriers', 'delivery:create', saveCourier(true), { ...G, status: 201 });
  route('put', '/fulfil/couriers/:id', 'delivery:create', saveCourier(false), G);
  route('get', '/fulfil/areas', 'delivery:view', wrap(async (req) => {
    const [rows] = await db.query(`SELECT a.area_id, a.label, a.towns, a.godown_id, g.name AS godown, a.charge, a.free_above, a.days, a.show_on_map, a.is_active,
        (SELECT COUNT(DISTINCT x.customer_id) FROM customer_addresses x WHERE x.delivery_area_id = a.area_id AND x.is_active = 1) AS customers
        FROM delivery_areas a LEFT JOIN locations g ON g.location_id = a.godown_id ORDER BY a.sort_order, a.area_id`);
    const all = (await godowns.list(db)).filter((x) => x.is_active).map((x) => ({ godown_id: x.godown_id, name: x.name }));
    return { rows: rows.map((a) => ({ ...a, charge: num(a.charge), free_above: num(a.free_above), days: String(a.days || '').split(',').filter(Boolean), show_on_map: Number(a.show_on_map) === 1, is_active: Number(a.is_active) === 1, customers: Number(a.customers),
      pins: String(a.towns || '').split(',').map((x) => x.trim()).filter((x) => /^\d{6}$/.test(x)), towns_only: String(a.towns || '').split(',').map((x) => x.trim()).filter((x) => x && !/^\d{6}$/.test(x)) })), godowns: all, days: DAYS, can: { edit: mayEdit(req) } };
  }), G);
  const saveArea = (isNew) => wrap(async (req) => tx(async (q) => {
    const b = req.body || {}; const f = {};
    const label = String(b.label || '').trim().slice(0, 80); if (label.length < 2) f.label = 'Give the town or area.';
    const words = String(b.towns || '').split(',').map((x) => x.trim()).filter(Boolean);
    const pins = words.filter((x) => /^\d{6}$/.test(x));
    if (!words.length) f.towns = 'PIN codes (or towns), separated by commas.';
    else if (words.some((x) => /^\d+$/.test(x) && !/^[1-9]\d{5}$/.test(x))) f.towns = 'A PIN code is 6 digits.';
    const charge = Number(b.charge); if (!(charge >= 0) || String(b.charge ?? '') === '') f.charge = '0 = free.';
    const days = (Array.isArray(b.days) ? b.days : []).filter((d) => DAYS.includes(d)); if (!days.length) f.days = 'Tick the days we go.';
    if (Object.keys(f).length) fail(f);
    if (pins.length) {
      const [others] = await q.query('SELECT area_id, label, towns FROM delivery_areas WHERE area_id <> ?', [isNew ? 0 : Number(req.params.id)]);
      const taken = pins.find((p) => others.some((o) => String(o.towns || '').split(',').map((x) => x.trim()).includes(p)));
      if (taken) fail({ towns: `${taken} already belongs to another area.` });
    }
    const vals = [label, Number(b.godown_id) || null, words.join(', ').slice(0, 1000), charge, b.free_above === '' || b.free_above === undefined || b.free_above === null ? null : Number(b.free_above), DAYS.filter((d) => days.includes(d)).join(','), b.show_on_map === false ? 0 : 1, b.is_active === false ? 0 : 1];
    if (isNew) { const [i] = await q.query('INSERT INTO delivery_areas (label, godown_id, towns, charge, free_above, days, show_on_map, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', vals); await audit(q, { empId: by(req), action: 'create', entity: 'delivery_area', entityId: label, after: { towns: vals[2], charge, days: vals[5] } }); return { area_id: i.insertId }; }
    const [[a]] = await q.query('SELECT area_id, towns, charge, days FROM delivery_areas WHERE area_id = ? FOR UPDATE', [Number(req.params.id)]);
    if (!a) throw new InputError('Area not found', 404);
    await q.query('UPDATE delivery_areas SET label = ?, godown_id = ?, towns = ?, charge = ?, free_above = ?, days = ?, show_on_map = ?, is_active = ? WHERE area_id = ?', [...vals, a.area_id]);
    await audit(q, { empId: by(req), action: 'update', entity: 'delivery_area', entityId: label, before: { towns: a.towns, charge: num(a.charge), days: a.days }, after: { towns: vals[2], charge, days: vals[5] } });
    return { area_id: a.area_id };
  }));
  route('post', '/fulfil/areas', 'delivery:create', saveArea(true), { ...G, status: 201 });
  route('put', '/fulfil/areas/:id', 'delivery:create', saveArea(false), G);
}

module.exports = { register };
