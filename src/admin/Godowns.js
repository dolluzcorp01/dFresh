// Admin > Organisation > Godowns (phase 12a, gap map D8; API /godowns in foundation.js), as v23: one card per godown
// with its code, state, address, phone, person in charge, GSTIN, the people who can work there, what it holds and its
// next invoice number; Change opens the panel, Close / Open again on the card. New godown / change (Settings edit):
// a code of 1 to 4 capital letters (it goes into the numbers of its invoices and credit notes: DFI/C/26-27/0001;
// Kanchipuram keeps today's numbers), a godown in another state needs its own GSTIN, which starts with that state's
// code. Closing is refused while it holds stock, has open orders or someone works only there. Every change is audited.
import { useState } from 'react';
import { api } from './adminApi';
import { Drawer, Field, LIcon, Loading, Notice, PageHead, Pill, useAction, useConfirm, useLoad } from './ui';

export default function Godowns() {
  const data = useLoad('/godowns');
  const staff = useLoad('/staff');
  const act = useAction();
  const confirm = useConfirm();
  const [open, setOpen] = useState(null); // godown_id | 'new'
  const d = data.data;
  const toggle = async (g) => {
    if (g.is_active && !(await confirm({ title: `Close ${g.name}?`, message: 'Nothing new can be made there. It stays on record and can be opened again.', action: 'Close godown', danger: true }))) return;
    act.run(async () => { await api.send('PUT', `/godowns/${g.godown_id}`, { is_active: g.is_active ? 0 : 1 }); data.reload(); }, `${g.name} ${g.is_active ? 'closed' : 'opened again'}`);
  };
  return (
    <section>
      <PageHead sub="Every godown and its code"
        actions={d && d.can_edit && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New godown</button>}
        rules={['GSTIN needed if in another state', 'Its code goes into its invoice and credit note numbers', 'A godown is closed, never deleted']} />
      {d && !d.can_edit && <Notice kind="info">View only: changing godowns needs Edit on Settings.</Notice>}
      <p className="a-lead">A godown is a place stock sits, not a selling shop. Adding one is a row here, and every screen that asks &quot;which godown&quot; offers it at once.</p>
      {act.note}
      <Loading state={data}>
        {d && (
          <div className="a-kitgrid">
            {d.godowns.map((g) => (
              <div key={g.godown_id} className={`a-card a-kitcard${g.is_active ? '' : ' dim'}`}>
                <div className="a-kh">
                  <span className="a-thumb2"><LIcon name="warehouse" /></span>
                  <div><b>{g.name}</b><span className="a-kh-sub">Code {g.code} · {g.state}{g.works_at ? ' · you work here' : ''}</span></div>
                  <span className="a-sp" />
                  <Pill tone={g.is_active ? 'good' : 'gray'}>{g.is_active ? 'Open' : 'Closed'}</Pill>
                </div>
                <dl className="a-kv a-kvs">
                  <dt>Address</dt><dd>{g.address || '-'}</dd>
                  <dt>Phone</dt><dd>{g.phone || '-'}</dd>
                  <dt>In charge</dt><dd>{g.in_charge_name || '-'}</dd>
                  <dt>GSTIN</dt><dd>{g.gstin || (g.state === d.company_state ? 'Company GSTIN' : <span className="a-bad">Needed, another state</span>)}</dd>
                  <dt>Staff</dt><dd>{g.people} {g.people === 1 ? 'person' : 'people'} can work here</dd>
                  <dt>Holds</dt><dd>{Number(g.packs).toLocaleString('en-IN')} packs · {g.open_orders} open order{g.open_orders === 1 ? '' : 's'}</dd>
                  <dt>Next invoice</dt><dd><code>{g.next_invoice}</code></dd>
                </dl>
                {d.can_edit && (
                  <div className="a-kfoot">
                    <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setOpen(g.godown_id)}>Change</button>
                    <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => toggle(g)}>{g.is_active ? 'Close this godown' : 'Open again'}</button>
                  </div>
                )}
                {!d.can_edit && <div className="a-kfoot"><button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setOpen(g.godown_id)}>Open</button></div>}
              </div>
            ))}
          </div>
        )}
      </Loading>
      <p className="a-hint-s">Watch who can see a new godown: people on &quot;Every godown&quot; get it straight away; people with ticked godowns do not, until somebody ticks it for them in Staff.</p>
      {open && d && (
        <GodownDrawer key={open} meta={d} staff={(staff.data && staff.data.staff) || []} godown={open === 'new' ? null : d.godowns.find((g) => g.godown_id === open)}
          onClose={() => setOpen(null)} onSaved={(text) => { setOpen(null); act.setMsg({ kind: 'ok', text }); data.reload(); }} />
      )}
    </section>
  );
}

