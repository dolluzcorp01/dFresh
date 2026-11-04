# Section 4 - Production: click test

For Pavithran, before Shoban freezes section 4. Click every step by hand on the stage2 admin and tick it.
Each step says what to do and what you should see. If you see something else, write down the step number and what
happened, and stop there.

## Before you start

- Use the stage2 admin with Commerce switched on (Admin > Settings > Switches > Turn on).
- Sign in as **Pavithran** (Admin). Steps that need another person say so: **Shoban** (Super admin) in a second
  browser, a **Supervisor** (a role with View, Create, Edit and Approve on "Production"), a **Warehouse** person (the
  built-in Warehouse role: View and Create on Production), a **Sales** person (no Production) and someone who works
  **only at the Chennai godown**. Add them in Admin > Users and security > Staff if they are not there; any real
  dAdmin employees will do.
- "Today" means the date you test on. Anything that "waits for approval" appears in Home > Approvals; another person
  approves it there. Nobody approves their own.
- First make what production uses (it is not in the demo data). If you did the Section 3 click test, the raw
  materials are there already:
  - Masters > Catalogue > Raw materials: `RM-PR2` "Jumbo parent reel, 2-ply" in **kg**, `RM-FILM` "Packing film" in
    **kg**, `RM-CORE` "Paper cores" and `RM-CTN` "Shipping cartons" in **pieces**.
  - Put about 900 of each into Good stock at Kanchipuram through Purchase (a PO, Goods in, Quality check), so each has
    an average cost.

## Part A - Rights and menu

1. **Admin > Users and security > Roles.** Open Supervisor, then Warehouse, then Delivery.
   The row **Production** is under "Suppliers and buying". Warehouse: View and Create. Delivery: nothing.
2. **The menu, Production group:** Recipes, Production runs, Wastage open their pages; Job work still shows "Later".
   Purchase > Quality check is also open to people with Production rights only.
3. Sign in as the **Sales** person and type `/admin/recipes` in the address bar.
   "Not for this role": Sales has no Production right, and the Production group is not in the menu.

## Part B - Machines

4. **Production > Production runs**, tab **Machines**, **New machine**: `Napkin folder 1`, Kanchipuram, tick Napkins,
   1200 packs per hour, Working. Save. Then `Rewinder (rolls)` (Rolls and Kitchen, 600), `Towel folder` (Towels, 700),
   and at Chennai `Napkin folder C` (Napkins, 800), State **Stopped** with no reason: Save.
   The stopped one is refused: "Say why it is stopped." Type `Waiting for a new folding blade`, Save.
   The list shows each machine with its godown, what it makes as pills, packs per hour and Working / Stopped (with why).
5. A second machine called `napkin folder 1`: refused, "Another machine has this name." No category ticked: "Tick at
   least one."

## Part C - Recipes

6. **Production > Recipes.** Two cards: "Made packs with a recipe" (empty) and "Made packs with no recipe" (every
   Made or Both pack, with Add recipe). Chips: one recipe per made pack, dated versions, made cost.
7. **Add recipe** on DF001-M100 (Table Napkins 20x20). One batch makes `400`. Materials: first `RM-FILM` 3, then
   `RM-PR2` 180, `RM-CTN` 10. Wastage 3, labour 1.10, power 0.40. Save recipe.
   Refused under the first material: "The first material is the main one (the reel, in kg)". Put RM-PR2 first.
   One batch `100` when a carton holds 24 (or 40): "Make it whole cartons: a multiple of ..." Use a multiple. Save.
   As you type, the blue box shows the made cost per pack = materials (average costs, with the 3% wastage) + labour
   + power. Saved: "Runs of DF001-M100 can be planned now"; the pack moves to "with a recipe" with v1 from today.
8. Open it again. **Made cost per pack** and **Standard cost in Products** show. Press **Use Rs .. as standard cost**.
   If that is lower than the standard cost (or the average cost when none is set), it waits for a second Admin
   (Approvals); otherwise "Standard cost set" and Masters > Prices shows the margin on it.
9. **Change the recipe**: reel 170, starts **today**: Save as v2. Refused: "A change starts tomorrow at the earliest".
   Starts tomorrow: Save as v2. It waits for approval ("Waiting for ..."); the list shows v1 in use and v2 waiting.
   Shoban approves it in Approvals: the list shows v2 "from" tomorrow; runs today still use v1.
10. **Add recipe** on a roll (DF016-R1): Copy materials from another recipe; the materials fill in.
11. A user without See cost opens a recipe: no made cost, no standard cost ("hidden"), no Use as standard cost.

## Part D - Plan and start a run

12. **Production runs, Plan a run**: DF001-M100, Kanchipuram, 400 packs, **Napkin folder C**, no operator. Plan the
    run. Red: Napkin folder C is at another godown, not Kanchipuram; "Who runs the machine."
