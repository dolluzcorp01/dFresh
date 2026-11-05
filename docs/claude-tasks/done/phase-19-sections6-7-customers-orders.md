# Phase 19 - Sections 6 and 7 Leads, customers, quotes and orders: complete to v23

Branch: `stage2` only. Needs phases 11 to 18. Read first: `CLAUDE.md`, `docs/STAGE2-GAP-MAP.md` (sections 6 and 7,
decision D3), `docs/STAGE2-TEST-ORDER.txt` (phase 6, steps 38 to 47), and in `docs/reference/dFresh_Back_Office_v23.html`
the Sales pages (Leads: Enquiries, Follow-ups; Customers: Customer list, Customer types, Credit limits, Customer
ledger; Orders: Quotes, Orders, Standing orders, Back-orders); the Tests page tabs "6 Customers" (16 tests) and
"7 Orders" (16 tests) and the sales items in the fix tabs (C1, RP2, Y8, Y11, the
back-order and quote items, the margin message, special price drafts). `docs/reference/dFresh_v23_Fix_Proof.md`
has the expected figures.

This is the section with the most live logic already on stage2 (orders, reservations, approvals, customers, merge,
own-customers-only, credit). Upgrade it; do not rebuild what works. Every order, reservation, invoice and payment
that exists today must keep its numbers and totals. Packing, delivery and invoicing stay as they are until phases
20 and 21; this phase must not break them.

## Steps
0. Carry-over: our built-in Warehouse role keeps Edit on Inventory (Shoban decides in Roles); nothing to build.
1. Enquiries and follow-ups: follow-ups on enquiries too (not only customers); convert to customer as today.
2. Customers (D3): status active / on hold / blocked (map today's on_hold and inactive). Sales may tighten (hold
   or block); easing needs Accounts or an Admin. Customer godown (customers are seen only inside the godowns a
   person works at; money tiles, lists, ledger and wallets scoped the same way). A new customer, or a type, on a
   non-standard price list waits (the customer starts on a standard-list type). A role change away from Sales
   hands the customers over (as leaving does). Merge keeps the invoice buyer on old documents; only the ledger
   moves.
3. Credit limits and ledger: as today, plus godown scope and cost masking.
4. Quotes (new): valid-until date, prices kept until then; the form shows exactly the price the save will use
   (kept, or today's when the quote expired or its date moved later); convert to an order in one press.
5. Orders: draft (server side), waiting approval, confirmed (holds stock), and today's statuses after it.
   Numbered revisions. Pricing in one function for the form, the save and the API: the customer's list and
   special price, quantity slabs, the lowest allowed price, cost + margin (people without See cost see "checked
   against cost when you save" and the request is a "Price check"), MRP cap, "in steps of", discontinued packs
   (sell from stock, never back-ordered), kits sold as one line taking stock from their parts.
6. Hold expiry: stock held for an order that is not packed within the switch's hours is released, with a message
   to the salesperson.
7. Back-orders: short lines are owed; new stock on Good is held for the oldest order first (after the action that
   brought it in); "Hold now"; "Drop" (frees any wallet kept for it).
8. Standing orders: repeat orders on a schedule, made as drafts or confirmed (setting), with the same checks.
9. Screens on the shared blocks, v23 layout, pack photo on every line.

## Acceptance (real output)
- Run all 16 + 16 tests of the v23 "6 Customers" and "7 Orders" tabs and the sales fix tests listed above; paste
  each result with figures (v23's rule on our data where figures differ).
- Existing data: every order, invoice and payment total, every held quantity and every customer balance identical
  after the migration (compare against a snapshot).
- One full sales flow by script: enquiry, customer, credit limit, special price, quote, order (with a slab, a kit
  and a back-order), approval, confirm, and on into today's packing, trip, delivery and invoice, with the same
  results as before.
- Public site unchanged (API, page text, main.js size).
- Everything from 11 to 18 still works: engine tests, `test:api`, all scenario scripts with sections 0 to 5 tests,
  buying flow, nav, menu, two-godown checks, commerce flows.
- Visual parity with an "after" table for every Sales page at 1440 and 390; fix every difference that is not data.
- No long dash characters; read-only rule.
- Write `docs/tests/SECTION-6-CLICK-TEST.md` and `docs/tests/SECTION-7-CLICK-TEST.md` for Pavithran.

Commit: `phase 19: sections 6 and 7 complete - customers, credit, quotes, orders, back-orders, standing orders`.
Move this file to `docs/claude-tasks/done/`, push stage2, STOP and report.
