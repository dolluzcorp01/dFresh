# dFresh Commerce: decisions for sir

What sir (and the accountant, where it is GST) still has to decide before Commerce is switched on. Each line says what
the system does today (the default it was built with) and what changes once it is decided. Everything here is a
setting in **Setup > Commerce settings** unless the line says otherwise; the 12 settings marked "To be confirmed" there
are all in this list. Changing a setting is audited and takes effect at once for new orders; orders and invoices
already made keep what they were made with.

"Not built yet" means the setting only records the decision today: choosing "on" needs development work first (an
estimate is given), it does not happen by itself.

Last checked against the code and the demo database: 21 Oct 2026.

## 1. GST, seller and invoices

| # | Decision | Today (default) | When it is decided |
|---|---|---|---|
| 1.1 | **Seller GSTIN** (To be confirmed) | `TO-BE-CONFIRMED`: every invoice and credit note prints **"DEMO - not a tax invoice"** | Type the real GSTIN (33..., checked for format and state). From the next invoice on, invoices are real tax invoices. Invoices made before keep the DEMO mark. |
| 1.2 | **Seller (legal entity)** name on the invoice (To be confirmed) | Dolluz Corporation (OPC) Pvt Ltd | The name printed as the seller on invoices, credit notes and statements. The site keeps saying "Marketed by" (no "Manufactured by" claim). |
| 1.3 | **Seller address** on the invoice (To be confirmed) | Kanchipuram, Tamil Nadu | The full registered address, as on the GST certificate. |
| 1.4 | Seller state code | 33 (Tamil Nadu) | Decides CGST + SGST (same state) or IGST (other state). Change only if the GSTIN is registered elsewhere. |
| 1.5 | **Bank details on the invoice** (To be confirmed) | Empty: not printed | Account name, number, IFSC typed here are printed as "Pay to" on every invoice (PDF and print). |
| 1.6 | **GST rate and HSN code per product** | Every product: HSN **4818**, GST **18 %** (the demo uses 48181000 / 48182000 / 48183000 for tissue and 33079090 for wet wipes) | Set per product in Products and prices: the HSN (8 digits from the accountant) and the rate. Used on every invoice line and in the GSTR-1 HSN summary. Rates offered: 0, 5, 12, 18 %. |
| 1.7 | GST on delivery charges | 18 % (SAC 9965) | The accountant confirms the rate for the delivery service. |
| 1.8 | **Place of supply rule** (To be confirmed, accountant) | B2B (the billing address has a GSTIN): the state of that GSTIN, even when shipped elsewhere. B2C: the shipping state. | The other choice is "always the shipping state". It decides CGST + SGST or IGST on every new order; the reason is printed on the invoice. |
| 1.9 | **Cashback under GST** (To be confirmed, accountant) | Discount: cashback or a manual credit used from the wallet lowers the taxable value of the order (less GST) | The other choice is "payment": the wallet pays part of the total and the taxable value stays the same (the GST is on the full price). |
| 1.10 | Prices with or without GST | Without GST (exclusive): GST is added on the invoice | "Inclusive": the price lists hold the price with GST. Change it BEFORE prices are entered: entered prices are not converted. |
| 1.11 | Invoice numbers and when the invoice is made | DFI/26-27/0001 (per financial year, no gaps), credit notes DFC/..., made at **dispatch** | A first number other than 1 (if invoices were already made elsewhere this year); "at confirmation" instead of dispatch. Fixed once the first real invoice exists. |
| 1.12 | **E-invoicing (IRN / QR)** (To be confirmed) | Off: invoices are made here without an IRN | Needed only above the turnover limit (accountant). **Not built yet**: the IRN portal connection is about 3 to 5 days of work. |
| 1.13 | **E-way bills** (To be confirmed) | Off: made by hand on the portal. Above Rs 50,000 the e-way bill number must be typed before the courier takes the goods. | "On" = made from here through the portal. **Not built yet** (about 3 days). The Rs 50,000 limit is its own setting. |

## 2. Payments and accounts

