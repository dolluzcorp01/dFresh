// Phase 21: the API of the Money and GST screens (sections 10 and 11, v23). Rules in billing.js (invoices, notes,
// challans, e-way bill, e-invoice, GSTR data) and money.js (receipts, cheques, refunds, bad debts, the ledger).
// Invoicing and GST is its own right ("invoicing"); Payments is "money". Lists follow the godowns a person works at (an
// invoice by its order's godown); Sales with "Own customers only" see and collect from their own customers only, and
// supplier payments, refunds and write-offs are for the office. Every change is audited (in the rules).
const billing = require('./billing');
const money = require('./money');
const godowns = require('./godowns');
const pricing = require('./pricing');
const reports = require('./reports');
const commerceSettings = require('./commerce-settings');
const company = require('./company');
const csv = require('./csv');
const auth = require('./auth');

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => (v === null || v === undefined ? null : Number(v));
const IST = (col) => `DATE_FORMAT(CONVERT_TZ(${col}, '+00:00', '+05:30'), '%Y-%m-%d')`;
const SKU_NAME = 'COALESCE(t.name, pt.name, s.product_id)';
const SKU_JOIN = `JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'`;
const IMG = '(SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1)';
const STATE = { open: 'Unpaid', part: 'Part paid', paid: 'Paid', overdue: 'Overdue', cancelled: 'Cancelled', cancelwait: 'Cancel waiting' };

