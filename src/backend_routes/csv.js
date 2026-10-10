// Minimal RFC 4180 CSV for the admin exports / the translators' sheet. Output starts with a UTF-8 BOM so Excel
// opens Tamil / Hindi correctly. A cell starting with = + - @ gets a leading apostrophe on export, so a
// spreadsheet never runs it as a formula; parse() strips that apostrophe again.
const FORMULA = /^[=+\-@\t\r]/;

function cell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (FORMULA.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function stringify(rows) {
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}

/** Rows of strings. Throws on an unterminated quoted field. */
function parse(text) {
  const s = String(text).replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (quoted) throw new Error('CSV: a quoted cell is not closed');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const unescape = (v) => (/^'[=+\-@\t\r]/.test(v) ? v.slice(1) : v);
  return rows.filter((r) => r.some((v) => v !== '')).map((r) => r.map(unescape));
}

module.exports = { stringify, parse };
