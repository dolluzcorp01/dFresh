-- dFresh Commerce (DEMO, database dfresh_commerce only): module A, orders entered in the ADMIN (phone / WhatsApp /
-- B2B). Prices exist only here (sku_prices, admin only, never on the public site). Also the tables orders need:
-- customers (module C screen later), coupons (module D screen later), wallet entries. Order number DFO-YYnnnn
-- (order_counters, India year). Dispatched takes stock out through stock_movements. Demo rows: scripts/commerce-seed.js.
USE dfresh_commerce;

CREATE TABLE IF NOT EXISTS sku_prices (
  sku_code  VARCHAR(30)   NOT NULL,
  price     DECIMAL(10,2) NOT NULL,                -- per pack, before GST
  gst_rate  DECIMAL(5,2)  NOT NULL DEFAULT 18.00,  -- tissue paper HSN 4818
  PRIMARY KEY (sku_code),
  CONSTRAINT fk_price_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  customer_id  INT          NOT NULL AUTO_INCREMENT,
  name         VARCHAR(120) NOT NULL,
  phone        VARCHAR(20)  NOT NULL,
  email        VARCHAR(150) NULL,
  ctype        VARCHAR(20)  NOT NULL DEFAULT 'Home',   -- Home | Hotel | Hospital | Office | Distributor
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
  kind         VARCHAR(10)   NOT NULL,              -- percent | fixed
  value        DECIMAL(10,2) NOT NULL,
  min_order    DECIMAL(10,2) NOT NULL DEFAULT 0,
  expires_on   DATE          NULL,
  usage_limit  INT           NULL,
  used         INT           NOT NULL DEFAULT 0,
  is_active    TINYINT(1)    NOT NULL DEFAULT 1,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_counters (
  yr       SMALLINT NOT NULL,
  last_no  INT      NOT NULL,
  PRIMARY KEY (yr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  order_id       BIGINT        NOT NULL AUTO_INCREMENT,
  order_no       VARCHAR(20)   NOT NULL,
  customer_id    INT           NOT NULL,
  status         VARCHAR(12)   NOT NULL DEFAULT 'new',  -- new | packed | dispatched | delivered
  payment        VARCHAR(20)   NOT NULL,                -- cod | razorpay | bank
  coupon_code    VARCHAR(20)   NULL,
  subtotal       DECIMAL(12,2) NOT NULL,
  discount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  gst            DECIMAL(12,2) NOT NULL,
  wallet_used    DECIMAL(12,2) NOT NULL DEFAULT 0,
  total          DECIMAL(12,2) NOT NULL,
  note           VARCHAR(255)  NULL,
  emp_id         VARCHAR(20)   NOT NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  packed_at      DATETIME      NULL,
  dispatched_at  DATETIME      NULL,
  delivered_at   DATETIME      NULL,
  PRIMARY KEY (order_id),
  UNIQUE KEY uq_order_no (order_no),
  KEY idx_order_status (status, created_at),
  CONSTRAINT fk_order_customer FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_items (
  order_id  BIGINT        NOT NULL,
  sku_code  VARCHAR(30)   NOT NULL,
  qty       INT           NOT NULL,
  price     DECIMAL(10,2) NOT NULL,
  gst_rate  DECIMAL(5,2)  NOT NULL,
  PRIMARY KEY (order_id, sku_code),
  CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES orders (order_id) ON DELETE CASCADE,
  CONSTRAINT fk_item_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_entries (
  entry_id     BIGINT        NOT NULL AUTO_INCREMENT,
  customer_id  INT           NOT NULL,
  amount       DECIMAL(10,2) NOT NULL,              -- + credit (cashback, refund), - used on an order
  reason       VARCHAR(160)  NOT NULL,
  order_id     BIGINT        NULL,
  emp_id       VARCHAR(20)   NOT NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entry_id),
  KEY idx_wallet_customer (customer_id),
  CONSTRAINT fk_wallet_customer FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- DEMO prices: 40 to 440 per pack, rounded to 5 (the same on every run)
INSERT IGNORE INTO sku_prices (sku_code, price)
SELECT sku_code, 40 + ROUND((CRC32(CONCAT(sku_code, 'price')) % 401) / 5) * 5 FROM skus;

INSERT IGNORE INTO coupons (code, kind, value, min_order, expires_on, usage_limit, is_active) VALUES
  ('WELCOME10', 'percent', 10, 500, '2026-12-31', 100, 1),
  ('HOTEL500', 'fixed', 500, 5000, '2026-12-31', 20, 1),
  ('FRESH5', 'percent', 5, 0, '2026-11-30', NULL, 1);
