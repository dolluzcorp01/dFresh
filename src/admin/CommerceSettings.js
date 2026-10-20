// Setup > Commerce settings (docs/COMMERCE-SPEC.md 3): every commerce value with its default, grouped like the site
// Settings page; the 6 values sir still has to decide carry "To be confirmed". A typed value is pending (row
// highlighted, Save / Cancel) until saved; every save is audited. The lists (customer types, return reasons, delivery
// methods and areas, stock locations) are edited in their own tables. A role with only "view" on Settings sees it all,
// greyed out.
import { useState } from 'react';
import { api } from './adminApi';
import { Drawer, InfoCard, Loading, Notice, fmtDate, useAction, useCan, useConfirm, useLeaveGuard, useLoad } from './ui';

// groups in this order; a list is shown after the group named next to it
const ORDER = ['General', 'Orders and pricing', 'Inventory', 'Returns', 'Delivery', 'Invoice', 'Numbering', 'GST and compliance', 'Payments', 'Notifications', 'Accounting', 'Approvals'];
const LISTS_AFTER = { 'Orders and pricing': ['customer_types'], Inventory: ['locations'], Returns: ['return_reasons'], Delivery: ['delivery_methods', 'delivery_areas'] };

export default function CommerceSettings() {
  const data = useLoad('/commerce-settings');
  const canEdit = useCan('settings', 'edit');
  const act = useAction();
  const [pending, setPending] = useState({});
  useLeaveGuard(Object.keys(pending).length > 0);
  const d = data.data;
  const set = (row, v) => setPending((p) => { const n = { ...p }; if (v === row.value) delete n[row.setting_key]; else n[row.setting_key] = v; return n; });
  const drop = (key) => setPending((p) => { const n = { ...p }; delete n[key]; return n; });
  const save = (row) => act.run(async () => {
    await api.send('PUT', `/commerce-settings/${row.setting_key}`, { value: pending[row.setting_key] });
    drop(row.setting_key);
    data.reload();
  }, `${row.label}: saved`);
  const groups = d ? ORDER.map((g) => [g, d.settings.filter((s) => s.grp === g)]).filter(([, rows]) => rows.length) : [];
  const tbc = d ? d.settings.filter((s) => s.tbc).length : 0;

  return (
    <section>
      <h1>Commerce settings</h1>
      <InfoCard title="How the back office behaves">
        <ul>
          <li>Every value here has a sensible default; change one and Save. Each change is in the audit log.</li>
          <li><span className="a-status a-status-test">To be confirmed</span> marks the {tbc} values sir still has to decide: they work with a placeholder until then.</li>
          <li>While the seller GSTIN is a placeholder, every invoice is marked &quot;DEMO - not a tax invoice&quot;.</li>
        </ul>
      </InfoCard>
      {act.note}
      {!canEdit && <Notice kind="info">Read only: your role can view Commerce settings but not change them.</Notice>}
      <Loading state={data}>
        {d && (
          <fieldset className="a-plainset" disabled={!canEdit}>
            {d.invoiceDemo && <Notice kind="warn">The seller GSTIN is still a placeholder: invoices show &quot;DEMO - not a tax invoice&quot; (Invoice group below).</Notice>}
            <div className="a-stats">
              <div className="a-stat"><b>{d.numbers.invoice}</b><span>next invoice (financial year {d.numbers.fy})</span></div>
              <div className="a-stat"><b>{d.numbers.creditNote}</b><span>first credit note this year</span></div>
              <div className="a-stat"><b>{d.numbers.order}</b><span>order numbers</span></div>
              <div className="a-stat"><b>{d.numbers.ret}</b><span>return numbers</span></div>
            </div>
            {groups.map(([g, rows]) => (
              <div key={g} id={`group-${g.replace(/\s+/g, '-')}`}>
                <div className="a-scroll">
                  <table className="a-table a-settings a-csettings">
                    <tbody>
                      <tr className="a-group"><th colSpan={3}>{g}</th></tr>
                      {rows.map((row) => (
                        <SettingRow key={row.setting_key} row={row} roles={d.roles} value={row.setting_key in pending ? pending[row.setting_key] : row.value}
                          pending={row.setting_key in pending} busy={act.busy} onChange={(v) => set(row, v)} onSave={() => save(row)} onCancel={() => drop(row.setting_key)} />
                      ))}
                    </tbody>
                  </table>
                </div>
                {(LISTS_AFTER[g] || []).map((k) => <ListEditor key={k} listKey={k} list={d.lists[k]} onChanged={data.reload} canEdit={canEdit} />)}
              </div>
            ))}
          </fieldset>
        )}
      </Loading>
    </section>
  );
}

