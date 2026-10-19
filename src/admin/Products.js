// Products (spec F 3): the list by category in the site's order, with drag and drop to reorder (main products within
// their category; colour versions inside their main product, which they always move with), the position as a
// read-only number, and a small version of the home page's featured section ("Most loved": the title and kicker come
// from the site texts feat_h / feat_k) with photo cards that are dragged the same way. Editor: base fields and
// per-language text side by side, photos (upload -> 1200 WebP <= 150 KB + 400 / 800, reorder 1-3, remove), active
// toggle, featured order, add colour version. Positions are whole numbers 1, 2, 3 ... kept unique by the server
// (positions.js); a new product goes to the end of its category.
import { useMemo, useState } from 'react';
import { api } from './adminApi';
import { mediaUrl } from '../utils/api';
import { Drawer, Field, Loading, MissingBadges, Notice, TrEditor, UploadButton, missingTexts, nextOrder, useAction, useAdmin, useCan, useConfirm, useLoad, useUpload } from './ui';
import { ProductField } from './ProductSelect';
import useOrderDraft from './useOrderDraft';

const TR_FIELDS = [
  { name: 'name', label: 'Name', required: true }, { name: 'one_liner', label: 'One-liner', required: true },
  { name: 'keywords', label: 'Keywords (comma separated)', required: true, help: 'First 3 = chips on the card.', info: 'The first 3 keywords show as chips on the product card. All of them are used by the site search.' },
  { name: 'description', label: 'Description', required: true, long: true },
  { name: 'best_for', label: 'Best for', required: true }, { name: 'colour_name', label: 'Colour name' },
  // empty = the site uses the main Specification / Pack (the default language has no box: the main field is its value)
  { name: 'specification', label: 'Specification (this language only)', mainLabel: 'Specification', override: true, help: 'Empty = the main value (grey).' },
  { name: 'pack', label: 'Pack (this language only)', mainLabel: 'Pack', override: true, help: 'Empty = the main value (grey).' },
  { name: 'alt_text', label: 'Photo alt text', help: 'For Google and screen readers.', info: 'Describes the photo for Google and screen readers. Not shown on the page.' },
  { name: 'whatsapp_message', label: 'WhatsApp message', long: true },
];
const HEX = /^#[0-9A-Fa-f]{6}$/;

const baseFields = (cats, cards, creating, home) => [
  { name: 'product_id', label: 'Product ID', type: creating ? 'text' : 'readonly', required: true, help: 'e.g. DZIND-DF050; a colour: DZIND-DF008-RED' },
  { name: 'category_key', label: 'Category', type: 'select', options: cats.map((c) => ({ value: c.category_key, label: `${c.tr?.en?.name ?? c.category_key}` })), required: true, allowEmpty: false },
  { name: 'variant_of', label: 'Colour version of', type: 'select', options: cards.map((p) => p.product_id), help: "Leave '-' for a main product. Pick the main product only if this is another colour of it." },
  { name: 'sort_order', label: 'Position', type: 'readonly', help: creating ? 'New items go to the end. Drag in the list to move.' : 'Drag the rows in the list to change it.' },
  { name: 'specification', label: 'Specification', required: true, wide: true },
  { name: 'pack', label: 'Pack', required: true },
  { name: 'is_featured', label: `In "${home.title}" on the home page`, type: 'bool' },
  creating
    ? { name: 'featured_order', label: `"${home.title}" order`, type: 'readonly', help: 'New items go to the end. Drag in the list to move.' }
    : { name: 'featured_order', label: `"${home.title}" order`, type: 'number', step: '1', help: `${home.hint} Empty = last; 1, 2, 3 ..., each used once. Or drag the cards in "${home.title}".` },
  { name: 'show_for_home', label: 'In "For Home" filter', type: 'bool' },
  { name: 'is_active', label: 'Active (shown on the site)', type: 'bool' },
  { name: 'spec_status', label: 'Spec status (INTERNAL, never shown)', type: 'textarea', wide: true, rows: 2 },
];

