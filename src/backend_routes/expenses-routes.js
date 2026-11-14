// Section 17 screens' API (phase 23, v23 viewExpenses / viewPetty / viewExport / viewExpHist and their drawers; rules in
// expenses.js and tally.js). Rights: the "Expenses and accounting export" row (view: the pages; create: record expenses,
// repeating ones, petty cash spends, top-ups and counts; edit: a box's float; cancel: cancel an expense; export: Export
// to accountant, its files, the ledger names). Every list follows the godowns a person works at.
const expenses = require('./expenses');
const tally = require('./tally');
const books = require('./books');
const godowns = require('./godowns');
const pricing = require('./pricing');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const STATUS_TAB = { recorded: ['done'], waiting: ['waiting'], drafts: ['draft'], closed: ['rejected', 'cancelled'] };

function register({ route, tx, db, by, InputError, canDo, commerceGate, upload }) {
  const G = { before: [commerceGate] };
  const asErr = (e) => {
    if (e && !(e instanceof InputError) && Number(e.status) >= 400 && Number(e.status) < 500) { const x = new InputError(e.message, e.status); if (e.fields) { x.code = 'fields'; x.fields = e.fields; } return x; }
    return e;
  };
  const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (e) { throw asErr(e); } };
  const list = (req) => godowns.viewScope(req) || 'ALL'; // what a list shows
  const works = (req) => godowns.scopeOf(req.admin) || 'ALL'; // where one may record
  const inList = (sc, col) => (sc === 'ALL' ? ['1 = 1', []] : godowns.where(col, sc));
  const can = (req) => ({ create: canDo(req, 'expenses', 'create'), edit: canDo(req, 'expenses', 'edit'), approve: canDo(req, 'expenses', 'approve'), cancel: canDo(req, 'expenses', 'cancel'), export: canDo(req, 'expenses', 'export') });
  const d10 = (d) => (typeof d === 'string' ? d.slice(0, 10) : new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10));

  // ============================================================================================ expenses
  route('get', '/money/expenses', 'expenses:view', wrap(async (req) => {
    const sc = list(req);
    const [gw, gp] = inList(sc, 'e.godown_id');
    const tab = STATUS_TAB[req.query.tab] ? req.query.tab : 'recorded';
    const [rows] = await db.query(`SELECT e.expense_id, e.expense_no, DATE_FORMAT(e.exp_date, '%Y-%m-%d') AS date, e.godown_id, g.name AS godown, e.head_key, h.name AS head, h.itc AS head_itc, e.payee_name, e.amount, e.gst_rate,
        e.gst_amount, e.total, e.itc, e.mode, e.reference, e.status, e.po_id, e.repeat_id, e.rej_note, e.created_by, (e.photo IS NOT NULL) AS has_photo,
        (SELECT 1 FROM month_exports m WHERE m.month = DATE_FORMAT(e.exp_date, '%Y-%m')) AS locked
        FROM expenses e JOIN expense_heads h ON h.head_key = e.head_key JOIN locations g ON g.location_id = e.godown_id WHERE ${gw} ORDER BY e.exp_date DESC, e.expense_id DESC LIMIT 500`, gp);
    const all = rows.map((r) => ({ ...r, amount: Number(r.amount), gst_rate: Number(r.gst_rate), gst_amount: Number(r.gst_amount), total: Number(r.total), itc: Number(r.itc) === 1, locked: Boolean(r.locked), has_photo: Boolean(Number(r.has_photo)) }));
    const m = pricing.istToday().slice(0, 7);
    const mon = all.filter((e) => e.status === 'done' && e.date.slice(0, 7) === m);
    const byHead = {}; mon.forEach((e) => { byHead[e.head] = r2((byHead[e.head] || 0) + e.total); });
    const big = Object.entries(byHead).sort((a, b) => b[1] - a[1])[0];
    const [heads] = await db.query('SELECT head_key, name, itc, ledger, for_po FROM expense_heads WHERE is_active = 1 ORDER BY sort_order');
    const [[rule]] = await db.query("SELECT is_on, limit_value FROM approval_rules WHERE kind = 'expense'");
    return {
      tab, counts: Object.fromEntries(Object.entries(STATUS_TAB).map(([k, st]) => [k, all.filter((e) => st.includes(e.status)).length])),
      rows: all.filter((e) => STATUS_TAB[tab].includes(e.status)),
      stats: { spent: r2(mon.reduce((a, e) => a + e.total, 0)), count: mon.length, gst_claim: r2(mon.filter((e) => e.itc).reduce((a, e) => a + e.gst_amount, 0)), biggest: big ? { head: big[0], total: big[1] } : null },
      repeats_due: await expenses.repeatsDue(db, sc),
      heads: heads.map((h) => ({ ...h, itc: Number(h.itc) === 1, for_po: Number(h.for_po) === 1 })), modes: expenses.MODES, gst_rates: expenses.GST_RATES, statusLabels: expenses.STATUS,
      rule: rule && Number(rule.is_on) ? Number(rule.limit_value) : null, can: can(req),
    };
  }), G);
  // the New expense form: payees, my godowns with their petty cash, purchase orders for freight in, the money rule
  route('get', '/money/expense-form', 'expenses:create', wrap(async (req) => {
    const sc = works(req);
    const [gs] = await db.query('SELECT location_id AS godown_id, name, state FROM locations WHERE is_active = 1 ORDER BY sort_order, location_id');
    const mine = gs.filter((g) => sc === 'ALL' || sc.includes(Number(g.godown_id)));
    for (const g of mine) g.petty = await expenses.pettyFree(db, g.godown_id);
    const [pos] = await db.query("SELECT po_no, s.name AS supplier, DATE_FORMAT(CONVERT_TZ(p.created_at, '+00:00', '+05:30'), '%Y-%m-%d') AS d FROM purchase_orders p JOIN suppliers s ON s.supplier_id = p.supplier_id WHERE p.status NOT IN ('draft', 'cancelled', 'rejected') AND p.po_no IS NOT NULL ORDER BY p.po_id DESC LIMIT 60");
    const [[rule]] = await db.query("SELECT is_on, limit_value FROM approval_rules WHERE kind = 'expense'");
    return { today: pricing.istToday(), godowns: mine, payees: (await expenses.payeeList(db)).map((p) => ({ name: p.name, pan: p.pan, gstin: p.gstin })), pos,
      rule: rule && Number(rule.is_on) ? Number(rule.limit_value) : null };
  }), G);
  route('get', '/money/expenses/:no', 'expenses:view', wrap(async (req) => {
    const [[e]] = await db.query(`SELECT e.expense_id, e.expense_no, DATE_FORMAT(e.exp_date, '%Y-%m-%d') AS date, e.godown_id, g.name AS godown, e.head_key, h.name AS head, h.ledger, h.for_po, e.payee_id, e.payee_name,
        e.amount, e.gst_rate, e.gst_amount, e.total, e.gstin, e.itc, e.inter_state, e.mode, e.reference, e.note, e.status, e.rej_note, e.cancel_reason, e.created_by, e.done_by, e.repeat_id, (e.photo IS NOT NULL) AS has_photo,
        (SELECT po_no FROM purchase_orders WHERE po_id = e.po_id) AS po_no, (SELECT pan FROM payees WHERE payee_id = e.payee_id) AS pan
        FROM expenses e JOIN expense_heads h ON h.head_key = e.head_key JOIN locations g ON g.location_id = e.godown_id WHERE e.expense_no = ?`, [req.params.no]);
    if (!e) throw new InputError('No such expense', 404);
    godowns.assertSees(req, e.godown_id);
    const [appr] = await db.query("SELECT approval_id, kind, status, summary, requested_by, decided_by, note FROM approvals WHERE ref_type = 'expense' AND ref_id = ? ORDER BY approval_id", [e.expense_no]);
    return { ...e, amount: Number(e.amount), gst_rate: Number(e.gst_rate), gst_amount: Number(e.gst_amount), total: Number(e.total), itc: Number(e.itc) === 1, inter_state: Number(e.inter_state) === 1,
      has_photo: Boolean(Number(e.has_photo)), locked: !!(await books.lockWhy(db, e.date)), mode_label: expenses.MODES[e.mode], status_label: expenses.STATUS[e.status],
      repeat: e.repeat_id ? `REP-${String(e.repeat_id).padStart(2, '0')}` : null, approvals: appr, can: can(req) };
  }), G);
  route('post', '/money/expenses', 'expenses:create', wrap(async (req) => {
    const b = { ...req.body, new_payee: ['1', 'true', true, 'on'].includes(req.body.new_payee) };
    return tx((q) => expenses.save(q, b, by(req), { scope: works(req), photo: req.file || null }));
  }), { before: [commerceGate, upload(8)], status: 201 });
  route('post', '/money/expenses/:no/save', 'expenses:create', wrap(async (req) => {
    const [[e]] = await db.query('SELECT expense_id, godown_id FROM expenses WHERE expense_no = ?', [req.params.no]);
    if (!e) throw new InputError('No such expense', 404);
    godowns.assertSees(req, e.godown_id);
    const b = { ...req.body, new_payee: ['1', 'true', true, 'on'].includes(req.body.new_payee) };
    return tx((q) => expenses.save(q, b, by(req), { scope: works(req), expenseId: e.expense_id, photo: req.file || null }));
  }), { before: [commerceGate, upload(8)] });
  route('post', '/money/expenses/:no/cancel', 'expenses:cancel', wrap(async (req) => {
    const [[e]] = await db.query('SELECT expense_id, godown_id FROM expenses WHERE expense_no = ?', [req.params.no]);
    if (!e) throw new InputError('No such expense', 404);
    godowns.assertSees(req, e.godown_id);
    return tx((q) => expenses.cancel(q, e.expense_id, req.body.reason, by(req)));
  }), G);
  route('get', '/money/expenses/:no/photo', 'expenses:view', async (req, res) => {
    const [[e]] = await db.query('SELECT photo, photo_type, godown_id FROM expenses WHERE expense_no = ?', [req.params.no]);
    if (!e || !e.photo) throw new InputError('No photo', 404);
    godowns.assertSees(req, e.godown_id);
    res.set({ 'Content-Type': e.photo_type || 'image/jpeg', 'Cache-Control': 'private, no-store' });
    res.send(e.photo);
  }, G);
  route('post', '/money/expenses-drafts', 'expenses:create', wrap(async (req) => {
    const made = await tx((q) => expenses.makeDrafts(q, works(req), by(req)));
    return { made, message: made.length ? `${made.length} draft${made.length === 1 ? '' : 's'} made: ${made.map((x) => `${x.expense_no} ${x.head}`).join(', ')}` : 'Nothing is due.' };
  }), G);
  route('get', '/money/expense-repeats', 'expenses:view', wrap(async () => {
    const [rows] = await db.query(`SELECT r.repeat_id, h.name AS head, r.payee_name, r.amount, r.gst_rate, r.mode, g.name AS godown, r.day_of_month, DATE_FORMAT(r.next_date, '%Y-%m-%d') AS next_date, r.is_active
        FROM expense_repeats r JOIN expense_heads h ON h.head_key = r.head_key JOIN locations g ON g.location_id = r.godown_id ORDER BY r.repeat_id`);
    return rows.map((r) => ({ ...r, code: `REP-${String(r.repeat_id).padStart(2, '0')}`, amount: Number(r.amount), gst_rate: Number(r.gst_rate), is_active: Number(r.is_active) === 1 }));
  }), G);
  route('post', '/money/expense-repeats', 'expenses:create', wrap(async (req) => tx((q) => expenses.saveRepeat(q, req.body || {}, by(req), works(req)))), { ...G, status: 201 });

  // ============================================================================================ petty cash
  route('get', '/money/petty', 'expenses:view', wrap(async (req) => ({ boxes: await expenses.boxes(db, list(req)), can: can(req) })), G);
  const box = (req) => { const g = Number(req.params.godown); const sc = works(req); if (sc !== 'ALL' && !sc.includes(g)) throw new InputError('You do not work at that godown', 403); return g; };
  route('post', '/money/petty/:godown/float', 'expenses:edit', wrap(async (req) => tx((q) => expenses.setFloat(q, box(req), req.body.float, by(req)))), G);
  route('post', '/money/petty/:godown/topup', 'expenses:create', wrap(async (req) => tx((q) => expenses.topUp(q, box(req), req.body.amount, by(req)))), G);
  route('post', '/money/petty/:godown/count', 'expenses:create', wrap(async (req) => tx((q) => expenses.count(q, box(req), req.body.counted, by(req)))), G);

  // ============================================================================================ export to accountant
  const months = () => { const out = []; let m = pricing.istToday().slice(0, 7); for (let i = 0; i < 7; i += 1) { out.push(m); const d = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 2, 1)); m = d.toISOString().slice(0, 7); } return out; };
  route('get', '/money/accounting', 'expenses:view', wrap(async (req) => {
    const ms = months();
    const month = books.isMonth(req.query.month) ? String(req.query.month) : ms[1];
    const [[done]] = await db.query("SELECT month, DATE_FORMAT(CONVERT_TZ(exported_at, '+00:00', '+05:30'), '%Y-%m-%d %H:%i') AS at, exported_by, times FROM month_exports WHERE month = ?", [month]);
    const [ex] = await db.query('SELECT month FROM month_exports');
    const V = await tally.vouchers(db, month);
    const issues = await tally.checks(db, month, { again: Boolean(done) });
    const counts = {}; V.forEach((v) => { counts[v.type] = (counts[v.type] || 0) + 1; });
    const names = await tally.ledgerNames(db);
    return { month, months: ms.map((m) => ({ month: m, exported: ex.some((x) => x.month === m) })), done: done || null, issues, ok: !issues.length, counts,
      vouchers: V.map((v) => ({ type: v.type, no: v.no, date: v.date, party: v.party, ledgers: v.ents.map((e) => e[0]), debit: r2(-v.ents.filter((e) => e[1] < 0).reduce((a, e) => a + e[1], 0)), credit: r2(v.ents.filter((e) => e[1] > 0).reduce((a, e) => a + e[1], 0)) })),
      ledgers: names.rows, heads: names.heads, can: can(req) };
  }), G);
  route('post', '/money/accounting/:month/export', 'expenses:export', wrap(async (req) => {
    const out = await tx((q) => tally.exportMonth(q, String(req.params.month), by(req)));
    return { month: out.month, xml_name: out.xml_name, csv_name: out.csv_name, vouchers: out.vouchers, sent: out.sent, totals: out.totals, message: `${out.month} exported: ${out.sent} voucher${out.sent === 1 ? '' : 's'}. The month is locked.` };
  }), G);
  const fileRoute = (kind) => route('get', `/money/accounting/:month/${kind}`, 'expenses:export', async (req, res) => {
    req.params.kind = kind;
    const [[m]] = await db.query('SELECT xml_name, xml_body, file_name, csv_body FROM month_exports WHERE month = ?', [req.params.month]);
    if (!m || !(req.params.kind === 'xml' ? m.xml_body : m.csv_body)) throw new InputError('No file for that month', 404);
    const xml = req.params.kind === 'xml';
    res.set({ 'Content-Type': xml ? 'application/xml; charset=utf-8' : 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${xml ? m.xml_name : m.file_name}"`, 'Cache-Control': 'no-store' });
    res.send(xml ? m.xml_body : m.csv_body);
  }, G);
  fileRoute('xml'); fileRoute('csv');
  route('put', '/money/accounting/ledgers', 'expenses:export', wrap(async (req) => tx((q) => tally.saveNames(q, req.body || {}, by(req)))), G);
  route('get', '/money/accounting-history', 'expenses:view', wrap(async (req) => {
    const [rows] = await db.query("SELECT month, DATE_FORMAT(CONVERT_TZ(exported_at, '+00:00', '+05:30'), '%Y-%m-%d %H:%i') AS at, exported_by, file_name, xml_name, `lines`, vouchers, totals, times, (xml_body IS NOT NULL) AS has_files FROM month_exports ORDER BY month DESC");
    const [events] = await db.query("SELECT event_id, month, kind, record_key, label, emp_id, DATE_FORMAT(CONVERT_TZ(`at`, '+00:00', '+05:30'), '%Y-%m-%d %H:%i') AS at FROM export_events ORDER BY event_id DESC LIMIT 300");
    const [changes] = await db.query("SELECT approval_id, summary, status, requested_by, decided_by, DATE_FORMAT(CONVERT_TZ(requested_at, '+00:00', '+05:30'), '%Y-%m-%d %H:%i') AS at FROM approvals WHERE kind = 'after_export' ORDER BY approval_id DESC LIMIT 200");
    return { months: rows.map((r) => { const t = r.totals ? (typeof r.totals === 'string' ? JSON.parse(r.totals) : r.totals) : null; if (t) delete t.sent; return { ...r, totals: t, has_files: Boolean(Number(r.has_files)) }; }),
      events, changes, can: can(req) };
  }), G);
  void d10;
}

module.exports = { register };
