// Inventory > Transfers (phase 18, v23 viewTransfers / DRAWERS.trNew / DRAWERS.tr; API /inventory/transfers in
// inventory-routes.js). Tabs In a lorry / Received. New transfer (Create): from a godown you work at to another, the
// lorry's number, driver and e-way bill (above the limit), items with quantities: only free stock goes (not held, not
// expired, not scanned by a packer); it leaves Good for On the road. Somebody else at the receiving godown counts it in;
// a short goes to the Disputed shelf and waits for approval (the sender and the receiver never sign it). A rejected
// loss comes back to the sender: Found (back to Good, signed) or Lost (a write-off); not offered while one waits.
import { useEffect, useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Table, Tabs, useAction, useAdmin, useCan, useLoad, useToast } from './ui';
import { In, ItemCell, ViewOnlyB, at, bm, fe, fieldsOf, useOpenParam } from './buyShared';
import { useInvOptions } from './invShared';

const TONE = { transit: 'warn', received: 'good', short: 'bad' };

export default function Transfers() {
  const [tab, setTab] = useState('transit');
  const data = useLoad(`/inventory/transfers?tab=${tab}`);
  const { me } = useAdmin();
  const canCreate = useCan('inventory', 'create');
  const [open, setOpen] = useState(null);
  const [neu, setNeu] = useState(false);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(Number(id)));
  const cols = [
    { key: 'no', label: 'Transfer', render: (t) => <><b className="a-mono">{t.transfer_no}</b><small className="a-muted a-p15-sub">{at(t.sent_at)}</small></> },
    { key: 'from', label: 'From' },
    { key: 'to', label: 'To' },
    { key: 'items', label: 'Items', render: (t) => <>{t.items_text}<small className="a-muted a-p15-sub">{t.lines_text}</small></> },
    { key: 'vehicle_no', label: 'Vehicle', hideSm: true },
    { key: 'status', label: 'Status', render: (t) => <span className="a-p17-pills"><Pill tone={TONE[t.status]}>{t.status_label}</Pill>{t.loss === 'waiting' && <Pill tone="warn">Loss waiting</Pill>}</span> },
  ];
  return (
    <section>
      <PageHead sub="Stock moving between godowns" rules={['The lorry is a place: stock in it still counts', 'Named sender and receiver', 'A short receipt is a loss to explain']}
        actions={canCreate && <button type="button" className="a-btn" onClick={() => setNeu(true)}><LIcon name="plus" size="sm" />New transfer</button>} />
      {!canCreate && <ViewOnlyB me={me} what="transfers" />}
      <Loading state={data}>
        {d && (
          <>
            <Tabs label="Transfers" value={tab} onChange={setTab} tabs={[{ key: 'transit', label: 'In a lorry', count: d.counts.transit }, { key: 'received', label: 'Received', count: d.counts.received }]} />
            <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(t) => t.transfer_id} label="Transfers" onRowClick={(t) => setOpen(t.transfer_id)}
              empty={{ icon: 'truck', title: 'Nothing here', text: tab === 'transit' ? 'Nothing is on the road.' : 'Nothing received yet.' }} /></div>
          </>
        )}
      </Loading>
      {neu && <NewTransfer onClose={() => setNeu(false)} onSaved={() => { setNeu(false); setTab('transit'); data.reload(); }} />}
      {open && <TransferDrawer id={open} onClose={() => setOpen(null)} onChanged={() => data.reload()} />}
    </section>
  );
}

