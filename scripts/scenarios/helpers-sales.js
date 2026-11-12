// Shared steps for the sales, fulfilment and money scenarios (sections 6 to 11): the v23 sales sample on our data
// (sample), the v23 delivery masters and roles (fulfilSample), and small reads used by several sections.
// v23 names stand in for our demo customers (the CUS numbers stay ours):
//   CUS-0001 Demo Hotel Sangam        = Hotel Kanchi Residency (Divya, Rs 75,000, 30 days)
//   CUS-0004 Demo Care Clinic         = Sri Devi Clinic (Divya, Rs 15,000, 45 days)
//   CUS-0012 Demo Restaurant Anjappar = Annapoorna Caterers (Divya, Rs 20,000, 15 days)
//   CUS-0009 Demo Home Priya          = Kamatchi Stores (Divya, cash; from enquiry DFL-260010)
//   CUS-0013 Demo School Canteen      = Ambur Leather Works (Divya, Rs 25,000, 30 days)
//   CUS-0005 Demo Tech Park Office    = Padur Tech Park (Pavithran, Chennai, Rs 40,000, 30 days)
//   CUS-0007 Demo Distributor Vellore = Vellore Hygiene (Pavithran, on hold: cheque bounced)
// Divya N (Sales) is DZIND147 on the dev data; Kumar M (Supervisor, role 32) is DZIND146.
const C = { hk: 1, sd: 4, an: 12, ka: 9, am: 13, pt: 5, vh: 7 };
const DIVYA = 'DZIND147';
const addD = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

