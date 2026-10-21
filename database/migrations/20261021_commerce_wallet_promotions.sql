-- Commerce phase 7 (docs/COMMERCE-SPEC.md 3, 4.5, 4.8, 6.2): promotions and the wallet. Structure and defaults only:
-- no coupons, offers, cashback rules or wallet entries (the demo ones come from scripts/commerce-demo-seed.js).
-- - coupons: percent / fixed / free delivery, minimum order, maximum discount, valid from / to, total uses and uses
--   per customer, scope rows (customer types, specific customers, SKUs or categories included / excluded), on / off.
--   One coupon per order; coupon_redemptions is the usage list.
-- - offers (no code, applied automatically): quantity slabs (from N packs or cartons = n % off the line) and buy X get
--   Y free (a free line at Rs 0 that takes stock like any line), per customer type, with dates.
-- - cashback_rules: percent per customer type, minimum order, maximum per order, dates, on / off. Credited on delivery
--   or once the return window has passed (setting); a later return takes the matching cashback back.
-- - wallet_entries: every credit and debit with its source (cashback, refund, manual, used, expired, reversed); a
--   credit keeps what is left of it (remaining) and its expiry (days per source, setting); wallet_allocations says
--   which credits each use or debit took, oldest first, so a cancelled order gives back exactly those.
-- customer_id has no foreign key yet: the customers table arrives with the CRM phase (8).
USE dfresh;

