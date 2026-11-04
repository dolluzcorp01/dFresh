-- Stage 2, phase 16 / 01: section 3 Suppliers and buying, to the v23 working file (docs/claude-tasks/phase-16).
-- Existing stock, batches and average cost do not change: no stock movement and no skus row is touched here.
-- 1. Suppliers (v23): a code (SUP-0001), what they supply, status (active, on hold, blocked with a reason), GSTIN with
--    the address state, MSME (Udyam, type), address, payment terms, opening amount, supplier credit, notes, up to 3
--    contacts, the items they sell (their code, price, lead days, minimum order, paper spec) and the APPROVED bank
--    account. A new or changed account waits for a second Admin (kind supplier_bank, never overridden); its details
--    ride in that request until signed. The two suppliers of today keep their name and GSTIN; phone and address move
--    to the new fields (main contact, address line 1, town).
-- 2. Indents, purchase orders (draft, waiting, open, closed short, cancelled, rejected; revisions; the one amendment
--    waiting), goods in (to QC hold), supplier bills (three-way match, freight), claims (debit note, return challan,
--    replacement or credit note), supplier payments (against bills, approved bank only) and cost adjustments (bill
--    against PO, freight true-up; the part on packs already sold goes to cost of sales).
-- 3. Rights: "Suppliers and buying" and "Payments" rows in the roles grid (v23 sections 3 and 11; owner decision of
--    4 Nov 2026). Sub-admin everything, Viewer view, Operations buying view / create / edit (v23 Supervisor), Warehouse
--    buying view / create (indents, goods in). Payments: Sub-admin and Viewer only for now.
-- 4. Approval rules (v23): purchase order above Rs 50,000 (orders to one supplier count together), bill price differs
--    from the PO, goods in beyond the 2% tolerance, goods in without a PO, pay a supplier above Rs 25,000, and the
--    customer change rule (a customer type moved to another price list; phase 15 carry-over). The supplier bank rule
--    moves to the buying row.
-- 1b. A raw material gets its own HSN code (v23), for the GST on its purchase.
-- 5. Switches (Stock): goods in wait in QC hold, freight goes into the average cost, days to claim after QC.
-- 6. Numbering: indent, PO, goods in, supplier bill, supplier code, debit note and return challan are issued from
--    now on; claim (CL-0001) and supplier payment (DFV) are new series.
USE dfresh;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- 1. suppliers
ALTER TABLE `suppliers`
  ADD COLUMN `code` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `supplier_id`,
  ADD COLUMN `kinds` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'raw' AFTER `name`,
  ADD COLUMN `status` enum('active','hold','blocked') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active' AFTER `kinds`,
  ADD COLUMN `block_reason` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `status`,
  ADD COLUMN `state_code` char(2) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `gstin`,
  ADD COLUMN `msme_type` enum('Micro','Small','Medium') COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `state_code`,
  ADD COLUMN `udyam` varchar(19) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `msme_type`,
  ADD COLUMN `addr_l1` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `udyam`,
  ADD COLUMN `addr_l2` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `addr_l1`,
  ADD COLUMN `city` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `addr_l2`,
  ADD COLUMN `pin` char(6) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `city`,
  ADD COLUMN `map_query` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `pin`,
  ADD COLUMN `pickup` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `map_query`,
  ADD COLUMN `terms_days` int NOT NULL DEFAULT '30' AFTER `pickup`,
  ADD COLUMN `opening_owed` decimal(12,2) NOT NULL DEFAULT '0.00' AFTER `terms_days`,
  ADD COLUMN `credit` decimal(12,2) NOT NULL DEFAULT '0.00' AFTER `opening_owed`,
  ADD COLUMN `notes` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `credit`,
  ADD COLUMN `bank_holder` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `notes`,
  ADD COLUMN `bank_name` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `bank_holder`,
  ADD COLUMN `bank_branch` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `bank_name`,
  ADD COLUMN `bank_acc` varchar(18) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `bank_branch`,
  ADD COLUMN `bank_ifsc` char(11) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `bank_acc`,
  ADD COLUMN `bank_type` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `bank_ifsc`,
  ADD COLUMN `since` date DEFAULT NULL AFTER `bank_type`,
  ADD COLUMN `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  ADD COLUMN `updated_at` datetime DEFAULT NULL;

CREATE TABLE IF NOT EXISTS `supplier_contacts` (
  `supplier_id` int NOT NULL,
  `pos` tinyint NOT NULL,
  `name` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `role` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `email` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `whatsapp` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`supplier_id`, `pos`),
  CONSTRAINT `fk_supcontact_sup` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- today's suppliers: a code in the order they were added, the state from the GSTIN, the old phone as the main contact
-- and the old address as line 1 (the town is its last part); everything else is filled in on the Suppliers page
UPDATE `suppliers` SET
  `code` = CONCAT('SUP-', LPAD(`supplier_id`, 4, '0')),
  `state_code` = IF(`gstin` REGEXP '^[0-9]{2}', LEFT(`gstin`, 2), NULL),
  `addr_l1` = LEFT(`address`, 100),
  `city` = NULLIF(LEFT(TRIM(SUBSTRING_INDEX(`address`, ',', -1)), 40), ''),
  `status` = IF(`is_active` = 1, 'active', 'blocked'),
  `block_reason` = IF(`is_active` = 1, NULL, 'Marked inactive before phase 16'),
  `since` = DATE(`created_at`);
INSERT IGNORE INTO `supplier_contacts` (`supplier_id`, `pos`, `name`, `phone`)
SELECT `supplier_id`, 0, NULL, `phone` FROM `suppliers` WHERE `phone` IS NOT NULL AND `phone` <> '';
ALTER TABLE `suppliers` DROP COLUMN `phone`, DROP COLUMN `address`, DROP COLUMN `is_active`, ADD UNIQUE KEY `uq_supplier_code` (`code`);
INSERT INTO `number_series` (`series_key`, `last_no`)
SELECT 'SUP', COALESCE(MAX(`supplier_id`), 0) FROM `suppliers` HAVING COUNT(*) > 0
ON DUPLICATE KEY UPDATE `last_no` = GREATEST(`last_no`, VALUES(`last_no`));

CREATE TABLE IF NOT EXISTS `supplier_items` (
  `supplier_id` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `their_code` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `price` decimal(10,2) NOT NULL,
  `lead_days` int NOT NULL DEFAULT '0',
  `moq` int NOT NULL DEFAULT '1',
  `spec_gsm` decimal(5,1) DEFAULT NULL,
  `spec_ply` tinyint DEFAULT NULL,
  `spec_width` int DEFAULT NULL,
  PRIMARY KEY (`supplier_id`, `sku_code`),
  KEY `fk_supitem_sku` (`sku_code`),
  CONSTRAINT `fk_supitem_sup` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_supitem_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- a raw material's HSN code (v23: every raw material has one; the GST on its purchase comes from that code's rate on
-- the day). A pack takes its product's HSN as before. Empty until set in Masters > Catalogue > Raw materials.
ALTER TABLE `skus` ADD COLUMN `raw_hsn` varchar(8) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `raw_name`;

-- ---------------------------------------------------------------- 2. indents
CREATE TABLE IF NOT EXISTS `indents` (
  `indent_id` int NOT NULL AUTO_INCREMENT,
  `indent_no` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `godown_id` int NOT NULL,
  `need_by` date NOT NULL,
  `reason` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('open','approved','po','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'open',
  `is_auto` tinyint(1) NOT NULL DEFAULT '0',
  `po_id` int DEFAULT NULL,
  `requested_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `requested_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decided_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decided_at` datetime DEFAULT NULL,
  `reject_reason` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`indent_id`),
  UNIQUE KEY `uq_indent_no` (`indent_no`),
  KEY `idx_indent_status` (`status`, `godown_id`),
  CONSTRAINT `fk_indent_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `indent_lines` (
  `indent_id` int NOT NULL,
  `line_no` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` int NOT NULL,
  PRIMARY KEY (`indent_id`, `line_no`),
  KEY `fk_indline_sku` (`sku_code`),
  CONSTRAINT `fk_indline_indent` FOREIGN KEY (`indent_id`) REFERENCES `indents` (`indent_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_indline_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 2. purchase orders
-- po_no is given when the order is raised (a draft has none, so the series has no gaps); freight_cost = the freight in
-- the stock cost so far (the PO estimate spread at QC, trued up to the billed freight at the PO's last bill)
CREATE TABLE IF NOT EXISTS `purchase_orders` (
  `po_id` int NOT NULL AUTO_INCREMENT,
  `po_no` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `draft_no` int DEFAULT NULL,
  `supplier_id` int NOT NULL,
  `godown_id` int NOT NULL,
  `status` enum('draft','waiting','open','closed','cancelled','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `rev` int NOT NULL DEFAULT '1',
  `po_date` date DEFAULT NULL,
  `expected_on` date NOT NULL,
  `freight` decimal(10,2) NOT NULL DEFAULT '0.00',
  `terms` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `indent_id` int DEFAULT NULL,
  `approval_id` bigint DEFAULT NULL,
  `raised_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `raised_at` datetime DEFAULT NULL,
  `approved_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sent_at` datetime DEFAULT NULL,
  `end_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `end_reason` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ended_at` datetime DEFAULT NULL,
  `freight_cost` decimal(12,2) NOT NULL DEFAULT '0.00',
  `freight_billed` tinyint(1) NOT NULL DEFAULT '0',
  `freight_sep` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`po_id`),
  UNIQUE KEY `uq_po_no` (`po_no`),
  KEY `idx_po_status` (`status`, `godown_id`),
  KEY `idx_po_supplier` (`supplier_id`, `po_date`),
  CONSTRAINT `fk_po_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`),
  CONSTRAINT `fk_po_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- the lines of the last APPROVED revision (goods in and bills use only these); credited = packs settled by a credit
-- note (not expected any more)
CREATE TABLE IF NOT EXISTS `po_lines` (
  `po_id` int NOT NULL,
  `line_no` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` int NOT NULL,
  `rate` decimal(10,2) NOT NULL,
  `disc_pct` decimal(5,2) NOT NULL DEFAULT '0.00',
  `credited` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`po_id`, `sku_code`),
  KEY `fk_poline_sku` (`sku_code`),
  CONSTRAINT `fk_poline_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`po_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_poline_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- earlier revisions (kind old) and rejected amendments (kind rejected), kept for the history
