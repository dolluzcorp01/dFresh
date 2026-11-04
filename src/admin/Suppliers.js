// Masters > Partners > Suppliers (phase 16, v23 viewSuppliers / DRAWERS.supplier; API /buying/suppliers in
// buying-routes.js). Tabs Active / On hold or blocked; search by name, code, GSTIN or town. A supplier: what they supply,
// payment terms, status (on hold or blocked needs a reason), up to 3 contacts, GSTIN checked against the address state
// (the PAN fills itself), MSME (Udyam, type), address, the items they sell with prices, and the bank account. A new or
// changed account waits for a second Admin and payments go only to the approved one. What we owe; a supplier credit
// shows as "credit". Values are hidden without See cost or Buying Edit.
import { useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, Tabs, useAction, useAdmin, useCan, useLoad, useToast } from './ui';
import { In, ViewOnlyB, at, bm, fe, fieldsOf, useOpenParam } from './buyShared';
import { panOf } from '../shared/buyRules';

const ST_TONE = { active: 'good', hold: 'warn', blocked: 'bad' };

export default function Suppliers() {
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const data = useLoad(`/buying/suppliers?tab=${tab}&q=${encodeURIComponent(q)}`);
  const opts = useLoad('/buying/options');
  const { me } = useAdmin();
  const canEdit = useCan('buying', 'edit');
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(Number(id)));
  const columns = [
    { key: 'name', label: 'Supplier', render: (s) => <><b>{s.name}</b><small className="a-muted a-p15-sub">{s.code}</small></> },
    { key: 'kinds', label: 'Supplies', render: (s) => <span className="a-p15-pills a-p16-nomb">{s.kinds.map((k) => <Pill key={k}>{k}</Pill>)}</span> },
    { key: 'gstin', label: 'GST', hideSm: true, render: (s) => (s.gstin ? <><span className="a-mono">{s.gstin}</span><small className="a-muted a-p15-sub">{s.state}{s.msme ? ` · MSME ${s.msme}` : ''}</small></> : <Pill tone="warn">Not registered</Pill>) },
    { key: 'terms', label: 'Terms', num: true, hideSm: true, render: (s) => `${s.terms} days` },
    { key: 'open_pos', label: 'Open POs', num: true, render: (s) => s.open_pos || <span className="a-muted">0</span> },
    { key: 'owe', label: 'We owe', num: true, render: (s) => (s.owe === null ? <span className="a-muted">hidden</span> : s.owe ? s.owe_text : <span className="a-muted">-</span>) },
    { key: 'rating', label: 'Record', hideSm: true, render: (s) => (s.rating.n ? `${s.rating.ontime}% on time${s.rating.rej_pct !== null ? ` · ${s.rating.rej_pct}% rejected` : ''}` : <span className="a-muted">No goods in yet</span>) },
    { key: 'status', label: 'State', render: (s) => <><Pill tone={ST_TONE[s.status]}>{s.status_label}</Pill>{s.bank_waiting && <> <Pill tone="warn">Bank change waiting</Pill></>}</> },
  ];
  return (
    <section>
      <PageHead sub="Who we buy from" rules={['GSTIN checked, state from its first 2 digits', 'MSME suppliers paid within 45 days', 'Bank change needs a second Admin']}
        actions={<>{d && d.can.export && <button type="button" className="a-btn a-btn-ghost" onClick={() => api.download('/buying/suppliers-export', 'dfresh-suppliers.csv').then(() => toast('good', 'Exported', 'Bank accounts are not in the file.'), (e) => toast('bad', 'Not exported', e.message))}><LIcon name="download" size="sm" />Export CSV</button>}
          {canEdit && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New supplier</button>}</>} />
      {!canEdit && <ViewOnlyB me={me} what="suppliers" />}
      <Loading state={data}>
        {d && (
          <>
            <Tabs label="Suppliers" value={tab} onChange={setTab} tabs={[{ key: 'active', label: 'Active', count: d.counts.active }, { key: 'blocked', label: 'On hold or blocked', count: d.counts.blocked }]} />
            <div className="a-listcard">
              <div className="a-p16-search"><label className="a-field-i"><LIcon name="search" size="sm" /><input value={q} placeholder="Search name, code, GSTIN or town" aria-label="Search suppliers" onChange={(e) => setQ(e.target.value)} /></label></div>
              <Table columns={columns} rows={d.rows} rowKey={(s) => s.supplier_id} label="Suppliers" onRowClick={(s) => setOpen(s.supplier_id)}
                empty={{ icon: 'inbox', title: 'No supplier here', text: q ? 'Nothing matches the search.' : tab === 'active' ? 'Add the first supplier.' : 'Nobody is on hold or blocked.' }} />
            </div>
          </>
        )}
      </Loading>
      {open && opts.data && <SupplierDrawer id={open} opts={opts.data} onClose={() => setOpen(null)} onSaved={(id) => { setOpen(id || null); data.reload(); }} />}
    </section>
  );
}

