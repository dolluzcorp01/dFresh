// Google Sheet lead sync (spec D2 step 3): one row per lead, appended to the tab for its form_type. Called only by
// outbox-worker.js (sync_outbox). Spreadsheet id = site_settings gsheet_spreadsheet_id, credentials = the
// service-account JSON at GOOGLE_SERVICE_ACCOUNT_JSON (share the sheet with its e-mail).
// The sheet comes from Dolluz's template: tabs Overview (never touched), Quote, Sample, Distributor, Contact,
// Brochure, each with its header already in row 1. Before every append row 1 is read and must match HEADERS
// exactly; otherwise appendLead throws (the outbox row stays pending, the error is logged). A tab or header row
// is never created or written here.
// Values are written RAW (as text), so a visitor typing "=..." can never inject a formula.
const path = require('path');
const { getDBConnection } = require('../../config/db');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const TZ = 'Asia/Kolkata';

const TABS = { quote: 'Quote', sample: 'Sample', distributor: 'Distributor', contact: 'Contact', brochure: 'Brochure' };

const QUOTE = ['Date & Time (IST)', 'Lead Ref', 'Full Name', 'Business Name', 'Business Type', 'Town', 'Phone', 'Email',
  'Products', 'Monthly Quantity', 'Message', 'Language', 'Source Page', 'Source Ref'];
const HEADERS = {
  Quote: QUOTE,
  Sample: QUOTE,
  Distributor: ['Date & Time (IST)', 'Lead Ref', 'Full Name', 'Firm Name', 'GST No', 'Areas Covered', 'Godown / Vehicles',
    'Other Brands', 'Monthly Sales', 'Phone', 'Email', 'Language', 'Source Page', 'Source Ref'],
  Contact: ['Date & Time (IST)', 'Lead Ref', 'Full Name', 'Phone', 'Email', 'Message', 'Language', 'Source Page', 'Source Ref'],
  Brochure: ['Date & Time (IST)', 'Lead Ref', 'First Name', 'Last Name', 'Email', 'Phone', 'Brochure Sent', 'Language',
    'Source Page', 'Source Ref'],
};

let client = null; // sheets v4 client, built on first use (or injected by tests)

/** Tests only: a fake { spreadsheets: { get, values: { get, append } } }. */
function setSheetsClient(c) {
  client = c;
}

