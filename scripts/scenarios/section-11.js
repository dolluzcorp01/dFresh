// Section 11 - Payments: the v23 Tests tab "11", the money fix items Low3 d (a receipt for exactly one invoice's balance
// goes to that invoice) and Bad debt (a payment between the ask and the approval stops the write-off), the full money
// flow (invoice, e-way bill, part receipt, matched receipt, debit note, credit note, refund, bad debt, GSTR) and the
// balance cross-check. Each "Start again" restores the dev data and builds the v23 sales sample and delivery masters on it
// (helpers-sales.js); our customers and invoices stand in for v23's and each check works its figure out with v23's rule.
// Run: npm run scenarios -- 11
const path = require('path');
const helpers = require('./helpers-sales');

module.exports = {
  title: 'Payments',
  async run(ctx) {
    const { api, pool, ok, say, q1, qa, approveAll, decide, decideAny, packed, T, fresh, run, r2, today, enc, ROOT } = ctx;
    const { C, DIVYA, addD, sample, fulfilSample, trip, stopsOf, otpOf, bal, B2B, scanAll, pick } = helpers(ctx);
    const SH = 'SH'; const KU = 'KU'; const DV = 'DV'; const RA = 'RA';
    const SKU = 'DF001-M100';
    const start = async () => { await fresh(); const S = await sample(); await fulfilSample(); return S; };
    const money = require(path.join(ROOT || path.resolve(__dirname, '..', '..'), 'src', 'backend_routes', 'money.js')); // eslint-disable-line global-require
    const mkInv = async (no, extra = {}) => (await api(SH, 'POST', '/billing/invoices', { order_no: no, ...extra })).data;
    /** balance cross-check: ledger closing = open items - on account - credit on overpaid orders (allocations agree) */
    const crossCheck = async (label) => {
      const custs = await qa("SELECT customer_id, customer_no FROM customers WHERE status <> 'merged'");
      const bad = [];
      for (const c of custs) {
        const st = await money.statement(pool, c.customer_id);
        const items = await money.openItems(pool, c.customer_id);
        const neg = await q1("SELECT COALESCE(SUM(o.amount_due), 0) n FROM orders o JOIN invoices i ON i.order_id = o.order_id AND i.status = 'issued' WHERE o.customer_id = ? AND o.status <> 'cancelled' AND o.amount_due < -0.005", [c.customer_id]);
        const pre = await q1("SELECT COALESCE(SUM(p.amount), 0) n FROM payments p JOIN orders o ON o.order_id = p.order_id WHERE o.customer_id = ? AND p.kind = 'payment' AND p.reversed_at IS NULL AND (o.status = 'cancelled' OR NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.order_id AND i.status = 'issued'))", [c.customer_id]);
        const canc = await q1("SELECT COALESCE(SUM(p.amount), 0) n FROM payments p JOIN orders o ON o.order_id = p.order_id WHERE o.customer_id = ? AND p.kind = 'refund' AND p.reversed_at IS NULL AND (o.status = 'cancelled' OR NOT EXISTS (SELECT 1 FROM invoices i WHERE i.order_id = o.order_id AND i.status = 'issued'))", [c.customer_id]);
        const want = r2(items.reduce((a, x) => a + x.left, 0) - st.on_account + Number(neg.n) - Number(pre.n) + Number(canc.n));
        if (Math.abs(want - st.balance) > 0.02) bad.push(`${c.customer_no} ledger ${st.balance} vs items ${want}`);
      }
      ok(!bad.length, `${label}: every customer's ledger balance = open items - on account - credit on overpaid orders (${custs.length} customers)`, bad.slice(0, 5).join('; ') || 'all agree');
    };

    if (run('11.1')) { await start(); T('11.1', 'What customers owe, at a glance');
      const r = (await api(SH, 'GET', '/money/receipts')).data;
      let tot = 0; let od = 0; for (const x of r.owing) { const st = await money.statement(pool, x.customer_id); tot += st.balance; od += st.overdue; }
      ok(Math.abs(r.summary.owe - r2(tot)) < 0.02 && Math.abs(r.summary.overdue - r2(od)) < 0.02 && r.owing.every((x, i, a) => i === 0 || a[i - 1].overdue >= x.overdue),
        `owe ${r.summary.owe}, overdue ${r.summary.overdue} (each customer's ledger adds up); most overdue first: ${r.owing.slice(0, 3).map((x) => `${x.name} ${x.overdue}${x.status !== 'active' ? ` (${x.status})` : ''}`).join('; ')}; write-off offered: ${r.owing.filter((x) => x.late30 > 0).map((x) => x.name).join(', ') || 'none'}`);
      say('v23: owe Rs 2,51,340, overdue Rs 1,02,660, Vellore first. Ours are the dev invoices.'); }

    if (run('11.2')) { await start(); T('11.2', 'A UPI receipt settles the oldest due');
      const r = (await api(SH, 'GET', '/money/receipts')).data; const c = r.owing.find((x) => x.overdue > 0 && x.status === 'active') || r.owing[0];
      const f = await bal(c.customer_id); const oldest = f.items[0];
      const a = await api(SH, 'POST', '/money/receipts', { customer_id: c.customer_id, amount: String(oldest.left), mode: 'upi', reference: '' });
      const b = await api(SH, 'POST', '/money/receipts', { customer_id: c.customer_id, amount: String(oldest.left), mode: 'upi', reference: 'UTR614523' });
      const p = (await api(SH, 'GET', `/money/receipts/${enc(b.data.receipt_no)}`)).data;
      const cr = (await api(SH, 'GET', '/sales/credit')).data.rows.find((x) => x.customer_id === c.customer_id);
      ok(a.status === 400 && /UTR|reference/i.test(JSON.stringify([a.msg, a.fields])) && b.status === 200 && b.data.settles[0].no === oldest.no && p.settles[0].no === oldest.no,
        `${c.name}: no reference: "${a.msg}"; ${b.data.receipt_no}: "${b.data.message}"; print: ${p.amount} by ${p.mode_label}, balance after ${p.balance_after}; Credit limits: ${cr && (cr.would.length ? `Wait: ${cr.would.join(', ')}` : 'Go through')}`); }

    if (run('11.3') || run('11.4')) { await start(); T('11.3', 'A bounced cheque');
      const r = (await api(SH, 'GET', '/money/receipts')).data; const c = r.owing.find((x) => x.status === 'active') || r.owing[0];
      const f = await bal(c.customer_id); const amt = f.items[0].left;
      const a = await api(SH, 'POST', '/money/receipts', { customer_id: c.customer_id, amount: String(amt), mode: 'cheque', cheque_no: '123456', cheque_bank: 'Canara Bank, Kanchipuram', cheque_date: today() });
      const chq = (await api(SH, 'GET', '/money/cheques')).data.received.find((x) => x.cheque_no === '123456');
      const o1 = (await bal(c.customer_id)).owes;
      await api(SH, 'POST', `/money/cheques/${chq.cheque_id}/deposit`);
      const b = await api(SH, 'POST', `/money/cheques/${chq.cheque_id}/bounce`, { why: 'Funds insufficient', charge: '500' });
      const o2 = (await bal(c.customer_id)).owes; const cu = await q1('SELECT status, hold_reason FROM customers WHERE customer_id = ?', [c.customer_id]);
      ok(a.status === 200 && b.status === 200 && r2(o2 - o1) === r2(amt + 500) && cu.status === 'hold', `${c.name}: ${a.data.receipt_no} settles ${a.data.settles.map((x) => x.no).join(', ')}; owes ${o1}; bounced: "${b.data.message}" owes ${o2} (+${amt} + 500); ${cu.status}: ${cu.hold_reason}`);
      if (run('11.4')) { T('11.4', 'Waiving the bounce charge needs approval');
        const w = await api(SH, 'POST', `/money/cheques/${chq.cheque_id}/waive`);
        const d = await decideAny(w.data.approval_id);
        const o3 = (await bal(c.customer_id)).owes;
        const led = (await api(SH, 'GET', `/commerce/customers/${c.customer_id}/statement`)).data;
        const bounced = (await api(SH, 'GET', '/money/cheques')).data;
        ok(w.data.waiting && d.status === 200 && r2(o2 - o3) === 500 && led.lines.some((l) => l.kind === 'waive'), `waive: "${w.data.message}"; approved; owes ${o3}; ledger "${(led.lines.find((l) => l.kind === 'waive') || {}).text}"; Bounced tab: ${(bounced.bounced || []).map((x) => x.cheque_no).join(', ')}`); } }

    if (run('11.5')) { await start(); T('11.5', 'A post-dated cheque waits for its date');
      const c = { customer_id: C.sd };
      const a = await api(SH, 'POST', '/money/receipts', { customer_id: c.customer_id, amount: '100', mode: 'cheque', cheque_no: '654321', cheque_bank: 'SBI Kanchipuram', cheque_date: addD(today(), 15) });
      const chq = (await api(SH, 'GET', '/money/cheques')).data.received.find((x) => x.cheque_no === '654321');
      const d = await api(SH, 'POST', `/money/cheques/${chq.cheque_id}/deposit`);
      const old = await api(SH, 'POST', '/money/receipts', { customer_id: c.customer_id, amount: '100', mode: 'cheque', cheque_no: '111222', cheque_bank: 'SBI Kanchipuram', cheque_date: addD(today(), -95) });
      ok(/Post-dated: deposit it on/.test(a.data.message) && chq.post_dated && d.status === 409 && old.status === 400 && /3 months/.test(JSON.stringify([old.msg, old.fields])), `Sri Devi Clinic: "${a.data.message}"; PDC ${chq.post_dated}; Deposited: "${d.msg}"; 95 days old: "${old.msg}"`); }

    if (run('11.6')) { await start(); T('11.6', 'Paid too much: on account, then a refund');
      const c = { customer_id: C.ka };
      const o0 = (await bal(c.customer_id)).owes;
      const a = await api(SH, 'POST', '/money/receipts', { customer_id: c.customer_id, amount: String(r2(Math.max(o0, 0) + 3000)), mode: 'cash' });
      const cr = (await api(SH, 'GET', '/money/receipts')).data.credit.find((x) => x.customer_id === c.customer_id);
      const f = await api(SH, 'POST', '/money/refunds', { customer_id: c.customer_id, amount: '3000', mode: 'bank', reference: 'NEFT0099112', why: 'Paid twice' });
      const d = f.data && f.data.approval_id ? await decideAny(f.data.approval_id) : { status: 0 };
      const fin = (await bal(c.customer_id)).owes;
      const rf = (await api(SH, 'GET', '/money/refunds')).data.paid.find((x) => x.refund_no === (f.data && f.data.refund_no));
      ok(a.data.extra === 3000 && cr && r2(cr.credit) === r2(3000 - Math.min(o0, 0)) && f.data && f.data.waiting && d.status === 200 && rf && Math.abs(fin - Math.min(o0, 0)) < 0.01,
        `Kamatchi owed ${o0}, pays ${r2(Math.max(o0, 0) + 3000)}: "${a.data.message}"; credit balance ${cr && cr.credit}; refund ${f.data && f.data.refund_no} waits (above Rs 2,000), approved: ${rf ? 'Paid' : 'missing'}; owes ${fin} (it had ${Math.min(o0, 0)} on account before)`); }

    if (run('11.7')) { await start(); T('11.7', 'Pay a supplier');
      const r = (await api(SH, 'GET', '/money/supplier-payments')).data;
      const s = r.to_pay.find((x) => !x.no_bank && !x.bank_waiting && x.bills.some((b) => b.left > 0));
      if (!s) { ok(r.to_pay !== undefined, `To pay: ${r.to_pay.map((x) => `${x.name} ${x.total}${x.no_bank ? ' (no approved bank account)' : ''}`).join('; ') || 'nothing'}; no supplier with an approved bank account and an open bill on the dev data, so nothing to pay`); } else {
        const b = s.bills.find((x) => x.left > 0);
        const form = (await api(SH, 'GET', `/money/supplier-payments/form/${s.supplier_id}`)).data;
        const p = await api(SH, 'POST', '/money/supplier-payments', { supplier_id: s.supplier_id, bills: [{ bill_id: b.bill_id, amount: b.left }], mode: 'bank', reference: 'HDFCN26300199', paid_on: today() });
        const ap = await q1("SELECT approval_id FROM approvals WHERE kind = 'supplier_pay' AND status = 'pending' AND ref_id = ?", [p.data && p.data.pay_no]);
        if (ap) await decideAny(ap.approval_id);
        const after = (await api(SH, 'GET', '/money/supplier-payments')).data.paid.find((x) => x.pay_no === (p.data && p.data.pay_no));
        const bl = await q1('SELECT status FROM supplier_bills WHERE bill_id = ?', [b.bill_id]);
        const needs = Number(b.left) > Number(r.rule.above || 0) && r.rule.on;
        ok(p.status < 300 && Boolean(ap) === Boolean(needs) && after && bl.status === 'paid',
          `To pay ${s.name} ${b.bill_no} ${b.left} (${s.msme || 'not MSME'}, due ${b.due_date}); account ${form.bank && form.bank.acc}; rule above ${r.rule.above}: ${ap ? 'waited for a second person, approved' : 'no approval'}; ${p.data && p.data.pay_no} ${after ? 'Paid' : 'not paid'}; bill ${bl.status}`); } }

    if (run('11.8')) { const S = await start(); T('11.8', 'Cash from a trip becomes a receipt');
      const no = S.o1; await pick(KU, [no]); await scanAll(no); await api(KU, 'POST', `/commerce/packing/${no}/packed`, { cartons: 2, weight_kg: '6.5' });
      const iv = await mkInv(no);
      const tid = await trip([no]); await api(KU, 'POST', `/commerce/trips/${tid}/start`);
      const st = (await stopsOf(tid))[0];
      await api(RA, 'POST', `/commerce/stops/${st.stop_id}/delivered`, { receiver_name: 'Kamatchi M', otp: await otpOf(st.stop_id), signed: '1' });
      const part = r2(Number(st.to_collect) - 218);
      const ca = await api(RA, 'POST', `/commerce/stops/${st.stop_id}/cash`, { amount: String(part), why: 'Customer paid part, rest on account' });
      await api(KU, 'POST', `/commerce/trips/${tid}/end`, { cash_handed: String(part) });
      const rc = (await api(SH, 'GET', '/money/receipts')).data.receipts.find((x) => x.order_no === no);
      const left = (await q1('SELECT amount_due FROM orders WHERE order_no = ?', [no])).amount_due;
      ok(ca.status === 200 && rc && rc.source === 'trip' && rc.amount === part && Math.abs(Number(left) - 218) < 0.01 && rc.settles.some((x) => x.no === iv.invoice_no),
        `receipt ${rc && rc.receipt_no} "${rc && rc.source_label}" Rs ${rc && rc.amount} settling ${rc && rc.settles.map((x) => `${x.no}${x.full ? '' : ' (part)'}`).join(', ')}; ${no} still owes ${left} (v23 Rs 218.00)`); }

    if (run('11.9')) { await start(); T('11.9', 'An advance on an order');
      const r = await api(SH, 'POST', '/commerce/orders', { customer_id: C.ka, items: [{ sku_code: 'DF002-M100', qty: 10 }], advance: '300', advance_mode: 'cash' });
      const f = await bal(C.ka);
      ok(r.data.advance && f.on_account >= 300, `${r.data.order_no}: advance receipt ${r.data.advance && r.data.advance.receipt_no} "${r.data.advance && r.data.advance.label}" Rs 300; on account ${f.on_account}`);
      const no = r.data.order_no; await approveAll(r.data.order_no || r.data.quote_no);
      await pick(KU, [no]); await scanAll(no); await api(KU, 'POST', `/commerce/packing/${no}/packed`, { cartons: 1, weight_kg: '3' });
      const iv = await api(SH, 'POST', '/billing/invoices', { order_no: no });
      const o = await q1('SELECT total, amount_due FROM orders WHERE order_no = ?', [no]);
      ok(iv.status === 200 && iv.data.on_account_used && iv.data.on_account_used.length && r2(o.total - o.amount_due) === 300, `invoice ${iv.data.invoice_no}: "${iv.data.message}"; due ${o.amount_due} of ${o.total}`); }

    if (run('11.10') || run('11.11')) { await start(); T('11.10', 'Remind an overdue customer');
      const r = (await api(SH, 'GET', '/money/receipts')).data; const c = r.owing.find((x) => x.overdue > 0);
      const before = (await q1('SELECT COALESCE(MAX(log_id), 0) m FROM notification_log')).m;
      const m = await api(SH, 'POST', `/money/customers/${c.customer_id}/remind`);
      const log = await qa('SELECT event_key, recipient, status FROM notification_log WHERE log_id > ?', [before]);
      const again = (await api(SH, 'GET', '/money/receipts')).data.owing.find((x) => x.customer_id === c.customer_id);
      ok(m.status === 200 && log.some((x) => x.event_key === 'overdue') && again.reminded && again.reminded.day === today(), `${c.name}: "${m.data && m.data.message}"; log ${log.map((x) => `${x.event_key} ${x.recipient} ${x.status}`).join(', ')}; Reminded ${again.reminded && `${again.reminded.day} ${again.reminded.how}`}`);
      if (run('11.11')) { T('11.11', 'Write off a bad debt');
        const w = r.owing.find((x) => x.late30 > 0);
        if (!w) {
          // the dev data has no dues 30 days late: one invoice of Vellore (v23's) is made 45 days old
          await pool.query("UPDATE invoices i JOIN orders o ON o.order_id = i.order_id SET i.due_on = DATE_SUB(CURDATE(), INTERVAL 45 DAY) WHERE o.customer_id = ? AND i.status = 'issued' AND o.amount_due > 0", [C.vh]);
        }
        const w2 = w || (await api(SH, 'GET', '/money/receipts')).data.owing.find((x) => x.late30 > 0);
        const a = await api(SH, 'POST', `/money/customers/${w2.customer_id}/write-off`);
        const d = await decideAny(a.data.approval_id);
        const cu = await q1('SELECT status, hold_reason FROM customers WHERE customer_id = ?', [w2.customer_id]);
        const after = (await bal(w2.customer_id)).owes;
        const led = (await api(SH, 'GET', `/commerce/customers/${w2.customer_id}/statement`)).data;
        ok(a.data.waiting && d.status === 200 && cu.status === 'blocked' && r2(w2.owes - after) === r2(a.data.amount) && r2(a.data.amount) === r2(w2.late30) && led.lines.some((l) => l.kind === 'bad_debt'),
          `${w2.name}: "Write off Rs ${a.data.amount}" (late more than 30 days ${w2.late30}) waits; approved: owes ${w2.owes} -> ${after}; ${cu.status}: ${cu.hold_reason}`); } }

    if (run('11.12')) { await start(); T('11.12', 'Sales collect from their own customers');
      const a = (await api(DV, 'GET', '/money/receipts')).data; const b = await api(DV, 'GET', '/money/refunds'); const c = await api(DV, 'GET', '/money/supplier-payments'); const d = await api(DV, 'GET', '/money/cheques');
      const ids = new Set((await qa('SELECT customer_id FROM customers WHERE owner_emp_id = ?', [DIVYA])).map((x) => x.customer_id));
      ok(a.own && a.owing.length && a.owing.every((x) => ids.has(x.customer_id)) && a.can.create && b.status === 403 && c.status === 403 && d.status === 200 && (d.data.received || []).every((x) => !x.customer_id || ids.has(x.customer_id)),
        `Divya sees ${a.owing.length} customers (all hers), owe ${a.summary.owe}; Refunds ${b.status} "${b.msg}"; Supplier payments ${c.status} "${c.msg}"; cheques ${d.status}`);
      const other = await q1('SELECT customer_id FROM customers WHERE owner_emp_id <> ? OR owner_emp_id IS NULL LIMIT 1', [DIVYA]);
      const x = await api(DV, 'POST', '/money/receipts', { customer_id: other.customer_id, amount: '10', mode: 'cash' });
      ok(x.status === 403 || x.status === 404, `a receipt for another salesperson's customer: ${x.status} "${x.msg}"`); }

    // ================================================================================================ fix tests
    if (run('Low3d')) { await start(); T('Low3d', "A receipt for exactly one invoice's balance goes to that invoice");
      const c = await B2B();
      const n1 = await packed(c.customer_id, [{ sku_code: SKU, qty: 5 }]); await mkInv(n1);
      const n2 = await packed(c.customer_id, [{ sku_code: SKU, qty: 4 }]); const i2 = (await mkInv(n2)).invoice_no;
      const f = await bal(c.customer_id); const it2 = f.items.find((x) => x.no === i2);
      const rc = await api(SH, 'POST', '/money/receipts', { customer_id: c.customer_id, amount: String(it2.left), mode: 'cash', to: i2 });
      ok(f.items[0].no !== i2 && rc.data.settles.length === 1 && rc.data.settles[0].no === i2 && rc.data.settles[0].full, `open ${f.items.map((x) => `${x.no} ${x.left}`).join(', ')}; Rs ${it2.left} set against ${i2} (not the oldest ${f.items[0].no}): ${JSON.stringify(rc.data.settles)}`); }

    if (run('BAD')) { await start(); T('BAD', 'A payment between the ask and the approval stops the write-off');
      await pool.query("UPDATE invoices i JOIN orders o ON o.order_id = i.order_id SET i.due_on = DATE_SUB(CURDATE(), INTERVAL 45 DAY) WHERE o.customer_id = ? AND i.status = 'issued' AND o.amount_due > 0", [C.vh]);
      const w = (await api(SH, 'GET', '/money/receipts')).data.owing.find((x) => x.late30 > 0);
      const a = await api(SH, 'POST', `/money/customers/${w.customer_id}/write-off`);
      await api(SH, 'POST', '/money/receipts', { customer_id: w.customer_id, amount: '100', mode: 'cash' });
      const d = await decide('PV', a.data.approval_id); const d2 = await decide('AN', a.data.approval_id);
      ok(d.status >= 400 && /now owes/.test(d.msg), `${w.name}: approve after Rs 100 came in: Pavithran ${d.status} "${d.msg}"; Anitha ${d2.status} "${d2.msg}"`); }

    if (run('FLOW')) { await start(); T('FLOW', 'Invoice, e-way bill, part receipt, matched receipt, debit note, credit note, refund, bad debt, GSTR');
      const { setting } = ctx;
      await setting('eway_bill_required', 1); await setting('eway_bill_above', 1000);
      const c = await B2B(); const b0 = (await bal(c.customer_id)).owes;
      const n1 = await packed(c.customer_id, [{ sku_code: SKU, qty: 10 }]); const n2 = await packed(c.customer_id, [{ sku_code: SKU, qty: 6 }]);
      const i1 = await mkInv(n1, { ewb_no: '341022518876', ewb_valid: addD(today(), 1) });
      const i2 = await mkInv(n2, { ewb_no: '341022518877', ewb_valid: addD(today(), 1) });
      const part = (await api(SH, 'POST', '/money/receipts', { customer_id: c.customer_id, amount: '500', mode: 'upi', reference: 'UTRFLOW001', to: i1.invoice_no })).data;
      const left2 = (await bal(c.customer_id)).items.find((x) => x.no === i2.invoice_no).left;
      const match = (await api(SH, 'POST', '/money/receipts', { customer_id: c.customer_id, amount: String(left2), mode: 'bank', reference: 'NEFTFLOW02', to: i2.invoice_no })).data;
      const dn = (await api(SH, 'POST', '/billing/debit-notes', { invoice_no: i1.invoice_no, why: 'Freight not charged on the invoice', amount: '150' })).data;
      const cn = (await api(SH, 'POST', '/billing/credit-notes', { invoice_no: i1.invoice_no, why: 'Price correction', amount: '100', note: 'Agreed rate' })).data; await decideAny(cn.approval_id);
      const over = (await api(SH, 'POST', '/money/receipts', { customer_id: c.customer_id, amount: String(r2((await bal(c.customer_id)).owes + 250)), mode: 'cash' })).data;
      const rf = (await api(SH, 'POST', '/money/refunds', { customer_id: c.customer_id, amount: '250', mode: 'cash', why: 'Paid too much on the flow' })).data;
      if (rf && rf.waiting) await decideAny(rf.approval_id);
      const st = (await api(SH, 'GET', `/commerce/customers/${c.customer_id}/statement`)).data;
      const docs = [i1.invoice_no, i2.invoice_no, dn.debit_note_no, cn.credit_note_no, part.receipt_no, match.receipt_no, over.receipt_no, rf.refund_no];
      const net = r2(st.lines.filter((l) => docs.includes(l.doc)).reduce((a, l) => a + l.debit - l.credit, 0));
      const paidOver = r2(Number(over.extra) + (over.settles || []).reduce((a, x) => a + x.amount, 0));
      ok(Math.abs(net + b0) < 0.01 && Math.abs(st.balance) < 0.01 && match.settles[0].no === i2.invoice_no && match.settles[0].full,
        `ledger of the flow: invoices ${r2(i1.total + i2.total)} + debit ${dn.total} - credit ${cn.total} - receipts ${r2(500 + left2 + paidOver)} + refund 250 = ${net}; = ${net} (the overpaid receipt also cleared the ${b0} owed before); balance now ${st.balance} (was ${b0}); matched ${match.receipt_no} -> ${JSON.stringify(match.settles)}`);
      await pool.query("UPDATE invoices i JOIN orders o ON o.order_id = i.order_id SET i.due_on = DATE_SUB(CURDATE(), INTERVAL 45 DAY) WHERE o.customer_id = ? AND i.status = 'issued' AND o.amount_due > 0", [C.vh]);
      const w = (await api(SH, 'GET', '/money/receipts')).data.owing.find((x) => x.late30 > 0);
      const a = await api(SH, 'POST', `/money/customers/${w.customer_id}/write-off`); await decideAny(a.data.approval_id);
      const wst = (await api(SH, 'GET', `/commerce/customers/${w.customer_id}/statement`)).data;
      ok(wst.lines.some((l) => l.kind === 'bad_debt' && Math.abs(l.credit - a.data.amount) < 0.01) && Math.abs(wst.balance - r2(w.owes - a.data.amount)) < 0.01, `bad debt ${w.name}: ${a.data.amount} written off; balance ${w.owes} -> ${wst.balance}`);
      const m = today().slice(0, 7); const g = (await api(SH, 'GET', `/gst/month?month=${m}`)).data;
      const facts = await require(path.join(path.resolve(__dirname, '..', '..'), 'src', 'backend_routes', 'reports.js')).salesFacts(pool, { from: `${m}-01`, to: today(), scope: null }); // eslint-disable-line global-require
      const ft = r2(facts.filter((x) => x.sku_code !== '(round off)').reduce((x, y) => x + y.taxable, 0));
      ok(Math.abs(g.gstr3b.output.taxable - ft) < 0.01 && g.checks.every((x) => x.ok), `GSTR-3B output taxable ${g.gstr3b.output.taxable} = sales facts ${ft}; tax ${g.gstr3b.output.tax}; GSTR-1 checks ${g.checks.map((x) => `${x.label.slice(0, 30)}: ${x.ok}`).join('; ')}`);
      await crossCheck('after the flow'); }

    if (run('CROSS')) { await start(); T('CROSS', 'The sample as built'); await crossCheck('dev data + sample'); }
  },
};
