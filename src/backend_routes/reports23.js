// Reports, the v23 pages (phase 23, v23 "SECTION 16 REPORTS AND DASHBOARD"): Sales and purchases, Stock, Money owed,
// GST and delivery. Each page answers { stats, tabs, tab, table: { title, cols, rows, foot }, chart, notes }; a table is
// also its CSV (Export right on Reports). Rules (v23):
// - A sale is the invoiced value without GST, less credit notes (reports.salesFacts); margin only where the average
//   cost is known ("cost not set" otherwise) and only for See cost ("hidden (See cost)" otherwise, never Rs 0).
// - Every figure follows the period, the godown filter and the person's godowns (RP2); "Own customers only" sees its
//   own customers.
// - Stock: value by godown and shelf, every shelf we own (Good, packed not invoiced, QC hold, Damaged, Returned,
//   Rejected, Disputed, on the road, issued to a running production run; v23 Y9), at the average cost; packs with no cost
//   are counted, not valued. Without See cost every money figure on the stock page is "hidden" (RP1).
// - Money owed: customers by days overdue (as phase 22), suppliers (MSME 45 days), collections by month.
const reports = require('./reports');
const billing = require('./billing');
const expenses = require('./expenses');
const { inScope } = require('./scope-sql');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const istDates = require('../shared/istDate'); // India dates in one place (src/shared/istDate.js)
const today = () => istDates.istToday();
const IST_TODAY = istDates.IST_TODAY_SQL; // never CURDATE(): the session is UTC
const monthName = (m) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const fyStart = (d) => { const y = Number(d.slice(0, 4)); const m = Number(d.slice(5, 7)); return `${m >= 4 ? y : y - 1}-04-01`; };
const monthEnd = (m) => istDates.lastDayOf(m);
const prevMonth = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
const PERIODS = { month: 'This month', last: 'Last month', quarter: 'This quarter', year: 'This year (from April)', custom: 'Choose dates' };
/** the v23 period -> [from, to] */
function period(per, from, to) {
  const t = today(); const m = t.slice(0, 7);
  if (per === 'last') { const pm = prevMonth(m); return [`${pm}-01`, monthEnd(pm)]; }
  if (per === 'quarter') { const fs = fyStart(t); const mm = Number(m.slice(5, 7)); const qi = Math.floor(((mm + 8) % 12) / 3); return [new Date(Date.UTC(Number(fs.slice(0, 4)), 3 + qi * 3, 1)).toISOString().slice(0, 10), t]; }
  if (per === 'year') return [fyStart(t), t];
  if (per === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(from || '') && /^\d{4}-\d{2}-\d{2}$/.test(to || '')) return [from, to < from ? from : to];
  return [`${m}-01`, t];
}
const col = (label, type = 'text') => ({ label, type }); // type: text | num | money | cost (money hidden without See cost)

async function skuMap(q) {
  const [rows] = await q.query(`SELECT s.sku_code, COALESCE(t.name, pt.name, s.product_id) AS name, s.size_label, p.category_key, COALESCE(ct.name, p.category_key) AS category_name, s.avg_cost, s.sku_type FROM skus s
      JOIN products p ON p.product_id = s.product_id LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
      LEFT JOIN category_translations ct ON ct.category_key = p.category_key AND ct.lang_code = 'en'
      LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'`);
  return new Map(rows.map((r) => [r.sku_code, { ...r, avg_cost: r.avg_cost === null ? null : Number(r.avg_cost) }]));
}
async function godownNames(q) { const [g] = await q.query('SELECT location_id, name FROM locations'); return new Map(g.map((x) => [Number(x.location_id), x.name])); }

/** the sale lines of a period (invoices, credit and debit notes), with their godown, cost where known */
async function saleLines(q, ctx) {
  const facts = (await reports.salesFacts(q, { from: ctx.from, to: ctx.to, scope: ctx.scope })).filter((r) => !['(round off)', '(delivery)'].includes(r.sku_code));
  const own = ctx.ownOnly ? ctx.empId : null;
  const ids = [...new Set(facts.map((r) => r.order_id))];
  const [gs] = ids.length ? await q.query('SELECT order_id, godown_id FROM orders WHERE order_id IN (?)', [ids]) : [[]];
  const gm = new Map(gs.map((x) => [x.order_id, Number(x.godown_id)]));
  const skus = await skuMap(q);
  return facts.filter((r) => !own || r.owner_emp_id === own).map((r) => {
    const s = skus.get(r.sku_code);
    const qty = Number(r.qty) || 0;
    const cost = s && s.avg_cost !== null && qty ? r2(s.avg_cost * qty) : null;
    return { ...r, godown_id: gm.get(r.order_id), qty, val: Number(r.is_free) ? 0 : r.taxable, cost, cn: r.sign < 0, sku: s };
  }).filter((r) => !ctx.godown || r.godown_id === ctx.godown);
}
function groupBy(lines, kf, lf) {
  const m = new Map();
  for (const x of lines) {
    const k = kf(x); if (k === null || k === undefined) continue;
    const g = m.get(k) || { k, label: lf ? lf(k, x) : k, qty: 0, val: 0, cost: 0, costVal: 0, n: 0 };
    g.qty += x.qty; g.val = r2(g.val + x.val); g.n += 1;
    if (x.cost !== null) { g.cost = r2(g.cost + x.cost); g.costVal = r2(g.costVal + x.val); }
    m.set(k, g);
  }
  return [...m.values()];
}
const marginOf = (g, seesCost) => (!seesCost ? null : !g.costVal ? 'cost not set' : r2(g.costVal - g.cost));
const marginText = (g, seesCost) => { const m = marginOf(g, seesCost); if (m === null) return 'hidden (See cost)'; if (typeof m === 'string') return m; return `Rs ${m.toFixed(2)} (${Math.round((m / g.costVal) * 1000) / 10}%)`; };

