# Section 9 - Delivery: click test

For Pavithran, before Shoban freezes section 9. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on. Sign in as **Pavithran** (Admin).
- Other people, in a second browser: a **Supervisor** (Create and Edit on Delivery), a **driver** (Delivery role, linked
  to a driver in Commerce settings > Drivers) and a **Sales** person.
- Two packed orders for our vehicle at Kanchipuram, one of a cash (pay on delivery) customer; one packed courier order;
  one packed "customer picks up" order of a cash customer.

## Part A - Masters

1. **Masters > Partners > Vehicles and drivers**: each vehicle with its godown, what it carries (kg and boxes), the
   insurance and fitness dates ("Soon" within 30 days, "Ended" in red) and its state (Ready / Cannot go out / Not in
   use). Drivers with their licence and valid until. New vehicle: number plate like TN 21 BC 4417, type, godown, kg,
   boxes, insurance date are required; the number plate cannot change once saved.
2. Open a driver: licence number and valid until; save.
3. **Masters > Partners > Couriers**: name, phone, charge per kg, minimum, tracking link with {awb}; New courier works.
4. **Masters > Tax and units > Delivery areas**: town or area, PIN codes, served from, days, charge, customers, website
   map. New area with a PIN already used by another area: "... already belongs to another area." With new PINs: saved.
   "Show on the website map" is kept with the area; the website map itself is unchanged.
5. In Sales > Orders, a new order for a customer in a charged area shows the area, its charge and the days we go.

## Part B - Trips

6. **Fulfilment > Delivery > Trips**: tabs Planned, On the road, Cash short, Closed; a banner counts packed orders
   waiting for our vehicle. **New trip**: godown, date, vehicle (with its limits and any paper problem), driver (with
   any licence problem), tick the packed orders to load. Nothing ticked: "Nothing loaded".
7. Load more than the vehicle carries (a small vehicle): "Too heavy for ...: the load would be ... it carries ...".
8. Start a trip on a vehicle whose insurance ended: "... cannot go out: insurance ended ...". Delete the planned trip:
   its orders wait in Packed, waiting again. A driver whose licence ended: "... cannot drive: licence ended ...".
9. A planned trip: **Load an order** adds one; the arrows change the order of the stops; x takes one off. The load
   shows kg of the vehicle's kg with a meter, and boxes. **Trip sheet** prints the stops in order with boxes, phone,
   cash to collect and the total.
10. **Start trip**: "on the road"; the tax invoices are made (one per shipment: a part shipment's balance has its own
    invoice and stop). The stock does not move again (it went down at Packed).

## Part C - At the stops (as the driver: My trips)

11. The driver sees only their trips. Record a stop with nothing filled: "Who took the goods?"; without ticking
    signed or a photo: "A signed slip or a photo is the proof."
12. Cash customer: enter less than due without a reason: "Cash is Rs ... less than due. Choose why." With a reason: saved.
13. **Delivered short**: enter how many of each they took, why: "N packs back on the Returned shelf; credit note
    DFC/...". The cash due is worked out again from what they kept.
14. **Refused** (why): every pack comes back to the Returned shelf with a credit note; the order is Refused.
15. **Not delivered** (why): the order shows in Failed / short / refused as "Still packed" with Re-attempt; Re-attempt puts
    it back in Packed, waiting. Stock does not move.
16. The driver cannot close the trip: "The supervisor closes the trip ...".

## Part D - Close and the lists

17. As the **Supervisor**: Close the trip with the cash handed in. Less than recorded without a note: asks for a note;
    with a note: closed, the trip shows in "Cash short" with the difference. A Supervisor cannot close a trip they drive
    themselves ("Not your own trip ...").
18. **Cash on delivery**: per trip to collect, collected (what is left on account), handed in, short, status.
19. **Courier and pickup**: Courier to book: Book courier (courier, AWB required, e-way bill when needed, the charge to
    us worked out from the weight, not saved). With the courier: tracking link, Delivered, or **Came back** (every pack to
    the Returned shelf with a credit note, order Refused). Pickup ready: Collected with name and phone (a phone not
    among the customer's contacts is noted), cash received, signed. Done lists them.
20. **Proof of delivery**: who received each delivery, when, and the proof (Signed / Photo; "None" in red, with a
    banner counting them). A photo opens from its pill.
21. **Failed / short / refused**: what happened, why, and the goods (packs on the Returned shelf with the return and the
    credit note, or still packed).
22. As the **Sales** person: the Delivery pages are not in the menu.
23. Every page and panel at phone width (390): no sideways scroll; My trips works on a phone.
