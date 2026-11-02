// Unit tests of the approval engine (src/backend_routes/approval-engine.js): the ladder, limits, godowns, stand-ins,
// leave rules, split counting, excluded signers, expiry. The people are v23's section 0 sample staff
// (docs/reference/dFresh_Back_Office_v23.html, TODAY 2026-10-28) on our sections: Supervisor approves Inventory,
// Packing and Returns-inspection work at their godown (v23: inventory, production, packing, returns), not refunds
// (v23 puts refunds under Payments, which a Supervisor cannot approve: here the refund test uses section 'orders').
//   node --test tests/engines/
const test = require('node:test');
const assert = require('node:assert/strict');
const permissions = require('../../src/shared/permissions');
const E = require('../../src/backend_routes/approval-engine');

const TODAY = '2026-10-28';
const K = 1;
const C = 2;
const grid = (spec) => { // { section: 'vca' } letters: v view, c create, e edit, a approve
  const out = permissions.permsFor(99, []);
  for (const [s, t] of Object.entries(spec)) out[s] = { ...out[s], view: t.includes('v'), create: t.includes('c'), edit: t.includes('e'), approve: t.includes('a') };
  return out;
};
// the Sub-admin grid as migration 20261102_stage2_12b_01 seeds it: everything; Roles and users and Settings view only
const SUB_ROWS = permissions.SECTION_KEYS.map((section) => {
  const full = ['users', 'settings', 'audit'].includes(section) ? 0 : 1;
  return { section, can_view: 1, can_create: full, can_edit: full, can_approve: full, can_cancel: full, can_export: full, can_delete: full };
});
const ROLE = {
  super: { role_id: 8, role_name: 'Super admin', perms: permissions.permsFor(8), is_admin: true, limit: { kind: 'any' } },
  admin: { role_id: 1, role_name: 'Admin', perms: permissions.permsFor(1), is_admin: true, limit: { kind: 'any' } },
  sub: { role_id: 2, role_name: 'Sub-admin', perms: permissions.permsFor(2, SUB_ROWS), limit: { kind: 'amount', amount: 25000 } },
  supervisor: { role_id: 3, role_name: 'Supervisor', perms: grid({ inventory: 'vcea', packing: 'vcea', returns: 'vcea', orders: 'v' }), limit: { kind: 'amount', amount: 2000 } },
  warehouse: { role_id: 4, role_name: 'Warehouse', perms: grid({ inventory: 'vc', packing: 'vce', returns: 'vc' }), limit: { kind: 'none' } },
  delivery: { role_id: 5, role_name: 'Delivery', perms: grid({ delivery: 've' }), limit: { kind: 'none' } },
  sales: { role_id: 6, role_name: 'Sales', perms: grid({ customers: 'vce', orders: 'vce' }), limit: { kind: 'none' } },
};
const person = (emp_id, name, role, godowns, extra = {}) => ({ emp_id, name, ...ROLE[role], godowns, active: true, leave: null, ...extra });

function staff() {
  return [
    person('DZIND002', 'Shoban B', 'super', 'ALL'),
    person('DZIND148', 'Pavithran V V', 'admin', 'ALL'),
    person('DFMGR01', 'Anitha R', 'sub', 'ALL'),
    person('DFSUP01', 'Kumar M', 'supervisor', [K], { leave: { from: '2026-10-28', to: '2026-10-31', standIn: 'DFSUP02', setBy: 'DZIND002' } }),
    person('DFSUP02', 'Lakshmi P', 'supervisor', [C], { limit: { kind: 'amount', amount: 5000, personal: true } }),
    person('DFEMP01', 'Murugan S', 'warehouse', [K]),
    person('DFEMP02', 'Selvi R', 'warehouse', [C]),
    person('DFEMP03', 'Raja K', 'delivery', [K, C]),
    person('DFSAL01', 'Divya N', 'sales', [K, C]),
  ];
}
const ctx = (people, extra = {}) => ({ people, today: TODAY, expiryDays: 7, godownNames: { [K]: 'Kanchipuram godown', [C]: 'Chennai godown (example)' }, ...extra });
const req = (extra) => ({ approval_id: 1, status: 'pending', requested_on: TODAY, excluded: [], amount: 0, ...extra });
const names = (lad) => lad.map((x) => (x.via ? `${x.person.name} (for ${x.via.name})` : x.person.name));
const byId = (ps, id) => ps.find((p) => p.emp_id === id);

