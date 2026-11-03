// Masters > Catalogue > Products and SKUs (phase 14, v23 viewProducts; API /catalogue/* in catalogue.js).
// Products tab: search (name, code, SKU, barcode), category and status filters with counts, sortable columns, 10 per
// page, select boxes with the bulk bar (Export, Hide from website, Show on website; each asks first), a row menu (Open,
// Hide / Show, Discontinue), "Most loved #n", "HI missing" and low-stock pills, the five statuses explained. SKUs (packs)
// tab: every pack we sell. The product panel: Basics, Website words (per language, a red dot on a language with gaps),
// Photos, Packs (opens the SKU panel, "Add SKU"), Label, History; the status bar acts straight away. Stock shows the
// godown picked in the header (else all godowns). Deep links: ?open=DZIND-DF001 opens a product, ?sku=DF001-M100 a SKU.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { mediaUrl } from '../utils/api';
import { DISCARD, Drawer, LIcon, Loading, PageHead, Pill, Tabs, UploadButton, fmtDate, useAction, useAdmin, useCan, useConfirm, useLoad, useToast, useUpload } from './ui';
import { savedGodown } from './HeaderBar';
import SkuDrawer, { DTabs, Fld, PIcon, ProductThumb, StatusPill, fid } from './SkuDrawer';

const PER = 10;
const STATUS_ORDER = ['draft', 'active', 'hidden', 'discontinued', 'archived'];

/** the godown the header picked (number) or null = all; its name for the count line */
function usePicked() {
  const { me } = useAdmin();
  const id = savedGodown(me);
  const g = id ? ((me && me.godown_list) || []).find((x) => Number(x.godown_id) === id) : null;
  return { id, name: g ? g.name : 'All godowns' };
}
const stockOf = (x, gid) => (gid ? Number((x.stock || {})[gid]) || 0 : Number((x.stock || {}).all) || 0);

