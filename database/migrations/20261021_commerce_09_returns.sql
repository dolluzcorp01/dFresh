-- Commerce 09: Returns and refunds (docs/COMMERCE-SPEC.md 4.8, 5.5; returns.js): requests inside or outside the window,
-- pickups on trips or by courier, receiving by scan, inspection, refunds (wallet / original payment / less to pay) with
-- credit notes, replacements.
-- Structure and defaults only: no customers, orders or demo data (scripts/commerce-demo-seed.js, dfresh_commerce only).
-- Safe on the live database: every table is new except the ALTERs marked "live table", which only add columns.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `returns` (
  `return_id` bigint NOT NULL AUTO_INCREMENT,
  `return_no` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,  -- DFR-26nnnn
  `order_id` bigint NOT NULL,
  `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'requested',
  `reason_id` int NOT NULL,
  `reason_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `delivered_on` date NOT NULL,
  `window_days` int NOT NULL,
  `outside_window` tinyint(1) NOT NULL DEFAULT '0',
  `collection` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- bring | trip | courier
  `courier_id` int DEFAULT NULL,
  `awb_no` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `picked_up_at` datetime DEFAULT NULL,
  `picked_up_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `received_at` datetime DEFAULT NULL,
  `received_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `inspected_at` datetime DEFAULT NULL,
  `inspected_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `inspect_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `refund_method` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- wallet | original | balance
  `no_refund_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `replacement_order_id` bigint DEFAULT NULL,
  `requested_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` datetime DEFAULT NULL,
  `version` int NOT NULL DEFAULT '1',
  `cashback_reversed` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`return_id`),
  UNIQUE KEY `uq_return_no` (`return_no`),
  KEY `idx_return_order` (`order_id`),
  KEY `idx_return_status` (`status`,`created_at`),
  CONSTRAINT `fk_return_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `return_items` (
  `line_id` bigint NOT NULL AUTO_INCREMENT,
  `return_id` bigint NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_id` bigint DEFAULT NULL,  -- the batch it left in (batch-tracked products)
  `qty` int NOT NULL,  -- packs the customer returns
  `qty_received` int NOT NULL DEFAULT '0',  -- scanned at the godown
  `qty_ok` int DEFAULT NULL,  -- inspection (NULL until inspected)
  `qty_damaged` int DEFAULT NULL,
  `qty_expired` int DEFAULT NULL,
  `qty_missing` int DEFAULT NULL,  -- not received
  `refund_qty` int DEFAULT NULL,  -- outcome (NULL until decided)
  `replace_qty` int DEFAULT NULL,
  `none_qty` int DEFAULT NULL,
  PRIMARY KEY (`line_id`),
  KEY `idx_ritem_return` (`return_id`),
  KEY `fk_ritem_sku` (`sku_code`),
  KEY `fk_ritem_batch` (`batch_id`),
  CONSTRAINT `fk_ritem_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`),
  CONSTRAINT `fk_ritem_return` FOREIGN KEY (`return_id`) REFERENCES `returns` (`return_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ritem_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `return_photos` (
  `photo_id` bigint NOT NULL AUTO_INCREMENT,
  `return_id` bigint NOT NULL,
  `kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- request | pickup | inspect
  `photo` mediumblob NOT NULL,
  `photo_type` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`photo_id`),
  KEY `idx_rphoto_return` (`return_id`),
  CONSTRAINT `fk_rphoto_return` FOREIGN KEY (`return_id`) REFERENCES `returns` (`return_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `return_scans` (
  `scan_id` bigint NOT NULL AUTO_INCREMENT,
  `return_id` bigint NOT NULL,
  `code` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `batch_id` bigint DEFAULT NULL,
  `qty` int NOT NULL DEFAULT '0',
  `result` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,  -- ok | wrong_sku | wrong_batch | too_many | unknown
  `message` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`scan_id`),
  KEY `idx_rscan_return` (`return_id`),
  CONSTRAINT `fk_rscan_return` FOREIGN KEY (`return_id`) REFERENCES `returns` (`return_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `return_history` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `return_id` bigint NOT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,  -- a status or a step (photo, scan reset, decided ...)
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_rhist_return` (`return_id`),
  CONSTRAINT `fk_rhist_return` FOREIGN KEY (`return_id`) REFERENCES `returns` (`return_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `refunds` (
  `refund_id` bigint NOT NULL AUTO_INCREMENT,
  `return_id` bigint NOT NULL,
  `order_id` bigint NOT NULL,
  `method` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- wallet | original | balance
  `mode` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- original: cash | upi | bank | cheque | razorpay
  `reference` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,  -- the credit note total
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- approval | paid | rejected
  `approval_id` bigint DEFAULT NULL,
  `credit_note_id` bigint DEFAULT NULL,
  `payment_id` bigint DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` datetime DEFAULT NULL,
  PRIMARY KEY (`refund_id`),
  KEY `idx_refund_order` (`order_id`),
  KEY `idx_refund_return` (`return_id`),
  CONSTRAINT `fk_refund_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`),
  CONSTRAINT `fk_refund_return` FOREIGN KEY (`return_id`) REFERENCES `returns` (`return_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `credit_note_lines` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `credit_note_id` bigint NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `hsn` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `gst_rate` decimal(5,2) NOT NULL,
  `qty` int NOT NULL,
  `taxable` decimal(12,2) NOT NULL,
  `cgst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `sgst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `igst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `line_total` decimal(12,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cnline_cn` (`credit_note_id`),
  CONSTRAINT `fk_cnline_cn` FOREIGN KEY (`credit_note_id`) REFERENCES `credit_notes` (`credit_note_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
