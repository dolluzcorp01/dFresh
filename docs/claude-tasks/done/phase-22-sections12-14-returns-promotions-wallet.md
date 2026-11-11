# Phase 22 - Sections 12, 13 and 14 Returns, promotions and wallet: complete to v23

Branch: `stage2` only. Needs phases 11 to 21. Read first: `CLAUDE.md` (light test rule applies), `docs/STAGE2-GAP-MAP.md`
(sections 12 to 14), `docs/STAGE2-TEST-ORDER.txt` (phase 6 step 43, phase 9 steps 61 to 64), and in
`docs/reference/dFresh_Back_Office_v23.html` the pages Sales > Returns (Return requests, Inspection) and Marketing
(Offers, Coupons, Cashback rules, Customer wallets); the Tests page tabs "12 Returns", "13 Promotions" and
"14 Wallet" (10 tests each) and the fix items for these sections (X9 out-of-window returns, return room held on the
invoice, cashback under the rule minimum after a return (W2), offers kept on a credit check, wallet kept for a
dropped back-order, Kumar's wallets "hidden" not Rs 0). The proof file has the figures.

Returns (DFR numbers, window, pickup, credit note, replacement, refunds), offers, coupons, the wallet and manual
credit approval already work on stage2. Upgrade; every existing return, note, refund, offer, coupon and wallet
entry stays identical.

## Steps
0. Carry-over from phase 21:
   - Receivables ageing by days overdue (v23's 1-30, 31-60, 61-90, 90+ from the due date), not from the invoice date.
   - The invoice PDF shows the e-way bill number and the IRN, as the print view does.
1. Return requests: per invoice line; inside the window as today; outside it waits for approval; a later request
   sees what earlier requests already took from the window (X9); a waiting return holds its room on the invoice
   (phase 21); pickup as today.
2. Inspection: per line resell (back to Good with approval when it came from Returned), repack, or scrap
   (write-off with approval); missing packs; the credit note is made per invoice from the inspection.
3. Offers: slab, buy X get Y, as today, plus who, when and stacking with coupons; creating or changing an offer
   that gives more than the rule allows waits for approval. Coupons: as today, plus approval above the limit.
4. Cashback rules: % back as wallet credit after delivery and the return window; a new or loosened rule goes live
   only after approval. If a return takes the invoice under the rule's minimum, all of that cashback is taken back.
5. Customer wallets: lots shown as pending, usable and expiring; use on orders up to the switch %, oldest first;
   take-back on credit note or cancel; manual credit or debit with approval; scoped by godown; cost and money
   masking as everywhere ("hidden", never Rs 0).
6. Screens on the shared blocks, v23 layout, pack photo on every line.

## Acceptance (real output, light test rule)
- All 10 + 10 + 10 tests of the v23 "12 Returns", "13 Promotions" and "14 Wallet" tabs and the fix items above;
  paste each result with figures.
- Existing data: every return, credit note, refund, offer use, coupon use and wallet balance identical after the
  migration, checked against a snapshot.
- One full flow by script: order with an offer and a coupon, delivered, cashback pending then usable, part return
  outside the window (approved), inspection with resell and scrap, credit note within the invoice room, cashback
  taken back under the minimum, wallet used on the next order; every figure reconciles.
- The checks the light rule asks for; layout at 1440 on the new pages with an "after" table.
- No long dash characters; read-only rule.
- Write `docs/tests/SECTION-12-CLICK-TEST.md`, `SECTION-13-CLICK-TEST.md` and `SECTION-14-CLICK-TEST.md`.

Commit: `phase 22: sections 12 to 14 complete - returns, inspection, offers, coupons, cashback, wallets`.
Move this file to `docs/claude-tasks/done/`, push stage2, STOP and report.
