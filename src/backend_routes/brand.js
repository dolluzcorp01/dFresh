// Website > Brand and layout > Logo and brand images (phase 15 step 9; owner request 4 Nov 2026). Three uploads, one
// place for the logo (Admin > Company shows them read only with a link here):
// - square logo: the app icon (manifest 192 / 512), the admin header and its tab icon, and the stamp;
// - wide logo: the header of invoices and other documents (PDFs);
// - favicon: one square picture made into 16, 32, 180, 192 and 512 pixel PNGs (the website's favicon and app icon).
// Settings logo_square / logo_wide / favicon_set hold the uploaded file (empty = the logo files of today, so the live
// site looks exactly the same until a new logo is uploaded). Files go to media/brand with a content hash in the name
// (the 30-day immutable /media cache never serves an old one); a replaced or removed upload's files are deleted.
// The website's /favicon*.png, /favicon.ico and /manifest.json are answered here when a favicon is uploaded; otherwise
// the build's own files (public/) are served as before.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { audit } = require('./audit');

const MEDIA = path.resolve(__dirname, '..', '..', 'media');
const DIR = path.join(MEDIA, 'brand');
const MAX = 1024 * 1024; // v23: logos up to 1 MB
const FAV_SIZES = [16, 32, 180, 192, 512];
const OWN = /^brand\/(logo-square|logo-wide|favicon)-[0-9a-f]{10}(-\d+)?\.png$/;
const KINDS = {
  square: { key: 'logo_square', name: 'square logo' },
  wide: { key: 'logo_wide', name: 'wide logo' },
  favicon: { key: 'favicon_set', name: 'favicon' },
};
const DEFAULTS = { square: '/media/logo/favicon-192.png', wide: '/media/logo/dfresh-logo-on-light.png', favicon: '/media/logo/favicon-32.png' };

class BrandError extends Error {}

const hash = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
const sniff = (b) => (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpeg'
  : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'webp' : null);
const unlink = (rel) => { try { if (OWN.test(rel)) fs.unlinkSync(path.join(MEDIA, rel)); } catch (e) { if (e.code !== 'ENOENT') console.warn(`brand: could not delete ${rel}: ${e.code}`); } };

async function read(q) {
  const [rows] = await q.query("SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN ('logo_square', 'logo_wide', 'favicon_set')");
  const v = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value || '']));
  return { square: v.logo_square || '', wide: v.logo_wide || '', favicon: v.favicon_set || '' };
}
/** the media path of each image as used now (an upload, or today's file) */
async function current(q) {
  const v = await read(q);
  return {
    square: v.square ? `/media/${v.square}` : DEFAULTS.square,
    wide: v.wide ? `/media/${v.wide}` : DEFAULTS.wide,
    favicon: v.favicon ? `/media/${v.favicon.replace(/-32\.png$/, '-32.png')}` : DEFAULTS.favicon,
    uploaded: { square: Boolean(v.square), wide: Boolean(v.wide), favicon: Boolean(v.favicon) },
  };
}
const favFile = (v, size) => v.replace(/-32\.png$/, `-${size}.png`);