/** orders confirmed and not invoiced yet */
async function ordersInHand(q, ctx) {
  const [rows] = await q.query(`SELECT COALESCE(SUM(GREATEST(0, i.qty) * i.price - i.offer_discount), 0) AS v FROM orders o JOIN order_items i ON i.order_id = o.order_id JOIN customers c ON c.customer_id = o.customer_id
      WHERE o.status IN ('new', 'packing', 'packed') AND i.is_free = 0 AND NOT EXISTS (SELECT 1 FROM invoices v WHERE v.live_order_id = o.order_id AND v.status = 'issued')
      AND ${inScope('o.godown_id', ctx.scope)}${ctx.godown ? ' AND o.godown_id = ?' : ''}${ctx.ownOnly ? ' AND c.owner_emp_id = ?' : ''}`, [...(ctx.godown ? [ctx.godown] : []), ...(ctx.ownOnly ? [ctx.empId] : [])]);
  return r2(rows[0].v);
}

// ============================================================================================ Sales and purchases
const SALES_TABS = { time: 'By day or month', product: 'By product', category: 'By category', customer: 'By customer', type: 'By customer type', owner: 'By salesperson', godown: 'By godown',
  purchases: 'Purchases', discounts: 'Discounts given', returns: 'Returns', profit: 'Expenses and profit' };
