// Sales > Orders > Quotes (phase 19, v23 viewQuotes / DRAWERS.quote / quoteEdit; API /sales/quotes in sales-routes.js).
// Tabs Draft / Waiting for approval / Sent / Won / Lost and expired. A quote is for a customer or an enquiry, ships from
// a godown and is valid until a date; prices come from the customer's list and are kept until then (the form shows the
// price the save will use: kept, or today's when the date moved later or it expired). Save and send asks for what it
// needs first. A sent quote prints (logo, lines with HSN, GST, totals) and becomes an order in one press (a draft with
// the quoted prices). Lost needs a reason. Every line shows the pack photo.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Table, Tabs, money, useAction, useAdmin, useLoad, useToast } from './ui';
import { In, ItemCell, addDays, at, fieldsOf, today, useOpenParam } from './buyShared';
import { LinesEditor, NeedsBox, TotalsBox, WhoSelect, itemsOf, rowsOf, useSalesOptions, whoBody } from './salesShared';
import { mediaUrl } from '../utils/api';

const TABS = [['draft', 'Draft'], ['approval', 'Waiting for approval'], ['sent', 'Sent'], ['won', 'Won'], ['lost', 'Lost and expired']];
const TONE = { draft: 'gray', approval: 'warn', sent: 'info', won: 'good', lost: 'gray', expired: 'bad' };
const inTab = (r, t) => (t === 'lost' ? ['lost', 'expired'].includes(r.state) : r.state === t);

export default function Quotes() {
  const data = useLoad('/sales/quotes');
  const opts = useSalesOptions();
  const [tab, setTab] = useState('draft');
  const [open, setOpen] = useState(null);
  const [edit, setEdit] = useState(null); // 'new' | quote_no
  const [print, setPrint] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (no) => setOpen(String(no)));
  if (print) return <PrintView no={print} onBack={() => { setOpen(print); setPrint(null); }} />;
  const rows = d ? d.rows.filter((r) => inTab(r, tab)) : [];
  const cols = [
    { key: 'quote_no', label: 'Quote', render: (r) => <><b className="a-mono">{r.quote_no}</b>{r.rev > 1 && <> <Pill>Rev {r.rev}</Pill></>}<small className="a-muted a-p15-sub">{r.godown} · {r.quote_date}</small></> },
    { key: 'for', label: 'For', render: (r) => <><b>{r.customer || `${r.lead_name} (enquiry)`}</b><small className="a-muted a-p15-sub">{r.customer_no || r.lead_ref}</small></> },
    { key: 'items', label: 'Items', hideSm: true, render: (r) => <>{r.first_name}{r.n_lines > 1 && <span className="a-muted"> +{r.n_lines - 1} more</span>}</> },
    { key: 'valid_until', label: 'Valid until', render: (r) => <span className="a-p18-nowrap">{r.valid_until}</span> },
    { key: 'total', label: 'Total', num: true, render: (r) => <><b>{money(r.total)}</b>{r.off_pct > 0 && <small className="a-muted a-p15-sub">{r.off_pct}% off the list</small>}</> },
    { key: 'state', label: 'Status', render: (r) => <><Pill tone={TONE[r.state]}>{r.state_label}</Pill>{r.order_no && <small className="a-muted a-p15-sub">{r.order_no}</small>}</> },
  ];
  return (
    <section>
      <PageHead sub="Prices for a customer or an enquiry, kept until the quote's date" rules={["Prices from the customer's list", 'Kept when the list changes', 'One press turns it into an order']}
        actions={d && d.can.create && <button type="button" className="a-btn" onClick={() => setEdit('new')}><LIcon name="plus" size="sm" />New quote</button>} />
      {opts.data && opts.data.own && <Alert tone="info" title="Your own.">You see the quotes of your own customers and enquiries.</Alert>}
      <Loading state={data}>
        {d && <>
          <Tabs label="Quotes" value={tab} onChange={setTab} tabs={TABS.map(([k, l]) => ({ key: k, label: l, count: d.rows.filter((r) => inTab(r, k)).length }))} />
          <div className="a-listcard"><Table columns={cols} rows={rows} rowKey={(r) => r.quote_no} label="Quotes" onRowClick={(r) => setOpen(r.quote_no)} empty={{ icon: 'file-text', title: 'Nothing here', text: 'No quote in this list.' }} /></div>
        </>}
      </Loading>
      {open && <QuoteDrawer no={open} onClose={() => setOpen(null)} onEdit={() => { setEdit(open); setOpen(null); }} onPrint={() => { setPrint(open); setOpen(null); }} onChanged={() => data.reload()} />}
      {edit && opts.data && <QuoteForm o={opts.data} no={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={(no) => { setEdit(null); data.reload(); setOpen(no); }} />}
    </section>
  );
}

