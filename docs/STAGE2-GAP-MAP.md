# dFresh Stage 2 - gap map: `stage2` branch vs the v23 working file

What the code on `stage2` already does (last commit 712d11a, 23 Oct 2026), compared with the v23 working file (the spec).
Keep = already right, leave it. Change = exists but must be upgraded. New = not there, must be built.

In all: 134 items - 46 Keep, 39 Change, 49 New.

Read the "Decisions to confirm" section first: 8 places where the code and v23 disagree.


## Decisions to confirm (code and v23 disagree)

| # | Topic | `stage2` today | v23 working file | Suggested |
|---|---|---|---|---|
| D1 | When stock goes down | At dispatch (trip start, courier hand-over, pickup) | At Packed (your 26 Oct stock rule) | v23: at Packed |
| D2 | Customer payments | Recorded per order | Per customer: settles oldest invoice or the one named | v23: per customer |
| D3 | Customer status | active / on_hold / inactive; anyone with Edit can change it | active / hold / blocked; Sales may tighten, easing needs Accounts or Admin | v23 |
| D4 | Approval limits | Global settings (e.g. refund above Rs 2,000) | Per role, with a per-person override | v23 |
| D5 | Role rights | view / create / edit / approve / delete | view / create / edit / approve / cancel / export | v23 (keep delete where used) |
| D6 | Quantity slabs | A discount offer on top of the price | Banded prices on the price list | v23 |
| D7 | Lowest price | Approval when more than X% below list | A fixed lowest allowed price per pack, plus cost + margin floor | v23 |
| D8 | Godowns | One working location (code hard-codes location 1) | Many godowns, with codes, people scoped to godowns | v23 |


## Section 0 - Foundation and Setup

| Item | `stage2` today | Action |
|---|---|---|
| Numbering series | Built (financial-year reset for invoices) | Keep |
| Audit log | Built, before/after on every write | Keep |
| Notifications, templates (EN/TA/HI), e-mail outbox with retry | Built | Keep |
| Approval queue (raise, approve, reject with reason, withdraw, expiry) | Built, 17 kinds | Keep, extend |
| Requester cannot decide own request | Built | Keep |
| Roles with rights per section | Built, no cancel/export rights | Change (D5) |
| Company profile | Free-text invoice settings | Change: profile, tax, address, PAN, bank accounts list, UPI |
| Godowns | Table exists, one used | Change (D8): code, person in charge, all stock by godown |
| Staff | Built, no godown scope | Change: godown scope, personal limit, leave |
| Approval limits per role and person | Missing | New (D4) |
| Approval rules page (kind, on/off, limit) | Partly, as settings | Change: one rules table |
| Amounts split over N days counted together | Missing | New |
| Stand-ins for leave | Missing | New |
| Second Admin for anything that loosens a control or gives signing power | Missing | New |
| Override when the other Admin is away (24h, alerts, never by the marker) | Missing | New |
| Feature switches with limits | Partly, scattered settings | Change: one switches page |
| Books-closed date and month lock | Missing | New |


## Section 1 - Products and catalogue

| Item | `stage2` today | Action |
|---|---|---|
| Categories | Built | Keep |
| Barcode labels (pack, carton, batch, A4 sheets) | Built | Keep |
| Product and SKU edit | Built | Keep, extend |
| Create an SKU from the admin | Missing (only the demo seed adds SKUs) | New - urgent |
| Status draft / active / discontinued | Only active on/off | Change |
| MRP, standard cost | Missing (only moving average) | New |
| Shelf life and near-expiry days per product | Global setting only | Change |
| Supplier EAN barcode | Missing | New |
| Raw materials as SKUs | Missing | New |
| Units of measure with conversion | Pack and carton only | Change |
| Kits as sellable bundles (show-on-site switch) | Website kits only | Change |
| Import / export with SKU columns | Products only | Change |


## Section 2 - Prices and tax

| Item | `stage2` today | Action |
|---|---|---|
| Price list per customer type, dated, with history | Built | Keep |
| Prices with or without GST per list | One global setting | Change |
| Lowest allowed price | % below list | Change (D7) |
| Margin floor (cost + %) approval | Missing | New |
| Quantity slabs on the price list | Built as offers | Change (D6) |
| Special price per customer per pack, with approval | Only a whole-list move | New |
| HSN and GST rate with dates and history | Plain columns | Change |


## Section 3 - Suppliers and buying

