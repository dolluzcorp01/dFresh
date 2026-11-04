# Phase 17 - Section 4 Production: complete to v23

Branch: `stage2` only. Needs phases 11 to 16. Read first: `CLAUDE.md`, `docs/STAGE2-GAP-MAP.md` (section 4),
`docs/STAGE2-TEST-ORDER.txt` (phase 4, steps 30 to 33), and in `docs/reference/dFresh_Back_Office_v23.html` the
pages Production (Recipes, Production runs, Wastage) and the production part of Purchase > Quality check; the
Tests page tab "4 Production" (16 tests), the section 0 tests 0.16 and 0.17 (they needed section 4), and the
production items in the fix tabs (PD1, PD2, less material, the abnormal loss and "Check again", rounding carried
into the last pack, packs with no cost). `docs/reference/dFresh_v23_Fix_Proof.md` (PD2, D section N3 and N11)
has the expected figures. Production > Job work stays "Later".

Shoban's decisions that apply here: rejects within the recipe's wastage % are a normal loss (cost spread over the
packs that passed, written off by quantity at Rs 0); rejects above it are an abnormal loss (written off at real
cost, with approval); if that approval is rejected, the packs go to QC hold at their run cost with a "Check
again" step, never lost, never stuck. Both lines show on the run.

## Steps
0. Carry-over from phase 16: every approval message must name who really signs it. Where the rule is "a second
   person with Approve" (supplier bank, payments...), the screens must not say "second Admin"; say "second Admin"
   only where only an Admin can sign. Check every message added in phases 12 to 16.
1. Recipes: raw material per pack (by base unit), wastage % allowed, versions with a start date (a run uses the
   version on its date); a recipe change needs approval; "Use this cost" sets the standard cost from the recipe
   (a lower cost waits, phase 14 rule).
2. Production runs: plan (pack, quantity, godown, recipe version), start = issue material from Good (batches
   strict, never expired, never below zero), finish = packs made, material used and returned, to QC hold.
   Using more than the recipe allows needs approval with a reason (wastage reasons list, including "Less
   material used than the recipe (recount)"); less material than the recipe also needs approval and nothing moves
   until it is signed. Made cost = material used at average cost, spread over the packs; rounding carried into
   the last pack (no lost paise).
3. Production QC (Purchase > Quality check lists runs too): pass / reject; passed packs to Good at made cost and
   into the moving average; normal and abnormal loss as above; "Check again" for packs back on QC hold, and a
   rejected re-check write-off returns to "Check again" (N11). Write-off room counted per batch (N3).
4. Packs with no cost: when packs already in stock had no cost at all, the run's cost is given to them and an
   alert says so (never silent).
5. Wastage page: wastage per run against the recipe, with reasons and approvals.
6. Replace the old "Stock in (production)" form: runs are now the only way finished packs are made; past
   production stock-ins stay listed; no stock or cost changes.
7. Production rights row in the roles grid (as v23), screens on the shared blocks, v23 layout, cost hidden
   without See cost.

## Acceptance (real output)
- Run all 16 tests of the v23 "4 Production" tab, section 0 tests 0.16 and 0.17, and the production fix tests;
  paste each result with figures; use the proof file's figures (PD2: 240 made, 3% = 7 normal at Rs 0, 33
  abnormal; passed packs carry only their own cost) worked out on our data with v23's rule.
- Value check after a run: stock value before + material cost = stock value after + normal loss (Rs 0) +
  abnormal loss, to the paise.
- Existing stock and average cost identical after the migration.
- Public site unchanged (API, page text, main.js size).
- Everything from 11 to 16 still works: engine tests, `test:api`, the 12a to 16 scenario scripts with sections 0
  to 3 tests, the buying flow script, nav, menu and two-godown checks, commerce flows.
- Visual parity for Recipes, Production runs (list and drawer), Wastage, production QC at 1440 and 390.
- No long dash characters; read-only rule for anything set by the server or code.
- Write `docs/tests/SECTION-4-CLICK-TEST.md` for Pavithran.

Commit: `phase 17: section 4 Production complete - recipes, runs, production QC, normal and abnormal loss`.
Move this file to `docs/claude-tasks/done/`, push stage2, STOP and report.
