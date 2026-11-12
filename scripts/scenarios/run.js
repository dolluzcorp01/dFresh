// npm run scenarios            every section-NN.js in this folder, in number order
// npm run scenarios -- 12 13   only those sections
// ONLY=12.3,12.5 npm run scenarios -- 12   only those tests of a section
// Prints each test's checks, then one row per section: steps run, passed, failed. Exit code 1 when anything failed.
// The dev database is dumped first and restored before each "Start again" test and at the end (see lib.js).
const fs = require('fs');
const path = require('path');
const lib = require('./lib');

const pick = process.argv.slice(2).map((x) => String(Number(x)).padStart(2, '0'));
const files = fs.readdirSync(__dirname).filter((f) => /^section-\d\d\.js$/.test(f)).sort()
  .filter((f) => !pick.length || pick.includes(f.slice(8, 10)));

(async () => {
  lib.devOnly();
  if (!files.length) { console.error(`No section file for ${pick.join(', ')}`); process.exit(1); }
  const base = lib.tmpFile('base.sql');
  console.log(`dumping ${process.env.DB_NAME} (${await lib.dump(base)} bytes) - it is restored before each test and at the end`);
  const h = await lib.startApi();
  // the dev data has a hand-made "Supervisor" role (32) for Kumar: it gets the v23 Supervisor rights that the migrations
  // give our built-in Operations role (4) on the rows those migrations changed (Returns, Promotions, Expenses)
  const devRoles = async () => {
    const [[r]] = await h.pool.query('SELECT role_id FROM roles WHERE role_id = 32');
    if (!r) return;
    const [cols] = await h.pool.query("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'role_permissions' AND column_name LIKE 'can\\_%'");
    const list = cols.map((x) => x.c);
    await h.pool.query(`INSERT INTO role_permissions (role_id, section, ${list.join(', ')}) SELECT 32, section, ${list.join(', ')} FROM role_permissions WHERE role_id = 4 AND section IN ('returns', 'promotions', 'expenses')
      ON DUPLICATE KEY UPDATE ${list.map((c) => `${c} = VALUES(${c})`).join(', ')}`);
  };
  const fresh = async () => { await lib.restore(base); await devRoles(); };
  const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null;
  const rows = [];
  let crashed = false;
  for (const f of files) {
    const sec = f.slice(8, 10);
    const mod = require(path.join(__dirname, f));
    const counts = { steps: 0, pass: 0, fail: 0, failed: [], test: '' };
    console.log(`\n=== Section ${Number(sec)} - ${mod.title}`);
    const ctx = lib.context(h, counts, fresh);
    ctx.run = (id) => !ONLY || ONLY.includes(id);
    try { await fresh(); await mod.run(ctx); } catch (e) { counts.fail += 1; counts.steps += 1; counts.failed.push(`${counts.test}: crashed ${e.stack || e.message}`); console.log(`  CRASH ${e.stack || e.message}`); crashed = true; }
    rows.push({ sec: Number(sec), title: mod.title, tests: mod.tests || '', ...counts });
  }
  await lib.restore(base);
  await h.close();
  fs.unlinkSync(base);
  console.log('\n| Section | Title | Steps run | Passed | Failed |\n|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.sec} | ${r.title} | ${r.steps} | ${r.pass} | ${r.fail} |`);
  const fails = rows.flatMap((r) => r.failed);
  console.log(`\n${rows.reduce((a, r) => a + r.pass, 0)} passed, ${fails.length} failed${crashed ? ' (a section crashed)' : ''}; ${process.env.DB_NAME} restored`);
  for (const x of fails) console.log(`  FAILED ${x}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
