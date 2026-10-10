// Builds the e-mail header logo (src/backend_routes/mail-logo.png) from the on-dark web logo in the logo kit.
// mailer.js attaches it inline (CID) to every message: Gmail does not load a logo from a URL reliably, and SVG
// never shows in mail clients. Shown at 34 px high in the black header, built at 2x (68 px) for retina.
// Run: node scripts/mail-logo.js   (re-run only when the logo kit changes; the output is committed)
const path = require('path');
const sharp = require('sharp');

const SRC = path.join(__dirname, '..', 'assets', 'logo', 'web', 'dfresh-logo-on-dark.png');
const OUT = path.join(__dirname, '..', 'src', 'backend_routes', 'mail-logo.png');
const HEIGHT = 68;
const MAX_BYTES = 20 * 1024;

(async () => {
  const info = await sharp(SRC)
    .trim()
    .resize({ height: HEIGHT })
    .png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })
    .toFile(OUT);
  console.log(`${path.relative(process.cwd(), OUT)}: ${info.width}x${info.height}, ${info.size} bytes`);
  if (info.size > MAX_BYTES) {
    console.error(`too big: ${info.size} bytes > ${MAX_BYTES}`);
    process.exit(1);
  }
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
