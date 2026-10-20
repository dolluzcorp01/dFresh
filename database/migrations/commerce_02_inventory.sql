-- dFresh Commerce (DEMO, database dfresh_commerce only): module 2, inventory. One location (Kanchipuram godown).
-- Stock is never typed in: it is the sum of the movements, per SKU and kind (good / returned (R) / damaged), so every
-- number has a who and a when. in = good +, out = good -, adjust = good +/- (a count correction), return = returned +,
-- damaged = good - and damaged + (two rows). low_level: below it the SKU shows a red "Low" badge.
-- Demo movements below (times in UTC, like every dFresh DATETIME): opening stock for every SKU, some sales, a few SKUs
-- run low, two returns, one damaged.
USE dfresh_commerce;

CREATE TABLE IF NOT EXISTS stock_levels (
  sku_code   VARCHAR(30) NOT NULL,
  low_level  INT         NOT NULL DEFAULT 20,
  PRIMARY KEY (sku_code),
  CONSTRAINT fk_level_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
  move_id     BIGINT       NOT NULL AUTO_INCREMENT,
  sku_code    VARCHAR(30)  NOT NULL,
  move_type   VARCHAR(10)  NOT NULL,              -- in | out | adjust | return | damaged
  stock_kind  VARCHAR(10)  NOT NULL,              -- good | returned | damaged
  delta       INT          NOT NULL,              -- signed change of that kind's stock
  note        VARCHAR(255) NULL,
  emp_id      VARCHAR(20)  NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (move_id),
  KEY idx_move_sku (sku_code, created_at),
  CONSTRAINT fk_move_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO stock_levels (sku_code, low_level)
SELECT sku_code, CASE WHEN sku_code LIKE '%-R%' THEN 30 ELSE 20 END FROM skus;

-- demo movements only once
SET @have = (SELECT COUNT(*) FROM stock_movements);

-- opening stock: 60 to 300 per SKU (from the SKU code, so it is the same on every run)
INSERT INTO stock_movements (sku_code, move_type, stock_kind, delta, note, emp_id, created_at)
SELECT sku_code, 'in', 'good', 60 + (CRC32(sku_code) % 241), 'DEMO opening stock - Kanchipuram godown', 'DZIND148', UTC_TIMESTAMP() - INTERVAL 6 DAY
  FROM skus WHERE @have = 0;

-- sales over the week: 10 to 40 out per SKU
INSERT INTO stock_movements (sku_code, move_type, stock_kind, delta, note, emp_id, created_at)
SELECT sku_code, 'out', 'good', -(10 + (CRC32(CONCAT(sku_code, 'out')) % 31)), 'DEMO dispatch to customers', 'DZIND002', UTC_TIMESTAMP() - INTERVAL 3 DAY
  FROM skus WHERE @have = 0;

-- three SKUs run low (below their level after this)
INSERT INTO stock_movements (sku_code, move_type, stock_kind, delta, note, emp_id, created_at)
SELECT s.sku_code, 'out', 'good', -(t.good - 8), 'DEMO big hotel order', 'DZIND002', UTC_TIMESTAMP() - INTERVAL 20 HOUR
  FROM skus s JOIN (SELECT sku_code, SUM(delta) good FROM stock_movements WHERE stock_kind = 'good' GROUP BY sku_code) t ON t.sku_code = s.sku_code
 WHERE @have = 0 AND s.sku_code IN ('DF037-M150', 'DF017-R4', 'DF028-M100');

-- two customer returns (good condition -> Returned (R) stock) and one damaged carton
INSERT INTO stock_movements (sku_code, move_type, stock_kind, delta, note, emp_id, created_at)
SELECT 'DF037-M150', 'return', 'returned', 4, 'DEMO return from Demo Hotel Sangam - unopened', 'DZIND148', UTC_TIMESTAMP() - INTERVAL 5 HOUR FROM DUAL WHERE @have = 0
UNION ALL SELECT 'DF001-M100', 'return', 'returned', 2, 'DEMO return from Demo Cafe Thendral - wrong size', 'DZIND148', UTC_TIMESTAMP() - INTERVAL 4 HOUR FROM DUAL WHERE @have = 0
UNION ALL SELECT 'DF019-R10', 'damaged', 'good', -3, 'DEMO carton crushed in the godown', 'DZIND002', UTC_TIMESTAMP() - INTERVAL 2 HOUR FROM DUAL WHERE @have = 0
UNION ALL SELECT 'DF019-R10', 'damaged', 'damaged', 3, 'DEMO carton crushed in the godown', 'DZIND002', UTC_TIMESTAMP() - INTERVAL 2 HOUR FROM DUAL WHERE @have = 0;
