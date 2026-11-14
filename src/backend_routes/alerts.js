// Home > Alerts and the bell (phase 23, v23 alertsAll / viewAlerts; migration 20261113_stage2_23_03_alerts.sql).
// - Business alerts are worked out live from the data, for the sections a person may view and the godowns they work at
//   (a role with "Own customers only" sees only its own customers' dues): low stock, batches near expiry, packs with no
//   cost (See cost only, v23 Low1), overdue customers, cheques to deposit, vehicle papers ending, supplier bills due,
//   returns to inspect, approvals waiting for them, approvals waiting long (more than half their expiry), order holds
//   ending, repeating expenses due, petty cash running low or counted off by more than Rs 100.
// - Admin alerts are stored events, shown to Admins: an override used, someone marked as left, leave entered for an
//   Admin, a rule loosened. record() writes one (notifications.adminAlert and a few saves call it).
// - Each person marks an alert read (Open does) or snoozes it until tomorrow; an Admin switches a type off for a role.
const permissions = require('../shared/permissions');
const pricing = require('./pricing');
const commerceSettings = require('./commerce-settings');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// type: [label, section that must be viewable ('home' = anyone), tone]
const TYPES = {
  approvals: ['Approvals waiting for you', 'home', 'gold'], approval_old: ['Approvals waiting long', 'home', 'warn'],
  low_stock: ['Stock below the reorder level', 'inventory', 'warn'], near_expiry: ['Batches near expiry', 'inventory', 'warn'],
  no_cost: ['Packs with no cost', 'products', 'warn'], overdue: ['Overdue customers', 'money', 'bad'], cheque: ['Cheques to deposit', 'money', 'info'],
  supplier_bill: ['Supplier bills due', 'money', 'warn'], vehicle: ['Vehicle papers ending', 'delivery', 'warn'], return_inspect: ['Returns to inspect', 'returns', 'gold'],
  hold_ending: ['Order holds ending', 'orders', 'warn'], repeat_due: ['Repeating expenses due', 'expenses', 'info'], petty: ['Petty cash low or counted off', 'expenses', 'warn'],
  override: ['An override used', 'admin', 'bad'], staff_left: ['Someone marked as left', 'admin', 'warn'], admin_leave: ['Leave entered for an Admin', 'admin', 'info'],
  rule_loosened: ['A rule loosened', 'admin', 'warn'],
};
const ICON = { approvals: 'clipboard-check', approval_old: 'clock', low_stock: 'triangle-alert', near_expiry: 'clock', no_cost: 'tag', overdue: 'receipt', cheque: 'landmark',
  supplier_bill: 'file-text', vehicle: 'truck', return_inspect: 'undo-2', hold_ending: 'clock', repeat_due: 'repeat', petty: 'wallet', override: 'lock', staff_left: 'users', admin_leave: 'users', rule_loosened: 'settings' };
const ORDER = { bad: 0, warn: 1, gold: 2, info: 3 };

/** an admin alert (stored): kind is a TYPES key of the admin group */
async function record(q, { kind, title, body = null, link = null, ref = null }, empId = 'system') {
  try {
    await q.query('INSERT INTO admin_alerts (kind, title, body, link, ref, emp_id) VALUES (?, ?, ?, ?, ?, ?)', [kind, String(title).slice(0, 255), body ? String(body).slice(0, 1000) : null, link, ref ? String(ref).slice(0, 80) : null, empId]);
  } catch (e) {
    if (e.code !== 'ER_NO_SUCH_TABLE') throw e; // before the phase 23 migration
  }
}

async function offTypes(q, roleId) {
  const [rows] = await q.query('SELECT alert_type FROM alert_role_settings WHERE role_id = ? AND is_on = 0', [Number(roleId)]);
  return new Set(rows.map((r) => r.alert_type));
}

/**
 * every alert for this person -> [{ key, type, label, section, tone, icon, title, text, link, at, read }]
 * admin = req.admin (perms, godowns, seesCost, ownOnly, is_admin, emp_id, role_id); countDecidable: approvals.countDecidable
 */
