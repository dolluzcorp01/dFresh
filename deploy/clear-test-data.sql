-- dFresh: clear the TEST leads before launch (deploy/DEPLOY.md step 11.3). Run ONCE, as MySQL root, with dfresh-api
-- STOPPED and a fresh backup taken:   sudo mysql --default-character-set=utf8mb4 dfresh < deploy/clear-test-data.sql
--
-- Removes every lead and everything tied to one (the schema's own list: every table with a foreign key to leads):
--   leads           the leads (visitor names, e-mails, phones, messages, ip_hash, brochure delivery / download time)
--   lead_products   products picked in a lead form
--   mail_outbox     ONLY rows with a lead_id: staff alerts, visitor confirmations (lead_ack), brochure copy links
--   sync_outbox     Google Sheet queue (every row belongs to a lead)
--   audit_log       ONLY lead history: entity_type 'lead' (status / notes changes, deletes, Excel / CSV exports of
--                   leads), Retry of a lead's mail and every sheet-queue Retry
-- Not stored anywhere else: the lead rate limit counts leads rows (ip_hash), brochure links are signed tokens (no
-- table), visitor e-mails are only in mail_outbox.
--
-- KEPT, not touched: lead_counters (the lead number DFL-YYnnnn keeps counting, so no number is ever given twice),
-- products and their texts / images, categories, kits, towns, banners, form options, size picker, ui_text, languages,
-- site_settings, brochures, admin_users, dfresh_meta, mail_outbox rows without a lead (sign-in codes, logo test
-- mails), every other audit_log row (settings, content, logins, admin users), media/ and private/ on disk.
-- DELETE, never TRUNCATE: the AUTO_INCREMENT ids go on, so a real lead never gets the id of a test lead (an e-mailed
-- test brochure link carries its lead id and would otherwise mark the new lead "Downloaded").
-- Outside the database (by hand, DEPLOY.md 11.3): the rows already in the LIVE Google Sheet, the staff alerts in the
-- lead_email inbox, and the "[mail] ... to <address>" lines in the pm2 log.
USE dfresh;
SET SESSION information_schema_stats_expiry = 0; -- AUTO_INCREMENT read live, not from the 24-hour statistics cache

-- ---------------------------------------------------------------------------------------------------- before
SELECT 'BEFORE' AS stage,
  (SELECT COUNT(*) FROM leads) AS leads,
  (SELECT COUNT(*) FROM lead_products) AS lead_products,
  (SELECT COUNT(*) FROM mail_outbox WHERE lead_id IS NOT NULL) AS lead_mails,
  (SELECT COUNT(*) FROM sync_outbox) AS sheet_queue,
  (SELECT COUNT(*) FROM audit_log WHERE entity_type = 'lead') AS lead_audit,
  (SELECT COUNT(*) FROM audit_log WHERE entity_type IN ('mail_outbox', 'sync_outbox')) AS outbox_retry_audit;
SELECT 'KEPT (must be equal before and after)' AS stage,
  (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM ui_text) AS ui_text, (SELECT COUNT(*) FROM banners) AS banners,
  (SELECT COUNT(*) FROM brochures) AS brochures, (SELECT COUNT(*) FROM site_settings) AS settings, (SELECT COUNT(*) FROM admin_users) AS admin_users,
  (SELECT COUNT(*) FROM mail_outbox WHERE lead_id IS NULL) AS other_mails,
  (SELECT COUNT(*) FROM audit_log WHERE entity_type NOT IN ('lead', 'mail_outbox', 'sync_outbox')) AS other_audit,
  (SELECT GROUP_CONCAT(CONCAT('DFL-', LPAD(yr, 2, '0'), ' last ', last_no) ORDER BY yr) FROM lead_counters) AS lead_counter;

-- ---------------------------------------------------------------------------------------------------- clear
START TRANSACTION;

-- audit first: a mail Retry row only holds the mail id, so it is matched while the mail rows still exist. Removed
-- unless that mail still exists WITHOUT a lead (a sign-in code or logo test mail keeps its history).
DELETE FROM audit_log WHERE entity_type = 'lead';
DELETE FROM audit_log WHERE entity_type = 'sync_outbox';
DELETE FROM audit_log
 WHERE entity_type = 'mail_outbox'
   AND NOT EXISTS (SELECT 1 FROM mail_outbox m WHERE CAST(m.mail_id AS CHAR) = audit_log.entity_id AND m.lead_id IS NULL);

-- the lead tables (the foreign keys cascade from leads anyway; explicit, so nothing depends on them being there)
DELETE FROM lead_products;
DELETE FROM sync_outbox;
DELETE FROM mail_outbox WHERE lead_id IS NOT NULL;
DELETE FROM leads;

COMMIT;

-- ---------------------------------------------------------------------------------------------------- after
SELECT 'AFTER' AS stage,
  (SELECT COUNT(*) FROM leads) AS leads,
  (SELECT COUNT(*) FROM lead_products) AS lead_products,
  (SELECT COUNT(*) FROM mail_outbox WHERE lead_id IS NOT NULL) AS lead_mails,
  (SELECT COUNT(*) FROM sync_outbox) AS sheet_queue,
  (SELECT COUNT(*) FROM audit_log WHERE entity_type = 'lead') AS lead_audit,
  (SELECT COUNT(*) FROM audit_log WHERE entity_type IN ('mail_outbox', 'sync_outbox')) AS outbox_retry_audit;
SELECT 'KEPT (must be equal before and after)' AS stage,
  (SELECT COUNT(*) FROM products) AS products, (SELECT COUNT(*) FROM ui_text) AS ui_text, (SELECT COUNT(*) FROM banners) AS banners,
  (SELECT COUNT(*) FROM brochures) AS brochures, (SELECT COUNT(*) FROM site_settings) AS settings, (SELECT COUNT(*) FROM admin_users) AS admin_users,
  (SELECT COUNT(*) FROM mail_outbox WHERE lead_id IS NULL) AS other_mails,
  (SELECT COUNT(*) FROM audit_log WHERE entity_type NOT IN ('lead', 'mail_outbox', 'sync_outbox')) AS other_audit,
  (SELECT GROUP_CONCAT(CONCAT('DFL-', LPAD(yr, 2, '0'), ' last ', last_no) ORDER BY yr) FROM lead_counters) AS lead_counter;
SELECT 'NEXT' AS stage,
  (SELECT AUTO_INCREMENT FROM information_schema.tables WHERE table_schema = 'dfresh' AND table_name = 'leads') AS next_lead_id,
  (SELECT GROUP_CONCAT(CONCAT('DFL-', LPAD(yr, 2, '0'), LPAD(last_no + 1, 4, '0')) ORDER BY yr) FROM lead_counters) AS next_lead_ref;
