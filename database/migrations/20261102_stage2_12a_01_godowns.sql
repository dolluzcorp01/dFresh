-- Stage 2, phase 12a / 01: godowns (gap map D8). The stock location table becomes the godown table: a code (K, C...)
-- that goes into document numbers when in_number = 1, the state (a godown in another state needs its own GSTIN),
-- the person in charge, a phone and the GSTIN. Today's only location (1, Kanchipuram) becomes godown K and keeps
-- today's numbers (in_number 0: DFI/26-27/0015, never DFI/K/...). Later godowns get their code in their numbers.
-- Every record that lives in one godown gets godown_id (today's rows: Kanchipuram). Stock tables keep their column
-- name location_id (= godown id) but lose the default 1: the code always names the godown now.
-- Structure and today's data only (the Chennai example godown is demo data: scripts/commerce-demo-seed.js).
USE dfresh;
SET NAMES utf8mb4;

ALTER TABLE `locations`
  ADD COLUMN `code` varchar(4) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `location_id`,
  ADD COLUMN `state` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Tamil Nadu' AFTER `address`,
  ADD COLUMN `gstin` varchar(15) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `state`,
  ADD COLUMN `in_charge` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `gstin`,
  ADD COLUMN `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `in_charge`,
  ADD COLUMN `in_number` tinyint(1) NOT NULL DEFAULT '1' AFTER `phone`,
  ADD COLUMN `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ADD COLUMN `updated_at` datetime DEFAULT NULL;
UPDATE `locations` SET `code` = 'K', `in_number` = 0 WHERE `location_id` = 1;
UPDATE `locations` SET `code` = CONCAT('G', `location_id`) WHERE `code` IS NULL;
ALTER TABLE `locations` MODIFY `code` varchar(4) COLLATE utf8mb4_unicode_ci NOT NULL, ADD UNIQUE KEY `uq_godown_code` (`code`);

-- stock: the godown is always named
ALTER TABLE `stock_movements` MODIFY `location_id` int NOT NULL, ADD KEY `idx_move_godown` (`location_id`, `sku_code`, `stock_kind`);
ALTER TABLE `stock_reservations` MODIFY `location_id` int NOT NULL;
ALTER TABLE `stock_levels` MODIFY `location_id` int NOT NULL;

-- records that belong to one godown (today's rows: Kanchipuram)
ALTER TABLE `customers` ADD COLUMN `godown_id` int NOT NULL DEFAULT '0' AFTER `type_key`;
UPDATE `customers` SET `godown_id` = 1;
ALTER TABLE `customers` ALTER COLUMN `godown_id` DROP DEFAULT, ADD KEY `idx_cust_godown` (`godown_id`),
  ADD CONSTRAINT `fk_cust_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`);

ALTER TABLE `orders` ADD COLUMN `godown_id` int NOT NULL DEFAULT '0' AFTER `customer_id`;
UPDATE `orders` SET `godown_id` = 1;
ALTER TABLE `orders` ALTER COLUMN `godown_id` DROP DEFAULT, ADD KEY `idx_order_godown` (`godown_id`),
  ADD CONSTRAINT `fk_order_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`);

ALTER TABLE `returns` ADD COLUMN `godown_id` int NOT NULL DEFAULT '0' AFTER `order_id`;
UPDATE `returns` SET `godown_id` = 1;
ALTER TABLE `returns` ALTER COLUMN `godown_id` DROP DEFAULT, ADD KEY `idx_return_godown` (`godown_id`),
  ADD CONSTRAINT `fk_return_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`);

ALTER TABLE `stock_ins` ADD COLUMN `godown_id` int NOT NULL DEFAULT '0' AFTER `kind`;
UPDATE `stock_ins` SET `godown_id` = 1;
ALTER TABLE `stock_ins` ALTER COLUMN `godown_id` DROP DEFAULT,
  ADD CONSTRAINT `fk_stockin_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`);

ALTER TABLE `write_offs` ADD COLUMN `godown_id` int NOT NULL DEFAULT '0' AFTER `sku_code`;
UPDATE `write_offs` SET `godown_id` = 1;
ALTER TABLE `write_offs` ALTER COLUMN `godown_id` DROP DEFAULT,
  ADD CONSTRAINT `fk_writeoff_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`);

ALTER TABLE `stock_counts` ADD COLUMN `godown_id` int NOT NULL DEFAULT '0' AFTER `scope`;
UPDATE `stock_counts` SET `godown_id` = 1;
ALTER TABLE `stock_counts` ALTER COLUMN `godown_id` DROP DEFAULT,
  ADD CONSTRAINT `fk_count_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`);

ALTER TABLE `delivery_trips` ADD COLUMN `godown_id` int NOT NULL DEFAULT '0' AFTER `trip_id`;
UPDATE `delivery_trips` SET `godown_id` = 1;
ALTER TABLE `delivery_trips` ALTER COLUMN `godown_id` DROP DEFAULT, ADD KEY `idx_trip_godown` (`godown_id`),
  ADD CONSTRAINT `fk_trip_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`);