async function salesPage(q, ctx) {
  const L = await saleLines(q, ctx);
  const tot = r2(L.reduce((a, x) => a + x.val, 0));
  const cnTot = r2(-L.filter((x) => x.cn).reduce((a, x) => a + x.val, 0));
  const all = groupBy(L, () => 'all')[0];
  const gn = await godownNames(q);
  const tab = SALES_TABS[ctx.tab] ? ctx.tab : 'time';
  const out = { stats: { sales: tot, invoices: new Set(L.filter((x) => !x.cn).map((x) => x.doc)).size, credit_notes: cnTot, in_hand: await ordersInHand(q, ctx), margin: all ? marginText(all, ctx.seesCost) : '-' },
    tabs: SALES_TABS, tab, notes: [], chart: null };
  const gt = (kf, lf, label, sort) => {
    const g = groupBy(L, kf, lf).sort(sort || ((a, b) => b.val - a.val));
    out.chart = g.slice(0, 10).map((x) => ({ l: x.label, v: x.val }));
    out.table = { title: label, cols: [col(label), col('Packs', 'num'), col('Sales', 'money'), col('Margin')], rows: g.map((x) => [x.label, x.qty, x.val, marginText(x, ctx.seesCost)]),
      foot: ['Total', g.reduce((a, x) => a + x.qty, 0), tot, ''] };
  };
  const long = (Date.parse(ctx.to) - Date.parse(ctx.from)) / 864e5 > 31;
  if (tab === 'time') gt((x) => (long ? x.day.slice(0, 7) : x.day), (k) => (long ? monthName(k) : k), long ? 'Month' : 'Day', (a, b) => (a.k < b.k ? -1 : 1));
  if (tab === 'product') gt((x) => (x.sku_code === '(price)' || x.sku_code === '(debit note)' ? null : x.sku_code), (k, x) => (x.sku ? `${x.sku.name} (${k})` : k), 'Product');
  if (tab === 'category') gt((x) => (x.sku ? x.sku.category_name || 'Other' : 'Price corrections'), (k) => k, 'Category');
  if (tab === 'customer') gt((x) => x.customer_id, (k, x) => x.customer, 'Customer');
  if (tab === 'type') gt((x) => x.type_key, (k, x) => x.type_label, 'Customer type');
  if (tab === 'owner') gt((x) => x.owner_emp_id || '-', (k) => (k === '-' ? 'Nobody' : k), 'Salesperson');
  if (tab === 'godown') gt((x) => x.godown_id, (k) => gn.get(k) || String(k), 'Godown');
  if (tab === 'purchases') {
    if (!ctx.canBuying) { out.blocked = 'Purchases need View on Suppliers and buying.'; return out; }
    const [rows] = await q.query(`SELECT s.name AS supplier, l.sku_code, SUM(l.qty) AS qty, SUM(l.qty * l.rate) AS val, GROUP_CONCAT(DISTINCT b.bill_no ORDER BY b.bill_no SEPARATOR ', ') AS bills
        FROM supplier_bills b JOIN supplier_bill_lines l ON l.bill_id = b.bill_id JOIN suppliers s ON s.supplier_id = b.supplier_id
        WHERE b.status IN ('unpaid', 'part', 'paid') AND b.bill_date BETWEEN ? AND ? AND ${inScope('b.godown_id', ctx.scope)}${ctx.godown ? ' AND b.godown_id = ?' : ''}
        GROUP BY s.name, l.sku_code ORDER BY val DESC`, [ctx.from, ctx.to, ...(ctx.godown ? [ctx.godown] : [])]);
    const skus = await skuMap(q);
    const bySup = new Map(); rows.forEach((r) => bySup.set(r.supplier, r2((bySup.get(r.supplier) || 0) + Number(r.val))));
    out.chart = [...bySup.entries()].sort((a, b) => b[1] - a[1]).map(([l, v]) => ({ l, v }));
    out.table = { title: 'Purchases', cols: [col('Supplier'), col('Item'), col('Quantity', 'num'), col('Value without GST', 'money'), col('Bills')],
      rows: rows.map((r) => [r.supplier, `${(skus.get(r.sku_code) || {}).name || r.sku_code} (${r.sku_code})`, r2(r.qty), r2(r.val), r.bills]), foot: ['Total', '', '', r2(rows.reduce((a, r) => a + Number(r.val), 0)), ''] };
  }
  if (tab === 'discounts') {
    const [rows] = await q.query(`SELECT o.order_no, o.offer_discount, o.discount, o.coupon_code, o.manual_discount, o.wallet_used, o.wallet_discount,
        (SELECT COALESCE(SUM(i.qty * COALESCE(i.list_price, i.price)), 0) FROM order_items i WHERE i.order_id = o.order_id AND i.is_free = 1) AS free_value
        FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.status NOT IN ('draft', 'cancelled') AND ${'DATE(CONVERT_TZ(o.created_at, \'+00:00\', \'+05:30\'))'} BETWEEN ? AND ?
        AND ${inScope('o.godown_id', ctx.scope)}${ctx.godown ? ' AND o.godown_id = ?' : ''}${ctx.ownOnly ? ' AND c.owner_emp_id = ?' : ''}`, [ctx.from, ctx.to, ...(ctx.godown ? [ctx.godown] : []), ...(ctx.ownOnly ? [ctx.empId] : [])]).catch(() => [[]]);
    const G = new Map(); const add = (k, v, no) => { if (!(Number(v) > 0.004)) return; const g = G.get(k) || { v: 0, n: new Set() }; g.v = r2(g.v + Number(v)); g.n.add(no); G.set(k, g); };
    for (const o of rows) { add('Offers', o.offer_discount, o.order_no); if (o.coupon_code) add(`Coupon ${o.coupon_code}`, o.discount, o.order_no); add('Manual discounts', o.manual_discount, o.order_no); add('Wallet used', o.wallet_used, o.order_no); add('Free items', o.free_value, o.order_no); }
    const g = [...G.entries()].sort((a, b) => b[1].v - a[1].v);
    out.chart = g.map(([l, x]) => ({ l, v: x.v }));
    out.table = { title: 'Discounts given', cols: [col('What'), col('Orders', 'num'), col('Given without GST', 'money')], rows: g.map(([l, x]) => [l, x.n.size, x.v]), foot: ['Total', '', r2(g.reduce((a, [, x]) => a + x.v, 0))] };
  }
  if (tab === 'returns') {
    const R = L.filter((x) => x.cn && x.sku);
    const rv = r2(-R.reduce((a, x) => a + x.val, 0));
    out.notes.push(`Returns Rs ${rv.toFixed(2)}${tot > 0 ? ` = ${Math.round((rv / (tot + rv)) * 1000) / 10}% of sales` : ''} in the period, at the price paid, without GST.`);
    out.table = { title: 'Returns', cols: [col('Credit note'), col('Customer'), col('Item'), col('Packs', 'num'), col('Value', 'money')],
      rows: R.map((x) => [x.doc, x.customer, `${x.sku.name} (${x.sku_code})`, -x.qty, -x.val]), foot: ['Total', '', '', -R.reduce((a, x) => a + x.qty, 0), rv] };
  }
  if (tab === 'profit') {
    if (!ctx.seesCost) { out.blocked = 'Cost is hidden: profit needs the cost of what was sold. Your role does not have See cost.'; return out; }
    if (!ctx.canExpenses) { out.blocked = 'Expenses need View on Expenses and accounting export.'; return out; }
    const [ex] = await q.query(`SELECT e.head_key, h.name AS head, COUNT(*) AS n, SUM(IF(e.itc = 1, e.amount, e.total)) AS v FROM expenses e JOIN expense_heads h ON h.head_key = e.head_key
        WHERE e.status = 'done' AND e.exp_date BETWEEN ? AND ? AND h.for_po = 0 AND ${inScope('e.godown_id', ctx.scope)}${ctx.godown ? ' AND e.godown_id = ?' : ''} GROUP BY e.head_key, h.name ORDER BY v DESC`,
    [ctx.from, ctx.to, ...(ctx.godown ? [ctx.godown] : [])]);
    const exT = r2(ex.reduce((a, x) => a + Number(x.v), 0));
    const cost = all ? all.cost : 0; const unk = all ? r2(all.val - all.costVal) : 0;
    out.profit = { sales: tot, cost, expenses: exT, profit: r2(tot - cost - exT), no_cost_sales: unk };
    out.notes.push(`Profit before tax: Rs ${r2(tot - cost - exT).toFixed(2)}. Sales Rs ${tot.toFixed(2)} less cost Rs ${cost.toFixed(2)} less expenses Rs ${exT.toFixed(2)}.${unk > 0 ? ` Rs ${unk.toFixed(2)} of sales has no cost set yet, so the real profit is lower.` : ''} GST that can be claimed is not an expense; freight in on a purchase is in the stock cost.`);
    out.chart = ex.map((x) => ({ l: x.head, v: r2(x.v) }));
    out.table = { title: 'Expenses', cols: [col('Head'), col('Entries', 'num'), col('Amount', 'money')], rows: ex.map((x) => [x.head, Number(x.n), r2(x.v)]), foot: ['Total', ex.reduce((a, x) => a + Number(x.n), 0), exT] };
  }
  return out;
}

