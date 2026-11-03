# Section 1 - Products and catalogue: click test

For Pavithran, before Shoban freezes section 1. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on (Admin > Settings > Switches > Turn on).
- Sign in as **Pavithran** (Admin). Steps 34 and 41 need **Shoban** (Super admin) in a second browser, and step 42
  needs a **Sub-admin**, a **Supervisor**, a **Sales** person, a **Warehouse** person and a **Delivery** person (add
  them in Admin > Users and security > Staff if they are not there; any real dAdmin employees will do).
- The numbers below are the demo data on stage2 (for example DF037-M150 holds 20 packs per carton, and the highest
  price of DF001-M100 today is Rs 47.20 with GST on the Default list). If the data has changed, the message still
  says the same thing with the new numbers.
- Anything that "waits for a second Admin" appears in Home > Approvals. The other Admin approves it there.
- Steps 3 to 7 upload photos to a new product. They stay on the test product only; archive it at the end (step 45).

## Part A - Products and SKUs

1. **Masters > Catalogue > Products and SKUs.**
   A table of products with their picture, code, category, first SKU and pack, stock and status. Ten rows a page.
   Two tabs on top: Products and SKUs (packs), each with a count. Under the table, a card explains the five statuses
   (Draft, Active, Hidden from website, Discontinued, Archived).

2. **New product.** Name `Kitchen Towels - 4 Pack`, code `DZIND-DF050`, category Kitchen Towels, first pack `4 rolls`,
   specification `2-ply · 4 rolls`, short line `Four soft kitchen towel rolls.` Press **Create as Draft**.
   A green message: created as a Draft with SKU DF050-R4. The panel opens on the new product with the status Draft
   and a yellow box "Before it can be active" that lists what is missing.

3. Press **Make active**.
   Refused. The message lists: no picture, DF050-R4 needs its weight, no English full description, no keywords,
   no "best for".

4. **Photos > Upload a photo** (any JPG or PNG). Then **Packs > DF050-R4**: Stock tab, weight `0.8`; Tax tab, HSN
   `48182000`. Save. Press **Product** (bottom left) to go back.
   The SKU saves; back on the product, the pack no longer says Not ready.

5. **Website words > English**: keywords `kitchen, towels, rolls`, full description, best for `Home · Eateries`. Save.
   Press **Make active**.
   It becomes Active.

6. **Photos**: upload two more photos. Remove two of the three (each asks first).
   Both go.

7. Try to remove the last one.
   Refused: an active product must keep at least one picture.

8. Open **Table Napkins 20×20** (DZIND-DF001). Look at Basics, then Website words in English, Tamil and Hindi.
   Basics: brand dFresh, For Home Yes, website order 1, the specification and the staff-only spec status. Website
   words: keywords, full description, best for, alt text and WhatsApp message in all three languages, and the Tamil
   and Hindi names.

9. Website words, English. Keywords `a, b, c, d, e, f, g`. Save.
   Refused under Keywords: up to 6 keywords. The Website words tab turns red.

10. Keywords `napkins, , soft`. Save.
    Refused: each keyword 1 to 30 characters. Put the keywords back as they were (Cancel).

11. Empty the English full description. Save.
    Refused: an active product needs its English full description; hide it first. Cancel.

12. Basics: empty the Specification. Open the Photos tab. Press Save.
    Refused. The panel jumps back to Basics, the Basics tab is red and Specification says why. Cancel, then Discard.

13. Open **2-ply Napkins 29×30 - Black** (a colour version, order 5.1). Basics, website order `7.1`. Save.
    Refused: use 5.1, 5.2 and so on, next to its main product (5). Change it to `5.4`. Save.
    Saved.

14. Open **Facial Tissue - 100 Pulls** (Most loved 3). Basics, Most loved: Position 1. Save.
    Saved; the message says Table Napkins 30×30 moved to position 3.

15. Open **Premium 3-ply Napkins 27×27**. Website words, Hindi: clear the short line. Save.
    Saved. In the list the row shows "HI missing" and the Hindi button in the panel has a red dot. Type the short line
    back and Save: the flag goes.

