# Phase 12b - Core engines, part 2: second Admin, override, month lock, Admin alerts

Branch: `stage2` only. Needs phase 12a done. Read first: `CLAUDE.md`, `docs/STAGE2-GAP-MAP.md`,
`docs/reference/dFresh_Back_Office_v23.html` (Approvals, Staff, Roles, Approval rules, Switches, Company,
Export to accountant; Tests page sections 0, G and H), and `docs/reference/dFresh_v23_Fix_Proof.md` (section D:
the 15 ways round the separate checker found - every one must stay closed).

## Steps
1. Second-Admin gate. These wait for a second Admin (kind `rule_change`, never signed by a stand-in):
   switching a rule off or raising its limit; any switch that loosens a control (split shipments on, freight into
   cost off, wallet max up, request expiry longer, days that count together shorter...); widening a role's rights
   (any Approve, a limit, See cost, Buying Edit); adding staff who can sign (they stay inactive until approved);
   bringing back someone who can sign; a higher personal limit; a wider godown scope; taking the Admin role away;
   narrowing an Admin's godowns or lowering an Admin's limit; a lower standard cost or lowest allowed price.
   The three locked rules (company bank, supplier bank, rule change) can never be switched off.
2. Override (Shoban's decisions). Allowed only when the system shows every other Admin away, with a reason of 10+
   letters in the audit log; applies 24 hours later; all Admins and Super admins get an e-mail and WhatsApp in the
   Outbox at once (prepared, never sent); any Admin can cancel; it re-checks "away" when it applies and stops if
   the other Admin is back. Never for: bank or UPI changes, the locked rules, and anything that changes who can
   sign (staff add, role, limit, scope, rights). "Never by the marker": an override never uses a leave or "left"
   that the overrider recorded himself; left marked by him counts only after 7 days with a daily Outbox notice,
   left marked by someone else after 2 days. The 24-hour clock is checked every minute, not only on page load.
3. Month lock. Company > System: "Books closed up to" date. Exporting a month to the CA locks it. Every dated
   save checks the lock on the record's own date (not today): invoices, notes, receipts, bills, expenses, stock
   moves, write-offs, petty cash, wallet credits, bad debts. An approval signed later checks the record's date too.
   A locked record can only change through an "unlock" request; the CA is told in Export history.
   Only a finished month can be exported; export is refused while any request dated in that month still waits.
4. Admin alerts: Outbox messages for override set / applied / cancelled, an Admin marked as left, leave recorded
   for another Admin.
5. Screens: Approvals cards show the override form only when allowed, with the reason and the 24-hour countdown;
   Staff shows "Waiting for a second Admin" instead of Bring back; Switches and Approval rules show which changes
   will wait.

## Acceptance (real output)
- Script each of the checker's ways round from the proof file section D that touch this phase (N1, N2, N12, N13,
  N14, N15, F1, F4, Y3, Y5, Y10, T2, Y1) and paste the result of each: must be refused or waiting.
- Run the v23 in-app tests (Tests page, tabs "v22 fixes" and "v23 fixes") on override, second Admin and the locked month; paste results.
- Month lock: a record dated in a locked month is refused in each of the save types listed in step 3.
- Everything from 11 and 12a still works (148 entries, commerce flows, unit tests).
- No long dash characters.

Commit: `phase 12b: core - second Admin, override, month lock, Admin alerts`. Move this file to
`docs/claude-tasks/done/`, STOP and report.
