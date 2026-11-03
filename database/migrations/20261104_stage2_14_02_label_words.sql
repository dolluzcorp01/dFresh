-- Stage 2, phase 14 / 02: the words printed on pack, carton and shelf labels (Masters > Catalogue > Barcodes and
-- labels, v23 test 1.18), in every language as data (docs/04_I18N.md: a new language is rows only). Group
-- "Pack labels": translated on the Translations page like any text, never sent to the public site (text-groups.js).
-- The legal lines of a pack label (MRP, net quantity, packed by, customer care, origin) stay in English, as the law allows.
USE dfresh;
SET NAMES utf8mb4;

INSERT IGNORE INTO `ui_text_keys` (`text_key`, `group_name`, `description`, `allows_html`, `max_chars`) VALUES
  ('lb_pack', 'Pack labels', 'Pack label: before the pack size ("Pack: Pack of 100")', 0, 20),
  ('lb_carton_of', 'Pack labels', 'Carton label: before the packs per carton ("Carton of 24 packs")', 0, 30),
  ('lb_packs', 'Pack labels', 'Carton label: after the packs per carton', 0, 20),
  ('lb_shelf', 'Pack labels', 'Shelf label: first word', 0, 20),
  ('lb_reorder', 'Pack labels', 'Shelf label: before the reorder level', 0, 30),
  ('lb_category', 'Pack labels', 'Every label: before the category name', 0, 20);
INSERT IGNORE INTO `ui_text` (`text_key`, `lang_code`, `value`) VALUES
  ('lb_pack', 'en', 'Pack'), ('lb_pack', 'ta', 'பொதி'), ('lb_pack', 'hi', 'पैक'),
  ('lb_carton_of', 'en', 'Carton of'), ('lb_carton_of', 'ta', 'அட்டைப்பெட்டி'), ('lb_carton_of', 'hi', 'कार्टन में'),
  ('lb_packs', 'en', 'packs'), ('lb_packs', 'ta', 'பொதிகள்'), ('lb_packs', 'hi', 'पैक'),
  ('lb_shelf', 'en', 'Shelf'), ('lb_shelf', 'ta', 'அலமாரி'), ('lb_shelf', 'hi', 'शेल्फ'),
  ('lb_reorder', 'en', 'Reorder at'), ('lb_reorder', 'ta', 'மறு ஆர்டர்'), ('lb_reorder', 'hi', 'दोबारा मंगाएं'),
  ('lb_category', 'en', 'Category'), ('lb_category', 'ta', 'வகை'), ('lb_category', 'hi', 'श्रेणी');
