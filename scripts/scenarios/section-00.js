// Section 0 - Foundation and setup: the v23 Tests tab "0" (52 tests: company, godowns, staff, roles, limits, approval
// rules, stand-ins, the second Admin, numbering, switches, audit log). Written from the v23 test definitions and
// docs/tests/SECTION-0-CLICK-TEST.md. Run: npm run scenarios -- 0
// Our people for v23's (dev data): Shoban B = SH DZIND002 (Super admin), Pavithran V V = PV DZIND148 (Admin),
// Anitha R = AN DZIND135 (Sub-admin), Kumar M = KU DZIND146 (hand-made role 32 "Supervisor", Kanchipuram),
// Lakshmi P = DZIND150 (role 32, Chennai), Murugan S = MU DZIND136 (Warehouse, Kanchipuram), Divya N = DV DZIND147
// (Sales), Raja K = RA DZIND142 (Delivery). Selvi R and the other new staff are dAdmin employees added in the test.
// v23's starting state is made with setup() where a test needs it: Anitha's limit Rs 25,000 (empty on dev), Lakshmi's
// personal Rs 5,000, Kumar on leave (yesterday to 3 days ahead) with Lakshmi standing in.
// v23's "Ask for" form does not exist in our app: requests are raised by the screen that holds the action. A real
// write-off (POST /inventory/write-offs) is used wherever v23 asks for one; other kinds are raised with the app's own
// approvals.request(), the call every holding screen makes.
// Deliberate differences (phase 12b, fix proof F1 / N14): a higher personal limit, a role that signs more and a wider
// godown scope wait for a second Admin instead of saving at once; the checks follow ours and say so.
const path = require('path');
const crypto = require('crypto');
const { ROOT } = require('./lib');

const BR = (m) => require(path.join(ROOT, 'src', 'backend_routes', m)); // eslint-disable-line global-require

