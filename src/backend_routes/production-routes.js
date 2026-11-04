// Section 4 Production, the screens' API (phase 17, v23 "SECTION 4 PRODUCTION - ACTIONS"; rules in production.js).
// Rights (roles grid row "Production"): view = every page; create = plan, start and finish a run, Plan from low stock;
// edit = recipes, machines, production QC and Check again; cancel = cancel a planned run; approve (Approvals) = recipe
// changes and wastage above the recipe. Costs (made cost, material value, losses, standard cost) only to See cost.
// Every run and machine belongs to a godown: people see the godowns they work at, records elsewhere answer 404.
// Approvals go through the one request engine (approvals.js): recipe (every change), prod_scrap (wastage above the
// recipe by more than the rule's %, nothing made, and a finish with less material than the recipe: nothing moves until
// it is signed), write_off (the abnormal loss and a re-check write-off, always). Dated actions check the month lock.
const prod = require('./production');
const { audit } = require('./audit');
const approvals = require('./approvals');
const secondAdmin = require('./second-admin');
const numbering = require('./numbering');
const stock = require('./stock');
const books = require('./books');
const godowns = require('./godowns');
const auth = require('./auth');
const permissions = require('../shared/permissions');

const { r2, rs, qround, qtyText, ProdError, bad, today } = prod;
const whole = (v, min = 0) => /^\d+$/.test(String(v ?? '').trim()) && Number(v) >= min;
const num = (v) => String(v ?? '').trim() !== '' && Number.isFinite(Number(v));
const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));

async function namesOf(q, ids) {
  const list = [...new Set(ids.filter((x) => x && x !== 'auto'))];
  if (!list.length) return new Map();
  const [rows] = await q.query(`SELECT emp_id, TRIM(CONCAT(COALESCE(emp_first_name, ''), ' ', COALESCE(emp_last_name, ''))) AS name FROM \`${auth.DADMIN}\`.employee WHERE emp_id IN (?)`, [list]);
  return new Map(rows.map((r) => [r.emp_id, r.name || r.emp_id]));
}
const nm = (names, id) => (id === 'auto' ? 'Passed straight away (QC hold is off)' : names.get(id) || id || '');
async function categories(q) {
  const [rows] = await q.query("SELECT c.category_key, COALESCE(ct.name, c.category_key) AS name FROM categories c LEFT JOIN category_translations ct ON ct.category_key = c.category_key AND ct.lang_code = 'en' ORDER BY c.sort_order");
  return rows.map((r) => ({ key: r.category_key, name: r.name }));
}
const matList = (lines, its) => lines.map((l) => `${qtyText((its.get(l.sku_code) || {}).unit, l.qty)} ${((its.get(l.sku_code) || {}).name || l.sku_code).toLowerCase()}`).join(', ');

// ---------------------------------------------------------------- approvals: what happens when they are decided
approvals.onApproved('recipe', async (q, p, empId) => {
  const [[v]] = await q.query('SELECT rv_id, sku_code, ver, status FROM recipe_versions WHERE rv_id = ? FOR UPDATE', [p.rv_id]);
  if (!v || v.status !== 'waiting') return;
  await q.query("UPDATE recipe_versions SET status = 'active', decided_by = ? WHERE rv_id = ?", [empId, v.rv_id]);
  await audit(q, { empId, action: 'approve', entity: 'recipe', entityId: `${v.sku_code} v${v.ver}`, before: { status: 'waiting' }, after: { status: 'in use' } });
});
approvals.onClosed('recipe', async (q, p, status, empId) => {
  const [[v]] = await q.query('SELECT rv_id, sku_code, ver, status FROM recipe_versions WHERE rv_id = ? FOR UPDATE', [p.rv_id]);
  if (!v || v.status !== 'waiting') return;
  await q.query("UPDATE recipe_versions SET status = 'rejected', decided_by = ? WHERE rv_id = ?", [empId, v.rv_id]);
  await audit(q, { empId, action: status, entity: 'recipe', entityId: `${v.sku_code} v${v.ver}`, before: { status: 'waiting' }, after: { status } });
});
approvals.onRecheck('recipe', async (q, p) => {
  const [[v]] = await q.query('SELECT status FROM recipe_versions WHERE rv_id = ?', [p.rv_id]);
  return !v || v.status !== 'waiting' ? 'the recipe change is no longer waiting' : '';
});
approvals.onRecheck('prod_scrap', async (q, p) => {
  const run = await prod.runOf(q, p.run_id);
  if (!run) return 'the run is gone';
  if (p.t === 'waste') return run.wst !== 'waiting' ? 'the wastage is no longer waiting' : '';
  if (run.status !== 'started' || !run.fin) return 'the finish is no longer waiting';
  // more material than issued is taken from stock when it is signed: it must still be there
  const mats = await prod.materialsOf(q, run.run_id);
  const its = await prod.items(q, mats.map((m) => m.sku_code));
  const have = await prod.usable(q, mats.map((m) => m.sku_code), run.godown_id);
  for (const [i, m] of mats.entries()) {
    const more = Number(run.fin.used[i]) - m.issued;
    if (more > 1e-9 && (have.get(m.sku_code) || 0) < more) return `only ${qtyText((its.get(m.sku_code) || {}).unit, have.get(m.sku_code) || 0)} more ${m.sku_code} is usable in stock now`;
  }
  return '';
});
approvals.onApproved('prod_scrap', async (q, p, empId) => {
  const run = await prod.runOf(q, p.run_id, true);
  if (!run) return;
  const names = await namesOf(q, [empId]);
  if (p.t === 'waste') {
    if (run.wst !== 'waiting') return;
    await q.query("UPDATE production_runs SET wst = 'approved', wst_by = ? WHERE run_id = ?", [empId, run.run_id]);
    await audit(q, { empId, action: 'approve', entity: 'production_run', entityId: run.run_no, before: { wastage: 'waiting' }, after: { wastage: 'approved' } });
    return;
  }
  if (run.status !== 'started' || !run.fin) return;
  const f = run.fin;
  await prod.finishApply(q, run, { ...f, reason: `${f.reason} (signed by ${nm(names, empId)})` }, empId);
});
approvals.onClosed('prod_scrap', async (q, p, status, empId) => {
  const run = await prod.runOf(q, p.run_id, true);
  if (!run) return;
  const names = await namesOf(q, [empId]);
  if (p.t === 'waste') {
    if (run.wst !== 'waiting' || status === 'expired') return; // expired: Send again asks once more
    await q.query("UPDATE production_runs SET wst = 'rejected', wst_by = ? WHERE run_id = ?", [empId, run.run_id]);
    await audit(q, { empId, action: status, entity: 'production_run', entityId: run.run_no, before: { wastage: 'waiting' }, after: { wastage: `${status}: look into it` } });
    return;
  }
  if (run.status !== 'started' || !run.fin) return;
  const note = status === 'expired' ? 'The finish request expired: count the packs and the material again, and finish once more.'
    : `Finish ${status} by ${nm(names, empId)}: count the packs and the material again.`;
  await q.query('UPDATE production_runs SET fin_json = NULL, fin_approval_id = NULL, fin_note = ? WHERE run_id = ?', [note, run.run_id]);
  await audit(q, { empId, action: status, entity: 'production_run', entityId: run.run_no, before: { finish: 'waiting' }, after: { finish: note } });
});
// Send again: a wastage request that expired asks once more (the run is done); a finish is asked again from the run
approvals.onAgain('prod_scrap', async (q, p) => {
  if (p.t !== 'waste') return 'finish the run again from Production runs';
  const run = await prod.runOf(q, p.run_id);
  return run && run.wst === 'waiting' ? '' : 'the wastage is no longer waiting';
});

