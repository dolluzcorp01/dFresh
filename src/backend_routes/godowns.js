// Godowns (gap map D8; table locations, migration 20261102_stage2_12a_01_godowns.sql) and who works where.
// - A person works at every godown (admin_users.godowns_all: every later godown included) or at a list of them
//   (admin_user_godowns). req.admin.godowns = 'ALL' | [ids] (auth.js).
// - The header picker (request header X-Godown) narrows what a person sees to one of their godowns; "All godowns" (no
//   header) shows all of theirs. It never widens: a godown outside the person's list is ignored.
// - Every list and figure filters with viewScope(req) (a SQL IN on the record's godown); a single record outside the
//   person's godowns answers 404 (assertSees); creating or signing anything there is refused (assertWorks).
// - Godown codes go into the numbers of per-godown documents (invoices, credit notes...) when in_number = 1
//   (numbering.godownSegment); Kanchipuram (K, in_number 0) keeps today's numbers.

class GodownError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const GODOWN_COLS = 'location_id AS godown_id, code, name, address, state, gstin, in_charge, phone, in_number, sort_order, is_active';

/** every godown (active first, then by sort order) */
async function list(q) {
  const [rows] = await q.query(`SELECT ${GODOWN_COLS} FROM locations ORDER BY is_active DESC, sort_order, location_id`);
  return rows.map((r) => ({ ...r, in_number: Number(r.in_number) === 1, is_active: Number(r.is_active) === 1 }));
}

async function byId(q, id) {
  const [[g]] = await q.query(`SELECT ${GODOWN_COLS} FROM locations WHERE location_id = ?`, [Number(id)]);
  return g || null;
}

/** the person's godowns: null = every godown, else the list of ids */
const scopeOf = (admin) => (!admin || admin.godowns === 'ALL' ? null : admin.godowns);

/** does this person work at that godown? */
function covers(admin, godownId) {
  const s = scopeOf(admin);
  return s === null || s.includes(Number(godownId));
}

/** the godown the header picker names, when the person works there (else null = all of theirs) */
function picked(req) {
  const raw = req && typeof req.get === 'function' ? req.get('x-godown') : null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 && covers(req.admin, id) ? id : null;
}

/** what a list shows: null = every godown, else ids (the picker's one, or the person's list) */
function viewScope(req) {
  const p = picked(req);
  if (p) return [p];
  return scopeOf(req.admin);
}

/** [sql, params] for a WHERE on a godown column; an empty list matches nothing */
function where(col, scope) {
  if (scope === null) return ['1 = 1', []];
  if (!scope.length) return ['1 = 0', []];
  return [`${col} IN (?)`, [scope]];
}

/** a record outside what this request may see: 404, as if it did not exist (no hint that it is there) */
function assertSees(req, godownId, what = 'Not found') {
  const s = viewScope(req);
  if (s !== null && !s.includes(Number(godownId))) throw new GodownError(what, 404);
}

/** creating or changing something in a godown the person does not work at: 403 */
function assertWorks(admin, godownId) {
  if (!covers(admin, godownId)) throw new GodownError('You do not work at that godown', 403);
}

/**
 * the godown a new record goes to when the form does not name one: the picker's, else the person's only godown,
 * else the first active godown they work at
 */
async function defaultFor(q, req) {
  const p = picked(req);
  if (p) return p;
  const s = scopeOf(req.admin);
  if (s && s.length === 1) return s[0];
  const all = (await list(q)).filter((g) => g.is_active && (s === null || s.includes(g.godown_id)));
  if (!all.length) throw new GodownError('You do not work at any active godown', 403);
  return all[0].godown_id;
}

/** a godown id from a form (or the default); it must be active and one the person works at */
async function resolve(q, req, raw) {
  const id = raw === undefined || raw === null || raw === '' ? await defaultFor(q, req) : Number(raw);
  const g = await byId(q, id);
  if (!g || !Number(g.is_active)) throw new GodownError('Choose a godown');
  assertWorks(req.admin, id);
  return id;
}

module.exports = { GodownError, list, byId, scopeOf, covers, picked, viewScope, where, assertSees, assertWorks, defaultFor, resolve };
