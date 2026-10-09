// Builds 400 / 800 WebP sizes from the 1200 product originals and checks that every file the
// database references (product_images, banners) exists on disk. Exit code 1 if anything is missing.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { getDBConnection } = require('../config/db');

const MEDIA = path.join(__dirname, '..', 'media');
const ORIGINALS = path.join(MEDIA, 'products', '1200');
const SIZES = [400, 800];

function isFresh(out, src) {
  return fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs;
}

async function buildSizes() {
  if (!fs.existsSync(ORIGINALS)) throw new Error('media/products/1200 not found - run npm run media:sync');
  const originals = fs.readdirSync(ORIGINALS).filter((f) => f.toLowerCase().endsWith('.webp'));
  let generated = 0;
  let upToDate = 0;
  for (const size of SIZES) {
    const dir = path.join(MEDIA, 'products', String(size));
    fs.mkdirSync(dir, { recursive: true });
    for (const f of originals) {
      const src = path.join(ORIGINALS, f);
      const out = path.join(dir, f);
      if (isFresh(out, src)) { upToDate++; continue; }
      await sharp(src).resize(size, size, { fit: 'inside' }).webp({ quality: 80 }).toFile(out);
      generated++;
    }
  }
  return { originals: originals.length, generated, upToDate };
}

async function checkReferences() {
  const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
  const missing = [];
  const [images] = await db.query('SELECT file_name FROM product_images');
  for (const { file_name } of images) {
    for (const size of [1200, ...SIZES]) {
      const rel = `products/${size}/${file_name}`;
      if (!fs.existsSync(path.join(MEDIA, rel))) missing.push(rel);
    }
  }
  const [banners] = await db.query('SELECT desktop_file, mobile_file FROM banners');
  let bannerFiles = 0;
  for (const b of banners) {
    for (const rel of [`banners/desktop/${b.desktop_file}`, `banners/mobile/${b.mobile_file}`]) {
      if (fs.existsSync(path.join(MEDIA, rel))) bannerFiles++;
      else missing.push(rel);
    }
  }
  await db.end();
  return { imageRows: images.length, bannerRows: banners.length, bannerFiles, missing };
}

async function main() {
  const b = await buildSizes();
  console.log(`product originals found: ${b.originals}`);
  console.log(`sizes generated: ${b.generated} (${SIZES.join(' + ')}), already up to date: ${b.upToDate}`);
  const r = await checkReferences();
  console.log(`product_images rows: ${r.imageRows} (checked at 1200 + ${SIZES.join(' + ')})`);
  console.log(`banner files found: ${r.bannerFiles} (${r.bannerRows} banners x desktop + mobile)`);
  console.log(`missing: ${r.missing.length}`);
  r.missing.forEach((m) => console.log(`  MISSING media/${m}`));
  if (r.missing.length) process.exit(1);
}

main().catch((err) => {
  console.error('media:build failed:', err.code || '', err.sqlMessage || err.message);
  process.exit(1);
});
