-- Stage 2, phase 12b / 01: second Admin, override, Send again, the Sub-admin grid, Admin alerts (v23 Foundation).
-- admin_users: pending_add = added (or brought back) but waiting for a second Admin (inactive until then); left_at /
--   left_by = when and by whom someone was marked as left (an override never uses an absence its own Admin made).
-- approvals: resent_id = the fresh request a "Send again" made from this expired one.
-- approval_overrides: an Admin's override of a waiting rule change while every other Admin is away; it applies 24 hours
--   after it is set unless an Admin cancels it, and stops if the other Admin is back by then.
-- Sub-admin: its grid becomes rows like any role (an Admin may change it; a widening waits for a second Admin): today's
--   built-in rights (everything; Roles and users and Settings view only) and See cost, as v23.
-- Admin alerts: one staff template (override set / applied / cancelled / stopped, an Admin marked as left, leave
--   entered for another Admin); WhatsApp copies are prepared in notification_log, never sent.
USE dfresh;
SET NAMES utf8mb4;

ALTER TABLE `admin_users`
  ADD COLUMN `pending_add` tinyint(1) NOT NULL DEFAULT '0' AFTER `is_active`,
  ADD COLUMN `left_at` datetime DEFAULT NULL AFTER `pending_add`,
  ADD COLUMN `left_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `left_at`;

ALTER TABLE `approvals` ADD COLUMN `resent_id` bigint DEFAULT NULL AFTER `decided_via`;

CREATE TABLE IF NOT EXISTS `approval_overrides` (
  `override_id` bigint NOT NULL AUTO_INCREMENT,
  `approval_id` bigint NOT NULL,
  `set_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `reason` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `set_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `apply_at` datetime NOT NULL,
  `status` enum('waiting','applied','cancelled','stopped','failed') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'waiting',
  `ended_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ended_at` datetime DEFAULT NULL,
  `why` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`override_id`),
  KEY `idx_ovr_approval` (`approval_id`),
  KEY `idx_ovr_due` (`status`, `apply_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- the Sub-admin grid as rows (section list of src/shared/permissions.js; audit is view only)
DELETE FROM `role_permissions` WHERE `role_id` = 2;
INSERT INTO `role_permissions` (`role_id`, `section`, `can_view`, `can_create`, `can_edit`, `can_approve`, `can_cancel`, `can_export`, `can_delete`)
SELECT 2, s.section, 1, s.full, s.full, s.full, s.full, s.full, s.full FROM (
  SELECT 'leads' AS section, 1 AS full UNION ALL SELECT 'orders', 1 UNION ALL SELECT 'packing', 1 UNION ALL SELECT 'delivery', 1
  UNION ALL SELECT 'inventory', 1 UNION ALL SELECT 'returns', 1 UNION ALL SELECT 'customers', 1 UNION ALL SELECT 'promotions', 1
  UNION ALL SELECT 'products', 1 UNION ALL SELECT 'reports', 1 UNION ALL SELECT 'content', 1
  UNION ALL SELECT 'settings', 0 UNION ALL SELECT 'users', 0 UNION ALL SELECT 'audit', 0) s;
UPDATE `roles` SET `see_cost` = 1, `description` = 'Everything; Roles and users and Settings view only, unless an Admin gives more. Built in.' WHERE `role_id` = 2;

-- a change to a record dated in a month already exported to the CA (asked once per record, then allowed)
INSERT IGNORE INTO `approval_rules` (`kind`, `label`, `section`, `is_on`, `unit`, `limit_value`, `limit_packs`, `locked`, `sort_order`)
VALUES ('after_export', 'Change a record in a month already exported to the CA', 'settings', 1, 'all', NULL, NULL, 1, 25);

INSERT IGNORE INTO `notification_templates` (`event_key`, `lang_code`, `subject`, `body`, `needs_review`) VALUES
  ('admin_alert', 'en', 'dFresh: {subject}', 'Hello {name},\n\n{body}\n\nOpen Approvals: {link}', 0);
