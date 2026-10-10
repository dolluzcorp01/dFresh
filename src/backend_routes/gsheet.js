// Google Sheet lead sync (spec D2 step 3): one row per lead, appended to the tab named after its form_type
// (brochure, quote, sample, distributor, contact). A missing tab is created; an empty tab gets the header row
// first. Called only by outbox-worker.js (sync_outbox). Spreadsheet id = site_settings gsheet_spreadsheet_id,
// credentials = the service-account JSON at GOOGLE_SERVICE_ACCOUNT_JSON (share the sheet with its e-mail).
// Values are written RAW, so a visitor typing "=..." can never inject a formula.
const path = require('path');
const { getDBConnection } = require('../../config/db');

const db = getDBConnection(process.env.DB_NAME || 'dfresh').promise();
const TZ = 'Asia/Kolkata';

const HEADER = ['Date (IST)', 'Lead ref', 'Name', 'Phone', 'E-mail', 'Business', 'Business type', 'Town',
  'Products', 'Monthly quantity', 'Message', 'Extras', 'Language', 'Page', 'Opened from'];

let client = null; // sheets v4 client, built on first use (or injected by tests)

/** Tests only: a fake { spreadsheets: { get, batchUpdate, values: { get, update, append } } }. */
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

function istDate(d) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(d));
}

// The sheet row for one lead (English labels for options and products, like the staff alert).
async function leadRow(leadId) {
  const [[lead]] = await db.query(
    `SELECT l.lead_id, l.lead_ref, l.form_type, l.full_name, l.phone, l.email, l.business_name, l.business_type,
            l.town, l.monthly_quantity, l.message, l.details_json, l.lang_code, l.source_page, l.source_ref, l.created_at
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
  let extras = '';
  if (lead.details_json) {
    const d = typeof lead.details_json === 'string' ? JSON.parse(lead.details_json) : lead.details_json;
    extras = [
      d.gst_no && `GST: ${d.gst_no}`,
      d.areas && `Areas: ${d.areas}`,
      d.godown_vehicles && `Godown/vehicles: ${await label('yes_no', d.godown_vehicles)}`,
      d.brands && `Brands: ${d.brands}`,
      d.monthly_sales && `Monthly sales: ${await label('monthly_sales', d.monthly_sales)}`,
    ].filter(Boolean).join('; ');
  }
  return {
    tab: lead.form_type,
    values: [
      istDate(lead.created_at), lead.lead_ref, lead.full_name || '', lead.phone, lead.email,
      lead.business_name || '', await label('business_type', lead.business_type), lead.town || '',
      products.map((p) => `${p.product_id} ${p.name || ''}`.trim()).join(', '),
      lead.monthly_quantity || '', lead.message || '', extras, lead.lang_code, lead.source_page || '', lead.source_ref || '',
    ],
  };
}

async function appendLead(leadId) {
  const row = await leadRow(leadId);
  if (!row) throw new Error(`lead ${leadId} not found`);
  const id = await spreadsheetId();
  const api = await sheets();

  const meta = await api.spreadsheets.get({ spreadsheetId: id, fields: 'sheets.properties.title' });
  const titles = (meta.data.sheets || []).map((s) => s.properties.title);
  if (!titles.includes(row.tab)) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: id,
      requestBody: { requests: [{ addSheet: { properties: { title: row.tab } } }] },
    });
  }
  const first = await api.spreadsheets.values.get({ spreadsheetId: id, range: `'${row.tab}'!A1:A1` });
  if (!first.data.values || !first.data.values.length) {
    await api.spreadsheets.values.update({
      spreadsheetId: id, range: `'${row.tab}'!A1`, valueInputOption: 'RAW', requestBody: { values: [HEADER] },
    });
  }
  await api.spreadsheets.values.append({
    spreadsheetId: id, range: `'${row.tab}'!A1`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [row.values] },
  });
}

module.exports = { appendLead, readiness, setSheetsClient, HEADER, leadRow };
