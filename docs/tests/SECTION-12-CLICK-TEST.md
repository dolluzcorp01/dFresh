# Section 12 - Returns: click test

For Pavithran, before Shoban freezes section 12. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on. Sign in as **Pavithran** (Admin).
- Other people, in a second browser: **Anitha R** (Sub-admin), a **Warehouse** person and a **Sales** person.
- Have two delivered orders: one delivered today, one delivered more than 7 days ago (the return window).
- To try "resell", turn on Commerce settings > Returns > "Returned stock can be sold again". Turn it off at the end.

## Part A - The pages

1. **Sales > Returns > Return requests**: rule chips, New return, tabs Waiting for approval, To collect, To inspect,
   Decision waiting, Closed, each with its count. Every row shows the first pack's photo, the customer, the reason
   ("Outside the window" when it was), how it comes back and the status. A row opens the return.
2. **Sales > Returns > Inspection**: "N packs on the Returned shelf", the returns to inspect (oldest first), the
   inspected ones whose money decision waits, and the Returned shelf per pack and godown with photos.

## Part B - A return outside the window

3. **New return**: choose the order delivered more than 7 days ago. The lines show what was delivered and "can
   return" for each. Save with nothing chosen: refused. Choose 4 packs, a reason, "pickup on a trip", Save.
4. It waits: tab **Waiting for approval**, and a card in Approvals. As Anitha, approve. It moves to **To collect**.
5. Make another return on the same order for more than is left: refused ("at most N pack(s) can still be returned"):
   the first return holds its packs even while it waited.

## Part C - Collect, inspect, credit

6. **Fulfilment > Trips**: a new trip with the return pickup; start it; the driver records Picked up with a photo.
   The return is now in **To inspect**.
7. Open it, scan the packs in, **Inspect**: columns Resell, Repack, Damaged, Scrap, Expired, Not received. Make a line
   not add up: "Each line must add up to its packs". Resell 2, Damaged 2: "Waiting for approval: Returned stock back
   to Good". The 2 resell packs stay on the Returned shelf until it is signed; the 2 damaged go to Damaged.
8. As Anitha, approve "Returned stock back to Good": the 2 packs are now Good stock.
9. **Refund** the 4 packs to the balance: the credit note is made against the invoice; the customer owes less by its
   total (Money > Customer ledger).

## Part D - Sent back, replacement, no refund

10. A return inspected as Resell 6: reject the "back to Good" as Anitha. The return shows "Inspect again" and the
    history says "Sent back ... 6 packs stay on the Returned shelf". Inspect again: Scrap 6. Done.
11. A return inside the window, Damaged 3, decision **Replace 3**: a Rs 0 replacement order "Replacement for DFR-..."
    is made and goes through picking and packing like any order.
12. A return with Scrap 2 and **No refund**: it waits for approval; after it, Closed, the customer owes the same, and
    the 2 packs left stock through a write-off.
13. A delivery recorded short on a trip: its return appears Closed ("money settled at delivery") and its packs show on
    the Inspection page's Returned shelf.

## Part E - Who does what

14. As **Sales**: Sales > Returns says it needs Returns rights. As **Warehouse**: the returns show, Inspect is there
    (Inventory edit), New return is not.
