# Phase 0 - Foundation (repo, server, database, media)

Read first: CLAUDE.md, docs/02_ARCHITECTURE.md, docs/03_DATABASE.md, docs/reference/insideD-patterns.md.

## Goal
A running skeleton: React dev server + Express API on 4012 talking to a seeded `dfresh` database, media served,
no visible site yet beyond a placeholder that proves the API works.

## Steps
1. Inspect the existing repo (CRA already initialised: `public/`, `src/`, `package.json`). Do NOT delete git history.
   Keep react-scripts. Report what you found before changing anything.
2. Add dependencies (match Inside D versions where they exist): express@5, cors, cookie-parser, dotenv, mysql2,
   jsonwebtoken, bcryptjs, @sendgrid/mail, multer, sharp, exceljs, react-router-dom@6, googleapis; dev: nodemon,
   concurrently. Nothing else.
3. Scripts: `dev` (concurrently server + client), `server` (nodemon server.js), `start`, `build`, `test`,
   `db:reset` (scripts/db-reset.js, refuses when NODE_ENV=production), `media:build`.
4. Create `config/db.js` (Inside D pattern), `server.js` (dotenv first, CORS rule, json limit 1mb - NOT 100mb,
   cookie-parser, `/media` static with long cache headers, `/api/dfresh/health`), `.env.example` (copy from kit),
   `.gitignore` (add `.env*`, `/build`, `/private/*` except `.gitkeep`, `/visual-output`).
5. Database: run `database/01_schema.sql` and `database/02_seed.sql` on the LOCAL MySQL (utf8mb4 client).
6. Copy kit assets into `media/` exactly as `assets/README.md` says (products into `media/products/1200/`).
   Write `scripts/media-build.js` (sharp) that creates `400/` and `800/` WebP versions for products and
   checks every file referenced in `product_images` / `banners` exists. Run it.
7. Favicons from `assets/logo/web/` into `public/`; set `<title>dFresh</title>`, theme-color #121214.
8. `src/utils/api.js` (Inside D pattern, port 4012). Temporary `App.js` that calls `/api/dfresh/health` and shows the JSON.
9. Put the kit `docs/`, `database/`, `CLAUDE.md` in the repo (they should already be there from the zip). Add `README.md`
   with setup steps.

## Acceptance (show real output)
- `npm run dev` starts both; browser at :3000 shows health JSON with `db: "ok"` and counts
  `{ products: 25, variants: 3, languages: 3 }` (re-query the DB to confirm the numbers).
- `curl localhost:4012/media/products/400/DZIND-DF007_1.webp -I` -> 200 image/webp.
- media-build report: 84 product originals found, 168 generated, 22 banner files found, 0 missing.
- `git status` shows no `.env`, no `node_modules`, no `private/` files staged.

Commit: `phase 0: foundation - server, db, media, health`
Then move this file to `docs/claude-tasks/done/` and STOP.
