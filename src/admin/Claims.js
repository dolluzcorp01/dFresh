// Purchase > Claims and purchase returns (phase 16, v23 viewClaims / DRAWERS.claim; API /buying/claims in
// buying-routes.js). Quality check (or a fault found after QC, from the goods in) starts a claim. Issue the debit note
// (choose replacement or credit note), then Goods sent back (a return challan; the goods leave the Rejected shelf).
// A replacement settles once it has come in on the same PO after the goods went back and been checked; a credit note
// settles when its amount equals the debit note, and is set against the supplier's bills (anything left waits as
// credit). Tabs Open / Settled.
import { useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, Tabs, useAction, useAdmin, useCan, useLoad, useToast } from './ui';
import { In, ItemCell, SupCell, ViewOnlyB, at, bm, fieldsOf, useOpenParam } from './buyShared';

const TONE = { draft: 'warn', issued: 'info', returned: 'info', settled: 'good' };

export default function Claims() {
  const [tab, setTab] = useState('open');
  const data = useLoad(`/buying/claims?tab=${tab}`);
  const { me } = useAdmin();
  const canEdit = useCan('buying', 'edit');
  const [open, setOpen] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(Number(id)));
  const columns = [
    { key: 'ref', label: 'Claim', render: (c) => <><b className="a-mono">{c.ref}</b><small className="a-muted a-p15-sub">{c.grn_no}{c.is_late ? ' · after QC' : ''}</small></> },
    { key: 'supplier', label: 'Supplier', render: (c) => <SupCell s={c.supplier} /> },
    { key: 'items', label: 'Items', render: (c) => <>{c.items_text}<small className="a-muted a-p15-sub">{c.lines_text}</small></> },
    { key: 'value', label: 'Value', num: true, render: (c) => bm(c.value) },
    { key: 'outcome', label: 'Outcome', hideSm: true, render: (c) => c.outcome_label },
    { key: 'status', label: 'Status', render: (c) => <Pill tone={TONE[c.status]}>{c.status_label}</Pill> },
  ];
  return (
    <section>
      <PageHead sub="Send back damaged or wrong goods" rules={['Started by Quality check', 'Debit note, then return challan', 'Replacement or credit note settles it']} />
      {!canEdit && <ViewOnlyB me={me} what="claims" />}
      <Loading state={data}>
        {d && (
          <>
            <Tabs label="Claims" value={tab} onChange={setTab} tabs={[{ key: 'open', label: 'Open', count: d.counts.open }, { key: 'settled', label: 'Settled', count: d.counts.settled }]} />
            <div className="a-listcard"><Table columns={columns} rows={d.rows} rowKey={(c) => c.claim_id} label="Claims" onRowClick={(c) => setOpen(c.claim_id)}
              empty={{ icon: 'inbox', title: 'Nothing here', text: tab === 'open' ? 'No open claim. Quality check starts one when it rejects goods.' : 'None settled yet.' }} /></div>
          </>
        )}
      </Loading>
      {open && <ClaimDrawer id={open} onClose={() => setOpen(null)} onChanged={() => data.reload()} />}
    </section>
  );
}

function ClaimDrawer({ id, onClose, onChanged }) {
  const one = useLoad(`/buying/claims/${id}`);
  const act = useAction();
  const toast = useToast();
  const [outcome, setOutcome] = useState(null);
  const [cn, setCn] = useState({ cn_no: '', amount: null });
  const [err, setErr] = useState({});
  const c = one.data;
  if (!c) return <Drawer title="Claim" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const run = (path, body, title) => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', `/buying/claims/${c.claim_id}/${path}`, body); toast('good', title, out.message); one.reload(); onChanged(); }
    catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const out = outcome || c.outcome;
  const KV = ({ k, children }) => <><dt>{k}</dt><dd>{children}</dd></>;
  const ed = c.can.edit;
  return (
    <Drawer title={`Claim ${c.ref}`} onClose={onClose} thumb={<LIcon name="undo-2" />}
      status={<><Pill tone={TONE[c.status]}>{c.status_label}</Pill><span className="a-p15-sp" />
        {ed && c.status === 'draft' && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => run('issue', { outcome: out }, 'Debit note issued')}><LIcon name="file-text" size="sm" />Issue debit note</button>}
        {ed && c.status === 'issued' && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => run('returned', {}, 'Goods sent back')}><LIcon name="truck" size="sm" />Goods sent back</button>}
        {ed && c.status === 'returned' && c.outcome === 'replace' && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => run('settle', {}, 'Settled')}><LIcon name="check" size="sm" />Replacement received</button>}</>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      {act.note}
      <dl className="a-kv">
        <KV k="Supplier">{c.supplier.name}</KV>
        <KV k="From"><a href={`/admin/goods-in?open=${c.grn_id}`}>{c.grn_no}</a> · {c.po_no || 'no PO'}</KV>
        <KV k="Started by">{c.started_by} on {at(c.created_at)}</KV>
        {c.debit_no && <KV k="Debit note">{c.debit_no}</KV>}
        {c.challan_no && <KV k="Return challan">{c.challan_no}</KV>}
        {c.cn && <KV k="Their credit note">{c.cn.no} · {bm(c.cn.amount)}{c.cn.set ? ` · ${c.cn.set}` : ''}</KV>}
        <KV k="Note">{c.note || '-'}</KV>
      </dl>
      <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Item</th><th className="a-num">Qty</th><th>Why</th><th className="a-num">Rate</th><th className="a-num">Value</th></tr></thead>
        <tbody>{c.lines.map((l) => <tr key={l.sku_code}><td><ItemCell name={l.name} code={l.sku_code} /></td><td className="a-num">{l.qty_text}</td><td>{l.reason}</td><td className="a-num">{bm(l.rate)}</td><td className="a-num">{bm(l.value)}</td></tr>)}</tbody></table></div>
      <dl className="a-kv a-p16-tot"><dt>Value</dt><dd>{bm(c.value)}</dd><dt>GST</dt><dd>{bm(c.gst)}</dd><dt><b>Debit note total</b></dt><dd><b>{bm(c.debit_total)}</b></dd></dl>
      {ed && c.status === 'draft' && (
        <Field def={{ name: 'outcome', label: 'What we want', type: 'select', allowEmpty: false, required: true, wide: true, options: [...(c.can.replace ? [{ value: 'replace', label: 'Replacement: the PO line stays open for it' }] : []), { value: 'credit', label: 'Credit note: money back, the PO line closes' }] }}
          value={out} onChange={setOutcome} />
      )}
      {ed && c.status === 'returned' && c.outcome === 'credit' && (
        <div className="a-p16-endbox">
          <b>Record their credit note</b>
          <div className="a-grid2">
            <In label="Credit note no. *" value={cn.cn_no} maxLength={30} error={err.cn_no} onChange={(e) => setCn((x) => ({ ...x, cn_no: e.target.value }))} />
            <In label="Amount (Rs) *" type="number" min="0" step="0.01" value={cn.amount === null ? (c.debit_total ?? '') : cn.amount} error={err.amount} hint="Must equal the debit note total." onChange={(e) => setCn((x) => ({ ...x, amount: e.target.value }))} />
          </div>
          <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => run('credit', { cn_no: cn.cn_no, amount: cn.amount === null ? c.debit_total : cn.amount }, 'Settled')}><LIcon name="check" size="sm" />Record and settle</button>
        </div>
      )}
      {c.status === 'returned' && c.outcome === 'replace' && <Alert tone="info" title="Waiting for the replacement.">Take it in through Goods in on {c.po_no}, check it, then press Replacement received.</Alert>}
    </Drawer>
  );
}
