# Section 6 - Leads and customers: click test

For Pavithran, before Shoban freezes section 6. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on, with two godowns (Kanchipuram and a second one, e.g. Chennai). Sign in
  as **Pavithran** (Admin).
- Other people, in a second browser: a **Sales** person whose role has "Own customers only" ticked (Admin > Roles) and
  who owns a few customers, an **Accounts** person (Approve on Money) and a second **Admin**.
- "Waits for approval" means it appears in Home > Approvals; somebody else approves it there.
- At least one customer type buys on the standard (default) price list (Customer types shows "default").

## Part A - Enquiries and follow-ups

1. **Sales > Leads > Enquiries.** Every website form is listed with its status. An open enquiry nobody has answered 24
   hours after it came in shows a red "No reply in 24 h".
2. Open an enquiry. Everything the visitor typed is there (phone, e-mail, message, distributor details), the consent
   text with its time and the Google Sheet sync. Under **Calls**: "No call yet".
3. **Log a call**: How WhatsApp, What was said "Sending the sample", next call in 3 days, a sample to send. Save:
   "WhatsApp logged. Sample SMP-000N is on the list to send. Next call on ...". The enquiry is now Contacted, given to
   you, the 24-hour flag is gone, and the call shows under Calls.
4. Choose no reason and press **Mark lost**: "Say why it was lost". Choose "Too far to deliver", Mark lost: it is Lost
   with the reason. On another enquiry press **Spam**: it moves to Spam.
5. **Sales > Leads > Follow-ups.** Tabs Today and overdue (overdue in red, today in amber), Coming up, Samples, Call
   log. Each due row has who, next call, given to and what was said last; a row opens the enquiry or the customer.
6. Samples tab: **Mark sent** on a sample to send, then **Ordered** (or No order) on a sent one.
7. **Convert to customer** on an enquiry whose phone belongs to an existing customer: refused, "Already a customer:
   CUS-00NN ... (same phone)". On a new one: the customer is made with the name, type, town, contact person and phone,
   the enquiry is Won and its calls, follow-ups and samples move to the customer.
8. As the **Sales** person: Enquiries lists only those given to them and new ones nobody has picked up. Giving an
   enquiry to someone else is refused: "Sales can pick up an enquiry for themselves, not give it to someone else."

## Part B - Customers

9. **Sales > Customers > Customer list.** Tabs Active / On hold and blocked / All. As the Sales person only their own
   customers show, and only customers of godowns they work at.
10. New customer with the phone of an existing customer: "Already a customer: CUS-00NN ... (same phone)". A GSTIN of
    another state than the billing address: refused with the state named. A GSTIN with a mistyped last character
    (33AAFFH4521K1ZA; the check character is K): "the last character does not match" (phase 23; an address
    already saved keeps its GSTIN when saved again unchanged). A good one is added on its type's list
    with the type's default days to pay.
11. As the **Sales** person, a new customer on a type whose price list is not the standard one (e.g. Distributor): it
    is added on a standard-list type and the wanted type waits for Accounts or an Admin ("type ... to Distributor").
12. Open a customer, State **On hold** with the Why empty: "Say why". With a reason: it moves to On hold and blocked.
    As the Sales person, put a customer on hold: done at once. Try to make it Active again: refused "Easing a
    customer's status (on hold to active) is for Accounts or an Admin".
13. As **Accounts** (or an Admin), make it Active: "Waiting for approval"; it stays on hold until a second person signs
    it in Approvals. After approval it is Active.
14. Changing a customer's type: only Accounts or an Admin, and it waits for a second person.
15. **Merge duplicates**: merge one customer into another; it waits for approval. After approval the merged one shows
    "Merged into ...", its orders, contacts, open quotes and standing orders are on the other customer. Its invoices
    still show the buyer they were issued to.

## Part C - Customer types, credit, ledger

16. **Sales > Customers > Customer types.** Each type with its price list ("default" when it buys on the standard
    list), default days to pay, number of customers. Move a type to another list: it waits for a second person
    ("List change waiting"); after approval it is on the new list.
17. New type "School", code school, 15 days: added on the standard list. As the Sales person, a new type on another
    list waits for Accounts or an Admin and buys on the standard list until then.
18. **Sales > Customers > Credit limits.** Each customer: limit (or cash), days, owes, used (a bar), overdue, and
    "Orders today would": Go through, or "Wait: on hold, overdue Rs ..., over the limit by Rs ...".
19. As the Sales person raise a limit (with why): "Waiting for approval"; the row shows "Rs ... waiting" and the panel
    cannot be changed again. Approve it as someone else: the new limit shows. Lowering a limit is done at once.
20. **Sales > Customers > Customer ledger.** Pick a customer: every line by date with the running balance, open
    invoices with their due date (Overdue in red), the ageing, and **Statement (PDF)** opens the statement.
21. As someone working at the second godown only: Customer list, Credit limits and Customer ledger show no customer of
    Kanchipuram.
22. In Staff, change the Sales person's role to Delivery without choosing who takes over: refused, "Hand over first:
    N customer(s) ...". Choose a taker: saved, and the customers are on the taker. In Roles, taking Edit on Customers
    off a role whose people still own customers is refused until they are handed over.
23. On a phone (390 wide): every page above works with no sideways scroll; tables become cards.
