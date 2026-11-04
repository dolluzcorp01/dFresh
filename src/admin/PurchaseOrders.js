// Purchase > Purchase orders (phase 16, v23 viewPOs / DRAWERS.poEdit / DRAWERS.po / poPrintView; API /buying/pos in
// buying-routes.js). Tabs Drafts / Waiting for approval / Open / Received / Closed and cancelled (Open first). A draft
// has no number; Raise numbers it. While typing, each line shows the last price paid (or the supplier's list), "up n%",
// below their minimum order, and the GST; the box under the total says whether it needs approval (orders to one
// supplier within the days that count together add up). Amend makes a new revision; a higher value or a higher rate or
// a new line waits again and the approved revision stays in force; rejected amendments stay in the history. Print or
// send (PDF, mail through the outbox), Goods in, Cancel (nothing came in) or Close short, with a reason and the Cancel
// right. Rates and totals only with See cost or Buying Edit.
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, Tabs, money, useAction, useAdmin, useCan, useConfirm, useLoad, useToast } from './ui';
import { In, ItemCell, SupCell, TotalsBox, ViewOnlyB, addDays, at, bm, fe, fieldsOf, rs0, today, useOpenParam } from './buyShared';

const TONE = { draft: 'gray', waiting: 'warn', open: 'info', part: 'warn', received: 'good', closed: 'gray', cancelled: 'gray', rejected: 'bad' };
const TABS = [['draft', 'Drafts'], ['waiting', 'Waiting for approval'], ['open', 'Open'], ['received', 'Received'], ['closed', 'Closed and cancelled']];
export const PoPill = ({ p }) => <><Pill tone={TONE[p.state]}>{p.state_label}</Pill>{p.rev > 1 && <> <Pill>Rev {p.rev}</Pill></>}{p.late && <> <Pill tone="bad">Late</Pill></>}</>;

export default function PurchaseOrders() {
  const [tab, setTab] = useState('open');
  const data = useLoad(`/buying/pos?tab=${tab}`);
  const opts = useLoad('/buying/options');
  const { me } = useAdmin();
  const canEdit = useCan('buying', 'edit');
  const toast = useToast();
  const [open, setOpen] = useState(null); // { view: id } | { edit: id | 'new', pre }
  const [print, setPrint] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen({ view: Number(id) }));
  const reload = () => data.reload();
  if (print) return <PoPrint id={print} onBack={() => setPrint(null)} />;
  const columns = [
    { key: 'ref', label: 'Purchase order', render: (p) => <><b className="a-mono">{p.ref}</b><small className="a-muted a-p15-sub">{p.godown} · {p.po_date || 'not raised'}</small></> },
    { key: 'supplier', label: 'Supplier', render: (p) => <SupCell s={p.supplier} /> },
    { key: 'items', label: 'Items', hideSm: true, render: (p) => p.items_text },
    { key: 'expected_on', label: 'Expected', hideSm: true },
    { key: 'total', label: 'Total', num: true, render: (p) => <><b>{bm(p.total)}</b><small className="a-muted a-p15-sub">{bm(p.value)} without GST</small></> },
    { key: 'received_pct', label: 'Received', num: true, hideSm: true, render: (p) => `${p.received_pct}%` },
    { key: 'state', label: 'Status', render: (p) => <PoPill p={p} /> },
  ];
  const empty = { draft: 'No drafts. New purchase order starts one.', waiting: 'Nothing is waiting for approval.', open: 'No purchase order is open.', received: 'Nothing fully received yet.', closed: 'Nothing closed or cancelled.' }[tab];
  return (
    <section>
      <PageHead sub="What we order, from whom, at what price" rules={d ? [`Above ${rs0(d.rule.above)} without GST needs approval`, 'Numbered only when raised, so no gaps', 'Amend keeps every revision'] : []}
        actions={<>{d && d.can.export && <button type="button" className="a-btn a-btn-ghost" onClick={() => api.download('/buying/pos-export', 'dfresh-purchase-orders.csv').then(() => toast('good', 'Exported', 'One row per line.'), (e) => toast('bad', 'Not exported', e.message))}><LIcon name="download" size="sm" />Export CSV</button>}
          {canEdit && <button type="button" className="a-btn" onClick={() => setOpen({ edit: 'new' })}><LIcon name="plus" size="sm" />New purchase order</button>}</>} />
      {!canEdit && <ViewOnlyB me={me} what="purchase orders" />}
      <Loading state={data}>
        {d && (
          <>
            <Tabs label="Purchase orders" value={tab} onChange={setTab} tabs={TABS.map(([k, l]) => ({ key: k, label: l, count: d.counts[k] }))} />
            <div className="a-listcard">
              <Table columns={columns} rows={d.rows} rowKey={(p) => p.po_id} label="Purchase orders" onRowClick={(p) => setOpen(p.status === 'draft' ? { edit: p.po_id } : { view: p.po_id })} empty={{ icon: 'inbox', title: 'Nothing here', text: empty }} />
            </div>
          </>
        )}
      </Loading>
      {open && open.view && <PoDrawer id={open.view} onClose={() => setOpen(null)} onChanged={reload} onAmend={() => setOpen({ edit: open.view, amend: true })} onPrint={() => { setPrint(open.view); setOpen(null); }} />}
      {open && open.edit && opts.data && <PoEditDrawer id={open.edit} amend={open.amend} pre={open.pre} opts={opts.data} onClose={() => setOpen(null)}
        onSaved={(out) => { setOpen(out && out.po_id && !out.draft ? { view: out.po_id } : null); setTab(out && out.draft ? 'draft' : out && out.waiting ? 'waiting' : tab); reload(); }} />}
    </section>
  );
}

