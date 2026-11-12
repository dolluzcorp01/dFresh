# Section 12 - Returns: click test

For Pavithran, before Shoban freezes section 12. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on. Sign in as **Pavithran** (Admin).
- Other people, in a second browser: **Anitha R** (Sub-admin), **Kumar M** (Supervisor: the role has "Inspect
  returns" ticked on the Returns row), **Murugan S** (Warehouse), **Divya N** (Sales).
- Have three delivered orders: one delivered today, one delivered 15 days ago (outside the 7-day return window), and
  one with a "buy 10 get 1" offer line (20 packs + 2 free).
- Resell needs Commerce settings > Returns > "Returned stock can be sold again" On. Steps 23 to 27 turn it on; turn it
  back as it was at the end (step 49).
- The figures below are the demo data; with other data the messages say the same thing with your figures.

## Part A - Return requests: the page

1. **Sales > Returns > Return requests.**
   Breadcrumb Sales / Returns / Return requests, the title and the line "Customers who send goods back". Three rule
   chips: "Against a delivered order", "Return window 7 days (Commerce settings)", "Credit note after inspection, for
   what came back". A **New return** button on the right.
2. Look at the tabs.
   Waiting for approval, To collect (open first), To inspect, Decision waiting, Closed. A tab with returns shows its
   count.
3. Click each tab.
   Each list shows, per return: the number and when it was made, the godown; the customer, customer number and order
   number; the first pack's photo with its name and the packs; the reason (with "Outside the window" when it was); how
   it comes back; the status pill, and what it waits for.
4. Click a return in Closed.
   The return opens on the right: the steps Requested, Collecting, Received, Inspected and the end, the order and
   customer, reason, delivery date and window, how it comes back, the lines with their pack photo, refunds and credit
   notes, photos, approvals and history.
5. Close it (X or Esc).
   Back on the list, same tab.

## Part B - New return outside the window

6. **New return.** The panel lists delivered orders, newest first, with the customer and how many days ago.
7. Choose the order delivered 15 days ago.
   "Delivered on ... (15 days ago). Return window: 7 days." A yellow box: outside the window, it waits for approval
   before it is collected. Each line shows its pack photo, batch, delivered and "can return".
8. Press **Save return** with no pack and no reason.
   It stays off (the button is grey until a pack and a reason are chosen).
9. Type more packs than "can return".
   The field stops at the most allowed; saving more is refused by the server with "at most N pack(s) can still be
   returned".
10. Return 4 packs, reason Damaged, comes back "Pickup on a trip", said "Packs crushed in the box". Save, confirm.
    The return opens: a yellow box "Outside the return window ... it waits for approval". It is in **Waiting for
    approval** with "waits: Return outside the window".
11. Make a second return on the same order for the other packs.
    "Can return" shows only what the first (still waiting) return did not take (X9). More is refused.
12. As **Anitha**: Home > Approvals, approve "Return outside the window".
    The return moves to **To collect**.

## Part C - Collect on a trip

13. **Fulfilment > Delivery > Trips**, New trip: vehicle and driver; under "Collect a return" choose the return. Start.
    The stop says "Collect return DFR-...".
14. As the driver (or Pavithran): record the stop **Picked up** with a photo.
    Without a photo: "Take a photo of the packs picked up". With it: the return is in **To inspect**, "Picked up by
    the driver".

## Part D - Inspection

15. **Sales > Returns > Inspection.**
    Rule chips "Each pack: resell, repack, damaged or scrap", "Resell and scrap follow the stock rules", "Then the
    money: credit, replace or no refund". A blue box "N packs on the Returned shelf. They cannot be sold until
    inspected and signed back to Good".
16. Look at the three lists.
    To inspect (oldest first), "Inspected: the money decision waits", and the Returned shelf per pack and godown with
    the pack photo.
17. As **Murugan** (Warehouse): open the return to inspect.
    He can scan the packs in, but there is no Inspect button: "Inspecting needs the right Inspect returns (the
    Supervisor inspects)".
18. As **Kumar** (Supervisor): open it, scan each pack (or type the code and press Enter).
    "OK" for each pack; "N of 4 packs received". A wrong pack: "NOT COUNTED: ... is not on DFR-...: keep it apart".
19. Press **Inspect**.
    A table: Item / batch (photo), Packs, Resell, Repack, Damaged, Scrap, Expired, Not received.
