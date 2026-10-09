# Inside D patterns to copy (summary of the reference project you shared)

The Inside D repo is the template for dFresh's structure. Its `.env` is NOT included here (it held real
secrets). Copy these patterns, not the code wholesale.

## Layout
- React CRA app at the repo root (`src/`, `public/`, `package.json` with react-scripts 5, React 19, react-router-dom 6).
- `server.js` at the root: loads dotenv FIRST, CORS allow-list (prod domains + any localhost port when not
  production), `express.json`, `cookie-parser`, mounts route modules under `/api/...`, serves upload folders
  with `express.static`, listens on `process.env.PORT`.
- `config/db.js`: `getDBConnection(database)` keeps one `mysql2.createPool` per database name
  (host/user/password from env; `waitForConnections`, `queueLimit`). Callers do `getDBConnection('dfresh').promise()`.
- Route modules live in `src/backend_routes/<Name>_server.js` and export an Express router.
- `src/backend_routes/mailer.js` is THE ONLY place that calls SendGrid: fixed FROM, branded shell with inline CSS,
  plain-text alternative mandatory (throws without it), `escapeHtml` for every interpolated value.
- `src/backend_routes/auth.js`: JWT in an httpOnly cookie; `readSession()` rejects two-step challenge tokens
  (`stage: 'otp'`); `optionalAuth` / `requireAuth` middlewares; session revocation via `dadmin.login_session_revoke`
  with an `app_key`, failing open on DB error (logged).
- Login (`Login_server.js`): `SELECT emp_id, emp_first_name, emp_last_name, emp_mail_id, account_pass FROM
  dadmin.employee WHERE emp_mail_id = ? AND deleted_time IS NULL`, bcrypt compare, then a 6-digit code bcrypt-hashed
  into `dadmin.login_otp (app_key, emp_id, email, otp_hash, expires_at, attempts)` and e-mailed; challenge cookie
  carries `stage:'otp'`; `/verify-login-otp` issues the real session. Cookie `sameSite: 'None'` + secure in prod, `Lax` in dev.
  In dev the code is printed to the console when mail is skipped.
- `src/utils/api.js`: `API_BASE` = `REACT_APP_API` in production else `http://localhost:<port>`;
  `apiFetch(endpoint, options)` always sends `credentials: 'include'`.
- Responses `{ success, data }` / `{ success: false, message }`.
- `.gitignore` ignores `.env*`, `/build`, `/node_modules`, `/visual-output`.
- `.vscode/launch.json` "Run Backend" launches `server.js`.
- `visual-check.js` (puppeteer-core) takes screenshots into `/visual-output` for visual QA - reuse the idea for dFresh.

## Differences for dFresh
- Public website first (no login for visitors); admin lives under `/admin` in the same repo.
- Own database `dfresh`; reads `dadmin` only for staff identity + login codes (app_key `dFresh`).
- Outbox tables for mail and Google Sheet instead of sending inside the request.
- Language prefix routing and DB-driven translations.
