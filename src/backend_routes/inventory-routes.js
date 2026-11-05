// Section 5 Inventory, the screens' API (phase 18, v23 "SECTION 5 INVENTORY - PAGES AND PANELS" and "ACTIONS"; rules in
// inventory.js and stock.js). Rights (roles grid row "Inventory"): view = every page; create = a transfer, counting it
// in, counting a stock take, a write-off, a shelf move, Found / Lost; edit = start or cancel a stock take; export = the
// stock ledger CSV; approve (Approvals) = write-offs, count differences, transfer losses, stock back to Good. Values and
// costs only to See cost ("hidden", never Rs 0). Every record belongs to a godown: people see the godowns they work
// at (the header picker narrows it); records elsewhere answer 404.
const inv = require('./inventory');
const stock = require('./stock');
const books = require('./books');
const godowns = require('./godowns');
const approvals = require('./approvals');
const secondAdmin = require('./second-admin');
const auth = require('./auth');
const { audit } = require('./audit');

const r3 = stock.round3;
const csvCell = (c) => { const s = c === null || c === undefined ? '' : String(c); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const TK_ST = { open: 'Counting, shelf frozen', pending: 'Waiting for approval', posted: 'Posted', closed: 'Posted, no difference', rejected: 'Rejected: count again', cancelled: 'Cancelled' };
const WO_ST = { pending: 'Waiting for approval', posted: 'Done', rejected: 'Rejected' };

async function namesOf(q, ids) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map();
  const [rows] = await q.query(`SELECT emp_id, TRIM(CONCAT(COALESCE(emp_first_name, ''), ' ', COALESCE(emp_last_name, ''))) AS name FROM \`${auth.DADMIN}\`.employee WHERE emp_id IN (?)`, [list]);
  return new Map(rows.map((r) => [r.emp_id, r.name || r.emp_id]));
}
const nm = (names, id) => (id ? names.get(id) || id : '');

