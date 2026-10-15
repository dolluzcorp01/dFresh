// Banners, Kits, Towns, Categories, Size picker, Form options (spec F 6-7): one list + editor per section,
// driven by the definitions below (they mirror backend admin-entities.js). Banners also take desktop / mobile
// photo uploads and drag-and-drop order; kits take their product list (tick in a list, drag to order); "Photo from
// product" shows that product's main photo as soon as it is picked; towns show a live map preview (pin + name).
import { isValidElement, useEffect, useMemo, useRef, useState } from 'react';
import { api, rowId } from './adminApi';
import { mediaUrl } from '../utils/api';
import { KitProducts, ProductField, RepPreview, Thumb, productName } from './ProductSelect';
import useOrderDraft from './useOrderDraft';
import { Drawer, Field, Loading, MissingBadges, TrEditor, missingTexts, useAction, useAdmin, useCan, useLoad } from './ui';
import { fontVar, loadFont } from '../i18n/fonts';
import { LAND, MAP_H, MAP_W } from '../shared/mapShape';

const KEY_HINT = 'Internal name (a-z, 0-9, -). Used in photo names, analytics and lead source.';
const RENAME_NOTE_BANNER = "The banner's texts, the leads from its form button and its history move to the new key; photos keep working. Analytics keeps the old key for earlier clicks.";
const KEY_INFO = "Not shown to visitors. 2 to 30 characters: lowercase a-z, digits 0-9 and hyphens. It starts the names of this banner's uploaded photo files, it is sent with the analytics click event (banner_click), and leads sent from this banner's form button record it as their source. Renaming moves the texts, those leads and the history to the new key in one step; analytics keeps the old key for earlier clicks.";
const ACTIVE = { name: 'is_active', label: 'Active', type: 'bool' };
// Banners, kits, categories: the position is set by dragging the rows (1, 2, 3 ...; a new row goes to the end)
const POSITION = { name: 'sort_order', label: 'Position', type: 'readonly', help: 'Drag the rows in the list to change it. A new one goes to the end.' };

