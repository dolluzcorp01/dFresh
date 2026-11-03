// Admin > Organisation > Company (phase 13 step 1; API /company in company.js), as v23: the sections down the left,
// each with only its own facts and its own Change; a missing fact is red and counted on the left. Only the Super admin
// and an Admin open it (v23 "Admin only"). Bank accounts: add (the number typed twice), change, make default, make
// inactive, bring back - every one waits for a second Admin and is never overridden; an account is never deleted.
// The legal name, CIN, GSTIN, e-mail, phone and WhatsApp are the same rows the public site prints (one source). The
// logo stays with the website (read only here). "Books closed up to" is the phase 12b setting (moving it back waits).
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { mediaUrl, API_BASE } from '../utils/api';
import { Alert, Drawer, Field, LIcon, Loading, Notice, PageHead, Pill, useAction, useAdmin, useConfirm, useLoad } from './ui';

const SECTIONS = [
  { key: 'profile', label: 'Company profile', icon: 'store', sub: 'Name, type, logo and website shown on documents and the website' },
  { key: 'tax', label: 'Tax and compliance', icon: 'clipboard-check', sub: 'GSTIN, PAN, GST type, e-invoice and e-way bill' },
  { key: 'address', label: 'Address and contact', icon: 'house', sub: 'Registered office, map, e-mail, phone and WhatsApp' },
  { key: 'bank', label: 'Bank accounts', icon: 'wallet', sub: 'Accounts printed on invoices for payment' },
  { key: 'invoice', label: 'Invoice preferences', icon: 'receipt', sub: 'What every invoice shows and how it is signed' },
  { key: 'system', label: 'System preferences', icon: 'settings', sub: 'Currency, dates, time zone, financial year and closed books' },
  { key: 'numbering', label: 'Document numbering', icon: 'list-todo', sub: 'How invoice, order and return numbers look' },
];
const SITE_LOGO = '/media/logo/dfresh-logo-on-light.png';
const SIGN_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

/** one fact: a red "Missing" pill when a needed one is empty, a dash when an optional one is */
function KV({ k, v, need, children }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{children || (v ? v : need ? <Pill tone="bad">Missing</Pill> : <span className="a-muted">-</span>)}</dd>
    </>
  );
}