| Item | `stage2` today | Action |
|---|---|---|
| Suppliers | Name, phone, GSTIN, address | Change: MSME, bank with approval, rating, contacts |
| Indents | Missing | New |
| Purchase orders, approval, amendments | Missing | New |
| Goods in to QC hold | Stock-in straight to good stock | Change |
| Quality check (accept / reject) | Missing | New |
| Supplier bills, match to PO and goods in, price difference approval | Missing | New |
| Freight in cost (PO, bill, transporter bill) | Missing | New |
| Claims, purchase returns, supplier credit notes | Missing | New |
| Supplier payments (approved bank only, MSME 45 days) | Missing | New |


## Section 4 - Production (all new)

| Item | `stage2` today | Action |
|---|---|---|
| Recipes with wastage % and versions | Missing | New |
| Production runs (plan, issue material, finish to QC hold) | A production stock-in with a typed cost | New (replaces it) |
| Production QC, normal and abnormal loss, check again | Missing | New |
| Made cost from material used | Typed by hand | New |


## Section 5 - Inventory

| Item | `stage2` today | Action |
|---|---|---|
| Stock = sum of movements, never negative | Built | Keep |
| Batches with expiry, FEFO, expired blocked | Built | Keep |
| Free = stock - held - expired, reservations on confirm | Built | Keep |
| Moving average cost | Built | Keep, extend (freight, bill true-up) |
| Reorder levels | Built (godown 1 only) | Change (D8) |
| Write-offs with approval | Built | Keep, extend (batch room, shelf) |
| Stock per godown | One godown | Change (D8) |
| Shelves: good, QC hold, damaged, returned, rejected, disputed | Kinds good, returned, damaged, expired | Change |
| Transfers (on the road, receive, short to disputed, found / lost) | Missing | New |
| Stock take freeze | Approval built, no freeze | Change |
| Shelf moves | Missing | New |


## Section 6 - Leads and customers

| Item | `stage2` today | Action |
|---|---|---|
| Website enquiries, convert to customer | Built | Keep |
| Contacts, addresses with GSTIN per state | Built | Keep |
| Customer types, credit limits with approval, ledger, merge, own-customers-only | Built | Keep |
| Follow-ups on enquiries (not only customers) | Customers only | Change |
| Customer godown | Missing | New (D8) |
| Status and who may change it | Different values, no rule | Change (D3) |
| Type on a non-standard price list needs approval | Missing | New |


## Section 7 - Quotes and orders

| Item | `stage2` today | Action |
|---|---|---|
| Stock held on confirm, released on cancel | Built | Keep |
| Discount and below-list approvals | Built | Keep, extend (margin, floor) |
| Cancel after dispatch with approval | Built | Keep |
| Quotes with valid-until and kept prices | Missing | New |
| Draft orders | Missing | New |
| Numbered revisions | Edit checks only | Change |
| Standing orders | Missing | New |
| Back-orders and part shipments | Missing | New |
| Hold expiry (hours) | Missing | New |


## Section 8 - Packing

| Item | `stage2` today | Action |
|---|---|---|
| Pick list by batch (FEFO) | Built | Keep |
| Pack by scan (pack, batch, carton) | Built | Keep |
| Stock down at Packed | At dispatch | Change (D1) |
| Part shipments | Missing | New |
| Scanned packs locked for the packer | Batch must match, no lock | Change |


## Section 9 - Delivery

| Item | `stage2` today | Action |
|---|---|---|
| Trips, vehicles, drivers, My trips | Built | Keep |
| Courier with AWB and tracking | Built | Keep |
| Customer pickup | Built | Keep |
| Proof of delivery (photo, OTP) | Built | Keep |
| Driver cash collected vs handed in | Built | Keep |
| Delivery areas | Built | Keep |
| Short delivery (some packs kept) | Full deliver or full fail only | Change |
| Cash due per trip = invoices on that trip | Per order | Change |


## Section 10 - Invoicing and GST

| Item | `stage2` today | Action |
|---|---|---|
| GST invoice, CGST/SGST/IGST, HSN, PDF | Built | Keep |
| GSTR-1 registers | Built | Keep |
| Credit notes with a value cap and approval | From returns and cancel only | Change |
| Debit notes | Missing | New |
| Delivery challans | Missing | New |
| Invoice cancel on its own, with approval | Only through order cancel | Change |
| E-way bill: real checks, one load per customer per day | Typed number | Change |
| E-invoice IRN | Setting only | New |
| GSTR-3B data | Missing | New |


## Section 11 - Payments and receivables

