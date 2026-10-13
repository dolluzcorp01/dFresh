-- Director decision 13 Oct 2026: show ALL banners, including funky, neon and rainbow (open item 11, closed).
-- Only rows that are still inactive change; sort order, headline and CTA text stay as they are. The internal note
-- (never sent to the browser) is updated only where it still holds the seeded "inactive until approved" text.
-- A running API shows the change after its content cache is cleared: production `pm2 reload dfresh` (DEPLOY.md
-- section 9), local `npm run cache:bust` (bumps contentVersion), else within the cache TTL (5 min).
UPDATE banners SET is_active = 1
 WHERE banner_key IN ('funky', 'neon', 'rainbow') AND is_active = 0;

UPDATE banners SET note = 'Director approved all banners, 13 Oct 2026'
 WHERE banner_key IN ('funky', 'neon', 'rainbow')
   AND note = 'Inactive until approved by the Director (brief: do not make the site funky)';
