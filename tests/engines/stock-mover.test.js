// Unit tests of the one stock mover (src/backend_routes/stock.js moveStock / moveShelf) on the dev database, inside one
// transaction that is always rolled back (nothing stays): two test godowns, three batches of one SKU (earlier expiry,
// later expiry, expired). Needs DB_NAME of a dev database with the 12a migrations (refuses NODE_ENV=production).
//   node --test --test-force-exit tests/engines/
require('dotenv').config({ quiet: true });
const test = require('node:test');
const assert = require('node:assert/strict');

if (process.env.NODE_ENV === 'production') throw new Error('stock-mover tests: not on production');
const { getDBConnection } = require('../../config/db');
const stock = require('../../src/backend_routes/stock');

const SKU = 'DF001-M100';
const EMP = 'test-engines';
let q;
let X1;
let X2;
const B = {};
const lots = (moved) => moved.map((l) => `${l.batch_id === B.old ? 'OLD' : l.batch_id === B.new ? 'NEW' : l.batch_id === B.exp ? 'EXP' : l.batch_id}:${l.qty}`).join(' ');
const shelfQty = (godown, shelf, batch = null) => stock.onShelf(q, { sku: SKU, godown, shelf, batch });

test.before(async () => {
  q = await getDBConnection(process.env.DB_NAME || 'dfresh').promise().getConnection();
  await q.beginTransaction();
  X1 = (await q.query("INSERT INTO locations (code, name, address, in_number) VALUES ('ZX1', 'Test godown 1', 'test', 1)"))[0].insertId;
  X2 = (await q.query("INSERT INTO locations (code, name, address, in_number) VALUES ('ZX2', 'Test godown 2', 'test', 1)"))[0].insertId;
  const add = async (no, mfg, exp) => (await q.query('INSERT INTO batches (sku_code, batch_no, mfg_date, expiry_date, created_by) VALUES (?, ?, ?, ?, ?)', [SKU, no, mfg, exp, EMP]))[0].insertId;
  B.old = await add('ZT-OLD', '2026-01-01', '2027-01-31');
  B.new = await add('ZT-NEW', '2026-02-01', '2027-06-30');
  B.exp = await add('ZT-EXP', '2024-01-01', '2025-01-31');
});
test.after(async () => {
  await q.rollback();
  q.release();
});

test('in: one movement on the named batch, per godown and shelf', async () => {
  await stock.moveStock(q, { sku: SKU, godown: X1, qty: 5, batch: B.new, what: 'production' }, EMP);
  await stock.moveStock(q, { sku: SKU, godown: X1, qty: 5, batch: B.old, what: 'production' }, EMP);
  assert.equal(await shelfQty(X1, 'good'), 10);
  assert.equal(await shelfQty(X2, 'good'), 0);
});

test('out without a batch: lots earliest expiry first', async () => {
  const moved = await stock.moveStock(q, { sku: SKU, godown: X1, qty: -7, what: 'out', doc: { type: 'order', id: 'TEST' } }, EMP);
  assert.equal(lots(moved), 'OLD:5 NEW:2');
  assert.equal(await shelfQty(X1, 'good'), 3);
});

test('never below zero', async () => {
  await assert.rejects(stock.moveStock(q, { sku: SKU, godown: X1, qty: -4, what: 'out' }, EMP), /Not enough DF001-M100 on the Good shelf: 3 there, 4 needed/);
  assert.equal(await shelfQty(X1, 'good'), 3);
});

test('a named batch is strict; strict false takes it first, then the others', async () => {
  await stock.moveStock(q, { sku: SKU, godown: X1, qty: 5, batch: B.old, what: 'production' }, EMP); // OLD 5, NEW 3
  await assert.rejects(stock.moveStock(q, { sku: SKU, godown: X1, qty: -4, batch: B.new, what: 'out' }, EMP), /in that batch on the Good shelf: 3 there, 4 needed/);
  const moved = await stock.moveStock(q, { sku: SKU, godown: X1, qty: -4, batch: B.new, strict: false, what: 'out' }, EMP);
  assert.equal(lots(moved), 'NEW:3 OLD:1');
});

test('the godown is its own stock: what is in godown 1 cannot leave godown 2', async () => {
  await assert.rejects(stock.moveStock(q, { sku: SKU, godown: X2, qty: -1, what: 'out' }, EMP), /0 there, 1 needed/);
});

test('expired lots never leave Good for a sale or transfer, but can be written off', async () => {
  await stock.moveStock(q, { sku: SKU, godown: X2, qty: 4, batch: B.exp, what: 'production' }, EMP);
  await assert.rejects(stock.moveStock(q, { sku: SKU, godown: X2, qty: -1, what: 'out' }, EMP), /0 there \(4 expired, blocked\), 1 needed/);
  await assert.rejects(stock.moveStock(q, { sku: SKU, godown: X2, qty: -1, batch: B.exp, what: 'transfer' }, EMP), /expired, it cannot leave Good/);
  const wo = await stock.moveStock(q, { sku: SKU, godown: X2, qty: -1, batch: B.exp, what: 'write_off' }, EMP);
  assert.equal(lots(wo), 'EXP:1');
});

test('a recheck never brings an expired batch back to Good', async () => {
  await stock.moveStock(q, { sku: SKU, godown: X2, shelf: 'ret', qty: 2, batch: B.exp, what: 'return' }, EMP);
  await assert.rejects(stock.moveShelf(q, { sku: SKU, godown: X2, from: 'ret', to: 'good', qty: 1, batch: B.exp, what: 'recheck' }, EMP), /has expired: it cannot go back to Good/);
});

test('a shelf move keeps the lots (good -> damaged), and an unknown shelf is refused', async () => {
  const moved = await stock.moveShelf(q, { sku: SKU, godown: X1, from: 'good', to: 'dmg', qty: 2, what: 'damaged' }, EMP);
  assert.equal(lots(moved), 'OLD:2');
  assert.equal(await shelfQty(X1, 'dmg', B.old), 2);
  await assert.rejects(stock.moveStock(q, { sku: SKU, godown: X1, shelf: 'expired', qty: 1, what: 'return' }, EMP), /unknown shelf/);
});

test('the godown is required', async () => {
  await assert.rejects(stock.moveStock(q, { sku: SKU, qty: 1, what: 'production' }, EMP), /the godown is required/);
});
