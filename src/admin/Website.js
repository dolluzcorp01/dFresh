// Section 18 Website pages (phase 24, built to the owner's field map docs/claude-tasks/done/phase-24-field-map.md):
// Home doors, Most loved, Form rules, Where we deliver map, Menu links, Visit cards, Google and sharing, Site settings.
// Shared rule (field map step 1): a value that comes from the server or another page is shown read only with where it
// comes from and a link there; a text per language that lives in Translations is shown and edited here too (PageTexts),
// writing the same ui_text rows: one source, two ways in. Rights: the Content row (view / edit / create / delete).
// Admin words only: every word a visitor sees is a Translations text or a row the Admin types (CLAUDE.md rule 1).
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './adminApi';
import { Drawer, Field, InfoCard, Loading, PageHead, Pill, TrEditor, useAction, useAdmin, useCan, useConfirm, useLeaveGuard, useLoad } from './ui';
import { KitProducts, ProductSelect } from './ProductSelect';
import MapPreview, { placed } from './MapPreview';
import useOrderDraft from './useOrderDraft';
import { SettingsTable } from './Settings';
import { MAP_H, MAP_W } from '../shared/mapShape';

// ------------------------------------------------------------------ shared blocks

/**
 * Translations texts used on this page, editable here (same ui_text rows as Website > Words and languages > Translations).
 * keys: the text keys in order, or group: a Translations group. One box per language; Save writes the changed boxes.
 */
export function PageTexts({ keys, group, title = 'Texts on the site (per language)', note }) {
  const grid = useLoad('/ui-text');
  const { languages } = useAdmin();
  const canEdit = useCan('content', 'edit');
  const act = useAction();
  const [edits, setEdits] = useState({}); // `${key}|${lang}` -> value
  useLeaveGuard(Object.keys(edits).length > 0);
  const rows = useMemo(() => {
    const all = (grid.data && grid.data.keys) || [];
    if (group) return all.filter((k) => k.group_name === group);
    const by = new Map(all.map((k) => [k.text_key, k]));
    return (keys || []).map((k) => by.get(k)).filter(Boolean);
  }, [grid.data, keys, group]);
  const val = (k, l) => (`${k.text_key}|${l}` in edits ? edits[`${k.text_key}|${l}`] : k.values[l] || '');
  const set = (k, l, v) => setEdits((e) => {
    const n = { ...e };
    if (v === (k.values[l] || '')) delete n[`${k.text_key}|${l}`]; else n[`${k.text_key}|${l}`] = v;
    return n;
  });
  const save = () => act.run(async () => {
    for (const id of Object.keys(edits)) {
      const [key, lang] = id.split('|');
      await api.send('PUT', `/ui-text/${encodeURIComponent(key)}/${lang}`, { value: edits[id] });
    }
    setEdits({});
    grid.reload();
  }, 'Texts saved: the site shows them on the next load');
  const changed = Object.keys(edits).length;
  return (
    <section className="a-card a-wtexts" aria-label={title}>
      <h2>{title}</h2>
      <p className="a-muted">{note || 'The same texts as on '}{!note && <Link to="/admin/translations">Translations</Link>}{!note && ': a change here changes them there too. An empty box in a language shows the default language on the site.'}</p>
      {act.note}
      <Loading state={grid}>
        <div className="a-scroll">
          <table className="a-table a-wtexts-t">
            <thead><tr><th>Text</th>{languages.map((l) => <th key={l.lang_code}>{l.name_en} <code>{l.lang_code}</code></th>)}</tr></thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k.text_key}>
                  <td><code>{k.text_key}</code><br /><small className="a-muted">{k.description}</small></td>
                  {languages.map((l) => {
                    const v = val(k, l.lang_code);
                    const long = v.length > 70 || (k.max_chars || 0) > 160;
                    const props = { value: v, dir: l.dir, disabled: !canEdit || (k.default_only && Number(l.is_default) !== 1), maxLength: k.max_chars || undefined,
                      'aria-label': `${k.text_key} (${l.lang_code})`, className: `${k.text_key}|${l.lang_code}` in edits ? 'a-changed' : undefined,
                      onChange: (e) => set(k, l.lang_code, e.target.value) };
                    return <td key={l.lang_code}>{long ? <textarea rows={3} {...props} /> : <input type="text" {...props} />}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className="a-row a-wtexts-b">
            <button type="button" className="a-btn" onClick={save} disabled={act.busy || !changed}>Save texts{changed ? ` (${changed})` : ''}</button>
            {changed > 0 && <button type="button" className="a-btn a-btn-ghost" onClick={() => setEdits({})} disabled={act.busy}>Cancel</button>}
          </div>
        )}
      </Loading>
    </section>
  );
}

/** a value from another page: read only, with where it comes from and a link there */
function FromElsewhere({ label, value, from, to }) {
  return (
    <div className="a-field a-ro">
      <span>{label}</span>
      <input type="text" value={value || ''} readOnly disabled aria-label={label} />
      <small className="a-hint">Read only. Changed on <Link to={to}>{from}</Link>.</small>
    </div>
  );
}

// where a door or a banner button goes: the shared list (src/shared/siteTargets.js), so it can never break
const ACTION_LABEL = {
  products: 'All products (the products drawer)', products_home: 'Products, "For Home" filter', products_category: 'A category',
  section: 'A home page section', form: 'A form',
};
const SECTION_LABEL = { business: 'For Business', where: 'Where we deliver', about: 'About', contact: 'Contact', products: 'Products (the drawer)', range: 'The range', moods: 'Moods' };
const FORM_LABEL = { sample: 'Free sample', quote: 'Quote', distributor: 'Become a distributor' };
const PAGE_LABEL = { products: 'Products (the drawer)', privacy: 'Privacy policy', terms: 'Terms' };

