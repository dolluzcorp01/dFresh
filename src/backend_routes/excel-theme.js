// The look of every Excel file the admin hands out (products, leads, translations): one place, so they all match.
// Sheet layout:
//   rows 1-3  dFresh logo (top-left), report title, "Exported on <date> IST by <name> (<emp_id>)" and the active filters
//   row 4     header: ink fill, gold bold text, centred, wrapped, thin gold bottom border
//   row 5+    data: Arial 10, white / light beige bands, thin light borders, top-aligned, long text wrapped
// Frozen below the header (and the first columns on wide sheets), AutoFilter on the header, landscape print at one
// page wide with the header row repeated and "dFresh - page X of Y" in the footer.
// Types: column type 'text' is always stored as text ('@' format: IDs, phones, GST keep leading zeros and never turn
// into 9.88E+09), 'date' is a real Excel date shown DD-MM-YYYY HH:MM in India time, 'number' stays a number.
// Imports find the header row by its column names (findHeaderRow), so the 3 branding rows never get in the way.
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');

const LOGO = path.join(__dirname, '..', '..', 'assets', 'logo', 'web', 'dfresh-logo-on-light.png'); // 900 x 498
const LOGO_PX = { width: 101, height: 56 };
const HEADER_ROW = 4;
const C = { ink: 'FF121214', gold: 'FFE5BF24', band: 'FFF8F3E8', white: 'FFFFFFFF', line: 'FFE6DFCB', muted: 'FF6F6B62' };
const FONT = 'Arial';
const IST_MS = 5.5 * 60 * 60 * 1000;
const DATE_FMT = 'dd-mm-yyyy hh:mm';
const LONG_TEXT = 40; // characters: a text column never grows wider than this from its content (it wraps)
// A header must fit its longest word (Product_ID, Category_key: no spaces to wrap at) in bold, plus the AutoFilter
// arrow, so no header is ever cut or split mid-word.
const ARROW = 4;
const headerMin = (h) => Math.ceil(Math.max(...String(h).split(/\s+/).map((w) => w.length)) * 1.1 + ARROW);

/** "13 Oct 2026, 15:20 IST" */
function istLabel(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).map((x) => [x.type, x.value]));
  return `${p.day} ${p.month} ${p.year}, ${p.hour}:${p.minute} IST`;
}

/**
 * Excel has no time zones: a cell shows the date's UTC fields. Shifting by +5:30 makes it show India time, so a lead
 * received at 15:20 IST reads 15:20 whatever zone the server runs in.
 */
const toIstCell = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? new Date(d.getTime() + IST_MS) : null);

/** A workbook with the dFresh properties set (title, author "dFresh admin", company "Dolluz Corporation"). */
function newWorkbook(title) {
  const wb = new ExcelJS.Workbook();
  wb.title = title;
  wb.creator = 'dFresh admin';
  wb.lastModifiedBy = 'dFresh admin';
  wb.company = 'Dolluz Corporation';
  wb.created = new Date();
  wb.modified = wb.created;
  return wb;
}

let logoBuffer = null;
function logoId(wb) {
  if (!wb.dfreshLogoId && wb.dfreshLogoId !== 0) {
    if (!logoBuffer) logoBuffer = fs.readFileSync(LOGO);
    wb.dfreshLogoId = wb.addImage({ buffer: logoBuffer, extension: 'png' });
  }
  return wb.dfreshLogoId;
}

