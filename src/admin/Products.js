// Products (spec F 3): list with colour variants under their card, editor with base fields and per-language
// text side by side, photos (upload -> 1200 WebP <= 150 KB + 400 / 800, reorder 1-3, remove), active toggle,
// featured order, add colour variant.
import { useMemo, useState } from 'react';
import { api } from './adminApi';
import { mediaUrl } from '../utils/api';
import { Drawer, Field, Loading, Notice, TrEditor, useAction, useCan, useLoad } from './ui';

const TR_FIELDS = [
  { name: 'name', label: 'Name', required: true }, { name: 'one_liner', label: 'One-liner', required: true },
  { name: 'keywords', label: 'Keywords (comma separated)', required: true }, { name: 'description', label: 'Description', required: true, long: true },
  { name: 'best_for', label: 'Best for', required: true }, { name: 'colour_name', label: 'Colour name' },
  { name: 'specification', label: 'Specification (override)' }, { name: 'pack', label: 'Pack (override)' },
  { name: 'alt_text', label: 'Photo alt text' }, { name: 'whatsapp_message', label: 'WhatsApp message', long: true },
];

const baseFields = (cats, cards, creating) => [
  { name: 'product_id', label: 'Product ID', type: creating ? 'text' : 'readonly', required: true, help: 'e.g. DZIND-DF050; a colour: DZIND-DF008-RED' },
  { name: 'category_key', label: 'Category', type: 'select', options: cats.map((c) => ({ value: c.category_key, label: `${c.tr.en ? c.tr.en.name : c.category_key}` })), required: true, allowEmpty: false },
  { name: 'variant_of', label: 'Colour of (variant)', type: 'select', options: cards.map((p) => p.product_id), help: 'Empty = its own product card' },
  { name: 'sort_order', label: 'Sort order', type: 'number', step: '0.01' },
  { name: 'specification', label: 'Specification', required: true, wide: true },
  { name: 'pack', label: 'Pack', required: true },
  { name: 'swatch_hex', label: 'Swatch colour', help: '#RRGGBB, for colour dots' },
  { name: 'is_featured', label: 'Featured on Home', type: 'bool' },
  { name: 'featured_order', label: 'Featured order', type: 'number', step: '1' },
  { name: 'show_for_home', label: 'In "For Home" filter', type: 'bool' },
  { name: 'is_active', label: 'Active (shown on the site)', type: 'bool' },
  { name: 'spec_status', label: 'Spec status (INTERNAL, never shown)', type: 'textarea', wide: true, rows: 2 },
];

export default function Products() {
  const list = useLoad('/products');
  const cats = useLoad('/categories');
  const canEdit = useCan('editor');
  const [open, setOpen] = useState(null); // { id } | { create: {...} }
  const [filter, setFilter] = useState('');

  const rows = useMemo(() => {
    const all = list.data || [];
    const f = filter.trim().toLowerCase();
    const match = (p) => !f || p.product_id.toLowerCase().includes(f) || Object.values(p.tr).some((t) => (t.name || '').toLowerCase().includes(f));
    const cards = all.filter((p) => !p.variant_of);
    return cards.flatMap((c) => [c, ...all.filter((v) => v.variant_of === c.product_id)]).filter(match);
  }, [list.data, filter]);

  return (
    <section>
      <h1>Products</h1>
      <div className="a-toolbar">
        <input type="search" placeholder="Filter by ID or name" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {canEdit && <button type="button" className="a-btn" onClick={() => setOpen({ create: { is_active: 1 } })}>Add product</button>}
      </div>
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table a-hover">
            <thead><tr><th /><th>ID</th><th>Name (EN)</th><th>Category</th><th>Photos</th><th>Featured</th><th>Active</th><th>Languages</th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.product_id} onClick={() => setOpen({ id: p.product_id })} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen({ id: p.product_id })} className={p.is_active ? '' : 'a-off'}>
                  <td>{p.images[0] && <img className="a-thumb" src={mediaUrl(`/media/products/400/${p.images[0].file_name}`)} alt="" width="40" height="40" />}</td>
                  <td><code>{p.variant_of ? '└ ' : ''}{p.product_id}</code></td>
                  <td>{p.tr.en ? p.tr.en.name : ''}{p.variant_of && p.tr.en && p.tr.en.colour_name ? ` (${p.tr.en.colour_name})` : ''}</td>
                  <td>{p.category_key}</td>
                  <td className="a-num">{p.images.length}</td>
                  <td>{p.is_featured ? `Yes (${p.featured_order ?? '-'})` : ''}</td>
                  <td>{p.is_active ? 'Yes' : 'No'}</td>
                  <td>{Object.keys(p.tr).join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Loading>
      {open && cats.data && (
        <ProductEditor key={open.id || 'new'} id={open.id} initial={open.create} cats={cats.data} cards={(list.data || []).filter((p) => !p.variant_of)}
          onClose={() => setOpen(null)} onSaved={(id) => { list.reload(); if (id) setOpen({ id }); }}
          onAddVariant={(p) => setOpen({ create: { variant_of: p.product_id, category_key: p.category_key, sort_order: Number(p.sort_order) + 0.1, specification: p.specification, pack: p.pack, is_active: 1, tr: p.tr } })} />
      )}
    </section>
  );
}

