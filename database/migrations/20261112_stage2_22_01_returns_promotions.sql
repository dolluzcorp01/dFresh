-- Stage 2, phase 22 / 01: sections 12, 13 and 14 Returns, promotions and wallet, to the v23 working file.
-- 1. Approval rules (v23): a new offer or coupon goes live only once signed (promo_new), a promotion that sells below
--    cost needs its own signature too (promo_below_cost), a new or loosened cashback rule goes live once signed
--    (cashback_rule). All "every one", on.
-- 2. Offers, coupons and cashback rules get a status: draft, waiting (for approval), live, rejected (sent back to the
--    draft), ended (stopped or switched off). Everything switched on today is live, everything switched off is ended,
--    so what applies to an order is exactly what applied before. Offers also get: the customers they are for (as well
--    as customer types), whether a coupon may stack on them (empty = the Commerce setting, as before), a budget.
-- 3. Orders: "No offers on this order", and the cashback rule's minimum kept with the cashback (W2: a return that takes
--    the invoice under it takes all of that cashback back).
-- 4. Returns: inspection per line adds repack (to the Damaged shelf for repacking) and scrap (a write-off from the
--    Returned shelf, under the write-off rule); "OK" becomes resell (back to Good with the "Returned stock back to
--    Good" approval). Credit note lines may be negative: a free pack no longer due under "buy X get Y" comes off.
-- 5. Rights (v23 13.10, 14.10): the Supervisor (our Operations role) makes offers, coupons and cashback rules: view,
--    create and edit on Promotions; Sub-admin and above approve them. Sales keep view only, Warehouse none.
USE dfresh;
SET NAMES utf8mb4;

-- ---------------------------------------------------------------- 1. approval rules
INSERT IGNORE INTO `approval_rules` (`kind`, `label`, `section`, `is_on`, `unit`, `limit_value`, `limit_packs`, `locked`, `sort_order`) VALUES
  ('promo_new', 'New offer or coupon goes live', 'promotions', 1, 'all', NULL, NULL, 0, 185),
  ('promo_below_cost', 'Promotion that sells below cost', 'promotions', 1, 'all', NULL, NULL, 0, 186),
  ('cashback_rule', 'New cashback rule goes live', 'promotions', 1, 'all', NULL, NULL, 0, 188);

INSERT INTO `role_permissions` (`role_id`, `section`, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`)
VALUES (4, 'promotions', 1, 1, 1, 0, 0, 0, 0)
ON DUPLICATE KEY UPDATE `can_view` = 1, `can_create` = 1, `can_edit` = 1;

-- ---------------------------------------------------------------- 2. offers, coupons, cashback rules
ALTER TABLE `offers`
  ADD COLUMN `status` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' AFTER `is_active`,
  ADD COLUMN `with_coupon` tinyint(1) DEFAULT NULL AFTER `status`,
  ADD COLUMN `budget` decimal(12,2) DEFAULT NULL AFTER `with_coupon`,
  ADD COLUMN `rej_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `budget`,
  ADD COLUMN `stopped_at` datetime DEFAULT NULL AFTER `rej_note`,
  ADD COLUMN `stopped_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `stopped_at`;
UPDATE `offers` SET `status` = IF(`is_active` = 1, 'live', 'ended');
CREATE TABLE IF NOT EXISTS `offer_customers` (
  `offer_id` int NOT NULL,
  `customer_id` int NOT NULL,
  PRIMARY KEY (`offer_id`, `customer_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `coupons`
  ADD COLUMN `status` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' AFTER `is_active`,
  ADD COLUMN `rej_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `status`,
  ADD COLUMN `stopped_at` datetime DEFAULT NULL AFTER `rej_note`,
  ADD COLUMN `stopped_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `stopped_at`;
UPDATE `coupons` SET `status` = IF(`is_active` = 1, 'live', 'ended');

ALTER TABLE `cashback_rules`
  ADD COLUMN `status` varchar(9) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft' AFTER `is_active`,
  ADD COLUMN `rej_note` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `status`,
  ADD COLUMN `stopped_at` datetime DEFAULT NULL AFTER `rej_note`,
  ADD COLUMN `stopped_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `stopped_at`;
UPDATE `cashback_rules` SET `status` = IF(`is_active` = 1, 'live', 'ended');

-- ---------------------------------------------------------------- 3. orders
ALTER TABLE `orders`
  ADD COLUMN `no_offers` tinyint(1) NOT NULL DEFAULT 0 AFTER `coupon_code`,
  ADD COLUMN `cashback_min` decimal(12,2) DEFAULT NULL AFTER `cashback_amount`;

-- ---------------------------------------------------------------- 4. returns
ALTER TABLE `return_items`
  ADD COLUMN `qty_repack` int NOT NULL DEFAULT 0 AFTER `qty_damaged`,
  ADD COLUMN `qty_scrap` int NOT NULL DEFAULT 0 AFTER `qty_repack`,
  ADD COLUMN `resell_approval_id` bigint DEFAULT NULL AFTER `none_qty`,
  ADD COLUMN `scrap_write_off_id` int DEFAULT NULL AFTER `resell_approval_id`;
ALTER TABLE `credit_note_lines`
  ADD COLUMN `note` varchar(160) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `line_total`;
