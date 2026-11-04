# Section 2 - Prices and tax: click test

For Pavithran, before Shoban freezes section 2. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on (Admin > Settings > Switches > Turn on).
- Sign in as **Pavithran** (Admin). Steps that need a second person say so: **Shoban** (Super admin) in a second
  browser, a **Supervisor** (a role with View on "Prices and tax", no See cost), a **Sales** person and a **Warehouse**
  person (add them in Admin > Users and security > Staff if they are not there; any real dAdmin employees will do).
- "Today" below means the date you test on; "a later date" means any date a few days ahead (the same one each time).
- The numbers are the demo data on stage2 (the Default list prices DF001-M100 at Rs 40.00 without GST, the Hotel list
  at Rs 37.00, all napkins are HSN 48183000 at 18%). If the data has changed, the message still says the same thing
  with the new numbers.
- Anything that "waits for approval" or "waits for a second Admin" appears in Home > Approvals. The other person
  approves it there. Nobody approves their own.

## Part A - The price lists

1. **Masters > Prices > Price lists.**
   A blue "Sample prices." notice, two tabs (Price lists, Check a price) and one card per list: Default, Home, Hotel,
   Hospital, Office, Distributor. Each card says who it is for, "Typed without GST", "28 of 28 priced". Default has a
   gold "Default" pill.

2. Open **Default**.
   A bar with All lists, the name, Rate card, Export, Import, Settings and Change many prices. A table of every pack:
   Price typed, Without GST, With GST, Carton (with the packs per carton under it), Margin, Lowest allowed and Next
   change. DF001-M100: Rs 40.00, Rs 40.00, Rs 47.20, Rs 1,132.80 for 24 packs.

3. Open **DF001-M100**. Lowest allowed price `32`. Save.
   Saved. The Lowest allowed column shows Rs 32.00.

4. Price `30`, starts today. Save.
   Refused under the price: below the lowest allowed price (Rs 32.00 without GST).

5. Price `50`, starts on 1 October 2026 (a past date). Save.
   Refused under the date: cannot start in the past. Quotes and orders already made keep their price.

6. Open the **Home** list, DF001-M100: price `50`, starts on the later date. Save.
   "The new price starts on (date)". The Next change column shows Rs 50.00 from that date; today's price stays 40.

7. **Check a price** tab: customer Demo Home Priya, DF001-M100, 1 pack, on the day before the later date; then on the
   later date.
   Rs 40.00 without GST the day before, Rs 50.00 on the later date. Every step of the working is listed.

8. Default list, **Settings**: Default list No. Save. Then Status Archived. Save.
   Both refused: there must always be a default list, and the default list cannot be archived.

9. **Distributor** list, Settings: tick Hotel. Save.
   "The customer types change waits for approval" (phase 16: also for an Admin; someone with Approve on Customers
   decides it in Home > Approvals). Shoban approves: customer type Hotel leaves the Hotel list, and Check a price for
   Demo Hotel Sangam now says Distributor (for Hotel). Put Hotel back on the Hotel list (Shoban approves again).

10. Home list, Settings: Prices are typed With GST. Save.
    "Prices are now typed with GST: (n) prices converted from today so the customer pays the same." DF001-M100 shows
    Rs 47.20 typed, Rs 40.00 without GST. Open it: the old price 40.00 without GST stays in the history and a new
    47.20 with GST from today. Put it back to Without GST.

11. **New price list**: name `Event caterers`, copy from Hotel, adjust `-5`, no customer types. Create list.
    Created with every Hotel price 5% lower, rounded to Rs 1 (DF002-M100: 41 becomes 39). Packs that would go below
    their lowest allowed price are skipped and counted in the message.

12. Default list, **Change many prices**: category Table Napkins, Percent, `5`, starts on the later date. Preview, then
    Apply.
    The preview lists each napkin pack, the price now and the new one rounded to Rs 1. Apply: "(n) prices changed.
    They start on (date)." Today's prices stay.

13. Default list, **Export**. Open the file: one row per pack, columns list, sku, product, price, from, typed,
    gst_rate, price_without_gst, price_with_gst. Change one pack's price to `0`. **Import**, Check the file.
    One error (price must be more than 0), and no Apply button. Put a real price and a later date: no errors, 1 price
    will change; Apply saves it.

14. **Rate card** on the Hotel list. Print.
    A clean page with the logo, "dFresh price list · Hotel", the company line and the date, and for every pack:
    pack, per carton, price without GST, GST, with GST, carton with GST and MRP. The print window shows only the rate
    card.

## Part B - Quantity slabs and a pack's own quantity prices

15. **Masters > Prices > Quantity slabs**, list Default. Slab 1: from `10`, `5`% off. Slab 2: from `5`, `8`% off. Save
    slabs.
    Refused under slab 2: each slab starts at more packs than the one before.

16. Slab 2: from `50`, `3`% off. Save. Then from `50`, `8`% off. Save.
    First refused: more packs must get more off than 5%. Then "Slabs saved: Default: 10+ 5%, 50+ 8%."

17. Add slab 3: from `100`, `25`% off. Save.
    Refused: at 100+ packs (25% off) these go below their lowest allowed price: DF001-M100 ... Lower the % or set a
    quantity band for those packs. Remove slab 3.

18. Default list, DF001-M100: price `34`, today. Save.
    Refused: "At 50+ packs (8% slab) this becomes Rs 31.00 without GST, below the lowest allowed Rs 32.00."

