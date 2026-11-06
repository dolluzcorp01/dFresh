// Money > Payments (phase 21, v23 viewReceipts / viewRefunds / viewCheques, DRAWERS.rcNew / rc / rfNew / chqBnc, rcPrint;
// API /money/* in money-routes.js, rules in money.js). Decision D2: a receipt is the customer's, not an order's.
// Receipts: what customers owe (to collect, most overdue first, ageing, last reminder; Receipt, Remind, Write off),
// receipts made, and credit balances (Refund). Record receipt: customer, amount, date, how (cash, UPI, bank, cheque with
// its number, bank and date), reference, and "Set against": oldest dues first, or the invoice the customer names; an
// amount equal to one invoice's balance picks that invoice by itself. The panel shows what it settles and what stays on
// account. Refunds: a credit balance paid back (above the rule a second person signs). Cheque register: to deposit (a
// post-dated cheque waits for its date), deposited (cleared or bounced), cleared, bounced (waive the charge), issued to
// suppliers. Sales see only their own customers; supplier payments, refunds and write-offs are for the office.
import { useEffect, useMemo, useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, Tabs, money, useAction, useConfirm, useLoad, useToast } from './ui';
import { In, fe, fieldsOf } from './buyShared';
import { PrintHead, inWords } from './Billing';

const enc = encodeURIComponent;
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const custCell = (r) => <><b>{r.name || r.customer}</b><small className="a-muted a-p15-sub">{r.customer_no}</small></>;
const STATUS = { active: null, hold: ['On hold', 'warn'], blocked: ['Blocked', 'bad'] };

/** v23 settlePlan: the named item first, then the oldest */
function plan(items, amount, to) {
  const list = items.slice();
  if (to) list.sort((a, b) => (a.no === to ? 0 : 1) - (b.no === to ? 0 : 1));
  let left = r2(amount); const lines = [];
  for (const it of list) { if (left <= 0.004) break; const t = r2(Math.min(it.left, left)); lines.push({ no: it.no, amount: t, full: t >= it.left - 0.004 }); left = r2(left - t); }
  return { lines, extra: r2(left) };
}

