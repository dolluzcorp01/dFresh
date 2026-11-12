// Section 12 - Returns: the v23 Tests tab "12" and the fix items X9 (a later return sees what an earlier one took) and the
// return room held on the invoice. Our data stands in for v23's; each check works its figure out with v23's rule.
// Run: npm run scenarios -- 12
const helpers = require('./helpers-returns');

module.exports = {
  title: 'Returns',
  async run(ctx) {
    const { api, pool, ok, say, q1, qa, setting, decide, decideAny, pendingOf, approveAll, order, packed, delivered, backdate, owes, shelf, r2, T, fresh, run, upload, enc } = ctx;
    const { reasonId, newReturn, ret, receive, promos, wal, wrow } = helpers(ctx);
    const SH = 'SH'; const PV = 'PV'; const AN = 'AN'; const KU = 'KU'; const DV = 'DV'; const MU = 'MU'; const RA = 'RA';
    const SKU = 'DF001-M100'; const WW = 'DF044-M100';
    const HOTEL = 1; const DIST = 7; const OFFICE = 5;
    void [pool, say, q1, qa, setting, decide, decideAny, pendingOf, approveAll, order, packed, delivered, backdate, owes, shelf, r2, T, fresh, upload, enc, reasonId, newReturn, ret, receive, promos, wal, wrow, SH, PV, AN, KU, DV, MU, RA, SKU, WW, HOTEL, DIST, OFFICE];
    if (run('12.1')) { await fresh(); T('12.1', 'What waits at the start');
      const i = (await api(SH, 'GET', '/sales/returns/inspection')).data;
      const r = (await api(SH, 'GET', '/sales/returns?tab=to_inspect')).data;
      ok(i.on_shelf >= 0 && r.counts.to_inspect === i.to_inspect.length && r.rows.length === i.to_inspect.length,
        `"${i.on_shelf} packs on the Returned shelf" (${i.shelf.map((s) => `${s.sku_code} ${s.packs} at ${s.godown}`).join(', ')}); To inspect ${r.counts.to_inspect}: ${r.rows.map((x) => `${x.return_no} ${x.customer} ${x.items} ${x.reason}`).join('; ')}; tabs ${JSON.stringify(r.counts)}`); }
    if (run('12.2')) { await fresh(); T('12.2', 'A return outside the window needs approval');
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 10 }]); await backdate(o.no, 15);
      const src = (await api(SH, 'GET', `/commerce/orders/${o.no}/returnable`)).data;
      const e = await newReturn(o.no, []);
      const big = await api(SH, 'POST', `/commerce/orders/${o.no}/returns`, { reason_id: await reasonId(), collection: 'bring', lines: [{ sku_code: SKU, batch_id: src.lines[0].batch_id, qty: src.lines[0].qty + 2 }] });
      const r = await newReturn(o.no, [{ sku_code: SKU, qty: 4 }], { reason_note: 'Packs crushed in the box', collection: 'trip' });
      const w = (await api(SH, 'GET', '/sales/returns?tab=waiting')).data;
      const a = await pendingOf('return_window', r.data.return_no);
      ok(src.days === 15 && src.days > src.window_days && e.status === 400 && big.status >= 400 && r.status < 300 && a && w.rows.some((x) => x.return_no === r.data.return_no),
        `delivered ${src.days} days ago, window ${src.window_days}: lines ${src.lines.map((l) => `${l.sku_code} up to ${l.qty}`).join(', ')}; nothing: "${e.msg}"; 12: "${big.msg}"; saved ${r.data && r.data.return_no}, Waiting tab, card #${a && a.approval_id} "${a && a.summary}"`);
      const d = await decideAny(a.approval_id);
      const c = (await api(SH, 'GET', '/sales/returns?tab=to_collect')).data;
      ok(d.status === 200 && c.rows.some((x) => x.return_no === r.data.return_no), `approved by Anitha (${d.status}): in To collect (${c.counts.to_collect})`); }
    if (run('12.3')) { await fresh(); T('12.3', 'Collect it on the next trip');
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 10 }]);
      const r = (await newReturn(o.no, [{ sku_code: SKU, qty: 4 }], { collection: 'trip' })).data;
      const before = (await api(SH, 'GET', '/sales/returns/inspection')).data.on_shelf;
      const t = await api(SH, 'POST', '/commerce/trips', { vehicle_id: 1, driver_id: 1, order_nos: [], return_nos: [r.return_no] });
      const s = await api(SH, 'POST', `/commerce/trips/${t.data && t.data.trip_id}/start`);
      const st = t.data && (await api(SH, 'GET', `/commerce/trips/${t.data.trip_id}`)).data.stops.find((x) => x.return_no === r.return_no || x.return_id);
      let p = st && await upload(RA, `/commerce/stops/${st.stop_id}/picked-up`, { receiver_name: 'Clinic nurse', qty: 4 });
      if (p && p.status === 403) p = await upload(SH, `/commerce/stops/${st.stop_id}/picked-up`, { receiver_name: 'Clinic nurse', qty: 4 });
      const i = (await api(SH, 'GET', '/sales/returns/inspection')).data;
      const d = await ret(r.return_no);
      ok(t.status < 300 && s.status < 300 && p && p.status < 300 && i.to_inspect.some((x) => x.return_no === r.return_no),
        `trip T-${t.data && t.data.trip_id} with the pickup (start ${s.status} ${s.msg || ''}); stop ${st && st.stop_id} picked up (${p && p.status} ${p && (p.msg || '')}); ${r.return_no} To inspect: ${d.status_label}, picked up ${d.picked_up_at ? 'yes' : 'no'}; shelf ${before} -> ${i.on_shelf}`); }
    if (run('12.4')) { await fresh(); T('12.4', 'Inspect, then the credit note for what came back');
      await setting('returned_resell', 1);
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 10 }]);
      const r = (await newReturn(o.no, [{ sku_code: SKU, qty: 4 }])).data; await receive(r.return_no);
      const line = (await ret(r.return_no)).lines[0];
      const bad = await api(KU, 'POST', `/commerce/returns/${r.return_no}/inspect`, { lines: [{ line_id: line.line_id, resell: 2, damaged: 1 }], note: 'Two packs crushed, two fine' });
      const [g0, d0, r0] = [await shelf(SKU, 'good'), await shelf(SKU, 'dmg'), await shelf(SKU, 'ret')];
      const x = await api(KU, 'POST', `/commerce/returns/${r.return_no}/inspect`, { lines: [{ line_id: line.line_id, resell: 2, damaged: 2 }], note: 'Two packs crushed, two fine' });
      const [g1, d1, r1] = [await shelf(SKU, 'good'), await shelf(SKU, 'dmg'), await shelf(SKU, 'ret')];
      const a = await pendingOf('restock', r.return_no);
      await decideAny(a.approval_id);
      const [g2, r2s] = [await shelf(SKU, 'good'), await shelf(SKU, 'ret')];
      const b0 = await owes(HOTEL);
      const dc = await api(SH, 'POST', `/commerce/returns/${r.return_no}/decide`, { lines: [{ line_id: line.line_id, refund: 4, replace: 0, none: 0 }], method: 'balance' });
      const d = await ret(r.return_no); const cn = d.credit_notes[0];
      const b1 = await owes(HOTEL);
      ok(bad.status === 400 && x.status === 200 && x.data.waiting.length === 1 && d1 - d0 === 2 && r1 - r0 === 2 && g1 === g0 && g2 - g1 === 2 && r2s === r0,
        `3 of 4: "${bad.msg}"; saved: "${x.data && x.data.message}"; Damaged +${d1 - d0}, Returned +${r1 - r0} (Good unchanged ${g0}); after Anitha signs: Good +${g2 - g1}, Returned back to ${r2s}`);
      ok(dc.status === 200 && cn && Math.abs(r2(b0 - b1) - cn.total) < 0.02, `decided ${dc.status}: ${d.status_label}; credit note ${cn && cn.credit_note_no} ${cn && cn.total} (taxable ${cn && cn.taxable} + GST); owes ${b0} -> ${b1}`);
      await setting('returned_resell', 0); }
    if (run('12.5')) { await fresh(); T('12.5', 'A short delivery comes to Inspection by itself');
      const no = await packed(OFFICE, [{ sku_code: SKU, qty: 20 }]);
      await api(SH, 'POST', '/billing/invoices', { order_no: no });
      const t = await api(SH, 'POST', '/commerce/trips', { vehicle_id: 1, driver_id: 1, order_nos: [no] }); await api(SH, 'POST', `/commerce/trips/${t.data.trip_id}/start`);
      const st = (await api(SH, 'GET', `/commerce/trips/${t.data.trip_id}`)).data.stops[0];
      const otp = (await q1('SELECT otp FROM trip_stops WHERE stop_id = ?', [st.stop_id])).otp;
      let d = await api(RA, 'POST', `/commerce/stops/${st.stop_id}/delivered`, { receiver_name: 'Test', otp, signed: '1', kept: { [SKU]: 15 }, short_reason: 'Damaged in transit' });
      if (d.status === 403) d = await api(SH, 'POST', `/commerce/stops/${st.stop_id}/delivered`, { receiver_name: 'Test', otp, signed: '1', kept: { [SKU]: 15 }, short_reason: 'Damaged in transit' });
      const i = (await api(SH, 'GET', '/sales/returns/inspection')).data;
      const row = (await api(SH, 'GET', '/sales/returns?tab=closed')).data.rows.find((x) => x.order_no === no); const sh = i.shelf.find((x) => x.sku_code === SKU);
      ok(d.status === 200 && d.data.back && row && row.packs === 5 && sh && sh.packs >= 5, `"${d.data && d.data.status}", back: ${JSON.stringify(d.data && d.data.back)}; ${row && `${row.return_no} ${row.customer} ${row.packs} packs, ${row.status_label} (money settled at delivery, phase 20)`}; Inspection > Returned shelf: ${SKU} ${sh && sh.packs}`); }
    if (run('12.6')) { await fresh(); T('12.6', 'A replacement is a free order through packing');
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 15 }]);
      const src = (await api(SH, 'GET', `/commerce/orders/${o.no}/returnable`)).data;
      const r = (await newReturn(o.no, [{ sku_code: SKU, qty: 3 }], { reason_note: 'Towels tear when pulled' })).data; await receive(r.return_no);
      const line = (await ret(r.return_no)).lines[0];
      await api(KU, 'POST', `/commerce/returns/${r.return_no}/inspect`, { lines: [{ line_id: line.line_id, damaged: 3 }], note: 'Paper too thin' });
      const dc = await api(SH, 'POST', `/commerce/returns/${r.return_no}/decide`, { lines: [{ line_id: line.line_id, refund: 0, replace: 3, none: 0 }] });
      const rep = dc.data && dc.data.replacement_no && await q1('SELECT order_no, status, total, note FROM orders WHERE order_no = ?', [dc.data.replacement_no]);
      ok(src.days === 0 && ['requested', 'collecting'].includes(r.status) && rep && Number(rep.total) === 0, `delivered ${src.days} days ago, inside the window: ${r.return_no} ${r.status}; replacement ${rep && rep.order_no} ${rep && rep.status}, total ${rep && rep.total}, "${rep && rep.note}"`); }
    if (run('12.7')) { await fresh(); T('12.7', '"No refund" needs a second person');
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 10 }]);
      const r = (await newReturn(o.no, [{ sku_code: SKU, qty: 2 }], { collection: 'courier' })).data; await receive(r.return_no);
      const line = (await ret(r.return_no)).lines[0];
      const r0 = await shelf(SKU, 'ret'); const b0 = await owes(HOTEL);
      const x = await api(KU, 'POST', `/commerce/returns/${r.return_no}/inspect`, { lines: [{ line_id: line.line_id, scrap: 2 }], note: 'Opened and used' });
      const wo = await q1('SELECT w.status, w.qty FROM write_offs w JOIN return_items ri ON ri.scrap_write_off_id = w.write_off_id WHERE ri.line_id = ?', [line.line_id]);
      const dc = await api(SH, 'POST', `/commerce/returns/${r.return_no}/decide`, { lines: [{ line_id: line.line_id, refund: 0, replace: 0, none: 2 }], no_refund_reason: 'Opened and used' });
      const a = await pendingOf('no_refund', r.return_no);
      await decideAny(a.approval_id);
      const d = await ret(r.return_no); const b1 = await owes(HOTEL); const r1 = await shelf(SKU, 'ret');
      ok(x.status === 200 && wo && dc.status === 200 && d.status === 'closed' && b1 === b0 && r1 === r0,
        `inspect Scrap 2: "${x.data && x.data.message}" write-off ${wo && `${wo.qty} ${wo.status}`}; "No refund" waits (#${a && a.approval_id}); after approval ${d.status_label}; owes ${b0} -> ${b1}; Returned shelf ${r0} -> ${r1} (the 2 left stock)`); }
    if (run('12.8')) { await fresh(); T('12.8', 'A rejected check sends the inspection back');
      await setting('returned_resell', 1);
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 10 }]);
      const r = (await newReturn(o.no, [{ sku_code: SKU, qty: 6 }])).data; await receive(r.return_no);
      const line = (await ret(r.return_no)).lines[0];
      await api(KU, 'POST', `/commerce/returns/${r.return_no}/inspect`, { lines: [{ line_id: line.line_id, resell: 6 }], note: 'Looks fine' });
      const a = await pendingOf('restock', r.return_no);
      const rj = await decideAny(a.approval_id, 'rejected', 'Crushed');
      const r0 = await shelf(SKU, 'ret');
      const d = await ret(r.return_no);
      const tab = (await api(SH, 'GET', '/sales/returns/inspection')).data.to_inspect.some((x) => x.return_no === r.return_no);
      const again = await api(KU, 'POST', `/commerce/returns/${r.return_no}/reinspect`, { lines: [{ line_id: line.line_id, scrap: 6 }] });
      const d2 = await ret(r.return_no); const r1 = await shelf(SKU, 'ret');
      ok(rj.status === 200 && d.lines[0].resell_state === 'rejected' && tab && d.history.some((x) => /Sent back/.test(x.note || '')) && again.status === 200 && d2.lines[0].qty_scrap === 6 && d2.lines[0].qty_ok === 0,
        `rejected: "${(d.history.find((x) => /Sent back/.test(x.note || '')) || {}).note}"; in To inspect: ${tab}; ${r0} on the Returned shelf; again Scrap 6: "${again.data && again.data.message}" (shelf ${r0} -> ${r1})`);
      await setting('returned_resell', 0); }
    if (run('12.9')) { await fresh(); T('12.9', 'An order refused at the door comes back');
      const no = await packed(OFFICE, [{ sku_code: SKU, qty: 20 }]);
      await api(SH, 'POST', '/billing/invoices', { order_no: no });
      const t = await api(SH, 'POST', '/commerce/trips', { vehicle_id: 1, driver_id: 1, order_nos: [no] }); await api(SH, 'POST', `/commerce/trips/${t.data.trip_id}/start`);
      const st = (await api(SH, 'GET', `/commerce/trips/${t.data.trip_id}`)).data.stops[0];
      let rf = await api(RA, 'POST', `/commerce/stops/${st.stop_id}/refused`, { reason: 'Wrong address, lorry came back' });
      if (rf.status === 403) rf = await api(SH, 'POST', `/commerce/stops/${st.stop_id}/refused`, { reason: 'Wrong address, lorry came back' });
      const o = await q1('SELECT status FROM orders WHERE order_no = ?', [no]);
      const all = await qa('SELECT r.return_no, r.status FROM returns r JOIN orders o ON o.order_id = r.order_id WHERE o.order_no = ?', [no]);
      say(`refused at the door (${rf.status} ${rf.msg || ''}): order ${o.status}; returns on it: ${all.map((x) => `${x.return_no} ${x.status}`).join(', ') || 'none (the goods go back to stock with the refused trip, phase 20)'}`);
      ok(rf.status === 200, 'the refused order comes back through the trip (phase 20 flow; no money: section 10 credit note)'); }
    if (run('12.10')) { await fresh(); T('12.10', 'Who does what on Returns');
      const mu = await api(MU, 'GET', '/sales/returns?tab=closed'); const dv = await api(DV, 'GET', '/sales/returns?tab=closed'); const ku = await api(KU, 'GET', '/sales/returns?tab=closed');
      // phase 23: inspecting is the right "Inspect returns" (Operations = v23 Supervisor), not Inventory edit
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 10 }]);
      const r = (await newReturn(o.no, [{ sku_code: SKU, qty: 2 }])).data; await receive(r.return_no);
      const line = (await ret(r.return_no)).lines[0];
      const muI = await api(MU, 'POST', `/commerce/returns/${r.return_no}/inspect`, { lines: [{ line_id: line.line_id, damaged: 2 }] });
      const kuI = await api(KU, 'POST', `/commerce/returns/${r.return_no}/inspect`, { lines: [{ line_id: line.line_id, damaged: 2 }] });
      ok(mu.status === 200 && !mu.data.can.inspect && dv.status === 403 && ku.data.can.inspect && muI.status === 403 && kuI.status === 200,
        `Warehouse sees the returns but cannot inspect: ${muI.status} "${muI.msg}"; the Supervisor inspects: ${kuI.status} "${kuI.data && kuI.data.message}"`);
      ok(mu.status !== 500 && dv.status !== 500, `Murugan (Warehouse): ${mu.status} ${mu.status === 200 ? `can ${JSON.stringify(mu.data.can)}` : mu.msg}; Divya (Sales): ${dv.status} ${dv.status === 200 ? JSON.stringify(dv.data.can) : dv.msg}; Kumar (Supervisor): ${ku.status} ${ku.status === 200 ? JSON.stringify(ku.data.can) : ku.msg}`); }
    if (run('X9')) { await fresh(); T('X9', 'A later return sees what an earlier one (waiting) took');
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 10 }]); await backdate(o.no, 15);
      const a = await newReturn(o.no, [{ sku_code: SKU, qty: 6 }]);
      const src = (await api(SH, 'GET', `/commerce/orders/${o.no}/returnable`)).data;
      const b = await newReturn(o.no, [{ sku_code: SKU, qty: 5 }]);
      ok(src.lines[0].qty === 4 && b.status >= 400, `first ${a.data.return_no} (waiting) takes 6: the second can take ${src.lines[0].qty}; 5: "${b.msg}"`); }
    if (run('ROOM')) { await fresh(); T('ROOM', 'A waiting return holds its room on the invoice');
      const o = await delivered(HOTEL, [{ sku_code: SKU, qty: 10 }]); await backdate(o.no, 15);
      const inv = await q1('SELECT taxable, delivery_charge FROM invoices WHERE invoice_no = ?', [o.invoice_no]);
      await newReturn(o.no, [{ sku_code: SKU, qty: 8 }]);
      const all = r2(Number(inv.taxable) + Number(inv.delivery_charge));
      const x = await api(SH, 'POST', '/billing/credit-notes', { invoice_no: o.invoice_no, why: 'Price correction', amount: String(all), note: 'Whole invoice' });
      ok(x.status === 409 && /held for returns/.test(x.msg), `invoice ${o.invoice_no} worth ${all} before GST with a waiting return of 8 of 10: a credit note for ${all}: ${x.status} "${(x.fields && x.fields.amount) || x.msg}"`); }
  },
};
