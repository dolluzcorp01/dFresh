# Phase 12a - Core engines, part 1: godowns, rights, limits, approval rules, stand-ins

Branch: `stage2` only. Read first: `CLAUDE.md`, `docs/STAGE2-GAP-MAP.md` (decisions D4, D5, D8 = follow v23),
`docs/reference/dFresh_Back_Office_v23.html` (Admin > Godowns, Staff, Roles, Approval rules, Stand-ins, Home >
Approvals; its in-app tests on the Tests page, sections 0, F, G, H), and the existing `approvals.js`,
`permissions.js`, `stock.js`, `numbering.js`.

These are ENGINES used by every later phase. Build them once, as shared server modules with unit tests; screens
only as far as needed to use and prove them. Existing data must survive: write migrations that move today's data
into the new shape (location 1 becomes the Kanchipuram godown; today's settings limits become rule limits).

## Steps
1. Godowns (D8). `locations` becomes the godown table: code (K, C...), name, address, person in charge, active.
   Every stock read and write takes a godown id; remove every hard-coded `location_id = 1`. Godown codes appear in
   document numbers where v23 shows them (DFT/C/..., DFG/C/...). The header godown picker filters every list and
   figure; "All godowns" only for people who work at all of them.
2. Shelves. `stock_movements.stock_kind` becomes the shelf: good, hold (QC hold), dmg (damaged), ret (returned),
   rej (rejected, to go back), disp (disputed). Map today's kinds (good, returned, damaged, expired-as-batch-state).
   One stock mover function `moveStock({sku, godown, shelf, qty, batch, strict, doc, what})` that every module uses:
   never below zero, lots by batch, a named batch is strict, expired batches never leave Good for a sale or transfer.
3. Rights (D5). Actions per section: view, create, edit, approve, cancel, export (keep delete where it exists).
   Plus the special rights v23 has: See cost, Edit on Buying shows purchase rates, own-customers-only.
   API checks every route; the UI only hides.
4. Limits (D4). Approval limit per role (Rs, or "anything", or nothing) with a personal override per person.
   Staff get godown scope (a set of godowns, or every godown). A person signs only inside their godowns and limit.
5. Approval rules (one table): kind, label, section, on/off, limit (Rs or %), unit, locked (cannot be switched off:
   company bank, supplier bank, rule change). Move today's 17 kinds and their settings into it. Rules page in Admin.
6. Approval engine (`approvals.js`), as in v23:
   - The ladder: who can sign a request = right to approve the section + limit covers the amount + godown covers
     the request's godown + not the requester + not away; excluded people for a request (e.g. the sender and
     receiver of a transfer) never sign it, nor anyone standing in for them.
   - Split counting: requests of one kind for the same target (supplier, payee, customer) within N days
     (switch "Days that count together") are added together before checking the limit; the card says so.
   - Expiry, withdraw, reject with reason, recheck at decide time (the thing may have changed since it was asked).
   - Every request stores the date of the record it is about (needed for the month lock in 12b).
7. Stand-ins. Leave dates + stand-in per person. Someone on leave signs nothing; their requests go to the
   stand-in, who must already approve the same sections with at least the same limit; the audit log names both.
   Leave for an Admin: entered by that Admin, or by another Admin at least 2 days ahead, at most 30 days, never
   changing a leave the Admin entered himself.
8. Screens (on the phase 11 blocks): Admin > Godowns, Staff (role, godowns, limit, leave), Roles (rights grid),
   Approval rules, Stand-ins; Home > Approvals uses the ladder ("can sign: ..." list on each card).

## Acceptance (real output)
- Unit tests for the stock mover, the ladder, split counting and stand-ins: list each case and its result.
- Migration on a copy of today's database: row counts before and after for stock, orders, approvals; every stock
  figure per SKU identical; Kanchipuram is godown K.
- Run these v23 in-app tests by hand or script and paste the results: section 0 tests on roles, limits, stand-ins
  and approvals; F and G tests on split counting and excluded signers; H "Lost on a transfer is never signed by
  its own people" (engine part only).
- Two godowns: a Chennai-only person sees no Kanchipuram stock, customers, money or requests, and cannot sign them.
- Everything from phase 11 still works: click-through of all 148 entries, 0 console errors; commerce flows as in
  phase 11 with the same results.
- No long dash characters.

Commit: `phase 12a: core - godowns, shelves, rights, limits, approval rules, stand-ins`. Move this file to
`docs/claude-tasks/done/`, STOP and report.
