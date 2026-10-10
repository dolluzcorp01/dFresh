-- =====================================================================
-- Phase 6: forms, leads, brochure, outboxes.
-- 1. lead_counters: one row per year; the lead route bumps it inside the lead transaction, so two
--    submissions can never get the same lead_ref (DFL-YY + running number), and the row lock also
--    serialises the per-IP rate-limit count.
-- 2. leads.idx_leads_ip: the rate-limit count (ip_hash within the last 10 minutes).
-- 3. Mail sender: mail_from = the verified SendGrid sender address only (owner's instruction), display name
--    in mail_from_name. Every e-mail reads both from here; nothing in code holds a sender.
-- 4. UI text the forms need that the seed did not have (Tamil / Hindi are drafts for native review, open
--    item 9), and ok_bro without the preview's "On the live site" wording.
-- INSERT IGNORE / guarded UPDATEs: re-running never overwrites a value edited in the admin.
-- =====================================================================
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS lead_counters (
  yr       SMALLINT NOT NULL,                     -- 2-digit year (26 = 2026, Asia/Kolkata)
  last_no  INT      NOT NULL,                     -- last running number used that year
  PRIMARY KEY (yr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE leads ADD KEY idx_leads_ip (ip_hash, created_at);

UPDATE site_settings
   SET setting_value = 'connect@dolluzcorp.com',
       description = 'sender address of EVERY e-mail; must be the verified SendGrid sender'
 WHERE setting_key = 'mail_from' AND setting_value = '"dFresh" <connect@dolluzcorp.com>';

INSERT IGNORE INTO site_settings (setting_key, setting_value, is_public, description) VALUES
  ('mail_from_name', 'dFresh', 0, 'sender display name shown with mail_from');

INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('sending', 'forms', 'Submit button while the form is being sent', 0),
  ('thanks_name', 'forms', 'Success title after a form; {name} = the first name they typed', 0),
  ('e_net', 'errors', 'Form could not be sent (network or server); the typed data stays', 0),
  ('e_rate', 'errors', 'Too many form submissions from one connection (5 in 10 minutes)', 0),
  ('bro_expired', 'common', 'Brochure download link expired or broken (page shown by the download link)', 0);

INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('sending', 'en', 'Sending...'),
  ('sending', 'ta', 'அனுப்புகிறது...'),
  ('sending', 'hi', 'भेजा जा रहा है...'),
  ('thanks_name', 'en', 'Thank you, {name}!'),
  ('thanks_name', 'ta', 'நன்றி, {name}!'),
  ('thanks_name', 'hi', 'धन्यवाद, {name}!'),
  ('e_net', 'en', 'Could not send. Check your connection and try again - your details are still here.'),
  ('e_net', 'ta', 'அனுப்ப முடியவில்லை. இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும் - உங்கள் விவரங்கள் அப்படியே உள்ளன.'),
  ('e_net', 'hi', 'भेजा नहीं जा सका। कनेक्शन जाँचें और फिर से कोशिश करें - आपकी जानकारी यहीं है।'),
  ('e_rate', 'en', 'Too many requests from this connection. Please wait a few minutes, or message us on WhatsApp.'),
  ('e_rate', 'ta', 'இந்த இணைப்பிலிருந்து அதிகமான கோரிக்கைகள். சில நிமிடங்கள் கழித்து முயற்சிக்கவும், அல்லது வாட்ஸ்அப்பில் எங்களுக்கு எழுதவும்.'),
  ('e_rate', 'hi', 'इस कनेक्शन से बहुत अधिक अनुरोध। कुछ मिनट बाद फिर कोशिश करें, या हमें व्हाट्सऐप पर लिखें।'),
  ('bro_expired', 'en', 'This brochure link has expired. Please request the brochure again on our website.'),
  ('bro_expired', 'ta', 'இந்த பிரோஷர் இணைப்பு காலாவதியாகிவிட்டது. எங்கள் இணையதளத்தில் மீண்டும் கோரவும்.'),
  ('bro_expired', 'hi', 'यह ब्रोशर लिंक समाप्त हो गया है। कृपया हमारी वेबसाइट पर फिर से ब्रोशर माँगें।');

UPDATE ui_text SET value = 'Your brochure is downloading now. A copy link is on its way to your e-mail.'
 WHERE text_key = 'ok_bro' AND lang_code = 'en'
   AND value = 'On the live site the brochure PDF downloads now and a copy goes to your e-mail.';
UPDATE ui_text SET value = 'உங்கள் பிரோஷர் இப்போது பதிவிறங்குகிறது. ஒரு நகல் இணைப்பு உங்கள் மின்னஞ்சலுக்கு வருகிறது.'
 WHERE text_key = 'ok_bro' AND lang_code = 'ta'
   AND value = 'நேரடி தளத்தில் பிரோஷர் PDF இப்போதே பதிவிறங்கும், ஒரு நகல் உங்கள் மின்னஞ்சலுக்கும் வரும்.';
UPDATE ui_text SET value = 'आपका ब्रोशर अभी डाउनलोड हो रहा है। एक कॉपी लिंक आपके ईमेल पर आ रहा है।'
 WHERE text_key = 'ok_bro' AND lang_code = 'hi'
   AND value = 'लाइव साइट पर ब्रोशर PDF अभी डाउनलोड होगा और एक कॉपी आपके ईमेल पर जाएगी।';