export default function Company() {
  const { me } = useAdmin();
  const isAdmin = Boolean(me && me.is_admin);
  const data = useLoad(isAdmin ? '/company' : null);
  const act = useAction();
  const confirm = useConfirm();
  const [sec, setSec] = useState(() => { const h = window.location.hash.slice(1); return SECTIONS.some((x) => x.key === h) ? h : 'profile'; }); // /admin/company#tax opens Tax
  const [open, setOpen] = useState(null); // { sec } | { bank: id | 'new' }
  const d = data.data;
  if (!isAdmin) {
    return (
      <section>
        <PageHead sub="The legal details printed on every document" rules={['Admin only']} />
        <Alert tone="warn" title="Admin only">Company holds the legal details and the bank account printed on every invoice, so only the Super admin or an Admin opens it, whatever the role grid says.</Alert>
      </section>
    );
  }
  const done = (r) => { setOpen(null); act.setMsg({ kind: r && r.waiting ? 'warn' : 'ok', text: (r && r.message) || 'Saved' }); data.reload(); };
  const bankAct = async (b, op) => {
    const name = `${b.bank_name}${b.account_no ? ` XXXX${b.account_no.slice(-4)}` : ''}`;
    if (op === 'inactive' && !(await confirm({ title: `Make ${name} inactive?`, danger: true, action: 'Ask to make it inactive',
      message: `${b.is_default ? 'It is the only account, so invoices will show no bank details until another is added. ' : ''}It is kept for the record and old invoices keep what they printed. A second Admin signs it first.` }))) return;
    if (op === 'back' && !(await confirm({ title: `Bring ${name} back?`, action: 'Ask to bring it back', message: 'A second Admin signs it first.' }))) return;
    act.run(async () => done(await api.send('POST', `/company/banks/${b.bank_id}/${op}`)));
  };
  const counts = d ? Object.fromEntries(Object.entries(d.missing).map(([k, v]) => [k, v.length])) : {};
  const stillMissing = d ? [...d.missing.tax, ...d.missing.bank] : [];
  const cur = SECTIONS.find((s) => s.key === sec);
  let action = null;
  if (sec === 'bank') action = <button type="button" className="a-btn" onClick={() => setOpen({ bank: 'new' })}><LIcon name="plus" size="sm" />Add account</button>;
  else if (sec === 'numbering') action = <Link className="a-btn a-btn-ghost" to="/admin/numbering">Open Numbering <LIcon name="chevron-right" size="sm" /></Link>;
  else action = <button type="button" className="a-btn" onClick={() => setOpen({ sec })}>Change</button>;

  return (
    <section>
      <PageHead sub="The legal details printed on every document"
        rules={['A red box is still missing', 'GSTIN is needed before the first tax invoice', 'Admin only', 'Every bank or UPI change waits for a second Admin']} />
      {act.note}
      <Loading state={data}>
        {d && (
          <>
            {stillMissing.length > 0 && <Alert tone="warn" title={`Still missing: ${stillMissing.join(', ')}.`}>{d.missing.tax.includes('GSTIN') ? 'Invoices print "DEMO - not a tax invoice" until the GSTIN is in.' : 'Fill these in before the first tax invoice.'}</Alert>}
            <div className="a-seclay">
              <nav className="a-secnav" aria-label="Sections">
                <div className="a-snh">Sections</div>
                {SECTIONS.map((s) => (
                  <button key={s.key} type="button" aria-current={s.key === sec} onClick={() => setSec(s.key)}>
                    <LIcon name={s.icon} size="sm" /><span>{s.label}</span>{counts[s.key] > 0 && <span className="a-co-miss">{counts[s.key]}</span>}
                  </button>
                ))}
              </nav>
              <div className="a-card a-co-card">
                <div className="a-cardh">
                  <div className="a-co-h"><h2>{cur.label}</h2><p className="a-hint-s">{cur.sub}</p></div>
                  {action}
                </div>
                <div className="a-cardb">
                  {sec === 'profile' && <Profile d={d} />}
                  {sec === 'tax' && <Tax d={d} />}
                  {sec === 'address' && <Address d={d} />}
                  {sec === 'bank' && <Banks d={d} onChange={(b) => setOpen({ bank: b.bank_id })} onAct={bankAct} busy={act.busy} />}
                  {sec === 'invoice' && <Invoice d={d} act={act} reload={data.reload} />}
                  {sec === 'system' && <System d={d} />}
                  {sec === 'numbering' && <p className="a-co-p">Numbers have their own page, so they are kept in one place: prefix, godown code, next number and when the count starts again.</p>}
                </div>
              </div>
            </div>
          </>
        )}
      </Loading>
      {open && open.sec && d && <SectionDrawer sec={open.sec} d={d} onClose={() => setOpen(null)} onSaved={done} />}
      {open && open.bank && d && <BankDrawer bank={open.bank === 'new' ? null : d.banks.find((b) => b.bank_id === open.bank)} d={d} onClose={() => setOpen(null)} onSaved={done} />}
    </section>
  );
}

// ---------------------------------------------------------------- the sections, view
function Profile({ d }) {
  const p = d.profile;
  return (
    <>
      <div className="a-co-logos">
        <div className="a-co-logo">
          <div className="a-co-lbox"><img src={mediaUrl(SITE_LOGO)} alt="dFresh logo" /></div>
          <div><b>Logo</b><small>The website keeps the logo; documents use the same one.</small><Link to="/admin/settings">Website &gt; Site settings</Link></div>
        </div>
      </div>
      <dl className="a-kv">
        <KV k="Legal name" v={p.name} need />
        <KV k="Brand" v={p.brand} need />
        <KV k="Company type" v={p.company_type} need />
        <KV k="CIN" v={p.cin} need />
        <KV k="Website" v={p.website} />
      </dl>
      <p className="a-hint-s">The legal name and CIN are the same ones the website footer prints, so they are changed in one place.</p>
    </>
  );
}

