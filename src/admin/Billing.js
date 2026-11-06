// Money > Billing (phase 21, v23 viewInvoices / viewCnotes / viewDnotes / viewChallans, DRAWERS.invMake / inv / cnNew / dnNew /
// dcNew, g10Print; API /billing/* in money-routes.js, rules in billing.js).
// Invoices: To invoice (packed shipments, made before the goods leave, at the order's prices and the GST of the invoice
// date, with the e-way bill or e-invoice papers when needed), Unpaid, Paid, Cancelled. An invoice opens with its lines,
// notes, papers and the cancel box (asked, then a second person signs). Print view: logo, GSTIN (or "to be provided"),
// bill to / ship to, place of supply, HSN, amount in words, HSN summary with the delivery charge as SAC 9965, bank and
// UPI QR, declaration and signatory; "DEMO - not a tax invoice" until the company GSTIN is in.
// Credit notes: goods back are credited where they come back; a price correction asks for approval; tabs To credit,
// Waiting, Made, Rejected. Debit notes: an extra charge on an invoice. Delivery challans: goods sent without a sale
// (the list shows transfers too, the same DFT series).
import { useEffect, useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, RuleChips, Table, Tabs, money, useAction, useAdmin, useLoad, useToast } from './ui';
import { In, ItemCell, at, fe, fieldsOf, today } from './buyShared';
import { mediaUrl } from '../utils/api';
import { qrSvg, upiLink } from '../shared/upiQr';
import { stateName } from '../shared/gstStates';

const enc = encodeURIComponent;
const custCell = (r) => <><b>{r.customer}</b><small className="a-muted a-p15-sub">{r.customer_no}</small></>;
const KIND = { own: 'Our vehicle', courier: 'Courier', pickup: 'Customer picks up' };
const TONE = { open: 'info', part: 'gold', paid: 'good', overdue: 'bad', cancelled: 'gray', cancelwait: 'warn' };
export const statePill = (st, label) => <Pill tone={TONE[st] || 'gray'}>{label}</Pill>;

/** rupees in words, Indian style (v23 inWords) */
export function inWords(n) {
  n = Math.round(Number(n) || 0);
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ` ${a[x % 10]}` : ''));
  const three = (x) => (x >= 100 ? `${a[Math.floor(x / 100)]} Hundred${x % 100 ? ' ' : ''}` : '') + (x % 100 ? two(x % 100) : '');
  if (!n) return 'Rupees Zero Only';
  const out = []; const cr = Math.floor(n / 1e7); const lk = Math.floor(n / 1e5) % 100; const th = Math.floor(n / 1e3) % 100; const rest = n % 1000;
  if (cr) out.push(`${three(cr)} Crore`); if (lk) out.push(`${two(lk)} Lakh`); if (th) out.push(`${two(th)} Thousand`); if (rest) out.push(three(rest));
  return `Rupees ${out.join(' ')} Only`;
}

/** v23 coWarn: the company facts still missing print "to be provided" */
function CoWarn({ c }) {
  if (!c || (!c.demo && !c.missing.length)) return null;
  return <Alert tone="warn" title={`Company ${c.missing.length ? c.missing.join(', ') : 'GSTIN'} not filled in yet.`}>Invoices print &quot;to be provided&quot; and &quot;DEMO - not a tax invoice&quot; until they are given (Admin &gt; Company).</Alert>;
}

function TotalsBox({ t, inter }) {
  if (!t) return null;
  const row = (l, v, b) => <div className={b ? 'a-p21-tb' : ''}><dt>{l}</dt><dd>{v}</dd></div>;
  return (
    <dl className="a-p21-tot">
      {row('Goods', money(Number(t.taxable) - Number(t.delivery_charge || 0)))}
      {Number(t.delivery_charge) > 0 && row('Delivery charge', money(t.delivery_charge))}
      {row('Taxable value', money(t.taxable))}
      {inter ? row('IGST', money(t.igst)) : <>{row('CGST', money(t.cgst))}{row('SGST', money(t.sgst))}</>}
      {Number(t.round_off) !== 0 && row('Round off', money(t.round_off))}
      {row('Total', <b>{money(t.total)}</b>, true)}
    </dl>
  );
}
const lineCols = [
  { key: 'item', label: 'Item', render: (l) => <ItemCell name={l.name} code={l.sku_code} image={l.image} sub={l.is_free ? `Free${l.free_why ? `: ${l.free_why}` : ''}` : null} /> },
  { key: 'qty', label: 'Packs', num: true },
  { key: 'price', label: 'Price', num: true, render: (l) => (l.is_free ? 'Free' : money(l.price)) },
  { key: 'gst', label: 'GST', num: true, render: (l) => `${Number(l.gst_rate)}%` },
  { key: 'amt', label: 'Amount', num: true, render: (l) => money(l.taxable) },
];

