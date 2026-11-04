# Section 3 - Suppliers and buying: click test

For Pavithran, before Shoban freezes section 3. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on (Admin > Settings > Switches > Turn on).
- Sign in as **Pavithran** (Admin). Steps that need a second person say so: **Shoban** (Super admin) in a second
  browser, a **Supervisor** (a role with View, Create and Edit on "Suppliers and buying", no See cost, no Approve), a
  **Warehouse** person (View and Create on Suppliers and buying), a **Sales** person (no Suppliers and buying) and
  someone who works **only at the Chennai godown** (add them in Admin > Users and security > Staff if they are not
  there; any real dAdmin employees will do).
- "Today" means the date you test on. Anything that "waits for approval" or "waits for a second Admin" appears in
  Home > Approvals; the other person approves it there. Nobody approves their own.
- First make the things you will buy (they are not in the demo data):
  - Masters > Catalogue > Raw materials > New: `RM-PR2` "Jumbo parent reel, 2-ply" in kg, `RM-CORE` "Paper cores" in
    pieces, `RM-CTN` "Shipping cartons" in pieces. Open each: weight (1 for the reel, 0.05 for the others) and, on the
    Tax tab, HSN `48030010`, `48229090` and `48191010` (add them in Masters > Tax and units > HSN and GST rates at 18%
    from 1 April 2026 if they are missing). The GST rate shows read only.
  - Masters > Catalogue > Products and SKUs, SKUs tab, `DF044-M100` (wet wipes): Made or bought = Bought.

## Part A - Suppliers

1. **Masters > Partners > Suppliers.**
   Rule chips (GSTIN checked, MSME 45 days, bank change needs a second Admin), tabs Active / On hold or blocked, a
   search box and one row per supplier: code, what they supply, GSTIN with the state, terms, open POs, we owe, record,
   state. The two DEMO suppliers are there as SUP-0001 and SUP-0002 with the GSTIN and town they had.

2. **New supplier**: name `Velan Converters`, tick Raw material. Contacts: Arul, phone `98400 1234`, e-mail `arul@x`.
   Tax and address: GSTIN `33AAKFA1234B1Z8`, `12 Main Road`, Ambur, PIN `63580`. Bank: account `123456789012`, again
   `123456789013`, IFSC `IDIB000A123`, holder and bank filled. Add supplier.
   Not saved. Red under the phone (10 digits), the e-mail, the GSTIN (the last character does not match), the PIN
   (6 digits) and the account typed again (does not match); the Contacts, Tax and Bank tabs are marked.

3. Fix them: phone `98400 12345`, e-mail `sales@velan.example`, GSTIN `33AAKFA1234B1Z9`, PIN `635802`, State
   **Karnataka**, account again `123456789012`. Add supplier.
   Refused under the GSTIN: it starts with 33, but Karnataka is 29. The PAN box shows AAKFA1234B by itself (read only).

4. State Tamil Nadu. Items and prices: Add an item, RM-PR2, their code `JR-2P-17`, price `72`, lead `7`, minimum
   `500`, Spec GSM `17`, ply `2`, width `2600`; another, RM-CORE, `6.5`, `5`, `1000`. Add supplier.
   "Velan Converters added as SUP-0003. Same state: CGST + SGST on their bills. Their bank account waits for a second
   Admin; they cannot be paid until it is signed." In the list: "No goods in yet" and "Bank change waiting".

5. As **Pavithran**, Home > Approvals: try to approve the bank request.
   You cannot: you raised it. As **Shoban**: approve it. The supplier's Bank tab now says "Paid to: Indian Bank
   XXXX9012".

6. Open Velan, Bank: a new account (holder, `HDFC Bank`, `50100222333444` twice, IFSC `HDFC0000999`). Save.
   "New bank account sent for approval ... Until then payments go only to the approved account (ending 9012), never to
   the new one." The bank fields are locked while it waits. Shoban approves; it is paid to HDFC XXXX3444. Admin > Users
   and security > Audit log, screen Suppliers: both account numbers are masked.

7. Add a second supplier `Sri Balaji Packaging` (Packing, GSTIN `33ABCPB7316M1ZV`, MSME Micro, Udyam
   `UDYAM-TN-02-0118842`, terms `15`, Chennai `600058`, a bank account) with item RM-CTN at `22`, minimum `500`; and a
   third `Kaveri Tissue Mills` (GSTIN `33AACCK9032H1ZP`), status **Blocked** with no reason. Save, then with the reason
   "Wet reels in September". Approve both bank accounts as Shoban.
   Blocked with no reason is refused under "Why on hold or blocked". Kaveri is then in the On hold or blocked tab.

8. **Export CSV.**
   A file with code, name, supplies, GSTIN, state, MSME, terms, we owe and status. No bank account in it.

## Part B - Indents

9. As the **Warehouse** person: Purchase > Indents > **New indent**: RM-CTN `1000`, needed by next week, no reason.
   Send indent.
   Refused under Why. Add `Cartons for the November dispatch`: sent as DFN/26-27/0001. Opening it shows "Waiting for
   someone else" and no buttons.

