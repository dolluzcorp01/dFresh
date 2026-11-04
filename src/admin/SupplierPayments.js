// Money > Payments > Supplier payments (phase 16, v23 viewSupPay / DRAWERS.spNew; API /money/supplier-payments in
// supplier-pay.js). Tabs To pay (by supplier, oldest due first; micro and small MSME bills past 45 days flagged first) /
// Waiting for approval / Paid. Pay: tick the bills and the amount of each, how (bank transfer, UPI, cheque), the UTR or
// cheque number and the date. Money goes only to the supplier's approved bank account (a new account waiting does not
// stop payments to the approved one; no approved account, no payment). Above the limit a second person signs it.
import { useEffect, useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, Tabs, money, useAction, useCan, useLoad, useToast } from './ui';
import { In, rs0, fe, fieldsOf } from './buyShared';

export default function SupplierPayments() {
  const [tab, setTab] = useState('to_pay');
  const data = useLoad('/money/supplier-payments');
  const canPay = useCan('money', 'create');
  const [pay, setPay] = useState(null);
  const d = data.data;
  const toPay = [
    { key: 'name', label: 'Supplier', render: (s) => <><b>{s.name}</b>{s.msme && <small className="a-p15-sub"><Pill tone="gold">MSME {s.msme}</Pill></small>}{s.bank_waiting && <small className="a-p15-sub"><Pill tone="warn">New bank waiting for approval</Pill></small>}{s.no_bank && <small className="a-p15-sub"><Pill tone="bad">No approved bank account</Pill></small>}</> },
    { key: 'bills', label: 'Bills', render: (s) => s.bills.map((b) => <div key={b.bill_id}>{b.bill_no} ({b.their_no}) {money(b.left)}{b.msme_late ? <> <b className="a-bad">MSME late</b></> : null}</div>) },
    { key: 'total', label: 'To pay', num: true, render: (s) => <b>{money(s.total)}</b> },
    { key: 'due', label: 'Oldest due', render: (s) => <>{s.bills[0].due_date}{s.bills[0].due_date < new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) && <> <Pill tone="bad">Overdue</Pill></>}</> },
    { key: 'act', label: '', render: (s) => (canPay ? <button type="button" className="a-btn a-btn-sm" onClick={() => setPay(s.supplier_id)}>Pay</button> : null) },
  ];
  const done = [
    { key: 'pay_no', label: 'Payment', render: (x) => <><b className="a-mono">{x.pay_no}</b><small className="a-muted a-p15-sub">{x.paid_on}</small></> },
    { key: 'supplier', label: 'Supplier' },
    { key: 'mode', label: 'How', render: (x) => <>{x.mode_label}<small className="a-muted a-p15-sub a-mono">{x.reference}</small></> },
    { key: 'bills', label: 'Bills', render: (x) => <>{x.bills.map((b) => `${b.bill_no} ${money(b.amount)}`).join(', ')}{x.waiting && <small className="a-muted a-p15-sub">{x.waiting}</small>}</> },
    { key: 'amount', label: 'Amount', num: true, render: (x) => <b>{money(x.amount)}</b> },
  ];
  return (
    <section>
      <PageHead sub="Money paid to suppliers" rules={d ? ['Against their bills, oldest due first', 'MSME micro and small: 45 days by law', `Above ${rs0(d.rule.above)} needs a second person`] : []} />
      <Loading state={data}>
        {d && (
          <>
            <Tabs label="Supplier payments" value={tab} onChange={setTab} tabs={[{ key: 'to_pay', label: 'To pay', count: d.counts.to_pay }, { key: 'waiting', label: 'Waiting for approval', count: d.counts.waiting }, { key: 'paid', label: 'Paid', count: d.counts.paid }]} />
            {tab === 'to_pay' && d.msme_late > 0 && <Alert tone="bad" title={`${d.msme_late} MSME bill${d.msme_late === 1 ? ' is' : 's are'} past 45 days.`}>The law charges interest on late payment to micro and small suppliers. Pay these first.</Alert>}
            <div className="a-listcard">
              {tab === 'to_pay' ? <Table columns={toPay} rows={d.to_pay} rowKey={(s) => s.supplier_id} label="To pay" empty={{ icon: 'inbox', title: 'Nothing to pay', text: 'Matched or approved supplier bills show here.' }} />
                : <Table columns={done} rows={tab === 'waiting' ? d.waiting : d.paid} rowKey={(x) => x.pay_id} label={tab === 'waiting' ? 'Waiting for approval' : 'Paid'} empty={{ icon: 'inbox', title: 'Nothing here', text: 'No payment in this list.' }} />}
            </div>
          </>
        )}
      </Loading>
      {pay && <PayDrawer supplierId={pay} onClose={() => setPay(null)} onSaved={(out) => { setPay(null); setTab(out.waiting ? 'waiting' : 'paid'); data.reload(); }} />}
    </section>
  );
}