const blankLine = () => ({ sku_code: '', qty: '', rate: '', disc: '0' });

/** new, draft or amend: supplier, godown, expected date, lines, freight, terms; the live box under the total */
export function PoEditDrawer({ id, amend = false, pre = null, opts, onClose, onSaved }) {
  const isNew = id === 'new';
  const one = useLoad(isNew ? null : `/buying/pos/${id}`);
  if (!isNew && !one.data) return <Drawer title="Purchase order" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  return <PoForm p={isNew ? null : one.data} amend={amend} pre={pre} opts={opts} onClose={onClose} onSaved={onSaved} />;
}

function PoForm({ p, amend, pre, opts, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const g0 = opts.godowns[0];
  const start = p ? { supplier_id: String(p.supplier.supplier_id), godown_id: String(p.godown_id), expected_on: p.expected_on, freight: p.freight ? String(p.freight) : '', terms: p.terms || '',
    lines: p.lines.map((l) => ({ sku_code: l.sku_code, qty: String(l.qty), rate: l.rate === null ? '' : String(l.rate), disc: String(l.disc || 0) })) }
    : { supplier_id: pre ? String(pre.supplier_id || '') : '', godown_id: String(pre ? pre.godown_id : g0 ? g0.godown_id : ''), expected_on: addDays(today(), 7), freight: '',
      terms: `Delivered to our ${((pre && opts.godowns.find((g) => g.godown_id === pre.godown_id)) || g0 || { name: 'godown' }).name}.`, lines: pre ? pre.lines : [blankLine()] };
  const [f, setF] = useState(start);
  const [err, setErr] = useState({});
  const [calc, setCalc] = useState(null);
  const timer = useRef(null);
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const isAmend = amend || (p && p.status !== 'draft');
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setL = (i, k, v) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  useEffect(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      api.send('POST', '/buying/pos/check', { ...f, po_id: p ? p.po_id : undefined }).then(setCalc, () => setCalc(null));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [f, p]);
  const pickItem = async (i, sku) => {
    setL(i, 'sku_code', sku);
    const line = f.lines[i];
    if (sku && f.supplier_id && (!line || line.rate === '')) {
      const r = await api.get(`/buying/last-price?supplier=${f.supplier_id}&sku=${encodeURIComponent(sku)}${p ? `&po=${p.po_id}` : ''}`).catch(() => null);
      if (r && r.last) setL(i, 'rate', String(r.last.rate));
    }
  };
  const go = (action) => act.run(async () => {
    setErr({});
    try {
      const out = isAmend ? await api.send('POST', `/buying/pos/${p.po_id}/amend`, f)
        : await api.send('POST', '/buying/pos', { ...f, action, po_id: p ? p.po_id : undefined, indent_id: pre ? pre.indent_id : undefined });
      toast(out.waiting ? 'warn' : out.nothing ? 'info' : 'good', isAmend ? (out.nothing ? 'Nothing changed' : out.waiting ? 'Saved, waits for approval' : 'Saved') : out.draft ? 'Draft saved' : `${out.po_no}${out.waiting ? ' waits for approval' : ' raised'}`, out.message);
      if (!out.nothing) onSaved({ ...out, po_id: out.po_id || (p && p.po_id) });
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const sup = opts.suppliers.find((s) => String(s.supplier_id) === String(f.supplier_id));
  const mine = [...opts.items].sort((a, b) => a.sku_code.localeCompare(b.sku_code));
  const title = isAmend ? `Amend ${p.po_no}` : p ? `Draft ${p.ref.replace('Draft ', '')}` : 'New purchase order';
  return (
    <Drawer title={title} onClose={onClose} dirty={dirty} thumb={<LIcon name="shopping-cart" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button>
        {isAmend ? <button type="button" className="a-btn" disabled={act.busy} onClick={() => go('amend')}><LIcon name="check" size="sm" />Save Rev {p.rev + 1}</button>
          : <><button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={() => go('draft')}>Save draft</button>
            <button type="button" className="a-btn" disabled={act.busy} onClick={() => go('raise')}><LIcon name="send" size="sm" />Raise purchase order</button></>}</>}>
      {isAmend && <Alert tone="warn" title={`Amending ${p.po_no} (now Rev ${p.rev}).`}>Saving makes Rev {p.rev + 1} and keeps Rev {p.rev} in the history. A line cannot go below what has come in. If the new value needs approval, it waits again before the supplier sees it.</Alert>}
      {pre && pre.indent_no && <Alert tone="info" title={`From indent ${pre.indent_no}.`}>The cheapest active supplier for the first item is filled in, each line at the last price paid. Raised, the indent becomes Turned into PO.</Alert>}
      {act.note}
      {err.lines && <Alert tone="bad" title="Not saved.">{err.lines}</Alert>}
      <div className="a-grid2">
        <Field def={{ name: 'supplier_id', label: 'Supplier', type: 'select', required: true, locked: isAmend, error: err.supplier_id, help: isAmend ? 'The supplier of a raised order never changes; cancel it and raise a new one.' : 'Suppliers on hold or blocked cannot be chosen.',
          options: opts.suppliers.map((s) => ({ value: String(s.supplier_id), label: `${s.name}${s.status !== 'active' ? ` - ${s.status === 'hold' ? 'on hold' : 'blocked'}` : ''}` })) }} value={f.supplier_id} onChange={(v) => set('supplier_id')(v || '')} />
        <Field def={{ name: 'godown_id', label: 'Deliver to', type: 'select', allowEmpty: false, required: true, locked: isAmend, error: err.godown_id, options: opts.godowns.map((g) => ({ value: String(g.godown_id), label: g.name })) }} value={f.godown_id} onChange={set('godown_id')} />
        <Field def={{ name: 'expected_on', label: 'Expected on', type: 'date', required: true, error: err.expected_on, help: "Used for the supplier's on-time record." }} value={f.expected_on} onChange={set('expected_on')} />
      </div>
      {sup && sup.status !== 'active' && !isAmend && <Alert tone="bad" title={`${sup.name} is ${sup.status === 'hold' ? 'on hold' : 'blocked'}.`}>{sup.why}</Alert>}
      <div className="a-p16-lines">
        {f.lines.map((l, i) => {
          const h = calc && calc.hints ? calc.hints[i] : null;
          return (
            <div key={i} className="a-p16-lrow a-p16-polrow">
              <In label="Item" wide error={fe(err, `lines.${i}.sku_code`)} hint={h && h.text ? h.text : null}>
                <select value={l.sku_code} onChange={(e) => pickItem(i, e.target.value)}><option value="">Choose...</option>
                  {mine.map((it) => <option key={it.sku_code} value={it.sku_code}>{it.sku_code} · {it.name}</option>)}</select></In>
              <In label="Quantity" type="number" min="1" step="1" value={l.qty} error={fe(err, `lines.${i}.qty`)} onChange={(e) => setL(i, 'qty', e.target.value)} />
              <In label="Rate (Rs, no GST)" type="number" min="0" step="0.01" value={l.rate} error={fe(err, `lines.${i}.rate`)} onChange={(e) => setL(i, 'rate', e.target.value)} />
              <In label="Disc. %" type="number" min="0" max="99" step="0.5" value={l.disc} error={fe(err, `lines.${i}.disc`)} onChange={(e) => setL(i, 'disc', e.target.value)} />
              <div className="a-p16-amt"><span className="a-muted">Amount</span><b>{h && h.amount !== null ? money(h.amount) : '-'}</b>{h && h.up && <small className="a-p16-up">price up</small>}</div>
              <button type="button" className="a-iconbtn a-p16-del" aria-label="Remove this row" onClick={() => setF((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((_, j) => j !== i) : [blankLine()] }))}><LIcon name="trash-2" size="sm" /></button>
            </div>
          );
        })}
        <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, blankLine()] }))}><LIcon name="plus" size="sm" />Add an item</button>
      </div>
      <div className="a-grid2">
        <Field def={{ name: 'freight', label: 'Freight and loading (Rs, no GST)', type: 'number', min: 0, error: err.freight, help: opts.switches.freightCost ? 'Spread over the lines by value into the average cost (Switches).' : 'Not added to the stock cost (Switches).' }} value={f.freight} onChange={set('freight')} />
        <Field def={{ name: 'terms', label: 'Terms printed on the order', type: 'textarea', rows: 2, wide: true }} value={f.terms} onChange={(v) => set('terms')(String(v).slice(0, 300))} />
      </div>
      <div className="a-p16-calc">
        {!calc || !calc.totals ? <p className="a-hint-s">Choose a supplier and at least one item with a quantity and rate to see the total.</p> : (
          <>
            <TotalsBox t={calc.totals} seeBuy={calc.see} />
            <div>
              {calc.need ? (
                <Alert tone="warn" title="Needs approval.">{rs0(calc.value)} without GST{calc.before > 0 ? `, with ${rs0(calc.before)} of ${calc.amend ? 'other orders to this supplier' : 'other orders to this supplier in the days that count together'}, ${rs0(calc.value + calc.before)},` : ''} is above the {rs0(calc.rule.above)} in Approval rules{calc.amend ? ', or a rate went up' : ''}. {calc.amend ? 'Saved, it waits again; the supplier sees the new revision after a second person approves.' : 'Raised, it waits; the supplier gets it after a second person approves.'}</Alert>
              ) : (
                <Alert tone="good" title="No approval needed.">{rs0(calc.value)} without GST{calc.before > 0 ? ` (with ${rs0(calc.before)} of other orders to this supplier, ${rs0(calc.value + calc.before)})` : ''} is within {calc.rule.on ? rs0(calc.rule.above) : 'the rules (switched off)'}. {calc.amend ? 'Saved, the new revision is ready for the supplier.' : 'Raised, it goes to the supplier at once.'}</Alert>
              )}
              {calc.notes.length > 0 && <Alert tone="info" title="Check before raising.">{calc.notes.join(' ')}</Alert>}
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

/** one raised order: lines with ordered / in / open, totals, goods in, claims, revisions; the actions of its state */
function PoDrawer({ id, onClose, onChanged, onAmend, onPrint }) {
  const one = useLoad(`/buying/pos/${id}`);
  const act = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const nav = useNavigate();
  const [why, setWhy] = useState('');
  const [whyErr, setWhyErr] = useState(null);
  const p = one.data;
  if (!p) return <Drawer title="Purchase order" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  const st = p.state;
  const end = async (kind) => {
    if (!why.trim()) { setWhyErr('Give a reason.'); return; }
    setWhyErr(null);
    const ok = await confirm(kind === 'close' ? { title: `Close ${p.po_no} short?`, message: 'What is still open will not be expected any more.', action: 'Close short', danger: true }
      : { title: `Cancel ${p.po_no}?`, message: 'The number stays used and is shown as cancelled.', action: 'Cancel order', danger: true });
    if (!ok) return;
    act.run(async () => { const out = await api.send('POST', `/buying/pos/${p.po_id}/end`, { kind, reason: why }); toast('good', kind === 'close' ? 'Closed short' : 'Cancelled', out.message); one.reload(); onChanged(); });
  };
  const del = async () => {
    if (!(await confirm({ title: 'Delete this draft?', message: 'A draft has no number yet, so nothing is lost from the series.', action: 'Delete', danger: true }))) return;
    act.run(async () => { await api.send('DELETE', `/buying/pos/${p.po_id}`); toast('good', 'Draft deleted'); onChanged(); onClose(); });
  };
  const KV = ({ k, children }) => <><dt>{k}</dt><dd>{children}</dd></>;
  const acts = (
    <>
      {['open', 'part', 'received', 'closed'].includes(st) && p.totals && <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={onPrint}><LIcon name="printer" size="sm" />Print or send</button>}
      {['open', 'part'].includes(st) && p.can.edit && <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={onAmend}><LIcon name="pencil" size="sm" />Amend</button>}
      {['open', 'part'].includes(st) && p.can.create && <button type="button" className="a-btn a-btn-sm" onClick={() => nav(`/admin/goods-in?po=${p.po_id}`)}><LIcon name="truck" size="sm" />Goods in</button>}
      {st === 'draft' && p.can.edit && <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={del}><LIcon name="trash-2" size="sm" />Delete draft</button>}
    </>
  );
  return (
    <Drawer title={`Purchase order ${p.ref}`} onClose={onClose} thumb={<LIcon name="shopping-cart" />} status={<><PoPill p={p} /><span className="a-p15-sp" />{acts}</>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      {act.note}
      {st === 'waiting' && p.amendment && <Alert tone="warn" title={`Rev ${p.amendment.rev} waits for approval.`}>{p.amendment.line} Until it is signed, Rev {p.rev} below is the order: goods in and bills use it.</Alert>}
      {st === 'waiting' && !p.amendment && p.waiting && <Alert tone="warn" title="Waiting for approval.">{p.waiting} The supplier does not see it until then.</Alert>}
      {st === 'rejected' && <Alert tone="bad" title="Rejected.">Raise a new one if it is still needed.</Alert>}
      {(st === 'closed' || st === 'cancelled') && p.ended && <Alert tone="info" title={`${st === 'closed' ? 'Closed short' : 'Cancelled'} by ${p.ended.by}.`}>{p.ended.why}</Alert>}
      <dl className="a-kv">
        <KV k="Supplier">{p.supplier.name} · {p.supplier.gstin || 'not registered'}</KV>
        <KV k="Deliver to">{p.godown}</KV>
        <KV k="Ordered on">{p.po_date || '-'}</KV>
        <KV k="Expected on">{p.expected_on}</KV>
        <KV k="Tax">{p.tax}</KV>
        <KV k="Terms">{p.terms || '-'}</KV>
        {p.raised_at && <KV k="Raised by">{p.raised_by} on {at(p.raised_at)}</KV>}
        {p.approved_by && <KV k="Approved by">{p.approved_by}</KV>}
        {p.sent_at && <KV k="Sent">{at(p.sent_at)}</KV>}
        {p.indent_no && <KV k="From indent">{p.indent_no}</KV>}
      </dl>
      <div className="a-scroll">
        <table className="a-table a-p16-dt">
          <thead><tr><th>Item</th><th className="a-num">Ordered</th><th className="a-num">In</th><th className="a-num">Open</th><th className="a-num">Rate</th><th className="a-num">Amount</th></tr></thead>
          <tbody>{p.lines.map((l) => (
            <tr key={l.sku_code}><td><ItemCell name={l.name} code={l.sku_code} /></td>
              <td className="a-num">{l.qty_text}{l.credited ? <small className="a-muted a-p15-sub">{l.credited_text} credited</small> : null}</td>
              <td className="a-num">{l.received_text}</td><td className="a-num"><b>{l.open_text}</b></td>
              <td className="a-num">{bm(l.rate)}{l.disc ? <small className="a-muted a-p15-sub">less {l.disc}%</small> : null}</td><td className="a-num">{bm(l.amount)}</td></tr>))}</tbody>
        </table>
      </div>
      <TotalsBox t={p.totals} seeBuy={Boolean(p.totals)} />
      {p.goods_in.length > 0 && <><h3 className="a-p14-fsec">Goods in</h3><ul className="a-p15-hist">{p.goods_in.map((g) => <li key={g.grn_id}><a href={`/admin/goods-in?open=${g.grn_id}`}>{g.grn_no}</a> · {g.received_on} · {g.status_label}</li>)}</ul></>}
      {p.claims.length > 0 && <><h3 className="a-p14-fsec">Claims</h3><ul className="a-p15-hist">{p.claims.map((c) => <li key={c.claim_id}><a href={`/admin/claims?open=${c.claim_id}`}>{c.debit_no || c.claim_no}</a> · {c.status_label}</li>)}</ul></>}
      {p.rejected.length > 0 && <><h3 className="a-p14-fsec">Rejected amendments</h3><ul className="a-p15-hist">{p.rejected.map((r) => <li key={`${r.rev}-${r.at}`}>Rev {r.rev} · rejected {at(r.at)} by {r.by} · {r.lines.map((l) => `${l.sku} ${l.qty} at ${l.rate === null ? 'hidden' : money(l.rate)}`).join(', ')}</li>)}</ul></>}
      {p.revisions.length > 0 && <><h3 className="a-p14-fsec">Earlier revisions</h3><ul className="a-p15-hist">{p.revisions.map((r) => <li key={r.rev}>Rev {r.rev} · until {at(r.until)} · {r.lines.map((l) => `${l.sku} ${l.qty} @ ${l.rate === null ? 'hidden' : money(l.rate)}`).join(', ')}{r.freight ? ` · freight ${money(r.freight)}` : ''} · expected {r.expected_on}</li>)}</ul></>}
      {['open', 'part', 'waiting'].includes(st) && p.status !== 'draft' && p.can.cancel && (
        <div className="a-p16-endbox">
          <b>{st === 'part' ? 'Close short' : 'Cancel this order'}</b>
          <p className="a-hint-s">{st === 'part' ? 'The rest will not come. Open quantities stop counting as "on order".' : 'Only while nothing has come in. The number stays used, marked cancelled.'}</p>
          <In label="Reason *" value={why} maxLength={120} error={whyErr} onChange={(e) => setWhy(e.target.value)} />
          <button type="button" className="a-btn a-btn-danger a-btn-sm" disabled={act.busy} onClick={() => end(st === 'part' ? 'close' : 'cancel')}>{st === 'part' ? 'Close short' : 'Cancel order'}</button>
        </div>
      )}
    </Drawer>
  );
}

/** the printable order (v23 poPrintView): Print, PDF, Mail to supplier (through the outbox) */
function PoPrint({ id, onBack }) {
  const data = useLoad(`/buying/pos/${id}/print`);
  const act = useAction();
  const toast = useToast();
  const d = data.data;
  const doPrint = () => { document.body.classList.add('a-printing-card'); window.print(); setTimeout(() => document.body.classList.remove('a-printing-card'), 500); };
  const mail = () => act.run(async () => { const out = await api.send('POST', `/buying/pos/${id}/mail`); toast('good', 'Mail queued', out.message); });
  return (
    <section>
      <div className="a-p15-bar a-card">
        <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={onBack}><LIcon name="chevron-left" size="sm" />Back to purchase orders</button>
        <span className="a-p15-sp" />
        <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => api.open(`/buying/pos/${id}/pdf`)}><LIcon name="file-text" size="sm" />PDF</button>
        <button type="button" className="a-btn a-btn-ghost a-btn-sm" disabled={act.busy} onClick={mail}><LIcon name="mail" size="sm" />Mail to supplier</button>
        <button type="button" className="a-btn a-btn-sm" onClick={doPrint}><LIcon name="printer" size="sm" />Print</button>
      </div>
      {act.note}
      <Loading state={data}>
        {d && (
          <div className="a-card a-printonly-area a-p16-print">
            <div className="a-p16-ph"><b>Purchase order {d.po_no}{d.rev > 1 ? ` (Rev ${d.rev})` : ''}</b><span>Date {d.po_date} · Deliver by {d.expected_on} to {d.godown.name}{d.godown.address ? `, ${d.godown.address}` : ''}</span></div>
            <dl className="a-kv"><dt>To</dt><dd>{d.supplier.name}, {d.supplier.address}</dd><dt>GSTIN</dt><dd>{d.supplier.gstin || 'Not registered'}</dd><dt>Contact</dt><dd>{d.contact.name || '-'} · {d.contact.phone || ''}</dd></dl>
            <table className="a-table a-p16-dt">
              <thead><tr><th>#</th><th>Item</th><th>Your code</th><th className="a-num">Quantity</th><th className="a-num">Rate</th><th className="a-num">Disc.</th><th className="a-num">GST</th><th className="a-num">Amount</th></tr></thead>
              <tbody>{d.lines.map((l, i) => <tr key={l.sku}><td>{i + 1}</td><td><b>{l.name}</b><small className="a-muted a-p15-sub">{l.sku}{l.hsn ? ` · HSN ${l.hsn}` : ''}</small></td><td>{l.their}</td><td className="a-num">{l.qty_text}</td>
                <td className="a-num">{money(l.rate)}</td><td className="a-num">{l.disc ? `${l.disc}%` : '-'}</td><td className="a-num">{l.gst === null ? '-' : `${l.gst}%`}</td><td className="a-num">{money(l.amount)}</td></tr>)}</tbody>
            </table>
            <TotalsBox t={d.totals} />
            <p className="a-hint-s">{d.terms ? `${d.terms} ` : ''}Payment: {d.supplier.terms_days} days from your bill. Quote this PO number on your challan and bill.</p>
            <p className="a-hint-s">Authorised signatory</p>
          </div>
        )}
      </Loading>
    </section>
  );
}
