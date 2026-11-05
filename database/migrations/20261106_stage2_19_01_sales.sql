-- Stage 2, phase 19 / 01: sections 6 and 7 Leads, customers, quotes and orders, to the v23 working file
-- (docs/claude-tasks/phase-19). Every order, reservation, invoice, payment and customer balance stays as it is.
-- 1. Customer status (D3): active / hold / blocked (today's on_hold and inactive); a merged customer is "merged".
-- 2. Follow-ups and calls on enquiries too (not only customers); the first reply and the lost reason of an enquiry;
--    samples sent to an enquiry or a customer (SMP-0001).
-- 3. Quotes (DFQ, the series exists): valid until, prices kept until then, numbered revisions, the order made from it.
-- 4. Orders: draft (no stock held, no approval asked), numbered revisions (rev; version stays the edit check), the quote
--    or standing order it came from, how long the stock is held (hold_until, set when an order is confirmed from now
--    on; orders confirmed before this phase keep their hold until packed), the note of a rejected check.
-- 5. Order lines: what is owed as a back-order and what was dropped, a kit sold as one line (its parts carry kit_key
--    and the number of kits), the reason of a free line.
-- 6. Standing orders (STO-0001): repeat orders on a schedule.
-- 7. Switches (Orders): part shipments and back-orders, the hold time, standing orders made as drafts or confirmed.
-- 8. Approval rule cust_change also covers easing a customer's status and changing its type (v23 C1).
USE dfresh;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- 1. customer status
UPDATE customers SET status = 'merged' WHERE merged_into IS NOT NULL;
UPDATE customers SET status = 'hold' WHERE status = 'on_hold';
UPDATE customers SET status = 'blocked' WHERE status = 'inactive';

-- ---------------------------------------------------------------- 2. follow-ups, calls and samples on enquiries
ALTER TABLE `follow_ups`
  MODIFY `customer_id` int DEFAULT NULL,
  ADD COLUMN `lead_id` bigint DEFAULT NULL AFTER `customer_id`,
  ADD KEY `idx_follow_lead` (`lead_id`, `status`);
ALTER TABLE `customer_activity`
  MODIFY `customer_id` int DEFAULT NULL,
  ADD COLUMN `lead_id` bigint DEFAULT NULL AFTER `customer_id`,
  ADD KEY `idx_activity_lead` (`lead_id`, `happened_at`);
ALTER TABLE `leads`
  ADD COLUMN `first_reply_at` datetime DEFAULT NULL AFTER `staff_notes`,
  ADD COLUMN `lost_reason` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `first_reply_at`;
CREATE TABLE IF NOT EXISTS `samples` (
  `sample_id` int NOT NULL AUTO_INCREMENT,
  `lead_id` bigint DEFAULT NULL,
  `customer_id` int DEFAULT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` int NOT NULL DEFAULT '1',
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'to_send',
  `sent_on` date DEFAULT NULL,
  `feedback` varchar(160) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`sample_id`),
  KEY `idx_sample_lead` (`lead_id`),
  KEY `idx_sample_customer` (`customer_id`),
  CONSTRAINT `fk_sample_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 3. quotes
CREATE TABLE IF NOT EXISTS `quotes` (
  `quote_id` int NOT NULL AUTO_INCREMENT,
  `quote_no` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id` int DEFAULT NULL,
  `lead_id` bigint DEFAULT NULL,
  `godown_id` int NOT NULL,
  `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `rev` int NOT NULL DEFAULT '1',
  `quote_date` date NOT NULL,
  `valid_until` date NOT NULL,
  `delivery_charge` decimal(10,2) NOT NULL DEFAULT '0.00',
  `notes` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gst_type` varchar(5) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'intra',
  `list_value` decimal(12,2) NOT NULL DEFAULT '0.00',
  `taxable` decimal(12,2) NOT NULL DEFAULT '0.00',
  `gst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `round_off` decimal(6,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `order_id` bigint DEFAULT NULL,
  `lost_reason` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `rej_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `ok_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `version` int NOT NULL DEFAULT '1',
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`quote_id`),
  UNIQUE KEY `uq_quote_no` (`quote_no`),
  KEY `idx_quote_customer` (`customer_id`),
  KEY `idx_quote_lead` (`lead_id`),
  KEY `idx_quote_status` (`status`, `valid_until`),
  CONSTRAINT `fk_quote_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `quote_lines` (
  `line_id` int NOT NULL AUTO_INCREMENT,
  `quote_id` int NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `kit_key` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `kit_qty` int DEFAULT NULL,
  `qty` int NOT NULL,
  `price` decimal(10,2) NOT NULL,
  `list_price` decimal(10,2) DEFAULT NULL,
  `gst_rate` decimal(5,2) NOT NULL DEFAULT '0.00',
  `is_free` tinyint(1) NOT NULL DEFAULT '0',
  `free_why` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`line_id`),
  KEY `idx_qline_quote` (`quote_id`),
  CONSTRAINT `fk_qline_quote` FOREIGN KEY (`quote_id`) REFERENCES `quotes` (`quote_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `quote_revisions` (
  `quote_id` int NOT NULL,
  `rev` int NOT NULL,
  `valid_until` date NOT NULL,
  `delivery_charge` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `lines` json NOT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `saved_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`quote_id`, `rev`),
  CONSTRAINT `fk_qrev_quote` FOREIGN KEY (`quote_id`) REFERENCES `quotes` (`quote_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 4. orders: drafts, revisions, hold time
ALTER TABLE `orders`
  ADD COLUMN `rev` int NOT NULL DEFAULT '1' AFTER `version`,
  ADD COLUMN `quote_id` int DEFAULT NULL AFTER `rev`,
  ADD COLUMN `standing_id` int DEFAULT NULL AFTER `quote_id`,
  ADD COLUMN `hold_until` datetime DEFAULT NULL AFTER `confirmed_at`,
  ADD COLUMN `hold_gone` tinyint(1) NOT NULL DEFAULT '0' AFTER `hold_until`,
  ADD COLUMN `rej_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `hold_gone`,
  ADD COLUMN `ok_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `rej_note`,
  ADD KEY `idx_order_hold` (`status`, `hold_until`);
CREATE TABLE IF NOT EXISTS `order_revisions` (
  `order_id` bigint NOT NULL,
  `rev` int NOT NULL,
  `total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `lines` json NOT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `saved_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`order_id`, `rev`),
  CONSTRAINT `fk_orev_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`order_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 5. order lines: back-orders, kits, free reason
ALTER TABLE `order_items`
  ADD COLUMN `back_qty` int NOT NULL DEFAULT '0' AFTER `qty`,
  ADD COLUMN `dropped_qty` int NOT NULL DEFAULT '0' AFTER `back_qty`,
  ADD COLUMN `kit_key` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '' AFTER `is_free`,
  ADD COLUMN `kit_qty` int DEFAULT NULL AFTER `kit_key`,
  ADD COLUMN `free_why` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `kit_qty`,
  DROP INDEX `uq_order_sku`,
  ADD UNIQUE KEY `uq_order_sku` (`order_id`, `sku_code`, `is_free`, `kit_key`);

-- ---------------------------------------------------------------- 6. standing orders
CREATE TABLE IF NOT EXISTS `standing_orders` (
  `standing_id` int NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `godown_id` int NOT NULL,
  `every` varchar(6) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'week',
  `run_day` tinyint NOT NULL DEFAULT '1',
  `starts_on` date NOT NULL,
  `ends_on` date DEFAULT NULL,
  `next_on` date NOT NULL,
  `status` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `delivery_method_id` int DEFAULT NULL,
  `ship_address_id` int DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`standing_id`),
  KEY `idx_sto_due` (`status`, `next_on`),
  KEY `idx_sto_customer` (`customer_id`),
  CONSTRAINT `fk_sto_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`customer_id`),
  CONSTRAINT `fk_sto_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `standing_order_lines` (
  `standing_id` int NOT NULL,
  `sort_order` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `kit_key` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qty` int NOT NULL,
  PRIMARY KEY (`standing_id`, `sort_order`),
  CONSTRAINT `fk_stol_sto` FOREIGN KEY (`standing_id`) REFERENCES `standing_orders` (`standing_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 7. switches
INSERT IGNORE INTO commerce_settings (setting_key, grp, label, help, value, value_type, options, tbc, sort_order, sw_group, sw_unit, sw_example, sw_sort) VALUES
  ('split_shipments', 'Orders and pricing', 'Part shipments and back-orders allowed', 'The balance stays open and is offered first when stock arrives.', '1', 'bool', NULL, 0, 60, 'Orders', NULL,
   'Example: an order for 100 packs, only 70 in stock. On: 70 are held today; the 30 wait as a back-order and are held first when stock arrives. Off: an order above the free stock waits for approval.', 30),
  ('hold_hours', 'Orders and pricing', 'Stock is held for an unpacked order for', 'After this the packs go back to free to sell, and the salesperson is told.', '48', 'int', NULL, 0, 61, 'Orders', 'hours',
   'Example: set to 48. An order confirmed Monday 10 am keeps its packs until Wednesday 10 am. If it is not packed by then, the packs go back to free stock and the order is held again from the order.', 40),
  ('standing_confirm', 'Orders and pricing', 'Standing orders are made confirmed', 'Off: each cycle makes a draft order that Sales check and confirm. On: it is confirmed at once, with the same checks.', '0', 'bool', NULL, 0, 62, 'Orders', NULL,
   'Example: Hotel Kanchi orders 24 packs every Wednesday. Off: a draft waits in Orders > Draft on Wednesday. On: it is confirmed and the packs are held (or it waits for approval like any order).', 50);

-- ---------------------------------------------------------------- 8. approval rule text (v23 C1)
UPDATE approval_rules SET label = 'Lift a customer hold or block, change a customer type, or put a type on another price list' WHERE kind = 'cust_change';

-- ---------------------------------------------------------------- 9. the salesperson is told when a hold ends
INSERT IGNORE INTO commerce_settings (setting_key, grp, label, help, value, value_type, options, tbc, sort_order) VALUES
  ('notify_ev_hold_ended', 'Staff notifications', 'Stock hold ended on an order', 'To the salesperson of the customer.', '1', 'bool', NULL, 0, 45);
INSERT IGNORE INTO notification_templates (event_key, lang_code, subject, body) VALUES
  ('hold_ended', 'en', 'Stock hold ended: {order_no}', 'Hello {name},\n\n{order_no} for {customer} was not packed within {hours} hours, so its {packs} held packs went back to free to sell.\n\nOpen the order and press Hold again to hold what is free now: {link}');
