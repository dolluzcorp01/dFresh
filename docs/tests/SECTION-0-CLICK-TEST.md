# Section 0 - Foundation and Setup: click test

For Pavithran, before Shoban freezes section 0. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on (Admin > Settings > Switches > Turn on).
- You need two logins open at the same time, in two different browsers (or one normal and one private window):
  - **Pavithran** (you, Admin)
  - **Shoban** (Super admin)
- Several steps need more staff. Step 12 adds them from dAdmin. Use real dAdmin employees who are not admin users
  yet, and give them the roles named there. In this guide they are called **Anitha** (Sub-admin), **Kumar**
  (Supervisor, Kanchipuram), **Lakshmi** (Supervisor, Chennai), **Murugan** (Warehouse) and **Divya** (Sales).
  Use whichever real names you pick.
- Some steps ask you to sign in as one of them. Ask that person to sign in, or sign in with their dAdmin login if you
  are allowed to.
- Anything that "waits for a second Admin" appears in Home > Approvals. The other Admin approves it there.
- Nothing is really sent. Messages go to the Outbox only (Admin > Communications > Outbox).

## Part A - The company

1. **Admin > Organisation > Company.**
   You see a list of sections on the left: Company profile, Tax and compliance, Address and contact, Bank accounts,
   Invoice preferences, System preferences, Document numbering. Missing facts are counted in a red circle next to
   their section.

2. **Tax and compliance > Change.** Type GSTIN `33ABCDE1234F1Z5` and PAN `ZZZZZ9999Z`. Save.
   Refused under PAN: the PAN inside the GSTIN does not match the PAN typed.

3. Same panel. PAN `ABCDE1234F`, TAN `12345`, Udyam `UDYAM-TN-2-123`. Save.
   TAN and Udyam are refused under their fields, each with an example of the right shape.

4. Same panel. Clear TAN and Udyam, keep GSTIN and PAN. Save.
   Saved. The GST state now reads "Tamil Nadu (33)". The red count on Tax and compliance is gone.

5. Set GST type to Composition while e-invoice is on (Admin > Settings > Switches > Money).
   Refused: a composition dealer makes bills of supply, so e-invoice stays off.

6. **Bank accounts > Add account.** State Bank of India, account `12345678901`, typed again as `12345678902`,
   IFSC `SBIN001234`. Add.
   Refused: the two numbers do not match, and the IFSC is not 11 characters.

7. Fix the second number to `12345678901` and the IFSC to `SBIN0001234`. UPI ID `dfresh@sbi`. Add.
   "Waiting for approval". The account is not on invoices yet.

8. As **Shoban**, Home > Approvals: approve the bank account.
   Back on Company it is the default account, with its UPI QR line.

9. Add a second account (HDFC Bank, `50200012345678`, `HDFC0001234`). Shoban approves it. Then press Make default on
   it, and Shoban approves that too.
   - HDFC is now the default.
   - Try Make inactive on HDFC: refused, because it is the default and another account exists.
   - There is no Delete anywhere.

10. Change the SBI account's UPI ID to `fraudster@okaxis`.
    - It waits for a second Admin, and invoices keep `dfresh@sbi`.
    - Open Home > Approvals: the card offers no override, even when Shoban is on leave.
    - Shoban rejects it with a note.

11. **Invoice preferences > Change.** Untick Duplicate, tick Triplicate, signatory "Shoban B". Save.
    - Copies are Original and Triplicate; Original can never be unticked.
    - With no approved bank account, the page warns that bank details or the QR cannot print.
    - Upload a signature: a PNG under 500 KB is taken; a PDF is refused; a picture over 500 KB is refused.

## Part B - Staff, roles and godowns

12. **Admin > Users and security > Staff > Add staff.** Pick an employee from dAdmin. Give them a role with
    Approve rights (Sub-admin, or a Supervisor role with a limit).
    - Saved, but shown as "Waiting for a second Admin". They cannot sign in yet.
    - The other Admin approves it in Approvals; then they are active.
    - Add the five people from "Before you start" this way.

13. Open one of them in Staff.
    - A "From dAdmin, read only" block shows their employee ID, e-mail, phone and last login ("Never" until they sign in).
    - Press Add staff again: the same person is not offered any more.

