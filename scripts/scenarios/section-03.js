// Section 3 - Suppliers and buying: the v23 Tests tab "3" (3.1 to 3.30), the buying fix items of the phase 16 script
// (F.3, F.7, F.21, F.35, F.37, H.52 B6, H.54 B1, H.55 B3, H.74 L1, H.84 X4, H.90 Y6, H.99) and its extra check RT (rates
// only with See cost or Buying Edit). Every test starts again from the dev data plus the v23 buying sample
// (helpers-buying.js); v23's document numbers map to the sample's own (p41..p44, p11, g16..g18, CL of g18). Where our data
// differs (stock, averages, open bills) the expected figure is worked out from ours with v23's rule; v23's is in the
// message. Lakshmi P (Supervisor, Chennai only) is DZIND150 on the dev data. Run: npm run scenarios -- 3
module.exports = {
  title: 'Suppliers and buying',
  async run(ctx) {
    const { api, ok, say, q1, qa, pool, T, fresh, run, decide, today, r2 } = ctx;
    const B = require('./helpers-buying')(ctx);
    const { avg, stockOf } = B;
    const LA = 'DZIND150';
    const TODAY = today();
    const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
    const js = (x) => JSON.stringify(x);
    const pend = async (kind, like = '%') => q1("SELECT approval_id, requested_by, summary FROM approvals WHERE status = 'pending' AND kind = ? AND summary LIKE ? ORDER BY approval_id DESC LIMIT 1", [kind, like]);
    const goodAt = async (sku, g) => ctx.shelf(sku, 'good', g);
    const holdAt = async (sku, g) => ctx.shelf(sku, 'hold', g);
    const qc = (who, id, ls) => api(who, 'POST', `/buying/goods-in/${id}/qc`, { lines: ls });
    const raise = (who, body) => api(who, 'POST', '/buying/pos', { action: 'raise', godown_id: 1, expected_on: TODAY, ...body });
    const gi = (who, body) => api(who, 'POST', '/buying/goods-in', body);
    let X;
    const start = async () => { await fresh(); X = await B.sample(); return X; };

    if (run('3.1')) { await start(); T('3.1', 'A supplier is checked before it is saved');
      const r = await api('SH', 'POST', '/buying/suppliers', { name: 'velan converters', kinds: ['raw'], terms_days: 30, status: 'active', state_code: '33', addr_l1: '12 Main Road', city: 'Ambur',
        contacts: [{ name: 'Arul', phone: '98400 1234', email: 'arul@x' }], gstin: '33AAKFA1234B1Z8', pin: '63580', bank: { acc: '123456789012', acc2: '123456789013', ifsc: 'IDIB000A123', holder: 'Arul', name: 'Indian Bank' } });
      const f = r.fields || {};
      ok(r.status === 400 && /already called Velan Converters/.test(f.name) && /10 digits/.test(f['contacts.0.phone']) && /Not an e-mail/.test(f['contacts.0.email']) && /last character does not match/.test(f.gstin) && /6 digits/.test(f.pin) && /Does not match/.test(f['bank.acc2']),
        `not saved, ${Object.keys(f).length} fields: ${js(f)}`); }

    // the dev walk-through gave Velan Converters v23's Ambur GSTIN (33AAKFA1234B1Z9), so Ambur Core Works gets another valid one
    const BR = require('../../src/shared/buyRules');
    const AMB_GSTIN = `33AAKFA9876B1Z${BR.gstinCheckChar('33AAKFA9876B1Z')}`;
    const amb = { name: 'Ambur Core Works', kinds: ['raw'], terms_days: 30, status: 'active', contacts: [{ name: 'Arul', phone: '98400 12345', email: 'arul@amburcore.in' }], gstin: AMB_GSTIN, addr_l1: '12 Main Road', city: 'Ambur', pin: '635802',
      bank: { acc: '123456789012', acc2: '123456789012', ifsc: 'IDIB000A123', holder: 'Ambur Core Works', name: 'Indian Bank' } };
    if (run('3.2')) { await start(); T('3.2', 'GSTIN and address must be in the same state');
      const k = await api('SH', 'POST', '/buying/suppliers', { ...amb, state_code: '29' });
      const pan = BR.panOf(AMB_GSTIN);
      const r = await api('SH', 'POST', '/buying/suppliers', { ...amb, state_code: '33', items: [{ sku_code: 'RM-CORE', price: 6.2, lead_days: 4, moq: 2000 }] });
      const row = r.data ? (await api('SH', 'GET', '/buying/suppliers?tab=active')).data.rows.find((x) => x.supplier_id === r.data.supplier_id) : null;
      ok(k.status === 400 && /starts with 33, but Karnataka is 29/i.test((k.fields || {}).gstin) && pan === 'AAKFA9876B', `${AMB_GSTIN} with Karnataka: "${(k.fields || {}).gstin}"; PAN fills itself: ${pan} (v23 AAKFA1234B)`);
      ok(r.status === 201 && /Same state: CGST \+ SGST on their bills\. Their bank account waits for a second Admin; they cannot be paid until it is signed/.test(r.data.message) && row && row.rating.n === 0 && row.bank_waiting,
        `saved as ${r.data && r.data.code} (v23 SUP-0005): "${r.data ? r.data.message : js(r.fields)}"; Active list: ${row && row.rating.n} goods in, bank change waiting ${row && row.bank_waiting}`); }

    if (run('3.3')) { await start(); T('3.3', 'A new bank account needs a second person');
      const vs = (await api('SH', 'GET', `/buying/suppliers/${X.VELAN}`)).data;
      const old4 = String(vs.supplier.bank.acc || '').slice(-4);
      const body = { ...vs.supplier, kinds: vs.supplier.kinds, contacts: vs.contacts, items: vs.items.map((x) => ({ ...x, spec_gsm: x.spec ? x.spec.gsm : '', spec_ply: x.spec ? x.spec.ply : '', spec_width: x.spec ? x.spec.width : '' })), no_gst: false };
      // the dev walk-through already moved Velan to v23's HDFC XXXX3444, so the new account here is HDFC ...3555
      const r = await api('SH', 'PUT', `/buying/suppliers/${X.VELAN}`, { ...body, bank: { holder: 'Velan Converters', name: 'HDFC Bank', acc: '50100222333555', acc2: '50100222333555', ifsc: 'HDFC0000999' } });
      const row = (await api('SH', 'GET', '/buying/suppliers')).data.rows.find((x) => x.supplier_id === X.VELAN);
      const a = await q1("SELECT approval_id, summary FROM approvals WHERE status = 'pending' AND kind = 'supplier_bank' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = ?", [`supbank:${X.VELAN}`]);
      const self = await decide('SH', a.approval_id); const pv = await decide('PV', a.approval_id);
      const s = (await api('SH', 'GET', `/buying/suppliers/${X.VELAN}`)).data.supplier;
      const au = await q1("SELECT before_json, after_json FROM audit_log WHERE entity_type = 'supplier' AND entity_id = ? AND after_json LIKE '%3555%' ORDER BY audit_id DESC LIMIT 1", [String(X.VELAN)]);
      ok(r.status === 200 && /New bank account sent for approval/.test(r.data.message) && /payments go only to the approved account/.test(r.data.message) && row.bank_waiting && a && /HDFC Bank XXXX3555/.test(a.summary),
        `"${r.data && r.data.message}"; the row shows Bank change waiting ${row && row.bank_waiting}; the request: "${a && a.summary}"`);
      ok(self.status >= 400 && pv.status === 200 && s.bank.acc === 'XXXX3555' && s.bank.name === 'HDFC Bank' && au && /XXXX3555/.test(js(au.after_json)) && /XXXX3444/.test(js(au.before_json)) && !/5010022233/.test(js(au)),
        `Shoban signs his own: ${self.status} "${self.msg}"; Pavithran: ${pv.status}; Velan now paid to ${s.bank.name} ${s.bank.acc} (was XXXX${old4}); the audit row keeps both masked: ${js(au && au.before_json).slice(0, 120)} -> ${js(au && au.after_json).slice(0, 120)}`); }

    if (run('3.4')) { await start(); T('3.4', 'A blocked supplier gets no order');
      const b = (await api('SH', 'GET', '/buying/suppliers?tab=blocked')).data.rows.find((x) => x.supplier_id === X.KAVERI);
      const o = (await api('SH', 'GET', '/buying/options')).data.suppliers.find((x) => x.supplier_id === X.KAVERI);
      const r = await raise('SH', { supplier_id: X.KAVERI, lines: [{ sku_code: 'RM-PR2', qty: 100, rate: 69 }] });
      ok(b && o && o.status === 'blocked' && r.status === 400 && /blocked/.test((r.fields || {}).supplier_id), `Blocked tab: ${b && `${b.name}: ${b.why}`}; the PO list marks it ${o && o.status}; raising anyway: "${(r.fields || {}).supplier_id}"`); }

    if (run('3.5')) { await start(); T('3.5', 'Only what is bought can be ordered');
      const offered = (await api('SH', 'GET', '/buying/options')).data.items.map((x) => x.sku_code).sort();
      const r = await raise('SH', { supplier_id: X.VELAN, lines: [{ sku_code: 'DF001-M100', qty: 10, rate: 30 }] });
      ok(js(offered) === js(['DF013-M50', 'DF028-M100', 'DF044-M100', 'DF048-BOX', 'RM-CORE', 'RM-CTN', 'RM-FILM', 'RM-PR2']) && r.status === 400 && /Made only/.test((r.fields || {})['lines.0.sku_code']),
        `offered: ${offered.join(', ')}; DF001-M100: "${(r.fields || {})['lines.0.sku_code']}"`); }

    if (run('3.6')) { await start(); T('3.6', 'An indent needs a second person');
      const a = await api('MU', 'POST', '/buying/indents', { godown_id: 1, need_by: TODAY, reason: '', lines: [{ sku_code: 'RM-CTN', qty: 1000 }] });
      const b = await api('MU', 'POST', '/buying/indents', { godown_id: 1, need_by: TODAY, reason: 'Cartons for the November dispatch', lines: [{ sku_code: 'RM-CTN', qty: 1000 }] });
      const id = b.data.indent_id;
      const m = (await api('MU', 'GET', `/buying/indents/${id}`)).data;
      const rj = await api('KU', 'POST', `/buying/indents/${id}/reject`, {});
      const ap = await api('KU', 'POST', `/buying/indents/${id}/approve`, {});
      const s = (await api('SH', 'GET', `/buying/indents/${id}`)).data.indent;
      ok(a.status === 400 && (a.fields || {}).reason && b.status === 201 && m.can.mine && !m.can.decide && rj.status === 400 && (rj.fields || {}).reason && ap.status < 300 && s.status === 'approved',
        `no Why: "${(a.fields || {}).reason}"; sent as ${b.data.indent_no} (v23 DFN/26-27/0007); Murugan: mine ${m.can.mine}, decide ${m.can.decide}; Kumar's Reject with no reason: "${(rj.fields || {}).reason}"; Approve: ${s.status}`); }

    if (run('3.7')) { await start(); T('3.7', 'An approved indent becomes a purchase order');
      const d = (await api('SH', 'GET', `/buying/indents/${X.ids.i5}/po-draft`)).data;
      const c = (await api('SH', 'POST', '/buying/pos/check', { supplier_id: X.VELAN, godown_id: 1, lines: d.lines })).data;
      const r = await raise('SH', { supplier_id: X.VELAN, indent_id: X.ids.i5, lines: [{ sku_code: 'RM-CORE', qty: 3000, rate: 6.5 }] });
      const i = await q1('SELECT i.status, p.po_no FROM indents i LEFT JOIN purchase_orders p ON p.po_id = i.po_id WHERE i.indent_id = ?', [X.ids.i5]);
      ok(d.supplier_id === X.VELAN && Number(d.lines[0].qty) === 3000 && Number(d.lines[0].rate) === 6.5 && c.value === 19500 && !c.need && r.status === 201 && !r.data.waiting && i.status === 'po' && i.po_no === r.data.po_no,
        `opens with Velan, ${d.lines[0].qty} at Rs ${d.lines[0].rate}; Rs ${c.value}, approval needed: ${c.need}; raised ${r.data && r.data.po_no} (v23 0045): "${r.data && r.data.message}"; indent ${i.status} ${i.po_no}`); }

    if (run('3.8')) { await start(); T('3.8', 'Reorder check fills the indent');
      const have = await goodAt('DF048-BOX', 1);
      await pool.query('INSERT INTO stock_levels (sku_code, location_id, reorder_level, reorder_qty) VALUES (?, 1, ?, 0) ON DUPLICATE KEY UPDATE reorder_level = VALUES(reorder_level)', ['DF048-BOX', have + 32]);
      const want = Math.max((have + 32) * 2 - have, 96);
      const a = await api('SH', 'POST', '/buying/indents/reorder-check');
      const b = await api('SH', 'POST', '/buying/indents/reorder-check');
      ok(a.status === 200 && a.data.made.some((x) => new RegExp(`DF048-BOX ${want}\\b`).test(x)) && b.data.made.length === 0 && /Everything is at or above/.test(b.data.message),
        `DF048-BOX: ${have} at Kanchipuram, reorder level set to ${have + 32} (v23 8 against 40): ${js(a.data && a.data.made)} (want ${want}: twice the level less what is there, at least Greenleaf's 96); again: "${b.data && b.data.message}"`); }

    if (run('3.9')) { await start(); T('3.9', 'Splitting purchase orders does not beat the limit');
      const lp = (await api('SH', 'GET', `/buying/last-price?supplier=${X.BALAJI}&sku=RM-CTN`)).data;
      const a = await raise('SH', { supplier_id: X.BALAJI, lines: [{ sku_code: 'RM-CTN', qty: 2000, rate: 22 }] });
      const c = (await api('SH', 'POST', '/buying/pos/check', { supplier_id: X.BALAJI, godown_id: 1, lines: [{ sku_code: 'RM-FILM', qty: 50, rate: 185 }] })).data;
      const b = await raise('SH', { supplier_id: X.BALAJI, lines: [{ sku_code: 'RM-FILM', qty: 50, rate: 185 }] });
      ok(lp.last && lp.last.rate === 22 && a.status === 201 && !a.data.waiting && c.need && c.value === 9250 && c.before === 44000 && b.data.waiting && /With Rs 44,000 of other orders to Sri Balaji Packaging in the last 3 days, that is Rs 53,250/.test(b.data.message),
        `rate fills ${lp.last && lp.last.rate}; first ${a.data && a.data.po_no} Rs 44,000 at once; the box: Rs ${c.value} with ${c.before} earlier, needs approval ${c.need}; ${b.data && b.data.po_no}: "${b.data && b.data.message}"`); }

    if (run('3.10')) { await start(); T('3.10', 'A dearer price or a small order is flagged');
      const c = (await api('SH', 'POST', '/buying/pos/check', { supplier_id: X.VELAN, godown_id: 1, lines: [{ sku_code: 'RM-PR2', qty: 300, rate: 75 }] })).data;
      const h = c.hints[0].text;
      ok(/Last Rs 72\.00 on/.test(h) && new RegExp(X.ids.p44.po_no.replace(/\//g, '\\/')).test(h) && /up 4\.2%/.test(h) && /below their minimum of 500 kg/.test(h) && /GST 18%/.test(h) && c.notes.length === 2,
        `under the item: "${h}" (v23 DFP/26-27/0044 = ${X.ids.p44.po_no}); "Check before raising": ${js(c.notes)}`); }

    if (run('3.11')) { await start(); T('3.11', 'A draft has no number');
      const top = async () => (await q1("SELECT MAX(po_no) n FROM purchase_orders WHERE po_no LIKE 'DFP/26-27/%'")).n;
      const n0 = await top();
      const d = await api('SH', 'POST', '/buying/pos', { action: 'draft', supplier_id: X.VELAN, godown_id: 1, expected_on: TODAY, lines: [{ sku_code: 'RM-PR2', qty: 300, rate: 75 }] });
      const n1 = await top(); const dr = await q1('SELECT po_no FROM purchase_orders WHERE po_id = ?', [d.data.po_id]);
      const r = await api('SH', 'POST', '/buying/pos', { action: 'raise', po_id: d.data.po_id, supplier_id: X.VELAN, godown_id: 1, expected_on: TODAY, lines: [{ sku_code: 'RM-PR2', qty: 300, rate: 72 }] });
      const want = `DFP/26-27/${String(Number(n1.slice(-4)) + 1).padStart(4, '0')}`;
      ok(d.status === 201 && d.data.draft && /Draft \d+ saved/.test(d.data.message) && dr.po_no === null && n0 === n1 && r.data && r.data.po_no === want, `"${d.data && d.data.message}" (the dev data has a draft already; v23 Draft 1), number ${dr.po_no}; last number still ${n1}; raised: ${r.data && r.data.po_no} (next ${want}; v23 0047)`); }

    if (run('3.12')) { await start(); T('3.12', 'A big order waits; the raiser cannot sign it');
      const r = await raise('KU', { supplier_id: X.VELAN, lines: [{ sku_code: 'RM-PR2', qty: 900, rate: 72 }] });
      const a = await pend('po', `PO ${r.data.po_no}%`);
      const k = await decide('KU', a.approval_id);
      const w = (await api('SH', 'GET', `/buying/pos/${r.data.po_id}`)).data;
      const pv = await decide('PV', a.approval_id);
      const d = (await api('SH', 'GET', `/buying/pos/${r.data.po_id}`)).data;
      ok(r.data.waiting && k.status >= 400 && w.state === 'waiting' && pv.status === 200 && d.state === 'open' && /Pavithran/.test(d.approved_by),
        `Rs 64,800: "${r.data.message}"; Kumar signs: ${k.status} "${k.msg}"; opened: ${w.state_label}; after Pavithran: ${d.state_label}, approved by ${d.approved_by}`); }

    if (run('3.13')) { await start(); T('3.13', 'The sample order 0044 waits for Shoban');
      const a = await pend('po', `PO ${X.ids.p44.po_no}%`);
      const pv = await decide('PV', a.approval_id); const sh = await decide('SH', a.approval_id);
      const d = (await api('SH', 'GET', `/buying/pos/${X.ids.p44.po_id}`)).data;
      ok(a && a.requested_by === 'DZIND148' && /1,200 kg/.test(a.summary) && pv.status >= 400 && sh.status === 200 && d.state === 'open', `"${a && a.summary}"; Pavithran: ${pv.status} "${pv.msg}"; after Shoban: ${d.state_label}`); }

    if (run('3.14')) { await start(); T('3.14', 'Amend keeps every revision');
      const id = X.ids.p43.po_id;
      const am = (lines) => api('SH', 'POST', `/buying/pos/${id}/amend`, { expected_on: TODAY, freight: 1400, terms: 'Delivered to our Kanchipuram godown.', lines });
      const a = await am([{ sku_code: 'RM-PR2', qty: 800, rate: 72 }, { sku_code: 'RM-CORE', qty: 1000, rate: 6.5 }]);
      const b = await am([{ sku_code: 'RM-PR2', qty: 800, rate: 72 }, { sku_code: 'RM-CORE', qty: 2500, rate: 6.5 }]);
      const w = (await api('SH', 'GET', `/buying/pos/${id}`)).data;
      const ap = await pend('po', '%Rev 2%'); if (ap) await decide('PV', ap.approval_id);
      const d = (await api('SH', 'GET', `/buying/pos/${id}`)).data;
      ok(a.status === 400 && /1,200 pieces has already come in/.test((a.fields || {})['lines.1.qty']) && b.data && b.data.waiting && /value went up to Rs 75,250/.test(b.data.message),
        `1000: "${(a.fields || {})['lines.1.qty']}"; 2500: "${b.data && b.data.message}"`);
      ok(w.amendment && w.amendment.rev === 2 && w.rev === 1 && d.rev === 2 && d.revisions[0].rev === 1 && d.revisions[0].lines.find((l) => l.sku === 'RM-CORE').qty === 2000 && d.revisions[0].freight === 1400,
        `while Rev 2 waits the order stays Rev ${w.rev} (v23 X4); signed: Rev ${d.rev}, "Earlier revisions" Rev 1 with ${d.revisions[0] && d.revisions[0].lines.find((l) => l.sku === 'RM-CORE').qty} cores, freight ${d.revisions[0] && d.revisions[0].freight}`); }

    if (run('3.15')) { await start(); T('3.15', 'Cancel and close short need a reason and the right');
      const c = X.ids.p11.po_id; const v = X.ids.p43.po_id;
      const a = await api('SH', 'POST', `/buying/pos/${c}/end`, { kind: 'cancel', reason: '' });
      await api('SH', 'POST', `/buying/pos/${c}/end`, { kind: 'cancel', reason: 'Supplier cannot deliver this month' });
      const cs = (await api('SH', 'GET', `/buying/pos/${c}`)).data;
      const x = await api('SH', 'POST', `/buying/pos/${v}/end`, { kind: 'cancel', reason: 'x' });
      await api('SH', 'POST', `/buying/pos/${v}/end`, { kind: 'close', reason: 'Cores now from Ambur' });
      const vs = (await api('SH', 'GET', `/buying/pos/${v}`)).data;
      const k = await api('KU', 'POST', `/buying/pos/${X.ids.p42.po_id}/end`, { kind: 'close', reason: 'x' });
      ok(a.status === 400 && (a.fields || {}).reason && cs.state === 'cancelled' && x.status === 409 && /Close it short instead/.test(x.msg) && vs.state === 'closed' && k.status === 403,
        `${X.ids.p11.po_no} with no reason: "${(a.fields || {}).reason}", then ${cs.state_label}; ${X.ids.p43.po_no} cancel: "${x.msg}", close short: ${vs.state_label}; Kumar: ${k.status}`); }

    if (run('3.16')) { await start(); T('3.16', 'Print or mail a purchase order');
      const id = X.ids.p43.po_id;
      const p = (await api('SH', 'GET', `/buying/pos/${id}/print`)).data;
      const n0 = Number((await q1('SELECT COUNT(*) n FROM mail_outbox')).n);
      const m = await api('SH', 'POST', `/buying/pos/${id}/mail`);
      const mo = await q1('SELECT to_email, attachments FROM mail_outbox ORDER BY mail_id DESC LIMIT 1');
      const n1 = Number((await q1('SELECT COUNT(*) n FROM mail_outbox')).n);
      const pdf = await fetch(`${ctx.base}/buying/pos/${id}/pdf`, { headers: { Cookie: ctx.cookie('SH') } }); const pb = Buffer.from(await pdf.arrayBuffer());
      const sup = ((await api('SH', 'GET', `/buying/suppliers/${X.VELAN}`)).data.contacts || []).find((c) => c.email) || {};
      ok(p.totals.total === 84960 && p.supplier.gstin && p.lines[0].their === 'JR-2P-17' && p.lines[0].hsn === '48030010' && p.lines[0].gst === 18,
        `print: total Rs ${p.totals.total}, supplier GSTIN ${p.supplier.gstin}, their codes ${p.lines.map((l) => l.their).join(', ')}, HSN ${p.lines[0].hsn}, GST ${p.lines[0].gst}%`);
      ok(m.status === 200 && n1 === n0 + 1 && mo.to_email === (sup && sup.email) && /"kind":"po"/.test(typeof mo.attachments === 'string' ? mo.attachments : js(mo.attachments)) && pdf.status === 200 && pb.slice(0, 4).toString() === '%PDF',
        `Mail: "${m.data ? m.data.message : m.msg}", outbox ${n0} -> ${n1}, to ${mo.to_email} (Velan's first contact ${sup.email}; v23 sales@velanconverters.in), attachments ${js(mo.attachments).slice(0, 120)} (mail is off in the scenarios); PDF ${pb.length} bytes`); }

    if (run('3.17')) { await start(); T('3.17', 'Goods in within the tolerance land in QC hold');
      const c = X.ids.p11.po_id;
      const a = await gi('SH', { po_id: c, challan_no: '', lines: [{ sku_code: 'RM-CTN', recv: 505, batch_no: 'C2610' }] });
      const b = await gi('SH', { po_id: c, challan_no: 'SBP/790X', vehicle_no: 'TN 5 lorry', lines: [{ sku_code: 'RM-CTN', recv: 505, batch_no: 'C2610' }] });
      const h0 = await holdAt('RM-CTN', 2); const g0 = await goodAt('RM-CTN', 2);
      const r = await gi('SH', { po_id: c, challan_no: 'SBP/790X', vehicle_no: 'TN 05 BQ 1180', lines: [{ sku_code: 'RM-CTN', recv: 505, batch_no: 'C2610' }] });
      ok(a.status === 400 && (a.fields || {}).challan_no && b.status === 400 && /TN 21 AX 4402/.test((b.fields || {}).vehicle_no) && r.status === 201 && /In QC hold at Chennai/.test(r.data.message) && (await holdAt('RM-CTN', 2)) === h0 + 505 && (await goodAt('RM-CTN', 2)) === g0,
        `no challan: "${(a.fields || {}).challan_no}"; "TN 5 lorry": "${(b.fields || {}).vehicle_no}"; ${r.data && r.data.grn_no}: "${r.data ? r.data.message : js(r.fields)}" (challan SBP/790X: the dev data already has SBP/790 from Balaji)`); }

    if (run('3.18')) { await start(); T('3.18', 'Too much, or a challan twice, is stopped');
      const r = await gi('SH', { po_id: X.ids.p11.po_id, challan_no: 'SBP/790X', vehicle_no: 'TN 05 BQ 1180', lines: [{ sku_code: 'RM-CTN', recv: 520, batch_no: 'C2610' }] });
      const h0 = await holdAt('RM-CTN', 2);
      const d = await gi('SH', { po_id: X.ids.p43.po_id, challan_no: 'VC/DC/3410', lines: [{ sku_code: 'RM-CORE', recv: 800, batch_no: 'X' }] });
      const a = await pend('excess_in'); const s = await decide('PV', a.approval_id);
      const g = (await api('SH', 'GET', `/buying/goods-in/${r.data.grn_id}`)).data;
      ok(r.data.waiting && /\+4%/.test(r.data.message) && h0 === 0 && new RegExp(`already taken in from this supplier \\(${X.ids.g18.grn_no.replace(/\//g, '\\/')}\\)`, 'i').test((d.fields || {}).challan_no) && s.status === 200 && (await holdAt('RM-CTN', 2)) === 520 && g.status === 'qc',
        `520: "${r.data.message}" (QC hold ${h0}); VC/DC/3410 again: "${(d.fields || {}).challan_no}" (v23 VC/DC/3390, DFG/26-27/0018); after Pavithran: QC hold ${await holdAt('RM-CTN', 2)}, ${g.status_label}`); }

    if (run('3.19')) { await start(); T('3.19', 'Scan cartons, and expiry is checked');
      const p = await raise('SH', { supplier_id: X.GREEN, lines: [{ sku_code: 'DF044-M100', qty: 240, rate: 58 }] });
      const per = Number((await q1("SELECT packs_per_carton n FROM skus WHERE sku_code = 'DF044-M100'")).n);
      const c = (await api('SH', 'POST', '/buying/scan', { code: 'DF044-M100#C' })).data;
      const onPo = (await api('SH', 'GET', `/buying/goods-in-form?po=${p.data.po_id}`)).data.lines.map((l) => l.sku_code);
      const n = (await api('SH', 'POST', '/buying/scan', { code: 'DF001-M100' })).data;
      const u = (await api('SH', 'POST', '/buying/scan', { code: '12345' })).data;
      const gl = (extra) => ({ po_id: p.data.po_id, challan_no: 'GL/INV/5600', lines: [{ sku_code: 'DF044-M100', recv: 3 * per, cartons: 3, ...extra }] });
      const a = await gi('SH', gl({}));
      const b = await gi('SH', gl({ batch_no: 'WW2611', mfg_date: '2024-10-01' }));
      const r = await gi('SH', gl({ batch_no: 'WW2611', mfg_date: '2024-12-01' }));
      const days = Math.round((Date.parse('2026-12-01') - Date.parse(TODAY)) / 864e5);
      ok(p.status === 201 && c.found && c.kind === 'carton' && c.packs === per && n.found && !onPo.includes('DF001-M100') && !u.found && /not a known barcode/.test(u.message),
        `${p.data.po_no}: a carton scan = ${c.packs} packs (3 scans ${3 * per}; v23 24 a carton, 72); DF001-M100 found but not on the order (${onPo.join(', ')}); 12345: "${u.message}"`);
      ok(a.status === 400 && (a.fields || {})['lines.0.batch_no'] && (a.fields || {})['lines.0.mfg_date'] && b.status === 400 && /expired on 2026-10-01/.test((b.fields || {})['lines.0.mfg_date']) && r.status === 201 && new RegExp(`expires in ${days} days`).test(r.data.message),
        `no batch: ${js(a.fields)}; made 2024-10-01: "${(b.fields || {})['lines.0.mfg_date']}"; made 2024-12-01: "${r.data ? r.data.message : js(r.fields)}" (v23 34 days from its 28 Oct)`); }

    if (run('3.20')) { await start(); T('3.20', 'Goods with no purchase order wait');
      const a = await gi('SH', { supplier_id: X.BALAJI, godown_id: 1, challan_no: 'SBP/811', lines: [{ sku_code: 'RM-FILM', recv: 20, batch_no: 'F2611' }] });
      const s0 = await stockOf('RM-FILM', 'good'); const h0 = await stockOf('RM-FILM', 'hold');
      const b = await gi('SH', { supplier_id: X.BALAJI, godown_id: 1, challan_no: 'SBP/811', lines: [{ sku_code: 'RM-FILM', recv: 20, batch_no: 'F2611', rate: 185 }] });
      ok(a.status === 400 && (a.fields || {})['lines.0.rate'] && b.data && b.data.waiting && /No purchase order\. Waiting for/.test(b.data.message) && (await stockOf('RM-FILM', 'good')) === s0 && (await stockOf('RM-FILM', 'hold')) === h0,
        `no rate: "${(a.fields || {})['lines.0.rate']}"; then "${b.data ? b.data.message : js(b.fields)}"; nothing in stock (challan SBP/811: the dev data has SBP/801)`); }

    if (run('3.21')) { await start(); T('3.21', 'QC hold can be switched off');
      const r = await api('SH', 'PUT', '/commerce-settings/quarantine', { value: '0' });
      const a = (await pend('rule_change', '%quarantine%')) || (await pend('rule_change', '%QC hold%'));
      if (a) await decide('PV', a.approval_id);
      const a0 = Number((await q1("SELECT avg_cost FROM skus WHERE sku_code = 'RM-CTN'")).avg_cost); const s0 = await stockOf('RM-CTN');
      const g = await gi('SH', { po_id: X.ids.p11.po_id, challan_no: 'SBP/790X', lines: [{ sku_code: 'RM-CTN', recv: 500, batch_no: 'C2610' }] });
      const want = r2((s0 * a0 + 500 * 22) / (s0 + 500));
      ok(a && /QC hold is switched off, so it is in stock now/.test(g.data && g.data.message) && (await goodAt('RM-CTN', 2)) === 500 && (await avg('RM-CTN')) === want,
        `switch off: "${(r.data && r.data.message) || r.msg}" (waits for a second Admin: ${Boolean(a)}); "${g.data ? g.data.message : js(g.fields)}"; Chennai ${await goodAt('RM-CTN', 2)}; RM-CTN average ${r2(a0)} -> ${await avg('RM-CTN')} (want ${want} from our ${s0} in stock; v23 21.50 -> 21.68)`); }

    if (run('3.22')) { await start(); T('3.22', 'Quality check splits accepted and rejected');
      const g = X.ids.g16.grn_id;
      const a = await qc('SH', g, [{ acc: 230, rej: 0 }]);
      const b = await qc('SH', g, [{ acc: 230, rej: 10 }]);
      const a0 = Number((await q1("SELECT avg_cost FROM skus WHERE sku_code = 'DF044-M100'")).avg_cost); const s0 = await stockOf('DF044-M100');
      const r = await qc('SH', g, [{ acc: 230, rej: 10, reason: 'Torn or crushed' }]);
      const want = r2((s0 * a0 + 230 * 60.5) / (s0 + 230));
      const p = (await api('SH', 'GET', `/buying/pos/${X.ids.p41.po_id}`)).data;
      ok(a.status === 400 && /must be 240, what came in\. Now 230/.test((a.fields || {})['lines.0.acc']) && b.status === 400 && (b.fields || {})['lines.0.reason'] && r.status === 200 && (await avg('DF044-M100')) === want && /claim CL-\d+/.test(r.data.message) && p.state === 'part',
        `230 + 0: "${(a.fields || {})['lines.0.acc']}"; no reason: "${(b.fields || {})['lines.0.reason']}"; saved: "${r.data && r.data.message}"; average ${r2(a0)} -> ${await avg('DF044-M100')} (230 at Rs 58 + 2.50 freight; want ${want}; v23 57.20 -> 59.25); ${X.ids.p41.po_no}: ${p.state_label}`); }

    if (run('3.23')) { await start(); T('3.23', 'Reels are checked for GSM');
      const a = await pend('po', `PO ${X.ids.p44.po_no}%`); await decide('SH', a.approval_id);
      const g = (await gi('SH', { po_id: X.ids.p44.po_id, challan_no: 'VC/DC/3412', lines: [{ sku_code: 'RM-PR2', recv: 1200, reels: 6, batch_no: 'VR1028' }] })).data.grn_id;
      const x = await qc('SH', g, [{ acc: 1200, rej: 0 }]);
      const y = await qc('SH', g, [{ acc: 1200, rej: 0, gsm: 15.5 }]);
      const a0 = Number((await q1("SELECT avg_cost FROM skus WHERE sku_code = 'RM-PR2'")).avg_cost); const s0 = await stockOf('RM-PR2');
      const r = await qc('SH', g, [{ acc: 1200, rej: 0, gsm: 15.5, deviation: 'Sir approved on call, used for 1-ply only' }]);
      const want = r2((s0 * a0 + 1200 * 72) / (s0 + 1200));
      ok(x.status === 400 && /Weigh a sample/.test((x.fields || {})['lines.0.gsm']) && y.status === 400 && /outside 17 \+\/- 1/.test((y.fields || {})['lines.0.deviation']) && r.status === 200 && (await avg('RM-PR2')) === want,
        `no GSM: "${(x.fields || {})['lines.0.gsm']}"; 15.5: "${(y.fields || {})['lines.0.deviation']}"; saved: 1,200 kg in, average ${r2(a0)} -> ${await avg('RM-PR2')} (want ${want}; v23 70.50 -> 71.36)`); }

    if (run('3.24')) { await start(); T('3.24', 'A bill is matched three ways');
      const g = X.ids.g18.grn_id;
      const f = (await api('SH', 'GET', `/buying/bill-form?supplier=${X.VELAN}`)).data.lines.filter((l) => l.grn_id === g);
      const bl = (reel) => [{ grn_id: g, sku_code: 'RM-PR2', qty: reel, rate: 72 }, { grn_id: g, sku_code: 'RM-CORE', qty: 1200, rate: 6.5 }];
      const a = await api('SH', 'POST', '/buying/bills', { supplier_id: X.VELAN, supplier_bill_no: 'VC/2711', bill_date: TODAY, total: 84000, lines: bl(780) });
      const b = await api('SH', 'POST', '/buying/bills', { supplier_id: X.VELAN, supplier_bill_no: 'VC/2711', bill_date: TODAY, total: 75472.8, lines: bl(800) });
      const r = await api('SH', 'POST', '/buying/bills', { supplier_id: X.VELAN, supplier_bill_no: 'VC/2711', bill_date: TODAY, total: 75472.8, lines: bl(780) });
      const due = addDays(TODAY, 30);
      ok(f.length === 2 && f[0].max === 780 && f[0].po_rate === 72 && f[1].max === 1200 && a.status === 400 && /add to Rs 75,472\.80/.test((a.fields || {}).total) && b.status === 400 && /Only 780 accepted and not billed/.test((b.fields || {})['lines.0.qty']) && r.status === 201 && new RegExp(`Due ${due} \\(MSME`).test(r.data.message),
        `lines of ${X.ids.g18.grn_no}: ${f.map((l) => `${l.sku_code} ${l.max} @ ${l.po_rate}`).join(', ')}; 84,000: "${(a.fields || {}).total}"; 800 kg: "${(b.fields || {})['lines.0.qty']}"; saved: ${r.data && r.data.bill_no} "${r.data ? r.data.message : js(r.fields)}" (bill VC/2711: the dev data has VC/2701)`); }

    if (run('3.25')) { await start(); T('3.25', 'A price different from the PO waits');
      const g = X.ids.g16.grn_id;
      await qc('SH', g, [{ acc: 240, rej: 0 }]);
      const c = (await api('SH', 'POST', '/buying/bills/check', { supplier_id: X.GREEN, bill_date: TODAY, freight: 600, lines: [{ grn_id: g, sku_code: 'DF044-M100', qty: 240, rate: 59 }] })).data;
      const r = await api('SH', 'POST', '/buying/bills', { supplier_id: X.GREEN, supplier_bill_no: 'GL/INV/5521', bill_date: TODAY, freight: 600, total: 17416.8, lines: [{ grn_id: g, sku_code: 'DF044-M100', qty: 240, rate: 59 }] });
      const a = await pend('bill_diff'); const s = a ? await decide('PV', a.approval_id) : null;
      const d = r.data ? (await api('SH', 'GET', `/buying/bills/${r.data.bill_id}`)).data : {};
      const left = (await api('SH', 'GET', `/buying/bill-form?supplier=${X.GREEN}`)).data.lines;
      ok(c.diff.length === 1 && c.diff[0].po_rate === 58 && c.totals.inter && r.data && r.data.waiting && /differs from the PO by Rs 240\.00 in all/.test(r.data.message) && s && s.status === 200 && d.status === 'unpaid' && left.length === 0,
        `the box: ${js(c.diff)}, IGST ${c.totals && c.totals.inter}; "${r.data ? r.data.message : js(r.fields)}"; after Pavithran: ${d.status_label}; a second bill finds ${left.length} lines`); }

    if (run('3.26')) { await start(); T('3.26', 'A claim settles by replacement');
      const cl = X.ids.cl1;
      const i = await api('SH', 'POST', `/buying/claims/${cl}/issue`, { outcome: 'replace' });
      const d = (await api('SH', 'GET', `/buying/claims/${cl}`)).data;
      const rej0 = await stockOf('RM-PR2', 'rej');
      const rt = await api('SH', 'POST', `/buying/claims/${cl}/returned`);
      const rej1 = await stockOf('RM-PR2', 'rej');
      const s1 = await api('SH', 'POST', `/buying/claims/${cl}/settle`);
      const g = await gi('SH', { po_id: X.ids.p43.po_id, challan_no: 'VC/DC/3420', lines: [{ sku_code: 'RM-PR2', recv: 20, batch_no: 'VR1030' }] });
      await qc('SH', g.data.grn_id, [{ acc: 20, rej: 0, gsm: 17 }]);
      const s2 = await api('SH', 'POST', `/buying/claims/${cl}/settle`);
      ok(/DFD\/26-27\/\d{4}/.test(i.data && i.data.message) && d.debit_total === 1699.2 && /DFT\/26-27\/\d{4}/.test(rt.data && rt.data.message) && rej0 === 20 && rej1 === 0 && s1.status === 409 && /still waits for 20 kg of RM-PR2/.test(s1.msg) && s2.status === 200,
        `${d.claim_no}: debit note ${d.debit_no} Rs ${d.debit_total} (v23 DFD/26-27/0004); "${rt.data && rt.data.message}", rejected shelf ${rej0} -> ${rej1}; settle: "${s1.msg}"; after the replacement: ${s2.status} "${s2.data && s2.data.message}"`); }

    if (run('3.27')) { await start(); T('3.27', 'A claim settles by credit note');
      const r = await qc('SH', X.ids.g16.grn_id, [{ acc: 230, rej: 10, reason: 'Torn or crushed' }]); const cl = r.data.claim.claim_id;
      const owe0 = (await api('SH', 'GET', '/buying/suppliers')).data.rows.find((x) => x.supplier_id === X.GREEN).owe;
      await api('SH', 'POST', `/buying/claims/${cl}/issue`, { outcome: 'credit' }); await api('SH', 'POST', `/buying/claims/${cl}/returned`);
      const a = await api('SH', 'POST', `/buying/claims/${cl}/credit`, { cn_no: 'GL/CN/88', amount: 580 });
      const b = await api('SH', 'POST', `/buying/claims/${cl}/credit`, { cn_no: 'GL/CN/88', amount: 684.4 });
      const owe1 = (await api('SH', 'GET', '/buying/suppliers')).data.rows.find((x) => x.supplier_id === X.GREEN).owe;
      const p = (await api('SH', 'GET', `/buying/pos/${X.ids.p41.po_id}`)).data;
      ok(a.status === 400 && /Our debit note is Rs 684\.40/.test((a.fields || {}).amount) && b.status === 200 && /We owe Greenleaf Hygiene Rs [\d,.]+ before, Rs [\d,.]+ now/.test(b.data.message) && r2(owe0 - owe1) === 684.4 && p.state === 'received' && p.lines[0].credited === 10,
        `580: "${(a.fields || {}).amount}"; 684.40: "${b.data ? b.data.message : js(b.fields)}" (we owed Rs ${owe0}, now ${owe1}: the dev data has an unpaid Greenleaf bill, so it is set against it; v23 owed 0); ${X.ids.p41.po_no}: ${p.state_label}, ${p.lines[0].credited} credited`); }

    if (run('3.28')) { await start(); T('3.28', 'Each role sees only its part');
      const pages = ['/buying/suppliers', '/buying/indents', '/buying/pos', '/buying/goods-in', '/buying/qc', '/buying/bills', '/buying/claims'];
      const dv = []; for (const p of pages) dv.push((await api('DV', 'GET', p)).status);
      const mv = (await api('MU', 'GET', '/buying/pos')).status;
      const mr = (await raise('MU', { supplier_id: X.VELAN, lines: [{ sku_code: 'RM-PR2', qty: 10, rate: 72 }] })).status;
      const mq = (await api('MU', 'POST', `/buying/goods-in/${X.ids.g16.grn_id}/qc`, { lines: [{ acc: 240, rej: 0 }] })).status;
      const mg = (await api('MU', 'GET', '/buying/goods-in-form')).status;
      const mi = (await api('MU', 'POST', '/buying/indents', { godown_id: 1, need_by: TODAY, reason: 'Cartons', lines: [{ sku_code: 'RM-CTN', qty: 100 }] })).status;
      const lp = (await api(LA, 'GET', '/buying/pos?tab=open')).data.rows.map((x) => x.po_no);
      const lg = (await api(LA, 'GET', '/buying/goods-in?tab=done')).data.rows.length;
      ok(dv.every((s) => s === 403), `Divya (Sales) on the 7 pages: ${dv.join(', ')}`);
      ok(mv === 200 && mr === 403 && mq === 403 && mg === 200 && mi === 201, `Murugan (Warehouse): POs view ${mv}, raise ${mr}; goods-in form ${mg}; indent ${mi}; Quality check ${mq}`);
      ok(js(lp) === js([X.ids.p11.po_no]) && lg === 0, `Lakshmi P (DZIND150, Chennai only): open POs ${js(lp)}; Kanchipuram goods in ${lg}`); }

    if (run('3.29')) { await start(); T('3.29', 'Approval rules drive buying');
      const r = await api('SH', 'PUT', '/approval-rules/po', { is_on: 0 });
      const a = await pend('rule_change'); const s = a ? await decide('PV', a.approval_id) : null;
      const k = await raise('KU', { supplier_id: X.VELAN, lines: [{ sku_code: 'RM-PR2', qty: 900, rate: 72 }] });
      const on = await api('SH', 'PUT', '/approval-rules/po', { is_on: 1 });
      const ro = await q1("SELECT is_on FROM approval_rules WHERE kind = 'po'");
      ok(a && s.status === 200 && k.status === 201 && !k.data.waiting && Number(ro.is_on) === 1, `off: "${(r.data && r.data.message) || r.msg}"; signed by Pavithran; Kumar's Rs 64,800: "${k.data && k.data.message}"; back on at once (${on.status}): ${ro.is_on}`); }

    if (run('3.30')) { await start(); T('3.30', 'Ctrl K finds suppliers and orders');
      const rows = (await api('SH', 'GET', '/buying/find?q=velan')).data.rows;
      ok(rows.some((x) => x.k === 'Supplier' && x.t === 'Velan Converters') && rows.some((x) => x.t === X.ids.p44.po_no) && rows.some((x) => x.t === X.ids.p43.po_no), rows.map((x) => `${x.k}: ${x.t}`).join(', ')); }

    if (run('RT')) { await start(); T('RT', 'Rates and totals only with See cost or Buying Edit');
      const m = (await api('MU', 'GET', `/buying/pos/${X.ids.p43.po_id}`)).data; const k = (await api('KU', 'GET', `/buying/pos/${X.ids.p43.po_id}`)).data;
      ok(m.total === null && m.lines[0].rate === null && m.totals === null && k.total === 84960, `Warehouse: total ${m.total}, rate ${m.lines[0].rate}; Supervisor (Buying Edit): ${k.total}`); }

    // ---------------------------------------------------------------- fix items
    if (run('F.3')) { await start(); T('F.3', 'A bill cannot be paid twice');
      const b = X.ids.b17.bill_id;
      const a = await api('SH', 'POST', '/money/supplier-payments', { supplier_id: X.BALAJI, bills: [{ bill_id: b, amount: 60770 }], mode: 'bank', reference: 'UTR123450', paid_on: TODAY });
      const c = await api('SH', 'POST', '/money/supplier-payments', { supplier_id: X.BALAJI, bills: [{ bill_id: b, amount: 60770 }], mode: 'bank', reference: 'UTR123451', paid_on: TODAY });
      const w = await pend('supplier_pay'); if (w) await decide('PV', w.approval_id);
      const p = await q1('SELECT paid, status FROM supplier_bills WHERE bill_id = ?', [b]);
      ok(a.data && a.data.waiting && c.status === 400 && /already waiting in another payment/.test(js(c.fields)) && Number(p.paid) === 60770 && p.status === 'paid', `first: "${a.data ? a.data.message : a.msg}"; second: ${js(c.fields || c.msg)}; after approval: paid ${p.paid}, ${p.status}`); }

    if (run('F.7')) { await start(); T('F.7', 'A rejected PO amendment keeps the old PO');
      await api('SH', 'POST', `/buying/pos/${X.ids.p43.po_id}/amend`, { expected_on: TODAY, freight: 1400, terms: 'Delivered to our Kanchipuram godown.', lines: [{ sku_code: 'RM-PR2', qty: 3000, rate: 72 }, { sku_code: 'RM-CORE', qty: 2000, rate: 6.5 }] });
      const a = await pend('po', '%Rev 2%'); await decide('PV', a.approval_id, 'rejected', 'too much');
      const d = (await api('SH', 'GET', `/buying/pos/${X.ids.p43.po_id}`)).data;
      ok(['part', 'open'].includes(d.state) && d.rev === 1 && d.lines[0].qty === 800 && d.lines[1].qty === 2000 && d.rejected.length === 1, `${d.state_label}, Rev ${d.rev}: ${d.lines.map((l) => `${l.sku_code} ${l.qty}`).join(', ')}; rejected revisions ${d.rejected.map((x) => x.rev).join(', ')}`); }

    if (run('F.21')) { await start(); T('F.21', 'A supplier credit note lowers what we owe');
      const r = await qc('SH', X.ids.g16.grn_id, [{ acc: 230, rej: 10, reason: 'Torn or crushed' }]); const cl = r.data.claim.claim_id;
      const b = await api('SH', 'POST', '/buying/bills', { supplier_id: X.GREEN, supplier_bill_no: 'GL/INV/5521', bill_date: TODAY, freight: 600, total: 16449.2, lines: [{ grn_id: X.ids.g16.grn_id, sku_code: 'DF044-M100', qty: 230, rate: 58 }] });
      const owe0 = (await api('SH', 'GET', '/buying/suppliers')).data.rows.find((x) => x.supplier_id === X.GREEN).owe;
      await api('SH', 'POST', `/buying/claims/${cl}/issue`, { outcome: 'credit' }); await api('SH', 'POST', `/buying/claims/${cl}/returned`);
      const c = await api('SH', 'POST', `/buying/claims/${cl}/credit`, { cn_no: 'GL/CN/88', amount: 684.4 });
      const fmt = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      ok(b.status === 201 && c.status === 200 && c.data.message.includes(`We owe Greenleaf Hygiene Rs ${fmt(owe0)} before, Rs ${fmt(r2(owe0 - 684.4))} now (set against`), `bill ${b.data && b.data.bill_no} Rs 16,449.20; "${c.data ? c.data.message : js(c.fields)}" (we owed ${owe0}; v23 20,000)`); }

    if (run('F.35')) { await start(); T('F.35', 'A rate up on a PO always asks');
      const r = await api('SH', 'POST', `/buying/pos/${X.ids.p43.po_id}/amend`, { expected_on: TODAY, freight: 0, terms: 'Delivered to our Kanchipuram godown.', lines: [{ sku_code: 'RM-PR2', qty: 800, rate: 80 }, { sku_code: 'RM-CORE', qty: 1200, rate: 6.5 }] });
      const a = await pend('po', '%Rev 2%');
      ok(r.data && r.data.waiting && a && /Rs 72,000 to Rs 71,800\. Rate up: RM-PR2 Rs 72\.00 to Rs 80\.00/.test(a.summary), `the value falls, still it waits: "${a && a.summary}"`); }

    if (run('F.37')) { await start(); T('F.37', 'POs add up by supplier');
      const a = await raise('KU', { supplier_id: X.VELAN, lines: [{ sku_code: 'RM-PR2', qty: 400, rate: 72 }] });
      const b = await raise('SH', { supplier_id: X.VELAN, lines: [{ sku_code: 'RM-PR2', qty: 400, rate: 72 }] });
      ok(a.data && !a.data.waiting && b.data && b.data.waiting && /With Rs 28,800 of other orders to Velan Converters in the last 3 days, that is Rs 57,600/.test(b.data.message), `Kumar Rs 28,800 at once; Shoban the same: "${b.data && b.data.message}"`); }

    if (run('H.52')) { await start(); T('H.52', 'B6: no supplier payment before its bank is approved; a change waiting does not stop payments');
      const s = await api('SH', 'POST', '/buying/suppliers', { ...amb, state_code: '33' });
      const res = [];
      for (const mode of ['cheque', 'bank']) { const r = await api('SH', 'POST', '/money/supplier-payments', { supplier_id: s.data.supplier_id, bills: [{ bill_id: X.ids.b17.bill_id, amount: 20000 }], mode, reference: 'CHQ555111', paid_on: TODAY }); res.push(r); }
      ok(res.every((r) => r.status === 409 && /has no approved bank account/.test(r.msg)), `a supplier whose bank waits: ${res.map((r) => `${r.status} "${r.msg}"`).join(' / ')}`);
      const bs = (await api('SH', 'GET', `/buying/suppliers/${X.BALAJI}`)).data;
      const approved = await q1('SELECT bank_acc FROM suppliers WHERE supplier_id = ?', [X.BALAJI]);
      await api('SH', 'PUT', `/buying/suppliers/${X.BALAJI}`, { ...bs.supplier, kinds: bs.supplier.kinds, contacts: bs.contacts, items: bs.items.map((x) => ({ ...x, spec_gsm: x.spec ? x.spec.gsm : '', spec_ply: x.spec ? x.spec.ply : '', spec_width: x.spec ? x.spec.width : '' })), no_gst: false, bank: { holder: 'Sri Balaji Packaging', name: 'Axis Bank', acc: '919010012345678', acc2: '919010012345678', ifsc: 'UTIB0000123' } });
      const f = (await api('SH', 'GET', `/money/supplier-payments/form/${X.BALAJI}`)).data;
      const p = await api('SH', 'POST', '/money/supplier-payments', { supplier_id: X.BALAJI, bills: [{ bill_id: X.ids.b17.bill_id, amount: 1000 }], mode: 'bank', reference: 'UTR777001', paid_on: TODAY });
      const sp = await q1('SELECT to_acc, status FROM supplier_payments ORDER BY pay_id DESC LIMIT 1');
      ok(f.bank_waiting && f.bank.acc === `XXXX${String(approved.bank_acc).slice(-4)}` && p.status === 201 && sp.to_acc === approved.bank_acc && sp.status === 'paid', `Balaji with a new account waiting: the Pay panel pays ${f.bank && f.bank.acc}; a payment now goes to XXXX${String(sp.to_acc).slice(-4)} (${sp.status})`); }

    if (run('H.54')) { await start(); T('H.54', 'B1: freight once per PO; differences on sold packs go to cost of sales');
      const g = X.ids.g16.grn_id;
      await qc('SH', g, [{ acc: 240, rej: 0 }]);
      const a0 = await avg('DF044-M100');
      const bill = (no, qty, fr, extra = {}) => api('SH', 'POST', '/buying/bills', { supplier_id: X.GREEN, supplier_bill_no: no, bill_date: TODAY, freight: fr, total: r2((qty * 58 + fr) * 1.18), lines: [{ grn_id: g, sku_code: 'DF044-M100', qty, rate: 58 }], ...extra });
      await bill('GL/A', 120, 600); await bill('GL/B', 120, 0);
      ok((await avg('DF044-M100')) === a0, `bill 120 with freight 600, then 120 with none: the average stays ${a0} (freight once)`);
      await fresh(); X = await B.sample();
      await qc('SH', g, [{ acc: 240, rej: 0 }]);
      const bt = await q1("SELECT batch_id FROM batches WHERE sku_code = 'DF044-M100' AND batch_no = 'WW2610'");
      await pool.query("INSERT INTO stock_movements (sku_code, location_id, stock_kind, batch_id, delta, move_type, note, emp_id) VALUES ('DF044-M100', 1, 'good', ?, -100, 'adjust', 'scenario: 100 sold', 'DZIND002')", [bt.batch_id]);
      const b0 = Number((await q1("SELECT avg_cost FROM skus WHERE sku_code = 'DF044-M100'")).avg_cost); const have = await stockOf('DF044-M100');
      await bill('GL/C', 240, 0);
      const c = await q1("SELECT value_stock, value_cos FROM cost_adjustments WHERE src_type = 'bill' ORDER BY adj_id DESC LIMIT 1");
      const want = r2(b0 + (-600 * 140) / 240 / have);
      ok(c && Number(c.value_cos) === -250 && (await avg('DF044-M100')) === want, `100 of WW2610 sold, then one bill with no freight: average ${r2(b0)} -> ${await avg('DF044-M100')} (want ${want}; v23 58.03), cost of sales ${c && c.value_cos} for the 100 sold`); }

    if (run('H.55')) { await start(); T('H.55', 'B3: late claims never more than accepted, same batch, real replacement');
      const g = X.ids.g16.grn_id;
      await qc('SH', g, [{ acc: 240, rej: 0 }]);
      const a = await api('SH', 'POST', `/buying/goods-in/${g}/late-claim`, { sku_code: 'DF044-M100', qty: 200, reason: 'Wet inside' });
      const b = await api('SH', 'POST', `/buying/goods-in/${g}/late-claim`, { sku_code: 'DF044-M100', qty: 52, reason: 'Wet inside' });
      const cl = a.data && a.data.claim.claim_id;
      await api('SH', 'POST', `/buying/claims/${cl}/issue`, { outcome: 'replace' }); await api('SH', 'POST', `/buying/claims/${cl}/returned`);
      const s = await api('SH', 'POST', `/buying/claims/${cl}/settle`);
      ok(a.status === 200 && b.status === 400 && /Only 40 can go back: .* in batch WW2610/.test((b.fields || {}).qty) && s.status === 409, `200: "${a.data && a.data.message}"; 52 more: "${(b.fields || {}).qty}"; settle before a replacement: "${s.msg}"`); }

    if (run('H.74')) { await start(); T('H.74', 'L1: an amendment counts with the supplier total');
      await raise('KU', { supplier_id: X.VELAN, lines: [{ sku_code: 'RM-PR2', qty: 400, rate: 72 }] });
      const r = await raise('KU', { supplier_id: X.VELAN, lines: [{ sku_code: 'RM-PR2', qty: 200, rate: 72 }] }); const id = r.data.po_id;
      const a = await api('KU', 'POST', `/buying/pos/${id}/amend`, { expected_on: TODAY, freight: 0, lines: [{ sku_code: 'RM-PR2', qty: 650, rate: 72 }] });
      const f = (await api('SH', 'GET', `/buying/goods-in-form?po=${id}`)).data;
      const w = await pend('po', '%Rev 2%'); await decide('PV', w.approval_id, 'rejected', 'no');
      const b = await api('KU', 'POST', `/buying/pos/${id}/amend`, { expected_on: TODAY, freight: 0, lines: [{ sku_code: 'RM-PR2', qty: 200, rate: 72 }, { sku_code: 'RM-CORE', qty: 10, rate: 1 }] });
      ok(!r.data.waiting && a.data && a.data.waiting && /with Rs 28,800 of other orders to this supplier/.test(a.data.message) && f.lines[0].open === 200 && b.data && b.data.waiting && /new line RM-CORE/.test(b.data.message),
        `200 kg at once; amended to 650: "${a.data && a.data.message}"; goods in still open ${f.lines[0].open}; a new line: "${b.data && b.data.message}"`); }

    if (run('H.84')) { await start(); T('H.84', 'X4: bills match only the approved PO');
      const id = X.ids.p43.po_id; const g = X.ids.g18.grn_id;
      const r = await api('SH', 'POST', `/buying/pos/${id}/amend`, { expected_on: TODAY, freight: 1400, terms: 'Delivered to our Kanchipuram godown.', lines: [{ sku_code: 'RM-PR2', qty: 800, rate: 80 }, { sku_code: 'RM-CORE', qty: 2000, rate: 6.5 }] });
      const f = (await api('SH', 'GET', `/buying/bill-form?supplier=${X.VELAN}`)).data.lines.find((l) => l.grn_id === g && l.sku_code === 'RM-PR2');
      const b = await api('SH', 'POST', '/buying/bills', { supplier_id: X.VELAN, supplier_bill_no: 'VC/780', bill_date: TODAY, total: r2((780 * 80 + 1200 * 6.5) * 1.18), lines: [{ grn_id: g, sku_code: 'RM-PR2', qty: 780, rate: 80 }, { grn_id: g, sku_code: 'RM-CORE', qty: 1200, rate: 6.5 }] });
      const a = await pend('po', '%Rev 2%'); await decide('PV', a.approval_id, 'rejected', 'no');
      const d = (await api('SH', 'GET', `/buying/pos/${id}`)).data;
      ok(r.data && r.data.waiting && f.po_rate === 72 && b.data && b.data.waiting && /differs from the PO by Rs 6,240\.00 in all/.test(b.data.message) && d.rejected.length === 1 && d.terms === 'Delivered to our Kanchipuram godown.' && d.lines[0].rate === 72,
        `72 -> 80 waits; the bill offers ${f && f.po_rate}; a bill at 80: "${b.data ? b.data.message : js(b.fields)}"; rejected: ${d.rejected.length} listed, rate ${d.lines[0].rate}, terms kept`); }

    if (run('H.90')) { await start(); T('H.90', 'Y6: PO freight stays in cost; a transporter bill can be added');
      const g = X.ids.g16.grn_id;
      await qc('SH', g, [{ acc: 240, rej: 0 }]);
      const a0 = await avg('DF044-M100');
      const bill = (no, extra = {}) => api('SH', 'POST', '/buying/bills', { supplier_id: X.GREEN, supplier_bill_no: no, bill_date: TODAY, freight: 0, total: r2(120 * 58 * 1.18), lines: [{ grn_id: g, sku_code: 'DF044-M100', qty: 120, rate: 58 }], ...extra });
      await bill('GL/A'); const a1 = await avg('DF044-M100'); await bill('GL/B', { freight_sep: true }); const a2 = await avg('DF044-M100');
      const pf = await q1('SELECT freight_cost, freight_billed, freight_sep FROM purchase_orders WHERE po_id = ?', [X.ids.p41.po_id]);
      ok(a1 === a0 && a2 === a0 && Number(pf.freight_cost) === 600 && Number(pf.freight_sep) === 1 && Number(pf.freight_billed) === 0, `average ${a0} after QC, ${a1} and ${a2} after the two bills; the PO keeps freight ${pf.freight_cost} in cost and waits for the transporter bill (sep ${pf.freight_sep}); the transporter bill itself is section 17 Y6`); }

    if (run('H.99')) { await start(); T('H.99', 'Smaller fixes: supplier credit shown as credit; no-PO freight is approved first');
      const r = await qc('SH', X.ids.g16.grn_id, [{ acc: 230, rej: 10, reason: 'Torn or crushed' }]); const cl = r.data.claim.claim_id;
      // the dev data's unpaid Greenleaf bill is paid off first so the credit stays a credit (v23 owed nothing)
      const ub = await qa("SELECT bill_id, total - paid AS left_amt FROM supplier_bills WHERE supplier_id = ? AND status <> 'paid'", [X.GREEN]);
      for (const b of ub) await pool.query("UPDATE supplier_bills SET paid = total, status = 'paid' WHERE bill_id = ?", [b.bill_id]);
      await api('SH', 'POST', `/buying/claims/${cl}/issue`, { outcome: 'credit' }); await api('SH', 'POST', `/buying/claims/${cl}/returned`); await api('SH', 'POST', `/buying/claims/${cl}/credit`, { cn_no: 'GL/CN/88', amount: 684.4 });
      const gr = (await api('SH', 'GET', '/buying/suppliers')).data.rows.find((x) => x.supplier_id === X.GREEN);
      ok(gr.owe === -684.4 && gr.owe_text === 'Rs 684.40 credit', `Greenleaf (its ${ub.length} open dev bill(s) marked paid first): "${gr.owe_text}"`);
      const g = await gi('SH', { supplier_id: X.BALAJI, godown_id: 1, challan_no: 'SBP/811', lines: [{ sku_code: 'RM-FILM', recv: 20, batch_no: 'F2611', rate: 185 }] });
      const a = await pend('no_po_in'); await decide('PV', a.approval_id);
      await qc('SH', g.data.grn_id, [{ acc: 20, rej: 0 }]);
      const f0 = Number((await q1("SELECT avg_cost FROM skus WHERE sku_code = 'RM-FILM'")).avg_cost); const s0 = await stockOf('RM-FILM');
      const b = await api('SH', 'POST', '/buying/bills', { supplier_id: X.BALAJI, supplier_bill_no: 'SBP/NP/1', bill_date: TODAY, freight: 500, total: r2((20 * 185 + 500) * 1.18), lines: [{ grn_id: g.data.grn_id, sku_code: 'RM-FILM', qty: 20, rate: 185 }] });
      const w = await pend('bill_diff'); if (w) await decide('PV', w.approval_id);
      const want = r2(f0 + 500 / s0);
      ok(b.data && b.data.waiting && /Freight on goods with no PO is approved first/.test(b.data.message) && (await avg('RM-FILM')) === want, `"${b.data ? b.data.message : js(b.fields)}"; approved: RM-FILM average ${r2(f0)} -> ${await avg('RM-FILM')} (want ${want})`); }
    void say;
  },
};