const SECTIONS = {
  banners: {
    title: 'Banners', keys: ['banner_key'], reorder: true,
    fields: [
      { name: 'banner_key', label: 'Key', required: true, keyField: true, help: KEY_HINT, info: KEY_INFO }, POSITION,
      { name: 'theme', label: 'Theme', type: 'select', options: ['light', 'dark'], allowEmpty: false, help: 'dark = gold button on a dark photo' },
      { name: 'cta_action', label: 'Button action', type: 'select', options: ['products', 'products_home', 'products_category', 'section', 'form'], allowEmpty: false },
      { name: 'cta_target', label: 'Button target' }, // a dropdown that follows Button action (BannerTarget)
      { name: 'note', label: 'Internal note' }, ACTIVE,
    ],
    layout: 'banners', // drawer rows (Editor)
    rename: { field: 'banner_key', note: RENAME_NOTE_BANNER },
    tr: [
      { name: 'headline', label: 'Headline', required: true, long: true, help: '{count} = number of active products', info: '{count} becomes the number of active products on the site: main products only, not colour versions ({products} works too).' },
      { name: 'cta_label', label: 'Button label', required: true },
    ],
    list: (r) => [
      <BannerThumb r={r} kind="desktop" />, <BannerThumb r={r} kind="mobile" />,
      r.banner_key, r.tr?.en?.headline ?? '', r.theme, `${r.cta_action ?? ''}${r.cta_target ? `: ${r.cta_target}` : ''}`,
    ],
    head: ['Desktop', 'Mobile', 'Key', 'Headline (EN)', 'Theme', 'Button'],
    nameCol: 3, // the cell that carries the "TA missing" badges
    defaults: { theme: 'light', cta_action: 'products', is_active: 0 },
  },
  kits: {
    title: 'Business kits', keys: ['kit_key'], reorder: true,
    fields: [
      { name: 'kit_key', label: 'Key', required: true, keyField: true }, POSITION,
      { name: 'business_type', label: 'Business type (prefills the quote form)', type: 'select', lookup: 'businessTypes', allowEmpty: false },
      { name: 'rep_product_id', label: 'Photo from product', type: 'select', lookup: 'products' }, { ...ACTIVE, wide: true },
    ],
    tr: [{ name: 'name', label: 'Name', required: true }, { name: 'tagline', label: 'Tagline', required: true }],
    links: 'products', // drawer order: fields, Active, text per language, Selected (in order), Products (in order)
    list: (r) => [r.kit_key, r.tr?.en?.name ?? '', r.business_type, (r.products || []).join(', ')],
    nameCol: 1,
    head: ['Key', 'Name (EN)', 'Business type', 'Products'],
    defaults: { is_active: 1, products: [] },
  },
  towns: {
    title: 'Towns', keys: ['town_key'], reorder: true, layout: 'towns',
    rename: { field: 'town_key', note: "The town's names per language and its history move to the new key. Leads keep the town the visitor typed." },
    fields: [
      { name: 'town_key', label: 'Key', required: true, keyField: true, help: 'Internal name (a-z, 0-9, -). Not shown on the site.',
        info: "2 to 30 characters: lowercase a-z, digits 0-9 and hyphens. It ties the town's names per language and its history together. Leads keep the town name the visitor typed, never this key." },
      { name: 'sort_order', label: 'Order', type: 'readonly', help: 'Drag the rows in the list to change it.', info: 'The order of the town names under the map on the home page. A new town goes to the end.' },
      { name: 'map_x', label: 'Map x', type: 'number', step: '1', help: '0-600, left to right. Or drag the pin.' },
      { name: 'map_y', label: 'Map y', type: 'number', step: '1', help: '0-360, top to bottom. Or drag the pin.' },
      { name: 'label_dx', label: 'Name offset across', type: 'number', step: '1', help: '+ right, - left. Or drag the name.', info: 'Map units from the pin to the point the name is placed at.' },
      { name: 'label_dy', label: 'Name offset down', type: 'number', step: '1', help: '+ down, - up; -20 = just above.', info: 'Map units from the pin to the point the name is placed at. -20 puts the name just above the pin.' },
      { name: 'label_anchor', label: 'Name alignment', type: 'select', allowEmpty: false, help: 'Which part of the name sits at that point.', options: [
        { value: 'start', label: 'start (runs to the right)' }, { value: 'middle', label: 'middle (centred)' },
        { value: 'end', label: 'end (runs to the left)' },
      ] },
      { name: 'lat', label: 'Latitude', type: 'number', help: 'For Google: base town only.', info: "Only the godown base town's latitude and longitude are used: they go into the site's structured data for Google (LocalBusiness, geo). Other towns' values are not used anywhere yet." },
      { name: 'lng', label: 'Longitude', type: 'number', help: 'For Google: base town only.', info: "Only the godown base town's latitude and longitude are used (Google structured data)." },
      { name: 'is_base', label: 'Godown base', type: 'bool', info: 'The town the goods ship from: the dark pin with a star. One town only; ticking it here unticks the other.' },
      { name: 'is_active', label: 'Active (shown on the map)', type: 'bool' },
    ],
    tr: [{ name: 'name', label: 'Name', required: true }],
    list: (r) => [r.town_key, r.tr?.en?.name ?? '', r.is_base ? 'base' : '', r.map_x != null ? `${r.map_x}, ${r.map_y}` : ''],
    nameCol: 1,
    head: ['Key', 'Name (EN)', 'Base', 'Map'],
    defaults: { is_active: 1, label_dx: 0, label_dy: -20, label_anchor: 'middle' },
  },
  categories: {
    title: 'Categories', keys: ['category_key'], reorder: true,
    fields: [{ name: 'category_key', label: 'Key', required: true, keyField: true }, POSITION, { name: 'rep_product_id', label: 'Photo from product', type: 'select', lookup: 'products' }, ACTIVE],
    tr: [{ name: 'name', label: 'Name', required: true }],
    list: (r) => [r.category_key, r.tr?.en?.name ?? '', r.rep_product_id],
    nameCol: 1,
    head: ['Key', 'Name (EN)', 'Photo from'],
    defaults: { is_active: 1 },
  },
  'size-picker': {
    title: 'Size picker', keys: ['size_id'], reorder: true,
    hint: "Controls the 'Pick a size' napkin card in the For Business section. The 'Roll it out' card has no settings here.",
    fields: [
      { name: 'sort_order', label: 'Position', type: 'readonly', help: 'Drag the rows in the list to change it.' },
      { name: 'product_id', label: 'Product', type: 'select', lookup: 'products', allowEmpty: false, required: true },
      { name: 'size_label', label: 'Size label', required: true, help: 'e.g. 30×30 (filled from the product when empty)' },
      { name: 'scale', label: 'Drawing scale', type: 'number', step: '0.01', min: 0.1, max: 1, help: '1 = largest size. e.g. 20x20 vs 40x40 = 0.5', info: 'How big the drawing looks compared with the largest size (1 = largest). Suggested: size / largest size, e.g. 20x20 vs 40x40 = 0.5. From 0.1 to 1.' },
      { name: 'is_default', label: 'Selected first', type: 'bool' },
      { name: 'is_active', label: 'Active (shown on the site)', type: 'bool' },
    ],
    // drawer: one row of fields, one row of checkboxes
    rows: [['sort_order', 'product_id', 'size_label', 'scale'], ['is_default', 'is_active']],
    title1: (r) => r.size_label || 'size',
    list: (r, { products }) => {
      const p = products.find((x) => x.product_id === r.product_id);
      return [
        r.sort_order,
        <span className="a-prodcell">{p && <Thumb p={p} size={32} />}<code>{r.product_id}</code>{p ? productName(p) : ''}</span>,
        r.size_label, Number(r.scale).toFixed(2),
        r.is_default ? <span className="a-firstbadge">Selected first</span> : '',
      ];
    },
    head: ['Position', 'Product', 'Size label', 'Drawing scale', 'Selected first'],
    defaults: { scale: 0.5, is_active: 1 },
  },
  'form-options': {
    title: 'Form options', keys: ['list_key', 'option_value'], reorder: true, groupBy: 'list_key', layout: 'options',
    rename: { field: 'option_value', note: 'Kits that use it follow. Only possible while no lead uses it.' },
    fields: [
      { name: 'list_key', label: 'List', type: 'select', allowEmpty: false, keyField: true, help: 'Which dropdown on the site this option belongs to.' },
      { name: 'option_value', label: 'Stored value', required: true, keyField: true, help: 'a-z, 0-9 and _. Saved in leads.',
        info: 'What a lead stores (the label is only shown). It can change while no lead uses it; once a lead uses it, it stays, so old leads keep their label.' },
      { name: 'sort_order', label: 'Order', type: 'readonly', help: 'Drag the rows in the list to change it.' },
      { name: 'is_active', label: 'Active (shown in the form)', type: 'bool', info: 'Off = hidden from the form. Leads that already chose it keep it and still show its label.' },
    ],
    tr: [{ name: 'label', label: 'Label', required: true }],
    list: (r) => [r.option_value, r.tr?.en?.label ?? '', r.used ? `${r.used.leads} lead(s)${r.used.kits ? `, ${r.used.kits} kit(s)` : ''}` : ''],
    nameCol: 1,
    head: ['Stored value', 'Label (EN)', 'Used in'],
    defaults: { is_active: 1, list_key: 'business_type' },
  },
};

