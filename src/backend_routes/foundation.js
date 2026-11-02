// Foundation routes (phase 12a, docs/claude-tasks/done/phase-12a-core-godowns-rights-approvals.md): Admin > Godowns,
// Staff, Approval rules, Stand-ins (Roles: Admin_server.js, its "Roles and permissions" block). Registered by
// Admin_server.js on its route helper (every route declares its permission, the start-up check refuses an undeclared one).
// The who-may-change-whom rules (v23 Foundation, section 0 tests), checked on the server whatever the screen shows:
// - nobody changes their own row (their leave excepted: an Admin enters their own leave), the Super admin's row is never
//   changed by anybody else, only the Super admin makes or changes an Admin, only an Admin changes a Sub-admin or gives
//   that role, the Super admin role is never given;
// - a person who is not an Admin gives at most what they have: roles within their own rights and limit, a personal
//   limit up to their own, only godowns they work at.
// Leave and stand-ins use approval-engine.js (leaveProblem, standInProblem); the ladder lives in approvals.js.
// Phase 12b (second-admin.js): what widens who can sign waits for a second Admin: a higher limit, a wider godown scope,
// a role that signs more, taking the Admin role away, narrowing an Admin's godowns or lowering an Admin's limit, an
// approval rule switched off or loosened. The rest of the same save is done at once; the reply lists what waits.
// Approval rules are shown, view only, to anyone with View on Roles and users or on Settings (v23 "Foundation").
const { audit } = require('./audit');
const permissions = require('../shared/permissions');
const engine = require('./approval-engine');
const approvals = require('./approvals');
const godowns = require('./godowns');
const pricing = require('./pricing');
const commerceSettings = require('./commerce-settings');
const numbering = require('./numbering');
const secondAdmin = require('./second-admin');
const notifications = require('./notifications');

const STATE_CODE = { 'Tamil Nadu': '33', Karnataka: '29', 'Andhra Pradesh': '37', Telangana: '36', Kerala: '32', Puducherry: '34', Maharashtra: '27', Delhi: '07' };
const STATES = Object.keys(STATE_CODE);
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const SECTION_LABEL = Object.fromEntries(permissions.SECTIONS.map((s) => [s.key, s.label]));
const isSuper = (p) => Number(p.role_id) === permissions.SUPERADMIN_ROLE_ID;

/** the rights in `grid` (a role's perms) that `me` does not have: ['Approve on Orders', ...] ('' list = within) */
function missingRights(grid, me) {
  if (me.is_admin) return [];
  const miss = [];
  for (const s of permissions.SECTION_KEYS) {
    for (const a of permissions.ACTIONS) if (grid[s] && grid[s][a] && !permissions.can(me.perms, s, a)) miss.push(`${a[0].toUpperCase()}${a.slice(1)} on ${SECTION_LABEL[s] || s}`);
  }
  return miss;
}
const limitFrom = (kind, amount) => ({ kind, amount: amount === null || amount === undefined ? null : Number(amount) });
/** a limit from the admin: { kind: none | any | amount, amount } (role: also 'role' = the role's default) */
function cleanLimit(raw, { allowRole = false, InputError }) {
  const kind = raw && raw.kind;
  if (allowRole && kind === 'role') return { kind: 'role', amount: null };
  if (kind === 'none' || kind === 'any') return { kind, amount: null };
  if (kind === 'amount') {
    const s = String(raw.amount ?? '').trim();
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) throw new InputError('Limit: an amount in Rs, e.g. 5000 (type 0 if this should sign nothing above Rs 0)');
    return { kind: 'amount', amount: Number(s) };
  }
  throw new InputError(allowRole ? 'Limit: role default, nothing, anything or an amount' : 'Limit: nothing, anything or an amount');
}

/** the role row with its grid and limit */
async function roleInfo(q, roleId) {
  const [[r]] = await q.query('SELECT role_id, name, limit_kind, limit_amount, see_cost, own_customers_only, is_builtin FROM roles WHERE role_id = ?', [Number(roleId)]);
  if (!r) return null;
  const builtin = permissions.isAdminRole(r.role_id);
  const [rows] = builtin ? [[]] : await q.query('SELECT section, can_view, can_create, can_edit, can_approve, can_cancel, can_export, can_delete FROM role_permissions WHERE role_id = ?', [r.role_id]);
  const isAdmin = permissions.isAdminRole(r.role_id);
  return { ...r, perms: permissions.permsFor(r.role_id, rows), is_admin: isAdmin, limit: isAdmin ? { kind: 'any', amount: null } : limitFrom(r.limit_kind, r.limit_amount), see_cost: builtin || Number(r.see_cost) === 1 };
}

