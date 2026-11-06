# Section 11 - Payments and receivables: click test

For Pavithran, before Shoban freezes section 11. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on. Sign in as **Pavithran** (Admin).
- Other people, in a second browser: **Anitha R** (Sub-admin) and a **Sales** person with "Own customers only".
- Have customers with unpaid invoices: one overdue, one with two invoices, one cash customer.

## Part A - What customers owe

1. **Money > Payments > Receipts**: the row "Customers owe / Overdue / On account (credit)", tabs To collect, Receipts,
   Credit balances. To collect lists customers who owe, most overdue first, with 0-30, 31-60 and 61+ days, when they
   were last reminded, and Receipt; overdue rows have Remind; dues more than 30 days late have Write off.
2. **Remind** an overdue customer: the overdue reminder goes through the Outbox (only to MAIL_TEST_TO on stage2); the
   Reminded column shows today and to whom.

## Part B - Receipts (per customer, D2)

3. **Record receipt**: customer, amount, received on, how (Cash, UPI, Bank transfer, Cheque), reference, Set against.
   The blue panel says what it owes and what this receipt settles: "Settles DFI/... Rs ... After this: Rs ...".
4. UPI with no reference: "The UTR or UPI reference (at least 6 characters)". A reference already used: refused.
5. A customer with two invoices: an amount equal to the newer invoice's balance sets "Set against" to that invoice by
   itself; any other amount stays "Oldest dues first" (the oldest is settled first). Choosing an invoice puts it first.
6. Pay more than they owe: "Rs ... stays on account for the next invoice. After this: Rs -...". The customer shows in
   Credit balances; their next invoice uses it by itself (Invoices > Make invoice says so).
7. Open a receipt: customer, amount and how, date, by whom, what it settled. **Print receipt**: "Received with thanks
   from ... the sum of Rs ... (Rupees ... Only)", against what, the balance after.
8. A receipt dated in a month already exported to the CA, or before "Books closed up to", is refused under the date.
9. Cash collected on a trip or at pickup, and a payment recorded on an order, show here as receipts ("Cash on a trip",
   "Paid at pickup", "Recorded on the order").
10. A new order with an advance: the advance is a receipt "Advance for DFO-..." on account until that order's invoice.

## Part C - Cheques

11. Receipt by cheque: cheque number (6 digits), their bank and branch, cheque date. A cheque dated more than 3 months
    before the receipt: "Older than 3 months". The same cheque again: "already in the register".
12. **Money > Payments > Cheque register**: tabs To deposit, Deposited, Cleared, Bounced, Issued to suppliers. A cheque
    dated later shows "PDC" and "Post-dated" with no Deposited button.
13. **Deposited**, then **Bounced** (Funds insufficient, charge 500): the receipt is reversed (they owe it again), Rs 500
    is added, and the customer is On hold with the reason, so new orders wait.
14. **Waive charge** on the bounced cheque: "Waiting for approval". As Anitha: approve. The ledger has "Charge waived"
    and the customer owes Rs 500 less. A charge typed below the standard at the bounce waits for approval for the rest.

## Part D - Refunds and bad debts

15. **Credit balances**: Refund, why "Paid twice": above the rule (Rs 2,000) it waits; as Anitha approve: it is in
    Money > Payments > Refunds > Paid (DFRF/...) and the customer owes Rs 0. More than the credit balance, or money still
    in cheques not cleared, is refused. Refund to the wallet adds it to the customer's wallet.
16. **Write off** on a customer with dues more than 30 days late: "Write off Rs ...?" Ask; as a second Admin approve:
    the ledger has "Bad debt written off" and the customer is Blocked with the reason. If a payment came in meanwhile,
    the approval is refused: "... now owes Rs ... more than 30 days late".
17. Sales > Customers > Customer ledger: every line in date order with the running balance: invoices, cancelled
    invoices, credit and debit notes, receipts, bounced cheques, charges and waivers, refunds, write-offs.

## Part E - Rights

18. As the **Sales** person: Receipts shows only their customers and they can record a receipt; Refunds says "for the
    office, not Sales"; the cheque register shows only their customers' cheques; no Write off.
19. Every page and panel at phone width (390): no sideways scroll.
