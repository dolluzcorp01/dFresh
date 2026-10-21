// Commerce reports (docs/COMMERCE-SPEC.md 10; phase 9). Every report answers in one shape so the screen, the Excel
// export and the print use the same numbers: { tables: [{ key, title, columns: [{ key, label, type }], rows, totals }],
// chart, notes, checks }. Column types: text | num | money | pct | date. Dates are India dates (from / to inclusive).
// - Sales: invoices issued in the period minus credit notes issued in the period (returns and cancellations), so a
//   month's total = its invoices - its credit notes. Grouped by day / month / SKU / category / customer / customer type /
//   town / area / sales owner, with the previous period of the same length for comparison.
// - GST: GSTR-1 style registers (B2B invoice-wise, B2C large and small, credit notes, HSN) and output tax by rate and
//   type; the Excel follows the GST offline tool's column order (b2b, b2cl, b2cs, cdnr, cdnur, hsn).
// - Margin: goods value (taxable, after every discount, less returns) against quantity x the SKU's average cost.
// - Stock, receivables, delivery, returns, promotions, the business view and the accounting journal.
// Each report is gated in Admin_server.js by its own section; cost figures only for Reports + Products and prices.
const commerceSettings = require('./commerce-settings');
const stock = require('./stock');
const commerce = require('./commerce');
const wallet = require('./wallet');
const { stateName } = require('../shared/gstStates');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const IST_TODAY = "DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'))";
const istToday = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const istDate = (col) => `DATE(CONVERT_TZ(${col}, '+00:00', '+05:30'))`;
const IN = (col) => `${col} >= CONVERT_TZ(?, '+05:30', '+00:00') AND ${col} < CONVERT_TZ(DATE_ADD(?, INTERVAL 1 DAY), '+05:30', '+00:00')`;
const span = (p) => [`${p.from} 00:00:00`, p.to];
const SKU_NAME = 'COALESCE(t.name, pt.name, s.product_id)';
const SKU_JOIN = `JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'`;
const col = (key, label, type = 'text') => ({ key, label, type });
const sumRows = (rows, keys) => Object.fromEntries(keys.map((k) => [k, round2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0))]));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400e3);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400e3).toISOString().slice(0, 10);

/** the previous period of the same length, just before */
function previous(p) {
  const len = daysBetween(p.from, p.to) + 1;
  return { from: addDays(p.from, -len), to: addDays(p.from, -1) };
}

// ---------------------------------------------------------------- the sales facts (invoices - credit notes)
/**
 * line-level facts of the period: invoice lines (+1), the invoice's delivery charge and round-off (+1), return credit
 * note lines and round-off (-1), cancellation credit notes = the whole invoice (-1). Their sum per invoice / note is
 * exactly its total.
 */
async function salesFacts(q, p) {
  const S = span(p);
  const base = `o.order_id, o.order_no, o.customer_id, c.name AS customer, c.customer_no, c.type_key, ct.label AS type_label, c.owner_emp_id, o.ship_town AS town, a.label AS area`;
  const joins = `JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id JOIN customer_types ct ON ct.type_key = c.type_key
    LEFT JOIN delivery_areas a ON a.area_id = o.delivery_area_id`;
  const [inv] = await q.query(`SELECT i.invoice_id, i.invoice_no AS doc, ${istDate('i.issued_at')} AS day, 1 AS sign, ${base},
      it.sku_code, it.is_free, it.qty, it.taxable, it.cgst, it.sgst, it.igst, it.line_total AS total, it.gst_rate, it.hsn
    FROM invoices i ${joins} JOIN order_items it ON it.order_id = o.order_id WHERE ${IN('i.issued_at')}`, S);
  const [invX] = await q.query(`SELECT i.invoice_id, i.invoice_no AS doc, ${istDate('i.issued_at')} AS day, 1 AS sign, ${base},
      i.delivery_charge, i.delivery_gst, i.round_off, i.gst_type FROM invoices i ${joins} WHERE ${IN('i.issued_at')}`, S);
  const [cnl] = await q.query(`SELECT i.invoice_id, cn.credit_note_no AS doc, ${istDate('cn.issued_at')} AS day, -1 AS sign, ${base},
      l.sku_code, 0 AS is_free, l.qty, l.taxable, l.cgst, l.sgst, l.igst, l.line_total AS total, l.gst_rate, l.hsn
    FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id ${joins} JOIN credit_note_lines l ON l.credit_note_id = cn.credit_note_id
    WHERE cn.return_id IS NOT NULL AND ${IN('cn.issued_at')}`, S);
  const [cnX] = await q.query(`SELECT i.invoice_id, cn.credit_note_no AS doc, ${istDate('cn.issued_at')} AS day, -1 AS sign, ${base}, cn.return_id,
      cn.round_off, i.delivery_charge, i.delivery_gst, i.gst_type FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id ${joins} WHERE ${IN('cn.issued_at')}`, S);
  const [cancelLines] = await q.query(`SELECT i.invoice_id, cn.credit_note_no AS doc, ${istDate('cn.issued_at')} AS day, -1 AS sign, ${base},
      it.sku_code, it.is_free, it.qty, it.taxable, it.cgst, it.sgst, it.igst, it.line_total AS total, it.gst_rate, it.hsn
    FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id ${joins} JOIN order_items it ON it.order_id = o.order_id
    WHERE cn.return_id IS NULL AND ${IN('cn.issued_at')}`, S);
  const out = [];
  const push = (r, extra) => out.push({ ...r, ...extra, day: typeof r.day === 'string' ? r.day : r.day.toISOString().slice(0, 10) });
  inv.forEach((r) => push(r, {}));
  cnl.forEach((r) => push(r, {}));
  cancelLines.forEach((r) => push(r, {}));
  const delRate = (r) => (Number(r.delivery_charge) ? Math.round((Number(r.delivery_gst) / Number(r.delivery_charge)) * 100) : 18);
  for (const r of invX) {
    if (Number(r.delivery_charge)) push(r, { sku_code: '(delivery)', qty: 0, taxable: r.delivery_charge, cgst: r.gst_type === 'intra' ? round2(r.delivery_gst / 2) : 0, sgst: r.gst_type === 'intra' ? round2(r.delivery_gst / 2) : 0, igst: r.gst_type === 'inter' ? r.delivery_gst : 0, total: round2(Number(r.delivery_charge) + Number(r.delivery_gst)), gst_rate: delRate(r), hsn: '9965' });
    if (Number(r.round_off)) push(r, { sku_code: '(round off)', qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: r.round_off, gst_rate: null, hsn: null });
  }
  for (const r of cnX) {
    if (!r.return_id && Number(r.delivery_charge)) push(r, { sku_code: '(delivery)', qty: 0, taxable: r.delivery_charge, cgst: r.gst_type === 'intra' ? round2(r.delivery_gst / 2) : 0, sgst: r.gst_type === 'intra' ? round2(r.delivery_gst / 2) : 0, igst: r.gst_type === 'inter' ? r.delivery_gst : 0, total: round2(Number(r.delivery_charge) + Number(r.delivery_gst)), gst_rate: delRate(r), hsn: '9965' });
    if (Number(r.round_off)) push(r, { sku_code: '(round off)', qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: r.round_off, gst_rate: null, hsn: null });
  }
  return out.map((r) => {
    const sg = Number(r.sign);
    const n = (k) => round2(sg * Number(r[k] || 0));
    return { ...r, sign: sg, qty: sg * Number(r.qty || 0), taxable: n('taxable'), cgst: n('cgst'), sgst: n('sgst'), igst: n('igst'), gst: round2(n('cgst') + n('sgst') + n('igst')), total: n('total') };
  });
}

async function skuInfo(q) {
  const [rows] = await q.query(`SELECT s.sku_code, ${SKU_NAME} AS name, s.size_label, p.category_key, s.avg_cost FROM skus s ${SKU_JOIN}`);
  return new Map(rows.map((r) => [r.sku_code, r]));
}