/**
 * may `me` give role `roleId` to someone (or keep them on it)? -> '' or why not. Super admin: never; Admin: only the
 * Super admin; Sub-admin: only an Admin; another role: an Admin, or someone holding at least its rights and limit.
 */
async function roleGiveProblem(q, me, roleId) {
  const r = await roleInfo(q, roleId);
  if (!r) return 'Choose a role';
  if (Number(r.role_id) === permissions.SUPERADMIN_ROLE_ID) return 'The Super admin role is never given.';
  if (Number(r.role_id) === permissions.ADMIN_ROLE_ID && !isSuper(me)) return 'Only the Super admin makes someone an Admin.';
  if (Number(r.role_id) === permissions.SUBADMIN_ROLE_ID && !me.is_admin) return 'Only an Admin gives the Sub-admin role.';
  if (me.is_admin) return '';
  const miss = missingRights(r.perms, me);
  if (miss.length) return `${r.name} has rights you do not have (${miss.slice(0, 3).join(', ')}${miss.length > 3 ? ` and ${miss.length - 3} more` : ''}).`;
  if (engine.limitNum(r.limit) > engine.limitNum(me.limit)) return `${r.name} signs up to ${engine.limitText(r.limit)}, more than your ${engine.limitText(me.limit)}.`;
  if (r.see_cost && !me.seesCost) return `${r.name} sees costs, which you do not.`;
  return '';
}

/** may `me` change the row of `target` (a person from approvals.people())? leaveOnly: only their leave changes */
function rowProblem(me, target, { leaveOnly = false } = {}) {
  if (target.emp_id === me.emp_id) return leaveOnly ? '' : 'Nobody changes their own role, limit or godowns. Ask an Admin.';
  if (isSuper(target)) return "The Super admin's row cannot be changed here. That stops anybody locking the company out.";
  if (Number(target.role_id) === permissions.ADMIN_ROLE_ID && !isSuper(me)) return 'Only the Super admin changes an Admin.';
  if (Number(target.role_id) === permissions.SUBADMIN_ROLE_ID && !me.is_admin) return 'Only an Admin changes a Sub-admin.';
  if (!me.is_admin && (engine.limitNum(target.limit) > engine.limitNum(me.limit) || missingRights(target.perms, me).length)) {
    return `${target.name} has rights or a limit above yours, so only someone above them can change their row.`;
  }
  return '';
}

/** does role b sign more than role a? (an Approve a lacks, a higher limit, See cost: v23 roleWider) */
function roleWider(a, b) {
  if (!a || !b) return false;
  if (engine.limitNum(b.limit) > engine.limitNum(a.limit)) return true;
  if (b.see_cost && !a.see_cost) return true;
  return permissions.SECTION_KEYS.some((s) => permissions.can(b.perms, s, 'approve') && !permissions.can(a.perms, s, 'approve'));
}
/** can this person sign anything? (an Approve right, a limit above nothing, or See cost: v23 staffSigns) */
function signs(role, limit) {
  return permissions.SECTION_KEYS.some((s) => permissions.can(role.perms, s, 'approve')) || engine.limitNum(limit) >= 0 || Boolean(role.see_cost);
}
const limitWords = (l) => (l === 'role' ? 'role default' : engine.limitText(l));

