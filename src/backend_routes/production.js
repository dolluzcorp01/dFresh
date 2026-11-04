// Section 4 Production (phase 17, v23 "SECTION 4 PRODUCTION - RULES"): the rules every production screen shares. The
// routes are in production-routes.js (recipes, machines, runs, production QC, wastage). Rights: the roles grid row
// "Production"; costs (made cost, material value, losses) only to See cost.
// - Recipe: per made pack (finished, Made or Both, not archived or discontinued): one batch makes `out` packs (whole
//   cartons) from raw materials (the first is the reel, in kg: wastage is measured on it); the wastage % allowed on top
//   (0 to 30); labour and power per pack. Dated versions: the first starts today or later; a change starts tomorrow at
//   the earliest and waits for approval (rule recipe); a run uses the version in force on its day (never a waiting one).
// - Made cost per pack (the estimate) = materials at average cost / out x (1 + wastage %) + labour + power.
// - Need for n packs = recipe x n / out x (1 + wastage %): kg to 2 decimals, pieces rounded up.
// - Start issues the need from Good (lot by lot, never an expired lot, never below zero); the batch is <machine>-yymmdd.
// - Finish: packs made (at most 110% of the plan) and the material really used: more than issued is taken from stock,
//   less goes back to the lot it came from. Wastage per input against the recipe for what was made; the worst counts;
//   nothing made = 100% (v22 PD1). Above the recipe needs a reason, and above it by more than the rule's % (or nothing
//   made) waits for approval (the run is done; the approval says it was looked at). Less material than the recipe cannot
//   make those packs: the finish waits and nothing moves until it is signed.
// - Run cost = material used at its average cost when issued + (labour + power) x packs made, to the paise; made cost
//   per pack = run cost / packs (shown to 2 decimals, never rounded away: the rounding stays in the last pack).
// - Packs made land in QC hold (QC hold off: straight into Good at made cost).
// - Production QC: passed + rejected = made. Rejects within the recipe's % (made x % rounded down) are a normal loss:
//   written off by quantity at Rs 0, their cost stays in the passed packs. Rejects above it are an abnormal loss:
//   written off at made cost, always with approval; the passed packs carry the run cost less the abnormal loss.
//   Passed packs go to Good and move the weighted average (kept to 6 decimals: the stock value keeps every paisa).
// - An abnormal loss (or a re-check write-off) that is not approved: the packs go (back) to QC hold at their made cost
//   and the run shows "Check again" (never lost, never stuck; v23 PD2, N11).
// - Packs with no cost: packs of the SKU in stock with no average cost at all take the run's cost; the run says so and
//   the admins get an alert (never silent; v23 Low1 d).
const { audit } = require('./audit');
const stock = require('./stock');
const approvals = require('./approvals');
const pricing = require('./pricing');
const notifications = require('./notifications');
const commerceSettings = require('./commerce-settings');
const { SKU_NAME, SKU_JOIN } = require('./catalogue');

