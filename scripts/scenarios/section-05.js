// Section 5 - Inventory: the v23 Tests tab "5" (5.1 to 5.18) and the inventory fix items of the phase 18 script (I6,
// transfer short Found / Lost / approved with its value check, PK1 / N8, N7, Low2 d, Low2 e, the write-off and count value
// check, step 0 pack photos). Every test starts from the dev data plus the v23 inventory sample (sample()):
// - the v23 buying sample (helpers-buying.js): goods in g16 = v23 DFG/26-27/0016, 240 Wet Wipes in QC hold (WW2610);
// - 20 Wet Wipes in batch WW2504, which expired on 2026-10-28 (v23 20 packs of WW2403, expired);
// - transfer T1 (v23 DFT/26-27/0001): Kumar M sends 40 Table Napkins 20x20 and 48 Toilet Rolls to Chennai, on the road;
// - write-off W1 (v23 WO-0001, 4 packs Rs 168 seeded as waiting): Murugan S writes off 21 damaged Kitchen Towels (above the 20-pack rule, so it waits).
// Our stock, orders and batches stand in for v23's: each test works its figure out from ours with v23's rule.
// Lakshmi P (Supervisor, Chennai only) is DZIND150. Run: npm run scenarios -- 5
module.exports = {
  title: 'Inventory',
  async run(ctx) {
    const { api, ok, say, q1, qa, pool, T, fresh, run, decide, today, r2, shelf } = ctx;
    const B = require('./helpers-buying')(ctx);
    const LA = 'DZIND150';
    const TODAY = today();
    const js = (x) => JSON.stringify(x);
    const lot = async (sku, g, no, kind = 'good') => Number((await q1('SELECT COALESCE(SUM(m.delta), 0) n FROM stock_movements m JOIN batches b ON b.batch_id = m.batch_id WHERE m.sku_code = ? AND m.location_id = ? AND b.batch_no = ? AND m.stock_kind = ?', [sku, g, no, kind])).n);
    const total = async (sku) => Number((await q1('SELECT COALESCE(SUM(delta), 0) n FROM stock_movements WHERE sku_code = ?', [sku])).n);
    const free = async (sku, g) => (await api('SH', 'GET', `/inventory/free?godown=${g}&sku=${sku}`)).data;
    const pend = async (kind) => q1("SELECT approval_id, requested_by, summary, amount, excluded FROM approvals WHERE status = 'pending' AND kind = ? ORDER BY approval_id DESC LIMIT 1", [kind]);
    const signers = async (id) => (await require('../../src/backend_routes/approvals').signers(pool, id)).map((x) => x.name);
    const value = async (codes, shelves = ['good', 'road', 'disp', 'dmg', 'ret', 'hold', 'rej']) => { let v = 0; for (const c of codes) { const a = await q1('SELECT avg_cost FROM skus WHERE sku_code = ?', [c]); const q = await q1('SELECT COALESCE(SUM(delta), 0) n FROM stock_movements WHERE sku_code = ? AND stock_kind IN (?)', [c, shelves]); v += Number(q.n) * Number(a.avg_cost || 0); } return r2(v); };
    let X; let S;
    const sample = async () => {
      X = await B.sample();
      const b = await q1("SELECT batch_id FROM batches WHERE sku_code = 'DF044-M100' AND batch_no = 'WW2504'");
      await pool.query("INSERT INTO stock_movements (sku_code, location_id, stock_kind, batch_id, delta, move_type, note, emp_id) VALUES ('DF044-M100', 1, 'good', ?, 20, 'adjust', 'scenario: v23 sample, 20 packs of an expired batch', 'DZIND002')", [b.batch_id]);
      const t = await api('KU', 'POST', '/inventory/transfers', { from: 1, to: 2, vehicle_no: 'TN 21 AB 1234', lines: [{ sku_code: 'DF001-M100', qty: 40 }, { sku_code: 'DF016-R1', qty: 48 }] });
      // v23's WO-0001 is seeded waiting; here it waits by the rule: 21 packs is above the 20-pack limit
      await api('SH', 'POST', '/inventory/moves', { godown_id: 1, sku_code: 'DF025-R1', from: 'good', to: 'dmg', qty: 21, note: 'Crushed in the godown' });
      const w = await api('MU', 'POST', '/inventory/write-offs', { godown_id: 1, sku_code: 'DF025-R1', stock_kind: 'dmg', qty: 21, reason_type: 'damaged', reason: 'Crushed in the godown' });
      if (t.status >= 300 || w.status >= 300) say('sample:', t.status, js(t.fields || t.msg), w.status, js(w.fields || w.msg));
      S = { t1: t.data && t.data.transfer_id, t1no: t.data && t.data.transfer_no, wo: w.data };
    };
    const start = async () => { await fresh(); await sample(); };

    if (run('5.1')) { await start(); T('5.1', 'Free to sell is worked out, not typed');
      const rows = (await api('SH', 'GET', '/inventory/stock?godown=1')).data.rows;
      const n = rows.find((x) => x.sku_code === 'DF001-M100'); const w = rows.find((x) => x.sku_code === 'DF044-M100');
      ok(n.free === n.good - n.held - n.expired && n.road === 40, `Table Napkins (Kanchipuram): good ${n.good}, held ${n.held}, free ${n.free}, ${n.road} in a lorry (v23 150 / 40 / 110 / 40)`);
      ok(w.expired === 20 && w.near > 0 && w.hold === 240 && w.free === w.good - w.held - w.expired, `Wet Wipes: good ${w.good}, held ${w.held}, free ${w.free}, "${w.expired} expired", "${w.near} near expiry", ${w.hold} in QC hold (v23 140 / 120, 20 expired, 60 near, 240)`); }

    if (run('5.2')) { await start(); T('5.2', 'Every number has its batches and moves');
      const d = (await api('SH', 'GET', '/inventory/stock/DF044-M100?godown=1')).data;
      const k = d.godowns.find((g) => g.godown_id === 1) || d.godowns[0];
      const ex = k.lots.find((l) => l.state === 'expired'); const ne = k.lots.find((l) => l.state === 'near'); const qh = k.lots.find((l) => l.shelf === 'hold');
      ok(ex && ex.batch_no === 'WW2504' && ex.qty === 20 && ne && qh && qh.qty === 240 && d.moves.length > 0 && d.moves.every((m) => m.who) && d.moves.some((m) => m.doc === X.ids.g16.grn_no),
        `Kanchipuram: ${ex && `${ex.batch_no} expired ${ex.exp} (${ex.qty})`}; ${ne && `${ne.batch_no} in ${ne.days} days (${ne.qty})`}; ${qh && `${qh.batch_no} QC hold ${qh.qty}`}; ${d.moves.length} last moves with who, incl. ${X.ids.g16.grn_no}`); }

    if (run('5.3')) { await start(); T('5.3', 'An expired batch is blocked, not just flagged');
      const e = (await api('SH', 'GET', '/inventory/batches?tab=expired')).data; const n = (await api('SH', 'GET', '/inventory/batches?tab=near')).data;
      const eb = e.rows.find((b) => b.sku_code === 'DF044-M100');
      ok(eb && eb.days < 0 && e.can.create && n.rows.some((b) => b.sku_code === 'DF044-M100' && b.days >= 0 && b.days < b.warn), `Expired: ${eb && `${eb.batch_no} ${-eb.days} days ago, ${eb.qty}`}, Write off offered ${e.can.create}; Near: ${n.rows.filter((b) => b.sku_code === 'DF044-M100').map((b) => `${b.batch_no} ${b.days} days (warn ${b.warn})`).join(', ')}`); }

    if (run('5.4')) { await start(); T('5.4', 'A transfer takes only free stock');
      const f = (await free('DF044-M100', 1)).free;
      const a = await api('SH', 'POST', '/inventory/transfers', { from: 1, to: 1, vehicle_no: '', lines: [{ sku_code: 'DF044-M100', qty: f + 10 }, { sku_code: 'DF001-M100', qty: 20 }] });
      const t0 = await total('DF044-M100'); const g0 = await shelf('DF044-M100', 'good', 1); const e0 = await lot('DF044-M100', 1, 'WW2504');
      const sent = Math.min(f, 100);
      const r = await api('SH', 'POST', '/inventory/transfers', { from: 1, to: 2, vehicle_no: 'TN 21 AB 1234', lines: [{ sku_code: 'DF044-M100', qty: sent }] });
      const tl = r.data ? await q1('SELECT l.lots FROM transfer_lines l JOIN transfers t USING (transfer_id) WHERE t.transfer_no = ?', [r.data.transfer_no]) : null;
      const lots = tl ? (typeof tl.lots === 'string' ? JSON.parse(tl.lots) : tl.lots) : [];
      ok(a.status === 400 && /two different godowns/.test(a.fields.to) && /needs a number/.test(a.fields.vehicle_no) && new RegExp(`Only ${f} free`).test(a.fields['lines.0.qty']), `${js(a.fields)}`);
      ok(r.status === 200 && !lots.some((x) => x.batch_no === 'WW2504') && (await lot('DF044-M100', 1, 'WW2504')) === e0 && (await shelf('DF044-M100', 'good', 1)) === g0 - sent && (await total('DF044-M100')) === t0,
        `${r.data && r.data.title}: ${sent} from ${lots.map((x) => `${x.batch_no} ${x.qty}`).join(', ')}, never WW2504 (${e0} stay); Kanchipuram good ${g0} -> ${await shelf('DF044-M100', 'good', 1)}; company total ${t0} (unchanged) (v23 100 of 120 free)`); }

    if (run('5.5')) { await start(); T('5.5', 'Only the receiving godown counts it in');
      const k = (await api('KU', 'GET', `/inventory/transfers/${S.t1}`)).data;
      const kr = await api('KU', 'POST', `/inventory/transfers/${S.t1}/receive`, { recv: [40, 48] });
      const a = await api(LA, 'POST', `/inventory/transfers/${S.t1}/receive`, { recv: [41, 48] });
      const c0 = await shelf('DF001-M100', 'good', 2);
      const r = await api(LA, 'POST', `/inventory/transfers/${S.t1}/receive`, { recv: [38, 48] });
      const q = await pend('transit_loss'); const ex = String(q.excluded || '').replace(/[\[\]"]/g, '').split(',').filter(Boolean);
      ok(!k.can.receive && /You sent it/.test(k.not_mine) && kr.status === 403, `Kumar (sent it): "${k.not_mine}", receiving anyway ${kr.status}`);
      ok(a.status === 400 && /More than was sent \(40\)/.test(a.fields['recv.0']) && r.data && r.data.title === 'Received short' && ex.includes('DZIND146') && ex.includes(LA) && (await shelf('DF001-M100', 'good', 2)) === c0 + 38 && (await shelf('DF001-M100', 'disp', 2)) === 2,
        `Lakshmi P 41: "${a.fields && a.fields['recv.0']}"; 38: "${r.data && r.data.message}"; never signed by ${ex.join(', ')}; signers ${(await signers(q.approval_id)).join(', ')}`); }

    if (run('5.6')) { await start(); T('5.6', 'A stock take freezes the shelf and hides the book figure');
      const r = await api('KU', 'POST', '/inventory/takes', { godown_id: 1, scope: 'wipes' });
      const tk = (await api('KU', 'GET', `/inventory/takes/${r.data.count_id}`)).data;
      const t = await api('SH', 'POST', '/inventory/transfers', { from: 1, to: 2, vehicle_no: 'TN 21 AB 1234', lines: [{ sku_code: 'DF044-M100', qty: 1 }] });
      const w = await api('SH', 'POST', '/inventory/write-offs', { godown_id: 1, sku_code: 'DF001-M100', stock_kind: 'good', qty: 2, reason_type: 'damaged', reason: 'Wet carton' });
      await api('KU', 'POST', `/inventory/takes/${r.data.count_id}/cancel`);
      const raw = await api('KU', 'POST', '/inventory/takes', { godown_id: 1, scope: 'raw' });
      const p = await api('KU', 'POST', '/production/runs', { sku_code: 'DF001-M100', godown_id: 1, qty: 480, machine_id: 1, run_date: TODAY, shift: 'Day', operator: 'DZIND136' });
      const s = await api('MU', 'POST', `/production/runs/${p.data && p.data.run_id}/start`);
      ok(r.status === 200 && tk.counting && tk.lines.every((l) => l.book === null) && t.status === 409 && new RegExp(`frozen by stock take ST-${r.data.count_id}`).test(t.msg) && w.status === 200 && raw.status === 200 && s.status === 409 && /frozen by stock take/.test(s.msg),
        `${r.data.title}: ${tk.lines.length} lines (${tk.lines.map((l) => l.batch_no).join(', ')}), no Book figure; wipes transfer: "${t.msg}"; napkin write-off: ${w.data && w.data.title}; raw count, then the run start: "${s.msg}"`); }

    if (run('5.7')) { await start(); T('5.7', 'A count is posted only after approval');
      const r = await api('KU', 'POST', '/inventory/takes', { godown_id: 1, scope: 'wipes' }); const id = r.data.count_id;
      const tk = (await api('KU', 'GET', `/inventory/takes/${id}`)).data;
      const e = await api('MU', 'POST', `/inventory/takes/${id}/submit`, { lines: tk.lines.map((l) => ({ line_id: l.line_id, counted: null })) });
      const books = []; for (const l of tk.lines) books.push(l.batch_no === '-' ? await shelf(l.sku_code, 'good', 1) : await lot(l.sku_code, 1, l.batch_no));
      const iN = tk.lines.findIndex((l) => l.batch_no === 'WW2603');
      const s = await api('MU', 'POST', `/inventory/takes/${id}/submit`, { lines: tk.lines.map((l, i) => ({ line_id: l.line_id, counted: i === iN ? books[i] - 3 : books[i] })) });
      const q = await pend('stock_count');
      const t = await api('SH', 'POST', '/inventory/transfers', { from: 1, to: 2, vehicle_no: 'TN 21 AB 1234', lines: [{ sku_code: 'DF044-M100', qty: 1 }] });
      const n0 = await lot('DF044-M100', 1, 'WW2603'); const g0 = await shelf('DF044-M100', 'good', 1);
      const d = await decide('PV', q.approval_id);
      const mv = await q1("SELECT unit_cost FROM stock_movements WHERE move_type = 'count' AND ref_id = ? LIMIT 1", [String(id)]);
      const a = Number((await q1("SELECT avg_cost FROM skus WHERE sku_code = 'DF044-M100'")).avg_cost);
      ok(e.status >= 400 && /count every batch/i.test(e.msg) && s.status === 200 && s.data.differences === 1 && /The shelf is unfrozen; the stock changes only after approval/.test(s.data.message) && n0 === books[iN] && t.status === 200,
        `empty: "${e.msg}"; WW2603 3 short: "${s.data && s.data.message}" (signers ${q && (await signers(q.approval_id)).join(', ')}); unfrozen: a transfer goes (${t.data && t.data.transfer_no})`);
      ok(d.status === 200 && (await lot('DF044-M100', 1, 'WW2603')) === n0 - 3 && (await shelf('DF044-M100', 'good', 1)) === g0 - 3 && mv && Number(mv.unit_cost) === r2(a), `approved: WW2603 ${n0} -> ${await lot('DF044-M100', 1, 'WW2603')}, good ${g0} -> ${await shelf('DF044-M100', 'good', 1)}, at the average Rs ${mv && mv.unit_cost}`); }

    if (run('5.8')) { await start(); T('5.8', 'A repeat shortage is a theft signal');
      const count = async (short) => { const r = await api('KU', 'POST', '/inventory/takes', { godown_id: 1, scope: 'wipes' }); const tk = (await api('KU', 'GET', `/inventory/takes/${r.data.count_id}`)).data;
        const bk = []; for (const l of tk.lines) bk.push(l.batch_no === '-' ? await shelf(l.sku_code, 'good', 1) : await lot(l.sku_code, 1, l.batch_no));
        const i = tk.lines.findIndex((l) => l.batch_no === 'WW2603');
        await api('MU', 'POST', `/inventory/takes/${r.data.count_id}/submit`, { lines: tk.lines.map((l, j) => ({ line_id: l.line_id, counted: j === i ? bk[j] - short : bk[j] })) });
        return r.data.count_id; };
      const c1 = await count(3); await decide('PV', (await pend('stock_count')).approval_id);
      const c2 = await count(1);
      const tk = (await api('SH', 'GET', `/inventory/takes/${c2}`)).data;
      const ag = tk.lines.filter((l) => l.again);
      const g0 = await shelf('DF044-M100', 'good', 1); await decide('PV', (await pend('stock_count')).approval_id);
      ok(ag.length === 1 && ag[0].diff === -1 && ag[0].batch_no === 'WW2603' && (await shelf('DF044-M100', 'good', 1)) === g0 - 1, `ST-${c2}: ${ag.map((l) => `${l.sku_code} ${l.batch_no} ${l.diff}`).join(', ')} marked "Short again: theft signal" (short in ST-${c1} too); after approval good ${g0} -> ${await shelf('DF044-M100', 'good', 1)} (v23 ST-301 / ST-302 at Chennai)`); }

    if (run('5.9')) { await start(); T('5.9', 'A small write-off is done at once; held packs are protected');
      const a = await free('DF001-M100', 1);
      const x = await api('SH', 'POST', '/inventory/write-offs', { godown_id: 1, sku_code: 'DF001-M100', stock_kind: 'good', qty: a.good - a.held + 10, reason_type: 'damaged', reason: 'Roof leak' });
      const r = await api('SH', 'POST', '/inventory/write-offs', { godown_id: 1, sku_code: 'DF001-M100', stock_kind: 'good', qty: 5, reason_type: 'damaged', reason: 'Roof leak' });
      const l = (await api('SH', 'GET', '/inventory/ledger?q=DF001-M100')).data.rows[0];
      ok(x.status >= 400 && new RegExp(`${a.held} are held for orders.*Only ${a.good - a.held} can be written off`).test(x.msg) && r.status === 200 && r.data.status === 'posted' && l.qty === -5 && l.doc === r.data.ref,
        `${a.good - a.held + 10}: "${x.msg}"; 5: ${r.data && r.data.title} (Rs ${r.data && r.data.value}); ledger ${l.qty} from batch ${l.batch_no}, ${l.doc}`); }

    if (run('5.10')) { await start(); T('5.10', 'A big write-off waits; the stock stays');
      const g = await shelf('DF002-M100', 'good', 1);
      const r = await api('SH', 'POST', '/inventory/write-offs', { godown_id: 1, sku_code: 'DF002-M100', stock_kind: 'good', qty: 25, reason_type: 'damaged', reason: 'Damaged in our godown' });
      ok(r.status === 200 && r.data.status === 'pending' && (await shelf('DF002-M100', 'good', 1)) === g, `25 Restaurant Napkins (Rs ${r.data && r.data.value}): ${r.data && r.data.title}. ${r.data && r.data.message} Kanchipuram still ${g}`); }

    if (run('5.11')) { await start(); T('5.11', 'The sample write-off clears the damaged shelf');
      const w = await q1("SELECT write_off_id, approval_id, status, value, qty FROM write_offs WHERE sku_code = 'DF025-R1' ORDER BY write_off_id DESC LIMIT 1");
      const d0 = await shelf('DF025-R1', 'dmg', 1);
      const d = w.approval_id && w.status === 'pending' ? await decide('PV', w.approval_id) : null;
      const s = await q1('SELECT status FROM write_offs WHERE write_off_id = ?', [w.write_off_id]);
      ok(w.status === 'pending' && d && d.status === 200 && s.status === 'posted' && (await shelf('DF025-R1', 'dmg', 1)) === d0 - Number(w.qty),
        `WO-${w.write_off_id} (${w.qty} Kitchen Towels, Rs ${w.value}, asked by Murugan S): was ${w.status}; Pavithran ${d ? d.status : 'had nothing to sign'}; now ${s.status}; damaged ${d0} -> ${await shelf('DF025-R1', 'dmg', 1)} (v23 WO-0001 Rs 168 waits)`); }

    if (run('5.12')) { await start(); T('5.12', 'A shelf move is not a loss');
      const g = await shelf('DF025-R1', 'good', 1); const d = await shelf('DF025-R1', 'dmg', 1); const t = await total('DF025-R1');
      const r = await api('SH', 'POST', '/inventory/moves', { godown_id: 1, sku_code: 'DF025-R1', from: 'good', to: 'dmg', qty: 10, note: 'crushed' });
      ok(r.status === 200 && r.data.status === 'posted' && (await shelf('DF025-R1', 'good', 1)) === g - 10 && (await shelf('DF025-R1', 'dmg', 1)) === d + 10 && (await total('DF025-R1')) === t, `${r.data && r.data.title}: "${r.data && r.data.message}" good ${g} -> ${g - 10}, damaged ${d} -> ${d + 10}, total ${t}`); }

    if (run('5.13')) { await start(); T('5.13', 'Returned stock back to Good needs a second person');
      // the dev data has 2 returned Table Napkins at Kanchipuram (v23: 6 Facial Tissue at Chennai); Kumar M asks
      const g = await shelf('DF001-M100', 'good', 1); const rt = await shelf('DF001-M100', 'ret', 1);
      const r = await api('KU', 'POST', '/inventory/moves', { godown_id: 1, sku_code: 'DF001-M100', from: 'ret', to: 'good', qty: rt, note: 'Checked, sealed' });
      const q = await pend('restock'); const sg = q ? await signers(q.approval_id) : [];
      const d = await decide('PV', q.approval_id);
      ok(r.data && r.data.status === 'pending' && /needs a second person/.test(r.data.message) && d.status === 200 && (await shelf('DF001-M100', 'good', 1)) === g + rt && (await shelf('DF001-M100', 'ret', 1)) === 0,
        `"${r.data && r.data.message}" (signers ${sg.join(', ')}); approved: good ${g} -> ${g + rt}, returned 0`); }

    if (run('5.14')) { await start(); T('5.14', 'Write off an expired batch in one click');
      const e = (await api('SH', 'GET', '/inventory/batches?tab=expired')).data.rows.find((b) => b.sku_code === 'DF044-M100');
      const r = await api('SH', 'POST', '/inventory/write-offs', { godown_id: 1, sku_code: 'DF044-M100', stock_kind: 'good', batch_id: e.batch_id, qty: e.qty, reason_type: 'expired', reason: 'Past its date' });
      const after = (await api('SH', 'GET', '/inventory/batches?tab=expired')).data.rows.find((b) => b.batch_id === e.batch_id);
      const big = Number(r.data && r.data.value) > 1000 || e.qty > 20;
      ok(r.status === 200 && (big ? r.data.status === 'pending' && after && after.qty === e.qty : r.data.status === 'posted' && !after),
        `${e.qty} packs of ${e.batch_no}, Expired, Rs ${r.data && r.data.value}: ${r.data && r.data.title}; ${big ? 'above the rule, the batch stays blocked until signed' : 'within the rule, gone'} (v23 Rs 1,144 waits)`); }

    if (run('5.15')) { await start(); T('5.15', 'Reorder: buy or make, from free stock');
      const r = (await api('SH', 'GET', '/inventory/reorder')).data;
      const mk = r.rows.filter((x) => x.how === 'make');
      const hb = await shelf('DF048-BOX', 'good', 1);
      await pool.query('INSERT INTO stock_levels (sku_code, location_id, reorder_level, reorder_qty) VALUES (?, 1, ?, 0) ON DUPLICATE KEY UPDATE reorder_level = VALUES(reorder_level)', ['DF048-BOX', hb + 32]);
      const bx = (await api('SH', 'GET', '/inventory/reorder')).data.rows.find((x) => x.sku_code === 'DF048-BOX' && /Kanchi/.test(x.godown));
      const i = bx ? await api('SH', 'POST', '/buying/indents', { godown_id: '1', need_by: TODAY, reason: 'From the Reorder page', lines: [{ sku_code: 'DF048-BOX', qty: String(bx.suggest) }] }) : {};
      ok(r.rows.length > 0 && r.rows.every((x) => x.free + x.coming < x.level), `${r.rows.length} low items, each free + coming below its level, e.g. ${r.rows.slice(0, 3).map((x) => `${x.sku_code} at ${x.godown}: free ${x.free}, coming ${x.coming}, level ${x.level}, suggest ${x.suggest} (${x.how})`).join('; ')}`);
      ok(bx && bx.how === 'buy' && bx.suggest >= 96 && i.status === 201 && (!mk.length || mk.some((x) => !x.recipe || x.recipe)), `Bamboo Facial Tissue (level set ${hb + 32} over its ${hb}): suggest ${bx && bx.suggest} (at least Greenleaf's 96); Ask to buy sends ${i.data && i.data.indent_no}; made packs with no recipe say so: ${mk.filter((x) => !x.recipe).map((x) => x.sku_code).join(', ') || 'none low'}`); }

    if (run('5.16')) { await start(); T('5.16', 'The stock ledger has every move');
      const g = X.ids.g16;
      const f = (await api('SH', 'GET', `/buying/goods-in/${g.grn_id}/qc`)).data;
      await api('SH', 'POST', `/buying/goods-in/${g.grn_id}/qc`, { lines: f.lines.map((l) => ({ acc: String(l.recv), rej: '0', reason: '', gsm: '', deviation: '' })) });
      const p = await api('KU', 'POST', '/production/runs', { sku_code: 'DF001-M100', godown_id: 1, qty: 480, machine_id: 1, run_date: TODAY, shift: 'Day', operator: 'DZIND136' });
      await api('MU', 'POST', `/production/runs/${p.data.run_id}/start`);
      const rows = (await api('SH', 'GET', '/inventory/ledger')).data.rows;
      const top = rows.slice(0, 6);
      const s = (await api('SH', 'GET', '/inventory/ledger?q=DF044')).data;
      const csv = await fetch(`${ctx.base}/inventory/ledger.csv?q=DF044`, { headers: { Cookie: ctx.cookie('SH') } }).then((x) => x.text());
      ok(top.some((m) => m.doc === p.data.run_no && m.what === 'Issued to production') && rows.some((m) => m.doc === g.grn_no && m.what === 'Goods in, accepted') && s.rows.every((m) => /DF044/.test(m.sku_code)) && /^﻿?when,who,employee_id,item,godown,shelf,batch,qty,what,document/.test(csv),
        `newest: ${top.map((m) => `${m.sku_code} ${m.qty} ${m.what} (${m.doc})`).join('; ')}; ${g.grn_no} from QC hold to Good; DF044: ${s.total} moves; CSV: ${csv.split('\n')[0].replace('﻿', '')}`); }

    if (run('5.17')) { await start(); T('5.17', 'The godown floor');
      const t = (await api('MU', 'GET', '/inventory/takes')).data;
      const m = await api('MU', 'POST', '/inventory/moves', { godown_id: 1, sku_code: 'DF001-M100', from: 'good', to: 'dmg', qty: 1, note: 'Report damage from the floor' });
      const o = await api('MU', 'POST', '/inventory/transfers', { from: 2, to: 1, vehicle_no: 'TN 21 AB 1234', lines: [{ sku_code: 'DF001-M100', qty: 1 }] });
      ok(!t.rows.some((x) => x.status === 'open') && m.status === 200 && o.status >= 400, `Count: no stock take running; Report damage: ${m.data && m.data.title}; Send from Chennai (not his godown): ${o.status} "${o.msg}" (the four buttons and From fixed are screen behaviour)`); }

    if (run('5.18')) { await start(); T('5.18', 'Each role sees only its part');
      const paths = ['/inventory/stock', '/inventory/batches', '/inventory/transfers', '/inventory/takes', '/inventory/write-offs', '/inventory/reorder', '/inventory/ledger'];
      const dv = []; const mu = []; const ku = [];
      for (const p of paths) { dv.push((await api('DV', 'GET', p)).status); mu.push((await api('MU', 'GET', p)).status); ku.push((await api('KU', 'GET', p)).status); }
      const ms = await api('MU', 'POST', '/inventory/takes', { godown_id: 1, scope: 'wipes' });
      ok(dv.every((s) => s === 403) && mu.every((s) => s === 200) && ku.every((s) => s === 200), `Divya: ${dv.join(', ')}; Murugan (Warehouse): ${mu.join(', ')}; Kumar (Supervisor): ${ku.join(', ')}; Murugan starts a stock take: ${ms.status} (our Warehouse role has Edit on Inventory; v23 Warehouse has View and Create - the roles grid decides)`); }

    // ---------------------------------------------------------------- fix items
    if (run('I6')) { await start(); T('I6', 'Sender, receiver and stand-ins never sign a transfer loss; Found and Lost hidden while one waits');
      await api(LA, 'POST', `/inventory/transfers/${S.t1}/receive`, { recv: [36, 48] });
      const q = await pend('transit_loss');
      const dk = await decide('KU', q.approval_id); const dl = await decide(LA, q.approval_id);
      const rj = await decide('SH', q.approval_id, 'rejected', 'look for them');
      const td = (await api('SH', 'GET', `/inventory/transfers/${S.t1}`)).data;
      ok(dk.status === 403 && dl.status === 403 && /part of this record/.test(dk.msg) && rj.status === 200 && td.loss === 'rejected' && td.missing.length === 1 && td.missing[0].qty === 4 && (await shelf('DF001-M100', 'disp', 1)) === 4 && (await shelf('DF001-M100', 'disp', 2)) === 0 && td.can.settle,
        `Kumar: "${dk.msg}"; Lakshmi: "${dl.msg}"; rejected: the 4 to the sender's Disputed shelf (K ${await shelf('DF001-M100', 'disp', 1)}, C ${await shelf('DF001-M100', 'disp', 2)}); Found / Lost offered ${td.can.settle}`);
      const l = await api('SH', 'POST', `/inventory/transfers/${S.t1}/lost`);
      const w = await pend('write_off'); const sg = await signers(w.approval_id);
      const td2 = (await api('SH', 'GET', `/inventory/transfers/${S.t1}`)).data;
      const f = await api('SH', 'POST', `/inventory/transfers/${S.t1}/found`);
      const k2 = await decide('KU', w.approval_id); const p = await decide('PV', w.approval_id);
      ok(l.status === 200 && !td2.can.settle && f.status === 409 && k2.status === 403 && p.status === 200 && (await shelf('DF001-M100', 'disp', 1)) === 0, `Lost: ${js(l.data && l.data.made)}; ladder ${sg.join(', ')}; box gone while it waits; Found: "${f.msg}"; Kumar ${k2.status}; Pavithran: written off`); }

    if (run('TRF')) { await start(); T('TRF', 'Transfer short: Found goes back to Good after a second person signs');
      await api(LA, 'POST', `/inventory/transfers/${S.t1}/receive`, { recv: [37, 48] });
      await decide('SH', (await pend('transit_loss')).approval_id, 'rejected', 'find them');
      const g = await shelf('DF001-M100', 'good', 1);
      await api('MU', 'POST', `/inventory/transfers/${S.t1}/found`);
      const d = await decide('PV', (await pend('restock')).approval_id);
      ok(d.status === 200 && (await shelf('DF001-M100', 'good', 1)) === g + 3 && (await shelf('DF001-M100', 'disp', 1)) === 0, `Found 3, signed: Kanchipuram good ${g} -> ${await shelf('DF001-M100', 'good', 1)}`); }

    if (run('TRV')) { await start(); T('TRV', 'Transfer short approved: written off from the receiver, value checked');
      const v0 = await value(['DF001-M100', 'DF016-R1']);
      await api(LA, 'POST', `/inventory/transfers/${S.t1}/receive`, { recv: [39, 47] });
      const q = await pend('transit_loss'); const loss = Number(q.amount);
      const d = await decide('SH', q.approval_id);
      const v1 = await value(['DF001-M100', 'DF016-R1']);
      ok(d.status === 200 && (await shelf('DF001-M100', 'disp', 2)) === 0 && Math.abs(v0 - loss - v1) < 0.005, `value before Rs ${v0} = after Rs ${v1} + loss Rs ${loss} (difference ${(v0 - loss - v1).toFixed(4)})`); }

    if (run('PK1')) { await start(); T('PK1', 'PK1 / N8: a transfer never takes packs a packer scanned, nor an expired batch');
      const no = await ctx.packed(9, [{ sku_code: 'DF044-M100', qty: 8 }]);
      const sc = await qa("SELECT b.batch_no, COUNT(*) n FROM pack_scans p JOIN orders o ON o.order_id = p.order_id LEFT JOIN batches b ON b.batch_id = p.batch_id WHERE o.order_no = ? GROUP BY b.batch_no", [no]).catch(() => []);
      const before = {}; for (const b of ['WW2504', 'WW2509', 'WW2603', 'GL2611', 'WW2610']) before[b] = await lot('DF044-M100', 1, b);
      const f = (await free('DF044-M100', 1)).free;
      const r = await api('SH', 'POST', '/inventory/transfers', { from: 1, to: 2, vehicle_no: 'TN 21 AB 1234', lines: [{ sku_code: 'DF044-M100', qty: f }] });
      const tl = r.data ? await q1('SELECT l.lots FROM transfer_lines l JOIN transfers t USING (transfer_id) WHERE t.transfer_no = ?', [r.data.transfer_no]) : null;
      const lots = tl ? (typeof tl.lots === 'string' ? JSON.parse(tl.lots) : tl.lots) : [];
      const left = await shelf('DF044-M100', 'good', 1);
      ok(no && r.status === 200 && !lots.some((x) => x.batch_no === 'WW2504') && left >= 8 + before.WW2504, `${no} packed 8 Wet Wipes (${js(sc)}); transfer of all ${f} free took ${lots.map((x) => `${x.batch_no} ${x.qty}`).join(', ')}; left at Kanchipuram ${left} = the 8 scanned + 20 expired + held`); }

    if (run('N7')) { await start(); T('N7', 'A named batch is the only batch taken');
      const n = await lot('DF044-M100', 1, 'WW2603'); const b = (await q1("SELECT batch_id FROM batches WHERE batch_no = 'WW2603'")).batch_id;
      const dmgBefore = await lot('DF044-M100', 1, 'WW2603', 'dmg'); // the dev data may hold damaged packs of this batch already
      const a = await api('SH', 'POST', '/inventory/moves', { godown_id: 1, sku_code: 'DF044-M100', from: 'good', to: 'dmg', qty: n + 1, batch_id: b, note: 'Crushed' });
      const r = await api('SH', 'POST', '/inventory/moves', { godown_id: 1, sku_code: 'DF044-M100', from: 'good', to: 'dmg', qty: 2, batch_id: b, note: 'Crushed' });
      const goodAfter = await lot('DF044-M100', 1, 'WW2603'); const dmgAfter = await lot('DF044-M100', 1, 'WW2603', 'dmg');
      ok(a.status === 400 && /Only \d+ on the good shelf in that batch/.test(a.fields.qty) && Number((a.fields.qty.match(/Only (\d+)/) || [])[1]) <= n && r.status === 200 && goodAfter === n - 2 && dmgAfter === dmgBefore + 2,
        `${n + 1}: ${a.status} "${a.fields && a.fields.qty}"; 2: ${r.status} "${r.msg || ''}", good WW2603 ${n} -> ${goodAfter}, damaged WW2603 ${dmgBefore} -> ${dmgAfter}`); }

    if (run('LOW2d')) { await start(); T('LOW2d', 'QC hold is cleared only by Quality check (refused on the server)');
      const a = await api('SH', 'POST', '/inventory/write-offs', { godown_id: 1, sku_code: 'DF044-M100', stock_kind: 'hold', qty: 2, reason_type: 'damaged', reason: 'x' });
      const b = await api('SH', 'POST', '/commerce/write-offs', { godown_id: 1, sku_code: 'DF044-M100', stock_kind: 'hold', qty: 2, reason_type: 'damaged', reason: 'x' });
      ok(a.status === 400 && b.status === 400 && /cleared only by Quality check/.test(b.msg), `Inventory: "${a.fields && a.fields.stock_kind}"; the older route: "${b.msg}"`); }

    if (run('LOW2e')) { await start(); T('LOW2e', 'The count sheet lists packs scanned for orders not yet dispatched');
      const no = await ctx.packed(9, [{ sku_code: 'DF044-M100', qty: 8 }]);
      const r = await api('KU', 'POST', '/inventory/takes', { godown_id: 1, scope: 'all' });
      const tk = (await api('KU', 'GET', `/inventory/takes/${r.data.count_id}`)).data;
      ok(tk.scanned.some((s) => s.order_no === no && s.sku_code === 'DF044-M100' && s.qty === 8), `listed: ${tk.scanned.map((s) => `${s.order_no} ${s.sku_code} ${s.qty}${s.packed ? ' (packed)' : ''}`).join(', ')}`); }

    if (run('VAL')) { await start(); T('VAL', 'Value check: a stock take difference and a write-off reconcile with the posted amounts');
      const codes = ['DF044-M100', 'DF001-M100'];
      const v0 = await value(codes, ['good']);
      const w = await api('SH', 'POST', '/inventory/write-offs', { godown_id: 1, sku_code: 'DF001-M100', stock_kind: 'good', qty: 5, reason_type: 'damaged', reason: 'Roof leak' });
      const r = await api('KU', 'POST', '/inventory/takes', { godown_id: 1, scope: 'wipes' });
      const tk = (await api('KU', 'GET', `/inventory/takes/${r.data.count_id}`)).data;
      const bk = []; for (const l of tk.lines) bk.push(l.batch_no === '-' ? await shelf(l.sku_code, 'good', 1) : await lot(l.sku_code, 1, l.batch_no));
      const i = tk.lines.findIndex((l) => l.batch_no === 'WW2603');
      await api('MU', 'POST', `/inventory/takes/${r.data.count_id}/submit`, { lines: tk.lines.map((l, j) => ({ line_id: l.line_id, counted: j === i ? bk[j] - 2 : bk[j] })) });
      const q = await pend('stock_count'); const cv = Number(q.amount); await decide('PV', q.approval_id);
      const v1 = await value(codes, ['good']);
      ok(Math.abs(v0 - Number(w.data.value) - cv - v1) < 0.005, `good stock before Rs ${v0} = after Rs ${v1} + write-off Rs ${w.data.value} + count shortage Rs ${cv} (difference ${(v0 - Number(w.data.value) - cv - v1).toFixed(4)})`); }

    if (run('STEP0')) { await start(); T('STEP0', 'Every pack row shows its photo');
      const r = (await api('SH', 'GET', '/sku-images')).data;
      const n = await q1("SELECT COUNT(*) n FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.sku_type <> 'raw' AND EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.product_id)");
      ok(Object.keys(r).length === Number(n.n) && Object.values(r).every((f) => /\.webp$/.test(f)), `${Object.keys(r).length} packs carry a photo (= the ${n.n} packs whose product has one)`); }
  },
};
