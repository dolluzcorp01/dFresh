// Sales > Customers > Customer types (phase 19, v23 viewCtypes / DRAWERS.ctype; API /sales/customer-types in
// sales-routes.js). Each type belongs to one price list (none = the standard list) and gives new customers their default
// days to pay. Putting a type on another price list (a new type on any list but the standard one too) is for Accounts or
// an Admin and waits for a second person (rule cust_change); until then it buys on the list it had.
import { useState } from 'react';
import { api } from './adminApi';
import { Drawer, LIcon, Loading, PageHead, Pill, Table, useAction, useLoad, useToast } from './ui';
import { In, fieldsOf } from './buyShared';

export default function CustomerTypes() {
  const data = useLoad('/sales/customer-types');
  const [open, setOpen] = useState(null);
  const d = data.data;
  const cols = [
    { key: 'label', label: 'Type', render: (r) => <><b>{r.label}</b><small className="a-muted a-p15-sub a-mono">{r.type_key}</small></> },
    { key: 'list_name', label: 'Price list', render: (r) => <>{r.list_name}{r.on_default && <> <Pill>default</Pill></>}{r.waiting && <small className="a-p15-sub"><Pill tone="warn">List change waiting</Pill></small>}</> },
    { key: 'default_credit_days', label: 'Default days to pay', num: true, render: (r) => (r.default_credit_days ? `${r.default_credit_days} days` : 'cash') },
    { key: 'customers', label: 'Customers', num: true },
    { key: 'is_active', label: 'State', render: (r) => (r.is_active ? <Pill tone="good">In use</Pill> : <Pill>Not offered</Pill>) },
  ];
  return (
    <section>
      <PageHead sub="Each type buys on one price list" rules={['Each type belongs to one price list', 'Default days to pay for new customers', 'Same list as the website forms']}
        actions={d && d.can.edit && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New type</button>} />
      <Loading state={data}>
        {d && <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(r) => r.type_key} label="Customer types" onRowClick={(r) => setOpen(r.type_key)} /></div>}
      </Loading>
      {open && d && <TypeDrawer d={d} t={open === 'new' ? null : d.rows.find((x) => x.type_key === open)} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); data.reload(); }} />}
    </section>
  );
}

function TypeDrawer({ d, t, onClose, onSaved }) {
  const act = useAction();
  const toast = useToast();
  const def = d.lists.find((l) => l.is_default) || {};
  const start = { label: t ? t.label : '', type_key: '', list_key: t && t.list_key && t.list_key !== def.key ? t.list_key : '', default_credit_days: String(t ? t.default_credit_days : 0), is_active: t ? (t.is_active ? '1' : '0') : '1' };
  const [f, setF] = useState(start);
  const [err, setErr] = useState({});
  const set = (k) => (e) => setF((v) => ({ ...v, [k]: e.target.value }));
  const ed = d.can.edit;
  const save = () => act.run(async () => {
    setErr({});
    try {
      const out = await api.send(t ? 'PUT' : 'POST', t ? `/sales/customer-types/${t.type_key}` : '/sales/customer-types', { ...f, is_active: f.is_active === '1' });
      toast(out.waiting ? 'warn' : 'good', 'Saved', out.message); onSaved();
    } catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  return (
    <Drawer title={t ? t.label : 'New customer type'} onClose={onClose} thumb={<LIcon name="users" />} dirty={JSON.stringify(f) !== JSON.stringify(start)}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>{ed ? 'Cancel' : 'Close'}</button>{ed && <button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Save</button>}</>}>
      {act.note}
      <div className="a-grid2">
        <In label="Name *" value={f.label} error={err.label} maxLength={40} disabled={!ed} onChange={set('label')} />
        {!t && <In label="Short code *" value={f.type_key} error={err.type_key} maxLength={20} placeholder="e.g. school" hint="Lower case letters only. Never changes once saved." onChange={set('type_key')} />}
        <In label="Price list *" error={err.list_key} hint={d.can.move ? 'Moving a type moves every customer of that type to the new prices from their next order. It waits for a second person.' : 'Another list than the standard one is for Accounts or an Admin; a new type waits for their approval and buys on the standard list until then.'}>
          <select value={f.list_key} disabled={!ed} onChange={set('list_key')}><option value="">Default list ({def.name})</option>{d.lists.filter((l) => !l.is_default).map((l) => <option key={l.key} value={l.key}>{l.name}</option>)}</select></In>
        <In label="Default days to pay *" type="number" min="0" max="120" step="1" value={f.default_credit_days} error={err.default_credit_days} hint="0 = cash. Used for new customers of this type." disabled={!ed} onChange={set('default_credit_days')} />
        <In label="Offered *"><select value={f.is_active} disabled={!ed} onChange={set('is_active')}><option value="1">Yes</option><option value="0">No (existing customers keep it)</option></select></In>
      </div>
    </Drawer>
  );
}