function Tax({ d }) {
  const t = d.tax;
  return (
    <>
      <dl className="a-kv">
        <KV k="GSTIN" v={t.gstin} need />
        <KV k="GST state">{t.gstin ? <>{t.gst_state} ({t.gst_state_code}) <small className="a-muted">read from the GSTIN</small></> : <span className="a-muted">from the GSTIN</span>}</KV>
        <KV k="PAN" v={t.pan} need />
        <KV k="GST type" v={t.gst_type === 'composition' ? 'Composition: bills of supply, no GST charged' : 'Regular: tax invoices with GST'} />
        <KV k="TAN" v={t.tan} />
        <KV k="MSME Udyam number" v={t.udyam} />
        <KV k="E-invoice"><Pill tone={t.einvoice ? 'good' : 'gray'}>{t.einvoice ? 'On' : 'Off'}</Pill> <small className="a-muted">needed once yearly turnover is above Rs 5 crore</small></KV>
        <KV k="E-way bill">{t.eway ? <><Pill tone="good">On</Pill> for goods moved above Rs {t.eway_limit.toLocaleString('en-IN')}</> : <Pill tone="gray">Off</Pill>}</KV>
      </dl>
      <p className="a-hint-s">E-invoice and the e-way bill are switched in <Link to="/admin/switches">Switches</Link>. A composition dealer makes bills of supply, so e-invoice stays off.</p>
    </>
  );
}

function Address({ d }) {
  const a = d.address;
  return (
    <>
      <dl className="a-kv">
        <KV k="Registered office">
          {a.line1 ? a.text : <Pill tone="bad">Missing</Pill>}{a.line1 && !a.city && <> <Pill tone="bad">Town to add</Pill></>}{a.line1 && !a.pin && <> <Pill tone="warn">PIN to add</Pill></>}
        </KV>
        <KV k="Map location" v={a.map_query} />
        <KV k="E-mail on documents" v={a.email} need />
        <KV k="Phone on documents" v={a.phone} need />
        <KV k="WhatsApp" v={a.whatsapp} />
      </dl>
      <p className="a-hint-s">The same e-mail, phone and WhatsApp show on the website. Godown addresses are kept on each godown; the addresses the website prints are texts in Translations.</p>
    </>
  );
}

function Banks({ d, onChange, onAct, busy }) {
  if (!d.banks.length && !d.banks_waiting.length) {
    return <div className="a-empty"><div className="a-empty-ic"><LIcon name="wallet" size="lg" /></div><h3>No bank account yet</h3><p>Invoices show no bank details until one is added and a second Admin signs it.</p></div>;
  }
  return (
    <div className="a-co-banks">
      {d.banks_waiting.map((w) => (
        <div key={`w${w.approval_id}`} className="a-co-bank">
          <div className="a-kh"><span className="a-thumb2"><LIcon name="wallet" /></span><div><b>{w.bank}</b><span className="a-kh-sub">{w.branch || ''}</span></div><span className="a-sp" /><Pill tone="warn">{w.label}</Pill></div>
          <dl className="a-kv a-kvs"><dt>Holder</dt><dd>{w.holder}</dd><dt>Account</dt><dd className="a-mono">{w.account}</dd><dt>IFSC</dt><dd className="a-mono">{w.ifsc}</dd><dt>UPI ID</dt><dd>{w.upi || '-'}</dd></dl>
          <p className="a-hint-s">{w.waiting} Not used on invoices until it is signed (<Link to="/admin/approvals">Approvals</Link>).</p>
        </div>
      ))}
      {d.banks.map((b) => (
        <div key={b.bank_id} className={`a-co-bank${b.is_default ? ' def' : ''}${b.status === 'inactive' ? ' dim' : ''}`}>
          <div className="a-kh">
            <span className="a-thumb2"><LIcon name="wallet" /></span>
            <div><b>{b.bank_name}</b><span className="a-kh-sub">{b.branch}</span></div>
            <span className="a-sp" />
            {b.is_default && <Pill tone="gold">Default on invoices</Pill>}
            {b.status === 'inactive' && <Pill tone="gray">Inactive</Pill>}
            {b.pending && <Pill tone="warn">{b.pending.label}</Pill>}
          </div>
          {b.old_text ? (
            <p className="a-co-p">Printed today as: <b>{b.old_text}</b><span className="a-sub-l">Moved from the old free-text setting. Change it to fill in the account number, IFSC and UPI ID.</span></p>
          ) : (
            <dl className="a-kv a-kvs">
              <dt>Holder</dt><dd>{b.holder_name}</dd>
              <dt>Account</dt><dd className="a-mono">{b.account_no}</dd>
              <dt>IFSC</dt><dd className="a-mono">{b.ifsc}</dd>
              <dt>Type</dt><dd>{b.account_type}</dd>
              <dt>UPI ID</dt><dd>{b.upi_id ? <>{b.upi_id}<span className="a-sub-l a-mono">QR carries: {b.qr}</span></> : <span className="a-muted">-</span>}</dd>
            </dl>
          )}
          {b.pending && <p className="a-hint-s">{b.pending.changes ? `Asked: ${b.pending.changes}. ` : ''}{b.pending.waiting} Invoices keep printing the account as it is until then.</p>}
          <div className="a-kfoot">
            {b.status === 'inactive'
              ? <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={busy || Boolean(b.pending)} onClick={() => onAct(b, 'back')}>Bring back</button>
              : (
                <>
                  <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={busy || Boolean(b.pending)} onClick={() => onChange(b)}>Change</button>
                  {!b.is_default && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={busy || Boolean(b.pending)} onClick={() => onAct(b, 'default')}>Make default</button>}
                  <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={busy || Boolean(b.pending)} onClick={() => onAct(b, 'inactive')}>Make inactive</button>
                </>
              )}
          </div>
        </div>
      ))}
    </div>
  );
}

