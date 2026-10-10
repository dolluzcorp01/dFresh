// E-mail templates (CID logo, size under Gmail's clip limit), public URL start-up check and the Google Sheet row
// builder / header check with a fake Sheets client, against the LOCAL dev database.
// Run: npm run test:api   (needs a seeded DB: npm run db:reset)
// Temporary leads use lead_ref 'TEST-GS-*'.
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run DB tests with NODE_ENV=production');
  process.exit(1);
}

const fs = require('fs');
const path = require('path');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { getDBConnection } = require('../../config/db');
const mailer = require('../../src/backend_routes/mailer');
const gsheet = require('../../src/backend_routes/gsheet');
const { publicUrlProblems } = require('../../config/urls');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();

after(async () => {
  await db.query("DELETE FROM leads WHERE lead_ref LIKE 'TEST-GS-%'");
  await db.end();
});

// Worst case allowed by rules.json: 2000-char message of characters that esc() expands, 40 products, long names.
const ui = new Proxy({}, { get: (t, k) => `${'&'.repeat(200)} ${String(k)} {name} {ref}` });
const worst = {
  lead_alert: mailer.renderLeadAlert({
    leadRef: 'DFL-260001', formType: 'quote', receivedAt: '10 Oct 2026, 12:00 IST', fullName: '&'.repeat(120),
    businessName: '&'.repeat(150), businessType: 'hotel', town: '&'.repeat(120), phone: '9876543210',
    email: `${'a'.repeat(140)}@x.com`, monthlyQuantity: '&'.repeat(150), message: '&'.repeat(2000),
    details: { gst_no: '33ABCDE1234F1Z5', areas: '&'.repeat(255), godown_vehicles: 'yes', brands: '&'.repeat(255), monthly_sales: 'x' },
    products: Array.from({ length: 40 }, (_, i) => ({ id: `DZIND-DF${100 + i}`, name: '&'.repeat(80) })),
    options: {}, brochure: 'sent', brochureLang: 'EN', languageName: 'Tamil (ta)', sourcePage: '&'.repeat(150),
    sourceRef: '&'.repeat(60), consentText: '&'.repeat(500), companyName: 'Dolluz Corporation (OPC) Pvt Ltd',
  }),
  brochure_copy: mailer.renderBrochureCopy({
    htmlLang: 'ta', ui, name: '&'.repeat(60), link: `https://api.example.in/x?token=${'a'.repeat(400)}`,
    companyName: 'Dolluz', publicEmail: 'info@example.com',
  }),
  lead_ack: mailer.renderLeadAck({
    htmlLang: 'ta', ui, name: '&'.repeat(120), leadRef: 'DFL-260001', whatsappNumber: '919876543210',
    whatsappDisplay: '+91 98765 43210', companyName: 'Dolluz', publicEmail: 'info@example.com',
  }),
  login_code: mailer.renderLoginCode({ name: '&'.repeat(120), code: '123456', minutes: 10, companyName: 'Dolluz' }),
};

test('every template uses the CID logo (never a URL / SVG) and stays under 60 KB at worst case', () => {
  for (const [name, m] of Object.entries(worst)) {
    const bytes = Buffer.byteLength(m.html);
    console.log(`  ${name}: html ${bytes} B, text ${Buffer.byteLength(m.text)} B (worst case)`);
    assert.ok(m.html.includes(`src="${mailer.LOGO_SRC}"`), `${name}: CID logo`);
    assert.ok(m.html.includes('alt="dFresh"'), `${name}: alt fallback`);
    assert.ok(!/\/media\/logo|\.svg/i.test(m.html), `${name}: no logo URL / SVG`);
    assert.ok(bytes < mailer.MAX_HTML_BYTES, `${name}: ${bytes} B >= 60 KB`);
  }
});

test('the e-mail logo file is a PNG of at most 20 KB at 2x height (68 px)', async () => {
  const file = path.join(__dirname, '..', '..', 'src', 'backend_routes', 'mail-logo.png');
  const buf = fs.readFileSync(file);
  assert.equal(buf.subarray(1, 4).toString(), 'PNG');
  assert.ok(buf.length <= 20 * 1024, `${buf.length} B`);
  assert.equal(buf.readUInt32BE(20), 68); // IHDR height
});

test('send() attaches the logo inline with the matching content id and turns click tracking off', async () => {
  let sent = null;
  mailer.setTransport(async (msg) => { sent = msg; return { id: 'fake-1' }; });
  try {
    const m = worst.login_code;
    await mailer.send({ to: 'obx@example.com', subject: m.subject, html: m.html, text: m.text });
  } finally {
    mailer.setTransport(null);
  }
  assert.equal(sent.attachments.length, 1);
  const a = sent.attachments[0];
  assert.equal(a.content_id, mailer.LOGO_SRC.replace('cid:', ''));
  assert.equal(a.disposition, 'inline');
  assert.equal(a.type, 'image/png');
  assert.equal(sent.trackingSettings.clickTracking.enable, false);
});

