-- Stage 2, phase 17 / 01: section 4 Production, to the v23 working file (docs/claude-tasks/phase-17).
-- Existing stock, batches and average cost do not change (two columns get wider; every value stays the same).
-- 1. Stock quantities with decimals: a reel is issued by the kilo (49.92 kg). Packs stay whole (the code checks it).
--    The average cost keeps 6 decimals, so every paisa of a run's cost stays in the stock value (stock value before +
--    run cost = stock value after + losses, to the paise; v23 PD2 keeps 4); screens and documents show 2 decimals.
-- 2. Machines (godown, the categories they make, packs per hour, working or stopped with a reason).
-- 3. Recipes: dated versions per made pack (one batch makes n packs; raw material per batch; allowed wastage %;
--    labour and power per pack); a change from tomorrow waits for approval (rule recipe); the version in force on
--    a run's day is used.
-- 4. Production runs (DFM/26-27/0001): planned, started (materials issued from Good), finished (packs made,
--    material used and returned, to QC hold), cancelled; wastage per input against the recipe and its approval
--    (rule prod_scrap); a finish with less material than the recipe waits and nothing moves until it is signed;
--    production QC with the normal loss (within the recipe %, written off at Rs 0, cost in the passed packs) and the
--    abnormal loss (above it, written off at cost with approval; rejected: back to QC hold to "Check again").
-- 5. Write-offs remember their run and kind of loss; a production QC reject is its own reason ("prodqc").
-- 6. Rights: a "Production" row in the roles grid (v23 section 4): Sub-admin everything, Viewer view, Operations
--    view / create / edit / approve (v23 Supervisor), Warehouse view / create (plan, start, finish runs).
-- 7. Approval rules (v23): "Change a recipe" (every change) and "Production wastage above the recipe" (5%).
-- 8. The production run series is issued from now on.
USE dfresh;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- 1. quantities with decimals, a finer average
ALTER TABLE `stock_movements` MODIFY `delta` decimal(12,3) NOT NULL;
ALTER TABLE `skus` MODIFY `avg_cost` decimal(14,6) DEFAULT NULL;

