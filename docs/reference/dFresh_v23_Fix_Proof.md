# dFresh Back Office v23: before and after each fix

The same steps run on v22 (before) and v23 (after), from a fresh start, following the routes in your v22 recheck. TODAY in the file is 2026-10-28. Rs = rupees; messages are copied from the screen; figures are read from the data, not only from messages.

## A. Still partly fixed in v22 (13)

### F1. A new staff member with a big limit saved at once; scope widened at once
Fix: Adding someone who can sign, a higher limit or a wider godown scope waits for a second Admin.

Before (v22):
- Pavithran (Admin) adds NEW staff Arun K as Sub-admin, personal limit Rs 50,00,000, every godown: Arun K can sign in now Sub-admin at every godown. Name, e-mail and phone come from dAdmin.
- Arun now: active true, limit 5000000, waiting to be added false. Waiting: ["write_off: 4 packs Kitchen Towel 2ply, forklift damage","write_off: 10 Wall Dispensers not found at stock take","refund: Refund to Hotel Saravana for 2 damaged cartons","po: PO DFP/26-27/0044 to Velan Converters, 1,200 kg jumbo parent reel 2-ply","count_fix: Stock take ST-302, Pocket Hanky 4 short, Tissue 8 short"]
- A PO approval of Rs 86,400 is raised by Kumar. Can Arun sign it? YES (own limit)
- Arun listed as a signer on that card: true
- Pavithran widens Lakshmi P (Chennai) to "Every godown": Lakshmi P saved Can sign up to ₹ 5,000 at every godown.
- Lakshmi works at now: every godown. Waiting: []
- Shoban approves the waiting changes: nothing to approve (it was never raised) / nothing to approve (it was never raised)
- After: Arun active true; Lakshmi at every godown

After (v23), same steps:
- Pavithran (Admin) adds NEW staff Arun K as Sub-admin, personal limit Rs 50,00,000, every godown: Waiting for a second Admin Arun K as Sub-admin can sign Foundation rules, so a second Admin agrees first. Waiting for Shoban B.
- Arun now: active false, limit 5000000, waiting to be added true. Waiting: ["write_off: 4 packs Kitchen Towel 2ply, forklift damage","write_off: 10 Wall Dispensers not found at stock take","refund: Refund to Hotel Saravana for 2 damaged cartons","po: PO DFP/26-27/0044 to Velan Converters, 1,200 kg jumbo parent reel 2-ply","count_fix: Stock take ST-302, Pocket Hanky 4 short, Tissue 8 short","rule_change: Give Arun K access as Sub-admin at every godown, signs up to ₹ 50,00,000"]
- A PO approval of Rs 86,400 is raised by Kumar. Can Arun sign it? no: Arun K is waiting to be added (a second Admin approves the access) and cannot sign yet.
- Arun listed as a signer on that card: false
- Pavithran widens Lakshmi P (Chennai) to "Every godown": Lakshmi P saved Can sign up to ₹ 5,000 at Chennai (example). The wider godown scope waits for a second Admin: Waiting for Shoban B.
- Lakshmi works at now: Chennai (example). Waiting: ["rule_change: Lakshmi P: godowns Chennai (example) to every godown"]
- Shoban approves the waiting changes: Approved by Shoban B Widen the godowns a person works at (second Admin), ₹ 0. / Approved by Shoban B Add a person who can sign (second Admin), ₹ 0.
- After: Arun active true; Lakshmi at every godown

### F4. Bank rules beaten by overriding the rule itself
Fix: The company-bank, supplier-bank and rule-change rules can never be switched off or overridden.

Before (v22):
- Setup: Shoban adds SBI 123456789012, UPI dfresh@sbi: Waiting for approval It is not used on invoices until a second person signs it. Waiting for Pavithran V V. Approved by Pavithran V V Add or change a company bank account, or the default, ₹ 0.
- Shoban puts Pavithran on a 1-day leave today: Pavithran V V saved Can sign up to anything at every godown.  Leave now: {"by":"DZIND002","from":"2026-10-28","to":"2026-10-28"}
- (For the rest, Pavithran is set as really on leave in the data, so the override condition holds.)
- Shoban switches off rule "Add or change a company bank account", then overrides: Waiting for a second Admin switch "Add or change a company bank account, or the default" off. Until then the rule stays as it is. Nobody can sign it today: raise a limit or give a role Approve on Foundation and Setup. The other Admin is on leave or has left: you can override it with a reason in Approvals (it applies after 24 hours, and can be cancelled until then). | override offered: True | rule on now: False
- Same for the supplier-bank rule: Waiting for a second Admin switch "Change a supplier's bank account" off. Until then the rule stays as it is. Nobody can sign it today: raise a limit or give a role Approve on Foundation and Setup. The other Admin is on leave or has left: you can override it with a reason in Approvals (it applies after 24 hours, and can be cancelled until then). | override offered: True | rule on now: False
- Same for "Weaken an approval rule" itself: Always on A weaker rule always needs a second Admin. This one cannot be switched off. -> no request to override. Rule on: True
- Shoban alone changes the UPI to fraudster@okaxis: Bank account saved 1 change in the audit log. UPI used on invoices now: fraudster@okaxis
- Card for the UPI change offers an override: no card

After (v23), same steps:
- Setup: Shoban adds SBI 123456789012, UPI dfresh@sbi: Waiting for approval It is not used on invoices until a second person signs it. Waiting for Pavithran V V. Approved by Pavithran V V Add or change a company bank account, or the default, ₹ 0.
- Shoban puts Pavithran on a 1-day leave today: Not saved Fix the field marked in red. An Admin's leave is entered by that Admin, or starts at least 2 days ahead (2026-10-30). Leave now: null
- (For the rest, Pavithran is set as really on leave in the data, so the override condition holds.)
- Shoban switches off rule "Add or change a company bank account", then overrides: Always on Money goes to bank accounts: this rule can never be switched off. -> no request to override. Rule on: True
- Same for the supplier-bank rule: Always on Money goes to bank accounts: this rule can never be switched off. -> no request to override. Rule on: True
- Same for "Weaken an approval rule" itself: Always on A weaker rule always needs a second Admin. This one cannot be switched off. -> no request to override. Rule on: True
- Shoban alone changes the UPI to fraudster@okaxis: Waiting for approval The account stays as it is until a second person signs the change. Nobody can sign it today: a bank change waits for a second Admin and is never overridden. UPI used on invoices now: dfresh@sbi
- Card for the UPI change offers an override: false

### PR1. Lowest allowed price 38 to 1 and price 30 in one save
Fix: Lowering the floor or margin floor waits; prices are checked against the old floor.

Before (v22):
- DF001-M100 on Shop: list Rs 48, lowest allowed price Rs 38, margin floor 10%.
- Pavithran (one Admin) lowers the lowest allowed price 38 to 1 and the price to Rs 30 in one save: Saved 2 changes.
- Lowest allowed price now: 1; Shop list now: 30; waiting: ["write_off: 4 packs Kitchen Towel 2ply, forklift damage","write_off: 10 Wall Dispensers not found at stock take","refund: Refund to Hotel Saravana for 2 damaged cartons","po: PO DFP/26-27/0044 to Velan Converters, 1,200 kg jumbo parent reel 2-ply","count_fix: Stock take ST-302, Pocket Hanky 4 short, Tissue 8 short"]
- 100 packs for a Shop customer, unit price without GST: 28
- An order line at Rs 28 is checked against floor: []
- 1b. Pavithran lowers only the lowest allowed price 38 to 1 (price kept): Saved 0 changes.
- Lowest allowed price now: 1; waiting floor change: []
- Shoban approves: nothing to approve (it was never raised) Lowest allowed price now: 1
- Pavithran lowers the margin floor to 0%: Saved Price below cost plus the margin floor needs approval above 0%. Margin floor now: 0%

After (v23), same steps:
- DF001-M100 on Shop: list Rs 48, lowest allowed price Rs 38, margin floor 10%.
- Pavithran (one Admin) lowers the lowest allowed price 38 to 1 and the price to Rs 30 in one save: Not saved Fix the field marked in red. Below the lowest allowed price (₹ 38.00 without GST).
- Lowest allowed price now: 38; Shop list now: 48; waiting: ["write_off: 4 packs Kitchen Towel 2ply, forklift damage","write_off: 10 Wall Dispensers not found at stock take","refund: Refund to Hotel Saravana for 2 damaged cartons","po: PO DFP/26-27/0044 to Velan Converters, 1,200 kg jumbo parent reel 2-ply","count_fix: Stock take ST-302, Pocket Hanky 4 short, Tissue 8 short"]
- 100 packs for a Shop customer, unit price without GST: 45
- An order line at Rs 28 is checked against floor: ["DF001-M100 at ₹ 28.00 is below its lowest allowed price ₹ 38.00"]
- 1b. Pavithran lowers only the lowest allowed price 38 to 1 (price kept): Saved 0 changes. Lowering the lowest allowed price waits for a second Admin: Waiting for Shoban B.
- Lowest allowed price now: 38; waiting floor change: ["rule_change: DF001-M100: lowest allowed price ₹ 38.00 to ₹ 1.00"]
- Shoban approves: Approved by Shoban B Lower the lowest allowed price (second Admin), ₹ 0. Lowest allowed price now: 1
- Pavithran lowers the margin floor to 0%: Waiting for a second Admin limit from 10% to 0%. Until then the rule stays as it is. Waiting for Shoban B. Margin floor now: 10%