20. Make one line not add up (Resell 2, Damaged 1). Save.
    "Each line must add up to its packs" and Save is off.
21. With "Returned stock can be sold again" Off: Resell is greyed and the note says returned stock is not sold again.
22. Set Repack 2, Damaged 2. Save inspection, confirm.
    "Inspected." The 4 packs go to the Damaged shelf (Inventory).

## Part E - Resell, its approval, and sent back

23. Turn on Commerce settings > Returns > "Returned stock can be sold again". Make a new return of 6 packs (inside the
    window), receive them as Kumar, Inspect: Resell 6. Save.
    "Inspected. Waiting for approval: Returned stock back to Good (6 ...). The stock stays on the Returned shelf until
    then." The Inspection page shows the request under "Back to Good waits for approval".
24. As **Anitha**, approve "Returned stock back to Good".
    The 6 packs move from Returned to Good (Inventory > Stock status).
25. Another return of 6: Resell 6, then as Anitha **reject** "Returned stock back to Good" with a note.
    The return shows "Inspect again"; History: "Sent back. Returned stock back to Good: rejected by Anitha R. 6 packs
    stay on the Returned shelf: inspect them again." It is back in To inspect.
26. **Inspect again**: Scrap 6. Save.
    "Inspected again." The packs go through the write-off rule (small value: posted; above the rule: a write-off waits).
27. An expired batch line: Resell is greyed; choose Expired or Scrap.

## Part F - The money decision

28. Open a return in **Decision waiting**. Refund all packs to the balance. Save, confirm.
    The credit note is made against the invoice (its own CGST + SGST or IGST); the customer owes less by its total
    (Money > Customer ledger). Print / PDF opens it.
29. A refund above Rs 2,000: it waits for approval; the credit note is made when it is approved.
30. **Replace** 3 packs.
    A Rs 0 replacement order "Replacement for DFR-..." goes through picking and packing like any order.
31. **No refund** for 2 scrapped packs, reason "Opened and used".
    It waits for "Return with no refund"; after approval the return is Closed and the customer owes the same.
32. A return of 10 packs of the "buy 10 get 1" order: Refund.
    The credit note credits the 10 packs and takes off 1 free pack: "Free under ..., no longer due".
33. A refund when the order earned cashback that brings its goods under the cashback rule's minimum: the return shows
    "Cashback ... taken back from the wallet" (all of it, W2).

## Part G - Room on the invoice and other ways in

34. While a return waits on an invoice, try a price-correction credit note for the whole invoice (Money > Billing >
    Credit notes).
    Refused: "Room left: Rs ... (Rs ... is held for returns still open on it)".
35. A delivery recorded "short" on a trip.
    Its return is Closed ("money settled at delivery") and its packs show on the Inspection page's Returned shelf.
36. An order refused at the door.
    The goods come back with the refused trip; no money choice.
37. From an order: **Orders > open a delivered order > New return** does the same as Return requests > New return.

## Part H - Who does what

38. As **Divya** (Sales): Sales > Returns.
    "This needs view on Returns" (Sales has no Returns rights in the role grid).
39. As **Murugan** (Warehouse): Return requests.
    He sees the returns of his godown; no New return (no Create); he can receive (scan) but not inspect.
40. As **Kumar**: New return, inspect and decide are all there (Supervisor).
41. **Admin > Users and security > Roles > Supervisor**: the Returns row shows "Inspect returns" ticked; Warehouse:
    not ticked. Untick it for Supervisor as Pavithran: it waits for a second Admin only when it widens; removing it is
    at once.
    As Kumar after that: no Inspect button. Tick it back.
42. A person who works only at another godown sees only that godown's returns, Inspection shelf and counts.

## Part I - Lists, layout and phone

43. Each tab of Return requests on a phone (390 px wide): the table scrolls inside its box, Packs, Why and Comes back
    hide; nothing scrolls sideways.
44. The Inspection page on a phone: the three lists stack.
45. Every list row shows the pack photo (or the grey square when a pack has none).
46. A return drawer on a phone opens full width; the step bar wraps.
47. An old link `/admin/commerce/returns` still opens the full returns list with filters.
48. Home > Dashboard: "returns to collect" and "returns to inspect" cards open Return requests (To collect) and
    Inspection.
49. Put Commerce settings > Returns > "Returned stock can be sold again" back as it was.