async function forPerson(q, admin, { countDecidable } = {}) {
  const today = pricing.istToday();
  const off = await offTypes(q, admin.role_id);
  const can = (sec) => sec === 'home' || (sec === 'admin' ? admin.is_admin : permissions.can(admin.perms, sec, 'view'));
  const scope = admin.godowns === 'ALL' ? null : admin.godowns; // null = every godown
  const inG = (g) => scope === null || g === null || g === undefined || scope.includes(Number(g));
  const out = [];
  const add = (type, key, title, text, link, extra = {}) => {
    if (off.has(type)) return;
    const [label, section, tone] = TYPES[type];
    if (!can(section)) return;
    const sl = section === 'home' ? 'Approvals' : section === 'admin' ? 'Admin' : (permissions.SECTIONS.find((s) => s.key === section) || { label: section }).label;
    out.push({ key: `${type}|${key}`, type, label, section, section_label: sl, tone: extra.tone || tone, icon: ICON[type], title, text, link, at: extra.at || null });
  };
  const cs = await commerceSettings.read(q);
  const [gs] = await q.query('SELECT location_id, name FROM locations WHERE is_active = 1');
  const gName = (id) => (gs.find((g) => Number(g.location_id) === Number(id)) || { name: `godown ${id}` }).name;
  const myG = gs.map((g) => Number(g.location_id)).filter((id) => inG(id));
  const stock = require('./stock'); // eslint-disable-line global-require

  // approvals
  if (countDecidable) {
    const n = await countDecidable(admin);
    if (n) add('approvals', 'mine', `${n} approval${n === 1 ? '' : 's'} wait${n === 1 ? 's' : ''} for you`, 'Home > Approvals', '/admin/approvals');
  }
  const half = Math.max(1, Math.floor((Number(cs.approval_expiry_days) || 7) / 2));
  if (admin.is_admin || permissions.SECTION_KEYS.some((s) => permissions.can(admin.perms, s, 'approve'))) {
    const [old] = await q.query(`SELECT approval_id, summary, godown_id, DATEDIFF(DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30')), DATE(CONVERT_TZ(requested_at, '+00:00', '+05:30'))) AS days FROM approvals WHERE status = 'pending' AND requested_at < UTC_TIMESTAMP() - INTERVAL ? DAY ORDER BY approval_id`, [half]);
    for (const a of old.filter((x) => inG(x.godown_id))) add('approval_old', a.approval_id, `Request #${a.approval_id} waits ${a.days} days`, a.summary, '/admin/approvals', { tone: 'warn' });
  }
  // stock
  if (can('inventory')) {
    for (const r of await stock.reorderList(q, myG)) {
      add('low_stock', `${r.sku_code}|${r.godown_id}`, `${r.name} is low at ${r.godown}`, `${r.available} free, reorder level ${r.reorder_level}`, '/admin/reorder', { tone: r.available <= 0 ? 'bad' : 'warn' });
    }
    for (const g of myG) {
      const { rows } = await stock.batchList(q, [g]);
      for (const b of rows.filter((x) => x.good > 0 && x.state !== 'ok')) {
        add('near_expiry', `${b.batch_id}|${g}`, `${b.name}: ${b.good} ${b.state === 'expired' ? 'expired' : 'near expiry'} at ${gName(g)}`,
          `Batch ${b.batch_no}, ${b.state === 'expired' ? `expired ${b.expiry_date}` : `expires ${b.expiry_date}`}. ${b.state === 'expired' ? 'Write it off or send it back' : 'Sell these first or move them'}`, '/admin/batches-and-expiry', { tone: b.state === 'expired' ? 'bad' : 'warn' });
      }
    }
  }
  // v23 Low1: packs in stock with no cost yet (See cost only)
  if (admin.seesCost && can('products')) {
    const [nc] = await q.query(`SELECT s.sku_code, SUM(m.delta) AS n FROM skus s JOIN stock_movements m ON m.sku_code = s.sku_code AND m.stock_kind = 'good'
        WHERE s.avg_cost IS NULL AND s.is_active = 1 ${scope === null ? '' : 'AND m.location_id IN (?)'} GROUP BY s.sku_code HAVING n > 0 ORDER BY s.sku_code`, scope === null ? [] : [scope.length ? scope : [0]]);
    for (const x of nc) add('no_cost', x.sku_code, `${x.sku_code}: ${Number(x.n)} packs have no cost`, 'Set the standard cost in Products, or it stays out of the stock value and margin.', '/admin/products');
  }
  // money
  if (can('money') || can('customers')) {
    const own = admin.ownOnly ? admin.emp_id : null;
    const { OVERDUE_SQL } = require('./commerce'); // eslint-disable-line global-require
    const [od] = await q.query(`SELECT c.customer_id, c.customer_no, c.name, c.godown_id, c.owner_emp_id, SUM(o.amount_due) AS amount, MIN(i.due_on) AS since
        FROM invoices i JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id WHERE ${OVERDUE_SQL} GROUP BY c.customer_id, c.customer_no, c.name, c.godown_id, c.owner_emp_id`);
    for (const c of od.filter((x) => inG(x.godown_id) && (!own || x.owner_emp_id === own))) {
      add('overdue', c.customer_id, `${c.name} is overdue`, `${rs(c.amount)} overdue since ${new Date(c.since).toISOString().slice(0, 10)}`, '/admin/receipts', { tone: 'bad' });
    }
  }
  if (can('money')) {
    const [ch] = await q.query(`SELECT ch.cheque_id, ch.cheque_no, ch.amount, cu.name, cu.godown_id FROM cheques ch JOIN customers cu ON cu.customer_id = ch.customer_id
        WHERE ch.status NOT IN ('deposited', 'cleared', 'bounced') AND ch.cheque_date <= ?`, [today]);
    for (const c of ch.filter((x) => inG(x.godown_id))) add('cheque', c.cheque_id, `Cheque ${c.cheque_no} can be deposited`, `${rs(c.amount)} from ${c.name}`, '/admin/cheque-register', { tone: 'info' });
    const [bills] = await q.query(`SELECT b.bill_no, b.godown_id, b.total - b.paid AS left_amt, DATE_FORMAT(b.due_date, '%Y-%m-%d') AS due, s.name FROM supplier_bills b JOIN suppliers s ON s.supplier_id = b.supplier_id
        WHERE b.status IN ('unpaid', 'part') AND b.total - b.paid > 0.004 AND b.due_date <= ? + INTERVAL 7 DAY`, [today]).catch(() => [[]]);
    for (const b of bills.filter((x) => inG(x.godown_id))) add('supplier_bill', b.bill_no, `Supplier bill ${b.due < today ? 'overdue' : 'due soon'}: ${b.bill_no}`, `${rs(b.left_amt)} to ${b.name}, due ${b.due}`, '/admin/supplier-payments', { tone: b.due < today ? 'bad' : 'warn' });
  }
  if (can('delivery')) {
    const [vs] = await q.query("SELECT vehicle_id, number, godown_id, DATE_FORMAT(insurance_until, '%Y-%m-%d') AS ins, DATE_FORMAT(fitness_until, '%Y-%m-%d') AS fc FROM vehicles WHERE is_active = 1");
    const soon = new Date(Date.parse(`${today}T00:00:00Z`) + 30 * 864e5).toISOString().slice(0, 10);
    for (const v of vs.filter((x) => inG(x.godown_id))) {
      for (const [k, label] of [['ins', 'Insurance'], ['fc', 'Fitness certificate']]) {
        if (v[k] && v[k] <= soon) add('vehicle', `${v.vehicle_id}|${k}`, `${v.number}: ${label} ${v[k] < today ? 'ended' : 'ends soon'}`, `${label} ${v[k] < today ? 'ended' : 'ends'} ${v[k]}`, '/admin/vehicles', { tone: v[k] < today ? 'bad' : 'warn' });
      }
    }
  }
  if (can('returns')) {
    const { TAB } = require('./returns-routes'); // eslint-disable-line global-require
    const [rt] = await q.query(`SELECT r.return_no, r.godown_id, c.name FROM returns r JOIN orders o ON o.order_id = r.order_id JOIN customers c ON c.customer_id = o.customer_id WHERE ${TAB.to_inspect}`);
    for (const r of rt.filter((x) => inG(x.godown_id))) add('return_inspect', r.return_no, `Return to inspect: ${r.return_no}`, r.name, '/admin/inspection');
  }
  if (can('orders')) {
    const [hs] = await q.query(`SELECT o.order_no, o.godown_id, c.name, TIMESTAMPDIFF(HOUR, UTC_TIMESTAMP(), o.hold_until) AS h FROM orders o JOIN customers c ON c.customer_id = o.customer_id
        WHERE o.status = 'new' AND o.hold_until IS NOT NULL AND (o.hold_gone IS NULL OR o.hold_gone = 0) AND o.hold_until <= UTC_TIMESTAMP() + INTERVAL 6 HOUR`);
    for (const o of hs.filter((x) => inG(x.godown_id) && (!admin.ownOnly || true))) add('hold_ending', o.order_no, `Hold ends soon: ${o.order_no}`, `${o.name}, ${Number(o.h) <= 0 ? 'ended' : `${o.h} hours left`}`, '/admin/commerce/orders');
  }
  if (can('expenses')) {
    const expenses = require('./expenses'); // eslint-disable-line global-require
    const due = await expenses.repeatsDue(q, scope === null ? 'ALL' : scope);
    if (due.length) add('repeat_due', 'all', `${due.length} repeating expense${due.length === 1 ? '' : 's'} due`, due.map((r) => `${r.head} ${rs(r.amount)} on ${r.next_date}`).join(', '), '/admin/expenses', { tone: 'info' });
    for (const b of await expenses.boxes(q, scope === null ? 'ALL' : scope)) {
      if (b.float === null) continue;
      if (b.low) add('petty', `low|${b.godown_id}`, `Petty cash at ${b.name} is running low`, `${rs(b.balance)} in the box, float ${rs(b.float)}`, '/admin/petty-cash');
      const last = b.moves.find((m) => m.kind === 'count');
      if (last && Math.abs(last.amount) > 100) add('petty', `count|${b.godown_id}|${last.move_id}`, `Petty cash count at ${b.name} is off by ${rs(last.amount)}`, `Book ${rs(last.book)}, counted ${rs(last.counted)} on ${last.date}`, '/admin/petty-cash', { tone: 'bad' });
    }
  }
  // admin alerts (stored, the last 30 days)
  if (admin.is_admin) {
    const [aa] = await q.query("SELECT alert_id, kind, title, body, link, DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%Y-%m-%d %H:%i') AS at FROM admin_alerts WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY ORDER BY alert_id DESC LIMIT 200")
      .catch((e) => { if (e.code === 'ER_NO_SUCH_TABLE') return [[]]; throw e; });
    for (const a of aa) if (TYPES[a.kind]) add(a.kind, a.alert_id, a.title, a.body || '', a.link || '/admin/approvals', { at: a.at });
  }
  // reads and snoozes
  const [marks] = await q.query('SELECT alert_key, read_at, DATE_FORMAT(snooze_until, \'%Y-%m-%d\') AS snooze FROM alert_marks WHERE emp_id = ?', [admin.emp_id]).catch(() => [[]]);
  const mk = new Map(marks.map((m) => [m.alert_key, m]));
  return out.filter((a) => { const m = mk.get(a.key); return !(m && m.snooze && m.snooze > today); })
    .map((a) => ({ ...a, read: Boolean(mk.get(a.key) && mk.get(a.key).read_at) }))
    .sort((a, b) => (ORDER[a.tone] ?? 9) - (ORDER[b.tone] ?? 9) || (a.type === 'approvals' ? -1 : b.type === 'approvals' ? 1 : 0));
}

