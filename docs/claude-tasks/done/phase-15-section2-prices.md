# Phase 15 - Section 2 Prices and tax: complete to v23

Branch: `stage2` only. Needs phases 11 to 14. Read first: `CLAUDE.md`, `docs/STAGE2-GAP-MAP.md` (section 2,
decisions D6 and D7), `docs/STAGE2-TEST-ORDER.txt` (phase 2, steps 11, 18 and 19, and step 42), and in
`docs/reference/dFresh_Back_Office_v23.html` the pages Masters > Prices (Price lists, Quantity slabs, Special
prices) and Masters > Tax and units > HSN and GST rates, and the Tests page tab "2 Prices" (29 tests), plus the
section 2 items in the "v21 fixes", "v22 fixes" and "v23 fixes" tabs (PR1, Y4 and the special-price draft packs).

Keep what already works: dated price lists per customer type with history (`sku_prices`, `price_changes`), the
fallback to the default list, the price Excel import / export, and quotes and orders keeping the price they were
made with.

## Steps
1. HSN and GST rates (v23 page): an HSN list with its GST rate and the date each rate starts; a rate change from a
   date needs approval; invoices use the rate on their own date. A pack's GST comes from its HSN and can no longer
   be typed (finishes Products tests 1.9 and 1.16). Move today's `products.hsn_code` / `gst_rate` into it without
   changing any rate in use.
2. Prices with or without GST per list (today one global setting): each list says how its prices are typed;
   everything is stored and checked without GST.
3. Lowest allowed price (D7): a fixed lowest price per pack. Lowering it waits for a second Admin (12b); a price
   save is checked against the OLD lowest price while the change waits. Replace the "% below list" rule for list
   prices; keep the document-level discount rule.
4. Margin floor: cost + X% (rule "Price below cost plus the margin floor"). A list price below it waits for
   approval; on an order or quote it raises the approval. People without See cost never see the cost or the
   exact trigger (they see "checked against cost when you save" and the request is called "Price check").
5. Quantity slabs on the price list (D6): price bands per list for bigger quantities, checked by one function for
   the panel, the import and bulk changes (the top band never below the lowest price or cost + margin). Today's
   slab offers stay working as offers; nothing is migrated silently.
6. Special prices: one customer's own price for a pack, dated, with approval when below the allowed % or the
   margin floor; draft or discontinued packs cannot be chosen (server check, not just the list); a lower standard
   cost re-checks open specials (Y4).
7. Screens on the shared blocks, v23 layout, cost hidden for people without See cost.
8. Small agreed change: the default Sales role gets View on Products (as in v23).
9. Website > Brand and layout > Logo and brand images, as in v23 (added by the owner on 4 Nov 2026). Three uploads:
   - square logo: favicon, app icon, admin header, stamp;
   - wide logo: invoice and document header;
   - favicon upload that makes the sizes 16, 32, 180, 192 and 512.
   The website, the admin and every PDF read the logo from there. Until a new logo is uploaded, the live site looks
   exactly as it does today.

## Acceptance (real output)
- Run all 29 tests of the v23 "2 Prices" tab and the section 2 items of the F, G and H tabs (PR1, Y4, special price
  draft packs, margin message hidden); paste each result. Re-run Products tests 1.9 and 1.16: both must now pass in
  full. A test needing a later section is marked "needs section N".
- Public site unchanged (no prices on the public site): the public API and page text before and after identical,
  public main.js size unchanged.
- No price changed by the migration: every current list price per SKU and list identical before and after.
- Everything from 11 to 14 still works: engine tests, `test:api`, the 12a, 12b, 13 and 14 scenario scripts (with
  the 52 + 32 section tests), menu and nav checks, commerce flows.
- Visual parity for Price lists, Quantity slabs, Special prices, HSN and GST rates and Logo and brand images at 1440
  and 390.
- Logo and brand images: with no new upload the public site (page text, screenshots, favicon and icon files) is
  identical before and after; an upload of each kind shows on the website, the admin header and a PDF, and the
  favicon sizes 16, 32, 180, 192 and 512 are made.
- No long dash characters.
- Write `docs/tests/SECTION-2-CLICK-TEST.md` for Pavithran: numbered steps, each with what he should see.

Commit: `phase 15: section 2 Prices and tax complete - HSN and GST dates, lowest price, margin floor, slabs,
special prices`. Move this file to `docs/claude-tasks/done/`, push stage2, STOP and report.