export default function EntityPage({ name }) {
  const cfg = SECTIONS[name];
  const list = useLoad(`/${name}`);
  const products = useLoad(cfg.fields.some((f) => f.lookup === 'products') || cfg.links || name === 'banners' ? '/products' : null);
  const cats = useLoad(name === 'banners' ? '/categories' : null);
  const uiText = useLoad(name === 'banners' || name === 'form-options' ? '/ui-text' : null); // banner eyebrow; option click paths
  const bannerRows = useLoad(name === 'form-options' ? '/banners' : null); // banners whose button opens a form
  const placesOf = (list) => optionPlaces(list, uiText.data, bannerRows.data || []);
  const { languages } = useAdmin();
  const [onlyMissing, setOnlyMissing] = useState(false);
  const missingOf = (r) => (cfg.tr ? missingTexts(r.tr, cfg.tr, languages) : []);
  const options = useLoad(cfg.fields.some((f) => f.lookup === 'businessTypes') ? '/form-options' : null);
  const canEdit = useCan('editor');
  const act = useAction();
  const [open, setOpen] = useState(null);
  const [drag, setDrag] = useState(null);

  const lookups = useMemo(() => ({
    products: (products.data || []).map((p) => ({ value: p.product_id, label: `${p.product_id} ${p.tr?.en?.name ?? ''}` })),
    businessTypes: (options.data || []).filter((o) => o.list_key === 'business_type').map((o) => o.option_value),
  }), [products.data, options.data]);

  // drag = a local order until "Save order" (useOrderDraft); the list shows it with the new positions
  // grouped lists (form options: one group per list) are dragged and saved per group
  const draft = useOrderDraft((scope, ids) => api.send('POST', `/${name}/reorder`, {
    order: ids.map(decodeURIComponent), ...(cfg.groupBy ? { list: scope.slice('group:'.length) } : {}),
  }), () => list.reload());
  const byId = new Map((list.data || []).map((r) => [rowId(cfg.keys, r), r]));
  const groupKeys = cfg.groupBy ? [...new Set((list.data || []).map((r) => r[cfg.groupBy]))] : [null];
  const groups = groupKeys.map((g) => {
    const scope = cfg.groupBy ? `group:${g}` : 'all';
    const savedIds = (list.data || []).filter((r) => !cfg.groupBy || r[cfg.groupBy] === g).map((r) => rowId(cfg.keys, r));
    const ids = draft.order(scope, savedIds);
    const rowsShown = ids.map((id, i) => byId.get(id) && (draft.order(scope, null) && 'sort_order' in byId.get(id) ? { ...byId.get(id), sort_order: i + 1 } : byId.get(id))).filter(Boolean);
    return { key: g, scope, savedIds, ids, rows: rowsShown };
  });
  const drop = (target, grp) => {
    if (!drag || drag.id === target || drag.scope !== grp.scope) return;
    const ids = [...grp.ids];
    const from = ids.indexOf(drag.id);
    ids.splice(ids.indexOf(target), 0, ids.splice(from, 1)[0]);
    setDrag(null);
    draft.set(grp.scope, ids, grp.savedIds);
  };
  const openDrawer = (o) => draft.guard(() => setOpen(o));

  return (
    <section>
      <h1>{cfg.title}</h1>
      {cfg.hint && <p className="a-muted a-pagehint">{cfg.hint}</p>}
      <div className="a-toolbar">
        {canEdit && <button type="button" className="a-btn" onClick={() => openDrawer({ create: true })}>Add</button>}
        {cfg.reorder && canEdit && <span className="a-muted">{onlyMissing ? 'Show all rows to drag them.' : 'Drag rows to change the order, then Save order.'}</span>}
        {cfg.tr && (
          <button type="button" className="a-chip" aria-pressed={onlyMissing} onClick={() => setOnlyMissing((x) => !x)}
            title="Only rows where an active language has an empty required text">
            Missing translations <b>{(list.data || []).filter((r) => missingOf(r).length).length}</b>
          </button>
        )}
      </div>
      {act.note}
      <Loading state={list}>
        <div className="a-scroll">
          <table className="a-table a-hover">
            <thead><tr>{cfg.reorder && <th />}{cfg.head.map((h) => <th key={h}>{h}</th>)}<th>Active</th></tr></thead>
            {groups.map((grp) => (
            <tbody key={grp.scope}>
              {cfg.groupBy && (
                <tr className="a-group"><th colSpan={cfg.head.length + 2}>
                  <PlacesList places={placesOf(grp.key)} listKey={grp.key} />
                </th></tr>
              )}
              {grp.rows.filter((r) => !onlyMissing || missingOf(r).length).map((r) => {
                const id = rowId(cfg.keys, r);
                const missing = missingOf(r);
                return (
                  <tr key={id} className={`${r.is_active === 0 ? 'a-off' : ''}${drag && drag.id === id ? ' a-dragging' : ''}`} onClick={() => openDrawer({ id })} tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && openDrawer({ id })}
                    draggable={cfg.reorder && canEdit && !onlyMissing} onDragStart={() => setDrag({ id, scope: grp.scope })}
                    onDragOver={(e) => { if (drag && drag.scope === grp.scope) e.preventDefault(); }} onDrop={() => drop(id, grp)}
                    onDragEnd={() => setDrag(null)}>
                    {cfg.reorder && <td className="a-handle" aria-hidden="true">{onlyMissing ? '' : '⠿'}</td>}
                    {cfg.list(r, { products: products.data || [] }).map((v, i) => (
                      <td key={i}>
                        {v === null || v === undefined ? '' : isValidElement(v) ? v : String(v)}
                        {i === cfg.nameCol && <MissingBadges missing={missing} />}
                      </td>
                    ))}
                    <td>{r.is_active === undefined ? '' : r.is_active ? 'Yes' : 'No'}</td>
                  </tr>
                );
              })}
            </tbody>
            ))}
          </table>
        </div>
      </Loading>
      {open && (
        <Editor name={name} cfg={cfg} id={open.id} lookups={lookups} products={products.data || []} rows={list.data || []} lists={groupKeys} onClose={() => setOpen(null)}
          onSaved={(id) => { list.reload(); setOpen(id ? { id } : null); }} cats={cats.data || []} uiText={uiText.data} placesOf={placesOf} />
      )}
      {draft.ui}
    </section>
  );
}