-- ---------------------------------------------------------------- 2. machines
CREATE TABLE IF NOT EXISTS `machines` (
  `machine_id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL,
  `godown_id` int NOT NULL,
  `makes` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `per_hour` int NOT NULL,
  `status` enum('active','stopped') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `stop_reason` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`machine_id`),
  UNIQUE KEY `uq_machine_name` (`name`),
  CONSTRAINT `fk_machine_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 3. recipes
CREATE TABLE IF NOT EXISTS `recipe_versions` (
  `rv_id` int NOT NULL AUTO_INCREMENT,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ver` int NOT NULL,
  `from_date` date NOT NULL,
  `out_packs` int NOT NULL,
  `waste_pct` decimal(5,2) NOT NULL,
  `labour` decimal(10,2) NOT NULL DEFAULT '0.00',
  `power` decimal(10,2) NOT NULL DEFAULT '0.00',
  `status` enum('active','waiting','rejected') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `approval_id` bigint DEFAULT NULL,
  `decided_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`rv_id`),
  UNIQUE KEY `uq_recipe_ver` (`sku_code`, `ver`),
  CONSTRAINT `fk_recipe_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- the first line is the main material (the reel, in kg)
CREATE TABLE IF NOT EXISTS `recipe_lines` (
  `rv_id` int NOT NULL,
  `line_no` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` decimal(12,3) NOT NULL,
  PRIMARY KEY (`rv_id`, `line_no`),
  CONSTRAINT `fk_recline_rv` FOREIGN KEY (`rv_id`) REFERENCES `recipe_versions` (`rv_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_recline_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 4. production runs
CREATE TABLE IF NOT EXISTS `production_runs` (
  `run_id` int NOT NULL AUTO_INCREMENT,
  `run_no` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `godown_id` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` int NOT NULL,
  `machine_id` int NOT NULL,
  `run_date` date NOT NULL,
  `shift` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `operator` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_auto` tinyint(1) NOT NULL DEFAULT '0',
  `status` enum('planned','started','done','cancelled') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'planned',
  `rv_id` int DEFAULT NULL,
  `batch_no` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `batch_id` bigint DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `ended_at` datetime DEFAULT NULL,
  `out_qty` int DEFAULT NULL,
  `scrap_kg` decimal(10,2) DEFAULT NULL,
  `reason` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `mat_cost` decimal(14,4) DEFAULT NULL,
  `run_cost` decimal(14,2) DEFAULT NULL,
  `unit_made` decimal(12,4) DEFAULT NULL,
  `wst` enum('ok','waiting','approved','rejected') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `wst_approval_id` bigint DEFAULT NULL,
  `wst_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `fin_json` json DEFAULT NULL,
  `fin_approval_id` bigint DEFAULT NULL,
  `fin_note` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qc` enum('hold','passed') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qc_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `qc_at` datetime DEFAULT NULL,
  `acc` int DEFAULT NULL,
  `rej` int DEFAULT NULL,
  `rej_allow` int DEFAULT NULL,
  `rej_normal` int DEFAULT NULL,
  `rej_abnormal` int DEFAULT NULL,
  `abnormal_value` decimal(12,2) DEFAULT NULL,
  `unit_passed` decimal(12,4) DEFAULT NULL,
  `wo_normal` bigint DEFAULT NULL,
  `wo_abnormal` bigint DEFAULT NULL,
  `recheck_qty` int DEFAULT NULL,
  `recheck_value` decimal(12,2) DEFAULT NULL,
  `recheck_note` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `uncosted_qty` int DEFAULT NULL,
  `uncosted_unit` decimal(12,4) DEFAULT NULL,
  `cancel_reason` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `cancelled_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`run_id`),
  UNIQUE KEY `uq_run_no` (`run_no`),
  KEY `idx_run_status` (`status`, `godown_id`),
  CONSTRAINT `fk_run_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`),
  CONSTRAINT `fk_run_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`),
  CONSTRAINT `fk_run_machine` FOREIGN KEY (`machine_id`) REFERENCES `machines` (`machine_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- what a run took from Good at its start (at the average cost then: cost per unit), and what it really used at its finish
CREATE TABLE IF NOT EXISTS `run_materials` (
  `run_id` int NOT NULL,
  `line_no` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `issued` decimal(12,3) NOT NULL,
  `used` decimal(12,3) DEFAULT NULL,
  `cost` decimal(14,6) DEFAULT NULL,
  PRIMARY KEY (`run_id`, `line_no`),
  CONSTRAINT `fk_runmat_run` FOREIGN KEY (`run_id`) REFERENCES `production_runs` (`run_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_runmat_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 5. write-offs of a run
ALTER TABLE `write_offs`
  ADD COLUMN `run_id` int DEFAULT NULL AFTER `approval_id`,
  ADD COLUMN `loss` enum('normal','abnormal','recheck') COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `run_id`,
  ADD KEY `idx_wo_run` (`run_id`);

-- ---------------------------------------------------------------- 6. rights
INSERT IGNORE INTO `role_permissions` (`role_id`, `section`, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`)
SELECT `role_id`, 'production', `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`
  FROM `role_permissions` WHERE `section` = 'inventory' AND `role_id` IN (2, 3);
INSERT INTO `role_permissions` (`role_id`, `section`, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`)
VALUES (4, 'production', 1, 1, 1, 1, 0, 0, 0), (5, 'production', 1, 1, 0, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE `can_view` = 1;

-- ---------------------------------------------------------------- 7. approval rules
INSERT IGNORE INTO `approval_rules` (`kind`, `label`, `section`, `is_on`, `unit`, `limit_value`, `limit_packs`, `locked`, `sort_order`) VALUES
  ('recipe', 'Change a recipe', 'production', 1, 'all', NULL, NULL, 0, 45),
  ('prod_scrap', 'Production wastage above the recipe', 'production', 1, '%', 5.00, NULL, 0, 46);

-- ---------------------------------------------------------------- 8. numbering
UPDATE `document_series` SET `live` = 1 WHERE `doc_key` = 'production';
