-- Stage 2, phase 12b / 02: the month lock (v23 Export to accountant, Company > System "Books closed up to").
-- Commerce setting books_closed_to: no record may be dated on or before it (set with the CA when a year is closed;
--   moving it back waits for a second Admin).
-- month_exports: a month sent to the CA (only a finished month, nothing dated in it still waiting); it locks the month.
-- record_unlocks: one record of an exported month that may change after all (an approved "after_export" request).
-- export_events: what the CA must know (Export history): each export, and each change allowed after it.
USE dfresh;
SET NAMES utf8mb4;

INSERT IGNORE INTO `commerce_settings` (`setting_key`, `grp`, `label`, `help`, `value`, `value_type`, `options`, `tbc`, `sort_order`) VALUES
  ('books_closed_to', 'Accounting', 'Books closed up to',
   'No invoice, note, receipt, stock move, write-off or wallet entry may be dated on or before this date (set with the CA when a year is closed). Empty = not closed. Moving it back waits for a second Admin.',
   '', 'text', NULL, 0, 20);

CREATE TABLE IF NOT EXISTS `month_exports` (
  `month` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `exported_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `exported_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `file_name` varchar(120) COLLATE utf8mb4_unicode_ci NOT NULL,
  `lines` int NOT NULL DEFAULT '0',
  PRIMARY KEY (`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `record_unlocks` (
  `record_key` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `month` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `approval_id` bigint DEFAULT NULL,
  `unlocked_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `unlocked_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`record_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `export_events` (
  `event_id` bigint NOT NULL AUTO_INCREMENT,
  `month` char(7) COLLATE utf8mb4_unicode_ci NOT NULL,
  `kind` enum('export','unlock') COLLATE utf8mb4_unicode_ci NOT NULL,
  `record_key` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `label` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `emp_id` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`event_id`),
  KEY `idx_exp_month` (`month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