function register({ route, tx, db, by, InputError, canDo, commerceGate, seesCost }) {
  const G = { before: [commerceGate] };
  const asErr = (e) => {
    if (e instanceof ProdError || e instanceof stock.StockError || e instanceof books.BooksError || e instanceof godowns.GodownError || e instanceof secondAdmin.GateError) {
      const x = new InputError(e.message, e.status || 400); if (e.fields) { x.code = 'fields'; x.fields = e.fields; } return x;
    }
    return e;
  };
  const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (e) { throw asErr(e); } };
  const hide = (req, v) => (seesCost(req) ? v : null);
  const scope = (req) => godowns.viewScope(req);
  const sees = (req, gid) => godowns.assertSees(req, gid, 'Not found');
  const works = (req, gid) => godowns.assertWorks(req.admin, gid);
  const myGodowns = async (q, req) => (await godowns.list(q)).filter((g) => g.is_active && godowns.covers(req.admin, g.godown_id));
  const waitLine = (q, id) => (id ? secondAdmin.waitingLine(q, id) : '');
  const can = (req, a) => canDo(req, 'production', a);

  // the people who may run a machine at a godown: Production Create, working there, active
  async function operators(q, godown = null) {
    return (await approvals.people(q)).filter((p) => p.active && !p.pending && permissions.can(p.perms, 'production', 'create') && (godown === null || godowns.covers(p, godown)))
      .map((p) => ({ emp_id: p.emp_id, name: p.name, role: p.role_name || '', godowns: p.godowns }));
  }
  async function machines(q, req) {
    const [gw, gp] = godowns.where('m.godown_id', scope(req));
    const [rows] = await q.query(`SELECT m.machine_id, m.name, m.godown_id, g.name AS godown, m.makes, m.per_hour, m.status, m.stop_reason,
        (SELECT run_no FROM production_runs r WHERE r.machine_id = m.machine_id AND r.status = 'started' LIMIT 1) AS busy
        FROM machines m JOIN locations g ON g.location_id = m.godown_id WHERE ${gw} ORDER BY m.machine_id`, gp);
    return rows.map((m) => ({ ...m, makes: String(m.makes || '').split(',').filter(Boolean) }));
  }

  // ============================================================================================ options
  route('get', '/production/options', 'production:view', wrap(async (req) => {
    const its = await prod.items(db);
    const t = today();
    const packs = [];
    for (const s of [...its.values()].filter((x) => x.makeable)) { const v = await prod.recipeOn(db, s.sku_code, t); if (v) packs.push({ sku_code: s.sku_code, name: s.name, per_carton: s.per_carton, category: s.category }); }
    return {
      today: t, godowns: (await myGodowns(db, req)).map((g) => ({ godown_id: g.godown_id, name: g.name })), machines: await machines(db, req), packs,
      operators: await operators(db), shifts: prod.SHIFTS, reasons: prod.WASTE_REASONS, categories: await categories(db),
      raws: [...its.values()].filter((x) => x.raw && x.live).map((x) => ({ sku_code: x.sku_code, name: x.name, unit: x.unit })),
      quarantine: (await prod.settings(db)).quarantine, see_cost: seesCost(req),
      can: { create: can(req, 'create'), edit: can(req, 'edit'), cancel: can(req, 'cancel') },
    };
  }), G);

  // ============================================================================================ recipes
  route('get', '/production/recipes', 'production:view', wrap(async (req) => {
    const its = await prod.items(db);
    const t = today();
    const withR = []; const without = [];
    for (const s of [...its.values()].filter((x) => x.makeable)) {
      const vers = await prod.versions(db, s.sku_code);
      if (!vers.length) { without.push({ sku_code: s.sku_code, name: s.name, source: s.source === 'both' ? 'Made and bought' : 'Made' }); continue; }
      const cur = await prod.recipeOn(db, s.sku_code, t);
      const next = vers.find((v) => v.status === 'active' && v.from_date > t) || null;
      const waiting = vers.find((v) => v.status === 'waiting') || null;
      if (!cur && !waiting && !next) continue;
      const mc = cur ? prod.madeCost(cur, its) : null;
      withR.push({ sku_code: s.sku_code, name: s.name, per_carton: s.per_carton,
        cur: cur ? { ver: cur.ver, from: cur.from_date, out: cur.out_packs, cartons: cur.out_packs / s.per_carton, waste: cur.waste_pct, uses: matList(cur.lines, its) } : null,
        next: next ? { ver: next.ver, from: next.from_date } : null, waiting: waiting ? { ver: waiting.ver } : null,
        made_cost: hide(req, mc ? mc.unit : null), std_cost: hide(req, s.std_cost) });
    }
    return { with: withR, without, see_cost: seesCost(req), can: { edit: can(req, 'edit') } };
  }), G);
  route('get', '/production/recipes/:sku', 'production:view', wrap(async (req) => {
    const sku = String(req.params.sku).toUpperCase();
    const its = await prod.items(db);
    const s = its.get(sku);
    if (!s || !s.makeable) throw new InputError('Not a made pack', 404);
    const t = today();
    const vers = await prod.versions(db, sku);
    const cur = await prod.recipeOn(db, sku, t) || null;
    const waiting = vers.find((v) => v.status === 'waiting') || null;
    const names = await namesOf(db, vers.map((v) => v.emp_id));
    const line = (l) => ({ sku_code: l.sku_code, qty: l.qty, name: (its.get(l.sku_code) || {}).name || l.sku_code, unit: (its.get(l.sku_code) || {}).unit });
    const mc = cur ? prod.madeCost(cur, its) : null;
    const others = [];
    for (const [code, x] of its) { if (code !== sku && x.makeable) { const v = await prod.recipeOn(db, code, t); if (v) others.push({ sku_code: code, name: x.name, lines: v.lines.map(line) }); } }
    const ed = can(req, 'edit');
    return {
      sku_code: sku, name: s.name, per_carton: s.per_carton, today: t,
      cur: cur ? { ver: cur.ver, from: cur.from_date, out: cur.out_packs, waste: cur.waste_pct, labour: cur.labour, power: cur.power, lines: cur.lines.map(line) } : null,
      waiting: waiting ? { ver: waiting.ver, from: waiting.from_date, uses: matList(waiting.lines, its), wait_line: await waitLine(db, waiting.approval_id) } : null,
      versions: vers.slice().reverse().map((v) => ({ ver: v.ver, from: v.from_date, out: v.out_packs, uses: matList(v.lines, its), waste: v.waste_pct,
        status: { active: 'in use', waiting: 'waiting for approval', rejected: 'rejected' }[v.status], by: nm(names, v.emp_id) })),
      next_ver: vers.length + 1, copy_from: others,
      raws: [...its.values()].filter((x) => x.raw && x.live).map((x) => ({ sku_code: x.sku_code, name: x.name, unit: x.unit })),
      // the made cost and the average costs for the live sum on the form: only to See cost
      made: hide(req, mc), std_cost: hide(req, s.std_cost), avg: seesCost(req) ? Object.fromEntries([...its.values()].filter((x) => x.raw).map((x) => [x.sku_code, x.avg_cost])) : null,
      change_waits: Boolean(cur) && (await approvals.check(db, 'recipe', {})).needs,
      can: { edit: ed && !waiting, use_cost: ed && seesCost(req) && canDo(req, 'products', 'edit') && Boolean(mc) && Math.abs((s.std_cost || 0) - mc.unit) > 0.004 },
    };
  }), G);
  route('post', '/production/recipes/:sku', 'production:edit', wrap(async (req) => tx(async (q) => {
    const sku = String(req.params.sku).toUpperCase();
    const its = await prod.items(q);
    const s = its.get(sku);
    if (!s || !s.makeable) throw new InputError('Not a made pack', 404);
    await q.query('SELECT sku_code FROM skus WHERE sku_code = ? FOR UPDATE', [sku]);
    const vers = await prod.versions(q, sku);
    if (vers.some((v) => v.status === 'waiting')) throw new InputError('A change is already waiting for approval.', 409);
    const t = today();
    const cur = await prod.recipeOn(q, sku, t);
    const b = req.body || {};
    const e = {};
    const out = String(b.out_packs ?? '').trim(); const from = String(b.from_date || ''); const w = String(b.waste_pct ?? '').trim();
    const lab = String(b.labour ?? '').trim(); const pow = String(b.power ?? '').trim();
    if (!whole(out, 1)) e.out_packs = 'A whole number of packs.'; else if (Number(out) % s.per_carton) e.out_packs = `Make it whole cartons: a multiple of ${s.per_carton}.`;
    if (!isDay(from) || from < t) e.from_date = 'Today or later.';
    else if (vers.length && from <= t) e.from_date = "A change starts tomorrow at the earliest, so today's runs keep their recipe.";
    if (!num(w) || Number(w) < 0 || Number(w) > 30) e.waste_pct = '0 to 30.';
    if (!num(lab) || Number(lab) < 0) e.labour = '0 or more.';
    if (!num(pow) || Number(pow) < 0) e.power = '0 or more.';
    const raw = Array.isArray(b.lines) ? b.lines : [];
    const lines = []; const seen = new Set();
    raw.forEach((x, i) => {
      const code = String(x.sku_code || '').trim().toUpperCase(); const qty = String(x.qty ?? '').trim();
      if (!code && qty === '') return;
      const it = its.get(code);
      if (!code || !it || !it.raw || !it.live) { e[`lines.${i}.sku_code`] = 'Choose the material.'; return; }
      if (seen.has(code)) { e[`lines.${i}.sku_code`] = 'Already in the recipe.'; return; }
      seen.add(code);
      if (!(Number(qty) > 0) || !/^\d+(\.\d{1,3})?$/.test(qty)) { e[`lines.${i}.qty`] = 'More than 0 (at most 3 decimals).'; return; }
      lines.push({ sku_code: code, qty: Number(qty), i });
    });
    if (!lines.length && !Object.keys(e).some((k) => k.startsWith('lines.'))) e['lines.0.sku_code'] = 'Add at least one material.';
    if (lines.length && its.get(lines[0].sku_code).unit !== 'kg') e[`lines.${lines[0].i}.sku_code`] = 'The first material is the main one (the reel, in kg): wastage is measured on it.';
    if (Object.keys(e).length) bad(e);
    const v = { out_packs: Number(out), waste_pct: Number(w), labour: Number(lab), power: Number(pow), lines: lines.map(({ sku_code: c, qty }) => ({ sku_code: c, qty })) };
    if (cur && JSON.stringify(cur.lines) === JSON.stringify(v.lines) && cur.out_packs === v.out_packs && cur.waste_pct === v.waste_pct && cur.labour === v.labour && cur.power === v.power) {
      return { changed: false, message: `Nothing changed: the recipe stays v${cur.ver}.` };
    }
    const ver = vers.length + 1;
    const waits = Boolean(cur) && (await approvals.check(q, 'recipe', {})).needs;
    const [ins] = await q.query('INSERT INTO recipe_versions (sku_code, ver, from_date, out_packs, waste_pct, labour, power, status, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [sku, ver, from, v.out_packs, v.waste_pct, v.labour, v.power, waits ? 'waiting' : 'active', by(req)]);
    const rvId = ins.insertId;
    for (const [n, l] of v.lines.entries()) await q.query('INSERT INTO recipe_lines (rv_id, line_no, sku_code, qty) VALUES (?, ?, ?, ?)', [rvId, n + 1, l.sku_code, l.qty]);
    let msg;
    if (waits) {
      const aid = await approvals.request(q, { kind: 'recipe', godownId: (await myGodowns(q, req))[0]?.godown_id || 1, refType: 'recipe', refId: `${sku} v${ver}`,
        summary: `Recipe of ${sku} v${ver} from ${from}: ${v.lines.map((l) => `${l.sku_code} ${l.qty}`).join(', ')} per ${v.out_packs} packs, waste ${v.waste_pct}%`, payload: { rv_id: rvId } }, by(req));
      await q.query('UPDATE recipe_versions SET approval_id = ? WHERE rv_id = ?', [aid, rvId]);
      msg = `${await waitLine(q, aid)} Until then v${cur.ver} is used.`;
    } else msg = cur ? `v${ver} is used from ${from}.` : `Runs of ${sku} can be planned now.`;
    await audit(q, { empId: by(req), action: cur ? 'update' : 'create', entity: 'recipe', entityId: `${sku} v${ver}`, before: cur ? { version: `v${cur.ver}` } : undefined,
      after: { from, out: v.out_packs, uses: v.lines.map((l) => `${l.sku_code} ${l.qty}`).join(', '), waste: `${v.waste_pct}%`, labour: v.labour, power: v.power, waits } });
    return { changed: true, waiting: waits, ver, title: cur ? `Saved as v${ver}` : 'Recipe saved', message: msg };
  })), G);
  // "Use this cost": the standard cost from the recipe's made cost; a lower one waits for a second Admin (phase 14 rule)
  route('post', '/production/recipes/:sku/use-cost', 'production:edit', wrap(async (req) => tx(async (q) => {
    if (!seesCost(req) || !canDo(req, 'products', 'edit')) throw new InputError('Setting the standard cost needs See cost and Products Edit.', 403);
    const sku = String(req.params.sku).toUpperCase();
    const its = await prod.items(q);
    const s = its.get(sku);
    const v = s && s.makeable ? await prod.recipeOn(q, sku, today()) : null;
    if (!v) throw new InputError('No recipe in force for this pack.', 404);
    const [[row]] = await q.query('SELECT std_cost, avg_cost FROM skus WHERE sku_code = ? FOR UPDATE', [sku]);
    const mc = prod.madeCost(v, its);
    const old = row.std_cost === null ? null : Number(row.std_cost);
    const av = row.avg_cost === null ? null : Number(row.avg_cost);
    if ((old !== null && mc.unit < old - 0.004) || (old === null && av !== null && mc.unit < av - 0.004)) {
      const r = await secondAdmin.ask(q, { t: 'stdcost', dk: `stdcost:${sku}`, payload: { sku, value: mc.unit, label: 'Lower a standard cost' },
        summary: `${sku}: standard cost ${old !== null ? rs(old) : `not set (average ${rs(av)})`} to ${rs(mc.unit)} (from the recipe; a lower cost lets lower prices pass the margin floor)` }, by(req));
      return { waiting: true, title: r.already ? 'Already asked' : 'Waiting for a second Admin', message: r.already ? `A cost change for ${sku} waits. ${r.message}` : r.message };
    }
    await q.query('UPDATE skus SET std_cost = ? WHERE sku_code = ?', [mc.unit, sku]);
    await audit(q, { empId: by(req), action: 'update', entity: 'sku', entityId: sku, before: { 'standard cost': old === null ? 'not set' : rs(old) }, after: { 'standard cost': rs(mc.unit), from: `recipe v${v.ver}` } });
    return { waiting: false, title: 'Standard cost set', message: `Prices now work the margin of ${sku} on ${rs(mc.unit)}.` };
  })), G);

  // ============================================================================================ machines
  route('get', '/production/machines', 'production:view', wrap(async (req) => ({ rows: await machines(db, req), categories: await categories(db), godowns: (await myGodowns(db, req)).map((g) => ({ godown_id: g.godown_id, name: g.name })), can: { edit: can(req, 'edit') } })), G);
  async function saveMachine(q, req, id) {
    const b = req.body || {};
    const m = id ? (await q.query('SELECT machine_id, name, godown_id, makes, per_hour, status, stop_reason FROM machines WHERE machine_id = ? FOR UPDATE', [id]))[0][0] : null;
    if (id && !m) throw new InputError('No such machine', 404);
    if (m) { sees(req, m.godown_id); works(req, m.godown_id); }
    const e = {};
    const name = String(b.name || '').trim().slice(0, 40);
    const cats = (await categories(q)).map((c) => c.key);
    const makes = [...new Set((Array.isArray(b.makes) ? b.makes : []).map(String))].filter((c) => cats.includes(c));
    const pph = String(b.per_hour ?? '').trim(); const st = b.status === 'stopped' ? 'stopped' : 'active'; const why = String(b.stop_reason || '').trim().slice(0, 80);
    if (!name) e.name = 'A name, like Napkin folder 2.';
    else { const [[dup]] = await q.query('SELECT machine_id FROM machines WHERE name = ? AND machine_id <> ?', [name, id || 0]); if (dup) e.name = 'Another machine has this name.'; }
    if (!makes.length) e.makes = 'Tick at least one.';
    if (!whole(pph, 1)) e.per_hour = 'A whole number, at least 1.';
    if (st === 'stopped' && !why) e.stop_reason = 'Say why it is stopped.';
    if (st === 'stopped' && m) { const [[busy]] = await q.query("SELECT run_no FROM production_runs WHERE machine_id = ? AND status = 'started' LIMIT 1", [id]); if (busy) e.status = `${busy.run_no} is running on it. Finish the run first.`; }
    let godown = m ? m.godown_id : Number(b.godown_id);
    if (!m) { const gs = await myGodowns(q, req); if (!gs.some((g) => g.godown_id === godown)) { if (gs.length === 1) godown = gs[0].godown_id; else e.godown_id = 'Choose the godown.'; } }
    if (Object.keys(e).length) bad(e);
    const row = { name, makes: makes.join(','), per_hour: Number(pph), status: st, stop_reason: st === 'stopped' ? why : null };
    let mid = id;
    if (m) await q.query('UPDATE machines SET name = ?, makes = ?, per_hour = ?, status = ?, stop_reason = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE machine_id = ?', [row.name, row.makes, row.per_hour, row.status, row.stop_reason, by(req), id]);
    else mid = (await q.query('INSERT INTO machines (name, godown_id, makes, per_hour, status, stop_reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)', [row.name, godown, row.makes, row.per_hour, row.status, row.stop_reason, by(req)]))[0].insertId;
    await audit(q, { empId: by(req), action: m ? 'update' : 'create', entity: 'machine', entityId: `M${mid}`, before: m ? { name: m.name, makes: m.makes, per_hour: m.per_hour, status: m.status } : undefined, after: row });
    return { machine_id: mid, message: st === 'stopped' ? 'Stopped: no run can be planned on it.' : '' };
  }
  route('post', '/production/machines', 'production:edit', wrap(async (req) => tx((q) => saveMachine(q, req, 0))), G);
  route('put', '/production/machines/:id', 'production:edit', wrap(async (req) => tx((q) => saveMachine(q, req, Number(req.params.id)))), G);

  // ============================================================================================ runs
  async function runView(q, req, r, full = false) {
    const its = await prod.items(q, [r.sku_code]);
    const s = its.get(r.sku_code) || { name: r.sku_code, per_carton: 1 };
    const x = { run_id: r.run_id, run_no: r.run_no, godown_id: r.godown_id, godown: r.godown, sku_code: r.sku_code, name: s.name, qty: r.qty, cartons: Math.round((r.qty / s.per_carton) * 100) / 100,
      out: r.out_qty, machine: r.machine, machine_id: r.machine_id, run_date: r.run_date, shift: r.shift, status: r.status, status_label: prod.RUN_ST[r.status], batch_no: r.batch_no,
      qc: r.qc, wst: r.wst, late: r.status === 'planned' && r.run_date < today(), fin_waiting: Boolean(r.fin), recheck: Number(r.recheck_qty || 0), is_auto: Number(r.is_auto) === 1 };
    if (!full) return x;
    const v = r.rv_id ? await prod.versionById(q, r.rv_id) : await prod.recipeOn(q, r.sku_code, r.run_date < today() ? today() : r.run_date);
    const mats = await prod.materialsOf(q, r.run_id);
    const codes = [...new Set([...(v ? v.lines.map((l) => l.sku_code) : []), ...mats.map((m) => m.sku_code)])];
    const mi = await prod.items(q, [r.sku_code, ...codes]);
    const have = await prod.usable(q, codes, r.godown_id);
    const hold = await prod.onHold(q, codes, r.godown_id);
    const names = await namesOf(q, [r.operator, r.created_by, r.cancelled_by, r.qc_by, r.wst_by]);
    const unit = (c) => (mi.get(c) || {}).unit;
    const mat = (c) => ({ sku_code: c, name: (mi.get(c) || {}).name || c, unit: unit(c) });
    const need = r.status === 'planned' && v ? prod.needFor(v, r.qty, mi).map((l) => ({ ...mat(l.sku_code), need: l.qty, need_text: qtyText(unit(l.sku_code), l.qty),
      have_text: qtyText(unit(l.sku_code), have.get(l.sku_code) || 0), hold_text: hold.get(l.sku_code) ? qtyText(unit(l.sku_code), hold.get(l.sku_code)) : null, short: (have.get(l.sku_code) || 0) < l.qty - 1e-9 })) : null;
    const issued = r.status !== 'planned' && r.status !== 'cancelled' ? mats.map((m) => ({ ...mat(m.sku_code), issued: m.issued, issued_text: qtyText(unit(m.sku_code), m.issued),
      have_text: qtyText(unit(m.sku_code), have.get(m.sku_code) || 0), used: m.used, used_text: m.used === null ? null : qtyText(unit(m.sku_code), m.used) })) : null;
    let waste = null;
    if (r.status === 'done' && v && mats.length && mats[0].used !== null) {
      const w = prod.runWaste(v, mats.map((m) => ({ sku_code: m.sku_code, qty: m.used })), Number(r.out_qty), mi);
      const std = prod.stdFor(v, Number(r.out_qty));
      waste = { wpct: w.wpct, allowed: w.allowed, on: ((mi.get(w.sku_code) || {}).name || w.sku_code).toLowerCase(),
        lines: std.map((l) => ({ ...mat(l.sku_code), std_text: qtyText(unit(l.sku_code), l.qty), used_text: qtyText(unit(l.sku_code), (mats.find((m) => m.sku_code === l.sku_code) || { used: 0 }).used || 0) })) };
    }
    const lastScrap = async (t) => { const [[a]] = await q.query("SELECT approval_id FROM approvals WHERE kind = 'prod_scrap' AND ref_type = 'run' AND ref_id = ? AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.t')) = ? ORDER BY approval_id DESC LIMIT 1", [r.run_no, t]); return a ? a.approval_id : null; };
    const wstId = r.wst === 'waiting' ? await lastScrap('waste') : null;
    const [wos] = await q.query('SELECT write_off_id, qty, value, status, loss FROM write_offs WHERE run_id = ? ORDER BY write_off_id', [r.run_id]);
    const recheckWo = wos.filter((w) => w.loss === 'recheck').pop();
    const ed = can(req, 'edit'); const cr = can(req, 'create');
    const out = Number(r.out_qty || 0);
    return { ...x, operator: nm(names, r.operator), planned_by: nm(names, r.created_by), planned_at: r.created_at, started_at: r.started_at, ended_at: r.ended_at,
      recipe: v ? { ver: v.ver, waste: v.waste_pct, out: v.out_packs } : null, scrap_kg: r.scrap_kg === null ? null : Number(r.scrap_kg), reason: r.reason,
      need, issued, waste,
      wst_line: r.wst === 'waiting' ? await waitLine(q, wstId) : r.wst === 'approved' ? `Approved by ${nm(names, r.wst_by)}.` : r.wst === 'rejected' ? `Rejected by ${nm(names, r.wst_by)}: look into it.` : r.wst === 'ok' ? 'Within the rules.' : null,
      fin: r.fin ? { out: r.fin.out, line: await waitLine(q, await lastScrap('finish')) } : null, fin_note: r.fin_note,
      made_cost: hide(req, r.unit_made === null ? null : Number(r.unit_made)), run_cost: hide(req, r.run_cost === null ? null : Number(r.run_cost)),
      mat_cost: hide(req, r.mat_cost === null ? null : r2(r.mat_cost)),
      qc_done: r.qc === 'passed' ? { acc: r.acc, rej: r.rej, by: nm(names, r.qc_by), at: r.qc_at, unit_passed: hide(req, r.unit_passed === null ? null : Number(r.unit_passed)) } : null,
      losses: r.rej ? { rej: r.rej, normal: r.rej_normal, allow: r.rej_allow, abnormal: r.rej_abnormal, normal_value: hide(req, r.rej_normal ? r2((Number(r.run_cost) / out) * r.rej_normal) : 0),
        abnormal_value: hide(req, r.abnormal_value === null ? null : Number(r.abnormal_value)), wo_normal: r.wo_normal ? `WO-${r.wo_normal}` : null, wo_abnormal: r.wo_abnormal ? `WO-${r.wo_abnormal}` : null,
        wo_abnormal_status: (wos.find((w) => w.write_off_id === r.wo_abnormal) || {}).status || null } : null,
      recheck: Number(r.recheck_qty || 0) ? { qty: r.recheck_qty, unit: hide(req, Number(r.recheck_value) / r.recheck_qty), note: r.recheck_note } : null,
      recheck_done: !Number(r.recheck_qty || 0) && r.recheck_note ? { note: r.recheck_note, wo_status: recheckWo ? recheckWo.status : null } : null,
      uncosted: r.uncosted_qty ? { qty: r.uncosted_qty, unit: hide(req, Number(r.uncosted_unit)) } : null,
      cancelled: r.status === 'cancelled' ? { by: nm(names, r.cancelled_by), reason: r.cancel_reason } : null,
      labels: r.status === 'done' && out ? { sku: r.sku_code, copies: Math.max(1, Math.round((r.acc || out) / s.per_carton)) } : null,
      can: { start: r.status === 'planned' && cr, finish: r.status === 'started' && cr && !r.fin, qc: r.status === 'done' && r.qc === 'hold' && ed, recheck: Boolean(Number(r.recheck_qty || 0)) && ed,
        cancel: r.status === 'planned' && can(req, 'cancel') },
      reasons: prod.WASTE_REASONS };
  }
  route('get', '/production/runs', 'production:view', wrap(async (req) => {
    const [gw, gp] = godowns.where('r.godown_id', scope(req));
    const rows = await prod.runRows(db, gw, gp);
    const groups = { planned: ['planned'], started: ['started'], done: ['done', 'cancelled'] };
    const tab = groups[req.query.tab] ? req.query.tab : 'planned';
    const list = [];
    for (const r of rows.filter((x) => groups[tab].includes(x.status))) list.push(await runView(db, req, r));
    const [gm, gmp] = godowns.where('godown_id', scope(req));
    const [[mc]] = await db.query(`SELECT COUNT(*) AS n FROM machines WHERE ${gm}`, gmp);
    return { rows: list, counts: { planned: rows.filter((r) => r.status === 'planned').length, started: rows.filter((r) => r.status === 'started').length,
      done: rows.filter((r) => ['done', 'cancelled'].includes(r.status)).length, machines: Number(mc.n) }, quarantine: (await prod.settings(db)).quarantine,
    can: { create: can(req, 'create'), edit: can(req, 'edit') } };
  }), G);
  route('get', '/production/runs/:id', 'production:view', wrap(async (req) => {
    const r = await prod.runOf(db, req.params.id);
    if (!r) throw new InputError('No such run', 404);
    sees(req, r.godown_id);
    return runView(db, req, r, true);
  }), G);
  // what a planned run needs (the Plan a run form, as you type)
  route('get', '/production/run-calc', 'production:view', wrap(async (req) => {
    const sku = String(req.query.sku || '').toUpperCase(); const n = Number(req.query.qty); const godown = Number(req.query.godown);
    const day = isDay(req.query.date) ? req.query.date : today();
    const v = sku ? await prod.recipeOn(db, sku, day < today() ? today() : day) : null;
    if (!v || !(n > 0) || !godown) return { ready: false };
    const its = await prod.items(db, [sku, ...v.lines.map((l) => l.sku_code)]);
    const s = its.get(sku);
    const need = prod.needFor(v, n, its);
    const have = await prod.usable(db, need.map((l) => l.sku_code), godown);
    const hold = await prod.onHold(db, need.map((l) => l.sku_code), godown);
    const [[m]] = req.query.machine ? await db.query('SELECT name, per_hour FROM machines WHERE machine_id = ?', [Number(req.query.machine)]) : [[null]];
    const mc = prod.madeCost(v, its);
    const unit = (c) => (its.get(c) || {}).unit;
    const lines = need.map((l) => ({ sku_code: l.sku_code, name: (its.get(l.sku_code) || {}).name, need_text: qtyText(unit(l.sku_code), l.qty), have_text: qtyText(unit(l.sku_code), have.get(l.sku_code) || 0),
      hold_text: hold.get(l.sku_code) ? qtyText(unit(l.sku_code), hold.get(l.sku_code)) : null, short: (have.get(l.sku_code) || 0) < l.qty - 1e-9 }));
    return { ready: true, ver: v.ver, out: v.out_packs, waste: v.waste_pct, not_whole: n % s.per_carton ? s.per_carton : null, hours: m ? Math.ceil((n / m.per_hour) * 10) / 10 : null, machine: m ? m.name : null,
      made_total: hide(req, r2(mc.unit * n)), lines, short: lines.filter((l) => l.short).map((l) => `${l.sku_code} needs ${l.need_text}, ${l.have_text} usable`) };
  }), G);
  async function checkPlan(q, req, b, its) {
    const e = {};
    const sku = String(b.sku_code || '').toUpperCase(); const s = its.get(sku);
    const godown = Number(b.godown_id); const n = String(b.qty ?? '').trim(); const day = String(b.run_date || '');
    const [[m]] = b.machine_id ? await q.query('SELECT machine_id, name, godown_id, makes, status, stop_reason FROM machines WHERE machine_id = ?', [Number(b.machine_id)]) : [[null]];
    const gs = await myGodowns(q, req);
    const g = gs.find((x) => x.godown_id === godown);
    if (!s || !s.makeable) e.sku_code = 'Choose the pack.';
    if (!g) e.godown_id = 'Choose a godown you work at.';
    if (!whole(n, 1)) e.qty = 'A whole number of packs.';
    if (!m) e.machine_id = 'Choose the machine.';
    else if (g && m.godown_id !== godown) e.machine_id = `${m.name} is at another godown, not ${g.name}.`;
    else if (m.status !== 'active') e.machine_id = `${m.name} is stopped: ${m.stop_reason}`;
    else if (s && !String(m.makes).split(',').includes(s.category)) e.machine_id = `${m.name} does not make ${(await categories(q)).find((c) => c.key === s.category)?.name.toLowerCase() || s.category}.`;
    if (!isDay(day) || day < today()) e.run_date = 'Today or later.';
    else if (s && s.makeable && !(await prod.recipeOn(q, sku, day))) e.sku_code = `${sku} has no recipe in force on ${day}.`;
    if (!prod.SHIFTS.includes(b.shift)) e.shift = 'Day or Night.';
    if (!b.operator) e.operator = 'Who runs the machine.';
    else if (g) {
      const ops = await operators(q);
      const op = ops.find((o) => o.emp_id === String(b.operator));
      if (!op) e.operator = 'Choose someone with Production Create.';
      else if (!godowns.covers(op, godown)) e.operator = `${op.name} does not work at ${g.name}.`;
    }
    if (Object.keys(e).length) bad(e);
    return { sku, godown, n: Number(n), day, m };
  }
  route('post', '/production/runs', 'production:create', wrap(async (req) => tx(async (q) => {
    const its = await prod.items(q);
    const p = await checkPlan(q, req, req.body || {}, its);
    const runNo = await numbering.issue(q, 'production', p.godown);
    const [ins] = await q.query('INSERT INTO production_runs (run_no, godown_id, sku_code, qty, machine_id, run_date, shift, operator, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [runNo, p.godown, p.sku, p.n, p.m.machine_id, p.day, req.body.shift, String(req.body.operator), by(req)]);
    const v = await prod.recipeOn(q, p.sku, p.day);
    const need = prod.needFor(v, p.n, its);
    const have = await prod.usable(q, need.map((l) => l.sku_code), p.godown);
    const short = need.filter((l) => (have.get(l.sku_code) || 0) < l.qty - 1e-9).map((l) => l.sku_code);
    await audit(q, { empId: by(req), action: 'create', entity: 'production_run', entityId: runNo, after: { pack: p.sku, packs: p.n, machine: p.m.name, day: p.day, shift: req.body.shift } });
    return { run_id: ins.insertId, run_no: runNo, title: `${runNo} planned`, tone: short.length ? 'warn' : 'good',
      message: short.length ? `Material is short (${short.join(', ')}): it cannot start until it is in.` : 'Materials are there. Start it on the day.' };
  })), G);
  // Plan from low stock: made packs below their reorder level at the godowns in view get a run for tomorrow
  route('post', '/production/runs/plan-low', 'production:create', wrap(async (req) => tx(async (q) => {
    const its = await prod.items(q);
    const t = today(); const tomorrow = prod.addDays(t, 1);
    const sc = scope(req);
    const made = []; const noRec = []; const noMach = [];
    for (const g of (await myGodowns(q, req)).filter((x) => sc === null || sc.includes(x.godown_id))) {
      const [lv] = await q.query('SELECT sku_code, reorder_level FROM stock_levels WHERE location_id = ? AND reorder_level > 0', [g.godown_id]);
      for (const l of lv) {
        const s = its.get(l.sku_code);
        if (!s || !s.makeable) continue;
        const good = (await prod.usable(q, [s.sku_code], g.godown_id)).get(s.sku_code) || 0;
        const hold = (await prod.onHold(q, [s.sku_code], g.godown_id)).get(s.sku_code) || 0;
        const [[pl]] = await q.query("SELECT COALESCE(SUM(qty), 0) AS n FROM production_runs WHERE godown_id = ? AND sku_code = ? AND status IN ('planned', 'started')", [g.godown_id, s.sku_code]);
        const have = good + hold + Number(pl.n);
        if (have >= l.reorder_level) continue;
        const v = await prod.recipeOn(q, s.sku_code, tomorrow);
        if (!v) { noRec.push(`${s.sku_code} (${g.name})`); continue; }
        const [[m]] = await q.query("SELECT machine_id, name FROM machines WHERE godown_id = ? AND status = 'active' AND FIND_IN_SET(?, makes) ORDER BY machine_id LIMIT 1", [g.godown_id, s.category]);
        if (!m) { noMach.push(`${s.sku_code} (${g.name})`); continue; }
        const n = Math.ceil((l.reorder_level * 2 - have) / v.out_packs) * v.out_packs;
        const runNo = await numbering.issue(q, 'production', g.godown_id);
        await q.query("INSERT INTO production_runs (run_no, godown_id, sku_code, qty, machine_id, run_date, shift, operator, is_auto, created_by) VALUES (?, ?, ?, ?, ?, ?, 'Day', ?, 1, ?)",
          [runNo, g.godown_id, s.sku_code, n, m.machine_id, tomorrow, by(req), by(req)]);
        await audit(q, { empId: by(req), action: 'create', entity: 'production_run', entityId: runNo, after: { pack: s.sku_code, packs: n, machine: m.name, day: tomorrow, from: 'Plan from low stock' } });
        made.push(`${runNo} ${s.sku_code} ${n}`);
      }
    }
    const extra = `${noRec.length ? ` No recipe: ${noRec.join(', ')}.` : ''}${noMach.length ? ` No working machine: ${noMach.join(', ')}.` : ''}`;
    if (!made.length) return { made, title: 'Nothing to plan', tone: 'info', message: `No made pack with a recipe is below its reorder level.${extra}` };
    return { made, title: `${made.length} run${made.length > 1 ? 's' : ''} planned for tomorrow`, tone: 'good',
      message: `${made.join('; ')}. Each makes twice the reorder level less what is there, in whole batches.${extra}` };
  })), G);
  async function lockRun(q, req, status) {
    const r = await prod.runOf(q, req.params.id, true);
    if (!r) throw new InputError('No such run', 404);
    sees(req, r.godown_id); works(req, r.godown_id);
    if (status && !status.includes(r.status)) throw new InputError(`${r.run_no} is ${prod.RUN_ST[r.status].toLowerCase()}.`, 409);
    return r;
  }
  route('post', '/production/runs/:id/start', 'production:create', wrap(async (req) => tx(async (q) => {
    const r = await lockRun(q, req, ['planned']);
    const t = today();
    const v = await prod.recipeOn(q, r.sku_code, t);
    if (!v) throw new InputError(`${r.sku_code} has no recipe in force today: add the recipe first.`, 409);
    const [[m]] = await q.query('SELECT machine_id, name, status, stop_reason FROM machines WHERE machine_id = ? FOR UPDATE', [r.machine_id]);
    if (m.status !== 'active') throw new InputError(`${m.name} is stopped: ${m.stop_reason}`, 409);
    const [[busy]] = await q.query("SELECT run_no FROM production_runs WHERE machine_id = ? AND status = 'started' AND run_id <> ?", [r.machine_id, r.run_id]);
    if (busy) throw new InputError(`${m.name} is running ${busy.run_no}. Finish it first.`, 409);
    await books.assertOpen(q, t);
    const its = await prod.items(q, [r.sku_code, ...v.lines.map((l) => l.sku_code)]);
    const sk = its.get(r.sku_code);
    if (sk.track && !sk.life) throw new InputError(`${r.sku_code} is tracked by batch but its product has no shelf life: set it in Products first.`, 409);
    const need = prod.needFor(v, r.qty, its);
    await stock.lockSkus(q, need.map((l) => l.sku_code));
    const have = await prod.usable(q, need.map((l) => l.sku_code), r.godown_id, true);
    const short = need.filter((l) => (have.get(l.sku_code) || 0) < l.qty - 1e-9);
    if (short.length) throw new InputError(`Not enough material: ${short.map((l) => `${l.sku_code} needs ${qtyText(its.get(l.sku_code).unit, l.qty)}, ${qtyText(its.get(l.sku_code).unit, have.get(l.sku_code) || 0)} usable`).join('; ')}. Goods in QC hold cannot be used.`, 409);
    for (const [i, l] of need.entries()) {
      const cost = its.get(l.sku_code).avg_cost;
      await stock.moveStock(q, { sku: l.sku_code, godown: r.godown_id, shelf: 'good', qty: -l.qty, what: 'prod_issue', unitCost: cost === null ? null : r2(cost), doc: { type: 'run', id: r.run_no }, note: `Issued to ${r.run_no}` }, by(req));
      await q.query('INSERT INTO run_materials (run_id, line_no, sku_code, issued, cost) VALUES (?, ?, ?, ?, ?)', [r.run_id, i + 1, l.sku_code, l.qty, cost === null ? 0 : cost]);
    }
    const batch = prod.batchNo(r.machine_id, t);
    await q.query("UPDATE production_runs SET status = 'started', rv_id = ?, run_date = ?, batch_no = ?, started_at = UTC_TIMESTAMP(), fin_note = NULL WHERE run_id = ?", [v.rv_id, t, batch, r.run_id]);
    await audit(q, { empId: by(req), action: 'start', entity: 'production_run', entityId: r.run_no, before: { status: 'Planned' }, after: { status: 'Running', batch, recipe: `v${v.ver}`, issued: matList(need, its) } });
    return { title: `Started, batch ${batch}`, message: `Issued from stock: ${matList(need, its)}.` };
  })), G);
  route('post', '/production/runs/:id/finish', 'production:create', wrap(async (req) => tx(async (q) => {
    const r = await lockRun(q, req, ['started']);
    if (r.fin) throw new InputError(`The finish of ${r.run_no} waits for approval. ${await waitLine(q, r.fin_approval_id)}`, 409);
    await books.assertOpen(q, today());
    const mats = await prod.materialsOf(q, r.run_id);
    const v = await prod.versionById(q, r.rv_id);
    const its = await prod.items(q, [r.sku_code, ...mats.map((m) => m.sku_code)]);
    const b = req.body || {};
    const e = {};
    const out = String(b.out ?? '').trim(); const sc = String(b.scrap ?? '').trim(); const why = String(b.reason || '').trim();
    if (!whole(out, 0)) e.out = 'A whole number.'; else if (Number(out) > r.qty * 1.1) e.out = 'More than 10% above the plan. Check the count.';
    if (sc !== '' && !(num(sc) && Number(sc) >= 0)) e.scrap = '0 or more.';
    if (why && !prod.WASTE_REASONS.includes(why)) e.reason = 'Choose a reason from the list.';
    const raw = Array.isArray(b.used) ? b.used : [];
    await stock.lockSkus(q, mats.map((m) => m.sku_code));
    const have = await prod.usable(q, mats.map((m) => m.sku_code), r.godown_id, true);
    const used = mats.map((m, i) => {
      const u = String(raw[i] ?? '').trim();
      if (!num(u) || Number(u) < 0) { e[`used.${i}`] = '0 or more.'; return { sku_code: m.sku_code, qty: 0 }; }
      const unit = its.get(m.sku_code).unit;
      const x = qround(unit, Number(u));
      const more = x - m.issued;
      if (more > 1e-9 && (have.get(m.sku_code) || 0) < more) e[`used.${i}`] = `Only ${qtyText(unit, have.get(m.sku_code) || 0)} more is usable in stock.`;
      return { sku_code: m.sku_code, qty: x };
    });
    if (Object.keys(e).length) bad(e);
    const n = Number(out);
    const w = prod.runWaste(v, used, n, its);
    if (n === 0 && !why) bad({ reason: 'Nothing was made. Say why.' });
    if (w.wpct > w.allowed && !why) bad({ reason: `Wastage is ${w.wpct}%, more than the ${w.allowed}% the recipe allows. Say why.` });
    if (w.under.length && !why) bad({ reason: `Less material used than the recipe needs for ${n} packs: ${w.under.map((x) => `${x.sku_code} ${x.used} of ${x.std}`).join(', ')}. Say why.` });
    const f = { out: n, scrap: sc === '' ? 0 : Number(sc), reason: why, used: used.map((u) => u.qty) };
    if (w.under.length) {
      // v22: less material than the recipe cannot make these packs: nothing moves until a second person signs it
      const sv = r2(w.under.reduce((a, x) => a + ((its.get(x.sku_code) || {}).avg_cost || 0) * (x.std - x.used), 0));
      const aid = await approvals.request(q, { kind: 'prod_scrap', godownId: r.godown_id, refType: 'run', refId: r.run_no, amount: sv, payload: { t: 'finish', run_id: r.run_id, label: 'Production: less material than the recipe' },
        summary: `Run ${r.run_no} ${r.sku_code}: ${n} packs made with less material than the recipe: ${w.under.map((x) => `${x.sku_code} ${x.used} used of ${x.std}`).join(', ')}. ${why}` }, by(req));
      await q.query('UPDATE production_runs SET fin_json = ?, fin_approval_id = ?, fin_note = NULL WHERE run_id = ?', [JSON.stringify(f), aid, r.run_id]);
      await audit(q, { empId: by(req), action: 'request', entity: 'production_run', entityId: r.run_no, after: { finish: 'waits for approval', made: n, reason: 'less material than the recipe' } });
      return { waiting: true, tone: 'warn', title: 'Waiting for approval', message: `Nothing moves until it is signed: the packs, the material and the cost stay as they are. ${await waitLine(q, aid)}` };
    }
    const res = await prod.finishApply(q, r, f, by(req));
    return { waiting: false, tone: (await prod.runOf(q, r.run_id)).wst === 'waiting' ? 'warn' : 'good',
      title: `Finished: ${n} packs${seesCost(req) && res.unit !== null ? ` at ${rs(res.unit)} each` : ''}`, message: res.msg };
  })), G);
  route('post', '/production/runs/:id/qc', 'production:edit', wrap(async (req) => tx(async (q) => {
    const r = await lockRun(q, req, ['done']);
    if (r.qc !== 'hold') throw new InputError('Nothing to check: the packs are not in QC hold.', 409);
    await books.assertOpen(q, today());
    const a = String((req.body || {}).acc ?? '').trim(); const j = String((req.body || {}).rej ?? '').trim();
    if (!whole(a, 0) || !whole(j, 0) || Number(a) + Number(j) !== Number(r.out_qty)) bad({ acc: `Passed + rejected must be ${r.out_qty}.` });
    const x = await prod.qcRun(q, r, Number(a), Number(j), by(req));
    const see = seesCost(req);
    const avg = x.av && see ? ` (average cost ${x.av.before === null ? `now ${rs(x.av.after)}` : `${rs(x.av.before)} to ${rs(x.av.after)}`})` : '';
    const each = x.acc && x.rej && see ? `; each passed pack carries ${rs(x.passedVal / x.acc)} (the run cost over ${x.acc} packs)` : '';
    const wo = see ? x.woMsg : x.woMsg.replace(` ${rs(x.abVal)}`, ''); // the abnormal loss is a cost; the normal loss is Rs 0 by rule
    return { tone: x.ra ? 'warn' : 'good', title: `${r.run_no} checked`, message: `${x.acc} packs into stock${avg}${each}${wo}.` };
  })), G);
  route('post', '/production/runs/:id/recheck', 'production:edit', wrap(async (req) => tx(async (q) => {
    const r = await lockRun(q, req, ['done']);
    const qty = Number(r.recheck_qty || 0);
    if (!qty) throw new InputError('Nothing to check again on this run.', 409);
    await books.assertOpen(q, today());
    const a = String((req.body || {}).acc ?? '').trim();
    if (!whole(a, 0) || Number(a) > qty) bad({ acc: `A whole number, 0 to ${qty}.` });
    const x = await prod.recheckRun(q, r, Number(a), by(req));
    const see = seesCost(req);
    return { tone: x.rej ? 'warn' : 'good', title: 'Saved',
      message: `${x.acc} passed to stock${see ? ` at ${rs(x.unit)} each` : ''}.${x.rej ? ` ${x.rej} go as write-off WO-${x.wo}${see ? ` (${rs(x.rejVal)})` : ''}, waiting for approval.` : ''}` };
  })), G);
  route('post', '/production/runs/:id/cancel', 'production:cancel', wrap(async (req) => tx(async (q) => {
    const r = await lockRun(q, req, ['planned']);
    const why = String((req.body || {}).reason || '').trim().slice(0, 120);
    if (!why) bad({ reason: 'Give a reason.' });
    await q.query("UPDATE production_runs SET status = 'cancelled', cancel_reason = ?, cancelled_by = ? WHERE run_id = ?", [why, by(req), r.run_id]);
    await audit(q, { empId: by(req), action: 'cancel', entity: 'production_run', entityId: r.run_no, before: { status: 'Planned' }, after: { status: 'Cancelled', reason: why } });
    return { title: 'Cancelled', message: `${r.run_no}: ${why}` };
  })), G);

  // ============================================================================================ production QC (Purchase > Quality check)
  route('get', '/production/qc', 'production:view', wrap(async (req) => {
    const [gw, gp] = godowns.where('r.godown_id', scope(req));
    const rows = await prod.runRows(db, `${gw} AND r.status = 'done'`, gp);
    const names = await namesOf(db, rows.map((r) => r.qc_by));
    const v = async (r) => ({ ...(await runView(db, req, r)), qc_by: nm(names, r.qc_by), qc_at: r.qc_at, acc: r.acc, rej: r.rej, ended_at: r.ended_at });
    const waiting = []; const again = []; const done = [];
    for (const r of rows.filter((x) => x.qc === 'hold').reverse()) waiting.push(await v(r));
    for (const r of rows.filter((x) => Number(x.recheck_qty || 0) > 0)) again.push(await v(r));
    for (const r of rows.filter((x) => x.qc === 'passed' && x.qc_by !== 'auto').sort((a, b) => new Date(b.qc_at) - new Date(a.qc_at)).slice(0, 5)) done.push(await v(r));
    return { waiting, again, done, can: { edit: can(req, 'edit') } };
  }), G);

  // ============================================================================================ wastage
  route('get', '/production/wastage', 'production:view', wrap(async (req) => {
    const [gw, gp] = godowns.where('r.godown_id', scope(req));
    const rows = await prod.runRows(db, `${gw} AND r.status = 'done'`, gp);
    const out = []; let lost = 0; let scrap = 0; const byM = new Map();
    for (const r of rows) {
      const mats = await prod.materialsOf(db, r.run_id);
      if (!mats.length || mats[0].used === null) continue;
      const v = await prod.versionById(db, r.rv_id);
      const its = await prod.items(db, [r.sku_code, ...mats.map((m) => m.sku_code)]);
      const w = prod.runWaste(v, mats.map((m) => ({ sku_code: m.sku_code, qty: m.used })), Number(r.out_qty), its);
      // the reel (the first input): standard for what was made against what was used
      const reel = w.per[0];
      const l = Math.max(0, reel.used - reel.std);
      lost += l; scrap += Number(r.scrap_kg || 0);
      byM.set(r.machine, (byM.get(r.machine) || 0) + l);
      out.push({ run_id: r.run_id, run_no: r.run_no, machine: r.machine, run_date: r.run_date, sku_code: r.sku_code, name: (its.get(r.sku_code) || {}).name, reel_std: reel.std, reel_used: reel.used,
        wpct: w.wpct, allowed: w.allowed, over: w.wpct > w.allowed, reason: r.reason, wst: r.wst || 'ok', wst_label: prod.WST[r.wst || 'ok'] });
    }
    const rule = await approvals.rule(db, 'prod_scrap');
    return { rows: out, stats: { lost: r2(lost), runs: out.length, scrap: r2(scrap), machines: [...byM].map(([name, kg]) => ({ name, kg: r2(kg) })) },
      rule: { on: Boolean(Number(rule.is_on)), pct: Number(rule.limit_value) } };
  }), G);
}

module.exports = { register };
