-- Commerce phase 4 (docs/COMMERCE-SPEC.md 4.4): inventory. Structure and defaults only, no stock.
-- (Named "stock" so it runs after 20261020_commerce_pricing.sql and _sales.sql, whose skus table it refers to.)
-- - stock_movements: every change of stock, never typed in: stock on hand = SUM(delta) per SKU, kind (good /
--   returned / damaged) and batch. move_type: production, purchase (stock in), out (dispatch), return (back in),
--   damaged (good -> damaged), write_off, count (approved count difference). ref_type / ref_id: stock_in, order,
--   write_off, count, return. unit_cost: the cost per pack of a stock in.
-- - batches (products.track_batches on): batch no., manufacture and expiry date; dispatch takes the earliest expiry
--   first (FEFO); expired stock cannot be ordered. Default on for wet wipes, off for paper.
-- - skus.avg_cost: weighted average cost per pack, updated by every stock in (stock value = good on hand x avg_cost).
-- - stock_levels: reorder level (below it the SKU is "low") and reorder quantity per SKU.
-- - write_offs: damaged / expired / lost / sample, above the Commerce setting thresholds through an approval.
-- - stock_counts: a count of all SKUs or a category; differences go to approval and post as count movements.
USE dfresh;

ALTER TABLE products ADD COLUMN track_batches TINYINT(1) NOT NULL DEFAULT 0 AFTER gst_rate;
UPDATE products SET track_batches = 1 WHERE category_key = 'wipes';
ALTER TABLE skus ADD COLUMN avg_cost DECIMAL(10,2) NULL AFTER sell_unit;