function SettingRow({ row, roles, value, pending, busy, onChange, onSave, onCancel }) {
  let control;
  if (row.value_type === 'bool') {
    const on = value === '1';
    control = (
      <span className="a-switch-row">
        <button type="button" role="switch" aria-checked={on} aria-label={row.label} className="a-switch" onClick={() => onChange(on ? '0' : '1')}>
          <span className="a-switch-knob" aria-hidden="true" />
        </button>
        <strong>{on ? 'On' : 'Off'}</strong>
      </span>
    );
  } else if (row.value_type === 'select') {
    control = <select value={value} aria-label={row.label} onChange={(e) => onChange(e.target.value)}>{row.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  } else if (row.value_type === 'roles') {
    let ids = [];
    try { ids = JSON.parse(value); } catch { ids = []; }
    control = (
      <span className="a-rolepick">
        {roles.map((r) => (
          <label key={r.role_id} className="a-inline"><input type="checkbox" checked={ids.includes(r.role_id)}
            onChange={(e) => onChange(JSON.stringify(e.target.checked ? [...ids, r.role_id].sort((a, b) => a - b) : ids.filter((x) => x !== r.role_id)))} /> {r.name}</label>
        ))}
      </span>
    );
  } else {
    control = <input type={row.value_type === 'text' ? 'text' : 'number'} min={row.value_type === 'text' ? undefined : 0} step={row.value_type === 'decimal' ? '0.01' : '1'}
      value={value} aria-label={row.label} onChange={(e) => onChange(e.target.value)} className={row.value_type === 'text' ? 'a-wide' : 'a-price'} />;
  }
  return (
    <tr id={`cs-${row.setting_key}`} className={pending ? 'a-pending' : undefined}>
      <td className="a-cs-label"><b>{row.label}</b>{row.tbc && <span className="a-status a-status-test a-tbp">To be confirmed</span>}
        {row.help && <small className="a-muted a-person-sub">{row.help}</small>}</td>
      <td className="a-set-val">{control}
        {row.updated_by && !pending && <small className="a-muted">Changed {fmtDate(row.updated_at)} by {row.updated_by}</small>}</td>
      <td>{pending && (
        <span className="a-pending-btns">
          <button type="button" className="a-btn a-btn-sm" disabled={busy} onClick={onSave}>Save</button>
          <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={busy} onClick={onCancel}>Cancel</button>
        </span>
      )}</td>
    </tr>
  );
}

function ListEditor({ listKey, list, onChanged, canEdit }) {
  const [open, setOpen] = useState(null); // row | 'new'
  const canCreate = useCan('settings', 'create');
  const cols = Object.entries(list.cols);
  const show = (row, col, def) => (def.type === 'bool' ? (Number(row[col]) ? 'Yes' : 'No') : row[col] === null || row[col] === undefined || row[col] === '' ? '-' : String(row[col]));
  return (
    <div className="a-card a-listed">
      <div className="a-listed-head"><h3>{list.label}</h3>{canCreate && <button type="button" className="a-btn a-btn-sm" onClick={() => setOpen('new')}>Add</button>}</div>
      <div className="a-scroll">
        <table className="a-table">
          <thead><tr>{cols.map(([c, def]) => <th key={c}>{def.label}</th>)}</tr></thead>
          <tbody>
            {list.rows.map((r) => (
              <tr key={r[list.pk]} className={`a-rowlink${Number(r.is_active) === 0 ? ' a-off' : ''}`} tabIndex={0} onClick={() => setOpen(r)} onKeyDown={(e) => e.key === 'Enter' && setOpen(r)}>
                {cols.map(([c, def]) => <td key={c}>{show(r, c, def)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <ListRowDrawer listKey={listKey} list={list} row={open === 'new' ? null : open} canEdit={canEdit} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); onChanged(); }} />}
    </div>
  );
}

function ListRowDrawer({ listKey, list, row, canEdit, onClose, onSaved }) {
  const act = useAction();
  const confirm = useConfirm();
  const creating = !row;
  const canDelete = useCan('settings', 'delete') && !creating;
  const canCreate = useCan('settings', 'create');
  const may = creating ? canCreate : canEdit;
  const blank = Object.fromEntries(Object.entries(list.cols).map(([c, def]) => [c, def.type === 'bool' ? 1 : '']));
  const [f, setF] = useState(() => (row ? Object.fromEntries(Object.keys(list.cols).map((c) => [c, row[c] ?? ''])) : blank));
  const [errors, setErrors] = useState({});
  const id = row ? row[list.pk] : null;
  const save = () => act.run(async () => {
    try {
      if (creating) await api.send('POST', `/commerce-settings/lists/${listKey}`, f);
      else await api.send('PUT', `/commerce-settings/lists/${listKey}/${encodeURIComponent(id)}`, f);
      onSaved();
    } catch (e) {
      if (e.data && e.data.code === 'fields') { setErrors(e.data.fields || {}); return; }
      throw e;
    }
  });
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${row.label || row.name}?`, message: 'Switching it off keeps it for old orders; deleting removes it for good.', action: 'Delete', danger: true }))) return;
    act.run(async () => { await api.send('DELETE', `/commerce-settings/lists/${listKey}/${encodeURIComponent(id)}`); onSaved(); });
  };
  return (
    <Drawer title={creating ? `Add to ${list.label}` : `${list.label}: ${row.label || row.name}`} onClose={onClose}
      footer={may || canDelete ? (
        <>
          {may && <button type="button" className="a-btn" disabled={act.busy} onClick={save}>{creating ? 'Add' : 'Save'}</button>}
          {canDelete && <button type="button" className="a-btn a-btn-danger" disabled={act.busy} onClick={remove}>Delete</button>}
        </>
      ) : null}>
      {act.note}
      <div className="a-grid2">
        {Object.entries(list.cols).map(([c, def]) => (c === list.pk && !creating ? null : (
          <label className="a-field" key={c}><span>{def.label}{def.req ? ' *' : ''}</span>
            {def.type === 'bool'
              ? <select value={String(Number(f[c]) ? 1 : 0)} disabled={!may} onChange={(e) => setF({ ...f, [c]: Number(e.target.value) })}><option value="1">Yes</option><option value="0">No</option></select>
              : <input value={f[c]} disabled={!may} inputMode={def.type === 'text' || def.type === 'key' ? undefined : 'decimal'} onChange={(e) => { setF({ ...f, [c]: e.target.value }); setErrors({ ...errors, [c]: undefined }); }} />}
            {errors[c] && <small className="a-bad" role="alert">{errors[c]}</small>}
          </label>
        )))}
      </div>
    </Drawer>
  );
}
