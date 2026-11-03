// Masters > Catalogue > Categories (phase 14, v23 viewCats + DRAWERS.cat; API /catalogue/categories in catalogue.js):
// every category in the order the website shows them, with its picture, its name in every language (a red "Missing"
// when empty; the columns come from the languages that are on), its products and the "On website" switch.
// - Moving rows only changes a draft: "New order not saved yet." with Save order / Cancel; leaving the page with an
//   unsaved order asks first. The switches are off while the order is unsaved.
// - The switch asks the server: a category with active products cannot be hidden, an empty one cannot be shown; the
//   switch snaps back and the reason shows as a red toast.
// - A row opens the panel: the name in every language and the product whose picture the website tile shows.
import { useMemo, useState } from 'react';
import { api } from './adminApi';
import { mediaUrl } from '../utils/api';
import {
  Alert, DISCARD, Drawer, Field, LIcon, Loading, PageHead, Pill, Table, useAction, useAdmin, useCan, useConfirm, useLeaveGuard, useLoad, useToast,
} from './ui';
import { splitMsg } from './Units';

export const picUrl = (file) => (file ? mediaUrl(`/media/products/400/${file}`) : null);

/** the product picture in a small square (a plain box when there is none) */
export function Thumb({ file, size }) {
  const src = picUrl(file);
  return (
    <span className="a-thumb2" style={size ? { width: size, height: size } : undefined}>
      {src ? <img src={src} alt="" loading="lazy" /> : <LIcon name="package" size="sm" />}
    </span>
  );
}

export function ViewOnly() {
  const { me } = useAdmin();
  return (
    <Alert tone="info" title="View only.">
      {me && me.role_name ? `${me.role_name} can` : 'Your role can'} see Products but not change them. Rights come from the role in Foundation (section 0).
    </Alert>
  );
}

export function Switch({ on, label, disabled, onClick, title }) {
  return (
    <button type="button" role="switch" aria-checked={Boolean(on)} aria-label={label} title={title} className="a-switch" disabled={disabled} onClick={onClick}>
      <span className="a-switch-knob" aria-hidden="true" />
    </button>
  );
}

export default function Categories() {
  const data = useLoad('/catalogue/categories');
  const canEdit = useCan('products', 'edit');
  const canCreate = useCan('products', 'create');
  const toast = useToast();
  const [draft, setDraft] = useState(null); // category keys in the new (unsaved) order
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(null); // category_key | 'new'
  const [ver, setVer] = useState(0);
  const d = data.data;
  useLeaveGuard(Boolean(draft), { title: 'Leave without saving the new order?', message: 'The categories keep their old order on the website.', action: 'Leave', cancel: 'Stay', danger: true });

  const rows = useMemo(() => (d ? d.rows : []), [d]);
  // the draft order (a category added meanwhile goes last), else the saved order
  const list = useMemo(() => {
    if (!draft) return rows;
    const byKey = new Map(rows.map((r) => [r.category_key, r]));
    const out = draft.filter((k) => byKey.has(k)).map((k) => byKey.get(k));
    rows.forEach((r) => { if (!draft.includes(r.category_key)) out.push(r); });
    return out;
  }, [rows, draft]);
  const others = d ? d.languages.filter((l) => l.lang_code !== 'en') : [];

  const run = async (fn, badTitle) => {
    setBusy(true);
    try { await fn(); } catch (e) { const [t, x] = splitMsg(e.message, badTitle); toast('bad', t, x); } finally { setBusy(false); }
  };
  const move = (key, dir) => {
    const keys = list.map((r) => r.category_key);
    const i = keys.indexOf(key);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    setDraft(keys);
  };
  const saveOrder = () => run(async () => {
    const out = await api.send('POST', '/catalogue/categories/order', { order: list.map((r) => r.category_key) });
    setDraft(null);
    data.reload();
    const [t, x] = splitMsg(out.message, 'Order saved');
    toast('good', t, x);
  }, 'Order not saved');
  const cancelOrder = () => { setDraft(null); toast('info', 'Order change cancelled'); };
  const toggle = (c) => run(async () => {
    const on = !c.is_active;
    const out = await api.send('POST', `/catalogue/categories/${encodeURIComponent(c.category_key)}/active`, { on });
    data.reload();
    toast('good', out.message.replace(/\.$/, ''));
  }, `Cannot ${c.is_active ? 'hide' : 'show'} ${c.name.en || c.category_key}`);

  const columns = [
    { key: 'n', label: '#', num: true, thClassName: 'a-p14-w50', render: (c) => list.indexOf(c) + 1 },
    { key: 'cat', label: 'Category', render: (c) => <span className="a-p14-prow"><Thumb file={c.image} /><b>{c.name.en || c.category_key}</b></span> },
    ...others.map((l) => ({
      key: `l-${l.lang_code}`, label: l.name_en, hideSm: true,
      render: (c) => (c.name[l.lang_code] ? c.name[l.lang_code] : <Pill tone="bad">Missing</Pill>),
    })),
    { key: 'products', label: 'Products', num: true, render: (c) => <>{c.products} <small className="a-muted">({c.active} active)</small></> },
    { key: 'web', label: 'On website',
      render: (c) => <Switch on={c.is_active} title={c.is_active ? 'Shown' : 'Hidden'} label={`Show ${c.name.en || c.category_key} on the website`}
        disabled={!canEdit || Boolean(draft) || busy} onClick={() => toggle(c)} /> },
    { key: 'mv', label: <span className="a-sr">Move</span>, className: 'a-p14-act',
      render: (c) => {
        if (!canEdit) return null;
        const i = list.indexOf(c);
        return (
          <span className="a-p14-mv">
            <button type="button" className="a-iconbtn" disabled={i === 0 || busy} aria-label={`Move ${c.name.en || c.category_key} up`} onClick={() => move(c.category_key, -1)}>
              <LIcon name="chevron-down" size="sm" className="a-rot" />
            </button>
            <button type="button" className="a-iconbtn" disabled={i === list.length - 1 || busy} aria-label={`Move ${c.name.en || c.category_key} down`} onClick={() => move(c.category_key, 1)}>
              <LIcon name="chevron-down" size="sm" />
            </button>
          </span>
        );
      } },
  ];

  const current = d && open && open !== 'new' ? rows.find((r) => r.category_key === open) : null;
  return (
    <section>
      <PageHead sub="The groups the website shows, in their order"
        actions={canCreate && <button type="button" className="a-btn" onClick={() => setOpen('new')}><LIcon name="plus" size="sm" />New category</button>} />
      {!canEdit && <ViewOnly />}
      {draft && (
        <div className="a-bulkbar" role="status">
          <b>New order not saved yet.</b>
          <span className="a-sp" />
          <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={busy} onClick={cancelOrder}>Cancel</button>
          <button type="button" className="a-btn a-btn-sm" disabled={busy} onClick={saveOrder}><LIcon name="check" size="sm" />Save order</button>
        </div>
      )}
      <Loading state={data}>
        {d && (
          <div className="a-listcard">
            <div className="a-countline"><b>{list.length}</b> categories, in the order the website shows them</div>
            <Table columns={columns} rows={list} rowKey={(c) => c.category_key} onRowClick={(c) => setOpen(c.category_key)} label="Categories"
              empty={{ title: 'No categories yet', text: 'Add the first one with New category.' }} />
          </div>
        )}
        <p className="a-hint-s">A category with active products cannot be hidden. A new category starts hidden; switch it on once it has an active product.</p>
      </Loading>
      {d && open && (open === 'new' || current) && (
        <CatDrawer key={`${open}-${ver}`} cat={current} meta={d} canSave={open === 'new' ? canCreate : canEdit}
          onClose={() => setOpen(null)}
          onSaved={(out, isNew) => {
            const [t, x] = splitMsg(out.message, isNew ? 'Category added' : 'Saved');
            toast('good', t.replace(/\.$/, ''), x);
            data.reload();
            if (isNew) setOpen(null); else setVer((v) => v + 1);
          }} />
      )}
    </section>
  );
}