/** an uploaded picture -> the setting value (files written) */
async function save(kind, buf) {
  if (buf.length > MAX) throw new BrandError(`The ${KINDS[kind].name} is over 1 MB. Make it smaller first.`);
  if (!sniff(buf)) throw new BrandError(`The ${KINDS[kind].name} must be PNG, JPG or WebP.`);
  const m = await sharp(buf).metadata();
  const [w, h] = m.orientation >= 5 ? [m.height, m.width] : [m.width, m.height];
  fs.mkdirSync(DIR, { recursive: true });
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  if (kind === 'square' || kind === 'favicon') {
    if (Math.abs(w - h) / Math.max(w, h) > 0.05) throw new BrandError(`The ${KINDS[kind].name} must be square (1:1); this one is ${w} x ${h}.`);
    if (w < 192) throw new BrandError(`The ${KINDS[kind].name} must be at least 192 x 192 pixels (512 x 512 is best); this one is ${w} x ${h}.`);
  }
  if (kind === 'square') {
    const out = await sharp(buf).rotate().resize(512, 512, { fit: 'contain', background: clear }).png().toBuffer();
    const rel = `brand/logo-square-${hash(out)}.png`;
    fs.writeFileSync(path.join(MEDIA, rel), out);
    return rel;
  }
  if (kind === 'wide') {
    if (w < h * 1.5) throw new BrandError(`The wide logo must be landscape (at least 1.5 times as wide as it is tall); this one is ${w} x ${h}.`);
    if (w < 300) throw new BrandError(`The wide logo must be at least 300 pixels wide; this one is ${w} x ${h}.`);
    const out = await sharp(buf).rotate().resize({ width: 1200, height: 400, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const rel = `brand/logo-wide-${hash(out)}.png`;
    fs.writeFileSync(path.join(MEDIA, rel), out);
    return rel;
  }
  const base = await sharp(buf).rotate().resize(512, 512, { fit: 'contain', background: clear }).png().toBuffer();
  const stem = `brand/favicon-${hash(base)}`;
  for (const s of FAV_SIZES) await sharp(base).resize(s, s).png().toFile(path.join(MEDIA, `${stem}-${s}.png`));
  return `${stem}-32.png`;
}
function removeFiles(kind, value) {
  if (!value) return;
  if (kind === 'favicon') FAV_SIZES.forEach((s) => unlink(favFile(value, s)));
  else unlink(value);
}

function register({ route, tx, db, by, InputError, upload }) {
  const out = async (q) => {
    const c = await current(q);
    return { ...c, sizes: FAV_SIZES, favicons: c.uploaded.favicon ? FAV_SIZES.map((s) => ({ size: s, url: favFile(c.favicon, s) })) : FAV_SIZES.map((s) => ({ size: s, url: s === 16 ? null : `/media/logo/favicon-${s}.png` })) };
  };
  route('get', '/brand', 'content:view', async () => out(db));
  route('post', '/brand/:kind', 'content:edit', async (req) => {
    const kind = req.params.kind;
    if (!KINDS[kind]) throw new InputError('Unknown picture', 404);
    if (!req.file) throw new InputError('Choose a picture');
    let rel;
    try { rel = await save(kind, req.file.buffer); } catch (e) { if (e instanceof BrandError) throw new InputError(e.message); throw e; }
    let old = '';
    try {
      await tx(async (q) => {
        old = (await read(q))[kind];
        await q.query('INSERT INTO site_settings (setting_key, setting_value, is_public, updated_by) VALUES (?, ?, 0, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)', [KINDS[kind].key, rel, by(req)]);
        await audit(q, { empId: by(req), action: old ? 'update' : 'create', entity: 'brand', entityId: kind, before: { [KINDS[kind].name]: old || 'the logo of today' }, after: { [KINDS[kind].name]: rel } });
      });
    } catch (e) { removeFiles(kind, rel); throw e; }
    if (old && old !== rel) removeFiles(kind, old);
    return { message: `${KINDS[kind].name.charAt(0).toUpperCase()}${KINDS[kind].name.slice(1)} saved.`, ...(await out(db)) };
  }, { before: [upload(1)] });
  route('delete', '/brand/:kind', 'content:edit', async (req) => {
    const kind = req.params.kind;
    if (!KINDS[kind]) throw new InputError('Unknown picture', 404);
    let old = '';
    await tx(async (q) => {
      old = (await read(q))[kind];
      if (!old) return;
      await q.query("UPDATE site_settings SET setting_value = '', updated_by = ? WHERE setting_key = ?", [by(req), KINDS[kind].key]);
      await audit(q, { empId: by(req), action: 'delete', entity: 'brand', entityId: kind, before: { [KINDS[kind].name]: old }, after: { [KINDS[kind].name]: 'the logo of today' } });
    });
    removeFiles(kind, old);
    return { message: old ? `${KINDS[kind].name.charAt(0).toUpperCase()}${KINDS[kind].name.slice(1)} removed: the logo of today is used again.` : 'Nothing to remove.', ...(await out(db)) };
  });
}

/**
 * the website's favicon files: an uploaded set wins, else next() (the build's public/ files). manifest.json lists the
 * uploaded 192 / 512 PNGs. Short cache so an upload shows within minutes.
 */
function publicRoutes(app, db) {
  const send = (res, file, type) => res.type(type).set('Cache-Control', 'public, max-age=300').sendFile(path.join(MEDIA, file));
  app.get(['/favicon.ico', ...FAV_SIZES.map((s) => `/favicon-${s}.png`)], async (req, res, next) => {
    try {
      const v = (await read(db)).favicon;
      if (!v) return next();
      const size = req.path === '/favicon.ico' ? 32 : Number(req.path.match(/(\d+)/)[1]);
      return send(res, favFile(v, size), 'image/png');
    } catch (e) { return next(e); }
  });
  app.get('/manifest.json', async (req, res, next) => {
    try {
      const v = (await read(db)).favicon;
      if (!v) return next();
      return res.set('Cache-Control', 'public, max-age=300').json({
        short_name: 'dFresh', name: 'dFresh', start_url: '.', display: 'standalone', theme_color: '#121214', background_color: '#FCFBF6',
        icons: [{ src: 'favicon-32.png', sizes: '32x32', type: 'image/png' }, { src: 'favicon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'favicon-512.png', sizes: '512x512', type: 'image/png' }],
      });
    } catch (e) { return next(e); }
  });
}

/** the wide logo file for PDFs (null = the built-in document logo), and the square one for the admin */
async function logoFile(q, kind) {
  const v = (await read(q))[kind];
  if (!v) return null;
  const f = path.join(MEDIA, v);
  return fs.existsSync(f) ? f : null;
}

module.exports = { register, publicRoutes, current, logoFile, DEFAULTS, FAV_SIZES };
