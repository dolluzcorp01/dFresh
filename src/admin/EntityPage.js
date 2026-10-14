// Banners, Kits, Towns, Categories, Size picker, Form options (spec F 6-7): one list + editor per section,
// driven by the definitions below (they mirror backend admin-entities.js). Banners also take desktop / mobile
// photo uploads and drag-and-drop order; kits take their product list (tick in a list, drag to order); "Photo from
// product" shows that product's main photo as soon as it is picked; towns show a live map preview (pin + name).
import { useMemo, useState } from 'react';
import { api, rowId } from './adminApi';
import { mediaUrl } from '../utils/api';
import { Drawer, Field, Loading, TrEditor, useAction, useCan, useLoad } from './ui';
import { LAND, MAP_H, MAP_W } from '../shared/mapShape';

const ACTIVE = { name: 'is_active', label: 'Active', type: 'bool' };
const ORDER = { name: 'sort_order', label: 'Order', type: 'number', step: '1' };
// Banners, kits, categories: the position is set by dragging the rows (1, 2, 3 ...; a new row goes to the end)
const POSITION = { name: 'sort_order', label: 'Position', type: 'readonly', help: 'Drag the rows in the list to change it. A new one goes to the end.' };

const SECTIONS = {
  banners: {
    title: 'Banners', keys: ['banner_key'], reorder: true,
    fields: [
      { name: 'banner_key', label: 'Key', required: true, keyField: true }, POSITION,
      { name: 'theme', label: 'Theme', type: 'select', options: ['light', 'dark'], allowEmpty: false, help: 'dark = gold button on a dark photo' },
      { name: 'cta_action', label: 'Button action', type: 'select', options: ['products', 'products_home', 'products_category', 'section', 'form'], allowEmpty: false },
      { name: 'cta_target', label: 'Button target', help: 'category key, section id or form type' },
      { name: 'note', label: 'Internal note', wide: true }, ACTIVE,
    ],
    tr: [{ name: 'headline', label: 'Headline', required: true, long: true }, { name: 'cta_label', label: 'Button label', required: true }],
    list: (r) => [r.banner_key, r.tr?.en?.headline ?? '', r.theme, `${r.cta_action ?? ''}${r.cta_target ? `: ${r.cta_target}` : ''}`],
    head: ['Key', 'Headline (EN)', 'Theme', 'Button'],
    defaults: { theme: 'light', cta_action: 'products', is_active: 0 },
  },
  kits: {
    title: 'Business kits', keys: ['kit_key'], reorder: true,
    fields: [
      { name: 'kit_key', label: 'Key', required: true, keyField: true }, POSITION,
      { name: 'business_type', label: 'Business type (prefills the quote form)', type: 'select', lookup: 'businessTypes', allowEmpty: false },
      { name: 'rep_product_id', label: 'Photo from product', type: 'select', lookup: 'products' }, ACTIVE,
    ],
    tr: [{ name: 'name', label: 'Name', required: true }, { name: 'tagline', label: 'Tagline', required: true }],
    links: 'products',
    list: (r) => [r.kit_key, r.tr?.en?.name ?? '', r.business_type, (r.products || []).join(', ')],
    head: ['Key', 'Name (EN)', 'Business type', 'Products'],
    defaults: { is_active: 1, products: [] },
  },
  towns: {
    title: 'Towns', keys: ['town_key'], reorder: true,
    fields: [
      { name: 'town_key', label: 'Key', required: true, keyField: true }, ORDER, { name: 'is_base', label: 'Godown base', type: 'bool' },
      { name: 'map_x', label: 'Map x (0-600)', type: 'number', step: '1' }, { name: 'map_y', label: 'Map y (0-360)', type: 'number', step: '1' },
      { name: 'label_dx', label: 'Name: move right (+) or left (-)', type: 'number', step: '1', help: 'map units from the pin' },
      { name: 'label_dy', label: 'Name: move down (+) or up (-)', type: 'number', step: '1', help: 'map units from the pin; -20 = just above' },
      { name: 'label_anchor', label: 'Name: which part sits at that point', type: 'select', allowEmpty: false, options: [
        { value: 'start', label: 'its start (name runs to the right)' }, { value: 'middle', label: 'its middle (centred)' },
        { value: 'end', label: 'its end (name runs to the left)' },
      ] },
      { name: 'lat', label: 'Latitude', type: 'number' }, { name: 'lng', label: 'Longitude', type: 'number' }, ACTIVE,
    ],
    tr: [{ name: 'name', label: 'Name', required: true }],
    list: (r) => [r.town_key, r.tr?.en?.name ?? '', r.is_base ? 'base' : '', r.map_x != null ? `${r.map_x}, ${r.map_y}` : ''],
    head: ['Key', 'Name (EN)', 'Base', 'Map'],
    defaults: { is_active: 1, label_dx: 0, label_dy: -20, label_anchor: 'middle' },
  },
  categories: {
    title: 'Categories', keys: ['category_key'], reorder: true,
    fields: [{ name: 'category_key', label: 'Key', required: true, keyField: true }, POSITION, { name: 'rep_product_id', label: 'Photo from product', type: 'select', lookup: 'products' }, ACTIVE],
    tr: [{ name: 'name', label: 'Name', required: true }],
    list: (r) => [r.category_key, r.tr?.en?.name ?? '', r.rep_product_id],
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
    list: (r) => [r.list_key, r.option_value, r.tr?.en?.label ?? ''],
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
    products: (products.data || []).map((p) => ({ value: p.product_id, label: `${p.product_id} ${p.tr?.en?.name ?? ''}` })),
    businessTypes: (options.data || []).filter((o) => o.list_key === 'business_type').map((o) => o.option_value),
  }), [products.data, options.data]);

  const drop = (target) => {
    if (!drag || drag === target) return;
    const ids = (list.data || []).map((r) => rowId(cfg.keys, r));
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
        <Editor name={name} cfg={cfg} id={open.id} lookups={lookups} products={products.data || []} rows={list.data || []} onClose={() => setOpen(null)}
          onSaved={(id) => { list.reload(); setOpen(id ? { id } : null); }} />
      )}
    </section>
  );
}