const r2 = (n) => Math.round(Number(n) * 100) / 100;
const r6 = (n) => Math.round(Number(n) * 1e6) / 1e6;
const today = () => pricing.istToday();
const addDays = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const addMonths = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + n); return x.toISOString().slice(0, 10); };
const ymd = (v) => (v ? (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10)) : null);
const rs = (n) => `Rs ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SHIFTS = ['Day', 'Night'];
const WASTE_REASONS = ['Trim and roll ends', 'Machine jam', 'Wet or damp reel', 'Wrong setting at start', 'Less material used than the recipe (recount)', 'Other'];
const RUN_ST = { planned: 'Planned', started: 'Running', done: 'Finished', cancelled: 'Cancelled' };
const WST = { ok: 'Within the rules', waiting: 'Waiting', approved: 'Approved', rejected: 'Rejected' };

class ProdError extends Error {
  constructor(message, status = 400, fields = null) { super(message); this.status = status; this.fields = fields; }
}
/** throw a form error: { field: message } */
const bad = (fields, msg = 'Fix the fields marked in red') => { throw new ProdError(msg, 400, fields); };

/** quantities: kg to 2 decimals, everything else (packs, pieces) rounded up to whole units */
const qround = (unit, n) => (unit === 'kg' ? r2(n) : Math.ceil(n - 1e-9));
/** "49.92 kg" / "3 pieces" / "240 packs" */
function qtyText(unit, n) {
  const x = Number(n);
  const word = unit === 'kg' ? 'kg' : unit === 'pieces' ? (x === 1 ? 'piece' : 'pieces') : x === 1 ? (unit || 'pack') : `${unit || 'pack'}s`;
  return `${x.toLocaleString('en-IN', { maximumFractionDigits: 3 })} ${word}`;
}

// ---------------------------------------------------------------- items
/** facts of SKUs -> Map sku -> { sku_code, name, type, unit, source, status, category, per_carton, avg_cost, std_cost, track, life, makeable } */
async function items(q, codes = null) {
  const [rows] = await q.query(`SELECT s.sku_code, ${SKU_NAME} AS name, s.size_label, s.sku_type, s.unit_code, s.source, s.status, s.packs_per_carton, s.avg_cost, s.std_cost,
      p.category_key, p.status AS product_status, COALESCE(p.track_batches, 0) AS track, COALESCE(p.shelf_life_months, 0) AS life
      FROM skus s ${SKU_JOIN} ${codes ? 'WHERE s.sku_code IN (?)' : ''} ORDER BY s.sku_type DESC, s.sku_code`, codes ? [codes.length ? codes : ['']] : []);
  return new Map(rows.map((r) => {
    const raw = r.sku_type === 'raw';
    const live = !['archived', 'discontinued'].includes(r.status) && (raw || !['archived', 'discontinued'].includes(r.product_status));
    return [r.sku_code, { sku_code: r.sku_code, name: raw ? r.name : `${r.name} ${r.size_label || ''}`.trim(), type: r.sku_type, unit: raw ? r.unit_code : 'pack',
      source: r.source, status: r.status, category: r.category_key || null, per_carton: raw ? null : Number(r.packs_per_carton) || 1,
      avg_cost: r.avg_cost === null ? null : Number(r.avg_cost), std_cost: r.std_cost === null ? null : Number(r.std_cost),
      track: Number(r.track) === 1, life: Number(r.life) || 0, raw, live,
      makeable: !raw && live && r.status !== 'draft' && ['made', 'both'].includes(r.source) }];
  }));
}

// ---------------------------------------------------------------- recipes
const VER_COLS = `rv_id, sku_code, ver, DATE_FORMAT(from_date, '%Y-%m-%d') AS from_date, out_packs, waste_pct, labour, power, status, approval_id, decided_by, emp_id, created_at`;
async function withLines(q, rows) {
  if (!rows.length) return [];
  const [lines] = await q.query('SELECT rv_id, line_no, sku_code, qty FROM recipe_lines WHERE rv_id IN (?) ORDER BY rv_id, line_no', [rows.map((r) => r.rv_id)]);
  return rows.map((r) => ({ ...r, out_packs: Number(r.out_packs), waste_pct: Number(r.waste_pct), labour: Number(r.labour), power: Number(r.power),
    lines: lines.filter((l) => l.rv_id === r.rv_id).map((l) => ({ sku_code: l.sku_code, qty: Number(l.qty) })) }));
}
/** every version of a pack's recipe, oldest first */
async function versions(q, sku) {
  const [rows] = await q.query(`SELECT ${VER_COLS} FROM recipe_versions WHERE sku_code = ? ORDER BY ver`, [sku]);
  return withLines(q, rows);
}
/** the version in force on a day: active, started on or before it (the latest start); a waiting version is never used */
async function recipeOn(q, sku, day = today()) {
  const [rows] = await q.query(`SELECT ${VER_COLS} FROM recipe_versions WHERE sku_code = ? AND status = 'active' AND from_date <= ? ORDER BY from_date DESC, ver DESC LIMIT 1`, [sku, day]);
  return (await withLines(q, rows))[0] || null;
}
async function versionById(q, rvId) {
  const [rows] = await q.query(`SELECT ${VER_COLS} FROM recipe_versions WHERE rv_id = ?`, [rvId]);
  return (await withLines(q, rows))[0] || null;
}
/** made cost per pack from today's average costs -> { mat, lab, pow, unit, miss: [skus with no average cost] } */
function madeCost(v, its) {
  let mat = 0; const miss = [];
  for (const l of v.lines) { const a = (its.get(l.sku_code) || {}).avg_cost; if (a === null || a === undefined) miss.push(l.sku_code); else mat += l.qty * a; }
  mat = (mat / v.out_packs) * (1 + v.waste_pct / 100);
  return { mat: r2(mat), lab: v.labour, pow: v.power, unit: r2(mat + v.labour + v.power), miss };
}
/** what n packs need: the recipe scaled, with the allowed wastage on top */
const needFor = (v, n, its) => v.lines.map((l) => ({ sku_code: l.sku_code, qty: qround((its.get(l.sku_code) || {}).unit, (l.qty * n / v.out_packs) * (1 + v.waste_pct / 100)) }));
/** the standard (no wastage) for n packs */
const stdFor = (v, n) => v.lines.map((l) => ({ sku_code: l.sku_code, qty: r2((l.qty * n) / v.out_packs) }));

/**
 * wastage of a finish: for every input, used against the standard for what was made; the worst counts; nothing made =
 * 100% (v22 PD1). The allowance of pieces is rounded up as they are issued. Less than the standard less the allowance
 * cannot have made the packs ("under"). -> { sku, std, used, wpct, allowed, over, excess, per, value, none, under }
 */
function runWaste(v, used, out, its) {
  const per = v.lines.map((l) => {
    const unit = (its.get(l.sku_code) || {}).unit;
    const std = (l.qty * out) / v.out_packs;
    const u = Number((used.find((x) => x.sku_code === l.sku_code) || { qty: 0 }).qty);
    const wpct = std ? Math.round(((u - std) / std) * 1000) / 10 : u > 0 ? 100 : 0;
    const mx = std ? qround(unit, std * (1 + v.waste_pct / 100)) : 0;
    const mn0 = std ? Math.floor(std * (1 - v.waste_pct / 100) * 100) / 100 : 0;
    return { sku_code: l.sku_code, std: r2(std), used: u, wpct, excess: r2(Math.max(0, u - mx)), under: std > 0 && u < mn0 - 1e-9 };
  });
  const over = per.filter((x) => x.excess > 0);
  let worst = (over.length ? over.slice().sort((a, b) => b.wpct - a.wpct)[0] : per[0]) || { sku_code: '', std: 0, used: 0, wpct: 0, excess: 0 };
  if (!over.length && out && worst.wpct > v.waste_pct) worst = { ...worst, wpct: v.waste_pct, excess: 0 };
  const value = r2(per.reduce((n, x) => n + ((its.get(x.sku_code) || {}).avg_cost || 0) * x.excess, 0));
  return { sku_code: worst.sku_code, std: worst.std, used: worst.used, wpct: worst.wpct, allowed: v.waste_pct, over: Math.round((worst.wpct - v.waste_pct) * 10) / 10,
    excess: worst.excess, per, value, none: !out, under: per.filter((x) => x.under) };
}

// ---------------------------------------------------------------- stock helpers
/** usable stock of SKUs at a godown (Good, less expired lots; QC hold never counts) -> Map sku -> qty */
async function usable(q, codes, godown, lock = false) {
  const av = await stock.availability(q, codes, 0, { godown, lock });
  return new Map(codes.map((c) => [c, Math.max(0, r2(((av.get(c) || {}).good || 0) - ((av.get(c) || {}).expired || 0)))]));
}
async function onHold(q, codes, godown) {
  if (!codes.length) return new Map();
  const [rows] = await q.query("SELECT sku_code, SUM(delta) AS n FROM stock_movements WHERE location_id = ? AND stock_kind = 'hold' AND sku_code IN (?) GROUP BY sku_code", [godown, codes]);
  return new Map(rows.map((r) => [r.sku_code, Number(r.n)]));
}
/** good stock of a SKU across every godown (the average cost is per SKU across godowns) */
async function goodAll(q, sku) {
  const [[st]] = await q.query("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE sku_code = ? AND stock_kind = 'good'", [sku]);
  return Math.max(0, Number(st.n));
}
/**
 * n packs into Good worth `value` in all: the weighted average moves by the exact value (6 decimals), so the stock value
 * keeps every paisa. Packs in stock with no cost at all take this cost (uncosted, returned so the run can say so).
 * -> { before, after, uncosted: n | 0 }
 */
async function addToGood(q, { sku, godown, n, value, batch, doc, what, note }, empId) {
  const [[s]] = await q.query('SELECT avg_cost FROM skus WHERE sku_code = ? FOR UPDATE', [sku]);
  const onHand = await goodAll(q, sku);
  const before = s.avg_cost === null ? null : Number(s.avg_cost);
  const uncosted = before === null && onHand > 0 ? onHand : 0;
  const after = before === null || onHand === 0 ? r6(value / n) : r6((onHand * before + value) / (onHand + n));
  if (after !== before) await q.query('UPDATE skus SET avg_cost = ? WHERE sku_code = ?', [after, sku]);
  await stock.moveStock(q, { sku, godown, shelf: 'good', qty: n, batch, what, unitCost: r2(value / n), doc, note }, empId);
  return { before, after, uncosted };
}

// ---------------------------------------------------------------- runs
const RUN_COLS = `r.run_id, r.run_no, r.godown_id, g.name AS godown, r.sku_code, r.qty, r.machine_id, m.name AS machine, DATE_FORMAT(r.run_date, '%Y-%m-%d') AS run_date,
  r.shift, r.operator, r.is_auto, r.status, r.rv_id, r.batch_no, r.batch_id, r.started_at, r.ended_at, r.out_qty, r.scrap_kg, r.reason, r.mat_cost, r.run_cost, r.unit_made,
  r.wst, r.wst_approval_id, r.wst_by, r.fin_json, r.fin_approval_id, r.fin_note, r.qc, r.qc_by, r.qc_at, r.acc, r.rej, r.rej_allow, r.rej_normal, r.rej_abnormal,
  r.abnormal_value, r.unit_passed, r.wo_normal, r.wo_abnormal, r.recheck_qty, r.recheck_value, r.recheck_note, r.uncosted_qty, r.uncosted_unit,
  r.cancel_reason, r.cancelled_by, r.created_by, r.created_at`;
const RUN_FROM = 'production_runs r JOIN locations g ON g.location_id = r.godown_id JOIN machines m ON m.machine_id = r.machine_id';
async function runRows(q, where, params = [], lock = false) {
  const [rows] = await q.query(`SELECT ${RUN_COLS} FROM ${RUN_FROM} WHERE ${where} ORDER BY r.run_id DESC${lock ? ' FOR UPDATE' : ''}`, params);
  return rows.map((r) => ({ ...r, fin: r.fin_json ? (typeof r.fin_json === 'string' ? JSON.parse(r.fin_json) : r.fin_json) : null }));
}
async function runOf(q, id, lock = false) {
  const [r] = await runRows(q, 'r.run_id = ?', [Number(id)], lock);
  return r || null;
}
async function materialsOf(q, runId) {
  const [rows] = await q.query('SELECT line_no, sku_code, issued, used, cost FROM run_materials WHERE run_id = ? ORDER BY line_no', [runId]);
  return rows.map((r) => ({ line_no: r.line_no, sku_code: r.sku_code, issued: Number(r.issued), used: r.used === null ? null : Number(r.used), cost: r.cost === null ? null : Number(r.cost) }));
}
/** the batch of a run: <machine>-yymmdd */
const batchNo = (machineId, day) => `M${machineId}-${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}`;

async function settings(q) {
  const s = await commerceSettings.read(q);
  const on = (v) => v === undefined || v === null || v === true || v === 1 || v === '1' || v === 'true';
  return { quarantine: on(s.quarantine) };
}

/**
 * apply a finish (straight away, or when the less-material request is signed): material back or extra out, cost, the
 * packs into QC hold (or Good), the wastage approval. f = { out, scrap, reason, used: [qty per line] } -> message text
 */
async function finishApply(q, run, f, empId) {
  const mats = await materialsOf(q, run.run_id);
  const v = await versionById(q, run.rv_id);
  const its = await items(q, [run.sku_code, ...mats.map((m) => m.sku_code)]);
  const doc = { type: 'run', id: run.run_no };
  let mat = 0;
  for (const [i, m] of mats.entries()) {
    const u = Number(f.used[i]);
    const unit = (its.get(m.sku_code) || {}).unit;
    const d = qround(unit, m.issued - u);
    if (d > 0) {
      // back to the lot it came from (the last lot issued)
      const [[lot]] = await q.query("SELECT batch_id FROM stock_movements WHERE ref_type = 'run' AND ref_id = ? AND sku_code = ? AND move_type = 'prod_issue' ORDER BY move_id DESC LIMIT 1", [run.run_no, m.sku_code]);
      await stock.moveStock(q, { sku: m.sku_code, godown: run.godown_id, shelf: 'good', qty: d, batch: lot ? lot.batch_id : null, what: 'prod_return', unitCost: r2(m.cost || 0), doc, note: `Returned from ${run.run_no}` }, empId);
      mat += u * (m.cost || 0);
    } else if (d < 0) {
      const now = (its.get(m.sku_code) || {}).avg_cost || 0;
      await stock.moveStock(q, { sku: m.sku_code, godown: run.godown_id, shelf: 'good', qty: d, what: 'prod_issue', unitCost: r2(now), doc, note: `More issued to ${run.run_no}` }, empId);
      mat += m.issued * (m.cost || 0) + -d * now;
    } else mat += u * (m.cost || 0);
    await q.query('UPDATE run_materials SET used = ? WHERE run_id = ? AND line_no = ?', [u, run.run_id, m.line_no]);
  }
  const out = Number(f.out);
  const used = mats.map((m, i) => ({ sku_code: m.sku_code, qty: Number(f.used[i]) }));
  const w = runWaste(v, used, out, its);
  const runCost = r2(mat + (v.labour + v.power) * out);
  const unitMade = out ? runCost / out : null;
  const scrap = f.scrap === '' || f.scrap === null || f.scrap === undefined ? 0 : r2(f.scrap);
  // wastage: nothing made always asks; above the recipe by more than the rule's % asks (v22 PD1)
  const wl = w.per.filter((x) => x.excess > 0 || (out === 0 && x.used > 0)).map((x) => `${x.sku_code} ${x.wpct}%${x.excess ? ` (${x.excess} over)` : ''}`);
  if (w.under.length) wl.push(`less than the recipe: ${w.under.map((x) => `${x.sku_code} ${x.used} used of ${x.std}`).join(', ')}`);
  let wst = 'ok';
  let msg = '';
  const asks = out === 0 || (w.over > 0 && (await approvals.check(q, 'prod_scrap', { pct: w.over, amount: w.value })).needs);
  let wstId = null;
  if (asks) {
    wst = 'waiting';
    const what = out === 0 ? 'nothing made, every input used is wastage' : w.under.length && !(w.over > 0) ? 'packs made with less material than the recipe' : `wastage above the ${w.allowed}% in the recipe`;
    wstId = await approvals.request(q, { kind: 'prod_scrap', godownId: run.godown_id, refType: 'run', refId: run.run_no,
      summary: `Run ${run.run_no} ${run.sku_code}: ${what}${wl.length ? `: ${wl.join('; ')}` : ''}. ${f.reason || ''}`.trim(), amount: w.value, payload: { t: 'waste', run_id: run.run_id } }, empId);
    msg = `${out === 0 ? 'Nothing made: ' : `Wastage ${w.wpct}% is ${w.over}% above the recipe: `}it waits for approval. `;
  }
  await q.query(`UPDATE production_runs SET status = 'done', ended_at = UTC_TIMESTAMP(), out_qty = ?, scrap_kg = ?, reason = ?, mat_cost = ?, run_cost = ?, unit_made = ?,
      wst = ?, wst_approval_id = ?, fin_json = NULL, fin_note = NULL WHERE run_id = ?`,
  [out, scrap, f.reason || null, r6(mat), runCost, unitMade === null ? null : Math.round(unitMade * 1e4) / 1e4, wst, wstId, run.run_id]);
  if (out) {
    const sk = its.get(run.sku_code);
    const mfg = run.run_date; // the day it started
    let batchId = null;
    if (sk.track) {
      const exp = addMonths(mfg, sk.life);
      const [[b]] = await q.query("SELECT batch_id FROM batches WHERE sku_code = ? AND batch_no = ?", [run.sku_code, run.batch_no]);
      batchId = b ? b.batch_id : (await q.query('INSERT INTO batches (sku_code, batch_no, mfg_date, expiry_date, created_by) VALUES (?, ?, ?, ?, ?)', [run.sku_code, run.batch_no, mfg, exp, empId]))[0].insertId;
      await q.query('UPDATE production_runs SET batch_id = ? WHERE run_id = ?', [batchId, run.run_id]);
    }
    if ((await settings(q)).quarantine) {
      await stock.moveStock(q, { sku: run.sku_code, godown: run.godown_id, shelf: 'hold', qty: out, batch: batchId, what: 'made', unitCost: r2(unitMade), doc, note: `Made, ${run.run_no}` }, empId);
      await q.query("UPDATE production_runs SET qc = 'hold' WHERE run_id = ?", [run.run_id]);
      msg += `${out} packs are in QC hold.`;
    } else {
      const a = await addToGood(q, { sku: run.sku_code, godown: run.godown_id, n: out, value: runCost, batch: batchId, doc, what: 'prod_pass', note: `Made, into stock (QC hold is off), ${run.run_no}` }, empId);
      await q.query("UPDATE production_runs SET qc = 'passed', qc_by = 'auto', qc_at = UTC_TIMESTAMP(), acc = ?, rej = 0, unit_passed = unit_made WHERE run_id = ?", [out, run.run_id]);
      if (a.uncosted) await noCost(q, run, a.uncosted, runCost / out, sk);
      msg += `${out} packs are in stock (QC hold is off).`;
    }
  }
  await audit(q, { empId, action: 'finish', entity: 'production_run', entityId: run.run_no, before: { status: 'Running' },
    after: { made: out, used: used.map((u) => `${u.sku_code} ${u.qty}`), wastage: `${w.wpct}% (recipe ${w.allowed}%)`, reason: f.reason || undefined, scrap_kg: scrap || undefined, wastage_approval: wst === 'waiting' ? wstId : undefined } });
  return { msg: msg.trim(), unit: unitMade, w };
}

/** packs in stock with no cost were given the run's cost: the run says so and the admins get an alert (never silent) */
async function noCost(q, run, qty, unit, sk) {
  await q.query('UPDATE production_runs SET uncosted_qty = ?, uncosted_unit = ? WHERE run_id = ?', [qty, Math.round(unit * 1e4) / 1e4, run.run_id]);
  await notifications.adminAlert(q, { subject: `${sk.name}: ${qty} packs had no cost`, ref: `nocost ${run.sku_code} ${run.run_no}`,
    body: `They were given ${rs(unit)} from ${run.run_no} on ${today()}. If that is wrong, set the standard cost in Products.` });
}

/**
 * production QC of a run in QC hold: passed + rejected = made. -> { message, ... }
 * Normal loss (within the recipe %): written off at Rs 0 now; abnormal loss (above it): a write-off at made cost that
 * always waits for approval. Passed packs carry the run cost less the abnormal loss.
 */
async function qcRun(q, run, acc, rej, empId) {
  const v = await versionById(q, run.rv_id);
  const its = await items(q, [run.sku_code]);
  const sk = its.get(run.sku_code);
  const out = Number(run.out_qty);
  const doc = { type: 'run', id: run.run_no };
  await stock.moveStock(q, { sku: run.sku_code, godown: run.godown_id, shelf: 'hold', qty: -out, batch: run.batch_id, strict: Boolean(run.batch_id), what: 'prod_qc', doc, note: `Production QC, ${run.run_no}` }, empId);
  const allowN = Math.floor((out * v.waste_pct) / 100 + 1e-9);
  const rn = Math.min(rej, allowN);
  const ra = rej - rn;
  const runCost = Number(run.run_cost);
  const unitMade = runCost / out;
  const abVal = r2(unitMade * ra);
  const passedVal = acc ? r2(runCost - abVal) : 0;
  let woN = null; let woA = null; let woMsg = '';
  if (rej) await stock.moveStock(q, { sku: run.sku_code, godown: run.godown_id, shelf: 'dmg', qty: rej, batch: run.batch_id, what: 'prod_reject', unitCost: r2(unitMade), doc, note: `Rejected at production QC, ${run.run_no}` }, empId);
  if (rn) {
    const [ins] = await q.query(`INSERT INTO write_offs (sku_code, godown_id, stock_kind, batch_id, qty, reason_type, reason, value, status, run_id, loss, emp_id)
        VALUES (?, ?, 'dmg', ?, ?, 'prodqc', ?, 0, 'pending', ?, 'normal', ?)`,
    [run.sku_code, run.godown_id, run.batch_id, rn, `Normal loss at QC of run ${run.run_no} (within ${v.waste_pct}%): cost carried by the passed packs`, run.run_id, empId]);
    woN = ins.insertId;
    await stock.postWriteOff(q, woN, empId);
    woMsg += `; ${rn} rejected within the ${v.waste_pct}% allowed: normal loss, written off at Rs 0 (WO-${woN}), cost spread over the passed packs`;
  }
  if (ra) {
    const [ins] = await q.query(`INSERT INTO write_offs (sku_code, godown_id, stock_kind, batch_id, qty, reason_type, reason, value, status, run_id, loss, emp_id)
        VALUES (?, ?, 'dmg', ?, ?, 'prodqc', ?, ?, 'pending', ?, 'abnormal', ?)`,
    [run.sku_code, run.godown_id, run.batch_id, ra, `Abnormal loss at QC of run ${run.run_no} (above the ${v.waste_pct}% allowed)`, abVal, run.run_id, empId]);
    woA = ins.insertId;
    const aid = await approvals.request(q, { kind: 'write_off', godownId: run.godown_id, refType: 'write_off', refId: String(woA), amount: abVal, payload: { write_off_id: woA },
      summary: `${ra} ${run.sku_code} rejected at production QC of ${run.run_no} above the ${v.waste_pct}% allowed: abnormal loss at cost` }, empId);
    await q.query('UPDATE write_offs SET approval_id = ? WHERE write_off_id = ?', [aid, woA]);
    woMsg += `; ${ra} above the limit: abnormal loss ${rs(abVal)}, WO-${woA} waits for approval`;
  }
  let av = null;
  if (acc) {
    av = await addToGood(q, { sku: run.sku_code, godown: run.godown_id, n: acc, value: passedVal, batch: run.batch_id, doc, what: 'prod_pass', note: `Passed production QC, ${run.run_no}` }, empId);
    if (av.uncosted) await noCost(q, run, av.uncosted, passedVal / acc, sk);
  }
  await q.query(`UPDATE production_runs SET qc = 'passed', qc_by = ?, qc_at = UTC_TIMESTAMP(), acc = ?, rej = ?, rej_allow = ?, rej_normal = ?, rej_abnormal = ?, abnormal_value = ?,
      unit_passed = ?, wo_normal = ?, wo_abnormal = ? WHERE run_id = ?`,
  [empId, acc, rej, allowN, rn, ra, abVal, acc ? Math.round((passedVal / acc) * 1e4) / 1e4 : null, woN, woA, run.run_id]);
  await audit(q, { empId, action: 'update', entity: 'quality_check', entityId: run.run_no, before: { status: 'QC hold' },
    after: { passed: acc, rejected: rej, normal_loss: rn || undefined, abnormal_loss: ra || undefined, write_offs: [woN, woA].filter(Boolean).map((x) => `WO-${x}`) } });
  return { acc, rej, rn, ra, abVal, passedVal, av, woN, woA, woMsg, unitMade };
}

/** Check again: packs back on QC hold after a loss was not approved. acc pass at their made cost; the rest go as a write-off for approval */
async function recheckRun(q, run, acc, empId) {
  const qty = Number(run.recheck_qty);
  const value = Number(run.recheck_value);
  const doc = { type: 'run', id: run.run_no };
  const there = await stock.onShelf(q, { sku: run.sku_code, godown: run.godown_id, shelf: 'hold', batch: run.batch_id });
  if (there < qty) throw new ProdError(`Only ${there} of batch ${run.batch_no} are on QC hold.`, 409);
  const accVal = acc === qty ? value : r2((value * acc) / qty);
  const rej = qty - acc;
  const rejVal = r2(value - accVal);
  let av = null; let wo = null;
  if (acc) {
    await stock.moveStock(q, { sku: run.sku_code, godown: run.godown_id, shelf: 'hold', qty: -acc, batch: run.batch_id, strict: Boolean(run.batch_id), what: 'prod_qc', doc, note: `Checked again: passed, ${run.run_no}` }, empId);
    av = await addToGood(q, { sku: run.sku_code, godown: run.godown_id, n: acc, value: accVal, batch: run.batch_id, doc, what: 'prod_pass', note: `Checked again: passed, ${run.run_no}` }, empId);
  }
  if (rej) {
    const [ins] = await q.query(`INSERT INTO write_offs (sku_code, godown_id, stock_kind, batch_id, qty, reason_type, reason, value, status, run_id, loss, emp_id)
        VALUES (?, ?, 'hold', ?, ?, 'prodqc', ?, ?, 'pending', ?, 'recheck', ?)`,
    [run.sku_code, run.godown_id, run.batch_id, rej, `Rejected again after the abnormal loss of run ${run.run_no} was not approved`, rejVal, run.run_id, empId]);
    wo = ins.insertId;
    const aid = await approvals.request(q, { kind: 'write_off', godownId: run.godown_id, refType: 'write_off', refId: String(wo), amount: rejVal, payload: { write_off_id: wo },
      summary: `${rej} ${run.sku_code} of run ${run.run_no} rejected again at QC: write-off at cost` }, empId);
    await q.query('UPDATE write_offs SET approval_id = ? WHERE write_off_id = ?', [aid, wo]);
  }
  const note = `Checked again: ${acc} passed${rej ? `, ${rej} sent as write-off WO-${wo}` : ''}.`;
  await q.query('UPDATE production_runs SET recheck_qty = 0, recheck_value = 0, recheck_note = ? WHERE run_id = ?', [note, run.run_id]);
  await audit(q, { empId, action: 'recheck', entity: 'quality_check', entityId: run.run_no, before: { 'check again': `${qty} on QC hold` }, after: { passed: acc, write_off: wo ? `WO-${wo} (${rej})` : undefined } });
  return { acc, rej, accVal, rejVal, wo, av, unit: value / qty };
}

// a run's write-off that is not approved (rejected, withdrawn or expired): the packs go (back) to QC hold at their made
// cost and the run shows Check again (v23 PD2, N11). The normal loss posts at once, so it never comes here.
stock.onWriteOffClosed(async (q, writeOffId, status, empId) => {
  const [[w]] = await q.query('SELECT write_off_id, run_id, loss, sku_code, godown_id, stock_kind, batch_id, qty, value FROM write_offs WHERE write_off_id = ?', [writeOffId]);
  if (!w || !w.run_id || !['abnormal', 'recheck'].includes(w.loss)) return;
  const [[run]] = await q.query('SELECT run_id, run_no, recheck_qty, recheck_value FROM production_runs WHERE run_id = ? FOR UPDATE', [w.run_id]);
  if (!run) return;
  if (w.loss === 'abnormal') {
    await stock.moveShelf(q, { sku: w.sku_code, godown: w.godown_id, from: 'dmg', to: 'hold', qty: w.qty, batch: w.batch_id, doc: { type: 'run', id: run.run_no }, what: 'recheck_hold',
      note: `Abnormal loss WO-${w.write_off_id} ${status}: back to QC hold at cost` }, empId);
  }
  const qty = Number(run.recheck_qty || 0) + Number(w.qty);
  const value = r2(Number(run.recheck_value || 0) + Number(w.value || 0));
  await q.query('UPDATE production_runs SET recheck_qty = ?, recheck_value = ?, recheck_note = ? WHERE run_id = ?',
    [qty, value, `Write-off WO-${w.write_off_id} was ${status}: ${w.qty} packs are on QC hold at their made cost to check again.`, run.run_id]);
  await audit(q, { empId, action: 'recheck_hold', entity: 'production_run', entityId: run.run_no, after: { write_off: `WO-${w.write_off_id} ${status}`, 'check again': `${qty} packs, ${rs(value)}` } });
});

module.exports = {
  SHIFTS, WASTE_REASONS, RUN_ST, WST, ProdError, bad, r2, r6, rs, today, addDays, ymd, qround, qtyText,
  items, versions, recipeOn, versionById, madeCost, needFor, stdFor, runWaste, usable, onHold, goodAll, addToGood,
  runRows, runOf, materialsOf, batchNo, settings, finishApply, qcRun, recheckRun,
};
