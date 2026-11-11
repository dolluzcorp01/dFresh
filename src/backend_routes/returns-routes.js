// Phase 22: the lists of the v23 pages Sales > Returns (Return requests, Inspection) and Marketing > Customer wallets.
// The steps of a return keep their routes (/commerce/returns/*, returns.js); the offers, coupons and cashback rules keep
// /commerce/promotions, /commerce/offers, /commerce/coupons and /commerce/cashback-rules (Admin_server.js, promotions.js).
// Every list follows the godowns a person works at; Sales with "Own customers only" see their own customers' returns
// and wallets. Amounts a role may not see are null ("hidden" on the screen), never Rs 0.
const returns = require('./returns');
const promotions = require('./promotions');
const wallet = require('./wallet');
const godowns = require('./godowns');
const pricing = require('./pricing');
const commerceSettings = require('./commerce-settings');
const approvals = require('./approvals');

const SKU_NAME = 'COALESCE(t.name, pt.name, s.product_id)';
const SKU_JOIN = `JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'`;
const IMG = '(SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1)';
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
// the v23 tabs of Return requests, over our statuses
const TAB = {
  waiting: "r.status IN ('requested', 'collecting') AND EXISTS (SELECT 1 FROM approvals a WHERE a.ref_type = 'return' AND a.ref_id = r.return_no AND a.kind = 'return_window' AND a.status = 'pending')",
  to_collect: "r.status IN ('requested', 'collecting') AND r.picked_up_at IS NULL AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.ref_type = 'return' AND a.ref_id = r.return_no AND a.kind = 'return_window' AND a.status = 'pending')",
  // phase 22: also a return whose resell was not signed (those packs are inspected again)
  to_inspect: "(r.status = 'received' OR (r.status = 'collecting' AND r.picked_up_at IS NOT NULL) OR EXISTS (SELECT 1 FROM return_items x JOIN approvals a ON a.approval_id = x.resell_approval_id WHERE x.return_id = r.return_id AND x.qty_ok > 0 AND a.status IN ('rejected', 'withdrawn', 'expired')))",
  deciding: "r.status = 'inspected'",
  closed: "r.status IN ('refunded', 'replaced', 'closed', 'rejected')",
};
const TAB_LABEL = { waiting: 'Waiting for approval', to_collect: 'To collect', to_inspect: 'To inspect', deciding: 'Decision waiting', closed: 'Closed' };