function Editor({ name, cfg, id, lookups, products, rows, onClose, onSaved }) {
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
          const field = <Field key={f.name} def={def} value={row[f.name]} disabled={!canEdit} onChange={(v) => set(f.name, v)} />;
          if (f.lookup !== 'products') return field;
          return <div key={f.name} className="a-repfield">{field}<RepPreview product={products.find((p) => p.product_id === row[f.name])} /></div>;
        })}
      </div>
      {name === 'towns' && <TownPreview rows={rows} town={row} />}
      {cfg.links && (
        <ProductPicker all={products} value={row.products || []} disabled={!canEdit} onChange={(v) => set('products', v)} />
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

const productName = (p) => {
  const name = p.tr?.en?.name ?? '';
  const colour = p.variant_of ? p.tr?.en?.colour_name : null; // most colour versions already carry it in the name
  return colour && !name.toLowerCase().includes(colour.toLowerCase()) ? `${name} (${colour})` : name;
};
const thumbUrl = (p) => (p && p.images && p.images[0] ? mediaUrl(`/media/products/400/${p.images[0].file_name}`) : null);
const Thumb = ({ p, size = 40 }) => (thumbUrl(p)
  ? <img className="a-thumb" src={thumbUrl(p)} alt="" width={size} height={size} style={{ width: size, height: size }} />
  : <span className="a-thumb a-thumb-none" style={{ width: size, height: size }} aria-hidden="true" />);

// "Photo from product": the picked product's main photo, from the unsaved value.
function RepPreview({ product }) {
  if (!product) return <p className="a-muted a-rep">No product picked.</p>;
  return (
    <div className="a-rep">
      <Thumb p={product} size={72} />
      <span>{thumbUrl(product) ? 'Main photo of' : 'No photo yet for'} <code>{product.product_id}</code><br />{productName(product)}</span>
    </div>
  );
}

// Kit products: tick them in the list (colour versions under their main product, with a filter), then drag the
// chosen ones into order. value = product IDs in order.
function ProductPicker({ all, value, onChange, disabled }) {
  const [filter, setFilter] = useState('');
  const [drag, setDrag] = useState(null);
  const byId = new Map(all.map((p) => [p.product_id, p]));
  const f = filter.trim().toLowerCase();
  const match = (p) => !f || p.product_id.toLowerCase().includes(f) || productName(p).toLowerCase().includes(f);
  const groups = all.filter((p) => !p.variant_of).map((m) => ({ main: m, variants: all.filter((v) => v.variant_of === m.product_id) }))
    .filter(({ main, variants }) => match(main) || variants.some(match));
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const move = (from, to) => {
    if (from === null || to < 0 || to >= value.length || from === to) return;
    const next = [...value];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange(next);
  };
  const option = (p, variant) => (
    <label key={p.product_id} className={`a-pick${variant ? ' a-pick-var' : ''}${p.is_active ? '' : ' a-off'}`}>
      <input type="checkbox" checked={value.includes(p.product_id)} disabled={disabled} onChange={() => toggle(p.product_id)} />
      <Thumb p={p} size={32} />
      <code>{p.product_id}</code>
      <span>{productName(p)}{p.is_active ? '' : ' (not active)'}</span>
    </label>
  );
  return (
    <div className="a-kitpick">
      <h3>Products (in order)</h3>
      <div className="a-kitpick-cols">
        <div>
          <input type="search" placeholder="Filter by ID or name" aria-label="Filter products" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="a-pick-list" role="group" aria-label="Products to include">
            {groups.map(({ main, variants }) => [option(main, false), ...variants.filter((v) => match(v) || match(main)).map((v) => option(v, true))])}
            {!groups.length && <p className="a-muted">No product matches.</p>}
          </div>
        </div>
        <div>
          <p className="a-muted a-pick-note">{value.length ? `${value.length} chosen. Drag to change the order.` : 'Tick products in the list.'}</p>
          <ol className="a-chosen">
            {value.map((id, i) => {
              const p = byId.get(id);
              return (
                <li key={id} draggable={!disabled} className={drag === i ? 'a-dragging' : undefined}
                  onDragStart={() => setDrag(i)} onDragOver={(e) => { if (drag !== null) e.preventDefault(); }}
                  onDrop={(e) => { e.preventDefault(); move(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}>
                  {!disabled && <span className="a-handle" aria-hidden="true">⠿</span>}
                  <span className="a-num">{i + 1}</span>
                  <Thumb p={p} size={32} />
                  <code>{id}</code>
                  <span className="a-chosen-name">{p ? productName(p) : '(unknown product)'}</span>
                  {!disabled && (
                    <span className="a-chosen-btns">
                      <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${id} up`}>↑</button>
                      <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => move(i, i + 1)} disabled={i === value.length - 1} aria-label={`Move ${id} down`}>↓</button>
                      <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => toggle(id)} aria-label={`Remove ${id}`}>×</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}

// Towns: the site's map (same land, pins and name sizes as src/home/WhereMap.js) with the town being edited drawn from
// the unsaved values, so the pin and the name can be placed before saving. Other active towns are shown faded.
function TownPreview({ rows, town }) {
  const name = (t) => (t.tr && t.tr.en && t.tr.en.name) || t.town_key || '';
  const placed = (t) => t.map_x !== null && t.map_x !== undefined && t.map_x !== '' && t.map_y !== null && t.map_y !== undefined && t.map_y !== '';
  const others = rows.filter((t) => t.town_key !== town.town_key && t.is_active && placed(t));
  const pin = (t, current) => {
    const x = Number(t.map_x);
    const y = Number(t.map_y);
    const base = Number(t.is_base) === 1;
    return (
      <g key={t.town_key || 'new'} opacity={current ? 1 : 0.35}>
        <circle cx={x} cy={y} r={base ? 11 : 7} fill={base ? '#121214' : '#E5BF24'} stroke="#fff" strokeWidth="3" />
        <text x={x + Number(t.label_dx || 0)} y={y + Number(t.label_dy || 0)} textAnchor={t.label_anchor || 'middle'}
          fontFamily="Saira, sans-serif" fontWeight="700" fontSize="18" fill="#121214">{name(t)}{base ? ' ★' : ''}</text>
      </g>
    );
  };
  return (
    <figure className="a-townmap">
      <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Preview of the delivery map">
        <path d={LAND} fill="#FFF3CF" stroke="#EEE4C8" strokeWidth="2" />
        {others.map((t) => pin(t, false))}
        {placed(town) ? pin(town, true) : null}
      </svg>
      <figcaption className="a-muted">
        {placed(town) ? 'Preview: this town in full colour, the others faded. Not saved until you press Save.' : 'Enter Map x and Map y to place this town.'}
      </figcaption>
    </figure>
  );
}
