-- Stage 2, phase 23 / 03: section 15 Home > Alerts (v23 alertsAll, viewAlerts).
-- a. Business alerts are worked out live from the data (low stock, near expiry, packs with no cost, overdue customers,
--    cheques to deposit, vehicle papers, supplier bills due, returns to inspect, approvals waiting and old ones, order
--    holds ending, repeating expenses due, petty cash low or counted off). Nothing of them is stored but who has read
--    or snoozed which (alert_marks).
-- b. Admin alerts are events kept as rows (admin_alerts): an override used (set, applied, cancelled), someone marked as
--    left, leave entered for an Admin, a rule loosened (signed). The e-mails to Admins stay as before (Outbox).
-- c. Each alert type can be switched off for a role by an Admin (alert_role_settings; no row = on).
-- WhatsApp and SMS stay off: no provider is chosen.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `admin_alerts` (
  `alert_id` bigint NOT NULL AUTO_INCREMENT,
  `kind` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `title` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `body` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `link` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ref` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`alert_id`),
  KEY `idx_admin_alert_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `alert_marks` (
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `alert_key` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `read_at` datetime DEFAULT NULL,
  `snooze_until` date DEFAULT NULL,
  PRIMARY KEY (`emp_id`, `alert_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `alert_role_settings` (
  `role_id` int NOT NULL,
  `alert_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `is_on` tinyint(1) NOT NULL DEFAULT '1',
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime DEFAULT NULL,
  PRIMARY KEY (`role_id`, `alert_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
