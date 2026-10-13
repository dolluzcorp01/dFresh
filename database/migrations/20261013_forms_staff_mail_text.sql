-- Admin coverage, group D (docs/ADMIN_COVERAGE.md): the last fixed words a visitor or staff member reads.
-- 1. Form example text inside the phone / e-mail boxes, and the free sample form's own title (seeded with the quote
--    title it showed so far, so nothing changes until an admin edits it).
-- 2. Staff e-mails (new lead alert, admin sign-in code): every word, English only (group "Staff e-mails"; the server
--    reads the default language only, so these are not counted as missing translations). Same wording as before.
-- Town name positions (towns.label_dx / label_dy / label_anchor) need no change here: the columns exist since
-- 20261010_phase5_home_rest.sql and are now on the admin Towns screen.
USE dfresh;

INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('ph_tel', 'forms', 'Example shown inside an empty phone box (all forms)', 0),
  ('ph_email', 'forms', 'Example shown inside an empty e-mail box (all forms)', 0),
  ('m_sample', 'forms', 'Free sample form title (the quote form opened from "Get a free sample" buttons)', 0);
INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('ph_tel', 'en', '98765 43210'), ('ph_tel', 'ta', '98765 43210'), ('ph_tel', 'hi', '98765 43210'),
  ('ph_email', 'en', 'name@company.com'), ('ph_email', 'ta', 'name@company.com'), ('ph_email', 'hi', 'name@company.com');
INSERT IGNORE INTO ui_text (text_key, lang_code, value)
  SELECT 'm_sample', lang_code, value FROM ui_text WHERE text_key = 'm_quote';

INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('ma_subject', 'Staff e-mails', 'New lead alert: subject. {ref} = lead reference, {form} = form name, {name} = visitor', 0),
  ('ma_preheader', 'Staff e-mails', 'New lead alert: preview line in the inbox ({form}, {name}; the town is added when given)', 0),
  ('ma_kicker', 'Staff e-mails', 'New lead alert: small heading above the reference', 0),
  ('ma_button', 'Staff e-mails', 'New lead alert: button to the lead in the admin', 0),
  ('ma_footer', 'Staff e-mails', 'New lead alert: footer (the company name is added)', 0),
  ('ma_text_head', 'Staff e-mails', 'New lead alert: first line of the plain-text version ({ref}, {form})', 0),
  ('ma_form_brochure', 'Staff e-mails', 'New lead alert: form name', 0),
  ('ma_form_quote', 'Staff e-mails', 'New lead alert: form name', 0),
  ('ma_form_sample', 'Staff e-mails', 'New lead alert: form name', 0),
  ('ma_form_distributor', 'Staff e-mails', 'New lead alert: form name', 0),
  ('ma_form_contact', 'Staff e-mails', 'New lead alert: form name', 0),
  ('ma_l_ref', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_form', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_received', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_name', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_business', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_business_type', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_town', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_phone', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_whatsapp', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_email', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_products', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_quantity', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_message', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_gst', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_areas', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_godown', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_brands', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_sales', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_brochure', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_language', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_page', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_from', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_l_consent', 'Staff e-mails', 'New lead alert: row label', 0),
  ('ma_bro_sent', 'Staff e-mails', 'New lead alert, brochure row: copy link sent ({lang} = brochure language)', 0),
  ('ma_bro_pending', 'Staff e-mails', 'New lead alert, brochure row: no brochure uploaded yet', 0),
  ('ma_consent_yes', 'Staff e-mails', 'New lead alert, consent row ({text} = the consent sentence the visitor ticked)', 0),
  ('mc_subject', 'Staff e-mails', 'Admin sign-in code e-mail: subject ({code})', 0),
  ('mc_preheader', 'Staff e-mails', 'Admin sign-in code e-mail: preview line in the inbox ({minutes})', 0),
  ('mc_hello', 'Staff e-mails', 'Admin sign-in code e-mail: greeting ({name})', 0),
  ('mc_intro', 'Staff e-mails', 'Admin sign-in code e-mail: line before the code', 0),
  ('mc_valid', 'Staff e-mails', 'Admin sign-in code e-mail: line after the code ({minutes})', 0),
  ('mc_footer', 'Staff e-mails', 'Admin sign-in code e-mail: footer (the company name is added)', 0);

INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('ma_subject', 'en', 'New dFresh lead {ref} - {form} - {name}'),
  ('ma_preheader', 'en', '{form} from {name}'),
  ('ma_kicker', 'en', 'New lead'),
  ('ma_button', 'en', 'Open in dFresh admin'),
  ('ma_footer', 'en', 'dFresh website lead alert'),
  ('ma_text_head', 'en', 'New dFresh lead {ref} ({form})'),
  ('ma_form_brochure', 'en', 'Brochure'),
  ('ma_form_quote', 'en', 'Quote'),
  ('ma_form_sample', 'en', 'Free sample'),
  ('ma_form_distributor', 'en', 'Distributor'),
  ('ma_form_contact', 'en', 'Contact'),
  ('ma_l_ref', 'en', 'Lead ref'),
  ('ma_l_form', 'en', 'Form'),
  ('ma_l_received', 'en', 'Received'),
  ('ma_l_name', 'en', 'Name'),
  ('ma_l_business', 'en', 'Business'),
  ('ma_l_business_type', 'en', 'Business type'),
  ('ma_l_town', 'en', 'Town'),
  ('ma_l_phone', 'en', 'Phone'),
  ('ma_l_whatsapp', 'en', 'WhatsApp'),
  ('ma_l_email', 'en', 'E-mail'),
  ('ma_l_products', 'en', 'Products'),
  ('ma_l_quantity', 'en', 'Monthly quantity'),
  ('ma_l_message', 'en', 'Message'),
  ('ma_l_gst', 'en', 'GST no.'),
  ('ma_l_areas', 'en', 'Areas covered'),
  ('ma_l_godown', 'en', 'Godown / vehicles'),
  ('ma_l_brands', 'en', 'Brands handled'),
  ('ma_l_sales', 'en', 'Monthly tissue sales'),
  ('ma_l_brochure', 'en', 'Brochure'),
  ('ma_l_language', 'en', 'Language'),
  ('ma_l_page', 'en', 'Page'),
  ('ma_l_from', 'en', 'Opened from'),
  ('ma_l_consent', 'en', 'Consent'),
  ('ma_bro_sent', 'en', 'Copy link e-mailed to the visitor ({lang})'),
  ('ma_bro_pending', 'en', 'No brochure uploaded yet - send it to the visitor when it is ready'),
  ('ma_consent_yes', 'en', 'Yes - "{text}"'),
  ('mc_subject', 'en', 'dFresh admin sign-in code: {code}'),
  ('mc_preheader', 'en', 'Your code is valid for {minutes} minutes.'),
  ('mc_hello', 'en', 'Hello {name},'),
  ('mc_intro', 'en', 'Your dFresh admin sign-in code is:'),
  ('mc_valid', 'en', 'It is valid for {minutes} minutes. If you did not try to sign in, tell the dFresh admin.'),
  ('mc_footer', 'en', 'dFresh admin');