// ============================================================================================ Stock
const STOCK_TABS = { value: 'Value', ageing: 'Ageing', expiry: 'Expiry', slow: 'Slow movers', losses: 'Write-offs and wastage' };
// the column heads of Stock value by shelf are v23's short ones (COLS); the category table uses SHELF
const SHELF_COL = { good: 'Good', packed: 'Packed', road: 'On the road', hold: 'QC hold', dmg: 'Damaged', ret: 'Returned', rej: 'Rejected', disp: 'Disputed', wip: 'In production' };
const SHELF = { good: 'Good', packed: 'Packed, not invoiced', road: 'On the road', hold: 'QC hold', dmg: 'Damaged', ret: 'Returned', rej: 'Rejected, to go back', disp: 'Disputed', wip: 'In production' };
async function stockRows(q, ctx) {
  const skus = await skuMap(q);
  const gw = (c) => `${inScope(c, ctx.scope)}${ctx.godown ? ` AND ${c} = ${Number(ctx.godown)}` : ''}`;
  const [kinds] = await q.query(`SELECT location_id AS g, stock_kind AS shelf, sku_code, SUM(delta) AS qty FROM stock_movements WHERE ${gw('location_id')} GROUP BY location_id, stock_kind, sku_code HAVING qty > 0.0001`);
  // packed for an order, not invoiced yet: off the shelf, still ours (v21)
  const [packed] = await q.query(`SELECT o.godown_id AS g, 'packed' AS shelf, m.sku_code, -SUM(m.delta) AS qty FROM stock_movements m JOIN orders o ON o.order_no = m.ref_id
      WHERE m.ref_type = 'order' AND m.move_type = 'out' AND o.status = 'packed' AND NOT EXISTS (SELECT 1 FROM invoices v WHERE v.live_order_id = o.order_id AND v.status = 'issued') AND ${gw('o.godown_id')}
      GROUP BY o.godown_id, m.sku_code HAVING qty > 0`).catch(() => [[]]);
  // material issued to a production run still running (v23 Y9)
  const [wip] = await q.query(`SELECT r.godown_id AS g, 'wip' AS shelf, m.sku_code, -SUM(m.delta) AS qty FROM stock_movements m JOIN production_runs r ON r.run_no = m.ref_id
      WHERE m.move_type = 'prod_issue' AND r.status NOT IN ('done', 'cancelled') AND ${gw('r.godown_id')} GROUP BY r.godown_id, m.sku_code HAVING qty > 0`).catch(() => [[]]);
  return [...kinds, ...packed, ...wip].map((x) => {
    const s = skus.get(x.sku_code); const u = s ? s.avg_cost : null; const qty = Number(x.qty);
    return { g: Number(x.g), shelf: x.shelf, sku_code: x.sku_code, s, qty, val: u === null ? null : r2(u * qty), cat: s ? (s.sku_type === 'raw' ? 'Raw materials' : s.category_name || 'No category') : 'Unknown pack' };
  });
}
async function stockPage(q, ctx) {
  const R = await stockRows(q, ctx);
  const gn = await godownNames(q);
  const tab = STOCK_TABS[ctx.tab] ? ctx.tab : (ctx.seesCost ? 'value' : 'ageing');
  const known = r2(R.reduce((a, r) => a + (r.val || 0), 0)); const unk = R.filter((r) => r.val === null).reduce((a, r) => a + r.qty, 0);
  const [[ex]] = await q.query(`SELECT COALESCE(SUM(IF(b.expiry_date < ${IST_TODAY}, m.delta, 0)), 0) AS expired, COALESCE(SUM(IF(b.expiry_date >= ${IST_TODAY} AND b.expiry_date <= ${IST_TODAY} + INTERVAL 60 DAY, m.delta, 0)), 0) AS near
      FROM stock_movements m JOIN batches b ON b.batch_id = m.batch_id WHERE m.stock_kind = 'good' AND ${inScope('m.location_id', ctx.scope)}`);
  const out = { stats: { value: ctx.seesCost ? known : null, no_cost: r2(unk), near: Number(ex.near), expired: Number(ex.expired) }, tabs: STOCK_TABS, tab, notes: [], chart: null, costHidden: !ctx.seesCost };
  if (tab === 'value') {
    if (!ctx.seesCost) { out.blocked = 'Cost is hidden: stock value is at cost. Your role does not have See cost; Ageing, Expiry and Slow movers show the packs.'; return out; }
    const by = new Map(); for (const r of R) { const b = by.get(r.g) || {}; b[r.shelf] = r2((b[r.shelf] || 0) + (r.val || 0)); by.set(r.g, b); }
    const shelves = Object.keys(SHELF);
    out.table = { title: 'Stock value by shelf', cols: [col('Godown'), ...shelves.map((k) => col(SHELF_COL[k], 'cost')), col('Total', 'cost')],
      rows: [...by.entries()].map(([g, b]) => [gn.get(g) || g, ...shelves.map((k) => b[k] || 0), r2(shelves.reduce((a, k) => a + (b[k] || 0), 0))]) };
    const cats = new Map(); for (const r of R) { const k = `${r.g}|${r.shelf === 'good' ? r.cat : SHELF[r.shelf] || r.shelf}`; const c = cats.get(k) || { g: r.g, cat: r.shelf === 'good' ? r.cat : SHELF[r.shelf] || r.shelf, packs: 0, val: 0, unk: 0 }; c.packs += r.qty; if (r.val === null) c.unk += r.qty; else c.val = r2(c.val + r.val); cats.set(k, c); }
    const cr = [...cats.values()].sort((a, b) => b.val - a.val);
    out.table2 = { title: 'Stock value', cols: [col('Godown'), col('Category'), col('Packs or units', 'num'), col('Value at cost', 'cost'), col('Without a cost', 'num')],
      rows: cr.map((c) => [gn.get(c.g) || c.g, c.cat, r2(c.packs), c.val, r2(c.unk)]), foot: ['Total', '', r2(cr.reduce((a, c) => a + c.packs, 0)), known, r2(unk)] };
    out.chart = cr.slice(0, 10).map((c) => ({ l: `${gn.get(c.g) || c.g} ${c.cat}`, v: c.val }));
  }
  if (tab === 'ageing') {
    const [rows] = await q.query(`SELECT m.sku_code, DATEDIFF(${IST_TODAY}, b.mfg_date) AS age, SUM(m.delta) AS qty FROM stock_movements m LEFT JOIN batches b ON b.batch_id = m.batch_id
        WHERE m.stock_kind = 'good' AND ${inScope('m.location_id', ctx.scope)}${ctx.godown ? ` AND m.location_id = ${Number(ctx.godown)}` : ''} GROUP BY m.sku_code, age HAVING qty > 0.0001`);
    const skus = await skuMap(q);
    const B = [['0-30 days', 0, 30], ['31-60 days', 31, 60], ['61-90 days', 61, 90], ['Over 90 days', 91, 1e9]];
    const o = [...B.map((b) => ({ l: b[0], packs: 0, val: 0 })), { l: 'Date not known (opening stock)', packs: 0, val: 0 }];
    for (const r of rows) { const a = r.age === null ? null : Number(r.age); const i = a === null ? 4 : B.findIndex((b) => a >= b[1] && a <= b[2]); const s = skus.get(r.sku_code); o[i].packs += Number(r.qty); if (s && s.avg_cost !== null) o[i].val = r2(o[i].val + s.avg_cost * Number(r.qty)); }
    out.chart = ctx.seesCost ? o.map((x) => ({ l: x.l, v: x.val })) : null;
    out.table = { title: 'Stock ageing', cols: [col('Age (from making)'), col('Packs or units', 'num'), col('Value at cost', 'cost')], rows: o.map((x) => [x.l, r2(x.packs), x.val]) };
  }
  if (tab === 'expiry') {
    const [rows] = await q.query(`SELECT m.sku_code, m.location_id AS g, b.batch_no, DATE_FORMAT(b.expiry_date, '%Y-%m-%d') AS exp, SUM(m.delta) AS qty, b.expiry_date < ${IST_TODAY} AS expired FROM stock_movements m JOIN batches b ON b.batch_id = m.batch_id
        WHERE m.stock_kind = 'good' AND b.expiry_date <= ${IST_TODAY} + INTERVAL 60 DAY AND ${inScope('m.location_id', ctx.scope)}${ctx.godown ? ` AND m.location_id = ${Number(ctx.godown)}` : ''}
        GROUP BY m.sku_code, m.location_id, b.batch_no, b.expiry_date HAVING qty > 0 ORDER BY b.expiry_date`);
    const skus = await skuMap(q);
    out.table = { title: 'Expiry', cols: [col('Pack'), col('Godown'), col('Batch'), col('Expires'), col('Packs', 'num'), col('State')],
      rows: rows.map((r) => [`${(skus.get(r.sku_code) || {}).name || r.sku_code} (${r.sku_code})`, gn.get(Number(r.g)) || r.g, r.batch_no, r.exp, Number(r.qty), Number(r.expired) ? 'Expired' : 'Near']) };
  }
  if (tab === 'slow') {
    const s = await reports.stockReport(q, { view: 'slow', scope: ctx.scope }, { seesCost: ctx.seesCost });
    const t = s.tables[0];
    out.table = { title: t.title, cols: [col('Pack'), col('In stock', 'num'), col('Last sale'), col('Days since', 'num')], rows: t.rows.map((r) => [`${r.name} (${r.sku_code})`, r.qty, r.last_sale, r.since]) };
    out.notes.push(...s.notes);
  }
  if (tab === 'losses') {
    const [wo] = await q.query(`SELECT DATE_FORMAT(CONVERT_TZ(COALESCE(posted_at, created_at), '+00:00', '+05:30'), '%Y-%m') AS m, SUM(qty) AS qty, SUM(COALESCE(value, 0)) AS v FROM write_offs
        WHERE status = 'posted' AND kind = 'write_off' AND ${inScope('godown_id', ctx.scope)} AND DATE(CONVERT_TZ(COALESCE(posted_at, created_at), '+00:00', '+05:30')) BETWEEN ? AND ? GROUP BY m`, [ctx.from, ctx.to]).catch(() => [[]]);
    const [sc] = await q.query(`SELECT DATE_FORMAT(run_date, '%Y-%m') AS m, SUM(COALESCE(rej_normal, 0) + COALESCE(rej_abnormal, 0)) AS qty, SUM(COALESCE(wo_normal, 0) + COALESCE(wo_abnormal, 0)) AS v FROM production_runs
        WHERE status = 'done' AND ${inScope('godown_id', ctx.scope)} AND run_date BETWEEN ? AND ? GROUP BY m`, [ctx.from, ctx.to]).catch(() => [[]]);
    const ks = [...new Set([...wo.map((x) => x.m), ...sc.map((x) => x.m)])].sort();
    const W = (m) => wo.find((x) => x.m === m) || {}; const S = (m) => sc.find((x) => x.m === m) || {};
    out.chart = ctx.seesCost ? ks.map((m) => ({ l: monthName(m), v: r2(Number(W(m).v || 0) + Number(S(m).v || 0)) })) : null;
    out.table = { title: 'Write-offs and wastage', cols: [col('Month'), col('Written off', 'num'), col('Write-off value', 'cost'), col('Production scrap (packs)', 'num'), col('Scrap value', 'cost')],
      rows: ks.map((m) => [monthName(m), Number(W(m).qty || 0), r2(W(m).v || 0), Number(S(m).qty || 0), r2(S(m).v || 0)]) };
  }
  return out;
}

