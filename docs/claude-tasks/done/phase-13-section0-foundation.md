# Phase 13 - Section 0 Foundation and Setup: finish every Admin page to v23

Branch: `stage2` only. Needs phases 11, 12a, 12b. Read first: `CLAUDE.md`, `docs/STAGE2-GAP-MAP.md` (section 0),
`docs/STAGE2-MENU-MAP.md`, `docs/STAGE2-TEST-ORDER.txt` (phase 1, steps 1 to 9), and in
`docs/reference/dFresh_Back_Office_v23.html` the Admin pages (Company, Godowns, Numbering, Staff, Roles,
Approval rules, Stand-ins, Audit log, Notifications, Message templates, Outbox, Switches) and the Tests page,
tab "0 Foundation" (52 tests).

Goal: when this phase ends, section 0 is complete and ready for Pavithran to test and Shoban to freeze.

## Steps
1. Company (v23 Company page). Split into Profile, Tax (GSTIN with state check, PAN, CIN), Address, Bank
   accounts (a list: add, change, make default, inactive, bring back; every bank or UPI change waits for a second
   Admin and is never overridden; invoices keep the old account until approved), UPI ID for the invoice QR,
   Preferences, and System (Books closed up to, from 12b). Move today's free-text invoice settings into it; the
   invoice and its PDF read from here. Logo stays where the live site keeps it.
2. Numbering (v23 Numbering page). One row per document: prefix, godown code in the number where v23 has it,
   next number, reset (financial year or never), live sample. A number already used can never be issued again;
   lowering "next number" below the last used is refused.
3. Switches (v23 Switches page). One switches table in groups (Money, Stock, Orders, Delivery, Wallet, System),
   each with on/off or a number with its allowed min and max. Loosening waits for a second Admin (12b). Move the
   scattered settings (einvoice_mode, ewaybill_mode, delivery_otp, notify_sms, notify_whatsapp...) into it; keep
   `commerce_enabled` as the master switch.
4. Audit log, Notifications, Message templates, Outbox: bring to the v23 layout (filters, who, what, old and new
   value; templates per language with "check the wording" flag; outbox with status and retry). Logic stays.
5. Pages with no v23 design yet (My tasks, Financial year lock, Print templates, Label printer, Scanner): leave
   them as placeholders, relabelled "Later (Foundation v7)" in the menu map. Do not invent them.
6. Every section 0 screen on the shared blocks, chips instead of the blue help card, the "i" popups for field help.

## Acceptance (real output)
- Run all 52 tests of the v23 "0 Foundation" tab against our code (script them through the API and the screens,
  as in the 12a follow-up). Paste each result. Any test that needs a later section says so and is marked
  "needs section N"; nothing else may be skipped.
- Visual parity for Company, Numbering, Switches, Audit log and Outbox at 1440 and 390, as in earlier phases.
- Everything from 11, 12a, 12b still works: engine tests, `test:api`, the 12a and 12b scenario scripts, menu
  check (148), commerce flows, build size of the public main.js unchanged.
- No long dash characters.
- Write `docs/tests/SECTION-0-CLICK-TEST.md`: the steps for Pavithran to click through section 0 by hand
  (from STAGE2-TEST-ORDER phase 1 and the v23 tests), each with what he should see. Plain words, numbered.

Commit: `phase 13: section 0 Foundation complete - Company, Numbering, Switches, Audit, Communications`.
Move this file to `docs/claude-tasks/done/`, push stage2, STOP and report.
