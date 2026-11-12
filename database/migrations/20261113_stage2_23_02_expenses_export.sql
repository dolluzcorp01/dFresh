-- Stage 2, phase 23 / 02: section 17 Expenses, petty cash and the accounting export (v23 working file).
-- a. Rights: a new row "Expenses and accounting export". Sub-admin: everything but delete; Viewer: view; Operations
--    (v23 Supervisor): view and create (records expenses and petty cash; cannot approve or export).
-- b. Approval rules: an expense above Rs 10,000 (counted together per payee within the split days), a new payee (once,
--    v23 L1), a petty cash top-up.
-- c. Numbers: expenses DFX (one series, financial year).
-- d. Heads: whether their GST can be claimed (input credit, with the payee's GSTIN), the CA's ledger name, and the head
--    for a transporter's freight on a purchase order (v23 Y6: its cost is spread over that PO's goods in).
-- e. Payees: one per tax ID (PAN, or the PAN inside a GSTIN) when there is one, else per name; a new one waits for its
--    first approval and is on the list only once approved; a name like one on the list is refused (v23 L1).
-- f. Expenses: draft (made from a repeating one), waiting (approval), done, rejected (back to the maker), cancelled.
-- g. Repeating expenses: a draft each time one falls due ("Make the drafts").
-- h. Petty cash: a box per godown with its float; moves are the opening float, spends (petty cash expenses), top-ups
--    (approval) and counts (book against counted; a difference above Rs 100 shows in Alerts).
-- i. The CA's ledger names in Tally (set once; every export uses them; the expense heads carry their own).
-- j. Export history keeps every file (Tally XML and the voucher CSV) with its totals, so it can be downloaded again.
--    Months exported before (journal CSV) keep their row as it was.
USE dfresh;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- a. rights
INSERT IGNORE INTO `role_permissions` (`role_id`, `section`, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`) VALUES
  (2, 'expenses', 1, 1, 1, 1, 1, 1, 0), (3, 'expenses', 1, 0, 0, 0, 0, 0, 0), (4, 'expenses', 1, 1, 0, 0, 0, 0, 0);

-- ---------------------------------------------------------------- b. approval rules
INSERT IGNORE INTO `approval_rules` (`kind`, `label`, `section`, `is_on`, `unit`, `limit_value`, `limit_packs`, `locked`, `sort_order`) VALUES
  ('expense', 'Expense above the limit', 'expenses', 1, 'Rs', 10000.00, NULL, 0, 190),
  ('payee_new', 'A new payee (approved once)', 'expenses', 1, 'all', NULL, NULL, 0, 191),
  ('petty_topup', 'Petty cash top-up', 'expenses', 1, 'all', NULL, NULL, 0, 192);

-- ---------------------------------------------------------------- c. numbers
INSERT IGNORE INTO `document_series` (`doc_key`, `label`, `prefix`, `fmt`, `per_godown`, `fy_reset`, `digits`, `max_len`, `gst`, `built`, `live`, `section_no`, `start_no`, `sort_order`) VALUES
  ('expense', 'Expense', 'DFX', 'slash', 0, 1, 4, 16, 0, 1, 1, 17, 1, 170);

-- ---------------------------------------------------------------- d. heads
CREATE TABLE IF NOT EXISTS `expense_heads` (
  `head_key` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `itc` tinyint(1) NOT NULL DEFAULT '1',
  `ledger` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `for_po` tinyint(1) NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  PRIMARY KEY (`head_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `expense_heads` (`head_key`, `name`, `itc`, `ledger`, `for_po`, `sort_order`) VALUES
  ('rent', 'Rent', 1, 'Rent', 0, 10), ('power', 'Power (electricity)', 0, 'Electricity Charges', 0, 20), ('fuel', 'Fuel', 0, 'Fuel Expenses', 0, 30),
  ('salary', 'Salaries and wages', 0, 'Salaries', 0, 40), ('vehicle', 'Vehicle repair', 1, 'Vehicle Maintenance', 0, 50),
  ('packing', 'Packing material (not stock)', 1, 'Packing Materials', 0, 60), ('office', 'Office and stationery', 1, 'Printing and Stationery', 0, 70),
  ('marketing', 'Marketing', 1, 'Advertisement', 0, 80), ('bank', 'Bank charges', 1, 'Bank Charges', 0, 90), ('food', 'Food and staff welfare', 0, 'Staff Welfare', 0, 100),
  ('freightin', 'Freight in on a purchase (transporter)', 1, 'Freight Inward', 1, 110), ('other', 'Other', 1, 'Miscellaneous Expenses', 0, 120);

-- ---------------------------------------------------------------- e. payees
CREATE TABLE IF NOT EXISTS `payees` (
  `payee_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name_key` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `pan` char(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gstin` char(15) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `approval_id` bigint DEFAULT NULL,
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `approved_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`payee_id`),
  KEY `idx_payee_key` (`name_key`),
  KEY `idx_payee_pan` (`pan`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- f. expenses
CREATE TABLE IF NOT EXISTS `expenses` (
  `expense_id` int NOT NULL AUTO_INCREMENT,
  `expense_no` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exp_date` date NOT NULL,
  `godown_id` int NOT NULL,
  `head_key` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `payee_id` int DEFAULT NULL,
  `payee_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `gst_rate` decimal(5,2) NOT NULL DEFAULT '0.00',
  `gst_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `total` decimal(12,2) NOT NULL,
  `gstin` char(15) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `itc` tinyint(1) NOT NULL DEFAULT '0',
  `inter_state` tinyint(1) NOT NULL DEFAULT '0',
  `mode` enum('cash','bank','upi','cheque','petty') COLLATE utf8mb4_unicode_ci NOT NULL,
  `reference` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `note` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `po_id` int DEFAULT NULL,
  `repeat_id` int DEFAULT NULL,
  `status` enum('draft','waiting','done','rejected','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'waiting',
  `approval_id` bigint DEFAULT NULL,
  `rej_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cancel_reason` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `photo` mediumblob,
  `photo_type` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `done_at` datetime DEFAULT NULL,
  `done_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`expense_id`),
  UNIQUE KEY `uq_expense_no` (`expense_no`),
  KEY `idx_expense_date` (`exp_date`, `status`),
  KEY `idx_expense_po` (`po_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- g. repeating expenses
CREATE TABLE IF NOT EXISTS `expense_repeats` (
  `repeat_id` int NOT NULL AUTO_INCREMENT,
  `head_key` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `payee_id` int DEFAULT NULL,
  `payee_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `gst_rate` decimal(5,2) NOT NULL DEFAULT '0.00',
  `gstin` char(15) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mode` enum('cash','bank','upi','cheque','petty') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'bank',
  `godown_id` int NOT NULL,
  `day_of_month` tinyint NOT NULL,
  `next_date` date NOT NULL,
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`repeat_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- h. petty cash
CREATE TABLE IF NOT EXISTS `petty_boxes` (
  `godown_id` int NOT NULL,
  `float_amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`godown_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS `petty_moves` (
  `move_id` int NOT NULL AUTO_INCREMENT,
  `godown_id` int NOT NULL,
  `move_date` date NOT NULL,
  `kind` enum('open','spend','topup','count') COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `ask_amount` decimal(12,2) DEFAULT NULL,
  `book` decimal(12,2) DEFAULT NULL,
  `counted` decimal(12,2) DEFAULT NULL,
  `status` enum('done','waiting','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'done',
  `ref` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `expense_id` int DEFAULT NULL,
  `approval_id` bigint DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`move_id`),
  KEY `idx_petty_godown` (`godown_id`, `move_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- i. Tally ledger names
CREATE TABLE IF NOT EXISTS `tally_ledgers` (
  `ledger_key` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `name` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`ledger_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO `tally_ledgers` (`ledger_key`, `label`, `name`, `sort_order`) VALUES
  ('sales', 'Sales', 'Sales Accounts', 10), ('cgst', 'Output CGST', 'Output CGST', 20), ('sgst', 'Output SGST', 'Output SGST', 30), ('igst', 'Output IGST', 'Output IGST', 40),
  ('icgst', 'Input CGST', 'Input CGST', 50), ('isgst', 'Input SGST', 'Input SGST', 60), ('iigst', 'Input IGST', 'Input IGST', 70), ('purchase', 'Purchases', 'Purchase Accounts', 80),
  ('bank', 'Bank', 'HDFC Bank', 90), ('cash', 'Cash', 'Cash', 100), ('petty', 'Petty cash', 'Petty Cash', 110), ('round', 'Round off', 'Round Off', 120),
  ('freight', 'Delivery charges', 'Freight Outward', 130), ('writeoff', 'Stock written off', 'Stock Written Off', 140), ('wallet', 'Wallet discount', 'Customer Wallet Discount', 150),
  ('walletliab', 'Customer wallets (owed)', 'Customer Wallets', 160), ('charges', 'Bounce charges', 'Cheque Bounce Charges', 170), ('baddebt', 'Bad debts', 'Bad Debts', 180);

-- ---------------------------------------------------------------- j. export history with its files
ALTER TABLE `month_exports`
  ADD COLUMN `vouchers` int DEFAULT NULL AFTER `lines`,
  ADD COLUMN `totals` json DEFAULT NULL AFTER `vouchers`,
  ADD COLUMN `xml_name` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `totals`,
  ADD COLUMN `xml_body` mediumtext COLLATE utf8mb4_unicode_ci AFTER `xml_name`,
  ADD COLUMN `csv_body` mediumtext COLLATE utf8mb4_unicode_ci AFTER `xml_body`,
  ADD COLUMN `times` int NOT NULL DEFAULT '1' AFTER `csv_body`;
