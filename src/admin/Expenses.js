// Money > Expenses and Money > Accounting export (phase 23, v23 viewExpenses / viewPetty / viewExport / viewExpHist and
// DRAWERS.exp; API /money/expenses*, /money/petty*, /money/accounting*; rules in expenses.js and tally.js).
// Expenses: tabs Recorded / Waiting for approval / Drafts / Rejected and cancelled; the month's spend, GST to claim and
// biggest head; repeating expenses due ("Make the drafts"); New expense (head, payee from the list or a new one, GST,
// the payee's GSTIN, how paid, reference, bill photo; freight in names its purchase order). Petty cash: a box per godown
// (float, balance, top-up, count). Export to accountant: a finished month's vouchers, the checks, Export (Tally XML and
// CSV, the month is locked), the CA's ledger names. Export history: every export with its files and totals, and the
// changes allowed after an export.
import { useEffect, useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Stat, Table, Tabs, money, useAction, useConfirm, useLoad, useToast } from './ui';
import { In, fe, fieldsOf } from './buyShared';

const TONE = { done: 'good', waiting: 'warn', draft: 'gray', rejected: 'bad', cancelled: 'gray' };
const enc = encodeURIComponent;
const monthName = (m) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;

// ---------------------------------------------------------------------------------------------------------------- Expenses
export function Expenses() {
  const [tab, setTab] = useState('recorded');
  const data = useLoad(`/money/expenses?tab=${tab}`);
  const [open, setOpen] = useState(null); // expense_no, or 'new'
  const act = useAction();
  const toast = useToast();
  const d = data.data;
  const drafts = () => act.run(async () => { const r = await api.send('POST', '/money/expenses-drafts'); toast(r.made.length ? 'good' : 'info', 'Repeating expenses', r.message); setTab('drafts'); data.reload(); });
  const cols = [
    { key: 'expense_no', label: 'Expense', sort: true, render: (e) => <><b className="a-mono">{e.expense_no}</b><small className="a-muted a-p15-sub">{e.date} · {e.godown}{e.locked ? ' · exported' : ''}</small></> },
    { key: 'head', label: 'Head and payee', sort: true, render: (e) => <><b>{e.head}</b><small className="a-muted a-p15-sub">{e.payee_name}</small></> },
    { key: 'total', label: 'Amount', num: true, sort: true, render: (e) => <b>{money(e.total)}</b> },
    { key: 'gst', label: 'GST', num: true, hideSm: true, render: (e) => (e.gst_amount ? <>{money(e.gst_amount)}<small className="a-muted a-p15-sub">{e.itc ? 'claim' : 'no claim'}</small></> : '-') },
    { key: 'mode', label: 'Paid', hideSm: true, render: (e) => d.modes[e.mode] },
    { key: 'status', label: 'Status', render: (e) => <Pill tone={TONE[e.status]}>{d.statusLabels[e.status]}</Pill> },
  ];
  return (
    <section>
      <PageHead sub="Rent, fuel, salaries, power" rules={['GST is input credit only with the supplier GSTIN', d && d.rule !== null ? `Above ${money(d.rule, { decimals: 0 })} needs a second person` : 'Above the limit needs a second person', 'A month with the CA is locked']}
        actions={d && d.can.create && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New expense</button>} />
      {act.note}
      <Loading state={data}>{d && <>
        {d.repeats_due.length > 0 && d.can.create && (
          <Alert tone="info" title={`${d.repeats_due.length} repeating expense${d.repeats_due.length === 1 ? ' is' : 's are'} due.`}>
            {d.repeats_due.map((r) => `${r.head} ${money(r.amount)} on ${r.next_date}`).join(', ')}{' '}
            <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={drafts}>Make the drafts</button>
          </Alert>
        )}
        <div className="a-stats">
          <Stat label="Spent this month" value={money(d.stats.spent)} sub={`${d.stats.count} expense${d.stats.count === 1 ? '' : 's'}`} icon="receipt" tone="info" card />
          <Stat label="GST to claim" value={money(d.stats.gst_claim)} sub="With a GSTIN, on heads that allow it" icon="percent" tone="good" card />
          <Stat label="Biggest head" value={d.stats.biggest ? d.stats.biggest.head : '-'} sub={d.stats.biggest ? money(d.stats.biggest.total) : ''} icon="chart-pie" tone="gold" card />
        </div>
        <Tabs label="Expenses" value={tab} onChange={setTab} tabs={[['recorded', 'Recorded'], ['waiting', 'Waiting for approval'], ['drafts', 'Drafts'], ['closed', 'Rejected and cancelled']].map(([key, label]) => ({ key, label, count: d.counts[key] }))} />
        <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(e) => e.expense_no} label="Expenses" onRowClick={(e) => setOpen(e.expense_no)} empty={{ icon: 'receipt', title: 'Nothing here', text: 'No expense in this list.' }} /></div>
      </>}</Loading>
      {open === 'new' && <ExpenseForm heads={d ? d.heads : []} onClose={() => setOpen(null)} onDone={(r) => { setOpen(null); setTab(r.status === 'done' ? 'recorded' : 'waiting'); data.reload(); }} />}
      {open && open !== 'new' && <ExpenseDrawer no={open} heads={d ? d.heads : []} onClose={() => { setOpen(null); data.reload(); }} />}
    </section>
  );
}

