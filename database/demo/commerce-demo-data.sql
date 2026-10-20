-- dFresh Commerce DEMO data (SQL part) - NOT a migration. Run only by scripts/commerce-demo-seed.js on dfresh_commerce,
-- after database/demo/commerce-demo-schema.sql: SKUs from the catalogue (with demo carton sizes, minimum orders and
-- HSN codes), demo stock week, the 3 demo coupons and the 5 % cashback rule. Prices, customers, orders, returns and
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

-- from commerce_02_inventory.sql

INSERT IGNORE INTO stock_levels (sku_code, low_level)
SELECT sku_code, CASE WHEN sku_code LIKE '%-R%' THEN 30 ELSE 20 END FROM skus;

SET @have = (SELECT COUNT(*) FROM stock_movements);

INSERT INTO stock_movements (sku_code, move_type, stock_kind, delta, note, emp_id, created_at)
SELECT sku_code, 'in', 'good', 60 + (CRC32(sku_code) % 241), 'DEMO opening stock - Kanchipuram godown', 'DZIND148', UTC_TIMESTAMP() - INTERVAL 6 DAY
  FROM skus WHERE @have = 0;

INSERT INTO stock_movements (sku_code, move_type, stock_kind, delta, note, emp_id, created_at)
SELECT sku_code, 'out', 'good', -(10 + (CRC32(CONCAT(sku_code, 'out')) % 31)), 'DEMO dispatch to customers', 'DZIND002', UTC_TIMESTAMP() - INTERVAL 3 DAY
  FROM skus WHERE @have = 0;

INSERT INTO stock_movements (sku_code, move_type, stock_kind, delta, note, emp_id, created_at)
SELECT s.sku_code, 'out', 'good', -(t.good - 8), 'DEMO big hotel order', 'DZIND002', UTC_TIMESTAMP() - INTERVAL 20 HOUR
  FROM skus s JOIN (SELECT sku_code, SUM(delta) good FROM stock_movements WHERE stock_kind = 'good' GROUP BY sku_code) t ON t.sku_code = s.sku_code
 WHERE @have = 0 AND s.sku_code IN ('DF037-M150', 'DF017-R4', 'DF028-M100');

INSERT INTO stock_movements (sku_code, move_type, stock_kind, delta, note, emp_id, created_at)
SELECT 'DF037-M150', 'return', 'returned', 4, 'DEMO return from Demo Hotel Sangam - unopened', 'DZIND148', UTC_TIMESTAMP() - INTERVAL 5 HOUR FROM DUAL WHERE @have = 0
UNION ALL SELECT 'DF001-M100', 'return', 'returned', 2, 'DEMO return from Demo Cafe Thendral - wrong size', 'DZIND148', UTC_TIMESTAMP() - INTERVAL 4 HOUR FROM DUAL WHERE @have = 0
UNION ALL SELECT 'DF019-R10', 'damaged', 'good', -3, 'DEMO carton crushed in the godown', 'DZIND002', UTC_TIMESTAMP() - INTERVAL 2 HOUR FROM DUAL WHERE @have = 0
UNION ALL SELECT 'DF019-R10', 'damaged', 'damaged', 3, 'DEMO carton crushed in the godown', 'DZIND002', UTC_TIMESTAMP() - INTERVAL 2 HOUR FROM DUAL WHERE @have = 0;

INSERT IGNORE INTO coupons (code, kind, value, min_order, expires_on, usage_limit, is_active) VALUES
  ('WELCOME10', 'percent', 10, 500, '2026-12-31', 100, 1),
  ('HOTEL500', 'fixed', 500, 5000, '2026-12-31', 20, 1),
  ('FRESH5', 'percent', 5, 0, '2026-11-30', NULL, 1);

-- from commerce_05_promotions.sql

INSERT IGNORE INTO cashback_rule (rule_id, pct, min_order, is_active) VALUES (1, 5, 0, 1);
