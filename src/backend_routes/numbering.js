// Document numbers from number_series (docs/COMMERCE-SPEC.md 6.1), concurrency safe and gap free:
// next() bumps the series row inside the caller's transaction (the row stays locked until COMMIT, so a second
// transaction waits for it) and a ROLLBACK undoes the bump, so a number is never skipped or handed out twice.
// - Orders DFO-26nnnn and returns per calendar year; invoices DFI/26-27/nnnn and credit notes per financial year
//   (April to March, India time).
// - Per-godown documents (invoices, credit notes): a godown with in_number = 1 puts its code in the number and has its
//   own counter (DFI/C/26-27/0001, series DFI-C-2026-27); Kanchipuram (K, in_number 0) keeps DFI/26-27/nnnn.

/** India date parts of a moment -> { y, m (1-12), d, ymd } */
function istParts(at = new Date()) {
  const s = new Date(new Date(at).getTime() + 5.5 * 3600e3).toISOString();
  return { y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)), ymd: s.slice(0, 10) };
}

/** financial year of a moment -> { fy: '2026-27', short: '26-27' } */
function fyOf(at = new Date()) {
  const { y, m } = istParts(at);
  const start = m >= 4 ? y : y - 1;
  const end = String((start + 1) % 100).padStart(2, '0');
  return { fy: `${start}-${end}`, short: `${String(start % 100).padStart(2, '0')}-${end}` };
}

/** the next number of a series (first = start) -> number. q MUST be inside a transaction. */
async function next(q, seriesKey, start = 1) {
  await q.query(
    'INSERT INTO number_series (series_key, last_no) VALUES (?, LAST_INSERT_ID(?)) ON DUPLICATE KEY UPDATE last_no = LAST_INSERT_ID(last_no + 1)',
    [seriesKey, Math.max(1, Number(start) || 1)]
  );
  const [[r]] = await q.query('SELECT LAST_INSERT_ID() AS n');
  return Number(r.n);
}

const pad = (n, w = 4) => String(n).padStart(w, '0');

/** the godown part of a per-godown number: { seg: '' | 'C/', key: '' | 'C-' } */
async function godownSegment(q, godownId) {
  const [[g]] = await q.query('SELECT code, in_number FROM locations WHERE location_id = ?', [Number(godownId)]);
  if (!g || !Number(g.in_number)) return { seg: '', key: '' };
  return { seg: `${g.code}/`, key: `${g.code}-` };
}

// ----------------------------------------------------------------------------------------- document series (phase 13)
// One row per document in document_series (the Numbering page). The counter of a run is number_series[key], where
// key and number are built from the same parts, so two different numbers never share a counter and one counter never
// gives two different numbers:
//   slash  key PREFIX[-CODE][-2026-27]   number PREFIX/[CODE/][26-27/]0001  (CODE: per-godown series, godown in_number)
//   year   key PREFIX-26                 number PREFIX-260001               (calendar year, India time)
//   plain  key PREFIX                    number PREFIX-0001                 (never restarts)
// The five running series (built) give exactly the keys and numbers of invoices.js, commerce.js, returns.js and
// customers.js. A number already used is never issued again: counters only go up (setNext refuses lower), a prefix
// change opens a new run under the new prefix, and switching "per godown" off and on again carries on each run.
const SERIES_COLS = 'doc_key, label, prefix, fmt, per_godown, fy_reset, digits, max_len, gst, built, live, section_no, start_no, sort_order, updated_by, updated_at';
const SERIES_SETTINGS = { invoice: 'invoice_prefix', credit: 'credit_note_prefix', order: 'order_prefix', return: 'return_prefix', customer: 'customer_prefix' };

function typedSeries(r) {
  return { ...r, per_godown: Number(r.per_godown) === 1, fy_reset: Number(r.fy_reset) === 1, digits: Number(r.digits), max_len: Number(r.max_len), gst: Number(r.gst) === 1,
    built: Number(r.built) === 1, live: Number(r.live) === 1, section_no: r.section_no === null ? null : Number(r.section_no), start_no: Number(r.start_no) };
}
/** every document series, in page order */
async function seriesList(q) {
  const [rows] = await q.query(`SELECT ${SERIES_COLS} FROM document_series ORDER BY sort_order, doc_key`);
  return rows.map(typedSeries);
}
/** one series (FOR UPDATE when lock) -> row | null */
async function seriesOf(q, docKey, lock = false) {
  const [[r]] = await q.query(`SELECT ${SERIES_COLS} FROM document_series WHERE doc_key = ?${lock ? ' FOR UPDATE' : ''}`, [String(docKey)]);
  return r ? typedSeries(r) : null;
}
/** the old Commerce settings names of the running series' prefixes, for commerce-settings.js read() */
async function settingsView(q) {
  const out = {};
  for (const s of await seriesList(q)) {
    if (SERIES_SETTINGS[s.doc_key]) out[SERIES_SETTINGS[s.doc_key]] = s.prefix;
    if (s.doc_key === 'invoice') out.invoice_start_no = s.start_no;
  }
  return out;
}

