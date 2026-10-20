// Document numbers from number_series (docs/COMMERCE-SPEC.md 6.1), concurrency safe and gap free:
// next() bumps the series row inside the caller's transaction (the row stays locked until COMMIT, so a second
// transaction waits for it) and a ROLLBACK undoes the bump, so a number is never skipped or handed out twice.
// - Orders DFO-26nnnn and returns per calendar year; invoices DFI/26-27/nnnn and credit notes per financial year
//   (April to March, India time).

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

module.exports = { istParts, fyOf, next, pad };
