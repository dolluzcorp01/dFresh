-- Positions are whole numbers 1, 2, 3 ... and unique in their list (admin catalogue fixes, 14 Oct 2026):
--   main products:   per category        (variant_of IS NULL, category_key)
--   colour versions: per main product    (variant_of)
--   featured order:  among featured products (is_featured = 1; NULL when not featured)
--   categories, kits, banners: the whole list
-- Everything is renumbered keeping today's visible order (ties by key), then products.sort_order becomes INT
-- (it was DECIMAL so 5.1, 5.2 kept colour versions next to their main product; they are now numbered inside it).
-- The admin keeps these unique (drag to reorder; the API and the Excel import refuse duplicates, decimals and
-- numbers below 1).
USE dfresh;

-- Featured first, while the old global sort_order still decides ties
UPDATE products SET featured_order = NULL WHERE is_featured = 0;
UPDATE products p
  JOIN (SELECT product_id, ROW_NUMBER() OVER (ORDER BY featured_order IS NULL, featured_order, sort_order, product_id) AS rn
          FROM products WHERE is_featured = 1) x USING (product_id)
   SET p.featured_order = x.rn;

UPDATE products p
  JOIN (SELECT product_id, ROW_NUMBER() OVER (PARTITION BY category_key ORDER BY sort_order, product_id) AS rn
          FROM products WHERE variant_of IS NULL) x USING (product_id)
   SET p.sort_order = x.rn;
UPDATE products p
  JOIN (SELECT product_id, ROW_NUMBER() OVER (PARTITION BY variant_of ORDER BY sort_order, product_id) AS rn
          FROM products WHERE variant_of IS NOT NULL) x USING (product_id)
   SET p.sort_order = x.rn;
ALTER TABLE products MODIFY sort_order INT NOT NULL DEFAULT 0;

UPDATE categories c
  JOIN (SELECT category_key, ROW_NUMBER() OVER (ORDER BY sort_order, category_key) AS rn FROM categories) x USING (category_key)
   SET c.sort_order = x.rn;
UPDATE kits k
  JOIN (SELECT kit_key, ROW_NUMBER() OVER (ORDER BY sort_order, kit_key) AS rn FROM kits) x USING (kit_key)
   SET k.sort_order = x.rn;
UPDATE banners b
  JOIN (SELECT banner_key, ROW_NUMBER() OVER (ORDER BY sort_order, banner_key) AS rn FROM banners) x USING (banner_key)
   SET b.sort_order = x.rn;
