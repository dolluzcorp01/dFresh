// Commerce DEMO seed - ONLY for the database dfresh_commerce (refuses DB_NAME or a connection to anything else).
// Run after a fresh copy of dfresh + every migration (database/migrations, incl. 20261020_commerce_*):
//   node scripts/commerce-demo-seed.js
// 1. the demo screens' interim tables (database/demo/commerce-demo-schema.sql; replaced in phases 3-8)
// 2. SQL demo data (database/demo/commerce-demo-data.sql): SKUs with carton sizes, minimum orders and HSN codes, a week
//    of stock, coupons, cashback rule
// 3. DEMO prices on all 6 lists (Default + 5 customer types) for every SKU, through src/backend_routes/pricing.js:
//    effective 30 days ago, a +5 % change on the toilet rolls 5 days ago and one scheduled for the 1st of next month
// 4. 15 demo customers and 25 orders across all statuses, through src/backend_routes/commerce.js (list prices of the
//    customer's type, coupons, wallet, stock out on dispatch, cashback on delivery), 2 returns, notes and follow-ups
// 5. demo approval requests (pending and decided) and Commerce switched ON
// Migrations never contain any of this (docs/COMMERCE-SPEC.md 9). Running it twice does nothing the second time.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const DB = 'dfresh_commerce';
if (process.env.DB_NAME !== DB) { console.error(`commerce-demo-seed refused: DB_NAME must be ${DB} (it is ${process.env.DB_NAME})`); process.exit(1); }
const { getDBConnection } = require('../config/db');
const commerce = require('../src/backend_routes/commerce');
const approvals = require('../src/backend_routes/approvals');
const pricing = require('../src/backend_routes/pricing');

const db = getDBConnection(DB).promise();
const ROOT = path.join(__dirname, '..');