function register({ route, tx, db, by, InputError, canDo }) {
  const people = async (q) => approvals.people(q);
  const meOf = (list, req) => list.find((p) => p.emp_id === req.admin.emp_id) || { ...req.admin, name: req.admin.emp_id, active: true };
  async function companyState(q) {
    const cs = await commerceSettings.read(q);
    const code = String(cs.invoice_seller_state_code || '33');
    return STATES.find((s) => STATE_CODE[s] === code) || 'Tamil Nadu';
  }

  // ------------------------------------------------------------------------------------------- godowns
  async function godownFacts(q, id) {
    const [[st]] = await q.query('SELECT COALESCE(SUM(delta), 0) AS packs FROM stock_movements WHERE location_id = ?', [id]);
    const [[op]] = await q.query("SELECT COUNT(*) AS n FROM orders WHERE godown_id = ? AND status NOT IN ('delivered', 'cancelled')", [id]);
    const [only] = await q.query(
      `SELECT g.emp_id FROM admin_user_godowns g JOIN admin_users a ON a.emp_id = g.emp_id AND a.is_active = 1 AND a.godowns_all = 0
        WHERE g.godown_id = ? AND NOT EXISTS (SELECT 1 FROM admin_user_godowns o WHERE o.emp_id = g.emp_id AND o.godown_id <> g.godown_id)`, [id]);
    return { packs: Number(st.packs), open_orders: Number(op.n), only_here: only.map((x) => x.emp_id) };
  }

  /** the next tax invoice number of a godown (read only: the series is not bumped) */
  async function nextInvoice(q, g, cs) {
    const fy = numbering.fyOf(new Date());
    const seg = Number(g.in_number) ? { seg: `${g.code}/`, key: `${g.code}-` } : { seg: '', key: '' };
    const [[r]] = await q.query('SELECT last_no FROM number_series WHERE series_key = ?', [`${cs.invoice_prefix}-${seg.key}${fy.fy}`]);
    const n = r ? Number(r.last_no) + 1 : (seg.key ? 1 : Number(cs.invoice_start_no) || 1);
    return `${cs.invoice_prefix}/${seg.seg}${fy.short}/${numbering.pad(n)}`;
  }

  route('get', '/godowns', 'any', async (req) => {
    const list = await godowns.list(db);
    const ppl = await people(db);
    const cs = await commerceSettings.read(db);
    const out = [];
    for (const g of list) {
      const f = await godownFacts(db, g.godown_id);
      const inCharge = ppl.find((p) => p.emp_id === g.in_charge);
      out.push({ ...g, works_at: godowns.covers(req.admin, g.godown_id), in_charge_name: inCharge ? inCharge.name : null, ...f, next_invoice: await nextInvoice(db, g, cs),
        people: ppl.filter((p) => p.active && engine.worksAt(p, g.godown_id)).length });
    }
    return { godowns: out, states: STATES, company_state: await companyState(db), can_edit: canDo(req, 'settings', 'edit') };
  });

  async function cleanGodown(q, body, before) {
    const code = String(body.code ?? (before ? before.code : '')).trim().toUpperCase();
    if (!/^[A-Z]{1,4}$/.test(code)) throw new InputError('Code: 1 to 4 capital letters, e.g. C');
    const [[dup]] = await q.query('SELECT location_id FROM locations WHERE code = ? AND location_id <> ?', [code, before ? before.godown_id : 0]);
    if (dup) throw new InputError(`Code ${code} is taken by another godown`, 409);
    const name = String(body.name ?? (before ? before.name : '')).trim();
    if (name.length < 2 || name.length > 100) throw new InputError('Name: 2 to 100 characters');
    const address = String(body.address ?? (before ? before.address || '' : '')).trim().slice(0, 255) || null;
    const state = String(body.state ?? (before ? before.state : 'Tamil Nadu')).trim();
    if (!STATES.includes(state)) throw new InputError(`State: one of ${STATES.join(', ')}`);
    const gstin = String(body.gstin ?? (before ? before.gstin || '' : '')).trim().toUpperCase() || null;
    if (gstin && !GSTIN_RE.test(gstin)) throw new InputError('GSTIN: 15 characters, like 33ABCDE1234F1Z5');
    if (gstin && gstin.slice(0, 2) !== STATE_CODE[state]) throw new InputError(`GSTIN: a ${state} GSTIN starts with ${STATE_CODE[state]}`);
    if (!gstin && state !== await companyState(q)) throw new InputError('GSTIN: a godown in another state needs its own 15-character GSTIN');
    const inCharge = String(body.in_charge ?? (before ? before.in_charge || '' : '')).trim() || null;
    if (inCharge) {
      const [[u]] = await q.query('SELECT emp_id FROM admin_users WHERE emp_id = ? AND is_active = 1', [inCharge]);
      if (!u) throw new InputError('In charge: an active member of staff');
    }
    const phone = String(body.phone ?? (before ? before.phone || '' : '')).trim() || null;
    if (phone && !/^\+?[0-9 ]{8,16}$/.test(phone)) throw new InputError('Phone: digits, e.g. +91 77790 39666');
    return { code, name, address, state, gstin, in_charge: inCharge, phone };
  }

  route('post', '/godowns', 'settings:edit', async (req) => tx(async (q) => {
    const g = await cleanGodown(q, req.body);
    const [[mx]] = await q.query('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM locations');
    const [ins] = await q.query(
      'INSERT INTO locations (code, name, address, state, gstin, in_charge, phone, in_number, sort_order, is_active, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 1, ?, UTC_TIMESTAMP())',
      [g.code, g.name, g.address, g.state, g.gstin, g.in_charge, g.phone, Number(mx.n), by(req)]);
    await audit(q, { empId: by(req), action: 'create', entity: 'godown', entityId: g.code, after: g });
    const [all] = await q.query("SELECT a.emp_id FROM admin_users a WHERE a.is_active = 1 AND a.godowns_all = 1");
    return { godown_id: ins.insertId, ...g, every_godown_people: all.map((x) => x.emp_id),
      message: `${g.name} added. Its invoices start at DFI/${g.code}/.../0001. People on "every godown" (${all.length}) can work there at once.` };
  }), { status: 201 });

  route('put', '/godowns/:id', 'settings:edit', async (req) => tx(async (q) => {
    const before = await godowns.byId(q, req.params.id);
    if (!before) throw new InputError('No such godown', 404);
    const g = await cleanGodown(q, req.body, before);
    const f = await godownFacts(q, before.godown_id);
    if (g.code !== before.code && (f.packs !== 0 || Number(before.in_number) === 0)) throw new InputError('The code is in its numbers and stock already: it cannot change', 409);
    let active = Number(before.is_active);
    if ('is_active' in req.body) {
      active = req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === '1' ? 1 : 0;
      if (!active && Number(before.is_active)) {
        const why = [f.packs ? `${f.packs} packs in stock` : null, f.open_orders ? `${f.open_orders} open order(s)` : null,
          f.only_here.length ? `${f.only_here.join(', ')} work only there` : null].filter(Boolean);
        if (why.length) throw new InputError(`${before.name} cannot be closed: ${why.join(', ')}.`, 409);
      }
    }
    await q.query('UPDATE locations SET code = ?, name = ?, address = ?, state = ?, gstin = ?, in_charge = ?, phone = ?, is_active = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE location_id = ?',
      [g.code, g.name, g.address, g.state, g.gstin, g.in_charge, g.phone, active, by(req), before.godown_id]);
    const b = { code: before.code, name: before.name, address: before.address, state: before.state, gstin: before.gstin, in_charge: before.in_charge, phone: before.phone, is_active: Number(before.is_active) };
    await audit(q, { empId: by(req), action: active !== b.is_active ? (active ? 'reopen' : 'close') : 'update', entity: 'godown', entityId: g.code, before: b, after: { ...g, is_active: active } });
    return { godown_id: before.godown_id, ...g, is_active: active === 1 };
  }));

  // ------------------------------------------------------------------------------------------- staff
  const asStaff = (p, list, extra = {}) => {
    const sp = p.leave && p.leave.standIn ? list.find((x) => x.emp_id === p.leave.standIn) : null;
    const setBy = p.leave && p.leave.setBy ? list.find((x) => x.emp_id === p.leave.setBy) : null;
    const standsInFor = list.filter((x) => x.leave && x.leave.standIn === p.emp_id && x.leave.to >= pricing.istToday()).map((x) => ({ emp_id: x.emp_id, name: x.name, from: x.leave.from, to: x.leave.to }));
    return {
      emp_id: p.emp_id, name: p.name, role_id: p.role_id, role_name: p.role_name, active: p.active, is_admin: p.is_admin, is_super: isSuper(p), see_cost: p.seesCost,
      limit: p.limit, limit_text: engine.limitText(p.limit), limit_personal: Boolean(p.limit && p.limit.personal), role_limit_text: engine.limitText(p.roleLimit),
      godowns: p.godowns, leave: p.leave ? { ...p.leave, stand_in_name: sp ? sp.name : null, set_by_name: setBy ? setBy.name : null, now: engine.onLeave(p, pricing.istToday()) } : null,
      stands_in_for: standsInFor, ...extra,
    };
  };

  route('get', '/staff', 'users:view', async (req) => {
    const list = await people(db);
    const me = meOf(list, req);
    const gs = await godowns.list(db);
    const [drv] = await db.query('SELECT DISTINCT emp_id FROM drivers WHERE is_active = 1 AND emp_id IS NOT NULL'); // read only: the Driver column
    const drivers = new Set(drv.map((x) => x.emp_id));
    return {
      staff: list.map((p) => asStaff(p, list, { locked: rowProblem(me, p) || null, driver: drivers.has(p.emp_id) })),
      godowns: gs.map((g) => ({ godown_id: g.godown_id, code: g.code, name: g.name, is_active: g.is_active, mine: godowns.covers(req.admin, g.godown_id) })),
      me: { emp_id: me.emp_id, is_admin: me.is_admin, is_super: isSuper(me), limit_text: engine.limitText(me.limit), godowns: me.godowns },
      today: pricing.istToday(),
    };
  });

  /** who can stand in for this person (from..to, default their current leave): every other active person with why not */
  route('get', '/staff/:empId/stand-ins', 'users:view', async (req) => {
    const list = await people(db);
    const p = list.find((x) => x.emp_id === req.params.empId);
    if (!p) throw new InputError('Not a member of staff', 404);
    const from = String(req.query.from || (p.leave && p.leave.from) || pricing.istToday());
    const to = String(req.query.to || (p.leave && p.leave.to) || from);
    return list.filter((x) => x.emp_id !== p.emp_id && x.active).map((x) => ({ emp_id: x.emp_id, name: x.name, role_name: x.role_name, limit_text: engine.limitText(x.limit),
      problem: engine.standInProblem(x, p, from, to, (s) => SECTION_LABEL[s] || s) || null }));
  });

  route('put', '/staff/:empId', 'users:edit', async (req) => tx(async (q) => {
    const list = await people(q);
    const me = meOf(list, req);
    const target = list.find((x) => x.emp_id === req.params.empId);
    if (!target) throw new InputError('Not a member of staff', 404);
    const body = req.body || {};
    const keys = ['role_id', 'limit', 'godowns', 'leave'].filter((k) => k in body);
    if (!keys.length) throw new InputError('Nothing to change');
    const leaveOnly = keys.length === 1 && keys[0] === 'leave';
    const lock = rowProblem(me, target, { leaveOnly });
    if (lock) throw new InputError(lock, 403);
    const [[row]] = await q.query(`SELECT emp_id, role_id, limit_kind, limit_amount, godowns_all, DATE_FORMAT(leave_from, '%Y-%m-%d') AS leave_from,
      DATE_FORMAT(leave_to, '%Y-%m-%d') AS leave_to, stand_in, leave_set_by FROM admin_users WHERE emp_id = ? FOR UPDATE`, [target.emp_id]);
    const [g0] = await q.query('SELECT godown_id FROM admin_user_godowns WHERE emp_id = ? ORDER BY godown_id', [target.emp_id]);
    const before = { role_id: row.role_id, limit: row.limit_kind === 'role' ? 'role' : limitFrom(row.limit_kind, row.limit_amount),
      godowns: Number(row.godowns_all) ? 'ALL' : g0.map((x) => Number(x.godown_id)),
      leave: row.leave_from ? { from: row.leave_from, to: row.leave_to, stand_in: row.stand_in, set_by: row.leave_set_by } : null };
    const set = {};
    const after = { ...before };
    const waiting = []; // what waits for a second Admin (phase 12b)
    const hold = async (t, what, summary, payload) => { waiting.push(await secondAdmin.ask(q, { t, dk: `${t}:${what}:${target.emp_id}`, summary, payload: { emp_id: target.emp_id, ...payload } }, by(req))); };
    const roleNow = await roleInfo(q, row.role_id);
    if ('role_id' in body && Number(body.role_id) !== Number(row.role_id)) {
      const why = await roleGiveProblem(q, me, body.role_id);
      if (why) throw new InputError(why, 403);
      // there must always be at least one active Admin (Super admin or Admin) who can sign in
      if (target.is_admin && !permissions.isAdminRole(body.role_id) && list.filter((p) => p.active && p.is_admin && p.emp_id !== target.emp_id).length === 0) {
        throw new InputError('There must always be at least one active Admin. Make someone else Admin first.', 409);
      }
      const roleNew = await roleInfo(q, body.role_id);
      const demote = target.is_admin && !permissions.isAdminRole(body.role_id); // v23 N13
      if (roleWider(roleNow, roleNew) || demote) {
        await hold('staffrole', 'role', `${target.name}: role ${roleNow.name} to ${roleNew.name}${demote ? ' (takes the Admin role away)' : ''}`, { role_id: Number(body.role_id) });
      } else {
        set.role_id = Number(body.role_id);
        after.role_id = set.role_id;
      }
    }
    if ('limit' in body) {
      const l = cleanLimit(body.limit, { allowRole: true, InputError });
      if (!me.is_admin) {
        const effective = l.kind === 'role' ? (await roleInfo(q, set.role_id || row.role_id)).limit : l;
        if (engine.limitNum(effective) > engine.limitNum(me.limit)) throw new InputError(`Limit: at most your own ${engine.limitText(me.limit)}`, 403);
      }
      const nowL = row.limit_kind === 'role' ? roleNow.limit : limitFrom(row.limit_kind, row.limit_amount);
      const newL = l.kind === 'role' ? (await roleInfo(q, set.role_id || row.role_id)).limit : l;
      const isSuperTarget = isSuper(target);
      const nowEff = target.is_admin && row.limit_kind === 'role' ? { kind: 'any', amount: null } : nowL;
      const newEff = target.is_admin && l.kind === 'role' ? { kind: 'any', amount: null } : newL;
      const words = `${target.name}: approval limit ${row.limit_kind === 'role' ? 'role default' : limitWords(nowL)} to ${limitWords(l.kind === 'role' ? 'role' : l)}`;
      if (!isSuperTarget && engine.limitNum(newEff) > engine.limitNum(nowEff)) await hold('stafflim', 'limit', words, { limit: l }); // v23 F1
      else if (target.is_admin && engine.limitNum(newEff) < engine.limitNum(nowEff)) await hold('staffadm', 'limit', `${words} (an Admin)`, { limit: l }); // v23 N14
      else {
        set.limit_kind = l.kind;
        set.limit_amount = l.kind === 'amount' ? l.amount : null;
        after.limit = l.kind === 'role' ? 'role' : l;
      }
    }
    let newGodowns = null;
    if ('godowns' in body) {
      const all = body.godowns === 'ALL';
      const ids = all ? [] : [...new Set((Array.isArray(body.godowns) ? body.godowns : []).map(Number))].filter((n) => Number.isInteger(n) && n > 0);
      if (!all && !ids.length) throw new InputError('Godowns: every godown, or at least one');
      if (!all) {
        const [ok] = await q.query('SELECT location_id FROM locations WHERE location_id IN (?)', [ids]);
        if (ok.length !== ids.length) throw new InputError('Godowns: unknown godown');
      }
      if (!me.is_admin) {
        if (all && godowns.scopeOf(me) !== null) throw new InputError('Godowns: you do not work at every godown, so you cannot give it', 403);
        const outside = ids.filter((id) => !godowns.covers(me, id));
        if (outside.length) throw new InputError('Godowns: only the godowns you work at', 403);
      }
      const old = before.godowns;
      const wider = old !== 'ALL' && (all || ids.some((id) => !old.includes(id)));
      const narrower = old === 'ALL' ? !all : !all && old.some((id) => !ids.includes(id));
      const names = async (g) => (g === 'ALL' ? 'every godown' : (await godowns.list(q)).filter((x) => g.includes(x.godown_id)).map((x) => x.name).join(', '));
      const words = `${target.name}: godowns ${await names(old)} to ${await names(all ? 'ALL' : ids)}`;
      if (wider) await hold('staffscope', 'godowns', words, { godowns: all ? 'ALL' : ids }); // v23 F1
      else if (narrower && target.is_admin) await hold('staffadm', 'godowns', `${words} (an Admin)`, { godowns: all ? 'ALL' : ids }); // v23 N14
      else {
        set.godowns_all = all ? 1 : 0;
        newGodowns = all ? [] : ids;
        after.godowns = all ? 'ALL' : ids;
      }
    }
    if ('leave' in body) {
      const lv = body.leave;
      const from = lv && lv.from ? String(lv.from) : null;
      const to = lv && lv.to ? String(lv.to) : null;
      const standIn = lv && lv.stand_in ? String(lv.stand_in) : null;
      const why = engine.leaveProblem({ who: target, by: me, from, to, standIn, today: pricing.istToday(), people: list });
      if (why) throw new InputError(why, 400);
      set.leave_from = from; set.leave_to = to; set.stand_in = from ? standIn : null; set.leave_set_by = from ? me.emp_id : null;
      after.leave = from ? { from, to, stand_in: standIn, set_by: me.emp_id } : null;
    }
    const cols = Object.keys(set);
    if (cols.length) await q.query(`UPDATE admin_users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE emp_id = ?`, [...cols.map((c) => set[c]), target.emp_id]);
    if (newGodowns) {
      await q.query('DELETE FROM admin_user_godowns WHERE emp_id = ?', [target.emp_id]);
      for (const id of newGodowns) await q.query('INSERT INTO admin_user_godowns (emp_id, godown_id) VALUES (?, ?)', [target.emp_id, id]);
    }
    const sp = after.leave && after.leave.stand_in ? list.find((x) => x.emp_id === after.leave.stand_in) : null;
    if (cols.length || newGodowns) {
      await audit(q, { empId: by(req), action: leaveOnly ? 'leave' : 'update', entity: 'admin_user', entityId: target.emp_id, before,
        after: { ...after, ...(sp ? { stand_in_name: sp.name } : {}) } });
    }
    // phase 12b: leave entered for another Admin is told to every Admin at once
    if ('leave' in body && target.is_admin && target.emp_id !== me.emp_id && after.leave) {
      await notifications.adminAlert(q, { subject: `Leave entered for ${target.name}`, ref: `leave ${target.emp_id}`, by: by(req),
        body: `${me.name} entered leave for ${target.name}: ${after.leave.from} to ${after.leave.to}${sp ? `, ${sp.name} standing in` : ''}. An override never uses a leave entered by the Admin who overrides.` });
    }
    const fresh = (await people(q)).find((x) => x.emp_id === target.emp_id);
    return { ...asStaff(fresh, await people(q)), waiting: waiting.map((w) => w.message) };
  }));

  // ------------------------------------------------------------------------------------------- approval rules
  route('get', '/approval-rules', 'any', async (req) => {
    if (!canDo(req, 'users', 'view') && !canDo(req, 'settings', 'view')) throw new InputError('This needs view on Roles and users or on Settings', 403);
    const cs = await commerceSettings.read(db);
    const list = (await people(db)).filter((p) => p.active);
    const today = pricing.istToday();
    // who can sign each rule today (read only): Approve on its section and a limit that covers the rule's own amount,
    // not on leave; smallest limit first
    const rules = (await approvals.rules(db)).map((r) => ({ ...r, signers: list
      .filter((p) => permissions.can(p.perms, r.section, 'approve') && !engine.onLeave(p, today) && engine.covers(p.limit, r.unit === 'Rs' ? Number(r.limit_value) || 0 : 0))
      .sort((a, b) => engine.limitNum(a.limit) - engine.limitNum(b.limit) || a.name.localeCompare(b.name))
      .map((p) => ({ emp_id: p.emp_id, name: p.name, limit_text: engine.limitText(p.limit) })) }));
    const [waits] = await db.query("SELECT approval_id, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.kind')) AS kind, summary FROM approvals WHERE kind = 'rule_change' AND status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.t')) = 'rule'");
    return { rules: rules.map((r) => ({ ...r, waiting: waits.filter((w) => w.kind === r.kind).map((w) => ({ approval_id: w.approval_id, summary: w.summary })) })),
      sections: permissions.SECTIONS, can_edit: canDo(req, 'settings', 'edit') && Boolean(req.admin.is_admin),
      split_days: Number(cs.split_days) || 3, expiry_days: Number(cs.approval_expiry_days) || 7 };
  });

  route('put', '/approval-rules/:kind', 'settings:edit', async (req) => tx(async (q) => {
    if (!req.admin.is_admin) throw new InputError('Only an Admin changes the approval rules', 403);
    const [[r]] = await q.query('SELECT kind, label, is_on, unit, limit_value, limit_packs, locked FROM approval_rules WHERE kind = ? FOR UPDATE', [req.params.kind]);
    if (!r) throw new InputError('No such rule', 404);
    const body = req.body || {};
    let on = Number(r.is_on);
    if ('is_on' in body) {
      on = body.is_on === true || body.is_on === 1 || body.is_on === '1' ? 1 : 0;
      if (!on && Number(r.locked)) throw new InputError(`"${r.label}" can never be switched off`, 409);
    }
    let value = r.limit_value === null ? null : Number(r.limit_value);
    if ('limit_value' in body && r.unit !== 'all') {
      const s = String(body.limit_value ?? '').trim();
      if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) throw new InputError(r.unit === '%' ? 'A percent, e.g. 10' : 'An amount in Rs, e.g. 2000');
      if (r.unit === '%' && Number(s) > 100) throw new InputError('A percent from 0 to 100');
      value = Number(s);
    }
    let packs = r.limit_packs === null ? null : Number(r.limit_packs);
    if ('limit_packs' in body && r.limit_packs !== null) {
      const s = String(body.limit_packs ?? '').trim();
      if (!/^\d{1,7}$/.test(s)) throw new InputError('Packs: a whole number, 0 or more');
      packs = Number(s);
    }
    // phase 12b: switching a rule off or raising its limit (or packs) is a weaker rule: a second Admin agrees first
    const was = { on: Number(r.is_on), value: r.limit_value === null ? null : Number(r.limit_value), packs: r.limit_packs === null ? null : Number(r.limit_packs) };
    const weaker = (was.on && !on) || (value !== null && was.value !== null && value > was.value) || (packs !== null && was.packs !== null && packs > was.packs);
    if (weaker) {
      const what = [was.on && !on ? 'switch it off' : '', value !== was.value ? `limit ${was.value} to ${value}` : '', packs !== was.packs ? `packs ${was.packs} to ${packs}` : ''].filter(Boolean).join(', ');
      const w = await secondAdmin.ask(q, { t: 'rule', dk: `rule:${r.kind}`, summary: `${r.label}: ${what}`, payload: { kind: r.kind, on, value, packs } }, by(req));
      return { ...(await approvals.rules(q)).find((x) => x.kind === r.kind), waiting: w.message };
    }
    await q.query('UPDATE approval_rules SET is_on = ?, limit_value = ?, limit_packs = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE kind = ?', [on, value, packs, by(req), r.kind]);
    await audit(q, { empId: by(req), action: 'update', entity: 'approval_rule', entityId: r.kind,
      before: { on: Number(r.is_on), limit: r.limit_value === null ? null : Number(r.limit_value), packs: r.limit_packs }, after: { on, limit: value, packs } });
    return (await approvals.rules(q)).find((x) => x.kind === r.kind);
  }));

  // ------------------------------------------------------------------------------------------- what a second Admin approves
  const setLimit = async (q, emp, l) => q.query('UPDATE admin_users SET limit_kind = ?, limit_amount = ? WHERE emp_id = ?', [l.kind, l.kind === 'amount' ? l.amount : null, emp]);
  const setGodowns = async (q, emp, g) => {
    await q.query('UPDATE admin_users SET godowns_all = ? WHERE emp_id = ?', [g === 'ALL' ? 1 : 0, emp]);
    await q.query('DELETE FROM admin_user_godowns WHERE emp_id = ?', [emp]);
    if (g !== 'ALL') for (const id of g) await q.query('INSERT INTO admin_user_godowns (emp_id, godown_id) VALUES (?, ?)', [emp, id]);
  };
  const stillThere = async (q, p) => {
    const [[u]] = await q.query('SELECT emp_id FROM admin_users WHERE emp_id = ?', [p.emp_id]);
    return u ? '' : 'that person is no longer a dFresh admin user';
  };
  const done = (what) => async (q, p, empId) => audit(q, { empId, action: 'update', entity: 'admin_user', entityId: p.emp_id, after: { ...what(p), approved: true } });
  secondAdmin.on('staffrole', { recheck: stillThere, async apply(q, p, empId) {
    const list = await people(q);
    const t = list.find((x) => x.emp_id === p.emp_id);
    if (t && t.is_admin && !permissions.isAdminRole(p.role_id) && list.filter((x) => x.active && x.is_admin && x.emp_id !== p.emp_id).length === 0) return; // never the last Admin
    await q.query('UPDATE admin_users SET role_id = ? WHERE emp_id = ?', [p.role_id, p.emp_id]);
    await done((x) => ({ role_id: x.role_id }))(q, p, empId);
  } });
  secondAdmin.on('stafflim', { recheck: stillThere, async apply(q, p, empId) { await setLimit(q, p.emp_id, p.limit); await done((x) => ({ limit: x.limit }))(q, p, empId); } });
  secondAdmin.on('staffscope', { recheck: stillThere, async apply(q, p, empId) { await setGodowns(q, p.emp_id, p.godowns); await done((x) => ({ godowns: x.godowns }))(q, p, empId); } });
  secondAdmin.on('staffadm', { recheck: stillThere, async apply(q, p, empId) {
    if (p.limit) await setLimit(q, p.emp_id, p.limit);
    if (p.godowns) await setGodowns(q, p.emp_id, p.godowns);
    await done((x) => ({ limit: x.limit, godowns: x.godowns }))(q, p, empId);
  } });
  // added or brought back: active once approved; a new person refused or expired is removed again
  const activate = async (q, p, empId) => {
    await q.query('UPDATE admin_users SET is_active = 1, pending_add = 0, left_at = NULL, left_by = NULL WHERE emp_id = ? AND pending_add = 1', [p.emp_id]);
    await done(() => ({ is_active: 1 }))(q, p, empId);
  };
  secondAdmin.on('staffadd', { recheck: stillThere, apply: activate, async closed(q, p, status, empId) {
    await q.query('DELETE FROM admin_user_godowns WHERE emp_id = ? AND EXISTS (SELECT 1 FROM admin_users a WHERE a.emp_id = ? AND a.pending_add = 1)', [p.emp_id, p.emp_id]);
    await q.query('DELETE FROM admin_users WHERE emp_id = ? AND pending_add = 1', [p.emp_id]);
    await audit(q, { empId, action: `add_${status}`, entity: 'admin_user', entityId: p.emp_id });
  } });
  secondAdmin.on('staffback', { recheck: stillThere, apply: activate, async closed(q, p, status, empId) {
    await q.query('UPDATE admin_users SET pending_add = 0 WHERE emp_id = ?', [p.emp_id]);
    await audit(q, { empId, action: `back_${status}`, entity: 'admin_user', entityId: p.emp_id });
  } });

  // ------------------------------------------------------------------------------------------- stand-ins
  route('get', '/stand-ins', 'users:view', async () => {
    const list = await people(db);
    const today = pricing.istToday();
    return { today, rows: list.filter((p) => p.leave && p.leave.to >= today).sort((a, b) => a.leave.from.localeCompare(b.leave.from)).map((p) => {
      const sp = list.find((x) => x.emp_id === p.leave.standIn);
      const setBy = list.find((x) => x.emp_id === p.leave.setBy);
      return { emp_id: p.emp_id, name: p.name, role_name: p.role_name, limit_text: engine.limitText(p.limit), from: p.leave.from, to: p.leave.to, now: engine.onLeave(p, today),
        stand_in: p.leave.standIn, stand_in_name: sp ? sp.name : null, stand_in_role: sp ? sp.role_name : null, stand_in_limit_text: sp ? engine.limitText(sp.limit) : null, stand_in_problem: sp ? engine.standInProblem(sp, p, p.leave.from, p.leave.to, (s) => SECTION_LABEL[s] || s) || null : null,
        set_by: p.leave.setBy, set_by_name: setBy ? setBy.name : p.leave.setBy };
    }) };
  });
}

module.exports = { register, roleGiveProblem, rowProblem, missingRights, roleInfo, cleanLimit, roleWider, signs, STATE_CODE };
