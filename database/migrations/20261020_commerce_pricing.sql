-- Commerce phase 2 (docs/COMMERCE-SPEC.md 4.3): products and prices. Structure and defaults only, no prices.
-- products: + HSN code and GST rate (per product, for every size of it).
-- skus: one per product and pack size, with carton size, minimum order and how it is sold (pack / carton / both).
-- sku_prices: one row per SKU, price list and "effective from" date. A price list is 'default' or a customer type
--   key (Commerce settings > Customer types). The price on a day = the row with the latest effective_from on or
--   before that day; no row, or a row with price NULL (removed), on a customer type's list = the Default list's price.
-- price_changes: the history (old -> new, who, when, effective from, how: grid / bulk / import / seed).
-- Whether prices include GST is the Commerce setting prices_include_gst.
USE dfresh;

ALTER TABLE products
  ADD COLUMN hsn_code VARCHAR(8) NOT NULL DEFAULT '4818' AFTER pack,
  ADD COLUMN gst_rate DECIMAL(5,2) NOT NULL DEFAULT 18.00 AFTER hsn_code;

CREATE TABLE IF NOT EXISTS skus (
  sku_code          VARCHAR(30)  NOT NULL,
  product_id        VARCHAR(30)  NOT NULL,
  size_label        VARCHAR(120) NOT NULL,
  packs_per_carton  INT          NOT NULL DEFAULT 1,
  min_order_qty     INT          NOT NULL DEFAULT 1,          -- in packs
  sell_unit         VARCHAR(10)  NOT NULL DEFAULT 'pack',     -- pack | carton | both
  is_active         TINYINT(1)   NOT NULL DEFAULT 1,
  created_by        VARCHAR(20)  NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by        VARCHAR(20)  NULL,
  updated_at        DATETIME     NULL,
  PRIMARY KEY (sku_code),
  KEY idx_sku_product (product_id),
  CONSTRAINT fk_sku_product FOREIGN KEY (product_id) REFERENCES products (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sku_prices (
  sku_code        VARCHAR(30)   NOT NULL,
  list_key        VARCHAR(20)   NOT NULL,                     -- 'default' or a customer_types.type_key
  effective_from  DATE          NOT NULL,                     -- India date
  price           DECIMAL(10,2) NULL,                         -- NULL = no own price from that day (Default applies)
  created_by      VARCHAR(20)   NOT NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (sku_code, list_key, effective_from),
  CONSTRAINT fk_skuprice_sku FOREIGN KEY (sku_code) REFERENCES skus (sku_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS price_changes (
  change_id       BIGINT        NOT NULL AUTO_INCREMENT,
  sku_code        VARCHAR(30)   NOT NULL,
  list_key        VARCHAR(20)   NOT NULL,
  old_price       DECIMAL(10,2) NULL,                         -- the price that applied on effective_from before this change
  new_price       DECIMAL(10,2) NULL,                         -- NULL = own price removed
  effective_from  DATE          NOT NULL,
  source          VARCHAR(10)   NOT NULL,                     -- grid | bulk | import | seed
  emp_id          VARCHAR(20)   NOT NULL,
  changed_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (change_id),
  KEY idx_pricechange_sku (sku_code, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