async function sheets() {
  if (client) return client;
  const { google } = require('googleapis'); // heavy: load only when sync is really enabled
  const keyFile = path.resolve(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || './private/google-service-account.json');
  const auth = new google.auth.GoogleAuth({ keyFile, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  client = google.sheets({ version: 'v4', auth });
  return client;
}

async function spreadsheetId() {
  const [[row]] = await db.query("SELECT setting_value FROM site_settings WHERE setting_key = 'gsheet_spreadsheet_id'");
  return ((row && row.setting_value) || '').trim();
}

/** Whether the worker may sync now. { ok, reason } */
async function readiness() {
  if (process.env.GSHEET_ENABLED !== 'true') return { ok: false, reason: 'GSHEET_ENABLED is not true' };
  if (!(await spreadsheetId())) return { ok: false, reason: 'site_settings.gsheet_spreadsheet_id is empty' };
  return { ok: true };
}

/** "YYYY-MM-DD HH:MM" in IST. */
function istDateTime(d) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// Column letter for a 1-based column number (14 -> N).
const colLetter = (n) => (n > 26 ? colLetter(Math.floor((n - 1) / 26)) : '') + String.fromCharCode(65 + ((n - 1) % 26));

// The tab and row values for one lead (English labels for options and products, like the staff alert).
async function leadRow(leadId) {
  const [[lead]] = await db.query(
    `SELECT l.lead_id, l.lead_ref, l.form_type, l.full_name, l.first_name, l.last_name, l.phone, l.email,
            l.business_name, l.business_type, l.town, l.monthly_quantity, l.message, l.details_json, l.lang_code,
            l.source_page, l.source_ref, l.created_at
       FROM leads l WHERE l.lead_id = ?`,
    [leadId]
  );
  if (!lead) return null;
  const [[def]] = await db.query('SELECT lang_code FROM languages WHERE is_default = 1 LIMIT 1');
  const [products] = await db.query(
    `SELECT lp.product_id, t.name FROM lead_products lp
       LEFT JOIN product_translations t ON t.product_id = lp.product_id AND t.lang_code = ?
      WHERE lp.lead_id = ? ORDER BY lp.product_id`,
    [def.lang_code, leadId]
  );
  const label = async (list, value) => {
    if (!value) return '';
    const [[r]] = await db.query(
      'SELECT label FROM form_option_translations WHERE list_key = ? AND option_value = ? AND lang_code = ?',
      [list, value, def.lang_code]
    );
    return r ? r.label : value;
  };
  const d = !lead.details_json ? {}
    : typeof lead.details_json === 'string' ? JSON.parse(lead.details_json) : lead.details_json;
  const s = (v) => (v === null || v === undefined ? '' : String(v));
  const date = istDateTime(lead.created_at);
  const tail = [lead.lang_code, s(lead.source_page), s(lead.source_ref)];

  let values;
  if (lead.form_type === 'quote' || lead.form_type === 'sample') {
    values = [date, lead.lead_ref, s(lead.full_name), s(lead.business_name), await label('business_type', lead.business_type),
      s(lead.town), lead.phone, lead.email, products.map((p) => `${p.product_id} ${p.name || ''}`.trim()).join(', '),
      s(lead.monthly_quantity), s(lead.message), ...tail];
  } else if (lead.form_type === 'distributor') {
    values = [date, lead.lead_ref, s(lead.full_name), s(d.firm_name || lead.business_name), s(d.gst_no), s(d.areas),
      await label('yes_no', d.godown_vehicles), s(d.brands), await label('monthly_sales', d.monthly_sales),
      lead.phone, lead.email, ...tail];
  } else if (lead.form_type === 'contact') {
    values = [date, lead.lead_ref, s(lead.full_name), lead.phone, lead.email, s(lead.message), ...tail];
  } else {
    values = [date, lead.lead_ref, s(lead.first_name), s(lead.last_name), lead.email, lead.phone,
      d.brochure_lang || 'none', ...tail];
  }
  return { tab: TABS[lead.form_type], values };
}

async function appendLead(leadId) {
  const row = await leadRow(leadId);
  if (!row) throw new Error(`lead ${leadId} not found`);
  const expected = HEADERS[row.tab];
  if (row.values.length !== expected.length) throw new Error(`${row.tab}: built ${row.values.length} values for ${expected.length} columns`);
  const id = await spreadsheetId();
  const api = await sheets();

  const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
  const titles = (meta.data.sheets || []).map((t) => t.properties.title);
  if (!titles.includes(row.tab)) throw new Error(`sheet tab "${row.tab}" not found (tabs: ${titles.join(', ')})`);

  const lastCol = colLetter(expected.length);
  const head = await api.spreadsheets.values.get({ spreadsheetId: id, range: `'${row.tab}'!1:1` });
  const actual = ((head.data.values || [])[0] || []).map((v) => String(v).trim());
  while (actual.length && actual[actual.length - 1] === '') actual.pop();
  if (actual.length !== expected.length || actual.some((v, i) => v !== expected[i])) {
    throw new Error(`"${row.tab}" row 1 does not match the expected header. Expected: ${expected.join(' | ')}. Found: ${actual.join(' | ') || '(empty)'}`);
  }

  const res = await api.spreadsheets.values.append({
    spreadsheetId: id, range: `'${row.tab}'!A1:${lastCol}1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row.values] },
  });
  return { tab: row.tab, range: (res.data && res.data.updates && res.data.updates.updatedRange) || null };
}

module.exports = { appendLead, readiness, setSheetsClient, HEADERS, TABS, leadRow, istDateTime };
