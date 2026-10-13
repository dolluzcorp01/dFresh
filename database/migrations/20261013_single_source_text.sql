-- Admin coverage, group C (docs/ADMIN_COVERAGE.md): texts that went stale or lived in several places.
USE dfresh;

-- 1. Live counts in texts (src/shared/countText.js): {products} {categories} {towns} {languages} = digits,
--    {..._word} = the word from num_words. The four texts that had a number typed in now use them; each reads exactly
--    as before with today's counts (25 products, 6 categories, 6 towns).
INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('num_words', 'Numbers in text', 'Number words for {products_word}, {categories_word}, {towns_word}, {languages_word}: zero, one, two ... up to twenty, separated by commas. Past the end of the list the digits are shown. TA/HI: draft, native review (open item 9)', 0);
INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('num_words', 'en', 'zero, one, two, three, four, five, six, seven, eight, nine, ten, eleven, twelve, thirteen, fourteen, fifteen, sixteen, seventeen, eighteen, nineteen, twenty'),
  ('num_words', 'ta', 'பூஜ்ஜியம், ஒன்று, இரண்டு, மூன்று, நான்கு, ஐந்து, ஆறு, ஏழு, எட்டு, ஒன்பது, பத்து, பதினொன்று, பன்னிரண்டு, பதிமூன்று, பதினான்கு, பதினைந்து, பதினாறு, பதினேழு, பதினெட்டு, பத்தொன்பது, இருபது'),
  ('num_words', 'hi', 'शून्य, एक, दो, तीन, चार, पाँच, छह, सात, आठ, नौ, दस, ग्यारह, बारह, तेरह, चौदह, पंद्रह, सोलह, सत्रह, अठारह, उन्नीस, बीस');

UPDATE ui_text SET value = REPLACE(value, '25', '{products}')
 WHERE text_key IN ('ab2_p', 'm_brochure_s') AND value LIKE '%25%';
UPDATE ui_text SET value = REPLACE(value, 'six towns', '{towns_word} towns') WHERE text_key = 'where_p' AND lang_code = 'en';
UPDATE ui_text SET value = REPLACE(value, 'छह शहरों', '{towns_word} शहरों') WHERE text_key = 'where_p' AND lang_code = 'hi';
UPDATE ui_text SET value = REPLACE(value, 'ஆறு ஊர்களுக்கு', '{towns_word} ஊர்களுக்கு') WHERE text_key = 'where_p' AND lang_code = 'ta';
UPDATE ui_text SET value = REPLACE(value, 'Six ways', '{categories_word} ways') WHERE text_key = 'range_h' AND lang_code = 'en';
UPDATE ui_text SET value = REPLACE(value, 'छह', '{categories_word}') WHERE text_key = 'range_h' AND lang_code = 'hi';
UPDATE ui_text SET value = REPLACE(value, 'ஆறு', '{categories_word}') WHERE text_key = 'range_h' AND lang_code = 'ta';

UPDATE ui_text_keys SET description = 'About point 2 text. {products} = number of products, filled in by the site' WHERE text_key = 'ab2_p';
UPDATE ui_text_keys SET description = 'Brochure form subtitle. {products} = number of products, filled in by the site' WHERE text_key = 'm_brochure_s';
UPDATE ui_text_keys SET description = 'Where we deliver paragraph. {towns_word} = number of towns as a word, filled in by the site' WHERE text_key = 'where_p';
UPDATE ui_text_keys SET description = 'Range heading. {categories_word} = number of categories as a word, filled in by the site' WHERE text_key = 'range_h';

-- {towns} is now the count everywhere; the map description's list of town names becomes {places}.
UPDATE ui_text SET value = REPLACE(value, '{towns}', '{places}') WHERE text_key = 'map_aria';
UPDATE ui_text_keys SET description = 'Delivery map, screen-reader description; {base} = base town, {places} = the other towns (names)' WHERE text_key = 'map_aria';

-- 2. Addresses: one text per language in Translations "Contact details" is the only copy (contact section cards,
--    footer, Google Maps search = the default language's text, Google business data). The Settings copies and the
--    footer's own text go.
UPDATE ui_text_keys SET group_name = 'Contact details',
       description = 'Office name: contact section card and footer.' WHERE text_key = 'c_office';
UPDATE ui_text_keys SET group_name = 'Contact details',
       description = 'Office address: the only copy. Used in the contact section, the Google Maps search (the English text) and Google business data.' WHERE text_key = 'c_office_a';
UPDATE ui_text_keys SET group_name = 'Contact details',
       description = 'Godown name: contact section card and footer.' WHERE text_key = 'c_godown';
UPDATE ui_text_keys SET group_name = 'Contact details',
       description = 'Godown address: the only copy. Used in the contact section, the Google Maps search (the English text) and Google business data.' WHERE text_key = 'c_godown_a';
DELETE FROM ui_text_keys WHERE text_key = 'f_addr';
DELETE FROM site_settings WHERE setting_key IN ('office_address', 'godown_address', 'office_map_query', 'godown_map_query');

-- 3. Footer company line = Settings company_name + "CIN {cin}" + "GSTIN {gstin}" (each part left out while empty).
--    The typed lines (with the CIN written into the text) go.
INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html) VALUES
  ('legal_cin', 'legal', 'Footer company line, CIN part; {cin} = Settings cin. Hidden while cin is empty', 0),
  ('legal_gstin', 'legal', 'Footer company line, GSTIN part; {gstin} = Settings gstin. Hidden while gstin is empty', 0);
INSERT IGNORE INTO ui_text (text_key, lang_code, value) VALUES
  ('legal_cin', 'en', 'CIN {cin}'), ('legal_cin', 'ta', 'CIN {cin}'), ('legal_cin', 'hi', 'CIN {cin}'),
  ('legal_gstin', 'en', 'GSTIN {gstin}'), ('legal_gstin', 'ta', 'GSTIN {gstin}'), ('legal_gstin', 'hi', 'GSTIN {gstin}');
DELETE FROM ui_text_keys WHERE text_key IN ('legal1', 'legal1_gst');
UPDATE site_settings SET description = 'Company legal name: footer company line, e-mail footers and Google business data.' WHERE setting_key = 'company_name';
UPDATE site_settings SET description = 'CIN: footer company line ("CIN ..."). Empty = not shown.' WHERE setting_key = 'cin';
UPDATE site_settings SET description = 'GSTIN: footer company line ("GSTIN ..."). Empty = not shown (fill it when Dolluz confirms the number).' WHERE setting_key = 'gstin';

-- 4. Settings nothing reads: the site address comes from the server (.env PUBLIC_SITE_URL); there is no reCAPTCHA.
DELETE FROM site_settings WHERE setting_key IN ('site_url', 'recaptcha_site_key');
