# Section 15 - Notifications and alerts: click test

For Pavithran, before Shoban freezes section 15. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on. Sign in as **Pavithran** (Admin); **Shoban** (Super admin).
- Other people, in a second browser: **Kumar M** (Supervisor, Kanchipuram only), **Divya N** (Sales), **Murugan S**
  (Warehouse).
- On stage2 no mail leaves except to MAIL_TEST_TO. WhatsApp and SMS are off (no provider chosen).
- Have a customer with an e-mail address and overdue invoices.

## Part A - The bell and Home > Alerts

1. Look at the bell in the header.
   A number: your unread alerts (and new enquiries). Click it: a line "N unread alerts" that opens Home > Alerts,
   and "Mark all alerts read".
2. **Home > Alerts.**
   Chips "Worked out live from the data", "Only your sections and godowns", "Snooze hides one for a day, for you
   only". Then the list only, as v23: no tabs and no buttons above or under it. Unread alerts have a bold title.
3. Read the list.
   Each alert has a coloured icon, a title and a line under it: low stock ("... is low at Kanchipuram godown: 5 free,
   reorder level 30"), near expiry, packs with no cost (See cost only), overdue customers, cheques to deposit, vehicle
   papers ending, supplier bills due, returns to inspect, approvals waiting for you and ones waiting long, order holds
   ending, repeating expenses due, petty cash low or counted off. Red first, then amber, gold, blue.
4. **Open** one.
   It goes to the page behind it and the alert reads as read (not bold) next time.
5. **Snooze 1 day** on another.
   It disappears for you until tomorrow; the bell drops by one. Someone else still sees it.
6. Bell > **Mark all alerts read.**
   Unread 0 (no title bold on Home > Alerts); the bell shows only new enquiries.

## Part B - Admin alerts

7. As Shoban: mark someone (not an Admin) as left (Admin > Users and security > Staff).
   Admins see "... marked as left" in Alerts.
8. As Shoban: enter leave for Pavithran from two days ahead, stand-in Shoban.
   "Leave entered for Pavithran V V" in Alerts (and the e-mail to Admins in the Outbox).
9. Loosen an approval rule (raise "Expense above the limit" to Rs 50,000); the second Admin signs it.
   "Loosened: Expense above the limit: limit 10000 to 50000" in Alerts.
10. An override set, applied or cancelled on a waiting rule change.
    "Override set: ..." in Alerts and the e-mail to Admins.
11. As Kumar (not an Admin): none of these show.

## Part C - Which alerts a role gets

12. As Pavithran: Admin > Notifications (Events), the card **Alerts each role gets** under the events.
    A role picker and one tick per alert type. All ticked.
13. Role Warehouse: untick "Stock below the reorder level". Save.
    As Murugan: no low-stock alerts any more.
14. As Kumar: the card is not on Notifications; the address answers "Only an Admin sets which alerts a role gets".

## Part D - Messages through the Outbox

15. A new order for the customer with an e-mail address, confirmed.
    **Admin > Communications > Outbox**: an e-mail "Order DFO-... confirmed", prepared, not sent from stage2.
16. **Admin > Communications > Notifications**: WhatsApp and SMS are off; e-mail goes any time (no quiet hours).
17. The customer's language Tamil, then a receipt for them.
    The receipt e-mail is in Tamil ("பணம் பெறப்பட்டது ..."). An event with no Tamil text uses English.
18. The customer opted out of reminders; Money > Payments > Receipts > Remind.
    "... Not sent to ... (the customer opted out of reminders), through the Outbox." The Outbox row says skipped.
19. **Message templates**: Payment received, English. Type `{foo}` in the text, Save.
    "Unknown placeholder {foo}: use {customer} {contact} ...". A correct text saves; Preview fills sample data.
20. Outbox, a failed message: **Retry**.
    It is queued again (prepared, not sent from stage2).
21. Make an invoice for the customer.
    The Outbox has "Invoice DFI/... for order DFO-..." with the invoice PDF attached.
22. A quote, invoice, receipt or statement "Mail to customer".
    A copy is in the Outbox with the PDF.

## Part E - Who sees what

23. As Kumar: Alerts show only Kanchipuram and only his sections; the Outbox answers "This needs view on Settings".
24. As Divya: only the overdue customers she may see, and approvals waiting for her.
25. As Murugan: stock and returns alerts of his godown.

## Part F - Layout and phone

26. Home > Alerts at 390 px: the What column hides; Open and Snooze stay on the row; nothing scrolls sideways.
27. The bell menu on a phone opens under the header and closes on a link.
