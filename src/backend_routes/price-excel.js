// Price list Excel, one file per list (phase 15, v23 2.26: Masters > Prices > Price lists > a list > Export / Import).
// Columns as v23: list, sku, product, price, from, typed, gst_rate, price_without_gst, price_with_gst. Only price and
// from are read back; the rest are for reading. Import = check the file first (every error; nothing saved with one),
// Apply only for the exact file (fingerprint) that passed with 0 errors, checked again inside the transaction.
// Each row goes through the one price guard (pricing.checkPrices): above MRP, below the lowest allowed price and the
// top slab are refused; below cost plus the margin floor is refused here too ("change it alone in the price panel so it
// goes for approval"). A row with both price and from empty is skipped. Each saved price is in the audit log.
const ExcelJS = require('exceljs');
const theme = require('./excel-theme');
const { sheetRows } = require('./product-excel');
const pricing = require('./pricing');
const tax = require('./tax');
const { InputError } = require('./admin-entities');

const SHEET = 'Prices';
const COLS = ['list', 'sku', 'product', 'price', 'from', 'typed', 'gst_rate', 'price_without_gst', 'price_with_gst'];
const blank = (v) => v === null || v === undefined || String(v).trim() === '';
const txt = (v) => (blank(v) ? '' : String(v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 100) / 100 : v).trim());

/** today's price of every pack on one list (the default list's price where this list has none, as orders do) */
async function listRows(q, list) {
  const today = pricing.istToday();
  const [skus, rows, rates, def] = [await pricing.skuRows(q), await pricing.rowsOn(q, today), await tax.ratesOn(q, today), await pricing.defaultKey(q)];
  return skus.filter((s) => s.product_status !== 'draft').map((s) => {
    const per = rows.get(s.sku_code) || {};
    const r = per[list.key] && per[list.key].price !== null ? per[list.key] : null;
    const rate = rates.has(s.hsn_code) ? rates.get(s.hsn_code) : null;
    const typed = r && rate !== null ? pricing.fromEx(pricing.toEx(r.price, r.basis, rate), list.typed, rate) : null;
    const ex = typed === null ? null : pricing.round2(pricing.toEx(typed, list.typed, rate));
    return { s, typed, from: r ? r.from : null, rate, ex, inc: ex === null ? null : pricing.round2(ex * (1 + rate / 100)), fallback: !r && list.key !== def };
  });
}

async function buildWorkbook(q, list, { who = 'dFresh admin' } = {}) {
  const today = pricing.istToday();
  const rows = await listRows(q, list);
  const wb = theme.newWorkbook('dFresh Prices');
  const meta = { exportedBy: who, filters: `list ${list.name}` };
  theme.notesSheet(wb, 'Read_Me', {
    ...meta,
    title: `dFresh price list: ${list.name}`,
    lines: [
      [`${list.name} on ${today}: prices are typed ${list.typed === 'inc' ? 'WITH GST' : 'WITHOUT GST'}`, true],
      [''],
      ['How to use', true],
      ['• Change price and from, keep the rest. One file per list: the list column must stay this list.'],
      ['• from: the date the new price starts (today or later). Quotes and orders already made keep their price.'],
      ['• Leave price and from empty on a row to leave that pack as it is.'],
      ['• Checked first in the admin: above MRP, below the lowest allowed price, below cost plus the margin floor and the top slab are errors; nothing is saved while one is left.'],
      ['• Keep the column names in the dark header row as they are: the import finds its columns by these names.'],
    ],
  });
  theme.tableSheet(wb, SHEET, {
    ...meta,
    title: `dFresh ${list.name} prices`,
    freezeCols: 2,
    columns: [
      { header: 'list', width: 14 }, { header: 'sku', width: 16 }, { header: 'product', width: 34 }, { header: 'price', type: 'number', width: 11 },
      { header: 'from', width: 12 }, { header: 'typed', width: 12 }, { header: 'gst_rate', type: 'number', width: 9 },
      { header: 'price_without_gst', type: 'number', width: 16 }, { header: 'price_with_gst', type: 'number', width: 15 },
    ],
    rows: rows.map((r) => [list.key, r.s.sku_code, `${r.s.name} ${r.s.size_label || ''}`.trim(), r.typed, r.from, list.typed === 'inc' ? 'with GST' : 'without GST', r.rate, r.ex, r.inc]),
  });
  return wb;
}

