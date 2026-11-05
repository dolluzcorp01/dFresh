# Phase 18 - Section 5 Inventory: complete to v23

Branch: `stage2` only. Needs phases 11 to 17. Read first: `CLAUDE.md`, `docs/STAGE2-GAP-MAP.md` (section 5),
`docs/STAGE2-TEST-ORDER.txt` (phase 5, steps 34 to 37, and phase 11, steps 67 to 69), and in
`docs/reference/dFresh_Back_Office_v23.html` the Inventory pages (Stock status, Batches and expiry, Transfers,
Stock take, Write-offs, Reorder, Stock ledger); the Tests page tab "5 Inventory" (18 tests) and the inventory items
in the fix tabs (transfers short / found / lost, I6, PK1, the count sheet with scanned packs, QC hold write-off
refused, N3, N7, N8). `docs/reference/dFresh_v23_Fix_Proof.md` has the expected figures.

## Steps
0. Carry-over from phase 17, house rules first:
   - Every product and pack row shows its photo (house rule: "every product must be shown with its image").
     Replace the generic item icons on the phase 16 and 17 pages (Purchase orders, Goods in, Quality check,
     Supplier bills, Recipes, Production runs, Wastage) with the pack photo, as v23 does. If the dev database has no
     photos, load the real product photos the live site uses so screens and parity can be judged.
   - Fix the layout differences in visual-output/phase-17/parity-table.md that are not data (stat tile icons,
     section headings, spacing); re-measure and show the "after" table. From now on every phase shows an
     "after" table; "fixed none" is not accepted.
1. Stock status: per pack and godown, by shelf (Good, QC hold, Damaged, Returned, Rejected, Disputed, On the road,
   In production), held for orders, free to sell (Good less held less expired), value (cost hidden without See
   cost, "hidden" never Rs 0).
2. Batches and expiry: each batch with mfg and expiry, near-expiry from the product's days, expired blocked from
   sale and transfer, FEFO everywhere.
3. Transfers between godowns: send (stock leaves Good to On the road, never expired, never packs a packer has
   scanned), receive with counts; a short goes to the Disputed shelf; Found or Lost settles it, Lost is a
   write-off with approval that the sender, the receiver and anyone standing in for them can never sign; Found
   and Lost are hidden while one waits. Transfer numbers carry the godown code.
4. Stock take: count sheets per godown and scope; the counted shelf is frozen while counting (moves refused with
   a clear message); packs scanned for orders still being packed are listed on the sheet; differences post only
   after approval, at average cost.
5. Write-offs and shelf moves: from any shelf except QC hold (QC hold is cleared only by Quality check, refused on
   the server too); a named batch is strict; room counted per batch; approval by value or packs; Returned to Good
   needs approval.
6. Reorder: packs and raw materials below their level per godown, with "Plan a run" (phase 17) and "Raise a PO"
   (phase 16) buttons.
7. Stock ledger: every movement with date, person, document, shelf, batch and cost; export for people with Export.
8. Screens on the shared blocks, v23 layout, pack photo on every row.

## Acceptance (real output)
- Run all 18 tests of the v23 "5 Inventory" tab and the inventory fix tests listed above; paste each result with
  figures, using v23's rule on our data where figures differ.
- Value check: total stock value before and after a transfer, a stock take difference and a write-off reconciles
  to the paise with the posted amounts.
- Existing stock and average cost identical after the migration.
- Public site unchanged (API, page text, main.js size).
- Everything from 11 to 17 still works: engine tests, `test:api`, the 12a to 17 scenario scripts with sections 0 to
  4 tests, the buying flow, nav, menu and two-godown checks, commerce flows.
- Visual parity with an "after" table for the 7 Inventory pages and the step 0 pages, at 1440 and 390, with photos.
- No long dash characters; read-only rule for anything set by the server or code.
- Write `docs/tests/SECTION-5-CLICK-TEST.md` for Pavithran.

Commit: `phase 18: section 5 Inventory complete - stock by shelf, batches, transfers, stock take, write-offs,
reorder, ledger`. Move this file to `docs/claude-tasks/done/`, push stage2, STOP and report.
