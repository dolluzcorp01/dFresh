# Section 16 - Reports and dashboard: click test

For Pavithran, before Shoban freezes section 16. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on. Sign in as **Pavithran** (Admin, sees cost).
- Other people, in a second browser: **Kumar M** (Supervisor, no See cost, Kanchipuram only), **Divya N** (Sales, no
  Export on Reports), **Murugan S** (Warehouse: no Reports).
- The figures below are the demo data; with other data the screens say the same with your figures.

## Part A - Home > Dashboard

1. **Home > Dashboard.**
   Chips "Every tile follows your godowns", "Costs only with See cost", "A tile opens its page". Tiles: Sales today
   (this month, last month), Orders to send (to pack, to deliver, in hand), Money owed to us (overdue, we owe), Stock at
   cost (packs without a cost), Cash to collect, Products on the website, Waiting for you.
2. Click each tile.
   Sales and purchases, Packing, Money owed, Stock report, Cash on delivery, Products, Approvals.
3. Under the tiles: Top 5 products this month (packs and value) with "Report", and the Newest alerts with "All".
4. Under them, Today's work: the cards of the day (to pick, to pack, out for delivery, returns...), each opens its list.
5. As Kumar: no Stock at cost tile (no See cost); his figures are Kanchipuram only. As Murugan: only the tiles of his
   sections.

## Part B - Sales and purchases

6. **Reports > Sales and purchases.**
   Chips "Sale = invoiced value without GST, less credit notes", "Margin only where the cost is known", "Financial year
   from April". Period (This month, Last month, This quarter, This year, Choose dates), Godown, CSV, Print. Figures:
   Sales in the period (invoices, credit notes), Orders in hand, Margin.
7. Tabs: By day or month, By product, By category, By customer, By customer type, By salesperson, By godown, Purchases,
   Discounts given, Returns, Expenses and profit. Click each.
   A chart of the top values and the table with the total; the table's total equals Sales in the period.
8. Period This year: By day or month shows months.
9. Choose dates from a date: only sales from then.
10. Make an invoice today and a Rs 100 price-correction credit note.
    Sales goes up by the invoice value without GST, then down by 100; credit notes show 100 more; orders in hand drop by
    the invoiced order.
11. **CSV** on By product.
    dfresh-sales-product-FROM-to-TO.csv: Product, Packs, Sales, Margin.
12. **Print**: only the table prints.
13. Purchases (needs View on Suppliers and buying): by supplier and item, from the supplier bills.
14. Discounts given: offers, coupons, manual discounts, wallet, free items.
15. Returns: "Returns Rs ... = N% of sales in the period".
16. Expenses and profit (See cost and View on Expenses): "Profit before tax: Rs ...". Sales less cost less expenses;
    GST that can be claimed is not an expense.

## Part C - Stock

17. **Reports > Stock.**
    Figures: Stock at cost (packs with no cost yet), Near expiry, Expired. Tabs Value, Ageing, Expiry, Slow movers,
    Write-offs and wastage.
18. Value: gold bars of the 10 largest, then "Stock value by shelf": per godown Good, Packed (not invoiced), On the
    road, QC hold, Damaged, Returned, Rejected, Disputed, In production, Total. Then "Stock value" by godown and
    category (category names, or the shelf for stock off the Good shelf), with a Total row.
19. Pack an order without invoicing it: its value shows under Packed, not invoiced.
20. Ageing: 0-30, 31-60, 61-90, over 90 days, date not known. Expiry: batches expired or near. Slow movers: no sale in
    60 days. Write-offs and wastage: by month.
21. As Kumar (no See cost): Value says "Cost is hidden ... Ageing, Expiry and Slow movers show the packs"; every money
    cell elsewhere reads "hidden", never Rs 0; charts say "values hidden (See cost)".

## Part D - Money owed

22. **Reports > Money owed.** Tabs Customers, Suppliers, Collections.
23. Customers: by days overdue (Not due, 1-30, 31-60, 61-90, Over 90, Owes), only customers with a balance, the
    largest first, by name; the total equals Money > Receipts "Customers owe".
24. Suppliers: bills, due date, days late, MSME with its day count; a red box when a Micro or Small supplier is past
    45 days.
25. Collections: received and bounced by month.

## Part E - GST and delivery

26. **Reports > GST and delivery.** Gold bars of the net GST by month (red when input is larger), then GST by month,
    every month back to April: sales without GST, output GST, input GST (bills), net payable. Under it: "Net payable
    before credit carried forward ... Input GST includes the GST on expenses that can be claimed: each expense and the
    month's total are on Money > GST > GSTR-1 / GSTR-3B data (ITC on expenses) ...".
27. Record a Rs 4,500 rent expense with 18% GST and a GSTIN (Money > Expenses).
    This month's input GST goes up by Rs 810. Money > GST > GSTR-1 / GSTR-3B data, this month: the row "Input: ITC on
    expenses (1 expense)" shows Rs 810, and the card "ITC on expenses" lists the rent with Month total Rs 810.
28. Delivery: by driver, by delivery area, trips and pay-on-delivery cash.

## Part F - Who sees what

29. As Divya (own customers only, where the role says so): Sales shows only her customers.
30. Divya without Export: no CSV button; the address of the CSV answers "This needs export on Reports" (the old Excel
    export too).
31. As Kumar: Godown lists only Kanchipuram; a report for another godown answers "You do not work at that godown".
32. As Murugan: "Reports need View on Reports".

## Part G - Layout and phone

33. Each report at 390 px: the filters stack, the table scrolls inside its box, nothing scrolls sideways.
34. Old links (Reports > tabs of the old page) still open; the menu opens the new pages.
