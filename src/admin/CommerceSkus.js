// Masters > Catalogue > Barcodes and labels (phase 14, v23 viewBarcodes / doScan / linkScan / viewLabels / showLabels /
// packDecl; API /catalogue/scan, /catalogue/barcodes, /catalogue/labels in catalogue.js). Three tabs:
// - Scan: any barcode (our own SKU label, the supplier's EAN, a carton code) finds its SKU, with the stock of the godown
//   picked at the top. A misread EAN-13 says so; an unknown code can be linked here by someone with Edit on Products,
//   anyone else notes it for the office ("Scanned, not yet linked", red count on the tab). People without Products
//   can still scan here when they have Inventory or Packing.
// - All barcodes: every barcode with its kind and SKU.
// - Print labels: 1. pick the packs, 2. choose the label (pack / carton / shelf, the language, copies, month of packing),
//   3. the labels, then Print opens an A4 sheet in a new window. The label words come from the label texts in every
//   language (ui_text); the pack declaration (MRP, net quantity, packed by, customer care, origin) stays in English,
//   as the law allows. Batch labels (SKU/BATCH) stay below.
// Barcodes are Code 128 (JsBarcode).
import { useMemo, useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import { api } from './adminApi';
import { Alert, Loading, Notice, PageHead, Pill, Table, Tabs, LIcon, fmtDate, money, useAdmin, useCan, useLoad, useToast } from './ui';
import { FONT_STACK, PRINT_FONTS, printWhenReady } from './printKit';
import { savedGodown } from './HeaderBar';
import { Thumb } from './Categories';
import { splitMsg } from './Units';

const BARCODE = { format: 'CODE128', margin: 6, background: '#ffffff', lineColor: '#121214', font: 'monospace' };

function Barcode({ value, height = 44, width = 1.4, fontSize = 13 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) {
      try { JsBarcode(ref.current, value, { ...BARCODE, height, width, fontSize, displayValue: true }); } catch { /* a value Code 128 cannot hold: the text below stays */ }
    }
  }, [value, height, width, fontSize]);
  return <svg ref={ref} className="a-barcode" role="img" aria-label={`Barcode ${value}`} />;
}

// SVG markup of one barcode, for the label sheet window
function barcodeSvg(value, { height = 46, width = 1.5, fontSize = 13 } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try { JsBarcode(svg, value, { ...BARCODE, height, width, fontSize, displayValue: true }); } catch { return `<div class="mono">${esc(value)}</div>`; }
  return svg.outerHTML;
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthText = (m) => (/^\d{4}-\d{2}$/.test(m || '') ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : '');
const thisMonth = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7);
const BLOCKED = 'The label window was blocked: allow pop-ups for this site and try again.';

