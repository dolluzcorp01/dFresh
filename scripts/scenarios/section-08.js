// Section 8 - Packing: the v23 Tests tab "8" and the fix items F1 (a part shipment: each shipment its own invoice and trip
// stop), F2 (packer lock PK1: scanned packs are locked, a pack taken since the scan or an expired batch stops Packed) and
// D1 (the stock moves exactly once: at Packed). Each "Start again" restores the dev data and builds the v23 sales sample
// and delivery masters on it (helpers-sales.js). v23 names: Kamatchi Stores 40 Table Napkins 20x20 = the sample's first
// order (v23 DFO-260029), Hotel Kanchi 24 Table Napkins 30x30 = the second (v23 DFO-260028); Kumar M (Supervisor) =
// DZIND146, Murugan S (Warehouse) = DZIND136, Divya N (Sales) = DZIND147. Run: npm run scenarios -- 8
const helpers = require('./helpers-sales');

module.exports = {
  title: 'Packing',
  async run(ctx) {
    const { api, pool, ok, say, q1, qa, approveAll, decideAny, T, fresh, run } = ctx;
    const { C, held, sample, fulfilSample, pick, scan, plines, scanAll, packFull, trip, stopsOf, shelfB, invoice } = helpers(ctx);
    const SH = 'SH'; const KU = 'KU'; const MU = 'MU'; const DV = 'DV';
    const start = async () => { await fresh(); const S = await sample(); await fulfilSample(); return S; };
    const N1 = 'DF001-M100'; const N3 = 'DF007-M100'; const WW = 'DF044-M100';

    if (run('8.1')) { const S = await start(); T('8.1', 'Only orders with held packs are ready to pick');
      const r = (await api(KU, 'GET', '/fulfil/to-pick')).data;
      const a = r.ready.find((o) => o.order_no === S.o1); const b = r.ready.find((o) => o.order_no === S.o2);
      const notReady = await qa("SELECT order_no FROM orders WHERE status IN ('approval', 'draft')");
      const bad = r.ready.filter((o) => notReady.some((x) => x.order_no === o.order_no) || !(o.held > 0));
      ok(a && a.held === 40 && b && b.held === 24 && !bad.length,
        `ready ${r.ready.length}: ${r.ready.map((o) => `${o.order_no} ${o.customer} ${o.held} held (${o.delivery_kind}, ${o.godown})`).join('; ')}; waiting for approval or drafts (not listed): ${notReady.map((x) => x.order_no).join(', ') || 'none'}; listed with nothing held: ${bad.map((o) => o.order_no).join(', ') || 'none'}`);
      say(`courier filter: ${r.ready.filter((o) => o.delivery_kind === 'courier').map((o) => o.order_no).join(', ') || 'none'} (v23 lists 2 ready; the dev data has more confirmed orders)`); }

    if (run('8.2')) { const S = await start(); T('8.2', 'A pick list for several orders');
      const e0 = await pick(KU, []);
      const r = await pick(KU, [S.o1, S.o2]);
      const l = r.data && r.data.pick_id && (await api(KU, 'GET', `/fulfil/pick-lists/${r.data.pick_id}`)).data;
      const st = await qa('SELECT order_no, status FROM orders WHERE order_no IN (?, ?)', [S.o1, S.o2]);
      const e = await api(SH, 'PUT', `/commerce/orders/${S.o1}`, { version: (await q1('SELECT version FROM orders WHERE order_no = ?', [S.o1])).version, items: [{ sku_code: N1, qty: 30, price: '' }] });
      const t1 = l && l.take.filter((t) => t.sku_code === N1).reduce((x, t) => x + Number(t.qty), 0); const t3 = l && l.take.filter((t) => t.sku_code === N3).reduce((x, t) => x + Number(t.qty), 0);
      ok(e0.status === 400 && /Tick/.test(e0.msg) && r.status < 300 && /^DFK\//.test(r.data.pick_no) && t1 === 40 && t3 === 24 && st.every((x) => x.status === 'packing') && e.status >= 400,
        `nothing ticked: "${e0.msg}"; ${r.data && r.data.pick_no}: take ${l && l.take.map((t) => `${t.name} ${t.sku_code} ${t.qty}${t.batch_no ? ` batch ${t.batch_no}` : ' (no batches)'}`).join('; ')}; orders ${st.map((x) => `${x.order_no} ${x.status}`).join(', ')}; a change in Orders: ${e.status} "${e.msg}"`); }

    if (run('8.3')) { const S = await start(); T('8.3', 'One godown per pick list');
      const r = await pick(KU, [S.o3, S.o1]);
      const r2 = await pick(SH, [S.o3, S.o1]);
      ok(r2.status === 400 && /One godown per pick list/.test(r2.msg), `${S.o3} (Chennai) with ${S.o1} (Kanchipuram): Kumar (Kanchipuram only, does not see the Chennai order) ${r.status} "${r.msg}"; Shoban ${r2.status} "${r2.msg}"`); }

    if (run('8.4')) { const S = await start(); T('8.4', 'Give it to a packer and print it');
      const r = await pick(KU, [S.o1, S.o2]);
      const l0 = (await api(KU, 'GET', `/fulfil/pick-lists/${r.data.pick_id}`)).data;
      const g = await api(KU, 'PUT', `/fulfil/pick-lists/${r.data.pick_id}/packer`, { packer: 'DZIND136' });
      const l = (await api(KU, 'GET', `/fulfil/pick-lists/${r.data.pick_id}`)).data;
      const off = l0.packers.map((p) => p.emp_id);
      ok(g.status === 200 && off.includes('DZIND136') && !off.includes('DZIND150') && !off.includes('DZIND147') && l.packer_name && l.godown && l.take.length === 2 && l.orders.length === 2,
        `packers offered: ${l0.packers.map((p) => `${p.emp_id} ${p.name}`).join(', ')} (Edit on Packing at Kanchipuram; not Lakshmi at Chennai, not Sales); give: "${g.data && g.data.message}"; print: ${l.pick_no}, ${l.godown}, packer ${l.packer_name}, ${l.take.length} lines with batch, orders ${l.orders.map((o) => o.order_no).join(', ')}`); }

    if (run('8.5') || run('8.6')) { const S = await start(); T('8.5', 'Scanning refuses mistakes');
      await pick(KU, [S.o1]);
      const res = [];
      for (const [c, n] of [['XYZ', 1], [N3, 1], [N1, 30], [`${N1}#C`, 1]]) { const s = await scan(MU, S.o1, c, n); res.push({ c, n, st: s.status, r: s.data && s.data.result, m: (s.data && s.data.message) || s.msg }); }
      ok(res[0].r === 'unknown' && res[1].r === 'wrong_sku' && /put it back/.test(res[1].m) && res[2].r === 'ok' && /30 of 40/.test(res[2].m) && res[3].r === 'too_many' && /only 10 more/.test(res[3].m),
        res.map((x) => `${x.c} x${x.n}: ${x.r} "${x.m}"`).join(' | '));
      if (run('8.6')) { T('8.6', 'Short at packing: the supervisor finishes it');
        const m = await api(MU, 'POST', `/commerce/packing/${S.o1}/packed`, { cartons: 1, weight_kg: '3', short: { [N1]: 'damaged' } });
        const k0 = await api(KU, 'POST', `/commerce/packing/${S.o1}/packed`, { cartons: 1, weight_kg: '3' });
        const g0 = await shelfB(N1); const d0 = await shelfB(N1, 'dmg');
        const k = await api(KU, 'POST', `/commerce/packing/${S.o1}/packed`, { cartons: 1, weight_kg: '3', short: { [N1]: 'damaged' } });
        const g1 = await shelfB(N1); const d1 = await shelfB(N1, 'dmg');
        const bo = (await api(SH, 'GET', '/sales/back-orders')).data.rows.filter((x) => [S.o1, k.data && k.data.balance_no].includes(x.order_no));
        const owed = k.data && k.data.balance_no ? Number((await q1('SELECT COALESCE(SUM(i.qty), 0) n FROM order_items i JOIN orders o USING (order_id) WHERE o.order_no = ?', [k.data.balance_no])).n) : 0;
        ok(m.status === 403 && /supervisor/i.test(m.msg) && k0.status === 400 && /Say why/.test(k0.msg) && k.status === 200 && k.data.packed === 30 && g0 - g1 === 40 && d1 - d0 === 10 && owed === 10,
          `Murugan: ${m.status} "${m.msg}"; Kumar, no reason: "${k0.msg}"; found damaged: "${k.data && k.data.message}" packed ${k.data && k.data.packed}, short ${k.data && k.data.short}, damaged ${k.data && k.data.damaged}, balance ${k.data && k.data.balance_no}; good ${g0} -> ${g1}, Damaged shelf ${d0} -> ${d1}; the 10 short wait on the balance order ${k.data && k.data.balance_no} (${owed} packs; v23 shows them in Back-orders "After this shipment leaves", ours ship them as the next part shipment, fix F1); back-order rows ${bo.map((x) => `${x.order_no} ${x.back_qty} ${x.state}`).join(', ') || 'none'}`); } }

    if (run('8.7') || run('8.11')) { const S = await start(); T('8.7', 'Packing done takes the packs off the shelf');
      await pick(KU, [S.o1]);
      const s = await scan(MU, S.o1, `${N1}#C`, 1);
      const per = Number((await q1('SELECT packs_per_carton n FROM skus WHERE sku_code = ?', [N1])).n);
      if (per < 40) await scan(MU, S.o1, N1, 40 - per); // a carton of DF001-M100 is 24 packs on the dev data (v23 40): the rest as packs
      const p0 = await api(MU, 'POST', `/commerce/packing/${S.o1}/packed`, {});
      const g0 = await shelfB(N1); const f0 = (await api(SH, 'GET', `/inventory/free?godown=1&sku=${N1}`)).data.free;
      const p = await api(MU, 'POST', `/commerce/packing/${S.o1}/packed`, { cartons: 2, weight_kg: '6.5' });
      const g1 = await shelfB(N1); const f1 = (await api(SH, 'GET', `/inventory/free?godown=1&sku=${N1}`)).data.free;
      const led = await qa("SELECT delta, note FROM stock_movements WHERE ref_id = ? AND sku_code = ? ORDER BY move_id", [S.o1, N1]);
      ok(s.data && s.data.result === 'ok' && p0.status === 400 && p.status === 200 && p.data.packed === 40 && g0 - g1 === 40 && f1 === f0 && (await held(S.o1)) === 0 && led.reduce((x, l) => x + Number(l.delta), 0) === -40,
        `carton of ${per}: "${s.data && s.data.message}"; no boxes: "${p0.msg}" ${JSON.stringify(p0.fields || {})}; packed: "${p.data && p.data.message}"; good ${g0} -> ${g1}, free ${f0} -> ${f1} (unchanged), held ${await held(S.o1)}; ledger ${led.map((l) => `${l.delta} "${l.note}"`).join('; ')}`);
      if (run('8.11')) { T('8.11', 'Cancel a packed order');
        const c = await api(SH, 'POST', `/commerce/orders/${S.o1}/cancel`, { reason: 'Customer called off' });
        const g2 = await shelfB(N1);
        const last = await q1('SELECT delta, note FROM stock_movements WHERE ref_id = ? AND sku_code = ? ORDER BY move_id DESC LIMIT 1', [S.o1, N1]);
        ok(c.status === 200 && g2 === g0 && /Unpacked/i.test(last.note || ''), `cancel: ${c.status} "${c.msg || (c.data && c.data.message)}"; good ${g1} -> ${g2} (back to ${g0}); ledger ${last.delta} "${last.note}"`); } }

    if (run('8.8')) { await start(); T('8.8', 'A batch other than the oldest needs the supervisor');
      const o = await api(SH, 'POST', '/commerce/orders', { customer_id: C.hk, items: [{ sku_code: WW, qty: 10 }] });
      await approveAll(o.data.order_no || o.data.quote_no);
      const no = o.data.order_no; const pl = await pick(KU, [no]);
      const take = (await api(KU, 'GET', `/fulfil/pick-lists/${pl.data.pick_id}`)).data.take;
      const lots = (await api(MU, 'GET', `/fulfil/packing/${no}`)).data.lots[WW];
      const fefo = await q1("SELECT b.batch_no FROM batches b JOIN stock_movements m ON m.batch_id = b.batch_id AND m.location_id = 1 AND m.stock_kind = 'good' WHERE b.sku_code = ? AND b.expiry_date >= CURDATE() GROUP BY b.batch_id HAVING SUM(m.delta) > 0 ORDER BY b.expiry_date LIMIT 1", [WW]);
      const late = await q1("SELECT b.batch_no FROM batches b JOIN stock_movements m ON m.batch_id = b.batch_id AND m.location_id = 1 AND m.stock_kind = 'good' WHERE b.sku_code = ? AND b.expiry_date >= CURDATE() GROUP BY b.batch_id HAVING SUM(m.delta) >= 10 ORDER BY b.expiry_date DESC LIMIT 1", [WW]);
      const expired = await qa('SELECT batch_no FROM batches WHERE sku_code = ? AND expiry_date < CURDATE()', [WW]);
      const need = (await plines(no)).reduce((x, l) => x + l.need, 0); // an offer may add a free pack
      const b0 = await shelfB(WW, 'good', late.batch_no);
      const s = await scan(MU, no, WW, need, late.batch_no);
      const m = await api(MU, 'POST', `/commerce/packing/${no}/packed`, { cartons: 1, weight_kg: '2' });
      const k = await api(KU, 'POST', `/commerce/packing/${no}/packed`, { cartons: 1, weight_kg: '2' });
      const b1 = await shelfB(WW, 'good', late.batch_no);
      ok(take[0].batch_no !== late.batch_no && !expired.some((x) => x.batch_no === take[0].batch_no) && !lots.some((l) => expired.some((x) => x.batch_no === l.batch_no)) && s.data && s.data.result === 'ok' && /oldest/i.test(s.data.message) && m.status >= 400 && k.status === 200 && b0 - b1 === need,
        `the pick list says take ${take.map((t) => `${t.sku_code} ${t.qty} batch ${t.batch_no} exp ${t.expiry_date}`).join('; ')} (oldest with free stock first; oldest good ${fefo.batch_no} is partly held for other orders); offered ${lots.map((l) => `${l.batch_no} ${l.qty}`).join(', ')} (expired ${expired.map((x) => x.batch_no).join(', ')} not offered); scan ${need} from ${late.batch_no}: "${s.data && s.data.message}"; Murugan: ${m.status} "${m.msg}"; Kumar: ${k.status}; ${late.batch_no} ${b0} -> ${b1}`); }

    if (run('8.9')) { await start(); T('8.9', 'Packed, waiting');
      const r = (await api(KU, 'GET', '/fulfil/packed')).data;
      const rows = r.rows; const day = rows.filter((o) => o.hours > 24);
      ok(rows.length > 0 && rows.every((o) => o.order_no && o.delivery_kind && o.hours !== undefined), `${rows.length} packed, ${day.length} more than a day${r.late !== undefined ? ` (banner ${r.late})` : ''}; ${['own', 'courier', 'pickup'].map((k) => `${k}: ${rows.filter((o) => o.delivery_kind === k).map((o) => `${o.order_no} ${o.customer} ${o.cartons} boxes ${o.weight_kg} kg waiting ${o.hours} h`).join('; ') || 'none'}`).join(' | ')}`);
      say('v23: 1 courier order DFO-260024 Ambur, 2 boxes 9.5 kg; ours are the dev packed orders.'); }

    if (run('8.10')) { await start(); T('8.10', 'Packing slip and box labels');
      const no = (await q1("SELECT order_no FROM orders WHERE status = 'packed' ORDER BY order_id DESC LIMIT 1")).order_no;
      const s = (await api(KU, 'GET', `/commerce/packing/${no}/slip`)).data;
      const priceKeys = Object.keys(s).filter((k) => /price|total|taxable|gst/.test(k)).concat(...s.lines.map((l) => Object.keys(l).filter((k) => /price|total|amount|taxable/.test(k))));
      ok(s.order_no === no && s.ship_address && s.lines.length && s.lines.every((l) => l.need > 0 || l.qty > 0) && !priceKeys.length && Number(s.cartons) >= 1,
        `slip ${s.order_no}: ${s.ship_name}, ${s.ship_address} ${s.ship_town} ${s.ship_pincode}, phone ${s.ship_phone}, PO ${s.customer_po || '-'}; lines ${s.lines.map((l) => `${l.sku_code} ${l.batch_no || '-'} ${l.need || l.qty}`).join(', ')}; prices in it: ${priceKeys.join(',') || 'none'} (cash to collect: ${s.amount_due}); labels: ${s.cartons} (Box 1 of ${s.cartons} ...)`); }

    if (run('8.12')) { const S = await start(); T('8.12', 'Packing is for the godown team');
      const d = await api(DV, 'GET', '/fulfil/to-pick');
      const m = await pick(MU, [S.o1]);
      const k = await pick(KU, [S.o1]);
      const s = await scan(MU, S.o1, N1, 40);
      ok(d.status === 403 && m.status === 403 && k.status < 300 && s.status === 200 && s.data.result === 'ok',
        `Divya (Sales): ${d.status} "${d.msg}"; Murugan (Warehouse) makes a pick list: ${m.status}; Kumar (Supervisor): ${k.status} ${k.data && k.data.pick_no}; Murugan packs: "${s.data && s.data.message}"`); }

    // ================================================================================================ fix tests
    if (run('F1')) { const S = await start(); T('F1', 'Part shipment: each shipment its own invoice and trip stop');
      await pick(KU, [S.o1]); await scanAll(S.o1, { [N1]: 15 });
      const r = await api(KU, 'POST', `/commerce/packing/${S.o1}/packed`, { cartons: 1, weight_kg: '4', short: { [N1]: 'notfound' } });
      const bal = r.data && r.data.balance_no;
      const p0 = await q1('SELECT total FROM orders WHERE order_no = ?', [S.o1]); const b0 = bal && await q1('SELECT total, status FROM orders WHERE order_no = ?', [bal]);
      await pick(KU, [bal]); await scanAll(bal);
      const rb = await api(KU, 'POST', `/commerce/packing/${bal}/packed`, { cartons: 1, weight_kg: '2' });
      const i1 = await invoice(S.o1); const i2 = await invoice(bal);
      const tid = await trip([S.o1, bal]);
      const st = await api(KU, 'POST', `/commerce/trips/${tid}/start`);
      const stops = await stopsOf(tid);
      ok(r.status === 200 && r.data.packed === 25 && bal && rb.status === 200 && rb.data.packed === 15 && i1.status === 200 && i2.status === 200 && i1.data.invoice_no !== i2.data.invoice_no && st.status === 200 && stops.length === 2,
        `packed 25 of 40, the rest on ${bal} (${b0 && b0.status}, total ${b0 && b0.total}; parent ${p0.total}); balance packed ${rb.data && rb.data.packed}; invoices ${i1.data && i1.data.invoice_no} ${i1.data && i1.data.total} and ${i2.data && i2.data.invoice_no} ${i2.data && i2.data.total}; trip start ${st.status}; stops ${stops.map((s) => `${s.seq}. ${s.order_no} collect ${s.to_collect}`).join(' | ')}`); }

    if (run('F2')) { await start(); T('F2', 'Packer lock (PK1)');
      const mk = async (cid, n) => { const o = await api(SH, 'POST', '/commerce/orders', { customer_id: cid, items: [{ sku_code: WW, qty: n }] }); await approveAll(o.data.order_no || o.data.quote_no); return o.data.order_no; };
      const a = await mk(C.ka, 10); const b = await mk(C.sd, 5);
      await pick(KU, [a]); await pick(KU, [b]);
      const lot = await q1("SELECT b.batch_id, b.batch_no, SUM(m.delta) n FROM batches b JOIN stock_movements m ON m.batch_id = b.batch_id AND m.location_id = 1 AND m.stock_kind = 'good' WHERE b.sku_code = ? AND b.expiry_date >= CURDATE() GROUP BY b.batch_id HAVING n BETWEEN 12 AND 20 ORDER BY b.expiry_date LIMIT 1", [WW]);
      const n0 = Number(lot.n);
      const needA = (await plines(a)).reduce((x, l) => x + l.need, 0);
      const s1 = await scan(KU, a, WW, needA, lot.batch_no);
      const lots = (await api(KU, 'GET', `/fulfil/packing/${b}`)).data.lots[WW].find((l) => l.batch_no === lot.batch_no);
      const s2 = await scan(KU, b, WW, 5, lot.batch_no);
      await pool.query("INSERT INTO stock_movements (sku_code, location_id, stock_kind, move_type, delta, batch_id, unit_cost, ref_type, ref_id, note, emp_id) VALUES (?, 1, 'good', 'adjust', -5, ?, 0, 'test', 'PK1', 'test: taken since the scan', 'DZIND002')", [WW, lot.batch_id]);
      const p1 = await api(KU, 'POST', `/commerce/packing/${a}/packed`, { cartons: 1, weight_kg: '2' });
      await pool.query("DELETE FROM stock_movements WHERE ref_type = 'test' AND ref_id = 'PK1'");
      await pool.query('UPDATE batches SET expiry_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY) WHERE batch_id = ?', [lot.batch_id]);
      const p2 = await api(KU, 'POST', `/commerce/packing/${a}/packed`, { cartons: 1, weight_kg: '2' });
      ok(s1.data.result === 'ok' && lots && Number(lots.qty) === n0 - needA && s2.data.result !== 'ok' && p1.status >= 400 && !/short/.test(p1.msg) && p2.status >= 400 && !/short/.test(p2.msg),
        `${lot.batch_no} has ${n0}; ${needA} scanned into ${a}: "${s1.data.message}"; ${b} sees ${lots && lots.qty} free${lots && lots.locked ? ` (${lots.locked} locked)` : ''}; 5 more into ${b}: "${s2.data.message}"; Packed after 5 were taken: ${p1.status} "${p1.msg}"; after the batch expired: ${p2.status} "${p2.msg}"`); }

    if (run('D1')) { const S = await start(); T('D1', 'One order: packed, dispatched, delivered; the stock moves exactly once');
      const g = [await shelfB(N1)];
      await packFull(S.o1, 2, '6.5'); g.push(await shelfB(N1));
      await invoice(S.o1);
      const tid = await trip([S.o1]); await api(KU, 'POST', `/commerce/trips/${tid}/start`); g.push(await shelfB(N1));
      const st = (await stopsOf(tid))[0];
      await api('RA', 'POST', `/commerce/stops/${st.stop_id}/delivered`, { receiver_name: 'Test', otp: (await q1('SELECT otp FROM trip_stops WHERE stop_id = ?', [st.stop_id])).otp, signed: '1' }); g.push(await shelfB(N1));
      const mv = await qa('SELECT move_type, stock_kind, delta FROM stock_movements WHERE ref_id = ? ORDER BY move_id', [S.o1]);
      ok(g[0] - g[1] === 40 && g[1] === g[2] && g[2] === g[3] && mv.length >= 1 && mv.reduce((x, m) => x + Number(m.delta), 0) === -40,
        `DF001-M100 good: before ${g[0]} | packed ${g[1]} | dispatched ${g[2]} | delivered ${g[3]}; stock moves for ${S.o1}: ${mv.map((m) => `${m.move_type} ${m.stock_kind} ${m.delta}`).join(', ')}`); }
    void [plines];
  },
};