function csvDownload(name, rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([`﻿${rows.map((r) => r.map(cell).join(',')).join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Products() {
  const list = useLoad('/catalogue/products');
  const codes = useLoad('/catalogue/barcodes');
  const { me } = useAdmin();
  const canEdit = useCan('products', 'edit');
  const canCreate = useCan('products', 'create');
  const canCancel = useCan('products', 'cancel');
  const canExport = useCan('products', 'export');
  const act = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const picked = usePicked();
  // query params by useLocation (not useSearchParams: that would pull more router code into the public bundle)
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const setParams = () => navigate({ pathname: location.pathname, search: '' }, { replace: true });
  const [tab, setTab] = useState('products');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [stat, setStat] = useState('');
  const [sort, setSort] = useState({ key: 'name', dir: 1 }); // { key, dir }; v23 starts by name
  const [page, setPage] = useState(1);
  const [sel, setSel] = useState({});
  const [open, setOpen] = useState(null); // { kind: 'product', id } | { kind: 'sku', code, from } | { kind: 'new' }
  const [menu, setMenu] = useState(null); // { id, left, top }
  const d = list.data;

  // deep links
  const deep = `${params.get('open') || ''}|${params.get('sku') || ''}`;
  useEffect(() => {
    const o = params.get('open');
    const s = params.get('sku');
    if (o) setOpen({ kind: 'product', id: o.toUpperCase() });
    else if (s) setOpen({ kind: 'sku', code: s.toUpperCase() });
  }, [deep]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = () => {
    setOpen(null);
    if (params.get('open') || params.get('sku')) setParams({}, { replace: true });
  };

  const barcodesOf = useMemo(() => {
    const m = new Map();
    ((codes.data && codes.data.rows) || []).forEach((r) => m.set(r.sku_code, `${m.get(r.sku_code) || ''} ${r.barcode}`));
    return m;
  }, [codes.data]);
  const catOf = useMemo(() => new Map(((d && d.categories) || []).map((c) => [c.category_key, c])), [d]);

  const rows = useMemo(() => {
    if (!d) return [];
    const t = q.trim().toLowerCase();
    let out = d.products.filter((p) => (!cat || p.category_key === cat) && (!stat || p.status === stat)
      && (!t || `${p.name} ${p.product_id} ${p.skus.map((s) => `${s.sku_code} ${barcodesOf.get(s.sku_code) || ''}`).join(' ')}`.toLowerCase().includes(t)));
    if (sort) {
      const key = (p) => (sort.key === 'stock' ? stockOf(p, picked.id) : sort.key === 'cat' ? (catOf.get(p.category_key) || {}).sort_order || 0
        : sort.key === 'status' ? STATUS_ORDER.indexOf(p.status) : p.name.toLowerCase());
      out = [...out].sort((a, b) => { const x = key(a); const y = key(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
    }
    return out;
  }, [d, q, cat, stat, sort, barcodesOf, catOf, picked.id]);
  const pages = Math.max(1, Math.ceil(rows.length / PER));
  const pg = Math.min(page, pages);
  const shown = rows.slice((pg - 1) * PER, pg * PER);
  const chosen = Object.keys(sel).filter((k) => sel[k]);
  useEffect(() => { setPage(1); }, [q, cat, stat]);

  // the row menu closes on a click elsewhere, Esc or scroll
  useEffect(() => {
    if (!menu) return undefined;
    const shut = (e) => { if (e.type === 'keydown' ? e.key === 'Escape' : !(e.target.closest && e.target.closest('.p14-menu'))) setMenu(null); };
    const scroll = () => setMenu(null);
    document.addEventListener('mousedown', shut);
    document.addEventListener('keydown', shut);
    window.addEventListener('scroll', scroll, true);
    return () => { document.removeEventListener('mousedown', shut); document.removeEventListener('keydown', shut); window.removeEventListener('scroll', scroll, true); };
  }, [menu]);

  const reload = () => { list.reload(); codes.reload(); };
  const sortBtn = (key, label) => {
    const on = sort && sort.key === key;
    return (
      <button type="button" className="a-sort" onClick={() => setSort(on ? { key, dir: -sort.dir } : { key, dir: 1 })}>
        {label}<LIcon name={on ? 'chevron-down' : 'arrow-up-down'} size="sm" className={on && sort.dir === -1 ? 'a-rot' : undefined} />
      </button>
    );
  };
  const ariaSort = (key) => (sort && sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none');

  const setStatus = async (p, to) => {
    if (to === 'discontinued' && !(await confirm({ title: `Discontinue ${p.name}?`, message: 'It leaves the website. The stock left is still sold, and at zero the nightly check archives it.', action: 'Discontinue' }))) return;
    act.run(async () => {
      const r = await api.send('POST', `/catalogue/products/${encodeURIComponent(p.product_id)}/status`, { to });
      toast(r.waiting ? 'warn' : to === 'active' ? 'good' : 'warn', r.waiting ? 'Waiting for approval' : p.name, r.message);
      reload();
    });
  };
  const bulkWeb = async (to) => {
    const n = chosen.length;
    const ok = await confirm({ title: `${to === 'hidden' ? 'Hide' : 'Show'} ${n} product${n > 1 ? 's' : ''} ${to === 'hidden' ? 'from' : 'on'} the website?`,
      message: `${to === 'hidden' ? 'Staff can still sell them.' : 'Visitors will see them straight away.'} Products in the wrong status or not ready are skipped.`, action: to === 'hidden' ? 'Hide' : 'Show' });
    if (!ok) return;
    act.run(async () => {
      const r = await api.send('POST', '/catalogue/products-bulk/web', { ids: chosen, to });
      toast('good', to === 'hidden' ? 'Hidden from the website' : 'Shown on the website', r.message);
      setSel({});
      reload();
    });
  };
  const bulkExport = async () => {
    const n = chosen.length;
    if (!(await confirm({ title: `Export ${n} product${n > 1 ? 's' : ''}?`, message: 'A CSV file of the selected rows downloads: code, name, category, SKUs, stock and status.', action: 'Export' }))) return;
    const pick = d.products.filter((p) => sel[p.product_id]);
    csvDownload('dFresh_products_selected.csv', [['Product code', 'Name', 'Category', 'SKUs', `Stock (${picked.name})`, 'Status'],
      ...pick.map((p) => [p.product_id, p.name, (catOf.get(p.category_key) || {}).name || p.category_key, p.skus.map((s) => s.sku_code).join(' '), stockOf(p, picked.id), p.status_label])]);
  };
  const exportAll = () => act.run(() => api.download('/products/export.xlsx', 'dFresh_Product_List.xlsx'));
  const nightly = () => act.run(async () => { const r = await api.send('POST', '/catalogue/nightly'); toast('good', 'Nightly check', r.message); reload(); });

  const menuFor = menu && d && d.products.find((p) => p.product_id === menu.id);
  const allOnPage = shown.length > 0 && shown.every((p) => sel[p.product_id]);
  const finished = d ? d.skus : [];

  return (
    <section className="p14">
      <PageHead sub="Every product and pack, with its picture"
        actions={(
          <>
            {canExport && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={exportAll}><LIcon name="download" size="sm" />Export</button>}
            {canCreate && canEdit && <Link className="a-btn a-btn-ghost" to="/admin/import-export"><PIcon name="upload" size="sm" />Import</Link>}
            {canEdit && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} title="Archives discontinued products whose stock reached zero" onClick={nightly}><LIcon name="clipboard-check" size="sm" />Nightly check</button>}
            {canCreate && <button type="button" className="a-btn" onClick={() => setOpen({ kind: 'new' })}><LIcon name="plus" size="sm" />New product</button>}
          </>
        )} />
      {!canEdit && (
        <div className="a-alert a-alert-info" role="status"><PIcon name="eye" /><div className="a-alert-tx"><b>View only.</b> {(me && me.role_name) || 'Your role'} can see Products but not change them. Rights come from the role in Foundation (section 0).</div></div>
      )}
      {!open && act.note}
      <Loading state={list}>
        {d && (
          <>
            <Tabs value={tab} onChange={setTab} label="Products and SKUs"
              tabs={[{ key: 'products', label: 'Products', count: d.products.length }, { key: 'skus', label: 'SKUs (packs)', count: finished.length }]} />
            {tab === 'products' ? (
              <>
                <div className="a-listcard">
                  <div className="p14-filters">
                    <label className="p14-fi p14-grow"><LIcon name="search" size="sm" />
                      <input type="search" value={q} placeholder="Search name, code, SKU or barcode" aria-label="Search products" onChange={(e) => setQ(e.target.value)} /></label>
                    <label className="p14-fi"><PIcon name="tag" size="sm" />
                      <select value={cat} aria-label="Category" onChange={(e) => setCat(e.target.value)}>
                        <option value="">All categories</option>
                        {d.categories.map((c) => <option key={c.category_key} value={c.category_key}>{c.name}{c.is_active ? '' : ' (hidden)'}</option>)}
                      </select></label>
                    <label className="p14-fi"><PIcon name="sliders-horizontal" size="sm" />
                      <select value={stat} aria-label="Status" onChange={(e) => setStat(e.target.value)}>
                        <option value="">All statuses</option>
                        {STATUS_ORDER.map((k) => <option key={k} value={k}>{d.statuses[k]} ({(d.counts || {})[k] || 0})</option>)}
                      </select></label>
                    {(q || cat || stat) && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => { setQ(''); setCat(''); setStat(''); }}><LIcon name="x" size="sm" />Clear</button>}
                  </div>
                  {chosen.length > 0 ? (
                    <div className="p14-bulk">
                      <b>{chosen.length} selected</b>
                      {canExport && <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={bulkExport}><LIcon name="download" size="sm" />Export</button>}
                      {canEdit && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => bulkWeb('hidden')}><PIcon name="eye" size="sm" />Hide from website</button>}
                      {canEdit && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => bulkWeb('active')}>Show on website</button>}
                      <span className="p14-sp" />
                      <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => setSel({})}>Clear selection</button>
                    </div>
                  ) : (
                    <div className="p14-count"><span><b>{rows.length}</b> products{rows.length !== d.products.length ? ` of ${d.products.length}` : ''}</span><span className="p14-sp" /><span>Stock: {picked.name}</span></div>
                  )}
                  {!rows.length ? (
                    <div className="a-empty"><div className="a-empty-ic"><LIcon name="search" size="lg" /></div><h3>No product matches</h3><p>Try another word, or clear the filters.</p>
                      <div className="a-empty-acts"><button type="button" className="a-btn a-btn-ghost" onClick={() => { setQ(''); setCat(''); setStat(''); }}>Clear filters</button></div></div>
                  ) : (
                    <>
                      <div className="a-tw p14-tw">
                        <table className="a-table a-hover p14-t">
                          <thead>
                            <tr>
                              <th className="p14-ck"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage}
                                onChange={(e) => setSel((s) => ({ ...s, ...Object.fromEntries(shown.map((p) => [p.product_id, e.target.checked])) }))} /></th>
                              <th aria-sort={ariaSort('name')}>{sortBtn('name', 'Product')}</th>
                              <th className="a-hide-sm" aria-sort={ariaSort('cat')}>{sortBtn('cat', 'Category')}</th>
                              <th className="a-hide-sm">SKU</th>
                              <th className="a-num" aria-sort={ariaSort('stock')}>{sortBtn('stock', 'Stock')}</th>
                              <th className="p14-st" aria-sort={ariaSort('status')}>{sortBtn('status', 'Status')}</th>
                              <th className="p14-act"><span className="a-sr">Actions</span></th>
                            </tr>
                          </thead>
                          <tbody>
                            {shown.map((p) => {
                              const low = picked.id ? Boolean((p.low_at || {})[picked.id]) : p.low;
                              const st = stockOf(p, picked.id);
                              return (
                                <tr key={p.product_id} className={`a-rowlink${sel[p.product_id] ? ' p14-sel' : ''}`} tabIndex={0}
                                  onClick={(e) => { if (!e.target.closest('a, button, input, select, label')) setOpen({ kind: 'product', id: p.product_id }); }}
                                  onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) setOpen({ kind: 'product', id: p.product_id }); }}>
                                  <td className="p14-ck"><input type="checkbox" aria-label={`Select ${p.name}`} checked={Boolean(sel[p.product_id])}
                                    onChange={(e) => setSel((s) => ({ ...s, [p.product_id]: e.target.checked }))} /></td>
                                  <td className="p14-pc">
                                    <span className="p14-prow">
                                      <ProductThumb file={p.image} />
                                      <span className="p14-pt">
                                        <b>{p.swatch_hex && p.variant_of && <span className="p14-sw" style={{ background: p.swatch_hex }} aria-hidden="true" />}{p.name}</b>
                                        <small>{p.product_id}{p.variant_of ? ` · colour of ${p.variant_of.replace('DZIND-', '')}` : ''}</small>
                                        {(p.featured || (p.status === 'active' && (p.lang_gaps || []).length > 0)) && (
                                          <span className="p14-minis">
                                            {p.featured && <Pill tone="gold" className="p14-mini">Most loved #{p.featured}</Pill>}
                                            {p.status === 'active' && (p.lang_gaps || []).length > 0 && <Pill tone="bad" className="p14-mini">{p.lang_gaps.join(', ')} missing</Pill>}
                                          </span>
                                        )}
                                      </span>
                                    </span>
                                  </td>
                                  <td className="a-hide-sm">{(catOf.get(p.category_key) || {}).name || p.category_key}</td>
                                  <td className="a-hide-sm">{p.skus.map((s) => <span key={s.sku_code} className="p14-blk">{s.sku_code}</span>)}<small className="a-muted">{(p.skus[0] || {}).size_label || ''}</small></td>
                                  <td className="a-num">{low ? <Pill tone="bad" title="Below its reorder level">{st}</Pill> : st}</td>
                                  <td className="p14-st"><StatusPill status={p.status} label={p.status_label} /></td>
                                  <td className="p14-act">
                                    <button type="button" className="a-iconbtn" aria-label={`Actions for ${p.name}`} aria-haspopup="menu" aria-expanded={Boolean(menu && menu.id === p.product_id)}
                                      onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu && menu.id === p.product_id ? null : { id: p.product_id, left: Math.max(8, r.right - 240), top: r.bottom + 4 }); }}>
                                      <PIcon name="ellipsis" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="p14-pager">
                        <span>Showing {(pg - 1) * PER + 1}-{Math.min(pg * PER, rows.length)} of {rows.length}</span>
                        <span className="p14-sp" />
                        <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={pg === 1} aria-label="Previous page" onClick={() => setPage(pg - 1)}><PIcon name="chevron-left" size="sm" /></button>
                        <span>Page {pg} of {pages}</span>
                        <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={pg === pages} aria-label="Next page" onClick={() => setPage(pg + 1)}><LIcon name="chevron-right" size="sm" /></button>
                      </div>
                    </>
                  )}
                </div>
                <FiveStatuses />
                {location.hash === '#most-loved' && <MostLoved products={d.products} onOpen={(id) => setOpen({ kind: 'product', id })} />}
              </>
            ) : (
              <div className="a-listcard">
                <div className="p14-count"><span><b>{finished.length}</b> packs we sell</span><span className="p14-sp" /><span>Stock: {picked.name}</span></div>
                <div className="a-tw p14-tw">
                  <table className="a-table a-hover p14-t">
                    <thead>
                      <tr><th>SKU</th><th className="a-hide-sm">Pack</th><th className="a-hide-sm">Made or bought</th><th className="a-num a-hide-sm">Per carton</th><th className="a-hide-sm">Customers buy</th>
                        <th className="a-hide-sm">Shelf life</th><th className="a-hide-sm">HSN</th><th className="a-num a-hide-sm">GST today</th><th className="a-num">Stock</th><th className="p14-st">Status</th></tr>
                    </thead>
                    <tbody>
                      {finished.map((s) => (
                        <tr key={s.sku_code} className="a-rowlink" tabIndex={0} onClick={() => setOpen({ kind: 'sku', code: s.sku_code })}
                          onKeyDown={(e) => { if (e.key === 'Enter') setOpen({ kind: 'sku', code: s.sku_code }); }}>
                          <td className="p14-pc"><span className="p14-prow"><ProductThumb file={s.image} /><span className="p14-pt"><b>{s.sku_code}</b><small>{s.name}</small></span></span></td>
                          <td className="a-hide-sm">{s.size_label}</td>
                          <td className="a-hide-sm">{s.source_label}</td>
                          <td className="a-num a-hide-sm">{s.packs_per_carton}</td>
                          <td className="a-hide-sm">{s.sell_label}{s.min_order_qty > 1 && <small className="a-sub-l">min {s.min_order_qty}</small>}</td>
                          <td className="a-hide-sm">{s.shelf_life_months ? `${s.shelf_life_months} months` : 'Never expires'}</td>
                          <td className="a-hide-sm">{s.hsn_code || '-'}</td>
                          <td className="a-num a-hide-sm">{s.gst_rate}%</td>
                          <td className="a-num">{stockOf(s, picked.id)}</td>
                          <td className="p14-st"><span className="p14-pills"><StatusPill status={s.status} label={s.status_label} />{s.status === 'active' && !s.ready && <Pill tone="bad" title="Set weight and HSN before it can be sold">Not ready</Pill>}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </Loading>

      {menuFor && (
        <div className="a-menu p14-menu" role="menu" style={{ left: menu.left, top: menu.top }}>
          <button type="button" role="menuitem" className="a-menu-item" onClick={() => { setMenu(null); setOpen({ kind: 'product', id: menuFor.product_id }); }}>
            <PIcon name="pencil" size="sm" />{canEdit ? 'Open and edit' : 'Open'}</button>
          {canEdit && (menuFor.status === 'active' || menuFor.status === 'hidden') && (
            <button type="button" role="menuitem" className="a-menu-item" onClick={() => { setMenu(null); setStatus(menuFor, menuFor.status === 'hidden' ? 'active' : 'hidden'); }}>
              <PIcon name="eye" size="sm" />{menuFor.status === 'hidden' ? 'Show on website' : 'Hide from website'}</button>
          )}
          {canCancel && (menuFor.status === 'active' || menuFor.status === 'hidden') && (
            <><hr /><button type="button" role="menuitem" className="a-menu-item a-menu-danger" onClick={() => { setMenu(null); setStatus(menuFor, 'discontinued'); }}>Discontinue</button></>
          )}
        </div>
      )}

      {open && open.kind === 'product' && (
        <ProductDrawer key={open.id} id={open.id} list={d} onClose={close} onChanged={reload}
          onOpenSku={(code) => setOpen({ kind: 'sku', code, from: open.id })} />
      )}
      {open && open.kind === 'sku' && (
        <SkuDrawer key={open.code} code={open.code} skus={d ? d.skus : undefined} onClose={close} onSaved={reload}
          onBack={(() => { const pid = open.from || ((d && d.skus.find((x) => x.sku_code === open.code)) || {}).product_id; return pid ? () => setOpen({ kind: 'product', id: pid }) : undefined; })()} />
      )}
      {open && open.kind === 'new' && d && (
        <NewProduct categories={d.categories} onClose={close}
          onCreated={(r) => { reload(); toast('good', 'Created as a Draft', r.message); setOpen({ kind: 'product', id: r.product_id }); }} />
      )}
    </section>
  );
}

/** Website > Home page > Most loved (/admin/products#most-loved): the home page row in its order (v23 dashboard "Most loved on
 * dfresh.us"); a place is changed in the product's Basics ("Most loved on the home page"), where a taken place swaps. */
function MostLoved({ products, onOpen }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.scrollIntoView({ block: 'start' }); }, []);
  const loved = products.filter((p) => p.featured).sort((a, b) => a.featured - b.featured);
  return (
    <div className="a-card p14-five" id="most-loved" ref={ref}>
      <h2>Most loved</h2>
      <p className="a-muted">The home page row, in this order. Change a place in the product: Basics, Most loved on the home page.</p>
      <div className="p14-loved">
        {loved.map((p) => (
          <button key={p.product_id} type="button" className="p14-loved-it" onClick={() => onOpen(p.product_id)}>
            {p.image ? <img src={mediaUrl(`/media/products/400/${p.image}`)} alt="" width="72" height="72" /> : <span className="p14-loved-none" />}
            <b>{p.featured}</b><span>{p.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function FiveStatuses() {
  const rows = [
    ['draft', 'Draft', 'Being set up. Not on the website, cannot be sold.'],
    ['active', 'Active', 'On the website and sold. Needs a picture, an English description, an active category and a ready SKU.'],
    ['hidden', 'Hidden from website', 'Staff can still sell it; visitors do not see it.'],
    ['discontinued', 'Discontinued', 'Off the website. The stock left is still sold; at zero the nightly check archives it.'],
    ['archived', 'Archived', 'Kept for history, never sold. Only an Admin brings it back, as a Draft.'],
  ];
  return (
    <div className="a-card p14-five">
      <h2>The five statuses</h2>
      <dl className="a-kv">
        {rows.map(([k, l, t]) => [<dt key={`${k}t`}><StatusPill status={k} label={l} /></dt>, <dd key={`${k}d`}>{t}</dd>])}
      </dl>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------ the product panel
// Basics: name, brand, category_key, variant_of, featured, show_for_home, order, specification, spec_status, swatch_hex
const tabOfKey = (k) => (k.startsWith('tr.') ? 'words' : k === 'packed_by' || k === 'origin' ? 'label' : 'basics');

function startOf(p) {
  const tr = {};
  Object.entries(p.tr || {}).forEach(([l, t]) => { tr[l] = { ...t }; });
  return {
    name: (p.tr && p.tr.en && p.tr.en.name) || '', brand: p.brand || '', category_key: p.category_key || '', variant_of: p.variant_of || '',
    featured: String(p.featured || 0), show_for_home: Boolean(p.show_for_home), order: String(p.order ?? ''), specification: p.specification || '',
    spec_status: p.spec_status || '', swatch_hex: p.swatch_hex || '', packed_by: p.packed_by || '', origin: p.origin || '', tr,
  };
}

function ProductDrawer({ id, list, onClose, onChanged, onOpenSku }) {
  const pickedG = usePicked(); // the Packs tab's stock follows the header godown
  const load = useLoad(`/catalogue/products/${encodeURIComponent(id)}`);
  const { me } = useAdmin();
  const canEdit = useCan('products', 'edit');
  const canCreate = useCan('products', 'create');
  const canCancel = useCan('products', 'cancel');
  const isAdmin = Boolean(me && me.is_admin);
  const act = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const up = useUpload();
  const [form, setForm] = useState(null);
  const [errs, setErrs] = useState({});
  const [tab, setTab] = useState('basics');
  const [lang, setLang] = useState('en');
  const [pack, setPack] = useState('');
  const focusRef = useRef(null);
  const p = load.data;
  const start = useMemo(() => (p ? startOf(p) : null), [p]);
  const f = form || start;
  const dirty = Boolean(form && start && JSON.stringify(form) !== JSON.stringify(start));

  useEffect(() => {
    const keys = Object.keys(act.fields || {});
    setErrs(act.fields || {});
    if (!keys.length) return;
    const k = keys[0];
    setTab(tabOfKey(k));
    if (k.startsWith('tr.')) setLang(k.split('.')[1]);
    focusRef.current = k;
    setTimeout(() => { const el = document.getElementById(fid(focusRef.current)); if (el) el.focus(); }, 0);
  }, [act.fields]);

  if (!p || !f) return <Drawer title={id} onClose={onClose}><Loading state={load}>{null}</Loading></Drawer>;

  const clearErr = (k) => {
    if (!errs[k]) return;
    const n = { ...errs }; delete n[k]; setErrs(n);
    if (!Object.keys(n).length) act.setMsg(null);
  };
  const set = (k, v) => { setForm({ ...f, [k]: v }); clearErr(k); };
  const setTr = (l, k, v) => { setForm({ ...f, tr: { ...f.tr, [l]: { ...(f.tr[l] || {}), [k]: v } } }); clearErr(`tr.${l}.${k}`); };
  const ro = !canEdit;
  const blocked = () => { if (dirty) { toast('warn', 'Save or cancel your changes first', 'Then do this.'); return true; } return false; };
  const cancel = async () => { if (dirty && !(await confirm(DISCARD))) return; onClose(); };
  const refresh = () => { load.reload(); onChanged(); };
  const pid = encodeURIComponent(p.product_id);
  const products = (list && list.products) || [];
  const cats = (list && list.categories) || [];
  const hasKids = products.some((x) => x.variant_of === p.product_id);
  const showSwatch = Boolean(f.variant_of) || hasKids || Boolean(p.swatch_hex);

  const save = () => act.run(async () => {
    const body = { name: f.name, brand: f.brand, category_key: f.category_key, variant_of: f.variant_of, featured: Number(f.featured) || 0, show_for_home: f.show_for_home,
      order: f.order, specification: f.specification, spec_status: f.spec_status, packed_by: f.packed_by, origin: f.origin, tr: {} };
    if (showSwatch) body.swatch_hex = f.swatch_hex;
    Object.entries(f.tr).forEach(([l, t]) => { body.tr[l] = l === 'en' ? Object.fromEntries(Object.entries(t).filter(([k]) => k !== 'name')) : t; });
    const r = await api.send('PUT', `/catalogue/products/${pid}`, body);
    load.setData(r.product);
    setForm(null);
    setErrs({});
    toast('good', 'Saved', r.message);
    onChanged();
  });

  const setStatus = async (to) => {
    if (blocked()) return;
    if (to === 'discontinued' && !(await confirm({ title: `Discontinue ${f.name}?`, message: 'It leaves the website. The stock left is still sold, and at zero the nightly check archives it.', action: 'Discontinue' }))) return;
    if (to === 'archived' && !(await confirm({ title: `Archive ${f.name}?`, message: 'It stays in history but can never be sold again. Only an Admin can bring it back.', action: 'Archive', danger: true }))) return;
    if (to === 'active' && p.status === 'discontinued' && !(await confirm({ title: `Make ${f.name} active again?`, message: 'A discontinued product comes back only when a second Admin approves. It can then be sold and back-ordered again.', action: 'Ask for approval' }))) return;
    act.run(async () => {
      const r = await api.send('POST', `/catalogue/products/${pid}/status`, { to });
      toast(r.waiting ? 'warn' : to === 'active' ? 'good' : 'warn', r.waiting ? 'Waiting for approval' : f.name, r.message);
      refresh();
    });
  };

  // photos
  const imgs = p.images || [];
  const freePos = [1, 2, 3].find((n) => !imgs.some((i) => Number(i.position) === n));
  const upload = (file) => { if (blocked()) return; act.run(async () => { await up.send('photo', `/products/${pid}/images`, file, { position: freePos }); toast('good', 'Picture added', p.product_id); refresh(); }); };
  const makeMain = (pos) => { if (blocked()) return; act.run(async () => { await api.send('PUT', `/products/${pid}/images/order`, { order: [pos, ...imgs.map((i) => i.position).filter((x) => x !== pos)] }); toast('good', 'Main picture changed', f.name); refresh(); }); };
  const removePic = async (pos) => {
    if (blocked()) return;
    if (!(await confirm({ title: 'Remove this picture?', message: `It is taken off ${f.name} everywhere.`, action: 'Remove', danger: true }))) return;
    act.run(async () => { await api.send('DELETE', `/products/${pid}/images/${pos}`); toast('good', 'Picture removed', f.name); refresh(); });
  };
  const addSku = () => {
    if (blocked()) return;
    if (!pack.trim()) { toast('bad', 'Not added', 'Type the pack, like "Pack of 200".'); return; }
    act.run(async () => { const r = await api.send('POST', `/catalogue/products/${pid}/skus`, { pack: pack.trim() }); setPack(''); toast('good', `${r.sku_code} added`, r.message); refresh(); });
  };

  const colour = Boolean(f.swatch_hex || f.variant_of);
  const gaps = p.lang_gaps || [];
  const nameOf = (pidx) => (products.find((x) => x.product_id === pidx) || {}).name || pidx;
  const err = (k) => errs[k];
  const tabBad = (t) => Object.keys(errs).some((k) => tabOfKey(k) === t);
  const langs = p.languages || [{ code: 'en', name: 'English', is_default: true }];
  const places = Math.max(1, Number(p.featured_places) || 5);

  const sb = [];
  if (p.status === 'draft' || p.status === 'hidden') sb.push(<button key="act" type="button" className="a-btn a-btn-sm" disabled={!canEdit || act.busy} onClick={() => setStatus('active')}><LIcon name="check" size="sm" />Make active</button>);
  if (p.status === 'active') sb.push(<button key="hide" type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={!canEdit || act.busy} onClick={() => setStatus('hidden')}><PIcon name="eye" size="sm" />Hide from website</button>);
  if (p.status === 'active' || p.status === 'hidden') sb.push(<button key="disc" type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={!canCancel || act.busy} onClick={() => setStatus('discontinued')}>Discontinue</button>);
  if (p.status === 'discontinued') sb.push(<button key="back" type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={!canEdit || act.busy || Boolean(p.waiting_back)} onClick={() => setStatus('active')}>Make active again (asks approval)</button>);
  if (p.status === 'discontinued' || p.status === 'draft') sb.push(<button key="arch" type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={!canCancel || act.busy} onClick={() => setStatus('archived')}>Archive</button>);
  if (p.status === 'archived') sb.push(<button key="draft" type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={!isAdmin || act.busy} title={isAdmin ? undefined : 'Admin only'} onClick={() => setStatus('draft')}>Bring back as Draft</button>);

  const tabs = [
    { key: 'basics', label: 'Basics', icon: 'package' },
    { key: 'words', label: 'Website words', icon: 'globe', count: gaps.length || '' },
    { key: 'photos', label: 'Photos', icon: 'image', count: imgs.length ? '' : '!' },
    { key: 'packs', label: 'Packs', icon: 'tag', count: (p.skus || []).length },
    { key: 'label', label: 'Label', icon: 'receipt' },
    { key: 'history', label: 'History', icon: 'clipboard-check' },
  ].map((t) => ({ ...t, bad: tabBad(t.key) }));
  const trv = (l, k) => ((f.tr[l] || {})[k] ?? '');
  const trIn = (l, k, label, { area, rows = 2, max, hint, req, full = true } = {}) => (
    <Fld key={`${l}-${k}`} k={`tr.${l}.${k}`} label={label} req={req} hint={hint} error={err(`tr.${l}.${k}`)} full={full}>
      {area
        ? <textarea id={fid(`tr.${l}.${k}`)} rows={rows} maxLength={max} value={trv(l, k)} disabled={ro} onChange={(e) => setTr(l, k, e.target.value)} />
        : <input id={fid(`tr.${l}.${k}`)} maxLength={max} value={trv(l, k)} disabled={ro} onChange={(e) => setTr(l, k, e.target.value)} />}
    </Fld>
  );

  return (
    <Drawer title={f.name || p.product_id} onClose={onClose} dirty={dirty}
      thumb={imgs[0] ? mediaUrl(`/media/products/400/${imgs[0].file_name}`) : <PIcon name="image" />}
      status={<><StatusPill status={p.status} label={p.status_label} />{p.waiting_back && <Pill tone="warn">Bringing it back waits for approval</Pill>}<span className="a-sp p14-sp" />{sb}</>}
      footer={canEdit ? (
        <><span className="a-sp p14-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={cancel}>Cancel</button>
          <button type="button" className="a-btn" disabled={!dirty || act.busy} onClick={save}><LIcon name="check" size="sm" />Save</button></>
      ) : <><span className="a-sp p14-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>Close</button></>}>
      {act.note}
      {(p.status === 'draft' || p.status === 'hidden') && (p.active_problems || []).length > 0 && (
        <div className="a-alert a-alert-warn" role="status"><LIcon name="triangle-alert" /><div className="a-alert-tx"><b>Before it can be active</b> {p.active_problems.join('; ')}.</div></div>
      )}
      <DTabs tabs={tabs} value={tab} onChange={setTab} label="Sections" />

      <div className="p14-form" hidden={tab !== 'basics'}>
        <Fld k="name" label="Name, exactly as supplied" req error={err('name')} hint="Keep the wording as supplied; a change is logged.">
          <input id={fid('name')} value={f.name} maxLength={80} disabled={ro} onChange={(e) => set('name', e.target.value)} />
        </Fld>
        <Fld k="brand" label="Brand" req error={err('brand')} hint="dFresh, or the maker's brand for a bought-in pack. Printed on labels and invoices.">
          <input id={fid('brand')} value={f.brand} maxLength={40} disabled={ro} onChange={(e) => set('brand', e.target.value)} />
        </Fld>
        <Fld k="category_key" label="Category" req error={err('category_key')}>
          <select id={fid('category_key')} value={f.category_key} disabled={ro} onChange={(e) => set('category_key', e.target.value)}>
            {cats.map((c) => <option key={c.category_key} value={c.category_key} disabled={!c.is_active && c.category_key !== f.category_key}>{c.name}{c.is_active ? '' : ' (hidden)'}</option>)}
          </select>
        </Fld>
        <Fld k="variant_of" label="Colour version of" error={err('variant_of')}>
          <select id={fid('variant_of')} value={f.variant_of} disabled={ro} onChange={(e) => set('variant_of', e.target.value)}>
            <option value="">Not a colour version</option>
            {products.filter((x) => x.product_id !== p.product_id && !x.variant_of).map((x) => <option key={x.product_id} value={x.product_id}>{x.name}</option>)}
          </select>
        </Fld>
        <Fld k="featured" label="Most loved on the home page" error={err('featured')} hint={`${places} places, each used once. Taking a used place swaps the two products.`}>
          <select id={fid('featured')} value={f.featured} disabled={ro} onChange={(e) => set('featured', e.target.value)}>
            <option value="0">Not in Most loved</option>
            {Array.from({ length: places }, (_, i) => i + 1).map((n) => {
              const other = (p.featured_taken || {})[n];
              return <option key={n} value={String(n)}>Position {n}{other && other !== p.product_id ? ` (now ${nameOf(other)})` : ''}</option>;
            })}
          </select>
        </Fld>
        <Fld k="show_for_home" label={'"For Home" filter on dfresh.us'} error={err('show_for_home')}>
          <select id={fid('show_for_home')} value={f.show_for_home ? '1' : '0'} disabled={ro} onChange={(e) => set('show_for_home', e.target.value === '1')}>
            <option value="1">Yes, show under For Home</option><option value="0">No, business only</option>
          </select>
        </Fld>
        <Fld k="order" label="Website order in its category" req error={err('order')} hint="Smaller comes first. A colour version keeps its main product's whole number, like 5.1 after 5.">
          <input id={fid('order')} value={f.order} inputMode="decimal" maxLength={12} disabled={ro} onChange={(e) => set('order', e.target.value)} />
        </Fld>
        {showSwatch && (
          <Fld k="swatch_hex" label="Swatch colour" error={err('swatch_hex')} hint="The colour dot on the product card, #RRGGBB.">
            <span className="p14-swrow">
              <input type="color" aria-label="Pick the swatch colour" value={/^#[0-9A-Fa-f]{6}$/.test(f.swatch_hex) ? f.swatch_hex.toLowerCase() : '#000000'} disabled={ro}
                onChange={(e) => set('swatch_hex', e.target.value.toUpperCase())} />
              <input id={fid('swatch_hex')} value={f.swatch_hex} maxLength={7} placeholder="#RRGGBB" disabled={ro} onChange={(e) => set('swatch_hex', e.target.value.trim().toUpperCase())} />
            </span>
          </Fld>
        )}
        <Fld k="specification" label="Specification" req full error={err('specification')} hint="Ply · GSM · size · count, shown on the product card.">
          <input id={fid('specification')} value={f.specification} maxLength={255} disabled={ro} onChange={(e) => set('specification', e.target.value)} />
        </Fld>
        <Fld k="spec_status" label="Spec status (staff only)" full error={err('spec_status')} hint="Internal note, never shown on the website.">
          <textarea id={fid('spec_status')} rows={2} maxLength={255} value={f.spec_status} disabled={ro} onChange={(e) => set('spec_status', e.target.value)} />
        </Fld>
      </div>

      <div hidden={tab !== 'words'}>
        <div className="a-seg p14-ltabs" role="group" aria-label="Language">
          {langs.map((l) => {
            const bad = Object.keys(errs).some((k) => k.startsWith(`tr.${l.code}.`));
            return (
              <button key={l.code} type="button" aria-pressed={lang === l.code} className={bad ? 'p14-lbad' : undefined} onClick={() => setLang(l.code)}>
                {l.name}{gaps.includes(String(l.code).toUpperCase()) && <span className="p14-dotw" title="missing" aria-label="missing" />}
              </button>
            );
          })}
        </div>
        {langs.map((l) => {
          const en = l.code === 'en';
          const miss = (k) => (!en && !trv(l.code, k) ? ' (missing)' : '');
          return (
            <div key={l.code} className="p14-form" hidden={lang !== l.code}>
              {!en && trIn(l.code, 'name', `Name in ${l.name}${miss('name')}`, { max: 150, hint: `Shown on dfresh.us in ${l.name}. Labels keep the name as supplied.` })}
              {trIn(l.code, 'one_liner', `Short line${miss('one_liner')}`, { area: true, max: 200, req: en, hint: en ? 'Shown when another language is missing.' : undefined })}
              {trIn(l.code, 'keywords', 'Keywords', { max: 255, hint: `Comma separated, up to 6. The first 3 show as chips on the card.${en ? ' Needed before it can be active.' : ''}` })}
              {trIn(l.code, 'description', 'Full description', { area: true, rows: 4, max: 1200, hint: en ? 'Needed before it can be active.' : undefined })}
              {trIn(l.code, 'best_for', 'Best for', { max: 255, hint: `Like: Tea shops · Eateries · Home${en ? '. Needed before it can be active.' : ''}` })}
              {colour && trIn(l.code, 'colour_name', 'Colour name', { max: 50, hint: 'The label under the colour dot.', full: false })}
              {trIn(l.code, 'alt_text', 'Photo alt text', { max: 255, hint: `Read by Google and screen readers.${en ? '' : ' Falls back to English.'}` })}
              {trIn(l.code, 'whatsapp_message', 'WhatsApp ready message', { area: true, max: 500, hint: `Filled in when a visitor taps "Ask on WhatsApp".${en ? '' : ' Falls back to English.'}` })}
              {!en && trIn(l.code, 'specification', `Specification in ${l.name} (optional)`, { max: 255, hint: 'Leave empty to show the English one.' })}
              {!en && trIn(l.code, 'pack', `Pack text in ${l.name} (optional)`, { max: 120, hint: 'Leave empty to show the English pack text.' })}
            </div>
          );
        })}
      </div>

      <div hidden={tab !== 'photos'}>
        {imgs.length ? (
          <div className="p14-pics">
            {imgs.map((img, i) => (
              <div key={img.position} className={`p14-pic${i === 0 ? ' p14-main' : ''}`}>
                <img src={mediaUrl(`/media/products/400/${img.file_name}`)} alt={i === 0 ? `${f.name}, main picture` : `Picture ${i + 1}`} />
                {i === 0 && <Pill tone="gold" className="p14-mini p14-pm">Main</Pill>}
                {canEdit && (
                  <div className="p14-pa">
                    {i > 0 ? <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => makeMain(img.position)}>Make main</button> : <span />}
                    <button type="button" className="a-iconbtn p14-del" disabled={act.busy} aria-label={`Remove picture ${i + 1}`} onClick={() => removePic(img.position)}><PIcon name="trash-2" size="sm" /></button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="a-alert a-alert-warn" role="status"><PIcon name="image" /><div className="a-alert-tx"><b>No picture yet.</b> A product without a picture cannot be active.</div></div>
        )}
        {canEdit && (
          <div className="p14-upl">
            {freePos ? (
              <UploadButton upload={up} uploadKey="photo" accept="image/jpeg,image/png,image/webp" disabled={act.busy} onFile={upload}
                label={<><PIcon name="upload" size="sm" />Upload a photo</>} />
            ) : <span className="a-muted">Three pictures is the most. Remove one to add another.</span>}
            <span className="a-hint-s">JPG, PNG or WebP, up to 8 MB. The first picture is the main one everywhere. Alt text is under Website words.</span>
          </div>
        )}
      </div>

      <div hidden={tab !== 'packs'}>
        {(p.skus || []).map((s) => (
            <button key={s.sku_code} type="button" className="p14-skurow" onClick={async () => { if (dirty && !(await confirm(DISCARD))) return; onOpenSku(s.sku_code); }}>
              <b>{s.sku_code}</b>
              <span className="p14-skumeta">{s.size_label} · {s.packs_per_carton} per carton · stock {s.stock_by ? stockOf({ stock: s.stock_by }, pickedG.id) : s.stock}{s.mrp ? ` · MRP Rs ${Number(s.mrp).toFixed(2)}` : ''}</span>
              <StatusPill status={s.status} label={s.status_label} />
              {s.status === 'active' && !s.ready && <Pill tone="bad" title="Set weight and HSN before it can be sold">Not ready</Pill>}
              <LIcon name="chevron-right" size="sm" />
            </button>
        ))}
        {canCreate && p.status !== 'archived' && (
          <div className="p14-inline">
            <label className="p14-fi"><LIcon name="plus" size="sm" /><input value={pack} placeholder="Add a pack size, e.g. Pack of 200" aria-label="New pack size"
              onChange={(e) => setPack(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addSku(); }} /></label>
            <button type="button" className="a-btn" disabled={act.busy} onClick={addSku}>Add SKU</button>
          </div>
        )}
      </div>

      <div hidden={tab !== 'label'}>
        <p className="a-hint-s p14-mt0 p14-mb">Every retail pack must carry these by law. MRP and net quantity are set on each pack (Packs); the month of packing is chosen when labels are printed.</p>
        <div className="p14-form">
          <Fld k="packed_by" label="Packed or marketed by" full error={err('packed_by')} hint="Leave empty for the company. For a bought-in pack, the maker or importer.">
            <textarea id={fid('packed_by')} rows={2} maxLength={200} value={f.packed_by} placeholder={(p.label_defaults || {}).packed_by || ''} disabled={ro} onChange={(e) => set('packed_by', e.target.value)} />
          </Fld>
          <Fld k="origin" label="Country of origin" req error={err('origin')}>
            <input id={fid('origin')} value={f.origin} maxLength={40} disabled={ro} onChange={(e) => set('origin', e.target.value)} />
          </Fld>
          <div className="a-field p14-fld">
            <span className="p14-l">Customer care</span>
            <div className="p14-box">{[(p.label_defaults || {}).phone, (p.label_defaults || {}).email].filter(Boolean).join(' · ') || '-'}</div>
            <small className="a-hint">From Company. Change it there.</small>
          </div>
        </div>
      </div>

      <div hidden={tab !== 'history'}>
        {(p.history || []).length ? (
          <div className="a-tw p14-flat">
            <table className="a-table p14-hist-t">
              <tbody>
                {p.history.map((h, i) => (
                  <tr key={i}>
                    <td className="p14-when">{fmtDate(h.at)}<small className="a-sub-l">{h.who_name || h.who || '-'}</small></td>
                    <td><b>{h.action} {h.what}</b><small className="a-sub-l">{h.on}</small></td>
                    <td className="p14-diff">
                      {(h.changes || []).map((c, j) => (
                        <span key={j} className="p14-blk">{c.field && <>{c.field}: </>}{c.from !== null && c.from !== undefined && <s>{c.from}</s>} {c.to !== null && c.to !== undefined && <ins>{c.to}</ins>}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="a-empty"><h3>No changes yet</h3><p>Every change to this product and its packs shows here.</p></div>
        )}
      </div>
    </Drawer>
  );
}

// ------------------------------------------------------------------------------------------------ new product
function NewProduct({ categories, onClose, onCreated }) {
  const act = useAction();
  const confirm = useConfirm();
  const empty = { name: '', product_id: '', category_key: '', first_pack: '', source: 'made', specification: '', one_liner: '' };
  const [f, setF] = useState(empty);
  const [errs, setErrs] = useState({});
  const dirty = JSON.stringify(f) !== JSON.stringify(empty);
  useEffect(() => {
    setErrs(act.fields || {});
    const k = Object.keys(act.fields || {})[0];
    if (k) setTimeout(() => { const el = document.getElementById(fid(`np.${k}`)); if (el) el.focus(); }, 0);
  }, [act.fields]);
  const set = (k, v) => { setF({ ...f, [k]: v }); if (errs[k]) { const n = { ...errs }; delete n[k]; setErrs(n); if (!Object.keys(n).length) act.setMsg(null); } };
  const create = () => act.run(async () => { const r = await api.send('POST', '/catalogue/products', { ...f, product_id: f.product_id.trim().toUpperCase() }); onCreated(r); });
  const cancel = async () => { if (dirty && !(await confirm(DISCARD))) return; onClose(); };
  const F = (k) => `np.${k}`;
  return (
    <Drawer title="New product" onClose={onClose} dirty={dirty} thumb={<PIcon name="image" />}
      footer={<><span className="a-sp p14-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={cancel}>Cancel</button>
        <button type="button" className="a-btn" disabled={!dirty || act.busy} onClick={create}><LIcon name="check" size="sm" />Create as Draft</button></>}>
      {act.note}
      <div className="a-alert a-alert-info" role="status"><LIcon name="info" /><div className="a-alert-tx"><b>A new product starts as a Draft.</b> Add its picture, its website words and finish its SKU, then make it active.</div></div>
      <div className="p14-form">
        <Fld k={F('name')} label="Name, exactly as supplied" req full error={errs.name}>
          <input id={fid(F('name'))} maxLength={80} placeholder="e.g. Kitchen Towels - 4 Pack" value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Fld>
        <Fld k={F('product_id')} label="Product code" req error={errs.product_id} hint="DZIND-DF and three digits. Never changes once saved.">
          <input id={fid(F('product_id'))} placeholder="DZIND-DF050" maxLength={30} value={f.product_id} onChange={(e) => set('product_id', e.target.value.toUpperCase())} />
        </Fld>
        <Fld k={F('category_key')} label="Category" req error={errs.category_key}>
          <select id={fid(F('category_key'))} value={f.category_key} onChange={(e) => set('category_key', e.target.value)}>
            <option value="">Choose...</option>
            {categories.filter((c) => c.is_active).map((c) => <option key={c.category_key} value={c.category_key}>{c.name}</option>)}
          </select>
        </Fld>
        <Fld k={F('first_pack')} label="First pack" req error={errs.first_pack} hint={'"Pack of 100" makes SKU DF050-M100, "4 rolls" makes DF050-R4.'}>
          <input id={fid(F('first_pack'))} placeholder="Pack of 100 / 4 rolls / Box" maxLength={120} value={f.first_pack} onChange={(e) => set('first_pack', e.target.value)} />
        </Fld>
        <Fld k={F('source')} label="Made or bought" req error={errs.source}>
          <select id={fid(F('source'))} value={f.source} onChange={(e) => set('source', e.target.value)}>
            <option value="made">Made by dFresh</option><option value="bought">Bought in</option><option value="both">Made and bought</option>
          </select>
        </Fld>
        <Fld k={F('specification')} label="Specification" req full error={errs.specification} hint="Ply · GSM · size · count.">
          <input id={fid(F('specification'))} maxLength={255} placeholder="2-ply · 4 rolls" value={f.specification} onChange={(e) => set('specification', e.target.value)} />
        </Fld>
        <Fld k={F('one_liner')} label="Short line (English)" full error={errs.one_liner}>
          <textarea id={fid(F('one_liner'))} rows={2} maxLength={200} value={f.one_liner} onChange={(e) => set('one_liner', e.target.value)} />
        </Fld>
      </div>
    </Drawer>
  );
}