function ProductEditor({ id, initial, cats, cards, onClose, onSaved, onAddVariant }) {
  const loaded = useLoad(id ? `/products/${encodeURIComponent(id)}` : null);
  const canEdit = useCan('editor');
  const act = useAction();
  const [draft, setDraft] = useState(null);
  const creating = !id;
  const p = draft || (creating ? { tr: {}, ...initial } : loaded.data);

  const set = (k, v) => setDraft({ ...p, [k]: v });
  const save = () => act.run(async () => {
    const { images, ...body } = p; // eslint-disable-line no-unused-vars
    const saved = creating ? await api.send('POST', '/products', body) : await api.send('PUT', `/products/${encodeURIComponent(id)}`, body);
    setDraft(null);
    if (!creating) loaded.setData(saved);
    onSaved(creating ? saved.product_id : null);
  }, 'Saved');

  if (!creating && !loaded.data) return <Drawer title="Product" onClose={onClose}><Loading state={loaded}>{null}</Loading></Drawer>;

  return (
    <Drawer title={creating ? (initial.variant_of ? `New colour of ${initial.variant_of}` : 'New product') : `${p.product_id}`} onClose={onClose}
      footer={canEdit && (
        <>
          <button type="button" className="a-btn" onClick={save} disabled={act.busy}>{creating ? 'Create' : 'Save'}</button>
          {!creating && !p.variant_of && <button type="button" className="a-btn a-btn-ghost" onClick={() => onAddVariant(p)}>Add colour variant</button>}
          {draft && <span className="a-muted">Unsaved changes</span>}
        </>
      )}>
      {act.note}
      <div className="a-grid2">
        {baseFields(cats, cards.filter((c) => c.product_id !== p.product_id), creating).map((f) => (
          <Field key={f.name} def={f} value={p[f.name]} disabled={!canEdit} onChange={(v) => set(f.name, v)} />
        ))}
      </div>
      <h3>Text per language</h3>
      <p className="a-muted">Empty cells show the default language on the site.</p>
      <TrEditor fields={TR_FIELDS} tr={p.tr || {}} disabled={!canEdit} onChange={(tr) => set('tr', tr)} />
      {!creating && <Photos product={loaded.data} canEdit={canEdit} onChanged={() => { loaded.reload(); onSaved(null); }} />}
    </Drawer>
  );
}

function Photos({ product, canEdit, onChanged }) {
  const act = useAction();
  const [position, setPosition] = useState(String(Math.min(product.images.length + 1, 3)));
  const id = encodeURIComponent(product.product_id);
  const upload = (file) => act.run(async () => {
    const r = await api.upload(`/products/${id}/images`, file, { position });
    onChanged();
    return r;
  }).then((r) => r && act.setMsg({ kind: 'ok', text: `Saved ${r.file_name}: ${Math.round(r.original_bytes / 1024)} KB in -> ${Math.round(r.bytes / 1024)} KB WebP 1200x1200 (+ 400, 800)` }));
  const remove = (pos) => window.confirm(`Remove photo ${pos}?`) && act.run(async () => { await api.send('DELETE', `/products/${id}/images/${pos}`); onChanged(); }, 'Removed');
  const move = (pos, dir) => {
    const order = product.images.map((i) => i.position);
    const at = order.indexOf(pos);
    const to = at + dir;
    if (to < 0 || to >= order.length) return;
    [order[at], order[to]] = [order[to], order[at]];
    act.run(async () => { await api.send('PUT', `/products/${id}/images/order`, { order }); onChanged(); }, 'Order saved');
  };

  return (
    <>
      <h3>Photos (1-3)</h3>
      {act.note}
      <div className="a-photos">
        {product.images.map((img, i) => (
          <figure key={img.position}>
            <img src={mediaUrl(`/media/products/400/${img.file_name}`)} alt={`${product.product_id} ${img.position}`} width="140" height="140" />
            <figcaption>
              {img.position}. <code>{img.file_name}</code>
              {canEdit && (
                <span className="a-row">
                  <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={i === 0 || act.busy} onClick={() => move(img.position, -1)} aria-label="Move left">◀</button>
                  <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={i === product.images.length - 1 || act.busy} onClick={() => move(img.position, 1)} aria-label="Move right">▶</button>
                  <button type="button" className="a-btn a-btn-sm a-btn-danger" disabled={act.busy} onClick={() => remove(img.position)}>Remove</button>
                </span>
              )}
            </figcaption>
          </figure>
        ))}
      </div>
      {canEdit && (
        <div className="a-toolbar">
          <label className="a-inline">Position
            <select value={position} onChange={(e) => setPosition(e.target.value)}>{[1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select>
          </label>
          <label className="a-btn a-btn-ghost a-file">
            {act.busy ? 'Uploading...' : 'Upload photo (JPG / PNG / WebP, max 8 MB)'}
            <input type="file" accept="image/jpeg,image/png,image/webp" disabled={act.busy} onChange={(e) => { const f = e.target.files[0]; e.target.value = ''; if (f) upload(f); }} />
          </label>
        </div>
      )}
      <Notice>A photo is fitted on white to 1200x1200 and saved as WebP of at most 150 KB.</Notice>
    </>
  );
}
