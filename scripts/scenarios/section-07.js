// Section 7 - Orders: the v23 Tests tab "7" and the sales fix items Low3 c (a back-order is held as soon as stock lands),
// Low4 a (the form shows the price the save will use), Low4 c (drop a back-order), Low4 e (no margin text without See
// cost) and the value checks. Each "Start again" restores the dev data and builds the v23 sales sample on it
// (helpers-sales.js): Kamatchi 40 table napkins and Hotel Kanchi 24 confirmed and held, Padur (Chennai) from its quote with
// 10 rolls on back-order, quotes 0001 expired / 0002 won / 0003 for an enquiry, standing order STO-0001 due today.
// Run: npm run scenarios -- 7
const helpers = require('./helpers-sales');

module.exports = {
  title: 'Orders',
  async run(ctx) {
    const { api, pool, ok, say, q1, qa, approveAll, decide, decideAny, pendingOf, T, fresh, run, r2, today, enc } = ctx;
    const { C, addD, lid, held, back, ver, itemsOf, free, pendingLike, sample } = helpers(ctx);
    const SH = 'SH'; const PV = 'PV'; const DV = 'DV'; const KU = 'KU';
    const start = async () => { await fresh(); return sample(); };

    if (run('7.1')) { const S = await start(); T('7.1', 'Open orders hold the packs Inventory shows');
      const r = (await api(SH, 'GET', '/commerce/orders?status=new')).data;
      const o1 = r.rows.find((o) => o.order_no === S.o1); const o2 = r.rows.find((o) => o.order_no === S.o2); const o3 = r.rows.find((o) => o.order_no === S.o3);
      const inv = (await api(SH, 'GET', '/inventory/stock?godown=1')).data.rows.find((x) => x.sku_code === 'DF001-M100');
      const resK = Number((await q1("SELECT COALESCE(SUM(qty), 0) n FROM stock_reservations WHERE sku_code = 'DF001-M100' AND status = 'active'")).n); // the stock row adds up the godowns in view
      ok(o1 && o1.held === 40 && o1.hours_left > 40 && o2 && o2.held === 24 && o3 && o3.back === 10 && inv && Number(inv.held) === resK,
        `Confirmed: ${S.o1} ${o1 && o1.customer} ${o1 && o1.held} of ${o1 && o1.units} held, ${o1 && o1.hours_left} h left; ${S.o2} ${o2 && o2.held} of ${o2 && o2.units}; ${S.o3} (Chennai) ${o3 && o3.held} held, ${o3 && o3.back} on back-order | Stock status DF001-M100 held ${inv && inv.held} = reservations ${resK}`);
      const tabs = (await api(SH, 'GET', '/commerce/orders')).data.counts;
      say(`tabs: ${JSON.stringify(tabs)} (v23: Confirmed 2, Packing and packed 1, Dispatched 1, Delivered 1, Cancelled 1; ours are the dev orders)`); }

    if (run('7.2')) { await start(); T('7.2', "Prices come from the customer's list");
      const r = await api(DV, 'POST', '/commerce/orders/preview', { customer_id: C.an, items: [{ sku_code: 'DF002-M100', qty: 20, price: '' }] });
      const pl = r.data.lines[0]; const tt = r.data.totals;
      ok(r.status === 200 && pl.list_price > 0 && pl.price === pl.list_price && Math.abs(r2(tt.taxable + tt.cgst + tt.sgst + (tt.igst || 0) + (tt.round_off || 0)) - tt.total) < 0.02 && tt.cgst === tt.sgst && r.data.free_now['DF002-M100'] >= 0,
        `Annapoorna, DF002-M100 20: list ${pl.list_price}, GST ${pl.gst_rate}%, ${r.data.free_now['DF002-M100']} free at Kanchipuram; total ${tt.total} (CGST ${tt.cgst} + SGST ${tt.sgst}); approvals: ${r.data.holds.map((x) => `${x.label}: ${x.what}`).join('; ') || 'none'}`);
      say('v23: Rs 51.00 (Restaurant list, 20+ slab), total Rs 1,204.00, waits for "overdue Rs 14,160". Ours: our list prices; Annapoorna has nothing overdue on the dev data (7.3 uses a customer that has).'); }

    if (run('7.3')) { await start(); T('7.3', 'Credit trouble waits for a second person');
      const ovd = await q1(`SELECT o.customer_id FROM invoices i JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id WHERE c.status = 'active' AND i.status = 'issued' AND o.amount_due > 0.005 AND i.due_on < CURDATE() AND o.status <> 'cancelled' AND (o.payment_terms <> 'cod' OR o.status = 'delivered') ORDER BY o.customer_id LIMIT 1`);
      const free0 = await free('DF002-M100');
      const r = await api(SH, 'POST', '/commerce/orders', { customer_id: ovd.customer_id, items: [{ sku_code: 'DF002-M100', qty: 20 }] });
      const free1 = await free('DF002-M100');
      const tab = (await api(SH, 'GET', '/commerce/orders?status=approval')).data.rows.some((o) => o.order_no === r.data.order_no);
      const ap3 = await pendingLike('credit_order', `${r.data.order_no}%`);
      const d3 = ap3 ? await decideAny(ap3.approval_id) : { status: 0 };
      const od3 = (await api(SH, 'GET', `/commerce/orders/${r.data.order_no}`)).data;
      ok(r.data.status === 'approval' && tab && free1 === free0 && d3.status === 200 && od3.status === 'new' && od3.held_total === 20 && od3.ok_by_name,
        `customer ${ovd.customer_id} (overdue): ${r.data.order_no} "${r.data.status_label}" (${(r.data.waits || []).join(', ')}), in the Waiting tab ${tab}, free stock ${free0} -> ${free1} (nothing held); approved: ${od3.status_label}, ${od3.held_total} of 20 held, approved by ${od3.ok_by_name}`); }

    if (run('7.4')) { await start(); T('7.4', 'A kit sells as one line; a lower price, a free item and the checks');
      const r = await api(SH, 'POST', '/commerce/orders/preview', { customer_id: C.ka, items: [{ kit_key: 'hotels', qty: 2, price: '' }] });
      const kit = r.data.kits && r.data.kits[0];
      const parts = r.data.lines.filter((l) => l.kit_key === 'hotels');
      const sumKit = r2(parts.reduce((a, l) => a + l.price * l.qty, 0));
      const kr = await api(SH, 'POST', '/commerce/orders', { customer_id: C.ka, items: [{ kit_key: 'hotels', qty: 2, price: '' }] });
      const kitHeld = kr.data && kr.data.order_no ? await held(kr.data.order_no) : 0;
      const kb = kr.data && kr.data.order_no ? await back(kr.data.order_no) : 0;
      ok(kit && parts.length >= 2 && Math.abs(sumKit - kit.price * 2) < 0.06 && kr.status === 200 && kitHeld + kb === parts.reduce((a, l) => a + l.qty, 0),
        `${kit && kit.kit_code} ${kit && kit.name} x2 at ${kit && kit.price} a kit: one line, ${parts.length} parts ${parts.map((l) => `${l.sku_code} ${l.qty} @ ${l.price}`).join(', ')} = ${sumKit}; ${kr.data && kr.data.order_no} ${kr.data && kr.data.status_label}, ${kitHeld} packs held from the parts, ${kb} on back-order`);
      const lp = (await api(SH, 'POST', '/commerce/orders/preview', { customer_id: C.hk, items: [{ sku_code: 'DF001-M100', qty: 6, price: '' }] })).data.lines[0].list_price;
      const low = await api(SH, 'POST', '/commerce/orders/preview', { customer_id: C.hk, items: [{ sku_code: 'DF001-M100', qty: 6, price: String(r2(lp * 0.92)) }] });
      ok(low.status === 200 && low.data.holds.length >= 1, `6 at 8% below the list (${lp} -> ${r2(lp * 0.92)}): checks ${low.data.holds.map((x) => `${x.label}: ${x.what}`).join('; ')}`);
      say('Ours: a kit is one line taking stock from its parts (phase 14 decision); v23 opens a kit into separate lines and checks a swap of a part (kit_swap), which has no place here. A hand-ticked free line is on quotes; on orders free lines come from offers.'); }

    if (run('7.5')) { await start(); T('7.5', 'A quote, then an order at the quoted prices');
      const r = await api(DV, 'POST', '/sales/quotes', { customer_id: C.sd, godown_id: 1, valid_until: addD(today(), 15), items: [{ sku_code: 'DF023-R1', qty: 12 }, { sku_code: 'DF038-M150', qty: 40 }], send: true });
      await approveAll(r.data.order_no || r.data.quote_no);
      const qn = r.data.quote_no;
      const mo = await api(DV, 'POST', `/sales/quotes/${enc(qn)}/order`);
      const dr = (await api(DV, 'GET', `/commerce/orders/${mo.data.order_no}`)).data;
      const pv5 = await api(DV, 'POST', '/commerce/orders/preview', { order_no: mo.data.order_no, items: (await itemsOf(mo.data.order_no)).map((i) => ({ ...i, kept: true })) });
      const cf = await api(DV, 'PUT', `/commerce/orders/${mo.data.order_no}`, { version: await ver(mo.data.order_no), confirm: true, items: (await itemsOf(mo.data.order_no)).map((i) => ({ ...i, kept: true })) });
      if (cf.data && cf.data.status === 'approval') await approveAll(cf.data.order_no || cf.data.quote_no);
      const qq = await q1('SELECT status, order_id FROM quotes WHERE quote_no = ?', [qn]);
      const o5 = await q1('SELECT status FROM orders WHERE order_no = ?', [mo.data.order_no]);
      ok(['sent', 'approval'].includes(r.data.status) && mo.status === 200 && dr.status === 'draft' && dr.quote && pv5.data.lines.every((l) => l.kept === 'kept') && cf.status === 200 && o5.status === 'new' && qq.status === 'won',
        `${qn} ${r.data.status_label}, ${r.data.total}; Make order: ${mo.data.order_no} ${dr.status_label}, from quote ${dr.quote && dr.quote.quote_no}, lines "${pv5.data.lines.map((l) => l.kept).join(', ')}"; Confirm: ${cf.data && cf.data.status_label}${cf.data && cf.data.waits && cf.data.waits.length ? ` (${cf.data.waits.join(', ')})` : ''}; after approval ${o5.status}, quote ${qq.status}`); }

    if (run('7.6')) { await start(); T('7.6', 'Print and mail a quote');
      const nq = await api(DV, 'POST', '/sales/quotes', { customer_id: C.sd, godown_id: 1, valid_until: addD(today(), 15), items: [{ sku_code: 'DF023-R1', qty: 12 }, { sku_code: 'DF038-M150', qty: 40 }], send: true });
      await approveAll(nq.data.order_no || nq.data.quote_no);
      const qn = nq.data.quote_no;
      const r = await api(DV, 'GET', `/sales/quotes/${enc(qn)}`);
      const before = (await q1('SELECT COALESCE(MAX(mail_id), 0) m FROM mail_outbox')).m;
      const m = await api(DV, 'POST', `/sales/quotes/${enc(qn)}/mail`);
      const mail = await q1('SELECT to_email, status FROM mail_outbox WHERE mail_id > ? ORDER BY mail_id LIMIT 1', [before]).catch(() => null);
      ok(r.status === 200 && r.data.company && r.data.company.name && r.data.lines.every((l) => l.hsn && l.gst_rate !== undefined) && Number(r.data.totals.total) === Number(r.data.total) && m.status < 500,
        `the print view: ${r.data.company && r.data.company.name}, ${r.data.who && r.data.who.name} ${(r.data.who && r.data.who.gstin) || '(no GSTIN)'}, valid until ${r.data.valid_until}, ${r.data.lines.map((l) => `${l.sku_code} HSN ${l.hsn} ${l.gst_rate}%`).join(', ')}, total ${r.data.totals.total}; Mail to customer: ${m.status} "${m.msg || (m.data && m.data.message)}" ${mail ? `(${mail.to_email}, ${mail.status})` : ''}`); }

    if (run('7.7')) { const S = await start(); T('7.7', 'An expired quote cannot become an order');
      const r = await api(DV, 'POST', `/sales/quotes/${enc(S.q1)}/order`);
      const q1v = (await api(DV, 'GET', `/sales/quotes/${enc(S.q1)}`)).data;
      const rv = await api(DV, 'PUT', `/sales/quotes/${enc(S.q1)}`, { customer_id: C.sd, godown_id: 1, valid_until: addD(today(), 7), delivery_charge: 250, items: q1v.lines.map((l) => ({ sku_code: l.sku_code, qty: l.qty, price: l.price })), send: true, version: q1v.version });
      for (const a of (rv.data && rv.data.approvals) || []) await decideAny(a);
      const q1b = (await api(DV, 'GET', `/sales/quotes/${enc(S.q1)}`)).data;
      ok(r.status === 409 && /expired/i.test(r.msg) && q1v.state === 'expired' && !q1v.can.order && rv.status === 200 && rv.data.rev === 2 && q1b.state === 'sent' && q1b.revisions.length === 1 && q1b.can.order,
        `"${r.msg}" | Revise: Rev ${rv.data && rv.data.rev}, ${q1b.state_label}, Rev 1 in the history (${q1b.revisions[0] && q1b.revisions[0].lines.map((l) => `${l.sku_code} ${l.qty} @ ${l.price}`).join(', ')}); Make order offered again: ${q1b.can.order}; repriced: ${rv.data && rv.data.repriced}`);
      say("v23 test 7.7 keeps the old prices; its later fix O4 (and ours) prices an expired quote again from today's list when it is revised."); }

    if (run('7.8')) { const S = await start(); T('7.8', 'A quote for an enquiry');
      const l8 = await lid('DFL-260008');
      const r = await api(DV, 'POST', `/sales/quotes/${enc(S.q3)}/order`);
      const mk = await api(DV, 'POST', `/commerce/customers/from-lead/${l8}`, { address: '12, Arcot Road', pincode: '632001' });
      const q3 = await q1('SELECT customer_id FROM quotes WHERE quote_no = ?', [S.q3]);
      const mo3 = await api(DV, 'POST', `/sales/quotes/${enc(S.q3)}/order`);
      const it3 = mo3.data && mo3.data.order_no ? await itemsOf(mo3.data.order_no) : [];
      const ql3 = await qa('SELECT sku_code, price FROM quote_lines l JOIN quotes q USING (quote_id) WHERE q.quote_no = ?', [S.q3]);
      ok(r.status === 409 && /customer/i.test(r.msg) && mk.status === 200 && mk.data && q3.customer_id === mk.data.customer_id && mo3.status === 200 && it3.length && it3.every((i) => Math.abs(i.price - Number(ql3.find((x) => x.sku_code === i.sku_code).price)) < 0.005),
        `"${r.msg}" | ${mk.data && mk.data.customer_no} ${mk.data && mk.data.name} made from DFL-260008; the quote now belongs to it; Make order: ${mo3.data && mo3.data.order_no} at the quoted prices (${it3.map((i) => `${i.sku_code} ${i.price}`).join(', ')})`); }

    if (run('7.9')) { await start(); T('7.9', 'A rejected check sends the quote back');
      const pr9 = await api(DV, 'POST', '/sales/quotes/preview', { customer_id: C.am, godown_id: 1, valid_until: addD(today(), 15), items: [{ sku_code: 'DF040-M100', qty: 30 }] });
      const lp9 = pr9.data.lines[0].list_price;
      const r = await api(DV, 'POST', '/sales/quotes', { customer_id: C.am, godown_id: 1, valid_until: addD(today(), 15), items: [{ sku_code: 'DF040-M100', qty: 30, price: r2(lp9 * 0.8) }], send: true });
      const reqs = await qa("SELECT approval_id, kind FROM approvals WHERE ref_type = 'quote' AND ref_id = ? ORDER BY approval_id", [r.data.quote_no]);
      const rj = reqs[0] ? await decideAny(reqs[0].approval_id, 'rejected', 'Too low') : { status: 0 };
      const q9 = await q1('SELECT status, rej_note FROM quotes WHERE quote_no = ?', [r.data.quote_no]);
      const others = await qa("SELECT status FROM approvals WHERE ref_type = 'quote' AND ref_id = ? AND approval_id <> ?", [r.data.quote_no, reqs[0] ? reqs[0].approval_id : 0]);
      ok(r.data.status === 'approval' && reqs.length >= 1 && rj.status === 200 && q9.status === 'draft' && /rejected by/.test(q9.rej_note || '') && others.every((x) => x.status !== 'pending'),
        `${r.data.quote_no} at 20% below the list (${lp9} -> ${r2(lp9 * 0.8)}): ${(r.data.waits || []).join(', ')} (${reqs.map((x) => x.kind).join(', ')}); the first rejected: ${q9.status}, "Sent back. ${q9.rej_note}"; the other checks: ${others.map((x) => x.status).join(', ') || 'none'}`);
      say('v23 raises two cards (price below the list, and the discount); ours checks a price under the list as the discount (one card), as the old script noted.'); }

    if (run('7.10')) { const S = await start(); T('7.10', 'Standing orders make drafts, not orders');
      const r = await api(DV, 'POST', '/sales/standing/run');
      const m10 = r.data && r.data.made && r.data.made.find((m) => m.sto_no === S.s1);
      const o10 = m10 && (await api(DV, 'GET', `/commerce/orders/${m10.order_no}`)).data;
      const sto1 = await q1("SELECT DATE_FORMAT(next_on, '%Y-%m-%d') n FROM standing_orders WHERE standing_id = ?", [S.s1id]);
      const c10 = m10 && await api(SH, 'PUT', `/commerce/orders/${m10.order_no}`, { version: await ver(m10.order_no), confirm: true, items: o10.items.map((i) => ({ sku_code: i.sku_code, qty: i.qty, price: '' })) });
      if (c10 && c10.data && c10.data.status === 'approval') await approveAll(c10.data.order_no || c10.data.quote_no);
      const h10 = m10 ? await held(m10.order_no) : 0; const b10 = m10 ? await back(m10.order_no) : 0;
      ok(m10 && o10.status === 'draft' && o10.standing_no === S.s1 && sto1.n === addD(today(), 7) && c10.status === 200 && h10 + b10 === 36,
        `${S.s1} due today: ${m10 && m10.order_no} ${o10 && o10.status_label} with today's prices (${o10 && o10.items.map((i) => `${i.sku_code} ${i.qty} @ ${i.price}`).join(', ')}), ${o10 && o10.total}; next ${sto1.n}; Confirm: ${c10 && c10.data && c10.data.status_label}, ${h10} packs held${b10 ? `, ${b10} back-order` : ''} (v23 36)`); }

    if (run('7.11')) { const S = await start(); T('7.11', 'Held packs go back after the hold time');
      const f0 = await free('DF001-M100');
      await pool.query('UPDATE orders SET hold_until = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 MINUTE) WHERE order_no = ?', [S.o1]);
      const r = (await api(SH, 'GET', '/commerce/orders?status=new')).data;
      const g11 = r.rows.find((o) => o.order_no === S.o1);
      const f1 = await free('DF001-M100');
      const ha = await api(DV, 'POST', `/commerce/orders/${S.o1}/hold-again`);
      const f2 = await free('DF001-M100');
      ok(g11 && g11.hold_gone && g11.held === 0 && f1 === f0 + 40 && r.hold_gone >= 1 && ha.status === 200 && ha.data.held === 40 && f2 === f0,
        `${S.o1}: "Hold ended", ${g11 && g11.held} of 40 held; free DF001-M100 ${f0} -> ${f1}; banner: ${r.hold_gone} order(s); Hold again: ${ha.data && ha.data.held} held for another ${r.hold_hours} hours (free ${f2})`); }

    if (run('7.12')) { const S = await start(); T('7.12', 'A back-order is held when stock arrives (v23 Low3 c) and 7.13 the oldest order first');
      const b0 = await back(S.o3);
      const bl0 = (await api(PV, 'GET', '/sales/back-orders')).data.rows.find((x) => x.order_no === S.o3);
      const tr = await api(KU, 'POST', '/inventory/transfers', { from: 1, to: 2, vehicle_no: 'TN 21 AB 1234', lines: [{ sku_code: 'DF019-R10', qty: 20 }] });
      const tid = tr.data && tr.data.transfer_no && (await q1('SELECT transfer_id FROM transfers WHERE transfer_no = ?', [tr.data.transfer_no])).transfer_id;
      const rc = await api('DZIND150', 'POST', `/inventory/transfers/${tid}/receive`, { recv: [20] });
      await new Promise((res) => { setTimeout(res, 400); });
      const b1 = await back(S.o3);
      const n13 = await api(PV, 'POST', '/commerce/orders', { customer_id: C.pt, items: [{ sku_code: 'DF019-R10', qty: 15 }] });
      for (const a of (n13.data && n13.data.approvals) || []) await decideAny(a);
      const n13h = n13.data ? await held(n13.data.order_no) : 0; const n13b = n13.data ? await back(n13.data.order_no) : 0;
      const bl = (await api(PV, 'GET', '/sales/back-orders')).data.rows.filter((x) => x.sku_code === 'DF019-R10');
      ok(b0 === 10 && bl0 && bl0.state === 'waiting' && tr.status < 300 && rc.status === 200 && b1 === 0,
        `${S.o3} owed ${b0} rolls at Chennai, ${bl0 && bl0.free_now} free, "${bl0 && bl0.state}"; transfer ${tr.data && tr.data.transfer_no} received 20 by Lakshmi P (${rc.status} ${rc.msg || ''}): the back-order is held by itself, owed now ${b1}`);
      T('7.13', 'The oldest order is served first');
      ok(n13.status === 200 && n13h === 10 && n13b === 5 && bl.length && bl[0].order_no === n13.data.order_no,
        `new order ${n13.data && n13.data.order_no} 15 at Chennai: ${n13h} held (10 free after ${S.o3}), ${n13b} on back-order; Back-orders: ${bl.map((x) => `${x.order_no} ${x.back_qty} ${x.state}`).join(', ')}`);
      say('v23 7.12 holds on "Hold now"; v23 fix Low3 c (and ours) hold it as soon as the stock lands on Good, so DFO-260027 is no longer owed when the new order comes.'); }

    if (run('7.14')) { const S = await start(); T('7.14', 'Cancel before and after dispatch');
      const r = await api(SH, 'POST', `/commerce/orders/${S.o2}/cancel`, { reason: '' });
      const fA = await free('DF007-M100');
      const c2 = await api(SH, 'POST', `/commerce/orders/${S.o2}/cancel`, { reason: 'Customer changed the plan' });
      const fB = await free('DF007-M100');
      const gone = await q1("SELECT order_no FROM orders WHERE status = 'out_for_delivery' ORDER BY order_id LIMIT 1");
      const c3 = await api(SH, 'POST', `/commerce/orders/${gone.order_no}/cancel`, { reason: 'Wrong address, lorry came back' });
      const d14 = c3.data && c3.data.pending ? await decideAny(c3.data.approval_id) : { status: 0 };
      const s14 = await q1('SELECT status, cancel_reason FROM orders WHERE order_no = ?', [gone.order_no]);
      const rets = await qa('SELECT r.return_no, r.status FROM returns r JOIN orders o ON o.order_id = r.order_id WHERE o.order_no = ?', [gone.order_no]);
      ok(r.status === 400 && c2.status === 200 && fB === fA + 24 && c3.data && c3.data.pending && d14.status === 200 && s14.status === 'cancelled',
        `no reason: "${r.msg}"; ${S.o2} cancelled ("${c2.data && c2.data.message}"), free DF007-M100 ${fA} -> ${fB}; ${gone.order_no} (out for delivery): waits (#${c3.data && c3.data.approval_id} "${c3.data && c3.data.message}"); approved: ${s14.status} (${s14.cancel_reason})`);
      // the packs are still on the vehicle: nothing back on a shelf yet (before phase 23 they went straight to Good)
      const backNow = await q1("SELECT COUNT(*) AS n FROM stock_movements WHERE ref_type = 'order' AND ref_id = ? AND delta > 0", [gone.order_no]);
      ok(rets.length === 1 && rets[0].status === 'collecting' && Number(backNow.n) === 0,
        `a return to collect for the goods of ${gone.order_no} (v23: Returns > Return requests, section 12): ${rets.map((x) => `${x.return_no} ${x.status}`).join(', ') || 'none'}; packs back on a shelf at the approval: ${backNow.n}`);
      if (rets.length === 1) { // received and inspected at the godown: Damaged shelf, closed, no refund (the invoice's credit note settled it)
        const rn = rets[0].return_no;
        const items = await qa('SELECT i.line_id, i.sku_code, i.qty, b.batch_no FROM return_items i JOIN returns r ON r.return_id = i.return_id LEFT JOIN batches b ON b.batch_id = i.batch_id WHERE r.return_no = ?', [rn]);
        const cn0 = await q1('SELECT COUNT(*) AS n FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id JOIN orders o ON o.order_id = i.order_id WHERE o.order_no = ?', [gone.order_no]);
        let scans = 0;
        for (const it of items) for (let k = 0; k < Number(it.qty); k += 1) { const s = await api(SH, 'POST', `/commerce/returns/${rn}/scan`, { code: it.batch_no ? `${it.sku_code}/${it.batch_no}` : it.sku_code }); if (s.status === 200) scans += 1; }
        const ins = await api(SH, 'POST', `/commerce/returns/${rn}/inspect`, { lines: items.map((it) => ({ line_id: it.line_id, damaged: Number(it.qty) })), note: 'Came back on the lorry' });
        const r2x = await q1('SELECT status FROM returns WHERE return_no = ?', [rn]);
        const cn1 = await q1('SELECT COUNT(*) AS n FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id JOIN orders o ON o.order_id = i.order_id WHERE o.order_no = ?', [gone.order_no]);
        const dmg = await q1("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE ref_type = 'return' AND ref_id = ? AND stock_kind = 'dmg'", [rn]);
        const packs = items.reduce((a, it) => a + Number(it.qty), 0);
        ok(scans === packs && ins.status === 200 && r2x.status === 'closed' && Number(dmg.n) === packs && Number(cn1.n) === Number(cn0.n),
          `${rn}: ${scans} of ${packs} packs scanned in; inspected (damaged) -> ${r2x.status} "${ins.data && ins.data.message}"; ${dmg.n} packs on the Damaged shelf; credit notes on ${gone.order_no}: ${cn0.n} -> ${cn1.n} (none added)`);
      } }

    if (run('7.15')) { const S = await start(); T('7.15', 'Sales work on their own customers');
      const r = (await api(DV, 'GET', '/commerce/orders')).data;
      const dvCusts = new Set(r.rows.map((o) => o.customer));
      const qd = (await api(DV, 'GET', '/sales/quotes')).data.rows.map((x) => x.quote_no);
      const one = await api(DV, 'GET', `/commerce/orders/${S.o3}`);
      ok(r.ownOnly !== false && !r.rows.some((o) => o.order_no === S.o3) && r.rows.some((o) => o.order_no === S.o1) && r.rows.some((o) => o.order_no === S.o2) && one.status >= 400 && !qd.includes(S.q2) && qd.includes(S.q3) && qd.includes(S.q1),
        `Divya's orders: ${r.rows.length} (customers ${[...dvCusts].join(', ')}), not ${S.o3} (Pavithran's Padur, opening it: ${one.status}); quotes: ${qd.join(', ')} (not ${S.q2})`);
      const cx = await api(DV, 'GET', `/commerce/orders/${S.o1}`);
      say(`Cancel on a confirmed order for Divya: ${JSON.stringify(cx.data && cx.data.can)} (our built-in Sales role has Cancel on Orders; v23 Sales has none - untick Cancel on Orders for Sales in Roles for v23)`); }

    if (run('7.16')) { const S = await start(); T('7.16', 'Changing a confirmed order is a revision');
      const before16 = await itemsOf(S.o1);
      const r = await api(DV, 'PUT', `/commerce/orders/${S.o1}`, { version: await ver(S.o1), items: [{ sku_code: 'DF001-M100', qty: 60, price: '' }] });
      for (const a of (r.data && r.data.approvals) || []) await decideAny(a);
      const d16 = (await api(DV, 'GET', `/commerce/orders/${S.o1}`)).data;
      const pv = await api(DV, 'POST', '/commerce/orders/preview', { customer_id: C.ka, items: [{ sku_code: 'DF001-M100', qty: 60, price: '' }] });
      const rev1 = d16.revisions && d16.revisions[0];
      ok(r.status === 200 && r.data.rev === 2 && rev1 && rev1.rev === 1 && rev1.lines[0].qty === 40 && d16.held_total + d16.back_total === 60 && Math.abs(d16.items[0].price - pv.data.lines[0].price) < 0.005,
        `Rev ${r.data && r.data.rev}: ${d16.held_total} held${d16.back_total ? `, ${d16.back_total} back-order` : ''}; Earlier revisions: Rev 1 ${rev1 && rev1.lines.map((l) => `${l.sku_code} ${l.qty} @ ${l.price}`).join(', ')} (was ${before16.map((i) => `${i.qty} @ ${i.price}`).join()}); now ${d16.items.map((i) => `${i.qty} @ ${i.price}`).join()} = the price at 60 (${pv.data.lines[0].price}, priced again)`);
      const sk = await q1("SELECT s.sku_code, s.min_order_qty m, s.step_qty st FROM skus s WHERE s.is_active = 1 AND s.min_order_qty > 1 ORDER BY s.sku_code LIMIT 1").catch(() => null);
      if (sk) {
        const a = await api(SH, 'POST', '/commerce/orders/preview', { customer_id: C.hk, items: [{ sku_code: sk.sku_code, qty: Number(sk.m) - 1 }] });
        ok(a.status === 400, `${sk.sku_code} below its minimum ${sk.m}: ${a.status} "${a.msg}" ${JSON.stringify(a.fields || (a.data && a.data.fields) || {})}`);
      } else say('no pack on the dev data has a minimum order above 1 (v23 "At least 48 (sold by the carton)"): not checked');
      const z = await api(SH, 'POST', '/commerce/orders', { customer_id: C.hk, items: [{ sku_code: 'DF002-M100', qty: 10, price: '0' }] });
      ok(z.status === 400 || (z.data && z.data.status === 'approval'), `Restaurant Napkins at price 0 (v23 "Zero? Tick Free instead and say why"): ${z.status} "${z.msg || (z.data && z.data.status_label)}" ${JSON.stringify(z.fields || {})}`); }

    // ================================================================================================ fix tests
    if (run('Low4a')) { await start(); T('Low4a', 'The form shows the price the save will use (quote expired)');
      const qa0 = await api(DV, 'POST', '/sales/quotes', { customer_id: C.sd, godown_id: 1, valid_until: addD(today(), 5), items: [{ sku_code: 'DF023-R1', qty: 12, price: '' }], send: true });
      const lpA = (await api(DV, 'GET', `/sales/quotes/${enc(qa0.data.quote_no)}`)).data.lines[0];
      await pool.query('UPDATE quote_lines SET price = ? WHERE quote_id = (SELECT quote_id FROM quotes WHERE quote_no = ?)', [r2(lpA.price * 0.9), qa0.data.quote_no]);
      const oa = await api(DV, 'POST', `/sales/quotes/${enc(qa0.data.quote_no)}/order`);
      const keptP = await api(DV, 'POST', '/commerce/orders/preview', { order_no: oa.data.order_no, items: (await itemsOf(oa.data.order_no)).map((i) => ({ ...i, kept: true })) });
      await pool.query('UPDATE quotes SET valid_until = ? WHERE quote_no = ?', [addD(today(), -1), qa0.data.quote_no]);
      const expP = await api(DV, 'POST', '/commerce/orders/preview', { order_no: oa.data.order_no, items: (await itemsOf(oa.data.order_no)).map((i) => ({ ...i, kept: true })) });
      const sv = await api(DV, 'PUT', `/commerce/orders/${oa.data.order_no}`, { version: await ver(oa.data.order_no), items: (await itemsOf(oa.data.order_no)).map((i) => ({ ...i, kept: true })) });
      const savedP = (await itemsOf(oa.data.order_no))[0].price;
      ok(keptP.data.lines[0].kept === 'kept' && expP.data.lines[0].kept === 'repriced' && Math.abs(expP.data.lines[0].price - savedP) < 0.005 && sv.status === 200,
        `kept: ${keptP.data.lines[0].price} (kept from when it was made); the quote expires: the form shows ${expP.data.lines[0].price} (priced again), list ${expP.data.lines[0].list_price}; saved: ${savedP}`); }

    if (run('Low4c')) { const S = await start(); T('Low4c', 'Drop a back-order');
      const t0 = Number((await q1('SELECT total FROM orders WHERE order_no = ?', [S.o3])).total);
      const r = await api(PV, 'POST', '/sales/back-orders/drop', { order_no: S.o3, sku_code: 'DF019-R10' });
      const o3b = await q1("SELECT total, (SELECT SUM(qty) FROM order_items i WHERE i.order_id = o.order_id AND sku_code = 'DF019-R10') q, (SELECT SUM(dropped_qty) FROM order_items i WHERE i.order_id = o.order_id) d, (SELECT SUM(line_total) FROM order_items i WHERE i.order_id = o.order_id) lt, delivery_charge, delivery_gst, round_off FROM orders o WHERE order_no = ?", [S.o3]);
      const sumCheck = r2(Number(o3b.lt) + Number(o3b.delivery_charge) + Number(o3b.delivery_gst) + Number(o3b.round_off));
      ok(r.status === 200 && r.data.dropped === 10 && Number(o3b.d) === 10 && Math.abs(sumCheck - Number(o3b.total)) < 0.01 && (await back(S.o3)) === 0,
        `${S.o3}: dropped ${r.data && r.data.dropped} DF019-R10 (now ${o3b.q}), total ${t0} -> ${Number(o3b.total)} (= lines + delivery + round off ${sumCheck}); wallet freed ${r.data && r.data.wallet_freed}`); }

    if (run('Low4e')) { await start(); T('Low4e', 'Without See cost: no margin text on the form, a "Price check" on save');
      await pool.query("UPDATE skus SET std_cost = 200 WHERE sku_code = 'DF001-M100'");
      const r = await api(DV, 'POST', '/commerce/orders/preview', { customer_id: C.ka, items: [{ sku_code: 'DF001-M100', qty: 10, price: '' }] });
      const listE = r.data.lines[0].list_price;
      const rT = await api(DV, 'POST', '/commerce/orders/preview', { customer_id: C.ka, items: [{ sku_code: 'DF001-M100', qty: 10, price: String(listE) }] });
      const sv4 = await api(DV, 'POST', '/commerce/orders', { customer_id: C.ka, items: [{ sku_code: 'DF001-M100', qty: 10, price: String(listE) }] });
      const pc = await q1("SELECT summary, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.label')) lab FROM approvals WHERE kind = 'margin_floor' AND status = 'pending' AND ref_id = ?", [sv4.data.order_no]);
      ok(!rT.data.holds.some((x) => x.kind === 'margin_floor') && rT.data.price_note && sv4.data.status === 'approval' && pc && pc.lab === 'Price check' && !/cost|margin/i.test(pc.summary),
        `form at the list Rs ${listE}: holds ${JSON.stringify(rT.data.holds.map((x) => x.label))}, note "${rT.data.price_note}"; save: ${sv4.data.status_label} "${(sv4.data.waits || []).join(', ')}"; card: ${pc && pc.lab}: "${pc && pc.summary}"`); }

    if (run('VALUE')) { await start(); T('VALUE', 'Value checks on the sample orders and quotes');
      const os = await qa("SELECT o.order_no, o.total, o.taxable, o.cgst + o.sgst + o.igst AS gst, o.round_off, (SELECT SUM(taxable) FROM order_items i WHERE i.order_id = o.order_id) lt, (SELECT SUM(cgst + sgst + igst) FROM order_items i WHERE i.order_id = o.order_id) lg, o.delivery_charge, o.delivery_gst FROM orders o WHERE o.order_id >= 30");
      const bad = os.filter((o) => Math.abs(Number(o.lt) + Number(o.delivery_charge) - Number(o.taxable)) > 0.01 || Math.abs(Number(o.lg) + Number(o.delivery_gst) - Number(o.gst)) > 0.01 || Math.abs(Number(o.taxable) + Number(o.gst) + Number(o.round_off) - Number(o.total)) > 0.01);
      ok(os.length && !bad.length, `orders of the sample: lines + delivery = taxable, GST of the lines + delivery GST = GST, taxable + GST + round off = total for ${os.length} orders (${os.map((o) => `${o.order_no} ${Number(o.total)}`).join(', ')})`, bad.map((o) => o.order_no).join(', ') || undefined);
      const qs = await qa('SELECT q.quote_no, q.total, q.taxable, q.gst, q.round_off FROM quotes q');
      const qbad = qs.filter((x) => Math.abs(Number(x.taxable) + Number(x.gst) + Number(x.round_off) - Number(x.total)) > 0.01);
      ok(qs.length && !qbad.length, `quotes: taxable + GST + round off = total for ${qs.length} (${qs.map((x) => `${x.quote_no} ${Number(x.total)}`).join(', ')})`);
      const hb = await qa("SELECT o.order_no, (SELECT SUM(qty) FROM order_items i WHERE i.order_id = o.order_id) q, (SELECT COALESCE(SUM(qty), 0) FROM stock_reservations r WHERE r.order_id = o.order_id AND r.status = 'active') h, (SELECT SUM(back_qty) FROM order_items i WHERE i.order_id = o.order_id) b FROM orders o WHERE o.status = 'new' AND o.hold_gone = 0 AND o.hold_until IS NOT NULL");
      ok(hb.length && hb.every((x) => Number(x.h) + Number(x.b) === Number(x.q)), `held + back-order = ordered for every confirmed order with a hold time: ${hb.map((x) => `${x.order_no} ${x.h}+${x.b}=${x.q}`).join(', ')}`); }
    void [pendingOf, decide];
  },
};
