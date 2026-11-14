// HSN codes and dated GST rates (phase 15, v23 Masters > Tax and units > HSN and GST rates; migration
// 20261104_stage2_15_01_prices.sql). One place for tax: a pack takes its GST from its product's HSN code, on a date.
// - hsn_rates: one row per code and start date; the rate on a day is the active row with the latest start on or before
//   it. A new rate from a date waits for a second Admin (owner decision 4 Nov 2026; v23 saves at once): its row is
//   'pending' and never used for tax until signed ('rejected' when turned down).
// - products.gst_rate is kept as today's rate of the product's HSN code (syncProductGst: on every rate change, on a
//   product's HSN change, and nightly so a rate that starts today is picked up), for the screens that show "GST today".
//   Orders, invoices and the price checks ask rateOn / ratesOn for their own date.
// - gst_rate_list: the rates an HSN code may use (0 to 40); a rate in use cannot be removed.
const { audit } = require('./audit');

const HSN_RE = /^(\d{4}|\d{6}|\d{8})$/;
const FIRST_DAY = '2026-04-01'; // a new code may start on 1 April of this year
const r2 = (n) => Math.round(n * 100) / 100;
const istDates = require('../shared/istDate'); // India dates in one place (src/shared/istDate.js)
const { ymd } = istDates;
const istToday = () => istDates.istToday();

class TaxError extends Error {
  constructor(message, status = 400, fields = null) { super(message); this.status = status; this.fields = fields; }
}

/** the GST rates HSN codes may use, ascending */
async function rateList(q) {
  const [rows] = await q.query('SELECT gst_rate FROM gst_rate_list ORDER BY gst_rate');
  return rows.map((r) => Number(r.gst_rate));
}

/** Map hsn -> GST % on `date` (active rows only) */
async function ratesOn(q, date) {
  const [rows] = await q.query(
    `SELECT r.hsn_code, r.gst_rate FROM hsn_rates r
       JOIN (SELECT hsn_code, MAX(effective_from) AS ef FROM hsn_rates WHERE status = 'active' AND effective_from <= ? GROUP BY hsn_code) m
         ON m.hsn_code = r.hsn_code AND m.ef = r.effective_from AND r.status = 'active'`, [date]);
  return new Map(rows.map((r) => [r.hsn_code, Number(r.gst_rate)]));
}
/** GST % of one code on `date`, or null when the code is not in the list (or has no rate yet) */
async function rateOn(q, hsn, date) {
  const m = await ratesOn(q, date);
  return m.has(String(hsn || '')) ? m.get(String(hsn)) : null;
}
/** the active rates of a code (oldest first) and its waiting one */
async function historyOf(q, hsn) {
  const [rows] = await q.query("SELECT rate_id, effective_from, gst_rate, status, approval_id, created_by, created_at FROM hsn_rates WHERE hsn_code = ? AND status IN ('active', 'pending') ORDER BY effective_from, rate_id", [hsn]);
  return rows.map((r) => ({ ...r, effective_from: ymd(r.effective_from), gst_rate: Number(r.gst_rate) }));
}
const exists = async (q, hsn) => Boolean((await q.query('SELECT 1 AS x FROM hsn_codes WHERE hsn_code = ?', [String(hsn || '')]))[0][0]);

/** products.gst_rate = today's rate of its HSN code (only rows that differ change) -> rows changed */
async function syncProductGst(q) {
  const today = istToday();
  const [r] = await q.query(
    `UPDATE products p JOIN (SELECT r.hsn_code, r.gst_rate FROM hsn_rates r
        JOIN (SELECT hsn_code, MAX(effective_from) AS ef FROM hsn_rates WHERE status = 'active' AND effective_from <= ? GROUP BY hsn_code) m
          ON m.hsn_code = r.hsn_code AND m.ef = r.effective_from AND r.status = 'active') t ON t.hsn_code = p.hsn_code
        SET p.gst_rate = t.gst_rate WHERE p.gst_rate <> t.gst_rate`, [today]);
  return r.affectedRows || 0;
}

