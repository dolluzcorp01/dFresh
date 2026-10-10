// Banners, Kits, Towns, Categories, Size picker, Form options (spec F 6-7): one list + editor per section,
// driven by the definitions below (they mirror backend admin-entities.js). Banners also take desktop / mobile
// photo uploads and drag-and-drop order; kits take their product list.
import { useMemo, useState } from 'react';
import { api, rowId } from './adminApi';
import { mediaUrl } from '../utils/api';
import { Drawer, Field, Loading, TrEditor, useAction, useCan, useLoad } from './ui';

const ACTIVE = { name: 'is_active', label: 'Active', type: 'bool' };
const ORDER = { name: 'sort_order', label: 'Order', type: 'number', step: '1' };

const SECTIONS = {
  banners: {
    title: 'Banners', keys: ['banner_key'], reorder: true,
    fields: [
      { name: 'banner_key', label: 'Key', required: true, keyField: true }, ORDER,
      { name: 'theme', label: 'Theme', type: 'select', options: ['light', 'dark'], allowEmpty: false, help: 'dark = gold button on a dark photo' },
      { name: 'cta_action', label: 'Button action', type: 'select', options: ['products', 'products_home', 'products_category', 'section', 'form'], allowEmpty: false },
      { name: 'cta_target', label: 'Button target', help: 'category key, section id or form type' },
      { name: 'note', label: 'Internal note', wide: true }, ACTIVE,
    ],
    tr: [{ name: 'headline', label: 'Headline', required: true, long: true }, { name: 'cta_label', label: 'Button label', required: true }],
    list: (r) => [r.banner_key, r.tr.en && r.tr.en.headline, r.theme, `${r.cta_action}${r.cta_target ? `: ${r.cta_target}` : ''}`],
    head: ['Key', 'Headline (EN)', 'Theme', 'Button'],
    defaults: { theme: 'light', cta_action: 'products', is_active: 0 },
  },
  kits: {
    title: 'Business kits', keys: ['kit_key'], reorder: true,
    fields: [
      { name: 'kit_key', label: 'Key', required: true, keyField: true }, ORDER,
      { name: 'business_type', label: 'Business type (prefills the quote form)', type: 'select', lookup: 'businessTypes', allowEmpty: false },
      { name: 'rep_product_id', label: 'Photo from product', type: 'select', lookup: 'products' }, ACTIVE,
    ],
    tr: [{ name: 'name', label: 'Name', required: true }, { name: 'tagline', label: 'Tagline', required: true }],
    links: 'products',
    list: (r) => [r.kit_key, r.tr.en && r.tr.en.name, r.business_type, r.products.join(', ')],
    head: ['Key', 'Name (EN)', 'Business type', 'Products'],
    defaults: { is_active: 1, products: [] },
  },
  towns: {
    title: 'Towns', keys: ['town_key'], reorder: true,
    fields: [
      { name: 'town_key', label: 'Key', required: true, keyField: true }, ORDER, { name: 'is_base', label: 'Godown base', type: 'bool' },
      { name: 'map_x', label: 'Map x (0-600)', type: 'number', step: '1' }, { name: 'map_y', label: 'Map y (0-360)', type: 'number', step: '1' },
      { name: 'lat', label: 'Latitude', type: 'number' }, { name: 'lng', label: 'Longitude', type: 'number' }, ACTIVE,
    ],
    tr: [{ name: 'name', label: 'Name', required: true }],
    list: (r) => [r.town_key, r.tr.en && r.tr.en.name, r.is_base ? 'base' : '', r.map_x !== null ? `${r.map_x}, ${r.map_y}` : ''],
    head: ['Key', 'Name (EN)', 'Base', 'Map'],
    defaults: { is_active: 1 },
  },
  categories: {
    title: 'Categories', keys: ['category_key'], reorder: true,
    fields: [{ name: 'category_key', label: 'Key', required: true, keyField: true }, ORDER, { name: 'rep_product_id', label: 'Photo from product', type: 'select', lookup: 'products' }, ACTIVE],
    tr: [{ name: 'name', label: 'Name', required: true }],
    list: (r) => [r.category_key, r.tr.en && r.tr.en.name, r.rep_product_id],
    head: ['Key', 'Name (EN)', 'Photo from'],
    defaults: { is_active: 1 },
  },
  'size-picker': {
    title: 'Size picker (Try it)', keys: ['position'],
    fields: [
      { name: 'position', label: 'Position', type: 'number', step: '1', required: true, keyField: true },
      { name: 'product_id', label: 'Product', type: 'select', lookup: 'products', allowEmpty: false },
      { name: 'size_label', label: 'Size label', required: true, help: 'e.g. 30×30' },
      { name: 'scale', label: 'Drawing scale (0-1)', type: 'number', step: '0.01' }, { name: 'is_default', label: 'Selected first', type: 'bool' },
    ],
    list: (r) => [r.position, r.product_id, r.size_label, r.scale, r.is_default ? 'default' : ''],
    head: ['Position', 'Product', 'Label', 'Scale', ''],
    defaults: { scale: 0.5 },
  },
  'form-options': {
    title: 'Form options', keys: ['list_key', 'option_value'],
    fields: [
      { name: 'list_key', label: 'List', type: 'select', options: ['business_type', 'monthly_sales', 'yes_no'], allowEmpty: false, keyField: true },
      { name: 'option_value', label: 'Stored value', required: true, keyField: true, help: 'saved in leads; never change it once used' }, ORDER, ACTIVE,
    ],
    tr: [{ name: 'label', label: 'Label', required: true }],
    list: (r) => [r.list_key, r.option_value, r.tr.en && r.tr.en.label],
    head: ['List', 'Value', 'Label (EN)'],
    defaults: { is_active: 1, list_key: 'business_type' },
  },
};

