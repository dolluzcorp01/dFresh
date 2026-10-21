-- Commerce 08: Packing and delivery (docs/COMMERCE-SPEC.md 5.3, 5.4; delivery.js): picks by batch, pack scans, own
-- vehicles and drivers (trips and their stops, proof of delivery, delivery OTP with a limit on wrong codes), couriers.
-- Structure and defaults only: no customers, orders or demo data (scripts/commerce-demo-seed.js, dfresh_commerce only).
-- Safe on the live database: every table is new except the ALTERs marked "live table", which only add columns.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `vehicles` (
  `vehicle_id` int NOT NULL AUTO_INCREMENT,
  `number` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`vehicle_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `drivers` (
  `driver_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- the admin user who sees this driver's trips (My trips)
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`driver_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `couriers` (
  `courier_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `tracking_url` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '',  -- with {awb}, e.g. https://example.com/track?awb={awb}
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`courier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_picks` (
  `pick_id` bigint NOT NULL AUTO_INCREMENT,
  `order_id` bigint NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_id` bigint DEFAULT NULL,
  `qty` int NOT NULL,
  PRIMARY KEY (`pick_id`),
  KEY `idx_pick_order` (`order_id`),
  KEY `fk_pick_sku` (`sku_code`),
  CONSTRAINT `fk_pick_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pick_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `pack_scans` (
  `scan_id` bigint NOT NULL AUTO_INCREMENT,
  `order_id` bigint NOT NULL,
  `code` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,  -- what was scanned: SKU, SKU/BATCH, SKU#C (one carton)
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `batch_id` bigint DEFAULT NULL,
  `qty` int NOT NULL DEFAULT '0',  -- packs counted (0 for a refused scan)
  `result` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,  -- ok | wrong_sku | wrong_batch | too_many | unknown
  `message` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`scan_id`),
  KEY `idx_scan_order` (`order_id`),
  CONSTRAINT `fk_scan_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `delivery_trips` (
  `trip_id` bigint NOT NULL AUTO_INCREMENT,
  `trip_date` date NOT NULL,
  `area_id` int DEFAULT NULL,
  `vehicle_id` int NOT NULL,
  `driver_id` int NOT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'planned',  -- planned | out | ended
  `cash_expected` decimal(12,2) DEFAULT NULL,  -- pay-on-delivery amounts due when the trip started
  `cash_collected` decimal(12,2) DEFAULT NULL,
  `cash_handed` decimal(12,2) DEFAULT NULL,
  `end_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `started_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `ended_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ended_at` datetime DEFAULT NULL,
  PRIMARY KEY (`trip_id`),
  KEY `idx_trip_status` (`status`,`trip_date`),
  KEY `fk_trip_vehicle` (`vehicle_id`),
  KEY `fk_trip_driver` (`driver_id`),
  CONSTRAINT `fk_trip_driver` FOREIGN KEY (`driver_id`) REFERENCES `drivers` (`driver_id`),
  CONSTRAINT `fk_trip_vehicle` FOREIGN KEY (`vehicle_id`) REFERENCES `vehicles` (`vehicle_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `trip_stops` (
  `stop_id` bigint NOT NULL AUTO_INCREMENT,
  `trip_id` bigint NOT NULL,
  `order_id` bigint NOT NULL,
  `kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'delivery',  -- delivery | pickup
  `return_id` bigint DEFAULT NULL,
  `seq` int NOT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',  -- pending | delivered | failed
  `otp` char(4) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `otp_fails` tinyint NOT NULL DEFAULT '0',  -- wrong delivery OTPs in a row; 5 make a new code
  `receiver_name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `photo` mediumblob,
  `photo_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `failed_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cash_collected` decimal(12,2) NOT NULL DEFAULT '0.00',
  `done_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `done_at` datetime DEFAULT NULL,
  PRIMARY KEY (`stop_id`),
  UNIQUE KEY `uq_trip_stop` (`trip_id`,`order_id`,`kind`),
  KEY `idx_stop_order` (`order_id`),
  CONSTRAINT `fk_stop_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`),
  CONSTRAINT `fk_stop_trip` FOREIGN KEY (`trip_id`) REFERENCES `delivery_trips` (`trip_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
