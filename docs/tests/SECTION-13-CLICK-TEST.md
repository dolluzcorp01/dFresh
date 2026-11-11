# Section 13 - Promotions: click test

For Pavithran, before Shoban freezes section 13. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on. Sign in as **Pavithran** (Admin).
- Other people, in a second browser: **Anitha R** (Sub-admin), a **Supervisor** (Operations role), a **Sales**
  person and a **Warehouse** person.

## Part A - The pages

1. **Marketing > Offers**: rule chips, New offer, tabs Live, Waiting for approval, Drafts and later, Ended with counts.
   Each row: name, number and dates; what; for whom; given (of the budget, orders, free packs); status pill.
2. **Marketing > Coupons**: the same tabs; code and dates, what it gives, used (of the limit, per customer), given.
3. An old link `/admin/commerce/promotions?tab=coupons` opens Marketing > Coupons.

## Part B - Offers on an order

4. **New order** with 20 packs of a "buy 10 get 1" pack and 3 cartons of a slab pack: 2 free packs appear, the slab
   line shows its offer and discount. Save: the offer page shows what was given.
5. Tick **No offers on this order**: the free packs and the slab discount go; the total rises.

## Part C - Make, approve, reject, stop

6. As the **Supervisor**: New offer, Save with nothing filled: "Name the offer". Fill it in at 75% off a pack (below
   cost) and **Save and send for approval**: "Waiting for approval: New offer or coupon goes live, Promotion that
   sells below cost". The cost shows only to people with See cost, else "(hidden)". The Supervisor cannot sign it.
7. As Anitha, approve both cards: the offer is **Live**.
8. A draft offer: **Send for approval**; reject it as Anitha with a note: it shows **Sent back** with the note, can be
   changed and sent again.
9. A live offer: **Stop**, confirm: it moves to Ended; a new order no longer gets it; old orders keep it.
10. Change a live offer to give more (bigger %): it waits for approval again and stops applying until signed.

## Part D - Coupons

11. New coupon "we 1": "Code: 3 to 20 letters or digits". An existing code: "exists already". A good one waits for
    approval, then is Live with "used 0 of N".
12. On an order: a coupon used up by this customer, one above its minimum, and an unknown code each give their message.

## Part E - Returns and offers

13. Return 10 of 20 "buy 10 get 1" packs: the credit note credits the 10 and takes off 1 free pack "Free under ...,
    no longer due".

## Part F - Who does what

14. As **Sales**: the offers and coupons show, but no New offer, Send or Stop. As **Warehouse**: Promotions is not
    there. As the **Supervisor**: New offer, New coupon and New rule are there; approving is for Sub-admin and above.
