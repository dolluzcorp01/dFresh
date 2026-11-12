// Export to the accountant (phase 23, v23 "TALLY EXPORT", vchOf / exportChecks / tallyXml; migration 20261113_stage2_23_02).
// - The vouchers of a finished month: everything the journal has (sales invoices, credit and debit notes, receipts,
//   refunds, bounced cheques, charges and waivers, bad debts, wallet), plus purchases (supplier bills), payments to
//   suppliers, expenses (their head's ledger; claimable GST to input GST; paid from bank, cash or petty cash) and petty
//   cash top-ups. Ledger names come from tally_ledgers (Ledger names in Tally) and the expense heads; parties by name.
// - A voucher is a list of [ledger, amount]: a debit is negative, a credit positive (Tally style); every voucher balances.
// - Only a finished month with nothing waiting is exported (books.exportChecks, v23 Y1 / T2), and no expense of it may
//   still be a draft or waiting. Exporting writes the Tally import XML and the voucher CSV, keeps both in month_exports
//   (Export history downloads them again) and locks the month. Exporting a month again sends what is new (Create), what
//   changed (Alter) and what is gone (Delete), each voucher with its own id, so Tally never gets one twice.
const crypto = require('crypto');
const { audit } = require('./audit');
const books = require('./books');
const reports = require('./reports');

class TallyError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

async function ledgerNames(q) {
  const [rows] = await q.query('SELECT ledger_key, label, name FROM tally_ledgers ORDER BY sort_order');
  const [heads] = await q.query('SELECT head_key, name, ledger FROM expense_heads ORDER BY sort_order');
  return { map: Object.fromEntries(rows.map((r) => [r.ledger_key, r.name])), rows, heads };
}
/** save the names (Export right); an empty one is refused */
async function saveNames(q, body, empId) {
  const { rows, heads } = await ledgerNames(q);
  const bad = [];
  for (const r of rows) { const v = body.ledgers && body.ledgers[r.ledger_key]; if (v !== undefined && !String(v).trim()) bad.push(r.label); }
  for (const h of heads) { const v = body.heads && body.heads[h.head_key]; if (v !== undefined && !String(v).trim()) bad.push(`Expense: ${h.name}`); }
  if (bad.length) throw new TallyError(`A ledger name cannot be empty: ${bad.join(', ')}`, 400);
  for (const r of rows) { const v = body.ledgers && body.ledgers[r.ledger_key]; if (v !== undefined) await q.query('UPDATE tally_ledgers SET name = ? WHERE ledger_key = ?', [String(v).trim().slice(0, 60), r.ledger_key]); }
  for (const h of heads) { const v = body.heads && body.heads[h.head_key]; if (v !== undefined) await q.query('UPDATE expense_heads SET ledger = ? WHERE head_key = ?', [String(v).trim().slice(0, 60), h.head_key]); }
  await audit(q, { empId, action: 'update', entity: 'tally_ledgers', after: body });
  return { message: 'The next export uses these names.' };
}

const TYPE = (t) => (/^Sales \(cancelled\)/.test(t) ? 'Credit Note' : /^Sales/.test(t) ? 'Sales' : /^Credit note/.test(t) ? 'Credit Note' : /^Debit note/.test(t) ? 'Debit Note'
  : /^Receipt/.test(t) ? 'Receipt' : /^Payment/.test(t) ? 'Payment' : 'Journal');