function register({ route, tx, db, by, InputError, canDo, commerceGate }) {
  const G = { before: [commerceGate] };
  const asErr = (e) => {
    // the rule modules' own errors (billing, money, books, invoices, stock, approvals) carry a 4xx status: shown as they are
    if (e && !(e instanceof InputError) && Number(e.status) >= 400 && Number(e.status) < 500) {
      const x = new InputError(e.message, e.status || 400); if (e.fields) { x.code = 'fields'; x.fields = e.fields; } return x;
    }
    return e;
  };
  const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (e) { throw asErr(e); } };
  const scope = (req, col) => godowns.where(col, godowns.viewScope(req));
  const own = (req) => (req.admin && req.admin.ownOnly ? req.admin.emp_id : null);
  const office = (req) => !own(req);
  async function names(q, ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return new Map();
    const [rows] = await q.query(`SELECT emp_id, TRIM(CONCAT(COALESCE(emp_first_name, ''), ' ', COALESCE(emp_last_name, ''))) AS name FROM \`${auth.DADMIN}\`.employee WHERE emp_id IN (?)`, [list]);
    return new Map(rows.map((r) => [r.emp_id, r.name || r.emp_id]));
  }
  async function firstItems(q, orderIds) {
    if (!orderIds.length) return new Map();
    const [rows] = await q.query(`SELECT it.order_id, it.sku_code, ${SKU_NAME} AS name, ${IMG} AS image FROM order_items it JOIN skus s ON s.sku_code = it.sku_code ${SKU_JOIN}
        WHERE it.line_id IN (SELECT MIN(x.line_id) FROM order_items x WHERE x.order_id IN (?) GROUP BY x.order_id)`, [orderIds]);
    return new Map(rows.map((r) => [r.order_id, r]));
  }
  /** the customers a person may see here (own customers only for Sales), as SQL on a customers alias */
  const custWhere = (req, alias = 'cu') => (own(req) ? [`${alias}.owner_emp_id = ?`, [own(req)]] : ['1 = 1', []]);
  async function assertCustomer(q, req, customerId) {
    const [[c]] = await q.query('SELECT customer_id, owner_emp_id FROM customers WHERE customer_id = ?', [Number(customerId)]);
    if (!c) throw new InputError('No such customer', 404);
    if (own(req) && c.owner_emp_id !== own(req)) throw new InputError('Not one of your customers', 403);
    return c;
  }
  const coWarn = async (q) => {
    const cs = await commerceSettings.read(q);
    const co = await company.facts(q);
    const missing = [!co.gstin && 'GSTIN', !co.pan && 'PAN', !co.bank && 'bank'].filter(Boolean);
    return { demo: commerceSettings.invoiceIsDemo(cs), missing };
  };

  // ============================================================================================ invoices
  /** an invoice's state for the lists */
  const stateOf = (v, today) => {
    if (v.status === 'cancelled') return 'cancelled';
    if (v.cancel_waiting) return 'cancelwait';
    if (Number(v.amount_due) <= 0.005) return 'paid';
    if (Number(v.amount_due) < Number(v.total) - 0.005) return 'part';
    return v.due_day < today ? 'overdue' : 'open';
  };
  route('get', '/billing/invoices', 'invoicing:view', wrap(async (req) => {
    const [gw, gp] = scope(req, 'o.godown_id');
    const ready = await billing.toInvoice(db, gw, gp);
    const fi = await firstItems(db, ready.map((o) => o.order_id));
    const [rows] = await db.query(`SELECT i.invoice_id, i.invoice_no, i.status, i.total, i.gst_type, i.buyer_json, ${IST('i.issued_at')} AS day, DATE_FORMAT(i.due_on, '%Y-%m-%d') AS due_day, i.ewb_no, i.irn, i.is_demo,
        o.order_no, o.order_id, o.amount_due, o.eway_bill_no AS order_ewb, o.customer_id, o.godown_id, c.name AS customer, c.customer_no, g.name AS godown,
        (SELECT a.approval_id FROM approvals a WHERE a.approval_id = i.cancel_approval_id AND a.status = 'pending') AS cancel_waiting
        FROM invoices i JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id JOIN locations g ON g.location_id = o.godown_id
       WHERE ${gw} ORDER BY i.issued_at DESC, i.invoice_id DESC LIMIT 500`, gp);
    const today = pricing.istToday();
    const ru = await billing.rules(db);
    const out = [];
    for (const v of rows) {
      const b = typeof v.buyer_json === 'string' ? JSON.parse(v.buyer_json) : v.buyer_json;
      const st = stateOf(v, today);
      let papers = [];
      if (v.status === 'issued') papers = await billing.papersMissing(db, { ...v, buyer: b, invoice_id: v.invoice_id });
      out.push({ invoice_no: v.invoice_no, order_no: v.order_no, day: v.day, due_on: v.due_day, customer: v.customer, customer_no: v.customer_no, godown: v.godown, kind: b.bill.gstin ? 'B2B' : 'B2C',
        inter: v.gst_type === 'inter', total: num(v.total), left: v.status === 'issued' ? num(v.amount_due) : 0, state: st, state_label: STATE[st], ewb: v.ewb_no || v.order_ewb || null, irn: Boolean(v.irn), papers });
    }
    const groups = { unpaid: ['open', 'part', 'overdue', 'cancelwait'], paid: ['paid'], cancelled: ['cancelled'] };
    return {
      to_invoice: ready.map((o) => ({ order_no: o.order_no, customer: o.customer, customer_no: o.customer_no, delivery_kind: o.delivery_kind, total: num(o.total), packed: o.packed, packed_at: o.packed_at, parent: Boolean(o.parent_id),
        first_name: (fi.get(o.order_id) || {}).name || o.first_sku, first_image: (fi.get(o.order_id) || {}).image || null })),
      unpaid: out.filter((x) => groups.unpaid.includes(x.state)), paid: out.filter((x) => groups.paid.includes(x.state)), cancelled: out.filter((x) => groups.cancelled.includes(x.state)),
      counts: { to_invoice: ready.length, unpaid: out.filter((x) => groups.unpaid.includes(x.state)).length, paid: out.filter((x) => x.state === 'paid').length, cancelled: out.filter((x) => x.state === 'cancelled').length },
      company: await coWarn(db), rules: ru, can: { create: canDo(req, 'invoicing', 'create'), cancel: canDo(req, 'invoicing', 'cancel') },
    };
  }), G);

  async function linesOf(q, orderId) {
    const [rows] = await q.query(`SELECT it.sku_code, ${SKU_NAME} AS name, s.size_label, ${IMG} AS image, it.qty, it.price, it.is_free, it.free_why, it.gst_rate, it.taxable, it.hsn
        FROM order_items it JOIN skus s ON s.sku_code = it.sku_code ${SKU_JOIN} WHERE it.order_id = ? ORDER BY it.line_id`, [orderId]);
    return rows.map((l) => ({ ...l, price: num(l.price), gst_rate: num(l.gst_rate), taxable: num(l.taxable), is_free: Boolean(Number(l.is_free)) }));
  }
  route('get', '/billing/to-invoice/:no', 'invoicing:view', wrap(async (req) => {
    const p = await billing.preview(db, req.params.no, req.query.date ? String(req.query.date) : null);
    godowns.assertSees(req, p.order.godown_id);
    const [[o]] = await db.query(`SELECT o.*, c.name AS customer, c.business_name, c.customer_no FROM orders o JOIN customers c ON c.customer_id = o.customer_id WHERE o.order_id = ?`, [p.order.order_id]);
    return { order_no: o.order_no, customer: o.customer, legal: o.business_name || o.customer, customer_no: o.customer_no, gstin: o.bill_gstin, kind: p.kind, next_no: p.next_no, day: p.day, order_day: p.order.order_day, today: pricing.istToday(),
      place: o.place_of_supply, inter: o.gst_type === 'inter', due_days: p.due_days, terms: o.payment_terms, lines: await linesOf(db, o.order_id),
      totals: { taxable: num(o.taxable), delivery_charge: num(o.delivery_charge), delivery_gst: num(o.delivery_gst), cgst: num(o.cgst), sgst: num(o.sgst), igst: num(o.igst), round_off: num(o.round_off), total: num(o.total) },
      needs: p.needs, status: o.status };
  }), G);
  route('post', '/billing/invoices', 'invoicing:create', wrap(async (req) => {
    const [[o]] = await db.query('SELECT godown_id FROM orders WHERE order_no = ?', [String(req.body.order_no || '')]);
    if (!o) throw new InputError('No such order', 404);
    godowns.assertSees(req, o.godown_id);
    return tx((q) => billing.makeInvoice(q, String(req.body.order_no), req.body || {}, by(req)));
  }), G);
  route('get', '/billing/invoices/:no', 'invoicing:view', wrap(async (req) => {
    const v = await billing.invoiceRow(db, 'i.invoice_no = ?', [req.params.no]);
    if (!v) throw new InputError('No such invoice', 404);
    godowns.assertSees(req, v.godown_id);
    const [cns] = await db.query("SELECT credit_note_no AS no, reason, total, status, kind FROM credit_notes WHERE invoice_id = ? ORDER BY credit_note_id", [v.invoice_id]);
    const [dns] = await db.query("SELECT debit_note_no AS no, reason, total, status FROM debit_notes WHERE invoice_id = ? ORDER BY debit_note_id", [v.invoice_id]);
    const [[w]] = await db.query("SELECT approval_id, summary FROM approvals WHERE approval_id = ? AND status = 'pending'", [v.cancel_approval_id || 0]);
    const papers = await billing.papersMissing(db, v);
    const n = v.status === 'issued' ? await billing.needs(db, { total: v.total, customerId: v.customer_id, godownId: v.godown_id, day: v.day, gstin: v.buyer.bill.gstin, invoiceId: v.invoice_id }) : { ewb: '', irn: false };
    const block = v.status === 'issued' ? await billing.cancelBlock(db, v) : '';
    const nm = await names(db, [v.emp_id, v.cancelled_by]);
    const st = stateOf({ ...v, cancel_waiting: w ? w.approval_id : null }, pricing.istToday());
    return { invoice_no: v.invoice_no, order_no: v.order_no, day: v.day, due_on: v.due_day, customer: v.customer, customer_no: v.customer_no, buyer: v.buyer, kind: v.buyer.bill.gstin ? 'B2B' : 'B2C', place: v.place_of_supply, inter: v.gst_type === 'inter',
      state: st, state_label: STATE[st], total: num(v.total), left: v.status === 'issued' ? num(v.amount_due) : 0, ewb_no: v.ewb_no || v.order_ewb, ewb_valid: v.ewb_valid ? String(v.ewb_valid instanceof Date ? v.ewb_valid.toISOString().slice(0, 10) : v.ewb_valid).slice(0, 10) : null,
      irn: v.irn, ack_no: v.ack_no, note: v.note, made_by: nm.get(v.emp_id) || v.emp_id, made_at: v.issued_at, cancel_reason: v.cancel_reason, cancelled_by: v.cancelled_by ? (nm.get(v.cancelled_by) || v.cancelled_by) : null,
      cancel_waiting: w ? { approval_id: w.approval_id, why: v.cancel_ask_why, summary: w.summary } : null, papers, needs: n, cancel_block: block,
      lines: await linesOf(db, v.order_id), totals: { taxable: num(v.taxable), delivery_charge: num(v.delivery_charge), delivery_gst: num(v.delivery_gst), cgst: num(v.cgst), sgst: num(v.sgst), igst: num(v.igst), round_off: num(v.round_off), total: num(v.total) },
      notes: [...cns.map((x) => ({ ...x, total: num(x.total), type: 'Credit note' })), ...dns.map((x) => ({ ...x, total: num(x.total), type: 'Debit note' }))],
      can: { create: canDo(req, 'invoicing', 'create'), cancel: canDo(req, 'invoicing', 'cancel') } };
  }), G);
  route('get', '/billing/invoice-print/:no', 'invoicing:view', wrap(async (req) => { // the snapshot the PDF prints (doc-pdf.invoiceData)
    const [[i]] = await db.query('SELECT i.invoice_id, o.godown_id FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE i.invoice_no = ?', [req.params.no]);
    if (!i) throw new InputError('No such invoice', 404);
    godowns.assertSees(req, i.godown_id);
    return require('./doc-pdf').invoiceData(db, i.invoice_id); // eslint-disable-line global-require
  }), G);
  route('post', '/billing/invoices/:no/mail', 'invoicing:view', wrap(async (req) => { // to the invoice contacts, through the outbox
    const [[i]] = await db.query('SELECT i.invoice_id, i.invoice_no, o.godown_id FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE i.invoice_no = ?', [req.params.no]);
    if (!i) throw new InputError('No such invoice', 404);
    godowns.assertSees(req, i.godown_id);
    const notifications = require('./notifications'); // eslint-disable-line global-require
    return tx(async (q) => {
      const before = (await q.query('SELECT COALESCE(MAX(log_id), 0) AS m FROM notification_log'))[0][0].m;
      await notifications.invoiceIssued(q, i.invoice_id, { again: true });
      const [sent] = await q.query("SELECT recipient, status, skip_reason FROM notification_log WHERE log_id > ? AND event_key = 'invoice' ORDER BY log_id", [before]);
      const { audit } = require('./audit'); // eslint-disable-line global-require
      await audit(q, { empId: by(req), action: 'mail', entity: 'invoice', entityId: i.invoice_no, after: { to: sent.map((x) => x.recipient) } });
      return { message: sent.length ? `${i.invoice_no} with its PDF to ${sent.map((x) => `${x.recipient || 'no address'}${x.status === 'skipped' ? ` (not sent: ${x.skip_reason})` : ''}`).join(', ')}, through the Outbox.` : 'No invoice contact with an e-mail: add one to the customer first.' };
    });
  }), G);
  route('post', '/billing/invoices/:no/papers', 'invoicing:create', wrap(async (req) => tx((q) => billing.addPapers(q, req.params.no, req.body || {}, by(req)))), G);
  route('post', '/billing/invoices/:no/cancel', 'invoicing:cancel', wrap(async (req) => {
    const v = await billing.invoiceRow(db, 'i.invoice_no = ?', [req.params.no]);
    if (!v) throw new InputError('No such invoice', 404);
    godowns.assertSees(req, v.godown_id);
    return tx((q) => billing.askCancel(q, req.params.no, (req.body || {}).reason, by(req)));
  }), G);

  // ============================================================================================ credit notes
  route('get', '/billing/credit-notes', 'invoicing:view', wrap(async (req) => {
    const [gw, gp] = scope(req, 'o.godown_id');
    const [rows] = await db.query(`SELECT cn.credit_note_no, cn.status, cn.kind, cn.reason, cn.total, cn.taxable, ${IST('cn.issued_at')} AS day, cn.approval_id, cn.return_id, i.invoice_no, c.name AS customer, c.customer_no, r.return_no,
        (SELECT a.summary FROM approvals a WHERE a.approval_id = cn.approval_id) AS approval
        FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id
        LEFT JOIN returns r ON r.return_id = cn.return_id WHERE ${gw} ORDER BY cn.credit_note_id DESC LIMIT 500`, gp);
    const list = rows.map((x) => ({ ...x, total: num(x.total), taxable: num(x.taxable) }));
    // goods back from a delivery or a return are credited where they come back (phase 20 and Returns): nothing waits here
    const [due] = await db.query(`SELECT r.return_no, o.order_no, c.name AS customer, r.status FROM returns r JOIN orders o ON o.order_id = r.order_id JOIN customers c ON c.customer_id = o.customer_id
        WHERE ${gw} AND r.status IN ('approved', 'inspected') AND EXISTS (SELECT 1 FROM return_items ri WHERE ri.return_id = r.return_id AND ri.refund_qty > 0)
          AND NOT EXISTS (SELECT 1 FROM credit_notes cn WHERE cn.return_id = r.return_id AND cn.status <> 'rejected') ORDER BY r.return_id`, gp);
    const [invs] = await db.query(`SELECT i.invoice_no, c.name AS customer, i.total FROM invoices i JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id
        WHERE i.status = 'issued' AND ${gw} ORDER BY i.invoice_id DESC LIMIT 300`, gp);
    return { to_credit: due, waiting: list.filter((x) => x.status === 'waiting'), done: list.filter((x) => x.status === 'done'), rejected: list.filter((x) => x.status === 'rejected'),
      counts: { to_credit: due.length, waiting: list.filter((x) => x.status === 'waiting').length, done: list.filter((x) => x.status === 'done').length, rejected: list.filter((x) => x.status === 'rejected').length },
      invoices: invs.map((x) => ({ ...x, total: num(x.total) })), reasons: billing.CN_WHY, can: { create: canDo(req, 'invoicing', 'create') } };
  }), G);
  route('get', '/billing/credit-room/:no', 'invoicing:view', wrap(async (req) => {
    const v = await billing.invoiceRow(db, 'i.invoice_no = ?', [req.params.no]);
    if (!v) throw new InputError('No such invoice', 404);
    const room = await billing.noteRoom(db, v.invoice_id);
    return { ...room, taxable: r2(Number(v.taxable) + Number(v.delivery_charge)), rate: await billing.mainRate(db, v.order_id), inter: v.gst_type === 'inter' };
  }), G);
  route('post', '/billing/credit-notes', 'invoicing:create', wrap(async (req) => tx((q) => billing.creditPrice(q, req.body || {}, by(req)))), G);

  // ============================================================================================ debit notes
  route('get', '/billing/debit-notes', 'invoicing:view', wrap(async (req) => {
    const [gw, gp] = scope(req, 'd.godown_id');
    const [rows] = await db.query(`SELECT d.debit_note_no, d.reason, d.note, d.total, d.taxable, d.gst_rate, d.paid, ${IST('d.issued_at')} AS day, DATE_FORMAT(d.due_on, '%Y-%m-%d') AS due_on, i.invoice_no, c.name AS customer, c.customer_no
        FROM debit_notes d JOIN invoices i ON i.invoice_id = d.invoice_id JOIN customers c ON c.customer_id = d.customer_id WHERE ${gw} ORDER BY d.debit_note_id DESC LIMIT 500`, gp);
    const [ow, op] = scope(req, 'o.godown_id');
    const [invs] = await db.query(`SELECT i.invoice_no, c.name AS customer, i.total FROM invoices i JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id
        WHERE i.status = 'issued' AND ${ow} AND NOT EXISTS (SELECT 1 FROM approvals a WHERE a.approval_id = i.cancel_approval_id AND a.status = 'pending') ORDER BY i.invoice_id DESC LIMIT 300`, op);
    return { rows: rows.map((x) => ({ ...x, total: num(x.total), taxable: num(x.taxable), paid: num(x.paid), gst_rate: num(x.gst_rate) })), invoices: invs.map((x) => ({ ...x, total: num(x.total) })), reasons: billing.DN_WHY, can: { create: canDo(req, 'invoicing', 'create') } };
  }), G);
  route('post', '/billing/debit-notes', 'invoicing:create', wrap(async (req) => tx((q) => billing.debitNote(q, req.body || {}, by(req)))), G);
  route('get', '/billing/notes/:no', 'invoicing:view', wrap(async (req) => { // the print of a credit or debit note
    const no = req.params.no;
    const [[cn]] = await db.query(`SELECT 'Credit note' AS title, cn.credit_note_no AS no, ${IST('cn.issued_at')} AS day, cn.reason, cn.kind, cn.status, cn.taxable, cn.cgst, cn.sgst, cn.igst, cn.round_off, cn.total, cn.gst_rate, cn.credit_note_id AS id,
        i.invoice_no, i.buyer_json, i.place_of_supply, i.gst_type, i.seller_name, i.seller_gstin, i.seller_address, i.is_demo, i.order_id, NULL AS due_on FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id WHERE cn.credit_note_no = ?`, [no]);
    const [[dn]] = cn ? [[null]] : await db.query(`SELECT 'Debit note' AS title, d.debit_note_no AS no, ${IST('d.issued_at')} AS day, CONCAT(d.reason, IF(d.note IS NULL, '', CONCAT(': ', d.note))) AS reason, 'debit' AS kind, d.status, d.taxable, d.cgst, d.sgst, d.igst, d.round_off, d.total, d.gst_rate, d.debit_note_id AS id,
        i.invoice_no, i.buyer_json, i.place_of_supply, i.gst_type, i.seller_name, i.seller_gstin, i.seller_address, i.is_demo, i.order_id, DATE_FORMAT(d.due_on, '%Y-%m-%d') AS due_on FROM debit_notes d JOIN invoices i ON i.invoice_id = d.invoice_id WHERE d.debit_note_no = ?`, [no]);
    const x = cn || dn;
    if (!x) throw new InputError('No such note', 404);
    const [[hsn]] = await db.query('SELECT hsn FROM order_items WHERE order_id = ? AND is_free = 0 ORDER BY taxable DESC LIMIT 1', [x.order_id]);
    let lines = [];
    if (cn) {
      const [ls] = await db.query(`SELECT l.sku_code, ${SKU_NAME} AS name, s.size_label, l.hsn, l.gst_rate, l.qty, l.taxable FROM credit_note_lines l JOIN skus s ON s.sku_code = l.sku_code ${SKU_JOIN} WHERE l.credit_note_id = ?`, [x.id]);
      lines = ls.map((l) => ({ ...l, taxable: num(l.taxable), gst_rate: num(l.gst_rate) }));
    }
    const co = await company.facts(db);
    return { ...x, buyer: typeof x.buyer_json === 'string' ? JSON.parse(x.buyer_json) : x.buyer_json, buyer_json: undefined, main_hsn: hsn ? hsn.hsn : null, lines,
      taxable: num(x.taxable), cgst: num(x.cgst), sgst: num(x.sgst), igst: num(x.igst), round_off: num(x.round_off), total: num(x.total), gst_rate: num(x.gst_rate), demo: Boolean(Number(x.is_demo)),
      company: { name: co.name, gstin: co.gstin, address: co.address, declaration: co.declaration, terms: co.terms, signatory: co.signatory } };
  }), G);

  // ============================================================================================ delivery challans
  route('get', '/billing/challans', 'invoicing:view', wrap(async (req) => {
    const [gw, gp] = scope(req, 'd.godown_id');
    const [rows] = await db.query(`SELECT d.challan_id, d.challan_no, d.why, d.to_name, d.to_address, d.value, d.created_at, g.name AS godown,
        (SELECT GROUP_CONCAT(CONCAT(l.sku_code, ' ', l.qty) ORDER BY l.line_id SEPARATOR ', ') FROM delivery_challan_lines l WHERE l.challan_id = d.challan_id) AS items
        FROM delivery_challans d JOIN locations g ON g.location_id = d.godown_id WHERE ${gw} ORDER BY d.challan_id DESC LIMIT 300`, gp);
    const [tw, tp] = scope(req, 't.from_godown');
    const [trs] = await db.query(`SELECT t.transfer_no, t.sent_at AS created_at, t.value, gf.name AS from_name, gt.name AS to_name,
        (SELECT GROUP_CONCAT(CONCAT(l.sku_code, ' ', l.qty) ORDER BY l.line_no SEPARATOR ', ') FROM transfer_lines l WHERE l.transfer_id = t.transfer_id) AS items
        FROM transfers t JOIN locations gf ON gf.location_id = t.from_godown JOIN locations gt ON gt.location_id = t.to_godown WHERE ${tw} ORDER BY t.transfer_id DESC LIMIT 300`, tp);
    const list = [...rows.map((d) => ({ no: d.challan_no, at: d.created_at, to: `${d.to_name}, ${d.to_address}`, why: d.why, items: d.items, value: num(d.value), own: true, godown: d.godown })),
      ...trs.map((t) => ({ no: t.transfer_no, at: t.created_at, to: `${t.to_name} godown`, why: 'Stock transfer', items: t.items, value: num(t.value), own: false, godown: t.from_name }))]
      .sort((a, b) => (new Date(b.at) - new Date(a.at)));
    return { rows: list, reasons: billing.DC_WHY, godowns: (await godowns.list(db)).filter((g) => godowns.covers(req.admin, g.location_id) && Number(g.is_active)).map((g) => ({ id: g.location_id, name: g.name })), can: { create: canDo(req, 'invoicing', 'create') } };
  }), G);
  route('get', '/billing/challans/:no', 'invoicing:view', wrap(async (req) => {
    const [[d]] = await db.query('SELECT d.*, g.name AS godown, g.address AS g_address, g.city AS g_city FROM delivery_challans d JOIN locations g ON g.location_id = d.godown_id WHERE d.challan_no = ?', [req.params.no]);
    if (!d) throw new InputError('No such challan', 404);
    const [ls] = await db.query(`SELECT l.sku_code, ${SKU_NAME} AS name, s.size_label, p.hsn_code AS hsn, SUM(l.qty) AS qty FROM delivery_challan_lines l JOIN skus s ON s.sku_code = l.sku_code ${SKU_JOIN} WHERE l.challan_id = ? GROUP BY l.sku_code, name, s.size_label, p.hsn_code`, [d.challan_id]);
    const co = await company.facts(db);
    return { challan_no: d.challan_no, day: d.created_at, why: d.why, to_name: d.to_name, to_address: d.to_address, value: num(d.value), godown: d.godown, lines: ls.map((l) => ({ ...l, qty: Number(l.qty) })), company: { name: co.name, gstin: co.gstin, address: co.address } };
  }), G);
  route('post', '/billing/challans', 'invoicing:create', wrap(async (req) => {
    if (!godowns.covers(req.admin, Number((req.body || {}).godown_id))) throw new InputError('You do not work at that godown', 403);
    return tx((q) => billing.makeChallan(q, req.body || {}, by(req)));
  }), G);

  // ============================================================================================ GST
  // the recorded expenses of a month whose GST can be claimed (phase 23): the ITC on expenses in GSTR-3B input
  const itcRows = async (m, sc) => {
    const [w, wp] = godowns.where('e.godown_id', sc);
    const [r] = await db.query(`SELECT e.expense_no, DATE_FORMAT(e.exp_date, '%Y-%m-%d') AS date, e.payee_name, e.gstin, COALESCE(h.name, e.head_key) AS head, e.amount, e.gst_rate, e.gst_amount, e.inter_state
        FROM expenses e LEFT JOIN expense_heads h ON h.head_key = e.head_key
        WHERE e.status = 'done' AND e.itc = 1 AND DATE_FORMAT(e.exp_date, '%Y-%m') = ? AND ${w} ORDER BY e.exp_date, e.expense_no`, [m, ...wp])
      .catch((e) => { if (e.code === 'ER_NO_SUCH_TABLE') return [[]]; throw e; });
    return r.map((x) => ({ ...x, amount: Number(x.amount), gst_rate: Number(x.gst_rate), gst_amount: Number(x.gst_amount), inter_state: Boolean(x.inter_state) }));
  };
  const monthOf = (req) => { const m = String(req.query.month || pricing.istToday().slice(0, 7)); if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new InputError('Month: like 2026-10'); return m; };
  route('get', '/gst/month', 'invoicing:view', wrap(async (req) => {
    const m = monthOf(req);
    const sc = godowns.viewScope(req);
    const g1 = await reports.gst(db, { from: `${m}-01`, to: require('./books').lastDay(m), scope: sc }); // eslint-disable-line global-require
    const b3 = await billing.gstr3b(db, m, sc);
    const itcExpenses = await itcRows(m, sc);
    const [[cnt]] = await db.query(`SELECT (SELECT COUNT(*) FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE DATE_FORMAT(CONVERT_TZ(i.issued_at, '+00:00', '+05:30'), '%Y-%m') = ? AND NOT (i.status = 'cancelled' AND i.cancel_kind = 'alone') AND ${godowns.where('o.godown_id', sc)[0]}) AS inv,
        (SELECT COUNT(*) FROM credit_notes cn JOIN invoices i ON i.invoice_id = cn.invoice_id JOIN orders o ON o.order_id = i.order_id WHERE cn.status = 'done' AND DATE_FORMAT(CONVERT_TZ(cn.issued_at, '+00:00', '+05:30'), '%Y-%m') = ? AND ${godowns.where('o.godown_id', sc)[0]}) AS cn,
        (SELECT COUNT(*) FROM debit_notes d WHERE d.status = 'done' AND DATE_FORMAT(CONVERT_TZ(d.issued_at, '+00:00', '+05:30'), '%Y-%m') = ? AND ${godowns.where('d.godown_id', sc)[0]}) AS dn`,
    [m, ...godowns.where('o.godown_id', sc)[1], m, ...godowns.where('o.godown_id', sc)[1], m, ...godowns.where('d.godown_id', sc)[1]]);
    const months = []; let d = new Date(`${pricing.istToday().slice(0, 7)}-01T00:00:00Z`);
    for (let i = 0; i < 7; i += 1) { months.push(d.toISOString().slice(0, 7)); d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)); }
    return { month: m, months, counts: { invoices: Number(cnt.inv), credit_notes: Number(cnt.cn), debit_notes: Number(cnt.dn) }, gstr3b: b3, itc_expenses: itcExpenses, tables: g1.tables.filter((t) => ['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'hsn'].includes(t.key)), checks: g1.checks, can: { export: canDo(req, 'invoicing', 'export') } };
  }), G);
  route('get', '/gst/month.csv', 'invoicing:export', async (req, res) => {
    const m = monthOf(req);
    const sc = godowns.viewScope(req);
    const g1 = await reports.gst(db, { from: `${m}-01`, to: require('./books').lastDay(m), scope: sc }); // eslint-disable-line global-require
    const b3 = await billing.gstr3b(db, m, sc);
    const rows = [['section', 'document', 'date', 'gstin', 'place', 'rate', 'taxable', 'igst', 'cgst', 'sgst', 'total']];
    const T = (k) => g1.tables.find((t) => t.key === k).rows;
    T('b2b').forEach((x) => rows.push(['B2B', x.doc, x.date, x.gstin, x.pos, x.rate, x.taxable, x.igst, x.cgst, x.sgst, x.value]));
    T('b2cl').forEach((x) => rows.push(['B2CL', x.doc, x.date, '', x.pos, x.rate, x.taxable, x.igst, 0, 0, x.value]));
    T('b2cs').forEach((x) => rows.push(['B2CS', '', '', '', x.pos, x.rate, x.taxable, x.igst, x.cgst, x.sgst, '']));
    T('cdnr').forEach((x) => rows.push([x.note_type === 'D' ? 'CDN debit' : 'CDN credit', x.doc, x.date, x.gstin, x.pos, x.rate, x.note_type === 'D' ? x.taxable : -x.taxable, x.note_type === 'D' ? x.igst : -x.igst, x.note_type === 'D' ? x.cgst : -x.cgst, x.note_type === 'D' ? x.sgst : -x.sgst, x.note_type === 'D' ? x.value : -x.value]));
    T('cdnur').forEach((x) => rows.push([x.note_type === 'D' ? 'CDN debit' : 'CDN credit', x.doc, x.date, '', x.pos, x.rate, x.note_type === 'D' ? x.taxable : -x.taxable, x.note_type === 'D' ? x.igst : -x.igst, 0, 0, x.note_type === 'D' ? x.value : -x.value]));
    T('hsn').forEach((x) => rows.push(['HSN', x.hsn, '', '', '', x.rate, x.taxable, x.igst, x.cgst, x.sgst, `${x.qty} packs`]));
    rows.push(['3B output', '', '', '', '', '', b3.output.taxable, b3.output.igst, b3.output.cgst, b3.output.sgst, b3.output.tax]);
    rows.push(['3B input', `${b3.input.bills} supplier bills`, '', '', '', '', b3.input.taxable, b3.input.igst, b3.input.cgst, b3.input.sgst, b3.input.tax]);
    // phase 23: the ITC on expenses inside 3B input, one row per expense, then the month total (none: no rows, as before)
    for (const x of await itcRows(m, sc)) {
      const h = x.inter_state ? 0 : Math.round((x.gst_amount / 2) * 100) / 100;
      rows.push(['3B input ITC on expense', x.expense_no, x.date, x.gstin || '', '', x.gst_rate, x.amount, x.inter_state ? x.gst_amount : 0, h, x.inter_state ? 0 : Math.round((x.gst_amount - h) * 100) / 100, x.gst_amount]);
    }
    if (b3.input.parts.expenses.count) { const e = b3.input.parts.expenses; rows.push(['3B input ITC on expenses total', `${e.count} expenses`, '', '', '', '', e.taxable, e.igst, e.cgst, e.sgst, e.tax]); }
    rows.push(['3B to pay', '', '', '', '', '', '', b3.to_pay.igst, b3.to_pay.cgst, b3.to_pay.sgst, b3.to_pay.tax]);
    const { audit } = require('./audit'); // eslint-disable-line global-require
    await audit(db, { empId: by(req), action: 'export', entity: 'gst', entityId: m, after: { rows: rows.length - 1 } });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="dfresh-gst-${m}.csv"`, 'Cache-Control': 'no-store' });
    res.send(csv.stringify(rows));
  }, G);
  route('get', '/gst/papers', 'invoicing:view', wrap(async (req) => {
    const [gw, gp] = scope(req, 'o.godown_id');
    const [rows] = await db.query(`SELECT i.invoice_id, i.invoice_no, i.status, i.total, i.buyer_json, i.ewb_no, DATE_FORMAT(i.ewb_valid, '%Y-%m-%d') AS ewb_valid, i.irn, i.ack_no, ${IST('i.issued_at')} AS day,
        o.order_no, o.order_id, o.customer_id, o.godown_id, o.eway_bill_no AS order_ewb, o.awb_no, o.delivery_kind, c.name AS customer,
        (SELECT v.number FROM trip_stops ts JOIN delivery_trips tr ON tr.trip_id = ts.trip_id LEFT JOIN vehicles v ON v.vehicle_id = tr.vehicle_id WHERE ts.order_id = o.order_id ORDER BY ts.stop_id DESC LIMIT 1) AS vehicle
        FROM invoices i JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id WHERE i.status = 'issued' AND ${gw} ORDER BY i.issued_at DESC LIMIT 400`, gp);
    const ru = await billing.rules(db);
    const today = pricing.istToday();
    const ewb = []; const einv = [];
    for (const v of rows) {
      const b = typeof v.buyer_json === 'string' ? JSON.parse(v.buyer_json) : v.buyer_json;
      const n = await billing.needs(db, { total: v.total, customerId: v.customer_id, godownId: v.godown_id, day: v.day, gstin: b.bill.gstin, invoiceId: v.invoice_id });
      const base = { invoice_no: v.invoice_no, day: v.day, customer: v.customer, total: num(v.total), order_no: v.order_no };
      if (n.ewb || v.ewb_no || v.order_ewb) ewb.push({ ...base, ewb_no: v.ewb_no || v.order_ewb, ewb_valid: v.ewb_valid, ended: Boolean(v.ewb_valid && v.ewb_valid < today), needed: Boolean(n.ewb), why: n.ewb, vehicle: v.vehicle || (v.awb_no ? `Courier ${v.awb_no}` : null) });
      if (b.bill.gstin) einv.push({ ...base, irn: v.irn, ack_no: v.ack_no, needed: ru.einvoice && !v.irn });
    }
    return { rules: ru, ewb, einv };
  }), G);

  // ============================================================================================ receipts and receivables
  route('get', '/money/receipts', 'money:view', wrap(async (req) => {
    const [cw, cp] = custWhere(req);
    const sc = godowns.viewScope(req);
    const [gw, gp] = godowns.where('cu.godown_id', sc);
    const [custs] = await db.query(`SELECT cu.customer_id, cu.customer_no, cu.name, cu.status, cu.hold_reason, cu.owner_emp_id FROM customers cu WHERE cu.status <> 'merged' AND ${cw} AND (${gw} OR cu.godown_id IS NULL) ORDER BY cu.name`, [...cp, ...gp]);
    const owing = []; const credit = [];
    for (const c of custs) {
      const st = await money.statement(db, c.customer_id);
      const bal = st.balance;
      if (bal > 0.004) {
        const l30 = await money.late30(db, c.customer_id);
        const [[rem]] = await db.query("SELECT DATE_FORMAT(CONVERT_TZ(created_at, '+00:00', '+05:30'), '%Y-%m-%d') AS day, recipient, channel, status FROM notification_log WHERE event_key = 'overdue' AND customer_id = ? AND is_test = 0 ORDER BY log_id DESC LIMIT 1", [c.customer_id]);
        const [[wo]] = await db.query("SELECT bad_debt_id FROM bad_debts WHERE customer_id = ? AND status = 'waiting'", [c.customer_id]);
        owing.push({ customer_id: c.customer_id, customer_no: c.customer_no, name: c.name, status: c.status, hold_reason: c.hold_reason, owes: bal, overdue: st.overdue, ageing: st.ageing, late30: l30.amount,
          reminded: rem ? { day: rem.day, how: `${rem.channel === 'whatsapp' ? 'WhatsApp' : 'mail'} to ${rem.recipient || '-'}${rem.status === 'skipped' ? ' (not sent)' : ''}` } : null, write_off_waiting: Boolean(wo) });
      } else if (bal < -0.004) credit.push({ customer_id: c.customer_id, customer_no: c.customer_no, name: c.name, credit: r2(-bal), refundable: (await money.refundable(db, c.customer_id)).can });
    }
    owing.sort((a, b) => b.overdue - a.overdue || b.owes - a.owes);
    const ids = custs.map((c) => c.customer_id);
    const [rcs] = ids.length ? await db.query(`SELECT r.receipt_id, r.receipt_no, r.customer_id, cu.name AS customer, r.amount, r.mode, r.reference, DATE_FORMAT(r.received_on, '%Y-%m-%d') AS received_on, r.source, r.status, r.note, r.order_id,
        (SELECT x.order_no FROM orders x WHERE x.order_id = r.order_id) AS order_no, ch.status AS cheque_status, ch.cheque_no,
        (SELECT GROUP_CONCAT(CONCAT(COALESCE(i.invoice_no, o.order_no), '|', p.amount, '|', IF(o.amount_due <= 0.005, 1, 0)) ORDER BY p.payment_id SEPARATOR ';') FROM payments p JOIN orders o ON o.order_id = p.order_id LEFT JOIN invoices i ON i.invoice_id = p.invoice_id WHERE p.receipt_id = r.receipt_id AND p.kind = 'payment' AND p.reversed_at IS NULL) AS settled,
        (SELECT GROUP_CONCAT(CONCAT(COALESCE(dn.debit_note_no, chg.text, 'refund'), '|', d.amount, '|0') SEPARATOR ';') FROM receipt_dues d LEFT JOIN debit_notes dn ON d.due_kind = 'debit' AND dn.debit_note_id = d.due_id LEFT JOIN customer_charges chg ON d.due_kind = 'charge' AND chg.charge_id = d.due_id WHERE d.receipt_id = r.receipt_id AND d.reversed_at IS NULL) AS dues
        FROM receipts r JOIN customers cu ON cu.customer_id = r.customer_id LEFT JOIN cheques ch ON ch.cheque_id = r.cheque_id WHERE r.customer_id IN (?) ORDER BY r.received_on DESC, r.receipt_id DESC LIMIT 400`, [ids]) : [[]];
    const receipts = rcs.map((r) => {
      const parts = [r.settled, r.dues].filter(Boolean).join(';').split(';').filter(Boolean).map((s) => { const [no, a, f] = s.split('|'); return { no, amount: r2(a), full: f === '1' }; }).filter((x) => x.no !== 'refund');
      const used = r2(parts.reduce((a, x) => a + x.amount, 0));
      return { receipt_no: r.receipt_no, customer_id: r.customer_id, customer: r.customer, amount: num(r.amount), mode: r.mode, mode_label: money.OLD_MODES[r.mode] || r.mode, reference: r.reference, received_on: r.received_on,
        source: r.source, source_label: money.SOURCES[r.source] || r.source, order_no: r.order_no, status: r.status, cheque_status: r.cheque_status, settles: parts, on_account: r.status === 'ok' ? r2(Number(r.amount) - used) : 0 };
    });
    const tot = r2(owing.reduce((a, x) => a + x.owes, 0)); const od = r2(owing.reduce((a, x) => a + x.overdue, 0));
    return { summary: { owe: tot, overdue: od, credit: r2(credit.reduce((a, x) => a + x.credit, 0)) }, owing, receipts, credit, own: Boolean(own(req)),
      counts: { to_collect: owing.filter((x) => x.overdue > 0.004).length, receipts: receipts.length, credit: credit.length },
      can: { create: canDo(req, 'money', 'create'), office: office(req) } };
  }), G);
  route('get', '/money/receipt-form', 'money:create', wrap(async (req) => {
    const [cw, cp] = custWhere(req);
    const [custs] = await db.query(`SELECT cu.customer_id, cu.customer_no, cu.name FROM customers cu WHERE cu.status <> 'merged' AND ${cw} ORDER BY cu.name`, cp);
    const out = { customers: custs, modes: Object.entries(money.MODES), today: pricing.istToday() };
    if (req.query.customer_id) {
      await assertCustomer(db, req, req.query.customer_id);
      const st = await money.statement(db, Number(req.query.customer_id));
      out.customer = { customer_id: Number(req.query.customer_id), owes: st.balance, overdue: st.overdue, on_account: st.on_account,
        items: (await money.openItems(db, Number(req.query.customer_id))).map((x) => ({ kind: x.kind, no: x.no, order_no: x.order_no, day: x.day, due_on: x.due_on, left: x.left })) };
    }
    return out;
  }), G);
  route('post', '/money/receipts', 'money:create', wrap(async (req) => {
    await assertCustomer(db, req, (req.body || {}).customer_id);
    return tx((q) => money.recordReceipt(q, req.body || {}, by(req), { source: 'office' }));
  }), G);
  route('get', '/money/receipts/:no', 'money:view', wrap(async (req) => {
    const [[r]] = await db.query(`SELECT r.*, DATE_FORMAT(r.received_on, '%Y-%m-%d') AS day, cu.name AS customer, cu.business_name, cu.customer_no, ch.cheque_no, ch.bank, DATE_FORMAT(ch.cheque_date, '%Y-%m-%d') AS cheque_date, ch.status AS cheque_status,
        (SELECT x.order_no FROM orders x WHERE x.order_id = r.order_id) AS order_no FROM receipts r JOIN customers cu ON cu.customer_id = r.customer_id LEFT JOIN cheques ch ON ch.cheque_id = r.cheque_id WHERE r.receipt_no = ?`, [req.params.no]);
    if (!r) throw new InputError('No such receipt', 404);
    await assertCustomer(db, req, r.customer_id);
    const [pays] = await db.query("SELECT COALESCE(i.invoice_no, o.order_no) AS no, p.amount, p.reversed_at FROM payments p JOIN orders o ON o.order_id = p.order_id LEFT JOIN invoices i ON i.invoice_id = p.invoice_id WHERE p.receipt_id = ? AND p.kind = 'payment' ORDER BY p.payment_id", [r.receipt_id]);
    const [dues] = await db.query("SELECT COALESCE(dn.debit_note_no, chg.text) AS no, d.amount, d.reversed_at, d.due_kind FROM receipt_dues d LEFT JOIN debit_notes dn ON d.due_kind = 'debit' AND dn.debit_note_id = d.due_id LEFT JOIN customer_charges chg ON d.due_kind = 'charge' AND chg.charge_id = d.due_id WHERE d.receipt_id = ? AND d.due_kind <> 'refund'", [r.receipt_id]);
    const settles = [...pays, ...dues].filter((x) => !x.reversed_at).map((x) => ({ no: x.no, amount: num(x.amount) }));
    const used = r2(settles.reduce((a, x) => a + x.amount, 0));
    const st = await money.statement(db, r.customer_id);
    const nm = await names(db, [r.emp_id]);
    const co = await company.facts(db);
    return { receipt_no: r.receipt_no, customer: r.customer, legal: r.business_name || r.customer, customer_no: r.customer_no, amount: num(r.amount), mode: r.mode, mode_label: money.OLD_MODES[r.mode] || r.mode, reference: r.reference, day: r.day,
      source: money.SOURCES[r.source] || r.source, order_no: r.order_no, status: r.status, cheque: r.cheque_no ? { no: r.cheque_no, bank: r.bank, date: r.cheque_date, status: r.cheque_status } : null,
      settles, on_account: r.status === 'ok' ? r2(Number(r.amount) - used) : 0, balance_after: st.balance, by: nm.get(r.emp_id) || r.emp_id, note: r.note, company: { name: co.name, phone: co.phone, gstin: co.gstin } };
  }), G);
  route('post', '/money/customers/:id/remind', 'money:create', wrap(async (req) => {
    await assertCustomer(db, req, req.params.id);
    const notifications = require('./notifications'); // eslint-disable-line global-require
    return tx(async (q) => {
      const n = await notifications.overdueNow(q, Number(req.params.id));
      const { audit } = require('./audit'); // eslint-disable-line global-require
      await audit(q, { empId: by(req), action: 'remind', entity: 'customer', entityId: String(req.params.id), after: { overdue: n.amount, to: n.to } });
      return n;
    });
  }), G);
  route('post', '/money/customers/:id/write-off', 'money:create', wrap(async (req) => {
    if (!office(req)) throw new InputError('Writing off a bad debt is for the office, not Sales', 403);
    return tx((q) => money.askBadDebt(q, Number(req.params.id), by(req)));
  }), G);

  // ============================================================================================ refunds
  route('get', '/money/refunds', 'money:view', wrap(async (req) => {
    if (!office(req)) throw new InputError('Refunds are for the office, not Sales.', 403);
    const [rows] = await db.query(`SELECT f.refund_id, f.refund_no, f.return_id, f.status, f.method, f.mode, f.reference, f.amount, f.why, DATE_FORMAT(COALESCE(f.refund_day, f.created_at), '%Y-%m-%d') AS day, f.approval_id,
        cu.name AS customer, cu.customer_no, r.return_no, (SELECT a.summary FROM approvals a WHERE a.approval_id = f.approval_id) AS approval
        FROM refunds f LEFT JOIN customers cu ON cu.customer_id = f.customer_id LEFT JOIN returns r ON r.return_id = f.return_id ORDER BY f.refund_id DESC LIMIT 400`);
    const list = rows.map((x) => ({ ...x, amount: num(x.amount), mode_label: money.REFUND_MODES[x.mode] || money.OLD_MODES[x.mode] || x.mode || (x.method === 'wallet' ? 'The customer wallet' : x.method) }));
    const [[rule]] = await db.query("SELECT is_on, unit, limit_value FROM approval_rules WHERE kind = 'refund'");
    return { waiting: list.filter((x) => x.status === 'approval'), paid: list.filter((x) => x.status === 'paid'), rejected: list.filter((x) => x.status === 'rejected'),
      counts: { waiting: list.filter((x) => x.status === 'approval').length, paid: list.filter((x) => x.status === 'paid').length, rejected: list.filter((x) => x.status === 'rejected').length },
      rule: { is_on: Boolean(rule && rule.is_on), above: rule ? num(rule.limit_value) : null }, modes: Object.entries(money.REFUND_MODES), can: { create: canDo(req, 'money', 'create') } };
  }), G);
  route('get', '/money/refund-form/:id', 'money:create', wrap(async (req) => {
    if (!office(req)) throw new InputError('Refunds are for the office, not Sales.', 403);
    const [[c]] = await db.query('SELECT customer_id, customer_no, name FROM customers WHERE customer_id = ?', [Number(req.params.id)]);
    if (!c) throw new InputError('No such customer', 404);
    const [[rule]] = await db.query("SELECT is_on, limit_value FROM approval_rules WHERE kind = 'refund'");
    return { customer: c, ...(await money.refundable(db, c.customer_id)), modes: Object.entries(money.REFUND_MODES), rule: { is_on: Boolean(rule && rule.is_on), above: rule ? num(rule.limit_value) : null } };
  }), G);
  route('post', '/money/refunds', 'money:create', wrap(async (req) => {
    if (!office(req)) throw new InputError('Refunds are for the office, not Sales.', 403);
    return tx((q) => money.askRefund(q, req.body || {}, by(req)));
  }), G);

  // ============================================================================================ cheques
  route('get', '/money/cheques', 'money:view', wrap(async (req) => {
    const [cw, cp] = custWhere(req);
    const [rows] = await db.query(`SELECT c.cheque_id, c.cheque_no, c.bank, DATE_FORMAT(c.cheque_date, '%Y-%m-%d') AS cheque_date, c.amount, c.status, DATE_FORMAT(c.deposited_on, '%Y-%m-%d') AS deposited_on, DATE_FORMAT(c.done_on, '%Y-%m-%d') AS done_on, c.bounce_why,
        r.receipt_no, cu.name AS customer, cu.customer_no, ch.charge_id, ch.amount AS charge, ch.waived, (SELECT a.approval_id FROM approvals a WHERE a.approval_id = ch.waive_approval_id AND a.status = 'pending') AS waive_waiting
        FROM cheques c JOIN receipts r ON r.receipt_id = c.receipt_id JOIN customers cu ON cu.customer_id = c.customer_id LEFT JOIN customer_charges ch ON ch.charge_id = c.charge_id WHERE ${cw} ORDER BY c.cheque_id DESC LIMIT 400`, cp);
    const today = pricing.istToday();
    const list = rows.map((x) => ({ ...x, amount: num(x.amount), charge: num(x.charge), waived: num(x.waived), post_dated: x.status === 'received' && x.cheque_date > today }));
    let out = [];
    if (office(req)) {
      const [sp] = await db.query(`SELECT p.pay_no, p.reference, DATE_FORMAT(p.paid_on, '%Y-%m-%d') AS paid_on, p.amount, s.name AS supplier FROM supplier_payments p JOIN suppliers s ON s.supplier_id = p.supplier_id WHERE p.mode = 'cheque' AND p.status = 'paid' ORDER BY p.pay_id DESC LIMIT 200`);
      out = sp.map((x) => ({ ...x, amount: num(x.amount) }));
    }
    const g = (s) => list.filter((x) => x.status === s);
    return { received: g('received'), deposited: g('deposited'), cleared: g('cleared'), bounced: g('bounced'), issued: out, today, reasons: money.BOUNCE_WHY,
      standard_charge: Number((await commerceSettings.read(db)).bounce_charge === undefined ? 500 : (await commerceSettings.read(db)).bounce_charge) || 0,
      counts: { received: g('received').length, deposited: g('deposited').length, cleared: g('cleared').length, bounced: g('bounced').length, issued: out.length },
      can: { create: canDo(req, 'money', 'create'), office: office(req) } };
  }), G);
  const chequeOf = async (req) => {
    const [[c]] = await db.query('SELECT customer_id FROM cheques WHERE cheque_id = ?', [Number(req.params.id)]);
    if (!c) throw new InputError('No such cheque', 404);
    await assertCustomer(db, req, c.customer_id);
  };
  route('post', '/money/cheques/:id/deposit', 'money:create', wrap(async (req) => { await chequeOf(req); return tx((q) => money.deposit(q, req.params.id, by(req))); }), G);
  route('post', '/money/cheques/:id/clear', 'money:create', wrap(async (req) => { await chequeOf(req); return tx((q) => money.clear(q, req.params.id, by(req))); }), G);
  route('post', '/money/cheques/:id/bounce', 'money:create', wrap(async (req) => { await chequeOf(req); return tx((q) => money.bounce(q, req.params.id, req.body || {}, by(req), req.admin)); }), G);
  route('post', '/money/cheques/:id/waive', 'money:create', wrap(async (req) => {
    if (!office(req)) throw new InputError('Waiving a charge is for the office, not Sales', 403);
    const [[c]] = await db.query('SELECT charge_id FROM cheques WHERE cheque_id = ?', [Number(req.params.id)]);
    if (!c || !c.charge_id) throw new InputError('This cheque has no charge', 404);
    return tx((q) => money.askWaive(q, c.charge_id, null, by(req)));
  }), G);
}

module.exports = { register };