/** the New transfer panel; fixedFrom: the godown floor fixes the sender's godown */
export function NewTransfer({ fixedFrom = null, onClose, onSaved }) {
  const opts = useInvOptions();
  const o = opts.data;
  if (!o) return <Drawer title="New transfer" onClose={onClose}><Loading state={opts}>{null}</Loading></Drawer>;
  return <TransferForm o={o} fixedFrom={fixedFrom} onClose={onClose} onSaved={onSaved} />;
}
function TransferForm({ o, fixedFrom, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const start = { from: String(fixedFrom || (o.mine[0] || {}).godown_id || ''), to: '', vehicle_no: '', driver: '', ewb_no: '', lines: [{ sku_code: '', qty: '' }] };
  const [f, setF] = useState(start);
  const [err, setErr] = useState({});
  const [free, setFree] = useState({});
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setL = (i, k, v) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const codes = f.lines.map((l) => l.sku_code).join(',');
  useEffect(() => { // what is free to go, line by line
    let live = true;
    Promise.all(f.lines.filter((l) => l.sku_code).map((l) => api.get(`/inventory/free?godown=${f.from}&sku=${encodeURIComponent(l.sku_code)}`).then((x) => [l.sku_code, x]).catch(() => [l.sku_code, null])))
      .then((xs) => { if (live) setFree(Object.fromEntries(xs)); });
    return () => { live = false; };
  }, [f.from, codes]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', '/inventory/transfers', f); toast('good', out.title, out.message); onSaved(out); } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title="New transfer" onClose={onClose} dirty={JSON.stringify(f) !== JSON.stringify(start)} thumb={<LIcon name="truck" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="send" size="sm" />Load the lorry and dispatch</button></>}>
      <Alert tone="info" title="One note, many products.">Only free stock can go (not held for orders, not expired, not scanned by a packer). Dispatch takes it off the shelf and puts it in the lorry; somebody at the other godown counts it in.</Alert>
      {act.note}
      <div className="a-grid2">
        <In label="From *" error={err.from} hint={fixedFrom ? 'Your godown, fixed on the floor.' : ''}><select value={f.from} disabled={Boolean(fixedFrom)} onChange={set('from')}>{o.mine.map((g) => <option key={g.godown_id} value={String(g.godown_id)}>{g.name}</option>)}</select></In>
        <In label="To *" error={err.to}><select value={f.to} onChange={set('to')}><option value="">Choose...</option>{o.godowns.map((g) => <option key={g.godown_id} value={String(g.godown_id)}>{g.name}</option>)}</select></In>
        <In label="Vehicle no. *" value={f.vehicle_no} maxLength={14} placeholder="TN 21 BC 4417" error={err.vehicle_no} onChange={(e) => setF((x) => ({ ...x, vehicle_no: e.target.value.toUpperCase() }))} />
        <In label="Driver" value={f.driver} maxLength={20} error={err.driver} onChange={set('driver')} />
        <In label="E-way bill no." wide value={f.ewb_no} maxLength={12} inputMode="numeric" error={err.ewb_no}
          hint={o.eway.on ? `Needed when the goods are worth more than Rs ${o.eway.above.toLocaleString('en-IN')} (at cost, with GST).` : 'E-way bills are switched off in Company.'} onChange={set('ewb_no')} />
      </div>
      {f.lines.map((l, i) => {
        const fr = free[l.sku_code];
        return (
          <div key={i} className="a-p16-lrow a-p16-qrow">
            <In label="Pack or material" wide error={fe(err, `lines.${i}.sku_code`)}><select value={l.sku_code} onChange={(e) => setL(i, 'sku_code', e.target.value)}><option value="">Choose...</option>
              {o.items.map((x) => <option key={x.sku_code} value={x.sku_code}>{x.sku_code} · {x.name}</option>)}</select></In>
            <In label="Quantity" type="number" min="1" step="1" value={l.qty} error={fe(err, `lines.${i}.qty`)} hint={fr ? `${fr.free} free (good ${fr.good}, held ${fr.held}${fr.expired ? `, expired ${fr.expired}` : ''})` : ''} onChange={(e) => setL(i, 'qty', e.target.value)} />
            <button type="button" className="a-iconbtn a-p16-del" aria-label="Remove this row" onClick={() => setF((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((_, j) => j !== i) : [{ sku_code: '', qty: '' }] }))}><LIcon name="trash-2" size="sm" /></button>
          </div>
        );
      })}
      <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, { sku_code: '', qty: '' }] }))}><LIcon name="plus" size="sm" />Add an item</button>
    </Drawer>
  );
}