### L1. PO amendment not counted with the supplier total
Fix: Amendments count in the supplier running total.

Before (v22):
- PO approval above Rs 50,000. 1. Kumar raises a PO to Velan Converters, 400 kg at Rs 72 (Rs 28,800): DFP/26-27/0045 raised ₹ 28,800 without GST needs no approval. It is ready to print or mail to Velan Converters.
- Next day Kumar raises 200 kg (Rs 14,400) to the same supplier: DFP/26-27/0046 raised ₹ 14,400 without GST needs no approval. It is ready to print or mail to Velan Converters.
- DFP/26-27/0045 open Rs 28800, DFP/26-27/0046 open Rs 14400
- Kumar amends DFP/26-27/0046 to 650 kg (Rs 46,800); with DFP/26-27/0045 the supplier total is Rs 75,600: Saved as Rev 2 Rev 2 is ready to print or mail. Rev 1 stays in the history.
- DFP/26-27/0046 now: open, Rev 2, value Rs 46800; can goods come in against the new qty: 650; waiting: ["po: PO DFP/26-27/0044 to Velan Converters, 1,200 kg jumbo parent reel 2-ply"]

After (v23), same steps:
- PO approval above Rs 50,000. 1. Kumar raises a PO to Velan Converters, 400 kg at Rs 72 (Rs 28,800): DFP/26-27/0045 raised ₹ 28,800 without GST needs no approval. It is ready to print or mail to Velan Converters.
- Next day Kumar raises 200 kg (Rs 14,400) to the same supplier: DFP/26-27/0046 raised ₹ 14,400 without GST needs no approval. It is ready to print or mail to Velan Converters.
- DFP/26-27/0045 open Rs 28800, DFP/26-27/0046 open Rs 14400
- Kumar amends DFP/26-27/0046 to 650 kg (Rs 46,800); with DFP/26-27/0045 the supplier total is Rs 75,600: Saved as Rev 2 The value went up to ₹ 46,800 (with ₹ 1,15,200 of other orders to this supplier in the last 3 days), so it waits for approval again. If it is rejected, Rev 1 stays in force. Waiting for Shoban B.
- DFP/26-27/0046 now: waiting, Rev 2, value Rs 46800; can goods come in against the new qty: 200; waiting: ["po: PO DFP/26-27/0044 to Velan Converters, 1,200 kg jumbo parent reel 2-ply","po: PO DFP/26-27/0046 Rev 2 to Velan Converters: ₹ 14,400 to ₹ 46,800"]

### L1 (payees). Payee look-alikes recorded; a different R.V. Traders refused
Fix: Your choice "both": PAN (or the PAN in the GSTIN) is the key, and every new payee is approved once.

Before (v22):
- Kumar: new payee "Ravi Traders" Rs 8,000 (PAN AABCR1234K): DFX/26-27/0007 recorded ₹ 8,000.00 Vehicle repair.  [status: Ravi Traders done]
- Shoban approves: nothing to approve (it was never raised)
- Look-alike "RaviTraders Co" Rs 8,000, ticked new: Waiting for approval Above ₹ 10,000. With 1 more in the last 3 days (₹ 8,000), the total is ₹ 16,000. Waiting for Anitha R.  [status: RaviTraders Co waiting]
- Look-alike "Raavi Trading Co" Rs 8,000, ticked new: Waiting for approval Above ₹ 10,000. With 2 more in the last 3 days (₹ 16,000), the total is ₹ 24,000. Waiting for Anitha R.  [status: Raavi Trading Co waiting]
- Look-alike "Sri Ravi Trading" with Ravi Traders' PAN AABCR1234K: Not saved Fix the field marked in red. Looks like "Raavi Trading Co" on the list. Pick it, so one payee is never two. [status: Raavi Trading Co waiting]
- A genuinely different "R.V. Traders" Rs 3,000, PAN AAFFR5678M: Not saved Fix the field marked in red. Looks like "Ravi Traders" on the list. Pick it, so one payee is never two. [status: Raavi Trading Co waiting]
- "Ravi Traders" again (now on the list), Rs 2,000: Waiting for approval Above ₹ 10,000. With 3 more in the last 3 days (₹ 24,000), the total is ₹ 26,000. Waiting for Anitha R.  [status: Ravi Traders waiting]
- "Ravi Traders" with a different PAN AAAPZ9999Q: Waiting for approval Above ₹ 10,000. With 4 more in the last 3 days (₹ 26,000), the total is ₹ 28,000. Waiting for Anitha R.  [status: Ravi Traders waiting]

After (v23), same steps:
- Kumar: new payee "Ravi Traders" Rs 8,000 (PAN AABCR1234K): Waiting for approval New payee (PAN AABCR1234K): every new payee is approved once. Waiting for Anitha R.  [status: Ravi Traders waiting]
- Shoban approves: Approved by Shoban B New payee (approved once) and above the limit, ₹ 8,000.
- Look-alike "RaviTraders Co" Rs 8,000, ticked new: Waiting for approval New payee, no tax ID: every new payee is approved once. With 1 more in the last 3 days (₹ 8,000), the total is ₹ 16,000. Waiting for Anitha R.  [status: RaviTraders Co waiting]
- Look-alike "Raavi Trading Co" Rs 8,000, ticked new: Waiting for approval New payee, no tax ID: every new payee is approved once. With 2 more in the last 3 days (₹ 16,000), the total is ₹ 24,000. Waiting for Anitha R.  [status: Raavi Trading Co waiting]
- Look-alike "Sri Ravi Trading" with Ravi Traders' PAN AABCR1234K: Not saved Fix the field marked in red. PAN AABCR1234K is "Ravi Traders" on the list. Pick it: one tax ID is one payee. [status: Raavi Trading Co waiting]
- A genuinely different "R.V. Traders" Rs 3,000, PAN AAFFR5678M: Waiting for approval New payee (PAN AAFFR5678M), looks like "Ravi Traders" on the list: every new payee is approved once. With 3 more in the last 3 days (₹ 24,000), the total is ₹ 27,000. Waiting for Shoban B.  [status: R.V. Traders waiting]
- "Ravi Traders" again (now on the list), Rs 2,000: Waiting for approval Above ₹ 10,000. With 4 more in the last 3 days (₹ 27,000), the total is ₹ 29,000. Waiting for Shoban B.  [status: Ravi Traders waiting]
- "Ravi Traders" with a different PAN AAAPZ9999Q: Not saved Fix the field marked in red. "Ravi Traders" on the list has PAN AABCR1234K. A different PAN is a different payee: give their own name and tick New payee. [status: Ravi Traders waiting]

### PD2. Rejecting the abnormal loss loses its cost
Fix: Your choice: the packs go to QC hold at cost.

Before (v22):
- Before: DF037-M150 good stock 28 at Rs 50 (value Rs 1400). Run DFM/26-27/0003 makes 240, run cost Rs 14138.4.
- QC: 200 pass, 40 rejected: Checked 200 packs into stock (average cost ₹ 50.00 to ₹ 59.62); each passed pack carries ₹ 60.97 (the run cost over 200 packs); 7 rejected within the 3% allowed: normal loss, written off at Rs 0 (WO-0002), cost spread over the passed packs; 33 above the limit: abnormal loss ₹ 1,944.03, WO-0003 waits for approval.
- Write-offs: WO-0002 7 packs Rs 0 done, WO-0003 33 packs Rs 1944.03 waiting (abnormal)
- Reject the abnormal loss: Rejected by Pavithran V V Stock write-off, ₹ 1,944.
- After: write-offs WO-0002 done, WO-0003 rejected; shelves: good 228, QC hold 0, damaged 33; average Rs 59.62
- Value check: good x average = Rs 13593.36; before + run cost = Rs 15538.4 (should be equal within rounding; the 7 normal rejects carry nothing)

