-- Stage 2, phase 15 / 01: section 2 Prices and tax, to the v23 working file (docs/claude-tasks/phase-15).
-- No price in use changes: every list keeps the prices it has, typed as they were (all without GST today), and every
-- pack keeps its GST rate (each HSN code starts with the rate its products carry).
-- 1. Price lists of their own (v23): name, who it is for, typed with or without GST, rounding, default, status. Today's
--    lists are "default" plus one per customer type (list key = type key); each becomes a list and each type keeps it.
--    A pack a list does not price still takes the default list's price (as before).
-- 2. Each price row says how it was typed (basis); switching a list keeps old rows as typed (v22).
-- 3. The lowest allowed price per pack (skus.min_price, without GST), list slabs and a pack's own quantity bands.
-- 4. Price changes waiting for approval (PC-001, below cost plus the margin floor) and special prices (SP-001).
-- 5. HSN codes with dated GST rates (a new rate from a date waits for a second Admin) and the GST rate list.
-- 6. Rights: a "Prices and tax" row in the roles grid (v23 section 2); Sales views Products (phase 15 step 8).
-- 7. Approval rules: "Price below cost plus the margin floor" (10%), "Special price for a customer, below their list
--    price" (10%) and "Order line below the lowest allowed price" replace "Price below the price list" (D7).
-- 8. Logo and brand images (Website > Brand and layout): empty settings = the logo files of today.
USE dfresh;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- 1. price lists
CREATE TABLE IF NOT EXISTS `price_lists` (
  `list_key` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `about` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `typed` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ex',
  `round_to` decimal(4,2) NOT NULL DEFAULT '1.00',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`list_key`),
  UNIQUE KEY `uq_price_lists_name` (`name`),
  CONSTRAINT `chk_price_lists_typed` CHECK (`typed` IN ('ex', 'inc')),
  CONSTRAINT `chk_price_lists_round` CHECK (`round_to` IN (0.00, 0.50, 1.00)),
  CONSTRAINT `chk_price_lists_status` CHECK (`status` IN ('active', 'archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `price_lists` (`list_key`, `name`, `about`, `typed`, `round_to`, `is_default`, `sort_order`, `created_by`)
SELECT 'default', 'Default', 'Anyone whose customer type has no list of its own',
       IF(COALESCE((SELECT `value` FROM `commerce_settings` WHERE `setting_key` = 'prices_include_gst'), 'exclusive') = 'inclusive', 'inc', 'ex'), 1.00, 1, 0, 'system'
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM `price_lists` WHERE `list_key` = 'default');
INSERT INTO `price_lists` (`list_key`, `name`, `typed`, `round_to`, `is_default`, `status`, `sort_order`, `created_by`)
SELECT t.`type_key`, LEFT(t.`label`, 40),
       IF(COALESCE((SELECT `value` FROM `commerce_settings` WHERE `setting_key` = 'prices_include_gst'), 'exclusive') = 'inclusive', 'inc', 'ex'), 1.00, 0,
       IF(t.`is_active` = 1, 'active', 'archived'), t.`sort_order` + 1, 'system'
  FROM `customer_types` t
 WHERE NOT EXISTS (SELECT 1 FROM `price_lists` p WHERE p.`list_key` = t.`type_key`);

-- a customer type uses one list (NULL = the default list)
ALTER TABLE `customer_types` ADD COLUMN `list_key` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `label`;
UPDATE `customer_types` t JOIN `price_lists` p ON p.`list_key` = t.`type_key` SET t.`list_key` = t.`type_key`;

-- ---------------------------------------------------------------- 2. how each price row was typed
ALTER TABLE `sku_prices` ADD COLUMN `basis` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ex' AFTER `price`;
UPDATE `sku_prices` SET `basis` = 'inc'
 WHERE COALESCE((SELECT `value` FROM `commerce_settings` WHERE `setting_key` = 'prices_include_gst'), 'exclusive') = 'inclusive';
ALTER TABLE `price_changes` ADD COLUMN `basis` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ex' AFTER `new_price`;
-- the global setting is replaced by each list's own "Prices are typed"
DELETE FROM `commerce_settings` WHERE `setting_key` = 'prices_include_gst';

-- ---------------------------------------------------------------- 3. lowest allowed price, slabs, bands
ALTER TABLE `skus` ADD COLUMN `min_price` decimal(10,2) DEFAULT NULL AFTER `std_cost`;

CREATE TABLE IF NOT EXISTS `list_slabs` (
  `list_key` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `min_qty` int NOT NULL,
  `pct` decimal(5,2) NOT NULL,
  PRIMARY KEY (`list_key`, `min_qty`),
  CONSTRAINT `fk_list_slabs_list` FOREIGN KEY (`list_key`) REFERENCES `price_lists` (`list_key`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- a pack's own quantity prices on one list, typed as the list types its prices
CREATE TABLE IF NOT EXISTS `sku_bands` (
  `list_key` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sku_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `min_qty` int NOT NULL,
  `price` decimal(10,2) NOT NULL,
  PRIMARY KEY (`list_key`, `sku_code`, `min_qty`),
  CONSTRAINT `fk_sku_bands_list` FOREIGN KEY (`list_key`) REFERENCES `price_lists` (`list_key`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 4. waiting price changes and special prices
CREATE TABLE IF NOT EXISTS `price_requests` (
  `request_id` int NOT NULL AUTO_INCREMENT,
  `request_no` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sku_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `list_key` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `basis` varchar(3) COLLATE utf8mb4_unicode_ci NOT NULL,
  `effective_from` date NOT NULL,
  `why` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `approval_id` int DEFAULT NULL,
  `raised_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `raised_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decided_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decided_at` datetime DEFAULT NULL,
  PRIMARY KEY (`request_id`),
  UNIQUE KEY `uq_price_requests_no` (`request_no`),
  KEY `ix_price_requests_sku` (`sku_code`, `list_key`, `status`),
  CONSTRAINT `chk_price_requests_status` CHECK (`status` IN ('pending', 'approved', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `special_prices` (
  `sp_id` int NOT NULL AUTO_INCREMENT,
  `sp_no` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id` int NOT NULL,
  `sku_code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `valid_from` date NOT NULL,
  `valid_to` date DEFAULT NULL,
  `reason` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `approval_id` int DEFAULT NULL,
  `raised_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `raised_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decided_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decided_at` datetime DEFAULT NULL,
  `ended_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ended_at` datetime DEFAULT NULL,
  PRIMARY KEY (`sp_id`),
  UNIQUE KEY `uq_special_prices_no` (`sp_no`),
  KEY `ix_special_prices_cust` (`customer_id`, `sku_code`, `status`),
  CONSTRAINT `fk_special_prices_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`customer_id`),
  CONSTRAINT `chk_special_prices_status` CHECK (`status` IN ('pending', 'active', 'rejected', 'ended'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 5. HSN codes and dated GST rates
CREATE TABLE IF NOT EXISTS `hsn_codes` (
  `hsn_code` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`hsn_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status pending = a new rate from a date waiting for a second Admin (never used for tax until signed)
CREATE TABLE IF NOT EXISTS `hsn_rates` (
  `rate_id` int NOT NULL AUTO_INCREMENT,
  `hsn_code` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `effective_from` date NOT NULL,
  `gst_rate` decimal(5,2) NOT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `approval_id` int DEFAULT NULL,
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`rate_id`),
  KEY `ix_hsn_rates_code` (`hsn_code`, `status`, `effective_from`),
  CONSTRAINT `fk_hsn_rates_code` FOREIGN KEY (`hsn_code`) REFERENCES `hsn_codes` (`hsn_code`),
  CONSTRAINT `chk_hsn_rates_status` CHECK (`status` IN ('active', 'pending', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `gst_rate_list` (
  `gst_rate` decimal(5,2) NOT NULL,
  PRIMARY KEY (`gst_rate`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- the rates of the old setting (and every rate a product carries), then the setting goes (one place: this page)
INSERT IGNORE INTO `gst_rate_list` (`gst_rate`)
WITH RECURSIVE parts (rest, part) AS (
  SELECT CONCAT(REPLACE(COALESCE((SELECT `value` FROM `commerce_settings` WHERE `setting_key` = 'gst_rates'), '0, 5, 12, 18'), ' ', ''), ','), CAST(NULL AS CHAR(20))
  UNION ALL
  SELECT SUBSTRING(rest, LOCATE(',', rest) + 1), SUBSTRING(rest, 1, LOCATE(',', rest) - 1) FROM parts WHERE rest <> ''
)
SELECT CAST(part AS DECIMAL(5,2)) FROM parts WHERE part IS NOT NULL AND part <> '';
INSERT IGNORE INTO `gst_rate_list` (`gst_rate`) SELECT DISTINCT `gst_rate` FROM `products`;
DELETE FROM `commerce_settings` WHERE `setting_key` = 'gst_rates';

-- the codes in use (the description is a starting point; the accountant confirms each code) and the usual others
INSERT IGNORE INTO `hsn_codes` (`hsn_code`, `description`, `created_by`) VALUES
  ('48183000', 'Paper napkins and serviettes', 'system'),
  ('48181000', 'Toilet paper', 'system'),
  ('48182000', 'Handkerchiefs, facial tissue and towels', 'system'),
  ('33079090', 'Wet wipes and other preparations', 'system'),
  ('48030010', 'Tissue paper in rolls (parent reels)', 'system'),
  ('48229090', 'Paper cores and bobbins', 'system'),
  ('39202020', 'Plastic packing film', 'system'),
  ('48191010', 'Corrugated cartons', 'system');
INSERT IGNORE INTO `hsn_codes` (`hsn_code`, `description`, `created_by`)
SELECT DISTINCT `hsn_code`, 'To be confirmed by the accountant', 'system' FROM `products` WHERE `hsn_code` IS NOT NULL AND `hsn_code` <> '';
-- each code starts on 1 April 2026 with the rate its products carry today (18% where no product uses it)
INSERT INTO `hsn_rates` (`hsn_code`, `effective_from`, `gst_rate`, `created_by`)
SELECT h.`hsn_code`, '2026-04-01', COALESCE((SELECT MAX(p.`gst_rate`) FROM `products` p WHERE p.`hsn_code` = h.`hsn_code`), 18.00), 'system'
  FROM `hsn_codes` h
 WHERE NOT EXISTS (SELECT 1 FROM `hsn_rates` r WHERE r.`hsn_code` = h.`hsn_code`);

-- ---------------------------------------------------------------- 6. rights
-- "Prices and tax" for each role from what it had on Products (and prices), then v23: Supervisor (Operations) view
-- only, Sales view and create (it proposes special prices), Warehouse and Delivery none. Sales views Products.
INSERT IGNORE INTO `role_permissions` (`role_id`, `section`, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`)
SELECT `role_id`, 'prices', `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`
  FROM `role_permissions` WHERE `section` = 'products' AND `role_id` IN (2, 3);
INSERT INTO `role_permissions` (`role_id`, `section`, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`)
VALUES (4, 'prices', 1, 0, 0, 0, 0, 0, 0), (6, 'prices', 1, 1, 0, 0, 0, 0, 0), (6, 'products', 1, 0, 0, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE `can_view` = 1;

-- ---------------------------------------------------------------- 7. approval rules (D7)
INSERT IGNORE INTO `approval_rules` (`kind`, `label`, `section`, `is_on`, `unit`, `limit_value`, `limit_packs`, `locked`, `sort_order`) VALUES
  ('margin_floor', 'Price below cost plus the margin floor', 'prices', 1, '%', 10.00, NULL, 0, 30),
  ('special_price', 'Special price for a customer, below their list price', 'prices', 1, '%', 10.00, NULL, 0, 31),
  ('price_floor', 'Order line below the lowest allowed price', 'prices', 1, 'all', NULL, NULL, 0, 32);
DELETE FROM `approval_rules` WHERE `kind` = 'price_below_list'
   AND NOT EXISTS (SELECT 1 FROM `approvals` WHERE `kind` = 'price_below_list' AND `status` = 'pending');

-- ---------------------------------------------------------------- 8. logo and brand images
-- not public: the server reads them (favicon routes, PDFs, the admin), so the public bootstrap stays as it is
INSERT IGNORE INTO `site_settings` (`setting_key`, `setting_value`, `is_public`, `description`) VALUES
  ('logo_square', '', 0, 'Square logo (Website > Brand and layout > Logo and brand images): app icon, admin header. Empty = the logo files of today.'),
  ('logo_wide', '', 0, 'Wide logo (Website > Brand and layout > Logo and brand images): invoice and document header. Empty = the logo of today.'),
  ('favicon_set', '', 0, 'Favicon sizes 16, 32, 180, 192, 512 made from one upload (Logo and brand images). Empty = the favicons of today.');