const SALES_GROUPS = { day: 'Day', month: 'Month', sku: 'SKU', category: 'Category', customer: 'Customer', type: 'Customer type', town: 'Town', area: 'Delivery area', owner: 'Sales owner' };
async function sales(q, p) {
  const group = SALES_GROUPS[p.group] ? p.group : 'day';
  const info = await skuInfo(q);
  const filter = (rows) => rows.filter((r) => (!p.type || r.type_key === p.type) && (!p.owner || r.owner_emp_id === p.owner));
  const keyOf = (r) => {
    switch (group) {
      case 'month': return [r.day.slice(0, 7), r.day.slice(0, 7)];
      case 'sku': { const s = info.get(r.sku_code); return [r.sku_code, s ? `${r.sku_code} ${s.name} ${s.size_label}` : r.sku_code]; }
      case 'category': { const s = info.get(r.sku_code); return s ? [s.category_key, s.category_key] : [r.sku_code, r.sku_code === '(delivery)' ? 'Delivery charges' : 'Round off']; }
      case 'customer': return [String(r.customer_id), `${r.customer_no} ${r.customer}`];
      case 'type': return [r.type_key, r.type_label];
      case 'town': return [r.town || '-', r.town || '(no town)'];
      case 'area': return [r.area || '-', r.area || '(no area)'];
      case 'owner': return [r.owner_emp_id || '-', r.owner_emp_id || '(no owner)'];
      default: return [r.day, r.day];
    }
  };
  const agg = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const [k, label] = keyOf(r);
      const g = m.get(k) || { key: k, label, docs: new Set(), qty: 0, taxable: 0, gst: 0, total: 0 };
      if (r.sign > 0) g.docs.add(r.invoice_id);
      g.qty += r.is_free ? 0 : r.qty; g.taxable = round2(g.taxable + r.taxable); g.gst = round2(g.gst + r.gst); g.total = round2(g.total + r.total);
      m.set(k, g);
    }
    return m;
  };
  const cur = agg(filter(await salesFacts(q, p)));
  const prevP = previous(p);
  const prevFacts = filter(await salesFacts(q, prevP));
  const prev = agg(prevFacts);
  const timeGroup = group === 'day' || group === 'month';
  let rows = [...cur.values()].map((g) => {
    const pv = timeGroup ? null : prev.get(g.key);
    return { key: g.key, label: g.label, invoices: g.docs.size, qty: g.qty, taxable: g.taxable, gst: g.gst, total: g.total,
      prev_total: pv ? pv.total : timeGroup ? null : 0, change: pv && pv.total ? round2(((g.total - pv.total) / Math.abs(pv.total)) * 100) : null };
  });
  rows.sort(timeGroup ? (a, b) => (a.key < b.key ? -1 : 1) : (a, b) => b.total - a.total);
  if (timeGroup && group === 'day') { // every day of the period, also the quiet ones (for the chart)
    const all = [];
    for (let d = p.from; d <= p.to; d = addDays(d, 1)) all.push(rows.find((r) => r.key === d) || { key: d, label: d, invoices: 0, qty: 0, taxable: 0, gst: 0, total: 0 });
    rows = all;
  }
  const totals = { ...sumRows(rows, ['qty', 'taxable', 'gst', 'total']), invoices: new Set([...cur.values()].flatMap((g) => [...g.docs])).size };
  const prevTotal = round2(prevFacts.reduce((a, r) => a + r.total, 0));
  totals.prev_total = prevTotal;
  totals.change = prevTotal ? round2(((totals.total - prevTotal) / Math.abs(prevTotal)) * 100) : null;
  // the previous period, day by day (same position in the period), for the chart
  let chart = null;
  if (group === 'day') {
    const pDays = []; for (let d = prevP.from; d <= prevP.to; d = addDays(d, 1)) pDays.push(d);
    const pv = agg(prevFacts);
    chart = { kind: 'line', x: rows.map((r) => r.key), series: [{ name: `${p.from} to ${p.to}`, values: rows.map((r) => r.total) }, { name: `Previous: ${prevP.from} to ${prevP.to}`, values: pDays.map((d) => (pv.get(d) || { total: 0 }).total) }] };
  } else if (group === 'month') {
    chart = { kind: 'bar', x: rows.map((r) => r.label), series: [{ name: 'Sales', values: rows.map((r) => r.total) }] };
  } else {
    const top = rows.slice(0, 10);
    chart = { kind: 'hbar', x: top.map((r) => r.label), series: [{ name: 'Sales', values: top.map((r) => r.total) }], title: `Top ${top.length} by total` };
  }
  const columns = [col('label', SALES_GROUPS[group]), col('invoices', 'Invoices', 'num'), col('qty', 'Packs', 'num'), col('taxable', 'Taxable value', 'money'), col('gst', 'GST', 'money'), col('total', 'Total', 'money'),
    ...(timeGroup ? [] : [col('prev_total', 'Previous period', 'money'), col('change', 'Change', 'pct')])];
  const [[chk]] = await q.query(`SELECT (SELECT COALESCE(SUM(total), 0) FROM invoices WHERE ${IN('issued_at')}) AS inv, (SELECT COALESCE(SUM(total), 0) FROM credit_notes WHERE ${IN('issued_at')}) AS cn`, [...span(p), ...span(p)]);
  const checks = (!p.type && !p.owner) ? [{ label: 'Invoices issued - credit notes issued in the period', value: round2(chk.inv - chk.cn), ok: Math.abs(round2(chk.inv - chk.cn) - totals.total) < 0.01,
    detail: `invoices Rs ${round2(chk.inv)} - credit notes Rs ${round2(chk.cn)}` }] : [];
  return { tables: [{ key: 'sales', title: `Sales by ${SALES_GROUPS[group].toLowerCase()}`, columns, rows, totals }], chart, checks,
    notes: [`Previous period: ${prevP.from} to ${prevP.to} (total Rs ${prevTotal.toLocaleString('en-IN')}).`, 'Sales = invoices issued in the period minus credit notes issued in it (returns and cancellations); delivery charges and round-off are part of the total.'] };
}