/** the month's vouchers -> [{ type, no, date, party, narr, ents: [[ledger, amount]] }] */
async function vouchers(q, month) {
  const from = `${month}-01`; const to = books.lastDay(month);
  const { map: T, heads } = await ledgerNames(q);
  const ledger = (l) => {
    if (/^Sundry debtors - /.test(l)) return l.replace(/^Sundry debtors - \S+ /, '');
    if (/^Bank \(/.test(l)) return T.bank;
    return { Sales: T.sales, 'Output CGST': T.cgst, 'Output SGST': T.sgst, 'Output IGST': T.igst, Cash: T.cash, 'Round off': T.round, 'Sales returns': T.sales,
      'Customer wallets (liability)': T.walletliab, 'Bad debts written off': T.baddebt, 'Bank charges recovered': T.charges }[l] || l;
  };
  const out = new Map();
  for (const x of await reports.journal(q, { from, to, scope: null })) {
    const k = `${x.type}|${x.no}`;
    const v = out.get(k) || { type: TYPE(x.type), no: x.no, date: x.date, party: x.party ? x.party.replace(/^\S+ /, '') : '', narr: '', ents: [] };
    if (x.narration && !v.narr) v.narr = x.narration;
    v.ents.push([ledger(x.ledger), r2(-(Number(x.debit) || 0) + (Number(x.credit) || 0))]);
    out.set(k, v);
  }
  const V = [...out.values()];
  const d10 = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10));
  // purchases: supplier bills (posted)
  const [bills] = await q.query(`SELECT b.bill_no, b.supplier_bill_no, b.bill_date, b.taxable, b.freight, b.gst, b.inter_state, b.round_off, b.total, s.name FROM supplier_bills b JOIN suppliers s ON s.supplier_id = b.supplier_id
      WHERE b.status IN ('unpaid', 'paid') AND b.bill_date BETWEEN ? AND ? ORDER BY b.bill_date, b.bill_id`, [from, to]);
  for (const b of bills) {
    const gst = Number(b.gst); const half = r2(gst / 2); const inter = Number(b.inter_state) === 1;
    V.push({ type: 'Purchase', no: b.bill_no, date: d10(b.bill_date), party: b.name, narr: `Supplier bill ${b.supplier_bill_no || ''}`.trim(),
      ents: [[T.purchase, -r2(Number(b.taxable) + Number(b.freight || 0))], [T.icgst, inter ? 0 : -half], [T.isgst, inter ? 0 : -r2(gst - half)], [T.iigst, inter ? -gst : 0], [T.round, -Number(b.round_off || 0)], [b.name, Number(b.total)]] });
  }
  const [pays] = await q.query(`SELECT p.pay_no, p.amount, p.mode, p.reference, p.paid_on, s.name FROM supplier_payments p JOIN suppliers s ON s.supplier_id = p.supplier_id
      WHERE p.status = 'paid' AND p.paid_on BETWEEN ? AND ? ORDER BY p.paid_on, p.pay_id`, [from, to]);
  for (const p of pays) V.push({ type: 'Payment', no: p.pay_no, date: d10(p.paid_on), party: p.name, narr: `Ref ${p.reference || ''}`.trim(), ents: [[p.name, -Number(p.amount)], [p.mode === 'cash' ? T.cash : T.bank, Number(p.amount)]] });
  const [exps] = await q.query(`SELECT e.expense_no, e.exp_date, e.head_key, e.payee_name, e.amount, e.gst_amount, e.total, e.itc, e.inter_state, e.mode, e.note FROM expenses e
      WHERE e.status = 'done' AND e.exp_date BETWEEN ? AND ? ORDER BY e.exp_date, e.expense_id`, [from, to]);
  for (const e of exps) {
    const h = heads.find((x) => x.head_key === e.head_key) || { name: e.head_key, ledger: e.head_key };
    const itc = Number(e.itc) === 1; const inter = Number(e.inter_state) === 1; const g = Number(e.gst_amount); const half = r2(g / 2);
    const pay = e.mode === 'petty' ? T.petty : e.mode === 'cash' ? T.cash : T.bank;
    V.push({ type: 'Payment', no: e.expense_no, date: d10(e.exp_date), party: e.payee_name, narr: `${h.name}: ${e.payee_name}${e.note ? `, ${e.note}` : ''}`,
      ents: [[h.ledger, -(itc ? Number(e.amount) : Number(e.total))], [T.icgst, itc && !inter ? -half : 0], [T.isgst, itc && !inter ? -r2(g - half) : 0], [T.iigst, itc && inter ? -g : 0], [pay, Number(e.total)]] });
  }
  const [tops] = await q.query(`SELECT m.move_id, m.godown_id, m.move_date, m.amount, g.name FROM petty_moves m JOIN locations g ON g.location_id = m.godown_id
      WHERE m.kind = 'topup' AND m.status = 'done' AND m.move_date BETWEEN ? AND ?`, [from, to]);
  for (const t of tops) V.push({ type: 'Contra', no: `PT-${t.godown_id}-${t.move_id}`, date: d10(t.move_date), party: '', narr: `Petty cash top-up, ${t.name}`, ents: [[T.petty, -Number(t.amount)], [T.bank, Number(t.amount)]] });
  // every voucher balances: a paisa difference goes to round off; zero lines go
  for (const v of V) {
    const s = r2(v.ents.reduce((a, e) => a + e[1], 0));
    if (Math.abs(s) >= 0.005 && Math.abs(s) < 1) v.ents.push([T.round, -s]);
    v.ents = v.ents.filter((e) => Math.abs(e[1]) >= 0.005).map((e) => [e[0], r2(e[1])]);
    v.guid = ['DFRESH', v.type.replace(/\s/g, ''), String(v.no).replace(/\s/g, ''), v.date.replace(/-/g, '')].join('-');
    v.hash = crypto.createHash('sha1').update(`${v.date}|${v.ents.map((e) => `${e[0]}:${e[1].toFixed(2)}`).join(';')}`).digest('hex').slice(0, 16);
  }
  return V.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.no).localeCompare(String(b.no))));
}

