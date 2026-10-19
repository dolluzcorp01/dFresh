-- Search engine indexing switch (Settings > Sharing and SEO), for the soft launch: 'off' = robots.txt disallows
-- everything, /sitemap.xml is 404 and every page carries <meta name="robots" content="noindex, nofollow"> plus an
-- X-Robots-Tag header; 'on' = the normal robots.txt (admin and api blocked, Sitemap line) and sitemap. Read per
-- request by seo.js / server.js from the cached public settings, so the switch applies at once. Public: it only says
-- whether the site wants to be indexed. Starts OFF; turn it ON on launch day. A missing row means on.
USE dfresh;

INSERT IGNORE INTO site_settings (setting_key, setting_value, is_public, description)
VALUES ('site_indexing', 'off', 1,
        'Off (soft launch): search engines are told not to index the site (robots.txt blocks all, every page noindex, no sitemap). On: normal robots.txt and sitemap. Turn on on launch day.');
