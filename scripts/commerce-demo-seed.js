// Commerce DEMO seed - ONLY for the database dfresh_commerce (refuses DB_NAME or a connection to anything else).
// Run after a fresh copy of dfresh + every migration (database/migrations, incl. 20261021_commerce_*):
//   node scripts/commerce-demo-seed.js
// 1. (the demo's interim tables are gone: phases 2-8 made every one of them a migration)
// 2. SQL demo data (database/demo/commerce-demo-data.sql): SKUs with carton sizes, minimum orders and HSN codes,
//    reorder levels, a little returned stock
// 3. DEMO prices on all 6 lists (Default + 5 customer types) for every SKU, through src/backend_routes/pricing.js:
//    effective 30 days ago, a +5 % change on the toilet rolls 5 days ago and one scheduled for the 1st of next month
// 4. 15 demo customers through src/backend_routes/customers.js (CUS-0001..., billing and shipping addresses with state
//    and PIN, credit terms by type, one in Karnataka for IGST, contacts, sales owners, tags) and 26 orders across all
//    statuses, through src/backend_routes/commerce.js (list prices of the customer's type, coupons, stock reserved, stock
//    out and invoice at dispatch); then the dates are moved back to the demo days, payments recorded (paid, part paid,
//    one overdue invoice)
// 4c. CRM (phase 8): two hotels with a second branch (a second GSTIN: Karnataka, Puducherry), timeline entries (calls,
//    visits, WhatsApp), follow-ups (some overdue), one customer on hold, a duplicate pair to merge (the same lodge
//    entered twice with another number), a lead converted to a customer, a saved segment
// 4b. returns through src/backend_routes/returns.js, one in every status: outside the window waiting for approval, a
//    courier reverse pickup still without AWB, a pickup on a planned trip, received (scanned), inspected, refunded to
//    the wallet (credit note), a partial one (IGST order: refund less to pay + replacement, courier reverse pickup),
//    replaced, closed with no refund (approved)
// 5. stock through src/backend_routes/stock.js: 2 suppliers, production stock-ins for every SKU 12 days ago and a
//    purchase of napkins 6 days ago (costs, so the average cost moves), wet wipes in 3 batches (one expired, one near
//    expiry, one fresh); after the orders: write-offs (one waiting for approval), a towels count with differences
//    waiting for approval
// 6. delivery setup (2 vehicles, 3 drivers, 2 couriers, 4 delivery areas with charges) before the orders; the orders go
//    through packing (pick list, scans, packed with cartons and weight) and delivery: past trips (delivered, cash
//    collected), a customer pickup, couriers (one delivered, one on the way), a failed delivery, one trip out for
//    delivery now, and orders still Packed, Packing and New
// 7. promotions (phase 7, before the orders so they apply): coupons of each type (percent with a cap and once per
//    Home customer, fixed for Hotels and Distributors, percent excluding wet wipes, free delivery), a quantity slab
//    (napkins from 3 cartons, 5 % off), buy 10 get 1 free on wet wipes, cashback for Hotels (3 %, max Rs 500) and
//    Distributors (2 % from Rs 5,000, max Rs 1,000); after the orders: cashback of the orders whose return window has
//    passed, manual wallet credits (one through an approved request, one expiring in 10 days, one already expired)
// 8. a demo approval decided, and Commerce switched ON
// 9. notifications (phase 10): MUTED while all of the above is built (months of demo history must not mail anyone);
//    then Demo Hotel Sangam gets its mails in Tamil and Demo Distributor Vellore opts out of reminders
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
const stock = require('../src/backend_routes/stock');
const delivery = require('../src/backend_routes/delivery');
const returns = require('../src/backend_routes/returns');
const promotions = require('../src/backend_routes/promotions');
const wallet = require('../src/backend_routes/wallet');
const customers = require('../src/backend_routes/customers');
const notifications = require('../src/backend_routes/notifications');

notifications.setMuted(true); // the demo history sends no mail (the hooks still run, they just do nothing)

const db = getDBConnection(DB).promise();
const ROOT = path.join(__dirname, '..');

