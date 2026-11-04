// Purchase > Supplier bills (phase 16, v23 viewBills / DRAWERS.billNew / DRAWERS.bill; API /buying/bills in
// buying-routes.js). A bill is entered after Quality check: each line comes from checked goods in that are not billed
// yet, at the approved PO rate (three-way match: billed never more than accepted; a different rate waits for a second
// person). Freight is charged once per PO; "a transporter bills the freight separately" keeps the PO estimate in cost
// until that bill is recorded. Freight on goods with no PO waits for approval and goes into their cost. The total as
// printed must match the lines, GST and freight within Rs 1. Due date from the supplier's terms; a micro or small
// supplier never later than 45 days. Tabs Waiting for approval / Unpaid / Paid / Rejected.
import { useEffect, useRef, useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, Tabs, money, useAction, useAdmin, useCan, useLoad, useToast } from './ui';
import { In, ItemCell, SupCell, TotalsBox, ViewOnlyB, at, bm, fe, fieldsOf, useOpenParam } from './buyShared';

const TONE = { waiting: 'warn', unpaid: 'info', part: 'warn', paid: 'good', rejected: 'gray' };
const TABS = [['waiting', 'Waiting for approval'], ['unpaid', 'Unpaid'], ['paid', 'Paid'], ['rejected', 'Rejected']];