module.exports = {
  title: 'Foundation and setup',
  async run(ctx) {
    const { api, ok, say, q1, qa, decide, T, fresh, run, pool, today, base, cookie, P } = ctx;
    const approvals = BR('approvals');
    const engine = BR('approval-engine');
    const foundation = BR('foundation');
    const secondAdmin = BR('second-admin');
    const LA = 'DZIND150'; // v23 Lakshmi P (Supervisor, Chennai)
    const K = 1; const C = 2; // Kanchipuram, Chennai
    const day = (n) => engine.addDays(today(), n);
    const sharp = require(path.join(ROOT, 'node_modules', 'sharp')); // eslint-disable-line global-require

    let names = {};
    const loadNames = async () => { names = Object.fromEntries((await approvals.people(pool)).map((p) => [p.emp_id, p.name])); };
    const nm = (e) => names[P[e] || e] || P[e] || e;
    const id = (e) => P[e] || e;

    const setLeave = (emp, from, to, standIn, setBy = 'DZIND002') => pool.query('UPDATE admin_users SET leave_from = ?, leave_to = ?, stand_in = ?, leave_set_by = ? WHERE emp_id = ?',
      [from, to, standIn, from ? setBy : null, id(emp)]);
    const personal = (emp, amount) => pool.query("UPDATE admin_users SET limit_kind = 'amount', limit_amount = ? WHERE emp_id = ?", [amount, id(emp)]);
    /** v23's start: Anitha Rs 25,000, Lakshmi Rs 5,000 personal, Kumar on leave with Lakshmi standing in */
    const setup = async ({ leave = true } = {}) => {
      await personal('AN', 25000);
      await personal(LA, 5000);
      if (leave) await setLeave('KU', day(-1), day(3), LA);
      else await setLeave('KU', null, null, null);
      await loadNames();
    };
    /** v23's Supervisor holds every Warehouse right; the dev role 32 lacks Cancel and Export on Packing and Inventory: added here */
    const supOverWarehouse = async () => {
      const cols = (await qa("SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'role_permissions' AND column_name LIKE 'can\_%'")).map((x) => x.c);
      await pool.query(`INSERT INTO role_permissions (role_id, section, ${cols.join(', ')}) SELECT * FROM (SELECT 32 AS role_id, section, ${cols.join(', ')} FROM role_permissions WHERE role_id = 5) w
        ON DUPLICATE KEY UPDATE ${cols.map((c) => `${c} = GREATEST(role_permissions.${c}, w.${c})`).join(', ')}`);
    };
    /** v23's "Ask for": the app's own request call (the one every holding screen makes) -> approval_id */
    // target: Rs rules count requests of one target together (else all of one person's): a scenario target keeps the dev data's own requests out
    const ask = (as, kind, godownId, amount, summary, target = `scn:${kind}`) => approvals.request(pool, { kind, godownId, amount, target, summary: summary || `Scenario: ${kind} Rs ${amount}` }, id(as));
    /** a real write-off from the Good shelf -> reply */
    const writeOff = async (as, godownId, sku, qty, reason = 'Scenario write-off') => { // the value from the row (hidden in the reply without See cost)
      const r = await api(as, 'POST', '/inventory/write-offs', { godown_id: godownId, sku_code: sku, stock_kind: 'good', qty, reason_type: 'damaged', reason });
      if (r.data && r.data.write_off_id) r.data.value = Number((await q1('SELECT value FROM write_offs WHERE write_off_id = ?', [r.data.write_off_id])).value);
      else say('write-off:', r.status, r.msg);
      return r;
    };
    const pend = async (as) => (await api(as, 'GET', '/approvals?status=pending')).data.rows;
    const mine = async (as) => (await api(as, 'GET', '/approvals?status=mine')).data.rows;
    const decided = async (as) => (await api(as, 'GET', '/approvals?status=decided')).data.rows;
    const rowOf = async (as, aid) => (await pend(as)).find((r) => r.approval_id === aid);
    const ladder = (r) => (r ? r.signers.map((s) => `${s.name}${s.via ? ` (for ${s.via})` : ''} ${s.limit}`).join(', ') : 'not listed');
    const staff = async (as = 'SH') => (await api(as, 'GET', '/staff')).data;
    const staffOf = async (emp, as = 'SH') => (await staff(as)).staff.find((x) => x.emp_id === id(emp));
    const roles = async (as = 'SH') => (await api(as, 'GET', '/roles')).data.roles;
    const roleOf = async (rid, as = 'SH') => (await roles(as)).find((r) => r.role_id === rid);
    const waitingRule = async (dk) => q1("SELECT approval_id, summary, requested_by FROM approvals WHERE status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = ? ORDER BY approval_id DESC LIMIT 1", [dk]);
    /** a dAdmin employee who is not a dFresh admin user yet (read only from dAdmin) -> { emp_id, name } */
    const newEmployee = async (skip = []) => (await api('SH', 'GET', '/users/employees')).data.find((e) => !skip.includes(e.emp_id));
    const tax = async () => (await api('SH', 'GET', '/company')).data.tax;
    const putTax = async (b, as = 'SH') => { const t = await tax(); return api(as, 'PUT', '/company/tax', { gstin: t.gstin, pan: t.pan, tan: t.tan, udyam: t.udyam, gst_type: t.gst_type, ...b }); };
    const godownBody = (b) => ({ name: 'Test godown', address: 'Scenario street 1', state: 'Tamil Nadu', ...b });
    const raw = async (as, method, p, opts = {}) => fetch(`${base}${p}`, { method, headers: { Cookie: cookie(as), ...(opts.headers || {}) }, body: opts.body });
    const multipart = async (as, p, buf, file, type) => {
      const fd = new FormData(); fd.append('file', new Blob([buf], { type }), file);
      const r = await raw(as, 'POST', p, { body: fd }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch { j = null; }
      return { status: r.status, msg: j && j.message, raw: t.slice(0, 200) };
    };
    const noisePng = (w, h) => sharp(crypto.randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
    const csvRecords = (s) => { // rows of a CSV (quoted fields may hold commas, quotes and new lines)
      let n = 0; let inQ = false; let any = false;
      for (let i = 0; i < s.length; i += 1) {
        const ch = s[i];
        if (inQ) { if (ch === '"') { if (s[i + 1] === '"') i += 1; else inQ = false; } } else if (ch === '"') { inQ = true; any = true; } else if (ch === '\n') { if (any) n += 1; any = false; } else if (ch !== '\r') any = true;
      }
      return n + (any ? 1 : 0);
    };
    await loadNames();

    if (run('0.1')) { await fresh(); await setup(); T('0.1', 'Nobody signs their own request');
      const aid = await ask('PV', 'po', K, 86400, 'Scenario: purchase order Rs 86,400');
      const pv = await rowOf('PV', aid); const pvMine = (await mine('PV')).find((r) => r.approval_id === aid);
      const sh = await rowOf('SH', aid);
      const d = await decide('PV', aid);
      ok(pv && !pv.can_decide && /raised it/i.test(pv.why_not || '') && pvMine && sh && sh.can_decide && d.status === 403,
        `PO #${aid} Rs 86,400 by ${nm('PV')}: his card "${pv && pv.why_not}", under Raised by you ${Boolean(pvMine)}; ${nm('SH')} can decide ${sh && sh.can_decide}; PV pressing Approve: ${d.status} "${d.msg}"`); }

    if (run('0.2')) { await fresh(); await setup(); T('0.2', 'A request waits for the smallest limit that covers it');
      const w = await writeOff('KU', K, 'DF024-R1', 31, 'Scenario: 31 packs damaged (v23 Rs 4,100)');
      const r = await rowOf('SH', w.data && w.data.approval_id);
      const order = r ? r.signers.map((s) => s.emp_id) : [];
      ok(w.status < 300 && r && order[0] === P.AN && order.slice(1).sort().join() === [P.SH, P.PV].sort().join() && !order.includes(P.KU),
        `${w.data && w.data.ref} by ${nm('KU')} at Kanchipuram, Rs ${w.data && w.data.value}: ladder ${ladder(r)} (Kumar raised it: not on it; Lakshmi signs for Kumar only up to his Rs 2,000)`); }

    if (run('0.3')) { await fresh(); await setup(); T('0.3', 'Too small a limit moves it up');
      const aid = await ask('DV', 'refund', C, 30000, 'Scenario: refund to a customer Rs 30,000 at Chennai');
      const la = await rowOf(LA, aid); const an = await rowOf('AN', aid);
      ok(!la && an && !an.can_decide && /25,000/.test(an.why_not || '') && an.signers.every((s) => [P.SH, P.PV].includes(s.emp_id)) && an.signers.length === 2,
        `refund #${aid} Rs 30,000 Chennai by ${nm('DV')}: ${nm(LA)} sees it: ${Boolean(la)} (Supervisor has no Approve on Returns); ${nm('AN')} sees it, can decide ${an && an.can_decide}: "${an && an.why_not}"; ladder ${ladder(an)}`); }

    if (run('0.4')) { await fresh(); await setup(); T('0.4', "A stand-in signs with the absent person's rights");
      const w = await writeOff('MU', K, 'DF024-R1', 13, 'Scenario: 13 packs damaged (v23 4 packs Kitchen Towel 2ply)');
      const aid = w.data && w.data.approval_id;
      const la = await rowOf(LA, aid);
      const d = await decide(LA, aid);
      const dec = (await decided('SH')).find((r) => r.approval_id === aid);
      const au = await q1("SELECT after_json FROM audit_log WHERE entity_type = 'approval' AND entity_id = ? AND action = 'approve'", [String(aid)]);
      const aj = au ? (typeof au.after_json === 'string' ? JSON.parse(au.after_json) : au.after_json) : {};
      ok(la && la.can_decide && la.via && la.via.emp_id === P.KU && la.amount === null && d.status === 200 && dec && dec.decided_via_name === nm('KU') && aj.for === P.KU && aj.signed_by === LA,
        `${w.data && w.data.ref} Rs ${w.data && w.data.value} at Kanchipuram: ${nm(LA)} (Chennai only) can sign for ${la && la.via && la.via.name}, value shown ${la && la.amount === null ? 'hidden (no See cost)' : la && la.amount}; Approve ${d.status}; Decided: by ${dec && dec.decided_by_name} for ${dec && dec.decided_via_name}; audit for ${aj.for} signed by ${aj.signed_by}`); }

    if (run('0.5')) { await fresh(); await setup(); T('0.5', 'Someone on leave cannot sign');
      const w = await writeOff('KU', K, 'DF024-R1', 31, 'Scenario: Kumar 31 packs (v23 Rs 4,100)');
      const w2 = await writeOff('MU', K, 'DF024-R1', 13, 'Scenario: Murugan 13 packs');
      const p = await pend('KU'); const m = await mine('KU');
      const other = p.find((r) => r.approval_id === w2.data.approval_id);
      ok(!p.some((r) => r.can_decide) && m.length >= 1 && m.every((r) => r.requested_by === P.KU) && m.some((r) => r.approval_id === w.data.approval_id) && (!other || /on leave until/.test(other.why_not || '')),
        `${nm('KU')} on leave ${day(-1)} to ${day(3)}: Waiting for you ${p.filter((r) => r.can_decide).length}; Raised by you ${m.map((r) => `#${r.approval_id} ${r.status}`).join(', ')}; Murugan's write-off ${other ? `shown with "${other.why_not}"` : 'not listed to him'}. The leave note on top is the screen's (not checked here)`); }

    if (run('0.6')) { await fresh(); await setup(); T('0.6', 'Godown scope decides what you can sign');
      const s = await api('SH', 'PUT', `/staff/${P.KU}`, { leave: { from: day(-1), to: day(3), stand_in: null } });
      const w = await writeOff('MU', K, 'DF024-R1', 13, 'Scenario: Kanchipuram write-off');
      const cnt = await ask('DV', 'stock_count', C, 740, 'Scenario: stock count fix Rs 740 at Chennai');
      const p = await pend(LA);
      const kRow = p.find((r) => r.approval_id === w.data.approval_id); const cRow = p.find((r) => r.approval_id === cnt);
      ok(s.status === 200 && !s.data.leave.stand_in && !kRow && cRow && cRow.can_decide,
        `Kumar's stand-in set to nobody (${s.status}); ${nm(LA)}: Kanchipuram ${w.data.ref} ${kRow ? 'listed' : 'not in her list'}; Chennai count fix #${cnt} Rs 740 ${cRow ? `under Waiting for you: ${cRow.can_decide}` : 'missing'}`); }

    if (run('0.7')) { await fresh(); await setup(); T('0.7', 'A personal limit beats the role default');
      const a0 = Number((await q1("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'admin_user' AND entity_id = ?", [P.MU])).n);
      const r1 = await api('SH', 'PUT', `/staff/${P.MU}`, { limit: { kind: 'amount', amount: '500' } });
      const w = await waitingRule(`stafflim:limit:${P.MU}`);
      const d = w ? await decide('PV', w.approval_id) : { status: 0 };
      const s1 = await staffOf('MU');
      const r2 = await api('SH', 'PUT', `/staff/${P.MU}`, { limit: { kind: 'role' } });
      const s2 = await staffOf('MU');
      const a1 = Number((await q1("SELECT COUNT(*) n FROM audit_log WHERE entity_type = 'admin_user' AND entity_id = ?", [P.MU])).n);
      ok(r1.status === 200 && w && d.status === 200 && s1.limit_text === 'Rs 500' && s1.limit_personal && s1.role_limit_text === 'nothing' && r2.status === 200 && !s2.limit_personal && a1 - a0 >= 2,
        `${nm('MU')} limit 500: "${(r1.data && r1.data.waiting || []).join(' ')}" (ours: a higher limit waits for a second Admin, F1), PV approves ${d.status}: ${s1.limit_text}, personal ${s1.limit_personal}, role ${s1.role_limit_text}; emptied: ${r2.status}, ${s2.limit_text} personal ${s2.limit_personal}; audit rows +${a1 - a0}`); }

    if (run('0.8')) { await fresh(); await setup(); T('0.8', 'Changing a role default moves everybody on it');
      const r = await api('SH', 'PUT', '/roles/32', { limit: { kind: 'amount', amount: '3000' } });
      const w = await waitingRule('roleperm:32');
      const d = w ? await decide('PV', w.approval_id) : { status: 0 };
      const ku = await staffOf('KU'); const la = await staffOf(LA);
      ok(r.status === 200 && w && d.status === 200 && ku.limit_text === 'Rs 3,000' && la.limit_text === 'Rs 5,000' && la.limit_personal,
        `Supervisor default 2000 to 3000: "${r.data && r.data.waiting}" (a higher limit waits for a second Admin), PV approves ${d.status}; ${nm('KU')} ${ku.limit_text}; ${nm(LA)} ${la.limit_text} (personal ${la.limit_personal})`); }

    if (run('0.9')) { await fresh(); await setup(); T('0.9', 'A tick without money signs nothing');
      const wh = await roleOf(5);
      const r = await api('SH', 'PUT', '/roles/5', { perms: { ...wh.perms, inventory: { ...wh.perms.inventory, approve: true } } });
      const w = await waitingRule('roleperm:5');
      const d = w ? await decide('PV', w.approval_id) : { status: 0 };
      const now = await roleOf(5);
      const rule = (await api('SH', 'GET', '/approval-rules')).data.rules.find((x) => x.kind === 'write_off');
      ok(d.status === 200 && now.perms.inventory.approve && !rule.signers.some((s) => s.emp_id === P.MU),
        `Warehouse Approve on Inventory: ${r.data && r.data.waiting ? 'waited, ' : ''}PV approves ${d.status}, ticked ${now.perms.inventory.approve}, limit ${now.limit_text}; write-off signers ${rule.signers.map((s) => `${s.name} ${s.limit_text}`).join(', ')} (no ${nm('MU')})`); }

    if (run('0.10')) { await fresh(); T('0.10', 'Every godown includes future godowns');
      const every = (await qa('SELECT emp_id FROM admin_users WHERE godowns_all = 1 AND is_active = 1 AND pending_add = 0')).map((x) => nm(x.emp_id));
      const g = await api('SH', 'POST', '/godowns', godownBody({ code: 'T', name: 'Tiruvallur godown' }));
      const st = await staff();
      const ku = st.staff.find((x) => x.emp_id === P.KU);
      ok(g.status === 201 && every.every((n) => g.data.message.includes(n)) && Array.isArray(ku.godowns) && !ku.godowns.includes(g.data.godown_id),
        `(Vellore V is already on dev, closed: a new godown T) "${g.data && g.data.message}"; on every godown: ${every.join(', ')} (Divya and Raja are on every godown on our data); ${nm('KU')} still ${JSON.stringify(ku.godowns)}`); }

    if (run('0.11')) { await fresh(); T('0.11', 'Another state needs its own GSTIN');
      const g = await api('SH', 'POST', '/godowns', godownBody({ code: 'M', name: 'Mysuru godown', state: 'Karnataka', gstin: '' }));
      ok(g.status === 400 && g.fields && /own 15-character GSTIN/.test(g.fields.gstin || ''), `${g.status} under GSTIN: "${g.fields && g.fields.gstin}"`); }

    if (run('0.12')) { await fresh(); T('0.12', 'Invoice numbers stay inside 16 characters');
      const r = await api('SH', 'PUT', '/numbering/debit', { prefix: 'DFRESH' });
      const s = (await api('SH', 'GET', '/numbering')).data.series.find((x) => x.doc_key === 'debit');
      ok(r.status >= 400 && /19 characters/.test(r.msg || '') && /Kept DFD/.test(r.msg || '') && s.prefix === 'DFD', `${r.status} "${r.msg}"; prefix now ${s.prefix}`); }

    if (run('0.13')) { await fresh(); T('0.13', 'Leaving blocks access at once');
      // v23: Divya owns 5 customers and 3 enquiries (none on dev): given to her here
      await pool.query('UPDATE customers SET owner_emp_id = ? WHERE customer_id IN (SELECT customer_id FROM (SELECT customer_id FROM customers WHERE merged_into IS NULL ORDER BY customer_id LIMIT 5) x)', [P.DV]);
      await pool.query("UPDATE leads SET assigned_to = ?, status = 'new' WHERE lead_id IN (SELECT lead_id FROM (SELECT lead_id FROM leads ORDER BY lead_id LIMIT 3) x)", [P.DV]);
      const c0 = await q1("SELECT (SELECT COUNT(*) FROM customers WHERE owner_emp_id = ?) c, (SELECT COUNT(*) FROM leads WHERE assigned_to = ? AND status IN ('new', 'contacted', 'qualified')) l", [P.DV, P.DV]);
      const a = await api('SH', 'PUT', `/users/${P.DV}`, { is_active: 0 });
      const b = await api('SH', 'PUT', `/users/${P.DV}`, { is_active: 0, hand_over_to: P.PV });
      const s = await staffOf('DV');
      const c1 = await q1('SELECT (SELECT COUNT(*) FROM customers WHERE owner_emp_id = ?) c, (SELECT COUNT(*) FROM customers WHERE owner_emp_id = ?) p', [P.DV, P.PV]);
      const as = await api('DV', 'GET', '/approvals'); const as2 = await api('DV', 'POST', '/approvals/1/decide', { decision: 'approved' });
      ok(a.status === 409 && /Hand over first/.test(a.msg || '') && b.status === 200 && s && !s.active && s.left && Number(c1.c) === 0 && as.status === 401 && as2.status === 401,
        `first: ${a.status} "${a.msg}" (she had ${c0.c} customers, ${c0.l} open enquiries); then ${b.status}, handed over ${JSON.stringify(b.data && b.data.handed_over)}; Staff: active ${s && s.active}, left ${JSON.stringify(s && s.left)}; as her: Approvals ${as.status} "${as.msg}", Approve ${as2.status}`); }

    if (run('0.14')) { await fresh(); await setup({ leave: false }); T('0.14', 'A request nobody can sign is flagged');
      const r = await api('SH', 'PUT', `/staff/${P.PV}`, { limit: { kind: 'amount', amount: '25000' } });
      const w = await waitingRule(`staffadm:limit:${P.PV}`);
      const d = w ? await decide('PV', w.approval_id) : { status: 0 };
      const pv = await staffOf('PV');
      const aid = await ask('SH', 'write_off', C, 30000, 'Scenario: stock write-off Rs 30,000 at Chennai');
      const line = await secondAdmin.waitingLine(pool, aid);
      const card = await rowOf('SH', aid);
      ok(r.status === 200 && d.status === 200 && pv.limit_text === 'Rs 25,000' && card && card.signers.length === 0 && /Nobody can sign it today/.test(line),
        `PV limit 25000: waits (lowering an Admin's limit, N14) "${(r.data && r.data.waiting || []).join(' ')}", PV signs it ${d.status} -> ${pv.limit_text}; write-off #${aid} Rs 30,000 by ${nm('SH')}: ladder ${ladder(card) || 'empty'}; message "${line}"`); }

    if (run('0.15')) { await fresh(); T('0.15', 'Every change is in the Audit log');
      const a0 = Number((await q1('SELECT COALESCE(MAX(audit_id), 0) n FROM audit_log')).n);
      const g = await api('SH', 'PUT', `/godowns/${C}`, { phone: '+91 77790 39666' });
      const s = await api('SH', 'PUT', '/commerce-settings/expiry_warn_days', { value: '45' });
      const ro = await api('SH', 'PUT', '/roles/32', { description: 'Scenario: supervises a godown' });
      const L = (await api('SH', 'GET', `/audit?emp=${P.SH}&from=${today()}&to=${today()}`)).data;
      const mineRows = L.rows.filter((x) => x.audit_id > a0);
      const each = ['godown', 'commerce_setting', 'role'].map((t) => mineRows.find((x) => x.entity_type === t));
      ok(g.status === 200 && s.status === 200 && ro.status === 200 && each.every((x) => x && x.changes.some((c) => c.from !== null && c.to !== null) && x.who === nm('SH') && x.created_at),
        `3 changes by ${nm('SH')}; audit (filtered to him, today): ${each.map((x) => x && `${x.screen_label}: ${x.changes.map((c) => `${c.field} ${c.from} -> ${c.to}`).join('; ').slice(0, 90)}`).join(' | ')}`); }

    if (run('0.16')) { await fresh(); T('0.16', 'Production is in every role grid');
      const R = await api('SH', 'GET', '/roles');
      const g = (rid) => { const p = R.data.roles.find((r) => r.role_id === rid).perms.production || {}; return Object.keys(p).filter((k) => p[k]); };
      const sup = g(32); const wh = g(5); const de = g(7);
      ok(R.data.sections.some((s) => s.key === 'production') && ['view', 'create', 'edit', 'approve'].every((a) => sup.includes(a)) && wh.join() === 'view,create' && de.length === 0,
        `Production: Supervisor ${sup.join(', ')}; Warehouse ${wh.join(', ')}; Delivery ${de.join(', ') || 'nothing'}; grid ${R.data.sections.length} sections x ${R.data.actions.length} actions (v23: 18 x 6; ours adds Content, Settings, Audit log rows and the Delete action)`); }

    if (run('0.17')) { await fresh(); await setup(); T('0.17', 'The floor reports production wastage, the office signs');
      const aid = await ask('MU', 'prod_scrap', K, 800, 'Scenario: production wastage above the recipe Rs 800');
      const r = await rowOf('SH', aid); const mu = (await mine('MU')).find((x) => x.approval_id === aid);
      const s = r ? r.signers : [];
      ok(s.length && s[0].emp_id === LA && s[0].via === nm('KU') && s[1].emp_id === P.AN && !s.some((x) => x.emp_id === P.MU) && mu && !mu.can_decide,
        `#${aid} Rs 800 by ${nm('MU')}: ladder ${ladder(r)}; Murugan: "${mu && mu.why_not}"`); }

    if (run('0.18')) { await fresh(); T('0.18', 'Numbers already running on stage2 are kept');
      const a = await api('SH', 'PUT', '/numbering/invoice', { prefix: 'DFX' });
      const b = await api('SH', 'PUT', '/numbering/credit', { fy_reset: 0 });
      const S = (await api('SH', 'GET', '/numbering')).data.series;
      const sr = (k) => S.find((x) => x.doc_key === k);
      const inv = sr('invoice').runs;
      const kRun = inv.find((x) => x.code === 'K'); const cRun = inv.find((x) => x.code === 'C');
      ok(a.status === 409 && /Kept as built/.test(a.msg || '') && b.status === 409 && /^DFI\/\d\d-\d\d\/\d{4}$/.test(kRun.no) && /^DFI\/C\/\d\d-\d\d\/\d{4}$/.test(cRun.no) && /^DFO-\d{6}$/.test(sr('order').runs[0].no) && /^DFR-\d{6}$/.test(sr('return').runs[0].no) && sr('receipt').prefix === 'DFRC',
        `prefix: ${a.status} "${(a.msg || '').slice(0, 90)}"; restart off: ${b.status}; Kanchipuram ${kRun.no}, Chennai ${cRun.no}, Order ${sr('order').runs[0].no}, Return ${sr('return').runs[0].no}, Receipt ${sr('receipt').runs[0].no}`); }

    if (run('0.19')) { await fresh(); T('0.19', 'Approval rules show what is built and what is new');
      const R = (await api('SH', 'GET', '/approval-rules')).data;
      const r = (k) => R.rules.find((x) => x.kind === k);
      const every = R.rules.filter((x) => x.unit === 'all');
      const secOrder = [...new Set(R.rules.map((x) => x.section))];
      ok(every.every((x) => x.limit_value === null) && r('write_off').unit === 'Rs' && r('write_off').limit_packs !== null && r('special_price').unit === '%' && r('special_price').limit_value === 10 && r('margin_floor').unit === '%' && r('margin_floor').limit_value === 10,
        `${R.rules.length} rules (v23 41; ours adds after-export changes and more kinds; no Built / New tag is shown), ${every.length} "every one" with no amount; write-off Rs ${r('write_off').limit_value} and ${r('write_off').limit_packs} packs; special price ${r('special_price').limit_value}%, margin floor ${r('margin_floor').limit_value}%; sections in order: ${secOrder.join(', ')}`); }

    if (run('0.20')) { await fresh(); T('0.20', 'The audit log shows each person only what they may see');
      const a = (await api('SH', 'GET', '/company')).data.address;
      const c = await api('SH', 'PUT', '/company/address', { line1: a.line1, line2: a.line2, city: a.city || 'Kanchipuram', pin: a.pin, state_code: a.state_code, map_query: a.map_query, email: a.email, phone: '+91 93302 59330', whatsapp: a.whatsapp });
      const w = await writeOff('KU', K, 'DF024-R1', 31, 'Scenario: Kumar write-off');
      const an = (await api('AN', 'GET', '/audit?limit=200')).data;
      const anScreens = new Set(an.rows.map((x) => x.screen));
      const ku = await api('KU', 'GET', '/audit?limit=200'); const kuMine = (await api('KU', 'GET', '/audit/mine')).data;
      const mu = await api('MU', 'GET', '/audit'); const muMine = (await api('MU', 'GET', '/audit/mine')).data;
      const sh = (await api('SH', 'GET', '/audit?screen=company')).data;
      if (c.status !== 200) say('company:', c.status, c.msg, JSON.stringify(c.fields));
      ok(c.status === 200 && w.status < 300 && an.scope === 'sections' && !anScreens.has('company') && an.people && sh.rows.length > 0 && kuMine.rows.every((x) => x.emp_id === P.KU) && kuMine.rows.some((x) => x.entity_type === 'write_off') && !kuMine.people
        && (ku.status === 403 || !ku.data.rows.some((x) => x.screen === 'company')) && mu.status === 403 && muMine.rows.every((x) => x.emp_id === P.MU),
        `company phone changed (${c.status}; the dev company has no town: Kanchipuram typed); ${nm('AN')}: scope ${an.scope}, screens ${[...anScreens].join(', ')} (no company); ${nm('KU')} /audit ${ku.status}${ku.status === 200 ? ` scope ${ku.data.scope} (the dev Supervisor role has View on Audit log), no company rows` : ''}, his own ${kuMine.rows.length} rows, no Everybody list; ${nm('MU')} (no View on Audit log): /audit ${mu.status}, own rows ${muMine.rows.length}; ${nm('SH')} sees ${sh.total} company rows`); }

    if (run('0.21')) { await fresh(); await setup(); T('0.21', 'A role shows its people, open or closed');
      const r = await roleOf(32); const st = (await staff()).staff.filter((x) => x.role_id === 32 && x.active);
      const ku = st.find((x) => x.emp_id === P.KU); const la = st.find((x) => x.emp_id === LA);
      ok(r.users === 2 && ku && ku.leave && ku.leave.to === day(3) && la && la.limit_text === 'Rs 5,000' && la.limit_personal,
        `Supervisor (${r.users}): ${st.map((x) => `${x.name} (${JSON.stringify(x.godowns)}, ${x.limit_text}${x.limit_personal ? ' personal' : ''}${x.leave ? `, on leave to ${x.leave.to}` : ''})`).join('; ')}. Show / Hide people and keeping it open per role are the screen's (not checked here)`); }

    if (run('0.22')) { await fresh(); T('0.22', 'Save only after a change, Cancel to undo');
      const r = await api('SH', 'PUT', '/roles/32', { limit: { kind: 'amount', amount: '' } });
      const g = await api('SH', 'PUT', `/godowns/${K}`, { address: '' });
      ok(r.status === 400 && r.fields && /type 0/.test(r.fields.limit || '') && g.status === 400 && g.fields && g.fields.address,
        `empty default limit: ${r.status} under the field "${r.fields && r.fields.limit}"; Godown panel too: ${g.status} "${g.fields && g.fields.address}". Greyed Save, Cancel changes and the highlight are the screen's (not checked here)`); }

    if (run('0.23')) { await fresh(); T('0.23', 'Only an Admin changes Sub-admin; nobody changes Super admin or Admin');
      const sup = await api('SH', 'PUT', '/roles/8', { description: 'x' }); const adm = await api('SH', 'PUT', '/roles/1', { description: 'x' });
      const sub = await roleOf(2);
      const r = await api('SH', 'PUT', '/roles/2', { perms: { ...sub.perms, reports: { ...sub.perms.reports, export: false } } });
      const after = await roleOf(2);
      const au = await q1("SELECT audit_id FROM audit_log WHERE entity_type = 'role' AND entity_id = '2' AND emp_id = ? ORDER BY audit_id DESC LIMIT 1", [P.SH]);
      const an = await api('AN', 'PUT', '/roles/2', { perms: sub.perms }); const anView = await roleOf(2, 'AN');
      ok([403, 409].includes(sup.status) && adm.status === 409 && r.status === 200 && !r.data.waiting && !after.perms.reports.export && au && an.status === 403 && anView.lock,
        `Super admin ${sup.status} "${sup.msg}", Admin ${adm.status} "${adm.msg}"; Sub-admin untick Export on Reports by ${nm('SH')}: ${r.status}, saved at once, logged #${au && au.audit_id}; ${nm('AN')}: ${an.status} "${an.msg}" (ours: she has no Edit on Roles and users, and she holds Sub-admin), lock "${anView.lock}"`); }

    if (run('0.24')) { await fresh(); T('0.24', 'Sub-admin sees Foundation, view only');
      const v = await Promise.all(['/staff', '/roles', '/godowns', '/numbering', '/approval-rules', '/company'].map((p) => api('AN', 'GET', p)));
      const g1 = await api('AN', 'PUT', `/godowns/${K}`, { phone: '+91 77790 39666' });
      const sub = await roleOf(2);
      const give = await api('SH', 'PUT', '/roles/2', { perms: { ...sub.perms, users: { ...sub.perms.users, edit: true } } });
      const mu = await api('AN', 'PUT', `/staff/${P.MU}`, { limit: { kind: 'none' } });
      const sh = await api('AN', 'PUT', `/staff/${P.SH}`, { limit: { kind: 'none' } });
      const pv = await api('AN', 'PUT', `/staff/${P.PV}`, { limit: { kind: 'none' } });
      const self = await api('AN', 'PUT', `/staff/${P.AN}`, { limit: { kind: 'none' } });
      ok(v.slice(0, 5).every((x) => x.status === 200) && v[2].data.can_edit === false && v[3].data.can_edit === false && v[4].data.can_edit === false && v[5].status === 403 && g1.status === 403
        && give.status === 200 && mu.status === 200 && sh.status === 403 && pv.status === 403 && self.status === 403,
        `view: ${['Staff', 'Roles', 'Godowns', 'Numbering', 'Rules', 'Company'].map((n, i) => `${n} ${v[i].status}`).join(', ')} (Company: "${v[5].msg && v[5].msg.slice(0, 40)}..."), godown change ${g1.status}; Edit on Roles and users given (${give.status}); then Murugan ${mu.status}, Shoban ${sh.status} "${sh.msg}", Pavithran ${pv.status} "${pv.msg}", herself ${self.status} "${self.msg}"`); }

    if (run('0.25')) { await fresh(); await setup(); T('0.25', 'Each person sees only their own approvals');
      const ref = await ask('DV', 'refund', K, 3600, 'Scenario: refund Rs 3,600');
      const po = await ask('PV', 'po', K, 86400, 'Scenario: purchase order Rs 86,400');
      await writeOff('KU', K, 'DF024-R1', 31, 'Scenario: Kumar write-off');
      await ask('MU', 'prod_scrap', K, 800, 'Scenario: wastage Rs 800');
      await ask('DV', 'stock_count', C, 740, 'Scenario: count fix Rs 740');
      const dv = await pend('DV'); const dvMine = (await mine('DV')).filter((r) => r.status === 'pending');
      const an = await pend('AN'); const nav = (await api('AN', 'GET', '/nav-counts')).data;
      const anCan = an.filter((r) => r.can_decide); const poRow = an.find((r) => r.approval_id === po);
      const all = Number((await q1("SELECT COUNT(*) n FROM approvals WHERE status = 'pending'")).n);
      ok(!dv.some((r) => r.can_decide) && dv.every((r) => r.mine) && dvMine.length === 2 && dvMine.some((r) => r.approval_id === ref) && an.length === all && anCan.length === nav.approvals && poRow && !poRow.can_decide,
        `${nm('DV')}: Waiting for you ${dv.filter((r) => r.can_decide).length}, Raised by you ${dvMine.map((r) => `#${r.approval_id} ${r.kind} Rs ${r.amount}`).join(', ')} (v23 1: she raised the count fix too here), sees ${dv.length} of ${all} waiting; ${nm('AN')}: sees ${an.length}, Waiting for you ${anCan.length} (menu ${nav.approvals}), PO Rs 86,400 under Everything else: "${poRow && poRow.why_not}"`); }

    if (run('0.26')) { await fresh(); T('0.26', 'Every message shows where you are looking');
      const S = (await api('SH', 'GET', '/numbering')).data.series;
      const last = S[S.length - 1];
      const t = await api('SH', 'POST', `/numbering/${last.doc_key}/issue`, {});
      const g = await api('SH', 'PUT', `/godowns/${K}`, { address: '' });
      ok(t.status === 200 && /issued/.test(t.data.message) && g.status === 400 && g.fields && g.fields.address,
        `Test: use next number on ${last.label}: "${t.data && t.data.message}"; Kanchipuram with Address line 1 empty: ${g.status}, field address "${g.fields && g.fields.address}". Where the message shows and its colours are the screen's (not checked here)`); }

    if (run('0.27')) { await fresh(); await setup(); await supOverWarehouse(); T('0.27', 'Nobody edits a role they hold');
      const sv = await roleOf(32);
      const give = await api('SH', 'PUT', '/roles/32', { perms: { ...sv.perms, users: { ...sv.perms.users, edit: true } } });
      const own = await api(LA, 'PUT', '/roles/32', { description: 'mine' });
      const wh = await roleOf(5, LA);
      const tick = await api(LA, 'PUT', '/roles/5', { perms: { ...wh.perms, invoicing: { view: true, approve: true } } });
      const lim = await api(LA, 'PUT', '/roles/5', { limit: { kind: 'amount', amount: '900000' } });
      ok(give.status === 200 && own.status === 403 && /role they hold/.test(own.msg || '') && tick.status === 403 && /Invoicing/.test(tick.msg || '') && lim.status === 403 && /5,000/.test(lim.msg || ''),
        `Supervisor gets Edit on Roles and users (${give.status}); ${nm(LA)} on Supervisor: ${own.status} "${own.msg}"; on Warehouse, Approve on Invoicing (v23 Payments; the dev Supervisor role has Approve on Payments, not on Invoicing): ${tick.status} "${tick.msg}"; limit 900000: ${lim.status} "${lim.msg}"`); }

    if (run('0.28')) { await fresh(); await setup(); await supOverWarehouse(); T('0.28', 'Nobody gives more than they have');
      const sv = await roleOf(32);
      await api('SH', 'PUT', '/roles/32', { perms: { ...sv.perms, users: { ...sv.perms.users, edit: true } } });
      const e = await newEmployee();
      const add = await api('SH', 'POST', '/users', { emp_id: e.emp_id, role_id: 5 });
      await api('SH', 'PUT', `/staff/${e.emp_id}`, { godowns: [C] });
      const big = await api(LA, 'PUT', `/staff/${e.emp_id}`, { limit: { kind: 'amount', amount: '50000' } });
      const small = await api(LA, 'PUT', `/staff/${e.emp_id}`, { limit: { kind: 'amount', amount: '4000' } });
      const ppl = await approvals.people(pool); const me = ppl.find((x) => x.emp_id === LA);
      const offered = [];
      for (const r of await roles()) if (!(await foundation.roleGiveProblem(pool, me, r.role_id))) offered.push(r.name);
      const all = await api(LA, 'PUT', `/staff/${e.emp_id}`, { godowns: 'ALL' }); const kg = await api(LA, 'PUT', `/staff/${e.emp_id}`, { godowns: [K] });
      ok(add.status === 201 && big.status === 403 && /5,000/.test(big.msg || '') && small.status === 200 && offered.includes('Supervisor') && offered.includes('Warehouse') && !offered.includes('Sales') && !offered.includes('Sub-admin') && all.status === 403 && kg.status === 403,
        `Selvi R = ${e.name} ${e.emp_id}, Warehouse at Chennai; ${nm(LA)}: 50000 ${big.status} "${big.msg}"; 4000 ${small.status} ${(small.data && small.data.waiting || []).join(' ') || 'saved'} (ours: a higher limit waits for a second Admin); roles she may give: ${offered.join(', ')} (Delivery is not: the dev Supervisor role has no Delivery rights); Every godown ${all.status}, Kanchipuram ${kg.status} "${kg.msg}"`); }

    if (run('0.29')) { await fresh(); T('0.29', 'Approval rules and switches are Admin only');
      const sv = await roleOf(32);
      await api('SH', 'PUT', '/roles/32', { perms: { ...sv.perms, users: { ...sv.perms.users, edit: true } } });
      const la = await api(LA, 'GET', '/approval-rules'); const laSw = await api(LA, 'GET', '/switches'); const laPut = await api(LA, 'PUT', '/approval-rules/refund', { limit_value: '1000' });
      const an = await api('AN', 'GET', '/approval-rules'); const anSw = await api('AN', 'GET', '/switches');
      const anPut = await api('AN', 'PUT', '/approval-rules/refund', { limit_value: '1000' }); const anSwPut = await api('AN', 'PUT', '/commerce-settings/split_days', { value: '5' });
      const sh = await api('SH', 'GET', '/approval-rules'); const pv = await api('PV', 'GET', '/switches');
      ok(la.status === 200 && !la.data.can_edit && laPut.status === 403 && an.status === 200 && !an.data.can_edit && anSw.status === 200 && !anSw.data.can_edit && anPut.status === 403 && anSwPut.status === 403 && sh.data.can_edit && pv.data.can_edit,
        `${nm(LA)}: rules ${la.status} can_edit ${la.data && la.data.can_edit}, change ${laPut.status}, switches ${laSw.status} (no View on Settings for the dev Supervisor role, so not even view only); ${nm('AN')}: rules ${an.status} can_edit ${an.data.can_edit}, switches can_edit ${anSw.data && anSw.data.can_edit}, changes ${anPut.status} / ${anSwPut.status} "${anSwPut.msg}"; Shoban rules can_edit ${sh.data.can_edit}, Pavithran switches can_edit ${pv.data.can_edit}`); }

    if (run('0.30')) { await fresh(); T('0.30', 'A new godown gets its own code in every number');
      const g = await api('SH', 'POST', '/godowns', godownBody({ code: 'T', name: 'Tiruvallur godown' }));
      const S = (await api('SH', 'GET', '/numbering')).data.series;
      const inv = S.find((x) => x.doc_key === 'invoice').runs; const cr = S.find((x) => x.doc_key === 'credit').runs;
      const t = inv.find((x) => x.code === 'T'); const k = inv.find((x) => x.code === 'K');
      ok(g.status === 201 && /DFI\/T\/\d\d-\d\d\/0001/.test(g.data.message) && t && /^DFI\/T\//.test(t.no) && cr.some((x) => /^DFC\/T\//.test(x.no)) && /^DFI\/\d\d/.test(k.no),
        `"${g.data && g.data.message.split('.').slice(0, 2).join('.')}"; Numbering: ${t && t.no}, ${(cr.find((x) => x.code === 'T') || {}).no}, Kanchipuram ${k.no}`); }

    if (run('0.31')) { await fresh(); await setup(); T('0.31', 'A stand-in must already hold the absent person\'s powers');
      const L = (await api('SH', 'GET', `/staff/${P.KU}/stand-ins`)).data;
      const p = (e) => L.find((x) => x.emp_id === id(e));
      const no = ['MU', 'DV', 'RA'].filter((e) => p(e) && p(e).problem); const yes = [LA, 'AN', 'PV', 'SH'].filter((e) => p(e) && !p(e).problem);
      ok(no.length === 3 && yes.length === 4,
        `cannot stand in: ${['MU', 'DV', 'RA'].map((e) => `${nm(e)} "${p(e) && p(e).problem}"`).join('; ')}; can: ${yes.map(nm).join(', ')}`); }

    if (run('0.32')) { await fresh(); await setup(); T('0.32', 'Someone on leave signs nothing, and two people cannot cover each other');
      const r = await api('SH', 'PUT', `/staff/${LA}`, { leave: { from: day(0), to: day(1), stand_in: P.PV } });
      const L = (await api('SH', 'GET', `/staff/${LA}/stand-ins?from=${day(0)}&to=${day(1)}`)).data;
      const ku = L.find((x) => x.emp_id === P.KU);
      await writeOff('MU', K, 'DF024-R1', 13, 'Scenario: small Kanchipuram write-off');
      const p = await pend('KU');
      ok(r.status === 400 && /standing in for/.test(r.msg || '') && ku && ku.problem && !p.some((x) => x.can_decide),
        `Lakshmi leave ${day(0)} to ${day(1)}: ${r.status} "${r.msg}"; Kumar in her list: "${ku && ku.problem}"; ${nm('KU')} on leave: Waiting for you ${p.filter((x) => x.can_decide).length}`); }

    if (run('0.33')) { await fresh(); await setup(); T('0.33', 'Splitting a request does not beat a limit');
      const one = await writeOff('MU', K, 'DF024-R1', 11, 'Scenario: split 1');
      const la1 = await rowOf(LA, one.data.approval_id);
      const two = await writeOff('MU', K, 'DF024-R1', 11, 'Scenario: split 2'); const three = await writeOff('MU', K, 'DF024-R1', 11, 'Scenario: split 3');
      const ids = [one, two, three].map((x) => x.data.approval_id);
      const sh = await pend('SH'); const cards = ids.map((i) => sh.find((x) => x.approval_id === i));
      const la = await pend(LA);
      ok(la1 && la1.can_decide && cards.every((c) => c && /Counts together with 2 other/.test(c.split_note) && c.signers[0].emp_id === P.AN) && !ids.some((i) => la.find((x) => x.approval_id === i && x.can_decide)),
        `3 x 11 packs (Rs ${one.data.value} each; v23 Rs 1,400): alone the first was ${nm(LA)}'s (for Kumar): ${la1 && la1.can_decide}; each card "${cards[0] && cards[0].split_note}", first on the ladder ${cards[0] && cards[0].signers[0] && cards[0].signers[0].name}; Lakshmi can sign none: ${!ids.some((i) => la.find((x) => x.approval_id === i && x.can_decide))}`); }

    if (run('0.34')) { await fresh(); await setup(); T('0.34', 'Leaving hands everything over');
      await pool.query('UPDATE locations SET in_charge = ? WHERE location_id = ?', [P.KU, K]);
      const own = await q1('SELECT (SELECT COUNT(*) FROM customers WHERE owner_emp_id = ?) n', [P.KU]);
      const extra = Number(own.n) ? { hand_over_to: P.PV } : {};
      const a = await api('SH', 'PUT', `/users/${P.KU}`, { is_active: 0, ...extra });
      const b = await api('SH', 'PUT', `/users/${P.KU}`, { is_active: 0, in_charge_to: LA, ...extra });
      const c = await api('SH', 'PUT', `/users/${P.KU}`, { is_active: 0, in_charge_to: P.PV, ...extra });
      const g = await q1('SELECT in_charge FROM locations WHERE location_id = ?', [K]);
      const kuRow = await q1('SELECT is_active, leave_from, stand_in FROM admin_users WHERE emp_id = ?', [P.KU]);
      const left = await qa('SELECT a.emp_id FROM admin_users a JOIN admin_users s ON s.emp_id = a.stand_in WHERE s.is_active = 0');
      const au = await q1("SELECT after_json FROM audit_log WHERE action = 'hand_over' AND entity_id = ? ORDER BY audit_id DESC LIMIT 1", [P.KU]);
      ok(a.status === 409 && /in charge/.test(a.msg || '') && b.status === 409 && /does not work at/.test(b.msg || '') && c.status === 200 && g.in_charge === P.PV && Number(kuRow.is_active) === 0 && !kuRow.leave_from && !kuRow.stand_in && left.length === 0 && au,
        `no choice: ${a.status} "${a.msg}"; Lakshmi (Chennai only): ${b.status} "${b.msg}"; Pavithran: ${c.status}; Kanchipuram in charge ${nm(g.in_charge)}; Kumar leave ${kuRow.leave_from || 'ended'}, stand-ins of people who left ${left.length}; audit ${au && JSON.stringify(au.after_json).slice(0, 120)}`); }

    if (run('0.35')) { await fresh(); T('0.35', 'A godown with stock, orders or staff cannot be closed');
      const f = await q1("SELECT (SELECT COALESCE(SUM(delta), 0) FROM stock_movements WHERE location_id = ?) packs, (SELECT COUNT(*) FROM orders WHERE godown_id = ? AND status NOT IN ('delivered', 'cancelled')) o", [C, C]);
      const a = await api('SH', 'PUT', `/godowns/${C}`, { is_active: 0 });
      const g = await api('SH', 'POST', '/godowns', godownBody({ code: 'T', name: 'Tiruvallur godown' }));
      const b = await api('SH', 'PUT', `/godowns/${g.data.godown_id}`, { is_active: 0 });
      ok(a.status === 409 && a.msg.includes(`${Number(f.packs)} packs`) && (Number(f.o) === 0 || a.msg.includes(`${f.o} open order`)) && a.msg.includes(LA) && b.status === 200 && b.data.is_active === false,
        `Chennai: ${a.status} "${a.msg}" (data: ${Number(f.packs)} packs, ${f.o} open orders; v23 also names open transfers, ours does not); new godown T closed: ${b.status} (the "asks first" is the screen's)`); }

    if (run('0.36')) { await fresh(); T('0.36', 'A GSTIN must match its state and the company PAN');
      await putTax({ pan: '' });
      const body = godownBody({ code: 'N', name: 'Bengaluru North godown', state: 'Karnataka' });
      const a = await api('SH', 'POST', '/godowns', { ...body, gstin: '33ABCDE1234F1Z5' });
      const b = await api('SH', 'POST', '/godowns', { ...body, gstin: '29ABCDE1234F1Z5' });
      const p = await putTax({ pan: 'ABCDE1234F' });
      const c = await api('SH', 'POST', '/godowns', { ...body, gstin: '29ZZZZZ9999Z1Z5' });
      const d = await api('SH', 'POST', '/godowns', { ...body, gstin: '29ABCDE1234F1Z5' });
      ok(a.status === 400 && /starts with 29/.test(a.fields.gstin) && b.status === 400 && /PAN first/.test(b.fields.gstin) && p.status === 200 && c.status === 400 && /not the company PAN/.test(c.fields.gstin) && d.status === 201,
        `(Bengaluru B is on dev already: code N) 33...: "${a.fields && a.fields.gstin}"; 29ABCDE without PAN: "${b.fields && b.fields.gstin}"; PAN saved ${p.status}; 29ZZZZZ: "${c.fields && c.fields.gstin}"; 29ABCDE: ${d.status} added`); }

    if (run('0.37')) { await fresh(); await setup(); T('0.37', 'Money leaving the company needs a second person');
      const R = (await api('SH', 'GET', '/approval-rules')).data.rules;
      const want = ['credit_no_return', 'cancel_invoice', 'supplier_pay', 'waive_bounce', 'petty_topup'];
      const there = want.filter((k) => R.some((x) => x.kind === k && x.is_on));
      const aid = await ask('DV', 'cancel_invoice', K, 1500, 'Scenario: cancel an invoice Rs 1,500');
      const r = await rowOf('SH', aid);
      const s = r ? r.signers.map((x) => x.emp_id) : [];
      ok(there.length === want.length && s[0] === P.AN && s.length === 3 && s.slice(1).sort().join() === [P.SH, P.PV].sort().join(),
        `rules on: ${there.map((k) => R.find((x) => x.kind === k).label).join('; ')} (supplier pay above Rs ${R.find((x) => x.kind === 'supplier_pay').limit_value}); cancel invoice #${aid} by ${nm('DV')}: ladder ${ladder(r)}`); }

    if (run('0.38')) { await fresh(); await setup(); T('0.38', 'Requests expire');
      const w = await writeOff('KU', K, 'DF024-R1', 31, 'Scenario: Kumar write-off');
      const other = await ask('DV', 'stock_count', C, 740, 'Scenario: count fix');
      await pool.query('UPDATE approvals SET requested_at = requested_at - INTERVAL 2 DAY WHERE approval_id IN (?, ?)', [w.data.approval_id, other]);
      const s = await api('SH', 'PUT', '/commerce-settings/approval_expiry_days', { value: '1' });
      const sh = await pend('SH');
      const st = await qa('SELECT approval_id, status FROM approvals WHERE approval_id IN (?, ?)', [w.data.approval_id, other]);
      const ku = (await mine('KU')).find((x) => x.approval_id === w.data.approval_id);
      const again = await api('KU', 'POST', `/approvals/${w.data.approval_id}/again`);
      const n = again.data ? await q1('SELECT status FROM approvals WHERE approval_id = ?', [again.data.approval_id]) : null;
      ok(s.status === 200 && st.every((x) => x.status === 'expired') && !sh.some((x) => [w.data.approval_id, other].includes(x.approval_id)) && ku && ku.can_send_again && again.status === 200 && n && n.status === 'pending',
        `expiry 7 to 1 day (${s.status}, tighter: saved at once); the two from ${day(-2)}: ${st.map((x) => `#${x.approval_id} ${x.status}`).join(', ')}, out of Waiting; ${nm('KU')}: Send again ${ku && ku.can_send_again} -> ${again.status} new #${again.data && again.data.approval_id} ${n && n.status}`); }

    if (run('0.39')) { await fresh(); T('0.39', 'A write-off needs approval by rupees or by packs');
      const a = await writeOff('MU', K, 'DF030-M200', 10, 'Scenario: 10 packs');
      const b = await writeOff('MU', K, 'DF016-R1', 25, 'Scenario: 25 packs');
      const card = b.data && b.data.approval_id ? await rowOf('SH', b.data.approval_id) : null;
      ok(a.data.status === 'posted' && b.data.status === 'pending' && card && /Counts together with 1 other/.test(card.split_note),
        `Rs ${a.data.value} and 10 packs: ${a.data.status} (under Rs 1,000 and 20 packs); Rs ${b.data.value} and 25 packs: ${b.data.status} ("${b.data.message}"); card "${card && card.split_note}" (v23 Rs 500 each)`); }

    if (run('0.40')) { await fresh(); T('0.40', 'Company is grouped in sections');
      const x = await putTax({ gstin: '', pan: '' });
      const c0 = (await api('SH', 'GET', '/company')).data;
      const y = await putTax({ gstin: '33ABCDE1234F1Z5', pan: 'ABCDE1234F' });
      const c1 = (await api('SH', 'GET', '/company')).data;
      const secs = ['profile', 'tax', 'address', 'banks', 'invoice', 'system'];
      ok(x.status === 200 && secs.every((k) => k in c0) && c0.missing.tax.length === 2 && y.status === 200 && c1.tax.gst_state === 'Tamil Nadu' && c1.tax.gst_state_code === '33' && c1.missing.tax.length === 0,
        `sections ${secs.filter((k) => k in c0).join(', ')}; missing with GSTIN and PAN empty: ${Object.entries(c0.missing).map(([k, v]) => `${k} ${v.length}`).join(', ')} (bank 0: the dev data has ${c0.banks.length} accounts); after the save GST state ${c1.tax.gst_state} (${c1.tax.gst_state_code}), tax missing ${c1.missing.tax.length}`); }

    if (run('0.41')) { await fresh(); T('0.41', 'Tax numbers are checked as they are typed');
      const a = await putTax({ tan: '12345', udyam: 'UDYAM-TN-2-123' });
      await ctx.setting('einvoice_mode', 'on'); // e-invoice is fixed off by the code (IRN not built): the stored value is set on for this check
      const b = await putTax({ gst_type: 'composition' });
      const e = await api('SH', 'PUT', '/commerce-settings/einvoice_mode', { value: 'off' }); await ctx.setting('einvoice_mode', 'off');
      const c = await putTax({ tan: 'CHEA12345B', udyam: 'UDYAM-TN-02-1234567', gst_type: 'regular' });
      const au = await q1("SELECT after_json FROM audit_log WHERE entity_type = 'company' AND entity_id = 'tax' ORDER BY audit_id DESC LIMIT 1");
      ok(a.status === 400 && a.fields.tan && a.fields.udyam && b.status === 400 && /composition/.test(b.fields.gst_type || '') && c.status === 200 && au && /CHEA12345B/.test(JSON.stringify(au.after_json)),
        `TAN / Udyam: "${a.fields && a.fields.tan}" / "${a.fields && a.fields.udyam}"; composition with e-invoice on: "${b.fields && b.fields.gst_type}"; e-invoice off on Switches: ${e.status} "${e.msg}" (read only, fixed off by the code; set back in the data); good values ${c.status} "${c.data && c.data.message}", audit ${JSON.stringify(au && au.after_json)}`); }

    if (run('0.42')) { await fresh(); T('0.42', 'A bank account is typed twice and checked');
      const a = await api('SH', 'POST', '/company/banks', { holder_name: 'Dolluz Corporation', bank_name: 'State Bank of India', account_no: '12345678911', account_no2: '12345678912', ifsc: 'SBIN001234', account_type: 'Current' });
      const b = await api('SH', 'POST', '/company/banks', { holder_name: 'Dolluz Corporation', bank_name: 'State Bank of India', account_no: '12345678911', account_no2: '12345678911', ifsc: 'SBIN0001234', account_type: 'Current', upi_id: 'dfresh@sbi' });
      const before = await q1("SELECT COUNT(*) n FROM company_bank_accounts WHERE account_no = '12345678911'");
      const d1 = b.data ? await decide('PV', b.data.approval_id) : { status: 0 };
      const nb = await q1("SELECT bank_id, is_default, upi_id FROM company_bank_accounts WHERE account_no = '12345678911'");
      const m = nb ? await api('SH', 'POST', `/company/banks/${nb.bank_id}/default`) : { status: 0 };
      const d2 = m.data ? await decide('PV', m.data.approval_id) : { status: 0 };
      const now = (await api('SH', 'GET', '/company')).data.banks.find((x) => nb && x.bank_id === nb.bank_id);
      const off = nb ? await api('SH', 'POST', `/company/banks/${nb.bank_id}/inactive`) : { status: 0 };
      const del = nb ? await api('SH', 'DELETE', `/company/banks/${nb.bank_id}`) : { status: 0 };
      const au = await qa("SELECT CONCAT(COALESCE(before_json, ''), COALESCE(after_json, '')) j FROM audit_log WHERE entity_type = 'company_bank'");
      const full = au.filter((x) => /12345678911|50200012345678/.test(x.j)).length;
      ok(a.status === 400 && a.fields.account_no2 && a.fields.ifsc && b.status === 201 && b.data.waiting && Number(before.n) === 0 && d1.status === 200 && nb && nb.upi_id === 'dfresh@sbi' && d2.status === 200 && now && now.is_default && /upi:\/\/pay\?pa=dfresh@sbi/.test(now.qr) && off.status === 409 && del.status === 404 && full === 0,
        `(the dev data already has SBI 12345678901 and HDFC as the default: a new SBI 12345678911) typo: "${a.fields && a.fields.account_no2}" / "${a.fields && a.fields.ifsc}"; then ${b.status} "${b.data && b.data.message}"; PV approves ${d1.status}; Make default waits, PV approves ${d2.status}: default ${now && now.is_default}, QR ${now && now.qr}; inactive on the default: ${off.status} "${off.msg}"; delete ${del.status}; audit rows with a full account number ${full} of ${au.length}`); }

    if (run('0.43')) { await fresh(); T('0.43', 'Invoice preferences warn when they cannot print');
      await pool.query("UPDATE company_bank_accounts SET status = 'inactive', is_default = 0"); // v23 starts with no bank account
      const c0 = (await api('SH', 'GET', '/company')).data.invoice;
      const r = await api('SH', 'PUT', '/company/invoice', { ...c0, copies: ['Triplicate'], signatory: 'Shoban B' });
      const r2 = await api('SH', 'PUT', '/company/invoice', { ...c0, copies: [], signatory: 'Shoban B' });
      const c1 = await q1('SELECT copies, signatory FROM company WHERE company_id = 1');
      ok(c0.warnings.length === 2 && r.status === 200 && r2.status === 200 && c1.copies === 'Original' && c1.signatory === 'Shoban B',
        `no approved bank: ${c0.warnings.join(' | ')}; Duplicate off, Triplicate on: ${r.status} (dev copies were already Original, Triplicate: "${r.data && r.data.message}"); nothing ticked: ${r2.status}, copies now ${c1.copies} (Original can never be unticked)`); }

    if (run('0.44')) { await fresh(); T('0.44', 'Logos and the signature are checked');
      const pdf = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
      const big = await noisePng(700, 700); const sig = await noisePng(450, 450);
      const small = await sharp({ create: { width: 300, height: 100, channels: 3, background: '#ffffff' } }).png().toBuffer();
      const lp = await multipart('SH', '/brand/wide', pdf, 'logo.pdf', 'application/pdf');
      const lb = await multipart('SH', '/brand/wide', big, 'logo.png', 'image/png');
      const sb = await multipart('SH', '/company/signature', sig, 'sign.png', 'image/png');
      const sp = await multipart('SH', '/company/signature', pdf, 'sign.pdf', 'application/pdf');
      const ss = await multipart('SH', '/company/signature', small, 'sign.png', 'image/png');
      const sd = await api('SH', 'DELETE', '/company/signature');
      ok(lp.status === 400 && lb.status >= 400 && sb.status === 413 && sp.status === 400 && ss.status === 200 && sd.status === 200,
        `wide logo PDF: ${lp.status} "${lp.msg}"; ${Math.round(big.length / 1024)} KB PNG: ${lb.status} "${lb.msg}"; signature ${Math.round(sig.length / 1024)} KB: ${sb.status} "${sb.msg}"; PDF: ${sp.status}; ${Math.round(small.length / 1024)} KB PNG: ${ss.status}; Remove ${sd.status} "${sd.data && sd.data.message}". Not run: a good wide logo upload writes into media/ (kept out of scenario runs); the "asks first" is the screen's`); }

    if (run('0.45')) { await fresh(); T('0.45', 'Staff come from dAdmin');
      const ku = await staffOf('KU');
      const e = await newEmployee();
      const add = await api('SH', 'POST', '/users', { emp_id: e.emp_id, role_id: 6 });
      const g = await api('SH', 'PUT', `/staff/${e.emp_id}`, { godowns: [K] });
      const s = await staffOf(e.emp_id);
      const again = (await api('SH', 'GET', `/users/employees?q=${e.emp_id}`)).data;
      const asNew = await api(e.emp_id, 'GET', '/approvals');
      ok(ku.dadmin && ku.dadmin.emp_id === P.KU && 'email' in ku.dadmin && 'phone' in ku.dadmin && add.status === 201 && g.status === 200 && s && s.active && s.last_login === null && JSON.stringify(s.godowns) === JSON.stringify([K]) && !again.some((x) => x.emp_id === e.emp_id) && asNew.status === 200,
        `Kumar from dAdmin: ${ku.dadmin && ku.dadmin.emp_id}, e-mail ${ku.dadmin && ku.dadmin.email ? 'set' : 'none'}, phone ${ku.dadmin && ku.dadmin.phone ? 'set' : 'none'}, last login ${ku.last_login || 'Never'}; added ${e.name} ${e.emp_id} as Sales at Kanchipuram: ${add.status}/${g.status}, last login ${s && s.last_login === null ? 'Never' : s && s.last_login}; offered again: ${again.some((x) => x.emp_id === e.emp_id)}; signed in as them: ${asNew.status}`); }

    if (run('0.46')) { await fresh(); await setup(); await supOverWarehouse(); T('0.46', 'Nobody gives access above themselves');
      const sv = await roleOf(32);
      const give = await api('SH', 'PUT', '/roles/32', { perms: { ...sv.perms, users: { ...sv.perms.users, edit: true, create: true } } });
      const e = await newEmployee();
      const sales = await api(LA, 'POST', '/users', { emp_id: e.emp_id, role_id: 6 });
      const sub = await api(LA, 'POST', '/users', { emp_id: e.emp_id, role_id: 2 });
      const wh = await api(LA, 'POST', '/users', { emp_id: e.emp_id, role_id: 5 });
      const s = await staffOf(e.emp_id);
      const all = await api(LA, 'PUT', `/staff/${e.emp_id}`, { godowns: 'ALL' });
      ok(give.status === 200 && sales.status === 403 && sub.status === 403 && wh.status === 201 && s && JSON.stringify(s.godowns) === JSON.stringify([C]) && all.status === 403,
        `Supervisor given Edit and Create on Roles and users (ours: Add staff needs Create); Priya S = ${e.name}: Sales ${sales.status} "${sales.msg}"; Sub-admin ${sub.status}; Warehouse ${wh.status}, works at ${JSON.stringify(s && s.godowns)} (Chennai, as Lakshmi); Every godown ${all.status} "${all.msg}"`); }

    if (run('0.47')) { await fresh(); T('0.47', 'A godown has an address, PIN and hours');
      await pool.query('UPDATE locations SET pin = NULL WHERE location_id = ?', [K]);
      const g0 = (await api('SH', 'GET', '/godowns')).data.godowns.find((x) => x.godown_id === K);
      const a = await api('SH', 'PUT', `/godowns/${K}`, { pin: '63150', close_time: '08:00' });
      const a2 = await api('SH', 'PUT', `/godowns/${K}`, { pin: '631501', close_time: '08:00' });
      const b = await api('SH', 'PUT', `/godowns/${K}`, { pin: '631501', close_time: '18:00', weekly_off: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] });
      const c = await api('SH', 'PUT', `/godowns/${K}`, { pin: '631501', close_time: '18:00', weekly_off: ['Sun'] });
      const g = (await api('SH', 'GET', '/godowns')).data.godowns.find((x) => x.godown_id === K);
      ok(g0.pin_missing && a.status === 400 && a.fields.pin && a2.status === 400 && a2.fields.close_time && b.status === 400 && /every day/.test(b.msg) && c.status === 200 && g.hours_text === '09:00 to 18:00, closed Sun' && !g.pin_missing,
        `PIN to add before: ${g0.pin_missing}; PIN 63150: "${a.fields && a.fields.pin}"; closes 08:00: "${a2.fields && a2.fields.close_time}" (one field at a time); every day off: "${b.msg}"; then ${c.status}: "${g.hours_text}", PIN ${g.pin}, flag ${g.pin_missing}`); }

    if (run('0.48')) { await fresh(); T('0.48', 'The audit log filters by date and exports');
      await api('SH', 'PUT', `/godowns/${C}`, { phone: '+91 77790 39666' });
      await api('SH', 'PUT', '/commerce-settings/expiry_warn_days', { value: '45' });
      const d = today();
      const L = (await api('SH', 'GET', `/audit?from=${d}&to=${d}&limit=200`)).data;
      const r = await raw('SH', 'GET', `/audit/export.csv?from=${d}&to=${d}`);
      const body = await r.text();
      const disp = r.headers.get('content-disposition') || '';
      const ex = await q1("SELECT after_json FROM audit_log WHERE action = 'export' AND entity_type = 'audit_log' ORDER BY audit_id DESC LIMIT 1");
      const an = (await api('AN', 'GET', `/audit?from=${d}&to=${d}`)).data; const anEx = await raw('AN', 'GET', `/audit/export.csv?from=${d}&to=${d}`);
      const pv = (await api('PV', 'GET', `/audit?from=${d}&to=${d}`)).data;
      ok(L.total >= 2 && r.status === 200 && csvRecords(body) - 1 === L.total && disp.includes(`dfresh-audit-log-${d}.csv`) && ex && an.rows && !an.can_export && anEx.status === 403 && pv.can_export,
        `(v23 uses 2026-10-28; ours today ${d}) ${L.total} rows today; export ${r.status} ${disp.replace(/^.*filename=/, '')}, ${csvRecords(body) - 1} rows, logged ${JSON.stringify(ex && ex.after_json)}; ${nm('AN')}: date filter ${an.rows ? 'yes' : 'no'}, export ${anEx.status}, can_export ${an.can_export}; ${nm('PV')} can_export ${pv.can_export}`); }

    if (run('0.49')) { await fresh(); T('0.49', 'Switches are grouped like Company');
      const S = (await api('SH', 'GET', '/switches')).data;
      const byG = Object.fromEntries(S.groups.map((g) => [g, S.switches.filter((s) => s.group === g).map((s) => s.key)]));
      const credit = S.switches.find((s) => /credit/i.test(`${s.label} ${s.about}`) && s.group === 'Money');
      ok(['Turn on', 'Stock', 'Orders', 'Money', 'Returns', 'Approvals'].every((g) => byG[g] && byG[g].length) && S.switches.every((s) => S.groups.includes(s.group)),
        `groups: ${S.groups.map((g) => `${g} (${byG[g].length})`).join(', ')}`);
      ok(Boolean(credit), `v23 "Credit sales allowed" switch in Money (Ctrl K "credit sales" opens it): ${credit ? credit.key : 'no such switch on our Switches page (Money has ' + byG.Money.join(', ') + ')'}`);
      if (credit) { // the switch works: off, no new order on credit and the form offers no credit; on again waits for a second Admin
        const off = await api('PV', 'PUT', `/commerce-settings/${credit.key}`, { value: '0' });
        const form = (await api('PV', 'GET', '/commerce/order-form')).data;
        const cr = await api('PV', 'POST', '/commerce/orders', { customer_id: 10, items: [{ sku_code: 'DF002-M100', qty: 12, price: '' }], payment_terms: 'credit' });
        const cod = await api('PV', 'POST', '/commerce/orders/preview', { customer_id: 10, items: [{ sku_code: 'DF002-M100', qty: 12, price: '' }], payment_terms: 'cod' });
        const on = await api('PV', 'PUT', `/commerce-settings/${credit.key}`, { value: '1' });
        ok(off.status === 200 && form && !form.terms.credit && cr.status === 400 && cod.status === 200 && on.status === 200 && Boolean(on.data && on.data.waiting) && on.data.value === '0',
          `off: ${off.status}; form terms ${form ? Object.keys(form.terms).join(', ') : '?'}; credit order ${cr.status} "${cr.msg}"; cash preview ${cod.status}; on again ${on.status} (still ${on.data && on.data.value}) "${on.data && on.data.waiting}"`);
      } }

    if (run('0.50')) { await fresh(); T('0.50', 'Four levels: Super admin, Admin, Sub-admin, then the rest');
      const st = (await staff()).staff; const rl = (e) => (st.find((x) => x.emp_id === P[e]) || {}).role_name;
      const R = await roles(); const r8 = R.find((x) => x.role_id === 8); const r1 = R.find((x) => x.role_id === 1); const r2 = R.find((x) => x.role_id === 2);
      const subSet = r2.perms.settings; const subUsers = r2.perms.users;
      const co = await api('PV', 'GET', '/company'); const ru = await api('PV', 'GET', '/approval-rules'); const sw = await api('PV', 'GET', '/switches'); const au = await api('PV', 'GET', '/audit');
      ok(rl('SH') === 'Super admin' && rl('PV') === 'Admin' && rl('AN') === 'Sub-admin' && r8.grid_fixed && r1.grid_fixed && r8.lock && r1.lock && subSet.view && !subSet.edit && subUsers.view && !subUsers.edit
        && co.status === 200 && co.data.can_edit && ru.data.can_edit && sw.data.can_edit && au.data.can_export,
        `Staff: ${nm('SH')} ${rl('SH')}, ${nm('PV')} ${rl('PV')}, ${nm('AN')} ${rl('AN')}; Super admin / Admin fixed and locked ("${r1.lock}"); Sub-admin Settings and Roles view only; Pavithran: Company ${co.status} can_edit ${co.data && co.data.can_edit}, rules ${ru.data.can_edit}, switches ${sw.data.can_edit}, audit export ${au.data.can_export}`); }

    if (run('0.51')) { await fresh(); T('0.51', 'Only the Super admin changes an Admin');
      const st = (await staff('PV')).staff; const lk = (e) => (st.find((x) => x.emp_id === P[e]) || {}).locked;
      const ppl = await approvals.people(pool); const pv = ppl.find((x) => x.emp_id === P.PV); const sh = ppl.find((x) => x.emp_id === P.SH);
      const gives = async (me) => { const o = []; for (const r of await roles()) if (!(await foundation.roleGiveProblem(pool, me, r.role_id))) o.push(r.name); return o; };
      const pvG = await gives(pv); const shG = await gives(sh);
      const shPv = (await staff('SH')).staff.find((x) => x.emp_id === P.PV).locked;
      const tryPv = await api('PV', 'PUT', `/staff/${P.SH}`, { limit: { kind: 'none' } });
      ok(lk('SH') && lk('PV') && !lk('AN') && pvG.includes('Sub-admin') && !pvG.includes('Admin') && !pvG.includes('Super admin') && !shPv && shG.includes('Admin') && shG.includes('Sub-admin') && !shG.includes('Super admin') && tryPv.status === 403,
        `as Pavithran: Shoban "${lk('SH')}", himself "${lk('PV')}", Anitha ${lk('AN') || 'open'}; his role list: ${pvG.join(', ')}; Shoban's: ${shG.join(', ')}; Shoban on Pavithran: ${shPv || 'open'}; Pavithran changing Shoban: ${tryPv.status}`); }

    if (run('0.52')) { await fresh(); await setup(); T('0.52', 'Admin signs anything, like the Super admin');
      const aid = await ask('DV', 'refund', C, 30000, 'Scenario: refund Rs 30,000 at Chennai');
      const pv = await rowOf('PV', aid); const an = await rowOf('AN', aid);
      const d = await decide('PV', aid);
      const s = pv ? pv.signers.map((x) => x.emp_id) : [];
      ok(s.length === 2 && s.includes(P.SH) && s.includes(P.PV) && !s.includes(P.AN) && pv.can_decide && d.status === 200 && an && !an.can_decide,
        `refund #${aid} Rs 30,000: ladder ${ladder(pv)}; ${nm('PV')} can decide ${pv && pv.can_decide}, Approve ${d.status}; ${nm('AN')} under Everything else: "${an && an.why_not}"`); }

    say('done');
  },
};
