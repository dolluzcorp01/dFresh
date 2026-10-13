-- Admin coverage, group B (docs/ADMIN_COVERAGE.md): page titles and descriptions for Google and share previews get
-- their own texts (Translations group "Google and sharing"), so editing them never changes text on the page.
-- Seeded per language with exactly what the pages use today (src/shared/pageMeta.js before this change):
--   home      "dFresh - {tagline} | {eyebrow}"      / lede
--   products  "{all_h} | dFresh"                    / lede
--   privacy   "{lg_priv_s} | dFresh"                / lede
--   terms     "{lg_terms_h} | dFresh"               / lede
--   category  "{category name} | dFresh"            / lede   (seo_cat_<category_key>_t / _d)
-- A category added later gets its two texts when it is created in the admin (Admin_server.js); a page without its
-- own text still falls back to the old pattern. max_chars = the counter shown in Translations (title 60,
-- description 160: about what Google shows).
USE dfresh;

ALTER TABLE ui_text_keys ADD COLUMN max_chars SMALLINT UNSIGNED NULL AFTER allows_html;

INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html, max_chars) VALUES
  ('seo_home_t', 'Google and sharing', 'Home page title: shown in Google results, the browser tab and share previews (WhatsApp, Facebook). Changes no text on the page.', 0, 60),
  ('seo_home_d', 'Google and sharing', 'Home page description: the short text under the title in Google results and share previews. Changes no text on the page.', 0, 160),
  ('seo_products_t', 'Google and sharing', 'All products page title: Google results, browser tab, share previews. Changes no text on the page.', 0, 60),
  ('seo_products_d', 'Google and sharing', 'All products page description: Google results and share previews. Changes no text on the page.', 0, 160),
  ('seo_privacy_t', 'Google and sharing', 'Privacy policy page title: Google results, browser tab, share previews. Changes no text on the page.', 0, 60),
  ('seo_privacy_d', 'Google and sharing', 'Privacy policy page description: Google results and share previews. Changes no text on the page.', 0, 160),
  ('seo_terms_t', 'Google and sharing', 'Terms of use page title: Google results, browser tab, share previews. Changes no text on the page.', 0, 60),
  ('seo_terms_d', 'Google and sharing', 'Terms of use page description: Google results and share previews. Changes no text on the page.', 0, 160);

INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html, max_chars)
  SELECT CONCAT('seo_cat_', category_key, '_t'), 'Google and sharing',
         CONCAT('Products page for the category "', category_key, '": title in Google results, the browser tab and share previews. Changes no text on the page.'), 0, 60
    FROM categories;
INSERT IGNORE INTO ui_text_keys (text_key, group_name, description, allows_html, max_chars)
  SELECT CONCAT('seo_cat_', category_key, '_d'), 'Google and sharing',
         CONCAT('Products page for the category "', category_key, '": description in Google results and share previews. Changes no text on the page.'), 0, 160
    FROM categories;

-- Titles, per language, from today's texts
INSERT IGNORE INTO ui_text (text_key, lang_code, value)
  SELECT 'seo_home_t', tg.lang_code, CONCAT('dFresh - ', tg.value, ' | ', eb.value)
    FROM ui_text tg JOIN ui_text eb ON eb.lang_code = tg.lang_code AND eb.text_key = 'eyebrow'
   WHERE tg.text_key = 'tagline';
INSERT IGNORE INTO ui_text (text_key, lang_code, value)
  SELECT 'seo_products_t', lang_code, CONCAT(value, ' | dFresh') FROM ui_text WHERE text_key = 'all_h';
INSERT IGNORE INTO ui_text (text_key, lang_code, value)
  SELECT 'seo_privacy_t', lang_code, CONCAT(value, ' | dFresh') FROM ui_text WHERE text_key = 'lg_priv_s';
INSERT IGNORE INTO ui_text (text_key, lang_code, value)
  SELECT 'seo_terms_t', lang_code, CONCAT(value, ' | dFresh') FROM ui_text WHERE text_key = 'lg_terms_h';
INSERT IGNORE INTO ui_text (text_key, lang_code, value)
  SELECT CONCAT('seo_cat_', category_key, '_t'), lang_code, CONCAT(name, ' | dFresh') FROM category_translations;

-- Descriptions: every page used the hero lede
INSERT IGNORE INTO ui_text (text_key, lang_code, value)
  SELECT k.text_key, l.lang_code, l.value
    FROM ui_text l
    JOIN (SELECT 'seo_home_d' AS text_key UNION ALL SELECT 'seo_products_d' UNION ALL SELECT 'seo_privacy_d' UNION ALL SELECT 'seo_terms_d') k
   WHERE l.text_key = 'lede';
INSERT IGNORE INTO ui_text (text_key, lang_code, value)
  SELECT CONCAT('seo_cat_', c.category_key, '_d'), l.lang_code, l.value
    FROM categories c JOIN ui_text l ON l.text_key = 'lede';