// ---------------------------------------------------------------------------------------------------------------- Receipts
export function Receipts() {
  const data = useLoad('/money/receipts');
  const [tab, setTab] = useState('to_collect');
  const [rec, setRec] = useState(null);
  const [open, setOpen] = useState(null);
  const [print, setPrint] = useState(null);
  const [refund, setRefund] = useState(null);
  const act = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const d = data.data;
  if (print) return <ReceiptPrint no={print} onBack={() => { setPrint(null); setOpen(print); }} />;
  const remind = (c) => act.run(async () => { const out = await api.send('POST', `/money/customers/${c.customer_id}/remind`); toast(out.sent ? 'info' : 'warn', out.sent ? 'Reminder prepared' : 'Reminder not sent', out.message); data.reload(); });
  const writeOff = async (c) => {
    const ok = await confirm({ title: `Write off ${money(c.late30)} for ${c.name}?`, message: 'Dues more than 30 days late are written off as a bad debt. The customer is then blocked. Needs a second person.', action: 'Ask to write off', danger: true });
    if (ok) act.run(async () => { const out = await api.send('POST', `/money/customers/${c.customer_id}/write-off`); toast(out.waiting ? 'warn' : 'good', out.waiting ? 'Waiting for approval' : 'Written off', out.message); data.reload(); });
  };
  const owing = [
    { key: 'name', label: 'Customer', render: (c) => <>{custCell(c)}{STATUS[c.status] && <small className="a-p15-sub"><Pill tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Pill></small>}</> },
    { key: 'owes', label: 'Owes', num: true, render: (c) => <b>{money(c.owes)}</b> },
    { key: 'overdue', label: 'Overdue', num: true, render: (c) => (c.overdue > 0.004 ? <b className="a-bad">{money(c.overdue)}</b> : '-') },
    { key: 'a1', label: '0-30', num: true, hideSm: true, render: (c) => (c.ageing.d0_30 ? money(c.ageing.d0_30) : '-') },
    { key: 'a2', label: '31-60', num: true, hideSm: true, render: (c) => (c.ageing.d31_60 ? money(c.ageing.d31_60) : '-') },
    { key: 'a3', label: '61+', num: true, hideSm: true, render: (c) => (c.ageing.d61_90 + c.ageing.d90 ? money(c.ageing.d61_90 + c.ageing.d90) : '-') },
    { key: 'rem', label: 'Reminded', hideSm: true, render: (c) => (c.reminded ? <>{c.reminded.day}<small className="a-muted a-p15-sub">{c.reminded.how}</small></> : <span className="a-muted">-</span>) },
    { key: 'act', label: '', render: (c) => <span className="a-p21-nowrap">
      {d.can.create && <button type="button" className="a-btn a-btn-sm" onClick={() => setRec(String(c.customer_id))}>Receipt</button>}
      {c.overdue > 0.004 && <> <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => remind(c)}><LIcon name="mail" size="sm" />Remind</button></>}
      {c.late30 > 0.004 && d.can.create && d.can.office && !c.write_off_waiting && <> <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => writeOff(c)}>Write off</button></>}
      {c.write_off_waiting && <> <Pill tone="warn">Write-off waiting</Pill></>}</span> },
  ];
  const rcs = [
    { key: 'no', label: 'Receipt', render: (r) => <><b className="a-mono">{r.receipt_no}</b><small className="a-muted a-p15-sub">{r.received_on}{r.source !== 'office' ? ` · ${r.source_label}${r.order_no ? ` ${r.order_no}` : ''}` : ''}</small></> },
    { key: 'customer', label: 'Customer' },
    { key: 'how', label: 'How', render: (r) => <>{r.mode_label}{r.reference && <small className="a-muted a-p15-sub a-mono">{r.reference}</small>}</> },
    { key: 'amount', label: 'Amount', num: true, render: (r) => <b>{money(r.amount)}</b> },
    { key: 'set', label: 'Settled', hideSm: true, render: (r) => <>{r.settles.map((s) => `${s.no}${s.full ? '' : ' (part)'}`).join(', ')}{r.on_account > 0.004 && <small className="a-muted a-p15-sub">{money(r.on_account)} on account</small>}</> },
    { key: 'st', label: 'Status', render: (r) => (r.status === 'bounced' ? <Pill tone="bad">Cheque bounced</Pill> : r.mode === 'cheque' ? <Pill tone="info">{r.cheque_status}</Pill> : <Pill tone="good">Received</Pill>) },
  ];
  const cr = [
    { key: 'name', label: 'Customer', render: custCell },
    { key: 'credit', label: 'We owe them', num: true, render: (c) => <b>{money(c.credit)}</b> },
    { key: 'act', label: '', render: (c) => (d.can.create && d.can.office ? <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setRefund(c.customer_id)}>Refund</button> : null) },
  ];
  return (
    <section>
      <PageHead sub="Money received from customers" rules={['Settles the oldest dues first', 'Cash from trips and pickups comes in by itself', 'Cheque bounce reverses it and holds the customer']}
        actions={d && d.can.create && <button type="button" className="a-btn" onClick={() => setRec('')}><LIcon name="plus" size="sm" />Record receipt</button>} />
      {act.note}
      <Loading state={data}>{d && <>
        {d.own && <Alert tone="info" title="Your customers only.">Sales record receipts for their own customers.</Alert>}
        <div className="a-listcard a-p21-sum"><div className="a-tw"><table className="a-table"><tbody><tr>
          <td><b>Customers owe</b></td><td className="a-num"><b>{money(d.summary.owe)}</b></td><td><b>Overdue</b></td><td className="a-num"><b className="a-bad">{money(d.summary.overdue)}</b></td>
          <td><b>On account (credit)</b></td><td className="a-num">{money(d.summary.credit)}</td></tr></tbody></table></div></div>
        <Tabs label="Receipts" value={tab} onChange={setTab} tabs={[{ key: 'to_collect', label: 'To collect', count: d.counts.to_collect }, { key: 'receipts', label: 'Receipts', count: d.counts.receipts }, { key: 'credit', label: 'Credit balances', count: d.counts.credit }]} />
        <div className="a-listcard">
          {tab === 'to_collect' && <Table columns={owing} rows={d.owing} rowKey={(c) => c.customer_id} label="To collect" empty={{ icon: 'wallet', title: 'Nobody owes anything', text: 'Customers with a balance show here.' }} />}
          {tab === 'receipts' && <Table columns={rcs} rows={d.receipts} rowKey={(r) => r.receipt_no} label="Receipts" onRowClick={(r) => setOpen(r.receipt_no)} empty={{ icon: 'wallet', title: 'No receipt yet', text: 'Receipts made here show in this list.' }} />}
          {tab === 'credit' && <><Table columns={cr} rows={d.credit} rowKey={(c) => c.customer_id} label="Credit balances" empty={{ icon: 'wallet', title: 'No credit balance', text: 'A customer who paid more than they owe shows here.' }} />
            {d.credit.length > 0 && <p className="a-hint-s a-p21-pad">It is used against their next invoice automatically, or refunded.</p>}</>}
        </div>
      </>}</Loading>
      {rec !== null && <ReceiptDrawer customer={rec} onClose={() => setRec(null)} onDone={() => { setRec(null); setTab('receipts'); data.reload(); }} />}
      {open && <ReceiptView no={open} onClose={() => setOpen(null)} onPrint={() => { setPrint(open); setOpen(null); }} />}
      {refund && <RefundDrawer customer={refund} onClose={() => setRefund(null)} onDone={() => { setRefund(null); data.reload(); }} />}
    </section>
  );
}

