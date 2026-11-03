-- Stage 2, phase 13 / 01: the Company page (v23 Admin > Organisation > Company, tests 0.37, 0.41 to 0.45, F4).
-- company: one row (company_id 1): brand, company type, website, PAN, GST type, TAN, Udyam, the registered office
--   (line 1, line 2, city, PIN, state, map), the invoice preferences (bank and UPI QR shown, signatory, signature,
--   declaration, footer terms, round off, copies) and the date format. The facts the public site shows stay in
--   site_settings, their one source (company_name, cin, gstin, office_phone, public_email, whatsapp_display): the
--   Company page writes those rows, so the site prints exactly what it printed before.
-- company_bank_accounts: the accounts printed on invoices (active / inactive, one default). Never deleted. Adding,
--   changing, making default, making inactive and bringing back wait for a second Admin (a company_bank approval that
--   is never overridden); the waiting change lives in that approval's payload, so invoices keep the old account.
-- invoices.seller_bank / seller_upi: what an invoice printed for payment, kept with it (a later bank change does not
--   change an old invoice).
-- Moved here from Commerce settings, which then go: invoice_seller_name (into site_settings company_name when that is
--   empty), invoice_seller_gstin (into site_settings gstin when that is empty and it is a real GSTIN), invoice_seller_address
--   (the office line 1), invoice_seller_state_code (the office state), invoice_bank_details (a first account, as its old
--   text, when not empty), invoice_round_off (round off). commerce-settings.js still gives these keys to its readers,
--   read from here.
USE dfresh;
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `company` (
  `company_id` tinyint NOT NULL DEFAULT '1',
  `brand` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'dFresh',
  `company_type` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'One Person Company (OPC) Private Limited',
  `website` varchar(80) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pan` char(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `gst_type` varchar(12) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'regular',
  `tan` char(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `udyam` varchar(19) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `addr_line1` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `addr_line2` varchar(150) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pin` char(6) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `state_code` char(2) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT '33',
  `map_query` varchar(120) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `show_bank` tinyint(1) NOT NULL DEFAULT '1',
  `show_upi` tinyint(1) NOT NULL DEFAULT '1',
  `signatory` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `signature_png` mediumblob,
  `declaration` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `terms` varchar(300) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `round_off` tinyint(1) NOT NULL DEFAULT '1',
  `copies` varchar(40) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Original,Duplicate',
  `date_format` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'DD-MM-YYYY',
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`company_id`),
  CONSTRAINT `chk_company_one` CHECK (`company_id` = 1),
  CONSTRAINT `chk_company_gst_type` CHECK (`gst_type` IN ('regular', 'composition'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `company_bank_accounts` (
  `bank_id` int NOT NULL AUTO_INCREMENT,
  `holder_name` varchar(80) COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank_name` varchar(60) COLLATE utf8mb4_unicode_ci NOT NULL,
  `branch` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `account_no` varchar(18) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ifsc` char(11) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `account_type` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Current',
  `upi_id` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `old_text` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `is_default` tinyint(1) NOT NULL DEFAULT '0',
  `created_by` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_by` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`bank_id`),
  UNIQUE KEY `uq_company_bank_acc` (`account_no`),
  CONSTRAINT `chk_company_bank_status` CHECK (`status` IN ('active', 'inactive'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `invoices`
  ADD COLUMN `seller_bank` varchar(1000) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `seller_state_code`,
  ADD COLUMN `seller_upi` varchar(60) COLLATE utf8mb4_unicode_ci DEFAULT NULL AFTER `seller_bank`;

-- the one company row, from today's invoice settings (the office line without the state, which is printed from the code)
INSERT INTO `company` (`company_id`, `website`, `addr_line1`, `state_code`, `round_off`, `declaration`, `terms`, `updated_by`)
SELECT 1, 'https://dfresh.in',
  NULLIF(TRIM(CASE WHEN st.value = '33' AND ad.value LIKE '%, Tamil Nadu' THEN LEFT(ad.value, CHAR_LENGTH(ad.value) - CHAR_LENGTH(', Tamil Nadu')) ELSE ad.value END), ''),
  COALESCE(NULLIF(st.value, ''), '33'), COALESCE(ro.value = '1', 1),
  'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.',
  'Goods once sold are taken back only under the dFresh return policy.', 'system'
FROM (SELECT 1 AS one) x
LEFT JOIN `commerce_settings` ad ON ad.setting_key = 'invoice_seller_address'
LEFT JOIN `commerce_settings` st ON st.setting_key = 'invoice_seller_state_code'
LEFT JOIN `commerce_settings` ro ON ro.setting_key = 'invoice_round_off'
WHERE NOT EXISTS (SELECT 1 FROM `company` WHERE `company_id` = 1);

-- the legal name and GSTIN: site_settings is their one source (the site's footer reads it); filled from the invoice
-- settings only where the site has none
UPDATE `site_settings` s JOIN `commerce_settings` c ON c.setting_key = 'invoice_seller_name'
   SET s.setting_value = c.value
 WHERE s.setting_key = 'company_name' AND COALESCE(s.setting_value, '') = '' AND c.value <> '';
UPDATE `site_settings` s JOIN `commerce_settings` c ON c.setting_key = 'invoice_seller_gstin'
   SET s.setting_value = UPPER(c.value)
 WHERE s.setting_key = 'gstin' AND COALESCE(s.setting_value, '') = '' AND UPPER(c.value) REGEXP '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$';

-- today's free-text bank details: a first account (default), its text kept as it was printed, until it is changed
INSERT INTO `company_bank_accounts` (`holder_name`, `bank_name`, `old_text`, `status`, `is_default`, `created_by`)
SELECT 'Dolluz Corporation (OPC) Pvt Ltd', 'Bank details (old text)', TRIM(c.value), 'active', 1, 'system'
  FROM `commerce_settings` c
 WHERE c.setting_key = 'invoice_bank_details' AND TRIM(c.value) <> ''
   AND NOT EXISTS (SELECT 1 FROM `company_bank_accounts`);

-- invoices issued so far keep what they printed (the old text, when there was one)
UPDATE `invoices` i JOIN `commerce_settings` c ON c.setting_key = 'invoice_bank_details'
   SET i.seller_bank = TRIM(c.value)
 WHERE i.seller_bank IS NULL AND TRIM(c.value) <> '';

-- a bank change still waiting under the old setting: closed (it would change a setting that is gone); asked again on
-- the Company page
UPDATE `approvals` SET `status` = 'withdrawn', `note` = 'Moved to Company > Bank accounts (phase 13): ask again there.'
 WHERE `kind` = 'company_bank' AND `status` = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(`payload`, '$.t')) = 'bank';

DELETE FROM `commerce_settings` WHERE `setting_key` IN
  ('invoice_seller_name', 'invoice_seller_gstin', 'invoice_seller_address', 'invoice_seller_state_code', 'invoice_bank_details', 'invoice_round_off');