function Invoice({ d, act, reload }) {
  const v = d.invoice;
  const confirm = useConfirm();
  const [stamp, setStamp] = useState(0); // a new picture after an upload
  const pick = (f) => {
    if (!SIGN_TYPES.includes(f.type)) { act.setMsg({ kind: 'error', text: 'The signature must be PNG, JPG or WebP.' }); return; }
    if (f.size > 500 * 1024) { act.setMsg({ kind: 'error', text: 'The signature is over 500 KB. Make it smaller first.' }); return; }
    act.run(async () => { await api.upload('/company/signature', f); setStamp(Date.now()); reload(); }, 'Signature saved');
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Remove the signature?', message: 'Invoices made from now on print without it.', action: 'Remove', danger: true }))) return;
    act.run(async () => { await api.send('DELETE', '/company/signature'); reload(); }, 'Signature removed');
  };
  return (
    <>
      {v.warnings.length > 0 && <Alert tone="warn" title="Check this">{v.warnings.join(' ')}</Alert>}
      <dl className="a-kv">
        <KV k="Bank details on invoices" v={v.show_bank ? `Yes, the default account${v.default_bank ? ` (${v.default_bank})` : ''}` : 'No'} />
        <KV k="UPI QR on invoices" v={v.show_upi ? 'Yes' : 'No'} />
        <KV k="Authorised signatory" v={v.signatory} />
        <KV k="Signature">
          <div className="a-co-logo sm">
            <div className="a-co-lbox">{v.has_signature ? <img src={`${API_BASE}/api/dfresh/admin/company/signature?v=${stamp}`} alt="Signature" /> : <span className="a-muted">No signature</span>}</div>
            <div>
              <small>PNG, JPG or WebP, at most 500 KB</small>
              <div className="a-co-lacts">
                <label className="a-btn a-btn-sm a-btn-ghost a-file">Upload<input type="file" accept={SIGN_TYPES.join(',')} disabled={act.busy} onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) pick(f); }} /></label>
                {v.has_signature && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={remove}>Remove</button>}
              </div>
            </div>
          </div>
        </KV>
        <KV k="Declaration" v={v.declaration} />
        <KV k="Round off" v={v.round_off ? 'Yes, to the nearest rupee' : 'No, paise as worked out'} />
        <KV k="Copies" v={v.copies.join(', ')} />
        <KV k="Footer terms" v={v.terms} />
      </dl>
      <p className="a-hint-s">How the invoice is laid out comes with Print templates in Invoicing (section 10). An invoice keeps the bank details it printed when it was made.</p>
    </>
  );
}

function System({ d }) {
  const s = d.system;
  return (
    <dl className="a-kv">
      <KV k="Currency">{s.currency} <small className="a-muted">fixed</small></KV>
      <KV k="Date format" v={s.date_format} />
      <KV k="Time zone">{s.time_zone} <small className="a-muted">fixed</small></KV>
      <KV k="Financial year starts">{s.fy_start} <small className="a-muted">fixed</small></KV>
      <KV k="Books closed up to" v={s.books_closed_to || 'not set'} />
      <KV k="Default language">English <Link to="/admin/languages" className="a-co-inl">Languages</Link></KV>
    </dl>
  );
}

