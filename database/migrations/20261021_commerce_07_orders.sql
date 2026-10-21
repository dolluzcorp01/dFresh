-- Commerce 07: Orders, payments, tax invoices and credit notes (docs/COMMERCE-SPEC.md 4.6, 6; commerce.js, invoices.js).
-- An order keeps a snapshot of its billing and shipping address, the place of supply and its GST, every discount, the
-- wallet used, the delivery and the cashback; an invoice is a snapshot of the order on the day it is issued.
-- Structure and defaults only: no customers, orders or demo data (scripts/commerce-demo-seed.js, dfresh_commerce only).
-- Safe on the live database: every table is new except the ALTERs marked "live table", which only add columns.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `orders` (
  `order_id` bigint NOT NULL AUTO_INCREMENT,
  `order_no` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id` int NOT NULL,
  `price_list` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'new',
  `payment_terms` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'cod',  -- cod | advance | credit
  `credit_days` int NOT NULL DEFAULT '0',  -- the customer's credit days on the order day
  `delivery_method_id` int DEFAULT NULL,
  `delivery_kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'own',
  `delivery_area_id` int DEFAULT NULL,
  `courier_id` int DEFAULT NULL,
  `awb_no` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `eway_bill_no` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cartons` int DEFAULT NULL,
  `weight_kg` decimal(8,2) DEFAULT NULL,
  `packed_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pack_override` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `received_by` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `failed_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `delivery_attempts` int NOT NULL DEFAULT '0',
  `payment_status` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unpaid',  -- unpaid | partly_paid | paid | refunded | part_refunded
  `bill_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bill_gstin` varchar(15) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bill_address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bill_town` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bill_state_code` char(2) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bill_pincode` varchar(6) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bill_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bill_address_id` int DEFAULT NULL,
  `ship_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ship_address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ship_town` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ship_state_code` char(2) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ship_pincode` varchar(6) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ship_phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ship_address_id` int DEFAULT NULL,
  `contact_id` int DEFAULT NULL,
  `place_of_supply` char(2) COLLATE utf8mb4_unicode_ci NOT NULL,
  `gst_type` varchar(5) COLLATE utf8mb4_unicode_ci NOT NULL,  -- intra | inter
  `coupon_code` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `subtotal` decimal(12,2) NOT NULL,
  `discount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `offer_discount` decimal(12,2) NOT NULL DEFAULT '0.00',  -- automatic offers (slabs)
  `manual_discount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `manual_discount_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `delivery_charge` decimal(10,2) NOT NULL DEFAULT '0.00',
  `delivery_gst` decimal(10,2) NOT NULL DEFAULT '0.00',
  `delivery_waived` decimal(12,2) NOT NULL DEFAULT '0.00',  -- free-delivery coupon
  `taxable` decimal(12,2) NOT NULL,
  `cgst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `sgst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `igst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `gst` decimal(12,2) NOT NULL,  -- cgst + sgst + igst
  `round_off` decimal(6,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL,
  `wallet_used` decimal(12,2) NOT NULL DEFAULT '0.00',
  `wallet_discount` decimal(12,2) NOT NULL DEFAULT '0.00',  -- part of wallet_used that lowered the taxable value
  `wallet_gst` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- discount | payment (setting when the wallet was used)
  `amount_paid` decimal(12,2) NOT NULL DEFAULT '0.00',  -- payments - refunds (wallet not included)
  `amount_due` decimal(12,2) NOT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `version` int NOT NULL DEFAULT '1',
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,  -- created by
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `confirmed_at` datetime DEFAULT NULL,
  `packing_at` datetime DEFAULT NULL,
  `packed_at` datetime DEFAULT NULL,
  `dispatched_at` datetime DEFAULT NULL,
  `out_at` datetime DEFAULT NULL,
  `courier_at` datetime DEFAULT NULL,
  `failed_at` datetime DEFAULT NULL,
  `delivered_at` datetime DEFAULT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `cancel_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  `cashback_base` decimal(12,2) DEFAULT NULL,  -- goods value the cashback was worked out on
  `cashback_amount` decimal(12,2) DEFAULT NULL,  -- NULL = not worked out yet; 0 = none due
  `cashback_at` datetime DEFAULT NULL,
  PRIMARY KEY (`order_id`),
  UNIQUE KEY `uq_order_no` (`order_no`),
  KEY `idx_order_status` (`status`,`created_at`),
  KEY `idx_order_customer` (`customer_id`),
  KEY `idx_order_payment` (`payment_status`),
  CONSTRAINT `fk_order_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_items` (
  `line_id` bigint NOT NULL AUTO_INCREMENT,
  `order_id` bigint NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_free` tinyint(1) NOT NULL DEFAULT '0',
  `qty` int NOT NULL,  -- packs
  `price` decimal(10,2) NOT NULL,  -- per pack before GST
  `list_price` decimal(10,2) DEFAULT NULL,  -- the list price that day, as on the list
  `offer_id` int DEFAULT NULL,
  `offer_discount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `coupon_discount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `wallet_discount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `hsn` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL,
  `gst_rate` decimal(5,2) NOT NULL,
  `taxable` decimal(12,2) NOT NULL,  -- qty x price less its share of the discount
  `cgst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `sgst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `igst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `line_total` decimal(12,2) NOT NULL,
  PRIMARY KEY (`line_id`),
  UNIQUE KEY `uq_order_sku` (`order_id`,`sku_code`,`is_free`),
  KEY `fk_item_sku` (`sku_code`),
  CONSTRAINT `fk_item_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `order_status_history` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `order_id` bigint NOT NULL,
  `from_status` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `to_status` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,  -- a status, or 'edited'
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_history_order` (`order_id`),
  CONSTRAINT `fk_history_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `stock_reservations` (
  `reservation_id` bigint NOT NULL AUTO_INCREMENT,
  `order_id` bigint NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `location_id` int NOT NULL DEFAULT '1',
  `qty` int NOT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',  -- active | consumed | released
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`reservation_id`),
  KEY `idx_res_sku` (`sku_code`,`location_id`,`status`),
  KEY `idx_res_order` (`order_id`),
  CONSTRAINT `fk_res_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`),
  CONSTRAINT `fk_res_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `payments` (
  `payment_id` bigint NOT NULL AUTO_INCREMENT,
  `order_id` bigint NOT NULL,
  `kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'payment',  -- payment | refund
  `mode` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,  -- cash | upi | bank | cheque | razorpay
  `amount` decimal(12,2) NOT NULL,  -- always above 0; kind says which way
  `received_on` date NOT NULL,
  `reference` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`payment_id`),
  KEY `idx_payment_order` (`order_id`),
  CONSTRAINT `fk_payment_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `invoices` (
  `invoice_id` bigint NOT NULL AUTO_INCREMENT,
  `invoice_no` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,  -- DFI/26-27/0001 (GST allows 16 characters)
  `fy` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,  -- 2026-27
  `seq` int NOT NULL,
  `order_id` bigint NOT NULL,
  `live_order_id` bigint DEFAULT NULL,  -- = order_id while issued, NULL once cancelled
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'issued',  -- issued | cancelled
  `issued_at` datetime NOT NULL,
  `due_on` date NOT NULL,
  `place_of_supply` char(2) COLLATE utf8mb4_unicode_ci NOT NULL,
  `gst_type` varchar(5) COLLATE utf8mb4_unicode_ci NOT NULL,
  `taxable` decimal(12,2) NOT NULL,
  `delivery_charge` decimal(10,2) NOT NULL DEFAULT '0.00',
  `delivery_gst` decimal(10,2) NOT NULL DEFAULT '0.00',
  `cgst` decimal(12,2) NOT NULL,
  `sgst` decimal(12,2) NOT NULL,
  `igst` decimal(12,2) NOT NULL,
  `round_off` decimal(6,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  `seller_name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `seller_gstin` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `seller_address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `seller_state_code` char(2) COLLATE utf8mb4_unicode_ci NOT NULL,
  `buyer_json` json NOT NULL,  -- bill / ship snapshot
  `is_demo` tinyint(1) NOT NULL DEFAULT '0',  -- issued while the seller GSTIN was a placeholder
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cancelled_at` datetime DEFAULT NULL,
  `cancel_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cancelled_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`invoice_id`),
  UNIQUE KEY `uq_invoice_no` (`invoice_no`),
  UNIQUE KEY `uq_invoice_live` (`live_order_id`),
  KEY `idx_invoice_order` (`order_id`),
  KEY `idx_invoice_due` (`status`,`due_on`),
  CONSTRAINT `fk_invoice_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `credit_notes` (
  `credit_note_id` bigint NOT NULL AUTO_INCREMENT,
  `credit_note_no` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,  -- DFC/26-27/0001
  `fy` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `seq` int NOT NULL,
  `invoice_id` bigint NOT NULL,
  `return_id` bigint DEFAULT NULL,
  `reason` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `taxable` decimal(12,2) NOT NULL,
  `cgst` decimal(12,2) NOT NULL,
  `sgst` decimal(12,2) NOT NULL,
  `igst` decimal(12,2) NOT NULL,
  `round_off` decimal(6,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL,
  `issued_at` datetime NOT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`credit_note_id`),
  UNIQUE KEY `uq_credit_note_no` (`credit_note_no`),
  KEY `idx_cn_invoice` (`invoice_id`),
  CONSTRAINT `fk_cn_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`invoice_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
