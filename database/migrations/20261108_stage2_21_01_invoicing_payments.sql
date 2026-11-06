-- Stage 2, phase 21 / 01: sections 10 and 11 Invoicing, GST and payments, to the v23 working file (docs/claude-tasks/phase-21).
-- 1. Rights: a new section "invoicing" (Invoicing and GST, v23 section 10). Sub-admin has it in full, Viewer sees it; Sales
--    and Supervisor have none (v23 test 10.13). Sales get View and Create on Payments: they record receipts for their own
--    customers (v23 test 11.12). Approval rules: a credit note not tied to goods coming back, cancelling an invoice (both
--    Invoicing), writing off a bad debt and waiving a cheque bounce charge (both Payments).
-- 2. Numbers: sales debit notes DFS (per godown, per financial year), refunds DFRF, receipts DFRC (now live).
-- 3. Orders: a delivery charge typed by hand stays (carry-over 9.2), with the reason when it differs from the area's;
--    the most it may be is a Commerce setting.
-- 4. Invoices: the invoice note, the e-way bill (number and valid until), the e-invoice IRN and ack number, a cancel that
--    waits for approval, and how it was cancelled ('order' = with the order and a credit note, as before; 'alone' = the
--    invoice only, a reversing line in the ledger, v23).
-- 5. Credit notes: status (done, waiting for approval, rejected), kind (return, short, refused, price, other, cancel),
--    the approval and a note. Every credit note made so far is done; kind 'return' when it has a return, else 'cancel'.
--    The order's amount due counts credit notes that are done and not a cancel: exactly the ones it counted before.
-- 6. New: sales debit notes, delivery challans (goods sent without a sale, DFT per godown like transfers), receipts per
--    customer (D2) with their allocations, cheques, customer charges (bounce charge), bad debt write-offs; refunds of a
--    credit balance (no return) and refund numbers.
-- 7. D2: every payment recorded per order so far becomes a receipt of that customer (DFRC by date) whose allocation is
--    that payment, so every balance stays exactly as it was.
USE dfresh;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- 1. rights and approval rules
INSERT IGNORE INTO `role_permissions` (`role_id`, `section`, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`)
SELECT `role_id`, 'invoicing', `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`
  FROM `role_permissions` WHERE `section` = 'money' AND `role_id` IN (2, 3);
INSERT INTO `role_permissions` (`role_id`, `section`, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`)
VALUES (6, 'money', 1, 1, 0, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE `can_view` = 1, `can_create` = 1;

INSERT IGNORE INTO `approval_rules` (`kind`, `label`, `section`, `is_on`, `unit`, `limit_value`, `limit_packs`, `locked`, `sort_order`) VALUES
  ('credit_no_return', 'Credit note not tied to a return', 'invoicing', 1, 'all', NULL, NULL, 0, 152),
  ('cancel_invoice', 'Cancel an invoice', 'invoicing', 1, 'all', NULL, NULL, 0, 153),
  ('bad_debt', 'Write off a bad debt', 'money', 1, 'all', NULL, NULL, 0, 157),
  ('waive_bounce', 'Waive a cheque bounce charge', 'money', 1, 'all', NULL, NULL, 0, 158);

-- ---------------------------------------------------------------- 2. numbers
INSERT IGNORE INTO `document_series` (`doc_key`, `label`, `prefix`, `fmt`, `per_godown`, `fy_reset`, `digits`, `max_len`, `gst`, `built`, `live`, `section_no`, `start_no`, `sort_order`) VALUES
  ('sdebit', 'Sales debit note', 'DFS', 'slash', 1, 1, 4, 16, 1, 1, 1, 10, 1, 45),
  ('refundv', 'Refund to a customer', 'DFRF', 'slash', 0, 1, 4, 20, 0, 1, 1, 11, 1, 165);
UPDATE `document_series` SET `built` = 1, `live` = 1 WHERE `doc_key` IN ('receipt', 'challan');

-- ---------------------------------------------------------------- 3. the delivery charge typed on the order (9.2)
ALTER TABLE `orders`
  ADD COLUMN `delivery_charge_typed` tinyint(1) NOT NULL DEFAULT 0 AFTER `delivery_waived`,
  ADD COLUMN `delivery_charge_why` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `delivery_charge_typed`;
INSERT IGNORE INTO `commerce_settings` (`setting_key`, `grp`, `label`, `help`, `value`, `value_type`, `options`, `tbc`, `sort_order`) VALUES
  ('delivery_charge_max', 'Delivery', 'Most a delivery charge typed on an order may be (Rs)',
   'The order form fills the charge from the delivery area; a charge typed by hand stays, needs a reason when it differs from the area''s, and may not pass this.',
   '5000', 'int', NULL, 0, 45);
INSERT IGNORE INTO `commerce_settings` (`setting_key`, `grp`, `label`, `help`, `value`, `value_type`, `options`, `tbc`, `sort_order`) VALUES
  ('bounce_charge', 'Payments', 'Bank charge for a bounced cheque (Rs)',
   'Added to the customer when their cheque bounces. Charging less is a waiver of the rest and waits for approval (rule "Waive a cheque bounce charge").',
   '500', 'int', NULL, 0, 50);

-- ---------------------------------------------------------------- 4. invoices
ALTER TABLE `invoices`
  ADD COLUMN `note` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `emp_id`,
  ADD COLUMN `ewb_no` char(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `note`,
  ADD COLUMN `ewb_valid` date DEFAULT NULL AFTER `ewb_no`,
  ADD COLUMN `irn` char(64) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `ewb_valid`,
  ADD COLUMN `ack_no` varchar(15) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `irn`,
  ADD COLUMN `cancel_approval_id` bigint DEFAULT NULL AFTER `cancelled_by`,
  ADD COLUMN `cancel_ask_why` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `cancel_approval_id`,
  ADD COLUMN `cancel_kind` varchar(6) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `cancel_ask_why`,
  ADD UNIQUE KEY `uq_invoice_ewb` (`ewb_no`);
UPDATE `invoices` SET `cancel_kind` = 'order' WHERE `status` = 'cancelled';

-- ---------------------------------------------------------------- 5. credit notes
ALTER TABLE `credit_notes`
  ADD COLUMN `status` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'done' AFTER `reason`,
  ADD COLUMN `kind` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'return' AFTER `status`,
  ADD COLUMN `note` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `kind`,
  ADD COLUMN `gst_rate` decimal(5,2) DEFAULT NULL AFTER `note`,
  ADD COLUMN `approval_id` bigint DEFAULT NULL AFTER `emp_id`,
  ADD COLUMN `decided_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `approval_id`,
  MODIFY `issued_at` datetime DEFAULT NULL,
  ADD KEY `idx_cn_status` (`status`);
UPDATE `credit_notes` SET `kind` = IF(`return_id` IS NULL, 'cancel', 'return');

-- ---------------------------------------------------------------- 6. new documents
CREATE TABLE IF NOT EXISTS `debit_notes` (
  `debit_note_id` bigint NOT NULL AUTO_INCREMENT,
  `debit_note_no` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `fy` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `invoice_id` bigint NOT NULL,
  `customer_id` int NOT NULL,
  `godown_id` int NOT NULL,
  `reason` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `note` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gst_type` varchar(5) COLLATE utf8mb4_unicode_ci NOT NULL,
  `gst_rate` decimal(5,2) NOT NULL,
  `taxable` decimal(12,2) NOT NULL,
  `cgst` decimal(12,2) NOT NULL DEFAULT 0,
  `sgst` decimal(12,2) NOT NULL DEFAULT 0,
  `igst` decimal(12,2) NOT NULL DEFAULT 0,
  `round_off` decimal(6,2) NOT NULL DEFAULT 0,
  `total` decimal(12,2) NOT NULL,
  `paid` decimal(12,2) NOT NULL DEFAULT 0,
  `due_on` date NOT NULL,
  `status` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'done',
  `issued_at` datetime NOT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`debit_note_id`),
  UNIQUE KEY `uq_debit_note_no` (`debit_note_no`),
  KEY `idx_dn_invoice` (`invoice_id`),
  KEY `idx_dn_customer` (`customer_id`),
  CONSTRAINT `fk_dn_invoice` FOREIGN KEY (`invoice_id`) REFERENCES `invoices` (`invoice_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `delivery_challans` (
  `challan_id` int NOT NULL AUTO_INCREMENT,
  `challan_no` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `godown_id` int NOT NULL,
  `why` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `to_name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `to_address` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` decimal(12,2) NOT NULL DEFAULT 0,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`challan_id`),
  UNIQUE KEY `uq_challan_no` (`challan_no`),
  CONSTRAINT `fk_dc_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `delivery_challan_lines` (
  `line_id` int NOT NULL AUTO_INCREMENT,
  `challan_id` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_id` int DEFAULT NULL,
  `qty` int NOT NULL,
  `unit_cost` decimal(12,4) DEFAULT NULL,
  PRIMARY KEY (`line_id`),
  KEY `idx_dcl_challan` (`challan_id`),
  CONSTRAINT `fk_dcl_challan` FOREIGN KEY (`challan_id`) REFERENCES `delivery_challans` (`challan_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- a receipt is per customer (D2); what it settles is in payments (one row per order / invoice it pays, as before) and
-- receipt_dues (debit notes and charges); what is left is on account until the next invoice takes it
CREATE TABLE IF NOT EXISTS `receipts` (
  `receipt_id` bigint NOT NULL AUTO_INCREMENT,
  `receipt_no` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `customer_id` int NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `mode` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `received_on` date NOT NULL,
  `reference` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `source` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'office',
  `order_id` bigint DEFAULT NULL,
  `to_invoice_id` bigint DEFAULT NULL,
  `status` varchar(8) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'ok',
  `cheque_id` int DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `from_payment_id` bigint DEFAULT NULL,
  PRIMARY KEY (`receipt_id`),
  UNIQUE KEY `uq_receipt_no` (`receipt_no`),
  KEY `idx_receipt_customer` (`customer_id`),
  KEY `idx_receipt_order` (`order_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `payments`
  ADD COLUMN `receipt_id` bigint DEFAULT NULL AFTER `order_id`,
  ADD COLUMN `invoice_id` bigint DEFAULT NULL AFTER `receipt_id`,
  ADD COLUMN `reversed_at` datetime DEFAULT NULL AFTER `created_at`,
  ADD KEY `idx_payment_receipt` (`receipt_id`);

CREATE TABLE IF NOT EXISTS `customer_charges` (
  `charge_id` int NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `kind` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'bounce',
  `text` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `paid` decimal(12,2) NOT NULL DEFAULT 0,
  `waived` decimal(12,2) NOT NULL DEFAULT 0,
  `waive_approval_id` bigint DEFAULT NULL,
  `waived_at` datetime DEFAULT NULL,
  `due_on` date NOT NULL,
  `cheque_id` int DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`charge_id`),
  KEY `idx_charge_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `receipt_dues` (
  `alloc_id` bigint NOT NULL AUTO_INCREMENT,
  `receipt_id` bigint NOT NULL,
  `due_kind` varchar(6) COLLATE utf8mb4_unicode_ci NOT NULL,
  `due_id` bigint NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `reversed_at` datetime DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`alloc_id`),
  KEY `idx_rd_receipt` (`receipt_id`),
  KEY `idx_rd_due` (`due_kind`, `due_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cheques` (
  `cheque_id` int NOT NULL AUTO_INCREMENT,
  `receipt_id` bigint NOT NULL,
  `customer_id` int NOT NULL,
  `cheque_no` char(6) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `cheque_date` date NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `status` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'received',
  `deposited_on` date DEFAULT NULL,
  `done_on` date DEFAULT NULL,
  `bounce_why` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `charge_id` int DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`cheque_id`),
  UNIQUE KEY `uq_cheque` (`customer_id`, `cheque_no`),
  KEY `idx_cheque_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `bad_debts` (
  `bad_debt_id` int NOT NULL AUTO_INCREMENT,
  `customer_id` int NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `why` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'waiting',
  `approval_id` bigint DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `done_at` datetime DEFAULT NULL,
  PRIMARY KEY (`bad_debt_id`),
  KEY `idx_bd_customer` (`customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- refunds of a credit balance have no return and no single order
ALTER TABLE `refunds`
  MODIFY `return_id` bigint DEFAULT NULL,
  MODIFY `order_id` bigint DEFAULT NULL,
  ADD COLUMN `refund_no` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `refund_id`,
  ADD COLUMN `customer_id` int DEFAULT NULL AFTER `order_id`,
  ADD COLUMN `why` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `amount`,
  ADD COLUMN `refund_day` date DEFAULT NULL AFTER `why`,
  ADD UNIQUE KEY `uq_refund_no` (`refund_no`);
UPDATE `refunds` f JOIN `orders` o ON o.order_id = f.order_id SET f.customer_id = o.customer_id WHERE f.customer_id IS NULL;

-- ---------------------------------------------------------------- 7. D2: payments become receipts
-- one receipt per payment, numbered by the date it came in within its financial year (DFRC/26-27/0001 ...)
INSERT INTO `receipts` (`receipt_no`, `customer_id`, `amount`, `mode`, `received_on`, `reference`, `note`, `source`, `order_id`, `status`, `emp_id`, `created_at`, `from_payment_id`)
SELECT CONCAT('DFRC/', x.fy_short, '/', LPAD(x.n, 4, '0')), x.customer_id, x.amount, x.mode, x.received_on, x.reference,
       CONCAT('Payment for ', x.order_no, ' (before receipts, phase 21)'), 'migrated', x.order_id, 'ok', x.emp_id, x.created_at, x.payment_id
  FROM (SELECT p.payment_id, o.customer_id, o.order_id, o.order_no, p.amount, p.mode, p.received_on, p.reference, p.emp_id, p.created_at,
               CONCAT(LPAD(MOD(IF(MONTH(p.received_on) >= 4, YEAR(p.received_on), YEAR(p.received_on) - 1), 100), 2, '0'), '-',
                      LPAD(MOD(IF(MONTH(p.received_on) >= 4, YEAR(p.received_on), YEAR(p.received_on) - 1) + 1, 100), 2, '0')) AS fy_short,
               ROW_NUMBER() OVER (PARTITION BY IF(MONTH(p.received_on) >= 4, YEAR(p.received_on), YEAR(p.received_on) - 1) ORDER BY p.received_on, p.payment_id) AS n
          FROM `payments` p JOIN `orders` o ON o.order_id = p.order_id WHERE p.kind = 'payment' AND p.receipt_id IS NULL) x
 ORDER BY x.received_on, x.payment_id;
UPDATE `payments` p JOIN `receipts` r ON r.from_payment_id = p.payment_id
   SET p.receipt_id = r.receipt_id
 WHERE p.kind = 'payment' AND p.receipt_id IS NULL;
UPDATE `payments` p JOIN `invoices` i ON i.order_id = p.order_id AND i.status = 'issued' SET p.invoice_id = i.invoice_id WHERE p.receipt_id IS NOT NULL AND p.invoice_id IS NULL;
INSERT INTO `number_series` (`series_key`, `last_no`)
SELECT CONCAT('DFRC-', IF(MONTH(received_on) >= 4, YEAR(received_on), YEAR(received_on) - 1), '-',
              LPAD(MOD(IF(MONTH(received_on) >= 4, YEAR(received_on), YEAR(received_on) - 1) + 1, 100), 2, '0')), COUNT(*)
  FROM `receipts` WHERE `source` = 'migrated' GROUP BY 1
ON DUPLICATE KEY UPDATE `last_no` = GREATEST(`last_no`, VALUES(`last_no`));