// ============================================================================================ Money owed
const MONEY_TABS = { customers: 'Customers', suppliers: 'Suppliers', collections: 'Collections' };
async function moneyPage(q, ctx) {
  const tab = MONEY_TABS[ctx.tab] ? ctx.tab : 'customers';
  const out = { tabs: MONEY_TABS, tab, notes: [], chart: null, stats: {} };
  if (tab === 'customers') {
    const rec = await reports.receivables(q, { scope: ctx.godown ? [ctx.godown] : ctx.scope, from: ctx.from, to: ctx.to });
    const t = rec.tables.find((x) => x.key === 'ageing') || rec.tables[0];
    const own = ctx.ownOnly ? new Set((await q.query('SELECT CONCAT(customer_no, \' \', name) AS k FROM customers WHERE owner_emp_id = ?', [ctx.empId]))[0].map((x) => x.k)) : null;
    const K = ['not_due', 'd1_30', 'd31_60', 'd61_90', 'd90'];
    const owes = (r) => r2(K.reduce((a, k) => a + (Number(r[k]) || 0), 0));
    // v23: only customers with a balance, the largest first, by name (the ledger report's "CUS-0007 Name" loses its number)
    const rows = t.rows.filter((r) => (!own || own.has(r.customer)) && Math.abs(owes(r)) > 0.004).sort((a, b) => owes(b) - owes(a));
    const tt = K.map((k) => r2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)));
    out.chart = [['Not due', tt[0]], ['1-30', tt[1]], ['31-60', tt[2]], ['61-90', tt[3]], ['Over 90', tt[4]]].map(([l, v]) => ({ l, v }));
    out.table = { title: 'Customer ageing (days overdue)', cols: [col('Customer'), col('Not due', 'money'), col('1-30 days', 'money'), col('31-60', 'money'), col('61-90', 'money'), col('Over 90', 'money'), col('Owes', 'money')],
      rows: rows.map((r) => [String(r.customer).replace(/^[A-Z]+-\d+\s+/, ''), ...K.map((k) => r2(r[k] || 0)), owes(r)]), foot: ['Total', ...tt, r2(tt.reduce((a, v) => a + v, 0))] };
    out.stats.owed = r2(tt.reduce((a, v) => a + v, 0)); out.stats.overdue = r2(tt.slice(1).reduce((a, v) => a + v, 0));
  }
  if (tab === 'suppliers') {
    const [rows] = await q.query(`SELECT b.bill_no, b.supplier_bill_no, s.name, s.msme_type, DATE_FORMAT(b.bill_date, '%Y-%m-%d') AS bill_date, DATE_FORMAT(b.due_date, '%Y-%m-%d') AS due, b.total - b.paid AS left_amt,
        DATEDIFF(${IST_TODAY}, b.due_date) AS late, DATEDIFF(${IST_TODAY}, b.bill_date) AS age FROM supplier_bills b JOIN suppliers s ON s.supplier_id = b.supplier_id
        WHERE b.status IN ('unpaid', 'part') AND b.total - b.paid > 0.004 AND ${inScope('b.godown_id', ctx.scope)}${ctx.godown ? ` AND b.godown_id = ${Number(ctx.godown)}` : ''} ORDER BY late DESC`);
    const msme = rows.filter((r) => r.msme_type && ['micro', 'small'].includes(String(r.msme_type).toLowerCase()) && Number(r.age) > 45);
    if (msme.length) out.notes.push(`MSME 45 days passed: ${msme.map((r) => `${r.bill_no} ${r.name} (${r.age} days)`).join(', ')}. Interest is due by law.`);
    out.table = { title: 'Supplier ageing', cols: [col('Bill'), col('Supplier'), col('Bill date'), col('Due'), col('Days late', 'num'), col('MSME'), col('We owe', 'money')],
      rows: rows.map((r) => [`${r.bill_no}${r.supplier_bill_no ? ` (${r.supplier_bill_no})` : ''}`, r.name, r.bill_date, r.due, Math.max(0, Number(r.late)), r.msme_type ? `${r.msme_type}, day ${r.age}` : '', r2(r.left_amt)]),
      foot: ['Total', '', '', '', '', '', r2(rows.reduce((a, r) => a + Number(r.left_amt), 0))] };
  }
  if (tab === 'collections') {
    const [rows] = await q.query(`SELECT DATE_FORMAT(r.received_on, '%Y-%m') AS m, COUNT(*) AS n, SUM(r.amount) AS v, SUM(IF(r.status = 'bounced', 1, 0)) AS bn, SUM(IF(r.status = 'bounced', r.amount, 0)) AS bv
        FROM receipts r JOIN customers c ON c.customer_id = r.customer_id WHERE r.received_on BETWEEN ? AND ? AND ${inScope('c.godown_id', ctx.scope)}${ctx.godown ? ` AND c.godown_id = ${Number(ctx.godown)}` : ''}${ctx.ownOnly ? ' AND c.owner_emp_id = ?' : ''}
        GROUP BY m ORDER BY m`, [ctx.from, ctx.to, ...(ctx.ownOnly ? [ctx.empId] : [])]);
    out.chart = rows.map((r) => ({ l: monthName(r.m), v: r2(Number(r.v) - Number(r.bv)) }));
    out.table = { title: 'Collections by month', cols: [col('Month'), col('Receipts', 'num'), col('Received', 'money'), col('Cheques bounced', 'num'), col('Bounced', 'money')],
      rows: rows.map((r) => [monthName(r.m), Number(r.n), r2(Number(r.v) - Number(r.bv)), Number(r.bn), r2(r.bv)]) };
  }
  return out;
}

