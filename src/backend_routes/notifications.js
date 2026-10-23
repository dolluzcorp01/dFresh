// Notifications (docs/COMMERCE-SPEC.md 5.5f; migration 20261021_commerce_11_notifications.sql). What happens in the back
// office is told to customers and staff by e-mail, always through the mail outbox (CLAUDE.md rule 7): a hook renders the
// message and inserts the mail row and its notification_log row in the SAME transaction as the change, so a rolled back
// change sends nothing and a SendGrid outage only delays the mail (outbox-worker.js retries; documents are attached as
// PDF when the mail is sent, doc-pdf.js).
// - Channels: e-mail (Commerce setting notify_email); WhatsApp and SMS are "provider not set up" (always off).
// - Each event has its own on / off (Commerce settings notify_ev_<event>) and a template per language
//   (notification_templates: subject + body with {placeholders}); a missing language falls back to the default one.
//   The customer's language is customers.lang_code (empty = the default language).
// - Recipients: delivery messages to the order contact (orders.contact_id, else the contact whose phone is the shipping
//   phone, else the first contact with an e-mail, else the customer's e-mail); invoices, receipts, refunds and
//   statements to the contacts with "gets invoices" (else the customer's e-mail); wallet mails to the customer's e-mail.
//   Reminders (overdue, wallet expiring) are not sent to a customer who opted out of reminders; nothing else can be
//   opted out of (an invoice always goes). Staff mails go to admin_users.notify_email, else the dAdmin e-mail.
// - Every message, sent or skipped, is a notification_log row; queued / sent / failed is the state of its mail row.
// - Daily jobs (overdue reminders every N days at most M times, wallet credit expiring, stock, follow-ups, the Admin
//   summary) run once per India day from the hour in notify_daily_hour (notification_runs), or from "Run daily mails now".
// - A hook never breaks the change it reports: any error is logged and the change goes on. The demo seed mutes all of it.
const { getDBConnection } = require('../../config/db');
const { siteBase } = require('../../config/urls');
const mailer = require('./mailer');
const commerceSettings = require('./commerce-settings');
const permissions = require('../shared/permissions');
const { DADMIN } = require('./auth');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const IST_TODAY = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))";
const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]{2,}$/;
const round2 = (n) => Math.round(n * 100) / 100;
const money = (v) => Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const link = (p) => `${siteBase()}/admin/${p}`;

// to: order (the order contact) | invoice (the invoice contacts) | customer (the customer's e-mail) | staff
// attach: the document built as PDF when the mail is sent. reminder: a customer can opt out of it.
const ORDER_VARS = ['customer', 'contact', 'order_no', 'total', 'amount_due', 'items', 'ship_to'];
const EVENTS = {
  order_confirmed: { audience: 'customer', label: 'Order confirmed', to: 'order', vars: ORDER_VARS },
  order_packed: { audience: 'customer', label: 'Order packed', to: 'order', vars: [...ORDER_VARS, 'cartons'] },
  invoice: { audience: 'customer', label: 'Invoice (PDF)', to: 'invoice', attach: 'invoice', vars: [...ORDER_VARS, 'invoice_no', 'due_on'] }, // made when the goods leave: before "out for delivery"
  order_out: { audience: 'customer', label: 'Out for delivery', to: 'order', vars: [...ORDER_VARS, 'cartons'] },
  order_courier: { audience: 'customer', label: 'Handed to the courier', to: 'order', vars: [...ORDER_VARS, 'courier', 'awb', 'tracking_link'] },
  order_delivered: { audience: 'customer', label: 'Delivered', to: 'order', vars: [...ORDER_VARS, 'received_by', 'return_days'] },
  payment: { audience: 'customer', label: 'Payment received (receipt)', to: 'invoice', vars: [...ORDER_VARS, 'amount', 'mode', 'reference', 'paid_on'] },
  return_accepted: { audience: 'customer', label: 'Return accepted', to: 'order', vars: ['customer', 'contact', 'order_no', 'return_no', 'items'] },
  return_picked: { audience: 'customer', label: 'Return picked up', to: 'order', vars: ['customer', 'contact', 'order_no', 'return_no', 'items'] },
  return_refunded: { audience: 'customer', label: 'Refunded (credit note PDF)', to: 'invoice', attach: 'credit_note', vars: ['customer', 'contact', 'order_no', 'return_no', 'amount', 'credit_note_no'] },
  wallet_credited: { audience: 'customer', label: 'Wallet credited', to: 'customer', vars: ['customer', 'contact', 'amount', 'reason', 'balance'] },
  wallet_expiring: { audience: 'customer', label: 'Wallet credit expiring', to: 'customer', reminder: true, vars: ['customer', 'contact', 'amount', 'expires_on', 'days', 'balance'] },
  overdue: { audience: 'customer', label: 'Overdue reminder (statement PDF)', to: 'invoice', reminder: true, attach: 'statement', vars: ['customer', 'contact', 'overdue_amount', 'overdue_count', 'invoices', 'outstanding'] },
  approval: { audience: 'staff', label: 'Approval waiting', vars: ['name', 'kind', 'summary', 'requested_by', 'link'] },
  stock_daily: { audience: 'staff', label: 'Low stock and near expiry (daily)', vars: ['name', 'low_count', 'low_list', 'expiry_count', 'expiry_list', 'expiry_days', 'link'] },
  follow_ups: { audience: 'staff', label: 'Follow-ups due today (daily)', vars: ['name', 'count', 'list', 'link'] },
  delivery_failed: { audience: 'staff', label: 'Failed delivery', vars: ['name', 'order_no', 'customer', 'trip', 'reason', 'link'] },
  cash_difference: { audience: 'staff', label: 'Cash handover difference', vars: ['name', 'trip', 'driver', 'collected', 'handed', 'difference', 'note', 'link'] },
  daily_summary: { audience: 'staff', label: 'Daily summary for Admin', vars: ['name', 'date', 'summary', 'link'] },
};
const settingKey = (event) => `notify_ev_${event}`;
const DAILY = ['overdue', 'wallet_expiring', 'stock_daily', 'follow_ups', 'daily_summary'];

let muted = false;
/** the demo seed builds months of history: no mail for any of it */
function setMuted(on) { muted = Boolean(on); }

/** is this event switched on (and e-mail on)? Nothing at all while Commerce is switched off (go-live: the site runs
 *  with Commerce off first, and no daily mail may go out before it is switched on) */
