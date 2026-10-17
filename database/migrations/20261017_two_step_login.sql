-- Admin sign-in: two-step verification switch (Settings > Security). 'on' = password + a code sent by e-mail (the
-- behaviour so far, and what a missing row means); 'off' = password only. Read at every sign-in
-- (Admin_login_server.js), so a change applies to the next sign-in; open sessions keep their 8 hours. Server only.
-- Changed only through its switch in admin Settings (admin role; turning it on needs a code e-mailed to that admin).
USE dfresh;

INSERT IGNORE INTO site_settings (setting_key, setting_value, is_public, description)
VALUES ('two_step_login', 'on', 0, 'On: sign in needs password + a code sent by e-mail. Off: password only.');
