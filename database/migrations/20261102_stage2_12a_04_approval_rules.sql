-- Stage 2, phase 12a / 04: approval rules in one table (gap map D4), and what the approval engine needs per request.
-- approval_rules: one row per kind - label, section (whose Approve right signs it), on / off, the limit (unit Rs =
-- above an amount, % = above a percent, all = every one), packs (write-off: or above this many packs), locked (can
-- never be switched off: a company bank change, a supplier bank change, weakening a rule). Today's 17 kinds take
-- their on / off and limits from today's Commerce settings, which are then removed; the kinds that always needed
-- approval until now start on. Three locked rules are added for the later phases (company bank, supplier bank,
-- rule change; 12b and the Company / Suppliers screens use them).
-- approvals: the godown of the record, the target (a customer, supplier or payee: requests of one kind for one
-- target within "Days that count together" are added up before the limit), the date of the record (12b's month
-- lock checks it), who may never sign it (e.g. the sender and receiver of a transfer), and for whom a stand-in signed.
-- Commerce settings: approver_role_ids goes (role limits decide now); split_days ("Days that count together") is new.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `approval_rules` (
  `kind` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(150) COLLATE utf8mb4_unicode_ci NOT NULL,
  `section` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_on` tinyint(1) NOT NULL DEFAULT '1',
  `unit` enum('Rs','%','all') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'all',
  `limit_value` decimal(12,2) DEFAULT NULL,
  `limit_packs` int DEFAULT NULL,
  `locked` tinyint(1) NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`kind`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- a setting's value as on / off and as a number (missing setting: the defaults of 20261021_commerce_02_settings.sql)
INSERT INTO `approval_rules` (`kind`, `label`, `section`, `is_on`, `unit`, `limit_value`, `limit_packs`, `locked`, `sort_order`)
SELECT x.kind, x.label, x.section,
       COALESCE((SELECT s.value = '1' FROM commerce_settings s WHERE s.setting_key = x.on_key), x.on_default),
       x.unit,
       CASE WHEN x.val_key IS NULL THEN NULL ELSE COALESCE((SELECT CAST(s.value AS DECIMAL(12,2)) FROM commerce_settings s WHERE s.setting_key = x.val_key), x.val_default) END,
       CASE WHEN x.packs_key IS NULL THEN NULL ELSE COALESCE((SELECT CAST(s.value AS SIGNED) FROM commerce_settings s WHERE s.setting_key = x.packs_key), 20) END,
       x.locked, x.sort_order
  FROM (
    SELECT 'rule_change' AS kind, 'Weaken an approval rule (switch it off or raise its limit)' AS label, 'settings' AS section, NULL AS on_key, 1 AS on_default, 'all' AS unit, NULL AS val_key, NULL AS val_default, NULL AS packs_key, 1 AS locked, 10 AS sort_order
    UNION ALL SELECT 'company_bank', 'Add or change a company bank account, or the default', 'settings', NULL, 1, 'all', NULL, NULL, NULL, 1, 20
    UNION ALL SELECT 'price_below_list', 'Price below the price list', 'products', 'approve_price_below_on', 1, '%', 'approve_price_below_pct', 5, NULL, 0, 30
    UNION ALL SELECT 'supplier_bank', 'Change a supplier''s bank account', 'inventory', NULL, 1, 'all', NULL, NULL, NULL, 1, 40
    UNION ALL SELECT 'write_off', 'Stock write-off', 'inventory', 'approve_writeoff_on', 1, 'Rs', 'approve_writeoff_value_above', 1000, 'approve_writeoff_qty_above', 0, 50
    UNION ALL SELECT 'stock_count', 'Stock take correction', 'inventory', NULL, 1, 'all', NULL, NULL, NULL, 0, 60
    UNION ALL SELECT 'restock', 'Returned stock back to Good', 'inventory', NULL, 1, 'all', NULL, NULL, NULL, 0, 70
    UNION ALL SELECT 'credit_order', 'Order over the credit limit or with overdue invoices', 'customers', 'approve_credit_order', 1, 'all', NULL, NULL, NULL, 0, 80
    UNION ALL SELECT 'customer_hold', 'Order for a customer on hold', 'customers', NULL, 1, 'all', NULL, NULL, NULL, 0, 90
    UNION ALL SELECT 'credit_raise', 'Raising a credit limit', 'customers', 'approve_credit_raise', 1, 'all', NULL, NULL, NULL, 0, 100
    UNION ALL SELECT 'price_list', 'A customer''s own price list (not its type''s)', 'customers', 'approve_price_list', 1, 'all', NULL, NULL, NULL, 0, 110
    UNION ALL SELECT 'customer_merge', 'Merge two customers', 'customers', NULL, 1, 'all', NULL, NULL, NULL, 0, 120
    UNION ALL SELECT 'discount', 'Discount on an order (all discounts together)', 'orders', 'approve_discount_on', 1, '%', 'approve_discount_pct_above', 10, NULL, 0, 130
    UNION ALL SELECT 'over_available', 'Order more than the free stock', 'orders', 'approve_over_available', 1, 'all', NULL, NULL, NULL, 0, 140
    UNION ALL SELECT 'cancel_after_dispatch', 'Cancel after dispatch', 'orders', 'approve_cancel_after_dispatch', 1, 'all', NULL, NULL, NULL, 0, 150
    UNION ALL SELECT 'refund', 'Refund to a customer', 'returns', 'approve_refund_on', 1, 'Rs', 'approve_refund_above', 2000, NULL, 0, 160
    UNION ALL SELECT 'return_window', 'Return outside the return window', 'returns', NULL, 1, 'all', NULL, NULL, NULL, 0, 170
    UNION ALL SELECT 'no_refund', '"No refund" decision on a return', 'returns', 'approve_no_refund', 1, 'all', NULL, NULL, NULL, 0, 180
    UNION ALL SELECT 'goodwill_credit', 'Manual wallet credit', 'promotions', 'approve_goodwill_credit', 1, 'all', NULL, NULL, NULL, 0, 190
    UNION ALL SELECT 'wallet_debit', 'Manual wallet debit', 'promotions', 'approve_goodwill_credit', 1, 'all', NULL, NULL, NULL, 0, 200
  ) x;

DELETE FROM `commerce_settings` WHERE `setting_key` IN ('approve_cancel_after_dispatch', 'approve_credit_order', 'approve_credit_raise', 'approve_discount_on',
  'approve_discount_pct_above', 'approve_goodwill_credit', 'approve_no_refund', 'approve_over_available', 'approve_price_below_on', 'approve_price_below_pct',
  'approve_price_list', 'approve_refund_above', 'approve_refund_on', 'approve_writeoff_on', 'approve_writeoff_qty_above', 'approve_writeoff_value_above',
  'approver_role_ids');
INSERT IGNORE INTO `commerce_settings` (`setting_key`, `grp`, `label`, `help`, `value`, `value_type`, `options`, `tbc`, `sort_order`) VALUES
  ('split_days', 'Approvals', 'Days that count together for a money limit',
   'Requests of the same kind for one customer, supplier or payee (or by one person, when there is no such target) are added up over these days before the limit.',
   '3', 'int', NULL, 0, 25);

-- actions of a Rs rule that went through without approval (under the limit): they count together with later
-- requests of the same kind and target (a split never beats a limit); kept for the "Days that count together"
CREATE TABLE IF NOT EXISTS `approval_directs` (
  `direct_id` bigint NOT NULL AUTO_INCREMENT,
  `kind` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `target` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `done_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `done_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`direct_id`),
  KEY `idx_direct_split` (`kind`, `target`, `done_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `approvals`
  ADD COLUMN `godown_id` int NOT NULL DEFAULT '0' AFTER `section`,
  ADD COLUMN `target` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `ref_id`,
  ADD COLUMN `record_date` date DEFAULT NULL AFTER `target`,
  ADD COLUMN `excluded` json DEFAULT NULL AFTER `payload`,
  ADD COLUMN `decided_via` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `decided_by`;
UPDATE `approvals` SET `godown_id` = 1, `record_date` = DATE(CONVERT_TZ(`requested_at`, '+00:00', '+05:30'));
ALTER TABLE `approvals` ALTER COLUMN `godown_id` DROP DEFAULT, ADD KEY `idx_appr_split` (`kind`, `target`, `status`),
  ADD CONSTRAINT `fk_appr_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`);
