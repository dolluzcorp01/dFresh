-- dFresh Commerce DEMO tables - NOT a migration, never applied to dfresh or live.
-- The interim tables of the 20 Oct 2026 demo (orders, stock, returns, customers, coupons ...), used by the demo screens
-- until phases 2-8 replace them with the spec's data model (docs/COMMERCE-SPEC.md 4). Created only in dfresh_commerce
-- by scripts/commerce-demo-seed.js, which refuses any other database. Taken from the demo's commerce_0x migrations
-- (tag demo-2026-10-20), structure only.


-- skus, sku_prices and price_changes come from the migration 20261020_commerce_pricing.sql (phase 2); orders,
-- order_items, payments, invoices, credit notes and stock reservations from 20261020_commerce_sales.sql (phase 3);
-- stock movements, levels, batches, stock-ins, suppliers, write-offs and counts from 20261020_commerce_stock.sql (phase 4);
-- returns, refunds and credit note lines from 20261021_commerce_returns.sql (phase 6); coupons, offers, cashback rules
-- and the wallet from 20261021_commerce_wallet_promotions.sql (phase 7).


-- from commerce_02_inventory.sql



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





-- from commerce_04_returns.sql



-- from commerce_05_promotions.sql




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

