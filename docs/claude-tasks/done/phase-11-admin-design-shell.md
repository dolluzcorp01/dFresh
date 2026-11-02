# Phase 11 - Stage 2 admin: design shell (v23 look, new left menu, shared blocks)

Branch: `stage2` only. `main` (the live site) is never touched.

Read first:
- `CLAUDE.md` (standing rules, process hygiene, "be careful" standard).
- `docs/reference/dFresh_Back_Office_v23.html` - THE spec for look and behaviour of every admin screen
  (open it in a browser; its CSS variables, header, left menu, tables, drawers, pills, toasts are the target).
- `docs/STAGE2-GAP-MAP.md` - what exists on stage2 and what is Keep / Change / New. Decisions D1-D8 are all
  "follow v23" (confirmed by Shoban 2 Nov 2026).
- `docs/STAGE2-MENU-GUIDE.txt` - the left menu: 13 groups, 148 entries, with "What you see" / "Use it to" per page.
- `src/admin/` (AdminApp.js, Sidebar.js, ui.js, adminStyles.js and the Commerce* screens).

This phase is LOOK AND STRUCTURE ONLY. No business logic, API or database change. Every screen that works today
must still work the same way after this phase.

## Steps
1. Design tokens. Replace the token block in `adminStyles.js` with the v23 tokens (same names and values as the
   `:root` block of the v23 file: --brand, --accent, --bg, --surface, --line, --text, --muted, --good/--bad/--warn/
   --info with -bg and -line, --font, --font-head, --fs 15px, --fs-sm, --fs-h1 26px, --r 10px, --row 52px, etc.),
   still scoped under `.adm`. Keep the "CSS as a string" pattern: the admin must add 0 KB to the public bundle.
2. Header bar as in v23: dark brand box with the dFresh favicon, page breadcrumb, godown picker (shows "All godowns"
   for now - real godown scoping comes in phase 12), alerts bell with count, approvals count, who is logged in,
   sign out. Sticky, no wasted height.
3. Left menu: rebuild `Sidebar.js` to the exact 13 groups and 148 entries of `STAGE2-MENU-GUIDE.txt`, same order,
   same names, same icons (emoji in the guide = group icon). Keep what works today: permission-based hiding,
   remembered open groups per user, icon-only collapsed mode, slide-in drawer under 900px.
   - An entry whose screen already exists opens that screen (map each existing screen to its new menu entry; write
     the map as a table in the commit message body and in `docs/STAGE2-MENU-MAP.md`).
   - An entry with no screen yet opens one shared placeholder page: page title, a "Not built yet - phase NN" pill
     (phase from the gap map's build order), and the "What you see" / "Use it to" text from the guide.
4. Shared building blocks in `src/admin/ui.js` (split into `src/admin/ui/` files if it gets long), matching the
   v23 markup and look:
   - PageHead: breadcrumb, title, one-line subtitle, NEW / UPGRADE tag, action buttons on the right.
   - Chips (the short rule hints under the title) and Tabs with counts.
   - Table: sticky head, sortable columns, row click opens the drawer, number columns right-aligned, empty state.
   - Drawer: right side, title + thumb, status bar of pills, scrolling body, sticky foot with buttons.
   - Field: label, required star, input, error text under it, and the small "i" that opens a floating help popup
     (never inline text that shifts the layout).
   - Pill (good / bad / warn / info / gray / gold), Alert box (same four tones), Toast, Confirm box with a reason box.
   - ApprovalCard: kind label, godown, amount, summary, raised by, "can sign" list, Approve / Reject / Withdraw.
   - Money helpers: `money()` (Rs with Indian grouping), and `costText()` that shows "hidden" (never Rs 0) when the
     user cannot see cost.
5. Move every existing screen onto these blocks (PageHead, Table, Drawer, Field, Pill, Toast) without changing what
   it does. Product images stay visible in every product list (house rule).
6. Plain hyphens only: no long dash characters anywhere (house rule 10).

## Acceptance (show real output, not "tests pass")
- Visual parity, as in every earlier phase: the v23 file and `/admin` side by side at 1440 and 390 for the header,
  the left menu (open and collapsed), one list page, one drawer and one toast. Table of every difference over
  4px or 5%, fix, re-measure, show the "after" table. Screenshots in `/visual-output/phase-11/`.
- Menu count: a script lists the menu entries and prints the total - must be 148, in the guide's order; a diff
  against the guide shows no missing, extra or renamed entry.
- Every entry opens: Playwright clicks all 148 as Super admin; 0 console errors; built screens show their data,
  the rest show the placeholder with the right phase.
- Roles: log in as a Sales user and a Warehouse user; list the groups each sees; nothing they lack rights for shows,
  and the API still answers 403 for those routes.
- Nothing broke: `npm test` output, plus one click-through of each existing commerce flow (new order -> pack ->
  trip -> delivered -> invoice; a return; a stock-in; a write-off) with the same results as before this phase.
- Public bundle: `npm run build` sizes of the public main.js before and after - must be unchanged.
- `grep -rn $'\xe2\x80\x93\|\xe2\x80\x94' src docs` (en and em dash bytes) finds nothing new.

Commit: `phase 11: admin design shell - v23 look, 148-entry menu, shared blocks`. Move this file to
`docs/claude-tasks/done/`, STOP and report (with `Stopped: ...` per CLAUDE.md).