function ReceiptDrawer({ customer, onClose, onDone }) {
  const [f, setF] = useState({ customer_id: customer || '', amount: '', received_on: '', mode: 'cash', reference: '', cheque_no: '', cheque_bank: '', cheque_date: '', to: '' });
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState({});
  const form = useLoad(`/money/receipt-form${f.customer_id ? `?customer_id=${f.customer_id}` : ''}`);
  const act = useAction();
  const toast = useToast();
  const d = form.data;
  const c = d && d.customer && String(d.customer.customer_id) === String(f.customer_id) ? d.customer : null;
  useEffect(() => { if (d && !f.received_on) setF((x) => ({ ...x, received_on: d.today, cheque_date: d.today })); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (c && f.amount === '' && c.owes > 0) setF((x) => ({ ...x, amount: String(c.owes) })); }, [c && c.customer_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const invs = useMemo(() => (c ? c.items.filter((x) => x.kind === 'invoice') : []), [c]);
  // v23 Low3 d: an amount equal to one invoice's balance goes to that invoice unless someone picked otherwise
  const auto = useMemo(() => { const m = invs.filter((o) => Math.abs(o.left - Number(f.amount || 0)) < 0.005); return m.length === 1 ? m[0].no : ''; }, [invs, f.amount]);
  const to = touched ? f.to : auto;
  const p = c && Number(f.amount) > 0 ? plan(c.items, Number(f.amount), to) : null;
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', '/money/receipts', { ...f, to }); toast('good', `${out.receipt_no} saved`, out.message); onDone(); } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title="Record receipt" onClose={onClose} thumb={<LIcon name="wallet" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Save receipt</button></>}>
      {act.note}
      <Loading state={form}>{d && <>
        <div className="a-grid2">
          <Field def={{ name: 'customer_id', label: 'Customer', type: 'select', required: true, error: err.customer_id, wide: true, options: d.customers.map((x) => ({ value: String(x.customer_id), label: `${x.customer_no} · ${x.name}` })) }} value={String(f.customer_id)} onChange={(v) => { setF((x) => ({ ...x, customer_id: v, amount: '', to: '' })); setTouched(false); }} />
          <In label="Amount (Rs)" type="number" min="1" step="0.01" value={f.amount} error={fe(err, 'amount')} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} />
          <In label="Received on" type="date" max={d.today} value={f.received_on} error={fe(err, 'received_on')} onChange={(e) => setF((x) => ({ ...x, received_on: e.target.value }))} />
          <Field def={{ name: 'mode', label: 'How', type: 'select', allowEmpty: false, required: true, error: err.mode, options: d.modes.map(([v, l]) => ({ value: v, label: l })) }} value={f.mode} onChange={(v) => setF((x) => ({ ...x, mode: v }))} />
          {f.mode !== 'cheque' && <In label="Reference" className="a-mono" maxLength={30} value={f.reference} error={fe(err, 'reference')} hint="UPI or bank reference (UTR). Not needed for cash." onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} />}
          {f.mode === 'cheque' && <>
            <In label="Cheque number" className="a-mono" maxLength={6} inputMode="numeric" value={f.cheque_no} error={fe(err, 'cheque_no')} hint="6 digits." onChange={(e) => setF((x) => ({ ...x, cheque_no: e.target.value }))} />
            <In label="Their bank and branch" maxLength={60} value={f.cheque_bank} error={fe(err, 'cheque_bank')} onChange={(e) => setF((x) => ({ ...x, cheque_bank: e.target.value }))} />
            <In label="Cheque date" type="date" value={f.cheque_date} error={fe(err, 'cheque_date')} hint="A later date is a post-dated cheque: it cannot be deposited before then." onChange={(e) => setF((x) => ({ ...x, cheque_date: e.target.value }))} />
          </>}
          <In label="Set against" wide error={fe(err, 'to')} hint="Pick an invoice when the customer says what they are paying. An amount that matches one invoice exactly is set against it.">
            <select id="f-to" value={to} onChange={(e) => { setTouched(true); setF((x) => ({ ...x, to: e.target.value })); }}><option value="">Oldest dues first</option>{invs.map((o) => <option key={o.no} value={o.no}>{`${o.no} · ${money(o.left)} left`}</option>)}</select>
          </In>
        </div>
        {c && <Alert tone="info" title={`Owes ${money(c.owes)}${c.overdue > 0.004 ? `, ${money(c.overdue)} overdue` : ''}.`}>
          {p ? <>{p.lines.length > 0 && `Settles ${p.lines.map((s) => `${s.no} ${money(s.amount)}${s.full ? '' : ' (part)'}`).join(', ')}.`}{p.extra > 0.004 && ` ${money(p.extra)} stays on account for the next invoice.`} After this: {money(r2(c.owes - Number(f.amount)))}.</> : null}
        </Alert>}
      </>}</Loading>
    </Drawer>
  );
}