// ---------------------------------------------------------------- GST registers (GSTR-1 style)
const gstDate = (d) => { const x = new Date(`${d}T00:00:00Z`); return `${String(x.getUTCDate()).padStart(2, '0')}-${x.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}-${x.getUTCFullYear()}`; };
const posText = (c) => `${c}-${stateName(c)}`;
async function gst(q, p) {
  const facts = (await salesFacts(q, p)).filter((r) => r.sku_code !== '(round off)');
  const [docs] = await q.query(`SELECT 'invoice' AS kind, i.invoice_id, i.invoice_no AS doc, ${istDate('i.issued_at')} AS day, i.total, i.place_of_supply, i.gst_type, i.buyer_json, i.status, NULL AS return_id
      FROM invoices i WHERE ${IN('i.issued_at')}
    UNION ALL SELECT 'note', i.invoice_id, cn.credit_note_no, ${istDate('cn.issued_at')}, cn.total, i.place_of_supply, i.gst_type, i.buyer_json, i.status, cn.return_id
      FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id WHERE ${IN('cn.issued_at')}`, [...span(p), ...span(p)]);
  const buyer = (d) => (typeof d.buyer_json === 'string' ? JSON.parse(d.buyer_json) : d.buyer_json).bill;
  const dayOf = (d) => (typeof d.day === 'string' ? d.day : d.day.toISOString().slice(0, 10));
  const rates = (doc, sign) => {
    const m = new Map();
    facts.filter((f) => f.doc === doc && Math.sign(f.sign) === sign).forEach((f) => {
      const g = m.get(f.gst_rate) || { rate: Number(f.gst_rate), taxable: 0, cgst: 0, sgst: 0, igst: 0 };
      g.taxable = round2(g.taxable + Math.abs(f.taxable)); g.cgst = round2(g.cgst + Math.abs(f.cgst)); g.sgst = round2(g.sgst + Math.abs(f.sgst)); g.igst = round2(g.igst + Math.abs(f.igst));
      m.set(f.gst_rate, g);
    });
    return [...m.values()].sort((a, b) => a.rate - b.rate);
  };
  const b2b = []; const b2cl = []; const b2csMap = new Map(); const cdnr = []; const cdnur = [];
  for (const d of docs) {
    const b = buyer(d);
    const day = dayOf(d);
    const inter = d.gst_type === 'inter';
    if (d.kind === 'invoice') {
      for (const r of rates(d.doc, 1)) {
        if (b.gstin) b2b.push({ gstin: b.gstin, name: b.name, doc: d.doc, date: gstDate(day), value: Number(d.total), pos: posText(d.place_of_supply), rc: 'N', app: '', type: 'Regular B2B', ecom: '', ...r, cess: 0 });
        else if (inter && Number(d.total) > 250000) b2cl.push({ doc: d.doc, date: gstDate(day), value: Number(d.total), pos: posText(d.place_of_supply), app: '', ...r, cess: 0, ecom: '' });
        else { const k = `${d.place_of_supply}|${r.rate}`; const g = b2csMap.get(k) || { type: 'OE', pos: posText(d.place_of_supply), app: '', rate: r.rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, ecom: '' }; ['taxable', 'cgst', 'sgst', 'igst'].forEach((x) => { g[x] = round2(g[x] + r[x]); }); b2csMap.set(k, g); }
      }
    } else {
      for (const r of rates(d.doc, -1)) {
        if (b.gstin) cdnr.push({ gstin: b.gstin, name: b.name, doc: d.doc, date: gstDate(day), note_type: 'C', pos: posText(d.place_of_supply), rc: 'N', supply: 'Regular B2B', value: Number(d.total), app: '', ...r, cess: 0 });
        else if (inter && Number(d.total) > 250000) cdnur.push({ ur: 'B2CL', doc: d.doc, date: gstDate(day), note_type: 'C', pos: posText(d.place_of_supply), value: Number(d.total), app: '', ...r, cess: 0 });
        else { const k = `${d.place_of_supply}|${r.rate}`; const g = b2csMap.get(k) || { type: 'OE', pos: posText(d.place_of_supply), app: '', rate: r.rate, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, ecom: '' }; ['taxable', 'cgst', 'sgst', 'igst'].forEach((x) => { g[x] = round2(g[x] - r[x]); }); b2csMap.set(k, g); }
      }
    }
  }
  // HSN summary and output tax by rate (invoices - credit notes)
  const hsnMap = new Map(); const rateMap = new Map();
  for (const f of facts) {
    const k = `${f.hsn}|${f.gst_rate}`;
    const h = hsnMap.get(k) || { hsn: f.hsn, desc: f.hsn === '9965' ? 'Delivery (transport of goods)' : '', uqc: f.hsn === '9965' ? 'NA' : 'NOS-NUMBERS', qty: 0, value: 0, rate: Number(f.gst_rate), taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 };
    h.qty += f.qty; h.value = round2(h.value + f.total); h.taxable = round2(h.taxable + f.taxable); h.igst = round2(h.igst + f.igst); h.cgst = round2(h.cgst + f.cgst); h.sgst = round2(h.sgst + f.sgst);
    hsnMap.set(k, h);
    const rr = rateMap.get(f.gst_rate) || { rate: Number(f.gst_rate), taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    rr.taxable = round2(rr.taxable + f.taxable); rr.cgst = round2(rr.cgst + f.cgst); rr.sgst = round2(rr.sgst + f.sgst); rr.igst = round2(rr.igst + f.igst);
    rateMap.set(f.gst_rate, rr);
  }
  const byRate = [...rateMap.values()].sort((a, b) => a.rate - b.rate).map((r) => ({ ...r, tax: round2(r.cgst + r.sgst + r.igst) }));
  const [descs] = await q.query("SELECT DISTINCT p.hsn_code, COALESCE(t.name, p.product_id) AS name FROM products p LEFT JOIN product_translations t ON t.product_id = p.product_id AND t.lang_code = 'en'");
  const hsn = [...hsnMap.values()].map((h) => ({ ...h, desc: h.desc || (descs.find((x) => x.hsn_code === h.hsn) || { name: '' }).name })).sort((a, b) => String(a.hsn).localeCompare(String(b.hsn)));
  const [[inv]] = await q.query(`SELECT COALESCE(SUM(cgst + sgst + igst), 0) AS gst FROM invoices WHERE ${IN('issued_at')}`, span(p));
  const [[cn]] = await q.query(`SELECT COALESCE(SUM(cgst + sgst + igst), 0) AS gst FROM credit_notes WHERE ${IN('issued_at')}`, span(p));
  const regInv = round2(facts.filter((f) => f.sign > 0).reduce((a, f) => a + f.gst, 0));
  const regCn = round2(-facts.filter((f) => f.sign < 0).reduce((a, f) => a + f.gst, 0));
  const net = sumRows(byRate, ['taxable', 'cgst', 'sgst', 'igst', 'tax']);
  const T = (rows, keys) => sumRows(rows, keys);
  return {
    tables: [
      { key: 'rate', title: 'Output tax by rate and type (invoices - credit notes)', columns: [col('rate', 'GST rate %', 'num'), col('taxable', 'Taxable value', 'money'), col('cgst', 'CGST', 'money'), col('sgst', 'SGST', 'money'), col('igst', 'IGST', 'money'), col('tax', 'Total tax', 'money')], rows: byRate, totals: net },
      { key: 'b2b', title: 'B2B invoices (with GSTIN)', columns: [col('gstin', 'GSTIN/UIN of Recipient'), col('name', 'Receiver Name'), col('doc', 'Invoice Number'), col('date', 'Invoice date'), col('value', 'Invoice Value', 'money'), col('pos', 'Place Of Supply'), col('rc', 'Reverse Charge'), col('app', 'Applicable % of Tax Rate'), col('type', 'Invoice Type'), col('ecom', 'E-Commerce GSTIN'), col('rate', 'Rate', 'num'), col('taxable', 'Taxable Value', 'money'), col('cess', 'Cess Amount', 'money'), col('cgst', 'CGST', 'money'), col('sgst', 'SGST', 'money'), col('igst', 'IGST', 'money')], rows: b2b, totals: T(b2b, ['taxable', 'cgst', 'sgst', 'igst']), portal: 'b2b', portalCols: 13 },
      { key: 'b2cl', title: 'B2C large (inter-state above Rs 2.5 lakh)', columns: [col('doc', 'Invoice Number'), col('date', 'Invoice date'), col('value', 'Invoice Value', 'money'), col('pos', 'Place Of Supply'), col('app', 'Applicable % of Tax Rate'), col('rate', 'Rate', 'num'), col('taxable', 'Taxable Value', 'money'), col('cess', 'Cess Amount', 'money'), col('ecom', 'E-Commerce GSTIN'), col('igst', 'IGST', 'money')], rows: b2cl, totals: T(b2cl, ['taxable', 'igst']), portal: 'b2cl', portalCols: 9 },
      { key: 'b2cs', title: 'B2C small by state and rate (net of their credit notes)', columns: [col('type', 'Type'), col('pos', 'Place Of Supply'), col('app', 'Applicable % of Tax Rate'), col('rate', 'Rate', 'num'), col('taxable', 'Taxable Value', 'money'), col('cess', 'Cess Amount', 'money'), col('ecom', 'E-Commerce GSTIN'), col('cgst', 'CGST', 'money'), col('sgst', 'SGST', 'money'), col('igst', 'IGST', 'money')], rows: [...b2csMap.values()], totals: T([...b2csMap.values()], ['taxable', 'cgst', 'sgst', 'igst']), portal: 'b2cs', portalCols: 7 },
      { key: 'cdnr', title: 'Credit notes to registered buyers', columns: [col('gstin', 'GSTIN/UIN of Recipient'), col('name', 'Receiver Name'), col('doc', 'Note Number'), col('date', 'Note Date'), col('note_type', 'Note Type'), col('pos', 'Place Of Supply'), col('rc', 'Reverse Charge'), col('supply', 'Note Supply Type'), col('value', 'Note Value', 'money'), col('app', 'Applicable % of Tax Rate'), col('rate', 'Rate', 'num'), col('taxable', 'Taxable Value', 'money'), col('cess', 'Cess Amount', 'money'), col('cgst', 'CGST', 'money'), col('sgst', 'SGST', 'money'), col('igst', 'IGST', 'money')], rows: cdnr, totals: T(cdnr, ['taxable', 'cgst', 'sgst', 'igst']), portal: 'cdnr', portalCols: 13 },
      { key: 'cdnur', title: 'Credit notes to unregistered buyers (B2C large)', columns: [col('ur', 'UR Type'), col('doc', 'Note Number'), col('date', 'Note Date'), col('note_type', 'Note Type'), col('pos', 'Place Of Supply'), col('value', 'Note Value', 'money'), col('app', 'Applicable % of Tax Rate'), col('rate', 'Rate', 'num'), col('taxable', 'Taxable Value', 'money'), col('cess', 'Cess Amount', 'money'), col('igst', 'IGST', 'money')], rows: cdnur, totals: T(cdnur, ['taxable', 'igst']), portal: 'cdnur', portalCols: 10 },
      { key: 'hsn', title: 'HSN summary (invoices - credit notes)', columns: [col('hsn', 'HSN'), col('desc', 'Description'), col('uqc', 'UQC'), col('qty', 'Total Quantity', 'num'), col('value', 'Total Value', 'money'), col('rate', 'Rate', 'num'), col('taxable', 'Taxable Value', 'money'), col('igst', 'Integrated Tax Amount', 'money'), col('cgst', 'Central Tax Amount', 'money'), col('sgst', 'State/UT Tax Amount', 'money'), col('cess', 'Cess Amount', 'money')], rows: hsn, totals: T(hsn, ['qty', 'value', 'taxable', 'igst', 'cgst', 'sgst']), portal: 'hsn', portalCols: 11 },
    ],
    chart: byRate.length ? { kind: 'hbar', x: byRate.map((r) => `${r.rate}% GST`), series: [{ name: 'Tax', values: byRate.map((r) => r.tax) }], title: 'Output tax by rate' } : null,
    checks: [
      { label: 'Register GST on invoices = GST of the invoices issued', value: regInv, ok: Math.abs(regInv - round2(inv.gst)) < 0.02, detail: `invoices Rs ${round2(inv.gst)}` },
      { label: 'Register GST on credit notes = GST of the credit notes issued', value: regCn, ok: Math.abs(regCn - round2(cn.gst)) < 0.02, detail: `credit notes Rs ${round2(cn.gst)}` },
      { label: 'Output tax (net) = invoices GST - credit notes GST', value: net.tax, ok: Math.abs(round2(inv.gst - cn.gst) - net.tax) < 0.02, detail: `Rs ${round2(inv.gst)} - Rs ${round2(cn.gst)}` },
    ],
    notes: ['Column order as the GST offline tool (b2b, b2cl, b2cs, cdnr, cdnur, hsn); the CGST / SGST / IGST columns after them are for checking and are left out of the portal sheets in the Excel.',
      'B2C small rows are net of their credit notes; credit notes to unregistered small buyers are adjusted there. Delivery charges are HSN / SAC 9965 at their own rate.',
      'The seller GSTIN is still a placeholder (DEMO): do not file from these demo figures.'],
  };
}

// ---------------------------------------------------------------- margin
const MARGIN_BY = { sku: 'SKU', customer: 'Customer', order: 'Order' };
async function margin(q, p) {
  const by = MARGIN_BY[p.by] ? p.by : 'sku';
  const info = await skuInfo(q);
  const facts = (await salesFacts(q, p)).filter((r) => !r.sku_code.startsWith('('));
  const m = new Map();
  let noCost = 0;
  for (const f of facts) {
    const s = info.get(f.sku_code);
    const key = by === 'sku' ? f.sku_code : by === 'customer' ? String(f.customer_id) : f.order_no;
    const label = by === 'sku' ? `${f.sku_code} ${s ? `${s.name} ${s.size_label}` : ''}` : by === 'customer' ? `${f.customer_no} ${f.customer}` : `${f.order_no} (${f.customer})`;
    const g = m.get(key) || { key, label, qty: 0, value: 0, cost: 0 };
    const c = s && s.avg_cost !== null ? Number(s.avg_cost) : null;
    if (c === null) noCost += 1;
    g.qty += f.qty; g.value = round2(g.value + f.taxable); g.cost = round2(g.cost + f.qty * (c || 0));
    m.set(key, g);
  }
  const rows = [...m.values()].map((g) => ({ ...g, margin: round2(g.value - g.cost), pct: g.value ? round2(((g.value - g.cost) / g.value) * 100) : null })).sort((a, b) => b.margin - a.margin);
  const totals = sumRows(rows, ['qty', 'value', 'cost', 'margin']);
  totals.pct = totals.value ? round2((totals.margin / totals.value) * 100) : null;
  const top = rows.slice(0, 10);
  return { tables: [{ key: 'margin', title: `Margin by ${MARGIN_BY[by].toLowerCase()}`, columns: [col('label', MARGIN_BY[by]), col('qty', 'Packs', 'num'), col('value', 'Selling value (taxable)', 'money'), col('cost', 'Cost (average)', 'money'), col('margin', 'Margin', 'money'), col('pct', 'Margin %', 'pct')], rows, totals }],
    chart: { kind: 'hbar', x: top.map((r) => r.label), series: [{ name: 'Margin', values: top.map((r) => r.margin) }], title: `Top ${top.length} by margin` },
    notes: ['Selling value = taxable value after every discount, less returns (credit notes); free packs count at Rs 0 with their cost.', 'Cost = packs x the SKU\'s weighted average cost now (Inventory).', ...(noCost ? [`${noCost} line(s) of SKUs without an average cost count at Rs 0 cost.`] : [])], checks: [] };
}

// ---------------------------------------------------------------- stock
const STOCK_VIEWS = { value: 'Stock value', movement: 'Movement summary', slow: 'Slow-moving', expiry: 'Near expiry and expired', reorder: 'Reorder' };
async function stockReport(q, p, { seesCost }) {
  const view = STOCK_VIEWS[p.view] ? p.view : 'movement';
  const info = await skuInfo(q);
  const label = (k) => { const s = info.get(k); return s ? `${s.name} ${s.size_label}` : ''; };
  if (view === 'value') {
    const [rows] = await q.query("SELECT sku_code, SUM(delta) AS qty FROM stock_movements WHERE stock_kind = 'good' GROUP BY sku_code HAVING qty <> 0");
    const r = rows.map((x) => { const s = info.get(x.sku_code); const c = s && s.avg_cost !== null ? Number(s.avg_cost) : null; return { sku_code: x.sku_code, name: label(x.sku_code), category: s ? s.category_key : '', qty: Number(x.qty), avg_cost: seesCost ? c : undefined, value: seesCost ? round2(Number(x.qty) * (c || 0)) : undefined }; }).sort((a, b) => (b.value || b.qty) - (a.value || a.qty));
    const cats = new Map(); r.forEach((x) => { const g = cats.get(x.category) || { category: x.category, skus: 0, qty: 0, value: 0 }; g.skus += 1; g.qty += x.qty; g.value = round2(g.value + (x.value || 0)); cats.set(x.category, g); });
    const catRows = [...cats.values()].sort((a, b) => b.value - a.value);
    return { tables: [
      { key: 'category', title: 'By category', columns: [col('category', 'Category'), col('skus', 'SKUs', 'num'), col('qty', 'Packs (good)', 'num'), ...(seesCost ? [col('value', 'Value (average cost)', 'money')] : [])], rows: catRows, totals: sumRows(catRows, ['skus', 'qty', 'value']) },
      { key: 'sku', title: 'By SKU', columns: [col('sku_code', 'SKU'), col('name', 'Product'), col('category', 'Category'), col('qty', 'Packs (good)', 'num'), ...(seesCost ? [col('avg_cost', 'Average cost', 'money'), col('value', 'Value', 'money')] : [])], rows: r, totals: sumRows(r, ['qty', 'value']) },
    ], chart: seesCost ? { kind: 'hbar', x: catRows.map((x) => x.category), series: [{ name: 'Value', values: catRows.map((x) => x.value) }], title: 'Stock value by category' } : null,
    notes: seesCost ? ['Good stock at the weighted average cost; returned (R), damaged and expired stock are not valued here.'] : ['Costs and values show only for a role with view on Reports and on Products and prices.'], checks: [] };
  }
  if (view === 'movement') {
    const [rows] = await q.query(`SELECT sku_code,
        SUM(CASE WHEN created_at < CONVERT_TZ(?, '+05:30', '+00:00') THEN delta ELSE 0 END) AS opening,
        SUM(CASE WHEN ${IN('created_at')} AND move_type IN ('production', 'purchase') THEN delta ELSE 0 END) AS stock_in,
        SUM(CASE WHEN ${IN('created_at')} AND move_type = 'out' THEN -delta ELSE 0 END) AS stock_out,
        SUM(CASE WHEN ${IN('created_at')} AND move_type IN ('return', 'recheck') THEN delta ELSE 0 END) AS returns,
        SUM(CASE WHEN ${IN('created_at')} AND move_type = 'write_off' THEN -delta ELSE 0 END) AS write_offs,
        SUM(CASE WHEN ${IN('created_at')} AND move_type NOT IN ('production', 'purchase', 'out', 'return', 'recheck', 'write_off') THEN delta ELSE 0 END) AS other,
        SUM(CASE WHEN created_at < CONVERT_TZ(DATE_ADD(?, INTERVAL 1 DAY), '+05:30', '+00:00') THEN delta ELSE 0 END) AS closing
      FROM stock_movements WHERE stock_kind = 'good' GROUP BY sku_code ORDER BY sku_code`, [`${p.from} 00:00:00`, ...span(p), ...span(p), ...span(p), ...span(p), ...span(p), p.to]);
    const r = rows.map((x) => ({ sku_code: x.sku_code, name: label(x.sku_code), ...Object.fromEntries(['opening', 'stock_in', 'stock_out', 'returns', 'write_offs', 'other', 'closing'].map((k) => [k, Number(x[k])])) }));
    const totals = sumRows(r, ['opening', 'stock_in', 'stock_out', 'returns', 'write_offs', 'other', 'closing']);
    const [[now]] = await q.query("SELECT COALESCE(SUM(delta), 0) AS n FROM stock_movements WHERE stock_kind = 'good'");
    return { tables: [{ key: 'movement', title: 'Good stock movement (packs)', columns: [col('sku_code', 'SKU'), col('name', 'Product'), col('opening', 'Opening', 'num'), col('stock_in', 'In (production, purchase)', 'num'), col('stock_out', 'Out (dispatched)', 'num'), col('returns', 'Back in (returns, recheck)', 'num'), col('write_offs', 'Written off', 'num'), col('other', 'Other (damaged, counts)', 'num'), col('closing', 'Closing', 'num')], rows: r, totals }],
      chart: { kind: 'bar', x: ['Opening', 'In', 'Out', 'Back in', 'Written off', 'Other', 'Closing'], series: [{ name: 'Packs', values: [totals.opening, totals.stock_in, -totals.stock_out, totals.returns, -totals.write_offs, totals.other, totals.closing] }], title: 'All SKUs, packs' },
      checks: p.to >= istToday() ? [{ label: 'Closing = good stock on the Inventory screen', value: totals.closing, ok: totals.closing === Number(now.n), detail: `Inventory good stock now: ${Number(now.n)} packs` }] : [],
      notes: ['Opening + in - out + back in - written off + other = closing, per SKU (good stock only).'] };
  }
  if (view === 'slow') {
    const s = await commerceSettings.read(q);
    const days = Number(p.days) || Number(s.slow_moving_days) || 60;
    const [rows] = await q.query(`SELECT g.sku_code, g.qty, DATE_FORMAT(CONVERT_TZ(m.last_out, '+00:00', '+05:30'), '%Y-%m-%d') AS last_sale, DATEDIFF(${IST_TODAY}, ${istDate('m.last_out')}) AS since
        FROM (SELECT sku_code, SUM(delta) AS qty FROM stock_movements WHERE stock_kind = 'good' GROUP BY sku_code HAVING qty > 0) g
        LEFT JOIN (SELECT sku_code, MAX(created_at) AS last_out FROM stock_movements WHERE move_type = 'out' GROUP BY sku_code) m ON m.sku_code = g.sku_code
        WHERE m.last_out IS NULL OR m.last_out < UTC_TIMESTAMP() - INTERVAL ? DAY ORDER BY m.last_out IS NOT NULL, m.last_out`, [days]);
    const r = rows.map((x) => { const i2 = info.get(x.sku_code); return { sku_code: x.sku_code, name: label(x.sku_code), qty: Number(x.qty), last_sale: x.last_sale || 'never', since: x.since === null ? null : Number(x.since), value: seesCost && i2 && i2.avg_cost !== null ? round2(Number(x.qty) * Number(i2.avg_cost)) : undefined }; });
    return { tables: [{ key: 'slow', title: `No sale in ${days} days`, columns: [col('sku_code', 'SKU'), col('name', 'Product'), col('qty', 'Packs (good)', 'num'), col('last_sale', 'Last sale'), col('since', 'Days since', 'num'), ...(seesCost ? [col('value', 'Value tied up', 'money')] : [])], rows: r, totals: sumRows(r, ['qty', 'value']) }],
      chart: null, notes: [`Slow-moving = good stock and no dispatch for ${days} days (Commerce settings > Inventory, or the Days filter).`], checks: [] };
  }
  if (view === 'expiry') {
    const b = await stock.batchList(q);
    const r = b.rows.filter((x) => x.good > 0 && x.state !== 'ok').map((x) => ({ sku_code: x.sku_code, name: `${x.name} ${x.size_label}`, batch_no: x.batch_no, expiry_date: x.expiry_date, state: x.state === 'expired' ? `Expired ${-x.days_left} days ago` : `Expires in ${x.days_left} days`, good: x.good, damaged: x.damaged }));
    return { tables: [{ key: 'expiry', title: `Expired and near expiry (within ${b.warnDays} days)`, columns: [col('sku_code', 'SKU'), col('name', 'Product'), col('batch_no', 'Batch'), col('expiry_date', 'Expires', 'date'), col('state', 'State'), col('good', 'Good packs', 'num'), col('damaged', 'Damaged', 'num')], rows: r, totals: sumRows(r, ['good', 'damaged']) }], chart: null, notes: ['Expired stock is blocked from orders: write it off.'], checks: [] };
  }
  const re = await stock.reorderList(q);
  const r = re.map((x) => ({ sku_code: x.sku_code, name: `${x.name} ${x.size_label || ''}`, available: x.available, reorder_level: x.reorder_level, suggested: x.suggested, cartons: `${x.cartons} x ${x.packs_per_carton}` }));
  return { tables: [{ key: 'reorder', title: 'Below the reorder level', columns: [col('sku_code', 'SKU'), col('name', 'Product'), col('available', 'Available', 'num'), col('reorder_level', 'Reorder level', 'num'), col('suggested', 'Suggested packs', 'num'), col('cartons', 'Cartons')], rows: r, totals: sumRows(r, ['suggested']) }], chart: null, notes: [], checks: [] };
}

// ---------------------------------------------------------------- receivables
async function receivables(q, p) {
  const [open] = await q.query(`SELECT c.customer_id, c.customer_no, c.name, c.credit_limit, c.credit_days, o.amount_due, i.invoice_no, o.order_no, ${istDate('i.issued_at')} AS day, DATE_FORMAT(i.due_on, '%Y-%m-%d') AS due_on,
        DATEDIFF(${IST_TODAY}, ${istDate('i.issued_at')}) AS age, DATEDIFF(${IST_TODAY}, i.due_on) AS late, (${commerce.OVERDUE_SQL}) AS overdue
      FROM invoices i JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id
      WHERE i.status = 'issued' AND o.status <> 'cancelled' AND o.amount_due > 0.005 ORDER BY c.name, i.issued_at`);
  const [uninv] = await q.query(`SELECT customer_id, SUM(amount_due) AS due FROM orders o WHERE o.status <> 'cancelled' AND o.amount_due > 0.005
      AND NOT EXISTS (SELECT 1 FROM invoices i WHERE i.live_order_id = o.order_id) GROUP BY customer_id`);
  const m = new Map();
  for (const o of open) {
    const g = m.get(o.customer_id) || { customer: `${o.customer_no} ${o.name}`, d0_30: 0, d31_60: 0, d61_90: 0, d90: 0, invoiced: 0, not_invoiced: 0, credit_limit: Number(o.credit_limit), overdue: 0 };
    const a = Number(o.age); const due = Number(o.amount_due);
    g[a <= 30 ? 'd0_30' : a <= 60 ? 'd31_60' : a <= 90 ? 'd61_90' : 'd90'] = round2(g[a <= 30 ? 'd0_30' : a <= 60 ? 'd31_60' : a <= 90 ? 'd61_90' : 'd90'] + due);
    g.invoiced = round2(g.invoiced + due); if (Number(o.overdue)) g.overdue = round2(g.overdue + due);
    m.set(o.customer_id, g);
  }
  const [lim] = await q.query('SELECT customer_id, customer_no, name, credit_limit FROM customers WHERE merged_into IS NULL');
  for (const u of uninv) {
    const c = lim.find((x) => x.customer_id === u.customer_id);
    const g = m.get(u.customer_id) || { customer: `${c.customer_no} ${c.name}`, d0_30: 0, d31_60: 0, d61_90: 0, d90: 0, invoiced: 0, not_invoiced: 0, credit_limit: Number(c.credit_limit), overdue: 0 };
    g.not_invoiced = round2(Number(u.due)); m.set(u.customer_id, g);
  }
  const byCust = [...m.values()].map((g) => ({ ...g, total: round2(g.invoiced + g.not_invoiced), use: g.credit_limit ? round2(((g.invoiced + g.not_invoiced) / g.credit_limit) * 100) : null })).sort((a, b) => b.total - a.total);
  const overdue = open.filter((o) => Number(o.overdue)).map((o) => ({ customer: `${o.customer_no} ${o.name}`, invoice_no: o.invoice_no, order_no: o.order_no, day: typeof o.day === 'string' ? o.day : o.day.toISOString().slice(0, 10), due_on: o.due_on, late: Number(o.late), amount: Number(o.amount_due) }));
  const S = span(p);
  const [modes] = await q.query(`SELECT mode, SUM(CASE WHEN kind = 'payment' THEN amount ELSE 0 END) AS received, SUM(CASE WHEN kind = 'refund' THEN amount ELSE 0 END) AS refunded, COUNT(*) AS n
      FROM payments WHERE received_on BETWEEN ? AND ? GROUP BY mode ORDER BY received DESC`, [p.from, p.to]);
  const modeRows = modes.map((x) => ({ mode: commerce.MODES[x.mode] || x.mode, n: Number(x.n), received: Number(x.received), refunded: Number(x.refunded), net: round2(x.received - x.refunded) }));
  const [drivers] = await q.query(`SELECT d.name AS driver, COUNT(DISTINCT t.trip_id) AS trips, COALESCE(SUM(s.cash_collected), 0) AS collected,
        (SELECT COALESCE(SUM(t2.cash_handed), 0) FROM delivery_trips t2 WHERE t2.driver_id = d.driver_id AND t2.status = 'ended' AND ${IN('t2.started_at')}) AS handed
      FROM delivery_trips t JOIN drivers d ON d.driver_id = t.driver_id LEFT JOIN trip_stops s ON s.trip_id = t.trip_id WHERE ${IN('t.started_at')} GROUP BY d.driver_id, d.name ORDER BY collected DESC`, [...S, ...S]);
  const drvRows = drivers.map((x) => ({ driver: x.driver, trips: Number(x.trips), collected: Number(x.collected), handed: Number(x.handed), difference: round2(Number(x.handed) - Number(x.collected)) }));
  const aT = sumRows(byCust, ['d0_30', 'd31_60', 'd61_90', 'd90', 'invoiced', 'not_invoiced', 'total', 'overdue']);
  const [[due]] = await q.query("SELECT COALESCE(SUM(amount_due), 0) AS n FROM orders WHERE status <> 'cancelled' AND amount_due > 0.005");
  return {
    tables: [
      { key: 'ageing', title: 'Outstanding by customer with ageing (by invoice date, now)', columns: [col('customer', 'Customer'), col('d0_30', '0-30 days', 'money'), col('d31_60', '31-60', 'money'), col('d61_90', '61-90', 'money'), col('d90', '90+', 'money'), col('invoiced', 'Invoiced, open', 'money'), col('not_invoiced', 'Not invoiced yet', 'money'), col('total', 'Total owed', 'money'), col('overdue', 'Of it overdue', 'money'), col('credit_limit', 'Credit limit', 'money'), col('use', 'Limit used', 'pct')], rows: byCust, totals: aT },
      { key: 'overdue', title: 'Overdue invoices (now)', columns: [col('customer', 'Customer'), col('invoice_no', 'Invoice'), col('order_no', 'Order'), col('day', 'Invoice date', 'date'), col('due_on', 'Due on', 'date'), col('late', 'Days late', 'num'), col('amount', 'Owed', 'money')], rows: overdue, totals: sumRows(overdue, ['amount']) },
      { key: 'modes', title: 'Collections by mode (in the period)', columns: [col('mode', 'Mode'), col('n', 'Entries', 'num'), col('received', 'Received', 'money'), col('refunded', 'Refunded', 'money'), col('net', 'Net', 'money')], rows: modeRows, totals: sumRows(modeRows, ['n', 'received', 'refunded', 'net']) },
      { key: 'drivers', title: 'Pay on delivery: cash by driver (trips started in the period)', columns: [col('driver', 'Driver'), col('trips', 'Trips', 'num'), col('collected', 'Cash collected', 'money'), col('handed', 'Handed over', 'money'), col('difference', 'Difference', 'money')], rows: drvRows, totals: sumRows(drvRows, ['trips', 'collected', 'handed', 'difference']) },
    ],
    chart: { kind: 'bar', x: ['0-30 days', '31-60', '61-90', '90+'], series: [{ name: 'Open invoices', values: [aT.d0_30, aT.d31_60, aT.d61_90, aT.d90] }], title: 'Ageing of open invoices' },
    checks: [{ label: 'Total owed = what the orders still owe', value: aT.total, ok: Math.abs(aT.total - round2(due.n)) < 0.01, detail: `orders amount due Rs ${round2(due.n)}` }],
    notes: ['Ageing and overdue are as of today; collections and cash by driver are for the period chosen.'],
  };
}

// ---------------------------------------------------------------- delivery
async function deliveryReport(q, p) {
  const S = span(p);
  const [stops] = await q.query(`SELECT d.name AS driver, COALESCE(a.label, '(no area)') AS area, s.kind, s.status, TIMESTAMPDIFF(MINUTE, t.started_at, s.done_at) <= 1440 AS in_time, t.trip_id
      FROM trip_stops s JOIN delivery_trips t ON t.trip_id = s.trip_id JOIN drivers d ON d.driver_id = t.driver_id LEFT JOIN orders o ON o.order_id = s.order_id LEFT JOIN delivery_areas a ON a.area_id = o.delivery_area_id
      WHERE t.started_at IS NOT NULL AND ${IN('t.started_at')}`, S);
  const agg = (keyFn) => {
    const m = new Map();
    for (const s of stops) {
      const k = keyFn(s);
      const g = m.get(k) || { key: k, trips: new Set(), stops: 0, delivered: 0, on_time: 0, failed: 0, pickups: 0, pending: 0 };
      g.trips.add(s.trip_id); g.stops += 1;
      if (s.kind === 'pickup') { if (s.status === 'picked_up') g.pickups += 1; else if (s.status === 'failed') g.failed += 1; else g.pending += 1; continue; }
      if (s.status === 'delivered') { g.delivered += 1; if (Number(s.in_time) === 1) g.on_time += 1; } else if (s.status === 'failed') g.failed += 1; else g.pending += 1;
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, trips: g.trips.size, on_time_pct: g.delivered + g.failed ? round2((g.on_time / (g.delivered + g.failed)) * 100) : null }));
  };
  const cols = (first) => [col('key', first), col('trips', 'Trips', 'num'), col('stops', 'Stops', 'num'), col('delivered', 'Delivered', 'num'), col('on_time', 'Within 24 h of the start', 'num'), col('failed', 'Failed', 'num'), col('pickups', 'Return pickups', 'num'), col('pending', 'Open', 'num'), col('on_time_pct', 'On time %', 'pct')];
  const byDriver = agg((s) => s.driver); const byArea = agg((s) => s.area);
  const [trips] = await q.query(`SELECT t.trip_id, DATE_FORMAT(t.trip_date, '%Y-%m-%d') AS trip_date, d.name AS driver, v.number AS vehicle, t.status, t.cash_expected, t.cash_collected, t.cash_handed,
      (SELECT COUNT(*) FROM trip_stops s WHERE s.trip_id = t.trip_id) AS stops FROM delivery_trips t JOIN drivers d ON d.driver_id = t.driver_id JOIN vehicles v ON v.vehicle_id = t.vehicle_id
      WHERE t.started_at IS NOT NULL AND ${IN('t.started_at')} ORDER BY t.trip_id`, S);
  const tRows = trips.map((t) => ({ trip: `T-${t.trip_id}`, trip_date: t.trip_date, driver: t.driver, vehicle: t.vehicle, status: t.status, stops: Number(t.stops), cash_expected: Number(t.cash_expected || 0),
    cash_collected: t.cash_collected === null ? null : Number(t.cash_collected), cash_handed: t.cash_handed === null ? null : Number(t.cash_handed), difference: t.cash_handed === null ? null : round2(Number(t.cash_handed) - Number(t.cash_collected)) }));
  const T = (rows) => sumRows(rows, ['trips', 'stops', 'delivered', 'on_time', 'failed', 'pickups', 'pending']);
  const all = T(byDriver);
  all.on_time_pct = all.delivered + all.failed ? round2((all.on_time / (all.delivered + all.failed)) * 100) : null;
  return {
    tables: [
      { key: 'driver', title: 'By driver', columns: cols('Driver'), rows: byDriver, totals: all },
      { key: 'area', title: 'By delivery area', columns: cols('Area'), rows: byArea, totals: { ...T(byArea), trips: all.trips, on_time_pct: all.on_time_pct } }, // a trip can cover several areas: counted once
      { key: 'trips', title: 'Trips and pay-on-delivery cash', columns: [col('trip', 'Trip'), col('trip_date', 'Date', 'date'), col('driver', 'Driver'), col('vehicle', 'Vehicle'), col('status', 'Status'), col('stops', 'Stops', 'num'), col('cash_expected', 'Cash to collect', 'money'), col('cash_collected', 'Collected', 'money'), col('cash_handed', 'Handed over', 'money'), col('difference', 'Difference', 'money')], rows: tRows, totals: sumRows(tRows, ['stops', 'cash_expected', 'cash_collected', 'cash_handed', 'difference']) },
    ],
    chart: byDriver.length ? { kind: 'hbar', x: byDriver.map((r) => r.key), series: [{ name: 'Delivered', values: byDriver.map((r) => r.delivered) }], title: 'Delivered stops by driver' } : null,
    checks: [], notes: ['Trips started in the period. On time = delivered within 24 hours of the trip starting; the % counts delivered and failed stops (open ones are left out).'],
  };
}