10. As the **Supervisor**: open it. Reject with no reason, then Approve.
    Reject asks for a reason. Approve moves it to the Approved tab.

11. Approved tab: open it, **Make purchase order**.
    A new purchase order opens with Sri Balaji Packaging (the cheapest active supplier for cartons), 1000 at Rs 22.00
    (their price). Raise it: the indent moves to Turned into PO with the number.

12. **Reorder check** (with a reorder level set on a bought item below its stock, Inventory > Stock > Reorder).
    An indent from Reorder check for what is low (twice the level less what is there or coming, rounded up to the
    supplier's minimum). Pressing it again says nothing is low.

## Part C - Purchase orders

13. Purchase > Purchase orders > **New purchase order**: Velan, Kanchipuram, RM-PR2 `300` at `75`.
    Under the item: "Last Rs 72.00 (their price list) · up 4.2% · below their minimum of 500 kg · GST 18%". The box under
    the totals lists both under "Check before raising". Neither blocks the order.

14. Same order: rate `72`, quantity `800`, add RM-CORE `2000` (the rate fills 6.50), freight `1400`.
    The box says "Needs approval. Rs 72,000 without GST is above the Rs 50,000 in Approval rules". Totals: value Rs 70,600,
    freight Rs 1,400, CGST and SGST Rs 6,480 each, total Rs 84,960.

15. **Save draft**.
    "Draft 1 saved. A draft has no number". Drafts tab shows it; the PO number is not used.

16. Open Draft 1, **Raise purchase order**.
    It takes the next number (DFP/26-27/000n), waits for approval. As Pavithran you cannot approve it (you raised it);
    Shoban approves: Sent to supplier, Approved by Shoban.

17. New purchase order: Sri Balaji, RM-CTN `2000` at `22` (Rs 44,000). Raise. Then another: Sri Balaji, RM-CTN `400`.
    The first goes at once. The second box says Needs approval: with Rs 44,000 of other orders to Sri Balaji in the last
    3 days, Rs 52,800. Raised, it waits.

18. New purchase order: Kaveri is shown "- blocked" in the Supplier list and cannot be picked.

19. Open the Velan order, **Print or send**: Print, PDF, Mail to supplier.
    A printable order: our details, their address and GSTIN, their item codes, HSN, GST and the totals. Print shows only
    the order. Mail: "Queued in the mail outbox to sales@velan.example with the PO as a PDF" (Admin > Communications >
    Outbox).

20. Open the Velan order, **Amend**: RM-CORE `2500`. Save Rev 2.
    It waits for approval again (value up to Rs 75,250). The order shows "Rev 2 waits for approval" and Rev 1 is still
    the order. Shoban rejects it: the order is Open at Rev 1 again, and "Rejected amendments" lists Rev 2.

21. Amend again: RM-PR2 rate `80`, RM-CORE `1200`, freight `0`. Save.
    It waits although the value fell: the request says "Rate up: RM-PR2 Rs 72.00 to Rs 80.00". Reject it.

## Part D - Goods in and Quality check

22. Purchase > Goods in > **New goods in**: the Velan order. RM-PR2 `800`, 4 reels, batch `VR1027`; RM-CORE `1200`,
    batch `VC1027`. No challan. Take in. Then challan `VC/DC/3390`, vehicle `TN 5 lorry`. Then `TN 21 AX 4402`.
    Refused without the challan, then the vehicle is refused. Then taken in: "In QC hold at Kanchipuram godown. It
    cannot be sold or used until Quality check passes it." Inventory > Stock shows the reel on QC hold, not Good.

23. New goods in on the same order, challan `VC/DC/3390` again.
    Refused: already taken in from this supplier (DFG/26-27/0001).

24. New goods in on the Sri Balaji order of 2000 cartons: received `2100`, batch `C2610`, challan `SBP/790`. Take in.
    5% over the order: it waits for approval ("More than the order ..."), nothing goes to stock. Shoban approves: the
    2100 land in QC hold.

25. New goods in on a Greenleaf-like order for DF044-M100 (make a supplier and a PO for it first): scan
    `DF044-M100#C` three times in the scan box (Enter each time); scan `DF001-M100`; scan `12345`.
    Each carton scan adds a carton (3 cartons = 3 times the packs per carton). DF001-M100 is "not on" the order; 12345 is
    not a known barcode. Batch and Made on are required; Expires on fills itself from the shelf life. A made date that
    makes it already expired is refused ("Refuse it at the gate"); one close to expiry is taken in with a note.

26. New goods in: **No purchase order**, Sri Balaji, add RM-CTN, received `20`, batch `F2611`, challan `SBP/801`. Take
    in. Then type rate `22`.
    The rate is required. Then it waits for approval ("No purchase order."); nothing goes to stock.

27. Purchase > **Quality check**: Check the Velan goods in. Reel: Accepted `780`, Rejected `0`. Save the check.
    Refused: 780 + 0 must be 800. Rejected `20`: the reason is asked for; Why rejected "Wet or damp". The GSM is required
    (Spec 17 +/- 1, 2-ply, 2600 mm wide): type `15.5`, Save: a reason is needed for accepting outside the spec; type
    `17.2` instead. Save the check.
    "Into stock: RM-PR2 +780 (average cost none to Rs 73.43); RM-CORE +1200 (... Rs 6.63). Rejected goods are set aside
    and claim CL-0001 is started." (Rs 72 + its share of the Rs 1,400 freight by value.) Inventory > Stock: 780 Good,
    20 Rejected, 0 on hold. The PO is Part received.

28. **Admin > Settings > Switches**, Stock: switch off "Goods in wait in QC hold until checked".
    It waits for a second Admin (it loosens a control). Shoban approves. Take some goods in: "QC hold is switched off, so
    it is in stock now." Switch it back on (saves at once).

29. Open the checked Velan goods in.
    "Found faulty after QC: 15 days left to claim". Item RM-PR2, how many `900`: refused ("Only 780 can go back ...").
    Leave it.

## Part E - Supplier bills

30. Purchase > Supplier bills > **New supplier bill**: Velan. The lines come from the checked goods in at the PO rates.
    Their bill no. `VC/2701`, total `84000`. Save. Then reel quantity `800`. Then back to `780`, freight `0`, total
    `75472.80`. Save bill.
    84,000 is refused (the lines and GST add to Rs 75,472.80). 800 is refused (only 780 accepted). Saved: "Matched. Due
    (30 days from the bill date; Velan is MSME, never beyond 45 days from accepting the goods)".

31. New supplier bill: Velan again.
    "Nothing to bill": every accepted pack is billed.

32. For a goods in of another PO: a bill with one rate Rs 1 higher than the PO.
    The box says "Price differs from the PO" before saving. Saved, it waits ("differs from the PO by ... in all"); Shoban
    approves it in Home > Approvals and it becomes Unpaid.

33. A bill for the no-PO goods in of step 26 (after it is approved and checked), with freight `200`.
    "Freight on goods with no PO is approved first." After approval the freight goes into the average cost of RM-CTN.

34. The bill drawer of the Velan bill.
    Lines with Bill rate and PO rate, the totals, Paid, and "Average cost" lines when the bill moved the cost.

## Part F - Claims and purchase returns

35. Purchase > Claims and purchase returns: open CL-0001. What we want: Credit note. **Issue debit note**.
    Debit note DFD/26-27/000n, Rs 1,699.20 with GST (20 kg x Rs 72 + 18%). Next: Goods sent back.

36. **Goods sent back.**
    A return challan DFT/26-27/000n; the 20 kg leave the Rejected shelf. "Record their credit note when it comes."

37. Credit note no. `VC/CN/88`, amount `1500`. Record and settle. Then `1699.20`.
    1,500 is refused (our debit note is Rs 1,699.20). Then settled: "We owe Velan Converters Rs 75,472.80 before,
    Rs 73,773.60 now (set against the bill)". The PO no longer waits for the 20 kg.

38. (Replacement) Another claim with "Replacement": debit note, goods sent back, **Replacement received**.
    Refused while the PO still waits for the goods. Take the replacement in through Goods in on the same PO and check
    it, then Replacement received settles it.

## Part G - Supplier payments

39. **Money > Payments > Supplier payments.**
    To pay: Velan with its bill and the amount left, the oldest due. A supplier whose new bank waits shows "New bank
    waiting for approval".

40. **Pay** Velan: Rs 73,773.60, Bank transfer, UTR `UTR123450`. Pay. Then Pay again for the same bill.
    "Above Rs 25,000: a second person signs it". The second is refused ("... is already waiting in another payment").
    Shoban approves it; the bill is Paid.

41. A new supplier whose bank waits for approval, with a bill: Pay.
    Refused: "has no approved bank account ... every payment mode waits for it."

42. Sri Balaji with a new bank account waiting: Pay a small amount.
    The panel says the payment goes to the approved account (ending ...), never the new one. Paid at once (under the
    limit) to the approved account.

## Part H - Rights, the menu and the rest

43. As the **Sales** person: open Purchase > Purchase orders by its address (/admin/purchase-orders).
    Not in the menu; the address says "No access: Your role, Sales, cannot open Suppliers and buying."

44. As the **Warehouse** person: Purchase orders open view only (no New purchase order, rates "hidden"); New indent and
    New goods in work; Quality check has no Check button.

45. As the person who works **only at Chennai**: Purchase orders and Goods in show only Chennai's.

46. The menu's **Find a page** (or Ctrl K): type `velan`.
    Velan Converters (Supplier) and its purchase orders are listed; a click opens them.

47. Admin > Users and security > **Approval rules**: switch off "Purchase order".
    It waits for a second Admin. After Shoban signs it, a Rs 64,800 order goes to the supplier at once. Switch it back
    on (saves at once).

48. Inventory > Stock > **Stock in**.
    Only Production: "Bought goods come in through Purchase > Goods in". The purchase stock-ins of before stay listed.

49. Masters > Prices > Price lists, a list's Settings: tick another customer type. Save.
    "The customer types change waits for approval" (even for an Admin); someone with Approve on Customers decides it in
    Home > Approvals.

50. **Admin > Users and security > Audit log**, screens Suppliers, Purchase and Supplier payments.
    Every change above is there with the time and who.
