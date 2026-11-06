# Section 8 - Packing: click test

For Pavithran, before Shoban freezes section 8. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on and two godowns. Sign in as **Pavithran** (Admin).
- Other people, in a second browser: a **Warehouse** person (Edit on Packing, no Create), a **Supervisor** (Create, Edit
  and Approve on Packing) and a **Sales** person.
- Admin > Switches > Orders: "Part shipments and back-orders allowed" On.
- Have at least two confirmed orders at the Kanchipuram godown with their packs held (Sales > Orders, Confirm), one of
  them for a batch-tracked pack (for example wet wipes) with more than one good batch on the shelf.

## Part A - To pick

1. **Fulfilment > Packing > To pick**: tab **Ready to pick** lists only confirmed orders with packs held, each with the
   first item's photo, the delivery (Our vehicle, Courier, Customer picks up) and the packs held. Drafts, orders
   waiting for approval and back-orders with nothing held are not here. The delivery filter and the date filter
   (ordered on or before) narrow the list.
2. Press **Make pick list** with nothing ticked: "Tick the orders first".
3. Tick an order of Kanchipuram and one of Chennai, Make pick list: "One godown per pick list ... Make one list for each."
4. Tick two Kanchipuram orders, Make pick list: a DFK/26-27/... number opens. "Take from the shelves" lists each pack
   with its photo, the bin, the packs and the batch to take (oldest expiry first, never an expired batch).
5. In **Sales > Orders** open one of the two orders: it is Packing and cannot be changed any more (no Change button).
6. Choose a packer (only people with Edit on Packing who cover the godown are offered), **Give to the packer**:
   "DFK/... is with ...". **Print pick list** shows the godown, the packer, each item with the batch and a tick box,
   and the orders on it.
7. As the **Warehouse** person: Make pick list is not offered (Create on Packing is needed). As the **Sales** person:
   the Packing pages are not in the menu, and a direct link says there is no access.

## Part B - Packing

8. **Fulfilment > Packing > Packing**: the orders being packed with the pick list, the packer and the progress
   ("Not started", "N of M packed"). Open one.
9. Scan (or type) **XYZ**: "Unknown code". Scan a pack that is not on the order: "Not on this order ... put it back".
10. Scan the right pack with a count less than needed: "+... N of M"; the row's Packed and Left change. Scan its
    carton label (SKU#C) when fewer than a carton are left: "Too many ... a carton is N packs: open the carton and scan
    packs".
11. Batch-tracked pack: the Batch box in its row lists the good batches, oldest first, with the packs free ("(oldest)"
    on the first). Scan the pack label with the planned batch chosen: it counts. Choose another batch and scan: it
    counts and "Packed so far" marks it "not the picked batch".
12. An expired batch typed as SKU/BATCH: "Expired batch ... it is never packed".
13. In "Packed so far", **remove** one scan: "Removed"; the counts go back.
14. Packing done with Boxes or Weight empty: both fields say what is needed.
15. With one line short: Packing done without a reason: "Say why it is short ... choose a reason in its row". Choose
    "Found damaged" in the row. As the **Warehouse** person Packing done: "Your supervisor (Approve on Packing) finishes a
    short packing". As the **Supervisor**: packed. The message says how many packs left the shelf, the damaged ones
    moved to the Damaged shelf, and the rest waits on a balance order (DFO-...-2, a part shipment).
16. A packing with "not the picked batch" scans: the Warehouse person cannot finish it, the Supervisor can.
17. **Inventory > Stock status / Stock ledger**: the packed packs left the Good shelf at Packed (exact batches, "Packed
    for ..."); starting the trip later does not move stock again.

## Part C - Packed, waiting

18. **Fulfilment > Packing > Packed, waiting**: tabs Our vehicle, Courier, Customer picks up with counts; each row has
    the address, boxes, weight and how long it has waited ("N days" in red after a day). A banner counts orders waiting
    more than a day.
19. Open one: **Packing slip** prints the address, contact, items with batch and packs, "not a tax invoice" and a
    signature line, no prices. **Box labels** prints one label per box ("Box 1 of 2" ...).
20. In Sales > Orders cancel a packed order with a reason: the packs go back to the shelf in their batches; the ledger
    line says "Unpacked: order cancelled".
21. Every page and panel at phone width (390): no sideways scroll, the scan box and count fit, every row shows the
    pack photo.
