-- Stage 2, phase 12a / 03: rights (D5), limits (D4), godown scope and leave per person, the Super admin.
-- Rights: two more actions per section, Cancel and Export (Delete stays where it is used). They take over the routes
-- that needed Edit (or View) before, so each role keeps exactly what it could do: Export = the right the export
-- needed until now (Edit; View for the customer list and the accounting journal), Cancel = Edit.
-- Role rights that are not a section: See cost (today: Reports + Products and prices) and Own customers only (today:
-- the Commerce setting own_customers_only with its role list; both settings move here and are removed).
-- Limits: per role "nothing" (signs nothing), "anything", or up to an amount; per person an override (or the role's).
-- Today only the approver roles (Commerce setting approver_role_ids, removed in 04) sign, with no amount limit: they
-- get "anything", every other role "nothing", so nobody signs more or less than before.
-- Godowns per person: every godown (today's users: they work everywhere today) or a list. Leave: from, to, the
-- stand-in, who entered it.
-- Super admin: the owner, above Admin, built in like Admin (src/shared/permissions.js); Shoban (DZIND002) moves to it.
USE dfresh;
SET NAMES utf8mb4;

ALTER TABLE `role_permissions`
  ADD COLUMN `can_cancel` tinyint(1) NOT NULL DEFAULT '0' AFTER `can_approve`,
  ADD COLUMN `can_export` tinyint(1) NOT NULL DEFAULT '0' AFTER `can_cancel`;
UPDATE `role_permissions` SET `can_cancel` = `can_edit`,
  `can_export` = CASE WHEN `section` IN ('customers', 'reports') THEN `can_view` ELSE `can_edit` END;

ALTER TABLE `roles`
  ADD COLUMN `limit_kind` enum('none','any','amount') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'none' AFTER `description`,
  ADD COLUMN `limit_amount` decimal(12,2) DEFAULT NULL AFTER `limit_kind`,
  ADD COLUMN `see_cost` tinyint(1) NOT NULL DEFAULT '0' AFTER `limit_amount`,
  ADD COLUMN `own_customers_only` tinyint(1) NOT NULL DEFAULT '0' AFTER `see_cost`;
-- the approver roles of today sign anything
UPDATE `roles` r JOIN `commerce_settings` s ON s.setting_key = 'approver_role_ids'
   SET r.limit_kind = 'any' WHERE JSON_CONTAINS(s.value, CAST(r.role_id AS JSON));
-- See cost: a role that could see costs until now (Reports and Products and prices, both View)
UPDATE `roles` r SET r.see_cost = 1
 WHERE EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.role_id AND p.section = 'reports' AND p.can_view = 1)
   AND EXISTS (SELECT 1 FROM role_permissions p WHERE p.role_id = r.role_id AND p.section = 'products' AND p.can_view = 1);
-- Own customers only: the roles listed in the setting, when it was on
UPDATE `roles` r JOIN `commerce_settings` on_ ON on_.setting_key = 'own_customers_only' AND on_.value = '1'
  JOIN `commerce_settings` l ON l.setting_key = 'own_customers_role_ids'
   SET r.own_customers_only = 1 WHERE JSON_CONTAINS(l.value, CAST(r.role_id AS JSON));
DELETE FROM `commerce_settings` WHERE `setting_key` IN ('own_customers_only', 'own_customers_role_ids');

-- the Super admin (built in: every right everywhere, never edited); the owner moves to it
INSERT INTO `roles` (`role_id`, `name`, `description`, `limit_kind`, `see_cost`, `is_builtin`, `created_by`)
VALUES (8, 'Super admin', 'The owner. Everything, everywhere. Cannot be changed.', 'any', 1, 1, 'migration');
UPDATE `roles` SET `limit_kind` = 'any', `see_cost` = 1 WHERE `role_id` = 1;
UPDATE `admin_users` SET `role_id` = 8 WHERE `emp_id` = 'DZIND002' AND `role_id` = 1;

ALTER TABLE `admin_users`
  ADD COLUMN `limit_kind` enum('role','none','any','amount') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'role' AFTER `role_id`,
  ADD COLUMN `limit_amount` decimal(12,2) DEFAULT NULL AFTER `limit_kind`,
  ADD COLUMN `godowns_all` tinyint(1) NOT NULL DEFAULT '0' AFTER `limit_amount`,
  ADD COLUMN `leave_from` date DEFAULT NULL AFTER `godowns_all`,
  ADD COLUMN `leave_to` date DEFAULT NULL AFTER `leave_from`,
  ADD COLUMN `stand_in` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `leave_to`,
  ADD COLUMN `leave_set_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `stand_in`;
UPDATE `admin_users` SET `godowns_all` = 1; -- everybody of today works at every godown

CREATE TABLE IF NOT EXISTS `admin_user_godowns` (
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `godown_id` int NOT NULL,
  PRIMARY KEY (`emp_id`, `godown_id`),
  CONSTRAINT `fk_aug_user` FOREIGN KEY (`emp_id`) REFERENCES `admin_users` (`emp_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aug_godown` FOREIGN KEY (`godown_id`) REFERENCES `locations` (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
