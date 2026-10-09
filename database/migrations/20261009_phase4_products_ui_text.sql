-- =====================================================================
-- Phase 4: UI text the flip cards, featured rail and products drawer need that the seed did not have.
-- All are screen-reader labels for controls the preview labelled in English only ("Previous", "Next",
-- "Image 1", "Search products"). Tamil / Hindi are drafts for native review (open item 9).
-- Data only, no schema change. INSERT IGNORE: re-running never overwrites a value edited in the admin.
-- =====================================================================
USE dfresh;
SET NAMES utf8mb4;

INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('feat_prev', 'featured', 'Featured rail previous button, screen-reader label', 0),
  ('feat_next', 'featured', 'Featured rail next button, screen-reader label', 0),
  ('card_photo', 'products', 'Product card photo dot, screen-reader label; {n} = photo number', 0),
  ('search_label', 'products', 'Products drawer search box, screen-reader label', 0);

INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('feat_prev', 'en', 'Previous products'),
  ('feat_prev', 'ta', 'முந்தைய தயாரிப்புகள்'),
  ('feat_prev', 'hi', 'पिछले उत्पाद'),
  ('feat_next', 'en', 'Next products'),
  ('feat_next', 'ta', 'அடுத்த தயாரிப்புகள்'),
  ('feat_next', 'hi', 'अगले उत्पाद'),
  ('card_photo', 'en', 'Image {n}'),
  ('card_photo', 'ta', 'படம் {n}'),
  ('card_photo', 'hi', 'चित्र {n}'),
  ('search_label', 'en', 'Search products'),
  ('search_label', 'ta', 'தயாரிப்புகளைத் தேடுங்கள்'),
  ('search_label', 'hi', 'उत्पाद खोजें');
