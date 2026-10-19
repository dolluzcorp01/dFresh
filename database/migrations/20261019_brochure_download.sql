-- Brochure download switch (Settings > Brochure). 'on' (also what a missing row means) = the brochure form starts the
-- PDF download and e-mails a copy link, as before. 'off' = the form is still collected (lead saved, staff alert, Google
-- Sheet row) but the visitor only sees the thank-you modal with bro_off: no download, no link, no copy e-mail, and
-- /brochure/download answers 404 for every link (also links e-mailed earlier). Read by the server at every request
-- (Leads_server.js, Brochure_server.js), never by the browser. Server only.
USE dfresh;

INSERT IGNORE INTO site_settings (setting_key, setting_value, is_public, description)
VALUES ('brochure_download_enabled', 'on', 0,
        'On: visitors get the PDF after filling the form. Off: the form is still collected, but only a thank-you message is shown.');

-- The visitor's thank-you line while the download is off (brochure form success, and the page a dead link opens).
INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('bro_off', 'forms', 'Brochure form sent while Settings brochure_download_enabled is off (no download): the thank-you line. Also the page an e-mailed brochure link opens then.', 0),
  ('ma_bro_off', 'Staff e-mails', 'New lead alert, brochure row: download switched off in Settings, nothing sent to the visitor', 0);

INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('bro_off', 'en', 'Thank you. Our team will share the brochure with you shortly.'),
  ('bro_off', 'ta', 'நன்றி. எங்கள் குழு விரைவில் பிரோஷரை உங்களுடன் பகிர்ந்துகொள்ளும்.'),
  ('bro_off', 'hi', 'धन्यवाद। हमारी टीम जल्द ही ब्रोशर आपके साथ साझा करेगी।'),
  ('ma_bro_off', 'en', 'Not sent: brochure download is off in Settings - send it to the visitor');