/** The home page's featured section as the site names it (default language), for the card and the drawer wording. */
function homeFeatured(ui) {
  const text = (k) => {
    const row = ui && (ui.keys || []).find((x) => x.text_key === k);
    return (row && (row.values[ui.default] || row.values.en)) || '';
  };
  const title = text('feat_h') || 'Featured';
  return { title, kicker: text('feat_k'), hint: `Shown in the ${title} section on the home page, in this order.` };
}

const thumbUrl = (p) => (p.images && p.images[0] ? mediaUrl(`/media/products/400/${p.images[0].file_name}`) : null);

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
  const ui = useLoad('/ui-text');
  const home = useMemo(() => homeFeatured(ui.data), [ui.data]);
  const canEdit = useCan('editor');
  const act = useAction();
  const [opened, setOpen] = useState(null); // { id } | { create: {...} }
  const [filter, setFilter] = useState('');
  const { languages } = useAdmin();
  const [onlyMissing, setOnlyMissing] = useState(false);
  const missingOf = (p) => missingTexts(p.tr, TR_FIELDS, languages);
  const [drag, setDrag] = useState(null); // { id, scope }

  const groups = useMemo(() => grouped(list.data || [], cats.data || []), [list.data, cats.data]);
  const f = filter.trim().toLowerCase();
  const match = (p) => (!f || p.product_id.toLowerCase().includes(f) || Object.values(p.tr).some((t) => (t.name || '').toLowerCase().includes(f)))
    && (!onlyMissing || missingOf(p).length > 0);
  const canDrag = canEdit && !f && !onlyMissing;
  const featured = useMemo(() => (list.data || []).filter((p) => Number(p.is_featured))
    .sort((a, b) => (Number(a.featured_order) || 999) - (Number(b.featured_order) || 999)), [list.data]);

  // A drop changes a local order per list (scope); "Save order" sends each changed list (useOrderDraft).
  const draft = useOrderDraft((scope, order) => {
    const [kind, key] = scope.split(':');
    const url = kind === 'featured' ? '/products/featured-order' : '/products/reorder';
    return api.send('POST', url, kind === 'featured' ? { order } : { order, ...(kind === 'cat' ? { category: key } : { parent: key }) });
  }, () => list.reload());
  const open = (o) => draft.guard(() => setOpen(o));
  /** items in the list's unsaved order, if it has one */
  const inOrder = (scope, items, idOf) => {
    const saved = items.map(idOf);
    return draft.order(scope, saved).map((x) => items.find((it) => idOf(it) === x)).filter(Boolean);
  };
  const dropOn = (target, scope, ids, savedIds) => {
    if (!drag || drag.scope !== scope || drag.id === target) { setDrag(null); return; }
    const order = ids.filter((x) => x !== drag.id);
    order.splice(order.indexOf(target) + (ids.indexOf(drag.id) < ids.indexOf(target) ? 1 : 0), 0, drag.id);
    setDrag(null);
    draft.set(scope, order, savedIds);
  };
  const dragProps = (id, scope, ids, savedIds) => (canDrag ? {
    draggable: true,
    onDragStart: (e) => { e.stopPropagation(); setDrag({ id, scope }); },
    onDragOver: (e) => { if (drag && drag.scope === scope) e.preventDefault(); },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); dropOn(id, scope, ids, savedIds); },
    onDragEnd: () => setDrag(null),
  } : {});
  const featuredShown = inOrder('featured:', featured, (p) => p.product_id);

  const row = (p, pos, scope, ids, savedIds, isVariant) => (
    <tr key={p.product_id} {...dragProps(p.product_id, scope, ids, savedIds)} onClick={() => open({ id: p.product_id })} tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && open({ id: p.product_id })}
      className={`${p.is_active ? '' : 'a-off'}${drag && drag.id === p.product_id ? ' a-dragging' : ''}`}>
      <td className="a-handle" aria-hidden="true">{canDrag ? '⠿' : ''}</td>
      <td className="a-num">{pos}</td>
      <td>{thumbUrl(p) && <img className="a-thumb" src={thumbUrl(p)} alt="" width="40" height="40" />}</td>
      <td><code>{isVariant ? '└ ' : ''}{p.product_id}</code></td>
      <td>{p.tr?.en?.name ?? ''}{isVariant && p.tr?.en?.colour_name ? ` (${p.tr.en.colour_name})` : ''}<MissingBadges missing={missingOf(p)} /></td>
      <td className="a-num">{(p.images || []).length}</td>
      <td>{Number(p.is_featured) ? `Yes (${p.featured_order ?? '-'})` : ''}</td>
      <td>{p.is_active ? 'Yes' : 'No'}</td>
    </tr>
  );

  return (
    <section>
      <h1>Products</h1>
      <div className="a-toolbar">
        <input type="search" placeholder="Filter by ID or name" aria-label="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
        {canEdit && <button type="button" className="a-btn" onClick={() => open({ create: { is_active: 1 } })}>Add product</button>}
        <button type="button" className="a-chip" aria-pressed={onlyMissing} onClick={() => setOnlyMissing((x) => !x)}
          title="Only products where an active language has an empty required text">
          Missing translations <b>{(list.data || []).filter((p) => missingOf(p).length).length}</b>
        </button>
        {canEdit && <span className="a-muted">{f || onlyMissing ? 'Clear the filters to drag rows.' : 'Drag rows to change the order (colour versions move with their product), then Save order.'}</span>}
      </div>
      {act.note}
      <Loading state={list}>
        <div className="a-card a-featured">
          {home.kicker && <p className="a-kicker">{home.kicker}</p>}
          <h2>{home.title}</h2>
          <p className="a-muted">{home.hint}{canDrag && featured.length > 1 ? ' Drag the cards to change it.' : ''}</p>
          {featured.length ? (
            <ol className="a-featured-list">
              {featuredShown.map((p, i) => (
                <li key={p.product_id} {...dragProps(p.product_id, 'featured:', featuredShown.map((x) => x.product_id), featured.map((x) => x.product_id))}
                  className={`${drag && drag.id === p.product_id ? 'a-dragging' : ''}${p.is_active ? '' : ' a-off'}`}
                  onClick={() => open({ id: p.product_id })} onKeyDown={(e) => e.key === 'Enter' && open({ id: p.product_id })} tabIndex={0}>
                  <span className="a-feat-photo">
                    {thumbUrl(p) ? <img src={thumbUrl(p)} alt="" width="96" height="96" /> : <span className="a-muted">No photo</span>}
                    <span className="a-num">{i + 1}</span>
                  </span>
                  <code>{p.product_id}</code>
                  <span className="a-feat-name">{p.tr?.en?.name ?? ''}{p.is_active ? '' : ' (not active)'}</span>
                </li>
              ))}
            </ol>
          ) : <p>{`No products yet. In a product, tick In "${home.title}" on the home page.`}</p>}
        </div>
        <div className="a-scroll">
          <table className="a-table a-hover">
            <thead><tr><th /><th>Pos.</th><th /><th>ID</th><th>Name (EN)</th><th>Photos</th><th>{home.title}</th><th>Active</th></tr></thead>
            {groups.map((g) => {
              const savedIds = g.items.map((x) => x.main.product_id);
              const items = inOrder(`cat:${g.key}`, g.items, (x) => x.main.product_id);
              const ids = items.map((x) => x.main.product_id);
              const rows = items.flatMap(({ main, variants: savedVariants }, i) => {
                const variants = inOrder(`var:${main.product_id}`, savedVariants, (v) => v.product_id);
                const vids = variants.map((v) => v.product_id);
                const savedVids = savedVariants.map((v) => v.product_id);
                return [
                  match(main) || variants.some(match) ? row(main, i + 1, `cat:${g.key}`, ids, savedIds, false) : null,
                  ...variants.filter((v) => match(v) || match(main)).map((v) => row(v, `${i + 1}.${vids.indexOf(v.product_id) + 1}`, `var:${main.product_id}`, vids, savedVids, true)),
                ];
              }).filter(Boolean);
              if (!rows.length) return null;
              return (
                <tbody key={g.key}>
                  <tr className="a-group"><th colSpan={8}>{g.name} <span className="a-muted">({g.items.length})</span></th></tr>
                  {rows}
                </tbody>
              );
            })}
          </table>
        </div>
      </Loading>
      {opened && cats.data && (
        <ProductEditor key={opened.id || 'new'} id={opened.id} initial={opened.create} cats={cats.data} all={list.data || []} listRows={list.data} home={home}
          onClose={() => setOpen(null)} onSaved={(id) => { list.reload(); if (id) setOpen({ id }); }}
          onAddVariant={(p) => setOpen({ create: { variant_of: p.product_id, category_key: p.category_key, specification: p.specification, pack: p.pack, is_active: 1, tr: p.tr } })} />
      )}
      {draft.ui}
    </section>
  );
}

