// Writes src/i18n/fallbackText.json: the few DB texts the "page did not load" screen needs, for every
// active language. That screen shows exactly when the API (and so the DB text) is unreachable, so it
// cannot fetch them; this snapshot keeps it DB-driven instead of hard-coding words in React.
// Runs before every `npm run build`. Without a DB it keeps the existing file (so a build machine with no
// DB still builds) and says so; run it by hand after changing these texts in the admin.
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'src', 'i18n', 'fallbackText.json');
const KEYS = ['load_err_h', 'load_err_p', 'retry', 'whatsapp_us', 'wa_general'];

async function main() {
  const { getDBConnection } = require('../config/db');
  const { content } = require('../src/backend_routes/Public_server');
  const pool = getDBConnection(process.env.DB_NAME || 'dfresh');
  try {
    const langs = (await content.loadLanguages()).data;
    const snapshot = {
      default: langs.default,
      languages: langs.languages.map(({ code, htmlLang, dir }) => ({ code, htmlLang, dir })),
      whatsappNumber: '',
      text: {},
    };
    for (const { code } of langs.languages) {
      const boot = (await content.getBootstrap(code)).data;
      snapshot.text[code] = Object.fromEntries(KEYS.map((k) => [k, boot.ui[k] || '']));
      if (code === langs.default) snapshot.whatsappNumber = boot.settings.whatsapp_number || '';
    }
    const missing = KEYS.filter((k) => !snapshot.text[langs.default][k]);
    if (missing.length) throw new Error(`default language has no text for: ${missing.join(', ')}`);
    fs.writeFileSync(OUT, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`i18n:fallback wrote ${path.relative(process.cwd(), OUT)} (${langs.languages.map((l) => l.code).join(', ')})`);
  } finally {
    await pool.promise().end();
  }
}

main().catch((err) => {
  const msg = err.code || err.message;
  if (fs.existsSync(OUT)) {
    console.warn(`i18n:fallback skipped (${msg}); keeping the existing ${path.basename(OUT)}`);
    return;
  }
  console.error(`i18n:fallback failed (${msg}) and no ${path.basename(OUT)} exists yet`);
  process.exit(1);
});