// ---------------------------------------------------------------- Change: one drawer per section
function startOf(sec, d) {
  if (sec === 'profile') return { ...d.profile };
  if (sec === 'tax') return { gstin: d.tax.gstin, pan: d.tax.pan, gst_type: d.tax.gst_type, tan: d.tax.tan, udyam: d.tax.udyam };
  if (sec === 'address') return { line1: d.address.line1, line2: d.address.line2, city: d.address.city, pin: d.address.pin, state_code: d.address.state_code, map_query: d.address.map_query, email: d.address.email, phone: d.address.phone, whatsapp: d.address.whatsapp };
  if (sec === 'invoice') return { show_bank: d.invoice.show_bank ? '1' : '0', show_upi: d.invoice.show_upi ? '1' : '0', signatory: d.invoice.signatory, round_off: d.invoice.round_off ? '1' : '0', copies: d.invoice.copies, declaration: d.invoice.declaration, terms: d.invoice.terms };
  return { date_format: d.system.date_format, books_closed_to: d.system.books_closed_to };
}

function SectionDrawer({ sec, d, onClose, onSaved }) {
  const act = useAction();
  const start = startOf(sec, d);
  const [f, setF] = useState(start);
  const [errs, setErrs] = useState({});
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v ?? '' }));
  const up = (k) => (v) => set(k)(String(v ?? '').toUpperCase());
  const fd = (name, label, extra = {}) => ({ name, label, error: errs[name], ...extra });
  const save = () => act.run(async () => {
    setErrs({});
    try {
      if (sec === 'system') {
        let msg = []; let waiting = false;
        if (f.date_format !== start.date_format) msg.push((await api.send('PUT', '/company/system', { date_format: f.date_format })).message);
        if (f.books_closed_to !== start.books_closed_to) {
          const r = await api.send('PUT', '/commerce-settings/books_closed_to', { value: f.books_closed_to });
          if (r.waiting) { waiting = true; msg.push(r.waiting); } else msg.push(`Books closed up to ${r.value || 'not set'}.`);
        }
        msg = msg.filter(Boolean);
        onSaved({ waiting, message: `System preferences saved. ${msg.join(' ')}` });
        return;
      }
      const body = sec === 'invoice' ? { ...f, copies: f.copies.filter((x) => x !== 'Original') } : f;
      const r = await api.send('PUT', `/company/${sec}`, body);
      onSaved({ message: `${SECTIONS.find((s) => s.key === sec).label} saved. ${r.message}` });
    } catch (err) {
      if (err.data && err.data.fields) setErrs(err.data.fields);
      throw err;
    }
  });
  const yesNo = [{ value: '1', label: 'Yes' }, { value: '0', label: 'No' }];
  let body = null;
  if (sec === 'profile') {
    body = (
      <div className="a-grid2">
        <Field def={fd('name', 'Legal name', { required: true, wide: true, info: 'As registered. The website footer prints the same name.' })} value={f.name} onChange={set('name')} />
        <Field def={fd('brand', 'Brand', { required: true })} value={f.brand} onChange={set('brand')} />
        <Field def={fd('company_type', 'Company type', { type: 'select', options: d.options.types, allowEmpty: false })} value={f.company_type} onChange={set('company_type')} />
        <Field def={fd('cin', 'CIN', { info: '21 characters, like U72501TN2018OPC120419. The website footer prints it.' })} value={f.cin} onChange={up('cin')} />
        <Field def={fd('website', 'Website', { info: 'Starts with https://' })} value={f.website} onChange={set('website')} />
      </div>
    );
  }
  if (sec === 'tax') {
    body = (
      <div className="a-grid2">
        <Field def={fd('gstin', 'GSTIN', { info: `15 characters, starts with ${d.address.state_code} for ${d.address.state}. Every tax invoice says "to be confirmed" until this is filled.` })} value={f.gstin} onChange={up('gstin')} />
        <Field def={fd('pan', 'PAN', { info: '10 characters. The PAN is also inside the GSTIN (characters 3 to 12), so the two are checked against each other. Godown GSTINs must carry it too.' })} value={f.pan} onChange={up('pan')} />
        <Field def={fd('gst_type', 'GST type', { type: 'select', allowEmpty: false, wide: true, info: 'Decides whether a sale makes a tax invoice or a bill of supply.',
          options: [{ value: 'regular', label: 'Regular: tax invoices with GST' }, { value: 'composition', label: 'Composition: bills of supply, no GST charged' }] })} value={f.gst_type} onChange={set('gst_type')} />
        <Field def={fd('tan', 'TAN (optional)', { info: '10 characters, like CHEA12345B. Needed only when dFresh deducts TDS.' })} value={f.tan} onChange={up('tan')} />
        <Field def={fd('udyam', 'MSME Udyam number (optional)', { info: 'Like UDYAM-TN-02-1234567.' })} value={f.udyam} onChange={up('udyam')} />
      </div>
    );
  }
  if (sec === 'address') {
    body = (
      <>
        <h3 className="a-h3">Registered office</h3>
        <div className="a-grid2">
          <Field def={fd('line1', 'Address line 1', { required: true, wide: true })} value={f.line1} onChange={set('line1')} />
          <Field def={fd('line2', 'Address line 2', { wide: true })} value={f.line2} onChange={set('line2')} />
          <Field def={fd('city', 'Town or city', { required: true })} value={f.city} onChange={set('city')} />
          <Field def={fd('pin', 'PIN code', { info: '6 digits.' })} value={f.pin} onChange={set('pin')} />
          <Field def={fd('state_code', 'State', { type: 'select', allowEmpty: false, options: d.options.states, locked: d.address.state_fixed,
            info: d.address.state_fixed ? 'Comes with the GST registration: the first two digits of the GSTIN.' : 'Fixed by the GSTIN once it is filled in.' })} value={f.state_code} onChange={set('state_code')} />
          <Field def={fd('map_query', 'Map location', { wide: true, info: 'A Google Maps search or place, as on the live site.' })} value={f.map_query} onChange={set('map_query')} />
        </div>
        <h3 className="a-h3">Contact</h3>
        <div className="a-grid2">
          <Field def={fd('email', 'E-mail on documents', { required: true, info: 'The website shows the same e-mail.' })} value={f.email} onChange={set('email')} />
          <Field def={fd('phone', 'Phone on documents', { required: true, info: '+91 and 10 digits. The website shows the same phone.' })} value={f.phone} onChange={set('phone')} />
          <Field def={fd('whatsapp', 'WhatsApp', { info: '+91 and 10 digits. The website chat button uses it.' })} value={f.whatsapp} onChange={set('whatsapp')} />
        </div>
      </>
    );
  }
  if (sec === 'invoice') {
    body = (
      <>
        <div className="a-grid2">
          <Field def={fd('show_bank', 'Bank details on invoices', { type: 'select', allowEmpty: false, options: [{ value: '1', label: 'Yes, the default account' }, { value: '0', label: 'No' }] })} value={f.show_bank} onChange={set('show_bank')} />
          <Field def={fd('show_upi', 'UPI QR on invoices', { type: 'select', allowEmpty: false, options: yesNo })} value={f.show_upi} onChange={set('show_upi')} />
          <Field def={fd('signatory', 'Authorised signatory', { info: 'The name printed under the signature.' })} value={f.signatory} onChange={set('signatory')} />
          <Field def={fd('round_off', 'Round off the invoice total', { type: 'select', allowEmpty: false, options: [{ value: '1', label: 'Yes, to the nearest rupee' }, { value: '0', label: 'No' }] })} value={f.round_off} onChange={set('round_off')} />
        </div>
        <h3 className="a-h3">Copies printed</h3>
        <div className="a-chkgrid a-co-copies">
          {d.options.copies.map((x) => (
            <label key={x} className="a-check">
              <input type="checkbox" disabled={x === 'Original'} checked={x === 'Original' || f.copies.includes(x)}
                onChange={(e) => setF((y) => ({ ...y, copies: d.options.copies.filter((c) => c === 'Original' || (c === x ? e.target.checked : y.copies.includes(c))) }))} />
              {' '}{x} <small className="a-muted">{x === 'Original' ? 'always' : x === 'Duplicate' ? 'for the transporter' : 'for us'}</small>
            </label>
          ))}
        </div>
        <div className="a-grid2">
          <Field def={fd('declaration', 'Declaration', { type: 'textarea', wide: true })} value={f.declaration} onChange={set('declaration')} />
          <Field def={fd('terms', 'Footer terms', { type: 'textarea', rows: 2, wide: true })} value={f.terms} onChange={set('terms')} />
        </div>
      </>
    );
  }
  if (sec === 'system') {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    body = (
      <>
        <div className="a-grid2">
          <Field def={fd('date_format', 'Date format', { type: 'select', allowEmpty: false, options: d.options.date_formats })} value={f.date_format} onChange={set('date_format')} />
          <Field def={fd('books_closed_to', 'Books closed up to', { type: 'date', max: today,
            info: 'Set with the CA when a year is closed. Nothing can be dated on or before it. Moving it back (reopening) needs a second Admin.' })} value={f.books_closed_to} onChange={set('books_closed_to')} />
        </div>
        <p className="a-hint-s">Currency (Rs), time zone (India) and the financial year (April to March) are fixed.</p>
      </>
    );
  }
  const cur = SECTIONS.find((s) => s.key === sec);
  return (
    <Drawer title={cur.label} onClose={onClose} dirty={dirty} thumb={<LIcon name={cur.icon} />}
      footer={<><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy || !dirty} onClick={save}>Save</button></>}>
      {act.note}
      {body}
    </Drawer>
  );
}