CREATE TABLE IF NOT EXISTS coupons (
  code                VARCHAR(20)   NOT NULL,
  description         VARCHAR(200)  NULL,
  kind                VARCHAR(14)   NOT NULL,                   -- percent | fixed | free_delivery
  value               DECIMAL(10,2) NOT NULL DEFAULT 0,         -- percent, or Rs for fixed; 0 for free delivery
  min_order           DECIMAL(10,2) NOT NULL DEFAULT 0,         -- goods value of the order before the coupon
  max_discount        DECIMAL(10,2) NULL,                       -- cap (percent coupons); NULL = no cap
  valid_from          DATE          NULL,
  valid_to            DATE          NULL,
  total_limit         INT           NULL,                       -- uses in all; NULL = no limit
  per_customer_limit  INT           NULL,                       -- uses per customer; NULL = no limit
  is_active           TINYINT(1)    NOT NULL DEFAULT 1,
  created_by          VARCHAR(20)   NOT NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by          VARCHAR(20)   NULL,
  updated_at          DATETIME      NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- who may use it (type / customer rows: either list matches; none = everyone) and on what (include rows: only those
-- SKUs or categories get the discount; exclude rows: never those)
CREATE TABLE IF NOT EXISTS coupon_scope (
  id            BIGINT       NOT NULL AUTO_INCREMENT,
  code          VARCHAR(20)  NOT NULL,
  scope         VARCHAR(10)  NOT NULL,                         -- type | customer | include | exclude
  type_key      VARCHAR(20)  NULL,
  customer_id   INT          NULL,
  sku_code      VARCHAR(30)  NULL,
  category_key  VARCHAR(40)  NULL,
  PRIMARY KEY (id),
  KEY idx_cscope_code (code, scope),
  CONSTRAINT fk_cscope_coupon FOREIGN KEY (code) REFERENCES coupons (code) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  code         VARCHAR(20)   NOT NULL,
  order_id     BIGINT        NOT NULL,
  customer_id  INT           NOT NULL,
  amount       DECIMAL(12,2) NOT NULL,                         -- discount given (or the delivery charge waived)
  status       VARCHAR(10)   NOT NULL DEFAULT 'active',        -- active | released (order cancelled or coupon removed)
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  released_at  DATETIME      NULL,
  PRIMARY KEY (id),
  KEY idx_redeem_code (code, status),
  KEY idx_redeem_customer (customer_id, code),
  KEY idx_redeem_order (order_id),
  CONSTRAINT fk_redeem_coupon FOREIGN KEY (code) REFERENCES coupons (code),
  CONSTRAINT fk_redeem_order FOREIGN KEY (order_id) REFERENCES orders (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS offers (
  offer_id      INT           NOT NULL AUTO_INCREMENT,
  name          VARCHAR(120)  NOT NULL,
  kind          VARCHAR(10)   NOT NULL,                        -- slab | bxgy
  sku_code      VARCHAR(30)   NULL,                            -- the SKU it is on, or
  category_key  VARCHAR(40)   NULL,                            -- every SKU of a category
  min_qty       INT           NOT NULL DEFAULT 1,              -- slab: from this quantity
  min_unit      VARCHAR(10)   NOT NULL DEFAULT 'pack',         -- pack | carton
  pct           DECIMAL(5,2)  NOT NULL DEFAULT 0,              -- slab: % off the line
  buy_qty       INT           NOT NULL DEFAULT 0,              -- bxgy: for every buy_qty packs ...
  get_qty       INT           NOT NULL DEFAULT 0,              -- ... get_qty packs free
  get_sku_code  VARCHAR(30)   NULL,                            -- bxgy: the free SKU (NULL = the same SKU)
  valid_from    DATE          NULL,
  valid_to      DATE          NULL,
  is_active     TINYINT(1)    NOT NULL DEFAULT 1,
  created_by    VARCHAR(20)   NOT NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by    VARCHAR(20)   NULL,
  updated_at    DATETIME      NULL,
  PRIMARY KEY (offer_id),
  KEY idx_offer_active (is_active, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS offer_customer_types (            -- no rows = every customer type
  offer_id  INT          NOT NULL,
  type_key  VARCHAR(20)  NOT NULL,
  PRIMARY KEY (offer_id, type_key),
  CONSTRAINT fk_otype_offer FOREIGN KEY (offer_id) REFERENCES offers (offer_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cashback_rules (
  rule_id        INT           NOT NULL AUTO_INCREMENT,
  name           VARCHAR(120)  NOT NULL,
  type_key       VARCHAR(20)   NULL,                           -- NULL = every customer type
  pct            DECIMAL(5,2)  NOT NULL,
  min_order      DECIMAL(10,2) NOT NULL DEFAULT 0,             -- goods value (before GST) after discounts and returns
  max_per_order  DECIMAL(10,2) NULL,
  valid_from     DATE          NULL,
  valid_to       DATE          NULL,
  is_active      TINYINT(1)    NOT NULL DEFAULT 1,
  created_by     VARCHAR(20)   NOT NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by     VARCHAR(20)   NULL,
  updated_at     DATETIME      NULL,
  PRIMARY KEY (rule_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_entries (
  entry_id     BIGINT        NOT NULL AUTO_INCREMENT,
  customer_id  INT           NOT NULL,
  source       VARCHAR(10)   NOT NULL,                         -- cashback | refund | manual | used | expired | reversed
  amount       DECIMAL(12,2) NOT NULL,                         -- + credit, - debit
  remaining    DECIMAL(12,2) NULL,                             -- credits: what is left to use (oldest first)
  expires_on   DATE          NULL,                             -- credits: NULL = never
  reason       VARCHAR(200)  NOT NULL,
  order_id     BIGINT        NULL,
  return_id    BIGINT        NULL,
  approval_id  BIGINT        NULL,
  emp_id       VARCHAR(20)   NOT NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (entry_id),
  KEY idx_wallet_customer (customer_id, entry_id),
  KEY idx_wallet_expiry (expires_on, remaining),
  KEY idx_wallet_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS wallet_allocations (
  id               BIGINT        NOT NULL AUTO_INCREMENT,
  debit_entry_id   BIGINT        NOT NULL,                     -- a use on an order, a reversal, a manual debit
  credit_entry_id  BIGINT        NOT NULL,                     -- the credit it took from
  amount           DECIMAL(12,2) NOT NULL,
  given_back       TINYINT(1)    NOT NULL DEFAULT 0,           -- the order was cancelled or edited: back on the credit
  PRIMARY KEY (id),
  KEY idx_walloc_debit (debit_entry_id),
  KEY idx_walloc_credit (credit_entry_id),
  CONSTRAINT fk_walloc_debit FOREIGN KEY (debit_entry_id) REFERENCES wallet_entries (entry_id),
  CONSTRAINT fk_walloc_credit FOREIGN KEY (credit_entry_id) REFERENCES wallet_entries (entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- orders: the discounts one by one, the wallet split (GST setting at the time), cashback
ALTER TABLE orders
  ADD COLUMN offer_discount          DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER discount,   -- automatic offers (slabs)
  ADD COLUMN manual_discount         DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER offer_discount,
  ADD COLUMN manual_discount_reason  VARCHAR(255)  NULL AFTER manual_discount,
  ADD COLUMN delivery_waived         DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER delivery_gst, -- free-delivery coupon
  ADD COLUMN wallet_discount         DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER wallet_used,  -- part of wallet_used that lowered the taxable value
  ADD COLUMN wallet_gst              VARCHAR(10)   NULL AFTER wallet_discount,            -- discount | payment (setting when the wallet was used)
  ADD COLUMN cashback_base           DECIMAL(12,2) NULL,                                  -- goods value the cashback was worked out on
  ADD COLUMN cashback_amount         DECIMAL(12,2) NULL,                                  -- NULL = not worked out yet; 0 = none due
  ADD COLUMN cashback_at             DATETIME      NULL;
-- discounts per line (coupon_discount = coupon + manual share); a free line (buy X get Y) may repeat a SKU
ALTER TABLE order_items
  ADD COLUMN is_free          TINYINT(1)    NOT NULL DEFAULT 0 AFTER sku_code,
  ADD COLUMN offer_id         INT           NULL AFTER list_price,
  ADD COLUMN offer_discount   DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER offer_id,
  ADD COLUMN coupon_discount  DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER offer_discount,
  ADD COLUMN wallet_discount  DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER coupon_discount,
  DROP INDEX uq_order_sku,
  ADD UNIQUE KEY uq_order_sku (order_id, sku_code, is_free);
ALTER TABLE returns ADD COLUMN cashback_reversed DECIMAL(12,2) NOT NULL DEFAULT 0;

INSERT IGNORE INTO commerce_settings (setting_key, grp, label, help, value, value_type, options, tbc, sort_order) VALUES
  ('offers_with_coupon', 'Promotions', 'Offers and a coupon can combine', 'Off: an order with an automatic offer (quantity slab, buy X get Y) cannot take a coupon.', '0', 'bool', NULL, 0, 10),
  ('cashback_credit_at', 'Promotions', 'Credit cashback', 'After the return window: a return never leaves extra cashback. On delivery: a later return takes it back.', 'after_window', 'select', '[["after_window","once the return window has passed after delivery"],["delivery","on delivery"]]', 0, 20),
  ('wallet_max_use_pct', 'Promotions', 'Wallet use per order, at most (% of the order)', '100 = the whole order may be paid from the wallet.', '50', 'int', NULL, 0, 30),
  ('wallet_expiry_cashback_days', 'Promotions', 'Cashback in the wallet expires after (days)', '0 = never.', '365', 'int', NULL, 0, 40),
  ('wallet_expiry_manual_days', 'Promotions', 'Manual wallet credit expires after (days)', '0 = never.', '365', 'int', NULL, 0, 50),
  ('wallet_expiry_refund_days', 'Promotions', 'Refunds to the wallet expire after (days)', '0 = never (the customer''s own money).', '0', 'int', NULL, 0, 60);
UPDATE commerce_settings SET label = 'Discounts on an order need approval', help = 'Offers + coupon + manual discount together, as a % of the goods value.' WHERE setting_key = 'approve_discount_on';
UPDATE commerce_settings SET label = 'Total discount above (% of the goods value)' WHERE setting_key = 'approve_discount_pct_above';
UPDATE commerce_settings SET label = 'Manual wallet credit or debit needs approval' WHERE setting_key = 'approve_goodwill_credit';
UPDATE commerce_settings SET help = 'Discount (default): wallet credit from cashback or manual credit used on an order lowers its taxable value. Payment method: the wallet counts as a payment and the taxable value stays. A refund to the wallet is always a payment method. To be confirmed by sir with the accountant.' WHERE setting_key = 'cashback_gst_treatment';