CREATE TABLE IF NOT EXISTS `po_revisions` (
  `rev_id` int NOT NULL AUTO_INCREMENT,
  `po_id` int NOT NULL,
  `rev` int NOT NULL,
  `kind` enum('old','rejected') COLLATE utf8mb4_unicode_ci NOT NULL,
  `rev_lines` json NOT NULL,
  `freight` decimal(10,2) NOT NULL DEFAULT '0.00',
  `expected_on` date NOT NULL,
  `terms` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`rev_id`),
  KEY `idx_porev_po` (`po_id`, `rev`),
  CONSTRAINT `fk_porev_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`po_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- the one amendment waiting for approval (the PO stays at its approved revision until it is signed)
CREATE TABLE IF NOT EXISTS `po_amendments` (
  `po_id` int NOT NULL,
  `rev` int NOT NULL,
  `rev_lines` json NOT NULL,
  `freight` decimal(10,2) NOT NULL DEFAULT '0.00',
  `expected_on` date NOT NULL,
  `terms` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `approval_id` bigint NOT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`po_id`),
  CONSTRAINT `fk_poam_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`po_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 2. goods in
CREATE TABLE IF NOT EXISTS `goods_ins` (
  `grn_id` int NOT NULL AUTO_INCREMENT,
  `grn_no` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `godown_id` int NOT NULL,
  `supplier_id` int NOT NULL,
  `po_id` int DEFAULT NULL,
  `challan_no` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `vehicle_no` varchar(14) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `received_on` date NOT NULL,
  `status` enum('waiting','qc','done','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'qc',
  `approval_id` bigint DEFAULT NULL,
  `why` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qc_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qc_at` datetime DEFAULT NULL,
  `qc_note` varchar(160) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `for_claim_id` int DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`grn_id`),
  UNIQUE KEY `uq_grn_no` (`grn_no`),
  KEY `idx_grn_status` (`status`, `godown_id`),
  KEY `idx_grn_po` (`po_id`),
  KEY `idx_grn_challan` (`supplier_id`, `challan_no`),
  CONSTRAINT `fk_grn_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`),
  CONSTRAINT `fk_grn_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`),
  CONSTRAINT `fk_grn_po` FOREIGN KEY (`po_id`) REFERENCES `purchase_orders` (`po_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- rate: the rate typed on goods with no PO; acc / rej after Quality check; unit_cost = the landed cost per unit that
-- went into the average (rate less discount plus the line's share of the PO freight)
CREATE TABLE IF NOT EXISTS `goods_in_lines` (
  `line_id` int NOT NULL AUTO_INCREMENT,
  `grn_id` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ordered` int DEFAULT NULL,
  `recv` int NOT NULL,
  `cartons` int DEFAULT NULL,
  `reels` int DEFAULT NULL,
  `batch_id` bigint DEFAULT NULL,
  `batch_no` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mfg_date` date DEFAULT NULL,
  `expiry_date` date DEFAULT NULL,
  `rate` decimal(10,2) DEFAULT NULL,
  `acc` int DEFAULT NULL,
  `rej` int DEFAULT NULL,
  `reason` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gsm` decimal(5,1) DEFAULT NULL,
  `deviation` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `unit_cost` decimal(10,2) DEFAULT NULL,
  `avg_before` decimal(10,2) DEFAULT NULL,
  `avg_after` decimal(10,2) DEFAULT NULL,
  PRIMARY KEY (`line_id`),
  KEY `idx_grnline_grn` (`grn_id`),
  KEY `fk_grnline_sku` (`sku_code`),
  CONSTRAINT `fk_grnline_grn` FOREIGN KEY (`grn_id`) REFERENCES `goods_ins` (`grn_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_grnline_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`),
  CONSTRAINT `fk_grnline_batch` FOREIGN KEY (`batch_id`) REFERENCES `batches` (`batch_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 2. supplier bills
CREATE TABLE IF NOT EXISTS `supplier_bills` (
  `bill_id` int NOT NULL AUTO_INCREMENT,
  `bill_no` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `supplier_bill_no` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `supplier_id` int NOT NULL,
  `godown_id` int NOT NULL,
  `bill_date` date NOT NULL,
  `due_date` date NOT NULL,
  `taxable` decimal(12,2) NOT NULL DEFAULT '0.00',
  `freight` decimal(10,2) NOT NULL DEFAULT '0.00',
  `gst` decimal(12,2) NOT NULL DEFAULT '0.00',
  `inter_state` tinyint(1) NOT NULL DEFAULT '0',
  `round_off` decimal(8,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL,
  `paid` decimal(12,2) NOT NULL DEFAULT '0.00',
  `freight_sep` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('waiting','unpaid','part','paid','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'unpaid',
  `approval_id` bigint DEFAULT NULL,
  `cost_done` tinyint(1) NOT NULL DEFAULT '0',
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`bill_id`),
  UNIQUE KEY `uq_bill_no` (`bill_no`),
  KEY `idx_bill_supplier` (`supplier_id`, `status`),
  KEY `idx_bill_their` (`supplier_id`, `supplier_bill_no`),
  CONSTRAINT `fk_bill_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`),
  CONSTRAINT `fk_bill_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- po_rate: the approved PO rate the line was matched to (NULL = goods with no PO)
CREATE TABLE IF NOT EXISTS `supplier_bill_lines` (
  `bill_id` int NOT NULL,
  `line_no` int NOT NULL,
  `grn_id` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` int NOT NULL,
  `rate` decimal(10,2) NOT NULL,
  `po_rate` decimal(10,2) DEFAULT NULL,
  `gst_rate` decimal(5,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`bill_id`, `line_no`),
  KEY `idx_billline_grn` (`grn_id`, `sku_code`),
  CONSTRAINT `fk_billline_bill` FOREIGN KEY (`bill_id`) REFERENCES `supplier_bills` (`bill_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_billline_grn` FOREIGN KEY (`grn_id`) REFERENCES `goods_ins` (`grn_id`),
  CONSTRAINT `fk_billline_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 2. claims and purchase returns
CREATE TABLE IF NOT EXISTS `claims` (
  `claim_id` int NOT NULL AUTO_INCREMENT,
  `claim_no` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL,
  `supplier_id` int NOT NULL,
  `grn_id` int NOT NULL,
  `po_id` int DEFAULT NULL,
  `godown_id` int NOT NULL,
  `outcome` enum('replace','credit') COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('draft','issued','returned','settled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft',
  `debit_no` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `challan_no` varchar(24) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `returned_at` datetime DEFAULT NULL,
  `cn_no` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cn_amount` decimal(12,2) DEFAULT NULL,
  `cn_date` date DEFAULT NULL,
  `cn_set` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_late` tinyint(1) NOT NULL DEFAULT '0',
  `note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `settled_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `settled_at` datetime DEFAULT NULL,
  PRIMARY KEY (`claim_id`),
  UNIQUE KEY `uq_claim_no` (`claim_no`),
  KEY `idx_claim_status` (`status`, `godown_id`),
  CONSTRAINT `fk_claim_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`),
  CONSTRAINT `fk_claim_grn` FOREIGN KEY (`grn_id`) REFERENCES `goods_ins` (`grn_id`),
  CONSTRAINT `fk_claim_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `claim_lines` (
  `claim_id` int NOT NULL,
  `line_no` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` int NOT NULL,
  `rate` decimal(10,2) NOT NULL,
  `reason` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `batch_id` bigint DEFAULT NULL,
  PRIMARY KEY (`claim_id`, `line_no`),
  CONSTRAINT `fk_claimline_claim` FOREIGN KEY (`claim_id`) REFERENCES `claims` (`claim_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_claimline_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 2. supplier payments and what settles a bill
CREATE TABLE IF NOT EXISTS `supplier_payments` (
  `pay_id` int NOT NULL AUTO_INCREMENT,
  `pay_no` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `supplier_id` int NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `mode` enum('upi','bank','cheque') COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `paid_on` date NOT NULL,
  `to_acc` varchar(18) COLLATE utf8mb4_unicode_ci NOT NULL,
  `to_ifsc` char(11) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('waiting','paid','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'waiting',
  `approval_id` bigint DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `paid_at` datetime DEFAULT NULL,
  PRIMARY KEY (`pay_id`),
  UNIQUE KEY `uq_spay_no` (`pay_no`),
  KEY `idx_spay_supplier` (`supplier_id`, `status`),
  CONSTRAINT `fk_spay_supplier` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`supplier_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `supplier_payment_lines` (
  `pay_id` int NOT NULL,
  `bill_id` int NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  PRIMARY KEY (`pay_id`, `bill_id`),
  CONSTRAINT `fk_spayline_pay` FOREIGN KEY (`pay_id`) REFERENCES `supplier_payments` (`pay_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_spayline_bill` FOREIGN KEY (`bill_id`) REFERENCES `supplier_bills` (`bill_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- a supplier credit note (or credit waiting from one) set against a bill
CREATE TABLE IF NOT EXISTS `bill_credits` (
  `credit_id` int NOT NULL AUTO_INCREMENT,
  `bill_id` int NOT NULL,
  `ref` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `claim_id` int DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`credit_id`),
  KEY `idx_billcredit_bill` (`bill_id`),
  CONSTRAINT `fk_billcredit_bill` FOREIGN KEY (`bill_id`) REFERENCES `supplier_bills` (`bill_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 2. cost adjustments (bill against PO, freight)
-- value_stock moved the average of the packs still in stock; value_cos went to cost of sales (packs already sold)
CREATE TABLE IF NOT EXISTS `cost_adjustments` (
  `adj_id` int NOT NULL AUTO_INCREMENT,
  `src_type` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `src_id` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `godown_id` int NOT NULL,
  `adj_date` date NOT NULL,
  `why` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `avg_before` decimal(10,2) DEFAULT NULL,
  `avg_after` decimal(10,2) DEFAULT NULL,
  `value_stock` decimal(12,2) NOT NULL DEFAULT '0.00',
  `value_cos` decimal(12,2) NOT NULL DEFAULT '0.00',
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`adj_id`),
  KEY `idx_costadj_src` (`src_type`, `src_id`),
  KEY `idx_costadj_sku` (`sku_code`, `adj_date`),
  CONSTRAINT `fk_costadj_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 3. rights
INSERT IGNORE INTO `role_permissions` (`role_id`, `section`, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`)
SELECT `role_id`, s.sec, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`
  FROM `role_permissions` JOIN (SELECT 'buying' AS sec UNION ALL SELECT 'money') s
 WHERE `section` = 'inventory' AND `role_id` IN (2, 3);
INSERT INTO `role_permissions` (`role_id`, `section`, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`)
VALUES (4, 'buying', 1, 1, 1, 0, 0, 0, 0), (5, 'buying', 1, 1, 0, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE `can_view` = 1;

-- ---------------------------------------------------------------- 4. approval rules
INSERT IGNORE INTO `approval_rules` (`kind`, `label`, `section`, `is_on`, `unit`, `limit_value`, `limit_packs`, `locked`, `sort_order`) VALUES
  ('po', 'Purchase order', 'buying', 1, 'Rs', 50000.00, NULL, 0, 41),
  ('bill_diff', 'Supplier bill price differs from the PO', 'buying', 1, 'all', NULL, NULL, 0, 42),
  ('excess_in', 'Goods in beyond the delivery tolerance', 'buying', 1, '%', 2.00, NULL, 0, 43),
  ('no_po_in', 'Goods in without a purchase order', 'buying', 1, 'all', NULL, NULL, 0, 44),
  ('supplier_pay', 'Pay a supplier', 'money', 1, 'Rs', 25000.00, NULL, 0, 155),
  ('cust_change', 'Put a customer type on another price list', 'customers', 1, 'all', NULL, NULL, 0, 95);
UPDATE `approval_rules` SET `section` = 'buying', `sort_order` = 40 WHERE `kind` = 'supplier_bank';
UPDATE `approvals` SET `section` = 'buying' WHERE `kind` = 'supplier_bank';

-- ---------------------------------------------------------------- 5. switches (Stock)
INSERT IGNORE INTO `commerce_settings` (`setting_key`, `grp`, `label`, `help`, `value`, `value_type`, `options`, `tbc`, `sort_order`, `sw_group`, `sw_unit`, `sw_example`, `sw_sort`) VALUES
  ('quarantine', 'Inventory', 'Goods in wait in QC hold until checked', 'Arrivals cannot be sold or used until Quality check passes them.', '1', 'bool', NULL, 0, 60, 'Stock', NULL,
   'Example: a lorry brings 480 packs. With this On, they land in QC hold and nobody can sell them until a supervisor checks them in Purchase > Quality check. Off: they are passed the moment they are counted in.', 40),
  ('freight_cost', 'Inventory', 'Freight goes into the average cost', 'Freight on a purchase order is spread over its lines by value, so the stock cost includes it.', '1', 'bool', NULL, 0, 61, 'Stock', NULL,
   'Example: a PO for Rs 70,000 of reels and cores pays Rs 1,400 freight (2%). With this On, a Rs 72 kg of reel costs Rs 73.44 in stock. Off: it stays Rs 72 and freight is only an expense.', 50),
  ('claim_days', 'Inventory', 'Days to claim faulty goods after QC', 'Goods found faulty after Quality check passed them can still go back to the supplier on a claim within these days.', '15', 'int', NULL, 0, 62, 'Stock', 'days',
   'Example: set to 15. A reel found wet inside 10 days after it was passed goes back on a claim and debit note.', 60);

-- ---------------------------------------------------------------- 6. numbering
UPDATE `document_series` SET `live` = 1 WHERE `doc_key` IN ('indent', 'po', 'grn', 'pbill', 'supplier', 'debit', 'challan');
INSERT IGNORE INTO `document_series` (`doc_key`, `label`, `prefix`, `fmt`, `per_godown`, `fy_reset`, `digits`, `max_len`, `gst`, `built`, `live`, `section_no`, `start_no`, `sort_order`) VALUES
  ('claim', 'Purchase claim', 'CL', 'plain', 0, 0, 4, 12, 0, 0, 1, 3, 1, 105),
  ('spay', 'Supplier payment', 'DFV', 'slash', 0, 1, 4, 24, 0, 0, 1, 11, 1, 125);