// ---------------------------------------------------------------- returns
async function returnsReport(q, p) {
  const S = span(p);
  const W = `r.created_at >= CONVERT_TZ(?, '+05:30', '+00:00') AND r.created_at < CONVERT_TZ(DATE_ADD(?, INTERVAL 1 DAY), '+05:30', '+00:00') AND r.status <> 'rejected'`;
  const [reason] = await q.query(`SELECT rr.label AS reason, COUNT(DISTINCT r.return_id) AS returns, COALESCE(SUM(x.qty), 0) AS packs FROM returns r JOIN return_reasons rr ON rr.reason_id = r.reason_id
      JOIN return_items x ON x.return_id = r.return_id WHERE ${W} GROUP BY rr.reason_id, rr.label ORDER BY packs DESC`, S);
  const [sku] = await q.query(`SELECT x.sku_code, COUNT(DISTINCT r.return_id) AS returns, SUM(x.qty) AS packs, COALESCE(SUM(x.qty_damaged), 0) AS damaged FROM returns r JOIN return_items x ON x.return_id = r.return_id
      WHERE ${W} GROUP BY x.sku_code ORDER BY packs DESC`, S);
  const [sold] = await q.query(`SELECT i.sku_code, SUM(i.qty) AS packs FROM orders o JOIN order_items i ON i.order_id = o.order_id WHERE ${IN('o.delivered_at')} AND o.status = 'delivered' GROUP BY i.sku_code`, S);
  const [cust] = await q.query(`SELECT c.customer_no, c.name, COUNT(DISTINCT r.return_id) AS returns, SUM(x.qty) AS packs FROM returns r JOIN orders o ON o.order_id = r.order_id JOIN customers c ON c.customer_id = o.customer_id
      JOIN return_items x ON x.return_id = r.return_id WHERE ${W} GROUP BY c.customer_id, c.customer_no, c.name ORDER BY packs DESC`, S);
  const [ref] = await q.query(`SELECT f.method, COALESCE(f.mode, '') AS mode, COUNT(*) AS n, SUM(f.amount) AS amount FROM refunds f WHERE f.status = 'paid' AND ${IN('f.paid_at')} GROUP BY f.method, f.mode ORDER BY amount DESC`, S);
  const info = await skuInfo(q);
  const del = new Map(sold.map((x) => [x.sku_code, Number(x.packs)]));
  const n = (x) => Number(x) || 0;
  const rR = reason.map((x) => ({ reason: x.reason, returns: n(x.returns), packs: n(x.packs) }));
  const rS = sku.map((x) => { const d = del.get(x.sku_code) || 0; const s = info.get(x.sku_code); return { sku_code: x.sku_code, name: s ? `${s.name} ${s.size_label}` : '', returns: n(x.returns), packs: n(x.packs), damaged: n(x.damaged), delivered: d, rate: d ? round2((n(x.packs) / d) * 100) : null }; });
  const rC = cust.map((x) => ({ customer: `${x.customer_no} ${x.name}`, returns: n(x.returns), packs: n(x.packs) }));
  const METH = { wallet: 'To the wallet', original: 'To the original payment', balance: 'Less to pay' };
  const rF = ref.map((x) => ({ method: METH[x.method] || x.method, mode: commerce.MODES[x.mode] || x.mode, n: n(x.n), amount: n(x.amount) }));
  return {
    tables: [
      { key: 'reason', title: 'By reason', columns: [col('reason', 'Reason'), col('returns', 'Returns', 'num'), col('packs', 'Packs', 'num')], rows: rR, totals: sumRows(rR, ['returns', 'packs']) },
      { key: 'sku', title: 'By SKU with the return rate', columns: [col('sku_code', 'SKU'), col('name', 'Product'), col('returns', 'Returns', 'num'), col('packs', 'Packs', 'num'), col('damaged', 'Damaged', 'num'), col('delivered', 'Delivered in the period', 'num'), col('rate', 'Return rate', 'pct')], rows: rS, totals: sumRows(rS, ['returns', 'packs', 'damaged', 'delivered']) },
      { key: 'customer', title: 'By customer', columns: [col('customer', 'Customer'), col('returns', 'Returns', 'num'), col('packs', 'Packs', 'num')], rows: rC, totals: sumRows(rC, ['returns', 'packs']) },
      { key: 'refunds', title: 'Refunds paid (by mode)', columns: [col('method', 'Refund'), col('mode', 'Mode'), col('n', 'Refunds', 'num'), col('amount', 'Amount', 'money')], rows: rF, totals: sumRows(rF, ['n', 'amount']) },
    ],
    chart: rR.length ? { kind: 'hbar', x: rR.map((r) => r.reason), series: [{ name: 'Packs', values: rR.map((r) => r.packs) }], title: 'Packs returned by reason' } : null,
    checks: [], notes: ['Returns entered in the period (rejected ones left out); return rate = packs returned / packs delivered in the period; refunds paid in the period.'],
  };
}

