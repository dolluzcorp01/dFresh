-- Commerce phase 1 (docs/COMMERCE-SPEC.md section 2): approvals. A held action (refund, write-off, discount, cancel
-- after dispatch, goodwill wallet credit, credit limit raise, price below the list) waits here until someone in an
-- approver role with "approve" on its section decides. Nobody decides their own request. Structure only.
USE dfresh;

CREATE TABLE IF NOT EXISTS approvals (
  approval_id   BIGINT        NOT NULL AUTO_INCREMENT,
  kind          VARCHAR(30)   NOT NULL,              -- refund | write_off | discount | cancel_after_dispatch | goodwill_credit | credit_raise | price_below_list
  section       VARCHAR(30)   NOT NULL,              -- whose "approve" is needed (src/shared/permissions.js)
  ref_type      VARCHAR(30)   NULL,                  -- order | return | customer | sku | stock ...
  ref_id        VARCHAR(40)   NULL,
  summary       VARCHAR(255)  NOT NULL,              -- one line for the queue
  amount        DECIMAL(12,2) NULL,
  payload       JSON          NULL,                  -- what runs when approved
  status        VARCHAR(12)   NOT NULL DEFAULT 'pending', -- pending | approved | rejected | expired | withdrawn
  requested_by  VARCHAR(20)   NOT NULL,
  requested_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_by    VARCHAR(20)   NULL,
  decided_at    DATETIME      NULL,
  note          VARCHAR(500)  NULL,
  PRIMARY KEY (approval_id),
  KEY idx_approval_status (status, kind),
  KEY idx_approval_ref (ref_type, ref_id),
  KEY idx_approval_requester (requested_by, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