async function isOn(q, event) {
  const cs = await commerceSettings.read(q);
  return Boolean(cs.commerce_enabled) && Boolean(cs.notify_email) && cs[settingKey(event)] !== false;
}

// ---------------------------------------------------------------- templates
async function defaultLang(q) {
  const [[l]] = await q.query('SELECT lang_code FROM languages WHERE is_default = 1 LIMIT 1');
  return l ? l.lang_code : 'en';
}

/** the template of an event in a language, else the default language -> { subject, body, lang_code, html_lang, font_family } */
async function template(q, event, lang) {
  const def = await defaultLang(q);
  const [rows] = await q.query(
    `SELECT t.lang_code, t.subject, t.body, l.html_lang, l.font_family FROM notification_templates t JOIN languages l ON l.lang_code = t.lang_code
      WHERE t.event_key = ? AND t.lang_code IN (?, ?) AND l.is_active = 1`, [event, lang || def, def]);
  return rows.find((r) => r.lang_code === (lang || def)) || rows.find((r) => r.lang_code === def) || null;
}

/** {placeholders} not allowed for an event (the editor refuses them) */
function unknownVars(event, ...texts) {
  const ok = new Set(EVENTS[event].vars);
  const found = texts.flatMap((t) => [...String(t || '').matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
  return [...new Set(found.filter((v) => !ok.has(v)))];
}

const fill = (text, vars) => String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? (vars[k] === null || vars[k] === undefined || vars[k] === '' ? '-' : String(vars[k])) : m));

async function footerFor(q, audience) {
  const [rows] = await q.query("SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('company_name', 'public_email', 'office_phone')");
  const s = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value || '']));
  return { company: s.company_name || 'dFresh', email: s.public_email, phone: s.office_phone, staff: audience === 'staff' };
}

/** subject, html and text of a message: the template text with the values filled in, in the dFresh mail shell */
function compose(tpl, vars, footer) {
  const subject = fill(tpl.subject, vars).replace(/\s+/g, ' ').trim().slice(0, 250);
  const text = fill(tpl.body, vars);
  const font = tpl.font_family && tpl.font_family !== 'Open Sans' ? `'${String(tpl.font_family).replace(/[^\w\s-]/g, '')}',` : '';
  const linkify = (s) => mailer.esc(s).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}" style="color:#121214;font-weight:600;word-break:break-all">${u}</a>`);
  const paras = text.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${p.split('\n').map(linkify).join('<br>')}</p>`).join('');
  const foot = footer.staff ? `dFresh admin &middot; ${mailer.esc(footer.company)}`
    : `${mailer.esc(footer.company)}${footer.email ? ` &middot; <a href="mailto:${mailer.esc(footer.email)}" style="color:#4A4840">${mailer.esc(footer.email)}</a>` : ''}${footer.phone ? ` &middot; ${mailer.esc(footer.phone)}` : ''}`;
  const html = mailer.shell({
    htmlLang: tpl.html_lang || tpl.lang_code || 'en',
    title: subject,
    preheader: text.split('\n').filter((l) => l.trim())[1] || subject,
    body: `<div style="font-family:${font}'Open Sans',Arial,Helvetica,sans-serif">${paras}</div>`,
    footer: foot,
  });
  const plain = `${text}\n\n${footer.company}${!footer.staff && footer.email ? ` - ${footer.email}` : ''}${!footer.staff && footer.phone ? ` - ${footer.phone}` : ''}\n`;
  return { subject, html, text: plain };
}

// ---------------------------------------------------------------- recipients
async function customerRow(q, customerId) {
  const [[c]] = await q.query('SELECT customer_id, customer_no, name, business_name, email, lang_code, opt_out_reminders, opt_out_offers FROM customers WHERE customer_id = ?', [customerId]);
  return c || null;
}
const digits = (p) => String(p || '').replace(/\D/g, '').slice(-10);

/** [{ email, name }] for an event: kind order | invoice | customer (a list without an address is empty) */
async function customerRecipients(q, kind, c, order = null) {
  const [contacts] = await q.query('SELECT contact_id, name, phone, email, gets_invoices FROM customer_contacts WHERE customer_id = ? AND is_active = 1 ORDER BY contact_id', [c.customer_id]);
  const withMail = contacts.filter((x) => EMAIL.test(x.email || ''));
  const self = EMAIL.test(c.email || '') ? [{ email: c.email, name: c.name }] : [];
  let out = [];
  if (kind === 'invoice') {
    out = withMail.filter((x) => Number(x.gets_invoices) === 1);
    if (!out.length) out = self;
  } else if (kind === 'order' && order) {
    const chosen = order.contact_id && withMail.find((x) => x.contact_id === Number(order.contact_id));
    const byPhone = withMail.find((x) => digits(x.phone) && digits(x.phone) === digits(order.ship_phone));
    out = chosen ? [chosen] : byPhone ? [byPhone] : withMail.length ? [withMail[0]] : self;
  } else out = self.length ? self : withMail.filter((x) => Number(x.gets_invoices) === 1);
  const seen = new Set();
  return out.map((x) => ({ email: String(x.email).trim(), name: x.name })).filter((x) => !seen.has(x.email.toLowerCase()) && seen.add(x.email.toLowerCase()));
}

/** admin users (active, with a notification address) and their display names */
async function staffUsers(q) {
  const [rows] = await q.query(`SELECT a.emp_id, a.role_id, COALESCE(a.notify_email, e.emp_mail_id) AS notify_email, TRIM(CONCAT(COALESCE(e.emp_first_name, ''), ' ', COALESCE(e.emp_last_name, ''))) AS name
      FROM admin_users a LEFT JOIN \`${DADMIN}\`.employee e ON e.emp_id = a.emp_id WHERE a.is_active = 1 ORDER BY a.emp_id`);
  const [perms] = await q.query('SELECT role_id, section, can_view, can_create, can_edit, can_approve, can_delete FROM role_permissions');
  return rows.map((r) => ({ emp_id: r.emp_id, role_id: Number(r.role_id), email: r.notify_email, name: r.name || r.emp_id,
    perms: permissions.permsFor(Number(r.role_id), perms.filter((p) => Number(p.role_id) === Number(r.role_id))) }));
}
/** staff who may do `action` on `section` */
async function staffWith(q, section, action) {
  return (await staffUsers(q)).filter((u) => permissions.can(u.perms, section, action));
}