// ---------------------------------------------------------------- promotions (phase 7 report, same numbers)
async function promotionsReport(q, p) {
  const S = span(p);
  const n = (x) => Number(x) || 0;
  const [coupons] = await q.query(`SELECT r.code, c.kind, COUNT(*) AS orders, COUNT(DISTINCT r.customer_id) AS customers, SUM(r.amount) AS amount FROM coupon_redemptions r JOIN coupons c ON c.code = r.code
      WHERE r.status = 'active' AND ${IN('r.created_at')} GROUP BY r.code, c.kind ORDER BY amount DESC`, S);
  const [offers] = await q.query(`SELECT f.name, f.kind, COUNT(DISTINCT i.order_id) AS orders, SUM(i.offer_discount) AS discount, SUM(CASE WHEN i.is_free = 1 THEN i.qty ELSE 0 END) AS free_packs,
      SUM(CASE WHEN i.is_free = 1 THEN i.qty * COALESCE(i.list_price, 0) ELSE 0 END) AS free_value FROM order_items i JOIN offers f ON f.offer_id = i.offer_id JOIN orders o ON o.order_id = i.order_id
      WHERE o.status <> 'cancelled' AND ${IN('o.created_at')} GROUP BY f.offer_id, f.name, f.kind ORDER BY orders DESC`, S);
  const [months] = await q.query(`SELECT DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%Y-%m') AS month, COUNT(*) AS orders, SUM(subtotal) AS goods, SUM(offer_discount) AS offers, SUM(discount) AS coupons,
      SUM(manual_discount) AS manual, SUM(delivery_waived) AS delivery, SUM(wallet_discount) AS wallet FROM orders WHERE status <> 'cancelled' AND ${IN('created_at')} GROUP BY month ORDER BY month`, S);
  const [[cb]] = await q.query(`SELECT COALESCE(SUM(CASE WHEN source = 'cashback' THEN amount END), 0) AS credited, COALESCE(-SUM(CASE WHEN source = 'reversed' THEN amount END), 0) AS reversed FROM wallet_entries WHERE ${IN('created_at')}`, S);
  const [took] = await q.query(`SELECT d.source, SUM(a.amount) AS amount FROM wallet_allocations a JOIN wallet_entries d ON d.entry_id = a.debit_entry_id JOIN wallet_entries c ON c.entry_id = a.credit_entry_id
      WHERE c.source = 'cashback' AND a.given_back = 0 AND d.source IN ('used', 'expired') AND ${IN('d.created_at')} GROUP BY d.source`, S);
  const [owed] = await q.query('SELECT c.customer_no, c.name, SUM(w.amount) AS balance FROM wallet_entries w JOIN customers c ON c.customer_id = w.customer_id GROUP BY c.customer_id, c.customer_no, c.name HAVING balance > 0.005 ORDER BY balance DESC');
  const KIND = { percent: 'Percent off', fixed: 'Fixed amount off', free_delivery: 'Free delivery', slab: 'Quantity slab', bxgy: 'Buy X get Y free' };
  const rC = coupons.map((c) => ({ code: c.code, kind: KIND[c.kind], orders: n(c.orders), customers: n(c.customers), amount: n(c.amount) }));
  const rO = offers.map((o) => ({ name: o.name, kind: KIND[o.kind], orders: n(o.orders), discount: n(o.discount), free_packs: n(o.free_packs), free_value: n(o.free_value) }));
  const rM = months.map((m) => { const r = { month: m.month, orders: n(m.orders), goods: n(m.goods), offers: n(m.offers), coupons: n(m.coupons), manual: n(m.manual), delivery: n(m.delivery), wallet: n(m.wallet) }; r.all = round2(r.offers + r.coupons + r.manual + r.delivery + r.wallet); return r; });
  const rCb = [{ what: 'Cashback credited', amount: n(cb.credited) }, { what: 'Cashback used on orders', amount: n((took.find((x) => x.source === 'used') || {}).amount) }, { what: 'Cashback expired', amount: n((took.find((x) => x.source === 'expired') || {}).amount) }, { what: 'Cashback taken back (returns)', amount: n(cb.reversed) }];
  const rW = owed.map((o) => ({ customer: `${o.customer_no} ${o.name}`, balance: n(o.balance) }));
  return {
    tables: [
      { key: 'discounts', title: 'Discounts given by month', columns: [col('month', 'Month'), col('orders', 'Orders', 'num'), col('goods', 'Goods', 'money'), col('offers', 'Offers', 'money'), col('coupons', 'Coupons', 'money'), col('manual', 'Manual', 'money'), col('delivery', 'Delivery waived', 'money'), col('wallet', 'Wallet as discount', 'money'), col('all', 'All', 'money')], rows: rM, totals: sumRows(rM, ['orders', 'goods', 'offers', 'coupons', 'manual', 'delivery', 'wallet', 'all']) },
      { key: 'coupons', title: 'Coupons used', columns: [col('code', 'Coupon'), col('kind', 'Type'), col('orders', 'Orders', 'num'), col('customers', 'Customers', 'num'), col('amount', 'Discount', 'money')], rows: rC, totals: sumRows(rC, ['orders', 'customers', 'amount']) },
      { key: 'offers', title: 'Offers used', columns: [col('name', 'Offer'), col('kind', 'Type'), col('orders', 'Orders', 'num'), col('discount', 'Discount', 'money'), col('free_packs', 'Free packs', 'num'), col('free_value', 'Free packs at list price', 'money')], rows: rO, totals: sumRows(rO, ['orders', 'discount', 'free_packs', 'free_value']) },
      { key: 'cashback', title: 'Cashback in the period', columns: [col('what', 'What'), col('amount', 'Amount', 'money')], rows: rCb, totals: {} },
      { key: 'wallets', title: 'Wallet balance owed to customers (now)', columns: [col('customer', 'Customer'), col('balance', 'Balance', 'money')], rows: rW, totals: sumRows(rW, ['balance']) },
    ],
    chart: rM.length ? { kind: 'hbar', x: ['Offers', 'Coupons', 'Manual', 'Delivery waived', 'Wallet as discount'], series: [{ name: 'Discount', values: ['offers', 'coupons', 'manual', 'delivery', 'wallet'].map((k) => sumRows(rM, [k])[k]) }], title: 'Discounts by kind' } : null,
    checks: [], notes: ['Orders entered in the period; the wallet balance is as of now.'],
  };
}

