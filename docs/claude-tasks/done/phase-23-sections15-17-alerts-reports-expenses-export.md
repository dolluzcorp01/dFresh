# Phase 23 - Sections 15, 16 and 17 Alerts, reports, expenses and accounting export: complete to v23, then the full regression

Branch: `stage2` only. Needs phases 11 to 22. Read first: `CLAUDE.md` (light test rule applies until step 7; step 7 is
the full regression), `docs/STAGE2-GAP-MAP.md` (sections 15 to 17), `docs/STAGE2-TEST-ORDER.txt`, and in
`docs/reference/dFresh_Back_Office_v23.html` the pages Home (Dashboard, Alerts), Reports (Sales and purchases, Stock,
Money owed, GST and delivery), Money > Expenses (Expenses, Petty cash) and Money > Accounting export (Export to
accountant, Export history); the Tests page tabs "15 Notifications", "16 Reports and dashboard" and "17 Expenses and
accounting export"; and these fix items in `docs/reference/dFresh_v23_Fix_Proof.md`: Y1 (exporting the running month),
Y6 (freight bill), Y9 (stock report shelves), RP1 and RP2 (cost and godown masking in reports), T2 (approvals after
export), L1 payees (look-alikes), Low1 (packs with no cost). The proof file has the figures.

Notifications, the dashboard tiles, the report tabs and the CSV journal already work on stage2. Upgrade; every existing
notification, outbox message, report figure and export file stays identical for the same data.

## Steps
0. Carry-over from phase 22:
   - Scenario scripts live in the repo from now on: `scripts/scenarios/section-NN.js`, one per section, committed, run
     by `npm run scenarios` (all) or `npm run scenarios -- 12` (one). Rebuild the lost ones for sections 0 to 14 from
     the v23 Tests tabs and the click guides. Never keep test scripts only in a temp folder again.
   - Who inspects returns follows v23: a new right "Inspect returns" on the Returns row in Roles, given by the migration
     to Operations (v23's Supervisor) only. Warehouse loses it. Admin can tick it for any role.
   - Wallet switch as in v23: Admin > Switches > Wallet on / off (turning it on follows the switch approval rule).
     When off, Customer wallets shows v23's "wallet is off" box, orders show no wallet line, and balances stay saved.
   - Customer wallets gets v23's Export button (needs the Export right on Wallet).
   - Click guides 12, 13 and 14 are short (14, 14 and 13 steps). Grow each to cover every tab, button, approval path and
     role check on its pages, as sections 0 to 5 do.
1. Alerts (Home > Alerts): v23's list with who, what and when, read and unread, and a link to the record. Admin alerts for
   an override used, someone marked as left, leave entered for an Admin, and a rule loosened. Business alerts: overdue
   money, packs with no cost (Low1), stock below reorder, batches near expiry, waiting approvals older than their
   limit. Each alert type can be switched on or off per role by an Admin. WhatsApp and SMS stay off (no provider).
2. Dashboard: v23 tiles, every tile scoped by the person's godowns, cost and money masked ("hidden", never Rs 0), each
   tile opens the filtered list behind it.
3. Reports: Sales and purchases, Stock (value by godown and shelf including production and every other shelf (Y9),
   ageing buckets), Money owed (by days overdue as phase 22), GST and delivery. Cost, margin, average cost, scrap value
   and ageing value hidden for people without cost rights (RP1). Godown scope on every report (RP2). Export follows
   the Export right.
4. Expenses: heads, GST and ITC, payees keyed on PAN and approved once, look-alike payees refused (L1), repeating
   expenses, approval by the money limits, attach bill photo. Freight in: a transporter bill as an expense linked to a
   PO, its cost spread onto that PO's goods in, including part bills (Y6). This finishes the Supplier bills part that
   waited.
5. Petty cash per godown: float, spends with a head and a bill photo, top-up with approval, day close with counted cash
   and the difference shown.
6. Export to accountant: Tally XML and CSV per finished month only; the running month cannot be exported (Y1). Export
   locks the month; approvals after the export cannot post into it (T2). Export history lists every file with who,
   when and the totals, and can download it again. GST on expenses joins GSTR data (finishes that waiting part).
7. Full regression (this is the one the light rule saves for): run every scenario script for sections 0 to 17, the
   engine tests, test:api, the menu and nav checks, a fresh install, the layout check at 1440 and at 390 wide on every
   built page, the long dash check and the public files check. Fix what fails, then run it all again.
8. Screens on the shared blocks, v23 layout, pack photo on every product line.

## Acceptance (real output)
- All tests of the v23 "15", "16" and "17" tabs and the fix items above; paste each result with figures.
- Existing data: every notification, outbox message, report figure and earlier CSV export identical for the same
  data, checked against a snapshot.
- One full flow by script: transporter bill for a PO with two part goods in, cost spread on both; an expense with GST;
  a petty cash day with a top-up and a day close; the finished month exported to Tally and CSV, the running month
  refused, an approval after the export refused for that month; GSTR data shows the expense GST; every figure reconciles.
- Full regression table: one row per section 0 to 17 with steps run, passed and failed, plus every other check. Every
  row must pass on the second run. Paste the real output.
- Layout "after" table for the new pages at 1440 and 390.
- No long dash characters; read-only rule for values from the server.
- Write `docs/tests/SECTION-15-CLICK-TEST.md`, `SECTION-16-CLICK-TEST.md` and `SECTION-17-CLICK-TEST.md`.

Commit: `phase 23: sections 15 to 17 complete - alerts, reports, expenses, petty cash, Tally export, full regression`.
Move this file to `docs/claude-tasks/done/`, push stage2, STOP and report.
