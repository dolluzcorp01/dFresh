-- Stage 2, phase 23 / 01: sections 15, 16 and 17 Alerts, reports, expenses and the accounting export, to the v23 working
-- file, and the carry-overs from phase 22.
-- 0a. A right of the Returns row only: "Inspect returns" (role_permissions.can_inspect). The migration gives it to
--     Operations (v23's Supervisor) only; Super admin and Admin have every right in code; an Admin can tick it for any
--     role. Warehouse no longer inspects (it receives and scans returns in, as before).
-- 0b. The wallet switch (v23 "Customer wallet and cashback on", Admin > Switches > Money). Off: the wallet pages say so,
--     an order takes no wallet and no cashback is earned; balances stay saved. A database that already has wallet
--     entries or cashback rules keeps the wallet on (it worked before); a new install starts with it off, as v23.
USE dfresh;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- 0a. Inspect returns
ALTER TABLE `role_permissions` ADD COLUMN `can_inspect` tinyint(1) NOT NULL DEFAULT '0' AFTER `can_delete`;
INSERT INTO `role_permissions` (`role_id`, `section`, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`, `can_inspect`)
VALUES (4, 'returns', 1, 0, 0, 0, 0, 0, 0, 1)
ON DUPLICATE KEY UPDATE `can_view` = 1, `can_inspect` = 1;

-- ---------------------------------------------------------------- 0b. wallet switch
INSERT IGNORE INTO `commerce_settings` (`setting_key`, `grp`, `label`, `help`, `value`, `value_type`, `options`, `tbc`, `sort_order`, `sw_group`, `sw_unit`, `sw_example`, `sw_sort`)
SELECT 'wallet_enabled', 'Promotions', 'Customer wallet and cashback on', 'Customers earn cashback into a wallet and use it on orders. Off: no wallet on orders and no cashback earned; balances stay saved.',
  IF(EXISTS (SELECT 1 FROM `wallet_entries`) OR EXISTS (SELECT 1 FROM `cashback_rules`), '1', '0'), 'bool', NULL, 0, 5, 'Money', NULL,
  'Example: Off (as delivered): orders show no wallet line. On: Hotel Kanchi can use its Rs 420 of cashback on the next order, up to the % set below. Turning it on needs a second Admin.', 30;