// ---------------------------------------------------------------- business view (Operations, Admin)
async function business(q) {
  const today = istToday();
  const month = { from: `${today.slice(0, 8)}01`, to: today };
  const facts = await salesFacts(q, month);
  const todayTotal = round2(facts.filter((f) => f.day === today).reduce((a, f) => a + f.total, 0));
  const monthTotal = round2(facts.reduce((a, f) => a + f.total, 0));
  const m = await margin(q, month);
  const [[due]] = await q.query("SELECT COALESCE(SUM(amount_due), 0) AS n FROM orders WHERE status <> 'cancelled' AND amount_due > 0.005");
  const [[sv]] = await q.query("SELECT COALESCE(SUM(m.delta * COALESCE(s.avg_cost, 0)), 0) AS v FROM stock_movements m JOIN skus s ON s.sku_code = m.sku_code WHERE m.stock_kind = 'good'");
  const info = await skuInfo(q);
  const bySku = new Map(); const byCust = new Map();
  for (const f of facts) {
    if (!f.sku_code.startsWith('(')) bySku.set(f.sku_code, round2((bySku.get(f.sku_code) || 0) + f.total));
    byCust.set(`${f.customer_no} ${f.customer}`, round2((byCust.get(`${f.customer_no} ${f.customer}`) || 0) + f.total));
  }
  const top = (map, label) => [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => ({ name: label(k), total: v }));
  return { today: todayTotal, month: monthTotal, monthFrom: month.from, margin: m.tables[0].totals.margin, marginPct: m.tables[0].totals.pct, outstanding: round2(due.n), stockValue: round2(sv.v),
    topSkus: top(bySku, (k) => { const s = info.get(k); return s ? `${k} ${s.name} ${s.size_label}` : k; }), topCustomers: top(byCust, (k) => k), wallet: await walletOwed(q) };
}
async function walletOwed(q) { const [rows] = await q.query('SELECT customer_id FROM wallet_entries GROUP BY customer_id'); let t = 0; for (const r of rows) { const b = await wallet.balance(q, r.customer_id); if (b > 0) t += b; } return round2(t); }

