// One-time / rare: refreshes the full source fonts the server subsets from (fonts/source/*.woff2, committed,
// never served). Each is the Google Fonts variable font limited to the weights the site uses (300-800) at
// width 100, with every character it has. The catalog of scripts the admin can pick is fonts/scripts.json.
// The site itself never needs this script: font-manager.js subsets from these files at run time.
// Run: node scripts/fonts-source.js   (needs internet; the result is committed)
const fs = require('fs');
const path = require('path');
const subsetFont = require('subset-font');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'fonts', 'source');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'fonts', 'scripts.json'), 'utf8'));
const AXES = { wght: { min: 300, max: 800, default: 400 }, wdth: 100 };

// every code point the font maps (harfbuzz, through subset-font's dependency)
async function allChars(buf) {
  const { Blob: HbBlob, Face } = await import('harfbuzzjs');
  const face = new Face(new HbBlob(buf), 0);
  return String.fromCodePoint(...face.collectUnicodes());
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const s of CATALOG.scripts) {
    const url = `https://raw.githubusercontent.com/google/fonts/main/ofl/${s.googleDir}/${encodeURIComponent(s.googleFile)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    const ttf = Buffer.from(await res.arrayBuffer());
    const woff2 = await subsetFont(ttf, await allChars(ttf), { targetFormat: 'woff2', variationAxes: AXES });
    fs.writeFileSync(path.join(OUT, s.file), woff2);
    console.log(`${s.script.padEnd(11)} ${s.family.padEnd(22)} ${String(Math.round(ttf.length / 1024)).padStart(5)} KB ttf -> ${String(Math.round(woff2.length / 1024)).padStart(4)} KB fonts/source/${s.file}`);
  }
  const lic = await fetch('https://raw.githubusercontent.com/google/fonts/main/ofl/notosanstamil/OFL.txt');
  if (lic.ok) fs.writeFileSync(path.join(OUT, 'OFL.txt'), Buffer.from(await lic.arrayBuffer()));
}

main().catch((err) => {
  console.error('fonts-source failed:', err.message);
  process.exit(1);
});
