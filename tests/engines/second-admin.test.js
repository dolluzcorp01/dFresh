// Unit tests of the phase 12b engine rules (src/backend_routes/approval-engine.js), no database: who signs a
// second-Admin request, when an Admin counts as away, when an override is allowed (v23 fix proof N2, N12, F4, Y3).
//   node --test tests/engines/
const test = require('node:test');
const assert = require('node:assert/strict');
const permissions = require('../../src/shared/permissions');
const E = require('../../src/backend_routes/approval-engine');

const TODAY = '2026-11-02';
const all = permissions.permsFor(1);
const person = (emp_id, name, role_id, extra = {}) => ({ emp_id, name, role_id, role_name: name, perms: permissions.isAdminRole(role_id) ? all : permissions.permsFor(99, []),
  is_admin: permissions.isAdminRole(role_id), limit: { kind: permissions.isAdminRole(role_id) ? 'any' : 'none' }, godowns: 'ALL', leave: null, active: true, ...extra });
const team = () => [person('DZIND002', 'Shoban B', 8), person('DZIND148', 'Pavithran V V', 1)];
const by = (ps, id) => ps.find((p) => p.emp_id === id);
const ruleChange = (extra = {}) => ({ approval_id: 1, kind: 'rule_change', section: 'settings', godown_id: 1, amount: 0, requested_by: 'DZIND002', status: 'pending',
  requested_on: TODAY, excluded: [], payload: { t: 'switch', dk: 'switch:split_days' }, ...extra });
const ctx = (ps) => ({ people: ps, today: TODAY, expiryDays: 7, godownNames: { 1: 'Kanchipuram', 2: 'Chennai' } });

test('a rule change is signed only by another Admin, at any godown, never by its asker', () => {
  const ps = team();
  // a custom role with Approve on Settings and "anything" is still not an Admin
  const boss = person('X1', 'Custom boss', 9, { perms: { ...permissions.permsFor(99, []), settings: { view: true, approve: true } }, limit: { kind: 'any' } });
  ps.push(boss);
  by(ps, 'DZIND148').godowns = [2]; // an Admin working at Chennai only still signs a company-wide change
  const q = ruleChange();
  assert.equal(E.decide(by(ps, 'DZIND148'), q, ctx(ps)).ok, true);
  assert.match(E.decide(boss, q, ctx(ps)).why, /second Admin/);
  assert.match(E.decide(by(ps, 'DZIND002'), q, ctx(ps)).why, /You raised it/);
  assert.equal(E.decide(by(ps, 'DZIND148'), { ...q, kind: 'company_bank' }, ctx(ps)).ok, true);
});

test('someone waiting to be added signs nothing (v23 F1)', () => {
  const ps = team();
  by(ps, 'DZIND148').pending = true;
  by(ps, 'DZIND148').active = false;
  assert.match(E.decide(by(ps, 'DZIND148'), ruleChange(), ctx(ps)).why, /waiting to be added/);
});

test('away: a leave the overrider entered for the other Admin never counts (v23 N2, Y3)', () => {
  const ps = team();
  const sh = by(ps, 'DZIND002');
  const pv = by(ps, 'DZIND148');
  pv.leave = { from: TODAY, to: '2026-11-05', standIn: null, setBy: 'DZIND002' };
  assert.equal(E.awayFor(pv, sh, TODAY), false);
  assert.equal(E.othersAway(sh, ps, TODAY), false);
  pv.leave.setBy = 'DZIND148'; // entered by Pavithran himself
  assert.equal(E.othersAway(sh, ps, TODAY), true);
  pv.leave.setBy = 'X9'; // entered by a third person
  assert.equal(E.othersAway(sh, ps, TODAY), true);
});

test('left: by the overrider only after 7 days; by anyone else after 2; by themselves at once (v23 N2)', () => {
  const ps = team();
  const sh = by(ps, 'DZIND002');
  const pv = by(ps, 'DZIND148');
  pv.active = false;
  pv.left = { at: '2026-10-30', by: 'DZIND002' }; // 3 days ago, by Shoban
  assert.equal(E.leftLongEnough(pv, sh, TODAY), false);
  pv.left.at = '2026-10-26'; // 7 days ago
  assert.equal(E.leftLongEnough(pv, sh, TODAY), true);
  pv.left = { at: '2026-11-01', by: 'X9' }; // yesterday, by someone else
  assert.equal(E.leftLongEnough(pv, sh, TODAY), false);
  pv.left.at = '2026-10-31';
  assert.equal(E.leftLongEnough(pv, sh, TODAY), true);
  pv.left = { at: TODAY, by: 'DZIND148' };
  assert.equal(E.leftLongEnough(pv, sh, TODAY), true);
});

test('there must be another Admin to be away: a lone Admin never overrides', () => {
  const ps = [person('DZIND002', 'Shoban B', 8)];
  assert.equal(E.othersAway(ps[0], ps, TODAY), false);
});

test('override: only a rule change, never who can sign or a bank change, only when nobody else can sign (v23 N12, F4)', () => {
  const ps = team();
  const sh = by(ps, 'DZIND002');
  by(ps, 'DZIND148').leave = { from: TODAY, to: '2026-11-05', standIn: null, setBy: 'DZIND148' };
  const q = ruleChange({ requested_by: 'DZIND002' });
  assert.equal(E.overrideProblem(sh, q, ctx(ps)), '');
  for (const t of ['staffadd', 'stafflim', 'staffscope', 'staffrole', 'staffadm', 'roleperm', 'staffback']) {
    assert.match(E.overrideProblem(sh, { ...q, payload: { t } }, ctx(ps)), /never overridden/, t);
  }
  assert.match(E.overrideProblem(sh, { ...q, kind: 'company_bank', payload: { t: 'bank' } }, ctx(ps)), /bank change is never overridden/);
  assert.match(E.overrideProblem(sh, q, ctx(ps), { override_id: 5 }), /already waits/);
  by(ps, 'DZIND148').leave = null; // Pavithran is back: he can sign it, so no override
  assert.match(E.overrideProblem(sh, q, ctx(ps)), /Somebody else can sign/);
});

test('override: a third Admin who is present blocks it; the overrider on leave cannot', () => {
  const ps = [...team(), person('A3', 'Third Admin', 1)];
  const sh = by(ps, 'DZIND002');
  by(ps, 'DZIND148').leave = { from: TODAY, to: '2026-11-05', standIn: null, setBy: 'DZIND148' };
  assert.match(E.overrideProblem(sh, ruleChange(), ctx(ps)), /Somebody else can sign/);
  by(ps, 'A3').active = false;
  by(ps, 'A3').left = { at: '2026-10-01', by: 'X9' };
  assert.equal(E.overrideProblem(sh, ruleChange(), ctx(ps)), '');
  sh.leave = { from: TODAY, to: TODAY, standIn: null, setBy: 'DZIND002' };
  assert.match(E.overrideProblem(sh, ruleChange(), ctx(ps)), /on leave/);
});
