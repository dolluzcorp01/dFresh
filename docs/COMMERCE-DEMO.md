# dFresh Commerce: 15-minute demo for sir

One customer from the first enquiry to the reports, on the demo database `dfresh_commerce`. Every click below was
done on screen on 21 Oct 2026 with the demo just seeded; the numbers in *italics* are what the screen showed then
(order and invoice numbers can differ by one or two if something else was entered first).

## Before sir arrives (5 minutes, not part of the 15)

1. A fresh demo: `node scripts/commerce-demo-seed.js` after rebuilding `dfresh_commerce` (or keep yesterday's if no
   demo order was made since). The seed leaves the lead **DFL-269001 DEMO Saravana Bhavan** waiting.
2. `.env`: `DB_NAME=dfresh_commerce`, `MAIL_ENABLED=true`, `MAIL_TEST_TO=` the test inbox (every mail goes there,
   with the real recipient in the subject). Then `npm run dev`.
3. Two browser windows, both on http://localhost:3000/admin:
   - window **A** signed in as Shoban (DZIND002): does the whole flow;
   - window **B** signed in as Pavithran (DZIND148): approves (nobody approves their own request).
4. The test inbox open in a third tab, to show the mails as they arrive (a minute after each step).

## The demo

The menu follows the business: Dashboard, Operations, Approvals on top; then Products and prices, Stock, Sales,
Fulfilment, Reports, Website content, Setup.

**1. The business at a glance (1 min)** - window A, *Operations* (top of the menu).
First what waits, in the order the goods move: stock below reorder level, follow-ups, to pick, to pack, waiting for a
trip, out for delivery, returns. Below that the business: sales this month (*Rs 28,712*), margin (*Rs 7,969, 34 %*),
owed by customers, stock value, wallets. (The "sales today" tile can be negative in the demo: the seeded returns are
dated today.)

**2. A lead becomes a customer (1 min)** - *Sales > Leads*, open **DFL-269001**, button **Convert to customer**.
The customer *CUS-0018 DEMO Saravana Bhavan* is made from the lead (name, phone, e-mail, type Hotel) and the lead's
history stays with it.

**3. An order that needs approval (2 min)** - *Sales > Orders*, **New order**.
Customer *CUS-0018*, SKU `DF001-M100` (Table Napkins), quantity `48` (2 cartons), Delivery: Own vehicle (the form runs
customer > addresses > items > discounts > delivery > payment). In Price,
type a price 10 % below the list (*list Rs 37, type 33.30*). The form says at once: *"Waits for approval: Price below
the list - 10 % below"*. Button **Save - send for approval**: the order is *DFO-260029, Waiting for approval*. Point
out: the customer gets nothing yet; the approver gets a mail.

**4. Approval (1 min)** - window B, *Approvals* (top of the menu, with its count): the request with the order, the price and the list price.
**Approve**. The order becomes *New*; the customer gets "Order confirmed".

**5. Pick and pack (2 min)** - window A, *Fulfilment > Packing*.
Tick the order; **Pick list** prints the pick list by bin; **Start packing**. Tab **Packing**, **Scan and pack**: scan
(or type) `DF001-M100#C` twice: one scan per carton, *48 of 48 packs, all matched* (a wrong product or batch is
refused with a message). Cartons `2`, weight `9.5`, **Mark packed**. **Packing slip** and **Carton labels** print
from the same screen. The customer gets "Order packed".

**6. The trip and the delivery (2 min)** - *Fulfilment > Delivery*, tab *Ready for a trip*.
Tick the order, choose the vehicle and the driver (*DEMO Murugan*), **New trip with 1 stop(s)**. Tab **Trips**, open
it, **Start trip**: *"out for delivery, Rs 1,886.00 to collect"*. Starting the trip takes the stock out by batch and
issues the tax invoice (*DFI/26-27/0015*); the customer gets "Out for delivery" and the invoice as a PDF. On the stop,
**Delivered**, received by `Saravanan`, save: *"DFO-260029 delivered to Saravanan"*. (The driver does the same on
a phone in *Fulfilment > My trips*, with a photo and, if switched on, the customer's OTP.)

**7. Invoice and payment (1 min)** - *Sales > Orders*, open the order.
Button **Invoice** opens the tax invoice (print or PDF; it says DEMO until the real GSTIN is set). **Record a
payment**: mode UPI, reference `UTR4455667788`, **Save payment**: *Paid*. The customer gets the receipt.

**8. Return and refund (2 min)** - on the same order, **New return**: reason *Wrong item*, *Customer brings it*,
`2` packs, **Save return** (confirm). *Fulfilment > Returns*, open *DFR-260010*: scan `DF001-M100` twice (*2 of 2
received*), **Inspect**: 2 OK, **Save inspection**; decide 2 to refund, Refund to *Wallet*, **Save decision**:
*"Refund Rs 79.00 paid with its credit note"* (*DFC/26-27/0003*, GST taken back as invoiced). The customer gets the
refund mail with the credit note PDF.

**9. Cashback (1 min)** - *Products and prices > Promotions*, tab **Cashback**: the rules per customer type. Cashback is
credited once the return window has passed, so the demo order's comes on *29 Oct*; show one already credited:
*Sales > Customers*, *CUS-0001*, tab *Wallet*: *Rs 175.26 cashback (3 % on DFO-260001)*, expiring in a year, used on the next order.

**10. Reports (2 min)** - *Reports > Reports*.
**Sales** (by day, product, customer, area; each report shows its own check, *"Check OK: invoices - credit notes"*),
**Margin** (at the cost when the goods left), **GST (GSTR-1)** (B2B, B2C, HSN summary; the Excel has the GST offline
tool's sheets). Every report: Excel and Print.

**Close (30 s)** - *Setup > Notifications > Log*: the 10 messages of this one order, from "approval waiting" to the
refund, each with its status. Then the test inbox.

## If something goes wrong in front of sir

- A button is greyed out: the form has a red line saying what is missing (for a return: choose the reason).
- "Waiting for approval" does not clear: approve in window B (Pavithran), not in window A.
- No mails: `MAIL_ENABLED=true` and `MAIL_TEST_TO` in `.env`, and `npm run dev` restarted after changing them.
- To run the demo again: rebuild `dfresh_commerce` and run the seed (about 2 minutes).