function TransferDrawer({ id, onClose, onChanged }) {
  const one = useLoad(`/inventory/transfers/${id}`);
  const act = useAction();
  const toast = useToast();
  const [recv, setRecv] = useState(null);
  const [err, setErr] = useState({});
  const t = one.data;
  if (!t) return <Drawer title="Transfer" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const rv = recv || t.lines.map((l) => String(l.qty));
  const post = (path, body) => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', `/inventory/transfers/${t.transfer_id}/${path}`, body); toast(out.tone || 'warn', out.title, out.message); setRecv(null); one.reload(); onChanged(); }
    catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const KV = ({ k, children }) => <><dt>{k}</dt><dd>{children}</dd></>;
  return (
    <Drawer title={`Transfer ${t.transfer_no}`} onClose={onClose} thumb={<LIcon name="truck" />} dirty={Boolean(recv)}
      status={<><Pill tone={TONE[t.status]}>{t.status_label}</Pill>{t.loss === 'waiting' && <Pill tone="warn">Loss waiting</Pill>}<span className="a-p15-sp" /></>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button>
        {t.can.receive && <button type="button" className="a-btn" disabled={act.busy} onClick={() => post('receive', { recv: rv })}><LIcon name="check" size="sm" />Received</button>}</>}>
      {act.note}
      {t.not_mine && <Alert tone="info" title="On the road.">{t.not_mine}</Alert>}
      <dl className="a-kv">
        <KV k="From">{t.from}</KV><KV k="To">{t.to}</KV>
        <KV k="Vehicle">{t.vehicle_no}{t.driver ? ` · ${t.driver}` : ''}</KV>
        {t.ewb_no && <KV k="E-way bill">{t.ewb_no}</KV>}
        <KV k="Value at cost">{bm(t.value)}</KV>
        <KV k="Sent by">{t.sent_by} at {at(t.sent_at)}</KV>
        {t.recv_by && <KV k="Received by">{t.recv_by} at {at(t.recv_at)}</KV>}
      </dl>
      <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Item</th><th className="a-num">Sent</th><th>Batches</th><th className="a-num">Received</th></tr></thead>
        <tbody>{t.lines.map((l, i) => (
          <tr key={l.sku_code}><td><ItemCell name={l.name} code={l.sku_code} image={l.image} /></td><td className="a-num a-p18-nowrap">{l.qty_text}</td><td className="a-mono">{l.lots}</td>
            <td className="a-num a-p18-cnt">{t.can.receive ? <In label="Counted *" aria-label={`Counted ${l.sku_code}`} type="number" min="0" step="1" value={rv[i]} error={fe(err, `recv.${i}`)} onChange={(e) => setRecv(rv.map((x, j) => (j === i ? e.target.value : x)))} />
              : l.recv === null ? '-' : l.recv < l.qty ? <b className="a-bad">{l.recv}</b> : l.recv}</td></tr>
        ))}</tbody></table></div>
      {t.loss && (
        <Alert tone={t.loss === 'approved' ? 'info' : 'warn'} title={`Short receipt: ${t.loss_text}`}>
          {t.loss === 'waiting' ? t.loss_line : t.loss === 'approved' ? `Written off (${t.loss_value === null ? 'value hidden' : `Rs ${t.loss_value}`}), approved by ${t.loss_by || 'the rule'}.` : `Rejected by ${t.loss_by}: the sender answers for it.`}
          {' '}Both names are on it: {t.sent_by} sent it, {t.recv_by} received it.
        </Alert>
      )}
      {t.missing.length > 0 && (
        <div className="a-p16-endbox">
          <b>Still missing at {t.from}</b>
          <p className="a-hint-s a-p16-mt0">{t.missing.map((x) => `${x.sku_code} ${x.qty}`).join(', ')} on the Disputed shelf. {t.can.settle ? 'Found sends them back to Good (a second person signs); Lost writes them off.' : 'A Found or Lost decision waits.'}</p>
          {t.can.settle && <div className="a-p17-pills"><button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => post('found')}><LIcon name="search" size="sm" />Found: back to Good</button>
            <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => post('lost')}><LIcon name="trash-2" size="sm" />Lost: write off</button></div>}
        </div>
      )}
      {t.settles.length > 0 && <p className="a-hint-s">{t.settles.map((w) => `${w.id} ${w.kind} ${w.qty} ${w.sku_code}: ${w.status}`).join(' · ')}</p>}
    </Drawer>
  );
}