const blankContact = () => ({ name: '', role: '', phone: '', email: '', whatsapp: '' });
const blankItem = () => ({ sku_code: '', their_code: '', price: '', lead_days: '', moq: '', spec_gsm: '', spec_ply: '', spec_width: '' });

function SupplierDrawer({ id, opts, onClose, onSaved }) {
  const isNew = id === 'new';
  const one = useLoad(isNew ? null : `/buying/suppliers/${id}`);
  const canEdit = useCan('buying', 'edit');
  if (!isNew && !one.data) return <Drawer title="Supplier" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  return <SupplierForm key={isNew ? 'new' : id} d={isNew ? null : one.data} opts={opts} canEdit={canEdit} onClose={onClose} onSaved={onSaved} reload={one.reload} />;
}

function SupplierForm({ d, opts, canEdit, onClose, onSaved, reload }) {
  const s = d ? d.supplier : null;
  const isNew = !s;
  const act = useAction();
  const toast = useToast();
  const [tab, setTab] = useState('basics');
  const start = {
    name: s ? s.name : '', kinds: s ? s.kinds : [], terms_days: s ? String(s.terms_days) : '30', opening_owed: s ? String(s.opening_owed ?? 0) : '0', status: s ? s.status : 'active', block_reason: s ? s.block_reason || '' : '', notes: s ? s.notes || '' : '',
    contacts: [0, 1, 2].map((i) => { const c = d && d.contacts.find((x) => x.pos === i); return c ? { name: c.name || '', role: c.role || '', phone: c.phone || '', email: c.email || '', whatsapp: c.whatsapp || '' } : blankContact(); }),
    no_gst: s ? !s.gstin : false, gstin: s ? s.gstin || '' : '', msme_type: s ? s.msme_type || '' : '', udyam: s ? s.udyam || '' : '', addr_l1: s ? s.addr_l1 || '' : '', addr_l2: s ? s.addr_l2 || '' : '',
    city: s ? s.city || '' : '', pin: s ? s.pin || '' : '', state_code: s ? s.state_code || '33' : '33', map_query: s ? s.map_query || '' : '', pickup: s ? s.pickup || '' : '',
    bank: { holder: '', name: '', branch: '', type: 'Current', acc: '', acc2: '', ifsc: '' },
    items: d ? d.items.map((x) => ({ sku_code: x.sku_code, their_code: x.their_code || '', price: x.price === null ? '' : String(x.price), lead_days: String(x.lead_days), moq: String(x.moq),
      spec_gsm: x.spec ? String(x.spec.gsm) : '', spec_ply: x.spec && x.spec.ply ? String(x.spec.ply) : '', spec_width: x.spec && x.spec.width ? String(x.spec.width) : '' })) : [],
  };
  const [f, setF] = useState(start);
  const [err, setErr] = useState({});
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setC = (i, k, v) => setF((x) => ({ ...x, contacts: x.contacts.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const setI = (i, k, v) => setF((x) => ({ ...x, items: x.items.map((c, j) => (j === i ? { ...c, [k]: v } : c)) }));
  const setB = (k, v) => setF((x) => ({ ...x, bank: { ...x.bank, [k]: v } }));
  const ro = !canEdit;
  const bankLocked = ro || Boolean(d && d.bank_waiting);
  const save = () => act.run(async () => {
    setErr({});
    try {
      const out = isNew ? await api.send('POST', '/buying/suppliers', f) : await api.send('PUT', `/buying/suppliers/${s.supplier_id}`, f);
      toast(out.nothing ? 'info' : 'good', isNew ? `${f.name} added as ${out.code}` : out.nothing ? 'Nothing changed' : 'Saved', out.message);
      if (isNew) onSaved(out.supplier_id); else { reload(); onSaved(s.supplier_id); }
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const tabOf = (k) => (/^contacts/.test(k) ? 'contacts' : /^bank/.test(k) ? 'bank' : /^items/.test(k) ? 'items' : ['gstin', 'state_code', 'msme_type', 'udyam', 'addr_l1', 'city', 'pin'].includes(k) ? 'tax' : 'basics');
  const bad = (t) => Object.keys(err).some((k) => tabOf(k) === t);
  const tabs = [{ key: 'basics', label: 'Basics' }, { key: 'contacts', label: 'Contacts' }, { key: 'tax', label: 'Tax and address' }, { key: 'bank', label: 'Bank' }, { key: 'items', label: 'Items and prices', count: f.items.length },
    ...(isNew ? [] : [{ key: 'record', label: 'Record' }])].map((t) => ({ ...t, bad: bad(t.key) }));
  const states = opts.states.map((x) => ({ value: x.code, label: x.name }));
  const status = s ? (
    <>
      <Pill tone={ST_TONE[s.status]}>{s.status_label}</Pill>
      {s.msme_type && <Pill tone="info">MSME {s.msme_type}</Pill>}
      {s.gstin ? <Pill>{s.state}</Pill> : <Pill tone="warn">Not registered for GST</Pill>}
      <span className="a-p15-sp" />
      {d.record.owe_text !== null && <span className="a-hint-s">{d.record.credit_with_them ? 'Credit with them' : 'We owe'} {d.record.owe_text}</span>}
    </>
  ) : null;
  return (
    <Drawer title={isNew ? 'New supplier' : s.name} pill={s ? <Pill>{s.code}</Pill> : null} status={status} onClose={onClose} dirty={canEdit && dirty}
      thumb={<LIcon name="building-2" />}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</button>
        {canEdit && <button type="button" className="a-btn" disabled={act.busy || (!isNew && !dirty)} onClick={save}><LIcon name="check" size="sm" />{isNew ? 'Add supplier' : 'Save'}</button>}</>}>
      {act.note}
      <Tabs label="Supplier" value={tab} onChange={setTab} tabs={tabs} />
      <div className="a-grid2" hidden={tab !== 'basics'}>
        <Field def={{ name: 'name', label: 'Supplier name', required: true, wide: true, locked: ro, error: err.name, help: 'As on their GST certificate or bill. Kept exactly as typed.' }} value={f.name} onChange={(v) => set('name')(String(v).slice(0, 80))} />
        <div className={`a-field a-wide${err.kinds ? ' a-err' : ''}`}>
          <span>What they supply <span className="a-req">*</span></span>
          <div className="a-p15-types">{opts.kinds.map(([k, label]) => (
            <label key={k} className="a-inline"><input type="checkbox" disabled={ro} checked={f.kinds.includes(k)} onChange={(e) => set('kinds')(e.target.checked ? [...f.kinds, k] : f.kinds.filter((x) => x !== k))} /> {label}</label>))}</div>
          {err.kinds && <small className="a-emsg" role="alert">{err.kinds}</small>}
        </div>
        <Field def={{ name: 'terms_days', label: 'Payment terms (days)', type: 'number', min: 0, max: 180, required: true, locked: ro, error: err.terms_days, help: 'Days after the bill date. For a micro or small (MSME) supplier the due date is never later than 45 days.' }} value={f.terms_days} onChange={set('terms_days')} />
        <Field def={{ name: 'opening_owed', label: 'Opening amount we owe (Rs)', type: 'number', min: 0, locked: ro || !isNew, error: err.opening_owed, help: isNew ? 'Only when the supplier is added: what we owed them before this system.' : 'Set when the supplier was added.' }} value={isNew ? f.opening_owed : (s.opening_owed === null ? 'hidden' : f.opening_owed)} onChange={set('opening_owed')} />
        <Field def={{ name: 'status', label: 'Status', type: 'select', allowEmpty: false, required: true, locked: ro, options: [{ value: 'active', label: 'Active' }, { value: 'hold', label: 'On hold: no new purchase orders for now' }, { value: 'blocked', label: 'Blocked: no new purchase orders' }] }} value={f.status} onChange={set('status')} />
        <Field def={{ name: 'block_reason', label: 'Why on hold or blocked', locked: ro || f.status === 'active', error: err.block_reason, help: 'Needed when on hold or blocked. Shown to anyone who tries to order from them.' }} value={f.block_reason} onChange={(v) => set('block_reason')(String(v).slice(0, 120))} />
        <Field def={{ name: 'notes', label: 'Notes', type: 'textarea', rows: 2, wide: true, locked: ro }} value={f.notes} onChange={(v) => set('notes')(String(v).slice(0, 300))} />
      </div>
      <div hidden={tab !== 'contacts'}>
        <p className="a-hint-s a-p16-mt0">The main contact gets purchase orders. Phone is 10 digits; +91 is added if missing.</p>
        {f.contacts.map((c, i) => (
          <div key={i} className="a-p16-crow">
            <b className="a-p16-cn">{i === 0 ? 'Main contact' : `Contact ${i + 1}`}</b>
            <In label={`Name${i === 0 ? ' *' : ''}`} value={c.name} maxLength={60} disabled={ro} error={fe(err, `contacts.${i}.name`)} onChange={(e) => setC(i, 'name', e.target.value)} />
            <In label="Role" value={c.role} maxLength={40} placeholder="e.g. Accounts" disabled={ro} onChange={(e) => setC(i, 'role', e.target.value)} />
            <In label={`Phone${i === 0 ? ' *' : ''}`} value={c.phone} inputMode="tel" placeholder="+91 98400 12345" disabled={ro} error={fe(err, `contacts.${i}.phone`)} onChange={(e) => setC(i, 'phone', e.target.value)} />
            <In label="E-mail" type="email" value={c.email} disabled={ro} error={fe(err, `contacts.${i}.email`)} onChange={(e) => setC(i, 'email', e.target.value)} />
            <In label="WhatsApp" value={c.whatsapp} inputMode="tel" disabled={ro} error={fe(err, `contacts.${i}.whatsapp`)} onChange={(e) => setC(i, 'whatsapp', e.target.value)} />
          </div>
        ))}
      </div>
      <div className="a-grid2" hidden={tab !== 'tax'}>
        <label className="a-inline a-wide"><input type="checkbox" disabled={ro} checked={f.no_gst} onChange={(e) => setF((x) => ({ ...x, no_gst: e.target.checked, gstin: e.target.checked ? '' : x.gstin }))} /> Not registered for GST (no GST on their bills, no input credit)</label>
        <In label="GSTIN" value={f.gstin} maxLength={15} className="a-mono" disabled={ro || f.no_gst} error={err.gstin} hint="15 characters. Checked for the state code and the check character." onChange={(e) => set('gstin')(e.target.value.toUpperCase())} />
        <In label="PAN" value={panOf(f.gstin)} disabled readOnly hint="Read only: taken from the GSTIN." />
        <Field def={{ name: 'msme_type', label: 'MSME (Udyam) type', type: 'select', locked: ro, error: err.msme_type, help: 'Micro and small suppliers must be paid within 45 days.', options: ['Micro', 'Small', 'Medium'].map((x) => ({ value: x, label: x })) }} value={f.msme_type} onChange={(v) => set('msme_type')(v || '')} />
        <In label="Udyam number" value={f.udyam} maxLength={19} placeholder="UDYAM-TN-03-0045121" disabled={ro} error={err.udyam} onChange={(e) => set('udyam')(e.target.value.toUpperCase())} />
        <In label="Address line 1 *" wide value={f.addr_l1} maxLength={100} disabled={ro} error={err.addr_l1} onChange={(e) => set('addr_l1')(e.target.value)} />
        <In label="Address line 2" wide value={f.addr_l2} maxLength={100} disabled={ro} onChange={(e) => set('addr_l2')(e.target.value)} />
        <In label="Town or city *" value={f.city} maxLength={40} disabled={ro} error={err.city} onChange={(e) => set('city')(e.target.value)} />
        <In label="PIN code *" value={f.pin} inputMode="numeric" maxLength={6} disabled={ro} error={err.pin} onChange={(e) => set('pin')(e.target.value.replace(/\D/g, ''))} />
        <Field def={{ name: 'state_code', label: 'State', type: 'select', allowEmpty: false, required: true, locked: ro, error: err.state_code, options: states, help: 'Same state as the godown: CGST + SGST. Another state: IGST.' }} value={f.state_code} onChange={set('state_code')} />
        <In label="Map search" value={f.map_query} maxLength={80} disabled={ro} hint="What to search on Google Maps to find them." onChange={(e) => set('map_query')(e.target.value)} />
        <In label="Pickup address, if different" wide value={f.pickup} maxLength={120} disabled={ro} hint="Where our vehicle collects from, when we collect." onChange={(e) => set('pickup')(e.target.value)} />
      </div>
      <div hidden={tab !== 'bank'}>
        {isNew ? <p className="a-hint-s a-p16-mt0">Type the account number twice. It waits for a second Admin; payments go only to an approved account.</p> : (
          <Alert tone="info" title={`Paid to: ${s.bank ? `${s.bank.name} ${s.bank.acc}` : 'no bank yet'}`}>{s.bank ? `${s.bank.ifsc} · ${s.bank.holder}. ` : 'Add the account below. '}A new account is used only after a second Admin approves it, so a fake "please pay our new account" letter cannot move money.</Alert>
        )}
        {d && d.bank_waiting && <Alert tone="warn" title="New account waiting for approval.">{d.bank_waiting.name} {d.bank_waiting.acc} · {d.bank_waiting.ifsc}. {d.bank_waiting.line} Until it is approved, payments go only to the approved account{s.bank ? '' : ' (there is none yet, so no payment can be made)'}.</Alert>}
        <div className="a-grid2">
          <In label="Account holder name" value={f.bank.holder} maxLength={80} disabled={bankLocked} placeholder={isNew ? 'As the bank has it' : (s.bank && s.bank.holder) || ''} error={fe(err, 'bank.holder')} onChange={(e) => setB('holder', e.target.value)} />
          <In label="Bank" value={f.bank.name} maxLength={60} disabled={bankLocked} placeholder={isNew ? 'e.g. Indian Bank' : (s.bank && s.bank.name) || ''} error={fe(err, 'bank.name')} onChange={(e) => setB('name', e.target.value)} />
          <In label="Branch" value={f.bank.branch} maxLength={60} disabled={bankLocked} onChange={(e) => setB('branch', e.target.value)} />
          <In label="Account type" disabled={bankLocked}><select value={f.bank.type} disabled={bankLocked} onChange={(e) => setB('type', e.target.value)}>{opts.bank_types.map((x) => <option key={x}>{x}</option>)}</select></In>
          <In label="Account number" value={f.bank.acc} inputMode="numeric" maxLength={18} autoComplete="off" disabled={bankLocked} error={fe(err, 'bank.acc')} hint={isNew ? '9 to 18 digits.' : 'Fill these only to change the account.'} onChange={(e) => setB('acc', e.target.value.replace(/\D/g, ''))} />
          <In label="Account number again" value={f.bank.acc2} inputMode="numeric" maxLength={18} autoComplete="off" disabled={bankLocked} error={fe(err, 'bank.acc2')} hint="Typed twice so a wrong digit is caught." onChange={(e) => setB('acc2', e.target.value.replace(/\D/g, ''))} />
          <In label="IFSC" value={f.bank.ifsc} maxLength={11} className="a-mono" disabled={bankLocked} error={fe(err, 'bank.ifsc')} hint="11 characters, like IDIB000S052." onChange={(e) => setB('ifsc', e.target.value.toUpperCase())} />
        </div>
      </div>
      <div hidden={tab !== 'items'}>
        <p className="a-hint-s a-p16-mt0">What we buy from them, at what price. A purchase order fills the price from here (or from the last PO), and warns when it goes up. A paper spec (GSM) makes Quality check weigh a sample.</p>
        {f.items.map((x, i) => (
          <div key={i} className="a-p16-lrow">
            <In label="Item" wide error={fe(err, `items.${i}.sku_code`)}><select value={x.sku_code} disabled={ro} onChange={(e) => setI(i, 'sku_code', e.target.value)}><option value="">Choose...</option>
              {opts.items.map((it) => <option key={it.sku_code} value={it.sku_code}>{it.sku_code} · {it.name}</option>)}</select></In>
            <In label="Their code" value={x.their_code} maxLength={24} disabled={ro} onChange={(e) => setI(i, 'their_code', e.target.value)} />
            <In label="Price (Rs, no GST)" type="number" min="0" step="0.01" value={x.price} disabled={ro} error={fe(err, `items.${i}.price`)} onChange={(e) => setI(i, 'price', e.target.value)} />
            <In label="Lead days" type="number" min="0" step="1" value={x.lead_days} disabled={ro} error={fe(err, `items.${i}.lead_days`)} onChange={(e) => setI(i, 'lead_days', e.target.value)} />
            <In label="Min. order" type="number" min="1" step="1" value={x.moq} disabled={ro} error={fe(err, `items.${i}.moq`)} onChange={(e) => setI(i, 'moq', e.target.value)} />
            <In label="Spec GSM" type="number" min="0" step="0.1" value={x.spec_gsm} disabled={ro} error={fe(err, `items.${i}.spec_gsm`)} onChange={(e) => setI(i, 'spec_gsm', e.target.value)} />
            <In label="Ply" type="number" min="1" step="1" value={x.spec_ply} disabled={ro || !x.spec_gsm} onChange={(e) => setI(i, 'spec_ply', e.target.value)} />
            <In label="Width mm" type="number" min="1" step="1" value={x.spec_width} disabled={ro || !x.spec_gsm} onChange={(e) => setI(i, 'spec_width', e.target.value)} />
            {!ro && <button type="button" className="a-iconbtn a-p16-del" aria-label="Remove this row" onClick={() => setF((y) => ({ ...y, items: y.items.filter((_, j) => j !== i) }))}><LIcon name="trash-2" size="sm" /></button>}
          </div>
        ))}
        {!ro && <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => setF((y) => ({ ...y, items: [...y.items, blankItem()] }))}><LIcon name="plus" size="sm" />Add an item</button>}
      </div>
      {!isNew && (
        <div hidden={tab !== 'record'}>
          <dl className="a-kv">
            <dt>Supplier since</dt><dd>{s.since || '-'}</dd>
            <dt>On time</dt><dd>{d.record.rating.n ? `${d.record.rating.ontime}% of ${d.record.rating.n} deliver${d.record.rating.n === 1 ? 'y' : 'ies'} on or before the expected date` : 'No deliveries yet'}</dd>
            <dt>Rejected at QC</dt><dd>{d.record.rating.rej_pct !== null ? `${d.record.rating.rej_pct}% of what was checked` : '-'}</dd>
            <dt>We owe</dt><dd>{d.record.owe_text === null ? <span className="a-muted">hidden</span> : d.record.owe_text}{s.opening_owed ? <> (with {bm(s.opening_owed)} opening)</> : ''}</dd>
          </dl>
          <h3 className="a-p14-fsec">Purchase orders</h3>
          {d.record.pos.length ? <ul className="a-p15-hist">{d.record.pos.map((p) => <li key={p.po_id}><a href={`/admin/purchase-orders?open=${p.po_id}`}>{p.po_no}</a> · {p.po_date} · {bm(p.value)} · {p.state}</li>)}</ul> : <p className="a-hint-s">None yet.</p>}
          <h3 className="a-p14-fsec">Bills</h3>
          {d.record.bills.length ? <ul className="a-p15-hist">{d.record.bills.map((b) => <li key={b.bill_id}>{b.supplier_bill_no} · {b.bill_date} · {bm(b.total)} · {b.status}</li>)}</ul> : <p className="a-hint-s">None yet.</p>}
          <h3 className="a-p14-fsec">Changes</h3>
          {d.record.changes.length ? <ul className="a-p15-hist">{d.record.changes.map((c, i) => <li key={i}>{at(c.at)} · {c.who} · {c.action}</li>)}</ul> : <p className="a-hint-s">No changes since it was added.</p>}
        </div>
      )}
    </Drawer>
  );
}
