// Section 4 - Production: the v23 Tests tab "4" (4.1 to 4.16) and the production fix items of the phase 17 script (PD1,
// PD2 abnormal loss and Check again, N11, N3, Low2 a0 / a less material, Low1 d packs with no cost, rounding carried into
// the last pack, step 6 stock-ins closed). Every test starts from the dev data plus the v23 production sample (sample()):
// - the dev data has machines Napkin folder 1, Rewinder (rolls), Towel folder and Napkin folder C (stopped) and a
//   DF001-M100 recipe of its own (480 packs, v3 from today); the sample adds the five other v23 recipes (DF002-M100,
//   DF007-M100, DF016-R1, DF025-R1, DF037-M150, v23's figures; our DF002 / DF007 come 24 to a carton, so their batches
//   are 480 and 288 with the materials in v23's proportion), a run of DF037-M150 on the Towel folder that is running
//   (v23 DFM/26-27/0003) and a planned DF025-R1 run on the Rewinder (v23 0004);
// - raw stock at Kanchipuram set to 900 each at v23's average costs (reel 70.50, cores 6.40, film 182, cartons 21.50),
//   as the phase 17 setup did, so v23's material figures hold.
// Where a figure rests on our own DF001-M100 recipe or our stock, it is worked out from ours with v23's rule.
// Lakshmi P (v23 Supervisor at Chennai) is DZIND150. Run: npm run scenarios -- 4
module.exports = {
  title: 'Production',
  async run(ctx) {
    const { api, ok, say, q1, qa, pool, T, fresh, run, decide, today, r2, shelf } = ctx;
    const TODAY = today();
    const TOM = new Date(Date.parse(`${TODAY}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
    const LA = 'DZIND150'; const MU_ID = 'DZIND136';
    const RAW = { 'RM-PR2': 70.5, 'RM-CORE': 6.4, 'RM-FILM': 182, 'RM-CTN': 21.5 };
    const js = (x) => JSON.stringify(x);
    const avg = async (sku) => Number((await q1('SELECT avg_cost FROM skus WHERE sku_code = ?', [sku])).avg_cost);
    const goodAll = async (sku) => Number((await q1("SELECT COALESCE(SUM(delta), 0) n FROM stock_movements WHERE sku_code = ? AND stock_kind = 'good'", [sku])).n);
    const value = async (codes) => { let v = 0; for (const c of codes) v += (await goodAll(c)) * ((await avg(c)) || 0); return v; };
    const runOf = async (id) => (await api('SH', 'GET', `/production/runs/${id}`)).data;
    const row = async (id) => q1('SELECT * FROM production_runs WHERE run_id = ?', [id]);
    const pend = async (kind, like = '%') => q1("SELECT approval_id, requested_by, summary, amount FROM approvals WHERE status = 'pending' AND kind = ? AND summary LIKE ? ORDER BY approval_id DESC LIMIT 1", [kind, like]);
    const signers = async (id) => (await require('../../src/backend_routes/approvals').signers(pool, id)).map((x) => x.name);
    const raw900 = async () => {
      for (const [code, cost] of Object.entries(RAW)) {
        const d = Math.round((900 - await shelf(code, 'good', 1)) * 1000) / 1000;
        if (d) await pool.query("INSERT INTO stock_movements (sku_code, location_id, stock_kind, move_type, delta, ref_type, note, emp_id) VALUES (?, 1, 'good', 'adjust', ?, 'test', 'scenario: v23 opening raw stock', 'DZIND002')", [code, d]);
        await pool.query('UPDATE skus SET avg_cost = ? WHERE sku_code = ?', [cost, code]);
      }
    };
    let M; let ID;
    const plan = (who, sku, qty, m, op = MU_ID, extra = {}) => api(who, 'POST', '/production/runs', { sku_code: sku, godown_id: 1, qty, machine_id: M[m], run_date: TODAY, shift: 'Day', operator: op, ...extra });
    const sample = async () => {
      M = {}; for (const m of await qa('SELECT machine_id, name FROM machines')) M[m.name] = m.machine_id;
      await raw900();
      for (const [sku, out, lines, waste, lab, pow] of [
        ['DF002-M100', 480, [['RM-PR2', 264], ['RM-FILM', 3.6], ['RM-CTN', 12]], 3, 1.2, 0.45],
        ['DF007-M100', 288, [['RM-PR2', 230.4], ['RM-FILM', 2.4], ['RM-CTN', 10]], 3, 1.5, 0.6],
        ['DF016-R1', 480, [['RM-PR2', 52.8], ['RM-CORE', 480], ['RM-FILM', 2], ['RM-CTN', 10]], 4, 0.5, 0.2],
        ['DF025-R1', 240, [['RM-PR2', 48], ['RM-CORE', 240], ['RM-FILM', 1.5], ['RM-CTN', 10]], 4, 0.6, 0.25],
        ['DF037-M150', 240, [['RM-PR2', 180], ['RM-FILM', 2], ['RM-CTN', 10]], 3, 1.4, 0.5]]) {
        const r = await api('SH', 'POST', `/production/recipes/${sku}`, { out_packs: out, from_date: TODAY, waste_pct: waste, labour: lab, power: pow, lines: lines.map(([c, q]) => ({ sku_code: c, qty: q })) });
        if (r.status !== 200) say(`sample recipe ${sku}: ${r.status} ${js(r.fields || r.msg)}`);
      }
      const r3 = await plan('KU', 'DF037-M150', 240, 'Towel folder');
      const s3 = await api('MU', 'POST', `/production/runs/${r3.data.run_id}/start`);
      const r4 = await plan('KU', 'DF025-R1', 240, 'Rewinder (rolls)');
      if ([r3, s3, r4].some((x) => x.status >= 300)) say('sample runs:', [r3, s3, r4].map((x) => `${x.status} ${js(x.fields || x.msg)}`).join(' / '));
      await raw900();
      ID = { r3: r3.data.run_id, r4: r4.data.run_id, no3: r3.data.run_no, no4: r4.data.run_no };
    };
    const start = async () => { await fresh(); await sample(); };
    const unitCost = (r) => { const mat = r.lines.reduce((s, l) => s + Number(l.qty) * RAW[l.sku_code], 0) * (1 + Number(r.waste) / 100) / Number(r.outp); return r2(mat + Number(r.lab) + Number(r.pow)); };

    if (run('4.1')) { await start(); T('4.1', 'Every made pack needs a recipe');
      const r = (await api('SH', 'GET', '/production/recipes')).data;
      const mk = await q1("SELECT COUNT(*) n FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.sku_type = 'finished' AND s.source IN ('made', 'both') AND s.status NOT IN ('archived', 'discontinued', 'draft') AND p.status NOT IN ('archived', 'discontinued')");
      const d1 = r.with.find((x) => x.sku_code === 'DF001-M100');
      const v = await q1("SELECT v.rv_id, v.out_packs outp, v.waste_pct waste, v.labour lab, v.power pow FROM recipe_versions v WHERE v.sku_code = 'DF001-M100' AND v.status = 'active' AND v.from_date <= ? ORDER BY v.from_date DESC, v.ver DESC LIMIT 1", [TODAY]);
      v.lines = await qa('SELECT sku_code, qty FROM recipe_lines WHERE rv_id = ?', [v.rv_id]);
      const want = unitCost(v);
      ok(r.with.length === 6 && d1 && Math.abs(d1.made_cost - want) <= 0.01 && d1.cur.out === Number(v.outp), `6 made packs with a recipe (${r.with.map((x) => x.sku_code).join(', ')}); Table Napkins 20x20: batch ${d1 && d1.cur.out}, ${d1 && d1.cur.uses}, made cost Rs ${d1 && d1.made_cost} (want ${want} from our v${d1 && d1.cur.ver}; v23 36.14 on 400 / 180 kg)`);
      ok(r.without.length === Number(mk.n) - 6, `${r.without.length} made packs under "no recipe" (v23 19; ours ${mk.n} made packs less the 6)`); }

    if (run('4.2')) { await start(); T('4.2', 'The made cost can become the standard cost');
      const d = (await api('SH', 'GET', '/production/recipes/DF001-M100')).data;
      const u = await api('SH', 'POST', '/production/recipes/DF001-M100/use-cost');
      // our DF001-M100 already has a standard cost (31.02) above the made cost: lowering it waits for a second Admin (Y4)
      const w = u.data && /Waiting for/.test(u.data.message) ? await q1("SELECT approval_id FROM approvals WHERE status = 'pending' AND summary LIKE '%DF001-M100%' ORDER BY approval_id DESC LIMIT 1") : null;
      if (w) await ctx.decideAny(w.approval_id);
      const sc = Number((await q1("SELECT std_cost FROM skus WHERE sku_code = 'DF001-M100'")).std_cost);
      const pl = (await api('SH', 'GET', '/prices/lists/default/skus/DF001-M100')).data;
      ok(r2(d.made.mat + d.made.lab + d.made.pow) === d.made.unit && d.can.use_cost && u.status === 200 && sc === d.made.unit && Number(pl.std_cost) === d.made.unit,
        `made cost Rs ${d.made.unit} = materials ${d.made.mat} + labour ${d.made.lab} + power ${d.made.pow} (v23 36.14 = 34.64 + 1.10 + 0.40); "${u.data && u.data.message}"${w ? ' - signed by a second Admin' : ''}; standard cost ${sc}; the Default price panel works on cost ${pl && pl.std_cost}`); }

    if (run('4.3')) { await start(); T('4.3', 'A recipe change needs a second person');
      const body = { out_packs: 480, waste_pct: 3, labour: 1.2, power: 0.45, lines: [{ sku_code: 'RM-PR2', qty: 252 }, { sku_code: 'RM-FILM', qty: 3.6 }, { sku_code: 'RM-CTN', qty: 12 }] };
      const a = await api('SH', 'POST', '/production/recipes/DF002-M100', { ...body, from_date: TODAY });
      const b = await api('SH', 'POST', '/production/recipes/DF002-M100', { ...body, from_date: TOM });
      const q = await pend('recipe');
      const sg = q ? await signers(q.approval_id) : [];
      const l1 = (await api('SH', 'GET', '/production/recipes')).data.with.find((y) => y.sku_code === 'DF002-M100');
      const pv = await decide('PV', q.approval_id);
      const l2 = (await api('SH', 'GET', '/production/recipes')).data.with.find((y) => y.sku_code === 'DF002-M100');
      const P = require('../../src/backend_routes/production');
      const t1 = await P.recipeOn(pool, 'DF002-M100', TODAY); const t2 = await P.recipeOn(pool, 'DF002-M100', TOM);
      ok(a.status === 400 && /tomorrow at the earliest/.test((a.fields || {}).from_date) && b.status === 200 && b.data.waiting && /Until then v1 is used/.test(b.data.message) && l1.cur.ver === 1 && l1.waiting && l1.waiting.ver === 2,
        `today: "${(a.fields || {}).from_date}"; ${TOM}: "${b.data && b.data.message}" (signers: ${sg.join(', ')}; v23 Lakshmi P for Kumar M)`);
      ok(pv.status === 200 && l2.next && l2.next.ver === 2 && l2.next.from === TOM && t1.ver === 1 && t2.ver === 2, `after Pavithran: v2 from ${l2.next && l2.next.from}; runs today use v${t1.ver}, from ${TOM} v${t2.ver}`); }

    if (run('4.4')) { await start(); T('4.4', 'Copy a recipe for a similar pack');
      const d = (await api('SH', 'GET', '/production/recipes/DF023-R1')).data;
      const src = d.copy_from.find((c) => c.sku_code === 'DF016-R1');
      const cl = src ? src.lines.map((l) => ({ sku_code: l.sku_code, qty: l.qty })) : [];
      const a = await api('SH', 'POST', '/production/recipes/DF023-R1', { out_packs: 60, from_date: TODAY, waste_pct: 4, labour: 0.5, power: 0.2, lines: [cl[1], cl[0], cl[2], cl[3]] });
      const b = await api('SH', 'POST', '/production/recipes/DF023-R1', { out_packs: 100, from_date: TODAY, waste_pct: 4, labour: 0.5, power: 0.2, lines: cl });
      const c = await api('SH', 'POST', '/production/recipes/DF023-R1', { out_packs: 60, from_date: TODAY, waste_pct: 4, labour: 0.5, power: 0.2, lines: cl });
      const l = (await api('SH', 'GET', '/production/recipes')).data;
      ok(src && src.lines.map((x) => x.sku_code).join(',') === 'RM-PR2,RM-CORE,RM-FILM,RM-CTN' && a.status === 400 && /main one \(the reel, in kg\)/.test((a.fields || {})['lines.0.sku_code']) && b.status === 400 && /multiple of 6/.test((b.fields || {}).out_packs) && c.status === 200 && l.with.some((y) => y.sku_code === 'DF023-R1') && !l.without.some((y) => y.sku_code === 'DF023-R1'),
        `copy from DF016-R1: ${src && src.lines.map((x) => `${x.sku_code} ${x.qty}`).join(', ')}; cores first: "${(a.fields || {})['lines.0.sku_code']}"; 100: "${(b.fields || {}).out_packs}"; 60: "${c.data && c.data.message}", now with a recipe`); }

    if (run('4.5')) { await start(); T('4.5', 'Planning checks the machine and the operator');
      const next = `DFM/26-27/${String(Number(ID.no4.slice(-4)) + 1).padStart(4, '0')}`;
      const per = (await q1("SELECT out_packs n FROM recipe_versions WHERE sku_code = 'DF001-M100' AND status = 'active' AND from_date <= ? ORDER BY from_date DESC, ver DESC LIMIT 1", [TODAY])).n;
      const a = await api('KU', 'POST', '/production/runs', { sku_code: 'DF001-M100', godown_id: 1, qty: per, machine_id: M['Napkin folder C'], run_date: TODAY, shift: 'Day', operator: '' });
      const b = await plan('KU', 'DF001-M100', per, 'Rewinder (rolls)');
      const c = await plan('KU', 'DF001-M100', per, 'Napkin folder 1', LA);
      const d = await plan('KU', 'DF001-M100', per, 'Napkin folder 1');
      ok(a.status === 400 && /at another godown, not Kanchipuram/.test((a.fields || {}).machine_id) && /Who runs the machine/.test((a.fields || {}).operator) && b.status === 400 && /does not make/i.test((b.fields || {}).machine_id) && c.status === 400 && /does not work at Kanchipuram/.test((c.fields || {}).operator) && d.status === 200 && d.data.run_no === next,
        `${per} packs (our batch; v23 400): Napkin folder C, no operator: ${js(a.fields)}; Rewinder: "${(b.fields || {}).machine_id}"; Lakshmi P: "${(c.fields || {}).operator}"; with Murugan S: ${d.data && d.data.title} (v23 0005)`); }

    if (run('4.6')) { await start(); T('4.6', 'A run cannot start without usable material');
      // our DF001-M100 recipe uses less reel than v23's, so the run is as many batches as it takes to need more than the 900 kg there
      const v = await q1("SELECT v.rv_id, v.out_packs, v.waste_pct FROM recipe_versions v WHERE v.sku_code = 'DF001-M100' AND v.status = 'active' AND v.from_date <= ? ORDER BY v.from_date DESC, v.ver DESC LIMIT 1", [TODAY]);
      const reel = Number((await q1("SELECT qty FROM recipe_lines WHERE rv_id = ? AND sku_code = 'RM-PR2'", [v.rv_id])).qty);
      let k = 1; while (reel * k * (1 + Number(v.waste_pct) / 100) <= 900) k += 1;
      const qty = k * v.out_packs;
      const c = (await api('KU', 'GET', `/production/run-calc?sku=DF001-M100&qty=${qty}&godown=1&machine=${M['Napkin folder 1']}&date=${TODAY}`)).data;
      const l = c.lines.find((x) => x.sku_code === 'RM-PR2');
      const p = await plan('KU', 'DF001-M100', qty, 'Napkin folder 1');
      const s = await api('MU', 'POST', `/production/runs/${p.data.run_id}/start`);
      ok(l.short && l.have_text === '900 kg' && c.short.length && p.status === 200 && p.data.tone === 'warn' && /cannot start until it is in/.test(p.data.message) && s.status === 409 && /Not enough material: RM-PR2 needs .* 900 kg usable.*QC hold cannot be used/.test(s.msg),
        `${qty} packs: reel ${l.need_text} needed, ${l.have_text} usable (v23 927 / 900 for 2000 packs); planned: "${p.data && p.data.message}"; Start: "${s.msg}"`); }

    if (run('4.7')) { await start(); T('4.7', 'Starting issues the materials');
      const r = await api('MU', 'POST', `/production/runs/${ID.r4}/start`);
      const st = await runOf(ID.r4);
      const iss = Object.fromEntries(st.issued.map((l) => [l.sku_code, l.issued]));
      const want = `M${M['Rewinder (rolls)']}-${TODAY.slice(2, 4)}${TODAY.slice(5, 7)}${TODAY.slice(8, 10)}`;
      const reel = await shelf('RM-PR2', 'good', 1);
      const p = await plan('KU', 'DF016-R1', 480, 'Rewinder (rolls)');
      const s2 = await api('MU', 'POST', `/production/runs/${p.data.run_id}/start`);
      ok(r.status === 200 && st.batch_no === want && iss['RM-PR2'] === 49.92 && iss['RM-CORE'] === 250 && iss['RM-FILM'] === 1.56 && iss['RM-CTN'] === 11 && reel === 850.08,
        `${r.data && r.data.title}: batch ${st.batch_no}; issued ${js(iss)}; reel 900 -> ${reel} kg`);
      ok(s2.status === 409 && new RegExp(`Rewinder \\(rolls\\) is running ${ID.no4.replace(/\//g, '\\/')}`).test(s2.msg), `the second start: "${s2.msg}"`); }

    if (run('4.8')) { await start(); T('4.8', 'Wastage above the recipe waits for approval (and 4.9 the check)');
      const a = await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 236, used: [195, 2.06, 11], reason: '' });
      const r = await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 236, used: [195, 2.06, 11], reason: 'Machine jam', scrap: 4 });
      const q = await pend('prod_scrap'); const rr = await row(ID.r3);
      const mat = 195 * 70.5 + 2.06 * 182 + 11 * 21.5;
      const scrap0 = Number((await q1("SELECT COALESCE(SUM(delta), 0) n FROM stock_movements WHERE sku_code IN (SELECT sku_code FROM skus WHERE sku_type = 'scrap')")).n || 0);
      const w = (await api('SH', 'GET', '/production/wastage')).data;
      ok(a.status === 400 && /Wastage is 10.2%, more than the 3%/.test((a.fields || {}).reason) && r.status === 200 && Number(rr.run_cost) === r2(mat + 236 * 1.9) && r2(Number(rr.unit_made)) === 62.74 && !/Rs/.test(r.data.title) && (await shelf('DF037-M150', 'hold', 1)) === 236 && rr.wst === 'waiting',
        `no reason: "${(a.fields || {}).reason}"; "${r.data && r.data.title}. ${r.data && r.data.message}"; run cost ${rr.run_cost} = ${r2(mat)} + 236 x 1.90, made cost ${r2(Number(rr.unit_made))} a pack (Murugan has no See cost, so his message shows no Rs); QC hold ${await shelf('DF037-M150', 'hold', 1)}`);
      ok(q && /RM-PR2 10.2% \(12.69 over\)/.test(q.summary) && Number(q.amount) === r2(12.69 * 70.5 + 0.03 * 182), `request: "${q && q.summary}", Rs ${q && q.amount} (v23 Rs 895 counts the reel only; the film 0.03 kg over adds 5.46); trim in stock ${w.stats.scrap} kg (our scrap stock ${scrap0}; v23 7.5)`); }

    if (run('4.9')) { await start(); T('4.9', 'Finished packs pass Quality check');
      await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 236, used: [195, 2.06, 11], reason: 'Machine jam', scrap: 4 });
      const w = (await api('SH', 'GET', '/production/qc')).data;
      const g0 = await shelf('DF037-M150', 'good', 1);
      const a = await api('KU', 'POST', `/production/runs/${ID.r3}/qc`, { acc: 230, rej: 0 });
      const r = await api('KU', 'POST', `/production/runs/${ID.r3}/qc`, { acc: 230, rej: 6 });
      const rr = await row(ID.r3);
      ok(w.waiting.some((y) => y.run_id === ID.r3) && a.status === 400 && /must be 236/.test((a.fields || {}).acc) && r.status === 200 && r2(Number(rr.unit_passed)) === 64.38 && rr.rej_normal === 6 && rr.rej_abnormal === 0 && (await shelf('DF037-M150', 'good', 1)) === g0 + 230,
        `waiting on the QC page; 230 + 0: "${(a.fields || {}).acc}"; 230 + 6: "${r.data && r.data.message}", each passed pack carries ${r2(Number(rr.unit_passed))}; good ${g0} -> ${await shelf('DF037-M150', 'good', 1)} (v23 4.9 written for v21 sends the 6 out at Rs 376.44; PD2, the rule in force, makes 6 of 236 within 3% a normal loss at Rs 0)`); }

    if (run('4.10')) { await start(); T('4.10', 'QC hold off: packs go straight to stock');
      await api('SH', 'PUT', '/commerce-settings/quarantine', { value: '0' });
      const q = (await pend('rule_change', '%QC hold%')) || (await pend('rule_change', '%quarantine%')); if (q) await decide('PV', q.approval_id);
      const g0 = await shelf('DF037-M150', 'good', 1);
      const r = await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 240, used: [185.4, 2.06, 11] });
      const rr = await row(ID.r3);
      ok(r.status === 200 && r2(Number(rr.unit_made)) === 58.91 && /240 packs are in stock \(QC hold is off\)/.test(r.data.message) && (await shelf('DF037-M150', 'good', 1)) === g0 + 240, `"${r.data && r.data.title}. ${r.data && r.data.message}" at ${r2(Number(rr.unit_made))} a pack; M-fold at Kanchipuram ${g0} -> ${await shelf('DF037-M150', 'good', 1)} (v23 8 -> 248)`); }

    if (run('4.11')) { await start(); T('4.11', 'The wastage page shows every run');
      const w = (await api('SH', 'GET', '/production/wastage')).data;
      const done = await qa("SELECT run_no FROM production_runs WHERE status = 'done'");
      const bad = w.rows.filter((y) => y.wst === 'ok' && y.wpct > y.allowed + w.rule.pct);
      ok(w.stats.runs === done.length && done.every((d) => w.rows.some((y) => y.run_no === d.run_no)) && !bad.length,
        `${w.stats.runs} finished runs (${done.map((d) => d.run_no).join(', ')}), reel lost ${w.stats.lost} kg, trim ${w.stats.scrap} kg, per machine ${js(w.stats.machines)}; rows: ${w.rows.map((y) => `${y.run_no} ${y.wpct}% vs ${y.allowed}% ${y.wst_label}`).join('; ')}; only more than ${w.rule.pct}% above the recipe needs a second person (v23: 2 runs, 11 kg)`); }

    if (run('4.12')) { await start(); T('4.12', 'Plan from low stock');
      const a = await api('KU', 'POST', '/production/runs/plan-low');
      // what is there counts QC hold too (our DF001-M100 has packs in QC hold at Kanchipuram)
      const good = (await shelf('DF001-M100', 'good', 1)) + (await shelf('DF001-M100', 'hold', 1));
      const per = (await q1("SELECT out_packs n FROM recipe_versions WHERE sku_code = 'DF001-M100' AND status = 'active' AND from_date <= ? ORDER BY from_date DESC, ver DESC LIMIT 1", [TOM])).n;
      const level = Math.ceil((good + 100) / 10) * 10;
      await pool.query('INSERT INTO stock_levels (sku_code, location_id, reorder_level, reorder_qty) VALUES (?, 1, ?, 0) ON DUPLICATE KEY UPDATE reorder_level = VALUES(reorder_level)', ['DF001-M100', level]);
      const b = await api('KU', 'POST', '/production/runs/plan-low');
      const want = Math.ceil((level * 2 - good) / per) * per;
      const p = await q1("SELECT run_no, qty, DATE_FORMAT(run_date, '%Y-%m-%d') d, machine_id FROM production_runs WHERE is_auto = 1 AND status = 'planned' AND sku_code = 'DF001-M100' ORDER BY run_id DESC LIMIT 1");
      ok(a.status === 200 && !a.data.made.length && b.status === 200 && p && p.qty === want && p.d === TOM && p.machine_id === M['Napkin folder 1'],
        `first: "${a.data && a.data.message}"; level ${level} (${good} there, good + QC hold): "${b.data && b.data.message}" -> ${p && `${p.run_no} ${p.qty} packs on ${p.d}`} (want twice ${level} less ${good} in batches of ${per} = ${want}; v23 800)`); }

    if (run('4.13')) { await start(); T('4.13', 'Cancel only before it starts');
      const a = await api('SH', 'POST', `/production/runs/${ID.r4}/cancel`, { reason: '' });
      const b = await api('SH', 'POST', `/production/runs/${ID.r4}/cancel`, { reason: 'Order moved' });
      const s4 = await runOf(ID.r4); const s3 = await runOf(ID.r3);
      const c = await api('SH', 'POST', `/production/runs/${ID.r3}/cancel`, { reason: 'x' });
      ok(a.status === 400 && /Give a reason/.test((a.fields || {}).reason) && b.status === 200 && s4.status === 'cancelled' && s4.run_no === ID.no4 && !s3.can.cancel && c.status === 409,
        `no reason: "${(a.fields || {}).reason}"; "${b.data && b.data.message}", ${s4.run_no} stays used; the running ${ID.no3}: cancel offered ${s3.can.cancel}, "${c.msg}"`); }

    if (run('4.14')) { await start(); T('4.14', 'A machine with a run cannot be stopped');
      const r = await api('SH', 'PUT', `/production/machines/${M['Towel folder']}`, { name: 'Towel folder', makes: ['towels'], per_hour: 700, status: 'stopped', stop_reason: '' });
      const mc = (await api('SH', 'GET', '/production/machines')).data.rows.find((y) => y.name === 'Napkin folder C');
      ok(r.status === 400 && /is running on it/.test((r.fields || {}).status) && /Say why/.test((r.fields || {}).stop_reason) && mc.status === 'stopped' && mc.stop_reason === 'Waiting for a new folding blade', `${js(r.fields)}; Napkin folder C: ${mc.status}, "${mc.stop_reason}"`); }

    if (run('4.15')) { await start(); T('4.15', 'Labels for the batch');
      const d = await q1("SELECT run_id, run_no, sku_code, out_qty, acc FROM production_runs WHERE status = 'done' AND out_qty > 0 ORDER BY run_id LIMIT 1");
      const per = Number((await q1('SELECT packs_per_carton n FROM skus WHERE sku_code = ?', [d.sku_code])).n);
      const n = Number(d.acc || d.out_qty);
      const st = await runOf(d.run_id);
      ok(st.labels && st.labels.sku === d.sku_code && st.labels.copies === Math.max(1, Math.round(n / per)), `${d.run_no}: Print labels opens with ${st.labels && st.labels.sku} for ${st.labels && st.labels.copies} carton labels (${n} packs passed / ${per} a carton; v23 396 / 40 = 10)`); }

    if (run('4.16')) { await start(); T('4.16', 'Each role sees only its part');
      const a = await api('DV', 'GET', '/production/runs'); const b = await api('DV', 'GET', '/production/recipes');
      const r = await api('MU', 'GET', '/production/recipes');
      const rc = await api('MU', 'POST', '/production/recipes/DF002-M100', { out_packs: 480, from_date: TOM, waste_pct: 3, labour: 1, power: 0.4, lines: [{ sku_code: 'RM-PR2', qty: 216 }] });
      const rp = await plan('MU', 'DF002-M100', 480, 'Napkin folder 1');
      const rs = await api('MU', 'POST', `/production/runs/${rp.data && rp.data.run_id}/start`);
      const rf = await api('MU', 'POST', `/production/runs/${rp.data && rp.data.run_id}/finish`, { out: 480, used: ((await runOf(rp.data && rp.data.run_id)) || { issued: [] }).issued.map((l) => l.issued) });
      const rq = await api('MU', 'POST', `/production/runs/${rp.data && rp.data.run_id}/qc`, { acc: 480, rej: 0 });
      ok(a.status === 403 && b.status === 403, `Divya N (Sales): ${a.status} / ${b.status} "${a.msg}"`);
      ok(r.status === 200 && !r.data.can.edit && rc.status === 403 && rp.status === 200 && rs.status === 200 && rf.status === 200 && rq.status === 403,
        `Murugan S (Warehouse): recipes view only (change ${rc.status}); plans ${rp.status}, starts ${rs.status}, finishes ${rf.status} (${rf.msg || ''}); Quality check ${rq.status}`); }

    // ---------------------------------------------------------------- fix items
    if (run('PD1')) { await start(); T('PD1', 'Wastage on every input; nothing made always asks');
      await api('MU', 'POST', `/production/runs/${ID.r4}/start`);
      const a = await api('MU', 'POST', `/production/runs/${ID.r4}/finish`, { out: 240, used: [49.92, 300, 1.56, 11], reason: '' });
      const b = await api('MU', 'POST', `/production/runs/${ID.r4}/finish`, { out: 240, used: [49.92, 300, 1.56, 11], reason: 'Machine jam' });
      const q = await pend('prod_scrap');
      ok(a.status === 400 && /Wastage is 25%/.test((a.fields || {}).reason) && b.status === 200 && /RM-CORE 25% \(50 over\)/.test(q.summary), `cores 300 for 240 packs: "${(a.fields || {}).reason}"; "${q && q.summary}"`);
      await fresh(); await sample();
      const c = await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 0, used: [185.4, 2.06, 11], reason: '' });
      const d = await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 0, used: [185.4, 2.06, 11], reason: 'Machine jam' });
      const st = await runOf(ID.r3); const q2 = await pend('prod_scrap');
      ok(c.status === 400 && /Nothing was made/.test((c.fields || {}).reason) && d.status === 200 && st.wst === 'waiting' && st.waste.wpct === 100 && /nothing made, every input used is wastage/.test(q2.summary), `nothing made: "${(c.fields || {}).reason}"; then "${d.data && d.data.message}", wastage ${st.waste.wpct}%`); }

    if (run('LOW2a')) { await start(); T('LOW2a', 'Less material than the recipe waits; nothing moves until it is signed');
      const st0 = await runOf(ID.r3);
      const before = { reel: await shelf('RM-PR2', 'good', 1), hold: await shelf('DF037-M150', 'hold', 1), good: await shelf('DF037-M150', 'good', 1) };
      const a = await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 240, used: [111.24, 2.06, 11], reason: '' });
      const b = await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 240, used: [111.24, 2.06, 11], reason: 'Less material used than the recipe (recount)' });
      const q = await pend('prod_scrap');
      const card = js((await api('PV', 'GET', '/approvals?status=pending')).data || '').includes('Production: less material than the recipe');
      const now = { reel: await shelf('RM-PR2', 'good', 1), hold: await shelf('DF037-M150', 'hold', 1), good: await shelf('DF037-M150', 'good', 1) };
      const again = await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 240, used: [111.24, 2.06, 11], reason: 'Less material used than the recipe (recount)' });
      ok(st0.reasons.includes('Less material used than the recipe (recount)') && a.status === 400 && /Less material used than the recipe needs for 240 packs: RM-PR2 111.24 of 180/.test((a.fields || {}).reason) && b.data && b.data.waiting && /Nothing moves until it is signed/.test(b.data.message) && js(before) === js(now) && card && again.status === 409,
        `no reason: "${(a.fields || {}).reason}"; "${b.data && b.data.message}" [${q && q.summary}]; Approvals card: ${card}; stock unchanged ${js(now)}; finish again: "${again.msg}"`);
      const rj = await decide('PV', q.approval_id, 'rejected', 'count again');
      const st1 = await runOf(ID.r3);
      await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 240, used: [111.24, 2.06, 11], reason: 'Less material used than the recipe (recount)' });
      const q2 = await pend('prod_scrap'); const sg = await decide('PV', q2.approval_id);
      const st2 = await runOf(ID.r3);
      ok(rj.status === 200 && st1.status === 'started' && /Finish rejected by .*: count the packs and the material again/.test(st1.fin_note) && sg.status === 200 && st2.status === 'done' && (await shelf('DF037-M150', 'hold', 1)) === 240 && Math.abs((await shelf('RM-PR2', 'good', 1)) - r2(before.reel + 185.4 - 111.24)) < 0.001,
        `rejected: "${st1.fin_note}"; finished again and signed: ${st2.status}, 240 in QC hold, reel ${before.reel} -> ${await shelf('RM-PR2', 'good', 1)} (${r2(185.4 - 111.24)} kg back)`); }

    if (run('PD2')) { await start(); T('PD2', 'The abnormal loss: normal at Rs 0, abnormal at cost; rejected: back to QC hold to Check again');
      const v0 = await value(['DF037-M150']);
      await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 240, used: [185.4, 2.06, 11] });
      let rr = await row(ID.r3);
      const runCost = r2(185.4 * 70.5 + 2.06 * 182 + 11 * 21.5 + 240 * 1.9);
      const a0 = await avg('DF037-M150'); const g0 = await goodAll('DF037-M150');
      const r = await api('KU', 'POST', `/production/runs/${ID.r3}/qc`, { acc: 200, rej: 40 });
      rr = await row(ID.r3);
      const ab = r2((runCost / 240) * 33); const a1 = Math.round(((g0 * a0 + r2(runCost - ab)) / (g0 + 200)) * 1e6) / 1e6;
      ok(Number(rr.run_cost) === runCost && r.status === 200 && rr.rej_allow === 7 && rr.rej_normal === 7 && rr.rej_abnormal === 33 && Number(rr.abnormal_value) === ab && Math.abs((await avg('DF037-M150')) - a1) < 1e-6,
        `run cost ${rr.run_cost}; QC 200 pass, 40 rejected: "${r.data && r.data.message}"; 7 normal, 33 abnormal Rs ${rr.abnormal_value}; average ${await avg('DF037-M150')} (want ${a1})`);
      const wos = await qa('SELECT write_off_id, qty, value, status, loss FROM write_offs WHERE run_id = ? ORDER BY write_off_id', [ID.r3]);
      const q = await q1("SELECT approval_id FROM approvals WHERE kind = 'write_off' AND ref_id = ? AND status = 'pending'", [String(wos[1] && wos[1].write_off_id)]);
      const g1 = await shelf('DF037-M150', 'good', 1);
      const rj = await decide('PV', q.approval_id, 'rejected', 'check them again');
      const st = await runOf(ID.r3); const qcp = (await api('SH', 'GET', '/production/qc')).data;
      ok(wos.length === 2 && wos[0].loss === 'normal' && Number(wos[0].value) === 0 && wos[0].status === 'posted' && wos[1].loss === 'abnormal' && Number(wos[1].value) === ab && rj.status === 200 && (await shelf('DF037-M150', 'hold', 1)) === 33 && (await shelf('DF037-M150', 'good', 1)) === g1 && st.recheck && st.recheck.qty === 33 && qcp.again.some((y) => y.run_id === ID.r3),
        `write-offs ${wos.map((w) => `${w.qty} Rs ${w.value} ${w.status} (${w.loss})`).join(', ')}; the abnormal one rejected: QC hold ${await shelf('DF037-M150', 'hold', 1)}, Check again ${st.recheck && st.recheck.qty} at Rs ${st.recheck && r2(st.recheck.unit)}`);
      const rc = await api('KU', 'POST', `/production/runs/${ID.r3}/recheck`, { acc: 33 });
      const v1 = await value(['DF037-M150']);
      ok(rc.status === 200 && /33 passed to stock/.test(rc.data.message) && (await shelf('DF037-M150', 'hold', 1)) === 0 && Math.abs(v0 + runCost - v1) < 0.005,
        `"${rc.data && rc.data.message}"; value before Rs ${r2(v0)} + run Rs ${runCost} = after Rs ${r2(v1)} (difference ${(v0 + runCost - v1).toFixed(4)})`); }

    if (run('N11')) { await start(); T('N11', 'A rejected re-check write-off goes back to Check again');
      await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 240, used: [185.4, 2.06, 11] });
      await api('KU', 'POST', `/production/runs/${ID.r3}/qc`, { acc: 200, rej: 40 });
      let q = await q1("SELECT approval_id FROM approvals WHERE kind = 'write_off' AND status = 'pending' ORDER BY approval_id DESC LIMIT 1");
      await decide('PV', q.approval_id, 'rejected', 'check again');
      const a = await api('KU', 'POST', `/production/runs/${ID.r3}/recheck`, { acc: 20 });
      const s1 = await runOf(ID.r3);
      q = await q1("SELECT approval_id FROM approvals WHERE kind = 'write_off' AND status = 'pending' ORDER BY approval_id DESC LIMIT 1");
      const rj = await decide('PV', q.approval_id, 'rejected', 'no');
      const s2 = await runOf(ID.r3);
      const b = await api('KU', 'POST', `/production/runs/${ID.r3}/recheck`, { acc: 13 });
      ok(a.status === 200 && /13 go as write-off WO-\d+/.test(a.data.message) && !s1.recheck && rj.status === 200 && s2.recheck && s2.recheck.qty === 13 && b.status === 200 && (await shelf('DF037-M150', 'hold', 1)) === 0,
        `20 passed: "${a.data && a.data.message}"; that write-off rejected: Check again ${s2.recheck && s2.recheck.qty} ("${s2.recheck && s2.recheck.note}"); checked again: "${b.data && b.data.message}"`); }

    if (run('N3')) { await start(); T('N3', 'Write-off room counted per batch; approval not blocked by another write-off waiting');
      await pool.query("UPDATE products p JOIN skus s ON s.product_id = p.product_id SET p.track_batches = 1, p.shelf_life_months = 24 WHERE s.sku_code = 'DF037-M150'");
      await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 240, used: [185.4, 2.06, 11] });
      await api('KU', 'POST', `/production/runs/${ID.r3}/qc`, { acc: 200, rej: 40 });
      const rr = await row(ID.r3);
      const a = await api('SH', 'POST', '/commerce/write-offs', { godown_id: 1, sku_code: 'DF037-M150', stock_kind: 'dmg', batch_id: rr.batch_id, qty: 2, reason_type: 'damaged', reason: 'torn' });
      const b = await api('SH', 'POST', '/commerce/write-offs', { godown_id: 1, sku_code: 'DF037-M150', stock_kind: 'dmg', qty: 2, reason_type: 'prodqc', reason: 'x' });
      const q = await q1("SELECT approval_id FROM approvals WHERE kind = 'write_off' AND status = 'pending' ORDER BY approval_id DESC LIMIT 1");
      const d = await decide('PV', q.approval_id);
      ok(a.status >= 400 && /Only 0 damaged packs of DF037-M150 in that batch.*33 more wait in other write-offs/.test(a.msg) && b.status >= 400 && /Why/.test(b.msg) && d.status === 200 && (await shelf('DF037-M150', 'dmg', 1)) === 0,
        `same batch: "${a.msg}"; "Rejected at production QC" typed by hand is refused: "${b.msg}" (v23 "Why: damaged, expired, lost or sample"); the abnormal loss signed (${d.status}), damaged ${await shelf('DF037-M150', 'dmg', 1)}`); }

    if (run('ROUND')) { await start(); T('ROUND', 'Rounding carried into the last pack (no lost paise)');
      const RAWS = Object.keys(RAW);
      const v0 = { packs: await value(['DF037-M150']), raw: await value(RAWS) };
      const iss = Number((await q1('SELECT SUM(issued * cost) v FROM run_materials WHERE run_id = ?', [ID.r3])).v);
      await api('MU', 'POST', `/production/runs/${ID.r3}/finish`, { out: 237, used: [186.7, 2.06, 11], reason: 'Trim and roll ends' });
      await api('KU', 'POST', `/production/runs/${ID.r3}/qc`, { acc: 229, rej: 8 });
      const q = await q1("SELECT approval_id FROM approvals WHERE kind = 'write_off' AND status = 'pending' ORDER BY approval_id DESC LIMIT 1"); if (q) await decide('PV', q.approval_id);
      const rr = await row(ID.r3);
      const v1 = { packs: await value(['DF037-M150']), raw: await value(RAWS) };
      const matR = 186.7 * 70.5 + 2.06 * 182 + 11 * 21.5;
      const conv = r2(Number(rr.run_cost) - r2(Number(rr.mat_cost)));
      ok(Math.abs(v0.packs + Number(rr.run_cost) - (v1.packs + Number(rr.abnormal_value))) < 0.005 && Math.abs(r2(Number(rr.mat_cost)) - r2(matR)) < 0.005 && Math.abs((v0.packs + v0.raw + r2(iss)) + conv - (v1.packs + v1.raw + Number(rr.abnormal_value))) < 0.005,
        `run cost ${rr.run_cost} for 237 packs (${(Number(rr.run_cost) / 237).toFixed(6)} each), abnormal ${rr.abnormal_value}; packs before ${r2(v0.packs)} + run = after ${r2(v1.packs)} + abnormal; material ${r2(Number(rr.mat_cost))} = issued ${r2(iss)} + 1.3 kg more; whole stock before + labour and power ${conv} = after + abnormal`); }

    if (run('LOW1d')) { await start(); T('LOW1d', 'Packs with no cost get the run cost, and an alert says so');
      await pool.query("UPDATE skus SET avg_cost = NULL WHERE sku_code = 'DF025-R1'");
      const have = await goodAll('DF025-R1');
      const n0 = (await q1('SELECT COALESCE(MAX(log_id), 0) m FROM notification_log')).m;
      await api('MU', 'POST', `/production/runs/${ID.r4}/start`);
      await api('MU', 'POST', `/production/runs/${ID.r4}/finish`, { out: 240, used: (await runOf(ID.r4)).issued.map((l) => l.issued) });
      await api('KU', 'POST', `/production/runs/${ID.r4}/qc`, { acc: 240, rej: 0 });
      const rr = await row(ID.r4); const st = await runOf(ID.r4);
      const al = await qa("SELECT subject, status FROM notification_log WHERE log_id > ? AND event_key = 'admin_alert'", [n0]);
      ok(rr.uncosted_qty === have && Math.abs((await avg('DF025-R1')) - Number(rr.run_cost) / 240) < 1e-4 && st.uncosted && al.length > 0,
        `${have} packs had no cost (v23 85); average now Rs ${r2(await avg('DF025-R1'))}; the run says "${st.uncosted && st.uncosted.qty} packs had no cost"; alert: ${al.map((a) => `${a.subject} (${a.status})`).join(' / ')}`); }

    if (run('STEP6')) { await start(); T('STEP6', 'Runs are the only way packs are made; past stock-ins stay listed');
      const r = await api('SH', 'POST', '/commerce/stock-ins', { kind: 'production', godown_id: 1, lines: [{ sku_code: 'DF001-M100', qty: 10, unit_cost: 20 }] });
      const l = await api('SH', 'GET', '/commerce/stock-ins'); const n = await q1('SELECT COUNT(*) n FROM stock_ins');
      ok(r.status === 410 && /production run/.test(r.msg) && l.status === 200 && l.data.rows.length === Number(n.n), `${r.status}: "${r.msg}"; ${l.data && l.data.rows.length} past stock-ins listed`); }
  },
};
