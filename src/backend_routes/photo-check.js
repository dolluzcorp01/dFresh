// Photos uploaded in Commerce (delivery stops, return pickups and inspections, write-offs): a JPEG, PNG or WebP picture,
// checked by its first bytes, not only by the type the browser claims (security review L2), then made small before it
// is stored: at most 1600 px on the long side, JPEG quality 75, turned upright, metadata (GPS) dropped. A phone photo of
// 3 to 5 MB becomes about 200 to 400 KB, so the database and its nightly backup stay small on the droplet.
const sharp = require('sharp');

const SIGNATURES = [
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a],
  ['image/webp', (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP'],
];
const MAX_PX = 1600;

/** the real image type of an upload ({ buffer, mimetype }), or null when it is not a JPEG, PNG or WebP picture */
function imageType(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length < 12) return null;
  const hit = SIGNATURES.find(([, test]) => test(file.buffer));
  return hit ? hit[0] : null;
}

/** the photo to store: { buffer, mimetype: 'image/jpeg' }, or null when the upload is not a picture we take */
async function storable(file) {
  if (!imageType(file)) return null;
  try {
    const buffer = await sharp(file.buffer, { failOn: 'error' }).rotate()
      .resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 75, mozjpeg: true }).toBuffer();
    return { buffer, mimetype: 'image/jpeg' };
  } catch {
    return null; // claims to be a picture but cannot be read
  }
}

module.exports = { imageType, storable };