const CUSTOMERS = [
  ['Demo Hotel Sangam', '9800000001', 'Hotel', 'Kanchipuram', 'Gandhi Road, Kanchipuram', '33AAACD0001A1Z5'],
  ['Demo Cafe Thendral', '9800000002', 'Hotel', 'Chennai', 'Anna Nagar, Chennai', null],
  ['Demo City Hospital', '9800000003', 'Hospital', 'Chengalpattu', 'GST Road, Chengalpattu', '33AAACD0003A1Z1'],
  ['Demo Care Clinic', '9800000004', 'Hospital', 'Kanchipuram', 'Railway Road, Kanchipuram', null],
  ['Demo Tech Park Office', '9800000005', 'Office', 'Chennai', 'OMR, Padur', '33AAACD0005A1Z7'],
  ['Demo Bank Branch', '9800000006', 'Office', 'Sriperumbudur', 'Main Road, Sriperumbudur', null],
  ['Demo Distributor Vellore', '9800000007', 'Distributor', 'Vellore', 'Katpadi Road, Vellore', '33AAACD0007A1Z3'],
  ['Demo Distributor Arakkonam', '9800000008', 'Distributor', 'Arakkonam', 'Bazaar Street, Arakkonam', '33AAACD0008A1Z1'],
  ['Demo Home Priya', '9800000009', 'Home', 'Kanchipuram', 'Vaikunta Perumal Koil St', null],
  ['Demo Home Arun', '9800000010', 'Home', 'Chennai', 'Tambaram West', null],
  ['Demo Home Lakshmi', '9800000011', 'Home', 'Chengalpattu', 'Collectorate Road', null],
  ['Demo Restaurant Anjappar', '9800000012', 'Hotel', 'Chennai', 'Velachery Main Road', null],
  ['Demo School Canteen', '9800000013', 'Office', 'Kanchipuram', 'Collector Office Road', null],
  ['Demo Lodge Kamakshi', '9800000014', 'Hotel', 'Kanchipuram', 'East Raja Street', null],
  ['Demo Home Karthik', '9800000015', 'Home', 'Sriperumbudur', 'SIPCOT Colony', null],
];
// DEMO Default price per pack (Rs, before GST) by product; the customer types' lists are derived from it (LIST_FACTOR)
const DEMO_PRICE = {
  'DZIND-DF028': 45, 'DZIND-DF030': 75, 'DZIND-DF031': 60, 'DZIND-DF035': 50, 'DZIND-DF048': 90,
  'DZIND-DF025': 55, 'DZIND-DF026': 99,
  'DZIND-DF001': 40, 'DZIND-DF002': 45, 'DZIND-DF006': 85, 'DZIND-DF007': 70, 'DZIND-DF008': 55, 'DZIND-DF008-BLK': 120,
  'DZIND-DF008-BUR': 65, 'DZIND-DF008-LAV': 65, 'DZIND-DF013': 210, 'DZIND-DF014': 50,
  'DZIND-DF016': 22, 'DZIND-DF017': 85, 'DZIND-DF018': 125, 'DZIND-DF019': 199, 'DZIND-DF023': 260, 'DZIND-DF024': 240,
  'DZIND-DF036': 115, 'DZIND-DF037': 70, 'DZIND-DF038': 70, 'DZIND-DF040': 60,
  'DZIND-DF044': 180,
};
const LIST_FACTOR = { default: 1, home: 1, hotel: 0.92, hospital: 0.9, office: 0.94, distributor: 0.8 };
// [customer #, status, payment, coupon, days ago, [[sku, qty], ...]] - quantities respect the demo carton rules
const ORDERS = [
  [1, 'delivered', 'bank', 'HOTEL500', 9, [['DF001-M100', 20], ['DF007-M100', 10], ['DF040-M100', 6], ['DF013-M50', 24]]],
  [3, 'delivered', 'bank', null, 8, [['DF044-M100', 10], ['DF036-M250', 8]]],
  [7, 'delivered', 'bank', null, 8, [['DF002-M100', 30], ['DF013-M50', 12], ['DF030-M200', 10]]],
  [9, 'delivered', 'cod', 'WELCOME10', 7, [['DF018-R6', 5]]],
  [2, 'delivered', 'razorpay', 'FRESH5', 7, [['DF001-M100', 8], ['DF008-M50', 6]]],
  [5, 'delivered', 'bank', null, 6, [['DF040-M100', 10], ['DF031-M200', 6]]],
  [12, 'delivered', 'razorpay', null, 6, [['DF002-M100', 12], ['DF014-M100', 6]]],
  [10, 'delivered', 'cod', 'WELCOME10', 5, [['DF017-R4', 6], ['DF023-R1', 6]]],
  [4, 'dispatched', 'bank', null, 4, [['DF044-M100', 6], ['DF036-M250', 4]]],
  [8, 'dispatched', 'bank', null, 3, [['DF002-M100', 20], ['DF007-M100', 12]]],
  [14, 'dispatched', 'cod', null, 3, [['DF001-M100', 10], ['DF024-R1', 6]]],
  [11, 'dispatched', 'razorpay', 'FRESH5', 2, [['DF018-R6', 2], ['DF030-M200', 2]]],
  [6, 'dispatched', 'bank', null, 2, [['DF040-M100', 8]]],
  [13, 'packed', 'bank', null, 2, [['DF008BLK-M100', 6], ['DF002-M100', 10]]],
  [1, 'packed', 'bank', null, 1, [['DF007-M100', 15], ['DF013-M50', 6]]],
  [15, 'packed', 'cod', 'FRESH5', 1, [['DF019-R10', 1], ['DF025-R1', 4]]],
  [3, 'packed', 'bank', null, 1, [['DF044-M100', 8]]],
  [2, 'packed', 'razorpay', null, 1, [['DF001-M100', 6], ['DF008LAV-M50', 4]]],
  [7, 'new', 'bank', 'HOTEL500', 0, [['DF002-M100', 40], ['DF014-M100', 20], ['DF030-M200', 12], ['DF036-M250', 24], ['DF044-M100', 12]]],
  [12, 'new', 'cod', null, 0, [['DF001-M100', 10], ['DF008BUR-M50', 6]]],
  [9, 'new', 'razorpay', 'FRESH5', 0, [['DF017-R4', 2], ['DF026-R2', 2]]],
  [5, 'new', 'bank', null, 0, [['DF040-M100', 12], ['DF031-M200', 8]]],
  [10, 'new', 'cod', null, 0, [['DF023-R1', 6], ['DF035-M10', 2]]],
  [4, 'new', 'bank', null, 0, [['DF044-M100', 4], ['DF038-M150', 6]]],
  [14, 'new', 'cod', null, 0, [['DF006-PKT', 10], ['DF001-M100', 6]]],
];
const NOTES = [
  ['Demo Hotel Sangam', 'DEMO - orders every Monday, wants the invoice with GSTIN', 0],
  ['Demo City Hospital', 'DEMO - asked for a bulk price on hand towels', -1],
  ['Demo Distributor Vellore', 'DEMO - distributor for Vellore district, monthly order', 5],
];

async function inTx(fn) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn(conn);
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally { conn.release(); }
}