After (v23), same steps:
- Before: DF037-M150 good stock 28 at Rs 50 (value Rs 1400). Run DFM/26-27/0003 makes 240, run cost Rs 14138.4.
- QC: 200 pass, 40 rejected: Checked 200 packs into stock (average cost ₹ 50.00 to ₹ 59.62); each passed pack carries ₹ 60.97 (the run cost over 200 packs); 7 rejected within the 3% allowed: normal loss, written off at Rs 0 (WO-0002), cost spread over the passed packs; 33 above the limit: abnormal loss ₹ 1,944.03, WO-0003 waits for approval.
- Write-offs: WO-0002 7 packs Rs 0 done, WO-0003 33 packs Rs 1944.03 waiting (abnormal)
- Reject the abnormal loss: Rejected by Pavithran V V Stock write-off, ₹ 1,944.
- After: write-offs WO-0002 done, WO-0003 rejected (to QC hold); shelves: good 228, QC hold 33, damaged 0; average Rs 59.6216
- The run now shows: Check again 33 packs on QC hold at Rs 58.91 each. Value on QC hold in Reports > Stock: Rs 1944.03
- Check again, all passed: Saved 33 passed to stock at ₹ 58.91 each.
- Value check: good x average = Rs 15537.33; before + run cost = Rs 15538.4 (should be equal within rounding; the 7 normal rejects carry nothing)

### I6. Sender or receiver (as stand-in) approve the Lost write-off
Fix: They and their stand-ins never sign it; Found and Lost hidden while one waits.

Before (v22):
- Kumar sends 10 Restaurant Napkins Kanchipuram to Chennai: DFT/26-27/0028 on the road Off the shelf at Kanchipuram, in the lorry TN 21 BC 4417. The company total has not moved; Chennai (example) counts it in.
- Lakshmi counts 6 in: Received short Counted in at Chennai (example). Short: DF002-M100 4. Waiting for Anitha R.
- Shoban rejects the transfer loss: Rejected by Shoban B Short receipt on a transfer, ₹ 220. Loss: rejected
- Shoban presses Lost (so neither Kumar nor Lakshmi raised it): Waiting for approval Write-off asked: WO-0002. The packs stay on the Disputed shelf until it is signed.
- Write-off card 7: Lost 4 DF002-M100 of transfer DFT/26-27/0028, Rs 220
- Kumar (sender) signs it? cannot (Kumar M is on leave until 2026-10-31. Lakshmi P is standing in.). Lakshmi (receiver, stands in for Kumar) signs it? CAN sign (for Kumar M). Anitha? CAN sign
- Ladder (who may sign): Lakshmi P for Kumar M, Anitha R, Pavithran V V
- Try through the screen as Kumar: no button / as Lakshmi: Approved by Lakshmi P for Kumar M Stock write-off, ₹ 220. Status: approved
- Kumar presses Lost again (if still waiting) while it waits: (none) Found/Lost box shown: False

After (v23), same steps:
- Kumar sends 10 Restaurant Napkins Kanchipuram to Chennai: DFT/26-27/0028 on the road Off the shelf at Kanchipuram, in the lorry TN 21 BC 4417. The company total has not moved; Chennai (example) counts it in.
- Lakshmi counts 6 in: Received short Counted in at Chennai (example). Short: DF002-M100 4. Waiting for Anitha R.
- Shoban rejects the transfer loss: Rejected by Shoban B Short receipt on a transfer, ₹ 220. Loss: rejected
- Shoban presses Lost (so neither Kumar nor Lakshmi raised it): Waiting for approval Write-off asked: WO-0002. The packs stay on the Disputed shelf until it is signed.
- Write-off card 7: Lost 4 DF002-M100 of transfer DFT/26-27/0028, Rs 220
- Kumar (sender) signs it? cannot (Kumar M was part of this transfer, so cannot sign its loss.). Lakshmi (receiver, stands in for Kumar) signs it? cannot (Lakshmi P was part of this transfer, so cannot sign its loss.). Anitha? CAN sign
- Ladder (who may sign): Anitha R, Pavithran V V
- Try through the screen as Kumar: no button / as Lakshmi: no button Status: pending
- Kumar presses Lost again (if still waiting) while it waits: Already asked A Found or Lost decision for DFT/26-27/0028 already waits. Found/Lost box shown: False

### PK1. A transfer took the batch a packer had scanned
Fix: Scanned packs are held for the packer for every mover.

Before (v22):
- Wet Wipes at Kanchipuram, Good: WW2412 60, WW2606 60.
- Order DFO-260030 for 40 Wet Wipes: DFO-260030 confirmed 40 packs held at Kanchipuram. Status: confirmed
- The packer scans 40: ["WW2412 40"]
- Kumar sends 60 Wet Wipes to Chennai: DFT/26-27/0028 on the road Off the shelf at Kanchipuram, in the lorry TN 21 BC 4417. The company total has not moved; Chennai (example) counts it in.
- The transfer took: WW2412 60. Good left: WW2606 60.
- The packer presses Packed: Scan again DF044-M100 batch WW2412: 40 scanned, 0 left. Another packer used that batch. Those scans are cleared: scan the packs you are holding again.
- Result: order packing; packed from: nothing

After (v23), same steps:
- Wet Wipes at Kanchipuram, Good: WW2412 60, WW2606 60.
- Order DFO-260030 for 40 Wet Wipes: DFO-260030 confirmed 40 packs held at Kanchipuram. Status: confirmed
- The packer scans 40: ["WW2412 40"]
- Kumar sends 60 Wet Wipes to Chennai: DFT/26-27/0028 on the road Off the shelf at Kanchipuram, in the lorry TN 21 BC 4417. The company total has not moved; Chennai (example) counts it in.
- The transfer took: WW2412 20, WW2606 40. Good left: WW2412 40, WW2606 20.
- The packer presses Packed: DFO-260030 packed 40 packs left the shelf at Kanchipuram. It waits in Packed, waiting.
- Result: order packed; packed from: WW2412 40

### C1. Sales makes a type on the Distributor list
Fix: A type on a non-standard list waits for Accounts/Admin; your choice: Sales may tighten status.

Before (v22):
- Divya (Sales) makes a new type "Restaurant two" on the Distributor list: Saved Restaurant two buys on Distributor. It buys on: Distributor. Waiting: []
- Approve as Pavithran (Admin): nothing to approve (it was never raised) It now buys on: Distributor
- Divya puts her active customer on hold: Not for Sales Changing a customer's status (active to hold) is for Accounts or an Admin. Status now: active
- (v22 refuses the step before this, so the next one cannot be done)

After (v23), same steps:
- Divya (Sales) makes a new type "Restaurant two" on the Distributor list: Saved Restaurant two buys on Shop. The list change waits for approval: Waiting for Anitha R. It buys on: Shop. Waiting: ["cust_change: New customer type Restaurant two on price list Distributor (it buys on Shop until approved)"]
- Approve as Pavithran (Admin): Approved by Pavithran V V Lift a customer hold or block, change a customer type, or put a type on another price list, ₹ 0. It now buys on: Distributor
- Divya puts her active customer on hold: Saved Annapoorna Caterers: hold. Status now: hold
- Divya tries to lift that hold: Not for Sales Easing a customer's status (hold to active) is for Accounts or an Admin. Status now: hold

### T2. Approvals after export post into the locked month
Fix: The lock is checked on the record date; export refused while a request dated in it waits.

Before (v22):
- a. Write-off of 30 packs asked today 28 Oct: WO-0002 waits for approval ₹ 1,650.00, 30 packs is above the rule. Waiting for Lakshmi P (for Kumar M). The stock stays until then.
- b. Petty cash top-up Rs 20,000 asked today: Waiting for approval Waiting for Anitha R.
- Waiting, dated 28 Oct: ["write_off 168 dated 2026-10-27","write_off 1650 dated 2026-10-28","petty_topup 20000 dated 2026-10-28"]
- Export October 2026 while those wait. Checks: []
- October locked after pressing Export: True
- The date moves to 2026-11-02 (today now: 2026-11-02).
- On 2 Nov Anitha approves the Rs 20,000 petty top-up dated 28 Oct: Approved by Anitha R Petty cash top-up, ₹ 20,000.
- Petty top-ups posted in October: 2026-10-28 20000
- On 2 Nov the Rs 1,650 write-off dated 28 Oct is approved: Approved by Pavithran V V Stock write-off, ₹ 1,650.
- Write-offs: WO-0001 waiting, WO-0002 done