async function mark(q, empId, key, { read = false, snooze = false } = {}) {
  const k = String(key || '').slice(0, 120);
  if (!k) throw Object.assign(new Error('Which alert?'), { status: 400 });
  const until = snooze ? new Date(Date.parse(`${pricing.istToday()}T00:00:00Z`) + 864e5).toISOString().slice(0, 10) : null;
  await q.query(`INSERT INTO alert_marks (emp_id, alert_key, read_at, snooze_until) VALUES (?, ?, ${read ? 'UTC_TIMESTAMP()' : 'NULL'}, ?)
      ON DUPLICATE KEY UPDATE read_at = ${read ? 'UTC_TIMESTAMP()' : 'read_at'}, snooze_until = ${snooze ? 'VALUES(snooze_until)' : 'snooze_until'}`, [empId, k, until]);
  return { key: k, read, snooze_until: until };
}

/** the role x type grid for Admins -> { roles, types, off: { role_id: [types] } } */
async function settings(q) {
  const [roles] = await q.query('SELECT role_id, name FROM roles ORDER BY role_id');
  const [rows] = await q.query('SELECT role_id, alert_type FROM alert_role_settings WHERE is_on = 0');
  const off = {}; rows.forEach((r) => { (off[r.role_id] = off[r.role_id] || []).push(r.alert_type); });
  return { roles, types: Object.entries(TYPES).map(([key, [label, section]]) => ({ key, label, section })), off };
}
async function saveSettings(q, body, empId) {
  const roleId = Number(body.role_id);
  const [[r]] = await q.query('SELECT role_id FROM roles WHERE role_id = ?', [roleId]);
  if (!r) throw Object.assign(new Error('Choose the role'), { status: 400 });
  const off = new Set((Array.isArray(body.off) ? body.off : []).filter((t) => TYPES[t]));
  for (const t of Object.keys(TYPES)) {
    await q.query(`INSERT INTO alert_role_settings (role_id, alert_type, is_on, updated_by, updated_at) VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
        ON DUPLICATE KEY UPDATE is_on = VALUES(is_on), updated_by = VALUES(updated_by), updated_at = VALUES(updated_at)`, [roleId, t, off.has(t) ? 0 : 1, empId]);
  }
  return { role_id: roleId, off: [...off] };
}

// a loosened rule or switch (a rule_change request) that is signed: every Admin sees it
require('./approvals').onApproved('rule_change', async (q, p, empId) => { // eslint-disable-line global-require
  const [[a]] = await q.query("SELECT summary FROM approvals WHERE kind = 'rule_change' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = ? ORDER BY approval_id DESC LIMIT 1", [String((p && p.dk) || '')]);
  await record(q, { kind: 'rule_loosened', title: `Loosened: ${a ? a.summary : (p && p.dk) || 'a rule'}`, body: 'Signed by a second Admin.', ref: p && p.dk, link: '/admin/approval-rules' }, empId);
});

module.exports = { TYPES, record, forPerson, mark, settings, saveSettings, r2 };
