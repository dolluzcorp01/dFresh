-- Stage 2, phase 14 / 01: section 1 Products and catalogue to v23 (Masters > Catalogue, Masters > Tax and units).
-- products (live table, columns added only):
--   status: draft | active | hidden | discontinued | archived (v23 "the five statuses"). is_active stays and always
--   equals (status = 'active'), so the public site reads exactly what it read before. Today's rows: 1 -> active,
--   0 -> hidden. brand, packed_by (empty = the company), origin: what a retail pack label must carry.
--   shelf_life_months (0 = never expires) and near_expiry_days (NULL = the Switches "expiry_warn_days" default) per
--   product, for every pack of it, next to track_batches (anything that expires is batch tracked).
-- product_translations (live table): name, short line, keywords, full description and best for may be empty (NULL),
--   so a Draft can be saved before its words are finished and a language can be partly done; the site falls back
--   to English per field (i18n-sql COALESCE), and Make active needs the English ones. Today's rows are unchanged.
-- skus: status active | discontinued | archived (is_active = can be ordered: an active or discontinued pack of an
--   active or hidden product; a discontinued pack is sold from stock, never back-ordered); sku_type finished | raw
--   (raw materials: no product, never sold, never on a price list or the site); raw_name, unit_code (what it is
--   counted in); source made | bought | both; net quantity, MRP (with GST), standard cost (without GST, See cost
--   only), weight, size, "in steps of", cartons per pallet.
-- sku_cartons: packs per carton with the date it applies from (a change applies to new arrivals only).
-- sku_barcodes: supplier EANs and extra carton codes (the SKU code itself and SKU#C always scan too).
-- unknown_barcodes: scanned on the floor, found nothing, waiting for the office to link them.
-- sku_substitutes: what to offer when a pack is out. units + sku_units: units of measure and per-SKU conversions
--   (stock is always held in the base unit: packs, or the raw material's unit).
-- kits: kit_code, status (active = sold, hidden = not sold), price (one price for the kit); kit_parts: SKU and
--   quantity. kit_products (what the website reads) is kept in step with the parts, so today's website kits stay.
USE dfresh;
SET NAMES utf8mb4;

-- live table
ALTER TABLE `products`
  ADD COLUMN `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' AFTER `is_active`,
  ADD COLUMN `brand` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'dFresh' AFTER `pack`,
  ADD COLUMN `packed_by` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `brand`,
  ADD COLUMN `origin` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'India' AFTER `packed_by`,
  ADD COLUMN `shelf_life_months` int NOT NULL DEFAULT '0' AFTER `track_batches`,
  ADD COLUMN `near_expiry_days` int DEFAULT NULL AFTER `shelf_life_months`;
UPDATE `products` SET `status` = IF(`is_active` = 1, 'active', 'hidden');

-- live table
ALTER TABLE `product_translations`
  MODIFY `name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  MODIFY `one_liner` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  MODIFY `keywords` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  MODIFY `description` text COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  MODIFY `best_for` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL;

ALTER TABLE `skus`
  MODIFY `product_id` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ADD COLUMN `sku_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'finished' AFTER `product_id`,
  ADD COLUMN `raw_name` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `sku_type`,
  ADD COLUMN `unit_code` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pack' AFTER `raw_name`,
  ADD COLUMN `step_qty` int NOT NULL DEFAULT '1' AFTER `min_order_qty`,
  ADD COLUMN `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' AFTER `is_active`,
  ADD COLUMN `source` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'made' AFTER `status`,
  ADD COLUMN `net_qty` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `source`,
  ADD COLUMN `mrp` decimal(10,2) DEFAULT NULL AFTER `net_qty`,
  ADD COLUMN `std_cost` decimal(10,2) DEFAULT NULL AFTER `mrp`,
  ADD COLUMN `weight_kg` decimal(8,3) DEFAULT NULL AFTER `std_cost`,
  ADD COLUMN `dims` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `weight_kg`,
  ADD COLUMN `per_pallet` int DEFAULT NULL AFTER `dims`;
UPDATE `skus` SET `status` = IF(`is_active` = 1, 'active', 'discontinued');
-- sold in full cartons: orders go in steps of a carton (as the order check already demands)
UPDATE `skus` SET `step_qty` = `packs_per_carton` WHERE `sell_unit` = 'carton';

CREATE TABLE IF NOT EXISTS `sku_cartons` (
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_date` date NOT NULL,  -- India date
  `packs` int NOT NULL,
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`sku_code`, `from_date`),
  CONSTRAINT `fk_skucarton_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `sku_cartons` (`sku_code`, `from_date`, `packs`, `created_by`)
  SELECT `sku_code`, DATE(`created_at`), `packs_per_carton`, `created_by` FROM `skus`;

CREATE TABLE IF NOT EXISTS `sku_barcodes` (
  `barcode` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,  -- upper case
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- supplier (EAN-13) | carton
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`barcode`),
  KEY `idx_barcode_sku` (`sku_code`),
  CONSTRAINT `fk_barcode_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `unknown_barcodes` (
  `barcode` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scanned_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scanned_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `times` int NOT NULL DEFAULT '1',
  PRIMARY KEY (`barcode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `sku_substitutes` (
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sub_sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`sku_code`, `sub_sku_code`),
  CONSTRAINT `fk_subs_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`),
  CONSTRAINT `fk_subs_sub` FOREIGN KEY (`sub_sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `units` (
  `unit_code` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`unit_code`),
  UNIQUE KEY `uq_unit_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `units` (`unit_code`, `name`, `sort_order`) VALUES
  ('pack', 'Pack', 1), ('carton', 'Carton', 2), ('roll', 'Roll', 3), ('box', 'Box', 4), ('kg', 'Kilogram', 5),
  ('pieces', 'Pieces', 6), ('litres', 'Litres', 7), ('metres', 'Metres', 8);

-- "1 <unit_code> = base_qty" of the SKU's base unit (packs, or a raw material's unit). Cartons come from sku_cartons.
CREATE TABLE IF NOT EXISTS `sku_units` (
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `unit_code` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `base_qty` decimal(12,3) NOT NULL,
  PRIMARY KEY (`sku_code`, `unit_code`),
  CONSTRAINT `fk_skuunit_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`),
  CONSTRAINT `fk_skuunit_unit` FOREIGN KEY (`unit_code`) REFERENCES `units` (`unit_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- live table
ALTER TABLE `kits`
  ADD COLUMN `kit_code` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `kit_key`,
  ADD COLUMN `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' AFTER `is_active`,
  ADD COLUMN `price` decimal(10,2) DEFAULT NULL AFTER `status`;
UPDATE `kits` k JOIN (SELECT `kit_key`, ROW_NUMBER() OVER (ORDER BY `sort_order`, `kit_key`) AS n FROM `kits`) x ON x.`kit_key` = k.`kit_key`
  SET k.`kit_code` = CONCAT('KIT-', LPAD(x.n, 2, '0'));
ALTER TABLE `kits` ADD UNIQUE KEY `uq_kit_code` (`kit_code`);

CREATE TABLE IF NOT EXISTS `kit_parts` (
  `kit_key` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` int NOT NULL DEFAULT '1',
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`kit_key`, `sku_code`),
  CONSTRAINT `fk_kitpart_kit` FOREIGN KEY (`kit_key`) REFERENCES `kits` (`kit_key`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_kitpart_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- today's website kits: each product's first pack, quantity 1 (until the quantities are confirmed)
INSERT IGNORE INTO `kit_parts` (`kit_key`, `sku_code`, `qty`, `sort_order`)
  SELECT kp.`kit_key`, (SELECT MIN(s.`sku_code`) FROM `skus` s WHERE s.`product_id` = kp.`product_id`), 1, kp.`sort_order`
    FROM `kit_products` kp WHERE EXISTS (SELECT 1 FROM `skus` s WHERE s.`product_id` = kp.`product_id`);
