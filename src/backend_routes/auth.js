// Admin sessions (Inside D pattern, docs/reference/insideD-patterns.md).
// - Identity is dadmin.employee; the role lives in dfresh.admin_users and is read on EVERY request, so a role
//   change or deactivation applies at once.
// - Two token kinds, both HS256 with JWT_SECRET (dFresh's own; it never reads a dAdmin token) and tagged with app + stage:
//   challenge (stage 'otp', 10 min, after the password) and session (stage 'session', 8 h, after the code).
//   readSession() accepts only stage 'session' for this app, so a challenge token, a dAdmin token or a
//   brochure token (different key) can never pass as a session.
// - Revocation: dadmin.login_session_revoke (app_key, emp_id, revoked_at) kills every session issued before
//   revoked_at. Fails open on a DB error (logged), like Inside D, so a dadmin hiccup does not lock staff out.
// - Cookies are httpOnly, SameSite=Strict, Secure in production, scoped to /api/dfresh/admin.
const jwt = require('jsonwebtoken');
const { getDBConnection } = require('../../config/db');
const permissions = require('../shared/permissions');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const isProd = process.env.NODE_ENV === 'production';
const APP_KEY = process.env.ADMIN_APP_KEY || 'dFresh';
const DADMIN = /^[A-Za-z0-9_]{1,32}$/.test(process.env.DADMIN_DB_NAME || '') ? process.env.DADMIN_DB_NAME : 'dadmin';
const SESSION_COOKIE = process.env.ADMIN_COOKIE_NAME || 'dfresh_admin_token';
const CHALLENGE_COOKIE = `${SESSION_COOKIE}_otp`;
const SESSION_TTL_S = 8 * 60 * 60;
const CHALLENGE_TTL_S = 10 * 60;
const COOKIE_PATH = '/api/dfresh/admin';


function secret() {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET missing');
  return process.env.JWT_SECRET;
}

const cookieOptions = (maxAgeS) => ({
  httpOnly: true, secure: isProd, sameSite: 'strict', path: COOKIE_PATH, maxAge: maxAgeS * 1000,
});

function sign(empId, stage, ttl) {
  return jwt.sign({ sub: String(empId), app: APP_KEY, stage }, secret(), { algorithm: 'HS256', expiresIn: ttl });
}

/** Verified claims of a token of this app and stage, else null. */
function verify(token, stage) {
  if (typeof token !== 'string' || !token) return null;
  try {
    const c = jwt.verify(token, secret(), { algorithms: ['HS256'] });
    if (c.app !== APP_KEY || c.stage !== stage || typeof c.sub !== 'string' || !c.sub) return null;
    return c;
  } catch {
    return null;
  }
}

function setChallenge(res, empId) {
  res.cookie(CHALLENGE_COOKIE, sign(empId, 'otp', CHALLENGE_TTL_S), cookieOptions(CHALLENGE_TTL_S));
}

const readChallenge = (req) => verify(req.cookies && req.cookies[CHALLENGE_COOKIE], 'otp');

function startSession(res, empId) {
  res.clearCookie(CHALLENGE_COOKIE, { path: COOKIE_PATH });
  res.cookie(SESSION_COOKIE, sign(empId, 'session', SESSION_TTL_S), cookieOptions(SESSION_TTL_S));
}

function endSession(res) {
  res.clearCookie(SESSION_COOKIE, { path: COOKIE_PATH });
  res.clearCookie(CHALLENGE_COOKIE, { path: COOKIE_PATH });
}

// dAdmin writes revoked_at with NOW(3) in the server's DEFAULT time zone (its sessions are not UTC) and reads it the
// same way; our sessions are UTC, so it is converted from @@global.time_zone first. emp_id '*' = the whole app
// (dAdmin "revoke all"), as dAdmin itself reads it.
async function isRevoked(empId, issuedAtS) {
  try {
    const [[row]] = await db.query(
      `SELECT UNIX_TIMESTAMP(CONVERT_TZ(MAX(revoked_at), @@global.time_zone, '+00:00')) AS sec
         FROM \`${DADMIN}\`.login_session_revoke WHERE app_key = ? AND emp_id IN (?, '*')`, [APP_KEY, empId]
    );
    return Boolean(row && row.sec !== null && Number(row.sec) >= issuedAtS);
  } catch (err) {
    console.error('session revoke check failed (allowing):', err.code || err.message);
    return false;
  }
}