function ReceiptView({ no, onClose, onPrint }) {
  const one = useLoad(`/money/receipts/${enc(no)}`);
  const r = one.data;
  return (
    <Drawer title={`Receipt ${no}`} onClose={onClose} thumb={<LIcon name="wallet" />} status={r && (r.status === 'bounced' ? <Pill tone="bad">Cheque bounced</Pill> : <Pill tone="good">Received</Pill>)}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      <Loading state={one}>{r && <>
        <div className="a-p21-acts"><button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={onPrint}><LIcon name="printer" size="sm" />Print receipt</button></div>
        <dl className="a-kv"><dt>Customer</dt><dd>{r.customer}</dd><dt>Amount</dt><dd><b>{money(r.amount)}</b> · {r.mode_label}{r.reference ? ` · ${r.reference}` : ''}</dd>
          <dt>Date</dt><dd>{r.day} · by {r.by} · {r.source}{r.order_no ? ` ${r.order_no}` : ''}</dd>
          {r.cheque && <><dt>Cheque</dt><dd>{r.cheque.no} · {r.cheque.bank} · dated {r.cheque.date} · {r.cheque.status}</dd></>}
          <dt>Settled</dt><dd>{r.settles.length ? r.settles.map((s) => `${s.no} ${money(s.amount)}`).join(', ') : '-'}{r.on_account > 0.004 ? ` · ${money(r.on_account)} on account` : ''}</dd></dl>
      </>}</Loading>
    </Drawer>
  );
}
function ReceiptPrint({ no, onBack }) {
  const one = useLoad(`/money/receipts/${enc(no)}`);
  const r = one.data;
  return (
    <section>
      <PageHead sub="The receipt as the customer sees it" actions={<><button type="button" className="a-btn a-btn-ghost" onClick={onBack}><LIcon name="chevron-left" size="sm" />Back</button><button type="button" className="a-btn" onClick={() => window.print()}><LIcon name="printer" size="sm" />Print</button></>} />
      <Loading state={one}>{r && (
        <div className="a-card a-p19-print a-p21-print" id="printArea">
          <PrintHead title={`Receipt ${r.receipt_no}`} sub={`Date ${r.day}`} company={{ name: r.company.name, gstin: r.company.gstin, address: r.company.phone }} />
          <p>Received with thanks from <b>{r.legal}</b> the sum of <b>{money(r.amount)}</b> ({inWords(r.amount)}) by {String(r.mode_label).toLowerCase()}{r.reference ? ` ref ${r.reference}` : ''}{r.cheque ? ` (cheque ${r.cheque.no}, subject to realisation)` : ''}.</p>
          <p className="a-hint-s">Against: {r.settles.length ? r.settles.map((s) => `${s.no} ${money(s.amount)}`).join(', ') : 'on account'}{r.on_account > 0.004 ? `; ${money(r.on_account)} on account` : ''}. Balance after this receipt: {money(r.balance_after)}.</p>
          <p className="a-hint-s">For {r.company.name} · Authorised signatory</p>
        </div>
      )}</Loading>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Refunds
export function Refunds() {
  const data = useLoad('/money/refunds');
  const [tab, setTab] = useState('waiting');
  const d = data.data;
  const cols = [
    { key: 'no', label: 'Refund', render: (f) => <><b className="a-mono">{f.refund_no || (f.return_no ? `Return ${f.return_no}` : `#${f.refund_id}`)}</b><small className="a-muted a-p15-sub">{f.day}</small></> },
    { key: 'customer', label: 'Customer', render: (f) => f.customer || '-' },
    { key: 'how', label: 'How', render: (f) => <>{f.mode_label}{f.reference && <small className="a-muted a-p15-sub a-mono">{f.reference}</small>}</> },
    { key: 'why', label: 'Why', render: (f) => <>{f.why || (f.return_no ? `Return ${f.return_no}` : '')}{f.status === 'approval' && f.approval && <small className="a-muted a-p15-sub">Waiting for approval</small>}</> },
    { key: 'amount', label: 'Amount', num: true, render: (f) => <b>{money(f.amount)}</b> },
  ];
  return (
    <section>
      <PageHead sub="Money paid back to customers" rules={d ? ['Only a credit balance is refunded', d.rule.is_on ? `Above Rs ${Number(d.rule.above || 0).toLocaleString('en-IN')} needs a second person` : 'Refund rule is off', 'Start from Receipts > Credit balances'] : []} />
      <Loading state={data}>{d && <>
        <Tabs label="Refunds" value={tab} onChange={setTab} tabs={[{ key: 'waiting', label: 'Waiting for approval', count: d.counts.waiting }, { key: 'paid', label: 'Paid', count: d.counts.paid }, { key: 'rejected', label: 'Rejected', count: d.counts.rejected }]} />
        <div className="a-listcard"><Table columns={cols} rows={d[tab]} rowKey={(f) => f.refund_id} label={tab} empty={{ icon: 'undo-2', title: 'Nothing here', text: "Refunds start from a customer's credit balance (Receipts > Credit balances)." }} /></div>
      </>}</Loading>
    </section>
  );
}
function RefundDrawer({ customer, onClose, onDone }) {
  const one = useLoad(`/money/refund-form/${customer}`);
  const [f, setF] = useState({ amount: '', mode: 'bank', reference: '', why: '' });
  const [err, setErr] = useState({});
  const act = useAction();
  const toast = useToast();
  const d = one.data;
  useEffect(() => { if (d && f.amount === '') setF((x) => ({ ...x, amount: String(d.can) })); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', '/money/refunds', { customer_id: customer, ...f }); toast(out.waiting ? 'warn' : 'good', out.waiting ? 'Waiting for approval' : `${out.refund_no} paid`, out.message); onDone(); } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title={d ? `Refund to ${d.customer.name}` : 'Refund'} onClose={onClose} thumb={<LIcon name="undo-2" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Refund</button></>}>
      {act.note}
      <Loading state={one}>{d && <>
        <dl className="a-kv"><dt>Customer</dt><dd>{d.customer.name}</dd><dt>Credit balance</dt><dd><b>{money(d.credit)}</b>{d.credit - d.can > 0.004 && <small className="a-muted a-p15-sub">{money(d.can)} can be refunded now{d.uncleared ? `; ${money(d.uncleared)} is in cheques not yet cleared` : ''}{d.waiting ? `; ${money(d.waiting)} in refunds waiting` : ''}</small>}</dd></dl>
        <div className="a-grid2">
          <In label="Refund (Rs)" type="number" min="1" step="0.01" value={f.amount} error={fe(err, 'amount')} hint="Not more than the credit balance." onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} />
          <Field def={{ name: 'mode', label: 'How', type: 'select', allowEmpty: false, required: true, error: err.mode, options: d.modes.map(([v, l]) => ({ value: v, label: l })) }} value={f.mode} onChange={(v) => setF((x) => ({ ...x, mode: v }))} />
          <In label="Reference" className="a-mono" maxLength={30} value={f.reference} error={fe(err, 'reference')} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} />
          <In label="Why" wide maxLength={120} placeholder="e.g. Paid twice for DFI/26-27/0413" value={f.why} error={fe(err, 'why')} onChange={(e) => setF((x) => ({ ...x, why: e.target.value }))} />
        </div>
        {d.rule.is_on && Number(f.amount) > Number(d.rule.above || 0) && <Alert tone="warn" title={`Above Rs ${Number(d.rule.above || 0).toLocaleString('en-IN')}`}>A second person signs it before the money goes.</Alert>}
      </>}</Loading>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Cheques
export function Cheques() {
  const data = useLoad('/money/cheques');
  const [tab, setTab] = useState('received');
  const [bnc, setBnc] = useState(null);
  const act = useAction();
  const toast = useToast();
  const d = data.data;
  const run = (path, title) => act.run(async () => { const out = await api.send('POST', path); toast(out.waiting ? 'warn' : 'good', out.waiting ? 'Waiting for approval' : title, out.message); data.reload(); });
  const cols = [
    { key: 'no', label: 'Cheque', render: (c) => <><b className="a-mono">{c.cheque_no}</b><small className="a-muted a-p15-sub">{c.bank} · {c.receipt_no}</small></> },
    { key: 'customer', label: 'From', render: (c) => c.customer },
    { key: 'date', label: 'Dated', render: (c) => <>{c.cheque_date}{c.post_dated && <> <Pill tone="gold">PDC</Pill></>}</> },
    { key: 'amount', label: 'Amount', num: true, render: (c) => <b>{money(c.amount)}</b> },
    { key: 'status', label: 'Status', render: (c) => <>{c.status}{c.deposited_on && <small className="a-muted a-p15-sub">deposited {c.deposited_on}</small>}{c.bounce_why && <small className="a-bad a-p15-sub">{c.bounce_why}{c.charge ? `, charge ${money(c.charge)}${c.waived ? ` (${money(c.waived)} waived)` : ''}` : ''}</small>}</> },
    { key: 'act', label: '', render: (c) => {
      if (!d.can.create) return null;
      if (c.status === 'received') return c.post_dated ? <Pill tone="gold">Post-dated</Pill> : <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => run(`/money/cheques/${c.cheque_id}/deposit`, 'Deposited')}>Deposited</button>;
      if (c.status === 'deposited') return <span className="a-p21-nowrap"><button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => run(`/money/cheques/${c.cheque_id}/clear`, 'Cleared')}>Cleared</button> <button type="button" className="a-btn a-btn-sm a-btn-danger" onClick={() => setBnc(c)}>Bounced</button></span>;
      if (c.status === 'bounced' && c.waive_waiting) return <Pill tone="warn">Waive waiting</Pill>;
      if (c.status === 'bounced' && c.charge && c.charge - (c.waived || 0) > 0.004 && d.can.office) return <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => run(`/money/cheques/${c.cheque_id}/waive`, 'Waived')}>Waive charge</button>;
      return null;
    } },
  ];
  const out = [
    { key: 'ref', label: 'Cheque', render: (x) => <><b className="a-mono">{x.reference}</b><small className="a-muted a-p15-sub">{x.pay_no}</small></> },
    { key: 'supplier', label: 'Supplier' },
    { key: 'paid_on', label: 'Dated' },
    { key: 'amount', label: 'Amount', num: true, render: (x) => <b>{money(x.amount)}</b> },
    { key: 'st', label: 'Status', render: () => 'issued' },
  ];
  return (
    <section>
      <PageHead sub="Cheques and their status" rules={['Received, deposited, cleared or bounced', 'A post-dated cheque waits for its date', 'Bounce: reversed, bank charge added, customer on hold']} />
      {act.note}
      <Loading state={data}>{d && <>
        <Tabs label="Cheques" value={tab} onChange={setTab} tabs={[{ key: 'received', label: 'To deposit', count: d.counts.received }, { key: 'deposited', label: 'Deposited', count: d.counts.deposited }, { key: 'cleared', label: 'Cleared', count: d.counts.cleared }, { key: 'bounced', label: 'Bounced', count: d.counts.bounced }, ...(d.can.office ? [{ key: 'issued', label: 'Issued to suppliers', count: d.counts.issued }] : [])]} />
        <div className="a-listcard">{tab === 'issued' ? <Table columns={out} rows={d.issued} rowKey={(x) => x.pay_no} label="Issued" empty={{ icon: 'landmark', title: 'Nothing here', text: 'Supplier payments by cheque show here.' }} />
          : <Table columns={cols} rows={d[tab]} rowKey={(c) => c.cheque_id} label={tab} empty={{ icon: 'landmark', title: 'Nothing here', text: 'No cheque in this list.' }} />}</div>
      </>}</Loading>
      {bnc && d && <BounceDrawer c={bnc} d={d} onClose={() => setBnc(null)} onDone={() => { setBnc(null); setTab('bounced'); data.reload(); }} />}
    </section>
  );
}
function BounceDrawer({ c, d, onClose, onDone }) {
  const [f, setF] = useState({ why: d.reasons[0], charge: String(d.standard_charge) });
  const [err, setErr] = useState({});
  const act = useAction();
  const toast = useToast();
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', `/money/cheques/${c.cheque_id}/bounce`, f); toast('warn', `Cheque ${c.cheque_no} bounced`, out.message); onDone(); } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title={`Cheque ${c.cheque_no} bounced`} onClose={onClose} thumb={<LIcon name="ban" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn a-btn-danger" disabled={act.busy} onClick={save}>Record bounce</button></>}>
      {act.note}
      <dl className="a-kv"><dt>Cheque</dt><dd>{c.cheque_no} · {c.bank} · {money(c.amount)}</dd><dt>From</dt><dd>{c.customer}</dd></dl>
      <Alert tone="warn" title="What happens.">The receipt is reversed (they owe it again), the bank charge is added, and the customer goes On hold: new orders wait.</Alert>
      <div className="a-grid2">
        <Field def={{ name: 'why', label: "Bank's reason", type: 'select', allowEmpty: false, required: true, error: err.why, options: d.reasons.map((x) => ({ value: x, label: x })) }} value={f.why} onChange={(v) => setF((x) => ({ ...x, why: v }))} />
        <In label="Bounce charge (Rs)" type="number" min="0" step="1" value={f.charge} error={fe(err, 'charge')} hint="Charged to the customer. Less than the standard is a waiver of the rest, which needs approval." onChange={(e) => setF((x) => ({ ...x, charge: e.target.value }))} />
      </div>
    </Drawer>
  );
}