// ---------------------------------------------------------------- accounting journal (CSV)
/** sales, receipts, credit notes, refunds and wallet use as balanced journal vouchers -> [{ date, type, no, party, gstin, ledger, debit, credit, narration }] */
async function journal(q, p) {
  const S = span(p);
  const lines = [];
  const add = (v, ledger, dr, cr, narration = '') => { if (Math.abs(dr) < 0.005 && Math.abs(cr) < 0.005) return; lines.push({ ...v, ledger, debit: dr ? round2(dr) : '', credit: cr ? round2(cr) : '', narration }); };
  const party = (r) => `${r.customer_no} ${r.customer}`;
  const [inv] = await q.query(`SELECT i.invoice_no, ${istDate('i.issued_at')} AS day, i.taxable, i.cgst, i.sgst, i.igst, i.round_off, i.total, i.buyer_json, o.order_no, o.wallet_used - o.wallet_discount AS wallet_paid, c.customer_no, c.name AS customer
      FROM invoices i JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id WHERE ${IN('i.issued_at')} ORDER BY i.issued_at`, S);
  const d10 = (d) => (typeof d === 'string' ? d : d.toISOString().slice(0, 10));
  for (const r of inv) {
    const b = (typeof r.buyer_json === 'string' ? JSON.parse(r.buyer_json) : r.buyer_json).bill;
    const v = { date: d10(r.day), type: 'Sales', no: r.invoice_no, party: party(r), gstin: b.gstin || '' };
    add(v, `Sundry debtors - ${party(r)}`, Number(r.total), 0, `Order ${r.order_no}`);
    add(v, 'Sales', 0, Number(r.taxable)); add(v, 'Output CGST', 0, Number(r.cgst)); add(v, 'Output SGST', 0, Number(r.sgst)); add(v, 'Output IGST', 0, Number(r.igst));
    if (Number(r.round_off) > 0) add(v, 'Round off', 0, Number(r.round_off)); else if (Number(r.round_off) < 0) add(v, 'Round off', -Number(r.round_off), 0);
    if (Number(r.wallet_paid) > 0.005) { const w = { ...v, type: 'Journal (wallet)', no: `${r.invoice_no}/W` }; add(w, 'Customer wallets (liability)', Number(r.wallet_paid), 0, `Paid from the wallet on ${r.order_no}`); add(w, `Sundry debtors - ${party(r)}`, 0, Number(r.wallet_paid)); }
  }
  const [cns] = await q.query(`SELECT cn.credit_note_no, ${istDate('cn.issued_at')} AS day, cn.taxable, cn.cgst, cn.sgst, cn.igst, cn.round_off, cn.total, cn.reason, i.invoice_no, i.buyer_json, c.customer_no, c.name AS customer
      FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id WHERE ${IN('cn.issued_at')} ORDER BY cn.issued_at`, S);
  for (const r of cns) {
    const b = (typeof r.buyer_json === 'string' ? JSON.parse(r.buyer_json) : r.buyer_json).bill;
    const v = { date: d10(r.day), type: 'Credit note', no: r.credit_note_no, party: party(r), gstin: b.gstin || '' };
    add(v, 'Sales returns', Number(r.taxable), 0, `Against ${r.invoice_no}: ${r.reason}`); add(v, 'Output CGST', Number(r.cgst), 0); add(v, 'Output SGST', Number(r.sgst), 0); add(v, 'Output IGST', Number(r.igst), 0);
    if (Number(r.round_off) > 0) add(v, 'Round off', Number(r.round_off), 0); else if (Number(r.round_off) < 0) add(v, 'Round off', 0, -Number(r.round_off));
    add(v, `Sundry debtors - ${party(r)}`, 0, Number(r.total));
  }
  const [pays] = await q.query(`SELECT p.payment_id, p.kind, p.mode, p.amount, DATE_FORMAT(p.received_on, '%Y-%m-%d') AS day, p.reference, o.order_no, c.customer_no, c.name AS customer
      FROM payments p JOIN orders o ON o.order_id = p.order_id JOIN customers c ON c.customer_id = o.customer_id WHERE p.received_on BETWEEN ? AND ? ORDER BY p.received_on, p.payment_id`, [p.from, p.to]);
  for (const r of pays) {
    const cash = r.mode === 'cash' ? 'Cash' : `Bank (${commerce.MODES[r.mode] || r.mode})`;
    const v = { date: r.day, type: r.kind === 'refund' ? 'Payment (refund)' : 'Receipt', no: `RCPT-${r.payment_id}`, party: party(r), gstin: '' };
    if (r.kind === 'refund') { add(v, `Sundry debtors - ${party(r)}`, Number(r.amount), 0, `Refund on ${r.order_no}${r.reference ? `, ${r.reference}` : ''}`); add(v, cash, 0, Number(r.amount)); } else { add(v, cash, Number(r.amount), 0, `${r.order_no}${r.reference ? `, ${r.reference}` : ''}`); add(v, `Sundry debtors - ${party(r)}`, 0, Number(r.amount)); }
  }
  const [wr] = await q.query(`SELECT f.refund_id, ${istDate('f.paid_at')} AS day, f.amount, r.return_no, c.customer_no, c.name AS customer FROM refunds f JOIN returns r ON r.return_id = f.return_id JOIN orders o ON o.order_id = f.order_id
      JOIN customers c ON c.customer_id = o.customer_id WHERE f.method = 'wallet' AND f.status = 'paid' AND ${IN('f.paid_at')}`, S);
  for (const r of wr) { const v = { date: d10(r.day), type: 'Journal (wallet)', no: `REF-${r.refund_id}`, party: party(r), gstin: '' }; add(v, `Sundry debtors - ${party(r)}`, Number(r.amount), 0, `Refund to the wallet, return ${r.return_no}`); add(v, 'Customer wallets (liability)', 0, Number(r.amount)); }
  return lines;
}

module.exports = { SALES_GROUPS, MARGIN_BY, STOCK_VIEWS, previous, salesFacts, sales, gst, margin, stockReport, receivables, deliveryReport, returnsReport, promotionsReport, business, journal };