/**
 * The signed-in person for a valid, unrevoked session of an active admin user; else null. Read on EVERY request, so a
 * change of role, rights, limit, godowns or leave applies to the person's next click:
 * { emp_id, role_id, role_name, perms (src/shared/permissions.js; built-in roles from code), is_admin (Super admin or
 *   Admin), seesCost, ownOnly (own customers only), limit: { kind: none | any | amount, amount } (the personal one, else
 *   the role's; Super admin: anything; Admin: anything unless the Super admin set a personal limit), godowns: 'ALL' | [godown ids], leave: { from, to, standIn, setBy } | null }
 */
async function readSession(req) {
  const claims = verify(req.cookies && req.cookies[SESSION_COOKIE], 'session');
  if (!claims) return null;
  // the employee must still be active in dAdmin too: someone who left the company loses access at once
  const [[user]] = await db.query(
    `SELECT a.emp_id, a.role_id, r.name AS role_name, r.is_builtin, r.limit_kind AS role_limit_kind, r.limit_amount AS role_limit_amount,
            r.see_cost, r.own_customers_only, a.limit_kind, a.limit_amount, a.godowns_all,
            DATE_FORMAT(a.leave_from, '%Y-%m-%d') AS leave_from, DATE_FORMAT(a.leave_to, '%Y-%m-%d') AS leave_to, a.stand_in, a.leave_set_by
       FROM admin_users a
       JOIN \`${DADMIN}\`.employee e ON e.emp_id = a.emp_id AND e.deleted_time IS NULL AND e.active = 1
       JOIN roles r ON r.role_id = a.role_id
      WHERE a.emp_id = ? AND a.is_active = 1`, [claims.sub]
  );
  if (!user) return null;
  if (await isRevoked(user.emp_id, claims.iat)) return null;
  return buildAdmin(db, user);
}

/** the person object of readSession from their admin_users + roles row (also used by the approval ladder for others) */
async function buildAdmin(q, user) {
  const builtin = permissions.isAdminRole(user.role_id); // Super admin and Admin: every right in code; others (Sub-admin too) from rows
  const [rows] = builtin ? [[]] : await q.query(
    `SELECT ${permissions.PERM_COLS} FROM role_permissions WHERE role_id = ?`, [user.role_id]
  );
  const isAdmin = permissions.isAdminRole(user.role_id);
  const roleLimit = isAdmin ? { kind: 'any', amount: null } : { kind: user.role_limit_kind || 'none', amount: user.role_limit_amount === null ? null : Number(user.role_limit_amount) };
  // a personal limit beats the role's for everyone but the Super admin (v23 0.15: the Super admin may cap an Admin)
  const own = Number(user.role_id) !== permissions.SUPERADMIN_ROLE_ID && user.limit_kind && user.limit_kind !== 'role'
    ? { kind: user.limit_kind, amount: user.limit_amount === null ? null : Number(user.limit_amount), personal: true } : null;
  let godowns = 'ALL';
  if (!Number(user.godowns_all)) {
    const [g] = await q.query('SELECT godown_id FROM admin_user_godowns WHERE emp_id = ? ORDER BY godown_id', [user.emp_id]);
    godowns = g.map((x) => Number(x.godown_id));
  }
  return {
    emp_id: user.emp_id, role_id: user.role_id, role_name: user.role_name, perms: permissions.permsFor(user.role_id, rows),
    is_admin: isAdmin, seesCost: builtin || Number(user.see_cost) === 1, ownOnly: !builtin && Number(user.own_customers_only) === 1,
    limit: own || roleLimit, roleLimit, godowns,
    leave: user.leave_from && user.leave_to ? { from: user.leave_from, to: user.leave_to, standIn: user.stand_in || null, setBy: user.leave_set_by || null } : null,
  };
}

async function requireAuth(req, res, next) {
  try {
    const admin = await readSession(req);
    if (!admin) return res.status(401).json({ success: false, message: 'Please sign in' });
    req.admin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Permission guard (after requireAuth): perm = "section:action" or "any" (signed in is enough; the route itself
 * limits what it returns). Missing permission -> 403 "This needs <action> on <section>".
 */
function requirePerm(perm) {
  const p = permissions.parsePerm(perm); // throws at start-up on a typo
  return (req, res, next) => {
    if (p.any || permissions.can(req.admin && req.admin.perms, p.section, p.action)) return next();
    const label = (permissions.SECTIONS.find((s) => s.key === p.section) || {}).label || p.section;
    return res.status(403).json({ success: false, message: `This needs ${p.action} on ${label}`, code: 'forbidden' });
  };
}

module.exports = {
  APP_KEY, DADMIN,
  setChallenge, readChallenge, startSession, endSession, readSession, requireAuth, requirePerm, buildAdmin,
};