19. Hotel list, open DF030-M200. Own quantity prices: band 1 from `24` at `66`, band 2 from `96` at `63`. Save.
    "Own quantity prices saved." The Pack cell says "own quantity prices". Band 2 at `67` instead: refused, more packs
    must cost less per pack than Rs 66.00.

20. Check a price: Demo Hotel Sangam, DF030-M200, `30` packs.
    "30 packs reach the 24+ band: Rs 66.00" (the band, not the list slab).

## Part C - Special prices

21. **Masters > Prices > Special prices > New special price**: Demo Home Priya, DF028-M100, price `43`, today,
    reason `trial`. Save.
    The info box first shows what she pays now. Saved: "SP-nnn: 4.4% below their list price." It is in the Active tab.

22. New special price: Demo Care Clinic, DF037-M150, `56.50`, reason `hospital tender`.
    "Sent for approval": more than 10% below. It is in Waiting for approval. As Pavithran (who raised it) you cannot
    approve it in Home > Approvals; Shoban approves it and it becomes Active.

23. As the **Sales** person: New special price, Demo Restaurant Anjappar, DF002-M100, `40`, reason `festival order`.
    Saved as Waiting for approval even though it is a small discount; no cost figure anywhere.

24. New special price: Demo Home Priya, DF001-M100, `30`.
    Refused under the price: below the lowest allowed price (Rs 32.00).

25. A second special for the same customer and pack and overlapping dates (e.g. step 21 again with `42`).
    Refused: SP-nnn already covers these dates for this customer and pack.

26. Check a price: Demo Home Priya, DF028-M100, 1 pack.
    The Special price step says the special wins because it is lower. Then open the special (Active tab), End it
    today: it asks first; from tomorrow the customer pays the normal price.

## Part D - Cost, margin and approvals

27. Open DF001-M100 in **Masters > Catalogue > Products and SKUs** (SKUs tab), Pack: standard cost `34`. Save. Back to
    the Default list.
    The Margin column of DF001-M100 shows 15% in green.

28. DF002-M100: standard cost `37` (cost plus 10% = Rs 40.70). Then Home list, DF002-M100: price `40` from the later
    date. Save.
    "PC-nnn waits for approval: Below cost plus the margin floor (Rs 40.70 without GST)." The list shows "Rs 40.00
    from (date), waiting"; Check a price on that date still gives the old price. Shoban approves it in Home >
    Approvals; the check on that date then gives 40.

29. **Admin > Users and security > Approval rules**: switch off "Price below cost plus the margin floor".
    It waits for a second Admin (Shoban signs). Then a price below cost plus margin saves straight away. Switch it on
    again (that one saves at once).

30. Default list, DF001-M100: lowest allowed price `1` and price `30` in one save.
    Refused: 30 is checked against the old lowest price (32). Then lowest allowed `1` alone: "Lowering the lowest
    allowed price waits for a second Admin". Shoban rejects it (keep 32).

31. As the **Supervisor**: Masters > Prices.
    Every price page opens with "View only." No Save, no New price list, no Margin column, no cost in the price panel.

32. As the **Warehouse** person: Masters > Prices is not in the menu; opening the address (/admin/prices) shows "No
    access: Your role, Warehouse, cannot open Prices and tax." (v23 words it "Not for Warehouse".)

## Part E - HSN and GST rates

33. **Masters > Tax and units > HSN and GST rates.**
    The "One place for tax." notice, every HSN code with what it covers, GST today, next change and the packs using
    it; under it the GST rates in use (gold = used).

34. Open **48183000** (napkins). New GST rate `5`%, starts on the later date. Save.
    "GST 5% from (date) waits for a second Admin." Shoban approves it in Home > Approvals. The code then shows "5%
    from (date)" as the next change.

35. Check a price: DF001-M100 on the day before the later date and on the later date.
    18% the day before, 5% on the later date. Then change 48183000 back to 18% from the day after (Shoban approves).

36. Remove the rate 18%.
    Refused: 18% is used by an HSN code. Add `28`, then remove it (it asks first): added, then removed.

37. SKUs tab, open DF001-M100, Tax: HSN `48189999`. Save.
    Refused: not in the HSN list, add it in HSN and GST rates first. The GST rate field is read only (it comes from
    the HSN code).

38. **Check a price**: Demo Hotel Sangam, DF007-M100, 24 packs, place of supply Tamil Nadu; then Karnataka.
    Tamil Nadu: the last step reads CGST 9% + SGST 9% (same state). Karnataka: IGST 18% (another state). The price
    does not change.

## Part F - Logo and brand images

39. **Website > Brand and layout > Logo and brand images.**
    Three tiles: Square logo, Wide logo, Favicon, each "The logo of today". Admin > Organisation > Company shows the
    two logos read only with a link here.

40. Upload a square picture as the square logo (PNG, at least 192 x 192), a landscape picture as the wide logo and a
    square one as the favicon. Try a landscape picture as the square logo first.
    The landscape one is refused (must be square). Then each is "Uploaded"; the favicon shows its sizes. The admin
    header shows the new square logo (reload); an invoice PDF (any order's Download PDF) shows the wide logo on a
    light panel; on the website the browser tab icon is the new favicon (reload).

41. Remove all three (each asks first).
    Each goes back to "The logo of today"; the website, the admin and the PDF look as before.

## Part G - The audit log and the website

42. **Admin > Users and security > Audit log**, screens Prices, Tax and Logo and brand images.
    Every change above is there with the time, who, and the old value struck through next to the new one.

43. **The website** (dfresh.us on stage2): the home page, a category and the product list.
    They look exactly as before this phase. No price shows anywhere.
