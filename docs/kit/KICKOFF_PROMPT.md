# Paste this into Claude Code (first session)

You are building the dFresh website with me, phase by phase.

I have unzipped `dfresh-kit.zip` into this repo root. It contains `CLAUDE.md`, `docs/` (project brief,
architecture, database, i18n, full feature spec, API, acceptance + open items, 9 phase task files, and
reference files: the developer brief PDF, the Product List Excel v0.2, the approved HTML preview v3 and an
Inside D patterns summary), `database/` (schema + seed, already tested), `assets/` (logos, 84 product
photos, 22 banners) and `.env.example`.

Do this now:
1. Read `CLAUDE.md` fully, then every file in `docs/` in number order (01 to 07) and
   `docs/reference/insideD-patterns.md`. Skim `docs/reference/dfresh-preview-v3-CODE-ONLY.html`
   to understand how the approved design behaves.
2. Look at the current repo (it is a fresh Create React App with git). Tell me in a short list:
   what you found, anything in the kit that conflicts with the repo, and any question you need answered
   before Phase 0. Do not change any file yet.
3. Wait for my "go". Then do ONLY `docs/claude-tasks/phase-00-foundation.md`, run its acceptance checks,
   show me the real output, commit, move the file to `docs/claude-tasks/done/`, and stop.

Rules for every session: follow CLAUDE.md, one phase per session, never skip acceptance checks, never
claim something works without showing the output, never use long dash characters, ask when unsure.
