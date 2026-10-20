# dFresh Commerce - back office specification (draft for review)

Branch `commerce`, development database `dfresh_commerce`. Status: **draft, no code until approved.**
Scope: the admin back office for orders taken by phone, WhatsApp, walk-in and B2B. No public shop, no prices on the
public site (CLAUDE.md rule 11 stays). Everything here must later apply cleanly to the live `dfresh` database.

Conventions that carry over from the current site (CLAUDE.md): parameterised SQL, named columns, `emp_id` VARCHAR(20),
times stored in UTC and shown in Asia/Kolkata, all e-mail through `mailer.js` + `mail_outbox`, in-app ConfirmDialog (no
browser alert / confirm / prompt), plain hyphens only. Admin screens are internal (English); anything a customer
receives (invoice, credit note, notification) takes its words from `ui_text` / settings, never from code.

Contents: 1 Roles and permissions - 2 Approvals - 3 Settings - 4 Data model - 5 Status flows and stock - 6 Numbering
and GST - 7 Audit log - 8 Demo code review - 9 Migration plan - 10 Build phases - 11 Open questions.

---

## 1. Roles and permissions

### 1.1 Model
- A **role** is a named set of permissions. Every admin user has exactly one role.
- A **permission** is a section x an action. Actions: `view`, `create`, `edit`, `approve`, `delete`.
- Built-in roles (cannot be deleted or edited):
  - **Admin**: every action in every section.
  - **Sub-admin**: every action in every section except *Roles and users* and *Settings* (both: none).
- **Custom roles** are created by an Admin in *Setup > Roles*: name, description, a grid of sections x actions
  (tick boxes). Example roles shipped as editable defaults (not built-in): *Operations*, *Warehouse*, *Sales*,
  *Viewer (read only)*.
- Rules inside the grid: `create`, `edit`, `approve` and `delete` imply `view`; ticking one ticks `view`.

