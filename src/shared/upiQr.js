// The UPI QR printed on an invoice (phase 14): a standard "upi://pay" link with the company UPI ID, the payee name,
// the amount to pay and the invoice number as the note, drawn as a QR code (qrcode-generator, no network). Any UPI app
// scans it and opens the payment filled in. CommonJS: the invoice PDF (doc-pdf.js) and the print view (invoicePrint.js)
// draw the same code.
const qrcode = require('qrcode-generator');

const enc = (v) => encodeURIComponent(String(v || '').trim());

/** upi://pay?pa=<id>&pn=<name>&am=<amount>&cu=INR&tn=<invoice no> */
function upiLink({ upi, name, amount, note }) {
  return `upi://pay?pa=${enc(upi)}&pn=${enc(name)}&am=${Number(amount).toFixed(2)}&cu=INR&tn=${enc(note)}`;
}

/** the QR modules of a text -> { n, dark(row, col) } (error correction M: still reads with a small smudge) */
function qrMatrix(text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  return { n: q.getModuleCount(), dark: (r, c) => q.isDark(r, c) };
}

/** an SVG of the QR, `size` px square with a 4-module quiet zone */
function qrSvg(text, size = 120) {
  const m = qrMatrix(text);
  const all = m.n + 8;
  let d = '';
  for (let r = 0; r < m.n; r += 1) for (let c = 0; c < m.n; c += 1) if (m.dark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${all} ${all}" shape-rendering="crispEdges" role="img" aria-label="UPI QR code"><rect width="${all}" height="${all}" fill="#fff"/><path d="${d}" fill="#121214"/></svg>`;
}

module.exports = { upiLink, qrMatrix, qrSvg };
