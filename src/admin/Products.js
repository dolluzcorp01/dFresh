// Products (spec F 3): the list by category in the site's order, with drag and drop to reorder (main products within
// their category; colour versions inside their main product, which they always move with), the position as a
// read-only number, and a small "Featured on Home" list that is dragged the same way. Editor: base fields and
// per-language text side by side, photos (upload -> 1200 WebP <= 150 KB + 400 / 800, reorder 1-3, remove), active
// toggle, featured order, add colour version. Positions are whole numbers 1, 2, 3 ... kept unique by the server
// (positions.js); a new product goes to the end of its category.
import { useMemo, useState } from 'react';
import { api } from './adminApi';
import { mediaUrl } from '../utils/api';
import { Drawer, Field, Loading, Notice, TrEditor, useAction, useCan, useLoad } from './ui';

const TR_FIELDS = [
  { name: 'name', label: 'Name', required: true }, { name: 'one_liner', label: 'One-liner', required: true },
  { name: 'keywords', label: 'Keywords (comma separated)', required: true, help: 'The first 3 show as chips on the product card. All are used for search.' },
  { name: 'description', label: 'Description', required: true, long: true },
  { name: 'best_for', label: 'Best for', required: true }, { name: 'colour_name', label: 'Colour name' },
  { name: 'specification', label: 'Specification (override)' }, { name: 'pack', label: 'Pack (override)' },
  { name: 'alt_text', label: 'Photo alt text', help: 'Describes the photo for Google and screen readers. Not shown on the page.' },
  { name: 'whatsapp_message', label: 'WhatsApp message', long: true },
];
const HEX = /^#[0-9A-Fa-f]{6}$/;

const baseFields = (cats, cards, creating) => [
  { name: 'product_id', label: 'Product ID', type: creating ? 'text' : 'readonly', required: true, help: 'e.g. DZIND-DF050; a colour: DZIND-DF008-RED' },
  { name: 'category_key', label: 'Category', type: 'select', options: cats.map((c) => ({ value: c.category_key, label: `${c.tr?.en?.name ?? c.category_key}` })), required: true, allowEmpty: false },
  { name: 'variant_of', label: 'Colour version of', type: 'select', options: cards.map((p) => p.product_id), help: "Leave '-' for a main product. Pick the main product only if this is another colour of it." },
  { name: 'sort_order', label: 'Position', type: 'readonly', help: creating ? 'Goes to the end of its category; drag in the list to move it.' : 'Drag the rows in the list to change it.' },
  { name: 'specification', label: 'Specification', required: true, wide: true },
  { name: 'pack', label: 'Pack', required: true },
  { name: 'is_featured', label: 'Featured on Home', type: 'bool' },
  { name: 'featured_order', label: 'Featured order', type: 'number', step: '1', help: 'Empty = last. Whole numbers 1, 2, 3 ..., each used once. Or drag in "Featured on Home".' },
  { name: 'show_for_home', label: 'In "For Home" filter', type: 'bool' },
  { name: 'is_active', label: 'Active (shown on the site)', type: 'bool' },
  { name: 'spec_status', label: 'Spec status (INTERNAL, never shown)', type: 'textarea', wide: true, rows: 2 },
];

/** The list in the site's order: categories by position, main products by position, colour versions under them. */
function grouped(all, cats) {
  const byPos = (a, b) => (Number(a.sort_order) - Number(b.sort_order)) || (a.product_id < b.product_id ? -1 : 1);
  const mains = all.filter((p) => !p.variant_of);
  const known = new Set(cats.map((c) => c.category_key));
  const groups = [...cats.map((c) => ({ key: c.category_key, name: c.tr?.en?.name ?? c.category_key })),
    ...[...new Set(mains.map((p) => p.category_key))].filter((k) => !known.has(k)).map((k) => ({ key: k, name: k }))];
  return groups.map((g) => ({
    ...g,
    items: mains.filter((p) => p.category_key === g.key).sort(byPos).map((m) => ({
      main: m, variants: all.filter((v) => v.variant_of === m.product_id).sort(byPos),
    })),
  })).filter((g) => g.items.length);
}