function register({ route, tx, db, by, InputError, canDo, commerceGate, seesCost }) {
  const G = { before: [commerceGate] };
  const asErr = (e) => {
    if (e instanceof inv.InvError || e instanceof stock.StockError || e instanceof books.BooksError || e instanceof godowns.GodownError) {
      const x = new InputError(e.message, e.status || 400); if (e.fields) { x.code = 'fields'; x.fields = e.fields; } return x;
    }
    return e;
  };
  const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (e) { throw asErr(e); } };
  const can = (req, a) => canDo(req, 'inventory', a);
  const hide = (req, v) => (seesCost(req) ? v : null);
  const waitLine = (q, id) => (id ? secondAdmin.waitingLine(q, id) : '');
  /** the active godowns in view (the picker's one, or all of the person's) -> [{ godown_id, name, code }] */
  async function inView(q, req) {
    const sc = godowns.viewScope(req);
    return (await godowns.list(q)).filter((g) => g.is_active && (sc === null || sc.includes(g.godown_id)));
  }
  const mine = async (q, req) => (await godowns.list(q)).filter((g) => g.is_active && godowns.covers(req.admin, g.godown_id));
  const sees = (req, gid) => godowns.assertSees(req, gid, 'Not found');

  // the photo of every pack (ItemCell on every admin page shows it: house rule "every product with its image")
  route('get', '/sku-images', 'any', wrap(async () => {
    const [rows] = await db.query(`SELECT s.sku_code, (SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1) AS image
        FROM skus s WHERE s.sku_type <> 'raw'`);
    return Object.fromEntries(rows.filter((r) => r.image).map((r) => [r.sku_code, r.image]));
  }));

  // ============================================================================================ options
  route('get', '/inventory/options', 'inventory:view', wrap(async (req) => {
    const its = await inv.items(db);
    const cats = (await db.query("SELECT c.category_key AS `key`, COALESCE(ct.name, c.category_key) AS name FROM categories c LEFT JOIN category_translations ct ON ct.category_key = c.category_key AND ct.lang_code = 'en' ORDER BY c.sort_order"))[0];
    const all = (await godowns.list(db)).filter((g) => g.is_active);
    return {
      mine: (await mine(db, req)).map((g) => ({ godown_id: g.godown_id, name: g.name })), godowns: all.map((g) => ({ godown_id: g.godown_id, name: g.name })),
      items: [...its.values()].filter((x) => x.live).map((x) => ({ sku_code: x.sku_code, name: x.name, unit: x.unit, raw: x.raw, image: x.image, track: x.track })),
      categories: cats, shelves: stock.SHELVES.map((k) => ({ key: k, label: stock.KIND_LABEL[k] })),
      wo_types: Object.entries(stock.WRITE_OFF_TYPES).filter(([k]) => k !== 'prodqc').map(([k, l]) => ({ key: k, label: l, next: stock.WRITE_OFF_NEXT[k] })),
      eway: await inv.ewayRule(db), see_cost: seesCost(req),
      can: { create: can(req, 'create'), edit: can(req, 'edit'), export: can(req, 'export'), buy: canDo(req, 'buying', 'create'), make: canDo(req, 'production', 'create'), goods_in: canDo(req, 'buying', 'create') },
    };
  }), G);

  // ============================================================================================ stock status
  route('get', '/inventory/stock', 'inventory:view', wrap(async (req) => {
    const gs = await inView(db, req);
    const kind = req.query.kind === 'raw' ? 'raw' : 'pack';
    const rows = await inv.stockRows(db, gs.map((g) => g.godown_id), { kind });
    const see = seesCost(req);
    return { rows: rows.map((r) => ({ ...r, avg_cost: see ? r.avg_cost : null, value: see ? r.value : null })), godowns: gs.map((g) => g.name), all_godowns: gs.length === (await godowns.list(db)).filter((g) => g.is_active).length,
      total_value: see ? Math.round(rows.reduce((a, r) => a + (r.value || 0), 0) * 100) / 100 : null, see_cost: see };
  }), G);
  route('get', '/inventory/stock/:sku', 'inventory:view', wrap(async (req) => {
    const gs = await inView(db, req);
    const d = await inv.itemDetail(db, String(req.params.sku).toUpperCase(), gs.map((g) => g.godown_id));
    return { ...d, avg_cost: hide(req, d.avg_cost), moves: d.moves.map((m) => ({ ...m, unit_cost: hide(req, m.unit_cost) })) };
  }), G);

  // ============================================================================================ batches and expiry
  route('get', '/inventory/batches', 'inventory:view', wrap(async (req) => {
    const gs = await inView(db, req);
    const ids = gs.map((g) => g.godown_id);
    const warn = Number((await require('./commerce-settings').read(db)).expiry_warn_days) || 60; // eslint-disable-line global-require
    const [rows] = await db.query(`SELECT m.location_id AS godown_id, g.name AS godown, m.stock_kind, b.batch_id, b.batch_no, b.sku_code, DATE_FORMAT(b.mfg_date, '%Y-%m-%d') AS mfg, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS exp,
        DATEDIFF(b.expiry_date, ${stock.IST_TODAY}) AS days, p.near_expiry_days AS w, SUM(m.delta) AS n
        FROM stock_movements m JOIN batches b ON b.batch_id = m.batch_id JOIN locations g ON g.location_id = m.location_id JOIN skus s ON s.sku_code = b.sku_code LEFT JOIN products p ON p.product_id = s.product_id
        WHERE m.location_id IN (?) AND m.stock_kind IN ('good', 'hold') GROUP BY m.location_id, g.name, m.stock_kind, b.batch_id, b.batch_no, b.sku_code, b.mfg_date, b.expiry_date, p.near_expiry_days HAVING n > 0 ORDER BY b.expiry_date`,
    [ids.length ? ids : [0]]);
    const its = await inv.items(db, [...new Set(rows.map((r) => r.sku_code))]);
    const all = rows.map((r) => {
      const d = Number(r.days); const w = r.w === null ? warn : Number(r.w);
      return { godown_id: r.godown_id, godown: r.godown, shelf: r.stock_kind, shelf_label: stock.KIND_LABEL[r.stock_kind], batch_id: r.batch_id, batch_no: r.batch_no, sku_code: r.sku_code,
        name: (its.get(r.sku_code) || {}).name, image: (its.get(r.sku_code) || {}).image, qty: r3(r.n), mfg: r.mfg, exp: r.exp, days: d, warn: w, state: d < 0 ? 'expired' : d < w ? 'near' : 'ok' };
    });
    const tab = ['expired', 'near', 'ok', 'all'].includes(req.query.tab) ? req.query.tab : 'expired';
    return { rows: all.filter((r) => tab === 'all' || r.state === tab), counts: { expired: all.filter((r) => r.state === 'expired').length, near: all.filter((r) => r.state === 'near').length,
      ok: all.filter((r) => r.state === 'ok').length, all: all.length }, can: { create: can(req, 'create') } };
  }), G);

  // ============================================================================================ transfers
  async function trView(q, req, t, full = false) {
    const its = await inv.items(q, t.lines.map((l) => l.sku_code));
    const first = its.get((t.lines[0] || {}).sku_code) || {};
    const out = { transfer_id: t.transfer_id, transfer_no: t.transfer_no, from: t.from_name, to: t.to_name, from_godown: t.from_godown, to_godown: t.to_godown, vehicle_no: t.vehicle_no,
      status: t.status, status_label: inv.TR_ST[t.status], loss: t.loss, sent_at: t.sent_at, recv_at: t.recv_at,
      items_text: `${first.name || ''}${t.lines.length > 1 ? ` +${t.lines.length - 1} more` : ''}`, lines_text: t.lines.map((l) => `${l.qty} ${l.sku_code}`).join(', ') };
    if (!full) return out;
    const names = await namesOf(q, [t.sent_by, t.recv_by, t.loss_by, t.driver]);
    const missing = t.loss === 'rejected' ? await inv.disputedOf(q, t, t.from_godown) : [];
    const waits = await inv.settling(q, t.transfer_id);
    const [wos] = await q.query("SELECT write_off_id, kind, qty, sku_code, status FROM write_offs WHERE transfer_id = ? ORDER BY write_off_id", [t.transfer_id]);
    const canRecv = t.status === 'transit' && can(req, 'create') && godowns.covers(req.admin, t.to_godown) && t.sent_by !== by(req);
    return { ...out, driver: t.driver ? nm(names, t.driver) : null, ewb_no: t.ewb_no, value: hide(req, t.value === null ? null : Number(t.value)),
      sent_by: nm(names, t.sent_by), recv_by: nm(names, t.recv_by), loss_text: t.loss_text, loss_value: hide(req, t.loss_value === null ? null : Number(t.loss_value)),
      loss_by: nm(names, t.loss_by), loss_line: t.loss === 'waiting' ? await waitLine(q, t.loss_approval_id) : null,
      lines: t.lines.map((l) => { const it = its.get(l.sku_code) || {}; return { sku_code: l.sku_code, name: it.name, image: it.image, unit: it.unit, qty: l.qty, qty_text: inv.qtyText(it, l.qty), recv: l.recv,
        lots: l.lots.map((x) => `${x.batch_no || '-'} ${x.qty}`).join(', ') }; }),
      missing: missing.map((x) => ({ sku_code: x.sku_code, qty: x.qty })), settles: wos.map((w) => ({ id: `WO-${w.write_off_id}`, kind: w.kind === 'move' ? 'Found' : 'Lost', qty: Number(w.qty), sku_code: w.sku_code, status: WO_ST[w.status] })),
      can: { receive: canRecv, settle: missing.length > 0 && !waits && can(req, 'create') && godowns.covers(req.admin, t.from_godown) },
      not_mine: t.status === 'transit' && !canRecv ? (t.sent_by === by(req) ? 'You sent it: somebody else counts it in.' : `Somebody at ${t.to_name} counts it in.`) : null };
  }
  route('get', '/inventory/transfers', 'inventory:view', wrap(async (req) => {
    const ids = (await inView(db, req)).map((g) => g.godown_id);
    const [rows] = await db.query('SELECT transfer_id, status FROM transfers WHERE from_godown IN (?) OR to_godown IN (?) ORDER BY transfer_id DESC', [ids.length ? ids : [0], ids.length ? ids : [0]]);
    const tab = req.query.tab === 'received' ? 'received' : 'transit';
    const list = [];
    for (const r of rows.filter((x) => (tab === 'transit' ? x.status === 'transit' : x.status !== 'transit'))) list.push(await trView(db, req, await inv.transferOf(db, r.transfer_id)));
    return { rows: list, counts: { transit: rows.filter((x) => x.status === 'transit').length, received: rows.filter((x) => x.status !== 'transit').length }, can: { create: can(req, 'create') } };
  }), G);
  route('get', '/inventory/transfers/:id', 'inventory:view', wrap(async (req) => {
    const t = await inv.transferOf(db, req.params.id);
    if (!t) throw new InputError('No such transfer', 404);
    const sc = godowns.viewScope(req);
    if (sc !== null && !sc.includes(t.from_godown) && !sc.includes(t.to_godown)) throw new InputError('Not found', 404);
    return trView(db, req, t, true);
  }), G);
  route('get', '/inventory/free', 'inventory:view', wrap(async (req) => { // what can go from a godown (the transfer form)
    const g = Number(req.query.godown); const sku = String(req.query.sku || '').toUpperCase();
    sees(req, g);
    const a = (await stock.availability(db, [sku], 0, { godown: g })).get(sku);
    return { free: r3(Math.max(0, a.good - a.reserved - a.expired)), good: r3(a.good), held: r3(a.reserved), expired: r3(a.expired) };
  }), G);
  route('post', '/inventory/transfers', 'inventory:create', wrap(async (req) => tx(async (q) => {
    const r = await inv.sendTransfer(q, req.body || {}, by(req), req.admin);
    return { ...r, title: `${r.transfer_no} on the road`, message: `Off the shelf at ${r.from}, in the lorry ${r.vehicle}. The company total has not moved; ${r.to} counts it in.` };
  })), G);
  route('post', '/inventory/transfers/:id/receive', 'inventory:create', wrap(async (req) => tx(async (q) => {
    const r = await inv.receiveTransfer(q, req.params.id, (req.body || {}).recv, by(req), req.admin);
    const line = r.approval_id ? ` ${await waitLine(q, r.approval_id)}` : '';
    return { ...r, tone: r.short.length ? 'warn' : 'good', title: r.short.length ? 'Received short' : 'Received', message: `${r.message}${line}` };
  })), G);
  route('post', '/inventory/transfers/:id/found', 'inventory:create', wrap(async (req) => tx(async (q) => ({ ...(await inv.settleTransfer(q, req.params.id, true, by(req))), title: 'Waiting for approval' }))), G);
  route('post', '/inventory/transfers/:id/lost', 'inventory:create', wrap(async (req) => tx(async (q) => ({ ...(await inv.settleTransfer(q, req.params.id, false, by(req))), title: 'Waiting for approval' }))), G);

  // ============================================================================================ stock take
  const scopeText = (s, cats) => (s === 'all' ? 'The whole godown' : s === 'raw' ? 'Raw materials' : (cats.find((c) => c.key === s) || { name: s }).name);
  const cats = async () => (await db.query("SELECT c.category_key AS `key`, COALESCE(ct.name, c.category_key) AS name FROM categories c LEFT JOIN category_translations ct ON ct.category_key = c.category_key AND ct.lang_code = 'en' ORDER BY c.sort_order"))[0];
  route('get', '/inventory/takes', 'inventory:view', wrap(async (req) => {
    const ids = (await inView(db, req)).map((g) => g.godown_id);
    const [rows] = await db.query(`SELECT c.count_id, c.scope, c.godown_id, g.name AS godown, c.status, c.started_at,
        (SELECT COUNT(*) FROM stock_count_lines l WHERE l.count_id = c.count_id AND l.counted IS NOT NULL AND l.expected IS NOT NULL AND l.counted <> l.expected) AS diffs
        FROM stock_counts c JOIN locations g ON g.location_id = c.godown_id WHERE c.godown_id IN (?) ORDER BY c.count_id DESC`, [ids.length ? ids : [0]]);
    const cs = await cats();
    return { rows: rows.map((r) => ({ count_id: r.count_id, ref: `ST-${r.count_id}`, godown: r.godown, scope: scopeText(r.scope, cs), status: r.status, status_label: TK_ST[r.status] || r.status,
      started_at: r.started_at, diffs: r.status === 'open' ? null : Number(r.diffs) })), can: { start: can(req, 'edit') }, scopes: [{ key: 'all', name: 'The whole godown' }, ...cs, { key: 'raw', name: 'Raw materials' }],
    mine: (await mine(db, req)).map((g) => ({ godown_id: g.godown_id, name: g.name })) };
  }), G);
  route('get', '/inventory/takes/:id', 'inventory:view', wrap(async (req) => {
    const t = await inv.takeView(db, Number(req.params.id));
    sees(req, t.godown_id);
    const names = await namesOf(db, [t.started_by, t.submitted_by]);
    const cs = await cats();
    const [[g]] = await db.query('SELECT name FROM locations WHERE location_id = ?', [t.godown_id]);
    const [[a]] = t.approval_id ? await db.query('SELECT status, decided_by FROM approvals WHERE approval_id = ?', [t.approval_id]) : [[null]];
    const dn = a && a.decided_by ? await namesOf(db, [a.decided_by]) : new Map();
    return { count_id: t.count_id, ref: `ST-${t.count_id}`, godown: g.name, scope: scopeText(t.scope, cs), status: t.status, status_label: TK_ST[t.status], started_by: nm(names, t.started_by), started_at: t.started_at,
      submitted_by: nm(names, t.submitted_by), decided_by: a && a.decided_by ? nm(dn, a.decided_by) : null, counting: t.counting, lines: t.lines, scanned: t.scanned, diffs: t.diffs, value: hide(req, t.value),
      wait_line: t.status === 'pending' ? await waitLine(db, t.approval_id) : null,
      can: { count: t.counting && can(req, 'create') && godowns.covers(req.admin, t.godown_id), cancel: t.counting && can(req, 'edit') && godowns.covers(req.admin, t.godown_id) } };
  }), G);
  route('post', '/inventory/takes', 'inventory:edit', wrap(async (req) => tx(async (q) => {
    const b = req.body || {};
    const g = (await mine(q, req)).find((x) => x.godown_id === Number(b.godown_id));
    if (!g) throw new InputError('Choose a godown you work at.');
    const r = await stock.startCount(q, b.scope, by(req), g.godown_id);
    const cs = await cats();
    return { ...r, ref: `ST-${r.count_id}`, title: `ST-${r.count_id}: ${scopeText(String(b.scope || 'all'), cs)} at ${g.name} is frozen`, message: 'Count each batch and Submit. Nothing can leave that shelf until then.' };
  })), G);
  route('put', '/inventory/takes/:id', 'inventory:create', wrap(async (req) => tx(async (q) => {
    const [[c]] = await q.query('SELECT godown_id FROM stock_counts WHERE count_id = ?', [Number(req.params.id)]);
    if (!c) throw new InputError('No such stock take', 404);
    godowns.assertWorks(req.admin, c.godown_id);
    return stock.saveCount(q, Number(req.params.id), (req.body || {}).lines, by(req));
  })), G);
  route('post', '/inventory/takes/:id/submit', 'inventory:create', wrap(async (req) => tx(async (q) => {
    const id = Number(req.params.id);
    const [[c]] = await q.query('SELECT godown_id FROM stock_counts WHERE count_id = ?', [id]);
    if (!c) throw new InputError('No such stock take', 404);
    godowns.assertWorks(req.admin, c.godown_id);
    if (Array.isArray((req.body || {}).lines)) await stock.saveCount(q, id, req.body.lines, by(req));
    const r = await stock.submitCount(q, id, by(req));
    if (r.status === 'closed') return { ...r, tone: 'good', title: 'No difference', message: 'Posted. The shelf is unfrozen.' };
    return { ...r, tone: 'warn', title: `Submitted with ${r.differences} difference${r.differences > 1 ? 's' : ''}`, message: `The shelf is unfrozen; the stock changes only after approval. ${await waitLine(q, r.approval_id)}` };
  })), G);
  route('post', '/inventory/takes/:id/cancel', 'inventory:edit', wrap(async (req) => tx(async (q) => {
    const id = Number(req.params.id);
    const [[c]] = await q.query('SELECT godown_id, status FROM stock_counts WHERE count_id = ? FOR UPDATE', [id]);
    if (!c) throw new InputError('No such stock take', 404);
    godowns.assertWorks(req.admin, c.godown_id);
    if (c.status !== 'open') throw new InputError(`ST-${id} is ${TK_ST[c.status].toLowerCase()}: only a count still being counted can be cancelled.`, 409);
    await q.query("UPDATE stock_counts SET status = 'cancelled', closed_at = UTC_TIMESTAMP() WHERE count_id = ?", [id]);
    await audit(q, { empId: by(req), action: 'cancel', entity: 'stock_count', entityId: String(id), before: { status: 'counting' }, after: { status: 'cancelled', stock: 'unchanged' } });
    return { title: 'Cancelled', message: 'The count is thrown away and the shelf is unfrozen. Nothing changed in stock.' };
  })), G);

  // ============================================================================================ write-offs and shelf moves
  route('get', '/inventory/write-offs', 'inventory:view', wrap(async (req) => {
    const ids = (await inView(db, req)).map((g) => g.godown_id);
    const [rows] = await db.query(`SELECT w.write_off_id, w.sku_code, w.godown_id, g.name AS godown, w.stock_kind, w.to_kind, w.kind, w.qty, w.reason_type, w.reason, w.value, w.status, w.run_id, w.transfer_id, w.emp_id, w.created_at
        FROM write_offs w JOIN locations g ON g.location_id = w.godown_id WHERE w.godown_id IN (?) ORDER BY w.write_off_id DESC LIMIT 300`, [ids.length ? ids : [0]]);
    const its = await inv.items(db, [...new Set(rows.map((r) => r.sku_code))]);
    const [wait] = await db.query("SELECT m.sku_code, m.location_id, g.name AS godown, m.stock_kind, SUM(m.delta) AS n FROM stock_movements m JOIN locations g ON g.location_id = m.location_id WHERE m.location_id IN (?) AND m.stock_kind IN ('dmg', 'ret') GROUP BY m.sku_code, m.location_id, g.name, m.stock_kind HAVING n > 0 ORDER BY g.name, m.sku_code",
      [ids.length ? ids : [0]]);
    const wits = await inv.items(db, [...new Set(wait.map((r) => r.sku_code))]);
    const rule = await approvals.rule(db, 'write_off');
    return {
      rows: rows.map((w) => { const it = its.get(w.sku_code) || {}; return { id: w.write_off_id, ref: `WO-${w.write_off_id}`, sku_code: w.sku_code, name: it.name, image: it.image, godown: w.godown, qty: r3(w.qty),
        from: stock.KIND_LABEL[w.stock_kind], to: w.kind === 'move' ? stock.KIND_LABEL[w.to_kind] : null, kind: w.kind,
        reason: w.kind === 'move' ? (w.transfer_id ? 'Found after a transfer' : 'Shelf move') : stock.WRITE_OFF_TYPES[w.reason_type] || w.reason_type, note: w.reason,
        value: hide(req, w.value === null ? null : Number(w.value)), status: w.status, status_label: WO_ST[w.status] || w.status, at: w.created_at }; }),
      waiting: wait.map((r) => ({ sku_code: r.sku_code, name: (wits.get(r.sku_code) || {}).name, image: (wits.get(r.sku_code) || {}).image, godown: r.godown, shelf: stock.KIND_LABEL[r.stock_kind], qty: r3(r.n) })),
      rule: { on: Boolean(Number(rule.is_on)), above: Number(rule.limit_value), packs: rule.limit_packs === null ? null : Number(rule.limit_packs) }, can: { create: can(req, 'create') },
    };
  }), G);
  route('get', '/inventory/write-offs/:id', 'inventory:view', wrap(async (req) => {
    const [[w]] = await db.query(`SELECT w.*, g.name AS godown, b.batch_no FROM write_offs w JOIN locations g ON g.location_id = w.godown_id LEFT JOIN batches b ON b.batch_id = w.batch_id WHERE w.write_off_id = ?`, [Number(req.params.id)]);
    if (!w) throw new InputError('No such record', 404);
    sees(req, w.godown_id);
    const its = await inv.items(db, [w.sku_code]);
    const it = its.get(w.sku_code) || {};
    const [[a]] = w.approval_id ? await db.query('SELECT status, decided_by FROM approvals WHERE approval_id = ?', [w.approval_id]) : [[null]];
    const names = await namesOf(db, [w.emp_id, a && a.decided_by]);
    const [[tr]] = w.transfer_id ? await db.query('SELECT transfer_no FROM transfers WHERE transfer_id = ?', [w.transfer_id]) : [[null]];
    const [[run]] = w.run_id ? await db.query('SELECT run_no FROM production_runs WHERE run_id = ?', [w.run_id]) : [[null]];
    return { id: w.write_off_id, ref: `WO-${w.write_off_id}`, sku_code: w.sku_code, name: it.name, image: it.image, godown: w.godown, qty: r3(w.qty), from: stock.KIND_LABEL[w.stock_kind],
      to: w.kind === 'move' ? stock.KIND_LABEL[w.to_kind] : null, kind: w.kind, batch_no: w.batch_no, reason: w.kind === 'move' ? (w.transfer_id ? 'Found after a transfer' : 'Shelf move') : stock.WRITE_OFF_TYPES[w.reason_type],
      next: w.kind === 'move' ? null : stock.WRITE_OFF_NEXT[w.reason_type], note: w.reason, value: hide(req, w.value === null ? null : Number(w.value)), status: w.status, status_label: WO_ST[w.status],
      by: nm(names, w.emp_id), at: w.created_at, decided_by: a && a.decided_by ? nm(names, a.decided_by) : null, transfer_no: tr ? tr.transfer_no : null, run_no: run ? run.run_no : null,
      wait_line: w.status === 'pending' ? await waitLine(db, w.approval_id) : null };
  }), G);
  route('post', '/inventory/write-offs', 'inventory:create', wrap(async (req) => tx(async (q) => {
    const b = req.body || {};
    godowns.assertWorks(req.admin, Number(b.godown_id));
    const e = {};
    if (!b.sku_code) e.sku_code = 'Choose the item.';
    if (!/^\d+$/.test(String(b.qty ?? '').trim()) || Number(b.qty) < 1) e.qty = 'A whole number, at least 1.';
    if (!String(b.reason || '').trim()) e.reason = 'Say what happened.';
    if (b.stock_kind === 'hold') e.stock_kind = 'QC hold is cleared only by Quality check: reject it there.';
    if (Object.keys(e).length) throw Object.assign(new InputError('Fix the fields marked in red'), { code: 'fields', fields: e });
    const r = await stock.requestWriteOff(q, b, by(req));
    const ref = `WO-${r.write_off_id}`;
    if (r.status === 'pending') return { ...r, ref, value: hide(req, r.value), tone: 'warn', title: `${ref} waits for approval`, message: `It is above the rule. ${await waitLine(q, r.approval_id)} The stock stays until then.` };
    return { ...r, ref, value: hide(req, r.value), tone: 'good', title: `${ref} written off`, message: 'It is within the rule, so it is done; it is in the audit log and the stock ledger.' };
  })), G);
  route('post', '/inventory/moves', 'inventory:create', wrap(async (req) => tx(async (q) => {
    const b = req.body || {};
    godowns.assertWorks(req.admin, Number(b.godown_id));
    const r = await inv.shelfMove(q, b, by(req));
    if (r.status === 'pending') return { ...r, tone: 'warn', title: 'Waiting for approval', message: `Stock back to Good needs a second person. ${await waitLine(q, r.approval_id)}` };
    const a = (await stock.availability(q, [String(b.sku_code).toUpperCase()], 0, { godown: Number(b.godown_id) })).get(String(b.sku_code).toUpperCase());
    return { ...r, tone: 'good', title: `Moved ${b.qty} to ${stock.KIND_LABEL[b.to]}`, message: `Not a loss: the company total is unchanged. Free to sell here is now ${r3(Math.max(0, a.good - a.reserved - a.expired))}.` };
  })), G);

  // ============================================================================================ reorder
  route('get', '/inventory/reorder', 'inventory:view', wrap(async (req) => {
    const rows = await inv.reorderRows(db, (await inView(db, req)).map((g) => g.godown_id));
    return { rows, can: { buy: canDo(req, 'buying', 'create'), make: canDo(req, 'production', 'create') } };
  }), G);

  // ============================================================================================ stock ledger
  const ledgerFilter = (req) => ({ q: String(req.query.q || '').slice(0, 60), shelf: req.query.shelf || '', from: req.query.from || '', sku: req.query.sku ? String(req.query.sku).toUpperCase() : '' });
  route('get', '/inventory/ledger', 'inventory:view', wrap(async (req) => {
    const r = await inv.ledger(db, (await inView(db, req)).map((g) => g.godown_id), ledgerFilter(req));
    return { ...r, rows: r.rows.map((m) => ({ ...m, unit_cost: hide(req, m.unit_cost) })), shelves: stock.SHELVES.map((k) => ({ key: k, label: stock.KIND_LABEL[k] })), can: { export: can(req, 'export') } };
  }), G);
  route('get', '/inventory/ledger.csv', 'inventory:export', wrap(async (req, res) => {
    const gs = await inView(db, req);
    const r = await inv.ledger(db, gs.map((g) => g.godown_id), { ...ledgerFilter(req), limit: 100000 });
    const see = seesCost(req);
    const head = ['when', 'who', 'employee_id', 'item', 'godown', 'shelf', 'batch', 'qty', 'what', 'document', ...(see ? ['unit_cost'] : [])];
    const ist = (d) => new Date(new Date(d).getTime() + 5.5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
    const lines = [head, ...r.rows.map((m) => [ist(m.at), m.who, m.emp_id, m.sku_code, m.godown, m.shelf_label, m.batch_no, m.qty, m.what, m.doc, ...(see ? [m.unit_cost] : [])])];
    await audit(db, { empId: by(req), action: 'export', entity: 'stock', entityId: 'ledger', after: { moves: r.rows.length } });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="dfresh-stock-ledger-${new Date().toISOString().slice(0, 10)}.csv"` });
    res.send(`﻿${lines.map((l) => l.map(csvCell).join(',')).join('\n')}\n`);
    return undefined;
  }), G);
}

module.exports = { register };
