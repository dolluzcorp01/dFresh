// GST (phase 21, v23 viewGstr / viewEinv / viewEwb; API /gst/* in money-routes.js, figures from reports.gst and
// billing.gstr3b). GSTR-1 / GSTR-3B data per month for the CA: the 3B summary (output = invoices - credit notes + debit
// notes; input = the month's supplier bills plus the ITC on expenses (phase 23, its own rows and month total); to pay =
// output - input, a negative is credit carried forward), then the
// GSTR-1 registers (B2B, B2C, credit and debit notes, HSN summary) and the CSV for the CA. E-invoice: B2B invoices with
// their IRN (typed from the portal; no live connection yet). E-way bill: invoices above the limit (alone or as the
// day's load to one customer from one godown) with the number, valid until and the vehicle.
import { useState } from 'react';
import { api } from './adminApi';
import { Alert, LIcon, Loading, PageHead, Pill, Table, money, useAction, useLoad } from './ui';

const enc = encodeURIComponent;
const invLink = (no) => <a href={`/admin/invoices?open=${enc(no)}`}><b className="a-mono">{no}</b></a>;

export function GstMonth() {
  const [m, setM] = useState('');
  const data = useLoad(`/gst/month${m ? `?month=${m}` : ''}`);
  const act = useAction();
  const d = data.data;
  const T = (k) => (d ? d.tables.find((t) => t.key === k) : null);
  const exp = () => act.run(async () => { await api.download(`/gst/month.csv?month=${d.month}`, `dfresh-gst-${d.month}.csv`); });
  const tax = (o) => money(Math.round((o.igst + o.cgst + o.sgst) * 100) / 100);
  const b2b = T('b2b'); const b2cl = T('b2cl'); const b2cs = T('b2cs'); const cdnr = T('cdnr'); const cdnur = T('cdnur'); const hsn = T('hsn');
  return (
    <section>
      <PageHead sub="Monthly sales and tax figures for the CA" rules={['From invoices, credit and debit notes made here', 'The CA files in Tally', 'Old invoices before this system are not in it']}
        actions={d && d.can.export && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={exp}><LIcon name="download" size="sm" />Export for the CA</button>} />
      {act.note}
      <Loading state={data}>{d && <>
        <div className="a-card a-p21-fcard"><div className="a-p18-filters">
          <label className="a-p20-fi"><LIcon name="calendar" size="sm" /><select aria-label="Month" value={d.month} onChange={(e) => setM(e.target.value)}>{d.months.map((x) => <option key={x} value={x}>{x}</option>)}</select></label>
          <span className="a-hint-s">{d.counts.invoices} invoices, {d.counts.credit_notes} credit notes, {d.counts.debit_notes} debit notes</span>
        </div></div>
        <div className="a-card a-p21-card">
          <div className="a-p21-ch"><h2>GSTR-3B summary</h2></div>
          <table className="a-table"><thead><tr><th /><th className="a-num">Taxable</th><th className="a-num">IGST</th><th className="a-num">CGST</th><th className="a-num">SGST</th><th className="a-num">Total tax</th></tr></thead>
            <tbody>
              <tr><td><b>Output (sales less credit notes)</b></td><td className="a-num">{money(d.gstr3b.output.taxable)}</td><td className="a-num">{money(d.gstr3b.output.igst)}</td><td className="a-num">{money(d.gstr3b.output.cgst)}</td><td className="a-num">{money(d.gstr3b.output.sgst)}</td><td className="a-num"><b>{tax(d.gstr3b.output)}</b></td></tr>
              {d.gstr3b.input.parts && <tr><td>{`Input: supplier bills (${d.gstr3b.input.parts.bills.count} bill${d.gstr3b.input.parts.bills.count === 1 ? "" : "s"})`}</td><td className="a-num">{money(d.gstr3b.input.parts.bills.taxable)}</td><td className="a-num">{money(d.gstr3b.input.parts.bills.igst)}</td><td className="a-num">{money(d.gstr3b.input.parts.bills.cgst)}</td><td className="a-num">{money(d.gstr3b.input.parts.bills.sgst)}</td><td className="a-num">{money(d.gstr3b.input.parts.bills.tax)}</td></tr>}
              {d.gstr3b.input.parts && <tr><td>{`Input: ITC on expenses (${d.gstr3b.input.parts.expenses.count} expense${d.gstr3b.input.parts.expenses.count === 1 ? "" : "s"})`}</td><td className="a-num">{money(d.gstr3b.input.parts.expenses.taxable)}</td><td className="a-num">{money(d.gstr3b.input.parts.expenses.igst)}</td><td className="a-num">{money(d.gstr3b.input.parts.expenses.cgst)}</td><td className="a-num">{money(d.gstr3b.input.parts.expenses.sgst)}</td><td className="a-num">{money(d.gstr3b.input.parts.expenses.tax)}</td></tr>}
              <tr><td><b>Input total</b></td><td className="a-num">{money(d.gstr3b.input.taxable)}</td><td className="a-num">{money(d.gstr3b.input.igst)}</td><td className="a-num">{money(d.gstr3b.input.cgst)}</td><td className="a-num">{money(d.gstr3b.input.sgst)}</td><td className="a-num"><b>{tax(d.gstr3b.input)}</b></td></tr>
              <tr><td><b>To pay (output less input)</b></td><td /><td className="a-num">{money(d.gstr3b.to_pay.igst)}</td><td className="a-num">{money(d.gstr3b.to_pay.cgst)}</td><td className="a-num">{money(d.gstr3b.to_pay.sgst)}</td><td className="a-num"><b>{money(d.gstr3b.to_pay.tax)}</b></td></tr>
            </tbody></table>
          <p className="a-hint-s a-p21-pad">A negative &quot;to pay&quot; is credit carried forward. The CA sets IGST against CGST and SGST in the return. Input includes the GST on recorded expenses that can be claimed (a supplier GSTIN and a head that allows it), listed below.</p>
        </div>
        <div className="a-card a-p21-card">
          <div className="a-p21-ch"><h2>ITC on expenses</h2><Pill tone="gray">{(d.itc_expenses || []).length}</Pill></div>
          {(d.itc_expenses || []).length ? <table className="a-table"><thead><tr><th>Expense</th><th>Date</th><th>Payee and head</th><th>GSTIN</th><th className="a-num">Rate</th><th className="a-num">Taxable</th><th className="a-num">GST (ITC)</th></tr></thead>
            <tbody>{d.itc_expenses.map((x) => <tr key={x.expense_no}><td className="a-mono">{x.expense_no}</td><td>{x.date}</td><td><b>{x.payee_name}</b><small className="a-muted a-p15-sub">{x.head}{x.inter_state ? ' · IGST' : ''}</small></td><td className="a-mono">{x.gstin}</td><td className="a-num">{x.gst_rate}%</td><td className="a-num">{money(x.amount)}</td><td className="a-num">{money(x.gst_amount)}</td></tr>)}</tbody>
            <tfoot><tr><td><b>Month total</b></td><td /><td /><td /><td /><td className="a-num"><b>{money(d.gstr3b.input.parts.expenses.taxable)}</b></td><td className="a-num"><b>{money(d.gstr3b.input.parts.expenses.tax)}</b></td></tr></tfoot></table>
            : <p className="a-hint-s a-p21-pad">No recorded expense with claimable GST this month (Money &gt; Expenses).</p>}
        </div>
        <div className="a-card a-p21-card">
          <div className="a-p21-ch"><h2>GSTR-1: B2B</h2><Pill tone="gray">{b2b.rows.length}</Pill></div>
          {b2b.rows.length ? <table className="a-table"><thead><tr><th>GSTIN</th><th>Invoice</th><th>Date</th><th>Place</th><th className="a-num">Value</th><th className="a-num">Rate</th><th className="a-num">Taxable</th><th className="a-num">Tax</th></tr></thead>
            <tbody>{b2b.rows.map((x, i) => <tr key={i}><td className="a-mono">{x.gstin}</td><td>{invLink(x.doc)}</td><td>{x.date}</td><td>{x.pos}</td><td className="a-num">{money(x.value)}</td><td className="a-num">{x.rate}%</td><td className="a-num">{money(x.taxable)}</td><td className="a-num">{tax(x)}</td></tr>)}</tbody></table>
            : <p className="a-hint-s a-p21-pad">None this month.</p>}
        </div>
        <div className="a-card a-p21-card">
          <div className="a-p21-ch"><h2>GSTR-1: B2C</h2></div>
          <table className="a-table"><thead><tr><th>Kind</th><th>Place</th><th className="a-num">Rate</th><th className="a-num">Taxable</th></tr></thead>
            <tbody>{b2cl.rows.map((x, i) => <tr key={`l${i}`}><td>Large: {x.doc}</td><td>{x.pos}</td><td className="a-num">{x.rate}%</td><td className="a-num">{money(x.taxable)}</td></tr>)}
              {b2cs.rows.map((x, i) => <tr key={`s${i}`}><td>Small (summary)</td><td>{x.pos}</td><td className="a-num">{x.rate}%</td><td className="a-num">{money(x.taxable)}</td></tr>)}
              {!b2cl.rows.length && !b2cs.rows.length && <tr><td colSpan={4} className="a-muted">None this month.</td></tr>}</tbody></table>
        </div>
        <div className="a-card a-p21-card">
          <div className="a-p21-ch"><h2>GSTR-1: credit and debit notes</h2></div>
          <table className="a-table"><thead><tr><th>Note</th><th>Customer GSTIN</th><th>Type</th><th className="a-num">Taxable</th><th className="a-num">Tax</th></tr></thead>
            <tbody>{[...cdnr.rows, ...cdnur.rows].map((x, i) => <tr key={i}><td className="a-mono">{x.doc}</td><td className="a-mono">{x.gstin || 'B2C'}</td><td>{x.note_type === 'D' ? 'Debit' : 'Credit'}</td><td className="a-num">{money(x.taxable)}</td><td className="a-num">{tax(x)}</td></tr>)}
              {!cdnr.rows.length && !cdnur.rows.length && <tr><td colSpan={5} className="a-muted">None this month{b2cs.rows.length ? ' (notes to small B2C buyers are netted in B2C above)' : ''}.</td></tr>}</tbody></table>
        </div>
        <div className="a-card a-p21-card">
          <div className="a-p21-ch"><h2>HSN summary</h2></div>
          <table className="a-table"><thead><tr><th>HSN</th><th className="a-num">Rate</th><th className="a-num">Packs</th><th className="a-num">Taxable</th><th className="a-num">IGST</th><th className="a-num">CGST</th><th className="a-num">SGST</th></tr></thead>
            <tbody>{hsn.rows.map((x, i) => <tr key={i}><td className="a-mono">{x.hsn}</td><td className="a-num">{x.rate}%</td><td className="a-num">{x.qty}</td><td className="a-num">{money(x.taxable)}</td><td className="a-num">{money(x.igst)}</td><td className="a-num">{money(x.cgst)}</td><td className="a-num">{money(x.sgst)}</td></tr>)}
              {!hsn.rows.length && <tr><td colSpan={7} className="a-muted">None this month.</td></tr>}</tbody></table>
        </div>
        {d.checks.some((c) => !c.ok) && <Alert tone="bad" title="A check does not add up.">{d.checks.filter((c) => !c.ok).map((c) => `${c.label}: ${c.detail}`).join('; ')}</Alert>}
      </>}</Loading>
    </section>
  );
}

