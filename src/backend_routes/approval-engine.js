// The approval engine's rules, without a database (gap map D4; v23 Foundation: decide, tryAs, ladder, standInProblem):
// approvals.js loads the people, the request and the split total, then asks this module. Unit tests: tests/engines.
//
// A person here = auth.buildAdmin() + { name, active }: perms, is_admin, limit { kind: none | any | amount, amount },
// godowns ('ALL' | [ids]), leave { from, to, standIn, setBy } | null.
// A request = { approval_id, kind, section, godown_id, amount, requested_by, status, requested_at, excluded: [emp ids] }.
//
// Who can sign a request (decide):
// - an active person, not the one who raised it, not one of its excluded people (e.g. the sender and receiver of a
//   transfer, for its loss), not on leave today, and the request is not expired;
// - with Approve on the request's section, working at its godown, and a limit that covers the amount (the request's
//   own amount, or the total of the requests of the same kind it counts together with, whichever is more);
// - or, failing that, with the rights of someone on leave today whom they stand in for (never for the locked kinds:
//   a second-Admin rule is never signed through a stand-in), when they could stand in for that person, and that person
//   is not the requester or excluded. The audit log then names both (decided_via).
// The ladder = everyone who can sign it today, smallest limit first; the first is "next".
const permissions = require('../shared/permissions');

const LOCKED_KINDS = ['rule_change', 'company_bank', 'supplier_bank'];
const SECTION_LABEL = Object.fromEntries(permissions.SECTIONS.map((s) => [s.key, s.label]));
const labelOf = (s) => SECTION_LABEL[s] || s;
const INF = Number.POSITIVE_INFINITY;
/** Rs with Indian grouping: whole rupees without decimals, else 2 (Rs 4,200 / Rs 2,101.50) */
const rs = (n) => { const v = Number(n) || 0; return `Rs ${v.toLocaleString('en-IN', Number.isInteger(v) ? {} : { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };

/** a limit as a number for comparing: nothing = -1 (below every amount, even 0), anything = infinity */
const limitNum = (l) => (!l || l.kind === 'none' ? -1 : l.kind === 'any' ? INF : Number(l.amount) || 0);
const limitText = (l) => (!l || l.kind === 'none' ? 'nothing' : l.kind === 'any' ? 'anything' : rs(l.amount));
const covers = (limit, amount) => limitNum(limit) >= 0 && (Number(amount) || 0) <= limitNum(limit);
const worksAt = (p, godownId) => p.godowns === 'ALL' || (Array.isArray(p.godowns) && p.godowns.includes(Number(godownId)));
const godownsText = (p, names = {}) => (p.godowns === 'ALL' ? 'every godown' : (p.godowns || []).map((g) => names[g] || `godown ${g}`).join(', ') || 'no godown');
const inRange = (d, a, b) => Boolean(a && b && d >= a && d <= b);
/** on leave today (signs nothing) */
const onLeave = (p, today) => Boolean(p.leave && inRange(today, p.leave.from, p.leave.to));
const overlap = (a1, a2, b1, b2) => a1 <= b2 && b1 <= a2;
const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

/** expired: still pending after the "expires after" days (counted from the day it was asked, India date) */
function expired(q, today, expiryDays) {
  return q.status === 'pending' && dayDiff(String(q.requested_on || '').slice(0, 10), today) >= Number(expiryDays || 7);
}

/**
 * why `sp` cannot stand in for `p` (from..to); '' = they can. A stand-in signs with the absent person's powers, so must
 * already hold at least those powers: Approve wherever p has it, a limit at least p's, active, not on leave then.
 */
function standInProblem(sp, p, from, to, sectionLabel = labelOf) {
  if (!sp) return 'Nobody chosen.';
  if (sp.active === false) return `${sp.name} has left.`;
  if (sp.emp_id === p.emp_id) return 'Somebody cannot stand in for themselves.';
  const miss = permissions.SECTION_KEYS.filter((s) => permissions.can(p.perms, s, 'approve') && !permissions.can(sp.perms, s, 'approve'));
  if (miss.length) return `${sp.name} cannot approve ${miss.map(sectionLabel).join(', ')}, which ${p.name} can.`;
  if (limitNum(sp.limit) < limitNum(p.limit)) return `${sp.name} signs up to ${limitText(sp.limit)}, less than ${p.name}'s ${limitText(p.limit)}.`;
  if (sp.leave && from && to && overlap(sp.leave.from, sp.leave.to, from, to)) return `${sp.name} is on leave ${sp.leave.from} to ${sp.leave.to}, which overlaps these dates.`;
  return '';
}

/**
 * why this leave cannot be saved; '' = it can. who = the person going on leave, by = who enters it.
 * from / to: dates (both or neither: neither = no leave). An Admin's leave: entered by that Admin, or by another Admin
 * at least 2 days ahead, at most 30 days, never changing a leave the Admin entered themselves.
 */
function leaveProblem({ who, by, from, to, standIn, today, people = [] }) {
  if (!from && !to) {
    if (who.is_admin && who.leave && who.leave.setBy === who.emp_id && by.emp_id !== who.emp_id) return `${who.name} entered this leave: only they can change it.`;
    return '';
  }
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 'Leave: a from and a to date.';
  if (to < from) return 'Leave: the last day is on or after the first.';
  if (to < today) return 'Leave: it is over already.';
  if (who.is_admin && by.emp_id !== who.emp_id) {
    if (who.leave && who.leave.setBy === who.emp_id) return `${who.name} entered their own leave: only they can change it.`;
    if (dayDiff(today, from) < 2) return `An Admin's leave is entered by that Admin, or starts at least 2 days ahead (${addDays(today, 2)}).`;
    if (dayDiff(from, to) + 1 > 30) return 'An Admin\'s leave entered by another Admin is at most 30 days.';
  }
  const covering = people.find((x) => x.emp_id !== who.emp_id && x.leave && x.leave.standIn === who.emp_id && overlap(x.leave.from, x.leave.to, from, to));
  if (covering) return `${who.name} is standing in for ${covering.name} on those dates, and someone on leave cannot stand in.`;
  if (!standIn) return '';
  return standInProblem(people.find((x) => x.emp_id === standIn), who, from, to);
}

