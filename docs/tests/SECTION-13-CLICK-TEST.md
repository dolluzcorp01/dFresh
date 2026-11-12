# Section 13 - Promotions: click test

For Pavithran, before Shoban freezes section 13. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on. Sign in as **Pavithran** (Admin).
- Other people, in a second browser: **Anitha R** (Sub-admin), **Kumar M** (Supervisor: Operations rights, view,
  create and edit on Promotions), **Divya N** (Sales: view only), **Murugan S** (Warehouse: no Promotions).
- Approval rules on (Admin > Users and security > Approval rules): "New offer or coupon goes live", "Promotion that
  sells below cost", "Discount above the limit".
- The figures below are the demo data (offers "DEMO Bulk napkins" 5% from 3 cartons and "DEMO Wet wipes 10 + 1";
  coupons FREESHIP, FRESH5, HOTEL500, WELCOME10). With other data the messages say the same with your figures.

## Part A - Offers: the page

1. **Marketing > Offers.**
   Title Offers, "Offers that apply by themselves on orders", chips "Applies by itself on orders", the coupon rule of
   Commerce settings, "Goes live once approved". **New offer** on the right.
2. Tabs Live, Waiting for approval, Drafts and later, Ended, each with its count.
3. Each row: name, number and dates; what it gives and on what (SKU or category); for whom (types, named customers or
   Everyone); given so far (of the budget), orders and free packs; the status pill.
4. Click a live offer.
   The drawer: status Live, Stop; the form greyed for a person without Edit.
5. An old link `/admin/commerce/promotions?tab=offers` opens Marketing > Offers.

## Part B - A new offer, below cost, two signatures

6. As **Kumar**: New offer, press **Save and send for approval** with nothing filled.
   "Name the offer (it shows on the order line)".
7. Name `Wet Wipes clearance`, Type Quantity slab, On DF044-M100, From 1 pack, 75% off, valid to a date this month.
   Save and send for approval.
   "Waiting for approval: New offer or coupon goes live, Promotion that sells below cost." The offer is in Waiting for
   approval. Its drawer shows both requests; the below-cost one names the pack, the price and "against cost Rs ...".
8. As **Divya** (no See cost) open it.
   The cost reads "(hidden)", never Rs 0.
9. As **Kumar**, Home > Approvals: try to sign his own request.
   Refused: "You raised it. Somebody else must decide."
10. As **Anitha**, approve both.
    The offer is **Live** (or "Starts later" when its start is in the future).

## Part C - Drafts, rejection, changes, stop

11. New offer as a draft: **Save as draft**.
    It is in Drafts and later as Draft.
12. Open it, **Send for approval**. As Anitha **reject** with a note.
    It shows **Sent back** with "New offer or coupon goes live: rejected by Anitha R". The form can be changed.
13. Change it and **Save and send for approval** again.
    Waiting for approval again.
14. A live offer: change it to give more (bigger %), Save.
    It is signed again: it waits, and it stops applying to new orders until signed.
15. A live offer: change only its name. Save.
    "Saved." It stays live.
16. A live offer: **Stop**, confirm.
    "Ended. Orders already made keep it." It moves to Ended. A new order no longer gets it.
17. A waiting offer cannot be changed: "waits for approval: decide it first, or stop it".

## Part D - Who, budget and stacking

18. An offer for named customers only (Named customers: Demo Hotel Sangam).
    Another customer's order does not get it.
19. An offer with a budget of Rs 100: once Rs 100 has been given, new orders no longer get it; Given shows "of Rs 100".
20. "With a coupon on the same order": As the Commerce setting / Yes / No.
    With No, an order with this offer refuses a coupon; with Yes it takes one.

## Part E - Offers on an order

21. **Sales > Orders > New order**: Demo Hotel Sangam, 20 packs of DF044-M100 and 3 cartons of DF001-M100.
    Two DF044-M100 free lines appear ("Offer: ..."), the napkins line shows its 5% offer and discount.
22. Tick **No offers on this order**.
    The free packs and the slab discount go; the total rises; a coupon can still be used.
23. A typed price below the list on an offer line: no offer on that line, and the price check applies.
24. An order held for a credit check: after the approval the order keeps its offers (OFFKEEP).

## Part F - Coupons

25. **Marketing > Coupons.**
    Chips "Typed on the order (website in stage 3)", "One coupon per order", the approval rule. Tabs as Offers. Rows:
    code and dates, what it gives, used (of the limit, a customer), given, status.
26. New coupon, code `we 1`, Save and send.
    "Code: 3 to 20 letters or digits".
27. Code `WELCOME10`.
    "Coupon WELCOME10 exists already".
28. Code `HOTEL5`, 5% off, at most Rs 300, from Rs 3,000, 20 uses, 2 a customer. Save and send.
    It waits; after Anitha approves: Live, "5% off, at most Rs 300.00, from Rs 3,000.00", used 0 of 20.
29. Open a coupon, **Usage**.
    The orders that used it, with the discount and when; given back when the order was cancelled.
30. On an order: `welcome10` for a first-time customer: applied. The same customer again: "this customer has used it 1
    time already (limit 1 per customer)". HOTEL500 on a small order: "needs goods of at least Rs 5,000.00". `NOPE`:
    "No coupon NOPE".
31. Stop a coupon: it is Ended; orders already made keep it.

## Part G - Returns and offers

32. Return 10 of the 20 "buy 10 get 1" packs (Sales > Returns).
    The credit note credits the 10 packs and takes off 1 free pack, "Free under DEMO Wet wipes 10 + 1, no longer due".

## Part H - Who does what

33. As **Divya**: Offers and Coupons show, with their details, but no New offer, New coupon, Send or Stop.
34. As **Murugan**: Marketing is not in the menu; the address answers "This needs view on Promotions".
35. As **Kumar**: New offer, New coupon and New rule are there; approving is for Sub-admin and above.

## Part I - Layout and phone

36. Offers, Coupons and Cashback rules at 390 px: What and For hide; nothing scrolls sideways; the drawers open full
    width.
37. Every tab with nothing in it says "Nothing here".