CREATE TABLE IF NOT EXISTS suppliers (
  supplier_id  INT          NOT NULL AUTO_INCREMENT,
  name         VARCHAR(150) NOT NULL,
  phone        VARCHAR(20)  NULL,
  gstin        VARCHAR(15)  NULL,
  address      VARCHAR(255) NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_by   VARCHAR(20)  NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS batches (
  batch_id     BIGINT       NOT NULL AUTO_INCREMENT,
  sku_code     VARCHAR(30)  NOT NULL,
  batch_no     VARCHAR(30)  NOT NULL,
  mfg_date     DATE         NOT NULL,
  expiry_date  DATE         NOT NULL,
  created_by   VARCHAR(20)  NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (batch_id),
  UNIQUE KEY uq_batch (sku_code, batch_no),
  KEY idx_batch_expiry (expiry_date),
  CONSTRAINT fk_batch_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_ins (
  stock_in_id  BIGINT       NOT NULL AUTO_INCREMENT,
  kind         VARCHAR(10)  NOT NULL,                       -- production | purchase
  supplier_id  INT          NULL,                           -- purchase only
  received_on  DATE         NOT NULL,
  reference    VARCHAR(60)  NULL,                           -- bill no. / batch sheet no.
  note         VARCHAR(255) NULL,
  emp_id       VARCHAR(20)  NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (stock_in_id),
  KEY idx_stockin_day (received_on),
  CONSTRAINT fk_stockin_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_in_lines (
  line_id      BIGINT        NOT NULL AUTO_INCREMENT,
  stock_in_id  BIGINT        NOT NULL,
  sku_code     VARCHAR(30)   NOT NULL,
  qty          INT           NOT NULL,                      -- packs
  unit_cost    DECIMAL(10,2) NOT NULL,                      -- per pack
  batch_id     BIGINT        NULL,
  avg_before   DECIMAL(10,2) NULL,
  avg_after    DECIMAL(10,2) NULL,
  PRIMARY KEY (line_id),
  KEY idx_stockin_line (stock_in_id),
  CONSTRAINT fk_stockinline_in FOREIGN KEY (stock_in_id) REFERENCES stock_ins (stock_in_id),
  CONSTRAINT fk_stockinline_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code),
  CONSTRAINT fk_stockinline_batch FOREIGN KEY (batch_id) REFERENCES batches (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
  move_id      BIGINT        NOT NULL AUTO_INCREMENT,
  sku_code     VARCHAR(30)   NOT NULL,
  location_id  INT           NOT NULL DEFAULT 1,
  stock_kind   VARCHAR(10)   NOT NULL,                      -- good | returned | damaged
  move_type    VARCHAR(12)   NOT NULL,
  delta        INT           NOT NULL,
  batch_id     BIGINT        NULL,
  unit_cost    DECIMAL(10,2) NULL,
  ref_type     VARCHAR(10)   NULL,
  ref_id       VARCHAR(30)   NULL,
  note         VARCHAR(255)  NULL,
  emp_id       VARCHAR(20)   NOT NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (move_id),
  KEY idx_move_sku (sku_code, stock_kind, batch_id),
  KEY idx_move_ref (ref_type, ref_id),
  KEY idx_move_day (created_at),
  CONSTRAINT fk_move_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code),
  CONSTRAINT fk_move_batch FOREIGN KEY (batch_id) REFERENCES batches (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_levels (
  sku_code       VARCHAR(30) NOT NULL,
  location_id    INT         NOT NULL DEFAULT 1,
  reorder_level  INT         NOT NULL,
  reorder_qty    INT         NOT NULL DEFAULT 0,             -- 0 = suggest from the level
  updated_by     VARCHAR(20) NULL,
  updated_at     DATETIME    NULL,
  PRIMARY KEY (sku_code, location_id),
  CONSTRAINT fk_level_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS write_offs (
  write_off_id  BIGINT        NOT NULL AUTO_INCREMENT,
  sku_code      VARCHAR(30)   NOT NULL,
  stock_kind    VARCHAR(10)   NOT NULL,                     -- good | damaged | returned: where the packs leave from
  batch_id      BIGINT        NULL,
  qty           INT           NOT NULL,
  reason_type   VARCHAR(10)   NOT NULL,                     -- damaged | expired | lost | sample
  reason        VARCHAR(255)  NOT NULL,
  value         DECIMAL(12,2) NULL,                         -- qty x average cost when requested
  photo         MEDIUMBLOB    NULL,                         -- internal, shown only in the admin
  photo_type    VARCHAR(30)   NULL,
  status        VARCHAR(10)   NOT NULL,                     -- pending | posted | rejected
  approval_id   BIGINT        NULL,
  emp_id        VARCHAR(20)   NOT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  posted_at     DATETIME      NULL,
  PRIMARY KEY (write_off_id),
  KEY idx_writeoff_status (status),
  CONSTRAINT fk_writeoff_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code),
  CONSTRAINT fk_writeoff_batch FOREIGN KEY (batch_id) REFERENCES batches (batch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_counts (
  count_id      BIGINT       NOT NULL AUTO_INCREMENT,
  scope         VARCHAR(30)  NOT NULL,                      -- 'all' or a category key
  status        VARCHAR(10)  NOT NULL DEFAULT 'open',       -- open | pending (approval) | posted | rejected | closed (no difference)
  note          VARCHAR(255) NULL,
  approval_id   BIGINT       NULL,
  started_by    VARCHAR(20)  NOT NULL,
  started_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_by  VARCHAR(20)  NULL,
  submitted_at  DATETIME     NULL,
  closed_at     DATETIME     NULL,
  PRIMARY KEY (count_id),
  KEY idx_count_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_count_lines (
  line_id     BIGINT       NOT NULL AUTO_INCREMENT,
  count_id    BIGINT       NOT NULL,
  sku_code    VARCHAR(30)  NOT NULL,
  batch_id    BIGINT       NULL,                            -- batch-tracked SKUs are counted per batch
  expected    INT          NULL,                            -- good stock when the count was submitted
  counted     INT          NULL,                            -- NULL = not counted (left out)
  counted_by  VARCHAR(20)  NULL,
  counted_at  DATETIME     NULL,
  PRIMARY KEY (line_id),
  UNIQUE KEY uq_count_line (count_id, sku_code, batch_id),
  CONSTRAINT fk_countline_count FOREIGN KEY (count_id) REFERENCES stock_counts (count_id),
  CONSTRAINT fk_countline_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