function BankDrawer({ bank, d, onClose, onSaved }) {
  const act = useAction();
  const creating = !bank;
  const start = creating
    ? { holder_name: d.profile.name, bank_name: '', branch: '', account_no: '', account_no2: '', ifsc: '', account_type: 'Current', upi_id: '' }
    : { holder_name: bank.holder_name, bank_name: bank.old_text ? '' : bank.bank_name, branch: bank.branch, account_no: bank.account_no, account_no2: bank.account_no, ifsc: bank.ifsc, account_type: bank.account_type, upi_id: bank.upi_id };
  const [f, setF] = useState(start);
  const [errs, setErrs] = useState({});
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v ?? '' }));
  const fd = (name, label, extra = {}) => ({ name, label, error: errs[name], ...extra });
  const save = () => act.run(async () => {
    setErrs({});
    try {
      onSaved(creating ? await api.send('POST', '/company/banks', f) : await api.send('PUT', `/company/banks/${bank.bank_id}`, f));
    } catch (err) {
      if (err.data && err.data.fields) setErrs(err.data.fields);
      throw err;
    }
  });
  return (
    <Drawer title={creating ? 'Add a bank account' : bank.bank_name} onClose={onClose} dirty={dirty} thumb={<LIcon name="wallet" />}
      footer={<><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button><button type="button" className="a-btn" disabled={act.busy || !dirty} onClick={save}>{creating ? 'Add account' : 'Save'}</button></>}>
      {act.note}
      <Notice kind="info">Money goes to this account, so a second Admin signs every change, the UPI ID too. It is never overridden. Invoices keep the account as it is until then.</Notice>
      {bank && bank.old_text && <p className="a-hint-s">Printed today as: {bank.old_text}</p>}
      <div className="a-grid2">
        <Field def={fd('holder_name', 'Account holder name', { required: true, wide: true, info: 'As printed on the cheque book.' })} value={f.holder_name} onChange={set('holder_name')} />
        <Field def={fd('bank_name', 'Bank name', { required: true })} value={f.bank_name} onChange={set('bank_name')} />
        <Field def={fd('branch', 'Branch')} value={f.branch} onChange={set('branch')} />
        <Field def={fd('account_no', 'Account number', { required: true, info: '9 to 18 digits.' })} value={f.account_no} onChange={(v) => set('account_no')(String(v).replace(/[^\d\s]/g, ''))} />
        <Field def={fd('account_no2', 'Type the account number again', { required: true, info: 'Stops a wrong digit going on every invoice.' })} value={f.account_no2} onChange={(v) => set('account_no2')(String(v).replace(/[^\d\s]/g, ''))} />
        <Field def={fd('ifsc', 'IFSC', { required: true, info: '11 characters: 4 letters, 0, then 6 letters or digits, like SBIN0001234.' })} value={f.ifsc} onChange={(v) => set('ifsc')(String(v).toUpperCase())} />
        <Field def={fd('account_type', 'Account type', { type: 'select', allowEmpty: false, options: d.options.account_types })} value={f.account_type} onChange={set('account_type')} />
        <Field def={fd('upi_id', 'UPI ID', { wide: true, info: 'Makes the pay-by-UPI QR code on invoices, like dfresh@sbi.' })} value={f.upi_id} onChange={set('upi_id')} />
      </div>
    </Drawer>
  );
}
