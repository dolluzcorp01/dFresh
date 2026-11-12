# Section 17 - Expenses and accounting export: click test

For Pavithran, before Shoban freezes section 17. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on. Sign in as **Pavithran** (Admin).
- Other people, in a second browser: **Anitha R** (Sub-admin: approves and exports), **Kumar M** (Supervisor: records
  expenses and petty cash, cannot approve or export), **Divya N** (Sales: no Expenses).
- Approval rules (Admin > Users and security > Approval rules): "Expense above the limit" Rs 10,000, "A new payee
  (approved once)", "Petty cash top-up".
- Last month must be finished, with nothing dated in it still waiting for a decision, to try the export.

## Part A - Expenses: the page

1. **Money > Expenses > Expenses.**
   Chips "GST is input credit only with the payee GSTIN", "Above the limit a second person signs it", "A month with the
   CA is locked". New expense on the right. Figures: Spent this month, GST to claim, Biggest head.
2. Tabs Recorded, Waiting for approval, Drafts, Rejected and cancelled, each with its count. Rows: number, date and
   godown (and "exported" when its month is with the CA), head and payee, amount, GST (claim or no claim), how paid,
   status.

## Part B - New expense and payees (L1)

3. **New expense**, Save with nothing filled.
   Marked: Head, Amount, Paid to, Reference (for bank, UPI or cheque).
4. Head list.
   Power, Fuel, Salaries and Food and staff welfare say "(GST not claimable)".
5. Paid to `x`.
   "Who was paid? (at least 3 letters)".
6. A name not on the list without "New payee".
   "Not on the list. Pick a payee, or tick New payee to add one." (with "Looks like ..." when one is close).