14. **Admin > Organisation > Godowns > New godown.** Vellore godown, code `V`, Tamil Nadu, address line 1 filled. Add.
    - The message names the people who can work there at once (the ones on "Every godown").
    - People with ticked godowns (for example Kumar) do not get Vellore until it is ticked for them in Staff.

15. **Admin > Organisation > Numbering.** You see Vellore's own numbers (`DFI/V/...`, `DFC/V/...`) next to
    Kanchipuram's, which have no letter.

16. New godown again: Bengaluru godown, code `B`, Karnataka, GSTIN empty. Add.
    Refused under GSTIN: a godown in another state needs its own GSTIN.

17. Same panel. GSTIN `33ABCDE1234F1Z5`: refused (a Karnataka GSTIN starts with 29). GSTIN `29ZZZZZ9999Z1Z5`:
    refused (not the company PAN). GSTIN `29ABCDE1234F1Z5`: added.

18. **Godowns > Kanchipuram > Change.**
    - Empty Address line 1 and Save: the message shows at the top of the open panel and Address line 1 turns red.
    - Put it back. PIN `63150`: refused (6 digits). Closes `08:00`: refused (after it opens).
    - Tick every day as weekly off: refused (never closed every day).
    - PIN `631501`, closes `18:00`, only Sunday off: saved. The card shows "09:00 to 18:00, closed Sun" and the
      "PIN to add" flag is gone.

19. **Close this godown** on Chennai. Refused, naming its packs in stock, its open orders and the people who work
    only there. Close Vellore (empty): it asks first, then closes.

20. **Admin > Users and security > Roles.** Pick a role with people.
    - "Show people in ..." opens the list: each person with their godowns, limit and "Open in Staff".
    - Pick another role: the list stays open.
    - Hide people, pick another role: it stays closed.

21. In Roles, pick a custom role.
    - Save role is greyed.
    - Change the default limit: Save role and Cancel changes appear.
    - Cancel changes puts it back.
    - Choose "Up to an amount" with the amount empty and Save: refused under the field ("type 0 ...").

22. Roles: tick Approve on a section for the Warehouse role, or raise its limit. Save.
    "Waiting for a second Admin". The role stays as it was until the other Admin approves.

23. Roles: Super admin and Admin show every right and are locked. Sub-admin keeps its name.
    - An Admin can change Sub-admin's rights: a narrower change saves at once, a wider one waits.
    - Signed in as Anitha (Sub-admin), the Sub-admin role is locked: "Nobody changes a role they hold".

24. **Staff:** open Murugan. Personal limit `500`. Save.
    - It waits for a second Admin.
    - After approval his row shows Rs 500 (personal).
    - Set it back to role default: saved at once.

25. Staff: give Lakshmi "Every godown". It waits for a second Admin; she keeps Chennai until it is approved.

26. As **Shoban**, open Pavithran.
    - Role Sub-admin: waits ("takes the Admin role away").
    - Chennai only and a limit of Rs 1: both wait. Nothing changes until another Admin approves.

27. As Shoban, put Pavithran on leave starting today. Refused: an Admin's leave is entered by that Admin, or starts
    at least 2 days ahead. Leave from 2 days ahead for 40 days: refused (30 days at most).

28. **Staff > Kumar**: set leave this week with Lakshmi standing in.
    - Open the Stand-in list for Kumar: people who cannot approve what Kumar approves show "cannot stand in".
    - Then try leave for Lakshmi on the same days, with Pavithran standing in: refused, because she stands in for Kumar then.

29. **Admin > Users and security > Stand-ins.** Kumar's leave and Lakshmi as his stand-in are listed.

30. **Staff > Divya > Mark as left.** Leave "Hand over to" empty and press Hand over and mark as left.
    - Refused: her customers and enquiries need someone.
    - Choose Pavithran and press it again: she shows as left, and her customers and open enquiries are now Pavithran's.
    - Signed in as Divya, she is signed out at once.

31. **Staff > Kumar > Mark as left** (he is in charge of Kanchipuram).
    - Without a new person in charge: refused.
    - Choose Lakshmi (Chennai only): refused.
    - Choose Pavithran: done. Kanchipuram's in charge is Pavithran, and Kumar's leave and Lakshmi's stand-in end.

32. As Shoban, bring Kumar back (Bring back on his row).
    - Shoban (Super admin): he is active at once, as before.
    - If Pavithran does it instead: it waits for a second Admin.

## Part C - Approvals and rules

