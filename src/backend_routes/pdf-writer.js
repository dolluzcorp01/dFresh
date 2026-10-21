// A small PDF writer for the documents attached to notification mails (doc-pdf.js): A4 pages, the two built-in
// Helvetica fonts (no font files, WinAnsi text), lines, filled boxes and JPEG images. No package: the invoices are plain
// text tables. Characters outside WinAnsi (Tamil, Devanagari) print as "?": the documents are in English.
// Coordinates are in points from the TOP left (A4 = 595 x 842); the writer flips them for PDF.
const W = 595.28;
const H = 841.89;

// Helvetica and Helvetica-Bold advance widths (1/1000 em) for the characters 32 to 126 (the standard AFM metrics)
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556,
  333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722,
  667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611,
  389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

/** text as WinAnsi bytes: Latin-1 as is, a few typographic marks mapped, anything else "?" */
function winAnsi(s) {
  return String(s ?? '').replace(/₹/g, 'Rs').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
}
const hex = (c) => {
  const v = String(c || '#000000').replace('#', '');
  return [0, 2, 4].map((i) => (parseInt(v.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
};
const n2 = (v) => Number(v).toFixed(2);

class Pdf {
  constructor() {
    this.pages = [];
    this.images = []; // { name, data, w, h }
    this.addPage();
  }

  addPage() {
    this.ops = [];
    this.pages.push(this.ops);
    return this;
  }

  get pageCount() { return this.pages.length; }

  /** width of a text in points */
  width(s, size = 9, bold = false) {
    const t = bold ? HELV_B : HELV;
    let w = 0;
    for (const ch of winAnsi(s)) { const c = ch.charCodeAt(0); w += c >= 32 && c <= 126 ? t[c - 32] : 556; }
    return (w * size) / 1000;
  }

  /** a text split into lines that fit `width` (words; a word longer than the width is cut) */
  wrap(s, width, size = 9, bold = false) {
    const out = [];
    for (const para of String(s ?? '').split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (this.width(next, size, bold) <= width) { line = next; continue; }
        if (line) out.push(line);
        let w = word;
        while (this.width(w, size, bold) > width && w.length > 1) {
          let k = w.length - 1;
          while (k > 1 && this.width(w.slice(0, k), size, bold) > width) k -= 1;
          out.push(w.slice(0, k));
          w = w.slice(k);
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  }

  /** one line of text; y = the top of the line. opts: size, bold, color, align (left | right | center) with width */
  text(x, y, s, { size = 9, bold = false, color = '#121214', align = 'left', width = 0 } = {}) {
    const str = winAnsi(s);
    let tx = x;
    if (align !== 'left' && width) {
      const w = this.width(str, size, bold);
      tx = align === 'right' ? x + width - w : x + (width - w) / 2;
    }
    const esc = str.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
    this.ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${hex(color)} rg ${n2(tx)} ${n2(H - y - size * 0.8)} Td (${esc}) Tj ET`);
    return this;
  }

  line(x1, y1, x2, y2, { color = '#cccccc', width = 0.6 } = {}) {
    this.ops.push(`${hex(color)} RG ${width} w ${n2(x1)} ${n2(H - y1)} m ${n2(x2)} ${n2(H - y2)} l S`);
    return this;
  }

  rect(x, y, w, h, { fill = null, stroke = null, width = 0.6 } = {}) {
    const p = `${n2(x)} ${n2(H - y - h)} ${n2(w)} ${n2(h)} re`;
    if (fill && stroke) this.ops.push(`${hex(fill)} rg ${hex(stroke)} RG ${width} w ${p} B`);
    else if (fill) this.ops.push(`${hex(fill)} rg ${p} f`);
    else this.ops.push(`${hex(stroke || '#cccccc')} RG ${width} w ${p} S`);
    return this;
  }

  /** a JPEG (buffer with its pixel size) drawn at x, y in a w x h box */
  jpeg(buf, px, py, x, y, w, h) {
    let img = this.images.find((i) => i.data === buf);
    if (!img) { img = { name: `Im${this.images.length + 1}`, data: buf, w: px, h: py }; this.images.push(img); }
    this.ops.push(`q ${n2(w)} 0 0 ${n2(h)} ${n2(x)} ${n2(H - y - h)} cm /${img.name} Do Q`);
    return this;
  }

  /** the finished file */
  toBuffer({ title = 'dFresh' } = {}) {
    const chunks = [];
    const offsets = [];
    let size = 0;
    const push = (b) => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); chunks.push(buf); size += buf.length; };
    const objects = []; // index + 1 = object number; each a function that writes it
    const add = (fn) => { objects.push(fn); return objects.length; };
    const catalog = add(null);
    const pagesObj = add(null);
    const f1 = add(() => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add(() => '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const imgObjs = this.images.map((img) => ({ img, num: add(null) }));
    const pageNums = [];
    for (const ops of this.pages) {
      const content = Buffer.from(ops.join('\n'), 'latin1');
      const c = add(() => [`<< /Length ${content.length} >>\nstream\n`, content, '\nendstream']);
      pageNums.push(add(() => `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Contents ${c} 0 R /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >>${imgObjs.length ? ` /XObject << ${imgObjs.map((i) => `/${i.img.name} ${i.num} 0 R`).join(' ')} >>` : ''} >> >>`));
    }
    const info = add(() => `<< /Title (${winAnsi(title).replace(/[()\\]/g, '')}) /Producer (dFresh) >>`);
    objects[catalog - 1] = () => `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objects[pagesObj - 1] = () => `<< /Type /Pages /Kids [${pageNums.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageNums.length} >>`;
    for (const { img, num } of imgObjs) {
      objects[num - 1] = () => [`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`, img.data, '\nendstream'];
    }
    push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
    objects.forEach((fn, i) => {
      offsets.push(size);
      push(`${i + 1} 0 obj\n`);
      const body = fn();
      for (const part of Array.isArray(body) ? body : [body]) push(part);
      push('\nendobj\n');
    });
    const xref = size;
    push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
    push(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    return Buffer.concat(chunks);
  }
}

module.exports = { Pdf, PAGE_W: W, PAGE_H: H, winAnsi };