/** the batch label sheet: items = [{ code, name, sub }] */
function printLabels(items, copies, what) {
  const labels = items.flatMap((s) => Array(copies).fill(s)).map((s) => `
    <div class="label"><div class="name">${esc(s.name)}</div>${barcodeSvg(s.code)}<div class="size">${esc(s.sub)}</div></div>`).join('');
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>dFresh ${esc(what)} - ${items.length}</title>${PRINT_FONTS}
<style>
  @page { size: A4; margin: 8mm; }
  body { margin: 0; font-family: ${FONT_STACK}; color: #121214; }
  .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; }
  .label { height: 34mm; border: 1px dashed #c9c6bc; border-radius: 2mm; padding: 1.5mm 2mm; display: flex; flex-direction: column;
           align-items: center; justify-content: center; overflow: hidden; break-inside: avoid; }
  .name { font-size: 9pt; font-weight: 700; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
  .size { font-size: 8pt; color: #4a4840; }
  .label svg { max-width: 100%; height: auto; }
  .bar { padding: 8px 0 12px; font-size: 13px; } @media print { .bar { display: none; } .label { border-color: #e2dccb; } }
</style></head><body><div class="bar">dFresh ${esc(what)} - ${items.length} label(s), ${copies} each. Print, or choose "Save as PDF".</div>
<div class="sheet">${labels}</div></body></html>`);
  w.document.close();
  printWhenReady(w);
  return true;
}

/** one label's content (preview and sheet): { name, lines: [text], decl: [text] | null, mrpLine, code } */
function labelOf(r, shown, words, company) {
  const w = words[shown.lang] || words.en || {};
  const cat = r.category ? (r.category[shown.lang] || r.category.en || '') : '';
  const kindLine = shown.type === 'carton' ? `${w.lb_carton_of} ${r.packs_per_carton} ${w.lb_packs}`
    : shown.type === 'shelf' ? `${w.lb_shelf} · ${w.lb_reorder} ${r.reorder ?? 0}`
      : `${w.lb_pack}: ${r.size_label || ''}`;
  const decl = shown.type === 'pack' && r.sku_type === 'finished' ? {
    mrp: r.mrp !== null && r.mrp !== undefined ? `MRP ${money(r.mrp)}` : 'MRP not set',
    mrpNote: r.mrp !== null && r.mrp !== undefined ? ' (incl. of all taxes)' : '',
    lines: [
      `Net qty: ${r.net_qty || r.size_label || ''} · Packed: ${monthText(shown.month)}`,
      `Brand: ${r.brand || ''}`,
      `Packed by: ${r.packed_by || [company.name, company.address].filter(Boolean).join(', ')}`,
      `Customer care: ${[company.phone, company.email].filter(Boolean).join(', ')}`,
      `Country of origin: ${r.origin || ''}`,
    ],
  } : null;
  return { name: r.name, lines: [cat ? `${w.lb_category}: ${cat}` : null, kindLine].filter(Boolean), decl, code: shown.type === 'carton' ? r.carton_code : r.sku_code };
}

/** the A4 sheet of shown labels in a new window */
function printSheet(labels, shown) {
  const body = labels.map((l) => `<div class="label"><b>${esc(l.name)}</b><span>${l.lines.map(esc).join('<br>')}</span>${
    l.decl ? `<span class="decl"><b>${esc(l.decl.mrp)}</b>${esc(l.decl.mrpNote)}<br>${l.decl.lines.map(esc).join('<br>')}</span>` : ''}${barcodeSvg(l.code)}</div>`).join('');
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html lang="${esc(shown.lang)}"><head><meta charset="utf-8"><title>dFresh ${esc(shown.type)} labels - ${labels.length}</title>${PRINT_FONTS}
<style>
  @page { size: A4; margin: 8mm; }
  body { margin: 0; font-family: ${FONT_STACK}; color: #111; }
  .sheet { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2mm; }
  .label { border: 1px dashed #c9c6bc; border-radius: 2mm; padding: 2.5mm; font-size: 8.5pt; line-height: 1.35; overflow: hidden; break-inside: avoid; }
  .label > b { display: block; font-size: 9.5pt; margin-bottom: 1mm; }
  .decl { display: block; font-size: 7pt; line-height: 1.35; margin-top: 1.5mm; padding-top: 1.5mm; border-top: 1px dotted #999; }
  .decl b { display: inline; font-size: 7.5pt; }
  .label svg { display: block; max-width: 100%; height: auto; margin-top: 1.5mm; }
  .bar { padding: 8px 0 12px; font-size: 13px; } @media print { .bar { display: none; } .label { border-color: #e2dccb; } }
</style></head><body><div class="bar">dFresh ${esc(shown.type)} labels - ${labels.length} label(s). Print, or choose "Save as PDF".</div>
<div class="sheet">${body}</div></body></html>`);
  w.document.close();
  printWhenReady(w);
  return true;
}

export default function CommerceSkus() {
  const canView = useCan('products', 'view');
  const canEdit = useCan('products', 'edit');
  const canInv = useCan('inventory', 'view');
  const barcodes = useLoad(canView ? '/catalogue/barcodes' : null);
  const unknown = (canEdit && barcodes.data && barcodes.data.unknown) || [];
  const tabs = [
    { key: 'scan', label: 'Scan', count: unknown.length },
    ...(canView ? [{ key: 'all', label: 'All barcodes' }] : []),
    ...(canView || canInv ? [{ key: 'labels', label: 'Print labels' }] : []),
  ];
  const [tab, setTab] = useState('scan');
  return (
    <section>
      <PageHead sub="Scan any barcode to find its SKU, see every barcode, print pack, carton and shelf labels." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} label="Barcodes and labels" className="a-p14-btabs" />
      {tab === 'scan' && <ScanTab barcodes={barcodes} unknown={unknown} canView={canView} canEdit={canEdit} />}
      {tab === 'all' && canView && <AllTab barcodes={barcodes} />}
      {tab === 'labels' && (
        <>
          {canView && <LabelMaker />}
          <BatchLabels />
        </>
      )}
    </section>
  );
}

function ScanTab({ barcodes, unknown, canView, canEdit }) {
  const { me } = useAdmin();
  const toast = useToast();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState({ sku: '', kind: 'supplier' });
  const ref = useRef(null);
  const picked = savedGodown(me);
  const gName = picked ? (((me && me.godown_list) || []).find((g) => Number(g.godown_id) === Number(picked)) || {}).name || 'This godown' : 'All godowns';
  const skus = (barcodes.data && barcodes.data.skus) || [];
  const imageOf = (sku) => ((barcodes.data && barcodes.data.rows.find((r) => r.sku_code === sku && r.image)) || {}).image;

  const focus = () => setTimeout(() => { if (ref.current) { ref.current.focus(); ref.current.select(); } }, 0);
  const scan = async (raw) => {
    const c = String(raw ?? '').trim().toUpperCase();
    setCode(c);
    if (!c) { setRes(null); toast('bad', 'Nothing scanned', 'Scan or type a barcode.'); focus(); return; }
    setBusy(true);
    try {
      const out = await api.send('POST', '/catalogue/scan', { code: c });
      setRes(out);
      if (out.unknown && out.can_link) setLink((l) => ({ ...l, sku: l.sku || (skus[0] && skus[0].sku_code) || '' }));
      if (out.noted || out.can_link) barcodes.reload();
    } catch (e) {
      setRes(null);
      toast('bad', 'Not found', e.message);
    } finally { setBusy(false); focus(); }
  };
  const doLink = async () => {
    if (!res || !link.sku) { toast('bad', 'Not linked', 'Choose the SKU.'); return; }
    setBusy(true);
    try {
      const out = await api.send('POST', '/catalogue/barcodes/link', { barcode: res.code, sku_code: link.sku, kind: link.kind });
      const [t, x] = splitMsg(out.message, 'Linked');
      toast('good', t, x);
      barcodes.reload();
      setBusy(false);
      scan(res.code);
    } catch (e) {
      toast('bad', 'Not linked', e.message);
      setBusy(false);
    }
  };
  const stock = res && res.stock ? (picked ? res.stock[picked] ?? 0 : res.stock.all ?? 0) : 0;
  const statusPill = (r) => {
    if (r.type === 'raw') return <Pill tone="info">Raw material</Pill>;
    return <Pill tone={r.status === 'active' ? 'good' : r.status === 'discontinued' ? 'warn' : 'gray'}>{r.status === 'active' ? 'Active' : r.status === 'discontinued' ? 'Discontinued' : String(r.status || '').replace(/^./, (x) => x.toUpperCase())}</Pill>;
  };

  return (
    <>
      <div className="a-card">
        <p className="a-p14-lead">Scan or type any barcode: our own label, the supplier&apos;s EAN or a carton code. All of them find the same SKU.</p>
        <form className="a-p14-scanbox" onSubmit={(e) => { e.preventDefault(); scan(code); }}>
          <label className="a-p14-scanin"><LIcon name="search" />
            <input ref={ref} value={code} autoFocus autoComplete="off" placeholder="Scan here, then Enter" aria-label="Barcode" onChange={(e) => setCode(e.target.value)} />
          </label>
          <button type="submit" className="a-btn a-p14-find" disabled={busy}>Find</button>
        </form>
        {res && res.sku && (
          <div className="a-p14-scanres">
            <Thumb file={imageOf(res.sku)} size={64} />
            <div>
              <b>{res.sku} · {res.name}</b>
              <span>Found by its {String(res.kind_label || '').toLowerCase()}{res.kind === 'carton' ? ` · 1 scan = 1 carton = ${res.packs} packs` : ''} · {gName} stock {stock}</span>
              <div className="a-p14-mt6">{statusPill(res)}</div>
            </div>
            {canView && <button type="button" className="a-btn a-btn-ghost" onClick={() => navigate(`/admin/products?sku=${encodeURIComponent(res.sku)}`)}>Open</button>}
          </div>
        )}
        {res && res.bad && (
          <Alert tone="bad" title={`${res.code} is a misread.`} className="a-p14-mt12">Its EAN-13 check digit is wrong. Scan it again.</Alert>
        )}
        {res && res.unknown && (
          <>
            <Alert tone="warn" title={`${res.code} belongs to no SKU.`} className="a-p14-mt12">
              {res.can_link ? 'Link it below, or put the pack aside.' : 'It has been noted for the office. Put the pack aside until they link it.'}
            </Alert>
            {res.can_link && (
              <div className="a-p14-inline">
                <select className="a-p14-grow" value={link.sku} aria-label="Link to SKU" onChange={(e) => setLink((l) => ({ ...l, sku: e.target.value }))}>
                  {skus.map((s) => <option key={s.sku_code} value={s.sku_code}>{s.sku_code} · {s.name}</option>)}
                </select>
                <select value={link.kind} aria-label="as" onChange={(e) => setLink((l) => ({ ...l, kind: e.target.value }))}>
                  <option value="supplier">as Supplier EAN</option>
                  <option value="carton">as Carton</option>
                </select>
                <button type="button" className="a-btn" disabled={busy} onClick={doLink}>Link</button>
              </div>
            )}
          </>
        )}
      </div>
      {canEdit && unknown.length > 0 && (
        <div className="a-listcard">
          <div className="a-cardh"><h2>Scanned, not yet linked</h2><Pill tone="bad">{unknown.length}</Pill></div>
          <Table rowKey={(u) => u.barcode} rows={unknown} label="Scanned, not yet linked" columns={[
            { key: 'barcode', label: 'Barcode', render: (u) => <code>{u.barcode}</code> },
            { key: 'who', label: 'Scanned by', render: (u) => u.who || u.scanned_by },
            { key: 'when', label: 'When', render: (u) => <>{fmtDate(u.scanned_at)}{u.times > 1 && <small className="a-muted"> ({u.times} times)</small>}</> },
            { key: 'act', label: <span className="a-sr">Link</span>, className: 'a-p14-act',
              render: (u) => <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => { window.scrollTo({ top: 0 }); scan(u.barcode); }}>Link it</button> },
          ]} />
        </div>
      )}
    </>
  );
}

function AllTab({ barcodes }) {
  const navigate = useNavigate();
  const rows = (barcodes.data && barcodes.data.rows) || [];
  const n = (k) => rows.filter((r) => r.kind === k).length;
  return (
    <Loading state={barcodes}>
      <div className="a-listcard">
        <div className="a-countline"><b>{rows.length}</b> barcodes · {n('supplier')} supplier EANs · {n('carton')} carton codes</div>
        <Table rows={rows} rowKey={(r) => r.barcode} label="All barcodes" onRowClick={(r) => navigate(`/admin/products?sku=${encodeURIComponent(r.sku_code)}`)}
          empty={{ title: 'No barcodes yet' }} columns={[
            { key: 'barcode', label: 'Barcode', sort: true, render: (r) => <code>{r.barcode}</code> },
            { key: 'kind_label', label: 'Kind', sort: true },
            { key: 'sku_code', label: 'SKU', sort: true, render: (r) => <span className="a-p14-prow"><Thumb file={r.image} size={34} /><span><b>{r.sku_code}</b><small>{r.name}</small></span></span> },
          ]} />
      </div>
    </Loading>
  );
}

function LabelMaker() {
  const data = useLoad('/catalogue/labels');
  const toast = useToast();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(() => new Set());
  const [opt, setOpt] = useState({ type: 'pack', lang: 'en', copies: '1', month: thisMonth() });
  const [shown, setShown] = useState(null); // the settings of the labels on screen
  const d = data.data;
  const rows = useMemo(() => (d ? d.rows : []), [d]);
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => `${r.sku_code} ${r.name}`.toLowerCase().includes(s)) : rows;
  }, [rows, q]);
  const toggle = (c) => setSel((x) => { const n = new Set(x); if (n.has(c)) n.delete(c); else n.add(c); return n; });
  const set = (k) => (e) => setOpt((o) => ({ ...o, [k]: e.target.value }));

  const show = () => {
    const codes = rows.filter((r) => sel.has(r.sku_code)).map((r) => r.sku_code);
    const copies = Number(opt.copies);
    if (!codes.length) { setShown(null); toast('bad', 'No labels', 'Tick at least one pack on the left.'); return; }
    if (!/^\d+$/.test(String(opt.copies).trim()) || copies < 1 || copies > 50) { setShown(null); toast('bad', 'No labels', 'Copies must be 1 to 50.'); return; }
    if (opt.type === 'pack' && !/^\d{4}-\d{2}$/.test(opt.month || '')) { setShown(null); toast('bad', 'No labels', 'Pick the month of packing.'); return; }
    setShown({ ...opt, copies, codes });
    if (opt.type === 'pack') {
      const nomrp = rows.filter((r) => sel.has(r.sku_code) && r.sku_type === 'finished' && (r.mrp === null || r.mrp === undefined)).map((r) => r.sku_code);
      if (nomrp.length) toast('warn', `MRP not set on ${nomrp.length} pack${nomrp.length > 1 ? 's' : ''}`, `${nomrp.join(', ')}: the label says "MRP not set". Set it on the pack before printing retail labels.`);
    }
  };
  const labels = useMemo(() => {
    if (!shown || !d) return [];
    return shown.codes.flatMap((c) => {
      const r = rows.find((x) => x.sku_code === c);
      return r ? Array(shown.copies).fill(labelOf(r, shown, d.words, d.company)) : [];
    });
  }, [shown, d, rows]);
  const print = () => { if (!printSheet(labels, shown)) toast('bad', 'Not printed', BLOCKED); };

  return (
    <Loading state={data}>
      {d && (
        <>
          <div className="a-p14-two">
            <div className="a-card a-card-flush">
              <div className="a-cardh"><h2>1. Pick the packs</h2><Pill tone="gray">{sel.size} picked</Pill></div>
              <div className="a-p14-pad">
                <label className="a-p14-scanin a-p14-search"><LIcon name="search" size="sm" />
                  <input value={q} placeholder="Find a SKU" aria-label="Find a SKU" onChange={(e) => setQ(e.target.value)} />
                </label>
              </div>
              <div className="a-p14-lablist">
                {list.map((r) => (
                  <label key={r.sku_code} className="a-p14-labrow">
                    <input type="checkbox" checked={sel.has(r.sku_code)} onChange={() => toggle(r.sku_code)} />
                    <Thumb file={r.image} size={34} />
                    <span><b>{r.sku_code}</b><small>{r.name}{r.sku_type === 'raw' ? ' · raw material' : ''}</small></span>
                  </label>
                ))}
                {!list.length && <p className="a-muted a-p14-pad">No SKU matches.</p>}
              </div>
            </div>
            <div className="a-card a-card-flush">
              <div className="a-cardh"><h2>2. Choose the label</h2></div>
              <div className="a-cardb a-p14-opts">
                <label className="a-field"><span>Label</span>
                  <select value={opt.type} onChange={set('type')}>
                    <option value="pack">Pack: our SKU barcode</option>
                    <option value="carton">Carton: carton code, packs per carton</option>
                    <option value="shelf">Shelf: SKU and reorder level</option>
                  </select></label>
                <label className="a-field"><span>Language</span>
                  <select value={opt.lang} onChange={set('lang')}>{d.languages.map((l) => <option key={l.lang_code} value={l.lang_code}>{l.name_en}</option>)}</select>
                  <small className="a-hint">Product names stay as supplied; the rest is translated.</small></label>
                <label className="a-field"><span>Copies of each</span>
                  <input type="number" min="1" max="50" step="1" value={opt.copies} onChange={set('copies')} /></label>
                <label className="a-field"><span>Month of packing (pack labels)</span>
                  <input type="month" value={opt.month} onChange={set('month')} />
                  <small className="a-hint">Printed on pack labels with MRP, net quantity, packed by, customer care and origin. These lines stay in English, as the law allows.</small></label>
                <div className="a-p14-btns">
                  <button type="button" className="a-btn" onClick={show}>Show labels</button>
                  {shown && <button type="button" className="a-btn a-btn-ghost" onClick={print}><LIcon name="download" size="sm" />Print</button>}
                </div>
              </div>
            </div>
          </div>
          {shown && (
            <div className="a-card a-card-flush">
              <div className="a-cardh"><h2>3. Labels</h2><Pill tone="gray">{labels.length} labels</Pill></div>
              <div className="a-cardb">
                <div className="a-p14-labels" lang={shown.lang}>
                  {labels.map((l, i) => (
                    <div key={i} className="a-p14-label">
                      <b>{l.name}</b>
                      <span>{l.lines.map((x, j) => <span key={j} className="a-p14-line">{x}</span>)}</span>
                      {l.decl && (
                        <span className="a-p14-decl"><b>{l.decl.mrp}</b>{l.decl.mrpNote}{l.decl.lines.map((x, j) => <span key={j} className="a-p14-line">{x}</span>)}</span>
                      )}
                      <Barcode value={l.code} height={40} width={1.3} fontSize={12} />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </Loading>
  );
}

/** batch labels SKU/BATCH: every batch with stock (good, returned or damaged) or ticked ones */
function BatchLabels() {
  const data = useLoad('/commerce/batches');
  const [sel, setSel] = useState(() => new Set());
  const [copies, setCopies] = useState(1);
  const [msg, setMsg] = useState(null);
  const rows = data.data ? data.data.rows.filter((b) => b.good > 0 || b.damaged > 0) : [];
  const print = () => {
    const chosen = rows.filter((b) => !sel.size || sel.has(b.batch_id));
    const ok = printLabels(chosen.map((b) => ({ code: `${b.sku_code}/${b.batch_no}`, name: b.name, sub: `${b.size_label} · batch ${b.batch_no} · mfd ${day(b.mfg_date)} · exp ${day(b.expiry_date)}` })), copies, 'batch labels');
    setMsg(ok ? null : { kind: 'error', text: BLOCKED });
  };
  const toggle = (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="a-card">
      <h2>Batch labels</h2>
      <Loading state={data}>
        {rows.length ? (
          <>
            <div className="a-toolbar">
              <label className="a-inline">Labels per batch
                <select value={copies} aria-label="Labels per batch" onChange={(e) => setCopies(Number(e.target.value))}>{[1, 2, 6, 12, 24, 48].map((n) => <option key={n}>{n}</option>)}</select>
              </label>
              <button type="button" className="a-btn" onClick={print}>Print batch labels ({sel.size || rows.length})</button>
            </div>
            {msg && <Notice kind={msg.kind} onClose={() => setMsg(null)}>{msg.text}</Notice>}
            <div className="a-scroll">
              <table className="a-table">
                <thead><tr><th /><th>Code</th><th>Product</th><th>Made</th><th>Expires</th><th className="a-num">Good</th><th>Barcode</th></tr></thead>
                <tbody>{rows.map((b) => (
                  <tr key={b.batch_id}>
                    <td><input type="checkbox" aria-label={`Tick ${b.sku_code}/${b.batch_no}`} checked={sel.has(b.batch_id)} onChange={() => toggle(b.batch_id)} /></td>
                    <td><code>{b.sku_code}/{b.batch_no}</code></td><td>{b.name} <small className="a-muted">{b.size_label}</small></td>
                    <td>{day(b.mfg_date)}</td><td className={b.state === 'expired' ? 'a-bad' : undefined}>{day(b.expiry_date)}</td><td className="a-num">{b.good}</td>
                    <td><Barcode value={`${b.sku_code}/${b.batch_no}`} height={30} width={1} fontSize={10} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>
        ) : <p className="a-muted">No batch with stock.</p>}
      </Loading>
    </div>
  );
}