function Editor({ name, cfg, id, lookups, products, rows, lists, cats, uiText, placesOf, onClose, onSaved }) {
  const loaded = useLoad(id ? `/${name}/${id}` : null);
  const canEdit = useCan('editor');
  const act = useAction();
  const [draft, setDraft] = useState(null);
  const creating = !id;
  const row = draft || (creating ? { tr: {}, ...cfg.defaults } : loaded.data);
  const set = (k, v) => {
    const next = { ...row, [k]: v };
    // size picker: a picked product fills an empty size label from its own size (e.g. 20×20)
    if (name === 'size-picker' && k === 'product_id' && !String(row.size_label || '').trim()) {
      const size = sizeOf(products.find((p) => p.product_id === v));
      if (size) next.size_label = size;
    }
    // banners: a new Button action keeps the target if it is still one of its choices, else takes its first choice
    if (name === 'banners' && k === 'cta_action') {
      const choices = targetChoices(v, cats);
      if (!choices.some((c) => c.value === row.cta_target)) next.cta_target = choices.length ? choices[0].value : null;
    }
    setDraft(next);
  };

  const [preview, setPreview] = useState(null); // banners: 'desktop' | 'mobile' while the large preview is open
  const [newList, setNewList] = useState(false); // form options: typing a new list key instead of picking one
  const rn = cfg.rename && cfg.rename.field;
  const keyChanged = Boolean(rn && !creating && loaded.data && String(row[rn] ?? '').trim() !== String(loaded.data[rn]));
  const save = () => {
    // towns: latitude / longitude inside India, or nothing is sent
    if (name === 'towns') {
      const bad = geoErrors(row);
      if (bad.lat || bad.lng) { act.setMsg({ kind: 'error', text: [bad.lat, bad.lng].filter(Boolean).join(' ') }); return undefined; }
    }
    if (keyChanged && !window.confirm(`Rename "${loaded.data[rn]}" to "${String(row[rn]).trim()}"?\n\nRenaming updates all references. ${cfg.rename.note}`)) return undefined;
    return act.run(async () => {
      const saved = creating ? await api.send('POST', `/${name}`, row) : await api.send('PUT', `/${name}/${id}`, row);
      setDraft(null);
      if (!creating) loaded.setData(saved);
      onSaved(creating || keyChanged ? rowId(cfg.keys, saved) : null);
    }, 'Saved');
  };
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

  function renderField(f) {
    const def = { ...f, type: f.keyField && !creating ? 'readonly' : f.type, options: f.lookup ? lookups[f.lookup] : f.options };
    if (name === 'banners' && f.name === 'cta_target') {
      return <Field key={f.name} def={{ ...def, type: 'select', options: targetChoices(row.cta_action, cats), allowEmpty: false, required: true }} value={row.cta_target ?? ''} disabled={!canEdit} onChange={(v) => set(f.name, v)} />;
    }
    if (name === 'size-picker' && f.name === 'scale') {
      return (
        <div key={f.name} className="a-scalefield">
          <Field def={def} value={row[f.name]} disabled={!canEdit} onChange={(v) => set(f.name, v)} />
          <ScalePreview scale={row[f.name]} />
        </div>
      );
    }
    if (f.lookup !== 'products') return <Field key={f.name} def={def} value={row[f.name]} disabled={!canEdit} onChange={(v) => set(f.name, v)} />;
    // a product: the photo picker; "Photo from product" also shows the larger photo (kits: their own products first)
    const picker = (
      <ProductField key={f.name} name={f.name} label={f.label} help={f.help} required={f.required} products={products} value={row[f.name]}
        allowEmpty={f.allowEmpty !== false} disabled={!canEdit} onChange={(v) => set(f.name, v)}
        top={cfg.links && (row.products || []).length ? { label: 'In this kit', ids: row.products } : null} />
    );
    if (f.name !== 'rep_product_id') return picker;
    return <div key={f.name} className="a-repfield">{picker}<RepPreview product={products.find((p) => p.product_id === row[f.name])} /></div>;
  }

  return (
    <Drawer title={creating ? `New - ${cfg.title}` : `${cfg.title}: ${cfg.title1 ? cfg.title1(row) : decodeURIComponent(id).replace('~', ' / ')}`} onClose={onClose}
      footer={canEdit && (
        <>
          <button type="button" className="a-btn" onClick={save} disabled={act.busy}>{creating ? 'Create' : 'Save'}</button>
          {!creating && <button type="button" className="a-btn a-btn-danger" onClick={remove} disabled={act.busy}>Delete</button>}
        </>
      )}>
      {act.note}
      {cfg.layout === 'banners' ? (() => {
        // Key | Position | Theme | Button action, then Internal note (cols 1-3) | Button target (col 4, only when the
        // action has targets; else the note takes the full row), then Active
        const fld = (n, extra) => renderField({ ...cfg.fields.find((x) => x.name === n), ...extra });
        const hasTarget = targetChoices(row.cta_action, cats).length > 0;
        return (
          <>
            <div className="a-prow a-prow-4">
              {fld('banner_key', { keyField: false })}{fld('sort_order')}{fld('theme')}
              {fld('cta_action', { help: `Button opens: ${buttonOpens(row, cats)}` })}
            </div>
            {keyChanged && <p className="a-replace-note">Renaming updates all references. {cfg.rename.note}</p>}
            <div className={`a-prow a-prow-4 a-banrow2${hasTarget ? '' : ' a-notarget'}`}>
              <div className="a-banote">{fld('note')}</div>
              {hasTarget && fld('cta_target')}
            </div>
            <div className="a-prow a-pchecks">{fld('is_active')}</div>
          </>
        );
      })() : cfg.layout === 'towns' ? (() => {
        // Key | Order, Latitude | Longitude, then the two checkboxes; the map fields sit next to the map (below)
        const fld = (n, extra) => renderField({ ...cfg.fields.find((x) => x.name === n), ...extra });
        const bad = geoErrors(row);
        return (
          <>
            <div className="a-prow a-prow-2">{fld('town_key', { keyField: false })}{fld('sort_order')}</div>
            {keyChanged && <p className="a-replace-note">Renaming updates all references. {cfg.rename.note}</p>}
            <div className="a-prow a-prow-2">{fld('lat', { error: bad.lat })}{fld('lng', { error: bad.lng })}</div>
            <div className="a-prow a-pchecks">{fld('is_base')}{fld('is_active')}</div>
            <BaseNote row={row} rows={rows} />
          </>
        );
      })() : cfg.layout === 'options' ? (() => {
        const fld = (n, extra) => renderField({ ...cfg.fields.find((x) => x.name === n), ...extra });
        const used = (loaded.data && loaded.data.used) || { leads: 0, kits: 0 };
        const listOptions = lists.map((l) => ({ value: l, label: (OPTION_LISTS[l] || {}).title ? `${OPTION_LISTS[l].title} (${l})` : l }));
        const listField = creating && newList
          ? fld('list_key', { type: 'text', keyField: false, label: 'New list key', help: 'a-z, 0-9 and _, e.g. delivery_slot. A form must use it to show it.' })
          : fld('list_key', { type: 'select', keyField: false, locked: !creating, options: listOptions, help: creating ? 'Which dropdown on the site it belongs to.' : 'Fixed once created.' });
        return (
          <>
            {row.list_key && placesOf && <div className="a-placeshint"><PlacesList places={placesOf(row.list_key)} listKey={row.list_key} /></div>}
            <div className="a-prow a-prow-3">
              <div className="a-fieldplus">
                {listField}
                {creating && canEdit && (
                  <button type="button" className="a-link" onClick={() => { setNewList((x) => !x); set('list_key', newList ? (lists[0] || '') : ''); }}>
                    {newList ? 'Pick an existing list' : 'New list'}
                  </button>
                )}
              </div>
              {fld('option_value', creating || used.leads === 0
                ? { keyField: false, ...(creating ? {} : { help: used.kits ? `Not in any lead; ${used.kits} kit(s) use it (they follow a rename).` : 'Not used in any lead yet: can still change.' }) }
                : { help: `Used in ${used.leads} lead(s): cannot change.` })}
              {fld('sort_order')}
            </div>
            <div className="a-prow a-pchecks">{fld('is_active')}</div>
          </>
        );
      })() : cfg.rows ? cfg.rows.map((names, i) => (
        <div key={names.join()} className={`a-prow ${i === 0 ? `a-prow-${names.length}` : 'a-pchecks'}`}>
          {names.map((n) => renderField(cfg.fields.find((f) => f.name === n)))}
        </div>
      )) : <div className="a-grid2">{cfg.fields.map(renderField)}</div>}
      {name === 'size-picker' && <DefaultNote row={row} rows={rows} />}
      {cfg.tr && (
        <div className="a-dsec">
          <h3>Text per language</h3>
          <TrEditor fields={cfg.tr} tr={row.tr || {}} disabled={!canEdit} onChange={(tr) => set('tr', tr)} />
          {name === 'banners' && <HeadlinePreview tr={row.tr || {}} count={liveCount(products, cats)} />}
        </div>
      )}
      {cfg.links && (
        <KitProducts all={products} value={row.products || []} disabled={!canEdit} onChange={(v) => set('products', v)} />
      )}
      {name === 'towns' && (
        <div className="a-dsec">
          <h3>Map preview</h3>
          <div className="a-townmapsec">
            <TownPreview rows={rows} town={row} selfKey={loaded.data ? loaded.data.town_key : null} disabled={!canEdit} onMove={(patch) => setDraft({ ...row, ...patch })} />
            {/* next to the map (below it in a narrower drawer); live-linked to dragging the pin and the name */}
            <div className="a-townside">
              <div className="a-prow a-prow-2">{renderField(cfg.fields.find((x) => x.name === 'map_x'))}{renderField(cfg.fields.find((x) => x.name === 'map_y'))}</div>
              <div className="a-prow a-prow-2">{renderField(cfg.fields.find((x) => x.name === 'label_dx'))}{renderField(cfg.fields.find((x) => x.name === 'label_dy'))}</div>
              <div className="a-prow">{renderField(cfg.fields.find((x) => x.name === 'label_anchor'))}</div>
            </div>
          </div>
        </div>
      )}
      {name === 'banners' && !creating && (
        <>
          <h3>Photos (text-free)</h3>
          <div className="a-photos">
            {[['desktop', '1920x800'], ['mobile', '1080x1350']].map(([kind, size]) => (
              <figure key={kind}>
                {row[`${kind}_file`]
                  ? (
                    <button type="button" className="a-photobtn" onClick={() => setPreview(kind)} aria-label={`Preview the ${kind} banner as on the site`}>
                      <img src={mediaUrl(`/media/banners/${kind}/${row[`${kind}_file`]}`)} alt={`${kind} banner`} className={`a-banner-${kind}`} />
                    </button>
                  )
                  : <p className="a-bad">No {kind} photo</p>}
                {row.photo_check && !row.photo_check[kind].ok && row[`${kind}_file`] && <p className="a-bad">Photo problem: {row.photo_check[kind].problem}</p>}
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
      {preview && <BannerPreview row={row} start={preview} count={liveCount(products, cats)} ui={uiText} onClose={() => setPreview(null)} />}
    </Drawer>
  );
}

const BANNER_SIZE = { desktop: [1920, 800], mobile: [1080, 1350] };

// Banners list: one photo column per kind (desktop 96x54, mobile 43x54), each with its own warning when that photo is
// missing or not its exact size (the server reads the files: photo_check).
function BannerThumb({ r, kind }) {
  const file = r[`${kind}_file`];
  const check = r.photo_check && r.photo_check[kind];
  const bad = check && !check.ok;
  return (
    <span className="a-bthumbcell">
      {file
        ? <img className={`a-bthumb a-bthumb-${kind}`} src={mediaUrl(`/media/banners/${kind}/${file}`)} alt="" loading="lazy" />
        : <span className={`a-bthumb a-bthumb-${kind} a-thumb-none`} aria-hidden="true" />}
      {bad && <span className="a-warnbadge" title={`${kind}: ${check.problem}`}>{/missing|not found/.test(check.problem) ? 'Photo missing' : 'Wrong size'}</span>}
    </span>
  );
}

// The large preview: the photo with the eyebrow, headline and button over it as the site lays them out (same type
// scale, scaled to the frame), theme applied, in the chosen language (its own font from languages.font_family).
function BannerPreview({ row, start, count, ui, onClose }) {
  const { languages } = useAdmin();
  const def = languages.find((l) => Number(l.is_default) === 1) || languages[0] || { lang_code: 'en' };
  const langs = languages.filter((l) => Number(l.is_active) === 1 || l === def);
  const [kind, setKind] = useState(start);
  const [lang, setLang] = useState(def.lang_code);
  const L = languages.find((l) => l.lang_code === lang) || def;
  const closeRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => { loadFont(L.font_family); }, [L.font_family]);
  useEffect(() => {
    if (closeRef.current) closeRef.current.focus();
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); onCloseRef.current(); } };
    window.addEventListener('keydown', onKey, true); // before the drawer's own Esc
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const tr = (row.tr || {})[lang] || (row.tr || {})[def.lang_code] || {};
  const fill = (v) => String(v || '').replace(/\{(count|products)\}/g, String(count));
  const bnk = ((ui && ui.keys) || []).find((k) => k.text_key === 'bn_k');
  const eyebrow = bnk ? bnk.values[lang] || bnk.values[def.lang_code] || '' : '';
  const file = row[`${kind}_file`];
  const long = L.font_family && def.font_family && L.font_family !== def.font_family; // the site's "long script" sizes
  return (
    <div className="a-bp-wrap" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="a-bp-box" role="dialog" aria-modal="true" aria-label={`Banner preview: ${row.banner_key}`}>
        <div className="a-bp-bar">
          <span className="a-seg" role="tablist" aria-label="Photo">
            {['desktop', 'mobile'].map((k) => (
              <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)}>
                {k === 'desktop' ? 'Desktop' : 'Mobile'} <small>{BANNER_SIZE[k].join('x')}</small>
              </button>
            ))}
          </span>
          <span className="a-seg" role="group" aria-label="Language">
            {langs.map((l) => <button key={l.lang_code} type="button" aria-pressed={lang === l.lang_code} onClick={() => setLang(l.lang_code)}>{l.lang_code.toUpperCase()}</button>)}
          </span>
          <span className="a-muted a-bp-note">{row.theme === 'dark' ? 'Dark theme: light text, gold button' : 'Light theme: ink text and button'}</span>
          <button ref={closeRef} type="button" className="a-x" onClick={onClose} aria-label="Close the preview">×</button>
        </div>
        <div className={`a-bp a-bp-${kind}${row.theme === 'dark' ? ' a-bp-dark' : ''}${long ? ' a-bp-long' : ''}`} lang={L.html_lang || lang} dir={L.dir || 'ltr'}
          style={{ '--bp-font': fontVar(L.font_family) || '"Open Sans"', '--bp-disp': long && fontVar(L.font_family) ? `${fontVar(L.font_family)}, "Saira"` : '"Saira"' }}>
          {file ? <img src={mediaUrl(`/media/banners/${kind}/${file}`)} alt="" /> : <div className="a-bp-none">No {kind} photo</div>}
          <div className="a-bp-cap">
            <div className="a-bp-ci">
              <p className="a-bp-k">{eyebrow}</p>
              <h2>{fill(tr.headline)}</h2>
              <span className="a-bp-btn">{fill(tr.cta_label)} <span aria-hidden="true">→</span></span>
            </div>
          </div>
        </div>
        {row.photo_check && !row.photo_check[kind].ok && <p className="a-bad">This photo: {row.photo_check[kind].problem}</p>}
      </div>
    </div>
  );
}

// Form option lists: which form field shows each list (src/forms/formConfig.js + shared/rules.json), and where on the
// site each form opens (every openForm() call: header menu, sections, product cards, footer, banners). The click paths
// are built from the live English site texts (Translations), so they follow any wording change.
const OPTION_LISTS = {
  business_type: { title: 'Business type', forms: ['quote', 'sample'], field: 'fl_type', extra: [['Business kits', 'Business type (pre-fills the free sample form)']] },
  monthly_sales: { title: 'Monthly sales', forms: ['distributor'], field: 'fl_sales' },
  yes_no: { title: 'Yes / No', forms: ['distributor'], field: 'fl_gd' },
};
// [form, path]: a path step is a site text key ({ t }) or a plain place name (admin only, never shown on the site)
const FORM_OPENERS = [
  ['sample', [{ t: 'nav_business' }, 'kit card', { t: 'sample' }]], // BusinessKits.js
  ['quote', [{ t: 'nav_products' }, 'product card', { t: 'request_quote' }]], // FlipCard.js in the products drawer / page
  ['quote', [{ t: 'feat_h' }, 'product card', { t: 'request_quote' }]], // FlipCard.js in the featured rail
  ['sample', [{ t: 'nav_contact' }, { t: 'sample' }]], // ContactBand.js
  ['distributor', [{ t: 'nav_where' }, { t: 'become_distributor' }]], // WhereMap.js
  ['quote', ['Phone menu', { t: 'request_quote' }]], // MobileMenu.js
  ['distributor', ['Phone menu', { t: 'become_distributor' }]], // MobileMenu.js
  ['quote', ['Footer', { t: 'f_work' }, { t: 'request_quote' }]], // Footer.js
  ['distributor', ['Footer', { t: 'f_work' }, { t: 'become_distributor' }]], // Footer.js
];
function optionPlaces(list, ui, banners) {
  const cfg = OPTION_LISTS[list];
  if (!cfg) return [];
  const text = (k) => {
    const row = ui && (ui.keys || []).find((x) => x.text_key === k);
    return (row && (row.values[ui.default] || row.values.en)) || k;
  };
  const step = (x) => (typeof x === 'string' ? x : text(x.t));
  const field = text(cfg.field);
  const lines = FORM_OPENERS.filter(([form]) => cfg.forms.includes(form)).map(([, path]) => [...path.map(step), field].join(' > '));
  for (const b of banners) {
    if (b.is_active && b.cta_action === 'form' && cfg.forms.includes(b.cta_target)) {
      lines.push(['Home banner', `"${b.tr?.en?.headline ?? b.banner_key}"`, b.tr?.en?.cta_label ?? b.cta_target, field].join(' > '));
    }
  }
  return [...lines, ...(cfg.extra || []).map((p) => p.join(' > '))];
}
function PlacesList({ places, listKey }) {
  return (
    <span className="a-places">
      {places.length ? places.map((p) => <span key={p} className="a-place">{p}</span>) : <span className="a-place">Not used by any form yet</span>}
      <span className="a-muted a-placekey">{listKey}</span>
    </span>
  );
}

// Towns: latitude 6-37 and longitude 68-98 (India); empty is allowed. Same limits in the API (Admin_server.js).
const GEO = { lat: [6, 37, 'Latitude'], lng: [68, 98, 'Longitude'] };
function geoErrors(row) {
  const out = {};
  for (const [k, [min, max, label]] of Object.entries(GEO)) {
    const v = row[k];
    if (v === null || v === undefined || String(v).trim() === '') continue;
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) out[k] = `${label} must be a number from ${min} to ${max} (India).`;
  }
  return out;
}

