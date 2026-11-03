-- Stage 2, phase 14 / 03: our only domain is https://dfresh.us. Where a database still holds the old placeholder
-- address (dfresh with the .in ending), it becomes https://dfresh.us. The website the documents and e-mails print is
-- the server's PUBLIC_SITE_URL (config/urls.js), shown read only on Admin > Company; these rows only keep the stored
-- copies in step. site_settings.site_url was removed on 13 Oct 2026 (20261013_single_source_text.sql), so that UPDATE
-- changes no row on a database that ran it.
USE dfresh;
SET NAMES utf8mb4;

UPDATE `company` SET `website` = 'https://dfresh.us', `updated_by` = 'system'
 WHERE `website` REGEXP 'dfresh[.]in([/:]|$)';
UPDATE `site_settings` SET `setting_value` = 'https://dfresh.us'
 WHERE `setting_key` = 'site_url' AND `setting_value` REGEXP 'dfresh[.]in([/:]|$)';
