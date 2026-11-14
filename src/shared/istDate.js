// India dates in ONE place (Asia/Kolkata, UTC+05:30, no daylight saving). Shared by the API and the admin (CommonJS:
// the server requires it, the admin imports it). Never the process or browser time zone, never local getters.
// Two kinds of value (docs/02_ARCHITECTURE.md "Times", config/db.js):
// - an instant (DATETIME, "now"): stored in UTC; its India calendar day is istDate(v);
// - a calendar day (DATE): mysql2 (timezone 'Z') reads it as midnight UTC of that day, a string 'YYYY-MM-DD' stays as
//   it is; ymd(v) gives the day. A DATE is never shifted by +05:30 (it has no time).
// SQL: the session is UTC, so CURDATE() is the UTC day; use IST_TODAY_SQL and istDateSql(col) instead.
const IST_OFFSET_MS = 330 * 60000;
const DAY_MS = 864e5;
const YMD = /^\d{4}-\d{2}-\d{2}$/;
const YM = /^\d{4}-\d{2}$/;

/**
 * an instant as milliseconds: a Date (mysql2 reads a DATETIME as one), a number, an ISO string with its zone. A string
 * with a time but no zone ('2026-11-13 00:30') is India wall time: our SQL makes those with DATE_FORMAT(CONVERT_TZ(...)).
 */
function msOf(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const s = String(v).trim();
  if (YMD.test(s)) return Date.parse(`${s}T00:00:00Z`);
  const iso = s.replace(' ', 'T');
  return Date.parse(/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso) ? iso : `${iso}+05:30`);
}

/** the India calendar day of an instant -> 'YYYY-MM-DD' (a plain 'YYYY-MM-DD' is already a day: returned as it is) */
function istDate(v = Date.now()) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'string' && YMD.test(v.trim())) return v.trim();
  const ms = msOf(v);
  return Number.isNaN(ms) ? null : new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** today in India -> 'YYYY-MM-DD' (now: for tests) */
const istToday = (now = Date.now()) => istDate(now);

/** a DATE value (a Date read from a DATE column, or a 'YYYY-MM-DD...' string) -> 'YYYY-MM-DD'; null when empty */
function ymd(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).trim();
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null;
}

/** 'YYYY-MM-DD' plus n days (n may be negative) */
const addDays = (d, n) => new Date(Date.parse(`${ymd(d)}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

/** the last day of a month ('YYYY-MM', or any day in it) -> 'YYYY-MM-DD' */
function lastDayOf(m) {
  const s = YM.test(String(m)) ? String(m) : String(ymd(m) || '').slice(0, 7);
  return new Date(Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)), 0)).toISOString().slice(0, 10);
}

/** is the India day of an instant (or a DATE value) within from..to (each 'YYYY-MM-DD', either may be empty)? */
function inIstDateRange(v, from, to) {
  const d = istDate(v);
  if (!d) return false;
  return (!from || d >= from) && (!to || d <= to);
}

/** a DATE value for people: '13 Nov 2026' (no time; the day as it is, never shifted) */
function fmtYmd(v) {
  const d = ymd(v);
  if (!d) return '';
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

/** an instant for people, in India time: '13 Nov 2026, 12:30 am' (the admin's fmtDate) */
function fmtIstDateTime(v) {
  if (v === null || v === undefined || v === '') return '';
  const ms = msOf(v);
  return Number.isNaN(ms) ? '' : new Date(ms).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}

// SQL: the India day of now and of a UTC DATETIME column
const IST_TODAY_SQL = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))";
const istDateSql = (col) => `DATE(CONVERT_TZ(${col}, '+00:00', '+05:30'))`;

module.exports = { IST_OFFSET_MS, istDate, istToday, ymd, addDays, lastDayOf, inIstDateRange, fmtYmd, fmtIstDateTime, IST_TODAY_SQL, istDateSql };