module.exports = (ctx) => {
  const { api, pool, q1, qa, say, today, decideAny, approveAll } = ctx;
  const q = (sql, a = []) => pool.query(sql, a);
  const must = (r, what) => { if (r.status >= 300) say(`(setup ${what}: ${r.status} ${r.msg || r.raw})`); return r.data || {}; };
  const lid = async (ref) => (await q1('SELECT lead_id FROM leads WHERE lead_ref = ?', [ref])).lead_id;
  const held = async (no) => Number((await q1("SELECT COALESCE(SUM(r.qty), 0) n FROM stock_reservations r JOIN orders o USING (order_id) WHERE o.order_no = ? AND r.status = 'active'", [no])).n);
  const back = async (no) => Number((await q1('SELECT COALESCE(SUM(i.back_qty), 0) n FROM order_items i JOIN orders o USING (order_id) WHERE o.order_no = ?', [no])).n);
  const ver = async (no) => (await q1('SELECT version FROM orders WHERE order_no = ?', [no])).version;
  const itemsOf = async (no) => (await qa('SELECT sku_code, qty, price FROM order_items i JOIN orders o USING (order_id) WHERE o.order_no = ? AND i.is_free = 0', [no])).map((i) => ({ sku_code: i.sku_code, qty: Number(i.qty), price: Number(i.price) }));
  const free = async (sku, g = 1) => (await api('SH', 'GET', `/inventory/free?godown=${g}&sku=${sku}`)).data.free;
  const pendingLike = (kind, like = '%') => q1("SELECT approval_id, summary, payload FROM approvals WHERE status = 'pending' AND kind = ? AND summary LIKE ? ORDER BY approval_id DESC LIMIT 1", [kind, like]);

  /** the v23 sales sample (enquiries, calls, samples, quotes, orders, standing orders) on our data -> the numbers made */
  async function sample() {
    const t = today();
    await q('UPDATE roles SET own_customers_only = 1 WHERE role_id = 6');
    // every dev type has a list of its own; v23 has types on the standard list (Shop), where a customer starts while a
    // non-standard type waits for approval (v23 N4)
    await q("INSERT INTO customer_types (type_key, label, list_key, sort_order, min_order_value, default_credit_days, default_credit_limit, is_active) VALUES ('shop', 'Shop', 'default', 6, 0, 0, 0, 1)");
    const cust = [[C.hk, DIVYA, 75000, 30, 1], [C.sd, DIVYA, 15000, 45, 1], [C.an, DIVYA, 20000, 15, 1], [C.ka, DIVYA, 0, 0, 1], [C.am, DIVYA, 25000, 30, 1],
      [C.pt, 'DZIND148', 40000, 30, 2], [C.vh, 'DZIND148', 100000, 30, 1]];
    for (const [id, own, lim, days, g] of cust) await q('UPDATE customers SET owner_emp_id = ?, credit_limit = ?, credit_days = ?, godown_id = ? WHERE customer_id = ?', [own, lim, days, g, id]);
    await q("UPDATE customers SET status = 'hold', hold_reason = 'Cheque for Rs 40,000 bounced on 20 Oct. Orders wait until it is cleared.' WHERE customer_id = ?", [C.vh]);
    // enquiries, one per v23 state (DFL-269001 came in this morning; DFL-260007 is a day and a half old and unanswered);
    // the dev leads all carry one phone (that of CUS-0017), so each gets its own
    const now = Date.now(); const ago = (h0) => new Date(now - h0 * 3600e3);
    await q("UPDATE leads SET phone = CONCAT('94431556', RIGHT(lead_ref, 2)), email = CONCAT('enquiry', RIGHT(lead_ref, 2), '@example.com') WHERE lead_ref LIKE 'DFL-2600%'");
    await q("UPDATE customers SET lead_id = NULL WHERE lead_id = (SELECT lead_id FROM leads WHERE lead_ref = 'DFL-260006')"); // CUS-0017 was made from it on the dev data
    await q("UPDATE leads SET status = 'new', assigned_to = NULL, first_reply_at = NULL, created_at = ? WHERE lead_ref = 'DFL-269001'", [ago(3)]);
    await q("UPDATE leads SET status = 'new', assigned_to = NULL, created_at = ? WHERE lead_ref = 'DFL-260007'", [ago(36)]);
    await q("UPDATE leads SET status = 'contacted', assigned_to = ?, first_reply_at = ?, staff_notes = 'Wants 12% margin.', business_name = 'KR Agencies', business_type = 'distributor', town = 'Vellore' WHERE lead_ref = 'DFL-260008'", [DIVYA, ago(240)]);
    const pt = await q1('SELECT phone FROM customers WHERE customer_id = ?', [C.pt]);
    await q("UPDATE leads SET status = 'qualified', assigned_to = 'DZIND148', first_reply_at = ?, phone = ?, business_name = 'Padur Tech Park' WHERE lead_ref = 'DFL-260006'", [ago(300), pt.phone]);
    await q("UPDATE leads SET status = 'won', assigned_to = ?, first_reply_at = ? WHERE lead_ref = 'DFL-260010'", [DIVYA, ago(400)]);
    await q('UPDATE customers SET lead_id = (SELECT lead_id FROM leads WHERE lead_ref = ?) WHERE customer_id = ?', ['DFL-260010', C.ka]);
    await q("UPDATE leads SET status = 'lost', assigned_to = ?, first_reply_at = ?, lost_reason = 'Price too high' WHERE lead_ref = 'DFL-260011'", [DIVYA, ago(500)]);
    await q(`INSERT INTO leads (lead_ref, form_type, full_name, business_name, business_type, town, phone, email, status, assigned_to, consent_given, consent_text, consent_at, lang_code, created_at, first_reply_at)
        VALUES ('DFL-269002', 'brochure', 'Priya N', 'Green Leaf Cafe', 'restaurant', 'Chennai', '9884455102', 'greenleafcafe.omr@gmail.com', 'contacted', ?, 1, 'I agree that dFresh may contact me about this request.', ?, 'en', ?, ?),
               ('DFL-269003', 'contact', 'Best Followers', NULL, NULL, NULL, '9000000001', 'promo@cheap-followers.example', 'spam', NULL, 1, 'I agree that dFresh may contact me about this request.', ?, 'en', ?, NULL)`,
    [DIVYA, ago(330), ago(330), ago(310), ago(370), ago(370)]);
    // calls and follow-ups: Green Leaf overdue (yesterday), Vellore Hygiene today, KR Agencies (DFL-260008) and Padur coming up
    const call = async (b, as) => must(await api(as, 'POST', '/sales/calls', b), 'call');
    await q("UPDATE follow_ups SET status = 'done' WHERE status = 'open'");
    await call({ lead_id: await lid('DFL-260008'), how: 'call', note: 'Spoke to Arjun. Sending distributor price list.', next_on: addD(t, 2) }, 'DV');
    await call({ lead_id: await lid('DFL-260006'), how: 'call', note: 'Wants C-fold on the same monthly order. Quote by Friday.', next_on: addD(t, 3) }, 'PV');
    await call({ lead_id: await lid('DFL-269002'), how: 'mail', note: 'Brochure sent again by e-mail.', next_on: t }, 'DV');
    await q("UPDATE follow_ups SET due_on = ? WHERE lead_id = ? AND status = 'open'", [addD(t, -1), await lid('DFL-269002')]);
    await call({ customer_id: C.vh, how: 'call', note: 'Bounced cheque: will pay by transfer this week.', next_on: t }, 'PV');
    // samples: to send (DFL-260007), no order (DFL-260011), ordered (Kamatchi)
    await q("INSERT INTO samples (lead_id, customer_id, sku_code, status, sent_on, feedback, emp_id) VALUES (?, NULL, 'DF002-M100', 'to_send', NULL, NULL, ?), (?, NULL, 'DF001-M100', 'no', ?, 'Liked it but price too high', ?), (NULL, ?, 'DF001-M100', 'ordered', ?, 'Ordered 2 cartons', ?)",
      [await lid('DFL-260007'), DIVYA, await lid('DFL-260011'), addD(t, -20), DIVYA, C.ka, addD(t, -18), DIVYA]);
    // quotes: 0001 Sri Devi (sent, expired), 0002 Padur (sent, then won with its order), 0003 for the enquiry DFL-260008 (sent)
    const quote = async (b, as) => must(await api(as, 'POST', '/sales/quotes', { send: true, ...b }), 'quote');
    const q1n = await quote({ customer_id: C.sd, godown_id: 1, valid_until: addD(t, 14), delivery_charge: 250, items: [{ sku_code: 'DF023-R1', qty: 12 }, { sku_code: 'DF038-M150', qty: 24 }] }, 'DV');
    if (q1n.quote_no) await q('UPDATE quotes SET quote_date = ?, valid_until = ?, sent_at = ? WHERE quote_no = ?', [addD(t, -31), addD(t, -16), ago(31 * 24), q1n.quote_no]);
    await approveAll(q1n.order_no || q1n.quote_no);
    // Chennai holds 120 toilet rolls on the dev data: 130 leaves 10 on back-order (v23: 10 owed at Chennai)
    const q2n = await quote({ customer_id: C.pt, godown_id: 2, valid_until: addD(t, 14), items: [{ sku_code: 'DF036-M250', qty: 20 }, { sku_code: 'DF019-R10', qty: 130 }] }, 'PV');
    await approveAll(q2n.order_no || q2n.quote_no);
    const q3n = await quote({ lead_id: await lid('DFL-260008'), godown_id: 1, valid_until: addD(t, 14), items: [{ sku_code: 'DF001-M100', qty: 200 }, { sku_code: 'DF007-M100', qty: 100 }] }, 'DV');
    await approveAll(q3n.order_no || q3n.quote_no);
    // orders: Padur from its quote (10 rolls on back-order), Kamatchi 40, Hotel Kanchi 24
    const o3 = must(await api('PV', 'POST', `/sales/quotes/${encodeURIComponent(q2n.quote_no)}/order`), 'quote 2 to order');
    if (o3.order_no) {
      const c3 = must(await api('PV', 'PUT', `/commerce/orders/${o3.order_no}`, { version: await ver(o3.order_no), confirm: true, items: (await itemsOf(o3.order_no)).map((i) => ({ ...i, kept: true })) }), 'confirm Padur');
      await approveAll(c3.order_no || c3.quote_no);
    }
    const ord = async (as, b) => { const d = must(await api(as, 'POST', '/commerce/orders', b), 'order'); await approveAll(d.order_no || d.quote_no); return d; };
    const o1 = await ord('DV', { customer_id: C.ka, items: [{ sku_code: 'DF001-M100', qty: 40 }], note: 'Cash on delivery.' });
    const o2 = await ord('DV', { customer_id: C.hk, items: [{ sku_code: 'DF007-M100', qty: 24 }] });
    // standing orders
    const sto = async (as, b) => must(await api(as, 'POST', '/sales/standing', b), 'standing');
    const wd = new Date(`${t}T00:00:00Z`).getUTCDay() || 7;
    const s1 = await sto('DV', { customer_id: C.hk, every: 'week', run_day: wd, starts_on: addD(t, -28), ends_on: '2027-03-31', items: [{ sku_code: 'DF007-M100', qty: 24 }, { sku_code: 'DF030-M200', qty: 12 }] });
    if (s1.standing_id) await q('UPDATE standing_orders SET next_on = ? WHERE standing_id = ?', [t, s1.standing_id]);
    const s2 = await sto('PV', { customer_id: C.pt, every: 'month', run_day: 1, starts_on: addD(t, -60), items: [{ sku_code: 'DF036-M250', qty: 20 }, { sku_code: 'DF019-R10', qty: 10 }] });
    return { C, q1: q1n.quote_no, q2: q2n.quote_no, q3: q3n.quote_no, o1: o1.order_no, o2: o2.order_no, o3: o3.order_no, s1: s1.sto_no, s1id: s1.standing_id, s2: s2.sto_no };
  }

  /** the v23 delivery masters and roles on our data (phase 20 sample): the Supervisor (role 32, Kumar) plans trips and
   *  finishes short packing; Warehouse packs but makes no pick list; Raja K = our Delivery user DZIND142 on driver 1 */
  async function fulfilSample() {
    const t = today();
    for (const [role, sec, v, c, e, a] of [[32, 'packing', 1, 1, 1, 1], [32, 'delivery', 1, 1, 1, 0], [5, 'packing', 1, 0, 1, 0]]) {
      await q(`INSERT INTO role_permissions (role_id, section, can_view, can_create, can_edit, can_approve, can_cancel, can_export) VALUES (?, ?, ?, ?, ?, ?, 0, 0)
        ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_create = VALUES(can_create), can_edit = VALUES(can_edit), can_approve = VALUES(can_approve)`, [role, sec, v, c, e, a]);
    }
    await q("UPDATE drivers SET name = 'Raja K', emp_id = 'DZIND142', licence_no = 'TN2120190012345', licence_until = '2027-08-31' WHERE driver_id = 1");
    await q("UPDATE drivers SET licence_no = 'TN2120170054321', licence_until = '2028-01-31' WHERE driver_id IN (2, 3)");
    await q("UPDATE vehicles SET number = 'TN 21 BC 4417', type = 'Tata Ace', godown_id = 1, max_kg = 750, max_boxes = 60, insurance_until = '2027-03-31', fitness_until = ? WHERE vehicle_id = 1", [addD(t, 20)]);
    await q("UPDATE vehicles SET number = 'TN 21 AK 2210', type = 'Two-wheeler', godown_id = 1, max_kg = 60, max_boxes = 4, insurance_until = '2026-10-25', fitness_until = NULL WHERE vehicle_id = 2");
    await q("INSERT INTO vehicles (number, type, godown_id, max_kg, max_boxes, insurance_until, fitness_until, sort_order, is_active) VALUES ('TN 22 AB 9031', 'Eicher (small truck)', 2, 1000, 80, '2027-06-30', '2027-06-30', 3, 1)");
    await q("UPDATE couriers SET name = 'Professional Couriers', phone = '+91 44 2345 6789', per_kg = 42, min_charge = 150 WHERE courier_id = 1");
    await q("INSERT INTO couriers (name, phone, tracking_url, per_kg, min_charge, sort_order, is_active) VALUES ('DTDC', '+91 80 2536 5000', 'https://www.dtdc.in/tracking?awb={awb}', 48, 150, 3, 1)");
    await q('UPDATE delivery_areas SET godown_id = 1 WHERE area_id IN (1, 3, 4)');
    await q('UPDATE delivery_areas SET godown_id = 2 WHERE area_id = 2');
    await q("UPDATE delivery_areas SET charge = 300, days = 'Tue,Fri' WHERE area_id = 4");
    await q("INSERT INTO delivery_areas (label, godown_id, towns, charge, free_above, days, show_on_map, sort_order, is_active) VALUES ('Ambur', 1, 'Ambur, 635802', 250, NULL, 'Wed', 0, 5, 1)");
    return { dtdc: (await q1("SELECT courier_id FROM couriers WHERE name = 'DTDC'")).courier_id };
  }

  // packing and trips (Kumar the Supervisor by default)
  const pick = (as, nos) => api(as, 'POST', '/fulfil/pick-lists', { order_nos: nos });
  const scan = (as, no, code, n, batch) => api(as, 'POST', `/commerce/packing/${no}/scan`, { code, n, batch });
  const plines = async (no) => (await api('SH', 'GET', `/fulfil/packing/${no}`)).data.lines;
  const scanAll = async (no, less = {}, as = 'KU') => { for (const l of await plines(no)) { const n = l.need - (less[l.sku_code] || 0); if (n > 0) await scan(as, no, l.batch_no ? `${l.sku_code}/${l.batch_no}` : l.sku_code, n); } };
  const packFull = async (no, cartons = 1, kg = '3', as = 'KU') => { await pick(as, [no]); await scanAll(no, {}, as); return api(as, 'POST', `/commerce/packing/${no}/packed`, { cartons, weight_kg: kg }); };
  const otpOf = async (stopId) => (await q1('SELECT otp FROM trip_stops WHERE stop_id = ?', [stopId])).otp;
  const stopsOf = async (tid) => (await api('SH', 'GET', `/commerce/trips/${tid}`)).data.stops;
  const stopOf = async (tid, no) => (await stopsOf(tid)).find((s) => s.order_no === no);
  const invoice = (no, extra = {}) => api('SH', 'POST', '/billing/invoices', { order_no: no, ...extra });
  // phase 23 (v23 10.1, switch "Invoice made at the gate" off as delivered): no goods leave without an invoice, so the
  // office makes the invoice of each packed order first, as in v23; { invoice: false } leaves them as they are (10.1)
  const trip = async (nos, veh = 1, drv = 1, as = 'KU', opts = {}) => {
    if (opts.invoice !== false) {
      for (const no of nos) {
        const x = await q1("SELECT o.status, (SELECT COUNT(*) FROM invoices i WHERE i.live_order_id = o.order_id) AS n FROM orders o WHERE o.order_no = ?", [no]);
        if (x && x.status === 'packed' && !Number(x.n)) { const iv = await invoice(no); if (iv.status >= 300) say('invoice:', iv.status, iv.msg); }
      }
    }
    const r = await api(as, 'POST', '/commerce/trips', { vehicle_id: veh, driver_id: drv, order_nos: nos }); if (r.status >= 300) say('trip:', r.status, r.msg); return r.data && r.data.trip_id;
  };
  const deliverStop = async (s, extra = {}, as = 'RA') => api(as, 'POST', `/commerce/stops/${s.stop_id}/delivered`, { receiver_name: 'Test', otp: await otpOf(s.stop_id), signed: '1', ...extra });
  const shelfB = async (sku, kind = 'good', batch = null, g = 1) => Number((await q1(`SELECT COALESCE(SUM(m.delta), 0) n FROM stock_movements m LEFT JOIN batches b ON b.batch_id = m.batch_id WHERE m.sku_code = ? AND m.location_id = ? AND m.stock_kind = ?${batch ? ' AND b.batch_no = ?' : ''}`, batch ? [sku, g, kind, batch] : [sku, g, kind])).n);
  const bal = async (cid) => (await api('SH', 'GET', `/money/receipt-form?customer_id=${cid}`)).data.customer;
  const B2B = () => q1("SELECT c.customer_id, c.name, a.gstin FROM customers c JOIN customer_addresses a ON a.customer_id = c.customer_id AND a.gstin IS NOT NULL AND a.gstin <> '' WHERE c.status = 'active' AND c.credit_days > 0 ORDER BY c.customer_id LIMIT 1");

  return { C, DIVYA, addD, lid, held, back, ver, itemsOf, free, pendingLike, sample, fulfilSample, pick, scan, plines, scanAll, packFull, otpOf, stopsOf, stopOf, invoice, trip, deliverStop, shelfB, bal, B2B };
};
module.exports.C = C;