export function EInvoice() {
  const data = useLoad('/gst/papers');
  const d = data.data;
  const cols = [
    { key: 'no', label: 'Invoice', render: (v) => <>{invLink(v.invoice_no)}<small className="a-muted a-p15-sub">{v.day}</small></> },
    { key: 'customer', label: 'Customer' },
    { key: 'total', label: 'Total', num: true, render: (v) => money(v.total) },
    { key: 'irn', label: 'IRN', render: (v) => (v.irn ? <span className="a-mono a-p21-sm">{v.irn.slice(0, 16)}...</span> : v.needed ? <Pill tone="bad">Needed</Pill> : <span className="a-muted">-</span>) },
  ];
  return (
    <section>
      <PageHead sub="Government invoice number for bills" />
      <Loading state={data}>{d && <>
        <Alert tone={d.rules.einvoice ? 'warn' : 'info'} title={`E-invoice is ${d.rules.einvoice ? 'ON' : 'OFF'}.`}>{d.rules.einvoice ? 'Every B2B invoice needs its IRN before printing and before the goods leave.' : 'Needed once yearly turnover crosses Rs 5 crore. Switch it on in Admin > Switches.'} The IRN is typed from the government portal for now; no live connection.</Alert>
        <div className="a-listcard"><Table columns={cols} rows={d.einv} rowKey={(v) => v.invoice_no} label="E-invoice" empty={{ icon: 'file-text', title: 'No B2B invoice', text: 'B2B invoices show here.' }} /></div>
      </>}</Loading>
    </section>
  );
}

