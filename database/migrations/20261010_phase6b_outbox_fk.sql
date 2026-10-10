-- =====================================================================
-- Phase 6b: an outbox row can never send for a lead that no longer exists.
-- 1. New status 'cancelled' in both outboxes: the worker sets it on any pending row whose lead is missing
--    (outbox-worker.js), so it is never sent and never retried.
-- 2. Rows already orphaned (lead deleted before this FK existed): not-yet-sent ones become 'cancelled',
--    the old lead id is kept in last_error, and lead_id is cleared so the foreign key can be added.
-- 3. mail_outbox.lead_id -> leads ON DELETE CASCADE (sync_outbox has had fk_sync_lead since the schema).
--    Deleting a lead now deletes its outbox rows with it.
-- 4. mail_outbox.provider_msg_id: SendGrid's x-message-id of a sent row (to trace a mail in SendGrid).
-- =====================================================================
USE dfresh;
SET NAMES utf8mb4;

ALTER TABLE mail_outbox
  MODIFY status ENUM('pending','sending','sent','failed','cancelled') NOT NULL DEFAULT 'pending';
ALTER TABLE sync_outbox
  MODIFY status ENUM('pending','sending','done','failed','cancelled') NOT NULL DEFAULT 'pending';

-- SET is applied left to right: status and last_error read lead_id before it is cleared.
UPDATE mail_outbox m
  LEFT JOIN leads l ON l.lead_id = m.lead_id
   SET m.status = IF(m.status = 'sent', 'sent', 'cancelled'),
       m.last_error = IF(m.status = 'sent', m.last_error, CONCAT('lead ', m.lead_id, ' no longer exists')),
       m.lead_id = NULL
 WHERE m.lead_id IS NOT NULL AND l.lead_id IS NULL;

ALTER TABLE mail_outbox
  ADD COLUMN provider_msg_id VARCHAR(100) NULL AFTER sent_at,
  ADD CONSTRAINT fk_mail_lead FOREIGN KEY (lead_id) REFERENCES leads(lead_id) ON DELETE CASCADE;