// [name, phone, type, town, address, GSTIN, state, PIN, credit days, credit limit]
const CUSTOMERS = [
  ['Demo Hotel Sangam', '9800000001', 'Hotel', 'Kanchipuram', 'Gandhi Road', '33AAACD0001A1Z5', '33', '631501', 7, 25000],
  ['Demo Cafe Thendral', '9800000002', 'Hotel', 'Chennai', 'Anna Nagar', null, '33', '600040', 0, 0],
  ['Demo City Hospital', '9800000003', 'Hospital', 'Chengalpattu', 'GST Road', '33AAACD0003A1Z1', '33', '603001', 30, 60000],
  ['Demo Care Clinic', '9800000004', 'Hospital', 'Kanchipuram', 'Railway Road', null, '33', '631502', 15, 15000],
  ['Demo Tech Park Office', '9800000005', 'Office', 'Chennai', 'OMR, Padur', '33AAACD0005A1Z7', '33', '603103', 15, 20000],
  ['Demo Bank Branch', '9800000006', 'Office', 'Sriperumbudur', 'Main Road', null, '33', '602105', 15, 10000],
  ['Demo Distributor Vellore', '9800000007', 'Distributor', 'Vellore', 'Katpadi Road', '33AAACD0007A1Z3', '33', '632007', 7, 150000], // 7 days: overdue (opted out of reminders)
  ['Demo Distributor Bengaluru', '9800000008', 'Distributor', 'Bengaluru', 'Peenya Industrial Area', '29AAACD0008A1Z1', '29', '560058', 30, 150000],
  ['Demo Home Priya', '9800000009', 'Home', 'Kanchipuram', 'Vaikunta Perumal Koil St', null, '33', '631502', 0, 0],
  ['Demo Home Arun', '9800000010', 'Home', 'Chennai', 'Tambaram West', null, '33', '600045', 0, 0],
  ['Demo Home Lakshmi', '9800000011', 'Home', 'Chengalpattu', 'Collectorate Road', null, '33', '603001', 0, 0],
  ['Demo Restaurant Anjappar', '9800000012', 'Hotel', 'Chennai', 'Velachery Main Road', null, '33', '600042', 0, 0],
  ['Demo School Canteen', '9800000013', 'Office', 'Kanchipuram', 'Collector Office Road', null, '33', '631501', 0, 0],
  ['Demo Lodge Kamakshi', '9800000014', 'Hotel', 'Kanchipuram', 'East Raja Street', null, '33', '631501', 0, 0],
  ['Demo Home Karthik', '9800000015', 'Home', 'Sriperumbudur', 'SIPCOT Colony', null, '33', '602105', 0, 0],
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
// [customer #, target status, terms (cod | advance | credit), coupon, days ago, [[sku, qty], ...], delivery (own | courier | pickup)]
// - quantities respect the demo carton rules; what was paid is set after the loop (PAID); pay-on-delivery cash is
//   collected on the trips
const ORDERS = [
  [1, 'delivered', 'credit', 'HOTEL500', 9, [['DF001-M100', 20], ['DF007-M100', 10], ['DF040-M100', 6], ['DF013-M50', 24]], 'own'],
  [3, 'delivered', 'credit', null, 8, [['DF044-M100', 10], ['DF036-M250', 8]], 'own'],
  [7, 'delivered', 'credit', null, 8, [['DF002-M100', 30], ['DF013-M50', 12], ['DF030-M200', 10]], 'own'],
  [9, 'delivered', 'cod', 'WELCOME10', 7, [['DF018-R6', 5]], 'own'],
  [2, 'delivered', 'advance', 'FRESH5', 7, [['DF001-M100', 8], ['DF008-M50', 6]], 'pickup'],
  [5, 'delivered', 'credit', null, 6, [['DF040-M100', 10], ['DF031-M200', 6]], 'own'],
  [12, 'delivered', 'advance', null, 6, [['DF002-M100', 12], ['DF014-M100', 6]], 'courier'],
  [10, 'delivered', 'cod', 'WELCOME10', 5, [['DF017-R4', 6], ['DF023-R1', 6]], 'own'],
  [4, 'out_for_delivery', 'credit', null, 1, [['DF044-M100', 6], ['DF036-M250', 4]], 'own'],
  [8, 'with_courier', 'credit', null, 3, [['DF002-M100', 20], ['DF007-M100', 12]], 'courier'],
  [14, 'out_for_delivery', 'cod', null, 1, [['DF001-M100', 10], ['DF024-R1', 6]], 'own'],
  [11, 'out_for_delivery', 'advance', 'FRESH5', 1, [['DF018-R6', 2], ['DF030-M200', 2]], 'own'],
  [6, 'failed', 'credit', null, 2, [['DF040-M100', 8]], 'own'],
  [13, 'packed', 'cod', null, 2, [['DF008BLK-M100', 6], ['DF002-M100', 10]], 'own'],
  [1, 'packed', 'credit', null, 1, [['DF007-M100', 15], ['DF013-M50', 6]], 'own'],
  [15, 'packed', 'cod', 'FRESH5', 1, [['DF019-R10', 1], ['DF025-R1', 4]], 'pickup'],
  [3, 'packed', 'credit', null, 1, [['DF044-M100', 8]], 'own'],
  [2, 'packed', 'advance', null, 1, [['DF001-M100', 6], ['DF008LAV-M50', 4]], 'courier'],
  [7, 'packing', 'credit', null, 0, [['DF002-M100', 40], ['DF014-M100', 20], ['DF030-M200', 12], ['DF036-M250', 24], ['DF044-M100', 12]], 'own'],
  [12, 'packing', 'cod', null, 0, [['DF001-M100', 10], ['DF008BUR-M50', 6]], 'own'],
  [9, 'new', 'advance', 'FRESH5', 0, [['DF017-R4', 2], ['DF026-R2', 2]], 'own'],
  [5, 'new', 'credit', null, 0, [['DF040-M100', 12], ['DF031-M200', 8]], 'own'],
  [10, 'new', 'cod', null, 0, [['DF023-R1', 6], ['DF035-M10', 2]], 'own'],
  [4, 'new', 'credit', null, 0, [['DF044-M100', 4], ['DF038-M150', 6]], 'own'],
  [14, 'new', 'cod', null, 0, [['DF006-PKT', 10], ['DF001-M100', 6]], 'own'],
  [8, 'delivered', 'credit', null, 4, [['DF044-M100', 6], ['DF002-M100', 20]], 'courier'], // IGST (Karnataka): its returns
];
const METHOD = { own: 1, courier: 2, pickup: 3 };
// what each demo order has paid after the loop: order index (1-based) -> 'full' | fraction | 0 (credit orders
// not listed stay unpaid; 'advance' orders are paid in full by Razorpay at the order day, 'cod' ones on the trip)
const PAID = { 2: 'full', 3: 0.5, 6: 'full', 9: 0.4 };

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
  if (Number(roles) !== 3) { console.error('commerce-demo-seed: apply the 20261021_commerce_* migrations first'); process.exit(1); }

  const raw = await mysql.createConnection({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: DB, multipleStatements: true, timezone: 'Z' });
  await raw.query("SET time_zone = '+00:00'");
  const [[{ has }]] = await raw.query('SELECT COUNT(*) AS has FROM stock_levels');
  if (!Number(has)) {
    await raw.query(fs.readFileSync(path.join(ROOT, 'database/demo/commerce-demo-data.sql'), 'utf8'));
    console.log('SQL demo data: done');
  } else console.log('SQL demo data exists already: skipped');
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

  // DEMO stock: suppliers and stock-ins with costs (every pack in the godown comes from a stock in)
  const [[{ ins }]] = await db.query('SELECT COUNT(*) AS ins FROM stock_ins');
  if (!Number(ins)) {
    const dayAgo = (n) => new Date(Date.now() + 5.5 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
    const atAgo = (n) => new Date(Date.now() - n * 86400e3);
    await db.query(`INSERT INTO suppliers (name, phone, gstin, address, created_by) VALUES
      ('DEMO Sri Lakshmi Paper Traders', '+91 94440 11223', '33AAACS1234L1Z2', 'Sidco Industrial Estate, Ambattur, Chennai', 'demo-seed'),
      ('DEMO Coimbatore Hygiene Products', '+91 98940 55667', '33AAACC5678H1Z9', 'Avinashi Road, Coimbatore', 'demo-seed')`);
    const [[sup1]] = await db.query("SELECT supplier_id FROM suppliers WHERE name LIKE 'DEMO Sri Lakshmi%'");
    const [[sup2]] = await db.query("SELECT supplier_id FROM suppliers WHERE name LIKE 'DEMO Coimbatore%'");
    const [all] = await db.query("SELECT s.sku_code, s.product_id, p.track_batches FROM skus s JOIN products p ON p.product_id = s.product_id ORDER BY s.sku_code");
    const LOW = { 'DF037-M150': 8, 'DF017-R4': 14, 'DF028-M100': 8 }; // a few SKUs run low on purpose
    const qtyOf = (sku) => LOW[sku] || 80 + ([...sku].reduce((a, c) => a + c.charCodeAt(0), 0) * 37) % 200;
    const costOf = (pid, f) => Math.round(DEMO_PRICE[pid] * f * 100) / 100;
    const paper = all.filter((x) => !Number(x.track_batches) && DEMO_PRICE[x.product_id]);
    await inTx((q) => stock.stockIn(q, { kind: 'production', received_on: dayAgo(12), reference: 'DEMO batch sheet KPM-1012', note: 'DEMO opening stock from the Kanchipuram unit',
      lines: paper.map((x) => ({ sku_code: x.sku_code, qty: qtyOf(x.sku_code), unit_cost: costOf(x.product_id, 0.55) })) }, 'DZIND002', { allowPast: true, at: atAgo(12) }));
    const napkins = paper.filter((x) => ['DZIND-DF001', 'DZIND-DF002', 'DZIND-DF007'].includes(x.product_id));
    await inTx((q) => stock.stockIn(q, { kind: 'purchase', supplier_id: sup1.supplier_id, received_on: dayAgo(6), reference: 'DEMO SLPT/2026/0418', note: 'DEMO top-up while the unit was on maintenance',
      lines: napkins.map((x) => ({ sku_code: x.sku_code, qty: 48, unit_cost: costOf(x.product_id, 0.66) })) }, 'DZIND148', { allowPast: true, at: atAgo(6) }));
    const wipes = all.filter((x) => Number(x.track_batches));
    for (const [batch, mfg, exp, qty, agoIn, f] of [['WW2504', -200, -5, 10, 190, 0.6], ['WW2509', -160, 20, 40, 150, 0.62], ['WW2603', -20, 345, 80, 15, 0.64]]) {
      await inTx((q) => stock.stockIn(q, { kind: 'purchase', supplier_id: sup2.supplier_id, received_on: dayAgo(agoIn), reference: `DEMO CHP/${batch}`, note: 'DEMO wet wipes',
        lines: wipes.map((x) => ({ sku_code: x.sku_code, qty, unit_cost: costOf(x.product_id, f), batch_no: batch, mfg_date: dayAgo(-mfg), expiry_date: dayAgo(-exp) })) }, 'DZIND002', { allowPast: true, at: atAgo(agoIn) }));
    }
    console.log(`demo stock: 2 suppliers, production stock in for ${paper.length} SKUs, a purchase of ${napkins.length} napkin SKUs, wet wipes in 3 batches`);
  } else console.log('stock-ins exist already: skipped');

  const [[{ n }]] = await db.query('SELECT COUNT(*) AS n FROM orders');
  if (Number(n) > 0) { console.log(`${n} orders exist already: customers, orders, returns and approvals skipped`); process.exit(0); }

  // DEMO delivery setup (Commerce settings > Delivery): areas with charges, vehicles, drivers, couriers
  await db.query(`INSERT INTO delivery_areas (area_id, label, towns, charge, free_above, sort_order) VALUES
      (2, 'Chennai', 'Chennai, 600040, 600042, 600045, 603103', 150, 5000, 2),
      (3, 'Chengalpattu and Sriperumbudur', 'Chengalpattu, Sriperumbudur, 603001, 602105', 100, 3000, 3),
      (4, 'Vellore and Arakkonam', 'Vellore, Arakkonam, Katpadi, 632007', 250, 10000, 4)
    ON DUPLICATE KEY UPDATE label = VALUES(label)`);
  await db.query("UPDATE delivery_areas SET towns = 'Kanchipuram, 631501, 631502' WHERE area_id = 1");
  await db.query("INSERT INTO vehicles (number, type, sort_order) VALUES ('TN 21 AB 4521', 'Tata Ace (mini truck)', 1), ('TN 21 CK 0987', 'Bajaj three-wheeler', 2)");
  await db.query("INSERT INTO drivers (name, phone, sort_order) VALUES ('DEMO Murugan', '+91 90030 11111', 1), ('DEMO Selvam', '+91 90030 22222', 2), ('DEMO Ravi', '+91 90030 33333', 3)");
  await db.query("INSERT INTO couriers (name, tracking_url, sort_order) VALUES ('DEMO Express Couriers', 'https://example.com/track?awb={awb}', 1), ('DEMO South Parcel Service', 'https://example.org/tracking/{awb}', 2)");

  // DEMO customers through customers.js (the drawer's rules), owners DZIND148 / DZIND002, tags, a contact each
  const TAGS = { Hotel: ['horeca', 'monthly'], Hospital: ['healthcare', 'b2b'], Office: ['b2b'], Distributor: ['distributor', 'b2b'], Home: ['retail'] };
  let k = 0;
  for (const [nm, phone, ctype, town, address, gstin, state, pin, days, limit] of CUSTOMERS) {
    k += 1;
    const idx = k;
    const addr = { label: ctype === 'Home' ? 'Home' : 'Main', name: nm, gstin, address, town, state_code: state, pincode: pin };
    await inTx(async (q) => {
      const c = await customers.createCustomer(q, { name: nm, business_name: ctype === 'Home' ? null : nm, type_key: ctype, phone, source: 'Phone', owner_emp_id: idx % 5 === 0 ? null : idx % 2 ? 'DZIND148' : 'DZIND002',
        tags: TAGS[ctype], bill: addr, ship: { ...addr, gstin: null, contact_person: ctype === 'Home' ? nm.replace('Demo Home ', '') : 'Store keeper', phone },
        contacts: ctype === 'Home' ? [] : [{ name: `DEMO ${['Ramesh', 'Suresh', 'Anitha', 'Kumar', 'Divya'][idx % 5]}`, role: ctype === 'Hospital' ? 'Purchase officer' : 'Manager', phone, email: `demo.buyer${idx}@example.com`, whatsapp: true, gets_invoices: true }],
      }, 'demo-seed');
      await q.query('UPDATE customers SET credit_days = ?, credit_limit = ?, created_at = UTC_TIMESTAMP() - INTERVAL 40 DAY WHERE customer_id = ?', [days, limit, c.customer_id]);
    });
  }
  const [custRows] = await db.query('SELECT customer_id FROM customers ORDER BY customer_id LIMIT 15');
  // DEMO promotions (the same tables the Promotions screen edits), valid from 30 days back so the back-dated orders get them
  const dayAt = (n) => new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);
  await inTx(async (q) => {
    const coupon = async (c, scope = []) => {
      await q.query(`INSERT INTO coupons (code, description, kind, value, min_order, max_discount, valid_from, valid_to, total_limit, per_customer_limit, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'demo-seed')`, [c.code, c.description, c.kind, c.value, c.min_order, c.max_discount, dayAt(-30), c.valid_to, c.total_limit, c.per_customer_limit]);
      for (const x of scope) await q.query('INSERT INTO coupon_scope (code, scope, type_key, sku_code, category_key) VALUES (?, ?, ?, ?, ?)', [c.code, x[0], x[1] || null, x[2] || null, x[3] || null]);
    };
    await coupon({ code: 'WELCOME10', description: 'DEMO - 10 % off the first order of a home customer, at most Rs 300', kind: 'percent', value: 10, min_order: 500, max_discount: 300, valid_to: dayAt(70), total_limit: 100, per_customer_limit: 1 }, [['type', 'home']]);
    await coupon({ code: 'HOTEL500', description: 'DEMO - Rs 500 off for hotels and distributors from Rs 5,000', kind: 'fixed', value: 500, min_order: 5000, max_discount: null, valid_to: dayAt(70), total_limit: 20, per_customer_limit: 3 }, [['type', 'hotel'], ['type', 'distributor']]);
    await coupon({ code: 'FRESH5', description: 'DEMO - 5 % off everything except wet wipes', kind: 'percent', value: 5, min_order: 0, max_discount: null, valid_to: dayAt(40), total_limit: null, per_customer_limit: null }, [['exclude', null, null, 'wipes']]);
    await coupon({ code: 'FREESHIP', description: 'DEMO - free delivery from Rs 1,000', kind: 'free_delivery', value: 0, min_order: 1000, max_discount: null, valid_to: dayAt(40), total_limit: 50, per_customer_limit: 2 });
    const [o1] = await q.query("INSERT INTO offers (name, kind, category_key, min_qty, min_unit, pct, valid_from, valid_to, created_by) VALUES ('DEMO Bulk napkins', 'slab', 'napkins', 3, 'carton', 5, ?, ?, 'demo-seed')", [dayAt(-30), dayAt(60)]);
    for (const t of ['hotel', 'office', 'distributor']) await q.query('INSERT INTO offer_customer_types (offer_id, type_key) VALUES (?, ?)', [o1.insertId, t]);
    await q.query("INSERT INTO offers (name, kind, sku_code, buy_qty, get_qty, valid_from, valid_to, created_by) VALUES ('DEMO Wet wipes 10 + 1', 'bxgy', 'DF044-M100', 10, 1, ?, ?, 'demo-seed')", [dayAt(-30), dayAt(30)]);
    await q.query(`INSERT INTO cashback_rules (name, type_key, pct, min_order, max_per_order, valid_from, created_by) VALUES
      ('DEMO Hotels 3 %', 'hotel', 3, 0, 500, ?, 'demo-seed'), ('DEMO Distributors 2 %', 'distributor', 2, 5000, 1000, ?, 'demo-seed')`, [dayAt(-30), dayAt(-30)]);
  });
  console.log('demo promotions: 4 coupons (percent capped, fixed, percent excluding wet wipes, free delivery), 2 offers (slab, buy 10 get 1), 2 cashback rules');
  let made = 0;
  const placed = []; // [order_no, terms, status, daysAgo, kind]
  for (const [ci, status, terms, coupon, daysAgo, lines, kind] of ORDERS) {
    await inTx(async (conn) => {
      const items = lines.map(([sku, qty]) => ({ sku_code: sku, qty, price: null })); // the list price of the customer's type
      const priceDate = new Date(Date.now() + 5.5 * 3600e3 - (daysAgo * 24 + 6) * 3600e3).toISOString().slice(0, 10);
      const o = await commerce.createOrder(conn, { customer_id: custRows[ci - 1].customer_id, items, coupon_code: coupon, payment_terms: terms, delivery_method_id: METHOD[kind], note: 'DEMO order' },
        ci % 2 ? 'DZIND148' : 'DZIND002', { priceDate });
      if (o.status !== 'new') throw new Error(`${o.order_no} is ${o.status}, expected new`);
      placed.push([o.order_no, terms, status, daysAgo, kind]);
    });
    made += 1;
  }
  // packing: start (pick list), scan every pack (full cartons as SKU#C), packed with cartons and weight
  const packAll = async (conn, no) => {
    const [[o]] = await conn.query('SELECT order_id FROM orders WHERE order_no = ?', [no]);
    const st = await delivery.packState(conn, o.order_id);
    for (const l of st.lines) {
      const code = l.batch_no ? `${l.sku_code}/${l.batch_no}` : l.sku_code;
      let left = l.need;
      const ppc = Number(l.packs_per_carton) || 1;
      while (ppc > 1 && left >= ppc) { await delivery.packScan(conn, no, `${code}#C`, 'DZIND002'); left -= ppc; }
      while (left > 0) { await delivery.packScan(conn, no, code, 'DZIND002'); left -= 1; }
    }
    const units = st.lines.reduce((a2, l) => a2 + l.need, 0);
    await delivery.markPacked(conn, no, { cartons: Math.max(1, Math.ceil(units / 24)), weight_kg: String(Math.round(units * 0.4 * 10) / 10 || 1) }, 'DZIND002', false);
  };
  const beyondNew = placed.filter((x) => x[2] !== 'new');
  for (const [no, , st] of beyondNew) {
    await inTx(async (conn) => {
      await delivery.startPacking(conn, [no], 'DZIND002');
      if (st !== 'packing') await packAll(conn, no);
    });
  }
  // half of one packing order is scanned already
  const halfway = beyondNew.find((x) => x[2] === 'packing');
  await inTx(async (conn) => {
    const [[o]] = await conn.query('SELECT order_id FROM orders WHERE order_no = ?', [halfway[0]]);
    const st = await delivery.packState(conn, o.order_id);
    const l = st.lines.find((x) => !x.batch_no);
    for (let i = 0; i < Math.min(5, l.need); i += 1) await delivery.packScan(conn, halfway[0], l.sku_code, 'DZIND002');
  });
  // delivery: past trips (one per day) for own-vehicle orders delivered, with the cash of pay-on-delivery orders
  const [drv] = await db.query('SELECT driver_id FROM drivers ORDER BY driver_id');
  const [veh] = await db.query('SELECT vehicle_id FROM vehicles ORDER BY vehicle_id');
  const trips = []; // [trip_id, daysAgo]
  const byDay = new Map();
  placed.filter((x) => x[2] === 'delivered' && x[4] === 'own').forEach((x) => byDay.set(x[3], [...(byDay.get(x[3]) || []), x]));
  let tripNo = 0;
  for (const [daysAgo, group] of [...byDay.entries()].sort((x, y) => y[0] - x[0])) {
    const pick = tripNo % 2;
    await inTx(async (conn) => {
      const t = await delivery.createTrip(conn, { order_nos: group.map((x) => x[0]), vehicle_id: veh[pick].vehicle_id, driver_id: drv[pick].driver_id }, 'DZIND002');
      await delivery.startTrip(conn, t.trip_id, 'DZIND002');
      const [stops] = await conn.query('SELECT s.stop_id, o.order_no, o.payment_terms, o.amount_due FROM trip_stops s JOIN orders o ON o.order_id = s.order_id WHERE s.trip_id = ? ORDER BY s.seq', [t.trip_id]);
      for (const st of stops) {
        if (st.payment_terms === 'cod') await delivery.stopCash(conn, st.stop_id, { amount: String(Number(st.amount_due)) }, 'DZIND002', true);
        await delivery.stopDelivered(conn, st.stop_id, { receiver_name: ['Manager on duty', 'Front desk', 'Store keeper', 'Owner'][st.stop_id % 4] }, null, 'DZIND002', true);
      }
      const [[cash]] = await conn.query('SELECT COALESCE(SUM(cash_collected), 0) AS c FROM trip_stops WHERE trip_id = ?', [t.trip_id]);
      await delivery.endTrip(conn, t.trip_id, { cash_handed: String(Number(cash.c)) }, 'DZIND002', true);
      trips.push([t.trip_id, daysAgo]);
    });
    tripNo += 1;
  }
  // customer pickup, couriers
  for (const [no, , st, , kind] of placed) {
    if (kind === 'pickup' && st === 'delivered') await inTx((conn) => delivery.pickedUp(conn, no, { receiver_name: 'Customer in person' }, 'DZIND002'));
    if (kind === 'courier' && ['delivered', 'with_courier'].includes(st)) {
      await inTx(async (conn) => {
        const [[c]] = await conn.query('SELECT courier_id FROM couriers ORDER BY courier_id LIMIT 1');
        await delivery.handToCourier(conn, no, { courier_id: c.courier_id, awb_no: `DX${String(7040001 + placed.indexOf(placed.find((x) => x[0] === no)))}IN` }, 'DZIND002');
        if (st === 'delivered') await delivery.courierDelivered(conn, no, { receiver_name: 'Reception' }, 'DZIND002');
      });
    }
  }
  // a failed delivery (trip ended) and the trip out for delivery now
  const failedOnes = placed.filter((x) => x[2] === 'failed');
  await inTx(async (conn) => {
    const t = await delivery.createTrip(conn, { order_nos: failedOnes.map((x) => x[0]), vehicle_id: veh[1].vehicle_id, driver_id: drv[2].driver_id }, 'DZIND002');
    await delivery.startTrip(conn, t.trip_id, 'DZIND002');
    const [stops] = await conn.query('SELECT stop_id FROM trip_stops WHERE trip_id = ?', [t.trip_id]);
    for (const st of stops) await delivery.stopFailed(conn, st.stop_id, { reason: 'Shop / office closed', note: 'bank holiday' }, 'DZIND002', true);
    await delivery.endTrip(conn, t.trip_id, { cash_handed: '0' }, 'DZIND002', true);
    trips.push([t.trip_id, 2]);
  });
  const outNow = placed.filter((x) => x[2] === 'out_for_delivery');
  const current = await inTx(async (conn) => {
    const t = await delivery.createTrip(conn, { order_nos: outNow.map((x) => x[0]), vehicle_id: veh[0].vehicle_id, driver_id: drv[1].driver_id, area_id: 1 }, 'DZIND002');
    await delivery.startTrip(conn, t.trip_id, 'DZIND002');
    return t.trip_id;
  });
  console.log(`demo delivery: ${trips.length} past trips, trip T-${current} out now (${outNow.length} stops), couriers and a pickup`);

  // the demo days: orders, history, stock movements, invoices (issued at dispatch, due after the credit days), cashback
  for (const [no, , , daysAgo] of placed) {
    const h = (x) => Math.max(daysAgo * 24 - x, 1);
    const today = daysAgo === 0;
    await db.query(`UPDATE orders SET created_at = UTC_TIMESTAMP() - INTERVAL ? HOUR, confirmed_at = UTC_TIMESTAMP() - INTERVAL ? HOUR,
        packing_at = IF(packing_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR),
        packed_at = IF(packed_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR),
        dispatched_at = IF(dispatched_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR),
        out_at = IF(out_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR), courier_at = IF(courier_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR),
        failed_at = IF(failed_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR),
        delivered_at = IF(delivered_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR) WHERE order_no = ?`,
    [daysAgo * 24 + 6, daysAgo * 24 + 6, today ? 1 : daysAgo * 24 + 5, daysAgo * 24 + 4, daysAgo * 24 + 2, daysAgo === 1 ? 2 : daysAgo * 24 + 2, daysAgo * 24 + 2, h(20), h(20), no]);
    await db.query(`UPDATE order_status_history hs JOIN orders o ON o.order_id = hs.order_id
        SET hs.created_at = CASE hs.to_status WHEN 'packing' THEN o.packing_at WHEN 'packed' THEN o.packed_at WHEN 'out_for_delivery' THEN o.out_at WHEN 'with_courier' THEN o.courier_at
          WHEN 'failed' THEN o.failed_at WHEN 'delivered' THEN o.delivered_at ELSE o.created_at END
      WHERE o.order_no = ? AND hs.to_status <> 'edited'`, [no]);
    await db.query('UPDATE stock_movements SET created_at = UTC_TIMESTAMP() - INTERVAL ? HOUR WHERE note = ?', [daysAgo * 24 + 2, `Dispatched ${no}`]);
    await db.query(`UPDATE invoices i JOIN orders o ON o.order_id = i.order_id
        SET i.issued_at = o.dispatched_at, i.due_on = DATE(CONVERT_TZ(o.dispatched_at, '+00:00', '+05:30')) + INTERVAL IF(o.payment_terms = 'credit', o.credit_days, 0) DAY
      WHERE o.order_no = ?`, [no]);
    await db.query("UPDATE payments p JOIN orders o ON o.order_id = p.order_id SET p.received_on = DATE(CONVERT_TZ(o.delivered_at, '+00:00', '+05:30')), p.created_at = o.delivered_at WHERE o.order_no = ? AND p.mode = 'cash' AND o.delivered_at IS NOT NULL", [no]);
    await db.query('UPDATE pack_scans p JOIN orders o ON o.order_id = p.order_id SET p.created_at = o.packed_at WHERE o.order_no = ? AND o.packed_at IS NOT NULL', [no]);
  }
  // the cost kept on each stock-out = the average cost valid on its (moved back) dispatch day
  const [outs] = await db.query("SELECT move_id, sku_code, created_at FROM stock_movements WHERE move_type = 'out'");
  for (const o of outs) await db.query('UPDATE stock_movements SET unit_cost = ? WHERE move_id = ?', [await stock.costAt(db, o.sku_code, o.created_at), o.move_id]);
  console.log(`demo costs: ${outs.length} stock-out movements carry the average cost of their dispatch day`);
  for (const [tripId, daysAgo] of trips) {
    await db.query(`UPDATE delivery_trips SET trip_date = DATE(CONVERT_TZ(UTC_TIMESTAMP() - INTERVAL ? HOUR, '+00:00', '+05:30')), created_at = UTC_TIMESTAMP() - INTERVAL ? HOUR,
        started_at = UTC_TIMESTAMP() - INTERVAL ? HOUR, ended_at = UTC_TIMESTAMP() - INTERVAL ? HOUR WHERE trip_id = ?`, [daysAgo * 24 + 2, daysAgo * 24 + 3, daysAgo * 24 + 2, Math.max(daysAgo * 24 - 21, 1), tripId]);
    await db.query('UPDATE trip_stops s JOIN orders o ON o.order_id = s.order_id SET s.done_at = COALESCE(o.delivered_at, o.failed_at) WHERE s.trip_id = ?', [tripId]);
  }
  // payments: advance = Razorpay on the order day; cod = cash when delivered; credit = as PAID says
  for (let i = 0; i < placed.length; i += 1) {
    const [no, terms] = placed[i];
    const [[o]] = await db.query("SELECT amount_due, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%Y-%m-%d') AS made, DATE_FORMAT(CONVERT_TZ(delivered_at, '+00:00', '+05:30'), '%Y-%m-%d') AS got FROM orders WHERE order_no = ?", [no]);
    let amount = 0; let mode = 'cash'; let day = o.got; let ref = null;
    if (terms === 'advance') { amount = Number(o.amount_due); mode = 'razorpay'; day = o.made; ref = `pay_DEMO${String(i + 1).padStart(4, '0')}`; }
    else if (terms === 'credit' && PAID[i + 1] !== undefined) {
      amount = PAID[i + 1] === 'full' ? Number(o.amount_due) : Math.round(Number(o.amount_due) * PAID[i + 1]);
      mode = 'bank'; day = o.got || o.made; ref = `UTR DEMO${String(i + 1).padStart(6, '0')}`;
    }
    if (amount > 0) await inTx((q) => commerce.recordPayment(q, no, { amount: String(amount), mode, received_on: day, reference: ref, note: 'DEMO payment' }, 'DZIND002'));
  }

  // returns (after the demo days, so the return window counts from the real delivery day)
  const nth = (i) => placed[i - 1][0]; // the i-th demo order (1-based, as in ORDERS)
  const linesOf = async (no, want) => {
    const [[o]] = await db.query('SELECT order_id FROM orders WHERE order_no = ?', [no]);
    const can = await returns.returnable(db, o.order_id);
    return want.map(([sku, qty]) => { const c = can.filter((x) => x.sku_code === sku).sort((a, b) => b.qty - a.qty)[0]; return { sku_code: sku, batch_id: c.batch_id, qty }; });
  };
  const scanAll = async (q, no) => {
    const [[r]] = await q.query('SELECT return_id FROM returns WHERE return_no = ?', [no]);
    for (const l of await returns.receiveState(q, r.return_id)) {
      for (let i = 0; i < l.qty; i += 1) await returns.receiveScan(q, no, l.batch_no ? `${l.sku_code}/${l.batch_no}` : l.sku_code, 'DZIND002');
    }
    return returns.receiveState(q, r.return_id);
  };
  const inspectAs = (q, no, lines, per, note) => returns.inspect(q, no, { lines: lines.map((l) => ({ line_id: l.line_id, ...per(l) })), note }, 'DZIND002');
  const decideAs = (q, no, lines, per, extra) => returns.decide(q, no, { lines: lines.map((l) => ({ line_id: l.line_id, ...per(l) })), ...extra }, 'DZIND148');
  const madeRet = [];
  const newReturn = async (q, orderNo, want, reason, collection, note) => {
    const r = await returns.createReturn(q, orderNo, { lines: await linesOf(orderNo, want), reason_id: reason, reason_note: note, collection }, 'DZIND148');
    madeRet.push(r.return_no);
    return r.return_no;
  };
  const [[courier]] = await db.query('SELECT courier_id FROM couriers ORDER BY courier_id LIMIT 1');
  // refunded to the wallet (credit note, CGST + SGST)
  await inTx(async (q) => {
    const no = await newReturn(q, nth(5), [['DF008-M50', 2]], 4, 'bring', 'DEMO - ordered the wrong napkin, packs unopened');
    const lines = await scanAll(q, no);
    await inspectAs(q, no, lines, (l) => ({ ok: l.qty }), 'DEMO - sealed, clean');
    await decideAs(q, no, lines, (l) => ({ refund: l.qty }), { method: 'wallet' });
  });
  // partial on the IGST order: courier reverse pickup, 1 pack refunded (less to pay on the credit order), 2 replaced
  await inTx(async (q) => {
    const no = await newReturn(q, nth(26), [['DF044-M100', 3]], 2, 'courier', 'DEMO - lids cracked in transit');
    await returns.setCourier(q, no, { courier_id: courier.courier_id, awb_no: 'RV7051001IN' }, 'DZIND148');
    const lines = await scanAll(q, no);
    await inspectAs(q, no, lines, () => ({ ok: 1, damaged: 2 }), 'DEMO - two packs with cracked lids, one fine');
    await decideAs(q, no, lines, () => ({ refund: 1, replace: 2 }), { method: 'balance' });
  });
  // replaced (damaged pack, a Rs 0 replacement order)
  await inTx(async (q) => {
    const no = await newReturn(q, nth(8), [['DF017-R4', 1]], 3, 'bring', 'DEMO - rolls torn inside the pack');
    const lines = await scanAll(q, no);
    await inspectAs(q, no, lines, (l) => ({ damaged: l.qty }), 'DEMO - torn wrapper, not sellable');
    await decideAs(q, no, lines, (l) => ({ replace: l.qty }), {});
  });
  // closed with no refund (approved)
  const noRefund = await inTx(async (q) => {
    const no = await newReturn(q, nth(7), [['DF014-M100', 1]], 5, 'bring', 'DEMO - customer changed their mind after opening');
    const lines = await scanAll(q, no);
    await inspectAs(q, no, lines, (l) => ({ ok: l.qty }), 'DEMO - opened, half used');
    await decideAs(q, no, lines, (l) => ({ none: l.qty }), { no_refund_reason: 'DEMO - opened and used: not returnable' });
    return no;
  });
  await inTx(async (q) => {
    await q.query("UPDATE approvals SET status = 'approved', decided_by = 'DZIND002', decided_at = UTC_TIMESTAMP() - INTERVAL 3 HOUR, note = 'DEMO - agreed, the pack was used' WHERE ref_type = 'return' AND ref_id = ? AND kind = 'no_refund'", [noRefund]);
    await returns.finalize(q, noRefund, 'DZIND002');
  });
  // inspected (waits for the decision), received (scanned, waits for inspection)
  await inTx(async (q) => {
    const no = await newReturn(q, nth(6), [['DF040-M100', 2]], 1, 'bring', 'DEMO - asked for the 2-ply towel');
    await inspectAs(q, no, await scanAll(q, no), (l) => ({ ok: l.qty }), 'DEMO - unopened');
  });
  await inTx(async (q) => { const no = await newReturn(q, nth(8), [['DF023-R1', 1]], 2, 'bring', 'DEMO - roll crushed'); await scanAll(q, no); });
  // a pickup on a planned trip (the driver marks it Picked up), a courier reverse pickup without AWB yet, one outside
  // the window (waits for approval)
  const pickupTrip = await inTx(async (q) => {
    const no = await newReturn(q, nth(4), [['DF018-R6', 2]], 3, 'trip', 'DEMO - rolls too thin, customer wants them collected');
    return (await delivery.createTrip(q, { return_nos: [no], vehicle_id: veh[1].vehicle_id, driver_id: drv[2].driver_id, area_id: 1 }, 'DZIND002')).trip_id;
  });
  await inTx((q) => newReturn(q, nth(26), [['DF002-M100', 4]], 1, 'courier', 'DEMO - 1-ply sent, 2-ply ordered'));
  await inTx((q) => newReturn(q, nth(1), [['DF013-M50', 2]], 3, 'bring', 'DEMO - customer found it late, outside the window'));
  // demo times: the returns over the last 2 days
  for (let i = 0; i < madeRet.length; i += 1) {
    const hours = 48 - i * 5;
    await db.query(`UPDATE returns SET created_at = UTC_TIMESTAMP() - INTERVAL ? HOUR, received_at = IF(received_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR),
        inspected_at = IF(inspected_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR), closed_at = IF(closed_at IS NULL, NULL, UTC_TIMESTAMP() - INTERVAL ? HOUR) WHERE return_no = ?`,
    [hours, hours - 2, hours - 3, hours - 4, madeRet[i]]);
    await db.query(`UPDATE return_history h JOIN returns r ON r.return_id = h.return_id SET h.created_at = CASE
        WHEN h.status IN ('requested', 'collecting') THEN r.created_at WHEN h.status = 'received' THEN r.received_at WHEN h.status = 'inspected' THEN r.inspected_at
        ELSE COALESCE(r.closed_at, r.inspected_at, r.created_at) END WHERE r.return_no = ?`, [madeRet[i]]);
  }
  console.log(`demo returns: ${madeRet.join(', ')}; pickup on trip T-${pickupTrip} (planned)`);
  // CRM (phase 8): second branches, timeline, follow-ups, on hold, a duplicate pair, a lead converted, a segment
  const cid = async (nm) => (await db.query('SELECT customer_id FROM customers WHERE name = ? AND merged_into IS NULL ORDER BY customer_id LIMIT 1', [nm]))[0][0].customer_id;
  await inTx(async (q) => {
    const sangam = await cid('Demo Hotel Sangam');
    await q.query("UPDATE customer_addresses SET label = 'Branch 1 - Kanchipuram' WHERE customer_id = ?", [sangam]);
    await customers.saveAddress(q, sangam, null, { kind: 'billing', label: 'Branch 2 - Bengaluru', name: 'Demo Hotel Sangam (Bengaluru)', gstin: '29AAACD0001A1Z9', address: 'MG Road', town: 'Bengaluru', state_code: '29', pincode: '560001' }, 'demo-seed');
    await customers.saveAddress(q, sangam, null, { kind: 'shipping', label: 'Branch 2 - Bengaluru', name: 'Demo Hotel Sangam (Bengaluru)', contact_person: 'DEMO Prakash (stores)', phone: '9800000101', address: 'MG Road', town: 'Bengaluru', state_code: '29', pincode: '560001' }, 'demo-seed');
    await customers.saveContact(q, sangam, null, { name: 'DEMO Prakash', role: 'Stores, Bengaluru branch', phone: '9800000101', whatsapp: true }, 'demo-seed');
    const anjappar = await cid('Demo Restaurant Anjappar');
    await q.query("UPDATE customer_addresses SET label = 'Branch 1 - Velachery', gstin = IF(kind = 'billing', '33AAACD0012A1Z2', NULL) WHERE customer_id = ?", [anjappar]);
    await customers.saveAddress(q, anjappar, null, { kind: 'billing', label: 'Branch 2 - Puducherry', name: 'Demo Restaurant Anjappar (Puducherry)', gstin: '34AAACD0012A1Z0', address: 'Mission Street', town: 'Puducherry', state_code: '34', pincode: '605001' }, 'demo-seed');
    await customers.saveAddress(q, anjappar, null, { kind: 'shipping', label: 'Branch 2 - Puducherry', name: 'Demo Restaurant Anjappar (Puducherry)', contact_person: 'DEMO Selvi', phone: '9800000112', address: 'Mission Street', town: 'Puducherry', state_code: '34', pincode: '605001' }, 'demo-seed');
    // timeline typed by hand (calls, visits, WhatsApp, mails, notes) a few days back
    const act = async (nm, kind, daysAgo, note, emp) => {
      await q.query('INSERT INTO customer_activity (customer_id, kind, happened_at, note, emp_id) VALUES (?, ?, UTC_TIMESTAMP() - INTERVAL ? HOUR, ?, ?)', [await cid(nm), kind, daysAgo * 24 + 3, note, emp]);
    };
    await act('Demo Hotel Sangam', 'visit', 12, 'DEMO - visited both kitchens; Bengaluru branch wants its own invoices (its GSTIN)', 'DZIND148');
    await act('Demo Hotel Sangam', 'call', 3, 'DEMO - asked for the overdue invoice to be resent', 'DZIND148');
    await act('Demo City Hospital', 'mail', 6, 'DEMO - sent the price list for hand towels', 'DZIND002');
    await act('Demo Distributor Vellore', 'whatsapp', 2, 'DEMO - shared the new wet wipes offer (10 + 1)', 'DZIND148');
    await act('Demo Bank Branch', 'call', 1, 'DEMO - disputes the last invoice: on hold until settled', 'DZIND002');
    await act('Demo Cafe Thendral', 'note', 4, 'DEMO - prefers delivery before 9 am', 'DZIND002');
    // follow-ups: two overdue, one today, two later
    const fu = async (nm, who, inDays, note) => {
      await q.query("INSERT INTO follow_ups (customer_id, assignee, due_on, note, created_by, created_at) VALUES (?, ?, DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')) + INTERVAL ? DAY, ?, ?, UTC_TIMESTAMP() - INTERVAL 5 DAY)",
        [await cid(nm), who, inDays, note, 'DZIND002']);
    };
    await fu('Demo Hotel Sangam', 'DZIND148', -3, 'DEMO - collect the overdue payment');
    await fu('Demo City Hospital', 'DZIND002', -1, 'DEMO - confirm the bulk towel price');
    await fu('Demo Distributor Vellore', 'DZIND148', 0, 'DEMO - monthly order call');
    await fu('Demo Tech Park Office', 'DZIND002', 5, 'DEMO - quarterly review');
    await fu('Demo Home Priya', 'DZIND148', 8, 'DEMO - festival offer reminder');
    await customers.setStatus(q, await cid('Demo Bank Branch'), 'on_hold', 'DEMO - invoice dispute, new orders need approval', 'DZIND002');
    // the same lodge entered twice (another number): the duplicate pair to merge
    const d = await customers.createCustomer(q, { name: 'Demo Lodge Kamakshi', type_key: 'hotel', phone: '9800000214', email: 'demo.kamakshi@example.com', source: 'WhatsApp', owner_emp_id: 'DZIND002', tags: ['horeca'],
      bill: { label: 'Main', name: 'Demo Lodge Kamakshi', address: 'East Raja Street', town: 'Kanchipuram', state_code: '33', pincode: '631501' },
      contacts: [{ name: 'DEMO Kamakshi reception', role: 'Reception', phone: '9800000214', whatsapp: true }] }, 'demo-seed');
    await q.query("INSERT INTO customer_activity (customer_id, kind, happened_at, note, emp_id) VALUES (?, 'whatsapp', UTC_TIMESTAMP() - INTERVAL 30 HOUR, 'DEMO - asked for the price of rolls on WhatsApp (the reception number)', 'DZIND002')", [d.customer_id]);
    // a lead converted to a customer (its history shows on the customer)
    const [[lead]] = await q.query("SELECT lead_id FROM leads WHERE business_name = 'Test Hotel Pvt Ltd' LIMIT 1");
    if (lead) await customers.fromLead(q, lead.lead_id, { address: 'Ennaikaran Street', pincode: '631501' }, 'demo-seed');
    await q.query("INSERT INTO customer_segments (name, filters, created_by) VALUES ('DEMO Hotels owing money', ?, 'demo-seed')", [JSON.stringify({ type: 'hotel', outstanding_min: '1' })]);
  });
  console.log('demo CRM: 2 hotels with a second branch (GSTIN 29 / 34), 6 timeline entries, 5 follow-ups (2 overdue), Demo Bank Branch on hold, a duplicate Demo Lodge Kamakshi, a lead converted, a segment');

  // cashback of the delivered orders whose return window has passed (the hourly job does this on the live system)
  const cb = await inTx((q) => promotions.cashbackDue(q, 'system'));
  console.log(`demo cashback: ${cb.filter((x) => x.amount > 0).map((x) => `${x.order_no} Rs ${x.amount}`).join(', ') || 'none'} (${cb.length} order(s) past the window)`);
  // wallets: a manual credit through an approved request (Demo Cafe Thendral), one expiring in 10 days (Demo Home
  // Priya), one that expired yesterday (Demo Lodge Kamakshi, taken out by the expiry job)
  const cust = async (nm) => (await db.query('SELECT customer_id FROM customers WHERE name = ?', [nm]))[0][0].customer_id;
  await inTx(async (q) => {
    const cafe = await cust('Demo Cafe Thendral');
    const id = await approvals.request(q, { kind: 'goodwill_credit', refType: 'customer', refId: String(cafe), summary: 'Wallet credit Rs 300.00 for Demo Cafe Thendral: DEMO - goodwill for a late delivery', amount: 300,
      payload: { customer_id: cafe, direction: 'credit', amount: 300, reason: 'DEMO - goodwill for a late delivery' } }, 'DZIND148');
    await q.query("UPDATE approvals SET status = 'approved', decided_by = 'DZIND002', decided_at = UTC_TIMESTAMP() - INTERVAL 2 HOUR, note = 'DEMO - OK, regular customer', requested_at = UTC_TIMESTAMP() - INTERVAL 5 HOUR WHERE approval_id = ?", [id]);
    await wallet.credit(q, { customerId: cafe, source: 'manual', amount: 300, reason: 'Manual credit: DEMO - goodwill for a late delivery', approvalId: id }, 'DZIND002');
    await wallet.credit(q, { customerId: await cust('Demo Home Priya'), source: 'manual', amount: 150, reason: 'Manual credit: DEMO - festival offer, use within 10 days', expiresOn: dayAt(10) }, 'DZIND002');
    const lodge = await cust('Demo Lodge Kamakshi');
    const e = await wallet.credit(q, { customerId: lodge, source: 'manual', amount: 200, reason: 'Manual credit: DEMO - trial credit for 30 days', expiresOn: dayAt(-1) }, 'DZIND002');
    await q.query('UPDATE wallet_entries SET created_at = UTC_TIMESTAMP() - INTERVAL 31 DAY WHERE entry_id = ?', [e]);
  });
  const ex = await inTx((q) => wallet.expireDue(q, 'system'));
  console.log(`demo wallets: Rs 300 manual credit (approved), Rs 150 expiring in 10 days, ${ex.length} expired credit taken out by the job`);
  // inventory after the orders: damaged in the godown, a small sample write-off (posts at once), the expired wet wipes
  // written off (above the threshold: waits for approval), a towels count with two differences (waits for approval)
  await inTx((q) => stock.recordMove(q, { sku_code: 'DF019-R10', qty: 3, move_type: 'damaged', note: 'DEMO carton crushed in the godown' }, 'DZIND002'));
  await inTx((q) => stock.requestWriteOff(q, { sku_code: 'DF001-M100', stock_kind: 'good', qty: 2, reason_type: 'sample', reason: 'DEMO samples for a hotel visit' }, 'DZIND148'));
  const [[expired]] = await db.query("SELECT batch_id FROM batches WHERE batch_no = 'WW2504' LIMIT 1");
  const wo = await inTx((q) => stock.requestWriteOff(q, { sku_code: 'DF044-M100', stock_kind: 'good', batch_id: expired.batch_id, qty: 10, reason_type: 'expired', reason: 'DEMO batch WW2504 expired on the shelf' }, 'DZIND002'));
  const cnt = await inTx((q) => stock.startCount(q, 'towels', 'DZIND002'));
  const det = await stock.countDetail(db, cnt.count_id);
  const DIFF = { 'DF036-M250': -2, 'DF040-M100': 3 };
  await inTx((q) => stock.saveCount(q, cnt.count_id, det.lines.map((l) => ({ line_id: l.line_id, counted: l.system_qty + (DIFF[l.sku_code] || 0) })), 'DZIND002'));
  const sub = await inTx((q) => stock.submitCount(q, cnt.count_id, 'DZIND002'));
  console.log(`demo inventory: damaged 3 x DF019-R10, sample write-off posted, expired write-off #${wo.write_off_id} ${wo.status}, count #${cnt.count_id} ${sub.status} (${sub.differences} differences)`);

  // notifications: a Tamil customer and one that opted out of reminders (both have overdue invoices for the tests)
  await db.query("UPDATE customers SET lang_code = 'ta' WHERE name = 'Demo Hotel Sangam' AND merged_into IS NULL");
  await db.query("UPDATE customers SET opt_out_reminders = 1 WHERE name = 'Demo Distributor Vellore'");
  const [[nm]] = await db.query('SELECT COUNT(*) AS n FROM notification_log');
  console.log(`demo notifications: Demo Hotel Sangam mails in Tamil, Demo Distributor Vellore opted out of reminders; ${nm.n} notification(s) during the seed (muted)`);

  await db.query("UPDATE commerce_settings SET value = '1', updated_by = 'demo-seed', updated_at = UTC_TIMESTAMP() WHERE setting_key = 'commerce_enabled'");
  console.log(`demo: ${CUSTOMERS.length} customers (+ a duplicate to merge and a converted lead), ${made} orders, ${madeRet.length} returns, approvals from the returns, wallet, write-off and count; Commerce switched on`);
  process.exit(0);
})().catch((e) => { console.error('commerce-demo-seed failed:', e.message); process.exit(1); });
