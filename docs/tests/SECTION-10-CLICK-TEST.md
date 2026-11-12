# Section 10 - Invoicing and GST: click test

For Pavithran, before Shoban freezes section 10. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on. Sign in as **Pavithran** (Admin).
- Other people, in a second browser: **Anitha R** (Sub-admin), a **Supervisor** and a **Sales** person.
- Admin > Switches: "E-way bill needed" On with the limit Rs 50,000; e-invoice Off (step 9 turns it on and off again).
- Have two packed orders that are not invoiced yet (Fulfilment > Packing, Packing done), one for a customer with a GSTIN.

## Part A - Invoices

1. **Money > Billing > Invoices**: tabs To invoice, Unpaid, Paid, Cancelled. A yellow banner says which company facts
   (GSTIN, PAN, bank) are not filled in yet. **To invoice** lists only packed orders with no invoice: order, customer,
   what is packed (with the first pack's photo), delivery and "Packed".
2. Try to dispatch one of them without an invoice: "Not ready to leave. Make the invoice for DFO-... first" (phase 23,
   v23: no goods leave without an invoice). Admin > Switches > Delivery "Invoice made at the gate" on (a second Admin
   signs it): leaving makes the invoice by itself, and when it needs papers (step 8) it says "Missing before the goods
   leave: ..." and nothing leaves.
3. **Make invoice** on the customer with a GSTIN: "B2B tax invoice to ... · GSTIN ...", the number it will get, place of
   supply (CGST + SGST or IGST), due (credit days, or cash on delivery), the lines with GST, the totals. Change the
   invoice date to an earlier day: the lines follow the GST rate of that date. A date before the order or after today
   is refused under the field.
4. Make invoice: "DFI/... made", Rs ... posted to the customer's ledger, due ... It is in Unpaid; Sales > Customers >
   Customer ledger shows the invoice line. Anything the customer had on account is used on it (the message names it).
5. Open the invoice: status, B2B/B2C, customer and GSTIN, order link, date and due, place of supply, made by, left to
   pay, the lines and totals, and the notes on it.
6. **Print**: the print view with the dFresh logo, "GSTIN to be provided" and "DEMO - not a tax invoice" while the
   company GSTIN is missing, bill to and ship to, place of supply, each line with HSN, the amount in words ("Rupees ...
   Only"), the HSN summary with the delivery charge as SAC 9965, "Pay to" (or "bank details to be provided"), the UPI QR
   for what is left to pay, the declaration and the signatory. **Mail to customer**: it goes through the Outbox with the
   PDF (only to MAIL_TEST_TO on stage2).
7. **Cancel**: reason "Wrong customer", Ask to cancel: "Waiting for approval". As **Anitha R** in Home > Approvals:
   approve. The invoice is Cancelled; the ledger has "Invoice ... cancelled" (owes Rs 0); the order is back in To invoice;
   the number is not used again. Then try to cancel an invoice that has a payment, a debit note, a credit note waiting,
   or whose goods have left: each is refused with what to do instead (make a credit note).
8. E-way bill: make an invoice above Rs 50,000 (or two invoices to one customer from one godown today that pass it
   together). The drawer asks for the e-way bill: empty "12 digits"; 1234 5678 9012, 000000000000 or 111111111111:
   "This is not an e-way bill number"; a number used on another invoice: "Already used on ..."; valid until before
   today: "Today or later". A real-looking number saves; **GST > E-way bill** lists it with valid until and the vehicle.
9. Admin > Switches: e-invoice On. Make an invoice for the GSTIN customer with a short IRN: "64 letters and digits";
   ack number of 5 digits: "12 to 15 digits". **GST > E-invoice** lists B2B invoices with their IRN ("Needed" in red
   until it is given). Switch e-invoice Off again.
10. In Sales > Orders open an order with an invoice that has not left: the panel shows "Invoices: DFI/..." and
    cancelling the order is refused: "Cancel the invoice first (Invoices), then the order."

## Part B - Credit and debit notes

11. **Money > Billing > Credit notes**: tabs To credit, Waiting for approval, Made, Rejected. Goods back from a short or
    refused delivery or a refunded return are credited where they come back (no approval) and show in Made.
12. **Price correction**: against an invoice, Rs 5000 when the invoice is worth less: "More than the invoice value
    without GST (Rs ...)". Rs 40 with details "Agreed rate": it waits (Waiting for approval). As Anitha: approve. It is
    Made and the customer owes Rs 40 + GST less. The GST rate is the invoice's own rate (read only).
13. A return still open on an invoice holds its room: a price credit note that would pass what is left is refused:
    "Room left: Rs ... (Rs ... is held for returns still open on it)".
14. **Money > Billing > Debit notes**: New debit note against an invoice, "Freight not charged on the invoice", Rs 150:
    "DFS/... made", Rs 177.00 (18% GST) added to the balance, due by the customer's days. It prints like the invoice with
    the reason. A debit note on a cancelled invoice, or one whose cancel waits, is refused.

## Part C - Challans and GST

15. **Money > Billing > Delivery challans**: New challan, Free samples, to "Hotel Annapurna Residency", Kanchipuram,
    one pack: "DFT/... made: 1 packs left the shelf at Kanchipuram (free samples)". Inventory > Stock status shows one
    less. The list also shows transfers (same DFT series) with a link. The print says "not a sale" and gives a value for
    transport. More than the free stock is refused.
16. **GST > GSTR-1 / GSTR-3B data**: pick the month. GSTR-3B summary: output (invoices - credit notes + debit notes),
    input (supplier bills of the month), to pay (a negative is credit carried forward). GSTR-1: B2B with GSTIN, place
    and tax; B2C; credit and debit notes; HSN summary. **Export for the CA** saves dfresh-gst-<month>.csv: one row per
    document, the HSN rows and the 3B rows.
17. As the **Supervisor** and the **Sales** person: the Billing and GST pages are not in the menu, and a direct link
    says there is no access (only Admins and the Sub-admin have Invoicing and GST).
18. Every page and panel at phone width (390): no sideways scroll; every line shows its pack photo.
