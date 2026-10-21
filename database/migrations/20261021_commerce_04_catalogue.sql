-- Commerce 04: Products and prices (docs/COMMERCE-SPEC.md 4.3). No prices, no SKUs (they are entered in the admin).
-- products: + HSN code and GST rate (per product), + track_batches (wet wipes: by batch and expiry).
-- skus: one per product and pack size (carton size, minimum order, how it is sold, bin, average cost).
-- sku_prices: per SKU, price list and "effective from" date; price_changes: the history.
-- Structure and defaults only: no customers, orders or demo data (scripts/commerce-demo-seed.js, dfresh_commerce only).
-- Safe on the live database: every table is new except the ALTERs marked "live table", which only add columns.
USE dfresh;
SET NAMES utf8mb4;

-- live table
ALTER TABLE products
  ADD COLUMN hsn_code VARCHAR(8) NOT NULL DEFAULT '4818' AFTER pack,
  ADD COLUMN gst_rate DECIMAL(5,2) NOT NULL DEFAULT 18.00 AFTER hsn_code,
  ADD COLUMN track_batches TINYINT(1) NOT NULL DEFAULT 0 AFTER gst_rate;  -- stock by batch and expiry
UPDATE products SET track_batches = 1 WHERE category_key = 'wipes';

CREATE TABLE IF NOT EXISTS `skus` (
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `product_id` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `size_label` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `packs_per_carton` int NOT NULL DEFAULT '1',
  `min_order_qty` int NOT NULL DEFAULT '1',  -- in packs
  `sell_unit` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pack',  -- pack | carton | both
  `avg_cost` decimal(10,2) DEFAULT NULL,
  `bin_location` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`sku_code`),
  KEY `idx_sku_product` (`product_id`),
  CONSTRAINT `fk_sku_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`product_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sku_prices` (
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `list_key` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,  -- 'default' or a customer_types.type_key
  `effective_from` date NOT NULL,  -- India date
  `price` decimal(10,2) DEFAULT NULL,  -- NULL = no own price from that day (Default applies)
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`sku_code`,`list_key`,`effective_from`),
  CONSTRAINT `fk_skuprice_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `price_changes` (
  `change_id` bigint NOT NULL AUTO_INCREMENT,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `list_key` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `old_price` decimal(10,2) DEFAULT NULL,  -- the price that applied on effective_from before this change
  `new_price` decimal(10,2) DEFAULT NULL,  -- NULL = own price removed
  `effective_from` date NOT NULL,
  `source` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- grid | bulk | import | seed
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `changed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`change_id`),
  KEY `idx_pricechange_sku` (`sku_code`,`changed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
