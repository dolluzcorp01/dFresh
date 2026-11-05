-- Stage 2, phase 18 / 01: section 5 Inventory, to the v23 working file (docs/claude-tasks/phase-18).
-- Existing stock, batches and average cost do not change.
-- 1. A shelf "On the road" (road): a transfer takes stock off the sender's Good shelf into the lorry; it still counts
--    in the company total until the receiver counts it in.
-- 2. Transfers between godowns (DFT, the godown's code in the number): from, to, vehicle, driver, e-way bill, value
--    at cost, sent by, received by; lines with the batches loaded and the quantity counted in. A short receipt sits on
--    the Disputed shelf until its loss is decided (rule transit_loss: the sender and the receiver never sign it).
-- 3. Write-offs also hold shelf moves (kind move, to a shelf) and remember the transfer they settle.
-- 4. Stock take counts with decimals (raw materials are counted by the kilo).
-- 5. Approval rule "Short receipt on a transfer" (every short, v23).
USE dfresh;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- 1. on the road
ALTER TABLE `stock_movements` MODIFY `stock_kind` enum('good','hold','dmg','ret','rej','disp','road') COLLATE utf8mb4_unicode_ci NOT NULL;

-- ---------------------------------------------------------------- 2. transfers
CREATE TABLE IF NOT EXISTS `transfers` (
  `transfer_id` int NOT NULL AUTO_INCREMENT,
  `transfer_no` varchar(24) COLLATE utf8mb4_unicode_ci NOT NULL,
  `from_godown` int NOT NULL,
  `to_godown` int NOT NULL,
  `vehicle_no` varchar(14) COLLATE utf8mb4_unicode_ci NOT NULL,
  `driver` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ewb_no` varchar(12) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `value` decimal(14,2) DEFAULT NULL,
  `status` enum('transit','received','short') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'transit',
  `sent_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `sent_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `recv_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `recv_at` datetime DEFAULT NULL,
  `loss` enum('waiting','approved','rejected') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `loss_text` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `loss_value` decimal(14,2) DEFAULT NULL,
  `loss_approval_id` bigint DEFAULT NULL,
  `loss_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`transfer_id`),
  UNIQUE KEY `uq_transfer_no` (`transfer_no`),
  KEY `idx_transfer_status` (`status`),
  CONSTRAINT `fk_tr_from` FOREIGN KEY (`from_godown`) REFERENCES `locations` (`location_id`),
  CONSTRAINT `fk_tr_to` FOREIGN KEY (`to_godown`) REFERENCES `locations` (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- lots: the batches loaded, [{ batch_id, batch_no, qty }], earliest expiry first
CREATE TABLE IF NOT EXISTS `transfer_lines` (
  `transfer_id` int NOT NULL,
  `line_no` int NOT NULL,
  `sku_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `qty` decimal(12,3) NOT NULL,
  `recv` decimal(12,3) DEFAULT NULL,
  `lots` json NOT NULL,
  PRIMARY KEY (`transfer_id`, `line_no`),
  CONSTRAINT `fk_trl_tr` FOREIGN KEY (`transfer_id`) REFERENCES `transfers` (`transfer_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_trl_sku` FOREIGN KEY (`sku_code`) REFERENCES `skus` (`sku_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------- 3. shelf moves and transfer losses
ALTER TABLE `write_offs`
  ADD COLUMN `kind` enum('write_off','move') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'write_off' AFTER `status`,
  ADD COLUMN `to_kind` enum('good','dmg','ret') COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `kind`,
  ADD COLUMN `transfer_id` int DEFAULT NULL AFTER `run_id`,
  ADD KEY `idx_wo_transfer` (`transfer_id`);

-- ---------------------------------------------------------------- 4. counts in kg
ALTER TABLE `stock_count_lines` MODIFY `expected` decimal(12,3) DEFAULT NULL, MODIFY `counted` decimal(12,3) DEFAULT NULL;

-- ---------------------------------------------------------------- 5. approval rule
INSERT IGNORE INTO `approval_rules` (`kind`, `label`, `section`, `is_on`, `unit`, `limit_value`, `limit_packs`, `locked`, `sort_order`) VALUES
  ('transit_loss', 'Short receipt on a transfer', 'inventory', 1, 'all', NULL, NULL, 0, 55);