function GodownDrawer({ meta, staff, godown, onClose, onSaved }) {
  const act = useAction();
  const confirm = useConfirm();
  const creating = !godown;
  const canEdit = meta.can_edit;
  const start = { code: godown ? godown.code : '', name: godown ? godown.name : '', address: godown ? godown.address || '' : '', state: godown ? godown.state : meta.company_state,
    gstin: godown ? godown.gstin || '' : '', in_charge: godown ? godown.in_charge || '' : '', phone: godown ? godown.phone || '' : '' };
  const [f, setF] = useState(start);
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v ?? '' }));
  const save = () => act.run(async () => {
    if (creating) { const r = await api.send('POST', '/godowns', f); onSaved(r.message); } else { await api.send('PUT', `/godowns/${godown.godown_id}`, f); onSaved(`${f.name} saved`); }
  });
  const toggle = async () => {
    const closing = godown.is_active;
    if (closing && !(await confirm({ title: `Close ${godown.name}?`, message: 'Nothing new can be made there. It stays on record and can be reopened.', action: 'Close godown', danger: true }))) return;
    act.run(async () => { await api.send('PUT', `/godowns/${godown.godown_id}`, { is_active: closing ? 0 : 1 }); onSaved(`${godown.name} ${closing ? 'closed' : 'reopened'}`); });
  };
  const people = staff.filter((p) => p.active);
  return (
    <Drawer title={creating ? 'New godown' : godown.name} sub={creating ? undefined : `Code ${godown.code}`} onClose={onClose} dirty={canEdit && dirty}
      status={!creating && <><Pill tone={godown.is_active ? 'good' : 'gray'}>{godown.is_active ? 'Open' : 'Closed'}</Pill><span className="a-custhead">{godown.packs} packs · {godown.open_orders} open order(s) · {godown.people} people</span></>}
      footer={canEdit ? (
        <>
          <button type="button" className="a-btn" disabled={act.busy || !dirty} onClick={save}>{creating ? 'Add the godown' : 'Save'}</button>
          {!creating && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={toggle}>{godown.is_active ? 'Close this godown' : 'Reopen'}</button>}
        </>
      ) : null}>
      {act.note}
      {!canEdit && <Notice kind="info">View only: changing godowns needs Edit on Settings.</Notice>}
      <div className="a-grid2">
        <Field def={{ name: 'code', label: 'Code', required: true, help: 'Goes into its document numbers, e.g. C', locked: !canEdit }} value={f.code} onChange={(v) => set('code')(String(v).toUpperCase())} />
        <Field def={{ name: 'name', label: 'Name', required: true, locked: !canEdit }} value={f.name} onChange={set('name')} />
        <Field def={{ name: 'address', label: 'Address', wide: true, locked: !canEdit }} value={f.address} onChange={set('address')} />
        <Field def={{ name: 'state', label: 'State', type: 'select', options: meta.states, allowEmpty: false, locked: !canEdit }} value={f.state} onChange={set('state')} />
        <Field def={{ name: 'gstin', label: 'GSTIN', info: 'Needed for a godown in another state than the company. It starts with that state\'s code (Tamil Nadu 33, Karnataka 29...).', locked: !canEdit }}
          value={f.gstin} onChange={(v) => set('gstin')(String(v).toUpperCase())} />
        <Field def={{ name: 'in_charge', label: 'Person in charge', type: 'select', options: people.map((p) => ({ value: p.emp_id, label: `${p.name} (${p.role_name})` })), locked: !canEdit }}
          value={f.in_charge} onChange={set('in_charge')} />
        <Field def={{ name: 'phone', label: 'Phone', locked: !canEdit }} value={f.phone} onChange={set('phone')} />
      </div>
    </Drawer>
  );
}