After (v23), same steps:
- a. Write-off of 30 packs asked today 28 Oct: WO-0002 waits for approval ₹ 1,650.00, 30 packs is above the rule. Waiting for Lakshmi P (for Kumar M). The stock stays until then.
- b. Petty cash top-up Rs 20,000 asked today: Waiting for approval Waiting for Anitha R.
- Waiting, dated 28 Oct: ["write_off 168 dated 2026-10-27","write_off 1650 dated 2026-10-28","petty_topup 20000 dated 2026-10-28"]
- (v23: Super admin test tool treats October as ended, so the export can be tried.)
- Export October 2026 while those wait. Checks: ["5 requests dated in 2026-10 still waiting: Stock write-off, Purchase order, Stock take correction, Stock write-off ..."]
- October locked after pressing Export: False
- (To test the second guard anyway, October is marked exported in the data.)
- The date moves to 2026-11-02 (today now: 2026-11-02).
- On 2 Nov Anitha approves the Rs 20,000 petty top-up dated 28 Oct: Cannot approve now 2026-10 is exported to the CA and locked: it (dated 2026-10-28) cannot be dated in it. Use a date in an open month. Reject it with a note; the person asks again.
- Petty top-ups posted in October: none
- On 2 Nov the Rs 1,650 write-off dated 28 Oct is approved: Cannot approve now 2026-10 is exported to the CA and locked: it (dated 2026-10-28) cannot be dated in it. Use a date in an open month. Reject it with a note; the person asks again.
- Write-offs: WO-0001 waiting, WO-0002 waiting

### RP1. Average cost, scrap and ageing shown to Kumar
Fix: "hidden" everywhere without See cost.

Before (v22):
- Kumar M (Supervisor, no See cost): see cost = False
- Kumar passes QC on DFG/26-27/0016: DFG/26-27/0016 checked Into stock: DF044-M100 +240 (average cost ₹ 57.20 to ₹ 59.28).
- 2.1 Stock report tab "Value": rupee amounts shown: none; "hidden" shown: False; Rs 0.00 cells: 0
- 2.2 Stock report tab "Ageing": rupee amounts shown: ['UE AT COST 0-30 days 240 ₹ 0.00', ' 31-60 days 0 ₹ 0.00', ' 61-90 days 0 ₹ 0.00']; "hidden" shown: False; Rs 0.00 cells: 5
- 2.3 Stock report tab "Expiry": rupee amounts shown: none; "hidden" shown: False; Rs 0.00 cells: 0
- 2.4 Stock report tab "Slow movers": rupee amounts shown: none; "hidden" shown: False; Rs 0.00 cells: 0
- 2.5 Stock report tab "Write-offs and wastage": rupee amounts shown: ['KS) SCRAP VALUE Oct 26 0 ₹ 0.00', ' 3.5 ₹ 118.02']; "hidden" shown: False; Rs 0.00 cells: 1

After (v23), same steps:
- Kumar M (Supervisor, no See cost): see cost = False
- Kumar passes QC on DFG/26-27/0016: DFG/26-27/0016 checked Into stock: DF044-M100 +240 (average cost (cost hidden) to (cost hidden)).
- 2.1 Stock report tab "Value": rupee amounts shown: none; "hidden" shown: False; Rs 0.00 cells: 0
- 2.2 Stock report tab "Ageing": rupee amounts shown: none; "hidden" shown: True; Rs 0.00 cells: 0
- 2.3 Stock report tab "Expiry": rupee amounts shown: none; "hidden" shown: False; Rs 0.00 cells: 0
- 2.4 Stock report tab "Slow movers": rupee amounts shown: none; "hidden" shown: False; Rs 0.00 cells: 0
- 2.5 Stock report tab "Write-offs and wastage": rupee amounts shown: none; "hidden" shown: True; Rs 0.00 cells: 0

### RP2. Divya (Chennai) sees Kanchipuram money and customers; Kumar wallets Rs 0
Fix: Scoped by the customer godown; wallets by godown.

Before (v22):
- Divya (Sales) set to work at Chennai only.
- Dashboard money tile: Money owed to us ₹ 83,780.00 ₹ 14,160.00 overdue · we owe ₹ 0.00
- Customer list - Kanchipuram customers shown: Hotel Kanchi Residency, Annapoorna Caterers, Kamatchi Stores, Ambur Leather
- Credit limits - Kanchipuram customers shown: Hotel Kanchi Residency, Annapoorna Caterers, Kamatchi Stores, Ambur Leather
- Customer ledger - Kanchipuram customers shown: Hotel Kanchi Residency, Annapoorna Caterers, Kamatchi Stores, Ambur Leather
- Money owed report - Kanchipuram customers shown: none
- Kanchipuram customers Divya can open (seesCust): 5
- Kumar, Customer wallets: Marketing / Customer wallets Customer wallets NEW Each customer's credit and its history The wallet is off. Admin > Switches > "Customer wallet and cashback on". Rules can be set up; nothing is earned or used until it is on. Usable: can go on an order now Pending: waits for payment or delivery Wallet money is a discount, never cash ₹ 0.00 usable in all customers' wallets. ₹ 0.00 runs out in the ne

After (v23), same steps:
- Divya (Sales) set to work at Chennai only.
- Dashboard money tile: Money owed to us ₹ 0.00 ₹ 0.00 overdue · we owe ₹ 0.00
- Customer list - Kanchipuram customers shown: none
- Credit limits - Kanchipuram customers shown: none
- Customer ledger - Kanchipuram customers shown: none
- Money owed report - Kanchipuram customers shown: none
- Kanchipuram customers Divya can open (seesCust): 0
- Kumar, Customer wallets: Marketing / Customer wallets Customer wallets NEW Each customer's credit and its history The wallet is off. Admin > Switches > "Customer wallet and cashback on". Rules can be set up; nothing is earned or used until it is on. Usable: can go on an order now Pending: waits for payment or delivery Wallet money is a discount, never cash ₹ 500.00 usable in all customers' wallets. ₹ 80.00 runs out in the

### X4. Bill matched the rate of a waiting amendment
Fix: Bills match the last approved revision; new lines need approval.

Before (v22):
- Kumar amends DFP/26-27/0043 reel rate Rs 72 to Rs 80: Saved as Rev 2 A rate went up (RM-PR2 ₹ 72.00 to ₹ 80.00), so it waits for approval again. If it is rejected, Rev 1 stays in force. Waiting for Pavithran V V.
- PO: waiting Rev 2
- Bill drawer offers the reel at Rs 80. Bill VC/780: 780 kg at Rs 80: VC/780 saved as DFB/26-27/0003 Matched. Due 2026-11-27 (MSME, 45 days from accepting the goods). It is paid in Money > Supplier payments (section 11).
- Bill DFB/26-27/0003: status unpaid, total Rs 73632, PO rate it was matched to: RM-PR2 po 80
- Pavithran rejects the amendment: Rejected by Pavithran V V Purchase order, ₹ 78,400. PO now Rev 1 reel rate 72
- Bill DFB/26-27/0003 after: status unpaid, total Rs 73632
- PO drawer lists rejected amendments: False
- PO state before step 4: part, Amend shown: True
- Amendment adds a new line RM-FILM 10 at Rs 500 (any rate) and cuts cores 2000 to 1200, so the PO value goes down: Saved as Rev 2 Rev 2 is ready to print or mail. Rev 1 stays in the history.
- PO: open Rev 2; waiting: ["po: PO DFP/26-27/0044 to Velan Converters, 1,200 kg jumbo parent reel 2-ply"]

After (v23), same steps:
- Kumar amends DFP/26-27/0043 reel rate Rs 72 to Rs 80: Saved as Rev 2 A rate went up (RM-PR2 ₹ 72.00 to ₹ 80.00), so it waits for approval again. If it is rejected, Rev 1 stays in force. Waiting for Pavithran V V.
- PO: waiting Rev 2
- Bill drawer offers the reel at Rs 72. Bill VC/780: 780 kg at Rs 80: VC/780 saved as DFB/26-27/0003 The price differs from the PO by ₹ 6,240.00 in all. Waiting for Anitha R. It cannot be paid until then.
- Bill DFB/26-27/0003: status waiting, total Rs 73632, PO rate it was matched to: RM-PR2 po 72
- Pavithran rejects the amendment: Rejected by Pavithran V V Purchase order, ₹ 78,400. PO now Rev 1 reel rate 72
- Bill DFB/26-27/0003 after: status waiting, total Rs 73632
- PO drawer lists rejected amendments: True
- PO state before step 4: part, Amend shown: True
- Amendment adds a new line RM-FILM 10 at Rs 500 (any rate) and cuts cores 2000 to 1200, so the PO value goes down: Saved as Rev 2 A rate went up (new line RM-FILM at ₹ 500.00), so it waits for approval again. If it is rejected, Rev 1 stays in force. Waiting for Pavithran V V.
- PO: waiting Rev 2; waiting: ["po: PO DFP/26-27/0044 to Velan Converters, 1,200 kg jumbo parent reel 2-ply","po: PO DFP/26-27/0043 Rev 2 to Velan Converters: ₹ 72,000 to ₹ 71,800. Rate up: new line RM-FILM at ₹ 500.00"]

### X9. Two out-of-window requests approved against 6 packs
Fix: Later requests see what earlier ones took.