| # | Decision | Today (default) | When it is decided |
|---|---|---|---|
| 2.1 | **Razorpay payment links** (To be confirmed) | Off: payments are entered by hand (Cash, UPI, Bank transfer, Cheque, "Razorpay (manual)" with its reference) | Needs a Razorpay account. **Not built yet**: a link on the order and the payment recorded by itself is about 3 days of work. |
| 2.2 | **Accounting software** (To be confirmed) | CSV journal from Reports > Accounting export (sales, receipts, credit notes, refunds, wallet; every voucher balanced) | Tally or Zoho: which one, and the accountant's ledger names. **Not built yet** (about 2 to 4 days for one of them). |
| 2.3 | Credit days and limits per customer type | Every type: 0 days, Rs 0 limit, no minimum order (so a credit order waits for approval until a customer has a limit) | Days and limit per type (Hotel, Hospital, Office, Distributor, Home) in Commerce settings > Customer types; each customer can differ. |

## 3. Prices, returns and approvals

| # | Decision | Today (default) | When it is decided |
|---|---|---|---|
| 3.1 | **Prices** | None on the live site (Phase 1: no prices anywhere on the public site). Price lists: Default + one per customer type. | Sir's price per pack (or carton) for each SKU on each list, typed or by Excel in Products and prices, with the date they start. Needed before the first order. |
| 3.2 | **Return window** | 7 days after delivery; a later return needs approval (the other choice: refused) | The number of days, and whether late returns are refused or approved case by case. |
| 3.3 | Cashback | Credited after the return window (no extra cashback when goods come back); cashback in the wallet expires after 365 days; at most 50 % of an order paid from the wallet | Rules per customer type are made in Promotions; these three numbers are settings. |
| 3.4 | **Who approves** | The Admin role only (nobody approves their own request) | Add other roles as approvers (Operations, for example). |
| 3.5 | **Approval limits** | Refund above Rs 2,000; stock write-off above Rs 1,000 or 20 packs; total discount above 10 % of the goods; a price more than 5 % below the list; cancelling after dispatch; manual wallet credit or debit; raising a credit limit; an order over the credit limit or with overdue invoices; ordering more than the stock; "No refund" on a return; a customer's own price list; merging customers. Requests not decided in 7 days expire. | Each limit is a number and each rule can be switched off. |

## 4. Notifications and texts

| # | Decision | Today (default) | When it is decided |
|---|---|---|---|
| 4.1 | E-mail to customers and staff | On (through SendGrid, from connect@dolluzcorp.com); every event on; daily mails at 9 am India time | Which events sir wants (Setup > Notifications): each one on or off. |
| 4.2 | **WhatsApp** (To be confirmed) | Off and locked: "provider not set up" | Choose a provider (for example Gupshup, Interakt, Meta Cloud API). **Not built yet**: about 3 to 5 days with the provider's templates approved. |
| 4.3 | **SMS** (To be confirmed) | Off and locked: "provider not set up" | Choose a provider with DLT registration. **Not built yet** (about 2 to 3 days). |
| 4.4 | **Tamil and Hindi mail texts** | 13 Tamil and 13 Hindi templates are drafts made by the developer, marked "check the wording". Customers marked Tamil or Hindi get these drafts now. | Someone who writes Tamil / Hindi well reads each one in Setup > Notifications > Templates (with the preview) and saves it; the mark goes away. English is the fallback for any text left empty. |

## 5. Known small gaps

From the security review before the merge (all high and medium findings are fixed). These two are left as they are:

| Gap | Risk |
|---|---|
| Two people planning a trip at the same moment can put the same packed order on two planned trips (security review L6). | Low: the second trip cannot be started with it (the order has already left), so nothing is delivered twice; the planner removes the extra stop. |
| A follow-up's due date is checked only for its form (YYYY-MM-DD), not for a sensible range (security review L7). | Low: a staff member could save a follow-up dated far in the past or future; it only affects their own reminder list. |

(The review's other L7 items were fixed: trip date and area, cash on a pickup stop or with an earlier date, and the
search wildcards in the customer and return lists.)