/** why the month cannot go to the CA now ([] = it can), as v23 exportChecks; exported once: "again" is allowed */
async function checks(q, month, { again = false } = {}) {
  const out = (await books.exportChecks(q, month)).filter((x) => !(again && / was exported on /.test(x)));
  const [x] = await q.query("SELECT expense_no, status FROM expenses WHERE status IN ('draft', 'waiting') AND DATE_FORMAT(exp_date, '%Y-%m') = ? ORDER BY expense_id", [month]);
  if (x.length) out.push(`${x.length} expense${x.length === 1 ? '' : 's'} still draft or waiting: ${x.map((e) => e.expense_no).join(', ')}.`);
  if (!books.isMonth(month)) return out;
  const V = await vouchers(q, month);
  const unb = V.filter((v) => Math.abs(v.ents.reduce((a, e) => a + e[1], 0)) >= 0.005);
  if (unb.length) out.push(`Debits and credits differ on ${unb.map((v) => v.no).join(', ')}.`);
  return out;
}

const xmlEsc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function xmlOf(V, company) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>\n <BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${xmlEsc(company)}</SVCURRENTCOMPANY></STATICVARIABLES></REQUESTDESC>\n  <REQUESTDATA>\n${
    V.map((x) => `   <TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER REMOTEID="${xmlEsc(x.guid)}" VCHTYPE="${xmlEsc(x.type)}" ACTION="${x.action || 'Create'}"><GUID>${xmlEsc(x.guid)}</GUID><DATE>${x.date.replace(/-/g, '')}</DATE><VOUCHERTYPENAME>${xmlEsc(x.type)}</VOUCHERTYPENAME><VOUCHERNUMBER>${xmlEsc(x.no)}</VOUCHERNUMBER>${x.party ? `<PARTYLEDGERNAME>${xmlEsc(x.party)}</PARTYLEDGERNAME>` : ''}<NARRATION>${xmlEsc(x.narr)}</NARRATION>${
      x.ents.map((e) => `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${xmlEsc(e[0])}</LEDGERNAME><ISDEEMEDPOSITIVE>${e[1] < 0 ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE><AMOUNT>${e[1].toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>`).join('')}</VOUCHER></TALLYMESSAGE>`).join('\n')}\n  </REQUESTDATA>\n </IMPORTDATA></BODY>\n</ENVELOPE>\n`;
}
const cell = (v) => (/[",\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
function csvOf(V) {
  const rows = [['Action', 'Voucher type', 'Voucher no', 'Date', 'Party', 'Ledger', 'Debit', 'Credit', 'Narration']];
  for (const v of V) for (const e of (v.ents.length ? v.ents : [['', 0]])) rows.push([v.action || 'Create', v.type, v.no, v.date, v.party, e[0], e[1] < 0 ? (-e[1]).toFixed(2) : '', e[1] > 0 ? e[1].toFixed(2) : '', v.narr]);
  return `﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}\r\n`;
}
/** totals of a month for Export history */
function totalsOf(V) {
  const t = { sales: 0, purchases: 0, receipts: 0, payments: 0, expenses: 0, journals: 0, vouchers: V.length };
  for (const v of V) {
    const credit = r2(v.ents.filter((e) => e[1] > 0).reduce((a, e) => a + e[1], 0));
    if (v.type === 'Sales') t.sales = r2(t.sales + credit); else if (v.type === 'Purchase') t.purchases = r2(t.purchases + credit);
    else if (v.type === 'Receipt') t.receipts = r2(t.receipts + credit); else if (v.type === 'Payment') { t.payments = r2(t.payments + credit); if (/^DFX/.test(v.no)) t.expenses = r2(t.expenses + credit); } else t.journals = r2(t.journals + credit);
  }
  return t;
}

/** export (or export again) a finished month -> { month, xml_name, csv_name, xml, csv, vouchers, totals } */
async function exportMonth(q, month, empId) {
  if (!books.isMonth(month)) throw new TallyError('Month: like 2026-10', 400);
  const [[had]] = await q.query('SELECT month, totals, times FROM month_exports WHERE month = ? FOR UPDATE', [month]);
  const why = await checks(q, month, { again: Boolean(had) });
  if (why.length) throw new TallyError(`Fix first: ${why.join(' ')}`);
  const V = await vouchers(q, month);
  let send = V.map((v) => ({ ...v, action: 'Create' }));
  const prevTotals = had && had.totals ? (typeof had.totals === 'string' ? JSON.parse(had.totals) : had.totals) : null;
  if (had && prevTotals && prevTotals.sent) {
    const now = new Set(V.map((v) => v.guid));
    send = V.filter((v) => prevTotals.sent[v.guid] !== v.hash).map((v) => ({ ...v, action: prevTotals.sent[v.guid] ? 'Alter' : 'Create' }));
    for (const [g, h] of Object.entries(prevTotals.sent)) if (!now.has(g)) send.push({ type: h.split('|')[1] || 'Journal', no: g, date: `${month}-01`, party: '', narr: 'Cancelled after export', ents: [], guid: g, action: 'Delete' });
  }
  const [[co]] = await q.query('SELECT brand FROM company LIMIT 1').catch(() => [[null]]);
  const company = (co && co.brand) || 'dFresh';
  const xml = xmlOf(send, company); const csvBody = csvOf(send);
  const totals = { ...totalsOf(V), sent: Object.fromEntries(V.map((v) => [v.guid, v.hash])), sent_now: send.length };
  const xmlName = `dfresh-tally-${month}${had ? `-${Number(had.times) + 1}` : ''}.xml`; const csvName = `dfresh-vouchers-${month}${had ? `-${Number(had.times) + 1}` : ''}.csv`;
  if (had) {
    await q.query('UPDATE month_exports SET exported_at = UTC_TIMESTAMP(), exported_by = ?, file_name = ?, vouchers = ?, totals = ?, xml_name = ?, xml_body = ?, csv_body = ?, times = times + 1 WHERE month = ?',
      [empId, csvName, V.length, JSON.stringify(totals), xmlName, xml, csvBody, month]);
  } else {
    await q.query('INSERT INTO month_exports (month, exported_by, file_name, `lines`, vouchers, totals, xml_name, xml_body, csv_body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [month, empId, csvName, V.reduce((a, v) => a + v.ents.length, 0), V.length, JSON.stringify(totals), xmlName, xml, csvBody]);
  }
  await q.query("INSERT INTO export_events (month, kind, label, emp_id) VALUES (?, 'export', ?, ?)",
    [month, `${had ? 'Exported again' : 'Exported'}: ${send.length} voucher${send.length === 1 ? '' : 's'} (${xmlName}, ${csvName}); the month is locked`.slice(0, 255), empId]);
  await audit(q, { empId, action: had ? 'export_again' : 'export', entity: 'month', entityId: month, after: { vouchers: V.length, sent: send.length, xml: xmlName, csv: csvName } });
  return { month, xml_name: xmlName, csv_name: csvName, xml, csv: csvBody, vouchers: V.length, sent: send.length, totals: totalsOf(V) };
}

module.exports = { TallyError, ledgerNames, saveNames, vouchers, checks, exportMonth, xmlOf, csvOf, totalsOf };