export default function Products() {
  const list = useLoad('/products');
  const cats = useLoad('/categories');
  const canEdit = useCan('editor');
  const act = useAction();
  const [open, setOpen] = useState(null); // { id } | { create: {...} }
  const [filter, setFilter] = useState('');
  const [drag, setDrag] = useState(null); // { id, scope }

  const groups = useMemo(() => grouped(list.data || [], cats.data || []), [list.data, cats.data]);
  const f = filter.trim().toLowerCase();
  const match = (p) => !f || p.product_id.toLowerCase().includes(f) || Object.values(p.tr).some((t) => (t.name || '').toLowerCase().includes(f));
  const canDrag = canEdit && !f;
  const featured = useMemo(() => (list.data || []).filter((p) => Number(p.is_featured))
    .sort((a, b) => (Number(a.featured_order) || 999) - (Number(b.featured_order) || 999)), [list.data]);

  // Drop a dragged row on another row of the same list: the whole list in its new order goes to the server.
  const dropOn = (target, scope, ids) => {
    if (!drag || drag.scope !== scope || drag.id === target) { setDrag(null); return; }
    const order = ids.filter((x) => x !== drag.id);
    order.splice(order.indexOf(target) + (ids.indexOf(drag.id) < ids.indexOf(target) ? 1 : 0), 0, drag.id);
    setDrag(null);
    const [kind, key] = scope.split(':');
    const url = kind === 'featured' ? '/products/featured-order' : '/products/reorder';
    const body = kind === 'featured' ? { order } : { order, ...(kind === 'cat' ? { category: key } : { parent: key }) };
    act.run(async () => { await api.send('POST', url, body); list.reload(); }, 'Order saved');
  };
  const dragProps = (id, scope, ids) => (canDrag ? {
    draggable: true,
    onDragStart: (e) => { e.stopPropagation(); setDrag({ id, scope }); },
    onDragOver: (e) => { if (drag && drag.scope === scope) e.preventDefault(); },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); dropOn(id, scope, ids); },
    onDragEnd: () => setDrag(null),
  } : {});

  const row = (p, pos, scope, ids, isVariant) => (
    <tr key={p.product_id} {...dragProps(p.product_id, scope, ids)} onClick={() => setOpen({ id: p.product_id })} tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && setOpen({ id: p.product_id })}
      className={`${p.is_active ? '' : 'a-off'}${drag && drag.id === p.product_id ? ' a-dragging' : ''}`}>
      <td className="a-handle" aria-hidden="true">{canDrag ? '⠿' : ''}</td>
      <td className="a-num">{pos}</td>
      <td>{p.images[0] && <img className="a-thumb" src={mediaUrl(`/media/products/400/${p.images[0].file_name}`)} alt="" width="40" height="40" />}</td>
      <td><code>{isVariant ? '└ ' : ''}{p.product_id}</code></td>
      <td>{p.tr?.en?.name ?? ''}{isVariant && p.tr?.en?.colour_name ? ` (${p.tr.en.colour_name})` : ''}</td>
      <td className="a-num">{(p.images || []).length}</td>
      <td>{Number(p.is_featured) ? `Yes (${p.featured_order ?? '-'})` : ''}</td>
      <td>{p.is_active ? 'Yes' : 'No'}</td>
      <td>{Object.keys(p.tr).join(' ')}</td>
    </tr>
  );

  return (
    <section>
      <h1>Products</h1>
      <div className="a-toolbar">
        <input type="search" placeholder="Filter by ID or name" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {canEdit && <button type="button" className="a-btn" onClick={() => setOpen({ create: { is_active: 1 } })}>Add product</button>}
        {canEdit && <span className="a-muted">{f ? 'Clear the filter to drag rows.' : 'Drag rows to change the order (colour versions move with their product).'}</span>}
      </div>
      {act.note}
      <Loading state={list}>
        {featured.length > 0 && (
          <div className="a-card a-featured">
            <h2>Featured on Home</h2>
            <ol className="a-featured-list">
              {featured.map((p) => (
                <li key={p.product_id} {...dragProps(p.product_id, 'featured:', featured.map((x) => x.product_id))}
                  className={`${drag && drag.id === p.product_id ? 'a-dragging' : ''}${p.is_active ? '' : ' a-off'}`}>
                  {canDrag && <span className="a-handle" aria-hidden="true">⠿</span>}
                  <span className="a-num">{p.featured_order}</span>
                  <code>{p.product_id}</code> {p.tr?.en?.name ?? ''}{p.is_active ? '' : ' (not active)'}
                </li>
              ))}
            </ol>
          </div>
        )}
        <div className="a-scroll">
          <table className="a-table a-hover">
            <thead><tr><th /><th>Pos.</th><th /><th>ID</th><th>Name (EN)</th><th>Photos</th><th>Featured</th><th>Active</th><th>Languages</th></tr></thead>
            {groups.map((g) => {
              const ids = g.items.map((x) => x.main.product_id);
              const rows = g.items.flatMap(({ main, variants }, i) => {
                const vids = variants.map((v) => v.product_id);
                return [
                  match(main) || variants.some(match) ? row(main, i + 1, `cat:${g.key}`, ids, false) : null,
                  ...variants.filter((v) => match(v) || match(main)).map((v) => row(v, `${i + 1}.${vids.indexOf(v.product_id) + 1}`, `var:${main.product_id}`, vids, true)),
                ];
              }).filter(Boolean);
              if (!rows.length) return null;
              return (
                <tbody key={g.key}>
                  <tr className="a-group"><th colSpan={9}>{g.name} <span className="a-muted">({g.items.length})</span></th></tr>
                  {rows}
                </tbody>
              );
            })}
          </table>
        </div>
      </Loading>
      {open && cats.data && (
        <ProductEditor key={open.id || 'new'} id={open.id} initial={open.create} cats={cats.data} all={list.data || []}
          onClose={() => setOpen(null)} onSaved={(id) => { list.reload(); if (id) setOpen({ id }); }}
          onAddVariant={(p) => setOpen({ create: { variant_of: p.product_id, category_key: p.category_key, specification: p.specification, pack: p.pack, is_active: 1, tr: p.tr } })} />
      )}
    </section>
  );
}

