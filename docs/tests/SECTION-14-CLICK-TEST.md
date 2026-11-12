# Section 14 - Wallet and cashback: click test

For Pavithran, before Shoban freezes section 14. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on. Sign in as **Pavithran** (Admin); **Shoban** (Super admin) as the
  second Admin.
- Other people, in a second browser: **Anitha R** (Sub-admin), **Kumar M** (Supervisor), **Divya N** (Sales: view
  only), **Murugan S** (Warehouse: no Promotions).
- Have a customer with wallet money (demo: Demo Cafe Thendral, Rs 428.25), a hotel customer (rule "DEMO Hotels 3 %")
  and a distributor (rule "DEMO Distributors 2 %", from Rs 5,000).

## Part A - The wallet switch

1. **Admin > Settings > Switches > Money**: "Customer wallet and cashback on".
   On (the demo data had wallets before; a new install starts Off).
2. Turn it **Off**.
   Off at once (switching a control off is not a loosening).
3. **Marketing > Customer wallets** and **Marketing > Cashback rules**.
   Both show the yellow box "The wallet is off. ... While it is off, orders take no wallet and no cashback is earned;
   the balances below stay saved." The balances are still listed.
4. **New order** for Demo Cafe Thendral.
   No "Use wallet" field (an order being edited that already used the wallet keeps its line).
5. Turn it back **On** as Pavithran.
   It waits for a second Admin ("Switch ... waits"). As Shoban, approve it in Home > Approvals. It is On.

## Part B - Customer wallets

6. **Marketing > Customer wallets.**
   Chips "Usable: can go on an order now", "Pending: waits for the return window", "Wallet money is a discount, never
   cash". A blue box: Rs ... usable in all wallets, Rs ... runs out in 30 days, Rs ... pending; the most a wallet pays.
7. The table: Customer, Usable (with "kept for open orders"), Pending, Runs out in 30 days. Sort each column.
8. **Export** (a role with Export on Promotions).
   dfresh-wallets-DATE.csv: customer number, name, usable, pending, runs out, first expiry, kept.
9. Click a customer.
   The drawer: usable, pending, runs out in 30 days; the statement with every entry (source, details, amount,
   balance); Print statement.

## Part C - Using the wallet

10. New order for Demo Cafe Thendral, 40 packs of DF001-M100. Use wallet more than they have.
    "The wallet has only Rs ... that can be used".
11. Use 100.
    Wallet Rs 100 on the order; "At most 50% of the lines with no offer". Save: Customer wallets shows Rs 100 "kept for
    open orders".
12. An order whose every line has an offer (3 cartons of DF001-M100), Use wallet 50.
    "Wallet not used. Every line has an offer: the wallet cannot pay for those."
13. Cancel the order that used Rs 100.
    The Rs 100 is back in usable.
14. An order with wallet money where a back-order is dropped (Sales > Orders > Back-orders > Drop).
    The wallet share of the dropped packs is given back; the order keeps the rest.

## Part D - Earning and taking back

15. Deliver an order for the hotel customer.
    Customer wallets: Pending shows its cashback (3% of the goods). Paying the invoice does not make it usable.
16. After the return window (7 days; Marketing > Cashback rules > **Run now**).
    Run now: "DFO-... Rs ..."; the cashback moves from Pending to Usable.
17. A price-correction credit note on that invoice (Money > Billing > Credit notes).
    Its share of the cashback is taken back from the wallet.
18. A distributor order above Rs 5,000 with cashback, then a return that brings the goods under Rs 5,000.
    All of that cashback is taken back (W2): the return shows "Cashback Rs ... taken back".

## Part E - Cashback rules

19. **Marketing > Cashback rules.**
    Chips "Earned on the goods, without GST", when it is credited, "Goes live once approved"; a blue box "A return can
    take it back."; tabs Live, Waiting for approval, Drafts and later, Ended; Run now and New rule.
20. As **Kumar**: New rule, Save and send with nothing filled.
    "Name the rule".
21. `Distributors 1% back`, Distributor, 1%. Save and send.
    "Waiting for approval: New cashback rule goes live." After Anitha approves: Live.
22. A live rule changed to give more (2%): signed again; until then it stops.
23. Stop a rule: Ended.

## Part F - Manual credit or debit

24. A customer's wallet drawer: Manual credit with nothing filled.
    The button stays off until an amount and a reason are there.
25. Credit Rs 150, "Late delivery on 20 Oct".
    "Sent for approval (request #...)": usable does not change. After Anitha approves: +Rs 150.
26. A manual debit: same, through "Manual wallet debit".

## Part G - Who does what

27. As **Divya**: Customer wallets shows (her godowns); no Manual credit, no Export, no New rule.
28. As **Kumar**: New rule is there; the wallets show for his godown only, with real amounts.
29. As **Murugan**: "This needs view on Promotions".
30. A person who works only at another godown sees only that godown's customers' wallets.

## Part H - Layout and phone

31. Customer wallets at 390 px: "Runs out in 30 days" hides; the drawer opens full width; nothing scrolls sideways.
32. Put the wallet switch back as it was.
