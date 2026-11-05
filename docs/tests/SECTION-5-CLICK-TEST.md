# Section 5 - Inventory: click test

For Pavithran, before Shoban freezes section 5. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on (Admin > Settings > Switches > Turn on), with two godowns
  (Kanchipuram and a second one, e.g. Chennai). Sign in as **Pavithran** (Admin).
- Other people, in a second browser: a **Supervisor** (Inventory View, Create, Edit, Approve, Export) who works at
  both godowns, someone who works **only at the second godown**, a **Warehouse** person and a **Sales** person.
- "Waits for approval" means it appears in Home > Approvals; somebody else approves it there.
- Every item row on every page shows the pack photo (raw materials show the package icon).

## Part A - Stock status and batches

1. **Inventory > Stock status.** Rule chips, tabs Packs we sell / Raw materials. Each row: photo, name, code, Good,
   Held, Free to sell, QC hold, Damaged, Returned, (In a lorry when a transfer is on the road), Value (See cost only),
   Flags (expired, near expiry, disputed, Low). Free to sell = Good - Held - expired, worked out, never typed.
2. Search "napkin", pick a category, tick "Low or expired only", tick "Show in cartons" (e.g. "9 ctn + 22").
3. Click a pack with batches (Wet Wipes): per godown, every batch on every shelf with made date and expiry ("Expired,
   blocked" in red, "38 days" in amber), the last moves with who did each, and "Every move in the stock ledger"
   opening the ledger on that pack.
4. Raw materials tab: the reel and other materials in kg or pieces, and "In production" for what running runs took.
5. **Batches and expiry**: tabs Expired / Near expiry / Good / All with expiry with counts. An expired batch says
   "expired N days ago, blocked" and has a **Write off** button that opens the write-off filled in (batch, quantity,
   reason Expired).

## Part B - Transfers

6. **Inventory > Transfers, New transfer**: From and To the same godown, no vehicle, more Wet Wipes than are free.
   Dispatch: red under To ("Pick two different godowns"), Vehicle ("Like TN 21 BC 4417"), quantity ("Only N free ...
   held for orders and expired batches cannot go"). Each line shows how many are free as you pick it.
7. Fix them (to the other godown, vehicle `TN 21 AB 1234`, a quantity that is free). Dispatch: "DFT/26-27/000N on the
   road" (the number carries the godown code for the second godown). Stock status: Good drops at the sender, "In a
   lorry" shows it, the company total is unchanged. The batches taken are the earliest expiry, never an expired one.
8. As the person who sent it, open it: no Received button ("You sent it: somebody else counts it in").
9. As the **second-godown-only** person: Counted more than sent: "More than was sent". Count 2 fewer than sent and
   press Received: "Received short"; it waits for approval. The sender and the receiver cannot approve it (the
   message says they are part of the record), nor anyone standing in for them.
10. Another person rejects the loss: the missing packs go to the sender's Disputed shelf. The transfer shows "Still
    missing at <sender>" with **Found: back to Good** and **Lost: write off**. Press Lost: it waits for approval and
    the two buttons disappear while it waits; the sender and receiver cannot sign it. Approve it: the packs leave.
11. Do it again with Found: after somebody signs, the packs are back on the sender's Good shelf.
12. A short that is approved straight away: it is written off from the receiver's Disputed shelf.

## Part C - Stock take

13. **Inventory > Stock take, Start a stock take**: Kanchipuram, Wet Wipes. "Freeze and start counting". The sheet has
    one line per batch and **no Book column**.
14. While it is counting, try a transfer of Wet Wipes from Kanchipuram: refused "frozen by stock take ST-N". A
    write-off of Table Napkins (another category) is allowed. A count of the whole godown is refused while another
    count is open or waiting there.
15. Packs scanned (or packed) for orders not yet dispatched are listed on the sheet ("Count these with the shelf").
16. Submit with a line empty: "Count every batch: N left empty." Count every batch, one 3 short: "Submitted with 1
    difference"; the shelf is unfrozen; stock is unchanged until approval. The counter cannot approve it.
17. Approve it: only that batch drops by 3, posted at the average cost (Stock ledger, document ST-N).
18. Count again with the same item short: the difference is marked "Short again: theft signal".
19. Start a raw materials count, then try to start a production run at that godown: refused (frozen).
20. Cancel a count still being counted: "Cancel the count", confirm: the shelf is unfrozen, nothing changed.

## Part D - Write-offs and shelf moves

21. **Inventory > Write-offs**: "Damaged and returned, waiting for a decision" lists what sits on those shelves; the
    list of write-offs and moves below.
22. **Write off**: Good, more than Good less what is held for orders: "N are held for orders. Only M can be written
    off from Good." 5 packs within the rule: written off at once; the ledger shows -5 with the WO number.
23. 25 packs (above Rs 1,000 or 20 packs, counting your earlier write-offs today): it waits; the stock stays.
24. From QC hold: refused, "QC hold is cleared only by Quality check: reject it there." The Disputed shelf is not
    offered (a transfer decides it).
25. **Move between shelves**: Good to Damaged 10, "crushed": moved at once; good -10, damaged +10, the company total
    unchanged ("Not a loss"). With a batch named, only that batch moves.
26. Returned (or Damaged) to Good: it waits ("Stock back to Good needs a second person"); after approval it is on Good.

## Part E - Reorder and ledger

27. **Inventory > Reorder**: each low item (packs and raw materials) with free, coming (QC hold, open POs, indents,
    planned runs), reorder level and the suggestion in whole cartons or the supplier's minimum, Make or Buy.
28. **Ask to buy** on a bought item: an indent appears in Purchase > Indents. **Plan a run** on a made pack opens
    Production runs with the plan filled in for tomorrow. Made packs with no recipe say "No recipe".
29. **Inventory > Stock ledger**: newest first, with when, item photo and code, godown and shelf, batch, quantity, what
    moved it and the document, who. Search a code, filter a shelf, a from date. **Export CSV** (Export right): the
    file has when, who, employee id, item, godown, shelf, batch, qty, what, document.

## Part F - The floor and rights

30. As the **Warehouse** person: Stock status, **Godown floor**: four big buttons. Send opens a transfer with From
    fixed to their godown; Count says no stock take is running (or opens the running one); Report damage opens a
    shelf move to Damaged.
31. As the **Sales** person: every Inventory page says it is not for this role and the Inventory group is not in the
    menu.
32. On a phone (390 wide): every Inventory page and panel works with no sideways scroll; tables become cards.