function ProductEditor({ id, initial, cats, all, onClose, onSaved, onAddVariant }) {
  const loaded = useLoad(id ? `/products/${encodeURIComponent(id)}` : null);
  const canEdit = useCan('editor');
  const act = useAction();
  const [draft, setDraft] = useState(null);
  const creating = !id;
  const p = draft || (creating ? { tr: {}, ...initial } : loaded.data);
  const cards = all.filter((x) => !x.variant_of);

  const set = (k, v) => setDraft({ ...p, [k]: v });
  const save = () => act.run(async () => {
    const { images, ...body } = p; // eslint-disable-line no-unused-vars
    if (body.swatch_hex && !HEX.test(body.swatch_hex)) throw new Error('Swatch colour: use the form #RRGGBB, e.g. #7A1F2B');
    const saved = creating ? await api.send('POST', '/products', body) : await api.send('PUT', `/products/${encodeURIComponent(id)}`, body);
    setDraft(null);
    if (!creating) loaded.setData(saved);
    onSaved(creating ? saved.product_id : null);
  }, 'Saved');

  if (!creating && !loaded.data) return <Drawer title="Product" onClose={onClose}><Loading state={loaded}>{null}</Loading></Drawer>;

  // The swatch only matters for a colour version or a product that has colour versions (the dots on the card).
  const hasVersions = !creating && all.some((x) => x.variant_of === p.product_id);
  const showSwatch = Boolean(p.variant_of) || hasVersions;
  const hex = p.swatch_hex || '';
  const hexOk = !hex || HEX.test(hex);

  return (
    <Drawer title={creating ? (initial.variant_of ? `New colour of ${initial.variant_of}` : 'New product') : `${p.product_id}`} onClose={onClose}
      footer={canEdit && (
        <>
          <button type="button" className="a-btn" onClick={save} disabled={act.busy || !hexOk}>{creating ? 'Create' : 'Save'}</button>
          {!creating && !p.variant_of && <button type="button" className="a-btn a-btn-ghost" onClick={() => onAddVariant(p)}>Add colour version</button>}
          {draft && <span className="a-muted">Unsaved changes</span>}
        </>
      )}>
      {act.note}
      <div className="a-grid2">
        {baseFields(cats, cards.filter((c) => c.product_id !== p.product_id), creating).map((fd) => (
          <Field key={fd.name} def={fd} value={p[fd.name]} disabled={!canEdit} onChange={(v) => set(fd.name, v)} />
        ))}
        {showSwatch && (
          <label className="a-field" htmlFor="f-swatch_hex">
            <span>Swatch colour</span>
            <span className="a-swatch-row">
              <span className="a-swatch" style={{ backgroundColor: hexOk && hex ? hex : 'transparent' }} aria-hidden="true" />
              <input id="f-swatch_hex" type="text" value={hex} placeholder="#RRGGBB" maxLength={7} disabled={!canEdit}
                aria-invalid={!hexOk} onChange={(e) => set('swatch_hex', e.target.value.trim() || null)} />
            </span>
            <small className={hexOk ? 'a-muted' : 'a-bad'}>{hexOk ? 'The colour dot on the product card, as #RRGGBB.' : 'Use the form #RRGGBB, e.g. #7A1F2B'}</small>
          </label>
        )}
      </div>
      <h3>Text per language</h3>
      <p className="a-muted">Empty cells show the default language on the site.</p>
      <TrEditor fields={TR_FIELDS} tr={p.tr || {}} disabled={!canEdit} onChange={(tr) => set('tr', tr)} />
      {!creating && <Photos product={loaded.data} canEdit={canEdit} onChanged={() => { loaded.reload(); onSaved(null); }} />}
    </Drawer>
  );
}

