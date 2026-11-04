// Masters > Tax and units > HSN and GST rates (phase 15, v23 viewHsn; API /prices/hsn in prices.js, tax.js): one place
// for tax. Every HSN code with what it covers, GST today, the next change (or one waiting for a second Admin) and
// the packs using it. A code opens its panel: rate history, what it covers, a new rate from a date (it waits for a
// second Admin: owner decision of 4 Nov 2026; invoices dated before keep the old rate). The GST rates in use: add one,
// remove one no code uses (asks first).
import { useState } from 'react';
import { api } from './adminApi';
import { ViewOnly } from './Prices';
import { splitMsg } from './Units';
import { Alert, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, useAction, useAdmin, useCan, useConfirm, useLoad, useToast } from './ui';

export default function HsnRates() {
  const data = useLoad('/prices/hsn');
  const { me } = useAdmin();
  const canEdit = useCan('prices', 'edit');
  const confirm = useConfirm();
  const toast = useToast();
  const [open, setOpen] = useState(null);
  const [rate, setRate] = useState('');
  const [busy, setBusy] = useState(false);
  const d = data.data;
  const run = async (fn, bad) => { setBusy(true); try { await fn(); } catch (e) { const [t, x] = splitMsg(e.message, bad); toast('bad', t, x); } finally { setBusy(false); } };
  const addRate = (e) => {
    e.preventDefault();
    run(async () => { const out = await api.send('POST', '/prices/gst-rates', { rate }); toast('good', 'Rate added', out.message); setRate(''); data.reload(); }, 'Not added');
  };
  const removeRate = async (r) => {
    if (!(await confirm({ title: `Remove ${r.rate}% from the list?`, message: 'No HSN code uses it.', action: 'Remove', danger: true }))) return;
    run(async () => { await api.send('DELETE', `/prices/gst-rates/${r.rate}`); toast('good', 'Rate removed', `${r.rate}%`); data.reload(); }, 'Cannot remove');
  };
  const columns = [
    { key: 'hsn_code', label: 'HSN code', render: (c) => <b className="a-p14-mono">{c.hsn_code}</b> },
    { key: 'description', label: 'What it covers' },
    { key: 'today', label: 'GST today', num: true, render: (c) => (c.today === null ? '-' : `${c.today}%`) },
    { key: 'next', label: 'Next change', render: (c) => (c.waiting ? <Pill tone="warn">{c.waiting.rate}% from {c.waiting.from}, waiting</Pill> : c.next ? `${c.next.rate}% from ${c.next.from}` : <span className="a-muted">-</span>) },
    { key: 'packs', label: 'Packs using it', num: true, render: (c) => c.packs.length },
  ];
  return (
    <section>
      <PageHead sub="Tax code and rate for each product" actions={canEdit && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New HSN code</button>} />
      {!canEdit && <ViewOnly me={me} />}
      <Alert tone="info" title="One place for tax.">Each pack takes its GST from its HSN code. Change a rate here, with the date it starts, and every pack with that code follows; the change waits for a second Admin. The accountant confirms each code.</Alert>
      <Loading state={data}>
        {d && (
          <>
            <div className="a-listcard">
              <Table columns={columns} rows={d.codes} rowKey={(c) => c.hsn_code} label="HSN codes" className="a-p15-hsn" onRowClick={(c) => setOpen(c)} />
            </div>
            <div className="a-card a-p15-rates">
              <h3 className="a-p14-fsec">GST rates in use</h3>
              <p className="a-hint-s">An HSN code can only use a rate from this list.</p>
              <div className="a-p15-pills">
                {d.rates.map((r) => (
                  <Pill key={r.rate} tone={r.used ? 'gold' : 'gray'}>{r.rate}%
                    {canEdit && !r.used && <button type="button" className="a-p15-x" aria-label={`Remove ${r.rate}%`} disabled={busy} onClick={() => removeRate(r)}>×</button>}</Pill>
                ))}
              </div>
              {canEdit && (
                <form className="a-p14-addrow" onSubmit={addRate}>
                  <label className="a-p14-in"><input type="number" min="0" max="40" step="0.25" value={rate} placeholder="e.g. 12" aria-label="New GST rate" onChange={(e) => setRate(e.target.value)} /></label>
                  <button type="submit" className="a-btn a-btn-ghost" disabled={busy || rate === ''}>Add rate</button>
                </form>
              )}
            </div>
            {open && <HsnDrawer c={open === 'new' ? null : open} d={d} canEdit={canEdit} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); data.reload(); }} />}
          </>
        )}
      </Loading>
    </section>
  );
}

function HsnDrawer({ c, d, canEdit, onClose, onSaved }) {
  const creating = !c;
  const act = useAction();
  const toast = useToast();
  const start = creating ? { hsn_code: '', description: '', gst_rate: '18', effective_from: d.today } : { description: c.description, gst_rate: '', effective_from: d.today };
  const [f, setF] = useState(start);
  const [err, setErr] = useState({});
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => act.run(async () => {
    setErr({});
    try {
      const out = creating ? await api.send('POST', '/prices/hsn', f) : await api.send('PUT', `/prices/hsn/${c.hsn_code}`, f);
      toast(out.waiting ? 'warn' : 'good', creating ? 'HSN code added' : out.waiting ? 'Waiting for a second Admin' : 'Saved', out.message);
      onSaved();
    } catch (e) { if (e.data && e.data.fields) setErr(e.data.fields); throw e; }
  });
  const rates = d.rates.map((r) => ({ value: String(r.rate), label: `${r.rate}%` }));
  return (
    <Drawer title={creating ? 'New HSN code' : `HSN ${c.hsn_code}`} sub={creating ? undefined : c.description} onClose={onClose} dirty={canEdit && dirty}
      footer={canEdit ? <><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="a-btn" disabled={act.busy || !dirty} onClick={save}><LIcon name="check" size="sm" />Save</button></>
        : <><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      {act.note}
      {!creating && (
        <>
          <h3 className="a-p14-fsec">Rate history</h3>
          <p>{c.history.map((h) => `${h.rate}% from ${h.from}`).join(' · ')}</p>
          {c.waiting && <Alert tone="warn" title={`${c.waiting.rate}% from ${c.waiting.from} waits for a second Admin.`}>It is decided on Home &gt; Approvals; until then the old rate stays.</Alert>}
          <p className="a-hint-s">Invoices dated before a change keep the old rate. Packs using it: {c.packs.length ? c.packs.join(', ') : 'none'}.</p>
        </>
      )}
      <div className="a-grid2">
        <Field def={{ name: 'hsn_code', label: 'HSN code', type: creating ? 'text' : 'readonly', required: true, error: err.hsn_code, help: '4, 6 or 8 digits.' }} value={creating ? f.hsn_code : c.hsn_code} onChange={set('hsn_code')} />
        <Field def={{ name: 'description', label: 'What it covers', required: true, locked: !canEdit, error: err.description }} value={f.description} onChange={(v) => set('description')(String(v).slice(0, 80))} />
        <Field def={{ name: 'gst_rate', label: creating ? 'GST rate' : 'New GST rate', type: 'select', allowEmpty: !creating, locked: !canEdit, error: err.gst_rate, options: rates }} value={f.gst_rate} onChange={set('gst_rate')} />
        <Field def={{ name: 'effective_from', label: 'Starts on', type: 'date', locked: !canEdit, error: err.effective_from, help: 'Today or later. A new code may start on 1 April of this year.' }} value={f.effective_from} onChange={set('effective_from')} />
      </div>
    </Drawer>
  );
}
