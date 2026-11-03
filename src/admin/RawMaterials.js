// Masters > Catalogue > Raw materials (phase 14, v23 viewRaw; API /catalogue/raw in catalogue.js): SKUs that are bought,
// never sold and never on the website. The list (code, name, what it is counted in, stock in the godown picked in the
// header, else all), "New raw material" (code RM-..., name, unit) which then opens the SKU panel (Pack, Stock, Barcodes,
// Tax). A row opens the same SKU panel. ?sku=RM-GLUE opens one.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { DISCARD, Drawer, LIcon, Loading, PageHead, Pill, useAction, useAdmin, useCan, useConfirm, useLoad, useToast } from './ui';
import { savedGodown } from './HeaderBar';
import SkuDrawer, { Fld, PIcon, RawThumb, StatusPill, fid } from './SkuDrawer';

export default function RawMaterials() {
  const data = useLoad('/catalogue/raw');
  const { me } = useAdmin();
  const canEdit = useCan('products', 'edit');
  const canCreate = useCan('products', 'create');
  const toast = useToast();
  // query params by useLocation (not useSearchParams: that would pull more router code into the public bundle)
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const setParams = () => navigate({ pathname: location.pathname, search: '' }, { replace: true });
  const [open, setOpen] = useState(null); // sku code | 'new'
  const gid = savedGodown(me);
  const gname = gid ? (((me && me.godown_list) || []).find((g) => Number(g.godown_id) === gid) || {}).name || 'All godowns' : 'All godowns';
  const d = data.data;
  const rows = (d && d.rows) || [];
  const skuParam = params.get('sku');
  useEffect(() => { if (skuParam) setOpen(skuParam.toUpperCase()); }, [skuParam]);
  const close = () => { setOpen(null); if (skuParam) setParams({}, { replace: true }); };
  const stock = (r) => Number((r.stock || {})[gid || 'all']) || 0;

  return (
    <section className="p14">
      <PageHead title="Raw materials" sub="What production uses: bought, never sold"
        actions={canCreate && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New raw material</button>} />
      {!canEdit && (
        <div className="a-alert a-alert-info" role="status"><PIcon name="eye" /><div className="a-alert-tx"><b>View only.</b> {(me && me.role_name) || 'Your role'} can see Products but not change them. Rights come from the role in Foundation (section 0).</div></div>
      )}
      <div className="a-alert a-alert-info" role="status"><LIcon name="info" /><div className="a-alert-tx"><b>Bought, never sold.</b> Raw materials are SKUs that never show on the website. Production (section 4) turns them into packs.</div></div>
      <Loading state={data}>
        <div className="a-listcard">
          <div className="p14-count"><span><b>{rows.length}</b> raw materials</span><span className="p14-sp" /><span>Stock: {gname}</span></div>
          {rows.length ? (
            <div className="a-tw p14-tw">
              <table className="a-table a-hover p14-t">
                <thead><tr><th>Code</th><th>Name</th><th className="a-hide-sm">Counted in</th><th className="a-hide-sm">HSN</th><th className="a-num">Stock</th><th className="p14-st">Status</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sku_code} className="a-rowlink" tabIndex={0} onClick={() => setOpen(r.sku_code)} onKeyDown={(e) => { if (e.key === 'Enter') setOpen(r.sku_code); }}>
                      <td className="p14-pc"><span className="p14-prow"><RawThumb /><span className="a-mono">{r.sku_code}</span></span></td>
                      <td><b>{r.name}</b><small className="a-sub-l p14-show-sm">{r.unit}</small></td>
                      <td className="a-hide-sm">{r.unit || r.unit_code}</td>
                      <td className="a-hide-sm">-</td>
                      <td className="a-num">{stock(r)}</td>
                      <td className="p14-st"><span className="p14-pills"><StatusPill status={r.status} label={r.status_label} />{r.status === 'active' && !r.ready && <Pill tone="bad" title="Set its weight first">Not ready</Pill>}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="a-empty"><div className="a-empty-ic"><LIcon name="package" size="lg" /></div><h3>No raw material yet</h3><p>Add the glue, cores and wrap that production uses.</p></div>
          )}
        </div>
      </Loading>
      {open === 'new' && d && (
        <NewRaw units={d.units || []} onClose={close}
          onCreated={(r) => { data.reload(); toast('good', `${r.sku_code} added`, r.message); setOpen(r.sku_code); }} />
      )}
      {open && open !== 'new' && <SkuDrawer key={open} code={open} onClose={close} onSaved={data.reload} />}
    </section>
  );
}

function NewRaw({ units, onClose, onCreated }) {
  const act = useAction();
  const confirm = useConfirm();
  const empty = { sku_code: '', name: '', unit_code: units[0] ? units[0].unit_code : '' };
  const [f, setF] = useState(empty);
  const [errs, setErrs] = useState({});
  const dirty = f.sku_code !== '' || f.name !== '' || f.unit_code !== empty.unit_code;
  useEffect(() => {
    setErrs(act.fields || {});
    const k = Object.keys(act.fields || {})[0];
    if (k) setTimeout(() => { const el = document.getElementById(fid(`rm.${k}`)); if (el) el.focus(); }, 0);
  }, [act.fields]);
  const set = (k, v) => { setF({ ...f, [k]: v }); if (errs[k]) { const n = { ...errs }; delete n[k]; setErrs(n); if (!Object.keys(n).length) act.setMsg(null); } };
  const add = () => act.run(async () => onCreated(await api.send('POST', '/catalogue/raw', { ...f, sku_code: f.sku_code.trim().toUpperCase(), name: f.name.trim() })));
  const cancel = async () => { if (dirty && !(await confirm(DISCARD))) return; onClose(); };
  return (
    <Drawer title="New raw material" onClose={onClose} dirty={dirty} thumb={<LIcon name="package" />}
      footer={<><span className="a-sp p14-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={cancel}>Cancel</button>
        <button type="button" className="a-btn" disabled={!dirty || act.busy} onClick={add}><LIcon name="check" size="sm" />Add</button></>}>
      {act.note}
      <div className="p14-form">
        <Fld k="rm.sku_code" label="Code" req error={errs.sku_code} hint="RM- and 2 to 10 letters or digits. Never changes.">
          <input id={fid('rm.sku_code')} placeholder="RM-GLUE" maxLength={13} value={f.sku_code} onChange={(e) => set('sku_code', e.target.value.toUpperCase())} />
        </Fld>
        <Fld k="rm.name" label="Name" req error={errs.name}>
          <input id={fid('rm.name')} placeholder="Core glue" maxLength={60} value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Fld>
        <Fld k="rm.unit_code" label="Counted in" req error={errs.unit_code}>
          <select id={fid('rm.unit_code')} value={f.unit_code} onChange={(e) => set('unit_code', e.target.value)}>
            {!units.length && <option value="">No unit yet</option>}
            {units.map((u) => <option key={u.unit_code} value={u.unit_code}>{u.name}</option>)}
          </select>
        </Fld>
      </div>
    </Drawer>
  );
}