/** e-way bill and e-invoice fields (shown only when needed) */
function Papers({ needs, f, setF, err, total }) {
  if (!needs || (!needs.ewb && !needs.irn)) return null;
  return (
    <div className="a-grid2">
      {needs.ewb && <>
        <In label="E-way bill number" className="a-mono" maxLength={14} inputMode="numeric" value={f.ewb_no || ''} error={fe(err, 'ewb_no')} hint={`12 digits, from the e-way bill portal. Needed: ${needs.ewb || `${money(total)} is above the limit`}.`} onChange={(e) => setF((x) => ({ ...x, ewb_no: e.target.value }))} />
        <In label="E-way bill valid until" type="date" min={today()} value={f.ewb_valid || ''} error={fe(err, 'ewb_valid')} onChange={(e) => setF((x) => ({ ...x, ewb_valid: e.target.value }))} />
      </>}
      {needs.irn && <>
        <In label="E-invoice IRN" className="a-mono" maxLength={64} wide value={f.irn || ''} error={fe(err, 'irn')} hint="64 characters from the e-invoice portal (IRP)." onChange={(e) => setF((x) => ({ ...x, irn: e.target.value }))} />
        <In label="Ack number" className="a-mono" maxLength={15} value={f.ack_no || ''} error={fe(err, 'ack_no')} onChange={(e) => setF((x) => ({ ...x, ack_no: e.target.value }))} />
      </>}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Invoices
export function Invoices() {
  const data = useLoad('/billing/invoices');
  const [tab, setTab] = useState('to_invoice');
  const [make, setMake] = useState(null);
  const [open, setOpen] = useState(null);
  const [print, setPrint] = useState(null);
  const d = data.data;
  useEffect(() => { const m = /[?&]open=([^&]+)/.exec(window.location.search); if (m) setOpen(decodeURIComponent(m[1])); }, []);
  if (print) return <InvoicePrint no={print} onBack={() => { setPrint(null); setOpen(print); }} />;
  const ready = [
    { key: 'order_no', label: 'Order', render: (o) => <><b className="a-mono">{o.order_no}</b><small className="a-muted a-p15-sub">{o.parent ? 'part shipment' : at(o.packed_at)}</small></> },
    { key: 'customer', label: 'Customer', render: custCell },
    { key: 'packed', label: 'Packed, not invoiced', hideSm: true, render: (o) => <ItemCell name={o.first_name} code={o.packed} image={o.first_image} /> },
    { key: 'kind', label: 'Delivery', render: (o) => KIND[o.delivery_kind] || o.delivery_kind },
    { key: 'st', label: 'Status', render: () => <Pill tone="gold">Packed</Pill> },
    { key: 'act', label: '', render: (o) => (d.can.create ? <button type="button" className="a-btn a-btn-sm" onClick={(e) => { e.stopPropagation(); setMake(o.order_no); }}>Make invoice</button> : null) },
  ];
  const list = [
    { key: 'invoice_no', label: 'Invoice', render: (v) => <><b className="a-mono">{v.invoice_no}</b><small className="a-muted a-p15-sub">{v.day} · {v.order_no}</small></> },
    { key: 'customer', label: 'Customer', render: custCell },
    { key: 'kind', label: 'Type', hideSm: true, render: (v) => `${v.kind}${v.inter ? ' · IGST' : ''}` },
    { key: 'total', label: 'Total', num: true, render: (v) => <b>{money(v.total)}</b> },
    { key: 'due_on', label: 'Due' },
    { key: 'papers', label: 'Papers', render: (v) => (v.papers.length ? <Pill tone="bad">{v.papers.join(', ')}</Pill> : <>{v.ewb && <Pill tone="good">EWB</Pill>} {v.irn && <Pill tone="good">IRN</Pill>}{!v.ewb && !v.irn && <span className="a-muted">-</span>}</>) },
    { key: 'st', label: 'Status', render: (v) => statePill(v.state, v.state_label) },
  ];
  return (
    <section>
      <PageHead sub="GST invoice for each sale" />
      <Loading state={data}>{d && <>
        <CoWarn c={d.company} />
        <RuleChips rules={['Made before the goods leave', "For what is packed, at the order's prices", 'Posts to the customer ledger']} />
        <Tabs label="Invoices" value={tab} onChange={setTab} tabs={[{ key: 'to_invoice', label: 'To invoice', count: d.counts.to_invoice, tone: 'warn' }, { key: 'unpaid', label: 'Unpaid', count: d.counts.unpaid }, { key: 'paid', label: 'Paid', count: d.counts.paid }, { key: 'cancelled', label: 'Cancelled', count: d.counts.cancelled }]} />
        <div className="a-listcard">
          {tab === 'to_invoice'
            ? <Table columns={ready} rows={d.to_invoice} rowKey={(o) => o.order_no} label="To invoice" empty={{ icon: 'file-text', title: 'Nothing to invoice', text: 'Packed orders show here until their invoice is made.' }} />
            : <Table columns={list} rows={d[tab]} rowKey={(v) => v.invoice_no} label={tab} onRowClick={(v) => setOpen(v.invoice_no)} empty={{ icon: 'file-text', title: 'Nothing here', text: 'No invoice in this list.' }} />}
        </div>
      </>}</Loading>
      {make && <MakeInvoice no={make} onClose={() => setMake(null)} onDone={(no) => { setMake(null); setTab('unpaid'); data.reload(); setOpen(no); }} />}
      {open && <InvoiceDrawer no={open} onClose={() => setOpen(null)} onChanged={() => data.reload()} onPrint={() => { setPrint(open); setOpen(null); }} />}
    </section>
  );
}

function MakeInvoice({ no, onClose, onDone }) {
  const [day, setDay] = useState('');
  const one = useLoad(`/billing/to-invoice/${enc(no)}${day ? `?date=${day}` : ''}`);
  const act = useAction();
  const toast = useToast();
  const [f, setF] = useState({ note: '' });
  const [err, setErr] = useState({});
  const d = one.data;
  const save = () => act.run(async () => {
    setErr({});
    try {
      const out = await api.send('POST', '/billing/invoices', { order_no: no, date: day || (d && d.day), ...f });
      toast(out.message.includes('before the goods leave') ? 'warn' : 'good', `${out.invoice_no} made`, out.message);
      onDone(out.invoice_no);
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title={`Invoice for ${no}`} onClose={onClose} thumb={<LIcon name="file-text" />} wide
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy || !d} onClick={save}><LIcon name="check" size="sm" />Make invoice</button></>}>
      {act.note}
      <Loading state={one}>{d && <>
        <Alert tone="info" title={d.kind === 'B2B' ? `B2B tax invoice to ${d.legal} · GSTIN ${d.gstin}.` : 'B2C invoice (customer has no GSTIN).'}>For what is packed and not yet invoiced, at the order&apos;s prices. Number on save: {d.next_no}.</Alert>
        <dl className="a-kv"><dt>Order</dt><dd>{d.order_no}</dd><dt>Place of supply</dt><dd>{stateName(d.place)} ({d.inter ? 'IGST' : 'CGST + SGST'})</dd><dt>Due</dt><dd>{d.due_days ? `${d.due_days} days after the invoice date` : 'cash, on delivery'}</dd></dl>
        <Table columns={lineCols} rows={d.lines} rowKey={(l, i) => `${l.sku_code}-${i}`} label="Lines" />
        <TotalsBox t={d.totals} inter={d.inter} />
        <div className="a-grid2">
          <In label="Invoice date" type="date" min={d.order_day} max={d.today} value={day || d.day} error={fe(err, 'date')} hint="GST is taken at the rate on this date; the lines above follow it." onChange={(e) => setDay(e.target.value)} />
          <In label="Note on the invoice" maxLength={120} value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} />
        </div>
        <Papers needs={d.needs} f={f} setF={setF} err={err} total={d.totals.total} />
      </>}</Loading>
    </Drawer>
  );
}

function InvoiceDrawer({ no, onClose, onChanged, onPrint }) {
  const one = useLoad(`/billing/invoices/${enc(no)}`);
  const act = useAction();
  const toast = useToast();
  const [why, setWhy] = useState('');
  const [f, setF] = useState({});
  const [err, setErr] = useState({});
  const v = one.data;
  const askCancel = () => act.run(async () => {
    setErr({});
    try {
      const out = await api.send('POST', `/billing/invoices/${enc(no)}/cancel`, { reason: why });
      toast(out.waiting ? 'warn' : 'good', out.waiting ? 'Waiting for approval' : `${no} cancelled`, out.message);
      one.reload(); onChanged();
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const savePapers = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', `/billing/invoices/${enc(no)}/papers`, f); toast('good', 'Saved', out.message); one.reload(); onChanged(); } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const missingNeeds = v ? { ewb: v.papers.includes('e-way bill') ? v.needs.ewb : '', irn: v.papers.includes('e-invoice IRN') } : null;
  return (
    <Drawer title={`Invoice ${no}`} onClose={onClose} thumb={<LIcon name="file-text" />} wide
      status={v && <>{statePill(v.state, v.state_label)}<Pill tone="gray">{v.kind}</Pill></>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      {act.note}
      <Loading state={one}>{v && <>
        <div className="a-p21-acts">
          <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={onPrint}><LIcon name="printer" size="sm" />Print</button>
          {v.state !== 'cancelled' && v.can.create && <><a className="a-btn a-btn-sm a-btn-ghost" href={`/admin/credit-notes?for=${enc(no)}`}>Credit note</a><a className="a-btn a-btn-sm a-btn-ghost" href={`/admin/debit-notes?for=${enc(no)}`}>Debit note</a></>}
        </div>
        {v.papers.length > 0 && <Alert tone="bad" title={`Missing: ${v.papers.join(' and ')}.`}>The goods cannot leave and the invoice cannot be printed until it is filled in below.</Alert>}
        {v.cancel_waiting && <Alert tone="warn" title={`Cancel asked: ${v.cancel_waiting.why}.`}>{v.cancel_waiting.summary} Waiting for approval (request {v.cancel_waiting.approval_id}).</Alert>}
        {v.state === 'cancelled' && <Alert tone="info" title="Cancelled.">{v.cancel_reason} The number stays used; the order&apos;s packs can be invoiced again.</Alert>}
        <dl className="a-kv">
          <dt>Customer</dt><dd>{v.buyer.bill.name}{v.buyer.bill.gstin ? ` · GSTIN ${v.buyer.bill.gstin}` : ''}</dd>
          <dt>Order</dt><dd><a href={`/admin/commerce/orders?open=${enc(v.order_no)}`}>{v.order_no}</a></dd>
          <dt>Date / due</dt><dd>{v.day} · due {v.due_on}</dd>
          <dt>Place of supply</dt><dd>{stateName(v.place)} ({v.inter ? 'IGST' : 'CGST + SGST'})</dd>
          {v.ewb_no && <><dt>E-way bill</dt><dd className="a-mono">{v.ewb_no}{v.ewb_valid ? ` valid until ${v.ewb_valid}` : ''}</dd></>}
          {v.irn && <><dt>IRN</dt><dd className="a-mono a-p21-brk">{v.irn} · ack {v.ack_no}</dd></>}
          {v.note && <><dt>Note</dt><dd>{v.note}</dd></>}
          <dt>Made by</dt><dd>{v.made_by} · {at(v.made_at)}</dd>
          {v.state !== 'cancelled' && <><dt>Left to pay</dt><dd><b>{money(v.left)}</b></dd></>}
        </dl>
        <Table columns={lineCols} rows={v.lines} rowKey={(l, i) => `${l.sku_code}-${i}`} label="Lines" />
        <TotalsBox t={v.totals} inter={v.inter} />
        {v.notes.length > 0 && <><h3 className="a-p21-h3">Notes on this invoice</h3><ul className="a-p21-mini">{v.notes.map((x) => <li key={x.no}>{x.type} {x.no} · {x.reason} · {money(x.total)}{x.status !== 'done' ? ` · ${x.status}` : ''}</li>)}</ul></>}
        {v.papers.length > 0 && v.can.create && v.state !== 'cancelled' && (
          <div className="a-p21-end"><b>Add the papers</b><Papers needs={missingNeeds} f={f} setF={setF} err={err} total={v.total} /><button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={savePapers}>Save</button></div>
        )}
        {['open', 'overdue'].includes(v.state) && v.can.cancel && (
          <div className="a-p21-end a-p21-dash"><b>Cancel this invoice</b><p className="a-hint-s">Only while nothing is paid. Needs a second person; the ledger gets a reversing line and the packs can be invoiced again.</p>
            {v.cancel_block ? <Alert tone="warn" title="Cannot cancel now.">{v.cancel_block}</Alert> : <>
              <In label="Reason" maxLength={120} wide value={why} error={fe(err, 'reason')} onChange={(e) => setWhy(e.target.value)} />
              <button type="button" className="a-btn a-btn-sm a-btn-danger" disabled={act.busy} onClick={askCancel}>Ask to cancel</button></>}
          </div>
        )}
      </>}</Loading>
    </Drawer>
  );
}

/** the HSN summary of an invoice (goods by HSN and rate; the delivery charge as SAC 9965 at its own rate) */
function hsnRows(lines, t, inter) {
  const m = new Map();
  for (const l of lines) {
    const k = `${l.hsn}@${l.gst_rate}`;
    const x = m.get(k) || { hsn: l.hsn, rate: Number(l.gst_rate), taxable: 0 };
    x.taxable += Number(l.taxable) || 0; m.set(k, x);
  }
  const out = [...m.values()].map((x) => { const tax = Math.round(x.taxable * x.rate) / 100; return { ...x, taxable: Math.round(x.taxable * 100) / 100, igst: inter ? tax : 0, cgst: inter ? 0 : Math.round((tax / 2) * 100) / 100, sgst: inter ? 0 : Math.round((tax - Math.round((tax / 2) * 100) / 100) * 100) / 100 }; });
  if (Number(t.delivery_charge) > 0) {
    const tax = Number(t.delivery_gst);
    out.push({ hsn: '9965', rate: Math.round((tax / Number(t.delivery_charge)) * 100), taxable: Number(t.delivery_charge), igst: inter ? tax : 0, cgst: inter ? 0 : Math.round((tax / 2) * 100) / 100, sgst: inter ? 0 : Math.round((tax - Math.round((tax / 2) * 100) / 100) * 100) / 100 });
  }
  return out;
}
export function PrintHead({ title, sub, demo, company }) {
  const { me } = useAdmin();
  return (
    <>
      {demo && <div className="a-p21-demo">DEMO - not a tax invoice (the company GSTIN is still to be provided)</div>}
      <div className="a-p19-ph"><img src={mediaUrl((me && me.logo_square) || '/media/logo/favicon-32.png')} alt="" /><div><b>{title}</b>
        <span>{company.name} · GSTIN {company.gstin && !demo ? company.gstin : 'to be provided'}{company.address ? ` · ${company.address}` : ''}</span><span>{sub}</span></div></div>
    </>
  );
}
function InvoicePrint({ no, onBack }) {
  const one = useLoad(`/billing/invoices/${enc(no)}`);
  const v = one.data;
  const [full, setFull] = useState(null);
  const toast = useToast();
  useEffect(() => { if (!v) return; api.get(`/billing/invoice-print/${enc(no)}`).then(setFull).catch(() => setFull(false)); }, [v, no]);
  const mail = () => api.send('POST', `/billing/invoices/${enc(no)}/mail`).then((o) => toast('info', 'Mail prepared', o.message)).catch((e) => toast('bad', 'Not sent', e.message));
  return (
    <section>
      <PageHead sub="The invoice as the customer sees it" actions={<><button type="button" className="a-btn a-btn-ghost" onClick={onBack}><LIcon name="chevron-left" size="sm" />Back</button>
        {v && !v.papers.length && <button type="button" className="a-btn a-btn-ghost" onClick={mail}><LIcon name="mail" size="sm" />Mail to customer</button>}
        {v && !v.papers.length && <button type="button" className="a-btn" onClick={() => window.print()}><LIcon name="printer" size="sm" />Print</button>}</>} />
      <Loading state={one}>{v && (v.papers.length ? <Alert tone="bad" title="Cannot print yet.">Missing {v.papers.join(' and ')}. Add it in the invoice.</Alert> : full && (
        <div className="a-card a-p19-print a-p21-print" id="printArea">
          <PrintHead title={`${v.kind === 'B2B' ? 'Tax invoice' : 'Invoice'} ${v.invoice_no}${v.state === 'cancelled' ? ' (CANCELLED)' : ''}`} demo={full.is_demo}
            sub={`Date ${v.day} · Due ${v.due_on} · Order ${v.order_no}${v.ewb_no ? ` · E-way bill ${v.ewb_no}` : ''}`} company={{ name: full.seller_name, gstin: full.seller_gstin, address: full.seller_address }} />
          {v.irn && <p className="a-hint-s a-mono a-p21-brk">IRN {v.irn} · Ack {v.ack_no}</p>}
          <dl className="a-kv"><dt>Bill to</dt><dd>{[v.buyer.bill.name, v.buyer.bill.address, v.buyer.bill.town, v.buyer.bill.pincode, stateName(v.buyer.bill.state_code)].filter(Boolean).join(', ')}{v.buyer.bill.gstin ? ` · GSTIN ${v.buyer.bill.gstin}` : ''}</dd>
            <dt>Ship to</dt><dd>{[v.buyer.ship.address, v.buyer.ship.town, v.buyer.ship.pincode].filter(Boolean).join(', ') || 'As billed'}</dd><dt>Place of supply</dt><dd>{v.place} {stateName(v.place)}</dd>{v.note && <><dt>Note</dt><dd>{v.note}</dd></>}</dl>
          <table className="a-table"><thead><tr><th>#</th><th>Item</th><th>HSN</th><th className="a-num">Qty</th><th className="a-num">Rate</th><th className="a-num">GST</th><th className="a-num">Taxable</th></tr></thead>
            <tbody>{v.lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td><b>{l.name}</b><small className="a-muted a-p15-sub">{l.sku_code}{l.is_free && l.free_why ? ` · ${l.free_why}` : ''}</small></td><td>{l.hsn}</td><td className="a-num">{l.qty}</td>
              <td className="a-num">{l.is_free ? 'Free' : money(l.price)}</td><td className="a-num">{Number(l.gst_rate)}%</td><td className="a-num">{money(l.taxable)}</td></tr>)}</tbody></table>
          <TotalsBox t={v.totals} inter={v.inter} />
          <p className="a-hint-s"><b>{inWords(v.total)}</b></p>
          <table className="a-table"><thead><tr><th>HSN</th><th className="a-num">Rate</th><th className="a-num">Taxable</th>{v.inter ? <th className="a-num">IGST</th> : <><th className="a-num">CGST</th><th className="a-num">SGST</th></>}</tr></thead>
            <tbody>{hsnRows(v.lines, v.totals, v.inter).map((x) => <tr key={`${x.hsn}${x.rate}`}><td className="a-mono">{x.hsn === '9965' ? 'SAC 9965' : x.hsn}</td><td className="a-num">{x.rate}%</td><td className="a-num">{money(x.taxable)}</td>
              {v.inter ? <td className="a-num">{money(x.igst)}</td> : <><td className="a-num">{money(x.cgst)}</td><td className="a-num">{money(x.sgst)}</td></>}</tr>)}</tbody></table>
          <p className="a-hint-s">Pay to: {full.bank || 'bank details to be provided'}</p>
          {full.upi && v.left > 0 && <div className="a-p21-qr"><span dangerouslySetInnerHTML={{ __html: qrSvg(upiLink({ upi: full.upi, name: full.seller_name, amount: v.left, note: v.invoice_no }), 110) }} /><p><b>Pay by UPI:</b> {full.upi}<br /><small>Scan with any UPI app: {money(v.left)} for {v.invoice_no}</small></p></div>}
          <p className="a-hint-s">{full.declaration} {full.terms}</p>
          <p className="a-hint-s">For {full.seller_name} · {full.signatory ? `${full.signatory}, authorised signatory` : 'Authorised signatory'}</p>
        </div>
      ))}{v && full === false && <Alert tone="bad" title="The invoice could not be read.">Open it again.</Alert>}</Loading>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Credit notes
export function CreditNotes() {
  const data = useLoad('/billing/credit-notes');
  const [tab, setTab] = useState('waiting');
  const [neu, setNeu] = useState(null);
  const [print, setPrint] = useState(null);
  const d = data.data;
  useEffect(() => { const m = /[?&]for=([^&]+)/.exec(window.location.search); if (m) setNeu(decodeURIComponent(m[1])); }, []);
  if (print) return <NotePrint no={print} onBack={() => setPrint(null)} />;
  const cols = [
    { key: 'no', label: 'Credit note', render: (c) => <><b className="a-mono">{c.credit_note_no}</b><small className="a-muted a-p15-sub">{c.day}</small></> },
    { key: 'customer', label: 'Customer', render: custCell },
    { key: 'inv', label: 'Against', render: (c) => <>{c.invoice_no}{c.return_no && <small className="a-muted a-p15-sub">return {c.return_no}</small>}</> },
    { key: 'why', label: 'Why', render: (c) => <>{c.reason}{c.status === 'waiting' && c.approval && <small className="a-muted a-p15-sub">Waiting for approval</small>}</> },
    { key: 'total', label: 'Total', num: true, render: (c) => <b>{money(c.total)}</b> },
    { key: 'act', label: '', render: (c) => <button type="button" className="a-btn a-btn-sm a-btn-ghost" aria-label={`Print ${c.credit_note_no}`} onClick={() => setPrint(c.credit_note_no)}><LIcon name="printer" size="sm" /></button> },
  ];
  const due = [
    { key: 'return_no', label: 'Return', render: (r) => <b className="a-mono">{r.return_no}</b> },
    { key: 'order_no', label: 'Order' },
    { key: 'customer', label: 'Customer' },
    { key: 'status', label: 'What happens', render: () => 'Credited when the return is refunded (Returns)' },
  ];
  return (
    <section>
      <PageHead sub="Money given back: returns, corrections" rules={['Goods back from a delivery: credit at the invoice price', 'A credit without goods coming back needs approval', 'Reduces what the customer owes']}
        actions={d && d.can.create && <button type="button" className="a-btn" onClick={() => setNeu('')}><LIcon name="plus" size="sm" />Price correction</button>} />
      <Loading state={data}>{d && <>
        <Tabs label="Credit notes" value={tab} onChange={setTab} tabs={[{ key: 'to_credit', label: 'To credit', count: d.counts.to_credit, tone: 'warn' }, { key: 'waiting', label: 'Waiting for approval', count: d.counts.waiting, tone: 'warn' }, { key: 'done', label: 'Made', count: d.counts.done }, { key: 'rejected', label: 'Rejected', count: d.counts.rejected }]} />
        <div className="a-listcard">
          {tab === 'to_credit' ? <Table columns={due} rows={d.to_credit} rowKey={(r) => r.return_no} label="To credit" empty={{ icon: 'undo-2', title: 'Nothing to credit', text: 'Short and refused deliveries are credited when the goods come back; returns when they are refunded.' }} />
            : <Table columns={cols} rows={d[tab]} rowKey={(c) => c.credit_note_no} label={tab} empty={{ icon: 'undo-2', title: 'Nothing here', text: 'No credit note in this list.' }} />}
        </div>
      </>}</Loading>
      {neu !== null && d && <PriceNote d={d} invoice={neu} onClose={() => setNeu(null)} onDone={(w) => { setNeu(null); setTab(w ? 'waiting' : 'done'); data.reload(); }} />}
    </section>
  );
}
function PriceNote({ d, invoice, onClose, onDone }) {
  const [f, setF] = useState({ invoice_no: invoice || '', why: 'Price correction', amount: '', note: '' });
  const [err, setErr] = useState({});
  const act = useAction();
  const toast = useToast();
  const room = useLoad(f.invoice_no ? `/billing/credit-room/${enc(f.invoice_no)}` : null);
  const r = f.invoice_no ? room.data : null;
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', '/billing/credit-notes', f); toast(out.waiting ? 'warn' : 'good', out.waiting ? 'Waiting for approval' : `${out.credit_note_no} made`, out.message); onDone(out.waiting); } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title="Credit note: price correction" onClose={onClose} thumb={<LIcon name="undo-2" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Ask for approval</button></>}>
      {act.note}
      <Alert tone="warn" title="No goods come back: needs a second person">(rule &quot;Credit note not tied to a return&quot;).</Alert>
      <div className="a-grid2">
        <Field def={{ name: 'invoice_no', label: 'Against invoice', type: 'select', required: true, error: err.invoice_no, options: d.invoices.map((x) => ({ value: x.invoice_no, label: `${x.invoice_no} · ${x.customer} · ${money(x.total)}` })) }} value={f.invoice_no} onChange={(v) => setF((x) => ({ ...x, invoice_no: v }))} />
        <Field def={{ name: 'why', label: 'Why', type: 'select', allowEmpty: false, required: true, options: d.reasons.map((x) => ({ value: x, label: x })) }} value={f.why} onChange={(v) => setF((x) => ({ ...x, why: v }))} />
        <In label="Amount without GST (Rs)" type="number" min="1" step="0.01" value={f.amount} error={fe(err, 'amount')} hint={r ? `Not more than the invoice value without GST (${money(r.taxable)}). Room left on it: ${money(Math.max(0, r.room))} with GST${r.held ? ` (${money(r.held)} held for returns still open on it)` : ''}.` : 'Not more than the invoice value without GST.'} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} />
        <In label="GST rate" readOnly value={r ? `${r.rate}%, the invoice's own rate` : 'Same as the invoice'} hint="Copied from the invoice, so the GST return matches." />
        <In label="Details" wide maxLength={120} placeholder="e.g. Agreed Rs 2 less per pack on 40 packs" value={f.note} error={fe(err, 'note')} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} />
      </div>
    </Drawer>
  );
}
export function NotePrint({ no, onBack }) {
  const one = useLoad(`/billing/notes/${enc(no)}`);
  const x = one.data;
  const inter = x && x.gst_type === 'inter';
  return (
    <section>
      <PageHead sub="The note as the customer sees it" actions={<><button type="button" className="a-btn a-btn-ghost" onClick={onBack}><LIcon name="chevron-left" size="sm" />Back</button><button type="button" className="a-btn" onClick={() => window.print()}><LIcon name="printer" size="sm" />Print</button></>} />
      <Loading state={one}>{x && (
        <div className="a-card a-p19-print a-p21-print" id="printArea">
          <PrintHead title={`${x.title} ${x.no}`} demo={x.demo} sub={`Date ${x.day} · Against invoice ${x.invoice_no}${x.due_on ? ` · Due ${x.due_on}` : ''}`} company={x.company} />
          <dl className="a-kv"><dt>Bill to</dt><dd>{x.buyer.bill.name}{x.buyer.bill.gstin ? ` · GSTIN ${x.buyer.bill.gstin}` : ''}</dd><dt>Place of supply</dt><dd>{x.place_of_supply} {stateName(x.place_of_supply)}</dd><dt>Reason</dt><dd>{x.reason}</dd></dl>
          <table className="a-table"><thead><tr><th>#</th><th>Item</th><th>HSN</th><th className="a-num">Qty</th><th className="a-num">GST</th><th className="a-num">Taxable</th></tr></thead>
            <tbody>{x.lines.length ? x.lines.map((l, i) => <tr key={i}><td>{i + 1}</td><td><b>{l.name}</b><small className="a-muted a-p15-sub">{l.sku_code}</small></td><td>{l.hsn}</td><td className="a-num">{l.qty}</td><td className="a-num">{l.gst_rate}%</td><td className="a-num">{money(l.taxable)}</td></tr>)
              : <tr><td>1</td><td><b>{x.reason}</b></td><td>{x.main_hsn}</td><td className="a-num">1</td><td className="a-num">{x.gst_rate}%</td><td className="a-num">{money(x.taxable)}</td></tr>}</tbody></table>
          <TotalsBox t={{ taxable: x.taxable, delivery_charge: 0, cgst: x.cgst, sgst: x.sgst, igst: x.igst, round_off: x.round_off, total: x.total }} inter={inter} />
          <p className="a-hint-s"><b>{inWords(x.total)}</b></p>
          <p className="a-hint-s">{x.company.declaration} {x.company.terms}</p>
          <p className="a-hint-s">For {x.company.name} · {x.company.signatory ? `${x.company.signatory}, authorised signatory` : 'Authorised signatory'}</p>
        </div>
      )}</Loading>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Debit notes
export function DebitNotes() {
  const data = useLoad('/billing/debit-notes');
  const [neu, setNeu] = useState(null);
  const [print, setPrint] = useState(null);
  const d = data.data;
  useEffect(() => { const m = /[?&]for=([^&]+)/.exec(window.location.search); if (m) setNeu(decodeURIComponent(m[1])); }, []);
  if (print) return <NotePrint no={print} onBack={() => setPrint(null)} />;
  const cols = [
    { key: 'no', label: 'Debit note', render: (x) => <><b className="a-mono">{x.debit_note_no}</b><small className="a-muted a-p15-sub">{x.day}</small></> },
    { key: 'customer', label: 'Customer', render: custCell },
    { key: 'inv', label: 'Against', render: (x) => x.invoice_no },
    { key: 'why', label: 'Why', render: (x) => <>{x.reason}{x.note && <small className="a-muted a-p15-sub">{x.note}</small>}</> },
    { key: 'total', label: 'Total', num: true, render: (x) => <b>{money(x.total)}</b> },
    { key: 'due_on', label: 'Due' },
    { key: 'act', label: '', render: (x) => <button type="button" className="a-btn a-btn-sm a-btn-ghost" aria-label={`Print ${x.debit_note_no}`} onClick={() => setPrint(x.debit_note_no)}><LIcon name="printer" size="sm" /></button> },
  ];
  return (
    <section>
      <PageHead sub="Extra charge added after the invoice" rules={['Extra charge after the invoice', 'Adds to what the customer owes', 'Series DFS']}
        actions={d && d.can.create && <button type="button" className="a-btn" onClick={() => setNeu('')}><LIcon name="plus" size="sm" />New debit note</button>} />
      <Loading state={data}>{d && <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(x) => x.debit_note_no} label="Debit notes" empty={{ icon: 'file-text', title: 'No debit note', text: 'New debit note adds a charge to an invoice.' }} /></div>}</Loading>
      {neu !== null && d && <DebitDrawer d={d} invoice={neu} onClose={() => setNeu(null)} onDone={() => { setNeu(null); data.reload(); }} />}
    </section>
  );
}
function DebitDrawer({ d, invoice, onClose, onDone }) {
  const [f, setF] = useState({ invoice_no: invoice || '', why: d.reasons[0], amount: '', note: '' });
  const [err, setErr] = useState({});
  const act = useAction();
  const toast = useToast();
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', '/billing/debit-notes', f); toast('good', `${out.debit_note_no} made`, out.message); onDone(); } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title="New debit note" onClose={onClose} thumb={<LIcon name="file-text" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Make debit note</button></>}>
      {act.note}
      <div className="a-grid2">
        <Field def={{ name: 'invoice_no', label: 'Against invoice', type: 'select', required: true, error: err.invoice_no, options: d.invoices.map((x) => ({ value: x.invoice_no, label: `${x.invoice_no} · ${x.customer}` })) }} value={f.invoice_no} onChange={(v) => setF((x) => ({ ...x, invoice_no: v }))} />
        <Field def={{ name: 'why', label: 'Why', type: 'select', allowEmpty: false, required: true, error: err.why, options: d.reasons.map((x) => ({ value: x, label: x })) }} value={f.why} onChange={(v) => setF((x) => ({ ...x, why: v }))} />
        <In label="Amount without GST (Rs)" type="number" min="1" step="0.01" value={f.amount} error={fe(err, 'amount')} onChange={(e) => setF((x) => ({ ...x, amount: e.target.value }))} />
        <In label="GST rate" readOnly value="From the invoice" hint="The same rate as the invoice it adds to." />
        <In label="Details" wide maxLength={120} value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} />
      </div>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Delivery challans
export function Challans() {
  const data = useLoad('/billing/challans');
  const [neu, setNeu] = useState(false);
  const [print, setPrint] = useState(null);
  const d = data.data;
  if (print) return <ChallanPrint no={print} onBack={() => setPrint(null)} />;
  const cols = [
    { key: 'no', label: 'Challan', render: (r) => <><b className="a-mono">{r.no}</b><small className="a-muted a-p15-sub">{at(r.at)}</small></> },
    { key: 'to', label: 'To' },
    { key: 'why', label: 'Why' },
    { key: 'items', label: 'Items', hideSm: true },
    { key: 'value', label: 'Value', num: true, render: (r) => money(r.value) },
    { key: 'act', label: '', render: (r) => (r.own ? <button type="button" className="a-btn a-btn-sm a-btn-ghost" aria-label={`Print ${r.no}`} onClick={() => setPrint(r.no)}><LIcon name="printer" size="sm" /></button> : <a href={`/admin/transfers?open=${enc(r.no)}`}>Transfer</a>) },
  ];
  return (
    <section>
      <PageHead sub="Goods sent without a sale" rules={['Goods that move without a sale', 'Samples, on approval, job work', 'Transfers between godowns use the same series']}
        actions={d && d.can.create && <button type="button" className="a-btn" onClick={() => setNeu(true)}><LIcon name="plus" size="sm" />New challan</button>} />
      <Loading state={data}>{d && <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(r) => r.no} label="Delivery challans" empty={{ icon: 'truck', title: 'No challan', text: 'New challan sends goods without a sale.' }} /></div>}</Loading>
      {neu && d && <ChallanDrawer d={d} onClose={() => setNeu(false)} onDone={() => { setNeu(false); data.reload(); }} />}
    </section>
  );
}
function ChallanDrawer({ d, onClose, onDone }) {
  const skus = useLoad('/sales/options');
  const [f, setF] = useState({ godown_id: d.godowns[0] ? String(d.godowns[0].id) : '', why: d.reasons[0], to_name: '', to_address: '' });
  const [lines, setLines] = useState([{ sku_code: '', qty: '' }]);
  const [err, setErr] = useState({});
  const act = useAction();
  const toast = useToast();
  const opts = skus.data ? (skus.data.packs || []).map((s) => ({ value: s.sku_code, label: `${s.sku_code} · ${s.name}${s.size_label ? ` ${s.size_label}` : ''}` })) : [];
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', '/billing/challans', { ...f, lines }); toast('good', `${out.challan_no} made`, out.message); onDone(); } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title="New delivery challan" onClose={onClose} thumb={<LIcon name="truck" />} wide
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Make challan</button></>}>
      {act.note}
      <div className="a-grid2">
        <Field def={{ name: 'godown_id', label: 'From', type: 'select', allowEmpty: false, required: true, error: err.godown_id, options: d.godowns.map((g) => ({ value: String(g.id), label: g.name })) }} value={f.godown_id} onChange={(v) => setF((x) => ({ ...x, godown_id: v }))} />
        <Field def={{ name: 'why', label: 'Why', type: 'select', allowEmpty: false, required: true, error: err.why, options: d.reasons.map((x) => ({ value: x, label: x })) }} value={f.why} onChange={(v) => setF((x) => ({ ...x, why: v }))} />
        <In label="To (name)" maxLength={80} value={f.to_name} error={fe(err, 'to_name')} onChange={(e) => setF((x) => ({ ...x, to_name: e.target.value }))} />
        <In label="Address" maxLength={120} value={f.to_address} error={fe(err, 'to_address')} onChange={(e) => setF((x) => ({ ...x, to_address: e.target.value }))} />
      </div>
      <b>Items</b>
      {lines.map((l, i) => (
        <div key={i} className="a-p21-line">
          <Field def={{ name: `sku${i}`, label: 'Item', type: 'select', required: true, error: fe(err, `lines.${i}.sku_code`), options: opts }} value={l.sku_code} onChange={(v) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, sku_code: v } : x)))} />
          <In label="Packs" type="number" min="1" step="1" value={l.qty} error={fe(err, `lines.${i}.qty`)} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} />
        </div>
      ))}
      <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setLines((ls) => [...ls, { sku_code: '', qty: '' }])}><LIcon name="plus" size="sm" />Add an item</button>
    </Drawer>
  );
}
function ChallanPrint({ no, onBack }) {
  const one = useLoad(`/billing/challans/${enc(no)}`);
  const x = one.data;
  return (
    <section>
      <PageHead sub="Goes with the goods" actions={<><button type="button" className="a-btn a-btn-ghost" onClick={onBack}><LIcon name="chevron-left" size="sm" />Back</button><button type="button" className="a-btn" onClick={() => window.print()}><LIcon name="printer" size="sm" />Print</button></>} />
      <Loading state={one}>{x && (
        <div className="a-card a-p19-print a-p21-print" id="printArea">
          <PrintHead title={`Delivery challan ${x.challan_no}`} sub={`${at(x.day)} · ${x.why} · not a sale`} company={x.company} />
          <dl className="a-kv"><dt>From</dt><dd>{x.godown}</dd><dt>To</dt><dd>{x.to_name}, {x.to_address}</dd></dl>
          <table className="a-table"><thead><tr><th>#</th><th>Item</th><th className="a-num">Packs</th></tr></thead>
            <tbody>{x.lines.map((l, i) => <tr key={l.sku_code}><td>{i + 1}</td><td><b>{l.name}</b><small className="a-muted a-p15-sub">{l.sku_code}{l.hsn ? ` · HSN ${l.hsn}` : ''}</small></td><td className="a-num">{l.qty}</td></tr>)}</tbody></table>
          <p className="a-hint-s">Value for transport: {money(x.value)}. Goods sent for {String(x.why).toLowerCase()}; no sale.</p>
        </div>
      )}</Loading>
    </section>
  );
}
