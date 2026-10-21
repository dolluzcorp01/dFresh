// Printing from the admin: a document in a new window with a "Print / Save as PDF" bar (A4 by default), and Code 128
// barcodes as SVG markup (JsBarcode, like the SKU labels). Used by the pick list, packing slip, carton labels and trip
// sheet. Returns false when the browser blocks the pop-up.
// Any script prints: every print window loads the full Noto fonts (PRINT_FONTS, GET /api/dfresh/print-fonts.css) and
// opens the print dialog once they are loaded (printWhenReady), so a name or address typed in Tamil or Hindi is never
// printed with missing letters.
import JsBarcode from 'jsbarcode';
import { API_BASE } from '../utils/api';

export const PRINT_FONTS = `<link rel="stylesheet" href="${API_BASE}/api/dfresh/print-fonts.css">`;
export const FONT_STACK = "Arial, 'dFresh Print', sans-serif";
/** the print dialog once the fonts the page uses are loaded (at most 4 s) */
export function printWhenReady(w) {
  let done = false;
  const go = () => { if (!done) { done = true; w.focus(); w.print(); } };
  setTimeout(go, 4000);
  const ready = w.document.fonts && w.document.fonts.ready;
  if (ready) setTimeout(() => ready.then(() => setTimeout(go, 150)), 100); else setTimeout(go, 400);
}

export const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const rs = (n) => `Rs ${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function barcodeSvg(value, { height = 46, width = 1.6, fontSize = 13 } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, value, { format: 'CODE128', margin: 4, background: '#ffffff', lineColor: '#121214', font: 'monospace', height, width, fontSize, displayValue: true });
  return svg.outerHTML;
}

const BASE_CSS = `body { font-family: ${FONT_STACK}; color: #121214; font-size: 12px; margin: 0; }
  h1 { font-size: 18px; margin: 0 0 6px; } h2 { font-size: 14px; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; } th, td { border: 1px solid #ccc; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #f6f3ea; } .n { text-align: right; white-space: nowrap; } small { color: #555; } .muted { color: #555; }
  .row { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .tick { width: 22px; } .box { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #121214; }
  .bar { padding: 8px 0; } @media print { .bar { display: none; } }`;

/** opens a printable page. page = { title, body, css = '', size = 'A4' } */
export function printPage({ title, body, css = '', size = 'A4', margin = '12mm' }) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>${PRINT_FONTS}<style>@page { size: ${size}; margin: ${margin}; } ${BASE_CSS} ${css}</style></head>
  <body><div class="bar"><button onclick="window.print()">Print / Save as PDF</button></div>${body}</body></html>`);
  w.document.close();
  printWhenReady(w);
  return true;
}
