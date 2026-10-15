-- Banner headlines may use {count}: the live number of active products (main products, not colour versions; the
-- same number as {products} in Translations). The "products" banner said "25 products. One gentle brand." with the
-- number typed in; it now follows the catalogue in all three languages (only its leading number changes).
USE dfresh;

UPDATE banner_translations
   SET headline = REGEXP_REPLACE(headline, '^[0-9]+', '{count}')
 WHERE banner_key = 'products' AND headline REGEXP '^[0-9]+ ';