/** 1 -> A, 27 -> AA */
function colLetter(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

// Excel column width (characters) -> pixels, roughly: 7 px per character + 5 px padding (Arial 10 / Calibri 11).
const colPx = (w) => Math.round((w || 8.43) * 7 + 5);

/**
 * Rows 1-3: logo at A1, then the title, the "Exported on" line and the filters line in the first column that starts
 * right of the logo, so text never sits under the picture. Text there is not wrapped: it runs on over the empty cells.
 */
function brand(wb, ws, { title, exportedBy, filters }) {
  ws.getRow(1).height = 24;
  ws.getRow(2).height = 15;
  ws.getRow(3).height = 15;
  ws.addImage(logoId(wb), { tl: { col: 0.08, row: 0.12 }, ext: LOGO_PX, editAs: 'oneCell' });
  let col = 1;
  let left = 0;
  while (left < LOGO_PX.width + 12) { left += colPx(ws.getColumn(col).width); col += 1; }
  const put = (row, text, font) => {
    const c = ws.getCell(row, col);
    c.value = text;
    c.font = { name: FONT, ...font };
    c.alignment = { vertical: 'middle', wrapText: false };
  };
  put(1, title, { size: 15, bold: true, color: { argb: C.ink } });
  put(2, `Exported on ${istLabel()} by ${exportedBy}`, { size: 9, color: { argb: C.muted } });
  put(3, filters ? `Filters: ${filters}` : 'Filters: none (everything)', { size: 9, color: { argb: C.muted } });
}

/** Widths: the given one, else from the content (header and the longest values), wide text capped and wrapped. */
function autoWidth(col, values) {
  return Math.max(contentWidth(col, values), headerMin(col.header));
}

function contentWidth(col, values) {
  if (col.width) return col.width;
  const lens = values.map((v) => (v === null || v === undefined ? 0 : (v instanceof Date ? 16 : String(v).split('\n').reduce((m, l) => Math.max(m, l.length), 0))));
  const longest = Math.max(String(col.header).length * (col.header.length > 14 ? 0.6 : 1) + 2, ...lens.map((n) => n + 2));
  if (col.type === 'date') return 17;
  if (col.type === 'number') return Math.max(9, Math.min(longest, 14));
  return Math.max(10, Math.min(longest, col.wrap === false ? 60 : LONG_TEXT + 6));
}

function cellFor(col, v) {
  if (v === null || v === undefined || v === '') return null;
  if (col.type === 'date') return toIstCell(v instanceof Date ? v : new Date(v));
  if (col.type === 'number') { const n = Number(v); return Number.isFinite(n) ? n : String(v); }
  return String(v);
}

/**
 * A branded table sheet. columns: [{ header, type: 'text' | 'number' | 'date' (default text), width?, wrap? }],
 * rows: arrays in column order. freezeCols: columns kept in view when scrolling sideways (default: 1 on sheets with
 * more than 8 columns). Returns the worksheet.
 */
function tableSheet(wb, name, { title, exportedBy, filters, columns, rows, freezeCols }) {
  const xSplit = freezeCols ?? (columns.length > 8 ? 1 : 0);
  const ws = wb.addWorksheet(name, {
    views: [{ state: 'frozen', xSplit, ySplit: HEADER_ROW, topLeftCell: `${colLetter(xSplit + 1)}${HEADER_ROW + 1}`, showGridLines: false }],
    pageSetup: {
      orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      printTitlesRow: `${HEADER_ROW}:${HEADER_ROW}`,
      margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
    headerFooter: { oddFooter: '&C&"Arial"&9dFresh - page &P of &N', evenFooter: '&C&"Arial"&9dFresh - page &P of &N' },
  });
  columns.forEach((col, i) => {
    const w = autoWidth(col, rows.map((r) => r[i]));
    ws.getColumn(i + 1).width = w;
    // Text columns always wrap: character counts underestimate wide scripts (Tamil, Hindi), and short text is unaffected.
    col.wraps = col.wrap ?? (col.type !== 'date' && col.type !== 'number');
  });
  brand(wb, ws, { title, exportedBy, filters });

  const head = ws.getRow(HEADER_ROW);
  const twoLines = columns.some((col, i) => Math.ceil(String(col.header).length * 1.1 + ARROW) > ws.getColumn(i + 1).width);
  head.height = twoLines ? 30 : 21; // 28 px; a header wider than its column gets a second line
  columns.forEach((col, i) => {
    const c = head.getCell(i + 1);
    c.value = col.header;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: C.gold } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.ink } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = { bottom: { style: 'thin', color: { argb: C.gold } } };
  });

  const thin = { style: 'thin', color: { argb: C.line } };
  rows.forEach((values, r) => {
    const row = ws.getRow(HEADER_ROW + 1 + r);
    const band = r % 2 === 0 ? C.white : C.band;
    columns.forEach((col, i) => {
      const c = row.getCell(i + 1);
      c.value = cellFor(col, values[i]);
      c.font = { name: FONT, size: 10, color: { argb: C.ink } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: band } };
      c.border = { top: thin, left: thin, bottom: thin, right: thin };
      c.alignment = { vertical: 'top', wrapText: Boolean(col.wraps), horizontal: col.type === 'number' ? 'right' : 'left' };
      if (col.type === 'date') c.numFmt = DATE_FMT;
      else if (col.type !== 'number') c.numFmt = '@';
    });
  });
  // Text format on the empty cells below as well, so a value typed in later (a phone, a GST) stays text.
  columns.forEach((col, i) => { if (col.type !== 'date' && col.type !== 'number') ws.getColumn(i + 1).numFmt = '@'; });

  ws.autoFilter = { from: { row: HEADER_ROW, column: 1 }, to: { row: HEADER_ROW + Math.max(rows.length, 1), column: columns.length } };
  return ws;
}

/** A branded notes sheet (Read_Me): branding rows, then lines of text in column B. lines: [text, bold?] */
function notesSheet(wb, name, { title, exportedBy, filters, lines }) {
  const ws = wb.addWorksheet(name, {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    headerFooter: { oddFooter: '&C&"Arial"&9dFresh - page &P of &N' },
  });
  ws.getColumn(1).width = 3;
  ws.getColumn(2).width = 14;
  ws.getColumn(3).width = 140;
  brand(wb, ws, { title, exportedBy, filters });
  lines.forEach(([text, bold], i) => {
    const c = ws.getCell(HEADER_ROW + 1 + i, 2);
    c.value = text;
    c.font = { name: FONT, size: bold ? 12 : 10, bold: Boolean(bold), color: { argb: C.ink } };
  });
  return ws;
}

/**
 * The header row of a sheet, found by a column name it must contain (e.g. "Product_ID"): the branded layout (row 4)
 * and the old plain layout (row 1) both work. Looks at the first 20 rows; returns the row number or 0.
 */
function findHeaderRow(ws, mustHave, cellText) {
  const last = Math.min(ws.rowCount, 20);
  for (let n = 1; n <= last; n += 1) {
    let hit = false;
    ws.getRow(n).eachCell((c) => { if (String(cellText(c.value) ?? '').trim() === mustHave) hit = true; });
    if (hit) return n;
  }
  return 0;
}

/** Sends a workbook as a download. */
async function send(res, wb, fileName) {
  const buf = await wb.xlsx.writeBuffer();
  res.set({
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
  });
  res.send(Buffer.from(buf));
  return buf.byteLength;
}

module.exports = { newWorkbook, tableSheet, notesSheet, findHeaderRow, send, istLabel, toIstCell, HEADER_ROW };
