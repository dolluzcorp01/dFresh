-- Stage 2, phase 13 / 04: a godown's full address and hours (v23 Godowns, test 0.48).
-- The address line stays in `address` (line 1); added: line 2, city, PIN (6 digits; empty = "PIN to add"), opening
-- and closing time, weekly days off (never every day), and dates it is closed (holidays: [{ from, to, why }]).
-- Today's godowns: open 09:00 to 18:00, closed on Sunday, as v23 starts them.
USE dfresh;
SET NAMES utf8mb4;

ALTER TABLE `locations`
  ADD COLUMN `addr_line2` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `address`,
  ADD COLUMN `city` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `addr_line2`,
  ADD COLUMN `pin` char(6) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `city`,
  ADD COLUMN `open_time` char(5) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '09:00' AFTER `phone`,
  ADD COLUMN `close_time` char(5) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '18:00' AFTER `open_time`,
  ADD COLUMN `weekly_off` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Sun' AFTER `close_time`,
  ADD COLUMN `closed_dates` json DEFAULT NULL AFTER `weekly_off`;
