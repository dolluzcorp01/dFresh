-- Commerce 10: Promotions and the wallet (docs/COMMERCE-SPEC.md 4.5; promotions.js, wallet.js): coupons with their scope
-- and limits, automatic offers (slabs, buy X get Y), cashback rules, the wallet (credits with source and expiry, uses
-- taken oldest first). No coupons, offers or rules: they are made in the admin.
-- Structure and defaults only: no customers, orders or demo data (scripts/commerce-demo-seed.js, dfresh_commerce only).
-- Safe on the live database: every table is new except the ALTERs marked "live table", which only add columns.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `coupons` (
  `code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `kind` varchar(14) COLLATE utf8mb4_unicode_ci NOT NULL,  -- percent | fixed | free_delivery
  `value` decimal(10,2) NOT NULL DEFAULT '0.00',  -- percent, or Rs for fixed; 0 for free delivery
  `min_order` decimal(10,2) NOT NULL DEFAULT '0.00',  -- goods value of the order before the coupon
  `max_discount` decimal(10,2) DEFAULT NULL,  -- cap (percent coupons); NULL = no cap
  `valid_from` date DEFAULT NULL,
  `valid_to` date DEFAULT NULL,
  `total_limit` int DEFAULT NULL,  -- uses in all; NULL = no limit
  `per_customer_limit` int DEFAULT NULL,  -- uses per customer; NULL = no limit
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coupon_scope` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `scope` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- type | customer | include | exclude
  `type_key` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `customer_id` int DEFAULT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `category_key` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_cscope_code` (`code`,`scope`),
  CONSTRAINT `fk_cscope_coupon` FOREIGN KEY (`code`) REFERENCES `coupons` (`code`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `coupon_redemptions` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `code` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `order_id` bigint NOT NULL,
  `customer_id` int NOT NULL,
  `amount` decimal(12,2) NOT NULL,  -- discount given (or the delivery charge waived)
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',  -- active | released (order cancelled or coupon removed)
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `released_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_redeem_code` (`code`,`status`),
  KEY `idx_redeem_customer` (`customer_id`,`code`),
  KEY `idx_redeem_order` (`order_id`),
  CONSTRAINT `fk_redeem_coupon` FOREIGN KEY (`code`) REFERENCES `coupons` (`code`),
  CONSTRAINT `fk_redeem_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `offers` (
  `offer_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- slab | bxgy
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- the SKU it is on, or
  `category_key` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- every SKU of a category
  `min_qty` int NOT NULL DEFAULT '1',  -- slab: from this quantity
  `min_unit` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pack',  -- pack | carton
  `pct` decimal(5,2) NOT NULL DEFAULT '0.00',  -- slab: % off the line
  `buy_qty` int NOT NULL DEFAULT '0',  -- bxgy: for every buy_qty packs ...
  `get_qty` int NOT NULL DEFAULT '0',  -- ... get_qty packs free
  `get_sku_code` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- bxgy: the free SKU (NULL = the same SKU)
  `valid_from` date DEFAULT NULL,
  `valid_to` date DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`offer_id`),
  KEY `idx_offer_active` (`is_active`,`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `offer_customer_types` (
  `offer_id` int NOT NULL,
  `type_key` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`offer_id`,`type_key`),
  CONSTRAINT `fk_otype_offer` FOREIGN KEY (`offer_id`) REFERENCES `offers` (`offer_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cashback_rules` (
  `rule_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type_key` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- NULL = every customer type
  `pct` decimal(5,2) NOT NULL,
  `min_order` decimal(10,2) NOT NULL DEFAULT '0.00',  -- goods value (before GST) after discounts and returns
  `max_per_order` decimal(10,2) DEFAULT NULL,
  `valid_from` date DEFAULT NULL,
  `valid_to` date DEFAULT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`rule_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wallet_entries` (
  `entry_id` bigint NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `source` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- cashback | refund | manual | used | expired | reversed
  `amount` decimal(12,2) NOT NULL,  -- + credit, - debit
  `remaining` decimal(12,2) DEFAULT NULL,  -- credits: what is left to use (oldest first)
  `expires_on` date DEFAULT NULL,  -- credits: NULL = never
  `reason` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `order_id` bigint DEFAULT NULL,
  `return_id` bigint DEFAULT NULL,
  `approval_id` bigint DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`entry_id`),
  KEY `idx_wallet_customer` (`customer_id`,`entry_id`),
  KEY `idx_wallet_expiry` (`expires_on`,`remaining`),
  KEY `idx_wallet_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `wallet_allocations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `debit_entry_id` bigint NOT NULL,  -- a use on an order, a reversal, a manual debit
  `credit_entry_id` bigint NOT NULL,  -- the credit it took from
  `amount` decimal(12,2) NOT NULL,
  `given_back` tinyint(1) NOT NULL DEFAULT '0',  -- the order was cancelled or edited: back on the credit
  PRIMARY KEY (`id`),
  KEY `idx_walloc_debit` (`debit_entry_id`),
  KEY `idx_walloc_credit` (`credit_entry_id`),
  CONSTRAINT `fk_walloc_credit` FOREIGN KEY (`credit_entry_id`) REFERENCES `wallet_entries` (`entry_id`),
  CONSTRAINT `fk_walloc_debit` FOREIGN KEY (`debit_entry_id`) REFERENCES `wallet_entries` (`entry_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
