// Branded Excel exports (excel-theme.js) and the Products import reading both layouts, against the LOCAL dev
// database (read-only: only dry-run diffs, nothing is written).
// Run: npm run test:api   (needs a seeded DB: npm run db:reset)
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run DB tests with NODE_ENV=production');
  process.exit(1);
}

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { getDBConnection } = require('../../config/db');
const theme = require('../../src/backend_routes/excel-theme');
const excel = require('../../src/backend_routes/product-excel');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
after(() => db.end());

const reload = async (wb) => {
  const back = new ExcelJS.Workbook();
  await back.xlsx.load(await wb.xlsx.writeBuffer());
  return back;
};

test('branded sheet: logo + title rows, ink / gold header in row 4, frozen, filtered, print setup, workbook properties', async () => {
  const wb = await reload(await excel.buildWorkbook(db, { who: 'Test User (ZZ001)' }));
  assert.equal(wb.title, 'dFresh Products');
  assert.equal(wb.creator, 'dFresh admin');
  assert.equal(wb.company, 'Dolluz Corporation');
  assert.deepEqual(wb.worksheets.map((s) => s.name), ['Read_Me', 'Products', 'Categories', 'UI_Text']);
  const ws = wb.getWorksheet('Products');
  assert.equal(ws.getImages().length, 1, 'logo on the sheet');
  assert.ok(ws.getImages()[0].range.tl.nativeRow < 3, 'logo starts in rows 1-3');
  const texts = [1, 2, 3].map((r) => ws.getRow(r).values.filter(Boolean).join(' '));
  assert.match(texts[0], /dFresh Products/);
  assert.match(texts[1], /^Exported on \d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} IST by Test User \(ZZ001\)$/);
  const head = ws.getRow(theme.HEADER_ROW).getCell(4);
  assert.equal(head.value, 'Product_ID');
  assert.equal(head.fill.fgColor.argb, 'FF121214');
  assert.equal(head.font.color.argb, 'FFE5BF24');
  assert.equal(head.font.bold, true);
  assert.equal(head.border.bottom.color.argb, 'FFE5BF24');
  const view = ws.views[0];
  assert.equal(view.state, 'frozen');
  assert.equal(view.ySplit, theme.HEADER_ROW);
  assert.equal(view.xSplit, 4);
  assert.ok(ws.autoFilter, 'AutoFilter on the header');
  assert.equal(ws.pageSetup.orientation, 'landscape');
  assert.equal(ws.pageSetup.fitToWidth, 1);
  assert.equal(ws.pageSetup.printTitlesRow, '4:4');
  assert.match(ws.headerFooter.oddFooter, /dFresh - page &P of &N/);
  const band = [ws.getRow(5).getCell(4).fill.fgColor.argb, ws.getRow(6).getCell(4).fill.fgColor.argb];
  assert.deepEqual(band, ['FFFFFFFF', 'FFF8F3E8'], 'white / beige bands');
  assert.equal(ws.getRow(5).getCell(4).font.name, 'Arial');

  // the internal column stands out: red header, white text, light red cells
  const specCol = ws.getRow(theme.HEADER_ROW).values.indexOf('Spec status - INTERNAL, do not publish');
  assert.ok(specCol > 0, 'Spec status header');
  const spec = ws.getRow(theme.HEADER_ROW).getCell(specCol);
  assert.equal(spec.fill.fgColor.argb, 'FFB42318');
  assert.equal(spec.font.color.argb, 'FFFFFFFF');
  assert.deepEqual([5, 6].map((r) => ws.getRow(r).getCell(specCol).fill.fgColor.argb), ['FFFEF3F2', 'FFFCE4E1']);
});

test('print options: pages wide and columns repeated on every page (leads: 2 pages wide, A:B repeated)', async () => {
  const wb = theme.newWorkbook('t');
  theme.tableSheet(wb, 'T', {
    title: 't', exportedBy: 'x', filters: null, freezeCols: 2, print: { pagesWide: 2, repeatCols: 2 },
    columns: [{ header: 'Lead ref' }, { header: 'Name' }, { header: 'Town' }], rows: [['DFL-1', 'A', 'B']],
  });
  const ws = (await reload(wb)).getWorksheet('T');
  assert.equal(ws.pageSetup.fitToWidth, 2);
  assert.equal(ws.pageSetup.paperSize, 9, 'A4');
  assert.equal(ws.pageSetup.orientation, 'landscape');
  assert.equal(ws.pageSetup.printTitlesRow, '4:4');
  assert.equal(ws.pageSetup.printTitlesColumn, 'A:B');
  assert.equal(ws.views[0].xSplit, 2);
});

test('types: IDs, phones and GST stay text (leading zeros), dates are real dates in India time, counts are numbers', async () => {
  const wb = theme.newWorkbook('t');
  const at = new Date('2026-10-13T09:50:00Z'); // 15:20 IST
  theme.tableSheet(wb, 'T', {
    title: 't', exportedBy: 'x', filters: null,
    columns: [{ header: 'Phone' }, { header: 'GST no.' }, { header: 'Received', type: 'date' }, { header: 'Count', type: 'number' }],
    rows: [['0987654321', '07AAAAA0000A1Z5', at, '3']],
  });
  const ws = (await reload(wb)).getWorksheet('T');
  const row = ws.getRow(theme.HEADER_ROW + 1);
  assert.equal(row.getCell(1).value, '0987654321');
  assert.equal(row.getCell(1).numFmt, '@');
  assert.equal(row.getCell(2).value, '07AAAAA0000A1Z5');
  const d = row.getCell(3).value;
  assert.ok(d instanceof Date);
  assert.equal(`${d.getUTCHours()}:${d.getUTCMinutes()}`, '15:20', 'the cell shows 15:20 (IST)');
  assert.equal(row.getCell(3).numFmt, 'dd-mm-yyyy hh:mm');
  assert.equal(row.getCell(4).value, 3);
});

test('Products import reads the branded export (header in row 4) and the old plain layout (header in row 1): 0 changes', async () => {
  const branded = await (await excel.buildWorkbook(db, { who: 'Test' })).xlsx.writeBuffer();
  const a = await excel.diffWorkbook(db, Buffer.from(branded));
  assert.equal(a.ok, true, a.errors.join('; '));
  assert.deepEqual([a.summary.added, a.summary.changed, a.summary.removed, a.summary.categories], [0, 0, 0, 0]);

  // the same data in the old layout: every sheet's header moved up to row 1, no logo / title rows
  const src = new ExcelJS.Workbook();
  await src.xlsx.load(branded);
  const plain = new ExcelJS.Workbook();
  for (const name of ['Products', 'Categories']) {
    const from = src.getWorksheet(name);
    const to = plain.addWorksheet(name);
    from.eachRow((row, n) => { if (n >= theme.HEADER_ROW) to.addRow(row.values.slice(1)); });
  }
  assert.equal(plain.getWorksheet('Products').getRow(1).getCell(4).value, 'Product_ID');
  const b = await excel.diffWorkbook(db, Buffer.from(await plain.xlsx.writeBuffer()));
  assert.equal(b.ok, true, b.errors.join('; '));
  assert.deepEqual([b.summary.added, b.summary.changed, b.summary.removed, b.summary.categories], [0, 0, 0, 0]);
});
