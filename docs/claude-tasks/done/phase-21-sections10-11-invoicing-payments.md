# Phase 21 - Sections 10 and 11 Invoicing, GST and payments: complete to v23

Branch: `stage2` only. Needs phases 11 to 20. Read first: `CLAUDE.md`, `docs/STAGE2-GAP-MAP.md` (sections 10 and
11, decision D2), `docs/STAGE2-TEST-ORDER.txt` (phase 7 step 50 to 51, phase 8 steps 57 to 60, phase 11 step 72),
and in `docs/reference/dFresh_Back_Office_v23.html` the pages Money > Billing (Invoices, Credit notes, Debit notes,
Delivery challans), Money > Payments (Receipts, Refunds), GST (GSTR-1 / GSTR-3B data, E-invoice, E-way bill); the
Tests page tabs "10 Invoicing" (13 tests) and "11 Payments" (12 tests), the section 0 test 0.37, and the money
items in the fix tabs (Y7, Y8, T2, invoice cancel, return room held on the invoice, e-way load and number checks,
receipt matched by amount, debit note rules, bad debt and the month lock). The proof file has the figures.

GST invoices with CGST/SGST/IGST by place of supply, HSN summary, PDF, GSTR-1 registers, refunds and the customer
statement already work. Upgrade; every existing invoice, note, payment and balance stays identical.

## Steps
0. Clean up phase 20's checks before anything else, and show the results:
   - Update the 3 D1 checks (phase 14 kit availability, phase 17 packs without cost, phase 18 transfer of scanned
     packs) to the new rule that packed packs have left Good; each new expectation worked out and explained.
   - Make the 4 phase 19 date checks relative to today, never a fixed date.
   - Find the 3 phase 19 failures that phase 20 did not explain (its run log said 39 passed, 4 failed). Fix the
     code if it is a real bug, or the test if it is out of date, and say which for each.
   - Re-run every scenario script from 12a to 20: all must pass with 0 failures.
   - Carry-over 9.2: a hand-typed delivery charge on the order form that sticks (within a limit, with a reason
     when changed), and is invoiced.
1. Invoices: made from a packed shipment before the goods leave (one invoice per shipment); number per financial
   year; date-based GST rate (phase 15); logo and UPI QR on the print view as well as the PDF; "DEMO - not a tax
   invoice" until the company GSTIN is in. Invoice cancel on its own, with approval, refused when anything was paid
   or credited, when a debit note exists, or when its month is exported (then an "after export" request).
2. Credit notes: on an invoice, never more than its room; returns still open on that invoice hold their room;
   approval by value; keep the invoice's buyer and tax. Debit notes: extra charge on an invoice, refused on a
   cancelled invoice or one whose cancel waits.
3. Delivery challans: goods sent without a sale (samples, transfers out, job work later), numbered per godown.
4. E-way bill: needed when the invoice, or the day's invoices to one customer from one godown, pass the limit;
   12-digit numbers with the real checks (no repeated, sequential or leading-zero numbers); entered before the
   goods leave. E-invoice: IRN and ack number entered by hand when the switch is on (no government API yet).
5. Receipts (D2): per customer, not per order; cash, UPI, bank, cheque; set against the oldest dues, or the invoice
   the customer names, and an amount equal to one invoice's balance goes to that invoice; advances kept as a
   balance and used later; waivers and bad debt write-off with approval; every save checks the month lock.
   Today's per-order payments migrate into receipts with identical balances.
6. Refunds: as today, with approval; to bank, UPI or wallet; month lock.
7. GSTR-1 and GSTR-3B data per month for the CA (3B is new), with credit and debit notes; CSV export.
8. Screens on the shared blocks, v23 layout.

## Acceptance (real output)
- Step 0 results first: every script 12a to 20 with 0 failures.
- Run all 13 + 12 tests of the v23 "10 Invoicing" and "11 Payments" tabs, test 0.37 and the money fix items;
  paste each result with figures.
- Existing data: every invoice, note, payment, refund and customer balance identical after the migration, checked
  against a snapshot; each customer's balance = invoices + debit notes - credit notes - receipts - waivers.
- One full money flow by script: invoice, e-way bill, part receipt, receipt matched by amount, debit note, credit
  note within room, refund, bad debt write-off, GSTR-1 and 3B totals for the month; every figure reconciles.
- Public site unchanged (API, page text, main.js size).
- Visual parity with an "after" table for every Money and GST page built here; fix every difference not from data.
- No long dash characters; read-only rule.
- Write `docs/tests/SECTION-10-CLICK-TEST.md` and `docs/tests/SECTION-11-CLICK-TEST.md` for Pavithran.

Commit: `phase 21: sections 10 and 11 complete - invoices, notes, challans, e-way, receipts, refunds, GSTR data`.
Move this file to `docs/claude-tasks/done/`, push stage2, STOP and report.
