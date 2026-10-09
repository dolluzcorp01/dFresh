-- =====================================================================
-- Phase 3: UI text the hero, banner slider and range ring need that the seed did not have.
-- bn_k is named in docs/05_FEATURES_SPEC.md B2 (text from preview v3); the rest are screen-reader labels
-- for controls the preview labelled in English only. Tamil / Hindi are drafts for native review (open item 9).
-- Data only, no schema change. INSERT IGNORE: re-running never overwrites a value edited in the admin.
-- =====================================================================
USE dfresh;
SET NAMES utf8mb4;

INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('bn_k', 'banners', 'Banner slider eyebrow over every banner headline (preview v3)', 0),
  ('bn_label', 'banners', 'Banner slider, screen-reader label of the carousel', 0),
  ('bn_prev', 'banners', 'Banner slider previous arrow, screen-reader label', 0),
  ('bn_next', 'banners', 'Banner slider next arrow, screen-reader label', 0),
  ('bn_goto', 'banners', 'Banner slider dot, screen-reader label; {n} = banner number', 0),
  ('ring_prev', 'range', 'Range ring previous button, screen-reader label', 0),
  ('ring_next', 'range', 'Range ring next button, screen-reader label', 0),
  ('sheet_label', 'hero', 'Hero tissue sheet, screen-reader description', 0);

INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('bn_k', 'en', 'dFresh moods'),
  ('bn_k', 'ta', 'dFresh மனநிலைகள்'),
  ('bn_k', 'hi', 'dFresh मूड'),
  ('bn_label', 'en', 'dFresh banners'),
  ('bn_label', 'ta', 'dFresh பேனர்கள்'),
  ('bn_label', 'hi', 'dFresh बैनर'),
  ('bn_prev', 'en', 'Previous banner'),
  ('bn_prev', 'ta', 'முந்தைய பேனர்'),
  ('bn_prev', 'hi', 'पिछला बैनर'),
  ('bn_next', 'en', 'Next banner'),
  ('bn_next', 'ta', 'அடுத்த பேனர்'),
  ('bn_next', 'hi', 'अगला बैनर'),
  ('bn_goto', 'en', 'Banner {n}'),
  ('bn_goto', 'ta', 'பேனர் {n}'),
  ('bn_goto', 'hi', 'बैनर {n}'),
  ('ring_prev', 'en', 'Previous category'),
  ('ring_prev', 'ta', 'முந்தைய வகை'),
  ('ring_prev', 'hi', 'पिछली श्रेणी'),
  ('ring_next', 'en', 'Next category'),
  ('ring_next', 'ta', 'அடுத்த வகை'),
  ('ring_next', 'hi', 'अगली श्रेणी'),
  ('sheet_label', 'en', 'A soft sheet of dFresh tissue that ripples when touched'),
  ('sheet_label', 'ta', 'தொட்டால் அலைபோல் அசையும் மென்மையான dFresh டிஷ்யூ'),
  ('sheet_label', 'hi', 'छूने पर लहराता हुआ मुलायम dFresh टिश्यू');