test('0.1 nobody signs their own request', () => {
  const ps = staff();
  const q = req({ kind: 'over_available', section: 'orders', godown_id: K, amount: 86400, requested_by: 'DZIND148' });
  const d = E.decide(byId(ps, 'DZIND148'), q, ctx(ps));
  assert.equal(d.ok, false);
  assert.match(d.why, /You raised it/);
  assert.equal(E.decide(byId(ps, 'DZIND002'), q, ctx(ps)).ok, true);
});

test('0.2 a request waits for the smallest limit that covers it (requester and their stand-in left out)', () => {
  const ps = staff();
  const q = req({ kind: 'write_off', section: 'inventory', godown_id: K, amount: 4100, requested_by: 'DFSUP01' });
  assert.deepEqual(names(E.ladder(q, ctx(ps))), ['Anitha R', 'Pavithran V V', 'Shoban B']);
});

test('0.3 too small a limit moves it up', () => {
  const ps = staff();
  const q = req({ kind: 'over_available', section: 'orders', godown_id: C, amount: 30000, requested_by: 'DFSAL01' });
  assert.deepEqual(names(E.ladder(q, ctx(ps))), ['Pavithran V V', 'Shoban B']);
  const a = E.decide(byId(ps, 'DFMGR01'), q, ctx(ps));
  assert.equal(a.ok, false);
  assert.match(a.why, /limit is Rs 25,000/);
  assert.match(E.decide(byId(ps, 'DFSUP02'), q, ctx(ps)).why, /cannot approve Orders/);
});

test('0.4 a stand-in signs with the absent person\'s rights (Kanchipuram scope, Rs 2,000)', () => {
  const ps = staff();
  const q = req({ kind: 'write_off', section: 'inventory', godown_id: K, amount: 1200, requested_by: 'DFEMP01' });
  const d = E.decide(byId(ps, 'DFSUP02'), q, ctx(ps));
  assert.equal(d.ok, true);
  assert.equal(d.via.name, 'Kumar M');
  assert.deepEqual(names(E.ladder(q, ctx(ps)))[0], 'Lakshmi P (for Kumar M)');
});

test('0.5 someone on leave cannot sign', () => {
  const ps = staff();
  const q = req({ kind: 'write_off', section: 'inventory', godown_id: K, amount: 500, requested_by: 'DFEMP01' });
  const d = E.decide(byId(ps, 'DFSUP01'), q, ctx(ps));
  assert.equal(d.ok, false);
  assert.match(d.why, /on leave until 2026-10-31\. Lakshmi P is standing in/);
});

test('0.6 godown scope decides what you can sign', () => {
  const ps = staff();
  byId(ps, 'DFSUP01').leave = null; // Kumar: stand-in set to nobody
  const atK = req({ kind: 'write_off', section: 'inventory', godown_id: K, amount: 1200, requested_by: 'DFEMP01' });
  const atC = req({ approval_id: 2, kind: 'stock_count', section: 'inventory', godown_id: C, amount: 740, requested_by: 'DFEMP02' });
  assert.match(E.decide(byId(ps, 'DFSUP02'), atK, ctx(ps)).why, /works at Chennai godown \(example\), not Kanchipuram godown/);
  assert.equal(E.decide(byId(ps, 'DFSUP02'), atC, ctx(ps)).ok, true);
});

test('0.7 a personal limit beats the role default; 0.8 a role default moves everybody without a personal one', () => {
  const ps = staff();
  const q = req({ kind: 'write_off', section: 'inventory', godown_id: K, amount: 400, requested_by: 'DFEMP03' });
  byId(ps, 'DFEMP01').perms = grid({ inventory: 'vca' });
  assert.equal(E.decide(byId(ps, 'DFEMP01'), q, ctx(ps)).ok, false); // role: nothing
  byId(ps, 'DFEMP01').limit = { kind: 'amount', amount: 500, personal: true };
  assert.equal(E.decide(byId(ps, 'DFEMP01'), q, ctx(ps)).ok, true);
  // Supervisor default 2000 -> 3000: Kumar follows, Lakshmi keeps her personal 5000
  for (const p of ps) if (p.role_id === 3 && !p.limit.personal) p.limit = { kind: 'amount', amount: 3000 };
  assert.equal(E.limitText(byId(ps, 'DFSUP01').limit), 'Rs 3,000');
  assert.equal(E.limitText(byId(ps, 'DFSUP02').limit), 'Rs 5,000');
});

test('0.9 a tick without money signs nothing', () => {
  const ps = staff();
  for (const p of ps) if (p.role_id === 4) p.perms = grid({ inventory: 'vca' }); // Warehouse: Approve on Inventory, limit nothing
  const q = req({ kind: 'write_off', section: 'inventory', godown_id: K, amount: 0, requested_by: 'DFSUP02' });
  const lad = names(E.ladder(q, ctx(ps)));
  assert.ok(!lad.includes('Murugan S') && !lad.includes('Selvi R'), lad.join(', '));
});

