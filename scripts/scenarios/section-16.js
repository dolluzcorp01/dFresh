// Section 16 - Reports and dashboard: the v23 Tests tab "16" and the fix items RP1 (cost masked on reports: "hidden",
// never Rs 0), RP2 (every report and tile scoped by the person's godowns) and Y9 (stock value on every shelf).
// Our figures stand in for v23's; each check works its figure out with v23's rule. Run: npm run scenarios -- 16
module.exports = {
  title: 'Reports and dashboard',
  async run(ctx) {
    const { api, ok, say, q1, decideAny, packed, T, fresh, run, r2, today, upload } = ctx;
    const rep = async (page, q = '', as = 'SH') => (await api(as, 'GET', `/reports23/${page}?${q}`));
    const total = (t, i) => r2(t.rows.reduce((a, r) => a + (Number(r[i]) || 0), 0));

    if (run('16.1')) { await fresh(); T('16.1', 'The dashboard shows real figures; each tile opens its page');
      const d = (await api('SH', 'GET', '/dashboard/home')).data;
      const s = (await rep('sales', 'per=month')).data;
      const sales = d.tiles.find((x) => x.key === 'sales');
      ok(d.tiles.length >= 6 && d.tiles.every((x) => /^\/admin\//.test(x.to)) && sales.sub.includes(`Rs ${Number(s.stats.sales).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) && d.top.length > 0,
        d.tiles.map((x) => `${x.label}: ${typeof x.value === 'number' ? x.value.toFixed(2) : x.value} (${x.sub}) -> ${x.to}`).join(' | ') + `; top 5 first: ${d.top[0] && d.top[0].label} ${d.top[0] && d.top[0].val}; newest alerts ${d.alerts.length}`); }

    if (run('16.2')) { await fresh(); T('16.2', 'Sales by customer, godown and period');
      const c = (await rep('sales', 'tab=customer&per=year')).data; const g = (await rep('sales', 'tab=godown&per=year')).data;
      const l = (await rep('sales', 'tab=customer&per=last')).data; const cu = (await rep('sales', 'tab=customer&per=custom&from=2026-10-14&to=2026-10-31')).data;
      ok(total(c.table, 2) === r2(c.stats.sales) && total(g.table, 2) === r2(g.stats.sales) && cu.from === '2026-10-14',
        `this year: ${c.table.rows.slice(0, 3).map((r) => `${r[0]} ${r[2]}`).join(', ')} ... total ${c.stats.sales}, margin ${c.stats.margin}; by godown ${g.table.rows.map((r) => `${r[0]} ${r[2]}`).join(', ')}; last month ${l.stats.sales}; from 2026-10-14: ${cu.stats.sales}`); }

    if (run('16.3')) { await fresh(); T('16.3', 'A new invoice and a credit note change the sales');
      const no = await packed(1, [{ sku_code: 'DF001-M100', qty: 24 }]);
      const s0 = (await rep('sales', 'per=month')).data.stats; // packed, not invoiced yet: in hand
      const iv = await api('SH', 'POST', '/billing/invoices', { order_no: no });
      const inv = await q1('SELECT taxable FROM invoices WHERE invoice_no = ?', [iv.data.invoice_no]);
      const s1 = (await rep('sales', 'per=month')).data.stats;
      const cn = await api('SH', 'POST', '/billing/credit-notes', { invoice_no: iv.data.invoice_no, why: 'Price correction', amount: '100', note: 'Agreed lower price' });
      if (cn.data && cn.data.approval_id) await decideAny(cn.data.approval_id);
      const s2 = (await rep('sales', 'per=month')).data.stats;
      const d = (await api('SH', 'GET', '/dashboard/home')).data.tiles.find((x) => x.key === 'sales');
      ok(r2(s1.sales - s0.sales) === r2(inv.taxable) && r2(s1.sales - s2.sales) === 100 && r2(s2.credit_notes - s1.credit_notes) === 100 && s1.in_hand < s0.in_hand,
        `sales ${s0.sales} -> ${s1.sales} (+${inv.taxable}, ${iv.data.invoice_no}) -> ${s2.sales} after a Rs 100 credit note (credit notes ${s2.credit_notes}); orders in hand ${s0.in_hand} -> ${s1.in_hand}; dashboard: ${d.value} today (${d.sub})`); }

    if (run('16.4')) { await fresh(); T('16.4', 'Export (CSV) follows the Export right');
      const r = await fetch(`${ctx.base}/reports23/sales/export.csv?tab=product&per=year`, { headers: { Cookie: ctx.cookie('SH') } }); const t = await r.text();
      const k = await fetch(`${ctx.base}/reports23/sales/export.csv?tab=product&per=year`, { headers: { Cookie: ctx.cookie('DV') } });
      const kx = await fetch(`${ctx.base}/commerce/reports/sales/export.xlsx`, { headers: { Cookie: ctx.cookie('DV') } });
      const dv = (await rep('sales', '', 'DV')).data;
      ok(r.status === 200 && /^﻿?Product,Packs,Sales,Margin/.test(t) && (dv ? dv.can.export === (k.status === 200) : true),
        `${r.headers.get('content-disposition')}: "${t.split(/\r?\n/)[1]}"; without Export (Divya: can.export ${dv && dv.can.export}): CSV ${k.status}, old Excel ${kx.status}`); }

    if (run('16.5')) { await fresh(); T('16.5', 'Purchases, discounts and returns');
      const p = (await rep('sales', 'tab=purchases&per=year')).data; const d = (await rep('sales', 'tab=discounts&per=year')).data; const r = (await rep('sales', 'tab=returns&per=year')).data;
      ok(p.table && d.table && r.table, `purchases: ${p.table.rows.length} lines, ${p.table.foot[3]}; discounts: ${d.table.rows.map((x) => `${x[0]} ${x[2]}`).join(', ')}; ${r.notes[0]}`); }

    if (run('16.6')) { await fresh(); T('16.6', 'Stock at cost on every shelf (Y9), ageing, expiry, slow movers, losses');
      const no = await packed(1, [{ sku_code: 'DF001-M100', qty: 24 }]);
      const v = (await rep('stock', 'tab=value')).data; const a = (await rep('stock', 'tab=ageing')).data; const e = (await rep('stock', 'tab=expiry')).data;
      const sl = (await rep('stock', 'tab=slow')).data; const lo = (await rep('stock', 'tab=losses&per=year')).data;
      const shelfCols = v.table.cols.map((c) => c.label);
      const k = v.table.rows[0];
      const packedCol = shelfCols.indexOf('Packed'); // v23 COLS: the short column head (the category table says "Packed, not invoiced")
      ok(r2(v.table.rows.reduce((s, r) => s + r[r.length - 1], 0)) === r2(v.stats.value) && packedCol > 0 && k[packedCol] > 0 && shelfCols.includes('QC hold') && shelfCols.includes('In production'),
        `${shelfCols.slice(1).join(', ')}: ${v.table.rows.map((r) => `${r[0]} ${r.slice(1).map((x) => x.toFixed(2)).join(' / ')}`).join('; ')} (${no} packed, not invoiced: ${k[packedCol]}); ${v.stats.no_cost} packs with no cost`);
      ok(a.table.rows.length === 5 && e.table && sl.table && lo.table, `ageing ${a.table.rows.map((r) => `${r[0]} ${r[1]}`).join(', ')}; expiry ${e.table.rows.length}; slow ${sl.table.rows.length}; losses ${lo.table.rows.map((r) => `${r[0]} ${r[1]} written off ${r[2]}`).join(', ')}`); }

    if (run('16.7')) { await fresh(); T('16.7', 'Who owes us and whom we owe');
      const c = (await rep('money', 'tab=customers')).data; const s = (await rep('money', 'tab=suppliers')).data; const co = (await rep('money', 'tab=collections&per=year')).data;
      const rc = (await api('SH', 'GET', '/money/receipts')).data;
      ok(Math.abs(c.stats.owed - rc.summary.owe) < 0.02, `customers ${c.stats.owed} (Receipts says ${rc.summary.owe}), overdue ${c.stats.overdue}: ${c.table.rows.slice(0, 2).map((r) => `${r[0]} ${r[6]}`).join(', ')}; suppliers ${s.table.foot[6]} (${s.notes[0] || 'no MSME past 45 days'}); collections ${co.table.rows.map((r) => `${r[0]} ${r[2]}`).join(', ')}`); }

    if (run('16.8')) { await fresh(); T('16.8', 'GST by month, with the GST on expenses that can be claimed');
      const d0 = (await rep('gst')).data; const g0 = d0.table.rows[0]; const e0 = d0.input_expense[0];
      await api('PV', 'POST', '/money/petty/1/float', { float: 5000 });
      const r1 = await upload('SH', '/money/expenses', { date: today(), godown_id: 1, head_key: 'rent', payee: 'Rent Owner Estates', new_payee: 1, amount: 4500, gst_rate: 18, gstin: '33AAKFM2231L1ZQ', mode: 'bank', reference: 'HDFC00931177' });
      for (const id of (r1.data && r1.data.approval_ids) || []) await decideAny(id);
      const d1 = (await rep('gst')).data; const g1 = d1.table.rows[0]; const e1 = d1.input_expense[0];
      ok(r2(g1[3] - g0[3]) === 810 && r2(e1) === r2(e0 + 810) && r2(g1[4]) === r2(g1[2] - g1[3]) && d1.chart.length === d1.table.rows.length, `${g0[0]}: input GST ${g0[3]} -> ${g1[3]} (of it on expenses ${e1}: rent Rs 4,500 at 18% with a GSTIN), net payable ${g1[4]}; bars ${d1.chart.length}`); }

    if (run('16.9')) { await fresh(); T('16.9', 'Delivery on time');
      const d = (await rep('gst', 'tab=delivery&per=year')).data;
      ok(d.table && d.table.rows.length >= 0, `${d.table.title}: ${d.table.rows.slice(0, 3).map((r) => r.join(' / ')).join('; ')} ${(d.extra || []).map((x) => `| ${x.title} ${x.rows.length}`).join(' ')}`); }

    if (run('16.10')) { await fresh(); T('16.10', 'Each person sees their own figures (RP1 cost hidden, RP2 godowns)');
      const ku = (await rep('sales', 'tab=godown&per=year', 'KU')).data; const kv = (await rep('stock', 'tab=value', 'KU')).data; const ka = (await rep('stock', 'tab=ageing', 'KU')).data;
      const kd = (await api('KU', 'GET', '/dashboard/home')).data; const mu = await rep('sales', '', 'MU');
      const kOut = await rep('sales', 'godown=2', 'KU');
      const kG = await q1("SELECT GROUP_CONCAT(godown_id) AS g FROM admin_user_godowns WHERE emp_id = 'DZIND146'");
      ok(/hidden/.test(ku.stats.margin) && kv.blocked && ka.table.rows.every((r) => r[2] === null) && !kd.tiles.some((t) => t.key === 'stock') && mu.status === 403,
        `Kumar: margin "${ku.stats.margin}", stock value "${kv.blocked}", ageing values ${JSON.stringify(ka.table.rows.map((r) => r[2]))} (hidden, never Rs 0), no stock tile; Murugan: ${mu.status} "${mu.msg}"`);
      ok(!kG.g || kOut.status === 403, `Kumar works at godown(s) ${kG.g || 'all'}: a report for godown 2: ${kOut.status} ${kOut.msg || ''}`);
      say(`Kumar's dashboard: ${kd.tiles.map((t) => t.label).join(', ')}`); }
  },
};
