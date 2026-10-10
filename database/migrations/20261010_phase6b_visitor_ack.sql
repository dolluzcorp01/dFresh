-- =====================================================================
-- Phase 6b: visitor confirmation e-mail (purpose 'lead_ack') for quote, sample, distributor and contact.
-- Sent in the visitor's language with English fallback; it also reuses thanks_name, ok_other, whatsapp_us
-- and wa_general. {ref} = lead_ref. Tamil / Hindi are drafts for native review (open item 9).
-- INSERT IGNORE: re-running never overwrites a value edited in the admin.
-- =====================================================================
USE dfresh;
SET NAMES utf8mb4;

INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('mail_ack_subject', 'mail', 'Visitor confirmation e-mail subject; {ref} = their lead reference', 0),
  ('mail_ack_intro', 'mail', 'Visitor confirmation e-mail: first line under the thank-you title', 0),
  ('mail_ack_ref', 'mail', 'Visitor confirmation e-mail: label above the lead reference', 0),
  ('mail_ack_next_h', 'mail', 'Visitor confirmation e-mail: "what happens next" heading (text below is ok_other)', 0),
  ('mail_ack_keep', 'mail', 'Visitor confirmation e-mail: ask them to quote the reference', 0);

INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('mail_ack_subject', 'en', 'dFresh - we have your request ({ref})'),
  ('mail_ack_subject', 'ta', 'dFresh - உங்கள் கோரிக்கை கிடைத்தது ({ref})'),
  ('mail_ack_subject', 'hi', 'dFresh - आपका अनुरोध मिल गया ({ref})'),
  ('mail_ack_intro', 'en', 'We have received your request.'),
  ('mail_ack_intro', 'ta', 'உங்கள் கோரிக்கை எங்களுக்குக் கிடைத்துவிட்டது.'),
  ('mail_ack_intro', 'hi', 'हमें आपका अनुरोध मिल गया है।'),
  ('mail_ack_ref', 'en', 'Your reference number'),
  ('mail_ack_ref', 'ta', 'உங்கள் குறிப்பு எண்'),
  ('mail_ack_ref', 'hi', 'आपका संदर्भ नंबर'),
  ('mail_ack_next_h', 'en', 'What happens next'),
  ('mail_ack_next_h', 'ta', 'அடுத்து என்ன'),
  ('mail_ack_next_h', 'hi', 'आगे क्या होगा'),
  ('mail_ack_keep', 'en', 'Please mention this reference when you write to us or call us.'),
  ('mail_ack_keep', 'ta', 'எங்களுக்கு எழுதும்போதோ அழைக்கும்போதோ இந்தக் குறிப்பு எண்ணைக் குறிப்பிடவும்.'),
  ('mail_ack_keep', 'hi', 'हमें लिखते या कॉल करते समय कृपया यह संदर्भ नंबर बताएँ।');