Before (v22):
- DFO-260030: the 10 paid Facial Tissue came in two parts: 4 on 2026-10-08 (20 days ago), 6 on 2026-10-26 (2 days ago). Return window 7 days.
- New return panel says: Delivered 2 days ago. Delivered in parts: up to the packs shown as inside the 7-day window are approved at once; more needs a second person (rule "Return outside the return window"). Invoice: DFI/26-2
- Return 5 of them: DFR-260020 saved Load it as a stop on the next trip from Kanchipuram.
- DFR-260020: status approved, requests []
- Then 2 more (offered up to 5): DFR-260021 saved Load it as a stop on the next trip from Kanchipuram.
- DFR-260021: status approved, requests []
- Result: packs approved at once without a second person: 7 (inside the window: 6)

After (v23), same steps:
- DFO-260030: the 10 paid Facial Tissue came in two parts: 4 on 2026-10-08 (20 days ago), 6 on 2026-10-26 (2 days ago). Return window 7 days.
- New return panel says: Delivered 2 days ago. Delivered in parts: up to the packs shown as inside the 7-day window are approved at once; more needs a second person (rule "Return outside the return window"). Invoice: DFI/26-2
- Return 5 of them: DFR-260020 saved Load it as a stop on the next trip from Kanchipuram.
- DFR-260020: status approved, requests []
- Then 2 more (offered up to 5): Waiting for approval Delivered 20 days ago, the window is 7 days. Waiting for Lakshmi P (for Kumar M).
- DFR-260021: status waiting, requests []
- Result: packs approved at once without a second person: 5 (inside the window: 6)

## B. New gaps in v22 (11)

### Y1. Exporting the running month locked the business
Fix: Only a finished month can be exported.

Before (v22):
- Today 2026-10-28. 1. Export to accountant, October (running month): export button enabled = True; check: ok []
- Force the export call: Oct 26 exported 6 vouchers (6 new) in dfresh-tally-2026-10.xml and dfresh-vouchers-2026-10.csv. Each has its own id, so Tally never gets one twice. The month is now locked. October locked now: True
- Then an expense today: Not saved Fix the field marked in red. 2026-10 is exported to the CA. Use a date in an open month.
- Super admin test tool shown: False
- Same page as Pavithran (Admin, not Super admin): test tool shown = False; ACT.axEnd: no tool

After (v23), same steps:
- Today 2026-10-28. 1. Export to accountant, October (running month): export button enabled = False; check: not ok []
- Force the export call: Fix first 2026-10 is still running. A month is exported after it ends; exporting locks it for everybody. 3 requests dated in 2026-10 still waiting: Stock write-off, Purchase order, Stock take correction October locked now: False
- Then an expense today: DFX/26-27/0007 recorded ₹ 500.00 Fuel.
- Super admin test tool shown: True
- Same page as Pavithran (Admin, not Super admin): test tool shown = False; ACT.axEnd: Not for you Only a Super admin can use this test tool.

### Y2. COD due was the whole order on each trip
Fix: Due = the invoices on that trip less what is paid.