### 1.2 Sections
| Section | Covers (screens and API) |
|---|---|
| Dashboard | Dashboard, Operations dashboard (view only; every role sees it, figures limited to sections it can view) |
| Leads | Leads list, drawer, status, notes, export, Convert to customer (needs Customers create too) |
| Orders | Orders, New order, edit, cancel, invoice, payments |
| Packing | Packing queue, pick list, scan-to-pack, mark packed |
| Delivery | Dispatch, delivery runs, proof of delivery, failed delivery |
| Inventory | Stock, movements, adjustments, write-off, labels, SKUs |
| Returns | Returns, inspection, refunds, credit notes |
| Customers | Customers, addresses, notes, follow-ups, credit terms, wallet history |
| Promotions | Coupons, cashback rules, manual wallet credit |
| Products and prices | Catalogue, SKUs, price lists, GST / HSN, carton size (today's Products, Categories, Kits, Size picker, Excel) |
| Reports | Sales, GST, stock, returns, wallet, customer reports and their exports |
| Content | Banners, Translations, Towns, Form options, Brochures, Languages |
| Settings | Site Settings, Commerce settings |
| Roles and users | Roles, Admin users |
| Audit log | Audit log (view only) |

Approvals (section 2) use the `approve` action of the section the request belongs to, plus the approver role setting.

### 1.3 Enforcement
- Every `/api/dfresh/admin/*` route declares `{ section, action }`. A middleware checks the signed-in user's role
  permissions **read from the database on every request** (as the role is today) and answers **403** with
  "This needs <action> on <section>". The menu hides what a role cannot view, but hiding is never the protection.
- A startup check refuses to start the API if any admin route has no declaration, and an automated test calls every
  route with a role that lacks the permission and expects 403.
- Data inside a response follows view rights: e.g. the Orders list never returns cost prices to a role without
  *Products and prices: view*; the dashboard leaves out cards for sections the role cannot view.
- Today's routes map as: `viewer` -> view, `editor` -> create / edit (and delete where the route deletes),
  `admin` -> Settings / Roles and users. The mapping is listed per route in the phase 1 checklist.

### 1.4 Admin users and lock-out protection
- *Setup > Admin users* (exists): pick a dAdmin employee, choose a role (now any role, not three fixed ones),
  activate / deactivate. Sign-in stays as it is (dAdmin password + e-mailed code, `two_step_login`).
- Nobody can change their own role or deactivate themselves.
- There is always at least one active user with the Admin role: the last one cannot be demoted or deactivated.
- Built-in roles cannot be edited or deleted. A custom role cannot be deleted while users have it (reassign first).
- Every change is audited (section 7) and takes effect on the user's next request.

---

## 2. Approvals

### 2.1 What can need approval (each a setting with an on / off and a threshold)
| Action | Default rule | Section whose `approve` is needed |
|---|---|---|
| Refund (wallet, original payment or bank) | above Rs 2,000 per return | Returns |
| Stock write-off (damaged, expired, lost) | any write-off above Rs 1,000 value or 20 packs | Inventory |
| Manual discount on an order (beyond coupons) | above 10 % of the order subtotal | Orders |
| Cancel an order after Dispatched | always | Orders |
| Manual wallet credit (goodwill) | always | Promotions |
| Credit limit raise for a customer | always | Customers |
| Price below the customer type's price list | below by more than 5 % | Products and prices |

### 2.2 Rules
- **Approver roles** are a setting (default: Admin). The approver needs the section's `approve` action too.
- The requester can never approve their own request.
- While pending, the action is held: the order cannot move on, the refund is not paid, the stock is not written off.
  The requester sees "Waiting for approval" with who can approve.
- Approve or reject needs a note on reject. An approved request runs the action at once (in one transaction).
- Pending requests older than a setting (default 7 days) expire and must be raised again.
- **Pending approvals queue**: Setup-level screen with a red count in the menu; filters by type, section, requester;
  each row opens the thing it is about. Dashboard card "Waiting for approval".
- E-mail to approvers when a request is raised (outbox, phase 10).

---

## 3. Admin-configurable values (Commerce settings)

Two new screens: **Settings > Commerce settings** (scalars, grouped) and the list editors named below. Every change is
audited. Defaults are sensible; nothing below is hard-coded.

| Value | Where it is edited | Default |
|---|---|---|
| Customer types (list) | Commerce settings > Customer types | Home, Hotel, Hospital, Office, Distributor |
| Price per SKU per customer type | Products and prices > Price list (grid SKU x type, Excel import / export) | base price for every type |
| Base price per SKU | Products and prices > SKU | required before an SKU can be ordered |
| GST rate and HSN per product | Products and prices > product drawer | 18 %, HSN 4818 |
| Carton size (packs per carton) per SKU | Products and prices > SKU | 1 |
| Minimum order (per customer type: value; per SKU: quantity) | Commerce settings / SKU | Rs 0; 1 pack |
| Coupons | Promotions > Coupons | none |
| Cashback rules: percent, per customer type, max per order, minimum order, wallet expiry days, on / off | Promotions > Cashback | 5 %, all types, no max, Rs 0, 365 days, off until switched on |
| Return window (days after delivery) | Commerce settings > Returns | 7 |
| Return reasons (list, each: needs photo yes / no) | Commerce settings > Return reasons | Wrong item, Damaged in transit, Quality issue, Ordered by mistake, Other |
| Credit days and credit limit per customer | Customers > customer drawer (default per customer type in Commerce settings) | 0 days, Rs 0 (no credit) |
| Invoice series per financial year (prefix, start number) | Commerce settings > Numbering | DFI/YY-YY/0001 |
| Delivery methods (Own vehicle, Courier, Customer pick-up ...) | Commerce settings > Delivery methods | Own vehicle, Courier, Pick-up at godown |
| Delivery areas and charges (by town / pincode, free above an amount) | Commerce settings > Delivery areas | Kanchipuram free; others Rs 0 until set |
| Stock locations | Commerce settings > Locations | Kanchipuram godown |
| Low-stock level and reorder quantity per SKU per location | Inventory > SKU | 20 / 0 |
| Reserve stock when (order confirmed / packing starts) | Commerce settings > Inventory | order confirmed |
| Approval thresholds and approver roles (section 2) | Commerce settings > Approvals | section 2 defaults |
| Seller details on invoices (name, GSTIN, state, address, bank details, signature line) | Commerce settings > Invoice | from site settings; GSTIN required before the first invoice |
| Round-off on invoices (to the rupee) | Commerce settings > Invoice | on |
| Payment methods enabled (Cash, UPI, Bank transfer, Cheque, Credit, Razorpay link) | Commerce settings > Payments | all but Razorpay |
| Order sources (Phone, WhatsApp, Walk-in, Referral, B2B visit, Other) | Commerce settings > Lists | as listed |
| Commerce on / off (menu and API) | Commerce settings | off on live until launch |

---

## 4. Data model

All tables InnoDB, utf8mb4, DATETIME in UTC, money DECIMAL(12,2), quantities INT (packs). `emp_id` columns are
VARCHAR(20). "(c)" = changed existing table, "(n)" = new.

### 4.1 Access
| Table | Columns | Keys / indexes |
|---|---|---|
| roles (n) | role_id INT AI, name VARCHAR(60), description VARCHAR(255), is_builtin TINYINT, created_by, created_at, updated_by, updated_at | PK role_id; UNIQUE name |
| role_permissions (n) | role_id, section VARCHAR(30), can_view, can_create, can_edit, can_approve, can_delete TINYINT | PK (role_id, section); FK role_id ON DELETE CASCADE |
| admin_users (c) | + role_id INT NULL; `role` ENUM kept until phase 1 is live, then dropped | FK role_id; INDEX role_id |

### 4.2 Settings and lists
| Table | Columns | Keys |
|---|---|---|
| commerce_settings (n) | setting_key VARCHAR(60), value VARCHAR(500), value_type (int / decimal / bool / text / json), description, updated_by, updated_at | PK setting_key |
| customer_types (n) | type_key VARCHAR(20), label, sort_order, min_order_value, default_credit_days, default_credit_limit, is_active | PK type_key |
| return_reasons (n) | reason_id INT AI, label, needs_photo, sort_order, is_active | PK |
| delivery_methods (n) | method_id INT AI, label, needs_tracking_no, is_active, sort_order | PK |
| delivery_areas (n) | area_id INT AI, label, towns TEXT (or pincodes), charge, free_above, is_active | PK |
| locations (n) | location_id INT AI, name, address, is_active | PK |
| number_series (n) | series_key VARCHAR(30) (e.g. `DFO-26`, `DFI-2026-27`), last_no INT | PK series_key |

### 4.3 Products and prices
| Table | Columns | Keys |
|---|---|---|
| products (c) | + hsn_code VARCHAR(8) DEFAULT '4818', + gst_rate DECIMAL(5,2) DEFAULT 18.00 | |
| skus (n, demo exists) | sku_code VARCHAR(30), product_id, pack_label, packs_per_carton INT DEFAULT 1, min_order_qty INT DEFAULT 1, base_price DECIMAL(10,2) NULL, barcode VARCHAR(40) (defaults to sku_code), is_active, created_by/at, updated_by/at | PK sku_code; UNIQUE barcode; INDEX product_id; FK product_id |
| sku_prices (n, demo differs) | sku_code, type_key, price DECIMAL(10,2), updated_by, updated_at | PK (sku_code, type_key); FKs |
| price_changes (n) | change_id AI, sku_code, type_key NULL (= base), old_price, new_price, emp_id, changed_at | INDEX (sku_code, changed_at) |

### 4.4 Inventory
| Table | Columns | Keys |
|---|---|---|
| stock_movements (n, demo differs) | move_id BIGINT AI, sku_code, location_id, stock_kind (good / returned / damaged), move_type (receipt, sale_out, return_in, restock, adjust, write_off, transfer_in, transfer_out, delivery_failed_in), delta INT, ref_type (order / return / approval / manual), ref_id, note, emp_id, created_at | PK; INDEX (sku_code, location_id, stock_kind); INDEX (ref_type, ref_id); INDEX created_at |
| stock_reservations (n) | reservation_id AI, order_id, sku_code, location_id, qty, status (active / consumed / released), created_at, closed_at | PK; INDEX (sku_code, location_id, status); INDEX order_id |
| sku_location_settings (n) | sku_code, location_id, low_level INT, reorder_qty INT | PK (sku_code, location_id) |

Stock on hand = SUM(delta) per sku, location, kind. **Available = good on hand - active reservations.** No stock
column is ever typed in; a nightly check compares sums and logs a warning if a negative appears.

### 4.5 Customers and wallet
| Table | Columns | Keys |
|---|---|---|
| customers (n, demo differs) | customer_id INT AI, name, business_name, type_key, phone (+91 format), phone_digits CHAR(10), email, gstin, source, lead_id NULL, credit_days, credit_limit, is_active, created_by, created_at, updated_by, updated_at | PK; UNIQUE phone_digits; INDEX email; INDEX type_key; FK lead_id |
| customer_addresses (n) | address_id AI, customer_id, label, line1, line2, town, district, state_code CHAR(2), pincode, is_default_billing, is_default_shipping | PK; INDEX customer_id |
| customer_notes (n) | note_id AI, customer_id, note TEXT, follow_up_on DATE NULL, done_at NULL, emp_id, created_at | PK; INDEX (customer_id); INDEX (follow_up_on, done_at) |
| wallet_entries (n, demo differs) | entry_id AI, customer_id, kind (cashback / refund / used / goodwill / expiry / reversal), amount, expires_at NULL, ref_type, ref_id, approval_id NULL, emp_id, created_at | PK; INDEX (customer_id, created_at); INDEX expires_at |

### 4.6 Orders, payments, invoices
| Table | Columns | Keys |
|---|---|---|
| orders (n, demo differs) | order_id AI, order_no, customer_id, type_key (price list used), source, status, payment_status, bill_* and ship_* snapshot (name, business, gstin, address lines, town, state_code, pincode, phone), place_of_supply CHAR(2), delivery_method_id, delivery_area_id, delivery_charge, subtotal, discount, manual_discount, taxable, cgst, sgst, igst, round_off, total, wallet_used, amount_due, coupon_code, credit_due_on DATE NULL, notes, version INT (optimistic lock), created_by, created_at, confirmed_at, packed_at, dispatched_at, delivered_at, cancelled_at, cancel_reason | PK; UNIQUE order_no; INDEX (status, created_at); INDEX customer_id; INDEX (payment_status, credit_due_on) |
| order_items (n) | line_id AI, order_id, sku_code, qty, unit_price, list_price, hsn, gst_rate, line_discount, taxable, cgst, sgst, igst, line_total | PK; UNIQUE (order_id, sku_code); FK order_id CASCADE |
| order_status_history (n) | id AI, order_id, from_status, to_status, emp_id, note, created_at | PK; INDEX order_id |
| payments (n) | payment_id AI, order_id, method, amount, reference, status (received / bounced / refunded), received_on DATE, emp_id, created_at | PK; INDEX order_id |
| invoices (n) | invoice_id AI, invoice_no, fy CHAR(7), order_id, issued_at, totals snapshot columns, seller snapshot (name, gstin, address), cancelled_at, cancel_reason | PK; UNIQUE invoice_no; UNIQUE order_id (one live invoice per order) |
| coupon_redemptions (n) | id AI, coupon_code, order_id, customer_id, amount, created_at | PK; INDEX (coupon_code, customer_id) |

### 4.7 Packing and delivery
| Table | Columns | Keys |
|---|---|---|
| packing (n) | order_id, started_by, started_at, packed_by, packed_at, cartons INT, weight_kg | PK order_id |
| packing_scans (n) | id AI, order_id, sku_code, qty, emp_id, scanned_at | INDEX order_id |
| deliveries (n) | delivery_id AI, order_id, method_id, vehicle_or_courier, driver_name, tracking_no, status, dispatched_at, delivered_at, received_by, pod_note, attempt INT | PK; INDEX (status); INDEX order_id |

### 4.8 Returns, refunds, credit notes, approvals
| Table | Columns | Keys |
|---|---|---|
| returns (n, demo differs) | return_id AI, return_no, order_id, reason_id, reason_note, status, outcome (wallet / original / bank / replacement), requested_at, received_at, inspected_at, closed_at, emp_id | PK; UNIQUE return_no; INDEX (status); INDEX order_id |
| return_items (n) | return_id, sku_code, qty_requested, qty_received, qty_ok, qty_damaged, qty_missing | PK (return_id, sku_code) |
| refunds (n) | refund_id AI, return_id NULL, order_id, method, amount, status (pending_approval / paid / rejected), reference, approval_id NULL, credit_note_id NULL, emp_id, created_at | PK; INDEX order_id |
| credit_notes (n) | credit_note_id AI, credit_note_no, fy, invoice_id, return_id NULL, reason, taxable, cgst, sgst, igst, total, issued_at, emp_id | PK; UNIQUE credit_note_no; INDEX invoice_id |
| approvals (n) | approval_id AI, kind, section, ref_type, ref_id, amount, payload JSON, status (pending / approved / rejected / expired / withdrawn), requested_by, requested_at, decided_by, decided_at, note | PK; INDEX (status, kind); INDEX (ref_type, ref_id) |
| coupons, cashback_rules (n, demo differs) | coupons: + description, max_discount, per_customer_limit, type_keys (coupon_customer_types table), created_by. cashback_rules: rule_id, name, type_key NULL (all), pct, max_per_order, min_order, wallet_expiry_days, valid_from, valid_to, is_active | coupons PK code; cashback_rules PK rule_id |

---

## 5. Status flows, edit rules and stock

### 5.1 Order
`draft` -> `confirmed` -> `packing` -> `packed` -> `dispatched` -> `delivered`; `cancelled` from any state before
`delivered` (rules below). A delivered order is closed; changes after delivery go through Returns.

| Status | Edit items / prices / customer | Cancel | Stock |
|---|---|---|---|
| draft (saved, not confirmed) | everything | delete the draft | nothing |
| confirmed | items, quantities, prices, address, coupon | yes, reason required | reserve available stock (setting: at confirm) |
| packing | quantities down only; items only after "back to confirmed" (Orders edit) | yes, reason | reservations stay |
| packed | no; "unpack" (Packing edit) returns it to packing | yes, reason | reservations stay |
| dispatched | no | only with approval; the goods come back as a delivery-failed receipt | reservation consumed, sale_out movement |
| delivered | no | no (Returns) | - |
| cancelled | no | - | reservations released; after dispatch: delivery_failed_in when the goods are back |

Every change writes `order_status_history` and the audit log; edits use the `version` column so two people cannot
overwrite each other (the second gets "This order changed, reload").

### 5.2 Payment
`unpaid` -> `partly_paid` -> `paid`; `credit` (paid later, due on `credit_due_on`, shown overdue after it);
`refunded` / `partly_refunded`. Payments are recorded rows (cash, UPI, bank, cheque, credit, wallet, Razorpay link).
A credit order is refused when it would take the customer above the credit limit (or needs approval, section 2).

### 5.3 Packing
`to_pack` (confirmed orders) -> `picking` (pick list printed, by SKU and location) -> `packed` (every line scanned or
ticked, cartons and weight entered). A scan of a wrong SKU or too many packs is refused on screen.

### 5.4 Delivery
`ready` (packed) -> `out_for_delivery` (method, vehicle / courier, tracking no.) -> `delivered` (received by, note) or
`failed` (reason; re-attempt or back to godown, which puts the stock back with delivery_failed_in).

### 5.5 Return
`requested` (within the return window; outside it needs approval) -> `approved` / `rejected` -> `received` (packs
counted) -> `inspected` (per SKU: ok / damaged / missing) -> `refunded` or `replaced` -> `closed`.
Stock: ok -> return_in to `returned` (R); damaged -> return_in to `damaged`; later *restock* moves (R) to good, or
*write-off* (approval) removes damaged stock. Refund: credit note first (if invoiced), then wallet / original / bank.
Replacement: a new order at Rs 0 linked to the return (stock reserved like any order).

### 5.6 Approval
`pending` -> `approved` (the action runs) / `rejected` / `expired` / `withdrawn` (by the requester).

---

## 6. Numbering and GST

### 6.1 Numbers (from `number_series`, inside the same transaction as the document)
| Document | Format | Resets |
|---|---|---|
| Order | DFO-YYnnnn (calendar year, as the demo) | each calendar year |
| Tax invoice | DFI/YY-YY/nnnn (financial year April-March), max 16 characters as GST requires | each financial year |
| Credit note | DFC/YY-YY/nnnn | each financial year |
| Return | DFR-YYnnnn | each calendar year |
Numbers are never reused; a cancelled invoice keeps its number and is marked cancelled.

### 6.2 GST
- Seller state: Tamil Nadu (33). Place of supply = the shipping address state.
- Same state: CGST + SGST (half the rate each). Other state: IGST (the full rate). Decided per order from the state
  code, shown on the order before saving.
- Each line keeps its HSN, rate and tax amounts as they were on the day (snapshot): later price or rate changes never
  change an issued invoice.
- B2B (buyer has a GSTIN): GSTIN and state on the invoice. B2C: name and address.
- Discounts (coupon, manual) reduce the taxable value of the lines, spread by line value. Delivery charge is taxed at
  18 % (setting).
- Round-off to the rupee as a separate line (setting).
- The invoice is issued at dispatch (setting: or at confirm) and is the legal document; the order is not.
- Refund of an invoiced order: a credit note reverses the taxable value and tax of the returned packs before money or
  wallet credit goes out.
- GST report (phase 9): B2B and B2C summaries by rate and state, HSN summary, credit notes, ready for GSTR-1.

---

## 7. Audit log

Every action writes one `audit_log` row (existing table: emp_id, action, entity_type, entity_id, before_json,
after_json, created_at), in the same transaction as the change. No personal data beyond what the entity needs.

| Entity | Actions logged |
|---|---|
| role, role_permission | create, update (permission grid before / after), delete |
| admin_user | create, role_change, deactivate, reactivate |
| commerce_setting, list rows (customer types, reasons, methods, areas, locations) | create, update, delete |
| product (tax), sku, sku_price | create, update (old / new price), deactivate |
| stock | receipt, adjust, write_off, restock, transfer |
| order | create, update (diff of lines and totals), confirm, status change, cancel, reopen |
| payment | record, bounce, refund |
| invoice, credit_note | issue, cancel |
| packing, delivery | start, scan corrections, packed, dispatch, delivered, failed |
| return, refund | create, approve, reject, receive, inspect, refund, replace, close |
| customer | create, update, merge, deactivate, credit change, convert from lead |
| wallet | credit, debit, expiry, goodwill |
| coupon, cashback_rule | create, update, on / off |
| approval | request, approve, reject, expire, withdraw |
| export | every export of leads, orders, customers or reports (filters and row count) |

The audit log screen gets filters by section, entity and user, and a link from each row to the thing it is about.

---

## 8. Review of the demo code

| Part | Keep | Rewrite |
|---|---|---|
| SKU code scheme (DF037-M150) and JsBarcode labels / label sheet | keep | - |
| Stock as the sum of movements, (R) and damaged kinds | keep the idea | add location, ref_type / ref_id, reservations, typed move_type |
| `src/backend_routes/commerce.js` (one module for order rules, used by routes and seed) | keep the pattern | split into orders / pricing / tax / stock / returns modules with tests; add IGST, round-off, line tax snapshot, edit / cancel, payments |
| `src/shared/customerRules.js` (shared validation) | keep | read customer types from the database, not a constant |
| Admin screens (chips, stat cards, drawers, ReturnForm, NewCustomerDrawer, Operations cards) | keep the look and components | wire to permissions, approvals, new statuses |
| Routes in `Admin_server.js` | - | move to `Commerce_server.js` (and smaller files per area) with `{ section, action }` declarations |
| `commerce_0x_*.sql` migrations | - | **delete**: they say `USE dfresh_commerce` and contain demo data; replaced by section 9 |
| `scripts/commerce-seed.js` | keep as the start of the demo seed | extend; never runs unless DB_NAME = dfresh_commerce |
| Prices (one price per SKU, demo values) | - | price lists per customer type, price history, approval below list price |
| Invoice (printed from the order, order number) | layout as a starting point | real invoice table, DFI numbering, seller snapshot, IGST, credit notes |
| Returns (saved and refunded in one step) | form layout | full status flow with inspection, refunds table, approvals, credit notes |
| Wallet (no kind, no expiry) and cashback backfill in a migration | - | wallet kinds, expiry, refund vs cashback; no backfill in migrations |
| Roles: viewer / editor / admin rank checks | - | roles + permissions (section 1) |
| Demo customer notes set by hand in the database | - | in the seed script |

---

## 9. Migration plan

- New migrations follow the site's rule: `database/migrations/YYYYMMDD_commerce_<name>.sql`, `USE dfresh;`, applied
  in name order, once per database, additive (no DROP of live data; a column is dropped only in a later migration after
  the code stops using it). They must run on a copy of the live database before they go live.
- Migrations contain **structure and reference defaults only** (built-in roles and their permissions, customer types,
  return reasons, delivery methods, the Kanchipuram location, Commerce settings defaults, number series rows).
  **No demo data**: no customers, orders, stock, prices or coupons.
- Existing admin users keep working: `admin` -> Admin, `editor` -> Sub-admin, `viewer` -> the *Viewer (read only)*
  role (migration sets role_id; the old column stays until the next release reads only role_id).
- The demo branch's `commerce_0x_*.sql` files are removed. `dfresh_commerce` is rebuilt: a fresh copy of `dfresh` +
  the new migrations + **`scripts/commerce-demo-seed.js`** (refuses unless DB_NAME = dfresh_commerce), which creates
  the demo prices, stock, customers, orders, returns, coupons and wallet history through the same code as the admin.
- Commerce stays off on live (`commerce_enabled` = off) until sir approves launch; the migrations can go live earlier
  without changing anything visible.
- Each phase ends with: migrations applied to a copy of live, `db:reset` on dev, the API test for 403 on every route,
  and the demo checklist.

---

## 10. Build phases and demo checklists

Each phase is a separate task file, ends with tests, a commit and a demo. A phase starts only after the previous demo.

**Phase 1 - Foundation** (roles, permissions, approvals engine, settings, numbering, audit)
- [ ] Setup > Roles: create *Warehouse* with Inventory and Packing only; a Warehouse user sees only those menus.
- [ ] The same user calling an Orders API gets 403 (shown with a test).
- [ ] Admin cannot remove his own Admin role; the last Admin cannot be deactivated.
- [ ] Commerce settings page with all section 3 values and defaults; a change shows in the audit log.
- [ ] Approvals queue shows a test request; the requester cannot approve it.

**Phase 2 - Products and pricing**
- [ ] HSN and GST rate on a product; SKU with carton size and minimum quantity.
- [ ] Price list grid SKU x customer type; Excel export and import with a dry run.
- [ ] Price history for one SKU; a price below list asks for approval.

**Phase 3 - Orders**
- [ ] New order for a Hotel customer uses the Hotel prices; another state's address gives IGST.
- [ ] Draft, confirm (stock reserved), edit while confirmed, cancel with a reason (stock released).
- [ ] Record a part payment; credit order beyond the limit is refused / sent for approval.
- [ ] Two people editing the same order: the second gets "This order changed, reload".

**Phase 4 - Inventory**
- [ ] Goods receipt, adjustment, write-off with approval; available vs on hand vs reserved per SKU.
- [ ] Low-stock list and reorder quantities; stock report by location.

**Phase 5 - Packing and delivery**
- [ ] Pick list, scan-to-pack with a wrong-SKU refusal, packed with cartons.
- [ ] Dispatch issues the invoice DFI/26-27/0001 (CGST/SGST or IGST) and takes stock out.
- [ ] Delivered with received-by; a failed delivery brings the stock back.

**Phase 6 - Returns**
- [ ] Return inside the window; outside the window needs approval.
- [ ] Receive, inspect (ok / damaged / missing), stock to (R) / damaged.
- [ ] Refund above the threshold waits for approval; credit note DFC issued before the wallet credit.
- [ ] Replacement order at Rs 0.

**Phase 7 - Promotions**
- [ ] Coupon limited to Hotels and once per customer; max discount.
- [ ] Cashback 5 % for Home, 3 % for Hotels, max Rs 500 per order, expiring after 90 days.
- [ ] Wallet used on an order; expired cashback removed by the nightly job.

**Phase 8 - Customers**
- [ ] Several addresses (billing / shipping) per customer; duplicate check by phone and e-mail.
- [ ] Notes timeline and follow-ups list ("due today", "overdue").
- [ ] Credit days / limit and an overdue list; merge two duplicates.

**Phase 9 - Reports**
- [ ] Sales by day / customer type / SKU; GST report (B2B, B2C, HSN, credit notes) for a month.
- [ ] Stock valuation, slow movers, returns by reason, wallet liability; every report exports to Excel.

**Phase 10 - Notifications**
- [ ] Order confirmed / dispatched / delivered e-mails in the customer's language (ui_text), through the outbox.
- [ ] Approval requests e-mailed to approvers; daily low-stock and follow-up digest to Operations.
- [ ] WhatsApp messages if sir chooses a provider (open question 4).

---

## 11. Open questions for sir

Only these need a decision; everything else is a setting with the default above.
1. **Seller on the invoice.** Which legal entity issues the tax invoice (Dolluz Corporation (OPC) Pvt Ltd?), and its
   GSTIN (Settings `gstin` is still empty). No invoice can be issued without it.
2. **E-invoicing and e-way bills.** Is Dolluz above the e-invoice turnover limit (IRN / QR code on B2B invoices), and
   should e-way bills (consignments above Rs 50,000) be generated from the admin or by hand on the portal?
3. **Cashback and wallet under GST.** Should cashback be treated as a discount on the next invoice (reduces the
   taxable value) or as a payment method? This changes the GST figures; please confirm with the accountant.
4. **Customer notifications channel.** E-mail only, or also WhatsApp / SMS through a paid provider (which one)?
5. **Accounting software.** Do sales, credit notes and payments need to go into Tally or Zoho (export format)?
6. **Payments.** Record payments by hand only, or also send Razorpay payment links (needs a Razorpay account)?
