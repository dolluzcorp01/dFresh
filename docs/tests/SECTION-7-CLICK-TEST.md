# Section 7 - Quotes and orders: click test

For Pavithran, before Shoban freezes section 7. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on and two godowns. Sign in as **Pavithran** (Admin).
- Other people, in a second browser: a **Sales** person (Own customers only) with a few customers, and a second person
  who can approve orders (another Admin).
- Admin > Switches > Orders: "Part shipments and back-orders allowed" On, "Stock is held for an unpacked order for"
  48 hours, "Standing orders are made confirmed" Off.

## Part A - Quotes

1. **Sales > Orders > Quotes**, New quote: a customer, Ships from, Valid until (15 days ahead), two packs. Each line
   shows the pack photo and, under it, the list price, GST and the free stock. Total, CGST and SGST show below.
2. Type a price well below the list on one line: the line says "N% below the list" and the box "Needs approval before
   it goes to the customer". **Save and send**: "Waiting for approval". As the second person reject one card: the
   quote is a Draft with "Sent back. ... rejected by ..." and the other cards close too.
3. A quote at the list price: Save and send: Sent. **Print or send** shows the quotation with the logo, the customer,
   the lines with HSN, GST and amount, the totals and "Valid until". Back opens the quote again.
4. A quote for an **enquiry** (not yet a customer): Make order says "First, make them a customer" and opens the enquiry
   to convert it. After the customer is made the quote belongs to it; Make order works.
5. An expired quote (valid until in the past) shows "Expired on ..." in red and no Make order. **Revise** with a new
   date: Rev 2, Sent, Rev 1 in "Earlier revisions"; it is priced again from today's list.
6. **Make order** on a sent quote: a draft order opens "From quote DFQ/... The quoted prices are kept.", the lines at
   the quoted prices. Confirm order: Confirmed (or Waiting for approval); the quote is Won with the order number.
7. Lost: choose a reason, Mark lost: the quote moves to Lost and expired.

## Part B - Orders

8. **Sales > Orders > Orders.** Tabs Draft, Waiting for approval, Confirmed, Packing and packed, Dispatched,
   Delivered, Cancelled, All. Each row: order (Rev, godown, date), customer, items, total, Stock ("N of N held", hours
   left, "N on back-order", "Hold ended"), status.
9. New order, **Save draft**: in Draft, nothing held. Open draft, **Confirm order**: Confirmed, "packs held";
   Inventory > Stock status shows them held.
10. An order for a customer with an overdue invoice: "Waiting for approval. No stock is held yet." Approve it: Confirmed,
    "approved by ...", the packs held.
11. An order for more than is free (part shipments on): the box says "Short: ... N would go on back-order"; Confirmed
    holds what is free and the rest shows on back-order.
12. A kit: choose it under Kits: one line, its price per kit; confirmed, the stock is held from its parts (the drawer
    lists the parts "Part of kit KIT-0N").
13. As a person **without See cost**, a price below cost plus margin: the form never names cost or margin; it says
    "Prices are also checked against cost when you save". Save: it waits for a "Price check".
14. Change a confirmed order (more packs): "Save Rev 2"; the drawer shows Rev 2 and "Earlier revisions: Rev 1 ...".
15. Hold time: on a confirmed order not packed within the hours, the list shows "Hold ended", the banner on Orders
    says so, the packs are free to sell again and the salesperson gets the "Stock hold ended" message. **Hold again**
    holds what is free now.
16. Cancel a confirmed order with no reason: "Say why the order is cancelled". With a reason: cancelled, the held packs
    free again. Cancelling an order that has left the godown waits for approval.
17. As the Sales person: only orders and quotes of their own customers show.

## Part C - Back-orders and standing orders

18. **Sales > Orders > Back-orders**: each owed line, oldest order first, with free now and "Waiting for stock" or
    "Stock arrived". Bring stock in on Good (a transfer received, goods in passed QC): the oldest back-order is held by
    itself straight after. **Hold now** holds what is free; **Drop** (confirm) takes what is owed off the order (the
    total drops; any wallet kept for it is freed).
19. A new order for the same pack at that godown cannot take what older orders are owed ("N free ... would go on
    back-order").
20. **Sales > Orders > Standing orders**, New standing order: a customer, Every week on 3 (Wednesday), from today, two
    lines. Saved "Every Wednesday. Next order on ...".
21. When one is due it shows "Due" and a banner; **Make today's orders** makes a Draft order with today's prices in
    Orders > Draft and moves Next on by a week (Switches On: made confirmed, with the same checks).
22. On a phone (390 wide): every page and panel above works with no sideways scroll; tables become cards.