33. **Admin > Users and security > Approval rules.**
    - Rules are grouped by section.
    - "Every one" rules have no amount box.
    - Stock write-off has a rupee box and a packs box.
    - The three locked rules (company bank, supplier bank, weakening a rule) cannot be switched off.

34. Raise the Refund rule's limit (weaker). It waits for a second Admin. Lowering a limit saves at once.

35. Signed in as Anitha (Sub-admin) or a Supervisor with View on Roles and users: Approval rules open view only.
    Changes are refused.

36. **Home > Approvals** as Divya (Sales): only her own requests show, and nothing waits for her.
    As Anitha (Sub-admin): she sees every request, grouped as Waiting for you, Raised by you and Everything else
    waiting.

37. A request raised by Pavithran: Pavithran has no Approve button ("You raised it"). Shoban does.

38. With Kumar on leave and Lakshmi standing in: Lakshmi's card for a small Kanchipuram write-off reads
    "Approve for Kumar M". After she approves, the Decided list names both of them.

39. Three write-offs of Rs 1,400 by the same person within 3 days: each card says it counts together with the
    others (Rs 4,200 in all), and the person with a Rs 2,000 limit is not offered them.

40. A rule change while Pavithran is really away (he enters his own leave):
    - Shoban's card offers the override.
    - A reason under 10 letters is refused.
    - With a proper reason it applies 24 hours later.
    - Every Admin is told at once (Outbox: an e-mail and a prepared WhatsApp each), and any Admin can cancel it.

## Part D - Numbering, switches, audit and messages

41. **Admin > Organisation > Numbering.**
    - Tax invoice, Credit note, Order, Return and Customer code are "Built, kept": their prefix cannot be typed in.
    - Debit note prefix `DFRESH`: refused, because the Chennai number would be 19 characters (GST allows 16).
    - Receipt is DFRC, so it never clashes with Return DFR.

42. Numbering > Set next number on Purchase order (Chennai): a number below the last used is refused.
    "Test: use next number" says which number it took and that it is never used again.

43. **Admin > Settings > Switches.** Groups on the left: Turn on, Stock, Orders, Delivery, Money, Wallet, Returns,
    Approvals, System.
    - "Most of an order the wallet can pay" at 500: refused (0 to 100).
    - "A waiting request expires after" 30 days, or "Days that count together" 1: waits for a second Admin.
    - "Days that count together" 5: saved at once.
    - Money > "Credit sales allowed" (phase 23, on as delivered): switch it off. Sales > New order: the payment terms
      offer only Pay on delivery and Paid in advance; an order sent with "On credit" is refused "Credit sales are
      switched off". Switch it on again: it waits for a second Admin (it loosens a control).
    - Delivery > "Invoice made at the gate" (phase 23, off as delivered): turning it on waits for a second Admin.

44. Press `/` in the menu (Find a page), type "switches", press Enter: Switches opens.
    `/admin/switches#money` opens the Money group.

45. **Admin > Users and security > Audit log.**
    - Every change above is listed: who, when, the screen, and the old value struck through next to the new one.
    - Pick yourself in Everybody, and today in From / To: only your changes of today.
    - Export CSV saves exactly those rows, and the export itself appears in the log.

46. Signed in as Anitha (Sub-admin): she sees the Staff, Roles, Godowns and Approvals rows but not the Company
    ones, and has no Export button. Signed in as Kumar: only his own changes, with no Everybody list.

47. **Admin > Communications > Notifications.** Each event with who gets it and its on / off.
    WhatsApp and SMS show "Provider not set up".

48. **Admin > Communications > Message templates.** Each event per language. Tamil and Hindi texts show "Check the
    wording" until someone reads them. Open one: a live preview.

49. **Admin > Communications > Outbox.** The messages of the steps above (e-mails, and the WhatsApp copies marked
    "Prepared", never sent). A failed e-mail can be sent again.

50. **Home > My tasks, Admin > Organisation > Financial year lock, Print templates, Admin > Devices > Label printer,
    Scanner:** each says "Later (Foundation v7)".

## Not in section 0 yet

These v23 Foundation tests need later sections and are not part of this click test:

- Production in the role grid and production wastage requests (section 4).
- The money rules for invoice cancel, supplier payments, expenses and petty cash (sections 10, 11 and 17).
- The other v23 approval rules: special price, price below cost plus margin, purchase orders (sections 2 and 3).