/** -> { ok, summary, errors, changes, plan } (nothing is written) */
async function diffWorkbook(q, buffer, list) {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buffer); } catch { throw new InputError('This is not an Excel (.xlsx) file this tool can read'); }
  const ws = wb.getWorksheet(SHEET);
  if (!ws) throw new InputError(`The workbook has no "${SHEET}" sheet (start from Export)`);
  if (ws.rowCount > 5001) throw new InputError(`At most 5,000 rows in one import (this sheet has ${ws.rowCount - 1})`);
  const { header, rows } = sheetRows(ws, 'sku');
  if (!rows.length) throw new InputError('The file is empty.');
  const miss = ['list', 'sku', 'price', 'from'].filter((c) => !header.includes(c));
  if (miss.length) throw new InputError(`Missing columns: ${miss.join(', ')}. Start from Export.`);
  const today = pricing.istToday();
  const current = new Map((await listRows(q, list)).map((r) => [r.s.sku_code, r]));
  const errors = [];
  const changes = [];
  const seen = new Set();
  for (const r of rows) {
    const code = txt(r.sku).toUpperCase();
    const at = `Row ${r._row} (${code || 'no SKU'}): `;
    if (blank(r.price) && blank(r.from)) continue;
    if (txt(r.list) !== list.key) { errors.push(`${at}list is ${txt(r.list) || 'empty'}, but this is the ${list.key} list. One file per list.`); continue; }
    if (!code) { errors.push(`${at}SKU is empty.`); continue; }
    if (seen.has(code)) { errors.push(`${at}SKU appears twice in the file.`); continue; }
    seen.add(code);
    const cur = current.get(code);
    if (!cur) { errors.push(`${at}no pack with this SKU.`); continue; }
    const p = pricing.parsePrice(txt(r.price));
    if (p.error || p.value === null || p.value <= 0) { errors.push(`${at}price must be more than 0, with at most 2 decimals.`); continue; }
    const from = txt(r.from);
    if (!pricing.isDate(from)) { errors.push(`${at}from must be a date like ${today}.`); continue; }
    if (from < today) { errors.push(`${at}from ${from} is in the past. Quotes and orders already made keep their price.`); continue; }
    if (cur.typed === p.value && cur.from === from) continue; // unchanged
    const [res] = (await pricing.checkPrices(q, [{ sku_code: code, list_key: list.key, price: p.value }], from)).values();
    const [[w]] = await q.query("SELECT request_no FROM price_requests WHERE sku_code = ? AND list_key = ? AND status = 'pending'", [code, list.key]);
    if (res.hard) { errors.push(`${at}${res.hard.charAt(0).toLowerCase()}${res.hard.slice(1)}`); continue; }
    if (res.soft) { errors.push(`${at}${res.soft.replace(/\.$/, '').charAt(0).toLowerCase()}${res.soft.replace(/\.$/, '').slice(1)}. Change it alone in the price panel so it goes for approval.`); continue; }
    if (w) { errors.push(`${at}a change already waits for approval (${w.request_no}).`); continue; }
    changes.push({ sku_code: code, list_key: list.key, price: p.value, from, old: cur.typed });
  }
  const ok = errors.length === 0;
  return { ok, summary: ok ? `No errors in ${rows.length} rows: ${changes.length} price${changes.length === 1 ? '' : 's'} will change.` : `${errors.length} error${errors.length === 1 ? '' : 's'}. Nothing was saved.`,
    errors, changes, plan: ok ? changes : [] };
}

/** apply a checked plan (grouped by start date) -> number of prices saved */
async function applyPlan(q, plan, { empId }) {
  let n = 0;
  const byDate = new Map();
  for (const c of plan) { if (!byDate.has(c.from)) byDate.set(c.from, []); byDate.get(c.from).push(c); }
  for (const [from, list] of byDate) {
    const r = await pricing.setPrices(q, list.map((c) => ({ sku_code: c.sku_code, list_key: c.list_key, price: c.price })), { effective: from, source: 'import', empId });
    n += r.changed.length;
  }
  return n;
}

module.exports = { buildWorkbook, diffWorkbook, applyPlan, listRows, SHEET, COLS };
