// The month lock (phase 12b; v23 Export to accountant and Company > System "Books closed up to"; migration
// 20261102_stage2_12b_02_month_lock.sql).
// - A record may not be dated on or before Commerce setting books_closed_to (a year closed with the CA), nor in a month
//   already exported to the CA (month_exports). Every dated save calls assertOpen(q, its own date), and so does an
//   approval signed later, on the date of the record it is about (approvals.record_date): a request asked in October
//   and signed in November still posts in October, so it is refused once October is with the CA (v23 T2).
// - One record of an exported month may still change after an approved "after_export" request (askUnlock): the record
//   key is then in record_unlocks and the change is listed for the CA in Export history (export_events).
// - Only a finished month is exported, and only when nothing dated in it still waits for a decision (v23 Y1, T2).
//   Exporting writes the journal (reports.journal) and locks the month for everybody.
const { audit } = require('./audit');
const approvals = require('./approvals');
const commerceSettings = require('./commerce-settings');
const pricing = require('./pricing');

class BooksError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}

const monthOf = (d) => String(d || '').slice(0, 7);
const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
const istDates = require('../shared/istDate'); // India dates in one place (src/shared/istDate.js)
const lastDay = (m) => istDates.lastDayOf(m);

/** why nothing may be dated `date` ('' = it may); key: a record allowed to change after all (record_unlocks) */
async function lockWhy(q, date, key = null) {
  const d = istDates.ymd(date) || pricing.istToday(); // a Date read from a DATE column, or 'YYYY-MM-DD'
  const [[bc]] = await q.query("SELECT value FROM commerce_settings WHERE setting_key = 'books_closed_to'"); // read on every stock move: one row only
  const closed = String((bc && bc.value) || '').trim();
  if (closed && d <= closed) return `The books are closed up to ${closed}: nothing can be dated ${d}. Use a date after it.`;
  const [[m]] = await q.query('SELECT month FROM month_exports WHERE month = ?', [monthOf(d)]);
  if (!m) return '';
  if (key) {
    const [[u]] = await q.query('SELECT record_key FROM record_unlocks WHERE record_key = ?', [String(key)]);
    if (u) return '';
  }
  return `${m.month} is exported to the CA and locked: it (dated ${d}) cannot be dated in it. Use a date in an open month.`;
}

/** refuse a save dated in a closed or exported month (409) */
async function assertOpen(q, date, key = null) {
  const why = await lockWhy(q, date, key);
  if (why) throw new BooksError(why);
}

/**
 * ask to change one record of an exported month: an "after_export" request (once per record; a waiting one is
 * returned). -> { approval_id, waiting: true } or { unlocked: true } when it may change already
 */
async function askUnlock(q, { key, label, date, godownId }, empId) {
  if (!(await lockWhy(q, date, key))) return { unlocked: true };
  const month = monthOf(date);
  const [[m]] = await q.query('SELECT month FROM month_exports WHERE month = ?', [month]);
  if (!m) throw new BooksError(await lockWhy(q, date, key)); // closed books: only moving the date back reopens them
  const [[w]] = await q.query("SELECT approval_id FROM approvals WHERE kind = 'after_export' AND status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.key')) = ?", [String(key)]);
  if (w) return { approval_id: w.approval_id, waiting: true, already: true };
  const id = await approvals.request(q, { kind: 'after_export', godownId: godownId || 1, refType: 'record', refId: String(key).slice(0, 60), recordDate: String(date).slice(0, 10),
    summary: `${label} in ${month}, which is already exported to the CA`, payload: { key: String(key), label, month } }, empId);
  return { approval_id: id, waiting: true };
}

/**
 * changing an existing record dated `date` (e.g. cancelling an October invoice): allowed in an open month, or once its
 * "after_export" request is approved. Else the request is raised (on its own connection, so it stays although this
 * save is refused) and the save is refused with what to do (v23 lockGuard). Closed books: refused, nothing asked.
 */