Before (v22):
- DFO-260029: cash customer CUS-0145, 40 x DF001-M100, order total Rs 2218.
- Pack 25 only (15 short, part shipment): DFO-260029 packed 25 packs left the shelf at Kanchipuram. 15 short wait as a back-order; check the shelf with a stock take. | invoice: DFI/26-27/0413 made ₹ 1,387.00 posted to Kamatchi Stores's ledger, due 2026-10-28. The goods can leave.
- Trip 1 carries DFI/26-27/0413 Rs 1387; cash due on the trip = Rs 2218.
- Trip 1 collects the invoice amount. Cash due for the order now = Rs 2218; customer balance Rs 0.
- Order now: packed, packed 25, inv 25, back 15
- (the second 15 are marked packed by script and invoiced: DFI/26-27/0414 made ₹ 832.00 posted to Kamatchi Stores's ledger, due 2026)
- The balance of 15 packed and invoiced (DFI/26-27/0414 Rs 832): cash due on trip 2 = Rs 2218.

After (v23), same steps:
- DFO-260029: cash customer CUS-0145, 40 x DF001-M100, order total Rs 2218.
- Pack 25 only (15 short, part shipment): DFO-260029 packed 25 packs left the shelf at Kanchipuram. 15 short wait as a back-order; check the shelf with a stock take. | invoice: DFI/26-27/0413 made ₹ 1,387.00 posted to Kamatchi Stores's ledger, due 2026-10-28. The goods can leave.
- Trip 1 carries DFI/26-27/0413 Rs 1387; cash due on the trip = Rs 1387.
- Trip 1 collects the invoice amount. Cash due for the order now = Rs 0; customer balance Rs 0.
- Order now: packed, packed 25, inv 25, back 15
- (the second 15 are marked packed by script and invoiced: DFI/26-27/0414 made ₹ 832.00 posted to Kamatchi Stores's ledger, due 2026)
- The balance of 15 packed and invoiced (DFI/26-27/0414 Rs 832): cash due on trip 2 = Rs 832.

### Y3. The requester made the "away" condition himself
Fix: Admin leave needs 2 days notice; override re-checks at apply time.

Before (v22):
- Shoban puts Pavithran on leave today only (28 Oct): Pavithran V V saved Can sign up to anything at every godown.  Pavithran away now: True
- Shoban switches "Expense above the limit" off; override form offered on his own request: True
- With Pavithran really on leave, Shoban overrides: Override set: applies in 24 hours The other Admins and every Super admin are told now by e-mail and WhatsApp (Outbox). Any Admin can cancel it until 2026-10-29 18:13.
- Pavithran is back before the 24 hours end; at apply time: request approved, rule on = False, override {"cancelled":false,"why":""}. Outbox last: ["Override by Shoban B: Expense above the limit: switch \"Expense above the limit\" off. Reaso"]
- Reverse: Shoban on leave, Pavithran switches the rule off; override form for Pavithran: no request

After (v23), same steps:
- Shoban puts Pavithran on leave today only (28 Oct): Not saved Fix the field marked in red. An Admin's leave is entered by that Admin, or starts at least 2 days ahead (2026-10-30). Pavithran away now: False
- Shoban switches "Expense above the limit" off; override form offered on his own request: False
- With Pavithran really on leave, Shoban overrides: Override set: applies in 24 hours The other Admins and every Super admin are told now by e-mail and WhatsApp (Outbox). Any Admin can cancel it until 2026-10-29 18:13.
- Pavithran is back before the 24 hours end; at apply time: request pending, rule on = True, override {"cancelled":true,"why":"the other Admin is back, so they decide it"}. Outbox last: ["The override of \"Expense above the limit: switch \"Expense above the limit\" off\" did not ap"]
- Reverse: Shoban on leave, Pavithran switches the rule off; override form for Pavithran: True

### Y4. Lower standard cost alone made a special go live
Fix: A lower standard cost waits; specials checked on the old cost.

Before (v22):
- DF001-M100 standard cost Rs 45, margin floor 10% (cost plus margin Rs 49.50). Customer CUS-0145, Shop list Rs 48.
- Anitha (Sub-admin) lowers standard cost 45 to 40: DF001-M100 saved 1 change in the audit log.  Cost now: 40; waiting: ["write_off: 4 packs Kitchen Towel 2ply, forklift damage","write_off: 10 Wall Dispensers not found at stock take","refund: Refund to Hotel Saravana for 2 damaged cartons","po: PO DFP/26-27/0044 to Velan Converters, 1,200 kg jumbo parent reel 2-ply","count_fix: Stock take ST-302, Pocket Hanky 4 short, Tissue 8 short"]
- Anitha adds a special price Rs 46 for CUS-0145: Special price active SP-002: 4.2% below their list price.
- Special state: [{"price":46,"status":"active"}]; margin approvals waiting: 0
- Pavithran approves the cost change: nothing to approve (it was never raised) Cost now: 40. Special SP-002 still: active

After (v23), same steps:
- DF001-M100 standard cost Rs 45, margin floor 10% (cost plus margin Rs 49.50). Customer CUS-0145, Shop list Rs 48.
- Anitha (Sub-admin) lowers standard cost 45 to 40: DF001-M100 saved 0 changes in the audit log. The lower standard cost waits for a second Admin: Waiting for Shoban B.  Cost now: 45; waiting: ["write_off: 4 packs Kitchen Towel 2ply, forklift damage","write_off: 10 Wall Dispensers not found at stock take","refund: Refund to Hotel Saravana for 2 damaged cartons","po: PO DFP/26-27/0044 to Velan Converters, 1,200 kg jumbo parent reel 2-ply","count_fix: Stock take ST-302, Pocket Hanky 4 short, Tissue 8 short","rule_change: DF001-M100: standard cost ₹ 45.00 to ₹ 40.00 (a lower cost lets lower prices pass the margin floor)"]
- Anitha adds a special price Rs 46 for CUS-0145: Sent for approval SP-002: 4.2% below their list price; DF001-M100 at ₹ 46.00 is below cost plus margin ₹ 49.50. An Admin or Sub-admin other than you must approve it.
- Special state: [{"price":46,"status":"pending"}]; margin approvals waiting: 0
- Pavithran approves the cost change: Approved by Pavithran V V Lower a standard cost (second Admin), ₹ 0. Cost now: 40. Special SP-002 still: pending

### Y5. Split shipments on removed an approval
Fix: Treated as a weakening.

Before (v22):
- Start: "Part shipments and back-orders" OFF (so an order above free stock needs approval). As Shoban alone.
- Switch it ON: Saved Part shipments and back-orders allowed: on. Value now: True; waiting: [] []
- Switch "Freight goes into the average cost" OFF: Saved Freight goes into the average cost: off. Value now: False; rule-change requests: 0

After (v23), same steps:
- Start: "Part shipments and back-orders" OFF (so an order above free stock needs approval). As Shoban alone.
- Switch it ON: Waiting for a second Admin Part shipments and back-orders allowed: on. It loosens a control, so until then it stays as it is. Waiting for Pavithran V V. Value now: False; waiting: ["rule_change: Switch Part shipments and back-orders allowed: on"] ["Switch Part shipments and back-orders allowed: on"]
- Switch "Freight goes into the average cost" OFF: Waiting for a second Admin Freight goes into the average cost: off. It loosens a control, so until then it stays as it is. Waiting for Pavithran V V. Value now: True; rule-change requests: 2

### Y6. Freight left cost on the first part bill; transporter bill lost
Fix: PO freight stays until the last bill; a Freight in expense can go on the PO.

Before (v22):
- PO DFP/26-27/0041: 240 Wet Wipes at Rs 58, PO freight Rs 600. After QC: average cost Rs 59.28.
- First part bill, 120 packs, 0 freight: GL/A saved as DFB/26-27/0003 Matched. Due 2026-11-27. It is paid in Money > Supplier payments (section 11). Average cost moved: DF044-M100 ₹ 59.28 to ₹ 57.70.  Average now Rs 57.7 (PO freight should stay in).
- Last bill, 120 packs, 0 freight, ticked "A transporter bills the freight separately": GL/B saved as DFB/26-27/0004 Matched. Due 2026-11-27. It is paid in Money > Supplier payments (section 11).  Average now Rs 57.7.
- (v22 has no such field, so the steps stop here)

After (v23), same steps:
- PO DFP/26-27/0041: 240 Wet Wipes at Rs 58, PO freight Rs 600. After QC: average cost Rs 59.28.
- First part bill, 120 packs, 0 freight: GL/A saved as DFB/26-27/0003 Matched. Due 2026-11-27. It is paid in Money > Supplier payments (section 11).  Average now Rs 59.28 (PO freight should stay in).
- Last bill, 120 packs, 0 freight, ticked "A transporter bills the freight separately": GL/B saved as DFB/26-27/0004 Matched. Due 2026-11-27. It is paid in Money > Supplier payments (section 11).  Average now Rs 59.28.
- Transporter bill Rs 750 + GST as a "Freight in" expense for DFP/26-27/0041: DFX/26-27/0007 recorded ₹ 885.00 Freight in on a purchase (transporter). Freight for DFP/26-27/0041: average cost DF044-M100 ₹ 59.28 to ₹ 59.67.  Average now Rs 59.67.
- Freight in the cost of the 380 packs in stock: Rs 748.2

### Y7. Debit note on an invoice whose cancel waits
Fix: Refused.

Before (v22):
- Invoice DFO-260024 (packed): DFI/26-27/0413 made ₹ 2,053.00 posted to Ambur Leather Works canteen's ledger, due 2026-11-27. The goods can leave.
- Ask to cancel DFI/26-27/0413: Waiting for approval Cancelling an invoice needs a second person. Waiting for Anitha R. Invoice: status open, cancel waiting true
- Debit note Rs 150 on it while the cancel waits: DFS/26-27/0001 made ₹ 177.00 added to Ambur Leather Works canteen's balance, due 2026-11-27.  Debit notes on it: 1
- Approved by Pavithran V V Cancel an invoice, ₹ 2,053.
- After: invoice cancelled; live debit notes on it: ["DFS/26-27/0001 undefined 177"]

After (v23), same steps:
- Invoice DFO-260024 (packed): DFI/26-27/0413 made ₹ 2,053.00 posted to Ambur Leather Works canteen's ledger, due 2026-11-27. The goods can leave.
- Ask to cancel DFI/26-27/0413: Waiting for approval Cancelling an invoice needs a second person. Waiting for Anitha R. Invoice: status open, cancel waiting true
- Debit note Rs 150 on it while the cancel waits: Not saved Fix the field marked in red. DFI/26-27/0413 waits to be cancelled. Decide the cancel first. Debit notes on it: 0
- Approved by Pavithran V V Cancel an invoice, ₹ 2,053.
- After: invoice cancelled; live debit notes on it: []

### Y8. Credit note buyer changed by a merge
Fix: The note keeps the invoice buyer; only the ledger moves.

Before (v22):
- Invoice DFO-260024: DFI/26-27/0413 made ₹ 2,053.00 posted to Ambur Leather Works canteen's ledger, due 2026-11-27. The goods can leave.
- DFI/26-27/0413 buyer CUS-0147 (Ambur Leather Works canteen), GSTIN 33AABCA5512H1Z7.
- CUS-0147 merged into CUS-0141 (status merged).
- Credit note Rs 40 on DFI/26-27/0413: Waiting for approval DFC/26-27/0015: no goods come back, so a second person signs it. Waiting for Anitha R.
- Approve (credit_no_return) as Anitha: Approved by Anitha R Credit note not tied to a return, ₹ 47.
- The credit note: {"id":"DFC/26-27/0015","cust":"CUS-0147","status":"done","gstinOnNote":"33AABCA5512H1Z7"}; invoice buyer stays CUS-0147. Ledger line for the note goes to: cledger:CUS-0147
- A return credit note built with the survivor as customer (how a return after the merge builds it) is posted: note customer / ledger = CUS-0141 / ledger to CUS-0141

After (v23), same steps:
- Invoice DFO-260024: DFI/26-27/0413 made ₹ 2,053.00 posted to Ambur Leather Works canteen's ledger, due 2026-11-27. The goods can leave.
- DFI/26-27/0413 buyer CUS-0147 (Ambur Leather Works canteen), GSTIN 33AABCA5512H1Z7.
- CUS-0147 merged into CUS-0141 (status merged).
- Credit note Rs 40 on DFI/26-27/0413: Waiting for approval DFC/26-27/0015: no goods come back, so a second person signs it. Waiting for Anitha R.
- Approve (credit_no_return) as Anitha: Approved by Anitha R Credit note not tied to a return, ₹ 47.
- The credit note: {"id":"DFC/26-27/0015","cust":"CUS-0147","status":"done","gstinOnNote":"33AABCA5512H1Z7"}; invoice buyer stays CUS-0147. Ledger line for the note goes to: cledger:CUS-0141
- A return credit note built with the survivor as customer (how a return after the merge builds it) is posted: note customer / ledger = CUS-0147 / ledger to CUS-0141

### Y9. Stock report left out production and other shelves
Fix: A column per shelf, In production included.

Before (v22):
- Run DFM/26-27/0003 is started (material issued). 4 DF044-M100 moved to Damaged and 6 to QC hold (worth Rs 572).
- Reports > Stock: "Stock at cost" ₹ 2,60,300.80
- Shelf table: none
- Category table: GODOWN CATEGORY PACKS OR UNITS VALUE AT COST WITHOUT A COST Kanchipuram Raw materials 3600 ₹ 2,52,360.00 0 Kanchipuram Wet Wipes 130 ₹ 7,436.00 0 Kanchipuram Facial Tissue 488 ₹ 504.80 480 Kanchipuram Table Napkins 1050 ₹ 0.00 1050 Chennai (example) Table Napk

After (v23), same steps:
- Run DFM/26-27/0003 is started (material issued). 4 DF044-M100 moved to Damaged and 6 to QC hold (worth Rs 572).
- Reports > Stock: "Stock at cost" ₹ 2,90,484.92
- Shelf table: GODOWN GOOD PACKED ON THE ROAD QC HOLD DAMAGED RETURNED REJECTED DISPUTED IN PRODUCTION TOTAL Kanchipuram ₹ 2,60,300.80 ₹ 0.00 ₹ 0.00 ₹ 14,863.20 ₹ 228.80 ₹ 0.00 ₹ 1,410.00 ₹ 0.00 ₹ 13,682.12 ₹ 2,90,484.92 Chennai (example) ₹ 0.00 ₹ 0.00 ₹ 0.00 ₹ 0.00 ₹ 0.00 ₹ 0.00 ₹ 0.00 ₹ 0.00 ₹ 0.00 ₹ 0.00 GODOWN CATEGORY PACKS OR UNITS VALUE
- Category table: GODOWN CATEGORY PACKS OR UNITS VALUE AT COST WITHOUT A COST Kanchipuram Raw materials 3600 ₹ 2,52,360.00 0 Kanchipuram QC hold 246 ₹ 14,863.20 0 Kanchipuram In production 198.46 ₹ 13,682.12 0 Kanchipuram Wet Wipes 130 ₹ 7,436.00 0 Kanchipuram Rejected, to go b

### Y10. Buying Edit given by one Admin
Fix: Counts as a widening.

Before (v22):
- Warehouse role (Murugan S) Buying Edit before: False
- Pavithran alone ticks Buying > Edit on the Warehouse role and saves: Warehouse saved, 1 change in the audit log Murugan S, Selvi R sign up to nothing. Buying Edit now: True; waiting: []
- Murugan (Warehouse) on Purchase orders sees rates/totals: True; "84,960" on the page: True

After (v23), same steps:
- Warehouse role (Murugan S) Buying Edit before: False
- Pavithran alone ticks Buying > Edit on the Warehouse role and saves: Waiting for a second Admin Warehouse: Edit on Buying (shows purchase rates). Rights that let someone sign are never widened by one person. Waiting for Shoban B. Buying Edit now: False; waiting: ["Role Warehouse: Edit on Buying (shows purchase rates)"]
- Murugan (Warehouse) on Purchase orders sees rates/totals: False; "84,960" on the page: False

### Y11. Role change away from Sales kept the customers
Fix: Same hand-over as leaving.

Before (v22):
- Divya has 5 customers. Shoban changes her role from Sales to Delivery.
- Save without choosing who takes over: Divya N saved Can sign up to nothing at Kanchipuram, Chennai (example). Role now: Delivery, customers still on her: 5

After (v23), same steps:
- Divya has 5 customers. Shoban changes her role from Sales to Delivery.
- Save without choosing who takes over: Not saved Fix the field marked in red. Role now: Sales, customers still on her: 5
- Choose who takes over and save: Divya N saved Can sign up to nothing at Kanchipuram, Chennai (example). 5 customers and 3 enquiries handed over to Shoban B. Customers still on Divya: 0

## C. Smaller items (22)

### Low1. Supplier credit, no-PO freight, payment while a bank change waits, packs with no cost
Fix: See each line.

Before (v22):
- a) Velan Converters with a Rs 2,737.60 supplier credit, Suppliers list row: Velan Converters SUP-0001 Raw material 33AAFFV4821K1Z3 Tamil Nadu · MSME Small 30 days 2 ₹ -2,737.60 100% on t
- b) Goods-in DFG/26-27/0018 has no PO. Bill 780 RM-PR2 at Rs 72 with Rs 5,000 freight: VC/NP/1 saved as DFB/26-27/0003 Matched. Due 2026-11-27 (MSME, 45 days from accepting the goods). It is paid in Money > Supplier payments (section 11).  Bill status: unpaid; average RM-PR2 Rs 70.5 -> Rs 70.5.
- c) Sri Balaji: a new bank account waits. Pay drawer says: A new bank account is waiting for approval. Pay to the approved account below, or wait. Never pay to an account that is not approved. Pay to Sri Balaji Packaging · Canara Bank · A/c XXXX4416 · IFSC CN
- Pay Rs 1,000 by bank: No approved bank account Sri Balaji Packaging's bank account waits for approval. No payment of any kind (bank, UPI, cheque or cash) until it is signed.  Payments made: 0
- d) DF001-M100 had 150 packs with no cost; a run adds 10 at Rs 50. Average now Rs 50; alert: []

