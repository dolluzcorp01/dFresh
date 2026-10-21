// Photos uploaded in Commerce (delivery stops, return pickups and inspections, write-offs): a JPEG, PNG or WebP picture,
// checked by its first bytes, not only by the type the browser claims (security review L2). The stored type is the one
// the bytes show, so a photo is always served as the image it really is.
const SIGNATURES = [
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a],
  ['image/webp', (b) => b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP'],
];

/** the real image type of an upload ({ buffer, mimetype }), or null when it is not a JPEG, PNG or WebP picture */
function imageType(file) {
  if (!file || !Buffer.isBuffer(file.buffer) || file.buffer.length < 12) return null;
  const hit = SIGNATURES.find(([, test]) => test(file.buffer));
  return hit ? hit[0] : null;
}

module.exports = { imageType };