// ============================================================================================ GST and delivery
const GST_TABS = { gst: 'GST by month', delivery: 'Delivery' };
async function gstPage(q, ctx) {
  const tab = GST_TABS[ctx.tab] ? ctx.tab : 'gst';
  const out = { tabs: GST_TABS, tab, notes: [], chart: null, stats: {} };
  if (tab === 'gst') {
    const months = []; let m = today().slice(0, 7); const stop = fyStart(today()).slice(0, 7);
    while (m >= stop) { months.push(m); m = prevMonth(m); }
    const rows = []; const exp = [];
    for (const mm of months) {
      const g = await billing.gstr3b(q, mm, ctx.godown ? [ctx.godown] : ctx.scope);
      rows.push([monthName(mm), g.output.taxable, g.output.tax, g.input.tax, r2(g.output.tax - g.input.tax)]);
      exp.push(r2(g.input.expense_tax || 0));
    }
    // v23's five columns; the claimable GST on expenses inside Input GST is in input_expense (same order as the rows)
    out.table = { title: 'GST by month', cols: [col('Month'), col('Sales without GST', 'money'), col('Output GST', 'money'), col('Input GST (bills)', 'money'), col('Net payable', 'money')], rows };
    out.input_expense = exp;
    out.chart = rows.slice().reverse().map((r) => ({ l: r[0], v: r[4] }));
    out.hint = "Net payable before credit carried forward and before the CA's adjustments. Input GST includes the GST on expenses that can be claimed: each expense and the month's total are on Money > GST > GSTR-1 / GSTR-3B data (ITC on expenses), with the figures by rate.";
  }
  if (tab === 'delivery') {
    const d = await reports.deliveryReport(q, { from: ctx.from, to: ctx.to, scope: ctx.godown ? [ctx.godown] : ctx.scope });
    const t = d.tables[0];
    out.table = { title: t.title, cols: t.columns.map((c) => col(c.label, c.type === 'money' ? 'money' : c.type === 'num' ? 'num' : 'text')), rows: t.rows.map((r) => t.columns.map((c) => r[c.key])) };
    out.notes.push(...(d.notes || []));
    out.extra = d.tables.slice(1).map((x) => ({ title: x.title, cols: x.columns.map((c) => col(c.label, c.type === 'money' ? 'money' : c.type === 'num' ? 'num' : 'text')), rows: x.rows.map((r) => x.columns.map((c) => r[c.key])) }));
  }
  return out;
}

