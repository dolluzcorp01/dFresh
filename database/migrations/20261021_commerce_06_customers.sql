-- Commerce 06: Customers (docs/COMMERCE-SPEC.md 4.5): CUS numbers, status, sales owner, own price list, credit terms,
-- language for their mails and the opt-outs, billing addresses with their GSTIN and shipping addresses, contacts, the
-- timeline (activity), follow-ups, tags and saved segments.
-- Structure and defaults only: no customers, orders or demo data (scripts/commerce-demo-seed.js, dfresh_commerce only).
-- Safe on the live database: every table is new except the ALTERs marked "live table", which only add columns.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `customers` (
  `customer_id` int NOT NULL AUTO_INCREMENT,
  `customer_no` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,  -- CUS-0001
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,  -- the customer as we call them (person or business)
  `business_name` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `type_key` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',  -- active | on_hold | inactive
  `hold_reason` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,  -- +91 98765 43210
  `phone_digits` char(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- duplicate check
  `email` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `lang_code` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `opt_out_reminders` tinyint(1) NOT NULL DEFAULT '0',
  `opt_out_offers` tinyint(1) NOT NULL DEFAULT '0',
  `source` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `owner_emp_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- sales owner (admin user)
  `price_list` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- NULL = the type's list
  `credit_days` int NOT NULL DEFAULT '0',
  `credit_limit` decimal(12,2) NOT NULL DEFAULT '0.00',
  `lead_id` bigint DEFAULT NULL,
  `merged_into` int DEFAULT NULL,
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`customer_id`),
  UNIQUE KEY `uq_customer_no` (`customer_no`),
  KEY `idx_customer_phone` (`phone_digits`),
  KEY `idx_customer_email` (`email`),
  KEY `idx_customer_type` (`type_key`,`status`),
  KEY `idx_customer_owner` (`owner_emp_id`),
  KEY `idx_customer_lead` (`lead_id`),
  CONSTRAINT `fk_customer_type` FOREIGN KEY (`type_key`) REFERENCES `customer_types` (`type_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_addresses` (
  `address_id` int NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- billing | shipping
  `label` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- e.g. "Branch 2 - Anna Nagar"
  `name` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,  -- on the invoice / the parcel
  `gstin` varchar(15) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- billing: this branch's GSTIN (its state)
  `contact_person` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- shipping
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `address` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `town` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `state_code` char(2) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pincode` varchar(6) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `delivery_area_id` int DEFAULT NULL,  -- shipping: NULL = from the PIN code / town
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`address_id`),
  KEY `idx_addr_customer` (`customer_id`,`kind`),
  KEY `idx_addr_gstin` (`gstin`),
  CONSTRAINT `fk_addr_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_contacts` (
  `contact_id` int NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `whatsapp` tinyint(1) NOT NULL DEFAULT '0',
  `gets_invoices` tinyint(1) NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`contact_id`),
  KEY `idx_contact_customer` (`customer_id`),
  CONSTRAINT `fk_contact_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_activity` (
  `activity_id` bigint NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,  -- call | whatsapp | visit | mail | note
  `happened_at` datetime NOT NULL,
  `note` text COLLATE utf8mb4_unicode_ci NOT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`activity_id`),
  KEY `idx_activity_customer` (`customer_id`,`happened_at`),
  CONSTRAINT `fk_activity_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `follow_ups` (
  `follow_up_id` bigint NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `assignee` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,  -- admin user
  `due_on` date NOT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',  -- open | done
  `snoozes` int NOT NULL DEFAULT '0',
  `done_at` datetime DEFAULT NULL,
  `done_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `done_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`follow_up_id`),
  KEY `idx_follow_assignee` (`assignee`,`status`,`due_on`),
  KEY `idx_follow_customer` (`customer_id`,`status`),
  CONSTRAINT `fk_follow_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_tags` (
  `customer_id` int NOT NULL,
  `tag` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`customer_id`,`tag`),
  KEY `idx_tag` (`tag`),
  CONSTRAINT `fk_tag_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `customer_segments` (
  `segment_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `filters` varchar(1000) COLLATE utf8mb4_unicode_ci NOT NULL,  -- JSON: the Customers list filters
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`segment_id`),
  UNIQUE KEY `uq_segment_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
