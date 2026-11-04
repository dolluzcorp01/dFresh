# Phase 16 - Section 3 Suppliers and buying: complete to v23

Branch: `stage2` only. Needs phases 11 to 15. Read first: `CLAUDE.md`, `docs/STAGE2-GAP-MAP.md` (section 3),
`docs/STAGE2-TEST-ORDER.txt` (phase 3, steps 20 and 23 to 29), and in `docs/reference/dFresh_Back_Office_v23.html`
the pages Masters > Partners > Suppliers, Purchase (Indents, Purchase orders, Goods in, Quality check, Supplier
bills, Claims and purchase returns) and Money > Payments > Supplier payments; the Tests page tab "3 Buying"
(30 tests) and the buying items in the "v21 fixes", "v22 fixes" and "v23 fixes" tabs (B1, B3, B6, L1, X4, Y6,
and the smaller ones: supplier credit shown as credit, freight on goods with no PO, payment while a bank change
waits). `docs/reference/dFresh_v23_Fix_Proof.md` shows the expected figures.

Keep what works: today's purchase stock-in keeps working until goods in replaces it in the menu; production
stock-in stays until phase 17. Existing stock, batches and average cost must not change.

## Steps
0. Carry-over from phase 15: moving a customer type to another price list waits for Accounts or an Admin
   (rule `cust_change`), as v23 does - also for an Admin, because a second person decides.
1. Suppliers: GSTIN (state check), MSME (Udyam, type), contacts, address, payment terms, rating (on time %,
   rejected %), status (active, on hold, blocked with a reason). Bank account: a new supplier's or a changed bank
   waits for a second Admin and is never overridden; payments go only to the approved account (a change waiting
   does not stop payments to the approved one). What we owe; a supplier credit shows as "credit", never a minus.
2. Indents: staff ask for an item and quantity; an indent becomes a PO.
3. Purchase orders: lines, rates, discount, freight, expected date, terms. Approval above the limit, with POs to
   the same supplier within "Days that count together" added together (split counting, 12a). Amendments make a
   new revision; a revision that raises the value or adds a line waits; rejected revisions stay in the history and
   the terms come back. Goods in and bills use only the last APPROVED revision.
4. Goods in: against a PO (or without one, with approval when beyond tolerance); scan cartons; batch, mfg and
   expiry; everything goes to the QC hold shelf, not Good. Over-delivery beyond the tolerance waits.
5. Quality check: accept / reject per line; accepted packs move to Good at their landed cost (rate less discount
   plus their share of PO freight) and update the moving average; rejected packs go to the Rejected shelf and
   make a claim. With the QC switch off, goods pass at once (still at landed cost).
6. Supplier bills: matched to goods in and the approved PO rate, line by line (three-way match); a price
   difference waits for approval; bill total must match the lines, GST and freight within Rs 1. Freight: PO
   freight stays in cost until the PO's last bill, then is trued up; a "transporter bills the freight separately"
   tick keeps the estimate until that bill arrives; freight on goods with no PO waits for approval and goes into
   their cost. Packs already sold take their share as cost of sales. MSME due date never later than 45 days.
7. Claims and purchase returns: send rejected goods back, debit note, supplier credit note; claims settle.
8. Supplier payments: against bills, oldest due first; above the limit a second person signs; only to the
   approved bank account; a bill is paid only once it is matched or approved. Locked months refuse (12b).
9. Screens on the shared blocks, v23 layout; purchase rates and totals visible only with See cost or Buying Edit.

## Acceptance (real output)
- Run all 30 tests of the v23 "3 Buying" tab and the buying fix tests listed above; paste each result with
  figures. Use the figures in the proof file where the same steps apply.
- Stock and cost: every stock figure and average cost of existing SKUs identical after the migration.
- One full flow by script with real numbers: PO, approval, goods in, QC (accept and reject), bill with freight,
  claim with supplier credit note, supplier payment; show the average cost before and after each step.
- Public site unchanged (API, page text, main.js size).
- Everything from 11 to 15 still works: engine tests, `test:api`, the 12a to 15 scenario scripts with the section
  0, 1 and 2 tests, nav, menu and two-godown checks, commerce flows.
- Visual parity for Suppliers, Purchase orders, Goods in, Quality check, Supplier bills, Supplier payments at 1440
  and 390.
- No long dash characters; nothing that looks editable but is set by the server or code (read-only rule).
- Write `docs/tests/SECTION-3-CLICK-TEST.md` for Pavithran.

Commit: `phase 16: section 3 Buying complete - suppliers, indents, POs, goods in, QC, bills, freight, claims,
supplier payments`. Move this file to `docs/claude-tasks/done/`, push stage2, STOP and report.
