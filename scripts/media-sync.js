// Copies the source-of-truth kit in assets/ into the served media/ folder (layout per assets/README.md).
// media/ is not in git; a fresh clone runs `npm run media:sync` to rebuild it.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MAP = [
  ['assets/products', 'media/products/1200'],
  ['assets/banners/desktop', 'media/banners/desktop'],
  ['assets/banners/mobile', 'media/banners/mobile'],
  ['assets/logo/web', 'media/logo'],
];

for (const [from, to] of MAP) {
  const src = path.join(ROOT, from);
  const dest = path.join(ROOT, to);
  fs.mkdirSync(dest, { recursive: true });
  const files = fs.readdirSync(src).filter((f) => fs.statSync(path.join(src, f)).isFile());
  for (const f of files) fs.copyFileSync(path.join(src, f), path.join(dest, f));
  console.log(`copied ${String(files.length).padStart(3)} files  ${from} -> ${to}`);
}