function QuoteDrawer({ no, onClose, onEdit, onPrint, onChanged }) {
  const one = useLoad(`/sales/quotes/${encodeURIComponent(no)}`);
  const act = useAction();
  const toast = useToast();
  const nav = useNavigate();
  const [lost, setLost] = useState('');
  const [err, setErr] = useState({});
  const x = one.data;
  if (!x) return <Drawer title={`Quote ${no}`} onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const toOrder = () => act.run(async () => {
    try {
      const out = await api.send('POST', `/sales/quotes/${encodeURIComponent(no)}/order`);
      toast('good', `${out.order_no} made from ${no}`, 'The quoted prices are kept. Check it and confirm it.');
      nav(`/admin/commerce/orders?open=${encodeURIComponent(out.order_no)}&edit=1`);
    } catch (e) {
      const f = fieldsOf(e);
      if (f.need_customer) { toast('info', 'First, make them a customer', 'Everything from the enquiry is filled in. After you add the customer, press Make order again.'); nav(`/admin/leads?open=${f.need_customer}&convert=1`); return; }
      throw e;
    }
  });
  const markLost = () => act.run(async () => { setErr({}); try { await api.send('POST', `/sales/quotes/${encodeURIComponent(no)}/lost`, { reason: lost }); toast('good', 'Marked lost', lost); one.reload(); onChanged(); } catch (e) { setErr(fieldsOf(e)); throw e; } });
  const pending = x.approvals.filter((a) => a.waiting);
  return (
    <Drawer title={`Quote ${x.quote_no}`} onClose={onClose} thumb={<LIcon name="file-text" />}
      status={<><Pill tone={TONE[x.state]}>{x.state_label}</Pill>{x.rev > 1 && <Pill>Rev {x.rev}</Pill>}<span className="a-p15-sp" />
        {x.can.edit && <button type="button" className={`a-btn a-btn-sm${x.state === 'draft' ? '' : ' a-btn-ghost'}`} onClick={onEdit}><LIcon name="pencil" size="sm" />{x.state === 'draft' ? 'Open draft' : 'Revise'}</button>}
        {['sent', 'won', 'expired'].includes(x.state) && <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={onPrint}><LIcon name="printer" size="sm" />Print or send</button>}
        {x.can.order && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={toOrder}><LIcon name="arrow-right" size="sm" />Make order</button>}</>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      {act.note}
      {x.state === 'approval' && <Alert tone="warn" title="Waiting for approval.">{pending.map((a) => `${a.kind_label}: ${a.summary}`).join(' ')} The customer does not see it until then.</Alert>}
      {x.rej_note && x.state === 'draft' && <Alert tone="bad" title="Sent back.">{x.rej_note}</Alert>}
      {x.state === 'expired' && <Alert tone="bad" title={`Expired on ${x.valid_until}.`}>Revise it with a new date (today's prices) before it can become an order.</Alert>}
      {x.who.kind === 'lead' && x.state === 'sent' && <Alert tone="info" title="For an enquiry.">Make order first makes {x.who.name} a customer (everything filled in), then the order.</Alert>}
      <dl className="a-kv">
        <dt>For</dt><dd>{x.who.name} · {x.who.no}</dd><dt>Ships from</dt><dd>{x.godown}</dd><dt>Made</dt><dd>{x.quote_date} by {x.made_by}</dd><dt>Valid until</dt><dd>{x.valid_until}</dd>
        {x.sent_at && <><dt>Sent</dt><dd>{at(x.sent_at)}</dd></>}{x.ok_by_name && <><dt>Approved by</dt><dd>{x.ok_by_name}</dd></>}
        {x.order && <><dt>Order</dt><dd><a href={`/admin/commerce/orders?open=${encodeURIComponent(x.order.order_no)}`}>{x.order.order_no}</a></dd></>}
        {x.lost_reason && <><dt>Lost because</dt><dd>{x.lost_reason}</dd></>}<dt>Notes</dt><dd>{x.notes || '-'}</dd>
      </dl>
      <DocLines lines={x.lines} />
      <TotalsBox t={x.totals} />
      {x.totals.off_pct > 0 && <p className="a-hint-s">List value {money(x.totals.list_value)}; {x.totals.off_pct}% off in all.</p>}
      {x.revisions.length > 0 && <><h3 className="a-h3s">Earlier revisions</h3><ul className="a-p17-vers">{x.revisions.map((r) => <li key={r.rev}>Rev {r.rev} · until {at(r.saved_at)} · {r.lines.map((l) => `${l.sku_code} ${l.qty} @ ${money(l.price)}`).join(', ')} · valid {r.valid_until}</li>)}</ul></>}
      {x.can.lost && (
        <div className="a-p16-endbox"><b>Lost</b>
          <In label="Lost because *" error={err.lost_reason}><select value={lost} onChange={(e) => setLost(e.target.value)}><option value="">Choose...</option>{['Price too high', 'Bought elsewhere', 'No reply', 'Delivery too far or slow', 'Plan dropped', 'Other'].map((w) => <option key={w}>{w}</option>)}</select></In>
          <button type="button" className="a-btn a-btn-ghost a-btn-sm" disabled={act.busy} onClick={markLost}>Mark lost</button>
        </div>
      )}
    </Drawer>
  );
}

/** the lines of a quote or order: photo, name, code, kit, packs, price (list when lower), amount */
export function DocLines({ lines, extra = null }) {
  return (
    <div className="a-scroll"><table className="a-table a-p16-dt"><thead><tr><th>Item</th><th className="a-num">Packs</th>{extra && extra.head}<th className="a-num">Price</th><th className="a-num">Amount</th></tr></thead>
      <tbody>{lines.map((l, i) => (
        <tr key={i}><td><ItemCell name={l.name} code={l.sku_code} image={l.image} sub={l.kit_key ? `kit ${l.kit_code || l.kit_key}` : null} /></td><td className="a-num">{l.qty}</td>{extra && extra.cells(l)}
          <td className="a-num">{l.is_free ? <><Pill tone="info">Free</Pill><small className="a-muted a-p15-sub">{l.free_why}</small></> : <>{money(l.price)}{l.list_price && Number(l.price) < Number(l.list_price) - 0.004 && <small className="a-muted a-p15-sub">list {money(l.list_price)}</small>}</>}</td>
          <td className="a-num">{money(l.is_free ? 0 : Number(l.price) * l.qty)}</td></tr>
      ))}</tbody></table></div>
  );
}

function QuoteForm({ o, no, onClose, onSaved }) {
  const one = useLoad(no ? `/sales/quotes/${encodeURIComponent(no)}` : null);
  const x = one.data;
  if (no && !x) return <Drawer title="Quote" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  return <QuoteFormIn o={o} x={x} onClose={onClose} onSaved={onSaved} />;
}
function QuoteFormIn({ o, x, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const rev = Boolean(x) && x.state !== 'draft';
  const start = { who: x ? (x.customer_id ? `C:${x.customer_id}` : `L:${x.lead_id}`) : '', godown_id: String(x ? x.godown_id : (o.godowns[0] || {}).godown_id || ''),
    valid_until: x ? (x.valid_until < today() ? addDays(today(), 15) : x.valid_until) : addDays(today(), 15), delivery_charge: x && Number(x.delivery_charge) ? String(Number(x.delivery_charge)) : '', notes: x ? x.notes || '' : '' };
  const [f, setF] = useState(start);
  const [rows, setRows] = useState(() => rowsOf(x ? x.lines : [], { keep: Boolean(x) }));
  const [pv, setPv] = useState(null);
  const [err, setErr] = useState({});
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target ? e.target.value : e }));
  const body = () => ({ ...whoBody(f.who), godown_id: f.godown_id, valid_until: f.valid_until, delivery_charge: f.delivery_charge, notes: f.notes, items: itemsOf(rows), quote_no: x ? x.quote_no : undefined, version: x ? x.version : undefined });
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(() => { api.send('POST', '/sales/quotes/preview', body()).then((r) => { if (n === seq.current) setPv(r); }).catch(() => {}); }, 300);
    return () => clearTimeout(t);
  }, [JSON.stringify(f), JSON.stringify(rows)]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = (send) => act.run(async () => {
    setErr({});
    try {
      const out = await api.send(x ? 'PUT' : 'POST', x ? `/sales/quotes/${encodeURIComponent(x.quote_no)}` : '/sales/quotes', { ...body(), send });
      if (out.status === 'approval') toast('warn', 'Waiting for approval', `${out.waits.join(', ')}. ${out.waiting_line}`);
      else toast('good', out.status === 'sent' ? `${out.quote_no}${out.rev > 1 ? ` Rev ${out.rev}` : ''} ready` : `${out.quote_no} saved as a draft`, out.status === 'sent' ? 'Print it or mail it from the quote.' : `Send it when ready.${out.repriced ? ' The valid-until date moved, so the prices are today\'s list again.' : ''}`);
      onSaved(out.quote_no);
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const gName = (o.godowns.find((g) => String(g.godown_id) === f.godown_id) || {}).name || '';
  return (
    <Drawer title={rev ? `Revise ${x.quote_no}` : x ? `Quote ${x.quote_no}` : 'New quote'} onClose={onClose} wide thumb={<LIcon name="file-text" />} dirty={JSON.stringify(f) !== JSON.stringify(start)}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button>
        {!rev && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => save(false)}>Save draft</button>}
        <button type="button" className="a-btn" disabled={act.busy} onClick={() => save(true)}><LIcon name="send" size="sm" />{rev ? `Save Rev ${x.rev + 1} and send` : 'Save and send'}</button></>}>
      {rev && <Alert tone="warn" title={`Revising ${x.quote_no} (now Rev ${x.rev}).`}>Saving makes Rev {x.rev + 1} and keeps Rev {x.rev} in the history. {x.state === 'expired' ? 'It had expired, so every line is priced again from today\'s list.' : 'Lines already on it keep their price while the date stays; a later date prices it again from today\'s list.'}</Alert>}
      {x && x.rej_note && <Alert tone="bad" title="Sent back.">{x.rej_note}</Alert>}
      {act.note}
      <div className="a-grid2">
        <WhoSelect o={o} value={f.who} onChange={set('who')} error={err.who} />
        <In label="Ships from *" error={err.godown_id}><select value={f.godown_id} onChange={set('godown_id')}>{o.godowns.map((g) => <option key={g.godown_id} value={String(g.godown_id)}>{g.name}</option>)}</select></In>
        <In label="Valid until *" type="date" min={today()} value={f.valid_until} error={err.valid_until} hint="After this it shows as Expired and cannot become an order." onChange={set('valid_until')} />
        <In label="Delivery charge (Rs, no GST)" type="number" min="0" step="1" value={f.delivery_charge} error={err.delivery_charge} hint="Taxed at the highest GST rate on the quote." onChange={set('delivery_charge')} />
      </div>
      <LinesEditor o={o} rows={rows} setRows={setRows} preview={pv} errors={{ ...err, ...(pv ? pv.fields : {}) }} godownName={gName} />
      <In label="Terms and notes printed on the quote" wide value={f.notes} onChange={set('notes')} maxLength={300} />
      {pv && pv.totals ? <div className="a-p19-calc"><TotalsBox t={pv.totals} /><div>
        {pv.totals.off_pct > 0 && <p className="a-hint-s">List value {money(pv.totals.list_value)}; {pv.totals.off_pct}% off in all.</p>}
        <NeedsBox needs={pv.needs} priceNote={pv.price_note} waitText="Needs approval before it goes to the customer." okText="Saved, it can go to the customer at once." /></div></div>
        : <p className="a-hint-s">Choose who it is for and at least one item to see the total.</p>}
    </Drawer>
  );
}

/** the quotation as the customer sees it: print, or mail it (the outbox, from connect@) */
function PrintView({ no, onBack }) {
  const one = useLoad(`/sales/quotes/${encodeURIComponent(no)}`);
  const { me } = useAdmin();
  const x = one.data; const c = x ? x.company : null;
  return (
    <section>
      <PageHead sub="The quotation as the customer sees it" actions={<><button type="button" className="a-btn a-btn-ghost" onClick={onBack}><LIcon name="chevron-left" size="sm" />Back</button>
        <button type="button" className="a-btn" onClick={() => window.print()}><LIcon name="printer" size="sm" />Print</button></>} />
      <Loading state={one}>{x && (
        <div className="a-card a-p19-print" id="printArea">
          <div className="a-p19-ph"><img src={mediaUrl((me && me.logo_square) || '/media/logo/favicon-32.png')} alt="" /><div><b>Quotation {x.quote_no}{x.rev > 1 ? ` (Rev ${x.rev})` : ''}</b>
            <span>{c ? `${c.name} · ${c.gstin || 'GSTIN to be provided'} · ${c.phone || ''} · ${c.email || ''}` : ''}</span><span>Date {x.quote_date} · Valid until {x.valid_until}</span></div></div>
          <dl className="a-kv"><dt>To</dt><dd>{x.who.name}{x.who.address ? `, ${x.who.address}` : ''}</dd>{x.who.gstin && <><dt>GSTIN</dt><dd>{x.who.gstin}</dd></>}</dl>
          <table className="a-table"><thead><tr><th>#</th><th>Item</th><th className="a-num">Packs</th><th className="a-num">Rate</th><th className="a-num">GST</th><th className="a-num">Amount</th></tr></thead>
            <tbody>{x.lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td><b>{l.name}</b><small className="a-muted a-p15-sub">{l.sku_code}{l.hsn ? ` · HSN ${l.hsn}` : ''}{l.kit_key ? ` · kit ${l.kit_key}` : ''}</small></td><td className="a-num">{l.qty}</td>
              <td className="a-num">{l.is_free ? 'Free' : money(l.price)}</td><td className="a-num">{Number(l.gst_rate)}%</td><td className="a-num">{money(l.is_free ? 0 : l.price * l.qty)}</td></tr>)}</tbody></table>
          <TotalsBox t={x.totals} />
          <p className="a-hint-s">{x.notes || ''} {x.who.kind === 'customer' ? `Payment: ${x.who.credit_days ? `${x.who.credit_days} days from the invoice.` : 'cash on delivery.'}` : ''}</p>
          <p className="a-hint-s">For {c ? c.name : ''} · Authorised signatory</p>
        </div>
      )}</Loading>
    </section>
  );
}
