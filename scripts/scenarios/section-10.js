// Section 10 - Invoicing: the v23 Tests tab "10", test 0.37 (money leaving the company needs a second person) and the
// money fix items Y7 (debit note and invoice cancel exclude each other), Y8 (a credit note keeps its invoice buyer after
// a merge), T2 (an approval after the books close is refused) and Low3 a / b (e-way bill load and real numbers; a waiting
// return holds its room on the invoice). Each "Start again" restores the dev data and builds the v23 sales sample and
// delivery masters on it (helpers-sales.js); a B2B customer of ours (a GSTIN, credit days) stands in for v23's Ambur
// Leather Works and each check works its figure out with v23's rule. Run: npm run scenarios -- 10
const helpers = require('./helpers-sales');

module.exports = {
  title: 'Invoicing',
  async run(ctx) {
    const { api, pool, ok, say, q1, qa, setting, decide, decideAny, pendingOf, packed, T, fresh, run, r2, today, enc, base, cookie } = ctx;
    const { addD, sample, fulfilSample, trip, stopsOf, otpOf, bal, B2B } = helpers(ctx);
    const SH = 'SH'; const PV = 'PV'; const KU = 'KU'; const DV = 'DV'; const RA = 'RA'; const AN = 'AN';
    const SKU = 'DF001-M100';
    const start = async () => { await fresh(); const S = await sample(); await fulfilSample(); return S; };
    const inv = async (no) => (await api(SH, 'GET', `/billing/invoices/${enc(no)}`)).data;
    const mkInv = async (no) => (await api(SH, 'POST', '/billing/invoices', { order_no: no })).data.invoice_no;

    if (run('10.1')) { await start(); T('10.1', 'No goods leave without an invoice (and its papers)');
      const c = await B2B(); const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]);
      const r = (await api(SH, 'GET', '/billing/invoices')).data;
      const row = r.to_invoice.find((x) => x.order_no === no);
      ok(row && r.company && r.company.demo !== undefined, `To invoice lists ${no} ${row && row.customer}: "${row && row.packed}", ${row && row.delivery_kind}, Packed; company banner: demo ${r.company && r.company.demo}, missing ${(r.company && r.company.missing || []).join(', ') || 'none'}`);
      const tid = await trip([no], 1, 1, 'KU', { invoice: false }); // the test needs the order with no invoice
      const leftOf = () => q1('SELECT dispatched_at, (SELECT COUNT(*) FROM invoices i WHERE i.order_id = o.order_id) n FROM orders o WHERE order_no = ?', [no]);
      // v23 (switch "Invoice made at the gate" off, as delivered): no invoice, nothing leaves
      const gate0 = await q1("SELECT value FROM commerce_settings WHERE setting_key = 'invoice_at_gate'");
      const s0 = await api(KU, 'POST', `/commerce/trips/${tid}/start`);
      const l0 = await leftOf();
      ok(gate0 && gate0.value === '0' && s0.status === 409 && new RegExp(`Make the invoice for ${no} first`).test(s0.msg) && !l0.dispatched_at && Number(l0.n) === 0,
        `switch "Invoice made at the gate" ${gate0 && gate0.value === '0' ? 'off (as delivered)' : 'ON?'}: start with no invoice: ${s0.status} "${s0.msg}"; dispatched ${l0.dispatched_at}, invoices ${l0.n}`);
      // the Admin's choice: the switch on, the invoice is made at the gate, still with its papers (e-way bill) checked
      await setting('invoice_at_gate', 1);
      await setting('eway_bill_required', 1); await setting('eway_bill_above', 100); // a small limit, so this invoice needs an e-way bill
      const s1 = await api(KU, 'POST', `/commerce/trips/${tid}/start`);
      const left = await leftOf();
      ok(s1.status === 409 && /Missing before the goods leave|e-way/i.test(s1.msg) && !left.dispatched_at && Number(left.n) === 0, `switch on, the invoice would need an e-way bill: ${s1.status} "${s1.msg}"; dispatched ${left.dispatched_at}, invoices kept ${left.n} (rolled back)`);
      await setting('eway_bill_above', 50000);
      const s2 = await api(KU, 'POST', `/commerce/trips/${tid}/start`);
      const made = await qa("SELECT i.invoice_no FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE o.order_no = ? AND i.status = 'issued'", [no]);
      ok(s2.status === 200 && made.length === 1, `switch on, limit back to Rs 50,000: ${s2.status}, invoice made at the gate ${made.map((x) => x.invoice_no).join(', ')}; the goods leave`);
      // switch off again: the invoice made first in Money > Billing > Invoices, then the trip starts
      await setting('invoice_at_gate', 0);
      const no2 = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]);
      const t2 = await trip([no2], 1, 1, 'KU', { invoice: false });
      const i2 = await mkInv(no2);
      const s3 = await api(KU, 'POST', `/commerce/trips/${t2}/start`);
      ok(Boolean(i2) && s3.status === 200, `switch off: invoice ${i2} made first for ${no2}, then the trip starts: ${s3.status}`); }

    if (run('10.2') || run('10.12')) { await start(); T('10.2', 'Make an invoice from the packed order');
      const c = await B2B(); const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]);
      const pv = (await api(SH, 'GET', `/billing/to-invoice/${no}`)).data;
      const before = (await bal(c.customer_id)).owes;
      const r = await api(SH, 'POST', '/billing/invoices', { order_no: no, date: today() });
      const v = await inv(r.data.invoice_no);
      const after = (await bal(c.customer_id)).owes;
      const t = pv.totals;
      ok(r.status === 200 && r.data.invoice_no === pv.next_no && pv.kind === 'B2B' && !pv.inter && v.state === 'open' && v.due_on === addD(today(), pv.due_days) && r2(after - before) === r2(v.total) && Math.abs(r2(t.taxable + t.cgst + t.sgst + (t.round_off || 0)) - t.total) < 0.02,
        `drawer: ${pv.kind} to ${pv.legal} GSTIN ${pv.gstin}, number ${pv.next_no}, place ${pv.place} (${pv.inter ? 'IGST' : 'CGST + SGST'}), due ${pv.due_days} days, taxable ${t.taxable} CGST ${t.cgst} SGST ${t.sgst} total ${t.total}; ${r.data.invoice_no} made: "${r.data.message}" ${v.state_label}, due ${v.due_on}; ledger ${before} -> ${after} (+${v.total})`);
      const led = (await api(SH, 'GET', `/commerce/customers/${c.customer_id}/statement`)).data;
      ok(led.lines.some((l) => l.doc === r.data.invoice_no), 'the customer ledger shows the invoice line', JSON.stringify(led.lines.find((l) => l.doc === r.data.invoice_no)));
      if (run('10.12')) { T('10.12', 'Order panel shows its invoices; cancel refused while it stands');
        const o = (await api(SH, 'GET', `/commerce/orders/${no}`)).data;
        const x = await api(SH, 'POST', `/commerce/orders/${no}/cancel`, { reason: 'Customer changed mind' });
        const old = (await api(SH, 'GET', '/commerce/orders/DFO-260002')).data;
        ok(o.invoices.some((i) => i.invoice_no === r.data.invoice_no) && x.status === 409 && /Cancel the invoice first/.test(x.msg),
          `panel invoices: ${o.invoices.map((i) => i.invoice_no).join(', ')}; cancel: "${x.msg}"; an older order DFO-260002: ${JSON.stringify(old.invoices)}`); } }

    if (run('10.3')) { await start(); T('10.3', 'The printed invoice');
      const c = await B2B(); const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]);
      const ino = await mkInv(no);
      const pr = (await api(SH, 'GET', `/billing/invoice-print/${enc(ino)}`)).data;
      ok(pr && pr.invoice_no === ino && pr.lines.length && pr.lines.every((l) => l.hsn) && 'upi' in pr && 'bank' in pr && 'declaration' in pr,
        `print data: ${pr.invoice_no}, seller ${pr.seller_name}, GSTIN ${pr.is_demo ? 'to be provided (DEMO)' : pr.seller_gstin}, ${pr.lines.length} line(s) with HSN ${pr.lines.map((l) => l.hsn).join(',')}, total ${pr.total} (the amount in words is written by the print page), bank "${pr.bank || 'to be provided'}", UPI ${pr.upi || '-'}`);
      const before = (await q1('SELECT COALESCE(MAX(mail_id), 0) m FROM mail_outbox')).m;
      const m = await api(SH, 'POST', `/billing/invoices/${enc(ino)}/mail`);
      const mails = await qa('SELECT to_email, subject, status FROM mail_outbox WHERE mail_id > ?', [before]);
      ok(m.status === 200, `Mail to customer: ${m.status} "${(m.data && m.data.message) || m.msg}" (outbox: ${mails.map((x) => `${x.to_email}: ${x.subject} ${x.status}`).join('; ') || 'none'})`); }

    if (run('10.4')) { await start(); T('10.4', 'Cancel an invoice needs approval');
      const c = await B2B(); const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]);
      const ino = await mkInv(no);
      const a = await api(PV, 'POST', `/billing/invoices/${enc(ino)}/cancel`, { reason: 'Wrong customer' });
      const w = await inv(ino);
      ok(a.data && a.data.waiting && w.state === 'cancelwait', `ask: ${a.status} "${a.data && a.data.message}"; state ${w.state_label}`);
      const d = await decideAny(a.data.approval_id);
      const v = await inv(ino); const led = (await api(SH, 'GET', `/commerce/customers/${c.customer_id}/statement`)).data;
      const back = (await api(SH, 'GET', '/billing/invoices')).data.to_invoice.some((x) => x.order_no === no);
      ok(d.status === 200 && v.state === 'cancelled' && led.lines.some((l) => l.kind === 'cancel' && l.doc === ino) && back, `approved (${d.status}): ${v.state_label}; ledger "${(led.lines.find((l) => l.kind === 'cancel') || {}).text}"; ${no} back in To invoice: ${back}`);
      const again = await api(SH, 'POST', '/billing/invoices', { order_no: no });
      ok(again.status === 200 && again.data.invoice_no !== ino, `invoiced again as ${again.data && again.data.invoice_no}: ${ino} is not used again`);
      const tid = await trip([no]); await api(KU, 'POST', `/commerce/trips/${tid}/start`);
      const x = await api(PV, 'POST', `/billing/invoices/${enc(again.data.invoice_no)}/cancel`, { reason: 'Too late' });
      ok(x.status === 409 && /left/.test(x.msg), `after the goods left: ${x.status} "${x.msg}"`); }

    if (run('10.5')) { await start(); T('10.5', 'E-way bill above Rs 50,000');
      await setting('eway_bill_required', 1); await setting('eway_bill_above', 50000);
      const c = await B2B();
      const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 800 }, { sku_code: 'DF019-R10', qty: 100 }]); // above Rs 50,000 on our list prices
      const pv = (await api(SH, 'GET', `/billing/to-invoice/${no}`)).data;
      const v1 = await api(SH, 'POST', '/billing/invoices', { order_no: no });
      const v2 = await api(SH, 'POST', '/billing/invoices', { order_no: no, ewb_no: '1234 5678 9012', ewb_valid: addD(today(), 1) });
      const v3 = await api(SH, 'POST', '/billing/invoices', { order_no: no, ewb_no: '341022518876', ewb_valid: addD(today(), 1) });
      const list = (await api(SH, 'GET', '/gst/papers')).data.ewb.find((x) => x.invoice_no === (v3.data && v3.data.invoice_no));
      ok(pv.totals.total > 50000 && v1.status === 400 && /12 digits/.test(v1.msg) && v2.status === 400 && /not an e-way bill/.test(v2.msg) && v3.status === 200 && list && list.ewb_valid,
        `${no} total ${pv.totals.total}, needs ${JSON.stringify(pv.needs)}; no number: "${v1.msg}"; 1234 5678 9012: "${v2.msg}"; 3410 2251 8876: ${v3.data && v3.data.invoice_no}; GST > E-way bill: ${list && `${list.ewb_no} valid until ${list.ewb_valid}`}`); }

    if (run('10.6')) { await start(); T('10.6', 'E-invoice when switched on');
      await setting('einvoice_mode', 'on');
      const c = await B2B(); const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]);
      const a = await api(SH, 'POST', '/billing/invoices', { order_no: no, irn: 'abc', ack_no: '123' });
      const irn = 'a1b2c3d4'.repeat(8);
      const b = await api(SH, 'POST', '/billing/invoices', { order_no: no, irn, ack_no: '112233445566' });
      const e = (await api(SH, 'GET', '/gst/papers')).data.einv.find((x) => x.invoice_no === (b.data && b.data.invoice_no));
      ok(a.status === 400 && a.fields && a.fields.irn && a.fields.ack_no && b.status === 200 && e && e.irn === irn, `short IRN: "${a.fields && a.fields.irn}" / ack "${a.fields && a.fields.ack_no}"; with both: ${b.data && b.data.invoice_no}; GST > E-invoice: ${e && `${e.irn.slice(0, 16)}...`}`);
      await setting('einvoice_mode', 'off'); }

    if (run('10.7')) { await start(); T('10.7', 'Credit note for goods that came back (no approval)');
      const c = await B2B(); const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]);
      await mkInv(no);
      const tid = await trip([no]); await api(KU, 'POST', `/commerce/trips/${tid}/start`);
      const st = (await stopsOf(tid))[0];
      const b0 = (await bal(c.customer_id)).owes;
      const n0 = (await q1('SELECT COALESCE(MAX(credit_note_id), 0) m FROM credit_notes')).m;
      const r = await api(RA, 'POST', `/commerce/stops/${st.stop_id}/refused`, { reason: 'Wrong item' });
      const cn = await q1('SELECT credit_note_no, total, status FROM credit_notes WHERE credit_note_id > ? ORDER BY credit_note_id LIMIT 1', [n0]);
      const pend = await qa("SELECT approval_id FROM approvals WHERE status = 'pending' AND ref_id = ?", [cn ? cn.credit_note_no : '-']);
      const b1 = (await bal(c.customer_id)).owes;
      ok(r.status === 200 && cn && cn.status === 'done' && !pend.length && r2(b0 - b1) === r2(cn.total), `refused: ${cn && cn.credit_note_no} Rs ${cn && cn.total} ${cn && cn.status}, made at once (no approval); balance ${b0} -> ${b1}`); }

    if (run('10.8') || run('10.9') || run('10.10')) { await start(); T('10.8', 'A price correction needs approval');
      const c = await B2B(); const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]);
      const ino = await mkInv(no); const v = await inv(ino);
      const a = await api(SH, 'POST', '/billing/credit-notes', { invoice_no: ino, why: 'Price correction', amount: '5000', note: 'Agreed rate' });
      const b0 = (await bal(c.customer_id)).owes;
      const b = await api(SH, 'POST', '/billing/credit-notes', { invoice_no: ino, why: 'Price correction', amount: '40', note: 'Agreed rate' });
      const d = await decideAny(b.data.approval_id);
      const b1 = (await bal(c.customer_id)).owes;
      const rate = (await api(SH, 'GET', `/billing/credit-room/${enc(ino)}`)).data.rate;
      ok(a.status === 400 && /More than the invoice value without GST/.test(a.msg) && b.data.waiting && d.status === 200 && r2(b0 - b1) === r2(b.data.total) && Math.abs(b.data.total - r2(40 * (1 + rate / 100))) <= 0.5,
        `Rs 5000: "${a.msg}" | Rs 40 + ${rate}% = ${b.data.total} waits (${b.data.credit_note_no}); approved: owes ${b0} -> ${b1} (invoice ${v.total})`);
      if (run('10.9') || run('10.10')) { T('10.9', 'Debit note');
        const d0 = (await bal(c.customer_id)).owes;
        const dn = await api(SH, 'POST', '/billing/debit-notes', { invoice_no: ino, why: 'Freight not charged on the invoice', amount: '150' });
        const d1 = (await bal(c.customer_id)).owes;
        const cd = await q1('SELECT credit_days FROM customers WHERE customer_id = ?', [c.customer_id]);
        const pr = (await api(SH, 'GET', `/billing/notes/${enc(dn.data.debit_note_no)}`)).data;
        ok(dn.status === 200 && /^DFS\//.test(dn.data.debit_note_no) && dn.data.total === 177 && dn.data.due_on === addD(today(), Number(cd.credit_days)) && r2(d1 - d0) === 177 && pr.reason,
          `${dn.data.debit_note_no} Rs ${dn.data.total} (18% GST), due ${dn.data.due_on}; balance ${d0} -> ${d1}; prints "${pr.title} ${pr.no}" reason "${pr.reason}"`); }
      if (run('10.10')) { T('10.10', 'GSTR-1 and GSTR-3B data');
        const m = today().slice(0, 7);
        const g = (await api(SH, 'GET', `/gst/month?month=${m}`)).data;
        const sum = await q1(`SELECT (SELECT COALESCE(SUM(taxable), 0) FROM invoices WHERE status = 'issued' AND DATE_FORMAT(CONVERT_TZ(issued_at, '+00:00', '+05:30'), '%Y-%m') = ?) i,
            (SELECT COALESCE(SUM(taxable), 0) FROM credit_notes WHERE status = 'done' AND DATE_FORMAT(CONVERT_TZ(issued_at, '+00:00', '+05:30'), '%Y-%m') = ?) c,
            (SELECT COALESCE(SUM(taxable), 0) FROM debit_notes WHERE status = 'done' AND DATE_FORMAT(CONVERT_TZ(issued_at, '+00:00', '+05:30'), '%Y-%m') = ?) d`, [m, m, m]);
        const want = r2(Number(sum.i) - Number(sum.c) + Number(sum.d));
        const b2b = g.tables.find((t) => t.key === 'b2b').rows.find((x) => x.doc === ino);
        const notes = g.tables.find((t) => t.key === 'cdnr').rows.map((x) => `${x.doc} ${x.note_type}`);
        ok(Math.abs(g.gstr3b.output.taxable - want) < 0.05 && b2b && notes.length >= 2 && g.checks.every((x) => x.ok),
          `3B output taxable ${g.gstr3b.output.taxable} = invoices ${sum.i} - credit ${sum.c} + debit ${sum.d}; CGST ${g.gstr3b.output.cgst} SGST ${g.gstr3b.output.sgst}; input ${g.gstr3b.input.taxable} (${g.gstr3b.input.bills} bills), to pay ${g.gstr3b.to_pay.tax}; B2B ${b2b && `${b2b.gstin} ${b2b.doc} ${b2b.pos}`}; notes ${notes.join(', ')}; checks ${g.checks.map((x) => x.ok).join(',')}`);
        const csvR = await fetch(`${base}/gst/month.csv?month=${m}`, { headers: { Cookie: cookie(SH) } }); const rows = (await csvR.text()).trim().split(/\r?\n/);
        ok(csvR.status === 200 && rows.some((x) => x.startsWith('B2B,')) && rows.some((x) => x.startsWith('HSN,')) && rows.some((x) => x.startsWith('3B output')), `CSV ${rows.length - 1} rows: ${[...new Set(rows.slice(1).map((x) => x.split(',')[0]))].join(', ')}`); } }

    if (run('10.11')) { await start(); T('10.11', 'Delivery challan for samples');
      const sku = 'DF007-M100';
      const good = async () => Number((await q1("SELECT COALESCE(SUM(delta), 0) n FROM stock_movements WHERE sku_code = ? AND location_id = 1 AND stock_kind = 'good'", [sku])).n);
      const s0 = await good();
      const r = await api(SH, 'POST', '/billing/challans', { godown_id: 1, why: 'Free samples', to_name: 'Hotel Annapurna Residency', to_address: 'Kanchipuram', lines: [{ sku_code: sku, qty: 2 }] });
      const s1 = await good();
      const list = (await api(SH, 'GET', '/billing/challans')).data.rows;
      const pr = (await api(SH, 'GET', `/billing/challans/${enc(r.data.challan_no)}`)).data;
      const big = await api(SH, 'POST', '/billing/challans', { godown_id: 1, why: 'Free samples', to_name: 'X Y', to_address: 'Kanchipuram', lines: [{ sku_code: sku, qty: 999999 }] });
      ok(r.status === 200 && /^DFT\//.test(r.data.challan_no) && s0 - s1 === 2 && list.some((x) => x.no === r.data.challan_no) && pr.value >= 0 && big.status === 400,
        `${r.data.challan_no}: "${r.data.message}"; Table Napkins 30x30 good ${s0} -> ${s1}; list ${list.length} (transfers too: ${list.filter((x) => !x.own).length}); print value Rs ${pr.value}; too many: "${big.msg}"`); }

    if (run('10.13')) { await start(); T('10.13', 'Invoicing is for the office');
      const a = await api(DV, 'GET', '/billing/invoices'); const b = await api(KU, 'GET', '/billing/invoices'); const c = await api(AN, 'GET', '/billing/invoices'); const d = await api(PV, 'GET', '/gst/month');
      ok(a.status === 403 && b.status === 403 && c.status === 200 && d.status === 200, `Sales ${a.status} "${a.msg}", Supervisor ${b.status} "${b.msg}", Sub-admin ${c.status}, Admin GST ${d.status}`); }

    // ================================================================================================ 0.37 and fix tests
    if (run('0.37')) { await start(); T('0.37', 'Money leaving the company needs a second person');
      const rules = await qa("SELECT kind, label, section, is_on, unit, limit_value FROM approval_rules WHERE kind IN ('credit_no_return', 'cancel_invoice', 'supplier_pay', 'waive_bounce', 'bad_debt', 'refund')");
      ok(rules.length === 6, `rules: ${rules.map((x) => `${x.label} (${x.section}, ${x.unit === 'all' ? 'every one' : `above ${x.limit_value}`})`).join('; ')}`);
      const c = await B2B(); const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]);
      const ino = await mkInv(no);
      const a = await api(PV, 'POST', `/billing/invoices/${enc(ino)}/cancel`, { reason: 'Test 0.37' });
      const k = await decide(KU, a.data.approval_id); const dv = await decide(DV, a.data.approval_id);
      ok(k.status >= 400 && dv.status >= 400, `Kumar (Supervisor) ${k.status} "${k.msg}"; Divya ${dv.status} "${dv.msg}"`);
      const an = await decideAny(a.data.approval_id);
      ok(an.status === 200, `a Sub-admin or Admin signs it: ${an.status}`); }

    if (run('Y7')) { await start(); T('Y7', 'Debit note on an invoice whose cancel waits');
      const c = await B2B(); const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]);
      const ino = await mkInv(no);
      const a = await api(PV, 'POST', `/billing/invoices/${enc(ino)}/cancel`, { reason: 'Wrong customer' });
      const d = await api(SH, 'POST', '/billing/debit-notes', { invoice_no: ino, why: 'Freight not charged on the invoice', amount: '150' });
      await decideAny(a.data.approval_id);
      const left = await qa('SELECT debit_note_no FROM debit_notes d JOIN invoices i USING (invoice_id) WHERE i.invoice_no = ?', [ino]);
      const dc = await api(SH, 'POST', '/billing/debit-notes', { invoice_no: ino, why: 'Freight not charged on the invoice', amount: '150' });
      ok(d.status === 400 && /waits to be cancelled/.test(d.msg) && !left.length && dc.status === 400 && /cancelled/.test(dc.msg), `while the cancel waits: "${d.msg}"; after: debit notes ${left.length}; on the cancelled invoice: "${dc.msg}"`);
      const no2 = await packed(c.customer_id, [{ sku_code: SKU, qty: 5 }]); const i2 = await mkInv(no2);
      await api(SH, 'POST', '/billing/debit-notes', { invoice_no: i2, why: 'Freight not charged on the invoice', amount: '150' });
      const x = await api(PV, 'POST', `/billing/invoices/${enc(i2)}/cancel`, { reason: 'Wrong' });
      ok(x.status === 409 && /debit note/.test(x.msg), `debit note first, then cancel: "${x.msg}"`); }

    if (run('Y8')) { await start(); T('Y8', 'A credit note keeps its invoice buyer after a merge; the money goes to the survivor');
      const c = await B2B(); const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]);
      const ino = await mkInv(no);
      const other = await q1("SELECT customer_id, name FROM customers WHERE customer_id <> ? AND status = 'active' ORDER BY customer_id LIMIT 1", [c.customer_id]);
      const mr = await api(SH, 'POST', '/commerce/customers/merge', { keep_id: other.customer_id, merge_id: c.customer_id, reason: 'test Y8' });
      if (mr.data && mr.data.approval_id) await decideAny(mr.data.approval_id);
      const cn = await api(SH, 'POST', '/billing/credit-notes', { invoice_no: ino, why: 'Price correction', amount: '40', note: 'Agreed rate' });
      if (cn.data && cn.data.approval_id) await decideAny(cn.data.approval_id);
      const pr = (await api(SH, 'GET', `/billing/notes/${enc(cn.data.credit_note_no)}`)).data;
      const led = (await api(SH, 'GET', `/commerce/customers/${other.customer_id}/statement`)).data;
      ok(pr.buyer.bill.gstin === c.gstin && led.lines.some((l) => l.doc === cn.data.credit_note_no), `merge ${mr.status}; ${cn.data.credit_note_no}: buyer on the note ${pr.buyer.bill.name} GSTIN ${pr.buyer.bill.gstin} (the invoice's); ledger line with the survivor ${other.name}`); }

    if (run('T2')) { await start(); T('T2', 'An approval signed after the books close posts on its record date: refused');
      const c = await B2B(); const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]);
      const ino = await mkInv(no);
      const cn = await api(SH, 'POST', '/billing/credit-notes', { invoice_no: ino, why: 'Price correction', amount: '40', note: 'Agreed rate' });
      await setting('books_closed_to', today());
      const d = await decide(AN, cn.data.approval_id); const d2 = await decide(PV, cn.data.approval_id);
      const st = await q1('SELECT status FROM credit_notes WHERE credit_note_no = ?', [cn.data.credit_note_no]);
      const rc = await api(SH, 'POST', '/money/receipts', { customer_id: c.customer_id, amount: '10', mode: 'cash', received_on: today() });
      await setting('books_closed_to', '');
      ok(d.status >= 400 && d2.status >= 400 && st.status === 'waiting' && rc.status === 400 && /closed/.test(rc.msg), `approve: ${d.status} "${d.msg}" / ${d2.status} (note ${st.status}); a receipt dated today: "${rc.msg}"`); }

    if (run('Low3')) { await start(); T('Low3a', 'E-way bill: one load per customer per godown per day; real numbers only');
      await setting('eway_bill_required', 1); await setting('eway_bill_above', 50000);
      const billing = require('../../src/backend_routes/billing.js'); // eslint-disable-line global-require
      const c = await B2B(); const no = await packed(c.customer_id, [{ sku_code: SKU, qty: 5 }]);
      const i1 = await mkInv(no);
      const v1 = await billing.invoiceRow(pool, 'i.invoice_no = ?', [i1]);
      const n2 = await billing.needs(pool, { total: 50000 - Number(v1.total) + 1, customerId: c.customer_id, godownId: v1.godown_id, day: today(), gstin: c.gstin });
      ok(n2.ewb && /load/.test(n2.ewb), `a second invoice today for ${50000 - Number(v1.total) + 1} with ${i1} (${v1.total}): needs e-way: "${n2.ewb}"`);
      const nums = ['000000000000', '111111111111', '123456789012', '341007654321'].map((x) => `${x} ${billing.ewbWhy(x) ? 'refused' : 'accepted'}`);
      ok(nums.join() === '000000000000 refused,111111111111 refused,123456789012 refused,341007654321 accepted', `numbers: ${nums.join(', ')}`);
      T('Low3b', 'A return still open holds its room on the invoice');
      const tid = await trip([no]); await api(KU, 'POST', `/commerce/trips/${tid}/start`);
      const st = (await stopsOf(tid))[0];
      await api(RA, 'POST', `/commerce/stops/${st.stop_id}/delivered`, { receiver_name: 'Test', otp: await otpOf(st.stop_id), signed: '1' });
      await pool.query('UPDATE orders SET delivered_at = DATE_SUB(delivered_at, INTERVAL 15 DAY) WHERE order_no = ?', [no]); // outside the window: the return waits
      const src = (await api(SH, 'GET', `/commerce/orders/${no}/returnable`)).data;
      const rid = (await q1('SELECT reason_id FROM return_reasons WHERE is_active = 1 ORDER BY sort_order, reason_id LIMIT 1')).reason_id;
      const ret = await api(SH, 'POST', `/commerce/orders/${no}/returns`, { reason_id: rid, collection: 'bring', lines: [{ sku_code: SKU, batch_id: src.lines[0].batch_id, qty: 3 }] });
      const room = (await api(SH, 'GET', `/billing/credit-room/${enc(i1)}`)).data;
      const big = await api(SH, 'POST', '/billing/credit-notes', { invoice_no: i1, why: 'Price correction', amount: String(r2((Number(v1.taxable) * (room.room + room.held / 2)) / Number(v1.total))), note: 'Agreed rate' });
      ok(ret.status < 300 && room.held > 0 && big.status === 409 && /held for returns/.test(big.msg), `return ${ret.data && ret.data.return_no} (3 packs) holds ${room.held}; room ${room.room} of ${room.total}; too much: "${big.msg}"`);
      void pendingOf; }
  },
};