export function EwayBill() {
  const data = useLoad('/gst/papers');
  const d = data.data;
  const cols = [
    { key: 'no', label: 'Invoice', render: (v) => <>{invLink(v.invoice_no)}<small className="a-muted a-p15-sub">{v.day}</small></> },
    { key: 'customer', label: 'Customer' },
    { key: 'total', label: 'Total', num: true, render: (v) => money(v.total) },
    { key: 'ewb', label: 'E-way bill', render: (v) => (v.ewb_no ? <><span className="a-mono">{v.ewb_no}</span>{v.ewb_valid && <small className="a-muted a-p15-sub">valid until {v.ewb_valid}{v.ended && <> <Pill tone="bad">Ended</Pill></>}</small>}</> : <><Pill tone="bad">Needed</Pill>{v.why && <small className="a-muted a-p15-sub">{v.why}</small>}</>) },
    { key: 'veh', label: 'Vehicle', render: (v) => v.vehicle || '-' },
  ];
  return (
    <section>
      <PageHead sub="Permit for moving goods above the limit" rules={d ? [`Needed above ${money(d.rules.limit)} (with GST)`, "One customer's invoices from one godown on one day count together", 'Before the goods leave'] : []} />
      <Loading state={data}>{d && <>
        {!d.rules.eway && <Alert tone="info" title="E-way bill rule is OFF">(Admin &gt; Switches).</Alert>}
        <div className="a-listcard"><Table columns={cols} rows={d.ewb} rowKey={(v) => v.invoice_no} label="E-way bill" empty={{ icon: 'truck', title: 'No invoice above the limit', text: `Invoices above ${money(d.rules.limit)} show here.` }} /></div>
      </>}</Loading>
    </section>
  );
}