7. `Sri Lakshmi Stationers`, tick New payee, Office and stationery, Rs 1,200, GST 18%, GSTIN 33ABCDE1234F1Z5, From petty
   cash (set the box's float first, Part D). Save.
   The line under the form: "Total Rs 1,416.00 (GST Rs 216.00, can be claimed) · Petty cash at Kanchipuram godown: Rs
   ... free now, Rs ... after". Saved: "DFX/26-27/... saved, Rs 1,416.00. Waiting for approval: A new payee (approved
   once)." The Rs 1,416 is kept aside in petty cash while it waits.
8. As Anitha approve the new payee.
   Then Money > GST > GSTR-1 / GSTR-3B data, this month: GSTR-3B input has the rows "Input: supplier bills (N bills)",
   "Input: ITC on expenses (1 expense)" (Rs 216.00) and "Input total"; the card "ITC on expenses" lists the
   expense (number, date, payee and head, GSTIN, 18%, Rs 1,200.00, Rs 216.00) and "Month total". The CSV for the CA has
   a "3B input ITC on expense" row and the "3B input ITC on expenses total".
   The expense is Recorded; the petty cash box is spent.
9. Another expense `Sri Laksmi Stationer` with New payee.
   "Looks like Sri Lakshmi Stationers on the list. One payee, one name: pick it."
10. A new payee with the same PAN as one on the list (GSTIN 33ABCDE1234F1Z5) and another name.
    "That PAN (ABCDE1234F) is Sri Lakshmi Stationers on the list: pick it."
11. `sri lakshmi stationers` again (picked from the list).
    Recorded at once: a payee is approved once.

## Part C - Approval, lock, cancel

12. Marketing Rs 15,000, bank, HDFC00944512, payee on the list.
    "Waiting for approval: Expense above the limit." The maker cannot sign it; after Anitha: Recorded.
13. A recorded expense: **Cancel this expense**, reason "Duplicate entry".
    Cancelled; a petty cash spend goes back into the box.
14. An expense of an exported month: Cancel.
    "2026-10 is exported to the CA and locked. Asked to change it: request ... waits for approval. After approval do it
    again; the CA is told." After approval it cancels; Export history lists the change.
15. A new expense dated in an exported month.
    "2026-10 is exported to the CA. Use a date in an open month."
16. A rejected expense: it shows "Sent back. Not approved: rejected by ...", can be changed and saved again.

## Part D - Petty cash

17. **Money > Expenses > Petty cash.**
    Chips "A box per godown", "Top-ups need a second person", "A count difference above Rs 100 shows in Alerts". One
    card per godown you work at.
18. A godown with no box: "Float to start the box" Rs 5,000, Save the float.
    The box has Rs 5,000 (Opening float).
19. Spend from it (Part B step 7); the box shows the spend.
20. **Ask for the top-up** (the field is filled with float less the box).
    "Top-up of Rs ... waits for approval." After Anitha: Rs 5,000 in the box.
21. **Counted in the box** Rs 4,750 at a box with Rs 5,000. Save the count.
    "Difference Rs -250.00. More than Rs 100: it shows in Alerts." Home > Alerts: "Petty cash count at ... is off by
    Rs -250.00".
22. A box under a quarter of its float: "Running low" (and in Alerts).

## Part E - Repeating expenses

23. A repeating expense (Salaries, Rs 1,86,000, every month on the 28th) that is due.
    A blue box "1 repeating expense is due" with **Make the drafts**.
24. Make the drafts.
    "1 draft made: DFX/... Salaries and wages"; the Drafts tab has it, "Made from repeating expense REP-..".
25. Open the draft, reference HDFC00955001, Save.
    It waits (above the limit); after approval it is Recorded; the repeat moves to next month.

## Part F - Freight in on a purchase (Y6)

26. Head "Freight in on a purchase (transporter)": a "For purchase order" field appears.
27. A transporter bill Rs 900 + 5% GST for a PO received in parts, then a second bill Rs 700.
    After each is recorded, the PO's freight in cost becomes what was billed (Rs 1,600), and the difference to the
    estimate is spread over all its goods in by value (Inventory > Stock ledger shows the cost adjustments).

## Part G - Export to accountant (Y1, T2)

28. **Money > Accounting export > Export to accountant.**
    Chips "Tally XML vouchers, and a CSV to check", "Ledger names from the mapping below", "An exported month is
    locked". A month picker (last 7 months, "(exported)" where done).
29. This month.
    "Fix first. 2026-11 is still running. A month is exported after it ends; exporting locks it for everybody." Export
    is off.
30. Last month with an expense draft dated in it.
    "Fix first. 1 expense still draft or waiting: DFX/...".
31. With every request of last month decided.
    "Ready. N vouchers, all balanced (debits equal credits), nothing waiting." The counts by type (Sales, Receipt,
    Purchase, Payment, Credit Note, Journal, Contra). The voucher table: type, number, date, party and ledgers, debit,
    credit.
32. **Export**, confirm.
    Two files download: dfresh-tally-YYYY-MM.xml (Tally import) and dfresh-vouchers-YYYY-MM.csv. The month is locked.
33. An approval dated in that month signed afterwards.
    "Cannot approve now: 2026-10 is exported to the CA and locked ..." (T2).
34. **Export again** after a change allowed after export.
    Only what is new, changed or cancelled goes, each voucher with its own id.
35. **Ledger names in Tally**: change Bank to "HDFC Bank 0412", Save names.
    "The next export uses these names." The vouchers now credit "HDFC Bank 0412". An empty name: "A ledger name cannot
    be empty: Bank".

## Part H - Export history

36. **Money > Accounting export > Export history.**
    Every export: month (times exported), when and who, both files (download again), vouchers, expenses, sales.
37. "Changes after export": every "Change after export" request with who, when and the decision.

## Part I - GST and reports

38. Reports > GST and delivery: the month's input GST includes the claimable expense GST.
39. Reports > Sales and purchases > Expenses and profit: by head; Rent counts without its claimed GST.

## Part J - Who does what

40. As Kumar: records expenses and petty cash at Kanchipuram, asks top-ups; Export says "Export needs the Export right
    on Expenses"; he cannot sign.
41. As Divya: "This needs view on Expenses and accounting export".
42. As Anitha: approves and exports.

## Part K - Layout and phone

43. Each page at 390 px: the stats stack, tables scroll inside their box, the petty cash fields stack, nothing scrolls
    sideways.
