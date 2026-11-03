# Phase 14 - Section 1 Products and catalogue: complete to v23

Branch: `stage2` only. Needs phases 11 to 13. Read first: `CLAUDE.md` (especially rules 1, 2 and 5: no
hard-coded customer text, languages are data, internal fields never reach the browser), `docs/STAGE2-GAP-MAP.md`
(section 1), `docs/STAGE2-TEST-ORDER.txt` (phase 2, steps 10 to 16), and in
`docs/reference/dFresh_Back_Office_v23.html` the Masters > Catalogue pages (Products and SKUs, Categories, Kits,
Barcodes and labels, Raw materials), Masters > Tax and units > Units of measure, and the Tests page tab
"1 Products" (32 tests).

The live site reads products, categories, kits and their translations. Nothing the public site shows today may
change, break or slow down. Check the public pages before and after (step 9).

## Steps
1. Create an SKU from the admin (today only the demo seed can). One product has many packs (SKUs): code, pack
   size, sell unit, packs per carton, minimum order, own barcode, supplier EAN barcode(s), images. The SKU code is
   unique and never reused.
2. Status for products and SKUs: draft, active, discontinued. A draft cannot be sold, priced on a list or shown on
   the site. A discontinued pack takes no new orders or back-orders and its open back-orders are dropped (with a
   message); "Make active again" for a discontinued pack waits for a second Admin (12b rule, label "Bring back a
   discontinued product"). The website shows only active items, as today.
3. Money and stock fields per SKU: MRP (price with GST may never be above it), standard cost (a lower cost waits
   for a second Admin; a first cost below the average cost waits too), reorder level per godown, shelf life in
   months and near-expiry days per product (replace the global setting; keep it as the default).
4. Raw materials as SKUs of type raw (paper reels, cores, film, cartons): never sold, never on a price list or the
   site; bought and used in production later. Masters > Catalogue > Raw materials lists them.
5. Units of measure: a units table (pack, carton, kg, roll...) with conversions per SKU (e.g. 1 carton = 24
   packs); quantities convert on screens; stock is always held in the base unit.
6. Kits: a kit is one record with SKU quantities and its own price, sold as one line, stock taken from its
   parts; the "show on website" switch keeps today's website kits working.
7. Barcodes and labels: own and supplier barcodes both scan to the same SKU everywhere (packing, goods in);
   label printing as today plus raw materials.
8. Import / export: the products Excel gains SKU columns (create and update SKUs by import, dry-run diff first,
   as today); the same rules apply (draft, MRP, cost approval).
9. UPI QR on the invoice: add a small QR package and print a scannable UPI QR (company UPI ID, amount, invoice
   number) on the invoice PDF and print view.
10. Screens on the shared blocks, v23 layout, product image on every product and SKU row (house rule).

## Acceptance (real output)
- Run all 32 tests of the v23 "1 Products" tab through the API and screens; paste each result. A test that needs a
  later section is marked "needs section N"; nothing else skipped.
- Public site unchanged: the existing public parity script at 1920, 1440 and 390 for home, a category and a
  product page, before and after this phase, no difference; public main.js size unchanged; public API responses
  for products identical (diff the JSON).
- Scan check: a pack barcode, a supplier EAN and a carton code each resolve to the right SKU in packing.
- Everything from 11 to 13 still works: engine tests, `test:api`, 12a / 12b / 13 scenario scripts, the 52 section 0
  tests, menu check, commerce flows.
- Visual parity for Products and SKUs (list and drawer), Raw materials, Units, Kits at 1440 and 390.
- No long dash characters.
- Write `docs/tests/SECTION-1-CLICK-TEST.md` for Pavithran: numbered steps, each with what he should see.

Commit: `phase 14: section 1 Products complete - SKUs, status, MRP and cost, raw materials, units, kits, UPI QR`.
Move this file to `docs/claude-tasks/done/`, push stage2, STOP and report.