16. Open **Table Napkins 20×20**, Packs. Add pack size `Pack of 100`.
    Refused: DF001-M100 already exists. Add `Pack of 200`.
    DF001-M200 is added on the same product, marked Not ready until its weight is set.

## Part B - The packs (SKUs)

17. SKUs (packs) tab. Open **DF037-M150**, Stock. Packs per carton `18`. Save.
    Saved. The history line reads "20 packs from (date) · 18 packs from (today)" and the message says cartons in stock
    keep 20.

18. Open **DF016-R1** (Toilet Roll, full cartons of 48), Selling. Minimum order `50`, Save.
    Refused under the field: use a multiple of 48. Change it to `96`, Save. Saved.

19. Open **DF001-M100**, Stock. Shelf life `12`, Batch tracking Off. Save.
    Refused under Batch tracking: it expires after 12 months, so batch tracking must be on.
    Batch On, Warn days `400`, Save: refused, longer than the 12-month shelf life. `60`, Save: saved.
    (Put shelf life back to 0, batch Off, warn days empty, and Save.)

20. DF001-M100, Pack. MRP `45`, Save.
    Refused under MRP: the Default list charges Rs 47.20 with GST. MRP `50`, Save: saved, and the hint shows the
    highest price today.

21. **Masters > Prices > Price lists**, open DF001-M100.
    The panel shows MRP Rs 50.00 with GST. Set the Default price to `43` and Save.
    Refused: above the MRP (50.74 with GST).

22. Back on DF001-M100, Pack: Standard cost `50`, Save.
    Saved. In Price lists, DF001-M100 shows "Cost 50.00" and the Default price 40 is marked "sells below cost".

23. DF001-M100: Standard cost `30`, Save.
    The message says the lower cost waits for a second Admin; the field still shows 50. Shoban approves it in Home >
    Approvals; then it shows 30.

24. DF001-M100, Selling. Substitutes: try to pick DF001-M100 itself.
    It is not in the list (or, if typed in, refused: a pack is never its own substitute).

25. DF001-M100, Stock, Other units: add Box = 6 packs. Save.
    Saved; stock is still counted in packs.

## Part C - Status: discontinue, archive, bring back

26. Open **Dispenser Napkins** (DZIND-DF014). **Discontinue** (it asks first).
    It becomes Discontinued: off the website, the stock left is still sold. If it is in a kit, the message names the
    kit.

27. Open DF001-M100, Selling. Pick DF014-M100 as a substitute. Save.
    Refused under Substitutes: DF014-M100 is not sold, so it cannot be offered.

28. Dispenser Napkins: **Archive**.
    Refused while packs are left ("It still has N packs").

29. Dispenser Napkins: **Make active again**.
    It waits for a second Admin: Home > Approvals shows "Bring back a discontinued product". Reject it there (we keep
    it discontinued for now).

30. When its stock reaches zero (sold through orders), the **Nightly check** on the Products page archives it.
    Press Nightly check now: if stock is still left it says nothing to archive.

## Part D - Raw materials and units

31. **Masters > Catalogue > Raw materials > New raw material.** Code `RM-REEL`, name `Paper reel`, counted in
    Kilogram. Add.
    The SKU panel opens (Pack, Stock, Barcodes, Tax; no Selling tab). Set its weight and Save.

32. **Masters > Tax and units > Units of measure.** Remove Kilogram.
    Refused: it is used by 1 SKU (raw materials are counted in it).

33. Add `Dozen` with code `dozen`. Then remove it (it asks first).
    Added, then removed.

## Part E - Categories and kits

34. **Masters > Catalogue > Categories.** Move Wet Wipes up twice.
    A bar says "New order not saved yet." with Save order and Cancel. Click another page in the menu: it asks first.
    Stay, press Cancel: the order goes back.

35. Switch off **Hand Towels**.
    Refused: it has active products.

36. **Masters > Catalogue > Kits.** Look at Hotels & lodges with All godowns picked at the top.
    Each godown shows how many kits can be sold, limited by the part with the least stock, or Unavailable with the
    reason on hover (a part not ready to sell, or out of stock there).

