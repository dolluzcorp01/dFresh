// Masters > Tax and units > Units of measure (phase 14, v23 viewUnits; API /catalogue/units in catalogue.js): every
// unit with its code and how many SKUs use it. Add a unit in the row at the bottom (a name and a code of 2 to 12 small
// letters); remove one that nothing uses (asks first). A unit in use is refused by the server with the reason
// ("Cannot remove Kilogram: it is used by 1 SKU (raw materials are counted in it)."), shown as a red toast.
import { useState } from 'react';
import { api } from './adminApi';
import { PIcon } from './SkuDrawer';
import { Alert, LIcon, Loading, PageHead, Table, useAdmin, useCan, useConfirm, useLoad, useToast } from './ui';

/** "Cannot remove X: it is used..." -> ['Cannot remove X', 'It is used...'] (v23 toast: title, then the reason) */
export function splitMsg(m, fallback) {
  const s = String(m || '');
  const i = s.indexOf(': ');
  return i > 0 && i < 70 ? [s.slice(0, i), s.charAt(i + 2).toUpperCase() + s.slice(i + 3)] : [fallback, s];
}

export default function Units() {
  const data = useLoad('/catalogue/units');
  const { me } = useAdmin();
  const canEdit = useCan('products', 'edit');
  const canCreate = useCan('products', 'create');
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const rows = data.data || [];

  const run = async (fn, badTitle) => {
    setBusy(true);
    try { await fn(); } catch (e) { const [t, x] = splitMsg(e.message, badTitle); toast('bad', t, x); } finally { setBusy(false); }
  };
  const add = (e) => {
    e.preventDefault();
    run(async () => {
      const out = await api.send('POST', '/catalogue/units', { name: name.trim(), unit_code: code.trim().toLowerCase() });
      toast('good', 'Unit added', name.trim());
      setName(''); setCode('');
      data.reload();
      return out;
    }, 'Not added');
  };
  const remove = async (u) => {
    // a unit in use: the server says why (one message, no question first); else ask before removing
    if (!u.used && !(await confirm({ title: `Remove the unit ${u.name}?`, message: 'Nothing uses it, so nothing else changes.', action: 'Remove', danger: true }))) return;
    run(async () => {
      await api.send('DELETE', `/catalogue/units/${encodeURIComponent(u.unit_code)}`);
      toast('good', 'Unit removed', u.name);
      data.reload();
    }, `Cannot remove ${u.name}`);
  };

  const columns = [
    { key: 'name', label: 'Unit', render: (u) => <b>{u.name}</b> },
    { key: 'unit_code', label: 'Code', render: (u) => <span className="a-p14-mono">{u.unit_code}</span> },
    { key: 'used', label: 'Used by', num: true },
    { key: 'act', label: <span className="a-sr">Remove</span>, className: 'a-p14-act',
      render: (u) => canEdit && (
        <button type="button" className="a-iconbtn" disabled={busy} onClick={() => remove(u)} aria-label={`Remove ${u.name}`} title={`Remove ${u.name}`}>
          <PIcon name="trash-2" size="sm" />
        </button>
      ) },
  ];

  return (
    <section>
      <PageHead sub="What raw materials and packs are counted in" />
      {!canEdit && (
        <Alert tone="info" title="View only.">{me && me.role_name ? `${me.role_name} can` : 'Your role can'} see Products but not change them. Rights come from the role in Foundation (section 0).</Alert>
      )}
      <Loading state={data}>
        <div className="a-listcard">
          <div className="a-countline"><b>{rows.length}</b> units</div>
          <Table columns={columns} rows={rows} rowKey={(u) => u.unit_code} label="Units of measure" className="a-p14-units"
            empty={{ icon: 'inbox', title: 'No units yet', text: 'Add the first one below.' }} />
          {canCreate && (
            <form className="a-p14-addrow" onSubmit={add}>
              <label className="a-p14-in"><LIcon name="plus" size="sm" />
                <input value={name} maxLength={40} placeholder="Name, e.g. Dozen" aria-label="Unit name" onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="a-p14-in">
                <input value={code} maxLength={12} placeholder="code, e.g. dozen" aria-label="Unit code" onChange={(e) => setCode(e.target.value.toLowerCase())} />
              </label>
              <button type="submit" className="a-btn a-btn-ghost" disabled={busy}>Add unit</button>
            </form>
          )}
        </div>
      </Loading>
    </section>
  );
}