function addDays(d, n) { return new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10); }

/**
 * can `rightsOf`'s powers sign q? -> { ok, why }. amount = max(the request's amount, the total it counts together with).
 */
function tryAs(actor, rightsOf, q, ctx) {
  const label = (ctx.sectionLabel || labelOf)(q.section);
  if (!permissions.can(rightsOf.perms, q.section, 'approve')) return { ok: false, why: `${rightsOf.role_name || 'This role'} cannot approve ${label}.` };
  if (!worksAt(rightsOf, q.godown_id)) return { ok: false, why: `${rightsOf.name} works at ${godownsText(rightsOf, ctx.godownNames)}, not ${(ctx.godownNames || {})[q.godown_id] || `godown ${q.godown_id}`}.` };
  const split = ctx.split || { total: 0, count: 1 };
  const amount = Math.max(Number(q.amount) || 0, Number(split.total) || 0);
  if (!covers(rightsOf.limit, amount)) {
    const whose = rightsOf === actor ? 'Your' : `${rightsOf.name}'s`;
    return { ok: false, over: true, why: `${whose} limit is ${limitText(rightsOf.limit)}. ${split.count > 1
      ? `Together with the other ${split.count - 1} request(s) it counts with, this is ${rs(amount)}.` : `This is ${rs(amount)}.`}` };
  }
  return { ok: true };
}

/** can person p sign request q today? -> { ok, why, via (the person stood in for) } */
function decide(p, q, ctx) {
  const today = ctx.today;
  const excluded = q.excluded || [];
  if (p.active === false) return { ok: false, why: `${p.name} has left and cannot sign anything.` };
  if (q.status !== 'pending') return { ok: false, why: `It is already ${q.status}.` };
  if (excluded.includes(p.emp_id)) return { ok: false, why: `${p.name} is part of this record (e.g. sent or received it), so cannot sign it.` };
  if (expired(q, today, ctx.expiryDays)) return { ok: false, why: 'This request expired and went back to the person who raised it.' };
  if (q.requested_by === p.emp_id) return { ok: false, why: 'You raised it. Somebody else must decide.' };
  if (onLeave(p, today)) {
    const sp = (ctx.people || []).find((x) => x.emp_id === p.leave.standIn);
    return { ok: false, why: `${p.name} is on leave until ${p.leave.to}.${sp ? ` ${sp.name} is standing in.` : ''}` };
  }
  const own = tryAs(p, p, q, ctx);
  if (own.ok) return own;
  if (LOCKED_KINDS.includes(q.kind)) return own; // a second-Admin rule is never signed through a stand-in
  const subs = (ctx.people || []).filter((x) => x.leave && x.leave.standIn === p.emp_id && onLeave(x, today));
  for (const s of subs) {
    if (s.emp_id === q.requested_by || excluded.includes(s.emp_id) || s.active === false) continue;
    if (standInProblem(p, s, s.leave.from, s.leave.to)) continue;
    const r = tryAs(p, s, q, ctx);
    if (r.ok) return { ok: true, via: s };
  }
  return own;
}

/** everyone who can sign q today, smallest limit first: [{ person, via, limit }] */
function ladder(q, ctx) {
  if (expired(q, ctx.today, ctx.expiryDays)) return [];
  const excluded = q.excluded || [];
  const out = [];
  for (const p of ctx.people || []) {
    if (excluded.includes(p.emp_id)) continue;
    const r = decide(p, q, ctx);
    if (!r.ok || (r.via && excluded.includes(r.via.emp_id))) continue;
    out.push({ person: p, via: r.via || null, limit: (r.via || p).limit });
  }
  return out.sort((a, b) => limitNum(a.limit) - limitNum(b.limit) || String(a.person.name).localeCompare(String(b.person.name)));
}

/**
 * does an action need approval under its rule? rule = approval_rules row; facts = { amount, qty, pct };
 * past = { total, count } of the same kind and target in the last "Days that count together" days (not this one)
 * -> { needs, total, count } (total = this amount + past, for Rs rules)
 */
function needs(rule, facts = {}, past = { total: 0, count: 0 }) {
  if (!rule || !Number(rule.is_on)) return { needs: false, total: Number(facts.amount) || 0, count: 0 };
  if (rule.unit === 'Rs') {
    const total = (Number(facts.amount) || 0) + (Number(past.total) || 0);
    const byPacks = rule.limit_packs !== null && rule.limit_packs !== undefined && (Number(facts.qty) || 0) > Number(rule.limit_packs);
    return { needs: total > Number(rule.limit_value || 0) || byPacks, total, count: past.count };
  }
  if (rule.unit === '%') return { needs: (Number(facts.pct) || 0) > Number(rule.limit_value || 0), total: Number(facts.amount) || 0, count: 0 };
  return { needs: true, total: Number(facts.amount) || 0, count: 0 };
}

/** the line a card shows about counting together, or '' */
function splitNote(split, days) {
  if (!split || split.count < 2) return '';
  return `Counts together with ${split.count - 1} other request(s) of the same kind in the last ${days} days: ${rs(split.total)} in all.`;
}

module.exports = { LOCKED_KINDS, limitNum, limitText, covers, worksAt, onLeave, expired, standInProblem, leaveProblem, tryAs, decide, ladder, needs, splitNote, addDays, dayDiff };