// Towns: ticking Godown base here replaces the town that has it now (the server unticks that one).
function BaseNote({ row, rows }) {
  if (!Number(row.is_base)) return null;
  const other = rows.find((r) => Number(r.is_base) === 1 && r.town_key !== row.town_key);
  if (!other) return null;
  return <p className="a-replace-note">This replaces {other.tr?.en?.name || other.town_key} as the godown base.</p>;
}

// Banners: what Button target can be for each Button action (validated again by the API, Admin_server.js).
const SECTION_TARGETS = ['business', 'where', 'about', 'contact', 'products'];
const FORM_TARGETS = ['sample', 'quote', 'distributor'];
function targetChoices(action, cats) {
  if (action === 'products_category') return cats.map((c) => ({ value: c.category_key, label: `${c.tr?.en?.name ?? c.category_key}${c.is_active ? '' : ' (not active)'}` }));
  if (action === 'section') return SECTION_TARGETS.map((s) => ({ value: s, label: s }));
  if (action === 'form') return FORM_TARGETS.map((s) => ({ value: s, label: s }));
  return []; // products, products_home: no target
}
function buttonOpens(row, cats) {
  const t = row.cta_target;
  switch (row.cta_action) {
    case 'products': return 'the products drawer (all products)';
    case 'products_home': return 'the products drawer, "For Home" filter';
    case 'products_category': {
      const c = cats.find((x) => x.category_key === t);
      return t ? `${c ? c.tr?.en?.name ?? t : t} category` : 'pick a category';
    }
    case 'section': return t ? (t === 'products' ? 'the products drawer (the Products link)' : `the "${t}" section of the home page`) : 'pick a section';
    case 'form': return t ? `the ${t} form` : 'pick a form';
    default: return '-';
  }
}

