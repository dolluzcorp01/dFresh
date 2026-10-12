-- E-mail header logo from a URL (admin Settings, admin role). Empty = the inline CID logo mailer.js attaches.
-- Every template shows the logo image only (no text wordmark), 62x34 in the ink header; the hosted file is a
-- transparent PNG at 2x (124x68), exported by scripts/mail-logo.js.
INSERT IGNORE INTO site_settings (setting_key, setting_value, is_public, description) VALUES
  ('mail_logo_url', '', 0, 'https URL of the e-mail header logo (transparent PNG 124x68, shown 62x34); empty = inline logo');
