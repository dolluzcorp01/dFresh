// Outbox rows and their lead (phase 6b) + the visitor confirmation template, against the LOCAL dev database.
// Run: npm run test:api   (needs a seeded DB: npm run db:reset)
// Temporary leads use lead_ref 'TEST-OBX-*'; orphan rows point at lead ids that cannot exist.
require('dotenv').config({ quiet: true });

if (process.env.NODE_ENV === 'production') {
  console.error('refusing to run DB tests with NODE_ENV=production');
  process.exit(1);
}
// The worker pass below must never send: with mail disabled it only runs the orphan clean-up.
process.env.MAIL_ENABLED = 'false';
process.env.GSHEET_ENABLED = 'false';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { getDBConnection } = require('../../config/db');
const mailer = require('../../src/backend_routes/mailer');
const worker = require('../../src/backend_routes/outbox-worker');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const NO_LEAD = 900000000 + Math.floor(Math.random() * 1000000);

async function insertLead(ref) {
  const [r] = await db.query(
    "INSERT INTO leads (lead_ref, form_type, phone, email) VALUES (?, 'contact', '9876543210', 'obx@example.com')", [ref]
  );
  return r.insertId;
}

const addMail = (q, leadId) => q.query(
  "INSERT INTO mail_outbox (to_email, subject, html_body, text_body, purpose, lead_id) VALUES ('obx@example.com', 'obx', '<p>obx</p>', 'obx', 'lead_ack', ?)",
  [leadId]
);
const addSync = (q, leadId) => q.query("INSERT INTO sync_outbox (target, lead_id) VALUES ('gsheet', ?)", [leadId]);

after(async () => {
  await db.query("DELETE FROM leads WHERE lead_ref LIKE 'TEST-OBX-%'");
  await db.query('DELETE FROM mail_outbox WHERE lead_id = ?', [NO_LEAD]);
  await db.query('DELETE FROM sync_outbox WHERE lead_id = ?', [NO_LEAD]);
  await db.end();
});

test('deleting a lead deletes its mail and sync outbox rows', async () => {
  const leadId = await insertLead('TEST-OBX-1');
  await addMail(db, leadId);
  await addSync(db, leadId);
  await db.query('DELETE FROM leads WHERE lead_id = ?', [leadId]);
  const [[m]] = await db.query('SELECT COUNT(*) AS n FROM mail_outbox WHERE lead_id = ?', [leadId]);
  const [[s]] = await db.query('SELECT COUNT(*) AS n FROM sync_outbox WHERE lead_id = ?', [leadId]);
  assert.equal(Number(m.n), 0);
  assert.equal(Number(s.n), 0);
});

test('a pending row whose lead is missing is cancelled, never sent', async () => {
  // Orphans can only exist when foreign keys were off (e.g. a restore): write them that way.
  const conn = await db.getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    await addMail(conn, NO_LEAD);
    await addSync(conn, NO_LEAD);
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
  const sent = [];
  mailer.setTransport(async (msg) => { sent.push(msg); });
  try {
    await worker.tick();
  } finally {
    mailer.setTransport(null);
  }
  const [mail] = await db.query('SELECT status, last_error FROM mail_outbox WHERE lead_id = ?', [NO_LEAD]);
  const [sync] = await db.query('SELECT status, last_error FROM sync_outbox WHERE lead_id = ?', [NO_LEAD]);
  for (const row of [...mail, ...sync]) {
    assert.equal(row.status, 'cancelled');
    assert.equal(row.last_error, `lead ${NO_LEAD} no longer exists`);
  }
  assert.equal(mail.length + sync.length, 2);
  assert.equal(sent.length, 0);
});

test('visitor confirmation: lead_ref in subject and text, values escaped, text part present', () => {
  const ui = {
    thanks_name: 'Thank you, {name}!', mail_ack_subject: 'dFresh - we have your request ({ref})',
    mail_ack_intro: 'We have received your request.', mail_ack_ref: 'Your reference number',
    mail_ack_next_h: 'What happens next', ok_other: 'Our team will contact you on WhatsApp.',
    mail_ack_keep: 'Please mention this reference.', whatsapp_us: 'WhatsApp us', wa_general: 'Hi dFresh',
  };
  const m = mailer.renderLeadAck({
    htmlLang: 'en', ui, name: '<b>Kavya</b>', leadRef: 'DFL-260001', whatsappNumber: '919330259330',
    whatsappDisplay: '+91 93302 59330', companyName: 'Dolluz', publicEmail: 'info@example.com',
  });
  assert.equal(m.subject, 'dFresh - we have your request (DFL-260001)');
  assert.match(m.text, /Your reference number: DFL-260001/);
  assert.match(m.text, /Thank you, <b>Kavya<\/b>!/);
  assert.ok(m.html.includes('Thank you, &lt;b&gt;Kavya&lt;/b&gt;!'));
  assert.ok(!m.html.includes('<b>Kavya</b>'));
  assert.ok(m.html.includes('https://wa.me/919330259330?text=Hi%20dFresh'));
});