37. **New kit.** Part 1 DF001-M100 qty 2, nothing else. Name `Test kit`, photo Table Napkins 20×20. Create.
    Refused: a kit needs at least two different packs. Set Part 2 to DF001-M100 again: refused, already in the kit.
    Set Part 2 to DF002-M100: created, with a code KIT-05.

38. Open **Offices & factories**. Clear the English tagline. Save.
    Refused under the field: a kit on the website needs its English tagline. Switch "Show on dfresh.us" off: it saves.
    (Put the tagline back and switch it on again.)

## Part F - Barcodes and labels

39. **Masters > Catalogue > Barcodes and labels**, Scan tab. Scan or type `DF037-M150#C`, then `df016-r1`.
    The carton code finds DF037-M150: 1 scan = 1 carton = 18 packs (after step 17). Lower case still finds DF016-R1.

40. Open DF044-M100 (Products, SKUs tab), Barcodes. Add a 13-digit supplier EAN from a real pack, as Supplier EAN.
    Then add the same number to DF001-M100.
    The second is refused: it already belongs to DF044-M100. Change its last digit and add again: refused, wrong check
    digit, misread.

41. As the **Warehouse** person: Barcodes and labels, Scan a barcode no SKU has (any other product's EAN).
    "Belongs to no SKU": noted for the office, no Link button. As Pavithran, the Scan tab shows a red 1 and "Scanned,
    not yet linked". Press Link it, link it to DF013-M50 as Supplier EAN. The list empties; scanning it again finds
    DF013-M50.

42. Print labels tab. Tick DF037-M150. Carton, Tamil, 2 copies. Show labels.
    Two carton labels with "அட்டைப்பெட்டி 18 பொதிகள்", the category in Tamil, the product name as supplied and a
    barcode of DF037-M150#C. Print opens the A4 sheet.

43. Tick DF001-M100 and DF002-M100. Pack, English, month 2026-10. Show labels.
    A warning that MRP is not set on DF002-M100 (DF001-M100 has 50 from step 20). Each label shows MRP (or "MRP not
    set"), net quantity, Packed: Oct 2026, brand, packed by (the company and address), customer care and Country of
    origin: India.

## Part G - Import, rights, the audit log, the invoice

44. Products and SKUs > **Export**. Open the file: it has a SKUs sheet (one row per pack, mrp last). Change DF002-M100
    packs_per_carton to `0`. **Import** (Excel import / export page), run the dry run.
    One error for DF002-M100 and no Apply. Put it back, change DF001-M100 mrp to `40`: one error, below the price
    with GST. Change it to `70`: no errors, 1 SKU change (mrp 50 -> 70); Apply saves it.

45. First, in Admin > Users and security > Roles, make sure Supervisor and Sales have View (only) on the Products row
    (our Sales role starts without it; v23's has it). Then as the **Supervisor** and the **Sales** person: open
    Products and SKUs.
    Both see every page with a "View only" note: no New product, no Save, no Import. As the **Delivery** person: the
    Masters > Catalogue pages are not in the menu.

46. As the **Supervisor**: open DF001-M100.
    There is no Standard cost field at all.

47. As the **Sub-admin**: archive the test product DZIND-DF050 (Discontinue, then Archive when it has no stock;
    it has none), then press **Bring back as Draft**.
    Refused: only an Admin brings an archived product back. As Pavithran it works, as a Draft. Archive it again.

48. **Admin > Users and security > Audit log**, screen Products.
    Every change above is there with the time, who, and the old value struck through next to the new one.

49. Open any invoice of an order with Admin > Organisation > Company > Bank accounts having a UPI ID, and print it
    (or download the PDF).
    Under the totals: a QR code next to "Pay by UPI: (the UPI ID)" and "Scan with any UPI app: Rs (amount to pay) for
    (invoice number)". Scan it with a UPI app (do not pay): the app shows the company UPI ID, the amount and the
    invoice number.

50. **The website** (dfresh.us on stage2): the home page, a category and the product list look exactly as before
    this phase. The test product DZIND-DF050 (archived) is not shown.