function ProductEditor({ id, initial, cats, all, listRows, home, onClose, onSaved, onAddVariant }) {
  const loaded = useLoad(id ? `/products/${encodeURIComponent(id)}` : null);
  const canEdit = useCan('editor');
  const act = useAction();
  const [draft, setDraft] = useState(null);
  const creating = !id;
  // Add: the category the dropdown shows first is really chosen (it used to be only displayed, so the position was
  // counted for "no category" until the category was changed)
  const p = draft || (creating ? { tr: {}, category_key: cats[0] ? cats[0].category_key : undefined, ...initial } : loaded.data);
  const cards = all.filter((x) => !x.variant_of);

  const [swatchErr, setSwatchErr] = useState(null);
  const set = (k, v) => { if (k === 'swatch_hex') setSwatchErr(null); setDraft({ ...p, [k]: v }); };
  const swatchShown = () => Boolean(p.variant_of) || (!creating && all.some((x) => x.variant_of === p.product_id));
  const [tried, setTried] = useState(false); // a save was attempted: empty required texts turn red
  const save = () => {
    setTried(true);
    // a shown swatch must be a #RRGGBB colour (it is the dot on the product card)
    if (swatchShown() && !HEX.test(p.swatch_hex || '')) {
      setSwatchErr(p.swatch_hex ? 'Use the form #RRGGBB, e.g. #7A1F2B' : 'Pick a colour or type #RRGGBB');
      return undefined;
    }
    return saveNow();
  };
  const saveNow = () => act.run(async () => {
    const { images, ...body } = p; // eslint-disable-line no-unused-vars
    const saved = creating ? await api.send('POST', '/products', body) : await api.send('PUT', `/products/${encodeURIComponent(id)}`, body);
    setDraft(null);
    if (!creating) loaded.setData(saved);
    onSaved(creating ? saved.product_id : null);
  }, 'Saved');

  if (!creating && !loaded.data) return <Drawer title="Product" onClose={onClose}><Loading state={loaded}>{null}</Loading></Drawer>;

  // The swatch only matters for a colour version or a product that has colour versions (the dots on the card); it
  // follows "Colour version of" at once (the draft), before saving.
  const showSwatch = swatchShown();
  const hex = p.swatch_hex || '';
  const hexOk = HEX.test(hex);
  const defs = Object.fromEntries(baseFields(cats, cards.filter((c) => c.product_id !== p.product_id), creating, home).map((fd) => [fd.name, fd]));
  // Add: the numbers the new product will get (the end of its category / of its main product's colours / of the featured
  // list), following the choices live; the server assigns them on create
  const preview = creating ? {
    sort_order: nextOrder(listRows, (x) => (p.variant_of ? x.variant_of === p.variant_of : !x.variant_of && x.category_key === p.category_key)),
    featured_order: Number(p.is_featured) ? nextOrder(listRows, (x) => Number(x.is_featured) === 1, 'featured_order') : '', // empty while unticked
  } : {};
  const F = (name) => <Field key={name} def={defs[name]} value={name in preview ? preview[name] : p[name]} disabled={!canEdit} onChange={(v) => set(name, v)} />;

  return (
    <Drawer title={creating ? (initial.variant_of ? `New colour of ${initial.variant_of}` : 'New product') : `${p.product_id}`} onClose={onClose} dirty={draft !== null}
      footer={canEdit && (
        <>
          <button type="button" className="a-btn" onClick={save} disabled={act.busy}>{creating ? 'Create' : 'Save'}</button>
          {!creating && !p.variant_of && <button type="button" className="a-btn a-btn-ghost" onClick={() => onAddVariant(p)}>Add colour version</button>}
          {draft && <span className="a-muted">Unsaved changes</span>}
        </>
      )}>
      {act.note}
      {/* Rows: ID / category / colour version of / position; specification; pack / featured order / swatch;
          the three switches on one line; spec status. */}
      <div className="a-prow a-prow-4">
        {F('product_id')}{F('category_key')}
        <ProductField name="variant_of" label={defs.variant_of.label} help={defs.variant_of.help} disabled={!canEdit} value={p.variant_of}
          products={cards.filter((c) => c.product_id !== p.product_id)} onChange={(v) => set('variant_of', v)} />
        {F('sort_order')}
      </div>
      <div className="a-prow">{F('specification')}</div>
      <div className={`a-prow a-prow-${showSwatch ? 3 : 2}`}>
        {F('pack')}{F('featured_order')}
        {showSwatch && (
          <div className="a-field">
            <span id="f-swatch-lbl">Swatch colour</span>
            <span className="a-swatch-row">
              {/* the card's colour dot, live; clicking it opens the colour picker */}
              <span className={`a-dot${hexOk ? '' : ' a-dot-empty'}`} style={{ '--c': hexOk ? hex : 'transparent' }} title="Pick a colour">
                <input type="color" value={hexOk ? hex.toLowerCase() : '#000000'} disabled={!canEdit} aria-label="Pick the swatch colour"
                  onChange={(e) => set('swatch_hex', e.target.value.toUpperCase())} />
              </span>
              <input id="f-swatch_hex" type="text" aria-labelledby="f-swatch-lbl" value={hex} placeholder="#RRGGBB" maxLength={7} disabled={!canEdit}
                aria-invalid={Boolean(swatchErr)} aria-describedby="f-swatch-msg" onChange={(e) => set('swatch_hex', e.target.value.trim() || null)} />
            </span>
            <small id="f-swatch-msg" className={swatchErr ? 'a-bad' : 'a-muted'}>{swatchErr || 'The colour dot on the product card.'}</small>
          </div>
        )}
      </div>
      <div className="a-prow a-pchecks">{F('is_featured')}{F('show_for_home')}{F('is_active')}</div>
      <div className="a-prow">{F('spec_status')}</div>
      <h3>Text per language</h3>
      <p className="a-muted">Empty cells show the default language on the site.</p>
      <TrEditor fields={TR_FIELDS} tr={p.tr || {}} main={p} disabled={!canEdit} onChange={(tr) => set('tr', tr)} strict={tried} />
      {!creating && <Photos product={loaded.data} canEdit={canEdit} onChanged={() => { loaded.reload(); onSaved(null); }} />}
    </Drawer>
  );
}