/** the HSN page: every code with today's rate, the next change, a waiting change and the packs using it */
async function hsnPage(q) {
  const today = istToday();
  const [codes] = await q.query('SELECT hsn_code, description, updated_by, updated_at FROM hsn_codes ORDER BY hsn_code');
  const [rates] = await q.query("SELECT hsn_code, effective_from, gst_rate, status, approval_id FROM hsn_rates WHERE status IN ('active', 'pending') ORDER BY effective_from, rate_id");
  const [packs] = await q.query("SELECT p.hsn_code, s.sku_code FROM skus s JOIN products p ON p.product_id = s.product_id WHERE s.sku_type <> 'raw' ORDER BY s.sku_code");
  const now = await ratesOn(q, today);
  const list = await rateList(q);
  return {
    today,
    codes: codes.map((c) => {
      const mine = rates.filter((r) => r.hsn_code === c.hsn_code).map((r) => ({ from: ymd(r.effective_from), rate: Number(r.gst_rate), status: r.status, approval_id: r.approval_id }));
      const next = mine.find((r) => r.status === 'active' && r.from > today) || null;
      const waiting = mine.find((r) => r.status === 'pending') || null;
      const used = packs.filter((p) => p.hsn_code === c.hsn_code).map((p) => p.sku_code);
      return { hsn_code: c.hsn_code, description: c.description, today: now.has(c.hsn_code) ? now.get(c.hsn_code) : null, next, waiting,
        history: mine.filter((r) => r.status === 'active'), packs: used };
    }),
    rates: list.map((r) => ({ rate: r, used: rates.some((x) => x.status !== 'rejected' && Number(x.gst_rate) === r) })),
  };
}

/** a date typed for a rate -> error message or '' */
function dateProblem(from, isNew) {
  const today = istToday();
  if (!from) return 'Pick the start date.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return 'A date like 2026-11-01.';
  if (isNew) return from < FIRST_DAY ? 'Not before 1 April 2026.' : '';
  return from < today ? 'Cannot start in the past. Invoices already made keep their rate.' : '';
}

/** a new HSN code with its first rate (no approval: nothing uses it yet) */
async function addCode(q, b, empId) {
  const code = String(b.hsn_code || '').trim();
  const desc = String(b.description || '').trim().slice(0, 80);
  const rate = Number(b.gst_rate);
  const from = String(b.effective_from || '').trim();
  const f = {};
  if (!HSN_RE.test(code)) f.hsn_code = '4, 6 or 8 digits.';
  else if (await exists(q, code)) f.hsn_code = `${code} is already in the list.`;
  if (!desc) f.description = 'Say what it covers.';
  if (!(await rateList(q)).includes(rate)) f.gst_rate = 'Pick a rate from the list.';
  const dp = dateProblem(from, true); if (dp) f.effective_from = dp;
  if (Object.keys(f).length) throw new TaxError('Fix the fields marked in red', 400, f);
  await q.query('INSERT INTO hsn_codes (hsn_code, description, created_by) VALUES (?, ?, ?)', [code, desc, empId]);
  await q.query('INSERT INTO hsn_rates (hsn_code, effective_from, gst_rate, created_by) VALUES (?, ?, ?, ?)', [code, from, rate, empId]);
  await audit(q, { empId, action: 'create', entity: 'hsn_code', entityId: code, after: { description: desc, gst_rate: rate, from } });
  return { message: `HSN code added: ${code}. Packs can now use it.` };
}

/**
 * change a code: its description at once; a new rate from a date waits for a second Admin (secondAdmin.ask, t 'hsnrate')
 * -> { message, waiting? }. checkMrp(q, code, rate, from) -> [problem lines] (prices above MRP at the new rate).
 */
async function changeCode(q, code, b, empId, { ask, checkMrp }) {
  const [[c]] = await q.query('SELECT hsn_code, description FROM hsn_codes WHERE hsn_code = ? FOR UPDATE', [code]);
  if (!c) throw new TaxError('No such HSN code', 404);
  const out = [];
  const f = {};
  const desc = b.description === undefined ? c.description : String(b.description || '').trim().slice(0, 80);
  if (!desc) f.description = 'Say what it covers.';
  let rate = null; let from = null;
  if (b.gst_rate !== undefined && b.gst_rate !== null && b.gst_rate !== '') {
    rate = Number(b.gst_rate);
    from = String(b.effective_from || '').trim();
    const today = await rateOn(q, code, from && /^\d{4}-\d{2}-\d{2}$/.test(from) ? from : istToday());
    if (!(await rateList(q)).includes(rate)) f.gst_rate = 'Pick a rate from the list.';
    const dp = dateProblem(from, false); if (dp) f.effective_from = dp;
    if (!f.gst_rate && !f.effective_from && today === rate) rate = null; // the same rate on that date: no change
  }
  if (Object.keys(f).length) throw new TaxError('Fix the fields marked in red', 400, f);
  if (desc !== c.description) {
    await q.query('UPDATE hsn_codes SET description = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE hsn_code = ?', [desc, empId, code]);
    await audit(q, { empId, action: 'update', entity: 'hsn_code', entityId: code, before: { description: c.description }, after: { description: desc } });
    out.push('Description saved.');
  }
  let waiting = null;
  if (rate !== null) {
    const bad = await checkMrp(q, code, rate, from);
    if (bad.length) throw new TaxError(`Above MRP at ${rate}%: ${bad.slice(0, 3).join('; ')}${bad.length > 3 ? ` and ${bad.length - 3} more` : ''}. Lower those prices first, or the MRP.`, 409);
    const [[w]] = await q.query("SELECT rate_id FROM hsn_rates WHERE hsn_code = ? AND status = 'pending'", [code]);
    if (w) throw new TaxError(`A rate change for ${code} already waits for a second Admin. It is decided first.`, 409);
    const r = await ask(q, { t: 'hsnrate', dk: `hsnrate:${code}`, summary: `HSN ${code}: GST ${rate}% from ${from} (packs using it follow from that date)`, payload: { hsn_code: code, gst_rate: rate, from } }, empId);
    await q.query("INSERT INTO hsn_rates (hsn_code, effective_from, gst_rate, status, approval_id, created_by) VALUES (?, ?, ?, 'pending', ?, ?)", [code, from, rate, r.approval_id, empId]);
    await audit(q, { empId, action: 'request', entity: 'hsn_rate', entityId: code, after: { gst_rate: rate, from, approval_id: r.approval_id } });
    waiting = r.message;
    out.push(`GST ${rate}% from ${from} waits for a second Admin. ${r.message}`);
  }
  return { message: out.join(' ') || 'Nothing changed.', waiting };
}