export default function SupplierBills() {
  const [tab, setTab] = useState('unpaid');
  const data = useLoad(`/buying/bills?tab=${tab}`);
  const opts = useLoad('/buying/options');
  const { me } = useAdmin();
  const canEdit = useCan('buying', 'edit');
  const [open, setOpen] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(Number(id)));
  const columns = [
    { key: 'supplier_bill_no', label: 'Bill', render: (b) => <><b>{b.supplier_bill_no}</b><small className="a-muted a-p15-sub">{b.bill_no} · {b.bill_date}</small></> },
    { key: 'supplier', label: 'Supplier', render: (b) => <SupCell s={b.supplier} /> },
    { key: 'grns', label: 'Goods in', hideSm: true, render: (b) => b.grns.join(', ') },
    { key: 'due_date', label: 'Due', render: (b) => <>{b.due_date}{b.overdue ? <> <Pill tone="bad">Overdue</Pill></> : ['unpaid', 'part'].includes(b.status) && b.due_in <= 7 ? <> <Pill tone="warn">{b.due_in} days</Pill></> : null}</> },
    { key: 'total', label: 'Total', num: true, render: (b) => <b>{bm(b.total)}</b> },
    { key: 'paid', label: 'Paid', num: true, hideSm: true, render: (b) => bm(b.paid) },
    { key: 'status', label: 'Status', render: (b) => <Pill tone={TONE[b.status]}>{b.status_label}</Pill> },
  ];
  const empty = { waiting: 'No bill waits for approval.', unpaid: 'Nothing to pay.', paid: 'Nothing paid yet.', rejected: 'None rejected.' }[tab];
  return (
    <section>
      <PageHead sub="The supplier's invoice, matched to goods in" rules={['Matched to the PO and to what was accepted', 'Price differences need approval', 'Paid in Money > Payments > Supplier payments']}
        actions={canEdit && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New supplier bill</button>} />
      {!canEdit && <ViewOnlyB me={me} what="supplier bills" />}
      <Loading state={data}>
        {d && (
          <>
            {d.msme_soon.length > 0 && <Alert tone="warn" title="MSME bills due within 7 days.">{d.msme_soon.map((b) => `${b.supplier} ${b.bill} ${b.left === null ? '' : money(b.left)} ${b.days < 0 ? `was due ${-b.days} days ago` : `due ${b.due}`}`).join('; ')}. Paying a micro or small supplier later than 45 days breaks the MSMED Act, and the interest is not tax-deductible.</Alert>}
            <Tabs label="Supplier bills" value={tab} onChange={setTab} tabs={TABS.map(([k, l]) => ({ key: k, label: l, count: d.counts[k] }))} />
            <div className="a-listcard"><Table columns={columns} rows={d.rows} rowKey={(b) => b.bill_id} label="Supplier bills" onRowClick={(b) => setOpen(b.bill_id)} empty={{ icon: 'inbox', title: 'Nothing here', text: empty }} /></div>
          </>
        )}
      </Loading>
      {open === 'new' && opts.data && <NewBill opts={opts.data} onClose={() => setOpen(null)} onSaved={(out) => { setOpen(null); setTab(out.waiting ? 'waiting' : 'unpaid'); data.reload(); }} />}
      {open && open !== 'new' && <BillDrawer id={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function NewBill({ opts, onClose, onSaved }) {
  const [sid, setSid] = useState('');
  const form = useLoad(sid ? `/buying/bill-form?supplier=${sid}` : null);
  const act = useAction();
  const toast = useToast();
  const [f, setF] = useState({ supplier_bill_no: '', bill_date: '', freight: '', freight_sep: false, total: '' });
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState({});
  const [calc, setCalc] = useState(null);
  const timer = useRef(null);
  const fd = form.data;
  useEffect(() => {
    if (!fd) return;
    setRows(fd.lines.map((l) => ({ ...l, qty: String(l.max), rate: l.rate === null ? '' : String(l.rate) })));
    setF((x) => ({ ...x, bill_date: x.bill_date || fd.today }));
  }, [fd]);
  const body = () => ({ supplier_id: Number(sid), ...f, lines: rows.map((r) => ({ grn_id: r.grn_id, sku_code: r.sku_code, qty: r.qty, rate: r.rate })) });
  useEffect(() => {
    if (!sid || !rows.length) { setCalc(null); return undefined; }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { api.send('POST', '/buying/bills/check', body()).then(setCalc, () => setCalc(null)); }, 250);
    return () => clearTimeout(timer.current);
  }, [rows, f.freight, f.bill_date, sid]); // eslint-disable-line react-hooks/exhaustive-deps
  const setR = (i, k, v) => setRows((x) => x.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', '/buying/bills', body()); toast(out.waiting ? 'warn' : 'good', `${f.supplier_bill_no} saved as ${out.bill_no}`, out.message); onSaved(out); }
    catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const sup = fd && fd.supplier;
  return (
    <Drawer title="New supplier bill" onClose={onClose} dirty={Boolean(f.supplier_bill_no || f.total)} thumb={<LIcon name="receipt" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button>{rows.length > 0 && <button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Save bill</button>}</>}>
      <Alert tone="info" title="Three-way match.">Each line is checked against the purchase order price and against what Quality check accepted. Billed more than accepted is refused; a different price waits for a second person.</Alert>
      {act.note}
      <Field def={{ name: 'supplier', label: 'Supplier', type: 'select', required: true, wide: true, options: opts.suppliers.map((s) => ({ value: String(s.supplier_id), label: s.name })) }} value={sid} onChange={(v) => { setSid(v || ''); setRows([]); setErr({}); }} />
      {sid && (
        <Loading state={form}>
          {fd && (!fd.lines.length ? <Alert tone="warn" title="Nothing to bill.">{sup.name} has no checked goods in that are not billed yet. A bill is entered after Quality check.</Alert> : (
            <>
              <div className="a-grid2">
                <Field def={{ name: 'supplier_bill_no', label: 'Their bill no.', required: true, error: err.supplier_bill_no }} value={f.supplier_bill_no} onChange={(v) => setF((x) => ({ ...x, supplier_bill_no: String(v).slice(0, 30) }))} />
                <Field def={{ name: 'bill_date', label: 'Bill date', type: 'date', required: true, error: err.bill_date, help: `Due date: ${sup.terms_days} days${sup.msme && sup.msme !== 'Medium' ? ' (MSME: at most 45 from accepting the goods)' : ''} from this date.` }} value={f.bill_date} onChange={(v) => setF((x) => ({ ...x, bill_date: v }))} />
              </div>
              {rows.map((r, i) => (
                <div key={`${r.grn_id}-${r.sku_code}`} className="a-p16-lrow a-p16-blrow">
                  <div className="a-p16-li"><ItemCell name={r.name} code={r.sku_code} /><small className="a-muted a-p15-sub">{r.grn_no} · accepted, not billed <b>{r.max_text}</b> · PO rate {r.po_rate === null ? 'none (no PO)' : bm(r.po_rate)}</small></div>
                  <In label="Billed qty" type="number" min="0" step="1" value={r.qty} error={fe(err, `lines.${i}.qty`)} onChange={(e) => setR(i, 'qty', e.target.value)} />
                  <In label="Bill rate (Rs, no GST)" type="number" min="0" step="0.01" value={r.rate} error={fe(err, `lines.${i}.rate`)} onChange={(e) => setR(i, 'rate', e.target.value)} />
                </div>
              ))}
              <p className="a-hint-s">Clear a quantity (0) to leave that line for a later bill.</p>
              <div className="a-grid2">
                <Field def={{ name: 'freight', label: 'Freight on the bill (Rs, no GST)', type: 'number', min: 0, error: err.freight }} value={f.freight} onChange={(v) => setF((x) => ({ ...x, freight: v }))} />
                <label className="a-field"><span>Freight billed by a transporter</span><span className="a-inline"><input type="checkbox" checked={f.freight_sep} onChange={(e) => setF((x) => ({ ...x, freight_sep: e.target.checked }))} /> A transporter bills the freight separately</span>
                  <small className="a-hint">The PO freight stays in cost until that bill is recorded as a Freight in expense on the PO (Expenses).</small></label>
                <Field def={{ name: 'total', label: 'Bill total as printed (Rs)', type: 'number', min: 0, step: '0.01', required: true, error: err.total, help: 'Must match the lines, GST and freight within Rs 1.' }} value={f.total} onChange={(v) => setF((x) => ({ ...x, total: v }))} />
              </div>
              {calc && calc.totals && (
                <div className="a-p16-calc">
                  <TotalsBox t={calc.totals} />
                  <div>
                    {calc.diff.length ? <Alert tone="warn" title={`Price differs from the PO on ${calc.diff.length} line${calc.diff.length > 1 ? 's' : ''}.`}>{calc.diff.map((x) => `${x.sku}: ${money(x.rate)} against ${money(x.po_rate)}`).join('; ')}. Saved, the bill waits for approval before it can be paid.</Alert>
                      : <Alert tone="good" title="Prices match the PO.">Saved, it is ready to pay.</Alert>}
                    {calc.no_po_freight && <Alert tone="warn" title="Freight on goods with no PO.">It waits for approval and then goes into their cost.</Alert>}
                    <p className="a-hint-s">{calc.totals.inter ? 'IGST: the supplier is in another state.' : 'CGST + SGST: same state.'}</p>
                  </div>
                </div>
              )}
            </>
          ))}
        </Loading>
      )}
    </Drawer>
  );
}

function BillDrawer({ id, onClose }) {
  const one = useLoad(`/buying/bills/${id}`);
  const b = one.data;
  if (!b) return <Drawer title="Bill" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const KV = ({ k, children }) => <><dt>{k}</dt><dd>{children}</dd></>;
  return (
    <Drawer title={`Bill ${b.supplier_bill_no}`} onClose={onClose} thumb={<LIcon name="receipt" />}
      status={<><Pill tone={TONE[b.status]}>{b.status_label}</Pill>{b.supplier.msme && <Pill tone="info">MSME {b.supplier.msme}</Pill>}<span className="a-p15-sp" /><span className="a-hint-s">Due {b.due_date}</span></>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      {b.status === 'waiting' && <Alert tone="warn" title="Waiting for approval.">{b.waiting}</Alert>}
      <dl className="a-kv">
        <KV k="Supplier">{b.supplier.name}</KV><KV k="Their bill">{b.supplier_bill_no} dated {b.bill_date}</KV><KV k="Our record">{b.bill_no}</KV><KV k="Goods in">{b.grns.join(', ')}</KV>
        <KV k="Entered by">{b.entered_by} on {at(b.created_at)}</KV><KV k="Paid">{bm(b.paid)} of {bm(b.total)}</KV>
        {b.freight_sep && <KV k="Freight">A transporter bills it separately: the PO estimate stays in cost until that bill is recorded.</KV>}
      </dl>
      <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Item</th><th className="a-num">Qty</th><th className="a-num">Bill rate</th><th className="a-num">PO rate</th><th className="a-num">Amount</th></tr></thead>
        <tbody>{b.lines.map((l) => <tr key={`${l.grn_no}-${l.sku_code}`}><td><ItemCell name={l.name} code={l.sku_code} sub={l.grn_no} /></td><td className="a-num">{l.qty_text}</td><td className="a-num">{bm(l.rate)}</td>
          <td className="a-num">{l.po_rate === null ? '-' : <>{bm(l.po_rate)}{l.differs && <> <Pill tone="warn">differs</Pill></>}</>}</td><td className="a-num">{bm(l.amount)}</td></tr>)}</tbody></table></div>
      <TotalsBox t={b.totals} seeBuy={Boolean(b.totals)} />
      {b.settled.length > 0 && <><h3 className="a-p14-fsec">Paid and set off</h3><ul className="a-p15-hist">{b.settled.map((x, i) => <li key={i}>{x.ref} · {money(x.amount)}</li>)}</ul></>}
      {b.cost.length > 0 && <><h3 className="a-p14-fsec">Average cost</h3><ul className="a-p15-hist">{b.cost.map((c, i) => <li key={i}>{c.sku}: {c.why}{c.stock ? ` · ${money(c.before)} to ${money(c.after)}` : ''}{c.cos ? ` · ${money(c.cos)} to cost of sales (packs already sold)` : ''}</li>)}</ul></>}
    </Drawer>
  );
}
