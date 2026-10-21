// The page writer behind the PDF documents (doc-pdf.js: invoice, credit note, statement), on pdfkit. Text in any script
// a language uses: every string is cut into runs by script and each run is drawn in that script's font, so a Tamil
// customer name next to an English label prints correctly (pdfkit shapes it: vowel signs, conjuncts).
// - Fonts: fonts/pdf/<Family>-Regular.ttf and -Bold.ttf, static instances of the same fonts the site uses (Open Sans,
//   Noto Sans Tamil, Noto Sans Devanagari; fontkit cannot embed the variable woff2 files). Which characters belong to
//   which family comes from fonts/scripts.json (the language Script catalogue). A script whose PDF fonts are not in
//   fonts/pdf yet falls back to Open Sans (its letters print as empty boxes): add its two .ttf files to support it.
// - Coordinates are in points from the TOP left (A4 = 595 x 842); y is the top of a line of text.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const W = 595.28;
const H = 841.89;
const FONT_DIR = path.join(__dirname, '..', '..', 'fonts', 'pdf');
const LATIN = 'Open Sans';

// [start, end, family] for every script with PDF fonts on disk (Latin is the default)
const fileOf = (family, bold) => path.join(FONT_DIR, `${family.replace(/\s+/g, '')}-${bold ? 'Bold' : 'Regular'}.ttf`);
const RANGES = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'fonts', 'scripts.json'), 'utf8')).scripts
  .filter((s) => s.family !== LATIN && fs.existsSync(fileOf(s.family, false)))
  .flatMap((s) => s.ranges.map((r) => { const [a, b] = r.split('-').map((x) => parseInt(x, 16)); return [a, b, s.family]; }));
const familyOf = (cp) => { const r = RANGES.find(([a, b]) => cp >= a && cp <= b); return r ? r[2] : null; };
const SCRIPTS = [LATIN, ...new Set(RANGES.map((r) => r[2]))];

/** a text cut into [{ family, text }]: spaces, digits and punctuation stay with the run they are in */
function runs(s) {
  const out = [];
  let cur = null;
  for (const ch of String(s ?? '')) {
    const fam = familyOf(ch.codePointAt(0));
    const neutral = !fam && /[\s\d.,:;()/\-+&'"#%@*!?[\]]/.test(ch);
    const f = fam || (neutral && cur ? cur.family : LATIN);
    if (cur && cur.family === f) cur.text += ch;
    else { cur = { family: f, text: ch }; out.push(cur); }
  }
  return out;
}

class Pdf {
  constructor({ title = 'dFresh' } = {}) {
    this.doc = new PDFDocument({ size: 'A4', margin: 0, bufferPages: true, autoFirstPage: true, info: { Title: title, Producer: 'dFresh' } });
    for (const fam of SCRIPTS) {
      this.doc.registerFont(`${fam}`, fileOf(fam, false));
      this.doc.registerFont(`${fam} Bold`, fileOf(fam, true));
    }
    this.chunks = [];
    this.doc.on('data', (c) => this.chunks.push(c));
  }

  addPage() { this.doc.addPage({ size: 'A4', margin: 0 }); return this; }

  get pageCount() { return this.doc.bufferedPageRange().count; }

  /** draw on page i (0-based), for the page numbers at the end */
  onPage(i) { this.doc.switchToPage(i); return this; }

  font(family, bold, size) { this.doc.font(bold ? `${family} Bold` : family).fontSize(size); }

  /** width of a text in points (each run in its own font) */
  width(s, size = 9, bold = false) {
    return runs(s).reduce((w, r) => { this.font(r.family, bold, size); return w + this.doc.widthOfString(r.text); }, 0);
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
        while (this.width(w, size, bold) > width && [...w].length > 1) {
          const chars = [...w];
          let k = chars.length - 1;
          while (k > 1 && this.width(chars.slice(0, k).join(''), size, bold) > width) k -= 1;
          out.push(chars.slice(0, k).join(''));
          w = chars.slice(k).join('');
        }
        line = w;
      }
      out.push(line);
    }
    return out;
  }

  /** one line of text; y = the top of the line. opts: size, bold, color, align (left | right | center) with width */
  text(x, y, s, { size = 9, bold = false, color = '#121214', align = 'left', width = 0 } = {}) {
    const parts = runs(s);
    let tx = x;
    if (align !== 'left' && width) {
      const w = this.width(s, size, bold);
      tx = align === 'right' ? x + width - w : x + (width - w) / 2;
    }
    const base = y + size * 0.95; // one baseline for every script on the line
    this.doc.fillColor(color);
    for (const r of parts) {
      this.font(r.family, bold, size);
      this.doc.text(r.text, tx, base, { lineBreak: false, baseline: 'alphabetic' });
      tx += this.doc.widthOfString(r.text);
    }
    return this;
  }

  line(x1, y1, x2, y2, { color = '#cccccc', width = 0.6 } = {}) {
    this.doc.save().moveTo(x1, y1).lineTo(x2, y2).lineWidth(width).strokeColor(color).stroke().restore();
    return this;
  }

  rect(x, y, w, h, { fill = null, stroke = null, width = 0.6 } = {}) {
    this.doc.save().rect(x, y, w, h).lineWidth(width);
    if (fill && stroke) this.doc.fillAndStroke(fill, stroke);
    else if (fill) this.doc.fill(fill);
    else this.doc.stroke(stroke || '#cccccc');
    this.doc.restore();
    return this;
  }

  /** a PNG or JPEG drawn in a w x h box */
  image(buf, x, y, w, h) { this.doc.image(buf, x, y, { width: w, height: h }); return this; }

  /** the finished file */
  toBuffer() {
    return new Promise((resolve, reject) => {
      this.doc.on('end', () => resolve(Buffer.concat(this.chunks)));
      this.doc.on('error', reject);
      this.doc.end();
    });
  }
}

module.exports = { Pdf, PAGE_W: W, PAGE_H: H, runs, SCRIPTS };
