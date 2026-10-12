// Builds the e-mail header logo from the on-dark web logo in the logo kit. The header shows it at 62x34 in the
// ink header; both files are exactly 2x that (124x68) for retina, the logo centred in that box.
// 1. src/backend_routes/mail-logo.png (committed): the inline CID attachment mailer.js uses when the setting
//    mail_logo_url is empty. Flattened onto ink, since it only ever sits on the ink header.
// 2. visual-output/mail-logo/dfresh-mail-logo.png: transparent PNG to upload to the website host; its https URL
//    goes into the admin setting mail_logo_url. Under 15 KB.
// SVG never shows in mail clients, so both are PNG.
// Run: node scripts/mail-logo.js   (re-run only when the logo kit changes)
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'logo', 'web', 'dfresh-logo-on-dark.png');
const CID = path.join(ROOT, 'src', 'backend_routes', 'mail-logo.png');
const HOSTED = path.join(ROOT, 'visual-output', 'mail-logo', 'dfresh-mail-logo.png');
const WIDTH = 124; // 2 x 62
const HEIGHT = 68; // 2 x 34
const MAX = { [CID]: 20 * 1024, [HOSTED]: 15 * 1024 };
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
const INK = '#121214';

// sharp flattens before it resizes, so the ink version gets ink padding from the resize itself.
const fit = (background) => sharp(SRC).trim().resize({ width: WIDTH, height: HEIGHT, fit: 'contain', background });

(async () => {
  fs.mkdirSync(path.dirname(HOSTED), { recursive: true });
  const outs = [
    [CID, fit(INK).flatten({ background: INK }).png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })],
    [HOSTED, fit(CLEAR).png({ palette: true, quality: 90, compressionLevel: 9, effort: 10 })],
  ];
  let bad = false;
  for (const [file, img] of outs) {
    const info = await img.toFile(file);
    console.log(`${path.relative(process.cwd(), file)}: ${info.width}x${info.height}, ${info.size} bytes${info.channels === 4 ? ', transparent' : ''}`);
    if (info.size > MAX[file]) {
      console.error(`too big: ${info.size} bytes > ${MAX[file]}`);
      bad = true;
    }
  }
  if (bad) process.exit(1);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