// {count} in a banner headline: active main products (not colour versions) in active categories, as on the site.
function liveCount(products, cats) {
  const on = new Set(cats.filter((c) => c.is_active).map((c) => c.category_key));
  return products.filter((p) => !p.variant_of && p.is_active && on.has(p.category_key)).length;
}
function HeadlinePreview({ tr, count }) {
  const used = Object.entries(tr).filter(([, t]) => t && /\{(count|products)\}/.test(t.headline || ''));
  if (!used.length) return null;
  return (
    <p className="a-muted a-ctaprev">
      On the site now ({count} active products):{' '}
      {used.map(([lang, t], i) => (
        <span key={lang} lang={lang}>{i ? ' · ' : ''}<code>{lang}</code> {t.headline.replace(/\{(count|products)\}/g, String(count))}</span>
      ))}
    </p>
  );
}

// Size picker: a product's size from its name or specification ("20×20", "20 x 20 cm" -> "20×20").
function sizeOf(p) {
  if (!p) return null;
  const m = /(\d+)\s*[×xX]\s*(\d+)/.exec(`${p.tr?.en?.name ?? ''} ${p.specification ?? ''}`);
  return m ? `${m[1]}×${m[2]}` : null;
}

// Size picker: the napkin drawing at this scale inside the outline of the largest size (1).
function ScalePreview({ scale }) {
  const n = Number(scale);
  const ok = Number.isFinite(n) && n >= 0.1 && n <= 1;
  return (
    <figure className="a-scaleprev" aria-label={ok ? `Drawing at ${Math.round(n * 100)}% of the largest size` : 'Scale must be 0.1 to 1'}>
      <span className="a-scaleprev-max" aria-hidden="true">
        {ok && <span className="a-scaleprev-nap" style={{ width: `${n * 100}%`, height: `${n * 100}%` }} />}
      </span>
      <figcaption className={ok ? 'a-muted' : 'a-bad'}>{ok ? `${Math.round(n * 100)}%` : '0.1 - 1'}</figcaption>
    </figure>
  );
}