test('0.13 a request nobody can sign is flagged (empty ladder)', () => {
  const ps = staff();
  byId(ps, 'DZIND148').is_admin = false;
  byId(ps, 'DZIND148').limit = { kind: 'amount', amount: 25000, personal: true };
  const q = req({ kind: 'write_off', section: 'inventory', godown_id: C, amount: 30000, requested_by: 'DZIND002' });
  assert.deepEqual(E.ladder(q, ctx(ps)), []);
});

test('0.49 Admin signs anything, like the Super admin', () => {
  const ps = staff();
  const q = req({ kind: 'over_available', section: 'orders', godown_id: C, amount: 30000, requested_by: 'DFSAL01' });
  const lad = names(E.ladder(q, ctx(ps)));
  assert.deepEqual(lad, ['Pavithran V V', 'Shoban B']);
  assert.ok(!lad.includes('Anitha R'));
});

test('0.30 a stand-in must already hold the absent person\'s powers', () => {
  const ps = staff();
  const kumar = byId(ps, 'DFSUP01');
  const why = (id) => E.standInProblem(byId(ps, id), kumar, '2026-11-02', '2026-11-03');
  assert.match(why('DFEMP01'), /cannot approve Packing, Inventory, Returns, which Kumar M can/);
  assert.match(why('DFSAL01'), /cannot approve/);
  assert.equal(why('DFSUP02'), '');
  assert.equal(why('DFMGR01'), '');
  assert.equal(why('DZIND148'), '');
});