| Item | `stage2` today | Action |
|---|---|---|
| Customer ageing and statement | Built | Keep |
| Refunds with approval | Built | Keep |
| Receipts per customer, oldest or chosen invoice | Per order | Change (D2) |
| Cheque register and bounce | Missing | New |
| Advances as a balance | A payment term only | Change |
| Waivers, bad debt write-off | Missing | New |
| Supplier payments | Missing | New (built in section 3) |


## Section 12 - Returns

| Item | `stage2` today | Action |
|---|---|---|
| DFR return numbers | Built | Keep |
| Return window and approval outside it | Built | Keep |
| Pickup (bring, trip, courier) | Built | Keep |
| Credit note from the return | Built | Keep, extend (per invoice, room held) |
| Replacement order, refunds | Built | Keep |
| Inspection: resell / repack / scrap per line | OK, damaged, expired, missing | Change |


## Section 13 - Promotions

| Item | `stage2` today | Action |
|---|---|---|
| Offers (slab, buy X get Y) | Built | Keep |
| Coupons with scope and limits | Built | Keep |
| Offer and coupon stacking | One setting | Keep |
| Approval to create an offer or coupon | Missing | New |


## Section 14 - Wallet and loyalty

| Item | `stage2` today | Action |
|---|---|---|
| Use on orders, take back on credit note or cancel | Built | Keep |
| Manual credit with approval | Built | Keep |
| Cashback rule approval | Missing | New |
| Pending lots shown in the wallet | On the order | Change |
| Cashback under the rule minimum after a return | Not handled | New |


## Section 15 - Notifications

| Item | `stage2` today | Action |
|---|---|---|
| Events, templates per language, outbox with retry | Built | Keep |
| Alerts to Admins (override, left, leave) | Missing | New |
| WhatsApp and SMS | Off until a provider is chosen | Keep (provider pending) |


## Section 16 - Reports and dashboard

| Item | `stage2` today | Action |
|---|---|---|
| Sales, margin (cost viewers only), money owed, GST, delivery, returns, promotions | Built | Keep |
| Dashboard tiles | Built | Keep, scope by godown |
| Stock value by shelf, stock ageing buckets | Value only | Change |
| Cost hidden everywhere for non-cost roles | Margin only | Change |
| Alerts (overdue, packs with no cost...) | Partly | Change |


## Section 17 - Expenses and accounting export (nearly all new)

| Item | `stage2` today | Action |
|---|---|---|
| Expenses with heads, GST, ITC | Missing | New |
| Payees (PAN key, approved once) | Missing | New |
| Petty cash per godown | Missing | New |
| Repeating expenses | Missing | New |
| Tally XML + CSV per finished month, month lock | CSV journal for any period | Change |
| Export history | Missing | New |


## Proposed build order (phase files)

| Phase | Scope | Why first |
|---|---|---|
| 11 | Design shell: 28 Oct design guide, new left menu, shared blocks (table, drawer, field with i popup, pills, toasts, approval card, cost mask) | Every page sits on it |
| 12 | Core engines: godowns (D8), shelves, rights (D5), limits (D4), rules, stand-ins, second Admin, override, month lock, split counting | Every section calls them |
| 13 | Section 0 screens: Company, Godowns, Staff, Roles, Approval rules, Switches | Setup comes first in testing |
| 14 | Section 1: SKU create, status, MRP, cost, raw materials, UoM, kits, EAN | Nothing can be bought or sold without it |
| 15 | Section 2: floor, margin floor, slabs on lists, special prices, dated GST | |
| 16 | Section 3: suppliers, indents, PO, goods in, QC, bills, freight, claims, supplier payments | |
| 17 | Section 4: recipes, runs, production QC, losses | |
| 18 | Section 5: transfers, disputed, stock take freeze, shelf moves | |
| 19 | Sections 6 and 7: status rule, quotes, drafts, revisions, standing orders, back-orders, hold expiry | |
| 20 | Sections 8 and 9: stock down at Packed (D1), part shipments, packer lock, short delivery, cash per trip | |
| 21 | Sections 10 and 11: debit notes, challans, invoice cancel, e-way, IRN, 3B, receipts per customer (D2), cheques, waivers, bad debts | |
| 22 | Sections 12 to 14: inspection outcomes, offer and cashback approvals, wallet pending lots | |
| 23 | Sections 15 to 17: Admin alerts, reports by shelf and cost mask, expenses, petty cash, Tally export, month lock | |

Each phase: database migration, API, screens, and automated tests copied from the working file's in-app tests for that section. Pavithran clicks through, then the section is frozen in the tracking file.