const PAGES = { sales: salesPage, stock: stockPage, money: moneyPage, gst: gstPage };
/** hide every cost cell for a person without See cost (never Rs 0, v23 RP1) */
function mask(out, seesCost) {
  if (seesCost) return out;
  for (const t of [out.table, out.table2, ...(out.extra || [])].filter(Boolean)) {
    const idx = t.cols.map((c, i) => (c.type === 'cost' ? i : -1)).filter((i) => i >= 0);
    t.rows = t.rows.map((r) => r.map((v, i) => (idx.includes(i) ? null : v)));
    if (t.foot) t.foot = t.foot.map((v, i) => (idx.includes(i) ? null : v));
    t.hidden = idx;
  }
  if (out.stats && 'value' in out.stats) out.stats.value = null;
  return out;
}
async function page(q, key, ctx) {
  const [from, to] = period(ctx.per, ctx.from, ctx.to);
  const out = await PAGES[key](q, { ...ctx, from, to });
  return mask({ ...out, from, to, per: PERIODS[ctx.per] ? ctx.per : 'month', periods: PERIODS }, ctx.seesCost);
}
/** a page's table as CSV rows (hidden cells say "hidden") */
function csvRows(out) {
  const t = out.table; if (!t) return [];
  const cell = (v, i) => (t.hidden && t.hidden.includes(i) ? 'hidden' : v === null || v === undefined ? '' : v);
  return [t.cols.map((c) => c.label), ...t.rows.map((r) => r.map(cell)), ...(t.foot ? [t.foot.map(cell)] : [])];
}

