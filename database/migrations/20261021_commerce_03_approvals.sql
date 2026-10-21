-- Commerce 03: Approvals (docs/COMMERCE-SPEC.md section 2): actions held until someone with an approver role and
-- "approve" on the section decides (approvals.js).
-- Structure and defaults only: no customers, orders or demo data (scripts/commerce-demo-seed.js, dfresh_commerce only).
-- Safe on the live database: every table is new except the ALTERs marked "live table", which only add columns.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `approvals` (
  `approval_id` bigint NOT NULL AUTO_INCREMENT,
  `kind` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,  -- refund | write_off | discount | cancel_after_dispatch | goodwill_credit | credit_raise | price_below_list
  `section` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,  -- whose "approve" is needed (src/shared/permissions.js)
  `ref_type` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,  -- order | return | customer | sku | stock ...
  `ref_id` varchar(40) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `summary` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,  -- one line for the queue
  `amount` decimal(12,2) DEFAULT NULL,
  `payload` json DEFAULT NULL,  -- what runs when approved
  `status` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | expired | withdrawn
  `requested_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `requested_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decided_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `decided_at` datetime DEFAULT NULL,
  `note` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`approval_id`),
  KEY `idx_approval_status` (`status`,`kind`),
  KEY `idx_approval_ref` (`ref_type`,`ref_id`),
  KEY `idx_approval_requester` (`requested_by`,`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