function Photos({ product, canEdit, onChanged }) {
  const images = product.images || [];
  const act = useAction();
  const [position, setPosition] = useState(String(Math.min(images.length + 1, 3)));
  const id = encodeURIComponent(product.product_id);
  const up = useUpload();
  const upload = (file) => act.run(async () => {
    const r = await up.send('photo', `/products/${id}/images`, file, { position });
    onChanged();
    return r;
  }).then((r) => r && act.setMsg({ kind: 'ok', text: `Saved ${r.file_name}: ${Math.round(r.original_bytes / 1024)} KB in -> ${Math.round(r.bytes / 1024)} KB WebP 1200x1200 (+ 400, 800)` }));
  const confirm = useConfirm();
  const remove = async (pos) => {
    if (!(await confirm({ title: `Remove photo ${pos}?`, message: 'The photo file is deleted. The other photos keep their order.', action: 'Remove', danger: true }))) return;
    act.run(async () => { await api.send('DELETE', `/products/${id}/images/${pos}`); onChanged(); }, 'Removed');
  };
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
            <select value={position} disabled={act.busy} onChange={(e) => setPosition(e.target.value)}>{[1, 2, 3].map((n) => <option key={n}>{n}</option>)}</select>
          </label>
          <UploadButton upload={up} uploadKey="photo" label="Upload photo (JPG / PNG / WebP, max 8 MB)" accept="image/jpeg,image/png,image/webp"
            className="a-btn a-btn-ghost" disabled={act.busy} onFile={upload} />
        </div>
      )}
      <Notice>A photo is fitted on white to 1200x1200 and saved as WebP of at most 150 KB.</Notice>
    </>
  );
}
