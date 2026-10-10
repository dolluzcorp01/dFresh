-- =====================================================================
-- Phase 5: try-it toys, business kits, delivery map, about, contact band, legal pages.
-- 1. towns: where each name sits next to its pin on the illustrated map. The preview placed them by
--    town name in code; as data, a new town gets the default (centred above the pin) and the admin can move it.
-- 2. UI text the seed did not have: screen-reader labels the preview had in English only, the "cm" unit of
--    the napkin counter, and the About photo's alt text. Tamil / Hindi are drafts for native review (open item 9).
-- INSERT IGNORE / guarded UPDATEs: re-running never overwrites a value edited in the admin.
-- =====================================================================
USE dfresh;
SET NAMES utf8mb4;

ALTER TABLE towns
  ADD COLUMN label_dx     SMALLINT NOT NULL DEFAULT 0   AFTER map_y,   -- label offset from the pin, map units
  ADD COLUMN label_dy     SMALLINT NOT NULL DEFAULT -20 AFTER label_dx,
  ADD COLUMN label_anchor ENUM('start','middle','end') NOT NULL DEFAULT 'middle' AFTER label_dy;

-- the approved preview's placements (Sriperumbudur and Vellore keep the default)
UPDATE towns SET label_dx = -16, label_dy = -16, label_anchor = 'end'   WHERE town_key = 'kanchipuram' AND label_dx = 0 AND label_dy = -20;
UPDATE towns SET label_dx = 0,   label_dy = -20, label_anchor = 'end'   WHERE town_key = 'chennai'     AND label_dx = 0 AND label_dy = -20;
UPDATE towns SET label_dx = 0,   label_dy = 32,  label_anchor = 'middle' WHERE town_key = 'wallajabad' AND label_dx = 0 AND label_dy = -20;
UPDATE towns SET label_dx = -4,  label_dy = 32,  label_anchor = 'start' WHERE town_key = 'ambur'       AND label_dx = 0 AND label_dy = -20;

INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('roll_aria', 'try_it', 'The roll toy, screen-reader label of the roll button', 0),
  ('size_aria', 'try_it', 'The napkin toy, screen-reader label of the size buttons group', 0),
  ('unit_cm', 'try_it', 'Unit after the napkin size counter', 0),
  ('map_aria', 'where', 'Delivery map, screen-reader description; {base} = base town, {towns} = the other towns', 0),
  ('map_frame', 'contact', 'Embedded Google map title (screen readers); {place} = office or godown name', 0),
  ('ab_alt', 'about', 'About photo, alt text', 0);

INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('roll_aria', 'en', 'Unroll the toilet roll'),
  ('roll_aria', 'ta', 'டாய்லெட் ரோலை விரிக்கவும்'),
  ('roll_aria', 'hi', 'टॉयलेट रोल खोलें'),
  ('size_aria', 'en', 'Napkin size'),
  ('size_aria', 'ta', 'நாப்கின் அளவு'),
  ('size_aria', 'hi', 'नैपकिन का आकार'),
  ('unit_cm', 'en', 'cm'),
  ('unit_cm', 'ta', 'செ.மீ'),
  ('unit_cm', 'hi', 'सेमी'),
  ('map_aria', 'en', 'Map: dFresh delivers from {base} to {towns}.'),
  ('map_aria', 'ta', 'வரைபடம்: dFresh {base}-இலிருந்து {towns} ஆகிய ஊர்களுக்கு டெலிவரி செய்கிறது.'),
  ('map_aria', 'hi', 'नक्शा: dFresh {base} से {towns} तक डिलीवरी करता है।'),
  ('map_frame', 'en', 'Map: {place}'),
  ('map_frame', 'ta', 'வரைபடம்: {place}'),
  ('map_frame', 'hi', 'नक्शा: {place}'),
  ('ab_alt', 'en', 'dFresh products on a soft beige stage'),
  ('ab_alt', 'ta', 'மென்மையான பழுப்பு மேடையில் dFresh பொருட்கள்'),
  ('ab_alt', 'hi', 'हल्के बेज मंच पर dFresh उत्पाद');
