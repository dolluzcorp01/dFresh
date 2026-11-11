// Sales > Customers > Customer ledger (phase 19, v23 viewCLedger; API /commerce/customers/:id/statement, customers.js
// statement). Pick a customer you see (godowns and own customers only): every invoice, payment, credit note and refund by
// date with the running balance, what is still open with its due date (overdue in red) and the ageing; the statement as
// a PDF to print, or mailed through the Outbox (phase 20). Receipts per customer and the rest of the money pages come with sections 10 and 11.
import { useState } from 'react';
import { api } from './adminApi';
import { LIcon, useAction, useLoad, useToast, Loading, PageHead, Pill, money } from './ui';
import { In } from './buyShared';

export default function CustomerLedger() {
  const list = useLoad('/sales/credit');
  const [id, setId] = useState('');
  const rows = list.data ? list.data.rows : [];
  const cur = id || (rows[0] ? String(rows[0].customer_id) : '');
  const st = useLoad(cur ? `/commerce/customers/${cur}/statement` : null);
  const s = st.data;
  const act = useAction();
  const toast = useToast();
  const mail = () => act.run(async () => { // phase 20: the statement as a PDF, prepared in the Outbox
    const r = await api.send('POST', `/sales/customers/${cur}/mail-statement`);
    if (r.queued) toast('good', 'Mail prepared', `The statement (PDF) to ${r.to}, in Admin > Communications > Outbox.`); else toast('warn', 'Not mailed', r.skip || 'No e-mail address.');
  });
  return (
    <section>
      <PageHead sub="Every invoice, payment and note of a customer, with the balance" />
      <Loading state={list}>
        <div className="a-listcard">
          <div className="a-p18-filters">
            <In label="Customer" box="a-p19-pick"><select value={cur} onChange={(e) => setId(e.target.value)}>{rows.map((c) => <option key={c.customer_id} value={String(c.customer_id)}>{c.customer_no} · {c.name}</option>)}</select></In>
            {cur && <a className="a-btn a-btn-ghost a-btn-sm" href={`/api/dfresh/admin/commerce/customers/${cur}/statement.pdf`} target="_blank" rel="noreferrer">Statement (PDF)</a>}
            {cur && <button type="button" className="a-btn a-btn-ghost a-btn-sm" disabled={act.busy} onClick={mail}><LIcon name="mail" size="sm" />Mail statement</button>}
          </div>
          {act.note}
          <Loading state={st}>{s && <>
            <div className="a-scroll"><table className="a-table"><thead><tr><th>Date</th><th>What</th><th className="a-num">Charged</th><th className="a-num">Paid or credited</th><th className="a-num">Balance</th></tr></thead>
              <tbody>{Number(s.opening) ? <tr><td /><td>Opening balance</td><td /><td /><td className="a-num"><b>{money(s.opening)}</b></td></tr> : null}
                {s.lines.map((l, i) => <tr key={i}><td className="a-p18-nowrap">{l.day}</td><td>{l.text}</td><td className="a-num">{l.debit ? money(l.debit) : ''}</td><td className="a-num">{l.credit ? money(l.credit) : ''}</td><td className="a-num"><b>{money(l.balance)}</b></td></tr>)}
                {!s.lines.length && <tr><td colSpan={5} className="a-muted">Nothing yet.</td></tr>}</tbody></table></div>
            <h3 className="a-h3s">Open invoices</h3>
            <div className="a-scroll"><table className="a-table"><thead><tr><th>Invoice</th><th>Order</th><th>Due</th><th className="a-num">Owes</th></tr></thead>
              <tbody>{s.open.map((o) => <tr key={o.invoice_no}><td className="a-mono">{o.invoice_no}</td><td className="a-mono">{o.order_no}</td><td>{o.due_on} {o.overdue && <Pill tone="bad">Overdue</Pill>}</td><td className="a-num">{money(o.amount_due)}</td></tr>)}
                {!s.open.length && <tr><td colSpan={4} className="a-muted">Nothing open.</td></tr>}</tbody></table></div>
            <div className="a-scroll"><table className="a-table"><thead><tr><th className="a-num">Owes</th><th className="a-num">Not due</th><th className="a-num">1-30 days late</th><th className="a-num">31-60</th><th className="a-num">61-90</th><th className="a-num">90+</th></tr></thead>
              <tbody><tr><td className="a-num"><b>{money(s.outstanding)}</b></td><td className="a-num">{money(s.ageing.not_due)}</td><td className="a-num">{money(s.ageing.d1_30)}</td><td className="a-num">{money(s.ageing.d31_60)}</td><td className="a-num">{money(s.ageing.d61_90)}</td><td className="a-num">{money(s.ageing.d90)}</td></tr></tbody></table></div>
          </>}</Loading>
        </div>
      </Loading>
    </section>
  );
}
