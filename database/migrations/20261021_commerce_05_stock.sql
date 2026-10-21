-- Commerce 05: Inventory (docs/COMMERCE-SPEC.md 4.4, stock.js): every change of stock is a movement (good / damaged /
-- returned), batches with expiry, stock-ins with costs (weighted average), reorder levels, write-offs (with approval
-- above the setting), stock counts (differences through approval).
-- Structure and defaults only: no customers, orders or demo data (scripts/commerce-demo-seed.js, dfresh_commerce only).
-- Safe on the live database: every table is new except the ALTERs marked "live table", which only add columns.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `suppliers` (
  `supplier_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gstin` varchar(15) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`supplier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `batches` (
  `batch_id` bigint NOT NULL AUTO_INCREMENT,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_no` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `mfg_date` date NOT NULL,
  `expiry_date` date NOT NULL,
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`batch_id`),
  UNIQUE KEY `uq_batch` (`sku_code`,`batch_no`),
  KEY `idx_batch_expiry` (`expiry_date`),
  CONSTRAINT `fk_batch_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock_ins` (
  `stock_in_id` bigint NOT NULL AUTO_INCREMENT,
  `kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- production | purchase
  `supplier_id` int DEFAULT NULL,  -- purchase only
  `received_on` date NOT NULL,
  `reference` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- bill no. / batch sheet no.
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`stock_in_id`),
  KEY `idx_stockin_day` (`received_on`),
  KEY `fk_stockin_supplier` (`supplier_id`),
  CONSTRAINT `fk_stockin_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock_in_lines` (
  `line_id` bigint NOT NULL AUTO_INCREMENT,
  `stock_in_id` bigint NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` int NOT NULL,  -- packs
  `unit_cost` decimal(10,2) NOT NULL,  -- per pack
  `batch_id` bigint DEFAULT NULL,
  `avg_before` decimal(10,2) DEFAULT NULL,
  `avg_after` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (`line_id`),
  KEY `idx_stockin_line` (`stock_in_id`),
  KEY `fk_stockinline_sku` (`sku_code`),
  KEY `fk_stockinline_batch` (`batch_id`),
  CONSTRAINT `fk_stockinline_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`),
  CONSTRAINT `fk_stockinline_in` FOREIGN KEY (`stock_in_id`) REFERENCES `stock_ins` (`stock_in_id`),
  CONSTRAINT `fk_stockinline_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock_movements` (
  `move_id` bigint NOT NULL AUTO_INCREMENT,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `location_id` int NOT NULL DEFAULT '1',
  `stock_kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- good | returned | damaged
  `move_type` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `delta` int NOT NULL,
  `batch_id` bigint DEFAULT NULL,
  `unit_cost` decimal(10,2) DEFAULT NULL,
  `ref_type` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ref_id` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`move_id`),
  KEY `idx_move_sku` (`sku_code`,`stock_kind`,`batch_id`),
  KEY `idx_move_ref` (`ref_type`,`ref_id`),
  KEY `idx_move_day` (`created_at`),
  KEY `fk_move_batch` (`batch_id`),
  CONSTRAINT `fk_move_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`),
  CONSTRAINT `fk_move_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock_levels` (
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `location_id` int NOT NULL DEFAULT '1',
  `reorder_level` int NOT NULL,
  `reorder_qty` int NOT NULL DEFAULT '0',  -- 0 = suggest from the level
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`sku_code`,`location_id`),
  CONSTRAINT `fk_level_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `write_offs` (
  `write_off_id` bigint NOT NULL AUTO_INCREMENT,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stock_kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- good | damaged | returned: where the packs leave from
  `batch_id` bigint DEFAULT NULL,
  `qty` int NOT NULL,
  `reason_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- damaged | expired | lost | sample
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` decimal(12,2) DEFAULT NULL,  -- qty x average cost when requested
  `photo` mediumblob,  -- internal, shown only in the admin
  `photo_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- pending | posted | rejected
  `approval_id` bigint DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `posted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`write_off_id`),
  KEY `idx_writeoff_status` (`status`),
  KEY `fk_writeoff_sku` (`sku_code`),
  KEY `fk_writeoff_batch` (`batch_id`),
  CONSTRAINT `fk_writeoff_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`),
  CONSTRAINT `fk_writeoff_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock_counts` (
  `count_id` bigint NOT NULL AUTO_INCREMENT,
  `scope` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,  -- 'all' or a category key
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',  -- open | pending (approval) | posted | rejected | closed (no difference)
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approval_id` bigint DEFAULT NULL,
  `started_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `started_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `submitted_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `closed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`count_id`),
  KEY `idx_count_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock_count_lines` (
  `line_id` bigint NOT NULL AUTO_INCREMENT,
  `count_id` bigint NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_id` bigint DEFAULT NULL,  -- batch-tracked SKUs are counted per batch
  `expected` int DEFAULT NULL,  -- good stock when the count was submitted
  `counted` int DEFAULT NULL,  -- NULL = not counted (left out)
  `counted_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `counted_at` datetime DEFAULT NULL,
  PRIMARY KEY (`line_id`),
  UNIQUE KEY `uq_count_line` (`count_id`,`sku_code`,`batch_id`),
  KEY `fk_countline_sku` (`sku_code`),
  CONSTRAINT `fk_countline_count` FOREIGN KEY (`count_id`) REFERENCES `stock_counts` (`count_id`),
  CONSTRAINT `fk_countline_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