function register({ route, db, InputError, canDo, commerceGate }) {
  const G = { before: [commerceGate] };
  const own = (req) => (req.admin && req.admin.ownOnly ? req.admin.emp_id : null);
  const scope = (req, col) => godowns.where(col, godowns.viewScope(req));

  // ============================================================================================ returns
  async function rowsOf(req, where, args) {
    const [gw, gp] = scope(req, 'r.godown_id');
    const ownW = own(req) ? ' AND c.owner_emp_id = ?' : '';
    const [rows] = await db.query(`SELECT r.return_no, r.status, r.collection, r.outside_window, r.created_at, r.received_at, r.picked_up_at, r.closed_at, r.reason_note, g.name AS godown,
        o.order_no, c.name AS customer, c.customer_no, rr.label AS reason,
        (SELECT x.sku_code FROM return_items x WHERE x.return_id = r.return_id ORDER BY x.line_id LIMIT 1) AS first_sku,
        (SELECT GROUP_CONCAT(CONCAT(x.sku_code, ' ', x.qty) ORDER BY x.line_id SEPARATOR ', ') FROM return_items x WHERE x.return_id = r.return_id) AS items,
        (SELECT COALESCE(SUM(x.qty), 0) FROM return_items x WHERE x.return_id = r.return_id) AS packs,
        (SELECT GROUP_CONCAT(a.kind) FROM approvals a WHERE a.ref_type = 'return' AND a.ref_id = r.return_no AND a.status = 'pending') AS waiting
        FROM returns r JOIN orders o ON o.order_id = r.order_id JOIN customers c ON c.customer_id = o.customer_id JOIN return_reasons rr ON rr.reason_id = r.reason_id
        JOIN locations g ON g.location_id = r.godown_id WHERE ${gw} AND ${where}${ownW} ORDER BY r.return_id DESC LIMIT 300`, [...gp, ...args, ...(own(req) ? [own(req)] : [])]);
    const skus = [...new Set(rows.map((r) => r.first_sku).filter(Boolean))];
    const [nm] = skus.length ? await db.query(`SELECT s.sku_code, ${SKU_NAME} AS name, ${IMG} AS image FROM skus s ${SKU_JOIN} WHERE s.sku_code IN (?)`, [skus]) : [[]];
    const m = new Map(nm.map((x) => [x.sku_code, x]));
    return rows.map((r) => ({ ...r, packs: Number(r.packs), outside_window: Number(r.outside_window) === 1, status_label: returns.STATUS_LABEL[r.status], collection_label: returns.COLLECTION[r.collection],
      first_name: (m.get(r.first_sku) || {}).name || r.first_sku, first_image: (m.get(r.first_sku) || {}).image || null,
      waiting: r.waiting ? r.waiting.split(',').map((k) => (approvals.KINDS[k] || {}).label || k) : [] }));
  }
  route('get', '/sales/returns', 'returns:view', async (req) => {
    const tab = TAB[req.query.tab] ? req.query.tab : 'to_collect';
    const counts = {};
    for (const k of Object.keys(TAB)) {
      const [gw, gp] = scope(req, 'r.godown_id');
      const [[n]] = await db.query(`SELECT COUNT(*) AS n FROM returns r JOIN orders o ON o.order_id = r.order_id JOIN customers c ON c.customer_id = o.customer_id WHERE ${gw} AND ${TAB[k]}${own(req) ? ' AND c.owner_emp_id = ?' : ''}`, [...gp, ...(own(req) ? [own(req)] : [])]);
      counts[k] = Number(n.n);
    }
    const s = await commerceSettings.read(db);
    return { tab, tabs: TAB_LABEL, counts, rows: await rowsOf(req, TAB[tab], []), window_days: Number(s.return_window_days) || 0,
      can: { create: canDo(req, 'returns', 'create'), edit: canDo(req, 'returns', 'edit'), inspect: canDo(req, 'inventory', 'edit') } };
  }, G);
  // the delivered orders a new return can be made on (the New return picker)
  route('get', '/sales/returns/orders', 'returns:create', async (req) => {
    const [gw, gp] = scope(req, 'o.godown_id');
    const [rows] = await db.query(`SELECT o.order_no, c.name AS customer, c.customer_no, DATE_FORMAT(CONVERT_TZ(o.delivered_at, '+00:00', '+05:30'), '%Y-%m-%d') AS delivered_on,
        DATEDIFF(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')), DATE(CONVERT_TZ(o.delivered_at, '+00:00', '+05:30'))) AS days
        FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.status = 'delivered' AND ${gw}${own(req) ? ' AND c.owner_emp_id = ?' : ''} ORDER BY o.delivered_at DESC LIMIT 200`,
    [...gp, ...(own(req) ? [own(req)] : [])]);
    return rows.map((r) => ({ ...r, days: Number(r.days) }));
  }, G);
  // Inspection: what is on the Returned shelf, the returns to inspect and those whose decision waits
  route('get', '/sales/returns/inspection', 'returns:view', async (req) => {
    const [gw, gp] = scope(req, 'm.location_id');
    const [shelf] = await db.query(`SELECT m.sku_code, m.location_id, g.name AS godown, ${SKU_NAME} AS name, s.size_label, ${IMG} AS image, SUM(m.delta) AS packs
        FROM stock_movements m JOIN skus s ON s.sku_code = m.sku_code ${SKU_JOIN} JOIN locations g ON g.location_id = m.location_id
        WHERE m.stock_kind = 'ret' AND ${gw} GROUP BY m.sku_code, m.location_id, g.name, name, s.size_label, image HAVING packs > 0 ORDER BY g.name, m.sku_code`, gp);
    const [waits] = await db.query("SELECT approval_id, summary, payload FROM approvals WHERE kind = 'restock' AND status = 'pending' ORDER BY approval_id");
    return { shelf: shelf.map((x) => ({ ...x, packs: Number(x.packs) })), on_shelf: shelf.reduce((a, x) => a + Number(x.packs), 0),
      to_inspect: await rowsOf(req, TAB.to_inspect, []), deciding: await rowsOf(req, TAB.deciding, []),
      resell_waiting: waits.map((w) => ({ approval_id: w.approval_id, summary: w.summary })), can: { inspect: canDo(req, 'inventory', 'edit'), decide: canDo(req, 'returns', 'edit') } };
  }, G);

  // ============================================================================================ wallets
  route('get', '/marketing/wallets', 'promotions:view', async (req) => {
    const s = await commerceSettings.read(db); // the wallet has no switch of its own here: it is on with Commerce
    const sc = godowns.viewScope(req);
    const [gw, gp] = godowns.where('c.godown_id', sc);
    const [custs] = await db.query(`SELECT c.customer_id, c.customer_no, c.name, c.type_key, c.godown_id FROM customers c WHERE c.status <> 'merged' AND (${gw} OR c.godown_id IS NULL)${own(req) ? ' AND c.owner_emp_id = ?' : ''}
        AND (EXISTS (SELECT 1 FROM wallet_entries w WHERE w.customer_id = c.customer_id) OR EXISTS (SELECT 1 FROM orders o WHERE o.customer_id = c.customer_id AND o.status = 'delivered' AND o.cashback_amount IS NULL))
        ORDER BY c.name`, [...gp, ...(own(req) ? [own(req)] : [])]);
    const today = pricing.istToday();
    const in30 = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 864e5).toISOString().slice(0, 10);
    const rows = [];
    for (const c of custs) {
      const bal = await wallet.balance(db, c.customer_id);
      const [[exp]] = await db.query('SELECT COALESCE(SUM(remaining), 0) AS n, MIN(expires_on) AS first FROM wallet_entries WHERE customer_id = ? AND remaining > 0.005 AND expires_on IS NOT NULL AND expires_on <= ?', [c.customer_id, in30]);
      // pending: delivered orders whose cashback is not worked out yet (the return window still runs), at today's rule
      const [pend] = await db.query(`SELECT o.order_id, o.order_no, DATE_FORMAT(CONVERT_TZ(o.delivered_at, '+00:00', '+05:30'), '%Y-%m-%d') AS d FROM orders o
          WHERE o.customer_id = ? AND o.status = 'delivered' AND o.cashback_amount IS NULL`, [c.customer_id]);
      let pending = 0;
      for (const o of pend) {
        const rule = await promotions.cashbackRule(db, c.type_key, o.d);
        const base = await promotions.goodsValue(db, o.order_id);
        if (rule && base >= Number(rule.min_order)) { let a = r2(base * (Number(rule.pct) / 100)); if (rule.max_per_order !== null) a = Math.min(a, Number(rule.max_per_order)); pending = r2(pending + a); }
      }
      // kept: taken from the wallet by orders still open (given back if they are cancelled)
      const [[kept]] = await db.query("SELECT COALESCE(SUM(wallet_used), 0) AS n FROM orders WHERE customer_id = ? AND status IN ('draft', 'approval', 'new', 'packing', 'packed')", [c.customer_id]);
      rows.push({ customer_id: c.customer_id, customer_no: c.customer_no, name: c.name, usable: r2(bal), pending, expiring: r2(exp.n), first_expiry: exp.first ? new Date(exp.first).toISOString().slice(0, 10) : null, kept: r2(kept.n) });
    }
    const tot = (k) => r2(rows.reduce((a, x) => a + x[k], 0));
    return { max_use_pct: Number(s.wallet_max_use_pct) || 0, rows,
      totals: { usable: tot('usable'), pending: tot('pending'), expiring: tot('expiring'), kept: tot('kept') },
      can: { manual: canDo(req, 'promotions', 'create') && !own(req) } };
  }, G);
  void InputError;
}

module.exports = { register, TAB, TAB_LABEL };