After (v23), same steps:
- a) Velan Converters with a Rs 2,737.60 supplier credit, Suppliers list row: Velan Converters SUP-0001 Raw material 33AAFFV4821K1Z3 Tamil Nadu · MSME Small 30 days 2 ₹ 2,737.60 credit 100
- b) Goods-in DFG/26-27/0018 has no PO. Bill 780 RM-PR2 at Rs 72 with Rs 5,000 freight: VC/NP/1 saved as DFB/26-27/0003 Freight on goods with no PO is approved first. Waiting for Anitha R. It cannot be paid until then.  Bill status: waiting; average RM-PR2 Rs 70.5 -> Rs 70.5.
- Approved by Pavithran: Approved by Pavithran V V Supplier bill price differs from the PO, ₹ 5,000. Bill now unpaid; average RM-PR2 Rs 70.64 (stock 900, from this goods-in still in stock 20); to cost of sales: ["RM-PR2 4871.79 freight on goods with no PO"]; bill costAdj: [{"sku":"RM-PR2","old":70.5,"now":70.64,"value":128.21}]
- c) Sri Balaji: a new bank account waits. Pay drawer says: A new bank account is waiting for approval. A payment made now goes to the approved account below (ending 4416), never to the new one. Confirm with the supplier by phone if unsure. Pay to Sri Balaji P
- Pay Rs 1,000 by bank: DFV/26-27/0001 paid ₹ 1,000.00 to Sri Balaji Packaging. The bills are updated.  Payments made: 1 to account ending 4416
- d) DF001-M100 had 150 packs with no cost; a run adds 10 at Rs 50. Average now Rs 50; alert: ["Table Napkins 20×20: 150 packs had no cost - They were given ₹ 50.00 from RUN-T on 2026-10-28. If that is wrong, set the standard cost in Products."]

### Low2. Labels, less-material reason, expired at pack, QC hold write-off, count sheet
Fix: See each line.

Before (v22):
- a0) Wastage reasons offered: - | Trim and roll ends | Machine jam | Wet or damp reel | Wrong setting at start | Other
- a) Run DFM/26-27/0003 finished with 60% of the material: Waiting for approval Nothing moves until it is signed: the packs, the material and the cost stay as they are. Waiting for Anitha R. Last request: 6 [Production wastage above the recipe] Run DFM/26-27/0003 DF037-M150: 240 packs made with less material than the recipe: RM-PR2 111.24 used of 180, R
- b) Bring back discontinued DZIND-DF040: Waiting for approval Waiting for Pavithran V V. Last request: 7 [Weaken an approval rule (switch it off or raise its limit)] Bring discontinued Interfold Towels (DZIND-DF040) back to Active: it can be sold and back-ordered again
- c) Scanned batch OPENING has expired before Packed is pressed: Scan again DF001-M100 batch OPENING: 40 scanned, expired. Another packer used that batch. Those scans are cleared: scan the packs you are holding again. Order status: packing
- d) Write-off of 2 from QC hold (option added by editing the page): WO-0002 written off ₹ 114.40 is within the rule, so it is done; it is in the audit log and the stock ledger.  Write-offs made: 1
- e) DFO-260028 has 10 DF007-M100 scanned (not yet Packed). Count sheet ST-303: no line about scanned packs

After (v23), same steps:
- a0) Wastage reasons offered: - | Trim and roll ends | Machine jam | Wet or damp reel | Wrong setting at start | Less material used than the recipe (recount) | Other
- a) Run DFM/26-27/0003 finished with 60% of the material: Waiting for approval Nothing moves until it is signed: the packs, the material and the cost stay as they are. Waiting for Anitha R. Last request: 6 [Production: less material than the recipe] Run DFM/26-27/0003 DF037-M150: 240 packs made with less material than the recipe: RM-PR2 111.24 used of 180, R
- b) Bring back discontinued DZIND-DF040: Waiting for approval Waiting for Pavithran V V. Last request: 7 [Bring back a discontinued product] Bring discontinued Interfold Towels (DZIND-DF040) back to Active: it can be sold and back-ordered again
- c) Scanned batch OPENING has expired before Packed is pressed: Scan again DF001-M100 batch OPENING: 40 scanned, expired. That batch has expired: put those packs aside for QC and scan a good batch. Those scans are cleared: scan the packs you are holding again. Order status: packing
- d) Write-off of 2 from QC hold (option added by editing the page): Not saved Fix the field marked in red. QC hold is cleared only by Quality check: reject it there. Write-offs made: 0
- e) DFO-260028 has 10 DF007-M100 scanned (not yet Packed). Count sheet ST-303: Count these with the shelf. They are scanned for orders still being packed, so they are in the book figure but may be on the packing table: DFO-260028 DF007-M100 10. Do not count the packed

### Low3. E-way bill loads and numbers, return room, back-order first claim, receipts, special price drafts
Fix: See each line.

