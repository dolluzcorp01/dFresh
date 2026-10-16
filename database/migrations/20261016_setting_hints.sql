-- Settings hints: "TO BE PROVIDED" stays as a marker at the start of a description, and the admin Settings page shows it
-- only while the value is empty (then just the hint). The lead sheet and GA4 hints get their plain wording.
USE dfresh;

UPDATE site_settings SET description = 'TO BE PROVIDED - Google Sheet that receives every lead (one tab per form).'
 WHERE setting_key = 'gsheet_spreadsheet_id';
UPDATE site_settings SET description = 'TO BE PROVIDED - Google Analytics 4 Measurement ID, e.g. G-XXXXXXXXXX. Empty = no analytics.'
 WHERE setting_key = 'ga4_measurement_id';