// Size picker: ticking "Selected first" here replaces the size that has it now (the server unticks that one).
function DefaultNote({ row, rows }) {
  if (!Number(row.is_default)) return null;
  const other = rows.find((r) => Number(r.is_default) === 1 && r.size_id !== row.size_id);
  if (!other) return null;
  return <p className="a-replace-note">This replaces {other.size_label} as the first selected size.</p>;
}

// Towns: the site's map (same land, pins and name sizes as src/home/WhereMap.js) with the town being edited drawn from
// the unsaved values: drag its pin to set Map x / y, drag its name to set the name offsets (the fields follow live).
// Other active towns are shown faded. Nothing is saved until Save.
function TownPreview({ rows, town, selfKey, onMove, disabled }) {
  const svgRef = useRef(null);
  const [dragging, setDragging] = useState(null); // 'pin' | 'name'
  const name = (t) => (t.tr && t.tr.en && t.tr.en.name) || t.town_key || '';
  const placed = (t) => t.map_x !== null && t.map_x !== undefined && t.map_x !== '' && t.map_y !== null && t.map_y !== undefined && t.map_y !== '';
  const others = rows.filter((t) => t.town_key !== (selfKey || town.town_key) && t.is_active && placed(t)); // saved key: a typed new key must not show the town twice
  const at = (e) => {
    const svg = svgRef.current;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.round(Math.min(MAP_W, Math.max(0, p.x))), y: Math.round(Math.min(MAP_H, Math.max(0, p.y))) };
  };
  const start = (what) => (e) => {
    if (disabled) return;
    e.preventDefault();
    svgRef.current.setPointerCapture(e.pointerId);
    setDragging(what);
  };
  const move = (e) => {
    if (!dragging) return;
    const p = at(e);
    if (dragging === 'pin') onMove({ map_x: p.x, map_y: p.y });
    else onMove({ label_dx: p.x - Number(town.map_x), label_dy: p.y - Number(town.map_y) });
  };
  const pin = (t, current) => {
    const x = Number(t.map_x);
    const y = Number(t.map_y);
    const base = Number(t.is_base) === 1;
    return (
      <g key={t.town_key || 'new'} opacity={current ? 1 : 0.35} className={current && !disabled ? 'a-tp-cur' : undefined}>
        <circle cx={x} cy={y} r={base ? 11 : 7} fill={base ? '#121214' : '#E5BF24'} stroke="#fff" strokeWidth="3"
          {...(current ? { onPointerDown: start('pin'), 'data-drag': 'pin' } : {})} />
        <text x={x + Number(t.label_dx || 0)} y={y + Number(t.label_dy || 0)} textAnchor={t.label_anchor || 'middle'}
          fontFamily="Saira, sans-serif" fontWeight="700" fontSize="18" fill="#121214"
          {...(current ? { onPointerDown: start('name'), 'data-drag': 'name' } : {})}>{name(t)}{base ? ' ★' : ''}</text>
      </g>
    );
  };
  return (
    <figure className="a-townmap">
      <svg ref={svgRef} viewBox={`0 0 ${MAP_W} ${MAP_H}`} role="img" aria-label="Preview of the delivery map"
        onPointerMove={move} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}
        className={dragging ? 'a-tp-dragging' : undefined}>
        <path d={LAND} fill="#FFF3CF" stroke="#EEE4C8" strokeWidth="2" />
        {others.map((t) => pin(t, false))}
        {placed(town) ? pin(town, true) : null}
      </svg>
      <figcaption className="a-muted">
        {placed(town)
          ? `${disabled ? '' : 'Drag the pin or the name to move them. '}This town in full colour, the others faded. Not saved until you press Save.`
          : 'Enter Map x and Map y to place this town.'}
      </figcaption>
    </figure>
  );
}