/** a godown id or { code, in_number } -> { code, coded } (coded: its code goes into per-godown numbers) */
async function godownOf(q, godown) {
  if (godown && typeof godown === 'object') return { code: String(godown.code || ''), coded: Boolean(Number(godown.in_number)) };
  if (!godown) return { code: '', coded: false };
  const [[g]] = await q.query('SELECT code, in_number FROM locations WHERE location_id = ?', [Number(godown)]);
  return g ? { code: g.code, coded: Number(g.in_number) === 1 } : { code: '', coded: false };
}

/** the counter key, the number for counter value n, and the first number of a new run -> { key, no(n), start } */
function compose(s, g, at = new Date(), prefix = s.prefix) {
  const w = (n) => pad(n, s.digits);
  if (s.fmt === 'year') {
    const yy = String(istParts(at).y % 100).padStart(2, '0');
    return { key: `${prefix}-${yy}`, no: (n) => `${prefix}-${yy}${w(n)}`, start: 1 };
  }
  if (s.fmt === 'plain') return { key: prefix, no: (n) => `${prefix}-${w(n)}`, start: 1 };
  const code = s.per_godown && g.coded ? g.code : '';
  const fy = s.fy_reset ? fyOf(at) : null;
  return {
    key: [prefix, code, fy && fy.fy].filter(Boolean).join('-'),
    no: (n) => [prefix, code, fy && fy.short, w(n)].filter(Boolean).join('/'),
    start: code ? 1 : Math.max(1, s.start_no || 1),
  };
}

/** the last number used in a run (0 = none yet) and the next one, read only -> { key, last, next, no } */
async function peek(q, s, g, at = new Date()) {
  const c = compose(s, g, at);
  const [[r]] = await q.query('SELECT last_no FROM number_series WHERE series_key = ?', [c.key]);
  const last = r ? Number(r.last_no) : 0;
  const nx = r ? last + 1 : c.start;
  return { key: c.key, last, next: nx, no: c.no(nx) };
}

/**
 * the next number of a document for a godown, read only (nothing is used up): sampleFor(q, 'invoice', 2) ->
 * 'DFI/C/26-27/0097'; godown = a location_id or { code, in_number } (a godown not saved yet: { code: 'V', in_number: 1 })
 */
async function sampleFor(q, docKey, godown = null, at = new Date()) {
  const s = await seriesOf(q, docKey);
  if (!s) throw new Error(`No document series ${docKey}`);
  return (await peek(q, s, await godownOf(q, godown), at)).no;
}

/** issue the next number of a document (q inside a transaction; the series row stays locked until COMMIT) -> number */
async function issue(q, docKey, godown = null, at = new Date()) {
  const s = await seriesOf(q, docKey, true);
  if (!s) throw new Error(`No document series ${docKey}`);
  const c = compose(s, await godownOf(q, godown), at);
  return c.no(await next(q, c.key, c.start));
}

/** the longest number a series can give with this prefix for these godowns (its highest counter value) -> text */
function longestOf(s, godowns, prefix = s.prefix, at = new Date()) {
  const top = 10 ** s.digits - 1;
  const list = s.fmt === 'slash' && s.per_godown ? godowns.map((g) => ({ code: g.code, coded: Boolean(Number(g.in_number)) })) : [{ code: '', coded: false }];
  return list.map((g) => compose(s, g, at, prefix).no(top)).reduce((a, x) => (x.length > a.length ? x : a), '');
}
/** '' when a number fits, else the rule it breaks (GST documents: 16 characters; the rest: the width they are stored in) */
function tooLong(s, no) {
  if (no.length <= s.max_len) return '';
  return s.gst ? `GST allows ${s.max_len}` : `A ${s.label.toLowerCase()} number holds at most ${s.max_len}`;
}

/**
 * can a godown use this code? Every per-godown series must still fit with it (DFI/VR/26-27/9999 is 17 characters:
 * refused). -> '' when it fits, else the reason, e.g. 'DFI/VR/26-27/9999 (17 characters). GST allows 16. Use a shorter code.'
 */
async function godownCodeCheck(q, code) {
  const g = { code: String(code || '').trim().toUpperCase(), in_number: 1 };
  for (const s of await seriesList(q)) {
    if (s.fmt !== 'slash' || !s.per_godown) continue;
    const no = longestOf(s, [g]);
    const why = tooLong(s, no);
    if (why) return `${no} (${no.length} characters). ${why}. Use a shorter code.`;
  }
  return '';
}

module.exports = {
  istParts, fyOf, next, pad, godownSegment,
  seriesList, seriesOf, settingsView, godownOf, compose, peek, sampleFor, issue, longestOf, tooLong, godownCodeCheck,
};
