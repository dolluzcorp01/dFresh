// Section 15 - Notifications and alerts: the v23 Tests tab "15" and phase 23's Admin alerts. Our messages are e-mail
// through the Outbox (mail_outbox + notification_log); WhatsApp and SMS stay off until a provider is chosen, so v23's
// WhatsApp and quiet-hour checks read "WhatsApp off" here. No mail leaves: the runner switches mail off.
// Run: npm run scenarios -- 15
module.exports = {
  title: 'Notifications and alerts',
  async run(ctx) {
    const { api, ok, say, q1, qa, decideAny, order, packed, T, fresh, run, pool } = ctx;
    const MAILC = 16; // a customer with an e-mail address on the dev data
    const logsSince = async (id, where = '1 = 1', args = []) => qa(`SELECT log_id, event_key, audience, channel, recipient, lang_code, status, skip_reason, mail_id, subject FROM notification_log WHERE log_id > ? AND ${where} ORDER BY log_id`, [id, ...args]);
    const lastLog = async () => Number((await q1('SELECT COALESCE(MAX(log_id), 0) AS n FROM notification_log')).n);

    if (run('15.1')) { await fresh(); T('15.1', 'Alerts come from the data; snooze; open marks read');
      const a = (await api('SH', 'GET', '/alerts')).data;
      const types = {}; a.alerts.forEach((x) => { types[x.type] = (types[x.type] || 0) + 1; });
      const one = a.alerts.find((x) => x.type !== 'approvals');
      await api('SH', 'POST', '/alerts/mark', { key: one.key, snooze: true });
      const b = (await api('SH', 'GET', '/alerts')).data;
      const two = b.alerts.find((x) => !x.read && x.type !== 'approvals');
      await api('SH', 'POST', '/alerts/mark', { key: two.key, read: true });
      const c = (await api('SH', 'GET', '/alerts')).data;
      const nav = (await api('SH', 'GET', '/nav-counts')).data;
      ok(a.alerts.length > 0 && b.alerts.length === a.alerts.length - 1 && !b.alerts.some((x) => x.key === one.key) && c.unread === b.unread - 1 && c.alerts.find((x) => x.key === two.key).read,
        `bell ${a.unread} (${JSON.stringify(types)}): "${a.alerts[0].title} - ${a.alerts[0].text}"; snoozed "${one.title}": ${a.alerts.length} -> ${b.alerts.length}; opened "${two.title}": unread ${b.unread} -> ${c.unread}; nav bell ${nav.alerts}`); }

    if (run('15.2')) { await fresh(); T('15.2', 'A confirmed order writes its messages (the Outbox prepares, nothing is sent here)');
      const l0 = await lastLog();
      const no = await order(MAILC, [{ sku_code: 'DF001-M100', qty: 40 }]);
      const L = await logsSince(l0, "event_key = 'order_confirmed'");
      const mail = L[0] && L[0].mail_id ? await q1('SELECT to_email, subject, status FROM mail_outbox WHERE mail_id = ?', [L[0].mail_id]) : null;
      ok(L.length > 0 && mail && /order|confirmed/i.test(mail.subject), `${no}: ${L.map((x) => `${x.channel} to ${x.recipient}: ${x.status}`).join('; ')}; Outbox "${mail && mail.subject}" ${mail && mail.status} (WhatsApp and SMS off: notify_whatsapp 0, notify_sms 0)`); }

    if (run('15.3')) { await fresh(); T('15.3', 'WhatsApp and SMS stay off (no quiet hours to wait for)');
      const s = await qa("SELECT setting_key, value FROM commerce_settings WHERE setting_key IN ('notify_whatsapp', 'notify_sms', 'notify_email')");
      const l0 = await lastLog();
      await order(MAILC, [{ sku_code: 'DF001-M100', qty: 40 }]);
      const L = await logsSince(l0, "audience = 'customer'");
      ok(s.find((x) => x.setting_key === 'notify_whatsapp').value === '0' && !L.some((x) => x.channel === 'whatsapp' && x.status !== 'skipped'), `${s.map((x) => `${x.setting_key} ${x.value}`).join(', ')}; customer messages now: ${L.map((x) => `${x.channel} ${x.status}`).join(', ')} (e-mail goes any time)`); }

    if (run('15.4')) { await fresh(); T("15.4", "Messages in the customer's language (English when that wording is empty)");
      await pool.query("UPDATE customers SET lang_code = 'ta' WHERE customer_id = ?", [MAILC]);
      const no = await packed(MAILC, [{ sku_code: 'DF001-M100', qty: 10 }]);
      await api('SH', 'POST', '/billing/invoices', { order_no: no });
      const owe = (await api('SH', 'GET', `/money/receipt-form?customer_id=${MAILC}`)).data.customer.owes;
      const l0 = await lastLog();
      const r = await api('SH', 'POST', '/money/receipts', { customer_id: MAILC, amount: String(owe), mode: 'cash' });
      const L = await logsSince(l0, "event_key = 'payment' AND audience = 'customer'");
      const ta = await q1("SELECT COUNT(*) AS n FROM notification_templates WHERE event_key = 'payment' AND lang_code = 'ta'");
      ok(r.status < 300 && L.length > 0 && L[0].lang_code === (Number(ta.n) ? 'ta' : 'en'), `receipt ${r.data && r.data.receipt_no}: e-mail in ${L[0] && L[0].lang_code} (a Tamil payment template ${Number(ta.n) ? 'is' : 'is not'} written: ${Number(ta.n) ? 'Tamil' : 'English is used'}), "${L[0] && L[0].subject}"`); }

    if (run('15.5')) { await fresh(); T('15.5', 'A customer who opted out of reminders');
      const OD = 1; // a credit customer with overdue invoices on the dev data (Demo Hotel Sangam): given an address, opted out
      await pool.query("UPDATE customers SET opt_out_reminders = 1, email = 'scenario.sangam@example.com' WHERE customer_id = ?", [OD]);
      const l0 = await lastLog();
      const rm = await api('SH', 'POST', `/money/customers/${OD}/remind`);
      const L = await logsSince(l0, "event_key = 'overdue'");
      ok(L.length > 0 && L.every((x) => x.status === 'skipped') && /opt/i.test(L[0].skip_reason || ''), `Remind: ${rm.status} "${rm.data && rm.data.message}"; logged ${L.map((x) => `${x.channel} ${x.status}: ${x.skip_reason}`).join('; ')}`); }

    if (run('15.6')) { await fresh(); T('15.6', 'Change a template');
      const bad = await api('SH', 'PUT', '/notifications/templates/payment/en', { subject: 'dFresh: got {amount}', body: 'dFresh: got {amount} {foo}' });
      const good = await api('SH', 'PUT', '/notifications/templates/payment/en', { subject: 'Payment received', body: 'dFresh: received {amount}, thank you.' });
      const pv = await api('SH', 'POST', '/notifications/preview', { event: 'payment', lang: 'en', subject: 'Payment received', body: 'dFresh: received {amount}, thank you.' });
      ok(bad.status === 400 && /\{foo\}/.test(bad.msg) && good.status === 200 && pv.status === 200, `{foo}: "${bad.msg}"; saved (${good.status}); preview: "${pv.data && String(pv.data.body || pv.data.text || JSON.stringify(pv.data)).slice(0, 120)}"`); }

    if (run('15.7')) { await fresh(); T('15.7', 'Retry a failed message');
      const f = await q1("SELECT n.log_id FROM notification_log n JOIN mail_outbox m ON m.mail_id = n.mail_id WHERE n.channel = 'email' ORDER BY n.log_id DESC LIMIT 1");
      await pool.query("UPDATE mail_outbox m JOIN notification_log n ON n.mail_id = m.mail_id SET m.status = 'failed', m.last_error = 'scenario: mailbox full' WHERE n.log_id = ?", [f.log_id]);
      const r = await api('SH', 'POST', `/notifications/log/${f.log_id}/retry`);
      const m = await q1('SELECT m.status FROM mail_outbox m JOIN notification_log n ON n.mail_id = m.mail_id WHERE n.log_id = ?', [f.log_id]);
      ok(r.status === 200 && m.status !== 'failed', `retry message ${f.log_id}: ${r.status} ${r.msg || JSON.stringify(r.data).slice(0, 100)}; now ${m.status} (prepared again, not sent from here)`); }

    if (run('15.8')) { await fresh(); T('15.8', 'The invoice goes out as an e-mail with the PDF');
      const no = await packed(MAILC, [{ sku_code: 'DF001-M100', qty: 10 }]);
      const l0 = await lastLog();
      const iv = await api('SH', 'POST', '/billing/invoices', { order_no: no });
      const L = await logsSince(l0, "event_key = 'invoice'");
      const m = L[0] && L[0].mail_id ? await q1('SELECT to_email, subject, attachments FROM mail_outbox WHERE mail_id = ?', [L[0].mail_id]) : null;
      ok(m && m.attachments && /invoice|pdf/i.test(String(m.attachments)), `${iv.data && iv.data.invoice_no}: e-mail to ${m && m.to_email} "${m && m.subject}", attachment ${m && String(m.attachments).slice(0, 120)}`); }

    if (run('15.9')) { await fresh(); T('15.9', 'Buttons that mail by hand keep a copy in the Outbox');
      const quote = await q1("SELECT quote_no FROM quotes ORDER BY quote_id DESC LIMIT 1").catch(() => null);
      const m0 = Number((await q1('SELECT COALESCE(MAX(mail_id), 0) AS n FROM mail_outbox')).n);
      const r = quote ? await api('SH', 'POST', `/sales/quotes/${encodeURIComponent(quote.quote_no)}/mail`) : null;
      const rows = await qa('SELECT to_email, subject, attachments FROM mail_outbox WHERE mail_id > ?', [m0]);
      ok(!quote || (r.status < 300 && rows.length > 0) || r.status === 400, quote ? `${quote.quote_no} Mail to customer: ${r.status} "${(r.data && r.data.message) || r.msg}"; Outbox rows: ${rows.map((x) => `${x.to_email} "${x.subject}"`).join('; ') || 'none (no e-mail on the customer)'}` : 'no quote on the dev data'); }

    if (run('15.10')) { await fresh(); T('15.10', 'Who sees what');
      const ku = (await api('KU', 'GET', '/alerts')).data; const dv = (await api('DV', 'GET', '/alerts')).data;
      const kuOut = await api('KU', 'GET', '/notifications/log'); const sh = (await api('SH', 'GET', '/alerts')).data;
      const kuG = await qa("SELECT godown_id FROM admin_user_godowns WHERE emp_id = 'DZIND146'");
      ok(ku.alerts.length < sh.alerts.length && kuOut.status === 403 && dv.alerts.every((a) => ['overdue', 'approvals', 'approval_old'].includes(a.type)),
        `Kumar (godowns ${kuG.map((g) => g.godown_id).join(', ') || 'all'}): ${ku.alerts.length} alerts (Shoban ${sh.alerts.length}); Outbox for Kumar: ${kuOut.status} "${kuOut.msg}"; Divya: ${dv.alerts.map((a) => a.type).join(', ') || 'none'}`); }

    if (run('ADMIN')) { await fresh(); T('ADMIN', 'Admin alerts: an override, someone marked as left, leave for an Admin, a rule loosened');
      const n0 = Number((await q1('SELECT COALESCE(MAX(alert_id), 0) AS n FROM admin_alerts')).n);
      const st = await qa("SELECT a.emp_id, a.role_id FROM admin_users a WHERE a.is_active = 1 AND a.role_id NOT IN (1, 8) AND a.emp_id NOT IN ('DZIND135', 'DZIND146', 'DZIND147', 'DZIND136', 'DZIND142') LIMIT 1");
      const left = st[0] ? await api('SH', 'PUT', `/users/${st[0].emp_id}`, { is_active: false }) : null;
      const d2 = new Date(Date.parse(`${ctx.today()}T00:00:00Z`) + 3 * 864e5).toISOString().slice(0, 10);
      const lv = await api('SH', 'PUT', '/staff/DZIND148', { leave: { from: d2, to: d2, stand_in: 'DZIND002' } });
      const rule = await api('PV', 'PUT', '/approval-rules/expense', { is_on: true, unit: 'Rs', limit_value: 50000 });
      const ra = await q1("SELECT approval_id FROM approvals WHERE kind = 'rule_change' AND status = 'pending' ORDER BY approval_id DESC LIMIT 1");
      if (ra) await decideAny(ra.approval_id);
      const rows = await qa('SELECT kind, title FROM admin_alerts WHERE alert_id > ? ORDER BY alert_id', [n0]);
      const al = (await api('SH', 'GET', '/alerts')).data.alerts.filter((a) => ['staff_left', 'admin_leave', 'rule_loosened', 'override'].includes(a.type));
      const kinds = new Set(rows.map((x) => x.kind));
      say(`left: ${left && left.status} ${left && (left.msg || '')}; leave: ${lv.status} ${lv.msg || ''}; rule: ${rule.status} ${rule.msg || ''}`);
      ok(kinds.has('admin_leave') && (kinds.has('rule_loosened') || !ra) && (kinds.has('staff_left') || !st[0]), `stored: ${rows.map((x) => `${x.kind}: ${x.title}`).join(' | ')}; in Shoban's alerts: ${al.length}`);
      const kuA = (await api('KU', 'GET', '/alerts')).data.alerts.filter((a) => ['staff_left', 'admin_leave', 'rule_loosened'].includes(a.type));
      ok(kuA.length === 0, `not an Admin (Kumar): ${kuA.length} admin alerts`); }

    if (run('ROLES')) { await fresh(); T('ROLES', 'An Admin switches an alert type off for a role');
      const before = (await api('MU', 'GET', '/alerts')).data.alerts.filter((a) => a.type === 'low_stock').length;
      const no = await api('KU', 'PUT', '/alerts/settings', { role_id: 5, off: ['low_stock'] });
      const s = await api('PV', 'PUT', '/alerts/settings', { role_id: 5, off: ['low_stock'] });
      const after = (await api('MU', 'GET', '/alerts')).data.alerts.filter((a) => a.type === 'low_stock').length;
      ok(before > 0 && no.status === 403 && s.status === 200 && after === 0, `Warehouse low-stock alerts ${before} -> ${after} after an Admin switched them off; a non-Admin: ${no.status} "${no.msg}"`); }
  },
};
