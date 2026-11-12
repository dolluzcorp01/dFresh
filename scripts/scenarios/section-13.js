// Section 13 - Promotions: the v23 Tests tab "13" and the fix item "offers kept on a credit check". Our data stands in for v23's; each check works its figure out with v23's rule.
// Run: npm run scenarios -- 13
const helpers = require('./helpers-returns');

module.exports = {
  title: 'Promotions',
  async run(ctx) {
    const { api, pool, ok, say, q1, qa, setting, decide, decideAny, pendingOf, approveAll, order, packed, delivered, backdate, owes, shelf, r2, T, fresh, run, upload, enc } = ctx;
    const { reasonId, newReturn, ret, receive, promos, wal, wrow } = helpers(ctx);
    const SH = 'SH'; const PV = 'PV'; const AN = 'AN'; const KU = 'KU'; const DV = 'DV'; const MU = 'MU'; const RA = 'RA';
    const SKU = 'DF001-M100'; const WW = 'DF044-M100';
    const HOTEL = 1; const DIST = 7; const OFFICE = 5;
    void [pool, say, q1, qa, setting, decide, decideAny, pendingOf, approveAll, order, packed, delivered, backdate, owes, shelf, r2, T, fresh, upload, enc, reasonId, newReturn, ret, receive, promos, wal, wrow, SH, PV, AN, KU, DV, MU, RA, SKU, WW, HOTEL, DIST, OFFICE];
    if (run('13.1')) { await fresh(); T('13.1', 'What is on offer at the start');
      const p = await promos(); const g = (rows) => rows.reduce((a, x) => ({ ...a, [x.shown]: (a[x.shown] || 0) + 1 }), {});
      ok(p.offers.length && p.coupons.length, `offers ${JSON.stringify(g(p.offers))}: ${p.offers.map((o) => `#${o.offer_id} ${o.name} (${o.text}) ${o.shown}`).join('; ')}; coupons ${JSON.stringify(g(p.coupons))}: ${p.coupons.map((c) => `${c.code} ${c.shown}`).join(', ')}`); }
    if (run('13.2')) { await fresh(); T('13.2', 'Offers apply by themselves on an order');
      const no = await order(HOTEL, [{ sku_code: WW, qty: 20 }, { sku_code: SKU, qty: 72 }]);
      const its = await qa('SELECT i.sku_code, i.qty, i.price, i.is_free, i.offer_id, i.offer_discount FROM order_items i JOIN orders o ON o.order_id = i.order_id WHERE o.order_no = ? ORDER BY i.is_free, i.sku_code', [no]);
      const p = await promos(); const o2 = p.offers.find((o) => o.offer_id === 2); const o1 = p.offers.find((o) => o.offer_id === 1);
      ok(its.some((i) => i.sku_code === WW && Number(i.is_free) === 1 && i.qty === 2) && its.some((i) => i.sku_code === SKU && Number(i.offer_discount) > 0),
        `${no}: ${its.map((i) => `${i.sku_code} ${i.qty}${Number(i.is_free) ? ' free' : ` at ${i.price}`}${Number(i.offer_discount) ? ` (offer -${i.offer_discount})` : ''}`).join(', ')}; Offers: #2 given ${o2.given}, ${o2.orders} order, ${o2.free_packs} free; #1 given ${o1.given}`); }
    if (run('13.3')) { await fresh(); T('13.3', 'A typed price or "No offers" wins');
      const items = [{ sku_code: SKU, qty: 72 }];
      const a = (await api(SH, 'POST', '/commerce/orders/preview', { customer_id: HOTEL, items })).data;
      const b = (await api(SH, 'POST', '/commerce/orders/preview', { customer_id: HOTEL, items, no_offers: true })).data;
      ok(a.totals.offer_discount > 0 && b.totals.offer_discount === 0 && b.no_offers === true && b.totals.total > a.totals.total, `with the offer: total ${a.totals.total} (offers -${a.totals.offer_discount}); "No offers on this order": total ${b.totals.total}, no offer line`); }
    if (run('13.4')) { await fresh(); T('13.4', 'Coupons are checked');
      const items = [{ sku_code: SKU, qty: 60 }];
      const c1 = await api(SH, 'POST', '/commerce/orders', { customer_id: 11, items, coupon_code: 'welcome10' });
      const c2 = await api(SH, 'POST', '/commerce/orders', { customer_id: 11, items, coupon_code: 'WELCOME10' });
      const c3 = await api(SH, 'POST', '/commerce/orders/preview', { customer_id: HOTEL, items: [{ sku_code: SKU, qty: 10 }], coupon_code: 'HOTEL500' });
      const c4 = await api(SH, 'POST', '/commerce/orders/preview', { customer_id: HOTEL, items: [{ sku_code: SKU, qty: 10 }], coupon_code: 'NOPE' });
      const o1 = c1.status < 300 && await q1('SELECT coupon_code, discount AS discount_total, total FROM orders WHERE order_no = ?', [c1.data.order_no]);
      ok(c1.status < 300 && o1.coupon_code === 'WELCOME10' && c2.status >= 400 && c3.data.coupon_error && c4.data.coupon_error,
        `welcome10: ${c1.data && c1.data.order_no} coupon ${o1 && o1.coupon_code}, total ${o1 && o1.total}; again: "${c2.msg}"; HOTEL500 on a small order: "${c3.data && c3.data.coupon_error}"; NOPE: "${c4.data && c4.data.coupon_error}"`); }
    if (run('13.5')) { await fresh(); T('13.5', 'A new offer below cost needs two signatures');
      const empty = await api(KU, 'POST', '/commerce/offers', {});
      const body = { name: 'Wet Wipes clearance', kind: 'slab', target: WW, min_qty: 1, min_unit: 'pack', pct: 75, valid_to: '2026-11-20' };
      const r = await api(KU, 'POST', '/commerce/offers', body);
      const ws = await qa("SELECT approval_id, kind, summary FROM approvals WHERE ref_type = 'offer' AND ref_id = ? AND status = 'pending'", [String(r.data && r.data.offer_id)]);
      const self = ws[0] && await decide(KU, ws[0].approval_id);
      for (const w of ws) await decideAny(w.approval_id);
      const o = (await promos()).offers.find((x) => x.offer_id === r.data.offer_id);
      ok(empty.status === 400 && r.data.status === 'waiting' && ws.length === 2 && self.status >= 400 && o.status === 'live',
        `nothing filled: "${empty.msg}"; sent: "${r.data.message}"; cards: ${ws.map((w) => `${w.kind}: ${w.summary}`).join(' | ')}; Kumar signs himself: ${self.status} "${self.msg}"; after Anitha: ${o.shown}`); }
    if (run('13.6')) { await fresh(); T('13.6', 'A rejected offer comes back as a draft');
      const r = await api(KU, 'POST', '/commerce/offers', { name: 'Hotel napkins 3%', kind: 'slab', target: SKU, min_qty: 2, min_unit: 'carton', pct: 3, draft: true });
      const s = await api(KU, 'POST', `/commerce/offers/${r.data.offer_id}/send`);
      const a = await pendingOf('promo_new', r.data.offer_id);
      await decideAny(a.approval_id, 'rejected', 'Too early');
      const o = (await promos()).offers.find((x) => x.offer_id === r.data.offer_id);
      const again = await api(KU, 'PUT', `/commerce/offers/${r.data.offer_id}`, { name: 'Hotel napkins 3%', kind: 'slab', target: SKU, min_qty: 3, min_unit: 'carton', pct: 3, send: true });
      ok(r.data.status === 'draft' && s.data.status === 'waiting' && o.status === 'rejected' && o.rej_note && again.data.status === 'waiting', `draft -> sent (${s.data.message}) -> rejected: "${o.statusLabels || o.shown}" note "${o.rej_note}"; changed and sent again: ${again.data.status}`); }
    if (run('13.7')) { await fresh(); T('13.7', 'Make a coupon');
      const b = { kind: 'percent', value: 5, max_discount: 300, min_order: 3000, total_limit: 20, per_customer_limit: 2 };
      const x1 = await api(KU, 'POST', '/commerce/coupons', { ...b, code: 'we 1' });
      const x2 = await api(KU, 'POST', '/commerce/coupons', { ...b, code: 'WELCOME10' });
      const x3 = await api(KU, 'POST', '/commerce/coupons', { ...b, code: 'HOTEL5' });
      const a = await pendingOf('promo_new', 'HOTEL5'); await decideAny(a.approval_id);
      const c = (await promos()).coupons.find((y) => y.code === 'HOTEL5');
      ok(x1.status === 400 && x2.status === 409 && x3.data.status === 'waiting' && c.status === 'live', `"we 1": "${x1.msg}"; WELCOME10: "${x2.msg}"; HOTEL5 waits ("${x3.data.message}"), after Anitha: ${c.shown}, used ${c.uses} of ${c.total_limit}`); }
    if (run('13.8')) { await fresh(); T('13.8', 'A return below "buy X" gives back the free pack\'s value');
      await setting('returned_resell', 1);
      const o = await delivered(HOTEL, [{ sku_code: WW, qty: 20 }]);
      const inv = (await api(SH, 'GET', `/billing/invoices/${enc(o.invoice_no)}`)).data;
      const rr = await newReturn(o.no, [{ sku_code: WW, qty: 10 }]); if (rr.status >= 300) say('return:', rr.status, rr.msg);
      const r = rr.data; await receive(r.return_no);
      const ls = (await ret(r.return_no)).lines;
      const ins = await api(KU, 'POST', `/commerce/returns/${r.return_no}/inspect`, { lines: ls.map((l) => ({ line_id: l.line_id, resell: l.qty })) }); if (ins.status >= 300) say('inspect:', ins.status, ins.msg);
      const b0 = await owes(HOTEL);
      const dc = await api(SH, 'POST', `/commerce/returns/${r.return_no}/decide`, { lines: ls.map((l) => ({ line_id: l.line_id, refund: l.qty, replace: 0, none: 0 })), method: 'balance' }); if (dc.status >= 300) say('decide:', dc.status, dc.msg);
      const d = await ret(r.return_no); const cn = d.credit_notes[0];
      const cl = cn ? await qa('SELECT sku_code, qty, taxable, note FROM credit_note_lines WHERE credit_note_id = ? ORDER BY id', [cn.credit_note_id]) : [];
      const b1 = await owes(HOTEL);
      ok(cl.some((l) => Number(l.taxable) < 0 && /no longer due/.test(l.note || '')) && Math.abs(r2(b0 - b1) - cn.total) < 0.02,
        `invoice ${o.invoice_no} ${inv && inv.total} (${inv && inv.lines.map((l) => `${l.sku_code} ${l.qty}${l.is_free ? ' free' : ''}`).join(', ')}); credit note ${cn && cn.credit_note_no} ${cn && cn.total}: ${cl.map((l) => `${l.qty} x ${l.sku_code} ${l.taxable}${l.note ? ` "${l.note}"` : ''}`).join('; ')}; owes ${b0} -> ${b1}`);
      await setting('returned_resell', 0); }
    if (run('13.9')) { await fresh(); T('13.9', 'Stop an offer');
      const s = await api(SH, 'POST', '/commerce/offers/1/stop');
      const o = (await promos()).offers.find((x) => x.offer_id === 1);
      const pv = (await api(SH, 'POST', '/commerce/orders/preview', { customer_id: HOTEL, items: [{ sku_code: SKU, qty: 72 }] })).data;
      ok(s.status === 200 && o.shown === 'ended' && pv.totals.offer_discount === 0, `"${s.data && s.data.message}": ${o.shown}; a new order of 3 cartons: no offer, total ${pv.totals.total}`); }
    if (run('13.10')) { await fresh(); T('13.10', 'Who does what on Promotions');
      const dv = await api(DV, 'GET', '/commerce/promotions'); const mu = await api(MU, 'GET', '/commerce/promotions'); const ku = await api(KU, 'GET', '/commerce/promotions');
      const dvNew = await api(DV, 'POST', '/commerce/offers', { name: 'x', kind: 'slab', target: SKU, min_qty: 1, pct: 1 });
      ok(mu.status === 403, `Divya: ${dv.status} can ${JSON.stringify(dv.data && dv.data.can)}, New offer ${dvNew.status}; Murugan: ${mu.status} "${mu.msg}"; Kumar can ${JSON.stringify(ku.data && ku.data.can)}`); }
    if (run('OFFKEEP')) { await fresh(); T('OFFKEEP', 'Offers stay on an order held for a credit check');
      await pool.query('UPDATE customers SET credit_limit = 100 WHERE customer_id = ?', [HOTEL]).catch(() => null);
      const r = await api(SH, 'POST', '/commerce/orders', { customer_id: HOTEL, items: [{ sku_code: SKU, qty: 72 }] });
      const before = await q1('SELECT status, (SELECT SUM(offer_discount) FROM order_items i WHERE i.order_id = o.order_id) od FROM orders o WHERE order_no = ?', [r.data.order_no]);
      for (const a of r.data.approvals || []) await decideAny(a);
      const after = await q1('SELECT status, (SELECT SUM(offer_discount) FROM order_items i WHERE i.order_id = o.order_id) od FROM orders o WHERE order_no = ?', [r.data.order_no]);
      ok(Number(before.od) > 0 && Number(after.od) === Number(before.od), `${r.data.order_no} ${before.status} (holds ${(r.data.holds || []).map((x) => x.kind || x).join(', ') || 'none'}), offer -${before.od}; after approval ${after.status}, offer -${after.od}`); }
  },
};
