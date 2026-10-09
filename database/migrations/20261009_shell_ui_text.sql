-- =====================================================================
-- Phase 2: UI text the site frame needs that the seed did not have.
-- wa_float is named in docs/05_FEATURES_SPEC.md A2 but was missing; the rest are labels for the header,
-- footer and the "page did not load" screen. Tamil / Hindi are drafts for native review (open item 9).
-- Data only, no schema change. INSERT IGNORE: re-running never overwrites a value edited in the admin.
-- =====================================================================
USE dfresh;
SET NAMES utf8mb4;

INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('wa_float', 'common', 'Floating WhatsApp button, screen-reader label', 0),
  ('lang_label', 'nav', 'Language switch group, screen-reader label', 0),
  ('home_link', 'nav', 'Header logo link, screen-reader label', 0),
  ('lbl_whatsapp', 'footer', 'Footer Visit column label before the WhatsApp number', 0),
  ('legal1_gst', 'legal', 'Footer legal line once the gstin setting is filled; {cin} {gstin} from settings', 0),
  ('copyright', 'legal', 'Footer copyright; {year} = current year', 0),
  ('load_err_h', 'errors', 'Shown when the site content could not load', 0),
  ('load_err_p', 'errors', 'Shown under load_err_h', 0),
  ('retry', 'errors', 'Button on the "did not load" screen', 0);

INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('wa_float', 'en', 'Chat with dFresh on WhatsApp'),
  ('wa_float', 'ta', 'dFresh உடன் WhatsApp-இல் பேசுங்கள்'),
  ('wa_float', 'hi', 'dFresh से WhatsApp पर बात करें'),
  ('lang_label', 'en', 'Language'),
  ('lang_label', 'ta', 'மொழி'),
  ('lang_label', 'hi', 'भाषा'),
  ('home_link', 'en', 'dFresh home'),
  ('home_link', 'ta', 'dFresh முகப்பு'),
  ('home_link', 'hi', 'dFresh होम'),
  ('lbl_whatsapp', 'en', 'WhatsApp'),
  ('lbl_whatsapp', 'ta', 'WhatsApp'),
  ('lbl_whatsapp', 'hi', 'WhatsApp'),
  ('legal1_gst', 'en', 'Dolluz Corporation (OPC) Pvt Ltd · CIN {cin} · GSTIN {gstin}'),
  ('legal1_gst', 'ta', 'டோலஸ் கார்ப்பரேஷன் (OPC) பிரைவேட் லிமிடெட் · CIN {cin} · GSTIN {gstin}'),
  ('legal1_gst', 'hi', 'डोलज़ कॉर्पोरेशन (OPC) प्राइवेट लिमिटेड · CIN {cin} · GSTIN {gstin}'),
  ('copyright', 'en', '© {year} dFresh'),
  ('copyright', 'ta', '© {year} dFresh'),
  ('copyright', 'hi', '© {year} dFresh'),
  ('load_err_h', 'en', 'This page did not load'),
  ('load_err_h', 'ta', 'இந்தப் பக்கம் ஏற்றப்படவில்லை'),
  ('load_err_h', 'hi', 'यह पेज लोड नहीं हुआ'),
  ('load_err_p', 'en', 'Please check your internet connection and try again, or send us a WhatsApp message.'),
  ('load_err_p', 'ta', 'உங்கள் இணைய இணைப்பைச் சரிபார்த்து மீண்டும் முயற்சிக்கவும், அல்லது WhatsApp-இல் செய்தி அனுப்புங்கள்.'),
  ('load_err_p', 'hi', 'कृपया अपना इंटरनेट कनेक्शन जाँचें और फिर से कोशिश करें, या हमें WhatsApp पर संदेश भेजें।'),
  ('retry', 'en', 'Try again'),
  ('retry', 'ta', 'மீண்டும் முயற்சிக்கவும்'),
  ('retry', 'hi', 'फिर से कोशिश करें');
