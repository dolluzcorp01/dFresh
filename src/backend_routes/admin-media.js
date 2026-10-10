// Admin uploads (docs/06_API.md): images (<= 8 MB in) become WebP, PDFs (<= 5 MB) go to private/brochures.
// - The type is decided by magic bytes, never by the file name or the browser's content type.
// - File names are generated here: <id>_<pos>-<hash>.webp, <banner_key>-<hash>.webp,
//   dFresh_Brochure_<LANG>-<hash>.pdf. The content hash makes every upload a new URL, so the 30-day immutable
//   cache on /media can never serve an old photo.
// - Only files with that "-<hash>" form are ever deleted (when replaced or removed in the admin); the seed
//   originals (<id>_<n>.webp from media:sync) are never touched. Deleting runs after the DB change has
//   committed, so it is best-effort: a locked file (Windows EBUSY) is logged and left, never a failed request.
// - Product photo: fitted inside 1200x1200 on white, WebP quality stepped down until <= 150 KB; 400 / 800 sizes
//   are made from it (same folders as media-build.js).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const ROOT = path.resolve(__dirname, '..', '..');
const MEDIA = path.join(ROOT, 'media');
const BROCHURES = path.join(ROOT, 'private', 'brochures');
const PRODUCT_SIZES = [400, 800];
const MAX_PRODUCT_BYTES = 150 * 1024;
const BANNER = { desktop: [1920, 800], mobile: [1080, 1350] };
const OWN_FILE = /-[0-9a-f]{10}\.(webp|pdf)$/;
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,149}$/;
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

class UploadError extends Error {
  constructor(message) {
    super(message);
    this.status = 400;
  }
}

function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  if (buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}

function unlink(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch (err) {
    console.error(`could not delete ${path.relative(ROOT, file)} (left on disk):`, err.code || err.message);
  }
}

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);

function requireImage(buf) {
  if (!['jpeg', 'png', 'webp'].includes(sniff(buf))) throw new UploadError('Upload a JPG, PNG or WebP image');
}

/** Writes the 1200 / 800 / 400 WebP files. Returns { file_name, width, height, bytes, quality }. */
async function saveProductImage(buf, productId, position) {
  requireImage(buf);
  if (!SAFE.test(productId)) throw new UploadError('Bad product id');
  const square = await sharp(buf).rotate()
    .resize(1200, 1200, { fit: 'contain', background: WHITE })
    .flatten({ background: WHITE })
    .toBuffer();
  let quality = 82;
  let out = await sharp(square).webp({ quality }).toBuffer();
  while (out.length > MAX_PRODUCT_BYTES && quality > 40) {
    quality -= 6;
    out = await sharp(square).webp({ quality }).toBuffer();
  }
  if (out.length > MAX_PRODUCT_BYTES) throw new UploadError('This photo cannot be made small enough (150 KB); try a simpler photo');
  const fileName = `${productId}_${position}-${hash(out)}.webp`;
  fs.mkdirSync(path.join(MEDIA, 'products', '1200'), { recursive: true });
  fs.writeFileSync(path.join(MEDIA, 'products', '1200', fileName), out);
  for (const size of PRODUCT_SIZES) {
    const dir = path.join(MEDIA, 'products', String(size));
    fs.mkdirSync(dir, { recursive: true });
    await sharp(out).resize(size, size, { fit: 'inside' }).webp({ quality: 80 }).toFile(path.join(dir, fileName));
  }
  return { file_name: fileName, width: 1200, height: 1200, bytes: out.length, quality };
}

function removeProductImage(fileName) {
  if (!fileName || !OWN_FILE.test(fileName) || !SAFE.test(fileName)) return;
  for (const size of [1200, ...PRODUCT_SIZES]) {
    unlink(path.join(MEDIA, 'products', String(size), fileName));
  }
}

/** Banner photo, cropped to cover the exact desktop (1920x800) or mobile (1080x1350) size. */
async function saveBanner(buf, bannerKey, kind) {
  requireImage(buf);
  if (!BANNER[kind]) throw new UploadError('kind must be desktop or mobile');
  if (!SAFE.test(bannerKey)) throw new UploadError('Bad banner key');
  const [w, h] = BANNER[kind];
  const out = await sharp(buf).rotate().resize(w, h, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();
  const fileName = `${bannerKey}-${kind}-${hash(out)}.webp`;
  const dir = path.join(MEDIA, 'banners', kind);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), out);
  return { file_name: fileName, bytes: out.length };
}

function removeBanner(fileName, kind) {
  if (!fileName || !BANNER[kind] || !OWN_FILE.test(fileName) || !SAFE.test(fileName)) return;
  unlink(path.join(MEDIA, 'banners', kind, fileName));
}

/** Brochure PDF for one language. Returns { file_name, size_kb }. */
function saveBrochure(buf, lang) {
  if (sniff(buf) !== 'pdf') throw new UploadError('Upload a PDF file');
  if (!SAFE.test(lang)) throw new UploadError('Bad language');
  const fileName = `dFresh_Brochure_${lang.toUpperCase()}-${hash(buf)}.pdf`;
  const dir = path.join(BROCHURES, lang);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, fileName), buf);
  return { file_name: fileName, size_kb: Math.ceil(buf.length / 1024) };
}

function brochurePath(lang, fileName) {
  if (!SAFE.test(lang) || !SAFE.test(fileName)) return null;
  return path.join(BROCHURES, lang, fileName);
}

function removeBrochure(lang, fileName) {
  if (!OWN_FILE.test(fileName || '')) return;
  const file = brochurePath(lang, fileName);
  if (file) unlink(file);
}

module.exports = {
  UploadError, sniff, saveProductImage, removeProductImage, saveBanner, removeBanner,
  saveBrochure, brochurePath, removeBrochure, MAX_PRODUCT_BYTES,
};