function targetsOf(action, choices, cats) {
  if (action === 'products_category') return cats.map((c) => ({ value: c.category_key, label: `${c.name}${c.is_active ? '' : ' (not active)'}` }));
  if (action === 'section') return choices.sections.map((s) => ({ value: s, label: SECTION_LABEL[s] || s }));
  if (action === 'form') return choices.forms.map((f) => ({ value: f, label: FORM_LABEL[f] || f }));
  return [];
}
function TargetPicker({ id, value, choices, cats, onChange, disabled, error }) {
  const list = targetsOf(value.action, choices, cats);
  const pickAction = (a) => {
    const next = targetsOf(a, choices, cats);
    onChange({ action: a, target: next.some((x) => x.value === value.target) ? value.target : (next[0] ? next[0].value : '') });
  };
  return (
    <div className="a-prow a-prow-2">
      <Field def={{ name: `${id}-action`, label: 'Where it goes', type: 'select', allowEmpty: false, options: choices.actions.map((a) => ({ value: a, label: ACTION_LABEL[a] || a })),
        help: 'Picked from the same list as the banner buttons.' }} value={value.action} disabled={disabled} onChange={pickAction} />
      {list.length > 0 && (
        <Field def={{ name: `${id}-target`, label: 'Which one', type: 'select', allowEmpty: false, options: list, error }} value={value.target} disabled={disabled}
          onChange={(t) => onChange({ ...value, target: t })} />
      )}
    </div>
  );
}

const mainCards = (products) => (products || []).filter((p) => !p.variant_of);

