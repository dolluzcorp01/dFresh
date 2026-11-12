// Section 17 - Expenses and accounting export: the v23 Tests tab "17" and the fix items Y1 (the running month is not
// exported), T2 (approvals after export), Y6 (a transporter's freight bill spread over the PO's goods in, part bills
// too) and L1 (payees keyed on PAN, approved once, look-alikes refused). Our data stands in for v23's: the dev data
// has no expenses, so each test records what it needs. Run: npm run scenarios -- 17
module.exports = {
  title: 'Expenses and accounting export',
  async run(ctx) {
    const { api, upload, ok, say, q1, qa, decide, decideAny, pendingOf, T, fresh, run, r2, pool, today } = ctx;
    const G = 1; // Kanchipuram
    const m0 = today().slice(0, 7);
    const prev = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
    const lastM = prev(m0);
    const exp = (b, as = 'SH') => upload(as, '/money/expenses', { date: today(), godown_id: G, mode: 'bank', gst_rate: 0, ...b });
    const box = async (g = G) => (await api('SH', 'GET', '/money/petty')).data.boxes.find((x) => x.godown_id === g);
    const float = (amt = 5000, g = G) => api('PV', 'POST', `/money/petty/${g}/float`, { float: amt });
    const payee = async (name, gstin, head = 'office', amt = 100) => { // a payee on the list (its first expense signed)
      const r = await exp({ head_key: head, payee: name, new_payee: 1, amount: amt, gst_rate: 0, gstin: gstin || '', reference: 'SETUP01' });
      for (const id of (r.data && r.data.approval_ids) || []) await decideAny(id);
      return r;
    };

    if (run('17.1')) { await fresh(); T('17.1', 'Expenses, petty cash and the CA at the start');
      const e = await api('SH', 'GET', '/money/expenses'); const p = await api('SH', 'GET', '/money/petty'); const a = await api('SH', 'GET', '/money/accounting'); const hi = await api('SH', 'GET', '/money/accounting-history');
      ok(e.status === 200 && p.status === 200 && a.status === 200 && hi.status === 200,
        `Expenses: recorded ${e.data.counts.recorded}, spent this month ${e.data.stats.spent}, heads ${e.data.heads.length} (${e.data.heads.filter((h) => !h.itc).map((h) => h.name).join(', ')} "GST not claimable"); petty boxes ${p.data.boxes.map((b) => `${b.name} ${b.float === null ? 'no box yet' : b.balance}`).join(', ')}; Export: ${a.data.month}, ${a.data.vouchers.length} vouchers, ${a.data.ok ? 'ready' : `fix first: ${a.data.issues[0]}`}; history ${hi.data.months.length} months`); }

    if (run('17.2')) { await fresh(); T('17.2', 'Record an expense from petty cash (and payees, v23 L1)');
      await float(5000);
      const e0 = await exp({});
      const x = await exp({ payee: 'x', head_key: 'office', amount: 10, reference: 'X1' });
      const r = await exp({ head_key: 'office', payee: 'Sri Lakshmi Stationers', new_payee: 1, amount: 1200, gst_rate: 18, gstin: '33abcde1234f1z5', mode: 'petty' });
      if (r.status >= 300) say('expense:', r.status, r.msg, JSON.stringify(r.fields));
      const b1 = await box();
      const waitP = await pendingOf('payee_new', r.data && r.data.expense_no);
      await decideAny(waitP.approval_id);
      const d = (await api('SH', 'GET', `/money/expenses/${encodeURIComponent(r.data.expense_no)}`)).data;
      const b2 = await box();
      ok(e0.status === 400 && e0.fields && e0.fields.head_key && e0.fields.amount && x.status === 400 && r.status === 201 && r.data.status === 'waiting' && d.status === 'done' && d.itc && r2(b1.free) === r2(5000 - 1416) && r2(b2.balance) === r2(5000 - 1416),
        `nothing filled: ${Object.keys(e0.fields || {}).join(', ')}; "x": "${x.fields && x.fields.payee}"; ${r.data.expense_no} total ${r.data.total} (GST 216, claimed ${d.itc}): "${r.data.message}"; free petty while it waits ${b1.free}; after the payee is signed: ${d.status_label}, box ${b2.balance}`);
      const like = await exp({ head_key: 'office', payee: 'Sri Laksmi Stationer', new_payee: 1, amount: 100, reference: 'L1TEST' });
      const pan = await exp({ head_key: 'office', payee: 'Lakshmi Paper House', new_payee: 1, amount: 100, gstin: '33ABCDE1234F1Z5', reference: 'L1TEST2' });
      const same = await exp({ head_key: 'office', payee: 'sri lakshmi stationers', amount: 100, reference: 'L1TEST3' });
      ok(like.status === 400 && /Looks like "Sri Lakshmi Stationers"/.test(like.fields.payee) && pan.status === 400 && /PAN/.test(pan.fields.payee) && same.status === 201 && same.data.status === 'done',
        `look-alike: "${like.fields && like.fields.payee}"; same PAN, other name: "${pan.fields && pan.fields.payee}"; the same name again: ${same.data && same.data.status} (approved once)`); }

    if (run('17.3')) { await fresh(); T('17.3', 'A big expense needs a second person');
      await payee('Dinamalar ads');
      const r = await exp({ head_key: 'marketing', payee: 'Dinamalar ads', amount: 15000, mode: 'bank', reference: 'HDFC00944512' });
      const a = await pendingOf('expense', r.data.expense_no);
      const self = await decide('SH', a.approval_id);
      await decideAny(a.approval_id);
      const d = (await api('SH', 'GET', `/money/expenses/${encodeURIComponent(r.data.expense_no)}`)).data;
      ok(r.data.status === 'waiting' && /Expense above the limit/.test(r.data.message) && self.status === 403 && d.status === 'done', `"${r.data.message}"; the maker signs it: ${self.status}; after a second person: ${d.status_label}`); }

    if (run('17.4')) { await fresh(); T('17.4', 'A month with the CA is locked (v23 Y1 / T2)');
      await payee('Murugan Estates', '33AAKFM2231L1ZQ', 'rent', 50);
      const r = await exp({ date: `${lastM}-05`, head_key: 'rent', payee: 'Murugan Estates', amount: 4500, gst_rate: 18, gstin: '33AAKFM2231L1ZQ', reference: 'HDFC00918821' });
      for (const id of r.data.approval_ids || []) await decideAny(id);
      for (const x of await qa("SELECT approval_id FROM approvals WHERE status = 'pending' AND DATE_FORMAT(record_date, '%Y-%m') = ?", [lastM])) await decideAny(x.approval_id);
      const exM = await api('SH', 'POST', `/money/accounting/${lastM}/export`);
      if (exM.status !== 200) say('export:', exM.status, exM.msg);
      const c1 = await api('SH', 'POST', `/money/expenses/${encodeURIComponent(r.data.expense_no)}/cancel`, { reason: 'Duplicate entry' });
      const a = await pendingOf('after_export');
      await decideAny(a.approval_id);
      const c2 = await api('SH', 'POST', `/money/expenses/${encodeURIComponent(r.data.expense_no)}/cancel`, { reason: 'Duplicate entry' });
      const hi = (await api('SH', 'GET', '/money/accounting-history')).data;
      const old = await exp({ date: `${lastM}-10`, head_key: 'rent', payee: 'Murugan Estates', amount: 100, reference: 'OLDDATE1' });
      ok(exM.status === 200 && c1.status === 409 && /exported to the CA and locked/.test(c1.msg) && c2.status === 200 && hi.events.some((x) => x.kind === 'unlock') && old.status === 400 && /exported to the CA/.test(old.fields.date),
        `export ${lastM}: ${exM.status}; cancel: "${c1.msg}"; after approval: "${c2.data && c2.data.message}"; history: "${(hi.events.find((x) => x.kind === 'unlock') || {}).label}"; a ${lastM} date: "${old.fields && old.fields.date}"`); }

    if (run('17.5')) { await fresh(); T('17.5', 'Repeating expenses make drafts');
      await payee('Staff salaries', '', 'salary', 50);
      const y = new Date(Date.parse(`${today()}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);
      const rp = await api('SH', 'POST', '/money/expense-repeats', { head_key: 'salary', payee: 'Staff salaries', amount: 186000, gst_rate: 0, mode: 'bank', godown_id: G, day_of_month: Number(y.slice(8, 10)), next_date: y });
      const mk = await api('SH', 'POST', '/money/expenses-drafts');
      const no = mk.data.made[0] && mk.data.made[0].expense_no;
      const dr = (await api('SH', 'GET', `/money/expenses/${encodeURIComponent(no)}`)).data;
      const sv = await upload('SH', `/money/expenses/${encodeURIComponent(no)}/save`, { date: dr.date, godown_id: G, head_key: 'salary', payee: 'Staff salaries', amount: 186000, gst_rate: 0, mode: 'bank', reference: 'HDFC00955001' });
      for (const id of sv.data.approval_ids || []) await decideAny(id);
      const d2 = (await api('SH', 'GET', `/money/expenses/${encodeURIComponent(no)}`)).data;
      const rep = (await api('SH', 'GET', '/money/expense-repeats')).data.find((x) => x.code === rp.data.code);
      ok(rp.status === 201 && mk.data.made.length === 1 && dr.status === 'draft' && dr.repeat === rp.data.code && sv.data.status === 'waiting' && d2.status === 'done' && rep.next_date > y,
        `"${mk.data.message}", ${dr.total}, "Made from repeating expense ${dr.repeat}"; saved: "${sv.data.message}"; after approval ${d2.status_label}; ${rep.code} moves to ${rep.next_date}`); }

    if (run('17.6')) { await fresh(); T('17.6', 'Export a month to Tally (v23 Y1 running month, T2 after export)');
      const run1 = await api('SH', 'POST', `/money/accounting/${m0}/export`);
      await payee('Indian Oil', '', 'fuel', 50);
      const dr = await pool.query("INSERT INTO expenses (expense_no, exp_date, godown_id, head_key, payee_name, amount, total, mode, status, created_by) VALUES ('DFX/TEST/0001', ?, 1, 'fuel', 'Indian Oil', 500, 500, 'cash', 'draft', 'DZIND002')", [`${lastM}-12`]);
      const a0 = (await api('SH', 'GET', `/money/accounting?month=${lastM}`)).data;
      await pool.query("DELETE FROM expenses WHERE expense_no = 'DFX/TEST/0001'"); void dr;
      for (const x of await qa("SELECT approval_id FROM approvals WHERE status = 'pending' AND DATE_FORMAT(record_date, '%Y-%m') = ?", [lastM])) await decideAny(x.approval_id);
      const a1 = (await api('SH', 'GET', `/money/accounting?month=${lastM}`)).data;
      const ex = await api('SH', 'POST', `/money/accounting/${lastM}/export`);
      const xml = await fetch(`${ctx.base}/money/accounting/${lastM}/xml`, { headers: { Cookie: ctx.cookie('SH') } }); const xt = await xml.text();
      const csv = await fetch(`${ctx.base}/money/accounting/${lastM}/csv`, { headers: { Cookie: ctx.cookie('SH') } }); const ct = await csv.text();
      const bal = (xt.match(/<VOUCHER /g) || []).length;
      ok(run1.status === 409 && /still running/.test(run1.msg) && !a0.ok && a0.issues.some((x) => /draft or waiting/.test(x)) && a1.ok && ex.status === 200 && bal === ex.data.vouchers && /^﻿?Action,Voucher type/.test(ct),
        `${m0}: "${run1.msg}"; with a draft: "${a0.issues.find((x) => /draft/.test(x))}"; then "${a1.ok ? 'Ready' : a1.issues.join(' ')}", ${a1.vouchers.length} vouchers (${Object.entries(a1.counts).map(([k, v]) => `${v} ${k}`).join(', ')}); exported ${ex.data.xml_name} (${bal} VOUCHER elements) and ${ex.data.csv_name} (${ct.trim().split(/\r?\n/).length - 1} lines)`);
      // T2: a request dated in the exported month cannot be signed afterwards (an expense asked before, dated in it)
      await payee('Dinamalar ads');
      const big = await exp({ head_key: 'marketing', payee: 'Dinamalar ads', amount: 15000, reference: 'HDFC00944512' });
      const ap = await pendingOf('expense', big.data.expense_no);
      await pool.query('UPDATE approvals SET record_date = ? WHERE approval_id = ?', [`${lastM}-20`, ap.approval_id]);
      await pool.query('UPDATE expenses SET exp_date = ? WHERE expense_no = ?', [`${lastM}-20`, big.data.expense_no]);
      const late = await decide('AN', ap.approval_id); const late2 = late.status === 200 || /limit/.test(late.msg || '') ? await decide('PV', ap.approval_id) : late;
      const st = await q1('SELECT status FROM expenses WHERE expense_no = ?', [big.data.expense_no]);
      ok(late2.status >= 400 && st.status === 'waiting', `a request dated ${lastM}-20 signed after the export: ${late2.status} "${late2.msg}"; the expense stays ${st.status}`);
      const unbal = (await api('SH', 'GET', `/money/accounting?month=${lastM}`)).data.vouchers.filter((v) => Math.abs(v.debit - v.credit) > 0.004);
      ok(!unbal.length, `every voucher balances (debit = credit): ${unbal.length ? unbal.map((v) => v.no).join(', ') : 'all'}`); }

    if (run('17.7')) { await fresh(); T('17.7', 'Ledger names for the CA');
      const empty = await api('SH', 'PUT', '/money/accounting/ledgers', { ledgers: { bank: ' ' } });
      const s = await api('SH', 'PUT', '/money/accounting/ledgers', { ledgers: { bank: 'HDFC Bank 0412' } });
      const v = (await api('SH', 'GET', `/money/accounting?month=${lastM}`)).data;
      const uses = v.vouchers.filter((x) => x.ledgers.includes('HDFC Bank 0412')).length;
      ok(empty.status === 400 && s.status === 200 && uses > 0, `empty name: "${empty.msg}"; saved: "${s.data && s.data.message}"; ${uses} voucher(s) of ${lastM} now use "HDFC Bank 0412"`); }

    if (run('17.8')) { await fresh(); T('17.8', 'Petty cash top-up and count');
      await float(5000, 1); await float(5000, 2);
      await payee('Sri Ganesh Motors', '33ABCPG7781R1ZK', 'vehicle', 50);
      await exp({ head_key: 'vehicle', payee: 'Sri Ganesh Motors', amount: 2600, gst_rate: 18, gstin: '33ABCPG7781R1ZK', mode: 'petty' });
      const b0 = await box(1);
      const t = await api('SH', 'POST', '/money/petty/1/topup', { amount: String(Math.round(5000 - b0.balance)) });
      const a = await pendingOf('petty_topup'); await decideAny(a.approval_id);
      const b1 = await box(1);
      const c = await api('SH', 'POST', '/money/petty/2/count', { counted: 4750 });
      ok(t.data.waiting && b1.balance === 5000 && c.data.difference === -250 && c.data.alert, `Kanchipuram ${b0.balance}: top-up "${t.data.message}", after approval ${b1.balance}; Chennai counted 4750: "${c.data.message}"`); }

    if (run('17.9')) { await fresh(); T('17.9', 'Expenses and profit in Reports');
      await payee('Murugan Estates', '33AAKFM2231L1ZQ', 'rent', 50);
      await payee('TANGEDCO', '', 'power', 50);
      for (const b of [{ head_key: 'rent', payee: 'Murugan Estates', amount: 45000, gst_rate: 18, gstin: '33AAKFM2231L1ZQ', reference: 'HDFC00931177' }, { head_key: 'power', payee: 'TANGEDCO', amount: 8420, mode: 'upi', reference: 'UPI628811920' }]) {
        const r = await exp(b); for (const id of (r.data && r.data.approval_ids) || []) await decideAny(id);
      }
      const p = (await api('SH', 'GET', '/reports23/sales?tab=profit&per=month')).data;
      const rent = p.table.rows.find((x) => x[0] === 'Rent'); const power = p.table.rows.find((x) => x[0] === 'Power (electricity)');
      const ku = (await api('KU', 'GET', '/reports23/sales?tab=profit&per=month')).data;
      ok(p.profit && rent[2] === 45050 && power[2] === 8470 && Math.abs(p.profit.profit - r2(p.profit.sales - p.profit.cost - p.profit.expenses)) < 0.01 && ku.blocked,
        `"${p.notes[0]}"; rent ${rent[2]} (its GST claimed, so not an expense), power ${power[2]}; Kumar: "${ku.blocked}"`); }

    if (run('17.10')) { await fresh(); T('17.10', 'Who does what on expenses');
      await payee('Kalaimagal Stationery', '', 'office', 50);
      await float(5000);
      const ku = await exp({ head_key: 'office', payee: 'Kalaimagal Stationery', amount: 300, mode: 'cash' }, 'KU');
      if (ku.status >= 300) say('Kumar:', ku.status, ku.msg, JSON.stringify(ku.fields));
      const kuEx = await api('KU', 'POST', `/money/accounting/${lastM}/export`);
      const kuTop = await api('KU', 'POST', '/money/petty/1/topup', { amount: 100 });
      const dv = await api('DV', 'GET', '/money/expenses'); const mu = await api('MU', 'GET', '/money/expenses');
      ok(ku.status === 201 && kuEx.status === 403 && kuTop.status < 300 && dv.status === 403, `Kumar (Supervisor) records ${ku.data && ku.data.expense_no} (${ku.status}) and asks a top-up (${kuTop.status}); exports: ${kuEx.status} "${kuEx.msg}"; Divya: ${dv.status} "${dv.msg}"; Murugan: ${mu.status}`); }

    if (run('FLOW')) { await fresh(); T('FLOW', 'Full flow: freight on a PO in parts, an expense with GST, a petty cash day, last month to Tally and CSV, the running month refused, an approval after export refused, GSTR data with the expense GST');
      // 1. a transporter bill for a PO received in three goods in, in two part bills
      const po = await q1("SELECT po_id, po_no, freight_cost FROM purchase_orders WHERE po_no = 'DFP/26-27/0003'");
      await payee('VRL Logistics', '', 'other', 10);
      const tb = [];
      for (const [amt, ref] of [[900, 'FR00001'], [700, 'FR00002']]) { const r = await exp({ head_key: 'freightin', po_no: po.po_no, payee: 'VRL Logistics', amount: amt, gst_rate: 5, reference: ref }); for (const id of r.data.approval_ids || []) await decideAny(id); tb.push(r.data.expense_no); }
      const p1 = await q1('SELECT freight_cost FROM purchase_orders WHERE po_id = ?', [po.po_id]);
      const adj = await q1("SELECT ROUND(SUM(a.value_stock + a.value_cos), 2) AS v, COUNT(DISTINCT a.sku_code) AS n FROM cost_adjustments a JOIN expenses e ON e.expense_id = a.src_id WHERE a.src_type = 'expense' AND e.po_id = ?", [po.po_id]);
      ok(r2(p1.freight_cost) === 1600 && Math.abs(Number(adj.v) - r2(1600 - Number(po.freight_cost))) < 0.05, `${tb.join(' + ')} on ${po.po_no}: freight in cost ${po.freight_cost} -> ${p1.freight_cost}; adjustments ${adj.v} over ${adj.n} packs (= 1600 - ${po.freight_cost})`);
      // 2. an expense with GST (rent, claimable), recorded after its approval
      await payee('Murugan Estates', '33AAKFM2231L1ZQ', 'rent', 50);
      const d0 = (await api('SH', 'GET', '/reports23/gst')).data; const g0 = d0.table.rows[0];
      const rent = await exp({ head_key: 'rent', payee: 'Murugan Estates', amount: 45000, gst_rate: 18, gstin: '33AAKFM2231L1ZQ', reference: 'HDFC00931177' });
      for (const id of rent.data.approval_ids || []) await decideAny(id);
      const d1 = (await api('SH', 'GET', '/reports23/gst')).data; const g1 = d1.table.rows[0];
      ok(rent.data.status === 'waiting' && r2(g1[3] - g0[3]) === 8100 && r2(d1.input_expense[0] - d0.input_expense[0]) === 8100, `${rent.data.expense_no} rent Rs 45,000 + GST 8,100 waited ("${rent.data.message}"), recorded; GSTR-3B ${g1[0]} input ${g0[3]} -> ${g1[3]} (expense GST ${d1.input_expense[0]})`);
      // ... and on screen: GST > GSTR-1 / GSTR-3B data shows it as the ITC on expenses, with the month total (and the CSV)
      const gm = (await api('SH', 'GET', '/gst/month')).data; const pe = gm.gstr3b.input.parts.expenses; const pb = gm.gstr3b.input.parts.bills;
      const line = (gm.itc_expenses || []).find((x) => x.expense_no === rent.data.expense_no);
      const gcsv = await api('SH', 'GET', `/gst/month.csv?month=${gm.month}`);
      const csvText = String(gcsv.text || '');
      ok(Boolean(line) && r2(line.gst_amount) === 8100 && r2(pe.tax) === r2(gm.itc_expenses.reduce((a, x) => a + x.gst_amount, 0)) && r2(pe.tax + pb.tax) === r2(gm.gstr3b.input.tax)
        && r2(pe.tax) === r2(d1.input_expense[0]) && csvText.includes(`3B input ITC on expense,${rent.data.expense_no}`) && csvText.includes('3B input ITC on expenses total'),
        `GSTR-3B data ${gm.month}: ITC on expenses ${pe.count} rows, month total ${pe.tax} (the rent line ${line && line.gst_amount}); supplier bills ${pb.tax} + expenses ${pe.tax} = input ${gm.gstr3b.input.tax}; CSV rows: ${csvText.includes('3B input ITC on expense,') ? 'yes' : 'no'}`);
      // 3. a petty cash day: float, a spend, a top-up (approved), the day close
      await float(5000);
      await payee('Indian Oil', '', 'fuel', 1);
      await exp({ head_key: 'fuel', payee: 'Indian Oil', amount: 3200, mode: 'petty' });
      const b0 = await box();
      const top = await api('SH', 'POST', `/money/petty/${G}/topup`, { amount: String(r2(5000 - b0.balance)) });
      await decideAny((await pendingOf('petty_topup')).approval_id);
      const b1 = await box();
      const cnt = await api('SH', 'POST', `/money/petty/${G}/count`, { counted: b1.balance });
      ok(b0.balance === r2(5000 - 3200) && b1.balance === 5000 && cnt.data.difference === 0, `box 5000 - fuel 3200 = ${b0.balance}; top-up "${top.data.message}" -> ${b1.balance}; day close counted ${b1.balance}: "${cnt.data.message}"`);
      // 4. last month to Tally and CSV; this month refused; an approval after the export refused
      const now = await api('SH', 'POST', `/money/accounting/${m0}/export`);
      for (const x of await qa("SELECT approval_id FROM approvals WHERE status = 'pending' AND DATE_FORMAT(record_date, '%Y-%m') = ?", [lastM])) await decideAny(x.approval_id);
      const pre = (await api('SH', 'GET', `/money/accounting?month=${lastM}`)).data;
      const ex = await api('SH', 'POST', `/money/accounting/${lastM}/export`);
      const xml = await (await fetch(`${ctx.base}/money/accounting/${lastM}/xml`, { headers: { Cookie: ctx.cookie('SH') } })).text();
      const csvT = await (await fetch(`${ctx.base}/money/accounting/${lastM}/csv`, { headers: { Cookie: ctx.cookie('SH') } })).text();
      const amounts = [...xml.matchAll(/<AMOUNT>(-?[0-9.]+)<\/AMOUNT>/g)].map((m) => Number(m[1]));
      const csvRows = csvT.trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
      const dr = r2(csvRows.reduce((a, r) => a + (Number(r[6]) || 0), 0)); const cr = r2(csvRows.reduce((a, r) => a + (Number(r[7]) || 0), 0));
      ok(now.status === 409 && pre.ok && ex.status === 200 && Math.abs(r2(amounts.reduce((a, v) => a + v, 0))) < 0.01 && dr === cr && (xml.match(/<VOUCHER /g) || []).length === pre.vouchers.length,
        `${m0}: ${now.status} "${now.msg.slice(0, 60)}..."; ${lastM}: ${ex.data.xml_name} ${pre.vouchers.length} vouchers, XML amounts sum ${r2(amounts.reduce((a, v) => a + v, 0))}, CSV debit ${dr} = credit ${cr}`);
      const big = await exp({ head_key: 'rent', payee: 'Murugan Estates', amount: 20000, reference: 'HDFC00999001' });
      const ap = await pendingOf('expense', big.data.expense_no);
      await pool.query('UPDATE approvals SET record_date = ? WHERE approval_id = ?', [`${lastM}-25`, ap.approval_id]);
      await pool.query('UPDATE expenses SET exp_date = ? WHERE expense_no = ?', [`${lastM}-25`, big.data.expense_no]);
      const late = await decide('PV', ap.approval_id);
      const hist = (await api('SH', 'GET', '/money/accounting-history')).data.months.find((x) => x.month === lastM);
      ok(late.status >= 400 && /exported to the CA/.test(late.msg) && hist && hist.has_files, `a request dated ${lastM}-25 after the export: ${late.status} "${late.msg.slice(0, 80)}"; history: ${hist && `${hist.xml_name}, ${hist.file_name}, ${hist.vouchers} vouchers, expenses ${hist.totals && hist.totals.expenses}`}`);
      // 5. everything reconciles: the ledger of expenses = the vouchers of the month (this month's expenses are not in last month's file)
      const sumX = await q1("SELECT COALESCE(SUM(total), 0) AS n FROM expenses WHERE status = 'done' AND DATE_FORMAT(exp_date, '%Y-%m') = ?", [lastM]);
      ok(r2(hist.totals.expenses) === r2(sumX.n), `${lastM} expenses in the export ${hist.totals.expenses} = recorded expenses dated ${lastM} ${r2(sumX.n)}`); }

    if (run('Y6')) { await fresh(); T('Y6', 'A transporter bill for a PO with goods in on three days: the freight spread over all of them');
      const po = await q1("SELECT p.po_id, p.po_no, p.freight, p.freight_cost FROM purchase_orders p WHERE p.po_no = 'DFP/26-27/0003'");
      const grns = await qa("SELECT g.grn_id, l.sku_code, l.acc FROM goods_ins g JOIN goods_in_lines l ON l.grn_id = g.grn_id WHERE g.po_id = ? AND g.status = 'done'", [po.po_id]);
      await payee('VRL Logistics', '', 'other', 10);
      const p1 = await exp({ head_key: 'freightin', po_no: po.po_no, payee: 'VRL Logistics', amount: 900, gst_rate: 5, mode: 'bank', reference: 'FR00001' });
      for (const id of p1.data.approval_ids || []) await decideAny(id);
      const p2 = await exp({ head_key: 'freightin', po_no: po.po_no, payee: 'VRL Logistics', amount: 700, gst_rate: 5, mode: 'bank', reference: 'FR00002' });
      for (const id of p2.data.approval_ids || []) await decideAny(id);
      const after = await q1('SELECT freight_cost, freight_billed FROM purchase_orders WHERE po_id = ?', [po.po_id]);
      const adj = await qa("SELECT a.sku_code, ROUND(a.value_stock + a.value_cos, 2) AS v FROM cost_adjustments a JOIN expenses e ON e.expense_id = a.src_id WHERE a.src_type = 'expense' AND e.po_id = ?", [po.po_id]);
      const tot = r2(adj.reduce((s, x) => s + Number(x.v), 0));
      ok(r2(after.freight_cost) === 1600 && Math.abs(tot - r2(1600 - Number(po.freight_cost))) < 0.05 && new Set(adj.map((x) => x.sku_code)).size >= new Set(grns.map((g) => g.sku_code)).size,
        `${po.po_no}: estimate ${po.freight} (in cost ${po.freight_cost}); two transporter part bills 900 + 700 (GST not in cost): freight in cost now ${after.freight_cost}; adjustments ${tot} over ${adj.map((x) => `${x.sku_code} ${x.v}`).join(', ')} (${grns.length} goods-in lines on ${new Set(grns.map((g) => g.grn_id)).size} goods in)`); }
  },
};