function Photos({ product, canEdit, onChanged }) {
  const images = product.images || [];
  const act = useAction();
  const [position, setPosition] = useState(String(Math.min(images.length + 1, 3)));
  const id = encodeURIComponent(product.product_id);
  const upload = (file) => act.run(async () => {
    const r = await api.upload(`/products/${id}/images`, file, { position });
    onChanged();
    return r;
  }).then((r) => r && act.setMsg({ kind: 'ok', text: `Saved ${r.file_name}: ${Math.round(r.original_bytes / 1024)} KB in -> ${Math.round(r.bytes / 1024)} KB WebP 1200x1200 (+ 400, 800)` }));
  const remove = (pos) => window.confirm(`Remove photo ${pos}?`) && act.run(async () => { await api.send('DELETE', `/products/${id}/images/${pos}`); onChanged(); }, 'Removed');
  const move = (pos, dir) => {
    const order = images.map((i) => i.position);
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
        {images.map((img, i) => (
          <figure key={img.position}>
            <img src={mediaUrl(`/media/products/400/${img.file_name}`)} alt={`${product.product_id} ${img.position}`} width="140" height="140" />
            <figcaption>
              {img.position}. <code>{img.file_name}</code>
              {canEdit && (
                <span className="a-row">
                  <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={i === 0 || act.busy} onClick={() => move(img.position, -1)} aria-label="Move left">◀</button>
                  <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={i === images.length - 1 || act.busy} onClick={() => move(img.position, 1)} aria-label="Move right">▶</button>
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
