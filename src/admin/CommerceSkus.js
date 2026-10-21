// dFresh Commerce (DEMO, branch `commerce`, database dfresh_commerce): SKU and barcode.
// One SKU per product / colour version and pack size (migration 20261020_commerce_pricing.sql). The barcode is the
// SKU printed as Code 128 (JsBarcode). "Scan / search SKU": a USB scanner types the code and Enter, like a keyboard.
// Print labels: a label sheet (A4, 3 x 8) in a new window, printed or saved as PDF from the browser. Three kinds, the
// scan formats of the pack check and the return receiving (phase 5 / 6): pack labels (SKU), carton labels (SKU#C =
// one full carton) and batch labels (SKU/BATCH, with the manufacture and expiry dates) for batch-tracked products.
import { useEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import { InfoCard, Loading, Notice, useLoad } from './ui';
import { FONT_STACK, PRINT_FONTS, printWhenReady } from './printKit';

const BARCODE = { format: 'CODE128', margin: 6, background: '#ffffff', lineColor: '#121214', font: 'monospace' };

function Barcode({ value, height = 44, width = 1.4, fontSize = 13 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) JsBarcode(ref.current, value, { ...BARCODE, height, width, fontSize, displayValue: true });
  }, [value, height, width, fontSize]);
  return <svg ref={ref} className="a-barcode" role="img" aria-label={`Barcode ${value}`} />;
}

// SVG markup of one barcode, for the label sheet window
function barcodeSvg(value) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, value, { ...BARCODE, height: 46, width: 1.5, fontSize: 13, displayValue: true });
  return svg.outerHTML;
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const day = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }) : '');
const KINDS = { pack: 'Pack labels (SKU)', carton: 'Carton labels (SKU#C)' };
/** the label of a SKU in a kind -> { code, name, sub } */
const labelOf = (s, kind) => (kind === 'carton'
  ? { code: `${s.sku_code}#C`, name: s.name, sub: `CARTON of ${s.packs_per_carton} x ${s.size_label}` }
  : { code: s.sku_code, name: s.name, sub: s.size_label });

/** items = [{ code, name, sub }] */
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