function PayDrawer({ supplierId, onClose, onSaved }) {
  const one = useLoad(`/money/supplier-payments/form/${supplierId}`);
  const act = useAction();
  const toast = useToast();
  const d = one.data;
  const [pick, setPick] = useState({});
  const [f, setF] = useState({ mode: 'bank', reference: '', paid_on: '' });
  const [err, setErr] = useState({});
  useEffect(() => { if (d) { setPick(Object.fromEntries(d.bills.map((b) => [b.bill_id, { on: b.free > 0, amount: String(b.free) }]))); setF((x) => ({ ...x, paid_on: d.today })); } }, [d]);
  if (!d) return <Drawer title="Pay a supplier" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const chosen = d.bills.filter((b) => pick[b.bill_id] && pick[b.bill_id].on);
  const total = Math.round(chosen.reduce((a, b) => a + (Number(pick[b.bill_id].amount) || 0), 0) * 100) / 100;
  const need = d.rule.is_on && total > Number(d.rule.limit_value);
  const save = () => act.run(async () => {
    setErr({});
    try {
      const out = await api.send('POST', '/money/supplier-payments', { supplier_id: d.supplier.supplier_id, ...f, bills: chosen.map((b) => ({ bill_id: b.bill_id, amount: pick[b.bill_id].amount })) });
      toast(out.waiting ? 'warn' : 'good', out.waiting ? 'Waiting for approval' : `${out.pay_no} paid`, out.message);
      onSaved(out);
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title={`Pay ${d.supplier.name}`} onClose={onClose} thumb={<LIcon name="landmark" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy || !d.bank} onClick={save}><LIcon name="check" size="sm" />Pay</button></>}>
      {!d.bank && <Alert tone="bad" title="No approved bank account.">{d.supplier.name} has no approved bank account. Add one in Suppliers first; every payment mode waits for it.</Alert>}
      {d.bank && d.bank_waiting && <Alert tone="warn" title="A new bank account is waiting for approval.">A payment made now goes to the approved account below (ending {d.bank.ending}), never to the new one. Confirm with the supplier by phone if unsure.</Alert>}
      {act.note}
      {d.bank && <dl className="a-kv"><dt>Pay to</dt><dd>{d.bank.holder} · {d.bank.name} · A/c {d.bank.acc} · IFSC {d.bank.ifsc}</dd></dl>}
      <b>Bills</b>
      {d.bills.map((b) => (
        <div key={b.bill_id} className="a-p16-payrow">
          <label className="a-inline"><input type="checkbox" checked={Boolean(pick[b.bill_id] && pick[b.bill_id].on)} onChange={(e) => setPick((x) => ({ ...x, [b.bill_id]: { ...x[b.bill_id], on: e.target.checked } }))} />
            <span>{b.bill_no} · their {b.their_no} · due {b.due_date}{b.msme_late && <b className="a-bad"> MSME late</b>}{b.pending > 0 && <b className="a-bad"> {money(b.pending)} already waiting</b>}</span></label>
          <In label={`Amount for ${b.bill_no}`} type="number" min="0" step="0.01" value={pick[b.bill_id] ? pick[b.bill_id].amount : ''} error={fe(err, `bills.${chosen.findIndex((x) => x.bill_id === b.bill_id)}.amount`)}
            onChange={(e) => setPick((x) => ({ ...x, [b.bill_id]: { ...x[b.bill_id], amount: e.target.value } }))} />
        </div>
      ))}
      <div className="a-grid2">
        <Field def={{ name: 'mode', label: 'How', type: 'select', allowEmpty: false, required: true, error: err.mode, options: d.modes.map(([v, l]) => ({ value: v, label: l })) }} value={f.mode} onChange={(v) => setF((x) => ({ ...x, mode: v }))} />
        <Field def={{ name: 'reference', label: 'Reference (UTR or cheque number)', required: true, error: err.reference }} value={f.reference} onChange={(v) => setF((x) => ({ ...x, reference: String(v).slice(0, 30) }))} />
        <Field def={{ name: 'paid_on', label: 'Paid on', type: 'date', required: true, error: err.paid_on }} value={f.paid_on} onChange={(v) => setF((x) => ({ ...x, paid_on: v }))} />
      </div>
      <Alert tone={need ? 'warn' : 'good'} title={money(total)}>{need ? `Above ${rs0(d.rule.limit_value)}: waits for a second person before it is paid. Payments to one supplier within the days that count together add up.` : 'Paid at once (unless earlier payments to this supplier in the days that count together take it above the limit).'}</Alert>
    </Drawer>
  );
}