Before (v22):
- a) Two Rs 30,000 invoices to CUS-0141 from Kanchipuram today (limit Rs 50,000): second invoice needs e-way bill: false; first one (after the second): false
- E-way bill numbers: 000000000000 accepted, 111111111111 accepted, 123456789012 accepted, 341007654321 accepted
- b) Invoice DFO-260024: DFI/26-27/0413 made ₹ 2,053.00 posted to Ambur Leathe
- A return of 10 packs (about Rs 956 with GST) waits on DFI/26-27/0413 (total Rs 2053). Room for notes: Rs 2053.
- A price credit note of Rs 1689 (+GST) on it: Waiting for approval DFC/26-27/0015: no goods come back, so a second person signs it. Waiting for Anitha R.
- Then the return credit check: fits
- c) DFO-260029 owes 15 DF001-M100 (back-order); free 95. 20 arrive on Good. Back-order now 15, held 25; free 115.
- d) CUS-0147 open items ["DFI/26-27/0413 2053"]. Receipt for exactly DFI/26-27/0413's balance: "Set against" = "Oldest dues first"
- e) Product of DF040-M100 is a draft (pack active). Special price form offers it: True
- Saved anyway (option added by editing the page): Special price active SP-002: 5.9% below their list price.  Specials made: 1

After (v23), same steps:
- a) Two Rs 30,000 invoices to CUS-0141 from Kanchipuram today (limit Rs 50,000): second invoice needs e-way bill: true; first one (after the second): true
- E-way bill numbers: 000000000000 refused, 111111111111 refused, 123456789012 refused, 341007654321 accepted
- b) Invoice DFO-260024: DFI/26-27/0413 made ₹ 2,053.00 posted to Ambur Leathe
- A return of 10 packs (about Rs 956 with GST) waits on DFI/26-27/0413 (total Rs 2053). Room for notes: Rs 1097.2.
- A price credit note of Rs 1689 (+GST) on it: Too much for DFI/26-27/0413 Credit notes on it together cannot pass the invoice value ₹ 2,053.00. Room left: ₹ 1,097.20 (₹ 955.80 is held for returns still open on it). Room left on DFI/26-27/0413: ₹ 1,097.20 with GST.
- Then the return credit check: fits
- c) DFO-260029 owes 15 DF001-M100 (back-order); free 95. 20 arrive on Good. Back-order now 0, held 40; free 100.
- d) CUS-0147 open items ["DFI/26-27/0413 2053"]. Receipt for exactly DFI/26-27/0413's balance: "Set against" = "DFI/26-27/0413 · ₹ 2,053.00 left"
- e) Product of DF040-M100 is a draft (pack active). Special price form offers it: False
- Saved anyway (option added by editing the page): Not saved Fix the field marked in red. DF040-M100 is not for sale yet (its product is a draft or it is not active). Specials made: 0

### Low4. Quote price shown, override tools, drop back-order and wallet, W2 cashback, margin message
Fix: See each line.

Before (v22):
- a) Quote DFQ/26-27/0001 (DF023-R1 kept at Rs 200) made into draft DFO-260030; then the quote expires. The draft form shows price Rs 200 (List ₹ 200.00 (kept from when it was made) · GST 18% · 120 free at Kanchipuram · 1 carton). Saved: Rs 233.
- b) Shoban overrides; Pavithran (Admin, not Super admin) sees the "24 hours later" test tool: True; pressing it: Test tool 24 hours have passed.; override applied: approved.
- A one-minute timer re-checks overrides: False
- Clock past the 24 hours, no click or refresh for 61 s: request approved, rule on = False
- c) DFO-260029 owes 15; wallet kept Rs 30. Back-orders page has no Drop button (page sales/orders/back-orders).
- d) Invoice DFO-260024: DFI/26-27/0413 made ₹ 2,053.00 posted to Am
- Cashback Rs 32.40 (2% of Rs 1,620, rule minimum Rs 1,000). A credit note returns 10 of 20 packs (base now Rs 810): taken back Rs 16.2, left Rs 16.2 (pending)
- e) Divya (no See cost), Kamatchi list Rs 47, cost plus margin Rs 49.50 (hidden). Form at Rs 45: mentions margin, approval shown. At Rs 47 (= list): mentions margin, approval shown.
- Save at Rs 47: Waiting for approval Price below cost plus the margin floor. No stock is held until then. Waiting for Anitha R. Order: waiting

After (v23), same steps:
- a) Quote DFQ/26-27/0001 (DF023-R1 kept at Rs 200) made into draft DFO-260030; then the quote expires. The draft form shows price Rs 233 (List ₹ 233.00 (priced again from today's list: the quote has expired) · GST 18% · 120 free at Kanchipuram · 1 carton). Saved: Rs 233.
- b) Shoban overrides; Pavithran (Admin, not Super admin) sees the "24 hours later" test tool: False; pressing it: Not for you Only a Super admin can use this test tool. In the real admin it is not there.; override applied: pending.
- A one-minute timer re-checks overrides: True
- Clock past the 24 hours, no click or refresh for 61 s: request approved, rule on = False
- c) DFO-260029 owes 15 (back-order); wallet kept for it Rs 30. Drop: Dropped 15 DF001-M100 no longer owed on DFO-260029. ₹ 30.00 kept from the wallet is free again. Now: qty 25, back 0, wallet kept Rs 0.
- d) Invoice DFO-260024: DFI/26-27/0413 made ₹ 2,053.00 posted to Am
- Cashback Rs 32.40 (2% of Rs 1,620, rule minimum Rs 1,000). A credit note returns 10 of 20 packs (base now Rs 810): taken back Rs 32.4, left Rs 0 (reversed)
- e) Divya (no See cost), Kamatchi list Rs 47, cost plus margin Rs 49.50 (hidden). Form at Rs 45: no margin text, approval shown, generic "checked against cost" note. At Rs 47 (= list): no margin text, approval shown, generic "checked against cost" note.
- Save at Rs 47: Waiting for approval Price check. No stock is held until then. Waiting for Anitha R. Order: waiting

## D. Found by the separate checker on the v23 builds (5 rounds), fixed and rechecked

The checker had your v22 recheck file and was told to hunt for new ways round each fix. Its last round: PASS, no High or Med gap open.

| ID | Level | Way round it found | Fix (rechecked by the checker) |
|---|---|---|---|
| N1 | High | "Bring back" on a new staff member still waiting made him active (signed a Rs 86,400 PO) | No Bring back while waiting; bringing back anyone who can sign waits for a second Admin |
| N2 | High | One Admin marks the other as left to open the override | Your choice: an override never uses an absence its own Admin made (7 days with a daily notice if he marked it; 2 days if someone else did; leave he entered never counts). Admins record their own leave |
| N3 | Med | Abnormal loss could not be approved while another write-off waited on the shelf | Write-off room counted per batch; a write-off with no batch takes other batches first |
| N4 | Med | Sales added a customer straight on the Distributor list | Starts on a standard-list type; the wanted type waits for Accounts or an Admin |
| N5 | Med | A new supplier counted as a known payee | A supplier is a payee only once its bank is approved |
| N6 | Low | The "treat October as ended" test tool stayed on for the next user | Works only for the Super admin who pressed it |
| N7 | Low | A move of a named batch took another batch | A named batch is the only batch taken; packs a packer scanned are left |
| N8 | Low | A transfer sent an expired batch | Transfers skip expired and scanned packs |
| N9 | Low | A first standard cost of Rs 1 needed no approval | A first cost below the average cost waits |
| N10 | Low | Taking Customers Edit off the Sales role kept her customers | Refused until they are handed over |
| N11 | Med | Packs could stay on QC hold for good after a second reject | A rejected re-check write-off goes back to "Check again" |
| N12 | High | An override could add a new Admin, who then signed everything | No override on anything that changes who can sign |
| N13 | Med | One Admin demoted the other alone | Taking the Admin role away waits for a second Admin |
| N14 | Med | Narrowing the other Admin to one godown and Rs 1 did the same | Narrowing an Admin's godowns or limit waits for a second Admin |
| N15 | Low | Very long leave entered for the other Admin | Leave entered for another Admin is at most 30 days and never changes a leave they entered |

Also found in the first round and fixed: PD2 (the packs sent back to QC hold could not be cleared and the average counted them twice: now a "Check again" box on the run and on the QC page, the average moves only on pass), Y2 (trip 2 also asked for trip 1's shortfall), Y7 (debit note first, cancel after), Y9 (QC hold after Finish valued at Rs 0: now at run or PO cost).

Known limits:
- Without See cost, Sales cannot see cost or the margin trigger on the form. But when a "Price check" is raised at save, they can tell one was needed. Each try leaves a request in Approvals.
- The marked Admin cannot cancel during the 7 or 2 days himself; the daily notices and a Super admin bringing him back are the remedy.
- Cashback after a return (W2) was proved by the script; the checker could not try it on screen because the wallet is off in the starting data.