export default function CommerceSkus() {
  const list = useLoad('/commerce/skus');
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState(null); // the SKU shown large (scan result or row click)
  const [scanMsg, setScanMsg] = useState(null);
  const [selected, setSelected] = useState(() => new Set());
  const [copies, setCopies] = useState(1);
  const [printMsg, setPrintMsg] = useState(null);
  const [kind, setKind] = useState('pack');
  const scanRef = useRef(null);
  const rows = useMemo(() => list.data || [], [list.data]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => [r.sku_code, r.product_id, r.name, r.size_label].some((v) => String(v || '').toLowerCase().includes(s))) : rows;
  }, [rows, q]);

  // Enter in the box (what a barcode scanner sends): an exact SKU opens it; anything else filters the list
  const scan = (e) => {
    e.preventDefault();
    const code = q.trim().toUpperCase();
    const hit = rows.find((r) => r.sku_code === code);
    if (hit) { setPicked(hit); setScanMsg({ kind: 'ok', text: `Found ${hit.sku_code}: ${hit.name}` }); setQ(''); }
    else setScanMsg(shown.length ? { kind: 'info', text: `No SKU "${code}" - ${shown.length} match(es) below` } : { kind: 'error', text: `No SKU matches "${q.trim()}"` });
    if (scanRef.current) scanRef.current.focus();
  };
  const toggle = (code) => setSelected((s) => { const n = new Set(s); if (n.has(code)) n.delete(code); else n.add(code); return n; });
  const allShown = shown.length > 0 && shown.every((r) => selected.has(r.sku_code));
  const toggleAll = () => setSelected((s) => { const n = new Set(s); shown.forEach((r) => (allShown ? n.delete(r.sku_code) : n.add(r.sku_code))); return n; });
  const print = () => {
    const skus = rows.filter((r) => selected.has(r.sku_code));
    const ok = printLabels((skus.length ? skus : shown).map((s) => labelOf(s, kind)), copies, KINDS[kind]);
    setPrintMsg(ok ? null : { kind: 'error', text: 'The label window was blocked: allow pop-ups for this site and try again.' });
  };

  return (
    <section>
      <h1>SKUs and labels</h1>
      <InfoCard title="Commerce demo - SKU and barcode">
        <ul>
          <li>One SKU per product and pack size, e.g. <code>DF037-M150</code> = DF037, pack of 150. Colour versions get their own (<code>DF008BLK-M100</code>).</li>
          <li>The barcode is the SKU as Code 128: any USB or phone scanner reads it.</li>
          <li>Scan into the box (or type and press Enter) to find a SKU. Tick rows and Print labels for an A4 label sheet.</li>
          <li>Carton labels (<code>SKU#C</code>) count a full carton in one scan; batch labels (<code>SKU/BATCH</code>) are for products tracked by batch, at packing and when returns come back.</li>
        </ul>
      </InfoCard>
      <div className="a-card a-scanbox">
        <form className="a-toolbar" onSubmit={scan}>
          <label htmlFor="sku-scan" className="a-inline"><strong>Scan / search SKU</strong></label>
          <input id="sku-scan" ref={scanRef} type="search" autoFocus autoComplete="off" placeholder="Scan a barcode or type DF037-M150"
            value={q} onChange={(e) => { setQ(e.target.value); setScanMsg(null); }} />
          <button type="submit" className="a-btn">Find</button>
        </form>
        {scanMsg && <Notice kind={scanMsg.kind} onClose={() => setScanMsg(null)}>{scanMsg.text}</Notice>}
        {picked && (
          <div className="a-skucard">
            <Barcode value={picked.sku_code} height={70} width={2} fontSize={16} />
            <dl className="a-dl">
              <div><dt>SKU</dt><dd><code>{picked.sku_code}</code></dd></div>
              <div><dt>Product</dt><dd>{picked.name} <code>{picked.product_id}</code></dd></div>
              <div><dt>Pack</dt><dd>{picked.size_label}</dd></div>
            </dl>
          </div>
        )}
      </div>
      <Loading state={list}>
        <div className="a-toolbar">
          <span className="a-muted">{shown.length} of {rows.length} SKUs{selected.size ? ` - ${selected.size} ticked` : ''}</span>
          <label className="a-inline">Kind
            <select value={kind} aria-label="Label kind" onChange={(e) => setKind(e.target.value)}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
          </label>
          <label className="a-inline">Labels per SKU
            <select value={copies} onChange={(e) => setCopies(Number(e.target.value))}>{[1, 2, 3, 6, 12, 24].map((n) => <option key={n}>{n}</option>)}</select>
          </label>
          <button type="button" className="a-btn" onClick={print} disabled={!shown.length}>
            Print {kind === 'carton' ? 'carton' : 'pack'} labels ({selected.size || shown.length} SKU)
          </button>
        </div>
        {printMsg && <Notice kind={printMsg.kind} onClose={() => setPrintMsg(null)}>{printMsg.text}</Notice>}
        <div className="a-scroll">
          <table className="a-table a-skus">
            <thead><tr>
              <th><input type="checkbox" aria-label="Tick all shown" checked={allShown} onChange={toggleAll} /></th>
              <th>SKU</th><th>Product</th><th>Pack</th><th>Barcode</th>
            </tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.sku_code} className={picked && picked.sku_code === r.sku_code ? 'a-target' : undefined}>
                  <td><input type="checkbox" aria-label={`Tick ${r.sku_code}`} checked={selected.has(r.sku_code)} onChange={() => toggle(r.sku_code)} /></td>
                  <td><button type="button" className="a-link" onClick={() => setPicked(r)}><code>{r.sku_code}</code></button></td>
                  <td>{r.name} <small className="a-muted">{r.product_id}</small></td>
                  <td>{r.size_label}</td>
                  <td><Barcode value={r.sku_code} height={34} width={1.1} fontSize={11} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Loading>
      <BatchLabels />
    </section>
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
    setMsg(ok ? null : { kind: 'error', text: 'The label window was blocked: allow pop-ups for this site and try again.' });
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