function ExpenseForm({ heads, start = null, no = null, onClose, onDone }) {
  const form = useLoad('/money/expense-form');
  const act = useAction();
  const toast = useToast();
  const [f, setF] = useState(start || { date: '', godown_id: '', head_key: '', po_no: '', payee: '', new_payee: false, pan: '', gstin: '', amount: '', gst_rate: '0', mode: 'bank', reference: '', note: '' });
  const [photo, setPhoto] = useState(null);
  const [err, setErr] = useState({});
  const d = form.data;
  useEffect(() => { if (d && !f.date) setF((x) => ({ ...x, date: d.today, godown_id: x.godown_id || String((d.godowns[0] || {}).godown_id || '') })); }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const head = heads.find((h) => h.head_key === f.head_key);
  const amt = Number(f.amount) || 0; const gst = Math.round(amt * Number(f.gst_rate)) / 100; const total = Math.round((amt + gst) * 100) / 100;
  const g = d && d.godowns.find((x) => String(x.godown_id) === String(f.godown_id));
  const known = d && d.payees.some((p) => p.name.toLowerCase() === f.payee.trim().toLowerCase());
  const save = () => act.run(async () => {
    setErr({});
    const body = { ...f, new_payee: f.new_payee ? '1' : '' };
    try {
      const path = no ? `/money/expenses/${enc(no)}/save` : '/money/expenses';
      const r = photo ? await api.upload(path, photo, body) : await api.send('POST', path, body);
      toast(r.status === 'done' ? 'good' : 'warn', r.status === 'done' ? 'Recorded' : 'Waiting for approval', r.message); onDone(r);
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title={no ? `Expense ${no}` : 'New expense'} onClose={onClose} dirty wide footer={<button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Save expense</button>}>
      {act.note}
      <Loading state={form}>{d && <>
        <div className="a-grid2">
          <In label="Date" type="date" max={d.today} value={f.date} error={fe(err, 'date')} onChange={(e) => set({ date: e.target.value })} />
          <In label="Godown" error={fe(err, 'godown_id')}><select value={f.godown_id} onChange={(e) => set({ godown_id: e.target.value })}>{d.godowns.map((x) => <option key={x.godown_id} value={x.godown_id}>{x.name}</option>)}</select></In>
          <In label="Head" error={fe(err, 'head_key')}><select value={f.head_key} aria-label="Head" onChange={(e) => set({ head_key: e.target.value })}><option value="">Choose...</option>{heads.map((h) => <option key={h.head_key} value={h.head_key}>{h.name}{h.itc ? '' : ' (GST not claimable)'}</option>)}</select></In>
          {head && head.for_po && <In label="For purchase order" error={fe(err, 'po_no')}><select value={f.po_no} aria-label="Purchase order" onChange={(e) => set({ po_no: e.target.value })}><option value="">Choose...</option>{d.pos.map((p) => <option key={p.po_no} value={p.po_no}>{p.po_no} · {p.supplier}</option>)}</select></In>}
          <In label="Paid to" error={fe(err, 'payee')} hint={f.payee && !known ? 'Not on the list: tick "New payee" (a second person approves it once).' : null}>
            <input list="exp-payees" value={f.payee} aria-label="Paid to" maxLength={120} onChange={(e) => set({ payee: e.target.value })} />
          </In>
          {f.payee && !known && <label className="a-inline"><input type="checkbox" checked={f.new_payee} onChange={(e) => set({ new_payee: e.target.checked })} /> New payee</label>}
          <In label="Amount without GST (Rs)" inputMode="decimal" value={f.amount} error={fe(err, 'amount')} aria-label="Amount" onChange={(e) => set({ amount: e.target.value })} />
          <In label="GST %" error={fe(err, 'gst_rate')}><select value={f.gst_rate} aria-label="GST" onChange={(e) => set({ gst_rate: e.target.value })}>{[0, 5, 12, 18, 28].map((x) => <option key={x} value={x}>{x}</option>)}</select></In>
          <In label="Their GSTIN" maxLength={15} value={f.gstin} error={fe(err, 'gstin')} hint="Needed to claim the GST." onChange={(e) => set({ gstin: e.target.value.toUpperCase() })} />
          {f.new_payee && <In label="Their PAN (if no GSTIN)" maxLength={10} value={f.pan} error={fe(err, 'pan')} onChange={(e) => set({ pan: e.target.value.toUpperCase() })} />}
          <In label="How paid" error={fe(err, 'mode')}><select value={f.mode} aria-label="How paid" onChange={(e) => set({ mode: e.target.value })}>{[['bank', 'Bank transfer'], ['upi', 'UPI'], ['cash', 'Cash'], ['cheque', 'Cheque'], ['petty', 'From petty cash']].map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></In>
          <In label="Reference (UTR, UPI, cheque)" maxLength={40} value={f.reference} error={fe(err, 'reference')} onChange={(e) => set({ reference: e.target.value })} />
          <In label="Photo of the bill" hint={photo ? photo.name : 'Optional'}><input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Bill photo" onChange={(e) => setPhoto(e.target.files[0] || null)} /></In>
        </div>
        <In label="Note" wide maxLength={120} value={f.note} onChange={(e) => set({ note: e.target.value })} />
        <datalist id="exp-payees">{d.payees.map((p) => <option key={p.name} value={p.name} />)}</datalist>
        <p className="a-hint-s">Total <b>{money(total)}</b>{gst ? ` (GST ${money(gst)}, ${f.gstin && head && head.itc ? 'can be claimed' : `not claimed: ${!f.gstin ? 'no GSTIN' : 'this head is blocked'}`})` : ''}
          {f.mode === 'petty' && g ? ` · Petty cash at ${g.name}: ${money(g.petty)} free now, ${money(g.petty - total)} after` : ''}
          {d.rule !== null && total > d.rule ? ` · Above ${money(d.rule, { decimals: 0 })}: a second person signs it` : ''}</p>
      </>}</Loading>
    </Drawer>
  );
}

function ExpenseDrawer({ no, heads, onClose }) {
  const r = useLoad(`/money/expenses/${enc(no)}`);
  const act = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const [why, setWhy] = useState('');
  const e = r.data;
  if (e && ['draft', 'rejected'].includes(e.status) && e.can.create) {
    return <ExpenseForm heads={heads} no={no} start={{ date: e.date, godown_id: String(e.godown_id), head_key: e.head_key, po_no: e.po_no || '', payee: e.payee_name, new_payee: false, pan: e.pan || '', gstin: e.gstin || '', amount: String(e.amount), gst_rate: String(e.gst_rate), mode: e.mode, reference: e.reference || '', note: e.note || '' }}
      onClose={onClose} onDone={onClose} />;
  }
  const cancel = async () => {
    if (!(await confirm({ title: `Cancel ${no}?`, message: `Reason: ${why}. A petty cash spend goes back into the box.`, action: 'Cancel expense', danger: true }))) return;
    act.run(async () => { const x = await api.send('POST', `/money/expenses/${enc(no)}/cancel`, { reason: why }); toast('good', 'Cancelled', x.message); r.reload(); });
  };
  const photo = () => act.run(async () => { if (!(await api.open(`/money/expenses/${enc(no)}/photo`))) throw new Error('Allow pop-ups to see the photo.'); });
  return (
    <Drawer title={`Expense ${no}`} onClose={onClose}>
      <Loading state={r}>{e && <>
        {act.note}
        <p><Pill tone={TONE[e.status]}>{e.status_label}</Pill></p>
        {e.locked && <Alert tone="info" title={`${e.date.slice(0, 7)} is exported to the CA.`}>A change needs &quot;Change after export to the CA&quot; approval first.</Alert>}
        {e.status === 'waiting' && <Alert tone="warn" title="Waiting for approval.">{e.approvals.filter((a) => a.status === 'pending').map((a) => `#${a.approval_id} ${a.summary}`).join('; ')}</Alert>}
        {e.rej_note && <Alert tone="bad" title="Sent back.">{e.rej_note}</Alert>}
        <dl className="a-dl">
          <div><dt>Date and godown</dt><dd>{e.date} · {e.godown}</dd></div>
          <div><dt>Head</dt><dd>{e.head} (CA ledger: {e.ledger}){e.po_no ? ` · for ${e.po_no}` : ''}</dd></div>
          <div><dt>Paid to</dt><dd>{e.payee_name}{e.gstin ? ` · GSTIN ${e.gstin}` : ''}{e.pan ? ` · PAN ${e.pan}` : ''}</dd></div>
          <div><dt>Amount</dt><dd>{money(e.amount)}{e.gst_rate ? ` + GST ${e.gst_rate}% ${money(e.gst_amount)}` : ''} = <b>{money(e.total)}</b>{e.gst_rate ? (e.itc ? ' · GST can be claimed' : ' · GST not claimed') : ''}</dd></div>
          <div><dt>How</dt><dd>{e.mode_label}{e.reference ? ` · ${e.reference}` : ''}</dd></div>
          {e.note && <div><dt>Note</dt><dd>{e.note}</dd></div>}
          {e.repeat && <div><dt>Made from</dt><dd>Repeating expense {e.repeat}</dd></div>}
          {e.cancel_reason && <div><dt>Cancelled</dt><dd>{e.cancel_reason}</dd></div>}
        </dl>
        {e.has_photo && <p><button type="button" className="a-link" onClick={photo}>Photo of the bill</button></p>}
        {e.status === 'done' && e.can.cancel && (
          <div className="a-card">
            <h3>Cancel this expense</h3>
            <In label="Reason" value={why} maxLength={100} onChange={(x) => setWhy(x.target.value)} />
            <button type="button" className="a-btn a-btn-danger" disabled={act.busy || why.trim().length < 4} onClick={cancel}>Cancel expense</button>
          </div>
        )}
      </>}</Loading>
    </Drawer>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Petty cash
export function PettyCash() {
  const data = useLoad('/money/petty');
  const act = useAction();
  const toast = useToast();
  const [v, setV] = useState({});
  const d = data.data;
  const val = (g, k) => (v[`${g}|${k}`] ?? '');
  const set = (g, k, x) => setV((s) => ({ ...s, [`${g}|${k}`]: x }));
  const post = (g, what, body) => act.run(async () => { const r = await api.send('POST', `/money/petty/${g}/${what}`, body); toast(r.alert ? 'warn' : r.waiting ? 'warn' : 'good', 'Petty cash', r.message || 'Saved'); setV({}); data.reload(); });
  return (
    <section>
      <PageHead sub="Small cash spent at office or godown" rules={['A box per godown', 'Top-ups need a second person', 'A count difference above Rs 100 shows in Alerts']} />
      {act.note}
      <Loading state={data}>{d && d.boxes.map((b) => (
        <div key={b.godown_id} className="a-card a-card-flush a-p23-box">
          <div className="a-card-h">
            <div><h2>{b.name}</h2><p>{b.float === null ? 'No box yet' : `Float ${money(b.float)}`}{b.moves.find((m) => m.kind === 'count') ? ` · last counted ${b.moves.find((m) => m.kind === 'count').date}` : ''}</p></div>
            <span className="a-sp" />
            {b.float !== null && <Pill tone={b.low ? 'bad' : 'good'}>{money(b.balance)} in the box</Pill>}
          </div>
          <div className="a-card-b">
          {b.low && <Alert tone="warn" title="Running low.">Less than a quarter of the float. Ask for a top-up.</Alert>}
          {b.float !== null && b.free < b.balance - 0.004 && <p className="a-hint-s">{money(b.balance - b.free)} kept aside for petty cash expenses waiting for approval.</p>}
          <div className="a-grid4">
            {d.can.edit && <><In label={b.float === null ? 'Float to start the box (Rs)' : 'Float (Rs)'} inputMode="numeric" value={val(b.godown_id, 'float')} placeholder={b.float === null ? '' : String(b.float)} onChange={(e) => set(b.godown_id, 'float', e.target.value)} />
              <div className="a-field"><span>&nbsp;</span><button type="button" className="a-btn a-btn-ghost" disabled={act.busy || !val(b.godown_id, 'float')} onClick={() => post(b.godown_id, 'float', { float: val(b.godown_id, 'float') })}>Save the float</button></div></>}
            {d.can.create && b.float !== null && <>
              <In label="Top-up (Rs)" inputMode="numeric" value={val(b.godown_id, 'top')} placeholder={String(Math.max(0, Math.round(b.float - b.balance)))} onChange={(e) => set(b.godown_id, 'top', e.target.value)} />
              <div className="a-field"><span>&nbsp;</span><button type="button" className="a-btn" disabled={act.busy} onClick={() => post(b.godown_id, 'topup', { amount: val(b.godown_id, 'top') || Math.max(0, Math.round(b.float - b.balance)) })}>Ask for the top-up</button></div>
              <In label="Counted in the box (Rs)" inputMode="numeric" value={val(b.godown_id, 'count')} onChange={(e) => set(b.godown_id, 'count', e.target.value)} />
              <div className="a-field"><span>&nbsp;</span><button type="button" className="a-btn" disabled={act.busy || val(b.godown_id, 'count') === ''} onClick={() => post(b.godown_id, 'count', { counted: val(b.godown_id, 'count') })}>Save the count</button></div>
            </>}
          </div>
          {b.moves.length > 0 && (
            <Table label={`Petty cash at ${b.name}`} rows={b.moves} rowKey={(m) => m.move_id} columns={[
              { key: 'date', label: 'Date' },
              { key: 'kind', label: 'What', render: (m) => <><b>{{ open: 'Opening float', spend: 'Spent', topup: 'Top-up', count: 'Count' }[m.kind]}</b><small className="a-muted a-p15-sub">{m.kind === 'count' ? `Book ${money(m.book)}, counted ${money(m.counted)}${m.amount ? `, difference ${money(m.amount)}` : ', matches'}` : m.ref}</small></> },
              { key: 'amount', label: 'Amount', num: true, render: (m) => money(m.kind === 'topup' && m.status === 'waiting' ? m.ask_amount : m.amount) },
              { key: 'status', label: 'Status', render: (m) => (m.status === 'waiting' ? <Pill tone="warn">Waiting</Pill> : m.status === 'rejected' ? <Pill tone="bad">Rejected</Pill> : m.kind === 'count' && Math.abs(m.amount) > 100 ? <Pill tone="bad">Check</Pill> : <Pill tone="good">Done</Pill>) },
            ]} />
          )}
          </div>
        </div>
      ))}</Loading>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Export to accountant
export function ExportToAccountant() {
  const [month, setMonth] = useState('');
  const data = useLoad(`/money/accounting${month ? `?month=${month}` : ''}`);
  const act = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const [names, setNames] = useState(null);
  const d = data.data;
  useEffect(() => { if (d) setNames({ ledgers: Object.fromEntries(d.ledgers.map((l) => [l.ledger_key, l.name])), heads: Object.fromEntries(d.heads.map((h) => [h.head_key, h.ledger])) }); }, [d]);
  const go = async () => {
    if (!(await confirm({ title: `${d.done ? 'Export again' : 'Export'} ${monthName(d.month)}?`, message: `${d.vouchers.length} vouchers to Tally XML and CSV. ${monthName(d.month)} is locked for everybody: changing a record dated in it needs approval first.`, action: 'Export' }))) return;
    act.run(async () => {
      const r = await api.send('POST', `/money/accounting/${d.month}/export`);
      await api.download(`/money/accounting/${d.month}/xml`, r.xml_name);
      await api.download(`/money/accounting/${d.month}/csv`, r.csv_name);
      toast('good', 'Exported', r.message); data.reload();
    });
  };
  const saveNames = () => act.run(async () => { const r = await api.send('PUT', '/money/accounting/ledgers', names); toast('good', 'Saved', r.message); data.reload(); });
  return (
    <section>
      <PageHead sub="Clean data for the CA's Tally" rules={['Tally XML vouchers, and a CSV to check', 'Ledger names from the mapping below', 'An exported month is locked']} />
      {act.note}
      <Loading state={data}>{d && <>
        <div className="a-card a-card-flush"><div className="a-card-b">
          <div className="a-grid4 a-p23-filters">
            <In label="Month"><select value={d.month} aria-label="Month" onChange={(e) => setMonth(e.target.value)}>{d.months.map((m) => <option key={m.month} value={m.month}>{monthName(m.month)}{m.exported ? ' (exported)' : ''}</option>)}</select></In>
            <div className="a-field"><span>&nbsp;</span><span className="a-row">{d.can.export ? <button type="button" className="a-btn" disabled={act.busy || !d.ok} onClick={go}><LIcon name="download" size="sm" />{d.done ? 'Export again' : `Export ${monthName(d.month)}`}</button>
              : <span className="a-hint-s">Export needs the Export right on Expenses.</span>}</span></div>
          </div>
          {d.done && <Alert tone="info" title={`${monthName(d.month)} was exported on ${d.done.at} by ${d.done.exported_by}.`}>It is locked. Exporting again sends only what is new, changed or cancelled since, each voucher with its own id, so Tally never gets one twice.</Alert>}
          {d.ok ? <Alert tone="good" title="Ready.">{d.vouchers.length} vouchers, all balanced (debits equal credits), nothing waiting.</Alert>
            : d.issues.map((x) => <Alert key={x} tone="bad" title="Fix first.">{x}</Alert>)}
          <p className="a-hint-s">{Object.keys(d.counts).length ? Object.entries(d.counts).map(([k, v]) => `${v} ${k}`).join(' · ') : 'No vouchers in this month.'}</p>
        </div></div>
        <div className="a-listcard a-p23-full a-p23-fit"><div className="a-card-h"><h2>Vouchers in {monthName(d.month)}</h2></div><Table label="Vouchers" rows={d.vouchers} rowKey={(v) => `${v.type}|${v.no}`} empty={{ icon: 'file-text', title: 'Nothing in this month', text: 'Invoices, receipts, bills and expenses of the month show here.' }} columns={[
          { key: 'type', label: 'Type' }, { key: 'no', label: 'Number', render: (v) => <span className="a-mono">{v.no}</span> }, { key: 'date', label: 'Date' },
          { key: 'party', label: 'Party', render: (v) => <>{v.party || '-'}<small className="a-muted a-p15-sub">{v.ledgers.join(', ')}</small></> },
          { key: 'debit', label: 'Debit', num: true, render: (v) => money(v.debit) }, { key: 'credit', label: 'Credit', num: true, render: (v) => money(v.credit) },
        ]} /></div>
        {names && (
          <div className="a-card a-card-flush">
            <div className="a-card-h"><div><h2>Ledger names in Tally</h2><p>Set once with the CA; every export uses them</p></div><span className="a-sp" />
              {d.can.export && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={saveNames}>Save names</button>}</div>
            <div className="a-card-b"><div className="a-grid3">
              {d.ledgers.map((l) => <In key={l.ledger_key} label={l.label} maxLength={60} value={names.ledgers[l.ledger_key]} disabled={!d.can.export} onChange={(e) => setNames({ ...names, ledgers: { ...names.ledgers, [l.ledger_key]: e.target.value } })} />)}
              {d.heads.map((h) => <In key={h.head_key} label={`Expense: ${h.name}`} maxLength={60} value={names.heads[h.head_key]} disabled={!d.can.export} onChange={(e) => setNames({ ...names, heads: { ...names.heads, [h.head_key]: e.target.value } })} />)}
            </div></div>
          </div>
        )}
      </>}</Loading>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------------------------- Export history
export function ExportHistory() {
  const data = useLoad('/money/accounting-history');
  const act = useAction();
  const d = data.data;
  const get = (m, kind, name) => act.run(async () => { await api.download(`/money/accounting/${m}/${kind}`, name); });
  return (
    <section>
      <PageHead sub="What was sent, when, any errors" rules={['Every export, with its totals', 'A change after export needs approval', 'The CA is told about each change']} />
      {act.note}
      <Loading state={data}>{d && <>
        <div className="a-listcard"><Table label="Exports" rows={d.months} rowKey={(x) => x.month} empty={{ icon: 'file-text', title: 'No exports yet', text: 'Export a month from Export to accountant.' }} columns={[
          { key: 'month', label: 'Month', render: (x) => <><b>{monthName(x.month)}</b>{x.times > 1 && <small className="a-muted a-p15-sub">exported {x.times} times</small>}</> },
          { key: 'at', label: 'When and who', render: (x) => <>{x.at}<small className="a-muted a-p15-sub">{x.exported_by}</small></> },
          { key: 'files', label: 'Files', render: (x) => (x.has_files && d.can.export ? <span className="a-row"><button type="button" className="a-link" onClick={() => get(x.month, 'xml', x.xml_name)}>{x.xml_name}</button><button type="button" className="a-link" onClick={() => get(x.month, 'csv', x.file_name)}>{x.file_name}</button></span> : <small>{x.file_name}</small>) },
          { key: 'vouchers', label: 'Vouchers', num: true, render: (x) => (x.vouchers ?? x.lines) },
          { key: 'exp', label: 'Expenses', num: true, hideSm: true, render: (x) => (x.totals ? money(x.totals.expenses) : '-') },
          { key: 'sales', label: 'Sales', num: true, hideSm: true, render: (x) => (x.totals ? money(x.totals.sales) : '-') },
        ]} /></div>
        <div className="a-card a-card-flush"><div className="a-card-h"><h2>Changes after export</h2></div><div className="a-card-b">{d.changes.length ? d.changes.map((c) => <p key={c.approval_id}><b>{c.summary}</b><br /><span className="a-hint-s">{c.at} · {c.requested_by} · {c.status}{c.decided_by ? ` by ${c.decided_by}` : ''}</span></p>) : <p className="a-hint-s">None.</p>}</div></div>
      </>}</Loading>
    </section>
  );
}
