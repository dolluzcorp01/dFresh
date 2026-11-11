# Section 14 - Wallet and cashback: click test

For Pavithran, before Shoban freezes section 14. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on. Sign in as **Pavithran** (Admin).
- Other people, in a second browser: **Anitha R** (Sub-admin), a **Supervisor**, a **Sales** and a **Warehouse** person.
- Have a customer with wallet money, and a customer type with a live cashback rule.

## Part A - The pages

1. **Marketing > Cashback rules**: rule chips, Run now, New rule, the box "A return can take it back", tabs Live,
   Waiting for approval, Drafts and later, Ended. Each rule: % back, cap, minimum, for whom, status.
2. **Marketing > Customer wallets**: "Rs ... usable in all customers' wallets", what runs out in 30 days and what is
   pending. Each customer: usable (and what is kept for open orders), pending, running out in 30 days. Only customers
   of your godowns show; an amount is never shown as Rs 0 when it is hidden.
3. A row opens the wallet: usable, pending, running out, the statement, Print statement, and the manual credit or
   debit for people who may make one.

## Part B - Using the wallet

4. New order for the customer with wallet money: use more than they have: "The wallet has only Rs ...". Use 100:
   "Wallet Rs 100" on the order; the wallets page shows Rs 100 "kept for open orders".
5. An order whose every line has an offer, with wallet: "Wallet not used. Every line has an offer".
6. Cancel the order that used the wallet: the Rs 100 is back.
7. An order with wallet money where a back-order is dropped: the wallet share of the dropped packs is given back.

## Part C - Earning and taking back

8. Deliver an order for a customer with a cashback rule: the wallet shows it **pending**. Paying the invoice does not
   make it usable; after the return window (Run now) it is usable.
9. A price-correction credit note on that invoice: its share of the cashback is taken back from the wallet.
10. A return that takes the order's goods under the rule's minimum: all of that cashback is taken back
    ("Cashback ... taken back" on the return).

## Part D - Approvals and rights

11. Manual credit with nothing filled: refused. Rs 150 "Late delivery": it waits; usable does not change until Anitha
    approves; then +150.
12. As the **Supervisor**: New rule, Save with nothing: "Name the rule"; fill it in and send: it waits; Anitha approves:
    Live.
13. As **Sales**: the wallets show, no manual credit and no New rule. As **Warehouse**: not there.