test('production refuses localhost / http public URLs, accepts https', () => {
  const keep = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    process.env.PUBLIC_API_URL = 'http://localhost:4013';
    process.env.PUBLIC_SITE_URL = 'http://dfresh.example.in';
    const p = publicUrlProblems();
    assert.ok(p.some((x) => /PUBLIC_API_URL must use https/.test(x)));
    assert.ok(p.some((x) => /PUBLIC_API_URL must not be localhost/.test(x)));
    assert.ok(p.some((x) => /PUBLIC_SITE_URL must use https/.test(x)));
    delete process.env.PUBLIC_API_URL;
    assert.ok(publicUrlProblems().some((x) => /PUBLIC_API_URL is missing/.test(x)));
    process.env.PUBLIC_API_URL = 'https://api.dfresh.example.in';
    process.env.PUBLIC_SITE_URL = 'https://dfresh.example.in/';
    assert.deepEqual(publicUrlProblems(), []);
    process.env.NODE_ENV = 'development';
    process.env.PUBLIC_API_URL = 'http://localhost:4012';
    assert.deepEqual(publicUrlProblems(), []);
  } finally {
    for (const k of ['NODE_ENV', 'PUBLIC_API_URL', 'PUBLIC_SITE_URL']) {
      if (k in keep) process.env[k] = keep[k]; else delete process.env[k];
    }
  }
});

// Fake Sheets client: row 1 per tab from `heads`, records every call.
function fakeSheets(heads) {
  const calls = [];
  return {
    calls,
    spreadsheets: {
      get: async () => ({ data: { sheets: ['Overview', ...Object.keys(gsheet.HEADERS)].map((title) => ({ properties: { title } })) } }),
      values: {
        get: async (q) => { calls.push(['get', q.range]); return { data: { values: [heads[q.range.split('!')[0].replace(/'/g, '')]] } }; },
        append: async (q) => { calls.push(['append', q.range, q.valueInputOption, q.requestBody.values[0]]); return { data: { updates: { updatedRange: `${q.range.split('!')[0]}!A2:N2` } } }; },
      },
    },
  };
}

test('sheet rows: exact column order per tab, written RAW under the existing header', async () => {
  const [r] = await db.query(
    `INSERT INTO leads (lead_ref, form_type, full_name, first_name, last_name, phone, email, details_json, lang_code, source_page, created_at)
     VALUES ('TEST-GS-1', 'brochure', 'Asha Kumar', 'Asha', 'Kumar', '9876543210', 'gs@example.com', '{"brochure_lang":"en"}', 'ta', '/ta', '2026-10-10 09:05:00')`
  );
  const row = await gsheet.leadRow(r.insertId);
  assert.equal(row.tab, 'Brochure');
  assert.equal(row.values.length, gsheet.HEADERS.Brochure.length);
  assert.deepEqual(row.values.slice(1), ['TEST-GS-1', 'Asha', 'Kumar', 'gs@example.com', '9876543210', 'en', 'ta', '/ta', '']);
  assert.match(row.values[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

  const fake = fakeSheets(Object.fromEntries(Object.entries(gsheet.HEADERS).map(([k, v]) => [k, [...v, '']])));
  gsheet.setSheetsClient(fake);
  try {
    await gsheet.appendLead(r.insertId);
  } finally {
    gsheet.setSheetsClient(null);
  }
  const append = fake.calls.find((c) => c[0] === 'append');
  assert.equal(append[1], "'Brochure'!A1:J1");
  assert.equal(append[2], 'RAW');
  assert.deepEqual(append[3], row.values);
  assert.ok(fake.calls.every((c) => !c[1].includes('Overview')));
});

test('sheet header mismatch fails loudly and appends nothing', async () => {
  const [r] = await db.query(
    "INSERT INTO leads (lead_ref, form_type, full_name, phone, email, message) VALUES ('TEST-GS-2', 'contact', 'Ravi', '9876543210', 'gs@example.com', 'Hi')"
  );
  const heads = Object.fromEntries(Object.entries(gsheet.HEADERS).map(([k, v]) => [k, v]));
  heads.Contact = ['Date', 'Lead Ref'];
  const fake = fakeSheets(heads);
  gsheet.setSheetsClient(fake);
  try {
    await assert.rejects(gsheet.appendLead(r.insertId), /"Contact" row 1 does not match the expected header/);
  } finally {
    gsheet.setSheetsClient(null);
  }
  assert.ok(!fake.calls.some((c) => c[0] === 'append'));
});
