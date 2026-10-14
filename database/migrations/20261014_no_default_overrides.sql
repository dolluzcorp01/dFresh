-- Specification / Pack overrides (product drawer, 14 Oct 2026): products.specification and products.pack are the
-- default language's value. product_translations.specification / pack stay as optional overrides for the OTHER
-- languages only (empty = the site uses the main field). The admin and the Excel import no longer accept a
-- default-language override, so this clears the ones already stored.
-- The main fields are kept as they are. An override that differed from its main field is listed first (the site
-- showed the override until now): check those products in the admin and copy the text into the main field by hand
-- if the override was the right one.
USE dfresh;

SELECT t.product_id,
       CASE WHEN t.specification IS NOT NULL AND t.specification <> p.specification THEN t.specification END AS cleared_specification_override,
       CASE WHEN t.specification IS NOT NULL AND t.specification <> p.specification THEN p.specification END AS kept_main_specification,
       CASE WHEN t.pack IS NOT NULL AND t.pack <> p.pack THEN t.pack END AS cleared_pack_override,
       CASE WHEN t.pack IS NOT NULL AND t.pack <> p.pack THEN p.pack END AS kept_main_pack
  FROM product_translations t
  JOIN products p ON p.product_id = t.product_id
 WHERE t.lang_code = (SELECT lang_code FROM languages WHERE is_default = 1 LIMIT 1)
   AND ((t.specification IS NOT NULL AND t.specification <> p.specification) OR (t.pack IS NOT NULL AND t.pack <> p.pack))
 ORDER BY t.product_id;

UPDATE product_translations
   SET specification = NULL, pack = NULL
 WHERE lang_code = (SELECT lang_code FROM languages WHERE is_default = 1 LIMIT 1)
   AND (specification IS NOT NULL OR pack IS NOT NULL);
