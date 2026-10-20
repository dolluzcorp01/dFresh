// Commerce DEMO data for dfresh_commerce ONLY (refuses any other DB_NAME): 15 demo customers and 25 orders across
// all statuses, made through src/backend_routes/commerce.js (same rules as the admin: coupons, wallet, stock out on
// dispatch). Run once after commerce_03_orders.sql: node scripts/commerce-seed.js   (does nothing if orders exist)
require('dotenv').config({ quiet: true });
const { getDBConnection } = require('../config/db');
const commerce = require('../src/backend_routes/commerce');

if (process.env.DB_NAME !== 'dfresh_commerce') { console.error('commerce-seed: only for DB_NAME=dfresh_commerce'); process.exit(1); }
const db = getDBConnection('dfresh_commerce').promise();

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

// [customer #, status, payment, coupon, days ago, [[sku, qty], ...]]
const ORDERS = [
  [1, 'delivered', 'bank', 'HOTEL500', 9, [['DF001-M100', 20], ['DF007-M100', 10], ['DF040-M100', 6]]],
  [3, 'delivered', 'bank', null, 8, [['DF044-M100', 10], ['DF036-M250', 8]]],
  [7, 'delivered', 'bank', null, 8, [['DF002-M100', 30], ['DF013-M50', 12], ['DF030-M200', 10]]],
  [9, 'delivered', 'cod', 'WELCOME10', 7, [['DF018-R6', 2], ['DF028-M100', 0]]],
  [2, 'delivered', 'razorpay', 'FRESH5', 7, [['DF001-M100', 8], ['DF008-M50', 6]]],
  [5, 'delivered', 'bank', null, 6, [['DF040-M100', 10], ['DF031-M200', 6]]],
  [12, 'delivered', 'razorpay', null, 6, [['DF002-M100', 12], ['DF014-M100', 6]]],
  [10, 'delivered', 'cod', 'WELCOME10', 5, [['DF016-R1', 6], ['DF023-R1', 4]]],
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
  [7, 'new', 'bank', 'HOTEL500', 0, [['DF002-M100', 40], ['DF014-M100', 20], ['DF030-M200', 12]]],
  [12, 'new', 'cod', null, 0, [['DF001-M100', 10], ['DF008BUR-M50', 6]]],
  [9, 'new', 'razorpay', 'FRESH5', 0, [['DF017-R4', 2], ['DF026-R2', 2]]],
  [5, 'new', 'bank', null, 0, [['DF040-M100', 12], ['DF031-M200', 8]]],
  [10, 'new', 'cod', null, 0, [['DF023-R1', 3], ['DF035-M10', 2]]],
  [4, 'new', 'bank', null, 0, [['DF044-M100', 4], ['DF038-M150', 6]]],
  [14, 'new', 'cod', null, 0, [['DF006-PKT', 10], ['DF001-M100', 6]]],
];

(async () => {
  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM orders');
  if (n > 0) { console.log(`commerce-seed: ${n} orders already there, nothing done`); process.exit(0); }
  const [[{ c }]] = await db.query('SELECT COUNT(*) AS c FROM customers');
  if (!c) {
    for (const [name, phone, ctype, town, address, gstin] of CUSTOMERS) {
      await db.query('INSERT INTO customers (name, phone, ctype, town, address, gstin, created_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP() - INTERVAL 12 DAY)', [name, phone, ctype, town, address, gstin]);
    }
  }
  const [custRows] = await db.query('SELECT customer_id FROM customers ORDER BY customer_id LIMIT 15');
  const [prices] = await db.query('SELECT sku_code, price FROM sku_prices');
  const price = new Map(prices.map((p) => [p.sku_code, Number(p.price)]));
  let made = 0;
  for (const [ci, status, payment, coupon, daysAgo, lines] of ORDERS) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const items = lines.filter(([, q]) => q > 0).map(([sku, qty]) => ({ sku_code: sku, qty, price: price.get(sku) }));
      const o = await commerce.createOrder(conn, { customer_id: custRows[ci - 1].customer_id, items, coupon_code: coupon, payment, note: 'DEMO order' }, ci % 2 ? 'DZIND148' : 'DZIND002');
      const steps = commerce.ORDER_FLOW.slice(1, commerce.ORDER_FLOW.indexOf(status) + 1);
      for (const s of steps) await commerce.advanceOrder(conn, o.order_no, s, 'DZIND002');
      // back-date the demo history (hours apart per step)
      await conn.query(`UPDATE orders SET created_at = UTC_TIMESTAMP() - INTERVAL ? HOUR,
          packed_at = IF(packed_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR),
          dispatched_at = IF(dispatched_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR),
          delivered_at = IF(delivered_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR) WHERE order_id = ?`,
      [daysAgo * 24 + 6, daysAgo * 24 + 4, daysAgo * 24 + 2, Math.max(daysAgo * 24 - 20, 1), o.order_id]);
      await conn.query("UPDATE stock_movements SET created_at = UTC_TIMESTAMP() - INTERVAL ? HOUR WHERE note = ?", [daysAgo * 24 + 2, `Dispatched ${o.order_no}`]);
      await conn.commit();
      made += 1;
    } catch (e) {
      await conn.rollback();
      console.error('order failed:', e.message);
    } finally { conn.release(); }
  }
  console.log(`commerce-seed: ${CUSTOMERS.length} customers, ${made} orders`);
  process.exit(0);
})();