async function guardRecord(q, { date, key, label, godownId }, empId) {
  const why = await lockWhy(q, date, key);
  if (!why) return;
  const [[m]] = await q.query('SELECT month FROM month_exports WHERE month = ?', [monthOf(date)]);
  if (!m) throw new BooksError(why);
  const { getDBConnection } = require('../../config/db'); // eslint-disable-line global-require
  const c = await getDBConnection(process.env.DB_NAME || 'dfresh').promise().getConnection();
  let r;
  try {
    await c.beginTransaction();
    r = await askUnlock(c, { key, label, date, godownId }, empId);
    await c.commit();
  } catch (e) { await c.rollback(); throw e; } finally { c.release(); }
  throw new BooksError(`${m.month} is exported to the CA and locked. ${r.already ? 'Already asked' : 'Asked'} to change it: request ${r.approval_id} waits for approval. After approval do it again; the CA is told.`);
}

/** an approved "after_export": the record may change, and the CA is told (Export history) */
async function unlockApproved(q, p, empId, approvalId = null) {
  await q.query('INSERT IGNORE INTO record_unlocks (record_key, month, label, approval_id, unlocked_by) VALUES (?, ?, ?, ?, ?)', [p.key, p.month, String(p.label).slice(0, 255), approvalId, empId]);
  await q.query("INSERT INTO export_events (month, kind, record_key, label, emp_id) VALUES (?, 'unlock', ?, ?, ?)", [p.month, p.key, `Change allowed after export: ${p.label}`.slice(0, 255), empId]);
}

/** why `month` cannot be exported now ([] = it can) */
async function exportChecks(q, month) {
  if (!isMonth(month)) return ['Month: like 2026-10'];
  const out = [];
  const today = pricing.istToday();
  if (month >= monthOf(today)) out.push(`${month} is still running. A month is exported after it ends; exporting locks it for everybody.`);
  const [[done]] = await q.query("SELECT DATE_FORMAT(CONVERT_TZ(exported_at, '+00:00', '+05:30'), '%Y-%m-%d') AS d, exported_by FROM month_exports WHERE month = ?", [month]);
  if (done) out.push(`${month} was exported on ${done.d} by ${done.exported_by}.`);
  const [wait] = await q.query("SELECT kind, summary FROM approvals WHERE status = 'pending' AND DATE_FORMAT(record_date, '%Y-%m') = ? ORDER BY approval_id", [month]);
  if (wait.length) out.push(`${wait.length} request${wait.length === 1 ? '' : 's'} dated in ${month} still waiting: ${wait.slice(0, 4).map((w) => w.summary).join('; ')}${wait.length > 4 ? ' ...' : ''}. Decide them first.`);
  return out;
}

/** export a finished month: the journal rows, and the month is locked -> { month, rows, file } */
async function exportMonth(q, month, empId, journal) {
  const why = await exportChecks(q, month);
  if (why.length) throw new BooksError(`Fix first: ${why.join(' ')}`);
  const rows = await journal(q, { from: `${month}-01`, to: lastDay(month), scope: null });
  const file = `dfresh-journal-${month}.csv`;
  await q.query('INSERT INTO month_exports (month, exported_by, file_name, `lines`) VALUES (?, ?, ?, ?)', [month, empId, file, rows.length]);
  await q.query("INSERT INTO export_events (month, kind, label, emp_id) VALUES (?, 'export', ?, ?)", [month, `Exported ${rows.length} journal lines (${file}); the month is locked`, empId]);
  await audit(q, { empId, action: 'export', entity: 'month', entityId: month, after: { lines: rows.length, file, locked: true } });
  return { month, rows, file };
}

/** Export history: every month sent and what changed after it */
async function history(q) {
  const [months] = await q.query("SELECT month, DATE_FORMAT(CONVERT_TZ(exported_at, '+00:00', '+05:30'), '%Y-%m-%d %H:%i') AS exported_at, exported_by, file_name, `lines` FROM month_exports ORDER BY month DESC");
  const [events] = await q.query("SELECT event_id, month, kind, record_key, label, emp_id, DATE_FORMAT(`at`, '%Y-%m-%d %H:%i') AS at FROM export_events ORDER BY event_id DESC LIMIT 500");
  const cs = await commerceSettings.read(q);
  return { months, events, books_closed_to: String(cs.books_closed_to || '').trim() || null };
}

approvals.onApproved('after_export', async (q, p, empId) => { if (p && p.key) await unlockApproved(q, p, empId); });

module.exports = { BooksError, monthOf, isMonth, lastDay, lockWhy, assertOpen, guardRecord, askUnlock, unlockApproved, exportChecks, exportMonth, history };