test('0.31 someone on leave signs nothing, and two people cannot cover each other', () => {
  const ps = staff();
  const lakshmi = byId(ps, 'DFSUP02');
  const p = E.leaveProblem({ who: lakshmi, by: byId(ps, 'DZIND002'), from: '2026-10-29', to: '2026-10-30', standIn: 'DZIND148', today: TODAY, people: ps });
  assert.match(p, /Lakshmi P is standing in for Kumar M on those dates/);
  assert.match(E.standInProblem(byId(ps, 'DFSUP01'), lakshmi, '2026-11-05', '2026-11-06'), /signs up to Rs 2,000, less than Lakshmi P's Rs 5,000/);
});

test('leave of an Admin: by that Admin, or by another Admin 2+ days ahead, at most 30 days, never over their own entry', () => {
  const ps = staff();
  const pav = byId(ps, 'DZIND148');
  const shoban = byId(ps, 'DZIND002');
  assert.match(E.leaveProblem({ who: pav, by: shoban, from: TODAY, to: TODAY, today: TODAY, people: ps }), /starts at least 2 days ahead \(2026-10-30\)/);
  assert.match(E.leaveProblem({ who: pav, by: shoban, from: '2026-10-30', to: '2026-12-15', today: TODAY, people: ps }), /at most 30 days/);
  assert.equal(E.leaveProblem({ who: pav, by: shoban, from: '2026-10-30', to: '2026-11-05', today: TODAY, people: ps }), '');
  assert.equal(E.leaveProblem({ who: pav, by: pav, from: TODAY, to: TODAY, today: TODAY, people: ps }), '');
  pav.leave = { from: '2026-11-10', to: '2026-11-12', standIn: null, setBy: 'DZIND148' };
  assert.match(E.leaveProblem({ who: pav, by: shoban, from: '2026-11-10', to: '2026-11-13', today: TODAY, people: ps }), /entered their own leave/);
  assert.match(E.leaveProblem({ who: pav, by: shoban, from: null, to: null, today: TODAY, people: ps }), /only they can change it/);
});

test('0.33 splitting a request does not beat a limit: three Rs 1,400 write-offs count as Rs 4,200', () => {
  const ps = staff();
  const rule = { is_on: 1, unit: 'Rs', limit_value: 1000, limit_packs: 20 };
  assert.equal(E.needs(rule, { amount: 1400, qty: 2 }, { total: 2800, count: 2 }).total, 4200);
  const q = req({ kind: 'write_off', section: 'inventory', godown_id: K, amount: 1400, requested_by: 'DFEMP01' });
  const split = { total: 4200, count: 3 };
  const lad = names(E.ladder(q, ctx(ps, { split })));
  assert.equal(lad[0], 'Anitha R');
  assert.ok(!lad.some((n) => n.startsWith('Lakshmi')), lad.join(', '));
  assert.equal(names(E.ladder(q, ctx(ps, { split: { total: 1400, count: 1 } })))[0], 'Lakshmi P (for Kumar M)'); // alone: hers
  assert.match(E.splitNote(split, 3), /2 other request\(s\) .* last 3 days: Rs 4,200 in all/);
});

test('0.37 a write-off needs approval by rupees or by packs; the card counts the first one of the day', () => {
  const rule = { is_on: 1, unit: 'Rs', limit_value: 1000, limit_packs: 20 };
  assert.equal(E.needs(rule, { amount: 500, qty: 10 }).needs, false);
  const second = E.needs(rule, { amount: 500, qty: 25 }, { total: 500, count: 1 });
  assert.equal(second.needs, true);
  assert.equal(second.total, 1000);
  assert.equal(E.needs({ ...rule, is_on: 0 }, { amount: 99999, qty: 999 }).needs, false);
  assert.equal(E.needs({ is_on: 1, unit: '%', limit_value: 10 }, { pct: 12 }).needs, true);
  assert.equal(E.needs({ is_on: 1, unit: 'all' }, {}).needs, true);
});

test('F small refunds do not beat the limit (Days that count together)', () => {
  const rule = { is_on: 1, unit: 'Rs', limit_value: 2000 };
  assert.equal(E.needs(rule, { amount: 1800 }, { total: 0, count: 0 }).needs, false);
  const second = E.needs(rule, { amount: 1800 }, { total: 1800, count: 1 });
  assert.deepEqual([second.needs, second.total], [true, 3600]);
});

test('G / H the sender and receiver of a transfer never sign its loss, nor anyone standing in for them', () => {
  const ps = staff();
  byId(ps, 'DFSUP01').leave = null;
  const q = req({ kind: 'write_off', section: 'inventory', godown_id: C, amount: 900, requested_by: 'DFEMP02', excluded: ['DFSUP01', 'DFSUP02'] });
  assert.match(E.decide(byId(ps, 'DFSUP01'), q, ctx(ps)).why, /part of this record/);
  assert.match(E.decide(byId(ps, 'DFSUP02'), q, ctx(ps)).why, /part of this record/);
  // Lakshmi on leave with Kumar standing in: Kumar may not sign as her stand-in either
  byId(ps, 'DFSUP02').leave = { from: '2026-10-28', to: '2026-10-29', standIn: 'DFSUP01', setBy: 'DZIND002' };
  byId(ps, 'DFSUP01').limit = { kind: 'amount', amount: 5000, personal: true };
  const lad = names(E.ladder(q, ctx(ps)));
  assert.ok(!lad.some((n) => /Kumar|Lakshmi/.test(n)), lad.join(', '));
  assert.deepEqual(lad, ['Anitha R', 'Pavithran V V', 'Shoban B']);
});

test('requests expire after the Switches days and then nobody can sign them', () => {
  const ps = staff();
  const q = req({ kind: 'write_off', section: 'inventory', godown_id: K, amount: 100, requested_by: 'DFEMP01', requested_on: '2026-10-27' });
  assert.equal(E.ladder(q, ctx(ps, { expiryDays: 1 })).length, 0);
  assert.match(E.decide(byId(ps, 'DZIND002'), q, ctx(ps, { expiryDays: 1 })).why, /expired/);
  assert.ok(E.ladder(q, ctx(ps, { expiryDays: 7 })).length > 0);
});

test('a second-Admin rule is never signed through a stand-in', () => {
  const ps = staff();
  byId(ps, 'DZIND148').leave = { from: '2026-10-27', to: '2026-10-30', standIn: 'DFMGR01', setBy: 'DZIND148' };
  byId(ps, 'DFMGR01').perms = permissions.permsFor(1);
  byId(ps, 'DFMGR01').limit = { kind: 'any' };
  const q = req({ kind: 'rule_change', section: 'settings', godown_id: K, amount: 0, requested_by: 'DZIND002' });
  const d = E.decide(byId(ps, 'DFMGR01'), q, ctx(ps));
  assert.equal(Boolean(d.via), false);
  const sub = { ...byId(ps, 'DFMGR01'), perms: permissions.permsFor(2, SUB_ROWS) }; // Sub-admin: no Approve on Settings itself
  assert.equal(E.decide(sub, q, ctx(ps.map((p) => (p.emp_id === 'DFMGR01' ? sub : p)))).ok, false);
});

test('someone who left signs nothing', () => {
  const ps = staff();
  byId(ps, 'DFMGR01').active = false;
  const q = req({ kind: 'write_off', section: 'inventory', godown_id: K, amount: 100, requested_by: 'DFEMP01' });
  assert.match(E.decide(byId(ps, 'DFMGR01'), q, ctx(ps)).why, /has left/);
});
