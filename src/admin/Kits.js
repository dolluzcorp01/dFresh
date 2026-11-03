// Masters > Catalogue > Kits (phase 14, v23 viewKits + DRAWERS.kit + saveKit; API /catalogue/kits in catalogue.js):
// one card per kit with its photo, name, code and business type, tagline, the parts (picture and quantity), what can be
// sold now in each godown (the godown picked at the top, else every godown; the reason as the pill's title), and
// whether it shows on the website and is sold. A card opens the panel: what can be sold now with the reasons, the parts
// (an SKU and a quantity per row, plus an empty row for the next part), Sold (status, kit code, price per kit) and On
// the website (switch, business type, name and tagline per language, photo from product). The server checks every
// rule; its refusals show under the field (parts.<i> under that part row).
import { useMemo, useState } from 'react';
import { api } from './adminApi';
import {
  Alert, DISCARD, Drawer, Empty, Field, InfoTip, LIcon, Loading, PageHead, Pill, useAction, useAdmin, useCan, useConfirm, useLoad, useToast,
} from './ui';
import { savedGodown } from './HeaderBar';
import { Switch, Thumb, ViewOnly, picUrl } from './Categories';
import { splitMsg } from './Units';

const short = (name) => String(name || '').split(' ')[0];

/** the part rows of the form: the kit's parts, then empty rows (at least one, and three rows in all) */
function partRows(parts) {
  const rows = parts.map((p) => ({ sku_code: p.sku_code, qty: String(p.qty) }));
  rows.push({ sku_code: '', qty: '1' });
  while (rows.length < 3) rows.push({ sku_code: '', qty: '1' });
  return rows;
}
/** what a save would change: the filled rows only */
const norm = (f) => JSON.stringify({ ...f, parts: f.parts.filter((p) => p.sku_code).map((p) => [p.sku_code, String(p.qty).trim()]) });

