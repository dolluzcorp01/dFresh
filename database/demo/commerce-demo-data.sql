-- dFresh Commerce DEMO data (SQL part) - NOT a migration. Run only by scripts/commerce-demo-seed.js on dfresh_commerce,
-- after database/demo/commerce-demo-schema.sql: SKUs from the catalogue (with demo carton sizes, minimum orders and
-- HSN codes), reorder levels and a little returned stock. Prices, customers, orders, returns and
-- approvals are made by the script through the same code as the admin (pricing.js, commerce.js).


-- from commerce_01_sku.sql

INSERT IGNORE INTO skus (sku_code, product_id, size_label, created_by)
SELECT CONCAT(REPLACE(REPLACE(p.product_id, 'DZIND-', ''), '-', ''), '-',
         CASE WHEN p.pack LIKE '%roll%' THEN CONCAT('R', REGEXP_SUBSTR(p.pack, '[0-9]+'))
              WHEN REGEXP_SUBSTR(p.pack, '[0-9]+') IS NOT NULL THEN CONCAT('M', REGEXP_SUBSTR(p.pack, '[0-9]+'))
              WHEN p.pack LIKE 'Packet%' THEN 'PKT'
              ELSE 'BOX' END),
       p.product_id, p.pack, 'demo-seed'
  FROM products p;

-- DEMO selling rules: packs per carton by category; single toilet rolls and hand / centre-pull rolls in full cartons only
UPDATE skus s JOIN products p ON p.product_id = s.product_id
   SET s.packs_per_carton = CASE p.category_key WHEN 'napkins' THEN IF(s.product_id = 'DZIND-DF013', 12, 24) WHEN 'facial' THEN IF(s.product_id = 'DZIND-DF035', 24, 36)
                                                WHEN 'kitchen' THEN 24 WHEN 'towels' THEN 20 WHEN 'wipes' THEN 12 ELSE 12 END,
       s.sell_unit = 'both', s.min_order_qty = 1;
UPDATE skus SET packs_per_carton = 48, sell_unit = 'carton', min_order_qty = 48 WHERE product_id = 'DZIND-DF016';
UPDATE skus SET packs_per_carton = 8 WHERE product_id = 'DZIND-DF018';
UPDATE skus SET packs_per_carton = 6 WHERE product_id = 'DZIND-DF019';
UPDATE skus SET packs_per_carton = 6, sell_unit = 'carton', min_order_qty = 6 WHERE product_id IN ('DZIND-DF023', 'DZIND-DF024');
UPDATE skus SET min_order_qty = 2 WHERE product_id = 'DZIND-DF044';

-- DEMO HSN codes by kind of product (to be confirmed by the accountant); GST stays at the 18 % default
UPDATE products SET hsn_code = '48183000' WHERE category_key = 'napkins';
UPDATE products SET hsn_code = '48182000' WHERE category_key IN ('facial', 'kitchen', 'towels');
UPDATE products SET hsn_code = '48181000' WHERE category_key = 'rolls';
UPDATE products SET hsn_code = '48182000' WHERE product_id IN ('DZIND-DF023', 'DZIND-DF024');
UPDATE products SET hsn_code = '33079090' WHERE category_key = 'wipes';

-- DEMO bin / shelf locations in the Kanchipuram godown (rack by product family, shelf by size)
UPDATE skus s JOIN products p ON p.product_id = s.product_id
   SET s.bin_location = CONCAT(CASE p.category_key WHEN 'napkins' THEN 'R1' WHEN 'facial' THEN 'R2' WHEN 'kitchen' THEN 'R3' WHEN 'rolls' THEN 'R4' WHEN 'towels' THEN 'R5' ELSE 'R6' END,
                               '-S', 1 + (CRC32(s.sku_code) % 4));

-- DEMO reorder levels and quantities (the stock itself comes from the seed's stock-ins: scripts/commerce-demo-seed.js)
INSERT IGNORE INTO stock_levels (sku_code, reorder_level, reorder_qty)
SELECT s.sku_code, CASE WHEN s.sku_code LIKE '%-R%' THEN 30 ELSE 20 END, s.packs_per_carton * 4 FROM skus s;

-- DEMO returned stock (R) kept apart from good stock
INSERT INTO stock_movements (sku_code, move_type, stock_kind, delta, ref_type, note, emp_id, created_at) VALUES
  ('DF037-M150', 'return', 'returned', 4, 'return', 'DEMO return from Demo Hotel Sangam - unopened', 'DZIND148', UTC_TIMESTAMP() - INTERVAL 5 HOUR),
  ('DF001-M100', 'return', 'returned', 2, 'return', 'DEMO return from Demo Cafe Thendral - wrong size', 'DZIND148', UTC_TIMESTAMP() - INTERVAL 4 HOUR);

-- coupons, offers, cashback rules and wallets: phase 7 tables, filled by scripts/commerce-demo-seed.js