// ------------------------------------------------------------------ Home page > Home doors (rows 12 to 15)
export function HomeDoors() {
  const d = useLoad('/website/doors');
  const products = useLoad('/products');
  const canEdit = useCan('content', 'edit');
  const act = useAction();
  const [draft, setDraft] = useState({}); // which -> { product, action, target }
  useLeaveGuard(Object.keys(draft).length > 0);
  const save = (door) => act.run(async () => {
    await api.send('PUT', `/website/doors/${door.which}`, draft[door.which]);
    setDraft((x) => { const n = { ...x }; delete n[door.which]; return n; });
    d.reload();
  }, `${door.label} door saved`);
  return (
    <section>
      <PageHead sub={'The "For Home" and "For Business" boxes'} />
      {act.note}
      <Loading state={d}>
        {d.data && (
          <div className="a-wdoors">
            {d.data.doors.map((door) => {
              const v = { product: door.product, action: door.action, target: door.target, ...(draft[door.which] || {}) };
              const set = (patch) => setDraft((x) => ({ ...x, [door.which]: { ...v, ...patch } }));
              const dirty = Boolean(draft[door.which]);
              return (
                <div key={door.which} className={`a-card a-wdoor${dirty ? ' a-pending' : ''}`}>
                  <h2>{door.label}</h2>
                  <div className="a-field">
                    <span id={`door-${door.which}-l`}>Picture (the product&apos;s first photo)</span>
                    <ProductSelect id={`door-${door.which}`} labelledBy={`door-${door.which}-l`} products={mainCards(products.data)} value={v.product || null} allowEmpty={false}
                      disabled={!canEdit} onChange={(x) => set({ product: x || '' })} />
                  </div>
                  <TargetPicker id={`door-${door.which}`} value={v} choices={d.data.choices} cats={d.data.categories} disabled={!canEdit}
                    error={act.fields && act.fields.target} onChange={(x) => set(x)} />
                  {canEdit && (
                    <div className="a-row">
                      <button type="button" className="a-btn" onClick={() => save(door)} disabled={act.busy || !dirty}>Save</button>
                      {dirty && <button type="button" className="a-btn a-btn-ghost" onClick={() => setDraft((x) => { const n = { ...x }; delete n[door.which]; return n; })}>Cancel</button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {d.data && <PageTexts keys={d.data.texts.map((t) => t.text_key)} title="Door headings and texts (per language)" />}
      </Loading>
    </section>
  );
}

// ------------------------------------------------------------------ Home page > Most loved (rows 16 to 19)
export function MostLoved() {
  const d = useLoad('/website/most-loved');
  const products = useLoad('/products');
  const canEdit = useCan('content', 'edit');
  const act = useAction();
  const saved = useMemo(() => ((d.data && d.data.products) || []).filter((p) => p.is_featured).sort((a, b) => (a.featured_order || 0) - (b.featured_order || 0)).map((p) => p.product_id), [d.data]);
  const [ids, setIds] = useState(null);
  const value = ids || saved;
  const dirty = ids !== null && ids.join() !== saved.join();
  useLeaveGuard(dirty);
  const save = () => act.run(async () => {
    await api.send('PUT', '/website/most-loved', { ids: value });
    setIds(null);
    d.reload();
  }, 'Most loved saved');
  return (
    <section>
      <PageHead sub="Home page products row, in order" />
      {act.note}
      <Loading state={d}>
        <div className={`a-card${dirty ? ' a-pending' : ''}`}>
          <KitProducts all={mainCards(products.data)} value={value} disabled={!canEdit} onChange={setIds}
            hint="Tick a product to add it to the row; drag the selected ones to set the order. Every ticked product shows (the row scrolls, no limit); only active products in active categories show on the site."
            emptyText="No product is ticked: the row is hidden on the site." />
          {canEdit && (
            <div className="a-row">
              <button type="button" className="a-btn" onClick={save} disabled={act.busy || !dirty}>Save</button>
              {dirty && <button type="button" className="a-btn a-btn-ghost" onClick={() => setIds(null)}>Cancel</button>}
            </div>
          )}
        </div>
        {d.data && <PageTexts keys={d.data.texts.map((t) => t.text_key)} title="Section heading and words (per language)" />}
      </Loading>
    </section>
  );
}

// ------------------------------------------------------------------ Forms > Form rules (rows 39 to 69)
const FORM_TITLE = { brochure: 'Brochure form', quote: 'Quote form (also Sample)', distributor: 'Distributor form', contact: 'Contact form' };
const FIELD_LABEL = {
  first_name: 'First name', last_name: 'Last name', email: 'E-mail', phone: 'Phone', full_name: 'Full name', business_name: 'Business name',
  business_type: 'Business type', town: 'Town', products: 'Products', monthly_quantity: 'Monthly quantity', message: 'Message', firm_name: 'Firm name',
  gst_no: 'GST number', areas: 'Areas', godown_vehicles: 'Godown and vehicles', brands: 'Brands', monthly_sales: 'Monthly sales',
};
const TYPE_CHECK = { email: 'email', tel: 'tel', gst: 'gst' };

export function FormRules() {
  const d = useLoad('/website/form-rules');
  const canEdit = useCan('content', 'edit');
  const act = useAction();
  const [lim, setLim] = useState(null); // typed limits
  const limits = (d.data && d.data.limits) || {};
  const typed = lim || { rate_max: String(limits.rate_max ?? ''), max_products: String(limits.max_products ?? '') };
  const limDirty = Boolean(lim) && (lim.rate_max !== String(limits.rate_max) || lim.max_products !== String(limits.max_products));
  useLeaveGuard(limDirty);
  const toggle = (f) => act.run(async () => {
    await api.send('PUT', '/website/form-rules/field', { form_type: f.form_type, field_name: f.field_name, required: !f.is_required });
    d.reload();
  }, `${FORM_TITLE[f.form_type]}: ${FIELD_LABEL[f.field_name] || f.field_name} is ${f.is_required ? 'optional' : 'required'} now`);
  const saveLimits = () => act.run(async () => {
    await api.send('PUT', '/website/form-rules/limits', { rate_max: Number(typed.rate_max), max_products: Number(typed.max_products) });
    setLim(null);
    d.reload();
  }, 'Limits saved');
  const forms = d.data ? [...new Set(d.data.fields.map((f) => f.form_type))] : [];
  const fe = (k) => act.fields && act.fields[k];
  return (
    <section>
      <PageHead sub="Required fields, checks, spam limit" />
      {act.note}
      <Loading state={d}>
        {d.data && (
          <>
            <div className="a-wforms">
              {forms.map((form) => (
                <div key={form} className="a-card">
                  <h2>{FORM_TITLE[form] || form}</h2>
                  <table className="a-table">
                    <thead><tr><th>Field</th><th>Required</th><th>Longest text</th><th>Check</th></tr></thead>
                    <tbody>
                      {d.data.fields.filter((f) => f.form_type === form).map((f) => (
                        <tr key={f.field_name}>
                          <td>{FIELD_LABEL[f.field_name] || f.field_name}<br /><small className="a-muted"><code>{f.field_name}</code></small></td>
                          <td>
                            <label className="a-check">
                              <input type="checkbox" checked={f.is_required} disabled={!canEdit || f.locked || act.busy} onChange={() => toggle(f)}
                                aria-label={`${FORM_TITLE[form]}: ${FIELD_LABEL[f.field_name] || f.field_name} required`} />
                              {f.is_required ? 'Required' : 'Optional'}
                            </label>
                            {f.locked && <small className="a-hint">Always required, so every lead can be called back (read only).</small>}
                          </td>
                          <td>{f.max_len ? `${f.max_len} characters` : f.field_type === 'pick' ? `${limits.max_products} products` : '-'}</td>
                          <td>{TYPE_CHECK[f.field_type] ? <small>{d.data.checks[TYPE_CHECK[f.field_type]]}</small> : f.field_type === 'select' ? <small className="a-muted">One of <Link to="/admin/form-options">Form options</Link></small> : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
            <div className="a-card">
              <h2>Limits</h2>
              <div className="a-prow a-prow-2">
                <Field def={{ name: 'rate_max', label: `Spam limit: enquiries from one visitor in ${limits.rate_window} minutes`, type: 'number', step: '1', min: limits.rate_range[0], max: limits.rate_range[1],
                  help: `From ${limits.rate_range[0]} to ${limits.rate_range[1]}. One more is refused with the "too many" message.`, error: fe('rate_max') }}
                value={typed.rate_max} disabled={!canEdit} onChange={(v) => setLim({ ...typed, rate_max: v })} />
                <Field def={{ name: 'max_products', label: 'Most products in one quote', type: 'number', step: '1', min: limits.max_products_range[0], max: limits.max_products_range[1],
                  help: `From ${limits.max_products_range[0]} to ${limits.max_products_range[1]}.`, error: fe('max_products') }}
                value={typed.max_products} disabled={!canEdit} onChange={(v) => setLim({ ...typed, max_products: v })} />
              </div>
              {canEdit && (
                <div className="a-row">
                  <button type="button" className="a-btn" onClick={saveLimits} disabled={act.busy || !limDirty}>Save limits</button>
                  {limDirty && <button type="button" className="a-btn a-btn-ghost" onClick={() => setLim(null)}>Cancel</button>}
                </div>
              )}
            </div>
            <InfoCard title="Read only">
              <ul>
                <li>The longest text per field is set by the database column, so a lead always fits.</li>
                <li>The e-mail, Indian mobile and GST number checks are fixed rules: {Object.values(d.data.checks).join('; ')}.</li>
              </ul>
            </InfoCard>
            <PageTexts keys={d.data.texts.map((t) => t.text_key)} title="Error messages (per language)" />
          </>
        )}
      </Loading>
    </section>
  );
}

// ------------------------------------------------------------------ Where we deliver map (rows 70 to 75)
const nameOf = (a, def) => (a.names && (a.names[def] || a.names.en)) || a.label;
const pinOf = (a, def) => ({ id: a.area_id, name: nameOf(a, def), map_x: a.map_x, map_y: a.map_y, is_base: a.is_base, label_dx: a.label_dx, label_dy: a.label_dy, label_anchor: a.label_anchor });

export function WhereMap() {
  const d = useLoad('/website/map');
  const canEdit = useCan('content', 'edit');
  const canCreate = useCan('content', 'create');
  const act = useAction();
  const [open, setOpen] = useState(null); // area_id | 'new'
  const [drag, setDrag] = useState(null);
  const def = (d.data && d.data.default) || 'en';
  const areas = (d.data && d.data.areas) || [];
  const shown = areas.filter((a) => a.show_on_map);
  const order = useOrderDraft((scope, ids) => api.send('PUT', '/website/map-order', { ids }), () => d.reload());
  const savedIds = shown.map((a) => a.area_id);
  const ids = order.order('map', savedIds);
  const byId = new Map(areas.map((a) => [a.area_id, a]));
  const drop = (target) => {
    if (drag === null || drag === target) return;
    const next = [...ids];
    next.splice(next.indexOf(target), 0, next.splice(next.indexOf(drag), 1)[0]);
    setDrag(null);
    order.set('map', next, savedIds);
  };
  const tick = (a) => act.run(async () => {
    await api.send('PUT', `/website/map/${a.area_id}`, { show_on_map: !a.show_on_map });
    d.reload();
  }, `${nameOf(a, def)} is ${a.show_on_map ? 'off' : 'on'} the map`);
  return (
    <section>
      <PageHead sub="Towns on the delivery map, in order"
        actions={canCreate ? <button type="button" className="a-btn" onClick={() => order.guard(() => setOpen('new'))}>Add a town for the map only</button> : null} />
      <InfoCard title="One town list">
        <ul>
          <li>The map shows the <Link to="/admin/delivery-areas">Delivery areas</Link> ticked &quot;Show on map&quot;. Charges, days and the towns each area covers are changed there.</li>
          <li>The name on the map, the pin, the godown base and Google&apos;s latitude and longitude are set here.</li>
          <li>A town for the map only is added as an inactive delivery area: it changes no delivery charge.</li>
        </ul>
      </InfoCard>
      {act.note}
      <Loading state={d}>
        <div className="a-wmap">
          <MapPreview others={ids.map((id) => byId.get(id)).filter(Boolean).map((a) => pinOf(a, def))} town={null} disabled />
          <div className="a-scroll">
            <table className="a-table a-hover">
              <thead><tr><th /><th>Name on the map</th><th>Delivery area</th><th>Pin</th><th>Show on map</th></tr></thead>
              <tbody>
                {ids.map((id, i) => byId.get(id)).filter(Boolean).map((a, i) => (
                  <tr key={a.area_id} className={drag === a.area_id ? 'a-dragging' : undefined} tabIndex={0} onClick={() => order.guard(() => setOpen(a.area_id))}
                    onKeyDown={(e) => e.key === 'Enter' && order.guard(() => setOpen(a.area_id))}
                    draggable={canEdit} onDragStart={() => setDrag(a.area_id)} onDragOver={(e) => { if (drag !== null) e.preventDefault(); }} onDrop={() => drop(a.area_id)} onDragEnd={() => setDrag(null)}>
                    <td className="a-handle" aria-hidden="true">{canEdit ? '⠿' : ''} {i + 1}</td>
                    <td><b>{nameOf(a, def)}</b>{a.is_base ? <Pill tone="gold" className="a-ml">Godown base</Pill> : null}</td>
                    <td>{a.label}{a.is_active ? '' : <small className="a-muted"> (map only)</small>}</td>
                    <td>{placed(a) ? `${a.map_x}, ${a.map_y}` : <span className="a-bad">Not placed</span>}</td>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked aria-label={`Show ${nameOf(a, def)} on the map`} disabled={!canEdit || act.busy} onChange={() => tick(a)} /></td>
                  </tr>
                ))}
              </tbody>
              <tbody>
                <tr className="a-group"><th colSpan={5}>Delivery areas not on the map</th></tr>
                {areas.filter((a) => !a.show_on_map).map((a) => (
                  <tr key={a.area_id} className="a-off" tabIndex={0} onClick={() => order.guard(() => setOpen(a.area_id))} onKeyDown={(e) => e.key === 'Enter' && order.guard(() => setOpen(a.area_id))}>
                    <td />
                    <td>{a.names[def] || <span className="a-muted">no map name yet</span>}</td>
                    <td>{a.label}{a.is_active ? '' : <small className="a-muted"> (not active)</small>}</td>
                    <td>{placed(a) ? `${a.map_x}, ${a.map_y}` : ''}</td>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={false} aria-label={`Show ${a.label} on the map`} disabled={!canEdit || act.busy} onChange={() => tick(a)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Loading>
      {open !== null && d.data && (
        <TownDrawer key={open} id={open} data={d.data} onClose={() => setOpen(null)} onSaved={(next, newId) => { d.setData(next); setOpen(newId || null); }} />
      )}
      {order.ui}
    </section>
  );
}

const GEO = [['lat', 6, 37, 'Latitude'], ['lng', 68, 98, 'Longitude']];
function TownDrawer({ id, data, onClose, onSaved }) {
  const creating = id === 'new';
  const canEdit = useCan('content', creating ? 'create' : 'edit');
  const act = useAction();
  const saved = creating ? { names: {}, map_x: 300, map_y: 180, label_dx: 0, label_dy: -20, label_anchor: 'middle', is_base: 0, lat: null, lng: null, show_on_map: 1 } : data.areas.find((a) => a.area_id === id);
  const [row, setRow] = useState(saved);
  const [names, setNames] = useState(Object.fromEntries(Object.entries(saved.names || {}).map(([l, v]) => [l, { name: v }])));
  const dirty = row !== saved || JSON.stringify(names) !== JSON.stringify(Object.fromEntries(Object.entries(saved.names || {}).map(([l, v]) => [l, { name: v }])));
  const set = (patch) => setRow((r) => ({ ...r, ...patch }));
  const def = data.default;
  const fe = (k) => act.fields && act.fields[k];
  const geoBad = (k) => {
    const g = GEO.find((x) => x[0] === k);
    const v = row[k];
    if (v === null || v === undefined || String(v).trim() === '') return null;
    const n = Number(v);
    return !Number.isFinite(n) || n < g[1] || n > g[2] ? `${g[3]} must be a number from ${g[1]} to ${g[2]} (India).` : null;
  };
  const otherBase = data.areas.find((a) => a.is_base && a.area_id !== id);
  const save = () => act.run(async () => {
    const body = { names: Object.fromEntries(Object.entries(names).map(([l, v]) => [l, v.name || ''])),
      ...Object.fromEntries(['map_x', 'map_y', 'label_dx', 'label_dy', 'label_anchor', 'is_base', 'lat', 'lng'].map((k) => [k, row[k] === '' ? null : row[k]])) };
    const r = creating ? await api.send('POST', '/website/map', body) : await api.send('PUT', `/website/map/${id}`, body);
    onSaved(r, creating ? r.area_id : id);
  }, 'Saved: the site shows it on the next load');
  const others = data.areas.filter((a) => a.show_on_map && a.area_id !== id).map((a) => pinOf(a, def));
  const fld = (name, label, extra = {}) => (
    <Field def={{ name, label, type: 'number', step: '1', ...extra }} value={row[name] ?? ''} disabled={!canEdit} onChange={(v) => set({ [name]: v })} />
  );
  return (
    <Drawer title={creating ? 'New town for the map only' : `Map: ${nameOf(saved, def)}`} onClose={onClose} dirty={dirty} wide
      footer={canEdit && <button type="button" className="a-btn" onClick={save} disabled={act.busy}>{creating ? 'Add' : 'Save'}</button>}>
      {act.note}
      {!creating && (
        <p className="a-muted">Delivery area <b>{saved.label}</b> ({saved.is_active ? 'active' : 'not active, map only'}): its charge, days and towns are on <Link to="/admin/delivery-areas">Masters &gt; Delivery areas</Link>.</p>
      )}
      <div className="a-dsec">
        <h3>Name on the map (per language)</h3>
        <TrEditor fields={[{ name: 'name', label: 'Name', required: true }]} tr={names} disabled={!canEdit} onChange={setNames} strict={Boolean(fe('names'))} />
        {fe('names') && <small className="a-emsg" role="alert">{fe('names')}</small>}
      </div>
      <div className="a-dsec">
        <h3>Map preview</h3>
        <div className="a-townmapsec">
          <MapPreview others={others} town={{ ...pinOf({ ...row, names: Object.fromEntries(Object.entries(names).map(([l, v]) => [l, v.name])), label: saved.label || '' }, def), id: 'cur' }} disabled={!canEdit} onMove={set} />
          <div className="a-townside">
            <div className="a-prow a-prow-2">{fld('map_x', 'Map x', { help: `0-${MAP_W}, left to right. Or drag the pin.`, error: fe('map_x') })}{fld('map_y', 'Map y', { help: `0-${MAP_H}, top to bottom. Or drag the pin.`, error: fe('map_y') })}</div>
            <div className="a-prow a-prow-2">{fld('label_dx', 'Name offset across', { help: '+ right, - left. Or drag the name.' })}{fld('label_dy', 'Name offset down', { help: '+ down, - up; -20 = just above.' })}</div>
            <div className="a-prow">
              <Field def={{ name: 'label_anchor', label: 'Name alignment', type: 'select', allowEmpty: false, options: [
                { value: 'start', label: 'start (runs to the right)' }, { value: 'middle', label: 'middle (centred)' }, { value: 'end', label: 'end (runs to the left)' }] }}
              value={row.label_anchor} disabled={!canEdit} onChange={(v) => set({ label_anchor: v })} />
            </div>
          </div>
        </div>
      </div>
      <div className="a-prow a-pchecks">
        <Field def={{ name: 'is_base', label: 'Godown base (the dark pin with a star)', type: 'bool', info: 'The town the goods ship from. One town only: ticking it here unticks the other.' }}
          value={row.is_base} disabled={!canEdit} onChange={(v) => set({ is_base: v })} />
      </div>
      {Number(row.is_base) === 1 && otherBase && <p className="a-replace-note">This replaces {nameOf(otherBase, def)} as the godown base.</p>}
      {Number(row.is_base) === 1 && (
        <div className="a-prow a-prow-2">
          {fld('lat', 'Latitude', { step: 'any', help: 'For Google (the base town only).', error: geoBad('lat') || fe('lat') })}
          {fld('lng', 'Longitude', { step: 'any', help: 'For Google (the base town only).', error: geoBad('lng') || fe('lng') })}
        </div>
      )}
    </Drawer>
  );
}

// ------------------------------------------------------------------ Brand and layout > Menu links (rows 76 to 81)
const MENUS = [['in_header', 'Header'], ['in_phone', 'Phone menu'], ['in_footer', 'Footer']];
const linkWhere = (l) => (l.target_kind === 'page' ? `Page: ${PAGE_LABEL[l.target] || l.target}` : `Section: ${SECTION_LABEL[l.target] || l.target}`);

export function MenuLinks() {
  const d = useLoad('/website/menu-links');
  const canEdit = useCan('content', 'edit');
  const canCreate = useCan('content', 'create');
  const act = useAction();
  const [open, setOpen] = useState(null); // link_key | 'new'
  const [drag, setDrag] = useState(null);
  const links = (d.data && d.data.links) || [];
  const def = (d.data && d.data.default) || 'en';
  const order = useOrderDraft((scope, keys) => api.send('PUT', '/website/menu-links-order', { keys }), () => d.reload());
  const savedKeys = links.map((l) => l.link_key);
  const keys = order.order('links', savedKeys);
  const byKey = new Map(links.map((l) => [l.link_key, l]));
  const drop = (target) => {
    if (drag === null || drag === target) return;
    const next = [...keys];
    next.splice(next.indexOf(target), 0, next.splice(next.indexOf(drag), 1)[0]);
    setDrag(null);
    order.set('links', next, savedKeys);
  };
  const flip = (l, k) => act.run(async () => {
    const r = await api.send('PUT', `/website/menu-links/${l.link_key}`, { [k]: l[k] ? 0 : 1 });
    d.setData(r);
  }, 'Saved: the site shows it on the next load');
  return (
    <section>
      <PageHead sub="Header, phone menu and footer links"
        actions={canCreate ? <button type="button" className="a-btn" onClick={() => order.guard(() => setOpen('new'))}>Add a link</button> : null} />
      <p className="a-muted">A link goes to one of our pages or a home page section only, picked from a list, so it can never break. Links to other websites are not offered (owner: revisit in Stage 3).</p>
      {act.note}
      <Loading state={d}>
        <div className="a-scroll">
          <table className="a-table a-hover">
            <thead><tr><th /><th>Name</th><th>Goes to</th>{MENUS.map(([k, label]) => <th key={k}>{label}</th>)}<th>Shown</th></tr></thead>
            <tbody>
              {keys.map((k) => byKey.get(k)).filter(Boolean).map((l, i) => (
                <tr key={l.link_key} className={`${l.is_active ? '' : 'a-off'}${drag === l.link_key ? ' a-dragging' : ''}`} tabIndex={0}
                  onClick={() => order.guard(() => setOpen(l.link_key))} onKeyDown={(e) => e.key === 'Enter' && order.guard(() => setOpen(l.link_key))}
                  draggable={canEdit} onDragStart={() => setDrag(l.link_key)} onDragOver={(e) => { if (drag !== null) e.preventDefault(); }} onDrop={() => drop(l.link_key)} onDragEnd={() => setDrag(null)}>
                  <td className="a-handle" aria-hidden="true">{canEdit ? '⠿' : ''} {i + 1}</td>
                  <td><b>{l.names[def] || l.link_key}</b><br /><small className="a-muted"><code>{l.text_key}</code></small></td>
                  <td>{linkWhere(l)}</td>
                  {[...MENUS, ['is_active', 'Shown']].map(([key, label]) => (
                    <td key={key} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={Boolean(l[key])} disabled={!canEdit || act.busy} aria-label={`${l.names[def] || l.link_key}: ${label}`} onChange={() => flip(l, key)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Loading>
      {open !== null && d.data && (
        <LinkDrawer key={open} id={open} data={d.data} onClose={() => setOpen(null)} onSaved={(r) => { d.setData(r); setOpen(null); }} />
      )}
      {order.ui}
    </section>
  );
}

function LinkDrawer({ id, data, onClose, onSaved }) {
  const creating = id === 'new';
  const canEdit = useCan('content', creating ? 'create' : 'edit');
  const canDelete = useCan('content', 'delete');
  const confirm = useConfirm();
  const act = useAction();
  const saved = creating ? { names: {}, target_kind: 'section', target: data.choices.sections[0], in_header: 1, in_phone: 1, in_footer: 1, is_active: 1 } : data.links.find((l) => l.link_key === id);
  const trOf = (n) => Object.fromEntries(Object.entries(n || {}).map(([l, v]) => [l, { name: v }]));
  const [row, setRow] = useState(saved);
  const [names, setNames] = useState(trOf(saved.names));
  const dirty = row !== saved || JSON.stringify(names) !== JSON.stringify(trOf(saved.names));
  const set = (patch) => setRow((r) => ({ ...r, ...patch }));
  const fe = (k) => act.fields && act.fields[k];
  const targets = row.target_kind === 'page' ? data.choices.pages.map((p) => ({ value: p, label: PAGE_LABEL[p] || p })) : data.choices.sections.map((s) => ({ value: s, label: SECTION_LABEL[s] || s }));
  const save = () => act.run(async () => {
    const body = { names: Object.fromEntries(Object.entries(names).map(([l, v]) => [l, v.name || ''])), target_kind: row.target_kind, target: row.target,
      in_header: row.in_header, in_phone: row.in_phone, in_footer: row.in_footer, is_active: row.is_active };
    onSaved(creating ? await api.send('POST', '/website/menu-links', body) : await api.send('PUT', `/website/menu-links/${id}`, body));
  }, 'Saved: the site shows it on the next load');
  const remove = async () => {
    if (!(await confirm({ title: `Delete the link "${names[data.default] ? names[data.default].name : id}"?`, message: 'Its names in every language go with it. This cannot be undone.', action: 'Delete', danger: true }))) return;
    act.run(async () => onSaved(await api.send('DELETE', `/website/menu-links/${id}`)), 'Deleted');
  };
  return (
    <Drawer title={creating ? 'New menu link' : `Menu link: ${(saved.names || {})[data.default] || id}`} onClose={onClose} dirty={dirty} wide
      footer={canEdit && (
        <>
          <button type="button" className="a-btn" onClick={save} disabled={act.busy}>{creating ? 'Add' : 'Save'}</button>
          {!creating && canDelete && saved.added && <button type="button" className="a-btn a-btn-danger" onClick={remove} disabled={act.busy}>Delete</button>}
        </>
      )}>
      {act.note}
      <div className="a-dsec">
        <h3>Name (per language)</h3>
        <TrEditor fields={[{ name: 'name', label: 'Name', required: true }]} tr={names} disabled={!canEdit} onChange={setNames} strict={Boolean(fe('names'))} />
        {fe('names') && <small className="a-emsg" role="alert">{fe('names')}</small>}
        {!creating && <p className="a-muted">The Translations text <code>{saved.text_key}</code>: a change here changes it there too.</p>}
      </div>
      <div className="a-prow a-prow-2">
        <Field def={{ name: 'target_kind', label: 'Goes to', type: 'select', allowEmpty: false, options: data.choices.kinds.map((k) => ({ value: k, label: k === 'page' ? 'One of our pages' : 'A home page section' })) }}
          value={row.target_kind} disabled={!canEdit} onChange={(v) => set({ target_kind: v, target: (v === 'page' ? data.choices.pages : data.choices.sections)[0] })} />
        <Field def={{ name: 'target', label: 'Which one', type: 'select', allowEmpty: false, options: targets, error: fe('target') }} value={row.target} disabled={!canEdit} onChange={(v) => set({ target: v })} />
      </div>
      <div className="a-prow a-pchecks">
        {MENUS.map(([k, label]) => <Field key={k} def={{ name: k, label: `In the ${label.toLowerCase()}`, type: 'bool' }} value={row[k]} disabled={!canEdit} onChange={(v) => set({ [k]: v })} />)}
        <Field def={{ name: 'is_active', label: 'Shown (off = hidden in every menu)', type: 'bool' }} value={row.is_active} disabled={!canEdit} onChange={(v) => set({ is_active: v })} />
      </div>
      {!creating && !saved.added && <p className="a-muted">A built-in link cannot be deleted (its name is also used by other parts of the site): hide it instead.</p>}
    </Drawer>
  );
}

// ------------------------------------------------------------------ Brand and layout > Visit cards (rows 82 to 88)
const embedUrl = (q) => `https://www.google.com/maps?q=${encodeURIComponent(q)}&output=embed`; // as src/home/ContactBand.js

export function VisitCards() {
  const d = useLoad('/website/visit-cards');
  const canEdit = useCan('content', 'edit');
  const canCreate = useCan('content', 'create');
  const act = useAction();
  const [open, setOpen] = useState(null); // card_id | 'new'
  const [drag, setDrag] = useState(null);
  const cards = (d.data && d.data.cards) || [];
  const def = (d.data && d.data.default) || 'en';
  const order = useOrderDraft((scope, ids) => api.send('PUT', '/website/visit-cards-order', { ids }), () => d.reload());
  const savedIds = cards.map((c) => c.card_id);
  const ids = order.order('cards', savedIds);
  const byId = new Map(cards.map((c) => [c.card_id, c]));
  const drop = (target) => {
    if (drag === null || drag === target) return;
    const next = [...ids];
    next.splice(next.indexOf(target), 0, next.splice(next.indexOf(drag), 1)[0]);
    setDrag(null);
    order.set('cards', next, savedIds);
  };
  const flip = (c) => act.run(async () => d.setData(await api.send('PUT', `/website/visit-cards/${c.card_id}`, { is_active: c.is_active ? 0 : 1 })), 'Saved: the site shows it on the next load');
  return (
    <section>
      <PageHead sub="Address cards in the Contact section"
        actions={canCreate ? <button type="button" className="a-btn" onClick={() => order.guard(() => setOpen('new'))}>Add a card</button> : null} />
      {act.note}
      <Loading state={d}>
        <div className="a-scroll">
          <table className="a-table a-hover">
            <thead><tr><th /><th>Card</th><th>Address</th><th>Phone</th><th>Opening hours</th><th>Shown</th></tr></thead>
            <tbody>
              {ids.map((id) => byId.get(id)).filter(Boolean).map((c, i) => (
                <tr key={c.card_id} className={`${c.is_active ? '' : 'a-off'}${drag === c.card_id ? ' a-dragging' : ''}`} tabIndex={0}
                  onClick={() => order.guard(() => setOpen(c.card_id))} onKeyDown={(e) => e.key === 'Enter' && order.guard(() => setOpen(c.card_id))}
                  draggable={canEdit} onDragStart={() => setDrag(c.card_id)} onDragOver={(e) => { if (drag !== null) e.preventDefault(); }} onDrop={() => drop(c.card_id)} onDragEnd={() => setDrag(null)}>
                  <td className="a-handle" aria-hidden="true">{canEdit ? '⠿' : ''} {i + 1}</td>
                  <td><b>{c.names[def] || '-'}</b></td>
                  <td>{c.addresses[def] || '-'}</td>
                  <td>{c.phone || ''}</td>
                  <td>{c.hours[def] || ''}</td>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={Boolean(c.is_active)} disabled={!canEdit || act.busy} aria-label={`${c.names[def] || c.card_id}: shown`} onChange={() => flip(c)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Loading>
      {open !== null && d.data && (
        <CardDrawer key={open} id={open} data={d.data} onClose={() => setOpen(null)} onSaved={(r) => { d.setData(r); setOpen(null); }} />
      )}
      {order.ui}
    </section>
  );
}

function CardDrawer({ id, data, onClose, onSaved }) {
  const creating = id === 'new';
  const canEdit = useCan('content', creating ? 'create' : 'edit');
  const canDelete = useCan('content', 'delete');
  const confirm = useConfirm();
  const act = useAction();
  const def = data.default;
  const saved = creating ? { names: {}, addresses: {}, hours: {}, map_query: '', phone: '', godown_id: null, is_active: 1 } : data.cards.find((c) => c.card_id === id);
  const trOf = (c) => {
    const out = {};
    for (const [field, src] of [['name', c.names], ['address', c.addresses], ['hours', c.hours]]) {
      for (const [l, v] of Object.entries(src || {})) out[l] = { ...(out[l] || {}), [field]: v };
    }
    return out;
  };
  const [tr, setTr] = useState(trOf(saved));
  const [row, setRow] = useState({ map_query: saved.map_query || '', phone: saved.phone || '', godown_id: saved.godown_id, is_active: saved.is_active });
  const [preview, setPreview] = useState(saved.map_query || '');
  const dirty = JSON.stringify(tr) !== JSON.stringify(trOf(saved)) || row.map_query !== (saved.map_query || '') || row.phone !== (saved.phone || '') || row.godown_id !== saved.godown_id || row.is_active !== saved.is_active;
  const set = (patch) => setRow((r) => ({ ...r, ...patch }));
  const fe = (k) => act.fields && act.fields[k];
  const fill = (gid) => {
    const g = data.godowns.find((x) => String(x.godown_id) === String(gid));
    if (!g) return;
    // copies the godown's address, phone and hours into the default language; everything stays editable
    setTr((t) => ({ ...t, [def]: { ...(t[def] || {}), name: (t[def] && t[def].name) || g.name, address: g.address, hours: g.hours || (t[def] && t[def].hours) || '' } }));
    set({ godown_id: g.godown_id, phone: g.phone || row.phone, map_query: g.address });
    setPreview(g.address);
  };
  const save = () => act.run(async () => {
    const col = (f) => Object.fromEntries(data.languages.map((l) => [l, (tr[l] && tr[l][f]) || '']));
    const body = { names: col('name'), addresses: col('address'), hours: col('hours'), map_query: row.map_query, phone: row.phone, godown_id: row.godown_id, is_active: row.is_active };
    onSaved(creating ? await api.send('POST', '/website/visit-cards', body) : await api.send('PUT', `/website/visit-cards/${id}`, body));
  }, 'Saved: the site shows it on the next load');
  const remove = async () => {
    if (!(await confirm({ title: 'Delete this card?', message: 'Its texts in every language go with it. This cannot be undone.', action: 'Delete', danger: true }))) return;
    act.run(async () => onSaved(await api.send('DELETE', `/website/visit-cards/${id}`)), 'Deleted');
  };
  const godown = data.godowns.find((g) => g.godown_id === row.godown_id);
  return (
    <Drawer title={creating ? 'New visit card' : `Visit card: ${(saved.names || {})[def] || id}`} onClose={onClose} dirty={dirty} wide
      footer={canEdit && (
        <>
          <button type="button" className="a-btn" onClick={save} disabled={act.busy}>{creating ? 'Add' : 'Save'}</button>
          {!creating && canDelete && saved.added && <button type="button" className="a-btn a-btn-danger" onClick={remove} disabled={act.busy}>Delete</button>}
        </>
      )}>
      {act.note}
      {canEdit && data.godowns.length > 0 && (
        <div className="a-prow a-prow-2">
          <Field def={{ name: 'fill_godown', label: 'Fill from a godown', type: 'select', options: data.godowns.map((g) => ({ value: String(g.godown_id), label: `${g.name} (${g.code})` })),
            help: 'Copies the address, phone and hours from Admin > Godowns; then edit freely.' }} value="" onChange={fill} />
          {godown && <p className="a-muted a-wfilled">Filled from {godown.name}. Later changes on <Link to="/admin/godowns">Godowns</Link> do not change this card.</p>}
        </div>
      )}
      <div className="a-dsec">
        <h3>Words (per language)</h3>
        <TrEditor fields={[{ name: 'name', label: 'Card name', required: true }, { name: 'address', label: 'Address', required: true, long: true }, { name: 'hours', label: 'Opening hours', help: 'Empty = no line' }]}
          tr={tr} disabled={!canEdit} onChange={setTr} strict={Boolean(fe('names') || fe('addresses') || fe('hours'))} />
        {['names', 'addresses', 'hours'].map((k) => fe(k) && <small key={k} className="a-emsg" role="alert">{fe(k)}</small>)}
      </div>
      <div className="a-prow a-prow-2">
        <Field def={{ name: 'phone', label: 'Phone', help: 'Empty = no phone line on the card.', error: fe('phone') }} value={row.phone} disabled={!canEdit} onChange={(v) => set({ phone: v })} />
        <Field def={{ name: 'is_active', label: 'Shown on the site', type: 'bool' }} value={row.is_active} disabled={!canEdit} onChange={(v) => set({ is_active: v })} />
      </div>
      <div className="a-dsec">
        <h3>Map location</h3>
        <div className="a-prow a-prow-2">
          <Field def={{ name: 'map_query', label: 'Map search text or exact pin', help: 'An address, a place name or "12.83,79.70" (latitude,longitude). Empty = the English address.', error: fe('map_query') }}
            value={row.map_query} disabled={!canEdit} onChange={(v) => set({ map_query: v })} />
          <div className="a-field"><span>&nbsp;</span><button type="button" className="a-btn a-btn-ghost" onClick={() => setPreview(row.map_query || ((tr[def] || {}).address || ''))}>Check on the map</button></div>
        </div>
        {preview ? <iframe className="a-wcardmap" title="Map preview" loading="lazy" referrerPolicy="no-referrer-when-downgrade" src={embedUrl(preview)} />
          : <p className="a-muted">Type a location, then Check on the map.</p>}
      </div>
    </Drawer>
  );
}

// ------------------------------------------------------------------ Google and sharing (rows 89 to 93)
export function GoogleSharing() {
  const facts = useLoad('/website/facts');
  return (
    <section>
      <PageHead sub="How pages show in Google and shares" />
      <Loading state={facts}>
        <div className="a-card">
          <div className="a-prow a-prow-2">
            <div className="a-field a-ro">
              <span>Website address</span>
              <input type="text" value={(facts.data && facts.data.site_url) || ''} readOnly disabled aria-label="Website address" />
              <small className="a-hint">Read only: set on the server (links, sitemap and sharing use it).</small>
            </div>
          </div>
        </div>
      </Loading>
      <SettingsTable sections={[['Google and sharing', ['site_indexing', 'share_image', 'ga4_measurement_id']]]} />
      <PageTexts group="Google and sharing" title="Page titles and descriptions (per page, per language)" />
    </section>
  );
}

// ------------------------------------------------------------------ Site settings (rows 94 to 102)
export function SiteSettings() {
  const facts = useLoad('/website/facts');
  const c = (facts.data && facts.data.company) || {};
  return (
    <section>
      <PageHead sub="Company, enquiries, mail, lead sheet" />
      <Loading state={facts}>
        <div className="a-card">
          <h2>Company details on the site</h2>
          <div className="a-prow a-prow-3">
            <FromElsewhere label="Company name" value={c.name} from="Admin > Company" to="/admin/company" />
            <FromElsewhere label="CIN" value={c.cin} from="Admin > Company" to="/admin/company" />
            <FromElsewhere label="GSTIN" value={c.gstin} from="Admin > Company" to="/admin/company" />
            <FromElsewhere label="Phone" value={c.phone} from="Admin > Company" to="/admin/company" />
            <FromElsewhere label="E-mail" value={c.email} from="Admin > Company" to="/admin/company" />
            <FromElsewhere label="WhatsApp number" value={c.whatsapp} from="Admin > Company" to="/admin/company" />
          </div>
          <p className="a-muted">One source for the site and the invoices.</p>
        </div>
      </Loading>
      <SettingsTable sections={[
        ['About section', ['about_image']],
        ['Enquiries and e-mail', ['lead_email', 'mail_from_name', 'mail_from', 'mail_logo_url']],
        ['Lead sheet', ['gsheet_spreadsheet_id']],
        ['Security', ['two_step_login']],
      ]} />
      <PageTexts keys={['wa_general']} title="WhatsApp button greeting (per language)" />
    </section>
  );
}

// ------------------------------------------------------------------ Brochures and Users: their switches (rows 32, 101)
export function BrochureSwitch() {
  return <SettingsTable sections={[['Brochure', ['brochure_download_enabled']]]} />;
}
export function TwoStepSetting() {
  return <div id="two-step"><SettingsTable sections={[['Two-step sign-in', ['two_step_login']]]} twoStep="switch" /></div>;
}

