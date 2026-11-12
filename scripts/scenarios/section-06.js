// Section 6 - Customers: the v23 Tests tab "6" and the sales fix items C1 (customer types wait for a second person; Sales
// tighten, not ease), N4 (a non-standard type waits), RP2 (godown scope), Y11 + N10 (a role change hands the customers
// over), Y8 (a merge keeps the invoice buyer) and Low3 e (no special price on a draft product). Each "Start again" restores
// the dev data and builds the v23 sales sample on it (helpers-sales.js); our figures stand in for v23's and each check works
// its figure out with v23's rule. Run: npm run scenarios -- 6
const helpers = require('./helpers-sales');

module.exports = {
  title: 'Customers',
  async run(ctx) {
    const { api, pool, ok, say, q1, qa, decide, decideAny, T, fresh, run, r2, today } = ctx;
    const { C, DIVYA, addD, lid, pendingLike, sample } = helpers(ctx);
    const SH = 'SH'; const PV = 'PV'; const AN = 'AN'; const DV = 'DV';
    const start = async () => { await fresh(); return sample(); };
    const isLate = (x) => ['new', 'contacted', 'qualified'].includes(x.status) && !x.first_reply_at && Date.now() - new Date(x.created_at).getTime() > 864e5;

    if (run('6.1')) { await start(); T('6.1', 'Every website form lands in Enquiries');
      const r = await api(SH, 'GET', '/leads?limit=100');
      const cnt = {}; r.data.rows.forEach((x) => { cnt[x.status] = (cnt[x.status] || 0) + 1; });
      const late = r.data.rows.filter(isLate).map((x) => x.lead_ref);
      const dist = (await api(SH, 'GET', '/leads?form=distributor&limit=100')).data.rows;
      ok(cnt.new === 2 && cnt.contacted === 2 && cnt.qualified === 1 && cnt.won === 1 && cnt.lost === 1 && cnt.spam === 1 && late.join() === 'DFL-260007' && dist.length === 1 && dist[0].status === 'contacted',
        `New ${cnt.new}, Contacted ${cnt.contacted}, Qualified ${cnt.qualified}, Won ${cnt.won}, Lost ${cnt.lost}, Spam ${cnt.spam} (v23 2/2/1/1/1/1); late (no reply in 24 h): ${late.join(', ')} (v23 DFL-260030); DFL-269001 came in 3 hours ago (not late); Distributor filter: ${dist.map((x) => `${x.lead_ref} ${x.business_name} ${x.status}`).join()}`); }

    if (run('6.2')) { await start(); T('6.2', 'An enquiry shows everything the visitor typed');
      const l8 = await lid('DFL-260008');
      const r = await api(SH, 'GET', `/leads/${l8}`);
      const calls8 = (await api(SH, 'GET', `/sales/calls?lead=${l8}`)).data;
      ok(r.status === 200 && r.data.phone && r.data.consent_text && r.data.consent_at && calls8.rows.length === 1 && calls8.next_on === addD(today(), 2),
        `${r.data.full_name}, ${r.data.business_name}, ${r.data.town}, ${r.data.phone}, ${r.data.email}; consent "${r.data.consent_text}" at ${r.data.consent_at}; sheet ${r.data.sheet_synced_at || 'waiting'}; call: "${calls8.rows[0] && calls8.rows[0].note}" by ${calls8.rows[0] && calls8.rows[0].by_name}, next call ${calls8.next_on}`); }

    if (run('6.3')) { await start(); T('6.3', 'An existing customer is caught (Link, no second customer)');
      const l6 = await lid('DFL-260006');
      const n0 = (await q1('SELECT COUNT(*) n FROM customers')).n;
      const m = await api(SH, 'GET', `/sales/leads/${l6}/matches`);
      const lk = await api(SH, 'POST', `/sales/leads/${l6}/link`, { customer_id: C.pt });
      const st = await q1('SELECT status FROM leads WHERE lead_id = ?', [l6]);
      const n1 = (await q1('SELECT COUNT(*) n FROM customers')).n;
      ok(m.status === 200 && m.data.rows.some((x) => x.customer_id === C.pt) && lk.status === 200 && st.status === 'won' && n1 === n0,
        `DFL-260006 has the phone of CUS-0005 (v23 CUS-0143 Padur Tech Park): matches ${m.data && m.data.rows.map((x) => `${x.customer_no} by ${x.by}`).join(', ')}; Link: ${lk.status} ${lk.msg || ''}; enquiry ${st.status}; customers ${n0} -> ${n1}`); }

    if (run('6.4')) { await start(); T('6.4', 'Make customer fills everything in');
      const l1 = await lid('DFL-269001');
      const r = await api(SH, 'POST', `/commerce/customers/from-lead/${l1}`, { address: '12, Station Road', pincode: '631501' });
      const nc = r.data && r.data.customer_id && await q1('SELECT c.customer_no, c.name, c.type_key, c.credit_days, c.lead_id, (SELECT COUNT(*) FROM customer_contacts k WHERE k.customer_id = c.customer_id) contacts, (SELECT town FROM customer_addresses a WHERE a.customer_id = c.customer_id LIMIT 1) town, (SELECT pincode FROM customer_addresses a WHERE a.customer_id = c.customer_id LIMIT 1) pin FROM customers c WHERE c.customer_id = ?', [r.data.customer_id]);
      const st1 = await q1('SELECT status FROM leads WHERE lead_id = ?', [l1]);
      const td = await q1("SELECT default_credit_days d FROM customer_types WHERE type_key = 'hotel'");
      ok(r.status === 200 && nc && nc.type_key === 'hotel' && Number(nc.contacts) === 1 && nc.pin === '631501' && Number(nc.credit_days) === Number(td.d) && st1.status === 'won',
        `${nc && nc.customer_no} ${nc && nc.name}, type ${nc && nc.type_key} (${nc && nc.credit_days} days to pay, the type default), ${nc && nc.contacts} contact, town ${nc && nc.town} ${nc && nc.pin}; DFL-269001 is ${st1.status}`); }

    if (run('6.5')) { await start(); T('6.5', 'A lost enquiry needs a reason, spam leaves the lists');
      const l7 = await lid('DFL-260007'); const l1 = await lid('DFL-269001');
      const r = await api(SH, 'POST', `/sales/leads/${l7}/close`, { how: 'lost' });
      const r5 = await api(SH, 'POST', `/sales/leads/${l7}/close`, { how: 'lost', reason: 'Too far to deliver' });
      const r6 = await api(SH, 'POST', `/sales/leads/${l1}/close`, { how: 'spam' });
      const s7 = await q1('SELECT status, lost_reason FROM leads WHERE lead_id = ?', [l7]);
      const late = (await api(SH, 'GET', '/leads?limit=100')).data.rows.filter(isLate);
      ok(r.status === 400 && /Say why it was lost/.test(JSON.stringify(r.fields || r.msg)) && r5.status === 200 && s7.status === 'lost' && s7.lost_reason === 'Too far to deliver' && r6.status === 200 && r6.data.status === 'spam' && !late.length,
        `no reason: "${(r.fields && r.fields.lost_reason) || r.msg}"; then ${s7.status} (${s7.lost_reason}), late enquiries left ${late.length}; DFL-269001: ${r6.data && r6.data.status}`); }

    if (run('6.6')) { await start(); T('6.6', 'A logged call clears the late flag');
      const l7 = await lid('DFL-260007');
      const r = await api(SH, 'POST', '/sales/calls', { lead_id: l7, how: 'whatsapp', note: 'Sending the 2-ply sample', next_on: addD(today(), 3), sample_sku: 'DF002-M100' });
      const s6 = await q1('SELECT status, assigned_to, first_reply_at FROM leads WHERE lead_id = ?', [l7]);
      const fu6 = await q1("SELECT DATE_FORMAT(due_on, '%Y-%m-%d') d FROM follow_ups WHERE lead_id = ? AND status = 'open'", [l7]);
      const smp = (await api(SH, 'GET', '/sales/follow-ups')).data.samples.find((s) => s.sample_no === (r.data && r.data.sample));
      ok(r.status === 201 && /^SMP-\d{4}$/.test(r.data.sample) && s6.status === 'contacted' && s6.assigned_to === 'DZIND002' && s6.first_reply_at && fu6 && fu6.d === addD(today(), 3) && smp && smp.status === 'to_send',
        `sample ${r.data && r.data.sample} (v23 SMP-0008) ${smp && smp.status}; DFL-260007 now ${s6.status}, given to ${s6.assigned_to}, replied ${s6.first_reply_at ? 'yes (no 24-hour flag)' : 'no'}, next call ${fu6 && fu6.d}`); }

    if (run('6.7')) { await start(); T('6.7', 'Follow-ups list what is due');
      const r = (await api(SH, 'GET', '/sales/follow-ups')).data;
      const t = today();
      ok(r.due.some((x) => x.ref === 'DFL-269002' && x.due_on < t) && r.due.some((x) => x.ref === 'CUS-0007' && x.due_on === t) && r.later.length === 2 && r.samples.length === 3 && r.calls.length >= 4 && r.calls.every((x, i, a) => i === 0 || a[i - 1].happened_at >= x.happened_at),
        `Today and overdue: ${r.due.map((x) => `${x.name} ${x.due_on} "${x.last_said || ''}"`).join('; ')} | Coming up: ${r.later.map((x) => `${x.name} ${x.due_on}`).join('; ')} | Samples: ${r.samples.map((s) => `${s.sample_no} ${s.status}`).join(', ')} | ${r.calls.length} calls, newest first`); }

    if (run('6.8')) { await start(); T('6.8', 'Sales see their own');
      const l7 = await lid('DFL-260007');
      const r = await api(DV, 'GET', '/leads?limit=100');
      const dvLeads = r.data.rows.map((x) => x.lead_ref);
      const dvCust = (await api(DV, 'GET', '/commerce/customers')).data;
      const ex = await api(DV, 'GET', '/commerce/customers/export.xlsx');
      const give = await api(DV, 'PATCH', `/leads/${l7}`, { assigned_to: 'DZIND148' });
      ok(!dvLeads.includes('DFL-260006') && dvLeads.includes('DFL-260007') && dvCust.ownOnly && dvCust.rows.length === 5 && !dvCust.rows.some((c) => [C.pt, C.vh].includes(c.customer_id)) && give.status === 403,
        `"Your own" ${dvCust.ownOnly}; Divya's enquiries: ${dvLeads.join(', ')} (no DFL-260006, Pavithran's); customers: ${dvCust.rows.length} (${dvCust.rows.map((c) => c.customer_no).join(', ')}), no CUS-0005 / CUS-0007; giving DFL-260007 to Pavithran: ${give.status} "${give.msg}"`);
      say(`Export CSV for Sales: ${ex.status} (our Sales role has Export on Customers; v23 Sales has none - a role setting, not a rule)`); }

    if (run('6.9')) { await start(); T('6.9', 'A new customer needs a reason, and no twin');
      const hk = await q1('SELECT name, phone FROM customers WHERE customer_id = ?', [C.hk]);
      const base = { godown_id: 1, name: 'Sri Balaji Hotel', type_key: 'hotel', phone: '9800011122', bill: { name: 'Sri Balaji Hotel', address: '1, Main Road', town: 'Kanchipuram', state_code: '33', pincode: '631501' } };
      const g0 = await api(SH, 'POST', '/commerce/customers', { ...base, name: hk.name, phone: '9841066120', source: '' });
      const g1 = await api(SH, 'POST', '/commerce/customers', { ...base, phone: '9800011199', source: 'Walk-in', bill: { ...base.bill, gstin: '33AAFFH4521K1ZA' } });
      const g2 = await api(SH, 'POST', '/commerce/customers', { ...base, source: 'Walk-in', phone: hk.phone });
      const g3 = await api(SH, 'POST', '/commerce/customers', { ...base, source: 'Walk-in' });
      const n3 = g3.data && g3.data.customer_id && await q1('SELECT c.customer_no, c.type_key, c.credit_days, c.source, pl.name AS list FROM customers c JOIN customer_types t ON t.type_key = c.type_key LEFT JOIN price_lists pl ON pl.list_key = t.list_key WHERE c.customer_id = ?', [g3.data.customer_id]).catch(() => q1('SELECT customer_no, type_key, credit_days, source FROM customers WHERE customer_id = ?', [g3.data.customer_id]));
      const td = await q1("SELECT default_credit_days d FROM customer_types WHERE type_key = 'hotel'");
      ok(g1.status === 400 && /GSTIN/.test(JSON.stringify([g1.msg, g1.fields])), `GSTIN 33AAFFH4521K1ZA (check character should be K): ${g1.status} "${g1.msg}" ${JSON.stringify(g1.fields || {})}`);
      ok(g2.status === 409 && /CUS-0001/.test(g2.msg) && g3.status === 201 && n3 && Number(n3.credit_days) === Number(td.d) && n3.source === 'Walk-in',
        `phone of CUS-0001: "${g2.msg}"; then ${n3 && n3.customer_no} on the hotel type${n3 && n3.list ? ` (${n3.list})` : ''}, ${n3 && n3.credit_days} days (the type default), source ${n3 && n3.source}`);
      say(`the name of CUS-0001 again with no source: ${g0.status} ${g0.msg || ''} (v23 refuses "the name is taken" and asks "Say how they came"; ours checks phone, e-mail and GSTIN and takes the source from the list, default Phone - the phase 19 decision, as the old script noted)`); }

    if (run('6.10')) { await start(); T('6.10', 'On hold and blocked need a reason');
      const r = await api(SH, 'PUT', `/commerce/customers/${C.am}/status`, { status: 'hold', reason: '' });
      const h2 = await api(SH, 'PUT', `/commerce/customers/${C.am}/status`, { status: 'hold', reason: 'GST certificate pending' });
      const held1 = (await api(SH, 'GET', '/commerce/customers?status=held')).data.rows.map((c) => c.customer_no);
      const cr10 = (await api(SH, 'GET', '/sales/credit')).data.rows.filter((c) => [C.am, C.vh].includes(c.customer_id)).map((c) => `${c.customer_no} ${c.would.join(', ')}`);
      ok(r.status === 400 && /Say why/.test(JSON.stringify([r.msg, r.fields])) && h2.status === 200 && held1.includes('CUS-0013') && held1.includes('CUS-0007') && cr10.length === 2 && cr10.every((x) => /on hold/.test(x)),
        `"${r.msg}"; then on hold; On hold and blocked tab: ${held1.join(', ')}; Credit limits: ${cr10.join(' | ')}`); }

    if (run('6.11')) { await start(); T('6.11', 'The type decides the price list');
      const r = await api(SH, 'GET', '/sales/customer-types');
      const homeT = r.data.rows.find((t) => t.type_key === 'home');
      const other = r.data.lists.find((l) => l.name !== homeT.list_name && !l.is_default) || r.data.lists.find((l) => l.name !== homeT.list_name);
      const tm = await api(SH, 'PUT', '/sales/customer-types/home', { label: homeT.label, default_credit_days: 0, list_key: other.key, is_active: true });
      const ap = await pendingLike('cust_change', `%${homeT.label}%`);
      const d = ap ? await decide(PV, ap.approval_id) : { status: 0 };
      const nowHome = (await api(SH, 'GET', '/sales/customer-types')).data.rows.find((t) => t.type_key === 'home');
      const sch = await api(SH, 'POST', '/sales/customer-types', { type_key: 'school', label: 'School', default_credit_days: 15, list_key: '', is_active: true });
      const pickable = (await api(SH, 'GET', '/sales/customer-types')).data.rows.some((t) => t.type_key === 'school' && t.is_active);
      ok(tm.status === 200 && d.status === 200 && nowHome.list_name === other.name && sch.status === 201 && pickable,
        `${r.data.rows.map((t) => `${t.label} ${t.list_name} ${t.default_credit_days || 'cash'}`).join(', ')} | Home to ${other.name}: "${tm.data && tm.data.message}"; approved by Pavithran (${d.status}): Home now on ${nowHome.list_name} | School: "${sch.data && sch.data.message}", can be picked ${pickable}`);
      say('v23 moves the type at once for an Admin; ours (v23 fix C1) waits for a second person even for an Admin (Shoban asked, Pavithran signed).'); }

    if (run('6.12')) { await start(); T('6.12', 'Credit: orders that would wait');
      const r = (await api(SH, 'GET', '/sales/credit')).data;
      const row = (id) => r.rows.find((c) => c.customer_id === id);
      const line = (k) => { const x = row(C[k]); return `${x.customer_no} ${x.name}: limit ${x.credit_limit || 'cash'}, owes ${x.owes}, used ${x.used_pct === null ? '-' : `${x.used_pct}%`}, overdue ${x.overdue}, ${x.would.length ? `Wait: ${x.would.join(', ')}` : 'Go through'}`; };
      const vh = row(C.vh); const hk = row(C.hk); const ka = row(C.ka);
      const wantHk = (Number(hk.overdue) > 0.004 || Number(hk.owes) > Number(hk.credit_limit)) ? hk.would.length > 0 : hk.would.length === 0;
      ok(vh.would.includes('on hold') && Number(ka.credit_limit) === 0 && ka.would.length === 0 && Number(hk.credit_limit) === 75000 && wantHk,
        ['vh', 'an', 'hk', 'ka'].map(line).join(' | '));
      say('v23: Vellore owes Rs 1,45,140 (145%), Annapoorna Rs 14,160 overdue, Hotel Kanchi Rs 60,180 of 75,000 Go through. Ours are our demo orders and invoices; the Wait / Go rule is the same.'); }

    if (run('6.13')) { await start(); T('6.13', 'Raising credit needs a second person');
      const r = await api(DV, 'PUT', `/commerce/customers/${C.an}/credit`, { credit_limit: '30000', credit_days: 15, reason: 'Orders doubled' });
      const w13 = (await api(DV, 'GET', '/sales/credit')).data.rows.find((c) => c.customer_id === C.an).waiting;
      const again = await api(DV, 'PUT', `/commerce/customers/${C.an}/credit`, { credit_limit: '35000', credit_days: 15, reason: 'Again' });
      const card = r.data && await q1('SELECT summary, ref_type, ref_id FROM approvals WHERE approval_id = ?', [r.data.approval_id]);
      const d13 = r.data && await decide(SH, r.data.approval_id);
      const an13 = await q1('SELECT credit_limit FROM customers WHERE customer_id = ?', [C.an]);
      const lo = await api(SH, 'PUT', `/commerce/customers/${C.am}/credit`, { credit_limit: '20000', credit_days: 30, reason: 'Lower' });
      const am13 = await q1('SELECT credit_limit FROM customers WHERE customer_id = ?', [C.am]);
      const aud = await qa("SELECT action FROM audit_log WHERE entity_type = 'customer' AND entity_id IN (?, ?) ORDER BY audit_id DESC LIMIT 10", [String(C.an), String(C.am)]).catch(() => []);
      ok(r.data && r.data.pending && w13 && Number(w13.limit) === 30000 && again.status >= 400 && d13.status === 200 && Number(an13.credit_limit) === 30000 && lo.status === 200 && lo.data.pending === false && Number(am13.credit_limit) === 20000,
        `Divya asks Rs 30,000: waiting (#${r.data && r.data.approval_id}, "${r.data && r.data.message}"), the row shows Rs ${w13 && w13.limit} waiting; a second change meanwhile: ${again.status} "${again.msg}"; card "${card && card.summary}" (${card && card.ref_type} ${card && card.ref_id}); Shoban approves: limit ${Number(an13.credit_limit)}; lowering Ambur to 20000: done at once (${Number(am13.credit_limit)}); audit rows ${aud.length}`); }

    if (run('6.14')) { await start(); T('6.14', 'Ledger, ageing and statement');
      const r = (await api(SH, 'GET', `/commerce/customers/${C.vh}/statement`)).data;
      const runOk = r.lines.every((l, i) => Math.abs(l.balance - ((i ? r.lines[i - 1].balance : Number(r.opening || 0)) + l.debit - l.credit)) < 0.01);
      const ag = r.ageing; const agSum = r2(Object.values(ag).filter((v) => typeof v === 'number').reduce((a, v) => a + v, 0));
      const pdf = await api(SH, 'GET', `/commerce/customers/${C.vh}/statement.pdf`);
      const before = (await q1('SELECT COALESCE(MAX(mail_id), 0) m FROM mail_outbox')).m;
      const m = await api(SH, 'POST', `/sales/customers/${C.vh}/mail-statement`);
      const mail = await q1('SELECT to_email, from_email, status FROM mail_outbox WHERE mail_id > ? ORDER BY mail_id LIMIT 1', [before]).catch(() => null);
      ok(runOk && r.lines.length > 0 && Math.abs(r2(r.closing) - r2(r.lines[r.lines.length - 1].balance)) < 0.01 && pdf.status === 200 && m.status === 200,
        `CUS-0007 Vellore: ${r.lines.length} lines (${r.lines.map((l) => `${l.doc || l.kind} ${l.debit || -l.credit}`).join(', ')}), running balance checked line by line, closing ${r.closing}; ageing ${JSON.stringify(ag)} = ${agSum}; statement PDF ${pdf.status}; Mail statement: ${m.status} "${m.data && m.data.message}" ${mail ? `(${mail.from_email || ''} to ${mail.to_email}, ${mail.status})` : ''}`);
      say('v23: invoice 88,500, receipt 40,000, bounced 40,000, invoice 56,640, owes Rs 1,45,140. Ours are the dev invoices of CUS-0007.'); }

    if (run('6.15')) { await start(); T('6.15', 'Merging a duplicate needs approval');
      const r = await api(SH, 'POST', '/commerce/customers/merge', { keep_id: C.hk, merge_id: C.am, reason: 'Same canteen, two records' });
      const mid = r.data && r.data.approval_id;
      const self = mid && await decide(SH, mid);
      const dm = mid && await decideAny(mid);
      const am15 = await q1('SELECT status, merged_into FROM customers WHERE customer_id = ?', [C.am]);
      const list = (await api(SH, 'GET', '/commerce/customers')).data.rows.some((c) => c.customer_id === C.am);
      ok(r.status < 300 && mid && self.status >= 400 && dm.status === 200 && am15.status === 'merged' && am15.merged_into === C.hk && !list,
        `asked (#${mid}, "${r.data && r.data.message}"); Shoban cannot sign his own: ${self && self.status}; a second person approves (${dm && dm.status}): CUS-0013 ${am15.status} into ${am15.merged_into}; in the list: ${list}`); }

    if (run('6.16')) { await start(); T('6.16', 'The customer panel holds money and record');
      const r = await api(SH, 'GET', `/commerce/customers/${C.hk}`);
      ok(r.status === 200 && Number(r.data.credit_limit) === 75000 && Number(r.data.credit_days) === 30 && Array.isArray(r.data.addresses) && Array.isArray(r.data.contacts),
        `CUS-0001: limit ${r.data.credit_limit}, ${r.data.credit_days} days, status ${r.data.status_label}; parts: ${Object.keys(r.data).filter((k) => /addresses|contacts|pending|special|follow|owes|ageing|timeline|files|lead/.test(k)).join(', ')}`); }

    // ================================================================================================ fix tests
    if (run('C1')) { await start(); T('C1', 'Sales makes a type on another list; Sales may tighten, not ease');
      const lists = (await api(SH, 'GET', '/sales/customer-types')).data.lists;
      const hotelList = (await api(SH, 'GET', '/sales/customer-types')).data.rows.find((t) => t.type_key === 'hotel').list_name;
      const r = await api(DV, 'POST', '/sales/customer-types', { type_key: 'restwo', label: 'Restaurant two', default_credit_days: 15, list_key: (lists.find((l) => l.name === hotelList && !l.is_default) || lists.find((l) => !l.is_default)).key, is_active: true });
      const c1 = await pendingLike('cust_change', '%Restaurant two%');
      const nowT = (await api(SH, 'GET', '/sales/customer-types')).data.rows.find((t) => t.type_key === 'restwo');
      const dc1 = c1 ? await decide(PV, c1.approval_id) : { status: 0 };
      const afterT = (await api(SH, 'GET', '/sales/customer-types')).data.rows.find((t) => t.type_key === 'restwo');
      const hold1 = await api(DV, 'PUT', `/commerce/customers/${C.an}/status`, { status: 'hold', reason: 'Two cheques late' });
      const lift1 = await api(DV, 'PUT', `/commerce/customers/${C.an}/status`, { status: 'active', reason: '' });
      ok(r.status === 201 && nowT && nowT.on_default && dc1.status === 200 && afterT.list_name !== nowT.list_name && hold1.status === 200 && lift1.status === 403,
        `"${r.data && r.data.message}" | buys on ${nowT && nowT.list_name} until Pavithran approves, then ${afterT && afterT.list_name} | Divya puts Annapoorna on hold: ${hold1.status}; lifting it: ${lift1.status} "${lift1.msg}"`); }

    if (run('N4')) { await start(); T('N4', 'Sales adds a customer on a non-standard type');
      const r = await api(DV, 'POST', '/commerce/customers', { godown_id: 1, name: 'KR Agencies Vellore', type_key: 'distributor', phone: '9443155629', source: 'Walk-in', bill: { name: 'KR Agencies', address: '9, Arcot Road', town: 'Vellore', state_code: '33', pincode: '632001' } });
      const n4 = r.data && r.data.customer_id && await q1('SELECT type_key FROM customers WHERE customer_id = ?', [r.data.customer_id]);
      ok(r.status === 201 && n4 && n4.type_key !== 'distributor' && r.data.waiting && r.data.waiting.type_key === 'distributor',
        `${r.status} ${r.msg || ''} ${JSON.stringify(r.fields || {})} ${r.data && r.data.customer_no} starts on ${n4 && n4.type_key}; Distributor waits (#${r.data && r.data.waiting && r.data.waiting.approval_id}, ${r.data && r.data.waiting && r.data.waiting.list})`); }

    if (run('RP2')) { await start(); T('RP2', 'Divya at Chennai only sees no Kanchipuram customers or money');
      await pool.query('UPDATE admin_users SET godowns_all = 0 WHERE emp_id = ?', [DIVYA]);
      await pool.query('DELETE FROM admin_user_godowns WHERE emp_id = ?', [DIVYA]);
      await pool.query('INSERT INTO admin_user_godowns (emp_id, godown_id) VALUES (?, 2)', [DIVYA]);
      const cl = (await api(DV, 'GET', '/commerce/customers')).data.rows;
      const crd = (await api(DV, 'GET', '/sales/credit')).data.rows;
      const one1 = await api(DV, 'GET', `/commerce/customers/${C.hk}`);
      ok(cl.every((c) => c.godown_id !== 1) && crd.every((c) => c.customer_id !== C.hk) && one1.status === 404, `Customer list: ${cl.length} (Kanchipuram none); Credit limits: ${crd.length}; opening CUS-0001: ${one1.status}`); }

    if (run('Y11')) { await start(); T('Y11', 'N10 + Y11 A role change away from Sales hands the customers over');
      const perms = Object.fromEntries((await qa('SELECT section, can_view, can_create, can_edit, can_approve, can_cancel, can_export FROM role_permissions WHERE role_id = 6')).map((x) => [x.section, { view: !!x.can_view, create: !!x.can_create, edit: x.section === 'customers' ? false : !!x.can_edit, approve: !!x.can_approve, cancel: !!x.can_cancel, export: !!x.can_export }]));
      const d11a = await api(SH, 'PUT', '/roles/6', { perms });
      const y1 = await api(SH, 'PUT', `/users/${DIVYA}`, { role_id: 7 });
      const y2 = await api(SH, 'PUT', `/users/${DIVYA}`, { role_id: 7, hand_over_to: 'DZIND002' });
      const left = Number((await q1('SELECT COUNT(*) n FROM customers WHERE owner_emp_id = ?', [DIVYA])).n);
      ok(d11a.status === 409 && y1.status === 409 && y1.fields && y1.fields.hand_over_to && y2.status === 200 && left === 0,
        `N10 taking Edit on Customers off Sales: ${d11a.status} "${d11a.msg}" | Y11 Delivery role without a taker: ${y1.status} "${y1.msg}"; with Shoban: ${y2.status} ${y2.msg || ''}, customers still on Divya: ${left}`); }

    if (run('Y8')) { await start(); T('Y8', 'A merge keeps the invoice buyer; only the ledger moves');
      const inv8 = await q1("SELECT i.invoice_id, i.invoice_no, i.buyer_json, o.customer_id, o.order_no FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE i.status = 'issued' ORDER BY i.invoice_id LIMIT 1");
      const keep8 = inv8.customer_id === C.hk ? C.sd : C.hk;
      const mr = await api(SH, 'POST', '/commerce/customers/merge', { keep_id: keep8, merge_id: inv8.customer_id, reason: 'Same buyer' });
      if (mr.data && mr.data.approval_id) await decideAny(mr.data.approval_id);
      const inv8b = await q1('SELECT i.buyer_json, o.customer_id FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE i.invoice_id = ?', [inv8.invoice_id]);
      const nm = (b) => (typeof b === 'string' ? JSON.parse(b) : b || {}).name;
      ok(JSON.stringify(inv8b.buyer_json) === JSON.stringify(inv8.buyer_json) && inv8b.customer_id === keep8,
        `${inv8.invoice_no}: buyer on the invoice unchanged (${nm(inv8.buyer_json)}); its order ${inv8.order_no} (the ledger) moved from customer ${inv8.customer_id} to ${inv8b.customer_id}`); }

    if (run('Low3e')) { await start(); T('Low3e', 'Special price form refuses a pack of a draft product');
      const dp = await q1("SELECT s.product_id FROM skus s WHERE s.sku_code = 'DF040-M100'");
      await pool.query("UPDATE products SET status = 'draft' WHERE product_id = ?", [dp.product_id]);
      const r = await api(SH, 'POST', '/prices/specials', { customer_id: C.hk, sku_code: 'DF040-M100', price: 70, valid_from: today(), reason: 'test' });
      const qd = await api(SH, 'POST', '/sales/quotes/preview', { customer_id: C.hk, godown_id: 1, items: [{ sku_code: 'DF040-M100', qty: 10 }] });
      const f = (qd.data && qd.data.fields) || qd.fields || {};
      ok(r.status >= 400 && f['items.0.sku_code'], `special price: ${r.status} "${r.msg}"; a quote line: "${f['items.0.sku_code']}"`); }
  },
};