export default function EntityPage({ name }) {
  const cfg = SECTIONS[name];
  const list = useLoad(`/${name}`);
  const products = useLoad(cfg.fields.some((f) => f.lookup === 'products') || cfg.links ? '/products' : null);
  const options = useLoad(cfg.fields.some((f) => f.lookup === 'businessTypes') ? '/form-options' : null);
  const canEdit = useCan('editor');
  const act = useAction();
  const [open, setOpen] = useState(null);
  const [drag, setDrag] = useState(null);

  const lookups = useMemo(() => ({
    products: (products.data || []).map((p) => ({ value: p.product_id, label: `${p.product_id} ${p.tr.en ? p.tr.en.name : ''}` })),
    businessTypes: (options.data || []).filter((o) => o.list_key === 'business_type').map((o) => o.option_value),
  }), [products.data, options.data]);

  const drop = (target) => {
    if (!drag || drag === target) return;
    const ids = list.data.map((r) => rowId(cfg.keys, r));
    const from = ids.indexOf(drag);
    ids.splice(ids.indexOf(target), 0, ids.splice(from, 1)[0]);
    setDrag(null);
    act.run(async () => { await api.send('POST', `/${name}/reorder`, { order: ids.map(decodeURIComponent) }); list.reload(); }, 'Order saved');
  };

  return (
    <section>
      <h1>{cfg.title}</h1>
      <div className="a-toolbar">
        {canEdit && <button type="button" className="a-btn" onClick={() => setOpen({ create: true })}>Add</button>}
        {cfg.reorder && canEdit && <span className="a-muted">Drag rows to change the order.</span>}
      </div>
      {act.note}
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table a-hover">
            <thead><tr>{cfg.reorder && <th />}{cfg.head.map((h) => <th key={h}>{h}</th>)}<th>Active</th><th>Languages</th></tr></thead>
            <tbody>
              {(list.data || []).map((r) => {
                const id = rowId(cfg.keys, r);
                return (
                  <tr key={id} className={r.is_active === 0 ? 'a-off' : ''} onClick={() => setOpen({ id })} tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setOpen({ id })}
                    draggable={cfg.reorder && canEdit} onDragStart={() => setDrag(id)} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(id)}>
                    {cfg.reorder && <td className="a-handle" aria-hidden="true">⠿</td>}
                    {cfg.list(r).map((v, i) => <td key={i}>{v === null || v === undefined ? '' : String(v)}</td>)}
                    <td>{r.is_active === undefined ? '' : r.is_active ? 'Yes' : 'No'}</td>
                    <td>{r.tr ? Object.keys(r.tr).join(' ') : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Loading>
      {open && (
        <Editor name={name} cfg={cfg} id={open.id} lookups={lookups} onClose={() => setOpen(null)}
          onSaved={(id) => { list.reload(); setOpen(id ? { id } : null); }} />
      )}
    </section>
  );
}

function Editor({ name, cfg, id, lookups, onClose, onSaved }) {
  const loaded = useLoad(id ? `/${name}/${id}` : null);
  const canEdit = useCan('editor');
  const act = useAction();
  const [draft, setDraft] = useState(null);
  const creating = !id;
  const row = draft || (creating ? { tr: {}, ...cfg.defaults } : loaded.data);
  const set = (k, v) => setDraft({ ...row, [k]: v });

  const save = () => act.run(async () => {
    const saved = creating ? await api.send('POST', `/${name}`, row) : await api.send('PUT', `/${name}/${id}`, row);
    setDraft(null);
    if (!creating) loaded.setData(saved);
    onSaved(creating ? rowId(cfg.keys, saved) : null);
  }, 'Saved');
  const remove = () => window.confirm('Delete this row? This cannot be undone.') && act.run(async () => {
    await api.send('DELETE', `/${name}/${id}`);
    onSaved(null);
  });
  const uploadBanner = (kind, file) => act.run(async () => {
    const r = await api.upload(`/${name}/${id}/image?kind=${kind}`, file);
    loaded.reload();
    return r;
  }, `${kind} photo saved`);

  if (!creating && !loaded.data) return <Drawer title={cfg.title} onClose={onClose}><Loading state={loaded}>{null}</Loading></Drawer>;

  return (
    <Drawer title={creating ? `New - ${cfg.title}` : `${cfg.title}: ${decodeURIComponent(id).replace('~', ' / ')}`} onClose={onClose}
      footer={canEdit && (
        <>
          <button type="button" className="a-btn" onClick={save} disabled={act.busy}>{creating ? 'Create' : 'Save'}</button>
          {!creating && <button type="button" className="a-btn a-btn-danger" onClick={remove} disabled={act.busy}>Delete</button>}
        </>
      )}>
      {act.note}
      <div className="a-grid2">
        {cfg.fields.map((f) => {
          const def = { ...f, type: f.keyField && !creating ? 'readonly' : f.type, options: f.lookup ? lookups[f.lookup] : f.options };
          return <Field key={f.name} def={def} value={row[f.name]} disabled={!canEdit} onChange={(v) => set(f.name, v)} />;
        })}
      </div>
      {cfg.links && (
        <label className="a-field a-wide"><span>Products (in order)</span>
          <select multiple size={8} disabled={!canEdit} value={row.products || []}
            onChange={(e) => set('products', [...e.target.selectedOptions].map((o) => o.value))}>
            {lookups.products.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <small className="a-muted">Ctrl / Cmd + click to pick several.</small>
        </label>
      )}
      {cfg.tr && (
        <>
          <h3>Text per language</h3>
          <TrEditor fields={cfg.tr} tr={row.tr || {}} disabled={!canEdit} onChange={(tr) => set('tr', tr)} />
        </>
      )}
      {name === 'banners' && !creating && (
        <>
          <h3>Photos (text-free)</h3>
          <div className="a-photos">
            {[['desktop', '1920x800'], ['mobile', '1080x1350']].map(([kind, size]) => (
              <figure key={kind}>
                {row[`${kind}_file`] ? <img src={mediaUrl(`/media/banners/${kind}/${row[`${kind}_file`]}`)} alt={`${kind} banner`} className={`a-banner-${kind}`} /> : <p className="a-bad">No {kind} photo</p>}
                <figcaption>{kind} ({size})
                  {canEdit && (
                    <label className="a-btn a-btn-sm a-btn-ghost a-file">Upload
                      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) uploadBanner(kind, f); }} />
                    </label>
                  )}
                </figcaption>
              </figure>
            ))}
          </div>
        </>
      )}
      {name === 'banners' && creating && <p className="a-muted">Create the banner first, then upload both photos and switch it on.</p>}
    </Drawer>
  );
}
