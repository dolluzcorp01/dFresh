# Phase 20 - Sections 8 and 9 Packing and delivery: complete to v23

Branch: `stage2` only. Needs phases 11 to 19. Read first: `CLAUDE.md`, `docs/STAGE2-GAP-MAP.md` (sections 8 and 9,
decision D1), `docs/STAGE2-TEST-ORDER.txt` (phase 7, steps 48 to 56), and in `docs/reference/dFresh_Back_Office_v23.html`
the Fulfilment pages (Packing: To pick, Packing, Packed waiting; Delivery: Trips, Courier and pickup, Proof of
delivery, Failed / short / refused, Cash on delivery) and Masters > Partners (Vehicles and drivers, Couriers),
Masters > Tax and units > Delivery areas; the Tests page tabs "8 Packing" (12 tests) and "9 Delivery" (14 tests)
and the fix items (part shipments, packer lock PK1, Y2 cash per trip, short delivery). The proof file has figures.

Packing by scan, trips, courier, pickup, proof of delivery with OTP and driver cash already work on stage2. Upgrade;
do not rebuild what works. Every existing order, trip, stop, invoice and cash figure stays identical.

## Steps
0. Carry-over from phase 19 (finish what was not built):
   - Quotes: a Mail button (a "quote sent" message template in EN, TA, HI, prepared in the Outbox, never sent in dev).
   - Enquiries: "Link to CUS-..." when the enquiry is an existing customer.
   - Customer ledger: "Mail statement" (PDF attached, Outbox).
   - Orders: a hand-ticked free line with a reason (as quotes have), within the free-line rule and its approval.
   - Order drawer: cancel in a box in the body with the reason, as v23.
1. Stock goes down at Packed (D1), not at dispatch: pressing Packed moves the scanned packs off Good (exact
   batches scanned); dispatch no longer moves stock. Migrate cleanly: orders already packed but not dispatched
   today must not lose or double their stock (show the before and after figures).
2. Packer lock: packs scanned into an order are held for that packer; nothing else (transfer, write-off, another
   order) can take them; a batch that expired or was taken since the scan is refused at Packed with the right
   message ("That batch has expired" / "Another packer used that batch").
3. Part shipments: when the order allows it, pack and send what is there; the rest stays a back-order (phase 19);
   each shipment gets its own invoice and trip stop.
4. Delivery: one trip carries many orders; short delivery (some packs kept) as well as failed and refused; packs
   not kept come back to stock (Returned shelf, or Good with approval) and the credit note is made for them.
   Cash due per stop = the invoices on that stop less what is paid (not the whole order, not an earlier trip's
   shortfall). Driver cash handed in vs collected, difference flagged.
5. Vehicles, drivers, couriers, delivery areas: as today plus v23 fields (insurance and fitness dates with alerts,
   areas with PIN codes, days and charges, "show on website map" keeps the live map working).
6. Screens on the shared blocks, v23 layout, pack photo on every line.

## Acceptance (real output)
- Run all 12 + 14 tests of the v23 "8 Packing" and "9 Delivery" tabs and the fix items above; paste each result.
- D1 migration: for every order packed but not yet dispatched, stock before and after identical in total, and no
  pack counted twice; one script packs, dispatches and delivers an order and shows stock moving exactly once.
- One full flow by script: order, pick, pack by scan, part shipment, invoice (today's invoicing), trip with two
  orders, one delivered, one short, cash handed in; every figure reconciles.
- Public site unchanged (API, page text, delivery map, main.js size).
- Everything from 11 to 19 still works: all scenario scripts and section 0 to 7 tests, buying and sales flows,
  engine tests, `test:api`, nav, menu, two-godown checks.
- Visual parity with an "after" table for every Fulfilment page; fix every difference that is not data.
- No long dash characters; read-only rule.
- Write `docs/tests/SECTION-8-CLICK-TEST.md` and `docs/tests/SECTION-9-CLICK-TEST.md` for Pavithran.

Commit: `phase 20: sections 8 and 9 complete - stock down at Packed, packer lock, part shipments, short delivery,
cash per trip`. Move this file to `docs/claude-tasks/done/`, push stage2, STOP and report.
