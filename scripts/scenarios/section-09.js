// Section 9 - Delivery: the v23 Tests tab "9" and the fix items F3 (Y2: the cash due per stop is that shipment's invoice
// less what is paid; a failed stop is collected once on the next trip) and FLOW (order, pick, pack by scan, part shipment,
// invoice, a trip with two orders, one delivered and one short, cash handed in). Each "Start again" restores the dev data
// and builds the v23 sales sample and delivery masters on it (helpers-sales.js): TN 21 BC 4417 (750 kg, 60 boxes, fitness
// soon), TN 21 AK 2210 two-wheeler (60 kg, 4 boxes, insurance ended 2026-10-25), TN 22 AB 9031 at Chennai; Raja K = our
// Delivery user DZIND142 on driver 1; couriers Professional (Rs 42/kg, min 150) and DTDC (Rs 48/kg, min 150); areas
// Vellore Rs 300, Ambur Rs 250 (Wed), Kanchipuram town free. Run: npm run scenarios -- 9
const helpers = require('./helpers-sales');

module.exports = {
  title: 'Delivery',
  async run(ctx) {
    const { api, pool, ok, say, q1, qa, approveAll, decideAny, T, fresh, run, r2 } = ctx;
    const { C, sample, fulfilSample, pick, scanAll, plines: plinesOf, packFull, trip, stopsOf, stopOf, otpOf, deliverStop, shelfB, invoice } = helpers(ctx);
    const SH = 'SH'; const KU = 'KU'; const DV = 'DV'; const RA = 'RA';
    const start = async () => { await fresh(); const S = await sample(); S.dtdc = (await fulfilSample()).dtdc; return S; };
    const N1 = 'DF001-M100'; const N3 = 'DF007-M100'; const WW = 'DF044-M100';
    const ord = async (no) => q1('SELECT order_no, status, total, amount_due, payment_terms FROM orders WHERE order_no = ?', [no]);
    const invs = async (no) => qa("SELECT i.invoice_no, i.total FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE o.order_no = ? AND i.status = 'issued'", [no]);
    /** a packed courier order of the dev data with its invoice (v23 DFO-260024 Ambur, courier) */
    const courierOrder = async () => {
      const cm = await q1("SELECT method_id FROM delivery_methods WHERE kind = 'courier' ORDER BY method_id LIMIT 1");
      const o = await q1("SELECT order_no FROM orders WHERE status = 'packed' ORDER BY order_id DESC LIMIT 1");
      await pool.query('UPDATE orders SET delivery_method_id = ? WHERE order_no = ?', [cm.method_id, o.order_no]);
      if (!(await invs(o.order_no)).length) await invoice(o.order_no);
      return o.order_no;
    };

    if (run('9.1')) { await start(); T('9.1', 'Vehicles, drivers, couriers and areas');
      const v = (await api(KU, 'GET', '/fulfil/vehicles')).data;
      const cs = (await api(KU, 'GET', '/fulfil/couriers')).data.rows;
      const ar = (await api(KU, 'GET', '/fulfil/areas')).data.rows;
      const v1 = v.vehicles.find((x) => x.number === 'TN 21 BC 4417'); const v2 = v.vehicles.find((x) => x.number === 'TN 21 AK 2210'); const v3 = v.vehicles.find((x) => x.number === 'TN 22 AB 9031');
      const raja = v.drivers.find((x) => x.name === 'Raja K');
      const area = (l) => ar.find((a) => a.label === l);
      ok(v1 && v1.fc_soon && !v1.problems.length && v2 && v2.problems.some((p) => /insurance ended 2026-10-25/.test(p)) && v3 && raja && raja.licence_until === '2027-08-31' && cs.some((c) => /Professional/.test(c.name) && Number(c.per_kg) === 42) && cs.some((c) => c.name === 'DTDC' && Number(c.per_kg) === 48)
        // phase 24 (one town list, field map row 75): the map town Wallajabad is a 6th area, map only (not active, no charge)
        && ar.length === 6 && area('Wallajabad') && !Number(area('Wallajabad').is_active) && Number(area('Vellore and Arakkonam').charge) === 300 && Number(area('Ambur').charge) === 250 && Number(area('Kanchipuram town').charge) === 0,
        `${v.vehicles.map((x) => `${x.number} ${x.max_kg} kg ${x.max_boxes} boxes ${x.godown || ''}${x.fc_soon ? ' fitness Soon' : ''}: ${x.problems.length ? `Cannot go out (${x.problems.join(', ')})` : 'Ready'}`).join(' | ')}; drivers ${v.drivers.map((x) => `${x.name} ${x.licence_until || '-'}`).join(', ')}; couriers ${cs.map((c) => `${c.name} ${c.per_kg}/kg min ${c.min_charge}`).join(', ')}; areas ${ar.map((a) => `${a.label} ${a.pins.join(' ')} ${a.days.join(',')} ${Number(a.charge) ? a.charge : 'free'} map ${a.show_on_map ? 'on' : 'off'}`).join(' | ')}`);
      say('v23 has 2 couriers; the dev data keeps a third (DEMO South Parcel Service).'); }

    if (run('9.2')) { await start(); T('9.2', 'The area fills the delivery charge on an order');
      // Ambur Leather Works (our CUS-0013) ships to Ambur 635802, as in v23
      await pool.query("UPDATE customer_addresses SET town = 'Ambur', pincode = '635802', delivery_area_id = NULL WHERE customer_id = ?", [C.am]);
      const pv = async (cid, extra = {}) => { const r = await api(SH, 'POST', '/commerce/orders/preview', { customer_id: cid, items: [{ sku_code: N1, qty: 10 }], ...extra }); if (r.status !== 200) say('preview:', r.status, r.msg); return r.data || { totals: {} }; };
      const a = await pv(C.am); const b = await pv(C.hk); const c = await pv(C.am, { delivery_charge: '99', delivery_charge_why: 'Agreed with the customer' });
      ok(a.delivery_area && Number(a.totals.delivery_charge) === Number(a.delivery_area.charge) && Number(a.delivery_area.charge) === 250 && (!b.delivery_area || Number(b.totals.delivery_charge) === 0) && Number(c.totals.delivery_charge) === 99 && c.delivery_typed,
        `CUS-0013 Ambur Leather Works (635802): area ${a.delivery_area && a.delivery_area.label}, charge ${a.totals.delivery_charge}, days ${a.delivery_area && a.delivery_area.days.join(',')}; CUS-0001 Hotel Kanchi: ${b.delivery_area ? b.delivery_area.label : 'no area'}, charge ${b.totals.delivery_charge} (free); typed 99: ${c.totals.delivery_charge}, kept ${c.delivery_typed}`); }

    if (run('9.3') || run('9.4')) { const S = await start(); T('9.3', 'A trip loads only what fits');
      const p1 = await packFull(S.o1, 2, '6.5'); const p2 = await packFull(S.o2, 3, '4.2');
      const d = (await api(KU, 'GET', '/commerce/delivery')).data;
      const waiting = d.orders.filter((o) => o.status === 'packed' && o.delivery_kind === 'own' && !o.trip_id).length;
      const r = await api(KU, 'POST', '/commerce/trips', { vehicle_id: 2, driver_id: 1, order_nos: [S.o1] });
      const tid = r.data && r.data.trip_id;
      const t = tid && (await api(KU, 'GET', `/commerce/trips/${tid}`)).data;
      const o1 = await ord(S.o1);
      const l = await api(KU, 'POST', `/commerce/trips/${tid}/load`, { order_no: S.o2 });
      ok(p1.status === 200 && p2.status === 200 && waiting >= 2 && r.status === 201 && t.stops[0].to_collect === Number(o1.amount_due) && l.status >= 400 && /Too heavy/.test(l.msg),
        `packed ${p1.status}/${p2.status}; waiting for our vehicle: ${waiting}; trip T-${tid} ${r.data && r.data.trip_no ? r.data.trip_no : ''} on TN 21 AK 2210 with ${S.o1}: collect ${t && t.stops[0].to_collect} (${o1.payment_terms}, due ${o1.amount_due}); load ${S.o2}: ${l.status} "${l.msg}"`);
      if (run('9.4')) { T('9.4', 'A vehicle or driver with lapsed papers cannot go out');
        const st = await api(KU, 'POST', `/commerce/trips/${tid}/start`);
        const del = await api(KU, 'DELETE', `/commerce/trips/${tid}`);
        const after = await ord(S.o1);
        const lic = await api(KU, 'PUT', '/fulfil/drivers/1', { name: 'Raja K', phone: '+91 90030 11111', emp_id: 'DZIND142', licence_no: 'TN2120190012345', licence_until: '2026-10-01', is_active: true });
        const dr = (await api(KU, 'GET', '/fulfil/vehicles')).data.drivers.find((x) => x.driver_id === 1);
        const t2 = await api(KU, 'POST', '/commerce/trips', { vehicle_id: 1, driver_id: 1, order_nos: [S.o1] });
        const s2 = t2.data && t2.data.trip_id ? await api(KU, 'POST', `/commerce/trips/${t2.data.trip_id}/start`) : t2;
        ok(st.status >= 400 && /cannot go out: insurance ended 2026-10-25/.test(st.msg) && del.status === 200 && after.status === 'packed' && lic.status === 200 && dr.problem && /licence ended 2026-10-01/.test(dr.problem) && s2.status >= 400 && /licence/.test(s2.msg),
          `start on the two-wheeler: "${st.msg}"; delete: ${del.status}, ${S.o1} ${after.status}; licence until 2026-10-01: ${lic.status} ${lic.msg || ''}, driver shows "${dr.name} (${dr.problem})"; start with him: ${s2.status} "${s2.msg}"`); } }

    let flow = null;
    if (run('9.5') || run('9.6') || run('9.7')) { const S = await start(); T('9.5', 'Start a trip: the orders are dispatched');
      await packFull(S.o1, 2, '6.5'); await packFull(S.o2, 1, '4.2');
      const tid = await trip([S.o1]);
      const l = await api(KU, 'POST', `/commerce/trips/${tid}/load`, { order_no: S.o2 });
      const mv = await api(KU, 'PUT', `/commerce/trips/${tid}/stops`, { stops: [S.o2, S.o1] });
      const g0 = await shelfB(N1);
      await invoice(S.o2); // loaded after the trip was made: its invoice too, before the goods leave (v23; 10.1)
      const s1 = await api(KU, 'POST', `/commerce/trips/${tid}/start`);
      const iv = [...await invs(S.o1), ...await invs(S.o2)];
      const os = await qa("SELECT order_no, status FROM orders WHERE order_no IN (?, ?)", [S.o1, S.o2]);
      const t = (await api(KU, 'GET', `/commerce/trips/${tid}`)).data;
      const due = r2(Number((await ord(S.o1)).amount_due) + Number((await ord(S.o2)).amount_due));
      const cash = r2(t.stops.reduce((a, s) => a + s.to_collect, 0));
      ok(l.status === 200 && mv.status === 200 && s1.status === 200 && iv.length === 2 && os.every((o) => o.status === 'out_for_delivery') && t.stops[0].order_no === S.o2 && g0 === await shelfB(N1),
        `start: ${s1.status} ${JSON.stringify(s1.data)}, with the invoices made first: ${iv.map((x) => `${x.invoice_no} ${x.total}`).join(', ')} (no invoice: refused, see 10.1); orders ${os.map((o) => `${o.order_no} ${o.status}`).join(', ')}; trip sheet ${t.stops.map((s) => `${s.seq}. ${s.order_no} ${s.cartons} boxes ${s.ship_phone || ''} collect ${s.to_collect}`).join(' | ')}, total to collect ${cash} (orders due ${due}); stock unchanged at start ${g0}`);
      flow = { S, tid }; }

    if ((run('9.6') || run('9.7')) && flow) { T('9.6', 'The driver records each stop'); const { S, tid } = flow;
      const my = await api(RA, 'GET', '/commerce/my-trips');
      const plan = await api(RA, 'GET', '/commerce/delivery');
      const k = await stopOf(tid, S.o1); const otp = await otpOf(k.stop_id);
      const a = await api(RA, 'POST', `/commerce/stops/${k.stop_id}/delivered`, { otp });
      const b = await api(RA, 'POST', `/commerce/stops/${k.stop_id}/delivered`, { receiver_name: 'Kamatchi M', otp });
      const c = await api(RA, 'POST', `/commerce/stops/${k.stop_id}/delivered`, { receiver_name: 'Kamatchi M', otp, signed: '1' });
      const part = r2(k.to_collect - 218);
      const cs0 = await api(RA, 'POST', `/commerce/stops/${k.stop_id}/cash`, { amount: String(part) });
      const cs1 = await api(RA, 'POST', `/commerce/stops/${k.stop_id}/cash`, { amount: String(part), why: 'Customer paid part, rest on account' });
      const hk = await stopOf(tid, S.o2); const r0 = await shelfB(N3, 'ret');
      const sh = await api(RA, 'POST', `/commerce/stops/${hk.stop_id}/delivered`, { receiver_name: 'Suresh P', otp: await otpOf(hk.stop_id), signed: '1', kept: JSON.stringify({ [N3]: 20 }), short_reason: 'Damaged in transit' });
      const r1 = await shelfB(N3, 'ret');
      const close = await api(RA, 'POST', `/commerce/trips/${tid}/end`, { cash_handed: String(part) });
      ok(my.status === 200 && my.data.trips.some((t) => t.trip_id === tid) && plan.status === 403 && a.status === 400 && b.status === 400 && c.status === 200 && cs0.status === 400 && cs1.status === 200 && sh.status === 200 && r1 - r0 === 4 && close.status === 403,
        `Raja: my trips ${my.data && my.data.trips.map((t) => `T-${t.trip_id} ${t.status}`).join(', ')}; plans trips: ${plan.status}; nothing filled: "${a.msg}"; no proof: "${b.msg}"; delivered: ${c.status}; cash ${part} of ${k.to_collect}, no reason: "${cs0.msg}"; with reason: "${cs1.data && (cs1.data.message || JSON.stringify(cs1.data))}"; short 20 of 24: "${sh.data && (sh.data.message || sh.data.status)}", Returned shelf ${r0} -> ${r1}; Raja closes: ${close.status} "${close.msg}"`);
      flow.part = part; flow.due = k.to_collect; }

    if (run('9.7') && flow && flow.part !== undefined) { T('9.7', 'Cash is counted by someone else; short cash needs approval'); const { tid, part } = flow;
      const handed = r2(part - 100);
      const a = await api(KU, 'POST', `/commerce/trips/${tid}/end`, { cash_handed: String(handed) });
      const b = await api(KU, 'POST', `/commerce/trips/${tid}/end`, { cash_handed: String(handed), note: 'Rs 100 short, driver to explain' });
      const c = (await api(KU, 'GET', '/fulfil/cod')).data.trips.find((t) => t.trip_id === tid);
      const nl = await q1("SELECT COUNT(*) n FROM notification_log WHERE event_key = 'cash_difference'");
      ok(a.status === 400 && /add a note/.test(a.msg) && b.status === 200 && c && r2(c.cash_collected) === part && r2(c.cash_handed) === handed,
        `Kumar hands in ${handed}, no note: "${a.msg}"; with a note: ${b.status} ${JSON.stringify(b.data)}; Cash on delivery: to collect ${c && c.cash_expected}, collected ${c && c.cash_collected}, handed in ${c && c.cash_handed}; cash difference notices ${nl.n}`);
      const ap = await q1("SELECT approval_id, kind FROM approvals WHERE status = 'pending' AND (ref_id = ? OR ref_id = ?) ORDER BY approval_id DESC LIMIT 1", [String(tid), `T-${tid}`]);
      const tr = await q1('SELECT status FROM delivery_trips WHERE trip_id = ?', [tid]);
      const amt = ap && await q1('SELECT amount FROM approvals WHERE approval_id = ?', [ap.approval_id]);
      ok(Boolean(ap) && ap.kind === 'cash_short' && tr.status === 'cashwait' && r2(amt.amount) === 318 && /Cash short by Rs 100\.00\. Plus Rs 218\.00 collected less than due/.test(b.data && b.data.message),
        `v23 (v21): Rs 100 short plus Rs 218 collected less than due go to a second person: "${b.data && b.data.message}"; approval #${ap && ap.approval_id} ${ap && ap.kind} for Rs ${amt && amt.amount}; trip ${tr.status}`);
      const d = ap ? await decideAny(ap.approval_id) : { status: 0 };
      const tr2 = await q1('SELECT status, ended_by FROM delivery_trips WHERE trip_id = ?', [tid]);
      ok(d.status === 200 && tr2.status === 'ended' && Boolean(tr2.ended_by), `approved: ${d.status}; trip ${tr2.status} (closed by ${tr2.ended_by})`); }

    if (run('9.8')) { const S = await start(); T('9.8', 'Refused at the door');
      await packFull(S.o1, 2, '6.5'); await invoice(S.o1);
      const tid = await trip([S.o1]); await api(KU, 'POST', `/commerce/trips/${tid}/start`);
      const s = await stopOf(tid, S.o1); const r0 = await shelfB(N1, 'ret');
      const r = await api(RA, 'POST', `/commerce/stops/${s.stop_id}/refused`, { reason: 'Wrong item' });
      const o = await ord(S.o1); const r1 = await shelfB(N1, 'ret');
      const f = (await api(KU, 'GET', '/fulfil/failed')).data.rows.find((x) => x.order_no === S.o1);
      ok(r.status === 200 && r1 - r0 === 40 && ['refused', 'cancelled'].includes(o.status) && f,
        `refused: "${r.data && (r.data.message || JSON.stringify(r.data))}"; ${S.o1} ${o.status}; Returned shelf ${r0} -> ${r1}; Failed / short / refused: ${f && `${f.kind} ${f.failed_reason} ${JSON.stringify(f.back)} ${f.godown} ${f.credit_note_no || ''}`}`);
      say('v23 refuses the Chennai order DFO-260027 (20 packs at Chennai); ours refuses the sample Kamatchi order at Kanchipuram (40 packs).'); }

    if (run('9.9')) { const S = await start(); T('9.9', 'Not delivered goes back to Packed, waiting');
      await packFull(S.o1, 2, '6.5'); await invoice(S.o1);
      const tid = await trip([S.o1]); await api(KU, 'POST', `/commerce/trips/${tid}/start`);
      const s = await stopOf(tid, S.o1); const g0 = await shelfB(N1);
      const r = await api(RA, 'POST', `/commerce/stops/${s.stop_id}/failed`, { reason: 'Shop / office closed' });
      const ra = await api(KU, 'POST', `/commerce/orders/${S.o1}/reattempt`);
      const w = (await api(KU, 'GET', '/fulfil/packed')).data.rows.find((o) => o.order_no === S.o1);
      ok(r.status === 200 && ra.status === 200 && w && g0 === await shelfB(N1),
        `not delivered: "${r.data && (r.data.message || JSON.stringify(r.data))}"; re-attempt: ${JSON.stringify(ra.data)}; Packed, waiting: ${w ? `${w.order_no} ${w.delivery_kind}` : 'missing'}; good ${g0} (unchanged)`); }

    if (run('9.10')) { const S = await start(); T('9.10', 'Book a courier');
      const no = await courierOrder();
      const a = await api(KU, 'POST', `/commerce/orders/${no}/courier`, { courier_id: S.dtdc, awb_no: '' });
      const o = await q1('SELECT weight_kg FROM orders WHERE order_no = ?', [no]);
      const b = await api(KU, 'POST', `/commerce/orders/${no}/courier`, { courier_id: S.dtdc, awb_no: 'D12345678' });
      const d = (await api(KU, 'GET', '/commerce/delivery')).data.orders.find((x) => x.order_no === no);
      const c = await api(KU, 'POST', `/commerce/orders/${no}/courier-delivered`, {});
      const p = (await api(KU, 'GET', '/fulfil/pod')).data.rows.find((x) => x.order_no === no);
      ok(a.status === 400 && /AWB/.test(a.msg) && b.status === 200 && d && d.tracking_link && /D12345678/.test(d.tracking_link) && c.status === 200 && p,
        `charge from ${o.weight_kg} kg: Professional Rs ${Math.max(150, Math.round(42 * o.weight_kg))}, DTDC Rs ${Math.max(150, Math.round(48 * o.weight_kg))}; no AWB: "${a.msg}"; booked DTDC: ${JSON.stringify(b.data)}; ${d && `${d.status} ${d.courier} ${d.tracking_link}`}; delivered ${c.status}; proof of delivery: ${JSON.stringify(p)}`); }

    if (run('9.11')) { await start(); T('9.11', 'The courier brings it back');
      const no = await courierOrder();
      await api(KU, 'POST', `/commerce/orders/${no}/courier`, { courier_id: 1, awb_no: 'P99887766' });
      const its = await qa('SELECT sku_code, SUM(qty) n FROM order_items i JOIN orders o USING (order_id) WHERE o.order_no = ? GROUP BY sku_code', [no]);
      const r0 = await shelfB(its[0].sku_code, 'ret');
      const r = await api(KU, 'POST', `/commerce/orders/${no}/courier-back`, { reason: 'Customer refused the parcel' });
      const r1 = await shelfB(its[0].sku_code, 'ret'); const o = await ord(no);
      ok(r.status === 200 && r1 - r0 === Number(its[0].n) && ['refused', 'cancelled'].includes(o.status),
        `came back: "${r.data && (r.data.message || JSON.stringify(r.data))}"; ${no} ${o.status}; ${its[0].sku_code} Returned shelf ${r0} -> ${r1} (${its[0].n} packs)`); }

    if (run('9.12')) { await start(); T('9.12', 'The customer picks it up');
      const pm = await q1("SELECT method_id FROM delivery_methods WHERE kind = 'pickup' ORDER BY method_id LIMIT 1");
      const o = await api(SH, 'POST', '/commerce/orders', { customer_id: C.ka, items: [{ sku_code: 'DF002-M100', qty: 10 }], delivery_method_id: pm.method_id });
      await approveAll(o.data.order_no || o.data.quote_no);
      const no = o.data.order_no; await packFull(no); await invoice(no);
      const due = (await ord(no)).amount_due;
      const r = await api(KU, 'POST', `/commerce/orders/${no}/picked-up`, { receiver_name: 'Kamatchi', phone: '90000 11111', cash: String(due), signed: '1' });
      const p = await ord(no);
      const hst = await q1('SELECT note FROM order_status_history WHERE order_id = (SELECT order_id FROM orders WHERE order_no = ?) ORDER BY history_id DESC LIMIT 1', [no]).catch(() => null);
      const cod = (await api(KU, 'GET', '/fulfil/cod')).data;
      ok(r.status === 200 && p.status === 'delivered' && Number(p.amount_due) === 0 && r.data.stranger_phone === true && (cod.pickups || cod.godown || []).some((x) => x.order_no === no),
        `${no} pickup, cash to collect ${due} (v23 Rs 625.00); collected: ${JSON.stringify(r.data)}; history "${hst && hst.note}"; order ${p.status}, due ${p.amount_due}; Cash on delivery at the godown: ${JSON.stringify((cod.pickups || cod.godown || []).slice(0, 1))}`); }

    if (run('9.13')) { await start(); T('9.13', 'Areas are unique by PIN');
      const a = await api(KU, 'POST', '/fulfil/areas', { label: 'Walajabad', towns: '631605, 631501', charge: '0', days: ['Mon', 'Thu'], godown_id: 1, show_on_map: true, is_active: true });
      const b = await api(KU, 'POST', '/fulfil/areas', { label: 'Walajabad', towns: '631605', charge: '0', days: ['Mon', 'Thu'], godown_id: 1, show_on_map: true, is_active: true });
      const w = (await api(KU, 'GET', '/fulfil/areas')).data.rows.find((x) => x.label === 'Walajabad');
      ok(a.status === 400 && /631501 already belongs/.test(JSON.stringify([a.msg, a.fields])) && b.status < 300 && w && w.days.join(',') === 'Mon,Thu',
        `631605, 631501: "${a.msg}" ${JSON.stringify(a.fields || {})}; 631605 only: ${b.status}, ${w && `${w.label} ${w.pins.join(',')} ${w.days.join(',')} ${w.charge}`}`); }

    if (run('9.14')) { const S = await start(); T('9.14', 'Delivery rights');
      await packFull(S.o1, 2, '6.5'); await invoice(S.o1);
      const ra = [await api(RA, 'GET', '/commerce/delivery'), await api(RA, 'POST', '/commerce/trips', { vehicle_id: 1, driver_id: 1, order_nos: [S.o1] }), await api(RA, 'GET', '/commerce/my-trips')];
      const dv = [await api(DV, 'GET', '/commerce/delivery'), await api(DV, 'GET', '/fulfil/pod')];
      const t = await api(KU, 'POST', '/commerce/trips', { vehicle_id: 1, driver_id: 1, order_nos: [S.o1] });
      await pool.query("UPDATE drivers SET emp_id = 'DZIND146' WHERE driver_id = 2");
      await pool.query('UPDATE delivery_trips SET driver_id = 2 WHERE trip_id = ?', [t.data.trip_id]);
      await api(KU, 'POST', `/commerce/trips/${t.data.trip_id}/start`);
      const s = await stopOf(t.data.trip_id, S.o1);
      await api(KU, 'POST', `/commerce/stops/${s.stop_id}/delivered`, { receiver_name: 'Kamatchi M', otp: await otpOf(s.stop_id), signed: '1', cash: '0' });
      const cashDue = (await stopOf(t.data.trip_id, S.o1)).cash_collected || 0;
      const e = await api(KU, 'POST', `/commerce/trips/${t.data.trip_id}/end`, { cash_handed: String(cashDue), note: 'x' });
      ok(ra[0].status === 403 && ra[1].status === 403 && ra[2].status === 200 && dv[0].status === 403 && dv[1].status === 403 && t.status === 201 && e.status === 403 && /Not your own trip/.test(e.msg),
        `Raja: office list ${ra[0].status}, new trip ${ra[1].status}, my trips ${ra[2].status} | Divya: trips ${dv[0].status}, proof of delivery ${dv[1].status} | Kumar plans a trip: ${t.status}; closes a trip he drives: ${e.status} "${e.msg}"`); }

    // ================================================================================================ fix tests
    if (run('F3')) { const S = await start(); T('F3', "Y2: cash due per stop is that shipment's invoice less what is paid");
      await pick(KU, [S.o1]); await scanAll(S.o1, { [N1]: 10 });
      const pk = await api(KU, 'POST', `/commerce/packing/${S.o1}/packed`, { cartons: 1, weight_kg: '4', short: { [N1]: 'notfound' } }); const bal = pk.data.balance_no;
      await invoice(S.o1);
      let tid = await trip([S.o1]); await api(KU, 'POST', `/commerce/trips/${tid}/start`); let st = (await stopsOf(tid))[0];
      const i1 = (await invs(S.o1))[0];
      const due1 = st.to_collect;
      await deliverStop(st);
      await api(RA, 'POST', `/commerce/stops/${st.stop_id}/cash`, { amount: String(r2(due1 - 100)), why: 'Customer paid part, rest on account' });
      await api(KU, 'POST', `/commerce/trips/${tid}/end`, { cash_handed: String(r2(due1 - 100)) });
      await pick(KU, [bal]); await scanAll(bal); await api(KU, 'POST', `/commerce/packing/${bal}/packed`, { cartons: 1, weight_kg: '1' }); await invoice(bal);
      tid = await trip([bal]); await api(KU, 'POST', `/commerce/trips/${tid}/start`); st = (await stopsOf(tid))[0];
      const i2 = (await invs(bal))[0];
      ok(r2(due1) === r2(i1.total) && r2(st.to_collect) === r2(i2.total), `trip 1: ${S.o1} (30 packs) collect ${due1} = its invoice ${i1.invoice_no} ${i1.total}; paid Rs 100 less; trip 2: ${bal} collect ${st.to_collect} = its invoice ${i2.invoice_no} ${i2.total}; ${S.o1} still owes ${(await ord(S.o1)).amount_due} (followed up in receipts, not on this trip)`);
      // a failed stop: the next trip collects the same invoice again, once
      await packFull(S.o2); await invoice(S.o2);
      tid = await trip([S.o2]); await api(KU, 'POST', `/commerce/trips/${tid}/start`); st = (await stopsOf(tid))[0]; const d1 = st.to_collect;
      await api(RA, 'POST', `/commerce/stops/${st.stop_id}/failed`, { reason: 'Shop / office closed' }); await api(KU, 'POST', `/commerce/trips/${tid}/end`, { cash_handed: '0' });
      await api(KU, 'POST', `/commerce/orders/${S.o2}/reattempt`); tid = await trip([S.o2]); await api(KU, 'POST', `/commerce/trips/${tid}/start`); st = (await stopsOf(tid))[0];
      const iv2 = await invs(S.o2);
      ok(r2(st.to_collect) === r2(d1) && iv2.length === 1, `failed on trip 1 (collect ${d1}), re-attempt on trip 2: collect ${st.to_collect}; invoices ${iv2.map((x) => `${x.invoice_no} ${x.total}`).join(', ')}`); }

    if (run('FLOW')) { const S = await start(); T('FLOW', 'Order, pick, pack by scan, part shipment, invoice, trip with two orders (one delivered, one short), cash handed in');
      const g0 = { nap: await shelfB(N1), ww: await shelfB(WW), n30: await shelfB(N3), ret: await shelfB(N3, 'ret') };
      const o = await api(SH, 'POST', '/commerce/orders', { customer_id: C.ka, items: [{ sku_code: N1, qty: 20 }, { sku_code: WW, qty: 10 }] });
      await approveAll(o.data.order_no || o.data.quote_no);
      const A = o.data.order_no;
      await pick(KU, [A, S.o2]);
      const wwNeed = (await plinesOf(A)).filter((l) => l.sku_code === WW).reduce((x, l) => x + l.need, 0); // an offer may add a free pack
      await scanAll(A, { [WW]: 4 }); await scanAll(S.o2);
      const pa = await api(KU, 'POST', `/commerce/packing/${A}/packed`, { cartons: 1, weight_kg: '3', short: { [WW]: 'notfound' } }); const B = pa.data.balance_no;
      const pb = await api(KU, 'POST', `/commerce/packing/${S.o2}/packed`, { cartons: 1, weight_kg: '4.2' });
      await invoice(A); await invoice(S.o2);
      const tid = await trip([A, S.o2]); const st = await api(KU, 'POST', `/commerce/trips/${tid}/start`);
      const ss = await stopsOf(tid); const sa = ss.find((s) => s.order_no === A); const sb = ss.find((s) => s.order_no === S.o2);
      const da = await deliverStop(sa); await api(RA, 'POST', `/commerce/stops/${sa.stop_id}/cash`, { amount: String(da.data.cash_due) });
      const db = await deliverStop(sb, { kept: JSON.stringify({ [N3]: 20 }), short_reason: 'Damaged in transit' });
      await api(RA, 'POST', `/commerce/stops/${sb.stop_id}/cash`, { amount: String(db.data.cash_due) });
      const t = (await api(KU, 'GET', `/commerce/trips/${tid}`)).data; const got = r2(t.stops.reduce((x, s) => x + s.cash_collected, 0));
      const end = await api(KU, 'POST', `/commerce/trips/${tid}/end`, { cash_handed: String(got) });
      const g1 = { nap: await shelfB(N1), ww: await shelfB(WW), n30: await shelfB(N3), ret: await shelfB(N3, 'ret') };
      const iA = (await invs(A))[0]; const iB = (await invs(S.o2))[0];
      const cn = await q1('SELECT credit_note_no, total FROM credit_notes WHERE return_id = (SELECT return_back_id FROM trip_stops WHERE stop_id = ?)', [sb.stop_id]).catch(() => null);
      const oA = await ord(A); const oB = await ord(S.o2); const oBal = await ord(B);
      ok(pa.status === 200 && pa.data.packed === 20 + wwNeed - 4 && B && pb.status === 200 && st.status === 200 && end.status === 200 && Math.abs(end.data.difference) < 0.01
        && g0.nap - g1.nap === 20 && g0.ww - g1.ww === wwNeed - 4 && g0.n30 - g1.n30 === 24 && g1.ret - g0.ret === 4 && Math.abs(Number(oA.amount_due)) < 0.01 && Math.abs(Number(oB.amount_due)) < 0.01 && cn && Math.abs(r2(iB.total - cn.total) - r2(db.data.cash_due)) < 0.01,
        `${A}: packed ${pa.data.packed}, short 4 wet wipes on ${B} (${oBal.status}); trip T-${tid} cash expected ${t.cash_expected}, collected ${got}, handed ${end.data && end.data.cash_handed}, difference ${end.data && end.data.difference}; stock good: napkins -${g0.nap - g1.nap}, wet wipes -${g0.ww - g1.ww}, 30x30 -${g0.n30 - g1.n30}, 30x30 Returned +${g1.ret - g0.ret}; ${A} invoice ${iA.invoice_no} ${iA.total}, owes ${oA.amount_due}; ${S.o2} invoice ${iB.invoice_no} ${iB.total} - credit note ${cn && cn.credit_note_no} ${cn && cn.total} = ${cn && r2(iB.total - cn.total)} collected ${db.data.cash_due}, owes ${oB.amount_due}`); }
  },
};