/** a signed rate change: the pending row becomes the rate from its date (a row already on that date is replaced) */
async function applyRate(q, p, empId) {
  const [[w]] = await q.query("SELECT rate_id FROM hsn_rates WHERE hsn_code = ? AND status = 'pending' AND effective_from = ? FOR UPDATE", [p.hsn_code, p.from]);
  if (!w) return;
  await q.query("DELETE FROM hsn_rates WHERE hsn_code = ? AND effective_from = ? AND status = 'active'", [p.hsn_code, p.from]);
  await q.query("UPDATE hsn_rates SET status = 'active' WHERE rate_id = ?", [w.rate_id]);
  await syncProductGst(q);
  await audit(q, { empId, action: 'approve', entity: 'hsn_rate', entityId: p.hsn_code, after: { gst_rate: p.gst_rate, from: p.from } });
}
async function closeRate(q, p) {
  await q.query("UPDATE hsn_rates SET status = 'rejected' WHERE hsn_code = ? AND effective_from = ? AND status = 'pending'", [p.hsn_code, p.from]);
}

async function addRate(q, raw, empId) {
  const r = Number(String(raw ?? '').trim());
  if (String(raw ?? '').trim() === '' || !Number.isFinite(r) || r < 0 || r > 40 || Math.round(r * 100) !== r * 100) throw new TaxError('A rate from 0 to 40, like 12 or 0.25.');
  if ((await rateList(q)).includes(r)) throw new TaxError(`${r}% is already in the list.`);
  await q.query('INSERT INTO gst_rate_list (gst_rate) VALUES (?)', [r]);
  await audit(q, { empId, action: 'create', entity: 'gst_rate', entityId: String(r), after: { gst_rate: r } });
  return { message: `${r}% can now be used by HSN codes.` };
}
async function removeRate(q, raw, empId) {
  const r = Number(raw);
  if (!(await rateList(q)).includes(r)) throw new TaxError('Not in the list', 404);
  const [[u]] = await q.query("SELECT hsn_code FROM hsn_rates WHERE gst_rate = ? AND status IN ('active', 'pending') LIMIT 1", [r]);
  if (u) throw new TaxError(`${r}% is used by an HSN code (${u.hsn_code}).`, 409);
  await q.query('DELETE FROM gst_rate_list WHERE gst_rate = ?', [r]);
  await audit(q, { empId, action: 'delete', entity: 'gst_rate', entityId: String(r), before: { gst_rate: r } });
  return { message: `${r}% removed.` };
}

/** a pack's HSN typed on its product -> '' or why not (v23 2.19) */
async function hsnProblem(q, hsn) {
  const h = String(hsn || '').trim();
  if (!HSN_RE.test(h)) return 'HSN: 4, 6 or 8 digits (e.g. 48182000).';
  if (!(await exists(q, h))) return 'Not in the HSN list. Add it in Masters > Tax and units > HSN and GST rates first.';
  return '';
}

module.exports = {
  TaxError, HSN_RE, FIRST_DAY, r2, rateList, ratesOn, rateOn, historyOf, exists, syncProductGst, hsnPage, addCode, changeCode,
  applyRate, closeRate, addRate, removeRate, hsnProblem,
};