13. Machine **Rewinder (rolls)**: "does not make table napkins". Napkin folder 1 with the **Chennai-only** person as
    operator: "does not work at Kanchipuram". The Warehouse person as operator: planned as DFM/26-27/0001 (the next
    number). The box under the form showed what it needs (reel 185.4 kg, film 3.09 kg, 11 cartons) against what is
    usable at Kanchipuram, and the hours on the machine.
14. Plan another: DF001-M100, **2000** packs. The box shows the reel needed in red against what is usable, "Not enough
    material today ... You can plan it". Plan it: warning "it cannot start until it is in". Open it: **Start** is
    refused, "Not enough material ... Goods in QC hold cannot be used." Cancel this run (step 26 way).
15. Open DFM/26-27/0001 (400): **Start: issue materials**. "Started, batch M<machine>-<yymmdd>"; the materials left
    stock (Inventory > Stock: the reel at Kanchipuram went down by 185.4 kg). The run moves to the Running tab.
16. Plan DF001-M100 again on the same machine and start it: refused, the machine "is running DFM/26-27/0001".
17. Machines tab: set Napkin folder 1 to Stopped with a reason: refused, a run is going on it.

## Part E - Finish, wastage and production QC

18. Open the running run. Finish form: packs made `396`, reel used `195`, the rest as issued, no reason. **Finish the
    run.** Red under Wastage reason: "Wastage is ..%, more than the 3% the recipe allows. Say why."
19. Reason **Machine jam**, trim kept 4. Finish. "Finished: 396 packs at Rs .. each"; the wastage waits for approval
    (more than 5% above the recipe: Approval rules); the packs are in QC hold; the 0.4 kg reel more than issued was
    taken from stock. The drawer shows "Used" (standard for 396 against used) and the wastage line with the approval.
20. **Purchase > Quality check**: the run is under "Production runs waiting for a check". Press **Check**: the run
    opens. Passed 390, Rejected 0, Save the check: "Passed + rejected must be 396."
21. Passed 380, Rejected 16: Save. 11 (3% of 396, rounded down) are a **normal loss**, written off at Rs 0, their
    cost in the passed packs; 5 are an **abnormal loss** at made cost, a write-off that waits for approval. The toast
    says the average cost before and after and what each passed pack carries. The run shows both lines.
22. Another person **rejects** that write-off in Approvals. The 5 packs come back to QC hold at their made cost; the
    run shows **Check again: 5 packs** (also on Quality check under "Check again").
23. Check again, Passed 3: the 3 go to stock at their made cost; 2 go as a new write-off for approval. Reject that one
    too: the run shows Check again 2 again (never stuck). Check again 2 passed: done.
24. **Production > Wastage**: the run, reel standard against used, wastage %, the reason and the approval; the
    totals: reel lost, trim kept, reel lost per machine. Approve the wastage in Approvals: the row says Approved.

## Part F - Less material, nothing made, QC hold off, labels

25. Start a new run (400) and finish it with the reel at **60%** of the recipe. A reason is asked for; choose **Less
    material used than the recipe (recount)**. "Waiting for approval. Nothing moves until it is signed: the packs,
    the material and the cost stay as they are." Inventory shows nothing moved; the run is still Running with
    "Finish waits for approval". The approval card is titled "Production: less material than the recipe".
    Reject it: the run says "Finish rejected by ..: count the packs and the material again". Finish again and approve
    it: now the packs are in QC hold and the rest of the reel is back in stock.
26. A planned run: **Cancel run** with no reason: "Give a reason." With `Order moved`: Cancelled, the number stays
    used. A running run has no cancel box.
27. Start a run and finish it with **0** packs made: "Nothing was made. Say why." With a reason it finishes and the
    wastage (100%) waits for approval.
28. Admin > Settings > Switches: switch off "Goods in wait in QC hold until checked" (a second Admin signs). Finish a
    run: "N packs are in stock (QC hold is off)" and the stock shows them at once. Switch it back on.
29. A finished run: **Print labels** opens Masters > Catalogue > Barcodes and labels, Print labels tab, with the pack
    ticked, Carton labels and the copies (packs passed / per carton).
30. **Plan from low stock** with nothing low: "Nothing to plan" (packs below their level with no recipe are named).
    Set DF001-M100's reorder level at Kanchipuram above its stock (Products, SKU, Stock tab) and press it again: a run
    for tomorrow on Napkin folder 1, twice the level less what is there or coming, in whole batches.

## Part G - Roles and the old Stock in

31. Sign in as the **Warehouse** person: Recipes is view only (no Save, "View only."), they can plan, start and
    finish a run, but the production QC box is not there.
32. **Inventory > Stock status, Stock in tab**: no "New stock in" button; a note says made packs come in through
    Production runs and bought goods through Goods in; the stock-ins of before are listed as they were.
33. Admin > Users and security > Audit log, screen Production: the recipe, machine and run changes are there with who
    and when.
34. On a phone (or the browser at 390 wide): Recipes, Production runs (list and a run), Wastage and Quality check have
    no sideways scroll; tables become cards.