// ---------------------------------------------------------------- queue + log
/**
 * one message: a mail_outbox row (unless skipped) and its notification_log row -> log_id
 * m = { event, audience, to: { email, name, emp_id }, lang, rendered, attachments, customerId, orderId, returnId, ref, skip, test, by }
 */
async function record(q, m) {
  let mailId = null;
  if (!m.skip) {
    const [ins] = await q.query(
      `INSERT INTO mail_outbox (to_email, subject, html_body, text_body, attachments, purpose, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [m.to.email, m.rendered.subject, m.rendered.html, m.rendered.text, m.attachments && m.attachments.length ? JSON.stringify(m.attachments) : null, `notify_${m.event}`.slice(0, 40)]);
    mailId = ins.insertId;
  }
  const [log] = await q.query(
    `INSERT INTO notification_log (event_key, audience, channel, recipient, recipient_name, emp_id, lang_code, subject, status, skip_reason, mail_id, customer_id, order_id, return_id, ref, is_test, created_by)
     VALUES (?, ?, 'email', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [m.event, m.audience, m.to ? m.to.email || null : null, m.to ? String(m.to.name || '').slice(0, 150) || null : null, m.to ? m.to.emp_id || null : null, m.lang || null,
      m.rendered ? m.rendered.subject : EVENTS[m.event].label, m.skip ? 'skipped' : 'queued', m.skip ? String(m.skip).slice(0, 255) : null, mailId,
      m.customerId || null, m.orderId || null, m.returnId || null, m.ref ? String(m.ref).slice(0, 60) : null, m.test ? 1 : 0, m.by || 'system']);
  return { log_id: log.insertId, mail_id: mailId };
}

/**
 * a customer event: render per recipient in the customer's language, queue, log. ctx = { customerId, orderId, returnId,
 * vars, attach: { kind, id }, ref, order (for the order contact) } -> number of mails queued
 */
async function toCustomer(q, event, ctx) {
  const ev = EVENTS[event];
  const c = await customerRow(q, ctx.customerId);
  if (!c) return 0;
  const base = { event, audience: 'customer', customerId: c.customer_id, orderId: ctx.orderId, returnId: ctx.returnId, ref: ctx.ref, by: ctx.by };
  const to = await customerRecipients(q, ev.to, c, ctx.order);
  if (ev.reminder && Number(c.opt_out_reminders) === 1) { // logged with the address it would have gone to
    await record(q, { ...base, to: to[0] || { email: null, name: c.name }, skip: 'the customer opted out of reminders' });
    return 0;
  }
  if (!to.length) {
    await record(q, { ...base, to: { email: null, name: c.name }, skip: ev.to === 'invoice' ? 'no contact with "gets invoices" and no customer e-mail' : 'no e-mail address' });
    return 0;
  }
  const tpl = await template(q, event, c.lang_code);
  if (!tpl) { await record(q, { ...base, to: to[0], skip: 'no template' }); return 0; }
  const footer = await footerFor(q, 'customer');
  for (const r of to) {
    const vars = { customer: c.business_name || c.name, contact: r.name || c.name, ...ctx.vars };
    await record(q, { ...base, to: r, lang: tpl.lang_code, rendered: compose(tpl, vars, footer), attachments: ctx.attach ? [ctx.attach] : null });
  }
  return to.length;
}

/** a staff event to these users (a user without a notification address is logged as skipped) */
async function toStaff(q, event, users, varsFor, meta = {}) {
  const tpl = await template(q, event, null);
  if (!tpl) return 0;
  const footer = await footerFor(q, 'staff');
  let n = 0;
  for (const u of users) {
    const base = { event, audience: 'staff', to: { email: u.email, name: u.name, emp_id: u.emp_id }, orderId: meta.orderId, customerId: meta.customerId, ref: meta.ref, by: meta.by };
    if (!EMAIL.test(u.email || '')) { await record(q, { ...base, skip: 'no notification e-mail for this user (Admin users)' }); continue; }
    await record(q, { ...base, lang: tpl.lang_code, rendered: compose(tpl, { name: u.name, ...varsFor(u) }, footer) });
    n += 1;
  }
  return n;
}

/** runs a hook without ever breaking the change it reports */
async function safely(what, fn) {
  if (muted) return;
  try { await fn(); } catch (e) { console.error(`notification ${what} failed:`, e.code || e.message); }
}

// ---------------------------------------------------------------- order facts
async function orderFacts(q, orderId) {
  const [[o]] = await q.query(`SELECT o.order_id, o.order_no, o.customer_id, o.contact_id, o.status, o.total, o.amount_due, o.cartons, o.awb_no, o.received_by,
      o.ship_name, o.ship_address, o.ship_town, o.ship_pincode, o.ship_phone, cr.name AS courier, cr.tracking_url
      FROM orders o LEFT JOIN couriers cr ON cr.courier_id = o.courier_id WHERE o.order_id = ?`, [orderId]);
  if (!o) return null;
  const [items] = await q.query('SELECT sku_code, SUM(qty) AS qty FROM order_items WHERE order_id = ? GROUP BY sku_code ORDER BY sku_code', [orderId]);
  const cs = await commerceSettings.read(q);
  return {
    order: o,
    vars: {
      order_no: o.order_no, total: money(o.total), amount_due: money(Math.max(Number(o.amount_due), 0)), cartons: o.cartons || '-',
      items: items.map((i) => `${i.qty} x ${i.sku_code}`).join(', '),
      ship_to: [o.ship_name, o.ship_address, [o.ship_town, o.ship_pincode].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      courier: o.courier, awb: o.awb_no, tracking_link: o.tracking_url && o.awb_no ? o.tracking_url.replace('{awb}', encodeURIComponent(o.awb_no)) : null,
      received_by: o.received_by, return_days: cs.return_window_days,
    },
  };
}

async function orderEvent(q, event, orderId, extra = {}) {
  if (!(await isOn(q, event))) return;
  const f = await orderFacts(q, orderId);
  if (!f) return;
  await toCustomer(q, event, { customerId: f.order.customer_id, orderId, order: f.order, vars: { ...f.vars, ...(extra.vars || {}) }, attach: extra.attach, ref: extra.ref || f.order.order_no, returnId: extra.returnId });
}

// ---------------------------------------------------------------- hooks (called by the modules, inside their transaction)
const STATUS_EVENT = { packed: 'order_packed', out_for_delivery: 'order_out', with_courier: 'order_courier', delivered: 'order_delivered' };

/** an order became confirmed for the first time (never while it waits for approval) */
const orderConfirmed = (q, orderId) => safely('order_confirmed', () => orderEvent(q, 'order_confirmed', orderId));

/** commerce.setStatus: packed (not the re-pack after a failed delivery), out, courier, delivered; failed -> staff */
const orderStatus = (q, orderId, from, to, note) => safely(`order ${to}`, async () => {
  if (to === 'failed') return deliveryFailed(q, orderId, note);
  if (to === 'packed' && from === 'failed') return undefined;
  if (STATUS_EVENT[to]) return orderEvent(q, STATUS_EVENT[to], orderId);
  return undefined;
});

/** invoices.issue: the invoice with its PDF */
const invoiceIssued = (q, invoiceId) => safely('invoice', async () => {
  if (!(await isOn(q, 'invoice'))) return;
  const [[i]] = await q.query("SELECT invoice_id, invoice_no, order_id, total, DATE_FORMAT(due_on, '%Y-%m-%d') AS due_on FROM invoices WHERE invoice_id = ?", [invoiceId]);
  if (!i) return;
  await orderEvent(q, 'invoice', i.order_id, { vars: { invoice_no: i.invoice_no, total: money(i.total), due_on: day(i.due_on) }, attach: { kind: 'invoice', id: i.invoice_id }, ref: i.invoice_no });
});

/** commerce.recordPayment: a receipt for a payment (not for a refund) */
const paymentReceived = (q, paymentId) => safely('payment', async () => {
  if (!(await isOn(q, 'payment'))) return;
  const [[p]] = await q.query("SELECT payment_id, order_id, kind, mode, amount, DATE_FORMAT(received_on, '%Y-%m-%d') AS received_on, reference FROM payments WHERE payment_id = ?", [paymentId]);
  if (!p || p.kind !== 'payment') return;
  const MODES = { cash: 'Cash', upi: 'UPI', bank: 'Bank transfer', cheque: 'Cheque', razorpay: 'Razorpay', card: 'Card' };
  await orderEvent(q, 'payment', p.order_id, { vars: { amount: money(p.amount), mode: MODES[p.mode] || p.mode, reference: p.reference, paid_on: day(p.received_on) }, ref: `payment ${p.payment_id}` });
});

async function returnFacts(q, returnId) {
  const [[r]] = await q.query('SELECT r.return_id, r.return_no, r.order_id, r.collection FROM returns r WHERE r.return_id = ?', [returnId]);
  if (!r) return null;
  const [items] = await q.query('SELECT sku_code, SUM(qty) AS qty FROM return_items WHERE return_id = ? GROUP BY sku_code ORDER BY sku_code', [returnId]);
  return { r, items: items.map((i) => `${i.qty} x ${i.sku_code}`).join(', ') };
}
const returnEvent = (event) => (q, returnId) => safely(event, async () => {
  if (!(await isOn(q, event))) return;
  const f = await returnFacts(q, returnId);
  if (!f) return;
  const [[already]] = await q.query('SELECT log_id FROM notification_log WHERE event_key = ? AND return_id = ? AND is_test = 0 LIMIT 1', [event, returnId]);
  if (already) return; // accepted / picked up once per return
  await orderEvent(q, event, f.r.order_id, { vars: { return_no: f.r.return_no, items: f.items }, returnId, ref: f.r.return_no });
});
const returnAccepted = returnEvent('return_accepted');
const returnPicked = returnEvent('return_picked');

/** returns.payRefund: the refund with the credit note PDF */
const returnRefunded = (q, refundId) => safely('return_refunded', async () => {
  if (!(await isOn(q, 'return_refunded'))) return;
  const [[f]] = await q.query(`SELECT f.refund_id, f.return_id, f.order_id, f.amount, f.credit_note_id, cn.credit_note_no, r.return_no
      FROM refunds f JOIN returns r ON r.return_id = f.return_id LEFT JOIN credit_notes cn ON cn.credit_note_id = f.credit_note_id WHERE f.refund_id = ?`, [refundId]);
  if (!f) return;
  await orderEvent(q, 'return_refunded', f.order_id, { vars: { return_no: f.return_no, amount: money(f.amount), credit_note_no: f.credit_note_no },
    attach: f.credit_note_id ? { kind: 'credit_note', id: f.credit_note_id } : null, returnId: f.return_id, ref: f.credit_note_no || f.return_no });
});

/** wallet.credit: cashback and manual credits (a refund to the wallet is told in the refund mail) */
const walletCredited = (q, entryId) => safely('wallet_credited', async () => {
  if (!(await isOn(q, 'wallet_credited'))) return;
  const [[w]] = await q.query('SELECT entry_id, customer_id, source, amount, reason, order_id FROM wallet_entries WHERE entry_id = ?', [entryId]);
  if (!w || w.source === 'refund') return;
  const [[b]] = await q.query('SELECT COALESCE(SUM(amount), 0) AS bal FROM wallet_entries WHERE customer_id = ?', [w.customer_id]);
  await toCustomer(q, 'wallet_credited', { customerId: w.customer_id, orderId: w.order_id, vars: { amount: money(w.amount), reason: w.reason, balance: money(b.bal) }, ref: `wallet ${w.entry_id}` });
});

/** approvals.request: to the users who may decide it */
const approvalWaiting = (q, approvalId) => safely('approval', async () => {
  if (!(await isOn(q, 'approval'))) return;
  const [[a]] = await q.query('SELECT approval_id, kind, section, ref_type, ref_id, summary, requested_by FROM approvals WHERE approval_id = ?', [approvalId]);
  if (!a) return;
  const cs = await commerceSettings.read(q);
  const roles = (cs.approver_role_ids || []).map(Number);
  const KINDS = require('./approvals').KINDS; // eslint-disable-line global-require
  const users = (await staffUsers(q)).filter((u) => roles.includes(u.role_id) && permissions.can(u.perms, a.section, 'approve') && u.emp_id !== a.requested_by);
  const by = (await staffUsers(q)).find((u) => u.emp_id === a.requested_by);
  const [[o]] = a.ref_type === 'order' ? await q.query('SELECT order_id, customer_id FROM orders WHERE order_no = ?', [a.ref_id]) : [[null]];
  await toStaff(q, 'approval', users, () => ({ kind: (KINDS[a.kind] || {}).label || a.kind, summary: a.summary, requested_by: by ? `${by.name} (${by.emp_id})` : a.requested_by, link: link('approvals') }),
    { ref: `approval ${a.approval_id}`, orderId: o ? o.order_id : null, customerId: o ? o.customer_id : (a.ref_type === 'customer' ? Number(a.ref_id) : null) });
});

async function deliveryFailed(q, orderId, note) {
  if (!(await isOn(q, 'delivery_failed'))) return;
  const [[o]] = await q.query(`SELECT o.order_id, o.order_no, o.customer_id, o.failed_reason, c.name AS customer,
      (SELECT MAX(s.trip_id) FROM trip_stops s WHERE s.order_id = o.order_id AND s.status = 'failed') AS trip_id
      FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.order_id = ?`, [orderId]);
  if (!o) return;
  await toStaff(q, 'delivery_failed', await staffWith(q, 'delivery', 'create'),
    () => ({ order_no: o.order_no, customer: o.customer, trip: o.trip_id ? `T-${o.trip_id}` : '-', reason: o.failed_reason || note, link: link('commerce/delivery') }),
    { orderId: o.order_id, customerId: o.customer_id, ref: o.order_no });
}

/** delivery.endTrip: cash handed over differs from the cash collected */
const cashDifference = (q, tripId) => safely('cash_difference', async () => {
  if (!(await isOn(q, 'cash_difference'))) return;
  const [[t]] = await q.query('SELECT t.trip_id, t.cash_collected, t.cash_handed, t.end_note, d.name AS driver FROM delivery_trips t JOIN drivers d ON d.driver_id = t.driver_id WHERE t.trip_id = ?', [tripId]);
  if (!t) return;
  const diff = round2(Number(t.cash_handed) - Number(t.cash_collected));
  if (Math.abs(diff) < 0.005) return;
  await toStaff(q, 'cash_difference', await staffWith(q, 'delivery', 'create'),
    () => ({ trip: `T-${t.trip_id}`, driver: t.driver, collected: money(t.cash_collected), handed: money(t.cash_handed), difference: `${diff > 0 ? '+' : '-'}${money(Math.abs(diff))}`, note: t.end_note, link: link('commerce/delivery') }),
    { ref: `T-${t.trip_id}` });
});

// ---------------------------------------------------------------- daily jobs
const OVERDUE = `i.status = 'issued' AND o.status <> 'cancelled' AND o.amount_due > 0.005 AND i.due_on < ${IST_TODAY} AND (o.payment_terms <> 'cod' OR o.status = 'delivered')`;

/** overdue reminders: every N days, at most M times while invoices stay overdue; never to an opted-out customer */
async function jobOverdue(q) {
  const cs = await commerceSettings.read(q);
  const every = Math.max(Number(cs.notify_overdue_every_days) || 7, 1);
  const max = Math.max(Number(cs.notify_overdue_max) || 3, 1);
  const [rows] = await q.query(`SELECT o.customer_id, COUNT(*) AS n, SUM(o.amount_due) AS amount, MIN(i.due_on) AS since,
      GROUP_CONCAT(CONCAT(i.invoice_no, ' (due ', DATE_FORMAT(i.due_on, '%d %b %Y'), ', Rs ', FORMAT(o.amount_due, 2, 'en_IN'), ')') ORDER BY i.due_on SEPARATOR '; ') AS list
      FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE ${OVERDUE} GROUP BY o.customer_id ORDER BY o.customer_id`);
  let sent = 0; let skipped = 0;
  for (const r of rows) {
    // reminders (and opt-out skips) since the oldest overdue invoice fell due
    const [[h]] = await q.query(`SELECT COALESCE(SUM(status <> 'skipped'), 0) AS n, DATEDIFF(${IST_TODAY}, MAX(DATE(CONVERT_TZ(created_at, '+00:00', '+05:30')))) AS ago
        FROM notification_log WHERE event_key = 'overdue' AND customer_id = ? AND is_test = 0 AND created_at >= ?`, [r.customer_id, r.since]);
    if (h.ago !== null && Number(h.ago) < every) continue;
    if (Number(h.n) >= max) continue;
    const [[o]] = await q.query(`SELECT COALESCE(SUM(amount_due), 0) AS owed FROM orders WHERE customer_id = ? AND status <> 'cancelled' AND amount_due > 0.005`, [r.customer_id]);
    const n = await toCustomer(q, 'overdue', { customerId: r.customer_id, vars: { overdue_amount: money(r.amount), overdue_count: Number(r.n), invoices: r.list, outstanding: money(o.owed) },
      attach: { kind: 'statement', id: r.customer_id }, ref: `${r.n} overdue` });
    if (n) sent += n; else skipped += 1;
  }
  return `${rows.length} customer(s) with overdue invoices: ${sent} reminder(s), ${skipped} not sent`;
}

/** wallet credit expiring in N days: once per credit, not to an opted-out customer */
async function jobWalletExpiring(q) {
  const cs = await commerceSettings.read(q);
  const days = Math.max(Number(cs.notify_wallet_expiry_days) || 7, 1);
  const [rows] = await q.query(`SELECT w.entry_id, w.customer_id, w.remaining, DATE_FORMAT(w.expires_on, '%Y-%m-%d') AS expires_on, DATEDIFF(w.expires_on, ${IST_TODAY}) AS left_days
      FROM wallet_entries w WHERE w.remaining > 0.005 AND w.expires_on IS NOT NULL AND w.expires_on >= ${IST_TODAY} AND w.expires_on <= ${IST_TODAY} + INTERVAL ? DAY
        AND NOT EXISTS (SELECT 1 FROM notification_log n WHERE n.event_key = 'wallet_expiring' AND n.ref = CONCAT('wallet ', w.entry_id) AND n.is_test = 0)`, [days]);
  let sent = 0;
  for (const w of rows) {
    const [[b]] = await q.query('SELECT COALESCE(SUM(amount), 0) AS bal FROM wallet_entries WHERE customer_id = ?', [w.customer_id]);
    sent += await toCustomer(q, 'wallet_expiring', { customerId: w.customer_id, vars: { amount: money(w.remaining), expires_on: day(w.expires_on), days: w.left_days, balance: money(b.bal) }, ref: `wallet ${w.entry_id}` });
  }
  return `${rows.length} credit(s) expiring within ${days} days: ${sent} mail(s)`;
}

async function jobStock(q) {
  const stock = require('./stock'); // eslint-disable-line global-require
  const low = await stock.reorderList(q);
  const b = await stock.batchList(q);
  const near = b.rows.filter((r) => r.good > 0 && r.state !== 'ok');
  if (!low.length && !near.length) return 'nothing low or near expiry';
  const n = await toStaff(q, 'stock_daily', await staffWith(q, 'inventory', 'edit'), () => ({
    low_count: low.length, expiry_count: near.length, expiry_days: b.warnDays, link: link('commerce/stock'),
    low_list: low.length ? low.map((s) => `- ${s.sku_code} ${s.name} ${s.size_label}: ${s.available} available, reorder level ${s.reorder_level}, suggested ${s.suggested}`).join('\n') : '- none',
    expiry_list: near.length ? near.map((r) => `- ${r.sku_code} batch ${r.batch_no}: ${r.good} packs, ${r.state === 'expired' ? `expired ${day(r.expiry_date)}` : `expires ${day(r.expiry_date)} (${r.days_left} days)`}`).join('\n') : '- none',
  }), { ref: istToday() });
  return `${low.length} low, ${near.length} near expiry: ${n} mail(s)`;
}

async function jobFollowUps(q) {
  const [rows] = await q.query(`SELECT f.assignee, f.note, DATE_FORMAT(f.due_on, '%Y-%m-%d') AS due_on, c.customer_no, c.name
      FROM follow_ups f JOIN customers c ON c.customer_id = f.customer_id WHERE f.status = 'open' AND f.due_on <= ${IST_TODAY} ORDER BY f.assignee, f.due_on`);
  const byOwner = new Map();
  rows.forEach((r) => byOwner.set(r.assignee, [...(byOwner.get(r.assignee) || []), r]));
  const users = (await staffUsers(q)).filter((u) => byOwner.has(u.emp_id));
  const n = await toStaff(q, 'follow_ups', users, (u) => {
    const list = byOwner.get(u.emp_id);
    return { count: list.length, link: link('commerce/follow-ups'), list: list.map((f) => `- ${f.customer_no} ${f.name}: ${f.note} (due ${day(f.due_on)})`).join('\n') };
  }, { ref: istToday() });
  return `${rows.length} follow-up(s) for ${byOwner.size} owner(s): ${n} mail(s)`;
}

async function jobDailySummary(q) {
  const Y = `DATE(CONVERT_TZ(x, '+00:00', '+05:30')) = ${IST_TODAY} - INTERVAL 1 DAY`;
  const on = (col) => Y.replace('x', col);
  const [[s]] = await q.query(`SELECT
      (SELECT COUNT(*) FROM orders WHERE ${on('created_at')}) AS orders, (SELECT COALESCE(SUM(total), 0) FROM orders WHERE ${on('created_at')} AND status <> 'cancelled') AS order_value,
      (SELECT COUNT(*) FROM invoices WHERE ${on('issued_at')}) AS invoices, (SELECT COALESCE(SUM(total), 0) FROM invoices WHERE ${on('issued_at')}) AS invoiced,
      (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE kind = 'payment' AND ${on('created_at')}) AS paid,
      (SELECT COUNT(*) FROM orders WHERE ${on('delivered_at')}) AS delivered, (SELECT COUNT(*) FROM orders WHERE ${on('failed_at')}) AS failed,
      (SELECT COUNT(*) FROM returns WHERE ${on('created_at')}) AS returns_new,
      (SELECT COUNT(*) FROM approvals WHERE status = 'pending') AS approvals,
      (SELECT COUNT(*) FROM orders WHERE status IN ('new', 'packing')) AS to_pack, (SELECT COUNT(*) FROM orders WHERE status = 'packed') AS to_dispatch,
      (SELECT COALESCE(SUM(o.amount_due), 0) FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE ${OVERDUE}) AS overdue`);
  const yday = new Date(Date.now() + 5.5 * 3600e3 - 86400e3).toISOString().slice(0, 10);
  const summary = [
    `- Orders: ${s.orders} (Rs ${money(s.order_value)})`, `- Invoiced: ${s.invoices} invoice(s), Rs ${money(s.invoiced)}`, `- Payments received: Rs ${money(s.paid)}`,
    `- Delivered: ${s.delivered}, failed: ${s.failed}`, `- New returns: ${s.returns_new}`,
    '', 'Waiting now:', `- Approvals: ${s.approvals}`, `- To pack: ${s.to_pack}, to dispatch: ${s.to_dispatch}`, `- Overdue with customers: Rs ${money(s.overdue)}`,
  ].join('\n');
  const n = await toStaff(q, 'daily_summary', (await staffUsers(q)).filter((u) => u.role_id === permissions.ADMIN_ROLE_ID), () => ({ date: day(yday), summary, link: link('commerce/ops') }), { ref: yday });
  return `summary of ${yday}: ${n} mail(s)`;
}

const JOBS = { overdue: jobOverdue, wallet_expiring: jobWalletExpiring, stock_daily: jobStock, follow_ups: jobFollowUps, daily_summary: jobDailySummary };

/**
 * the daily jobs that are on and have not run today (India date), from the setting's hour; force = now, whatever the
 * hour (the "Run daily mails now" button; each job still runs once a day) -> [{ job, result }]
 */
async function runDaily({ force = false, by = 'system' } = {}) {
  if (muted) return [];
  const cs = await commerceSettings.read(db);
  if (!cs.commerce_enabled) return [{ job: 'all', result: 'Commerce is switched off: no daily mails' }];
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  if (!force && hour < (Number(cs.notify_daily_hour) || 0)) return [];
  const today = istToday();
  const out = [];
  for (const job of DAILY) {
    if (!(await isOn(db, job))) { out.push({ job, result: 'off' }); continue; }
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const [claim] = await conn.query('INSERT IGNORE INTO notification_runs (job_key, run_day, result) VALUES (?, ?, ?)', [job, today, `running (${by})`]);
      if (!claim.affectedRows) { await conn.rollback(); out.push({ job, result: 'already ran today' }); continue; }
      const result = await JOBS[job](conn);
      await conn.query('UPDATE notification_runs SET result = ?, ran_at = UTC_TIMESTAMP() WHERE job_key = ? AND run_day = ?', [`${result} (${by})`.slice(0, 255), job, today]);
      await conn.commit();
      out.push({ job, result });
    } catch (e) {
      await conn.rollback().catch(() => {});
      console.error(`notification job ${job} failed:`, e.code || e.message);
      out.push({ job, result: `failed: ${e.code || e.message}` });
    } finally { conn.release(); }
  }
  return out;
}

let timer = null;
function startJobs() {
  if (timer) return;
  timer = setInterval(() => { runDaily().catch((e) => console.error('notification jobs:', e.message)); }, 10 * 60 * 1000);
  timer.unref();
}
function stopJobs() { clearInterval(timer); timer = null; }

// ---------------------------------------------------------------- preview and test (the template editor)
/**
 * sample values for an event from the real demo data -> { vars, sample (what it is about), customerId, attach }
 * staff events use the signed-in user's name
 */
async function sampleFor(q, event, me, lang = null) {
  const pick = async (sql) => { const [[r]] = await q.query(sql); return r || null; };
  const ord = async (where) => {
    // a customer in the language being edited, with an e-mail address, when there is one
    const pref = `(SELECT COALESCE(c.lang_code, '') = ? FROM customers c WHERE c.customer_id = o.customer_id) DESC,
      EXISTS (SELECT 1 FROM customer_contacts x WHERE x.customer_id = o.customer_id AND x.is_active = 1 AND x.email IS NOT NULL) DESC`;
    const [[r0]] = await q.query(`SELECT order_id FROM orders o WHERE ${where} ORDER BY ${pref}, order_id DESC LIMIT 1`, [lang || '']);
    const r = r0 || await pick('SELECT order_id FROM orders ORDER BY order_id DESC LIMIT 1');
    if (!r) return null;
    const f = await orderFacts(q, r.order_id);
    return { ...f, sample: `order ${f.order.order_no}` };
  };
  const ev = EVENTS[event];
  let s = null;
  switch (event) {
    case 'order_confirmed': s = await ord("status = 'new'"); break;
    case 'order_packed': s = await ord("status = 'packed'"); break;
    case 'order_out': s = await ord("status = 'out_for_delivery'"); break;
    case 'order_courier': s = await ord('awb_no IS NOT NULL'); break;
    case 'order_delivered': s = await ord("status = 'delivered'"); break;
    case 'invoice': {
      const i = await pick("SELECT invoice_id, invoice_no, order_id, total, DATE_FORMAT(due_on, '%Y-%m-%d') AS due_on FROM invoices WHERE status = 'issued' ORDER BY invoice_id DESC LIMIT 1");
      if (!i) break;
      const f = await orderFacts(q, i.order_id);
      s = { ...f, vars: { ...f.vars, invoice_no: i.invoice_no, total: money(i.total), due_on: day(i.due_on) }, attach: { kind: 'invoice', id: i.invoice_id }, sample: `invoice ${i.invoice_no}` };
      break;
    }
    case 'payment': {
      const p = await pick("SELECT payment_id, order_id, mode, amount, DATE_FORMAT(received_on, '%Y-%m-%d') AS received_on, reference FROM payments WHERE kind = 'payment' ORDER BY payment_id DESC LIMIT 1");
      if (!p) break;
      const f = await orderFacts(q, p.order_id);
      s = { ...f, vars: { ...f.vars, amount: money(p.amount), mode: p.mode, reference: p.reference, paid_on: day(p.received_on) }, sample: `payment ${p.payment_id} on ${f.order.order_no}` };
      break;
    }
    case 'return_accepted': case 'return_picked': case 'return_refunded': {
      const r = await pick(`SELECT r.return_id, f.amount, cn.credit_note_id, cn.credit_note_no FROM returns r LEFT JOIN refunds f ON f.return_id = r.return_id AND f.status = 'paid'
          LEFT JOIN credit_notes cn ON cn.credit_note_id = f.credit_note_id ORDER BY (cn.credit_note_id IS NOT NULL) DESC, r.return_id DESC LIMIT 1`);
      if (!r) break;
      const rf = await returnFacts(q, r.return_id);
      const f = await orderFacts(q, rf.r.order_id);
      s = { ...f, vars: { ...f.vars, return_no: rf.r.return_no, items: rf.items, amount: money(r.amount), credit_note_no: r.credit_note_no },
        attach: event === 'return_refunded' && r.credit_note_id ? { kind: 'credit_note', id: r.credit_note_id } : null, sample: `return ${rf.r.return_no}` };
      break;
    }
    case 'wallet_credited': case 'wallet_expiring': {
      const w = await pick(`SELECT entry_id, customer_id, amount, remaining, reason, DATE_FORMAT(COALESCE(expires_on, ${IST_TODAY} + INTERVAL 7 DAY), '%Y-%m-%d') AS expires_on,
          DATEDIFF(COALESCE(expires_on, ${IST_TODAY} + INTERVAL 7 DAY), ${IST_TODAY}) AS left_days FROM wallet_entries WHERE source IN ('cashback', 'manual') ORDER BY entry_id DESC LIMIT 1`);
      if (!w) break;
      const [[b]] = await q.query('SELECT COALESCE(SUM(amount), 0) AS bal FROM wallet_entries WHERE customer_id = ?', [w.customer_id]);
      s = { customerId: w.customer_id, vars: { amount: money(event === 'wallet_expiring' ? w.remaining : w.amount), reason: w.reason, balance: money(b.bal), expires_on: day(w.expires_on), days: w.left_days }, sample: `wallet entry ${w.entry_id}` };
      break;
    }
    case 'overdue': {
      const r = await pick(`SELECT o.customer_id, COUNT(*) AS n, SUM(o.amount_due) AS amount,
          GROUP_CONCAT(CONCAT(i.invoice_no, ' (due ', DATE_FORMAT(i.due_on, '%d %b %Y'), ', Rs ', FORMAT(o.amount_due, 2, 'en_IN'), ')') ORDER BY i.due_on SEPARATOR '; ') AS list
          FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE ${OVERDUE} GROUP BY o.customer_id ORDER BY SUM(o.amount_due) DESC LIMIT 1`);
      if (!r) break;
      const [[o]] = await q.query("SELECT COALESCE(SUM(amount_due), 0) AS owed FROM orders WHERE customer_id = ? AND status <> 'cancelled' AND amount_due > 0.005", [r.customer_id]);
      s = { customerId: r.customer_id, vars: { overdue_amount: money(r.amount), overdue_count: Number(r.n), invoices: r.list, outstanding: money(o.owed) }, attach: { kind: 'statement', id: r.customer_id }, sample: 'the customer with the most overdue' };
      break;
    }
    case 'approval': {
      const a = await pick("SELECT approval_id, kind, summary, requested_by FROM approvals ORDER BY status = 'pending' DESC, approval_id DESC LIMIT 1");
      const KINDS = require('./approvals').KINDS; // eslint-disable-line global-require
      s = { vars: { kind: a ? (KINDS[a.kind] || {}).label : 'Refund', summary: a ? a.summary : '-', requested_by: a ? a.requested_by : '-', link: link('approvals') }, sample: a ? `approval #${a.approval_id}` : 'example' };
      break;
    }
    case 'delivery_failed': {
      const o = await pick("SELECT o.order_no, o.failed_reason, c.name FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.failed_at IS NOT NULL ORDER BY o.failed_at DESC LIMIT 1");
      s = { vars: { order_no: o ? o.order_no : 'DFO-260001', customer: o ? o.name : '-', trip: 'T-1', reason: o ? o.failed_reason : 'Shop closed', link: link('commerce/delivery') }, sample: o ? o.order_no : 'example' };
      break;
    }
    case 'cash_difference': {
      const t = await pick("SELECT t.trip_id, t.cash_collected, t.cash_handed, t.end_note, d.name FROM delivery_trips t JOIN drivers d ON d.driver_id = t.driver_id WHERE t.status = 'ended' ORDER BY ABS(t.cash_handed - t.cash_collected) DESC, t.trip_id DESC LIMIT 1");
      const diff = t ? round2(Number(t.cash_handed) - Number(t.cash_collected)) : -200;
      s = { vars: { trip: t ? `T-${t.trip_id}` : 'T-1', driver: t ? t.name : '-', collected: money(t ? t.cash_collected : 1000), handed: money(t ? t.cash_handed : 800), difference: `${diff >= 0 ? '+' : '-'}${money(Math.abs(diff))}`, note: t ? t.end_note : '-', link: link('commerce/delivery') }, sample: t ? `trip T-${t.trip_id}` : 'example' };
      break;
    }
    case 'stock_daily': s = { vars: { low_count: 2, expiry_count: 1, expiry_days: 60, low_list: '- DF001-M100: 12 available, reorder level 20', expiry_list: '- DF044-M100 batch B2: 40 packs, expires in 30 days', link: link('commerce/stock') }, sample: 'example lines' }; break;
    case 'follow_ups': s = { vars: { count: 1, list: '- CUS-0001: call about the next order (due today)', link: link('commerce/follow-ups') }, sample: 'example lines' }; break;
    case 'daily_summary': s = { vars: { date: day(istToday()), summary: '- Orders: 3 (Rs 12,000.00)\n- Payments received: Rs 5,000.00', link: link('commerce/ops') }, sample: 'example numbers' }; break;
    default: break;
  }
  if (!s) return null;
  const customerId = s.customerId || (s.order ? s.order.customer_id : null);
  const c = customerId ? await customerRow(q, customerId) : null;
  return { vars: { ...(s.vars || {}), ...(ev.audience === 'staff' ? { name: me.name } : { customer: c ? c.business_name || c.name : '-', contact: c ? c.name : '-' }) },
    sample: s.sample, customer: c, order: s.order || null, attach: s.attach || null };
}

/** the editor: render a (maybe unsaved) subject + body with real demo data -> { subject, html, text, sample, recipients, attach } */
async function preview(q, event, lang, draft, me) {
  if (!EVENTS[event]) throw Object.assign(new Error('Unknown event'), { status: 404 });
  const def = await defaultLang(q);
  const s = await sampleFor(q, event, me, lang === def ? '' : lang);
  if (!s) throw Object.assign(new Error('No demo data for this event yet'), { status: 409 });
  const [[l]] = await q.query('SELECT lang_code, html_lang, font_family FROM languages WHERE lang_code = ?', [lang]);
  if (!l) throw Object.assign(new Error('Unknown language'), { status: 404 });
  const saved = await template(q, event, lang);
  const tpl = { ...l, subject: draft && draft.subject !== undefined ? draft.subject : (saved ? saved.subject : ''), body: draft && draft.body !== undefined ? draft.body : (saved ? saved.body : '') };
  const out = compose(tpl, s.vars, await footerFor(q, EVENTS[event].audience));
  // the admin preview (an iframe) cannot load the cid: logo of a real mail: the same picture inline
  const html = out.html.split(mailer.LOGO_SRC).join(`data:image/png;base64,${logoData()}`);
  const recipients = EVENTS[event].audience === 'customer' && s.customer ? await customerRecipients(q, EVENTS[event].to, s.customer, s.order) : [];
  return { ...out, html, sample: s.sample, recipients, attach: s.attach, customer: s.customer ? `${s.customer.customer_no} ${s.customer.name}` : null };
}
let logoB64 = null;
const logoData = () => {
  if (!logoB64) logoB64 = require('fs').readFileSync(require('path').join(__dirname, 'mail-logo.png')).toString('base64'); // eslint-disable-line global-require
  return logoB64;
};

/** "Send test to me": the preview as a real mail (with its PDF) to the signed-in user's notification address */
async function sendTest(q, event, lang, draft, me) {
  if (!EMAIL.test(me.email || '')) throw Object.assign(new Error('Set your notification e-mail first (Setup > Admin users)'), { status: 409 });
  const p = await preview(q, event, lang, draft, me);
  const html = p.html.split(`data:image/png;base64,${logoData()}`).join(mailer.LOGO_SRC); // the real mail: the logo as in every mail
  const r = await record(q, { event, audience: EVENTS[event].audience, to: { email: me.email, name: me.name, emp_id: me.emp_id }, lang, rendered: { subject: `[Test] ${p.subject}`, html, text: p.text },
    attachments: p.attach ? [p.attach] : null, test: true, ref: p.sample, by: me.emp_id });
  return { ...r, to: me.email, subject: `[Test] ${p.subject}`, attach: p.attach };
}

module.exports = {
  EVENTS, DAILY, settingKey, setMuted, isOn, template, unknownVars, compose, customerRecipients, staffUsers, staffWith, record,
  orderConfirmed, orderStatus, invoiceIssued, paymentReceived, returnAccepted, returnPicked, returnRefunded, walletCredited, approvalWaiting, cashDifference,
  runDaily, startJobs, stopJobs, preview, sendTest, JOBS,
};