function CatDrawer({ cat, meta, canSave, onClose, onSaved }) {
  const act = useAction();
  const confirm = useConfirm();
  const creating = !cat;
  const start = {
    name: Object.fromEntries(meta.languages.map((l) => [l.lang_code, (cat && cat.name[l.lang_code]) || ''])),
    rep_product_id: (cat && cat.rep_product_id) || '',
  };
  const [f, setF] = useState(start);
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const err = act.fields || {};
  const prods = creating ? [] : meta.products.filter((p) => p.category_key === cat.category_key);
  const cancel = async () => { if (!dirty || (await confirm(DISCARD))) onClose(); };
  const save = () => act.run(async () => {
    const body = { name: Object.fromEntries(Object.entries(f.name).map(([k, v]) => [k, v.trim()])), rep_product_id: f.rep_product_id || null };
    const out = creating ? await api.send('POST', '/catalogue/categories', body) : await api.send('PUT', `/catalogue/categories/${encodeURIComponent(cat.category_key)}`, body);
    onSaved(out, creating);
  });
  return (
    <Drawer title={creating ? 'New category' : cat.name.en || cat.category_key} thumb={creating ? <LIcon name="package" /> : picUrl(cat.image) || <LIcon name="package" />}
      sub={creating ? 'Starts hidden and last; switch it on once it has an active product' : `${cat.products} products, ${cat.active} active`}
      pill={!creating && <Pill tone={cat.is_active ? 'good' : 'gray'}>{cat.is_active ? 'On website' : 'Hidden'}</Pill>}
      onClose={onClose} dirty={canSave && dirty}
      footer={(
        <>
          <span className="a-sp" />
          <button type="button" className="a-btn a-btn-ghost" onClick={cancel}>Cancel</button>
          {canSave && <button type="button" className="a-btn" disabled={act.busy || !dirty} onClick={save}><LIcon name="check" size="sm" />{creating ? 'Add category' : 'Save'}</button>}
        </>
      )}>
      {act.note}
      <div className="a-grid2 a-p14-form">
        {meta.languages.map((l) => (
          <Field key={l.lang_code} def={{ name: `cat-${l.lang_code}`, label: `Name in ${l.name_en}`, required: l.lang_code === 'en', locked: !canSave, error: err[`name.${l.lang_code}`] }}
            value={f.name[l.lang_code]} onChange={(v) => setF((x) => ({ ...x, name: { ...x.name, [l.lang_code]: String(v).slice(0, 40) } }))} />
        ))}
        <Field def={{ name: 'cat-rep', label: 'Picture from product', type: 'select', required: !creating, wide: true, locked: !canSave || creating,
          options: prods.map((p) => ({ value: p.product_id, label: p.name })), error: err.rep_product_id,
          help: creating ? 'Choose after adding products. The website tile uses that product\'s main picture.' : 'The website tile uses that product\'s main picture.' }}
        value={f.rep_product_id} onChange={(v) => setF((x) => ({ ...x, rep_product_id: v || '' }))} />
      </div>
    </Drawer>
  );
}
