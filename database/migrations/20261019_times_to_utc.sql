-- Every dfresh DATETIME is UTC from now on (config/db.js: each app connection sets time_zone '+00:00' and mysql2 reads
-- DATETIME as UTC; display converts to Asia/Kolkata). Until now NOW() / CURRENT_TIMESTAMP wrote them in the MySQL
-- session's zone = the server's DEFAULT zone (IST on the live droplet: an upload at 17:22 IST showed as 10:52 pm).
-- This shifts the existing values ONCE by the offset of THIS session, which is that same default (run it with the
-- mysql client, as every migration: `mysql dfresh < file`). Offset 0 (a server already in UTC) = nothing changes.
--
-- LIVE: run it while dfresh-api is STOPPED, between `pm2 stop dfresh-api` (old release) and the start of the release
-- that sets UTC sessions (deploy/DEPLOY.md, Update, "times to UTC"). Otherwise rows written in between end up wrong.
-- Run once: the marker row in dfresh_meta makes a second run a no-op (a second shift would be 5:30 off again).
-- JSON times (leads.details_json.brochure_downloaded_at) are already UTC and are not touched.
USE dfresh;

CREATE TABLE IF NOT EXISTS dfresh_meta (
  meta_key   VARCHAR(60)  NOT NULL,
  meta_value VARCHAR(255) NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (meta_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @done = (SELECT COUNT(*) FROM dfresh_meta WHERE meta_key = 'times_utc');
SET @off = IF(@done > 0, 0, TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), NOW()));
SELECT @@session.time_zone AS session_zone, @off AS minutes_shifted_back, IF(@done > 0, 'already done, nothing changed', 'shifting') AS state;

-- one UPDATE per table with ALL its DATETIME columns, so ON UPDATE CURRENT_TIMESTAMP never stamps "now"
UPDATE admin_users          SET created_at = created_at - INTERVAL @off MINUTE;
UPDATE audit_log            SET created_at = created_at - INTERVAL @off MINUTE;
UPDATE banners              SET updated_at = updated_at - INTERVAL @off MINUTE;
UPDATE brochures            SET uploaded_at = uploaded_at - INTERVAL @off MINUTE;
UPDATE categories           SET updated_at = updated_at - INTERVAL @off MINUTE;
UPDATE languages            SET created_at = created_at - INTERVAL @off MINUTE, updated_at = updated_at - INTERVAL @off MINUTE;
UPDATE leads                SET created_at = created_at - INTERVAL @off MINUTE, updated_at = updated_at - INTERVAL @off MINUTE,
                                consent_at = consent_at - INTERVAL @off MINUTE, sheet_synced_at = sheet_synced_at - INTERVAL @off MINUTE;
UPDATE mail_outbox          SET created_at = created_at - INTERVAL @off MINUTE, next_attempt_at = next_attempt_at - INTERVAL @off MINUTE,
                                sent_at = sent_at - INTERVAL @off MINUTE;
UPDATE product_translations SET updated_at = updated_at - INTERVAL @off MINUTE;
UPDATE products             SET created_at = created_at - INTERVAL @off MINUTE, updated_at = updated_at - INTERVAL @off MINUTE;
UPDATE site_settings        SET updated_at = updated_at - INTERVAL @off MINUTE;
UPDATE sync_outbox          SET created_at = created_at - INTERVAL @off MINUTE, next_attempt_at = next_attempt_at - INTERVAL @off MINUTE,
                                done_at = done_at - INTERVAL @off MINUTE;
UPDATE ui_text              SET updated_at = updated_at - INTERVAL @off MINUTE;

INSERT IGNORE INTO dfresh_meta (meta_key, meta_value, created_at)
VALUES ('times_utc', CONCAT('stored as UTC; existing rows shifted back ', @off, ' minutes'), UTC_TIMESTAMP());