/**
 * the v23 dashboard (dashTiles, dashBiz): one tile per section the person may view, every figure in their godowns,
 * cost tiles only with See cost; each tile names the page it opens -> { tiles: [{ key, label, value, sub, icon, tone, to }], top }
 */
// a rupee figure in a tile's line, grouped as the screens show money (Rs 1,02,660.00)
const rsf = (v) => `Rs ${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
async function dashboard(q, ctx, { can, approvalsWaiting }) {
  const t = today(); const m = t.slice(0, 7); const pm = prevMonth(m);
  const tiles = [];
  if (can('reports') || can('invoicing')) {
    const sum = async (from, to) => r2((await saleLines(q, { ...ctx, from, to })).reduce((a, x) => a + x.val, 0));
    const [d, mo, lm] = [await sum(t, t), await sum(`${m}-01`, t), await sum(`${pm}-01`, monthEnd(pm))];
    tiles.push({ key: 'sales', label: 'Sales today', value: d, money: true, sub: `This month ${rsf(mo)} · last month ${rsf(lm)}`, icon: 'trending-up', tone: 'good', to: '/admin/sales-and-purchases' });
  }
  if (can('orders') || can('packing')) {
    const [[o]] = await q.query(`SELECT SUM(o.status IN ('new', 'packing')) AS to_pack, SUM(o.status = 'packed') AS to_send FROM orders o JOIN customers c ON c.customer_id = o.customer_id
        WHERE o.status IN ('new', 'packing', 'packed') AND ${inScope('o.godown_id', ctx.scope)}${ctx.ownOnly ? ' AND c.owner_emp_id = ?' : ''}`, ctx.ownOnly ? [ctx.empId] : []);
    const tp = Number(o.to_pack) || 0; const ts = Number(o.to_send) || 0;
    tiles.push({ key: 'orders', label: 'Orders to send', value: `${tp} to pack · ${ts} to deliver`, sub: `In hand ${rsf(await ordersInHand(q, ctx))}`, icon: 'package', tone: tp + ts ? 'warn' : 'good', to: '/admin/packing' });
  }
  if (can('money')) {
    const mp = await moneyPage(q, { ...ctx, tab: 'customers', from: `${m}-01`, to: t });
    const [[we]] = await q.query(`SELECT COALESCE(SUM(b.total - b.paid), 0) AS n FROM supplier_bills b WHERE b.status IN ('unpaid', 'part') AND ${inScope('b.godown_id', ctx.scope)}`);
    tiles.push({ key: 'money', label: 'Money owed to us', value: mp.stats.owed, money: true, sub: `${rsf(mp.stats.overdue)} overdue · we owe ${rsf(r2(we.n))}`, icon: 'wallet', tone: mp.stats.overdue > 0 ? 'warn' : 'good', to: '/admin/money-owed' });
  }
  if (can('inventory') && ctx.seesCost) {
    const R = await stockRows(q, ctx);
    const known = r2(R.reduce((a, r) => a + (r.val || 0), 0)); const unk = r2(R.filter((r) => r.val === null).reduce((a, r) => a + r.qty, 0));
    tiles.push({ key: 'stock', label: 'Stock at cost', value: known, money: true, sub: unk ? `${unk} packs without a cost yet` : 'All stock has a cost', icon: 'package', tone: 'info', to: '/admin/stock-report' });
  }
  if (can('delivery')) {
    const [[c]] = await q.query(`SELECT COALESCE(SUM(t.cash_expected), 0) AS n FROM delivery_trips t WHERE t.status = 'out' AND ${inScope('t.godown_id', ctx.scope)}`).catch(() => [[{ n: 0 }]]);
    tiles.push({ key: 'cash', label: 'Cash to collect', value: r2(c.n), money: true, sub: 'On trips on the road now', icon: 'truck', tone: 'info', to: '/admin/cash-on-delivery' });
  }
  if (can('products')) {
    const [[p]] = await q.query("SELECT SUM(status = 'active') AS a, COUNT(*) AS n FROM products WHERE variant_of IS NULL").catch(() => [[{ a: 0, n: 0 }]]);
    const [[cat]] = await q.query('SELECT COUNT(*) AS n FROM categories WHERE is_active = 1').catch(() => [[{ n: 0 }]]);
    tiles.push({ key: 'products', label: 'Products on the website', value: `${Number(p.a) || 0} of ${Number(p.n) || 0}`, sub: `${Number(cat.n) || 0} categories shown`, icon: 'package', tone: 'good', to: '/admin/products' });
  }
  tiles.push({ key: 'approvals', label: 'Waiting for you', value: `${approvalsWaiting} approval${approvalsWaiting === 1 ? '' : 's'}`, sub: 'Home > Approvals', icon: 'clipboard-check', tone: approvalsWaiting ? 'gold' : 'good', to: '/admin/approvals' });
  let top = null;
  if (can('reports')) {
    const L = await saleLines(q, { ...ctx, from: `${m}-01`, to: t });
    top = groupBy(L.filter((x) => x.sku), (x) => x.sku_code, (k, x) => x.sku.name).sort((a, b) => b.val - a.val).slice(0, 5).map((g) => ({ label: g.label, qty: g.qty, val: g.val }));
  }
  return { tiles, top };
}

module.exports = { dashboard, PAGES, PERIODS, SALES_TABS, STOCK_TABS, MONEY_TABS, GST_TABS, period, page, csvRows, saleLines, ordersInHand, stockRows, expenses };