export default function Kits() {
  const data = useLoad('/catalogue/kits');
  const { me } = useAdmin();
  const canEdit = useCan('products', 'edit');
  const canCreate = useCan('products', 'create');
  const toast = useToast();
  const [open, setOpen] = useState(null); // kit_key | 'new'
  const [ver, setVer] = useState(0);
  const d = data.data;
  const picked = savedGodown(me);
  const shownGodowns = useMemo(() => {
    if (!d) return [];
    const one = picked ? d.godowns.filter((g) => Number(g.godown_id) === Number(picked)) : [];
    return one.length ? one : d.godowns;
  }, [d, picked]);
  const bizName = (v) => ((d && d.business_types.find((b) => b.value === v)) || {}).label || v;
  const current = d && open && open !== 'new' ? d.kits.find((k) => k.kit_key === open) : null;
  const openCard = (k) => setOpen(k.kit_key);

  return (
    <section>
      <PageHead sub="Several packs sold as one"
        actions={canCreate && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New kit</button>} />
      {!canEdit && <ViewOnly />}
      <Alert tone="info" title="One kit, sold and shown.">
        A kit is several packs sold as one, at one price. Stock comes off each part. The same kit can show in &quot;For Business&quot; on dfresh.us. Availability follows the godown picked at the top.
      </Alert>
      <Loading state={data}>
        {d && (d.kits.length ? (
          <div className="a-kitgrid">
            {d.kits.map((k) => (
              <div key={k.kit_key} className="a-card a-kitcard a-p14-kit" role="button" tabIndex={0} aria-label={`Open ${k.name.en || k.kit_code}`}
                onClick={() => openCard(k)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openCard(k); } }}>
                <div className="a-kh">
                  <Thumb file={k.image} size={60} />
                  <div><b>{k.name.en || k.kit_code}</b><span className="a-kh-sub">{k.kit_code} · {bizName(k.business_type)}</span></div>
                </div>
                {k.tagline.en && <p className="a-p14-kt">{k.tagline.en}</p>}
                <div className="a-p14-kparts">
                  {k.parts.map((pt) => (
                    <span key={pt.sku_code} className="a-p14-kp" title={`${pt.sku_code} · ${pt.name}`}>
                      <Thumb file={pt.image} size={34} /><small>{pt.qty} ×</small>
                    </span>
                  ))}
                </div>
                <div className="a-kfoot">
                  {shownGodowns.map((g) => {
                    const a = (k.avail || {})[g.godown_id] || { n: 0, why: [] };
                    return <Pill key={g.godown_id} tone={a.n > 0 ? 'good' : 'bad'} title={a.why.join('; ') || undefined}>{short(g.name)}: {a.n > 0 ? `${a.n} can be sold` : 'Unavailable'}</Pill>;
                  })}
                  <Pill tone={k.on_site ? 'gold' : 'gray'}>{k.on_site ? 'On website' : 'Not on website'}</Pill>
                  {k.status !== 'active' && <Pill tone="gray">Not sold</Pill>}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="a-card a-card-flush"><Empty icon="package" title="No kits yet">{canCreate ? 'Make the first one with New kit.' : 'Nothing to show.'}</Empty></div>
        ))}
      </Loading>
      {d && open && (open === 'new' || current) && (
        <KitDrawer key={`${open}-${ver}`} kit={current} meta={d} canSave={open === 'new' ? canCreate : canEdit} onClose={() => setOpen(null)}
          onSaved={(out, isNew) => {
            // the saved kit straight into the list (the drawer reopens on it), then the full list again
            if (out.kit) data.setData((x) => (x ? { ...x, kits: isNew ? [...x.kits, out.kit] : x.kits.map((k) => (k.kit_key === out.kit.kit_key ? out.kit : k)) } : x));
            const [t, x] = splitMsg(out.message, isNew ? 'Kit created' : 'Saved');
            toast('good', t.replace(/\.$/, ''), x);
            setOpen(out.kit_key);
            setVer((v) => v + 1);
            data.reload();
          }} />
      )}
    </section>
  );
}

function KitDrawer({ kit, meta, canSave, onClose, onSaved }) {
  const act = useAction();
  const confirm = useConfirm();
  const creating = !kit;
  const langs = meta.languages;
  const [start] = useState(() => ({
    parts: partRows(kit ? kit.parts : []),
    name: Object.fromEntries(langs.map((l) => [l.lang_code, (kit && kit.name[l.lang_code]) || ''])),
    tagline: Object.fromEntries(langs.map((l) => [l.lang_code, (kit && kit.tagline[l.lang_code]) || ''])),
    on_site: Boolean(kit && kit.on_site),
    rep_product_id: (kit && kit.rep_product_id) || '',
    business_type: (kit && kit.business_type) || '',
    status: (kit && kit.status) || 'active',
    price: kit && kit.price !== null && kit.price !== undefined ? String(kit.price) : '',
  }));
  const [f, setF] = useState(start);
  const dirty = norm(f) !== norm(start);
  const err = act.fields || {};
  const lock = !canSave;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v ?? '' }));
  const setPart = (i, patch) => setF((x) => {
    const parts = x.parts.map((p, j) => (j === i ? { ...p, ...patch } : p));
    if (parts[parts.length - 1].sku_code) parts.push({ sku_code: '', qty: '1' }); // always one empty row for the next part
    return { ...x, parts };
  });
  const setLang = (k, code, v) => setF((x) => ({ ...x, [k]: { ...x[k], [code]: v } }));
  const cancel = async () => { if (!dirty || (await confirm(DISCARD))) onClose(); };
  const save = () => act.run(async () => {
    const body = {
      parts: f.parts.map((p) => ({ sku_code: p.sku_code, qty: String(p.qty).trim() })), // every row: refusals name the row (parts.<i>)
      name: Object.fromEntries(Object.entries(f.name).map(([k, v]) => [k, v.trim()])),
      tagline: Object.fromEntries(Object.entries(f.tagline).map(([k, v]) => [k, v.trim()])),
      on_site: f.on_site, rep_product_id: f.rep_product_id || null, business_type: f.business_type, status: f.status, price: f.price.trim(),
    };
    const out = creating ? await api.send('POST', '/catalogue/kits', body) : await api.send('PUT', `/catalogue/kits/${encodeURIComponent(kit.kit_key)}`, body);
    onSaved(out, creating);
  });
  const notSold = (s) => s.status !== 'active' || ['draft', 'archived'].includes(s.product_status);

  return (
    <Drawer title={creating ? 'New kit' : kit.name.en || kit.kit_code} sub={creating ? undefined : kit.kit_code}
      thumb={(kit && picUrl(kit.image)) || <LIcon name="package" />}
      pill={!creating && <Pill tone={kit.on_site ? 'gold' : 'gray'}>{kit.on_site ? 'On website' : 'Not on website'}</Pill>}
      onClose={onClose} dirty={canSave && dirty}
      footer={(
        <>
          <span className="a-sp" />
          <button type="button" className="a-btn a-btn-ghost" onClick={cancel}>Cancel</button>
          {canSave && <button type="button" className="a-btn" disabled={act.busy || !dirty} onClick={save}><LIcon name="check" size="sm" />{creating ? 'Create kit' : 'Save'}</button>}
        </>
      )}>
      {act.note}
      {!creating && (
        <>
          <h3 className="a-p14-gh">Can be sold now</h3>
          <div className="a-p14-pills">
            {meta.godowns.map((g) => {
              const a = (kit.avail || {})[g.godown_id] || { n: 0, why: [] };
              return <Pill key={g.godown_id} tone={a.n > 0 ? 'good' : 'bad'}>{g.name}: {a.n > 0 ? a.n : 'Unavailable'}</Pill>;
            })}
          </div>
          {meta.godowns.map((g) => {
            const a = (kit.avail || {})[g.godown_id];
            return a && a.why.length ? <p key={g.godown_id} className="a-hint-s a-p14-why">{short(g.name)}: {a.why.join('; ')}</p> : null;
          })}
        </>
      )}

      <h3 className="a-p14-fsec">Parts</h3>
      {f.parts.map((pt, i) => {
        const e = err[`parts.${i}`];
        return (
          <div key={i} className={`a-field a-p14-kitrow${e ? ' a-err' : ''}`}>
            <span>Part {i + 1}</span>
            <div className="a-p14-kr">
              <select value={pt.sku_code} disabled={lock} aria-label={`Part ${i + 1}`} aria-invalid={e ? true : undefined} onChange={(ev) => setPart(i, { sku_code: ev.target.value })}>
                <option value="">-</option>
                {meta.skus.map((s) => <option key={s.sku_code} value={s.sku_code}>{s.sku_code} · {s.name}{notSold(s) ? ' (not sold)' : ''}</option>)}
              </select>
              <input type="number" min="1" step="1" value={pt.qty} disabled={lock} aria-label={`Quantity of part ${i + 1}`} onChange={(ev) => setPart(i, { qty: ev.target.value })} />
            </div>
            {e && <small className="a-emsg" role="alert">{e}</small>}
          </div>
        );
      })}
      <p className="a-hint-s">Leave a part on &quot;-&quot; to drop it. An empty line is always there for the next part.</p>

      <h3 className="a-p14-fsec">Sold</h3>
      <div className="a-grid2">
        <Field def={{ name: 'kit-status', label: 'Status', type: 'select', allowEmpty: false, locked: lock, error: err.status,
          options: [{ value: 'active', label: 'Sold' }, { value: 'hidden', label: 'Not sold' }] }} value={f.status} onChange={set('status')} />
        <Field def={{ name: 'kit-code', label: 'Kit code', type: 'readonly', help: 'Given by the system, never changes.' }} value={creating ? 'Given on create' : kit.kit_code} onChange={() => {}} />
        <Field def={{ name: 'kit-price', label: `Price, per kit, ${meta.basis}`, type: 'number', min: 0, step: '0.01', locked: lock, error: err.price, wide: true,
          help: 'Optional. One price for the kit; sold as one line from section 7 (orders).' }} value={f.price} onChange={set('price')} />
      </div>

      <h3 className="a-p14-fsec">On the website (&quot;For Business&quot;)</h3>
      <div className="a-field a-p14-sw">
        <span>Show on dfresh.us<InfoTip text="Needs the English name and tagline, and a photo. Off keeps the kit for staff only." /></span>
        <Switch on={f.on_site} label="Show on dfresh.us" disabled={lock} onClick={() => setF((x) => ({ ...x, on_site: !x.on_site }))} />
      </div>
      <div className="a-grid2">
        <Field def={{ name: 'kit-biz', label: 'Business type', type: 'select', required: true, locked: lock, error: err.business_type, wide: true,
          options: meta.business_types.map((b) => ({ value: b.value, label: b.label })), help: 'The free-sample form opens with this already picked.' }}
        value={f.business_type} onChange={set('business_type')} />
        {langs.map((l) => [
          <Field key={`n-${l.lang_code}`} def={{ name: `kit-n-${l.lang_code}`, label: `Name, ${l.name_en}`, required: l.lang_code === 'en', locked: lock, error: err[`name.${l.lang_code}`] }}
            value={f.name[l.lang_code]} onChange={(v) => setLang('name', l.lang_code, String(v).slice(0, 40))} />,
          <Field key={`t-${l.lang_code}`} def={{ name: `kit-t-${l.lang_code}`, label: `Tagline, ${l.name_en}`, required: l.lang_code === 'en' && f.on_site, locked: lock, error: err[`tagline.${l.lang_code}`] }}
            value={f.tagline[l.lang_code]} onChange={(v) => setLang('tagline', l.lang_code, String(v).slice(0, 90))} />,
        ])}
        <Field def={{ name: 'kit-rep', label: 'Photo from product', type: 'select', required: true, locked: lock, error: err.rep_product_id, wide: true,
          options: meta.products.map((p) => ({ value: p.product_id, label: `${p.name}${p.images ? '' : ' (no picture)'}` })), help: 'Usually one of the kit\'s own products.' }}
        value={f.rep_product_id} onChange={set('rep_product_id')} />
      </div>
    </Drawer>
  );
}