(async () => {
  // the connection must really be dfresh_commerce, whatever the .env says
  const [[{ name }]] = await db.query('SELECT DATABASE() AS name');
  if (name !== DB) { console.error(`commerce-demo-seed refused: connected to ${name}, not ${DB}`); process.exit(1); }
  const [[{ roles }]] = await db.query("SELECT COUNT(*) AS roles FROM information_schema.tables WHERE table_schema = ? AND table_name IN ('roles', 'commerce_settings', 'approvals')", [DB]);
  if (Number(roles) !== 3) { console.error('commerce-demo-seed: apply the 20261020_commerce_* migrations first'); process.exit(1); }

  const raw = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB, multipleStatements: true, timezone: 'Z' });
  await raw.query("SET time_zone = '+00:00'");
  const [[{ has }]] = await raw.query("SELECT COUNT(*) AS has FROM information_schema.tables WHERE table_schema = ? AND table_name = 'orders'", [DB]);
  if (!Number(has)) {
    await raw.query(fs.readFileSync(path.join(ROOT, 'database/demo/commerce-demo-schema.sql'), 'utf8'));
    await raw.query(fs.readFileSync(path.join(ROOT, 'database/demo/commerce-demo-data.sql'), 'utf8'));
    console.log('demo tables and SQL demo data: done');
  } else console.log('demo tables exist already: skipped');
  await raw.end();

  // DEMO prices through the same code as the admin (history, audit)
  const [[{ priced }]] = await db.query('SELECT COUNT(*) AS priced FROM price_changes');
  if (!Number(priced)) {
    const [skus] = await db.query('SELECT sku_code, product_id FROM skus ORDER BY sku_code');
    const ist = (days) => new Date(Date.now() + 5.5 * 3600e3 + days * 86400e3).toISOString().slice(0, 10);
    const lists = (await pricing.lists(db)).map((l) => l.key).filter((k) => LIST_FACTOR[k]);
    const at = (base, k) => Math.round(base * LIST_FACTOR[k]);
    const changes = [];
    for (const s of skus) {
      const base = DEMO_PRICE[s.product_id];
      if (base) lists.forEach((k) => changes.push({ sku_code: s.sku_code, list_key: k, price: at(base, k) }));
    }
    await inTx((q) => pricing.setPrices(q, changes, { effective: ist(-30), source: 'seed', empId: 'DZIND002', allowPast: true }));
    const rolls = skus.filter((s) => ['DZIND-DF017', 'DZIND-DF018', 'DZIND-DF019'].includes(s.product_id));
    await inTx((q) => pricing.setPrices(q, rolls.flatMap((s) => lists.map((k) => ({ sku_code: s.sku_code, list_key: k, price: at(Math.round(DEMO_PRICE[s.product_id] * 1.05), k) }))),
      { effective: ist(-5), source: 'seed', empId: 'DZIND002', allowPast: true }));
    const first = new Date(Date.now() + 5.5 * 3600e3);
    const nextMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
    await inTx((q) => pricing.setPrices(q, skus.filter((s) => s.product_id === 'DZIND-DF044').map((s) => ({ sku_code: s.sku_code, list_key: 'default', price: 189 })),
      { effective: nextMonth, source: 'seed', empId: 'DZIND002' }));
    await db.query("UPDATE price_changes SET changed_at = UTC_TIMESTAMP() - INTERVAL 30 DAY WHERE effective_from < DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) - INTERVAL 20 DAY");
    await db.query("UPDATE price_changes SET changed_at = UTC_TIMESTAMP() - INTERVAL 5 DAY WHERE source = 'seed' AND effective_from = ?", [ist(-5)]);
    console.log(`demo prices: ${changes.length} on ${lists.length} lists, ${rolls.length * lists.length} changed 5 days ago, 1 scheduled for ${nextMonth}`);
  } else console.log('prices exist already: skipped');

  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM orders');
  if (Number(n) > 0) { console.log(`${n} orders exist already: customers, orders, returns and approvals skipped`); process.exit(0); }

  for (const [nm, phone, ctype, town, address, gstin] of CUSTOMERS) {
    await db.query("INSERT INTO customers (name, phone, ctype, town, address, gstin, source, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Phone', UTC_TIMESTAMP() - INTERVAL 12 DAY)",
      [nm, `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`, ctype, town, address, gstin]);
  }
  const [custRows] = await db.query('SELECT customer_id FROM customers ORDER BY customer_id LIMIT 15');
  let made = 0;
  for (const [ci, status, payment, coupon, daysAgo, lines] of ORDERS) {
    await inTx(async (conn) => {
      const items = lines.map(([sku, qty]) => ({ sku_code: sku, qty, price: null })); // the list price of the customer's type
      const priceDate = new Date(Date.now() + 5.5 * 3600e3 - (daysAgo * 24 + 6) * 3600e3).toISOString().slice(0, 10);
      const o = await commerce.createOrder(conn, { customer_id: custRows[ci - 1].customer_id, items, coupon_code: coupon, payment, note: 'DEMO order' }, ci % 2 ? 'DZIND148' : 'DZIND002', { priceDate });
      for (const s of commerce.ORDER_FLOW.slice(1, commerce.ORDER_FLOW.indexOf(status) + 1)) await commerce.advanceOrder(conn, o.order_no, s, 'DZIND002');
      await conn.query(`UPDATE orders SET created_at = UTC_TIMESTAMP() - INTERVAL ? HOUR,
          packed_at = IF(packed_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR),
          dispatched_at = IF(dispatched_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR),
          delivered_at = IF(delivered_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR) WHERE order_id = ?`,
      [daysAgo * 24 + 6, daysAgo * 24 + 4, daysAgo * 24 + 2, Math.max(daysAgo * 24 - 20, 1), o.order_id]);
      await conn.query('UPDATE stock_movements SET created_at = UTC_TIMESTAMP() - INTERVAL ? HOUR WHERE note = ?', [daysAgo * 24 + 2, `Dispatched ${o.order_no}`]);
      await conn.query("UPDATE wallet_entries SET created_at = UTC_TIMESTAMP() - INTERVAL ? HOUR WHERE order_id = ? AND reason LIKE 'Cashback%'", [Math.max(daysAgo * 24 - 20, 1), o.order_id]);
    });
    made += 1;
  }

  const [del] = await db.query("SELECT o.order_no, (SELECT sku_code FROM order_items i WHERE i.order_id = o.order_id ORDER BY qty DESC LIMIT 1) AS sku FROM orders o WHERE status = 'delivered' ORDER BY order_id LIMIT 2");
  const plans = [
    { items: [{ sku_code: del[0].sku, qty: 4, item_check: 'ok' }], reason: 'DEMO - wrong size ordered, packs unopened', outcome: 'wallet' },
    { items: [{ sku_code: del[1].sku, qty: 2, item_check: 'damaged' }], reason: 'DEMO - cartons wet on arrival', outcome: 'replacement' },
  ];
  for (let i = 0; i < 2; i += 1) {
    await inTx(async (conn) => {
      const r = await commerce.createReturn(conn, del[i].order_no, plans[i], 'DZIND148');
      await conn.query('UPDATE returns SET created_at = UTC_TIMESTAMP() - INTERVAL ? HOUR WHERE return_no = ?', [30 - i * 20, r.return_no]);
    });
  }
  for (const [nm, note, days] of NOTES) {
    await db.query("UPDATE customers SET notes = ?, follow_up = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) + INTERVAL ? DAY WHERE name = ?", [note, days, nm]);
  }

  // demo approval requests: two raised by DZIND002, one by DZIND148, one already decided
  const [[ret]] = await db.query("SELECT return_no, amount FROM returns WHERE outcome = 'wallet' LIMIT 1");
  const [[ord]] = await db.query("SELECT order_no, subtotal FROM orders WHERE status = 'new' ORDER BY order_id LIMIT 1");
  await inTx(async (q) => {
    await approvals.request(q, { kind: 'refund', refType: 'return', refId: ret.return_no, summary: `DEMO - refund Rs 2,400 to the bank for ${ret.return_no} (above the Rs 2,000 limit)`, amount: 2400, payload: { demo: true } }, 'DZIND002');
    await approvals.request(q, { kind: 'write_off', refType: 'stock', refId: 'DF019-R10', summary: 'DEMO - write off 25 packs of DF019-R10 (wet cartons)', amount: 1850, payload: { demo: true, qty: 25 } }, 'DZIND002');
    await approvals.request(q, { kind: 'discount', refType: 'order', refId: ord.order_no, summary: `DEMO - 15 % manual discount on ${ord.order_no} (limit 10 %)`, amount: Math.round(Number(ord.subtotal) * 0.15), payload: { demo: true, pct: 15 } }, 'DZIND148');
    const id = await approvals.request(q, { kind: 'goodwill_credit', refType: 'customer', refId: 'Demo Cafe Thendral', summary: 'DEMO - Rs 300 goodwill wallet credit for a late delivery', amount: 300, payload: { demo: true } }, 'DZIND148');
    await q.query("UPDATE approvals SET status = 'approved', decided_by = 'DZIND002', decided_at = UTC_TIMESTAMP() - INTERVAL 2 HOUR, note = 'DEMO - OK, regular customer', requested_at = UTC_TIMESTAMP() - INTERVAL 5 HOUR WHERE approval_id = ?", [id]);
  });
  await db.query("UPDATE commerce_settings SET value = '1', updated_by = 'demo-seed', updated_at = UTC_TIMESTAMP() WHERE setting_key = 'commerce_enabled'");
  console.log(`demo: ${CUSTOMERS.length} customers, ${made} orders, 2 returns, ${NOTES.length} follow-ups, 4 approval requests; Commerce switched on`);
  process.exit(0);
})().catch((e) => { console.error('commerce-demo-seed failed:', e.message); process.exit(1); });
