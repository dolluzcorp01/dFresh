# Phase 7 - Admin console (/admin)

Read first: docs/05_FEATURES_SPEC.md F; docs/06_API.md Admin; docs/reference/insideD-patterns.md (login).

## Steps
1. `Admin_login_server.js` + `auth.js`: two-step login against dadmin.employee + dadmin.login_otp (app_key dFresh),
   challenge token never accepted as a session, role from dfresh.admin_users, revoke check, logout, /me.
2. `Admin_server.js` with role middleware on EVERY route; audit_log on every write; content-cache bust on content writes.
3. Admin UI (lazy chunk, can use a simple clean layout - not the public design): Dashboard, Leads, Products (+ images
   upload -> sharp WebP 1200 + sizes, <=150 KB check), Excel import (dry-run diff, apply) / export (v0.2 layout +
   extra language columns), Translations grid (missing highlight, CSV export/import), Banners, Kits, Towns,
   Categories, Size picker, Form options, Languages, Brochures, Settings, Users, Audit log.
4. Prove the language promise: add language `te` (Telugu) inactive, fill 3 texts, see completeness %, activate ->
   switcher + routes + sitemap show it with English fallback for the rest; deactivate and delete it afterwards.

## Acceptance
- Viewer cannot write (403 from the API, not just hidden buttons). Editor cannot change settings/users/languages.
- Export the products Excel, change one Tamil name, import: dry-run shows exactly 1 change; apply; site shows it
  within one request (cache busted); audit_log has before/after.
- Upload a 3 MB JPG product photo -> stored as WebP <= 150 KB at 1200x1200 + 400/800.
- The Telugu round trip above works with no code change and no restart.

Commit: `phase 7: admin console`. Move file to done/, STOP.
