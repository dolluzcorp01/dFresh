// Section 14 - Wallet and loyalty: the v23 Tests tab "14" and the fix items W2, the wallet kept for a dropped back-order, Kumar's
// wallets, and the phase 22 full flow. Our data stands in for v23's; each check works its figure out with v23's rule.
// Run: npm run scenarios -- 14
const helpers = require('./helpers-returns');

module.exports = {
  title: 'Wallet and loyalty',
  async run(ctx) {
    const { api, pool, ok, say, q1, qa, setting, decide, decideAny, pendingOf, approveAll, order, packed, delivered, backdate, owes, shelf, r2, T, fresh, run, upload, enc } = ctx;
    const { reasonId, newReturn, ret, receive, promos, wal, wrow } = helpers(ctx);
    const SH = 'SH'; const PV = 'PV'; const AN = 'AN'; const KU = 'KU'; const DV = 'DV'; const MU = 'MU'; const RA = 'RA';
    const SKU = 'DF001-M100'; const WW = 'DF044-M100';
    const HOTEL = 1; const DIST = 7; const OFFICE = 5;
    void [pool, say, q1, qa, setting, decide, decideAny, pendingOf, approveAll, order, packed, delivered, backdate, owes, shelf, r2, T, fresh, upload, enc, reasonId, newReturn, ret, receive, promos, wal, wrow, SH, PV, AN, KU, DV, MU, RA, SKU, WW, HOTEL, DIST, OFFICE];
    if (run('14.1')) { await fresh(); T('14.1', 'The wallet at the start');
      const w = (await api(SH, 'GET', '/marketing/wallets')).data; const p = await promos();
      ok(w.rows.length > 0, `rules: ${p.rules.map((r) => `#${r.rule_id} ${r.name} ${r.pct}% ${r.shown}`).join('; ')}; wallets: ${w.totals.usable} usable, ${w.totals.expiring} runs out in 30 days, ${w.totals.pending} pending: ${w.rows.map((x) => `${x.name} ${x.usable}`).join(', ')}`); }
    if (run('14.2')) { await fresh(); T('14.2', 'Use the wallet on an order');
      const c = (await qa('SELECT customer_id FROM wallet_entries WHERE remaining > 0 GROUP BY customer_id ORDER BY SUM(remaining) DESC LIMIT 1'))[0].customer_id;
      const bal = (await wal(c)).usable;
      const items = [{ sku_code: SKU, qty: 40 }];
      const p1 = (await api(SH, 'POST', '/commerce/orders/preview', { customer_id: c, items, wallet_use: bal + 100 })).data;
      const p2 = (await api(SH, 'POST', '/commerce/orders/preview', { customer_id: c, items, wallet_use: 100 })).data;
      const no = await order(c, items, { wallet_use: 100 });
      const row = await wrow(c);
      ok(p1.wallet_error && p2.totals.wallet_used === 100 && row && row.kept >= 100, `usable ${bal}; ${bal + 100}: "${p1.wallet_error}"; 100: wallet ${p2.totals.wallet_used}, total ${p2.totals.total}; ${no}: wallets row usable ${row && row.usable}, kept ${row && row.kept}`); }
    if (run('14.3')) { await fresh(); T('14.3', 'Cashback is earned after delivery and the return window');
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 20 }]);
      const w0 = await wrow(HOTEL);
      await backdate(o.no, 8); const jobs = await api(SH, 'POST', '/commerce/promotions/run-jobs');
      const ob = await q1('SELECT cashback_amount, cashback_min FROM orders WHERE order_no = ?', [o.no]);
      const w1 = await wrow(HOTEL);
      ok(w0 && w0.pending > 0 && Number(ob.cashback_amount) > 0 && Math.abs(r2(w1.usable - w0.usable) - Number(ob.cashback_amount)) < 0.02, `delivered ${o.no}: pending ${w0 && w0.pending}; 8 days later Run now: ${JSON.stringify(jobs.data && jobs.data.cashback)}; usable ${w0 && w0.usable} -> ${w1 && w1.usable} (+${ob.cashback_amount}, min ${ob.cashback_min})`); }
    if (run('14.4')) { await fresh(); T('14.4', 'Paid: the cashback still waits for the return window');
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 20 }]);
      const due = await owes(HOTEL);
      const rc = await api(SH, 'POST', '/money/receipts', { customer_id: HOTEL, amount: String(due), mode: 'upi', reference: 'UTR778899' });
      const ob = await q1('SELECT payment_status, cashback_amount FROM orders WHERE order_no = ?', [o.no]); const w = await wrow(HOTEL);
      ok(rc.status < 300 && ob.cashback_amount === null && w.pending > 0, `receipt ${rc.data && rc.data.receipt_no} Rs ${due} (UPI UTR778899): ${o.no} ${ob.payment_status}; cashback still pending ${w.pending} (usable only after delivery and the return window, v21)`); }
    if (run('14.5')) { await fresh(); T('14.5', 'A credit note takes back its share');
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 20 }]); await backdate(o.no, 8); await api(SH, 'POST', '/commerce/promotions/run-jobs');
      const ob = await q1('SELECT cashback_amount FROM orders WHERE order_no = ?', [o.no]);
      const u0 = (await wal(HOTEL)).usable;
      const cn = await api(SH, 'POST', '/billing/credit-notes', { invoice_no: o.invoice_no, why: 'Price correction', amount: '100', note: 'Agreed lower price' });
      if (cn.data && cn.data.approval_id) await decideAny(cn.data.approval_id);
      const u1 = (await wal(HOTEL)).usable;
      const inv = await q1('SELECT taxable FROM invoices WHERE invoice_no = ?', [o.invoice_no]);
      ok(cn.status < 300 && u1 < u0, `cashback ${ob.cashback_amount} on goods ${inv.taxable}; price correction Rs 100 (${cn.status} ${cn.msg || cn.data.message || ''}): usable ${u0} -> ${u1} (taken back ${r2(u0 - u1)}, v23: its share ${r2(Number(ob.cashback_amount) * 100 / Number(inv.taxable))})`); }
    if (run('14.6')) { await fresh(); T('14.6', 'A cancelled order gives the wallet back');
      const c = (await qa('SELECT customer_id FROM wallet_entries WHERE remaining > 0 GROUP BY customer_id ORDER BY SUM(remaining) DESC LIMIT 1'))[0].customer_id;
      const u0 = (await wal(c)).usable;
      const no = await order(c, [{ sku_code: SKU, qty: 40 }], { wallet_use: 100 });
      const u1 = (await wal(c)).usable;
      const x = await api(SH, 'POST', `/commerce/orders/${no}/cancel`, { reason: 'Wrong price' });
      if (x.data && x.data.approval_id) await decideAny(x.data.approval_id);
      const u2 = (await wal(c)).usable;
      ok(Math.abs(u2 - u0) < 0.01, `usable ${u0}; ${no} with Rs 100 of wallet: ${u1}; cancelled (${x.status} ${x.msg || ''}): ${u2}`); }
    if (run('14.7')) { await fresh(); T('14.7', 'A manual credit needs a second person');
      const u0 = (await wal(2)).usable;
      const e = await api(SH, 'POST', '/commerce/customers/2/wallet', { direction: 'credit' });
      const r = await api(SH, 'POST', '/commerce/customers/2/wallet', { direction: 'credit', amount: '150', reason: 'Late delivery on 20 Oct' });
      const u1 = (await wal(2)).usable;
      await decideAny(r.data.approval_id);
      const u2 = (await wal(2)).usable;
      ok(e.status === 400 && !r.data.posted && u1 === u0 && Math.abs(r2(u2 - u0) - 150) < 0.01, `nothing filled: "${e.msg}"; Rs 150: waits #${r.data.approval_id}; usable ${u0} -> ${u1} (waiting) -> ${u2} after Anitha`); }
    if (run('14.8')) { await fresh(); T('14.8', 'A new cashback rule');
      const e = await api(KU, 'POST', '/commerce/cashback-rules', {});
      const r = await api(KU, 'POST', '/commerce/cashback-rules', { name: 'Distributors 1% back', type_key: 'distributor', pct: 1, min_order: 0 });
      const a = await pendingOf('cashback_rule', r.data.rule_id); await decideAny(a.approval_id);
      const x = (await promos()).rules.find((y) => y.rule_id === r.data.rule_id);
      ok(e.status === 400 && r.data.status === 'waiting' && x.status === 'live', `nothing filled: "${e.msg}"; sent: "${r.data.message}"; after Anitha: ${x.shown}`); }
    if (run('14.9')) { await fresh(); T('14.9', 'No wallet on offer lines');
      const c = (await qa('SELECT customer_id FROM wallet_entries WHERE remaining > 0 GROUP BY customer_id ORDER BY SUM(remaining) DESC LIMIT 1'))[0].customer_id;
      const p = (await api(SH, 'POST', '/commerce/orders/preview', { customer_id: c, items: [{ sku_code: SKU, qty: 72 }], wallet_use: 50 })).data;
      ok(p.totals.offer_discount > 0 && /Every line has an offer/.test(p.wallet_error || ''), `offer -${p.totals.offer_discount}; "${p.wallet_error}"`); }
    if (run('14.10')) { await fresh(); T('14.10', 'Who does what on the wallet');
      const dv = await api(DV, 'GET', '/marketing/wallets'); const ku = await api(KU, 'GET', '/marketing/wallets'); const mu = await api(MU, 'GET', '/marketing/wallets');
      const kup = (await promos(KU)).can;
      ok(mu.status === 403 && ku.status === 200 && kup.create, `Divya: ${dv.status} manual ${dv.data && dv.data.can.manual}, rows ${dv.data && dv.data.rows.length}; Kumar: New rule ${kup.create}, usable ${ku.data.totals.usable} in his godown (never Rs 0 for a hidden figure); Murugan: ${mu.status} "${mu.msg}"`); }
    if (run('SWITCH')) { await fresh(); T('SWITCH', 'The wallet switch and the wallets export (phase 23)');
      const c = (await qa('SELECT customer_id FROM wallet_entries WHERE remaining > 0 GROUP BY customer_id ORDER BY SUM(remaining) DESC LIMIT 1'))[0].customer_id;
      const u0 = (await wal(c)).usable;
      await setting('wallet_enabled', 0);
      const w = (await api(SH, 'GET', '/marketing/wallets')).data;
      const p = (await api(SH, 'POST', '/commerce/orders/preview', { customer_id: c, items: [{ sku_code: SKU, qty: 40 }], wallet_use: 50 })).data;
      const f = (await api(SH, 'GET', '/commerce/order-form')).data;
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 20 }]); await backdate(o.no, 8);
      const jobs = (await api(SH, 'POST', '/commerce/promotions/run-jobs')).data;
      const u1 = (await wal(c)).usable;
      ok(!w.wallet_on && /switched off/.test(p.wallet_error || '') && p.totals.wallet_used === 0 && jobs.cashback.length === 0 && u1 === u0,
        `off: wallets page wallet_on ${w.wallet_on}, ${w.rows.length} balances still listed; order: "${p.wallet_error}"; order form walletOn ${f && f.walletOn}; Run now earns nothing (${jobs.cashback.length}); balance kept ${u0} -> ${u1}`);
      await setting('wallet_enabled', 1);
      const sw = await api(PV, 'PUT', '/commerce-settings/wallet_enabled', { value: '1' });
      await setting('wallet_enabled', 0);
      const on = await api(PV, 'PUT', '/commerce-settings/wallet_enabled', { value: '1' });
      const v = (await q1("SELECT value FROM commerce_settings WHERE setting_key = 'wallet_enabled'")).value;
      ok(on.status < 300 && v === '0' && /second|approval|wait/i.test(JSON.stringify(on.data || on.msg)), `turning it on as an Admin: ${on.status} ${JSON.stringify(on.data || on.msg).slice(0, 160)}; still ${v} until a second Admin signs (${sw.status})`);
      const csv = await fetch(`${ctx.base}/marketing/wallets.csv`, { headers: { Cookie: ctx.cookie('SH') } }); const text = await csv.text();
      const dvx = await fetch(`${ctx.base}/marketing/wallets.csv`, { headers: { Cookie: ctx.cookie('DV') } });
      ok(csv.status === 200 && /Customer no,Customer,Usable/.test(text) && dvx.status === 403, `Export: ${csv.headers.get('content-disposition')}, ${text.trim().split(/\r?\n/).length - 1} rows, first "${text.split(/\r?\n/)[1]}"; Sales (no Export): ${dvx.status}`); }
    if (run('W2')) { await fresh(); T('W2', 'A return under the rule minimum takes back all of the cashback');
      await setting('returned_resell', 1);
      const o = await delivered(DIST, [{ sku_code: SKU, qty: 200 }]); await backdate(o.no, 8); await api(SH, 'POST', '/commerce/promotions/run-jobs');
      const ob = await q1('SELECT cashback_amount, cashback_min, (SELECT taxable FROM invoices WHERE invoice_no = ?) goods FROM orders WHERE order_no = ?', [o.invoice_no, o.no]);
      await pool.query('UPDATE orders SET delivered_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY) WHERE order_no = ?', [o.no]);
      const u0 = (await wal(DIST)).usable;
      const r = (await newReturn(o.no, [{ sku_code: SKU, qty: 80 }])).data; await receive(r.return_no);
      const line = (await ret(r.return_no)).lines[0];
      await api(KU, 'POST', `/commerce/returns/${r.return_no}/inspect`, { lines: [{ line_id: line.line_id, damaged: 80 }] });
      await api(SH, 'POST', `/commerce/returns/${r.return_no}/decide`, { lines: [{ line_id: line.line_id, refund: 80, replace: 0, none: 0 }], method: 'balance' });
      await approveAll(r.return_no);
      const u1 = (await wal(DIST)).usable; const d = await ret(r.return_no);
      ok(Number(ob.cashback_amount) > 0 && Math.abs(r2(u0 - u1) - Number(ob.cashback_amount)) < 0.02, `goods ${ob.goods}, rule minimum ${ob.cashback_min}, cashback ${ob.cashback_amount}; return of 80 of 200 -> goods under the minimum: taken back ${r2(u0 - u1)} (return says ${d.cashback_reversed})`);
      await setting('returned_resell', 0); }
    if (run('BACKW')) { await fresh(); T('BACKW', 'The wallet kept for a dropped back-order is freed');
      const c = (await qa('SELECT customer_id FROM wallet_entries WHERE remaining > 0 GROUP BY customer_id ORDER BY SUM(remaining) DESC LIMIT 1'))[0].customer_id;
      const u0 = (await wal(c)).usable;
      const no = await order(c, [{ sku_code: SKU, qty: 40 }, { sku_code: 'DF002-M100', qty: 20 }], { wallet_use: 200 });
      // a part shipment left 20 of DF002-M100 owed (the state phase 20 leaves after Packed short): set straight on the line
      await pool.query("UPDATE order_items i JOIN orders o ON o.order_id = i.order_id SET i.back_qty = 20 WHERE o.order_no = ? AND i.sku_code = 'DF002-M100'", [no]);
      const u1 = (await wal(c)).usable;
      const x = await api(SH, 'POST', '/sales/back-orders/drop', { order_no: no, sku_code: 'DF002-M100' });
      const o = await q1('SELECT wallet_used, total FROM orders WHERE order_no = ?', [no]); const u2 = (await wal(c)).usable;
      ok(x.status === 200 && x.data.wallet_freed > 0 && Math.abs(r2(u2 - u1) - x.data.wallet_freed) < 0.02 && Math.abs(r2(u0 - u2) - Number(o.wallet_used)) < 0.02,
        `usable ${u0}; ${no} keeps 200 -> ${u1}; drop 20 DF002-M100: total ${x.data && x.data.total}, wallet freed ${x.data && x.data.wallet_freed}, still kept ${o.wallet_used}; usable ${u2}`); }
    if (run('KUMAR')) { await fresh(); T('KUMAR', 'Kumar\'s wallets: his godown, real amounts');
      const ku = (await api(KU, 'GET', '/marketing/wallets')).data; const sh = (await api(SH, 'GET', '/marketing/wallets')).data;
      ok(ku.totals.usable > 0 && ku.rows.every((x) => typeof x.usable === 'number'), `Kumar: ${ku.rows.length} wallets, ${ku.totals.usable} usable (Shoban: ${sh.rows.length}, ${sh.totals.usable})`); }
    if (run('FLOW')) { await fresh(); T('FLOW', 'Offer + coupon, delivered, cashback, return outside the window, resell + scrap, credit note, W2, wallet on the next order');
      await setting('returned_resell', 1); await setting('offers_with_coupon', 1);
      const o = await delivered(DIST, [{ sku_code: SKU, qty: 120 }, { sku_code: WW, qty: 20 }], { coupon_code: 'FRESH5' });
      const ob = await q1('SELECT o.order_id, o.coupon_code, o.discount + o.offer_discount AS discount_total, o.total, (SELECT SUM(IF(is_free, qty, 0)) FROM order_items i WHERE i.order_id = o.order_id) free FROM orders o WHERE order_no = ?', [o.no]);
      const w0 = await wrow(DIST);
      ok(ob.coupon_code === 'FRESH5' && Number(ob.free) === 2 && w0.pending > 0, `${o.no} / ${o.invoice_no}: coupon ${ob.coupon_code}, free packs ${ob.free}, discounts ${ob.discount_total}, total ${ob.total}; pending cashback ${w0.pending}`);
      await backdate(o.no, 8); await api(SH, 'POST', '/commerce/promotions/run-jobs');
      const cb = await q1('SELECT cashback_amount, cashback_min FROM orders WHERE order_no = ?', [o.no]); const w1 = await wrow(DIST);
      ok(Number(cb.cashback_amount) > 0 && Math.abs(r2(w1.usable - w0.usable) - Number(cb.cashback_amount)) < 0.02, `after the window: cashback ${cb.cashback_amount} usable (${w0.usable} -> ${w1.usable}); pending ${w1.pending}`);
      await backdate(o.no, 7); // now 15 days: outside the window
      const owe0 = await owes(DIST);
      const r = await newReturn(o.no, [{ sku_code: SKU, qty: 70 }]);
      const a = await pendingOf('return_window', r.data.return_no); await decideAny(a.approval_id);
      await receive(r.data.return_no);
      const line = (await ret(r.data.return_no)).lines[0];
      const ins = await api(KU, 'POST', `/commerce/returns/${r.data.return_no}/inspect`, { lines: [{ line_id: line.line_id, resell: 60, scrap: 10 }] });
      for (const x of await qa("SELECT approval_id FROM approvals WHERE ref_id = ? AND status = 'pending'", [r.data.return_no])) await decideAny(x.approval_id);
      const wo = await q1('SELECT approval_id FROM write_offs w JOIN return_items ri ON ri.scrap_write_off_id = w.write_off_id WHERE ri.line_id = ?', [line.line_id]).catch(() => null);
      if (wo && wo.approval_id) await decideAny(wo.approval_id);
      const dc = await api(SH, 'POST', `/commerce/returns/${r.data.return_no}/decide`, { lines: [{ line_id: line.line_id, refund: 70, replace: 0, none: 0 }], method: 'balance' });
      await approveAll(r.data.return_no);
      const d = await ret(r.data.return_no); const cn = d.credit_notes[0]; const owe1 = await owes(DIST); const w2 = await wrow(DIST);
      const inv = await q1('SELECT taxable FROM invoices WHERE invoice_no = ?', [o.invoice_no]);
      ok(ins.status === 200 && dc.status === 200 && cn && Number(cn.taxable) <= Number(inv.taxable) && Math.abs(r2(owe0 - owe1) - cn.total) < 0.02,
        `return ${r.data.return_no} of 70 outside the window, approved; inspected "${ins.data.message}"; credit note ${cn && cn.credit_note_no} ${cn && cn.total} (taxable ${cn && cn.taxable} within the invoice ${inv.taxable}); owes ${owe0} -> ${owe1}`);
      ok(Math.abs(r2(w1.usable - w2.usable) - Number(cb.cashback_amount)) < 0.02, `goods under the minimum ${cb.cashback_min}: all cashback taken back ${r2(w1.usable - w2.usable)} (return: ${d.cashback_reversed})`);
      await pool.query('INSERT INTO wallet_entries (customer_id, source, amount, remaining, reason, emp_id) VALUES (?, ?, ?, ?, ?, ?)', [DIST, 'manual', 200, 200, 'test credit', 'DZIND002']).catch((e) => say('wallet seed:', e.message));
      const u = (await wal(DIST)).usable;
      const no2 = await order(DIST, [{ sku_code: 'DF002-M100', qty: 20 }], { wallet_use: Math.min(100, u) });
      const o2 = no2 && await q1('SELECT wallet_used, total FROM orders WHERE order_no = ?', [no2]);
      ok(o2 && Number(o2.wallet_used) > 0, `wallet ${u} usable; next order ${no2}: wallet used ${o2 && o2.wallet_used}, total ${o2 && o2.total}`);
      await setting('returned_resell', 0); await setting('offers_with_coupon', 0); }
  },
};
