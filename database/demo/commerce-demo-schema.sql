-- dFresh Commerce DEMO tables - NOT a migration, never applied to dfresh or live.
-- The interim tables of the 20 Oct 2026 demo (orders, stock, returns, customers, coupons ...), used by the demo screens
-- until phases 2-8 replace them with the spec's data model (docs/COMMERCE-SPEC.md 4). Created only in dfresh_commerce
-- by scripts/commerce-demo-seed.js, which refuses any other database. Taken from the demo's commerce_0x migrations
-- (tag demo-2026-10-20), structure only.


-- skus, sku_prices and price_changes come from the migration 20261020_commerce_pricing.sql (phase 2); orders,
-- order_items, payments, invoices, credit notes and stock reservations from 20261020_commerce_sales.sql (phase 3).


-- from commerce_02_inventory.sql

CREATE TABLE IF NOT EXISTS stock_levels (
  sku_code   VARCHAR(30) NOT NULL,
  low_level  INT         NOT NULL DEFAULT 20,
  PRIMARY KEY (sku_code),
  CONSTRAINT fk_level_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_movements (
  move_id     BIGINT       NOT NULL AUTO_INCREMENT,
  sku_code    VARCHAR(30)  NOT NULL,
  move_type   VARCHAR(10)  NOT NULL,              
  stock_kind  VARCHAR(10)  NOT NULL,              
  delta       INT          NOT NULL,              
  note        VARCHAR(255) NULL,
  emp_id      VARCHAR(20)  NOT NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (move_id),
  KEY idx_move_sku (sku_code, created_at),
  CONSTRAINT fk_move_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



-- from commerce_03_orders.sql

CREATE TABLE IF NOT EXISTS customers (
  customer_id  INT          NOT NULL AUTO_INCREMENT,
  name         VARCHAR(120) NOT NULL,
  phone        VARCHAR(20)  NOT NULL,
  email        VARCHAR(150) NULL,
  ctype        VARCHAR(20)  NOT NULL DEFAULT 'Home',   
  town         VARCHAR(80)  NULL,
  address      VARCHAR(255) NULL,
  gstin        VARCHAR(20)  NULL,
  notes        TEXT         NULL,
  follow_up    DATE         NULL,
  lead_id      BIGINT       NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupons (
  code         VARCHAR(20)   NOT NULL,
  kind         VARCHAR(10)   NOT NULL,              
  value        DECIMAL(10,2) NOT NULL,
  min_order    DECIMAL(10,2) NOT NULL DEFAULT 0,
  expires_on   DATE          NULL,
  usage_limit  INT           NULL,
  used         INT           NOT NULL DEFAULT 0,
  is_active    TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_entries (
  entry_id     BIGINT        NOT NULL AUTO_INCREMENT,
  customer_id  INT           NOT NULL,
  amount       DECIMAL(10,2) NOT NULL,              
  reason       VARCHAR(160)  NOT NULL,
  order_id     BIGINT        NULL,
  emp_id       VARCHAR(20)   NOT NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entry_id),
  KEY idx_wallet_customer (customer_id),
  CONSTRAINT fk_wallet_customer FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



-- from commerce_04_returns.sql

CREATE TABLE IF NOT EXISTS return_counters (
  yr       SMALLINT NOT NULL,
  last_no  INT      NOT NULL,
  PRIMARY KEY (yr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS returns (
  return_id     BIGINT        NOT NULL AUTO_INCREMENT,
  return_no     VARCHAR(20)   NOT NULL,
  order_id      BIGINT        NOT NULL,
  reason        VARCHAR(255)  NOT NULL,
  outcome       VARCHAR(20)   NOT NULL,              
  amount        DECIMAL(12,2) NOT NULL,              
  replacement_order_id BIGINT NULL,
  emp_id        VARCHAR(20)   NOT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (return_id),
  UNIQUE KEY uq_return_no (return_no),
  KEY idx_return_order (order_id),
  CONSTRAINT fk_return_order FOREIGN KEY (order_id) REFERENCES orders (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS return_items (
  return_id  BIGINT       NOT NULL,
  sku_code   VARCHAR(30)  NOT NULL,
  qty        INT          NOT NULL,
  item_check VARCHAR(10)  NOT NULL,                  
  PRIMARY KEY (return_id, sku_code, item_check),
  CONSTRAINT fk_ritem_return FOREIGN KEY (return_id) REFERENCES returns (return_id) ON DELETE CASCADE,
  CONSTRAINT fk_ritem_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



-- from commerce_05_promotions.sql

CREATE TABLE IF NOT EXISTS cashback_rule (
  rule_id    TINYINT       NOT NULL,
  pct        DECIMAL(5,2)  NOT NULL,
  min_order  DECIMAL(10,2) NOT NULL DEFAULT 0,
  is_active  TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (rule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;



-- from commerce_06_customer_source.sql

ALTER TABLE customers
  ADD COLUMN business_name VARCHAR(150) NULL AFTER name,
  ADD COLUMN source VARCHAR(20) NULL AFTER lead_id;

-- phase 3 (until phase 8 rebuilds customers): state for the GST type, PIN code, credit terms
ALTER TABLE customers
  ADD COLUMN state_code CHAR(2) NOT NULL DEFAULT '33' AFTER town,
  ADD COLUMN pincode VARCHAR(6) NULL AFTER state_code,
  ADD COLUMN credit_days INT NOT NULL DEFAULT 0 AFTER gstin,
  ADD COLUMN credit_limit DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER credit_days;

