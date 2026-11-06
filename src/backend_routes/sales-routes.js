// Phase 19: the API of the Sales screens (sections 6 and 7, v23): Follow-ups (calls, next calls, samples), Credit
// limits, Customer types, Quotes, Standing orders, Back-orders, Hold again. Rules in sales.js, customers.js, commerce.js.
// Every list follows the godowns a person works at (the header picker) and, for a role with "Own customers only",
// their own customers and enquiries (with new enquiries nobody has picked up). Every change is audited.
const sales = require('./sales');
const commerce = require('./commerce');
const customers = require('./customers');
const pricing = require('./pricing');
const approvals = require('./approvals');
const godowns = require('./godowns');
const secondAdmin = require('./second-admin');
const { audit } = require('./audit');

const SKU_NAME = 'COALESCE(t.name, pt.name, s.product_id)';
const SKU_JOIN = `JOIN products p ON p.product_id = s.product_id
       LEFT JOIN product_translations t ON t.product_id = s.product_id AND t.lang_code = 'en'
       LEFT JOIN product_translations pt ON pt.product_id = p.variant_of AND pt.lang_code = 'en'`;
const IMG = '(SELECT pi.file_name FROM product_images pi WHERE pi.product_id = s.product_id ORDER BY pi.position LIMIT 1)';
const num = (v) => (v === null || v === undefined ? null : Number(v));

function register({ route, tx, db, by, InputError, canDo, commerceGate }) {
  const G = { before: [commerceGate] };
  const asErr = (e) => {
    if (e instanceof sales.SalesError || e instanceof commerce.CommerceError || e instanceof customers.CustomerError || e instanceof godowns.GodownError) {
      const x = new InputError(e.message, e.status || 400); if (e.fields) { x.code = e.code || 'fields'; x.fields = e.fields; } return x;
    }
    return e;
  };
  const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (e) { throw asErr(e); } };
  const own = (req) => customers.ownScope(req.admin);
  /** SQL for "customers this person sees": godowns in view and, own customers only, theirs */
  const custScope = (req, alias = 'c') => {
    const [gw, gp] = godowns.where(`${alias}.godown_id`, godowns.viewScope(req));
    const o = own(req);
    return [`${gw}${o ? ` AND ${alias}.owner_emp_id = ?` : ''}`, [...gp, ...(o ? [o] : [])]];
  };
  const leadScope = (req, alias = 'l') => {
    const o = own(req);
    return o ? [`(${alias}.assigned_to = ? OR (${alias}.assigned_to IS NULL AND ${alias}.status = 'new'))`, [o]] : ['1 = 1', []];
  };
  async function seeCust(req, id) {
    const [[c]] = await db.query('SELECT customer_id, godown_id, owner_emp_id FROM customers WHERE customer_id = ?', [Number(id)]);
    if (!c) throw new InputError('Customer not found', 404);
    godowns.assertSees(req, c.godown_id, 'Customer not found');
    if (own(req) && c.owner_emp_id !== own(req)) throw new InputError('This customer belongs to another sales owner', 403);
    return c;
  }
  async function seeLead(req, id) {
    const [[l]] = await db.query('SELECT lead_id, assigned_to, status FROM leads WHERE lead_id = ?', [Number(id)]);
    if (!l) throw new InputError('Enquiry not found', 404);
    if (own(req) && l.assigned_to !== own(req) && !(l.assigned_to === null && l.status === 'new')) throw new InputError('This enquiry is given to someone else', 403);
    return l;
  }
  async function seeDoc(req, r) {
    godowns.assertSees(req, r.godown_id, 'Not found');
    if (r.customer_id) await seeCust(req, r.customer_id); else if (r.lead_id) await seeLead(req, r.lead_id);
  }
  const custOf = (req) => canDo(req, 'customers', 'edit') || canDo(req, 'leads', 'edit');

  // ============================================================================================ the form lists
  route('get', '/sales/options', 'orders:view', wrap(async (req) => {
    const [cw, cp] = custScope(req);
    const [lw, lp] = leadScope(req);
    const [custs] = await db.query(`SELECT c.customer_id, c.customer_no, c.name, c.status, c.hold_reason, c.godown_id, c.type_key FROM customers c WHERE c.merged_into IS NULL AND ${cw} ORDER BY c.name`, cp);
    const [leads] = await db.query(`SELECT l.lead_id, l.lead_ref, COALESCE(l.business_name, l.full_name) AS name FROM leads l WHERE l.status IN ('new', 'contacted', 'qualified')
        AND NOT EXISTS (SELECT 1 FROM customers c WHERE c.lead_id = l.lead_id AND c.merged_into IS NULL) AND ${lw} ORDER BY l.created_at DESC`, lp);
    const [packs] = await db.query(`SELECT s.sku_code, ${SKU_NAME} AS name, s.size_label, s.packs_per_carton, s.min_order_qty, s.sell_unit, s.status, ${IMG} AS image
        FROM skus s ${SKU_JOIN} WHERE s.sku_type <> 'raw' AND s.is_active = 1 AND s.status IN ('active', 'discontinued') AND COALESCE(p.status, 'active') IN ('active', 'hidden', 'discontinued') ORDER BY s.sku_code`);
    const [kits] = await db.query("SELECT k.kit_key, k.kit_code, COALESCE(t.name, k.kit_key) AS name, k.price FROM kits k LEFT JOIN kit_translations t ON t.kit_key = k.kit_key AND t.lang_code = 'en' WHERE k.status = 'active' ORDER BY k.sort_order");
    const all = (await godowns.list(db)).filter((g) => g.is_active);
    const sw = await commerce.orderSwitches(db);
    return { customers: custs, leads, packs: packs.map((s) => ({ ...s, packs_per_carton: num(s.packs_per_carton) })), kits: kits.map((k) => ({ ...k, price: num(k.price) })),
      godowns: all.filter((g) => godowns.covers(req.admin, g.godown_id)).map((g) => ({ godown_id: g.godown_id, name: g.name, code: g.code })), own: Boolean(own(req)),
      switches: { split: sw.split, hold_hours: sw.hours, standing_confirm: sw.standingConfirm }, lost_reasons: sales.QT_LOST, call_how: sales.CALL_HOW, lead_lost: sales.LOST_WHY,
      can: { create: canDo(req, 'orders', 'create'), edit: canDo(req, 'orders', 'edit'), cancel: canDo(req, 'orders', 'cancel'), approve: canDo(req, 'orders', 'approve'), customers: canDo(req, 'customers', 'edit') },
      see_cost: Boolean(req.admin && req.admin.seesCost) };
  }), G);

  // ============================================================================================ quotes
  route('get', '/sales/quotes', 'orders:view', wrap(async (req) => {
    const [gw, gp] = godowns.where('q.godown_id', godowns.viewScope(req));
    const o = own(req);
    const [rows] = await db.query(`SELECT q.quote_id, q.quote_no, q.rev, q.status, DATE_FORMAT(q.quote_date, '%Y-%m-%d') AS quote_date, DATE_FORMAT(q.valid_until, '%Y-%m-%d') AS valid_until, q.total, q.list_value, q.taxable, q.delivery_charge,
        q.customer_id, q.lead_id, q.godown_id, g.name AS godown, c.customer_no, c.name AS customer, l.lead_ref, COALESCE(l.business_name, l.full_name) AS lead_name, ord.order_no,
        (SELECT ql.sku_code FROM quote_lines ql WHERE ql.quote_id = q.quote_id ORDER BY ql.sort_order LIMIT 1) AS first_sku, (SELECT COUNT(*) FROM quote_lines ql WHERE ql.quote_id = q.quote_id) AS n_lines
        FROM quotes q JOIN locations g ON g.location_id = q.godown_id LEFT JOIN customers c ON c.customer_id = q.customer_id LEFT JOIN leads l ON l.lead_id = q.lead_id LEFT JOIN orders ord ON ord.order_id = q.order_id
        WHERE ${gw}${o ? " AND (c.owner_emp_id = ? OR (q.customer_id IS NULL AND l.assigned_to = ?))" : ''} ORDER BY q.quote_id DESC`, [...gp, ...(o ? [o, o] : [])]);
    const [names] = await db.query(`SELECT s.sku_code, ${SKU_NAME} AS name FROM skus s ${SKU_JOIN} WHERE s.sku_code IN (?)`, [[...new Set(rows.map((r) => r.first_sku).filter(Boolean)), '']]);
    const nm = Object.fromEntries(names.map((x) => [x.sku_code, x.name]));
    return { rows: rows.map((r) => ({ ...r, state: sales.qState(r), state_label: sales.QT_STATUS[sales.qState(r)], total: num(r.total), list_value: num(r.list_value),
      off_pct: num(r.list_value) > 0 ? Math.round(((num(r.list_value) - (num(r.taxable) - num(r.delivery_charge))) / num(r.list_value)) * 1000) / 10 : 0,
      first_name: nm[r.first_sku] || r.first_sku, n_lines: Number(r.n_lines) })), labels: sales.QT_STATUS, can: { create: canDo(req, 'orders', 'create') } };
  }), G);
  route('get', '/sales/quotes/:no', 'orders:view', wrap(async (req) => {
    const r = await sales.quoteRow(db, req.params.no);
    await seeDoc(req, r);
    const lines = sales.kitPrices(await sales.quoteLines(db, r.quote_id));
    const [names] = await db.query(`SELECT s.sku_code, ${SKU_NAME} AS name, p.hsn_code AS hsn, ${IMG} AS image FROM skus s ${SKU_JOIN} WHERE s.sku_code IN (?)`, [[...lines.map((l) => l.sku_code), '']]);
    const nm = Object.fromEntries(names.map((x) => [x.sku_code, x]));
    const [revs] = await db.query("SELECT rev, DATE_FORMAT(valid_until, '%Y-%m-%d') AS valid_until, total, `lines`, saved_at, emp_id FROM quote_revisions WHERE quote_id = ? ORDER BY rev DESC", [r.quote_id]);
    const [appr] = await db.query("SELECT a.approval_id, a.kind, a.status, a.summary, JSON_UNQUOTE(JSON_EXTRACT(a.payload, '$.label')) AS label FROM approvals a WHERE a.ref_type = 'quote' AND a.ref_id = ? ORDER BY a.approval_id", [r.quote_no]);
    const [[who]] = r.customer_id ? await db.query(`SELECT c.customer_no AS no, c.name, (SELECT a.gstin FROM customer_addresses a WHERE a.customer_id = c.customer_id AND a.kind = 'billing' AND a.is_active = 1 ORDER BY a.is_default DESC LIMIT 1) AS gstin,
        (SELECT CONCAT_WS(', ', a.address, a.town, a.pincode) FROM customer_addresses a WHERE a.customer_id = c.customer_id AND a.kind = 'billing' AND a.is_active = 1 ORDER BY a.is_default DESC LIMIT 1) AS address, c.email, c.credit_days
        FROM customers c WHERE c.customer_id = ?`, [r.customer_id]) : await db.query('SELECT lead_ref AS no, COALESCE(business_name, full_name) AS name, NULL AS gstin, town AS address, email, 0 AS credit_days FROM leads WHERE lead_id = ?', [r.lead_id]);
    const [[g]] = await db.query('SELECT name FROM locations WHERE location_id = ?', [r.godown_id]);
    const people = await sales.staffNames(db, [r.emp_id, r.ok_by]);
    const mk = { name: people.get(r.emp_id) }; const ok = r.ok_by ? { name: people.get(r.ok_by) } : null;
    const [[ord]] = r.order_id ? await db.query('SELECT order_no, status FROM orders WHERE order_id = ?', [r.order_id]) : [[null]];
    const state = sales.qState(r);
    const t = await sales.quoteTotals(db, lines, r.gst_type, r.delivery_charge);
    const co = await require('./company').facts(db); // eslint-disable-line global-require
    return { ...r, total: num(r.total), delivery_charge: num(r.delivery_charge), company: { name: co.name, gstin: co.gstin, phone: co.phone, email: co.email }, state, state_label: sales.QT_STATUS[state], who: { ...who, kind: r.customer_id ? 'customer' : 'lead' }, godown: g.name, made_by: mk ? mk.name : r.emp_id, ok_by_name: ok ? ok.name : null, order: ord || null,
      lines: lines.map((l) => ({ ...l, name: (nm[l.sku_code] || {}).name || l.sku_code, hsn: (nm[l.sku_code] || {}).hsn || null, image: (nm[l.sku_code] || {}).image || null })), totals: t,
      revisions: revs.map((x) => ({ ...x, total: num(x.total), lines: typeof x.lines === 'string' ? JSON.parse(x.lines) : x.lines })),
      approvals: appr.map((a) => ({ ...a, kind_label: a.label && a.label !== 'null' ? a.label : (approvals.KINDS[a.kind] || {}).label, waiting: a.status === 'pending' })),
      can: { edit: canDo(req, 'orders', 'edit') && ['draft', 'sent', 'expired'].includes(state), order: canDo(req, 'orders', 'create') && state === 'sent', lost: canDo(req, 'orders', 'edit') && ['draft', 'sent', 'expired'].includes(state) } };
  }), G);
  route('post', '/sales/quotes/preview', 'orders:view', wrap(async (req) => {
    const b = req.body || {};
    if (b.customer_id) await seeCust(req, b.customer_id); else if (b.lead_id) await seeLead(req, b.lead_id);
    if (b.quote_no) await seeDoc(req, await sales.quoteRow(db, b.quote_no));
    return sales.previewQuote(db, b.quote_no || null, b, req.admin);
  }), G);
  const saveQ = (id) => wrap(async (req) => {
    const b = req.body || {};
    if (!canDo(req, 'orders', id ? 'edit' : 'create')) throw new InputError(`This needs ${id ? 'edit' : 'create'} on Orders`, 403);
    if (b.customer_id) await seeCust(req, b.customer_id); else if (b.lead_id) await seeLead(req, b.lead_id);
    if (b.godown_id) godowns.assertSees(req, b.godown_id, 'Not found');
    return tx(async (q) => {
      if (id) await seeDoc(req, await sales.quoteRow(q, id));
      const out = await sales.saveQuote(q, id, b, by(req), req.admin);
      out.waiting_line = out.status === 'approval' ? await waitLineOf(q, 'quote', out.quote_no) : '';
      return out;
    });
  });
  async function waitLineOf(q, refType, refId) {
    const [rows] = await q.query("SELECT approval_id FROM approvals WHERE ref_type = ? AND ref_id = ? AND status = 'pending' ORDER BY approval_id", [refType, refId]);
    const lines = [];
    for (const r of rows) { const l = await secondAdmin.waitingLine(q, r.approval_id); if (!lines.includes(l)) lines.push(l); }
    return lines.join(' ');
  }
  route('post', '/sales/quotes', 'orders:create', saveQ(null), { ...G, status: 201 });
  route('put', '/sales/quotes/:no', 'orders:edit', (req, res) => saveQ(req.params.no)(req, res), G);
  route('post', '/sales/quotes/:no/lost', 'orders:edit', wrap(async (req) => tx(async (q) => { await seeDoc(req, await sales.quoteRow(q, req.params.no)); return sales.lostQuote(q, req.params.no, (req.body || {}).reason, by(req)); })), G);
  // phase 20: Mail to customer: the quotation as a PDF, prepared in the Outbox (sent only where mail is on)
  route('post', '/sales/quotes/:no/mail', 'orders:edit', wrap(async (req) => tx(async (q) => {
    const r = await sales.quoteRow(q, req.params.no);
    await seeDoc(req, r);
    if (!['sent', 'won'].includes(sales.qState(r))) throw new InputError('Only a sent quote is mailed', 409);
    const out = await require('./notifications').quoteSent(q, r.quote_id, by(req)); // eslint-disable-line global-require
    await audit(q, { empId: by(req), action: 'mail', entity: 'quote', entityId: r.quote_no, after: out });
    return out;
  })), G);
  // phase 20: Mail statement (Customer ledger): the statement as a PDF, prepared in the Outbox
  route('post', '/sales/customers/:id/mail-statement', 'customers:view', wrap(async (req) => tx(async (q) => {
    await seeCust(req, req.params.id);
    return require('./notifications').statementMail(q, Number(req.params.id), by(req)); // eslint-disable-line global-require
  })), G);
  // phase 20: customers that look like this enquiry (same phone or e-mail), for "Link to CUS-..." (only those this user sees)
  route('get', '/sales/leads/:id/matches', 'any', wrap(async (req) => {
    await seeLead(req, req.params.id);
    const [[l]] = await db.query('SELECT lead_id, phone, email, status FROM leads WHERE lead_id = ?', [Number(req.params.id)]);
    if (!l) throw new InputError('Enquiry not found', 404);
    const [[own]] = await db.query('SELECT customer_id, customer_no, name FROM customers WHERE lead_id = ? AND merged_into IS NULL LIMIT 1', [l.lead_id]);
    const pd = l.phone ? require('../shared/customerRules').phoneDigits(l.phone) : null; // eslint-disable-line global-require
    const found = await customers.duplicates(db, { phone_digits: pd || null, email: l.email ? String(l.email).trim().toLowerCase() : null });
    const rows = [];
    for (const c of found) { if (rows.some((x) => x.customer_id === c.customer_id)) { rows.find((x) => x.customer_id === c.customer_id).by.push(c.by); continue; } try { await seeCust(req, c.customer_id); rows.push({ ...c, by: [c.by] }); } catch (e) { /* not this user's customer */ } }
    return { own: own || null, rows: rows.map((r) => ({ ...r, by: r.by.join(' and ') })), can: Boolean(custOf(req)) && ['new', 'contacted', 'qualified'].includes(l.status) && !own };
  }), G);
  // phase 20: an enquiry that is an existing customer is linked to it (no second record): Won, its calls and quotes move
  route('post', '/sales/leads/:id/link', 'any', wrap(async (req) => {
    if (!custOf(req)) throw new InputError('This needs edit on Leads and customers', 403);
    await seeLead(req, req.params.id);
    const cid = Number((req.body || {}).customer_id);
    await seeCust(req, cid);
    return tx(async (q) => {
      const [[l]] = await q.query('SELECT lead_id, lead_ref, status FROM leads WHERE lead_id = ? FOR UPDATE', [Number(req.params.id)]);
      const [[c]] = await q.query('SELECT customer_id, customer_no, name, lead_id, merged_into FROM customers WHERE customer_id = ? FOR UPDATE', [cid]);
      if (!c || c.merged_into) throw new InputError('Choose the customer', 400);
      if (!['new', 'contacted', 'qualified'].includes(l.status)) throw new InputError(`${l.lead_ref} is ${l.status}`, 409);
      const [[own]] = await q.query('SELECT customer_no FROM customers WHERE lead_id = ? AND customer_id <> ? LIMIT 1', [l.lead_id, c.customer_id]);
      if (own) throw new InputError(`${l.lead_ref} is already ${own.customer_no}: merge the two customers instead`, 409);
      await customers.moveLeadRecords(q, l.lead_id, c.customer_id);
      if (!c.lead_id) await q.query('UPDATE customers SET lead_id = ? WHERE customer_id = ?', [l.lead_id, c.customer_id]);
      await q.query("UPDATE leads SET status = 'won', first_reply_at = COALESCE(first_reply_at, UTC_TIMESTAMP()), updated_at = UTC_TIMESTAMP() WHERE lead_id = ?", [l.lead_id]);
      await q.query("UPDATE follow_ups SET status = 'done', done_at = UTC_TIMESTAMP(), done_by = ?, done_note = ? WHERE lead_id = ? AND status = 'open'", [by(req), `Linked to ${c.customer_no}`, l.lead_id]);
      await audit(q, { empId: by(req), action: 'link', entity: 'lead', entityId: l.lead_ref, before: { status: l.status }, after: { status: 'won', customer: c.customer_no } });
      return { lead_ref: l.lead_ref, customer_no: c.customer_no, name: c.name };
    });
  }), G);
  route('post', '/sales/quotes/:no/order', 'orders:create', wrap(async (req) => tx(async (q) => { await seeDoc(req, await sales.quoteRow(q, req.params.no)); return sales.quoteToOrder(q, req.params.no, by(req), req.admin); })), G);

  // ============================================================================================ standing orders
  route('get', '/sales/standing', 'orders:view', wrap(async (req) => {
    const [cw, cp] = custScope(req);
    const [rows] = await db.query(`SELECT s.standing_id, s.customer_id, s.godown_id, g.name AS godown, s.every, s.run_day, DATE_FORMAT(s.starts_on, '%Y-%m-%d') AS starts_on, DATE_FORMAT(s.ends_on, '%Y-%m-%d') AS ends_on,
        DATE_FORMAT(s.next_on, '%Y-%m-%d') AS next_on, s.status, c.customer_no, c.name AS customer, (SELECT COUNT(*) FROM orders o WHERE o.standing_id = s.standing_id) AS made
        FROM standing_orders s JOIN customers c ON c.customer_id = s.customer_id JOIN locations g ON g.location_id = s.godown_id WHERE ${cw} ORDER BY s.standing_id DESC`, cp);
    const [ls] = rows.length ? await db.query(`SELECT l.standing_id, l.sku_code, l.kit_key, l.qty FROM standing_order_lines l WHERE l.standing_id IN (?) ORDER BY l.sort_order`, [rows.map((r) => r.standing_id)]) : [[]];
    const t = pricing.istToday();
    return { rows: rows.map((r) => ({ ...r, sto_no: sales.stoNo(r.standing_id), when: sales.stoWhen(r), made: Number(r.made), lines: ls.filter((l) => l.standing_id === r.standing_id),
      due: r.status === 'active' && r.next_on <= t && (!r.ends_on || r.next_on <= r.ends_on) })), can: { create: canDo(req, 'orders', 'create'), edit: canDo(req, 'orders', 'edit') } };
  }), G);
  route('get', '/sales/standing/:id', 'orders:view', wrap(async (req) => {
    const [[s]] = await db.query(`SELECT standing_id, customer_id, godown_id, every, run_day, DATE_FORMAT(starts_on, '%Y-%m-%d') AS starts_on, DATE_FORMAT(ends_on, '%Y-%m-%d') AS ends_on, DATE_FORMAT(next_on, '%Y-%m-%d') AS next_on, status
        FROM standing_orders WHERE standing_id = ?`, [Number(req.params.id)]);
    if (!s) throw new InputError('Standing order not found', 404);
    await seeCust(req, s.customer_id);
    const [lines] = await db.query('SELECT sku_code, kit_key, qty FROM standing_order_lines WHERE standing_id = ? ORDER BY sort_order', [s.standing_id]);
    const [made] = await db.query('SELECT order_no, status FROM orders WHERE standing_id = ? ORDER BY order_id', [s.standing_id]);
    return { ...s, sto_no: sales.stoNo(s.standing_id), when: sales.stoWhen(s), lines, made };
  }), G);
  route('post', '/sales/standing', 'orders:create', wrap(async (req) => { await seeCust(req, (req.body || {}).customer_id); return tx((q) => sales.saveStanding(q, null, req.body || {}, by(req))); }), { ...G, status: 201 });
  route('put', '/sales/standing/:id', 'orders:edit', wrap(async (req) => {
    const [[s]] = await db.query('SELECT customer_id FROM standing_orders WHERE standing_id = ?', [Number(req.params.id)]);
    if (!s) throw new InputError('Standing order not found', 404);
    await seeCust(req, s.customer_id); await seeCust(req, (req.body || {}).customer_id);
    return tx((q) => sales.saveStanding(q, req.params.id, req.body || {}, by(req)));
  }), G);
  route('post', '/sales/standing/run', 'orders:create', wrap(async (req) => {
    const [cw, cp] = custScope(req);
    const ids = (await db.query(`SELECT c.customer_id FROM customers c WHERE ${cw}`, cp))[0].map((x) => x.customer_id);
    return tx((q) => sales.runStanding(q, by(req), { scope: ids.length ? `s.customer_id IN (${ids.map(Number).join(',')})` : '1 = 0', admin: req.admin }));
  }), G);

  // ============================================================================================ back-orders and the hold time
  route('get', '/sales/back-orders', 'orders:view', wrap(async (req) => {
    await tx((q) => commerce.sweepHolds(q));
    const [cw, cp] = custScope(req);
    const [rows] = await db.query(`SELECT i.line_id, i.sku_code, i.back_qty, i.kit_key, o.order_no, o.order_id, o.status, o.godown_id, g.name AS godown, DATE_FORMAT(o.confirmed_at, '%Y-%m-%d %H:%i') AS confirmed_at, c.name AS customer,
        ${SKU_NAME} AS name, ${IMG} AS image
        FROM order_items i JOIN orders o ON o.order_id = i.order_id JOIN customers c ON c.customer_id = o.customer_id JOIN locations g ON g.location_id = o.godown_id
        JOIN skus s ON s.sku_code = i.sku_code ${SKU_JOIN}
        WHERE i.back_qty > 0 AND o.status IN (?) AND ${cw} ORDER BY o.confirmed_at, o.order_id, i.line_id`, [commerce.OPEN, ...cp]);
    const out = [];
    for (const r of rows) {
      const free = await commerce.freeForBack(db, r.sku_code, r.godown_id, r.order_id, r.confirmed_at);
      out.push({ ...r, back_qty: Number(r.back_qty), free_now: free, state: ['packing', 'packed'].includes(r.status) ? 'after' : free > 0 ? 'arrived' : 'waiting', status_label: commerce.STATUS_LABEL[r.status] });
    }
    return { rows: out, can: { edit: canDo(req, 'orders', 'edit') } };
  }), G);
  const orderOf = async (req, no) => {
    const [[o]] = await db.query('SELECT order_id, customer_id, godown_id FROM orders WHERE order_no = ?', [String(no || '')]);
    if (!o) throw new InputError('Order not found', 404);
    await seeCust(req, o.customer_id);
    return o;
  };
  route('post', '/sales/back-orders/hold', 'orders:edit', wrap(async (req) => {
    const b = req.body || {};
    const o = await orderOf(req, b.order_no);
    return tx(async (q) => {
      const [[st]] = await q.query('SELECT status FROM orders WHERE order_id = ? FOR UPDATE', [o.order_id]);
      if (['packing', 'packed'].includes(st.status)) throw new InputError('Not yet: the balance is held after this shipment leaves', 409);
      const n = await commerce.boAuto(q, String(b.sku_code || ''), o.godown_id, by(req), o.order_id);
      if (!n) throw new InputError('Nothing free: still waiting for stock', 409);
      const [[left]] = await q.query('SELECT COALESCE(SUM(back_qty), 0) AS n FROM order_items WHERE order_id = ? AND sku_code = ?', [o.order_id, String(b.sku_code)]);
      return { held: n, still_owed: Number(left.n) };
    });
  }), G);
  route('post', '/sales/back-orders/drop', 'orders:edit', wrap(async (req) => {
    const b = req.body || {};
    await orderOf(req, b.order_no);
    return tx((q) => commerce.dropBack(q, String(b.order_no), String(b.sku_code || ''), by(req)));
  }), G);
  route('post', '/commerce/orders/:no/hold-again', 'orders:edit', wrap(async (req) => { await orderOf(req, req.params.no); return tx((q) => commerce.holdAgain(q, req.params.no, by(req))); }), G);

  // ============================================================================================ follow-ups, calls, samples
  route('get', '/sales/follow-ups', 'customers:view', wrap(async (req) => {
    const [cw, cp] = custScope(req);
    const [lw, lp] = leadScope(req);
    const o = own(req);
    const [due] = await db.query(`SELECT f.follow_up_id, f.customer_id, f.lead_id, DATE_FORMAT(f.due_on, '%Y-%m-%d') AS due_on, f.note, f.assignee,
        COALESCE(c.name, l.business_name, l.full_name) AS name, COALESCE(c.customer_no, l.lead_ref) AS ref,
        (SELECT a.note FROM customer_activity a WHERE (f.lead_id IS NOT NULL AND a.lead_id = f.lead_id) OR (f.lead_id IS NULL AND a.customer_id = f.customer_id AND a.lead_id IS NULL) ORDER BY a.happened_at DESC, a.activity_id DESC LIMIT 1) AS last_said
        FROM follow_ups f LEFT JOIN customers c ON c.customer_id = f.customer_id LEFT JOIN leads l ON l.lead_id = f.lead_id
        WHERE f.status = 'open' AND (f.lead_id IS NULL OR l.status IN ('new', 'contacted', 'qualified'))
          AND ((f.lead_id IS NOT NULL AND ${lw}) OR (f.lead_id IS NULL AND ${cw})) ORDER BY f.due_on, f.follow_up_id`, [...lp, ...cp]);
    const [samples] = await db.query(`SELECT sm.sample_id, sm.lead_id, sm.customer_id, sm.sku_code, sm.qty, sm.status, DATE_FORMAT(sm.sent_on, '%Y-%m-%d') AS sent_on, sm.feedback,
        COALESCE(c.name, l.business_name, l.full_name) AS name, COALESCE(l.lead_ref, c.customer_no) AS ref, ${SKU_NAME} AS sku_name, ${IMG} AS image
        FROM samples sm LEFT JOIN customers c ON c.customer_id = sm.customer_id LEFT JOIN leads l ON l.lead_id = sm.lead_id JOIN skus s ON s.sku_code = sm.sku_code ${SKU_JOIN}
        WHERE (sm.customer_id IS NULL OR c.godown_id IS NULL OR ${cw}) ORDER BY sm.sample_id DESC`, cp);
    const [calls] = await db.query(`SELECT a.activity_id, a.customer_id, a.lead_id, a.kind, a.note, a.happened_at, a.emp_id, COALESCE(c.name, l.business_name, l.full_name) AS name
        FROM customer_activity a LEFT JOIN customers c ON c.customer_id = a.customer_id LEFT JOIN leads l ON l.lead_id = a.lead_id
        WHERE a.kind IN ('call', 'whatsapp', 'visit', 'mail', 'note') ${o ? 'AND a.emp_id = ?' : ''} ORDER BY a.happened_at DESC, a.activity_id DESC LIMIT 300`, o ? [o] : []);
    const t = pricing.istToday();
    const people = await sales.staffNames(db, [...due.map((f) => f.assignee), ...calls.map((c) => c.emp_id)]);
    due.forEach((f) => { f.assignee_name = people.get(f.assignee) || f.assignee; });
    calls.forEach((c) => { c.by_name = people.get(c.emp_id) || c.emp_id; });
    return { today: t, due: due.filter((f) => f.due_on <= t), later: due.filter((f) => f.due_on > t), samples: samples.map((s) => ({ ...s, sample_no: `SMP-${String(s.sample_id).padStart(4, '0')}` })),
      calls, own: Boolean(o), can: { edit: custOf(req) } };
  }), G);
  route('post', '/sales/calls', 'any', wrap(async (req) => {
    if (!custOf(req)) throw new InputError('This needs edit on Leads and customers', 403);
    const b = req.body || {};
    if (b.lead_id) await seeLead(req, b.lead_id); else if (b.customer_id) await seeCust(req, b.customer_id);
    return tx((q) => sales.logCall(q, b, by(req)));
  }), { ...G, status: 201 });
  route('get', '/sales/calls', 'any', wrap(async (req) => {
    const lead = req.query.lead ? Number(req.query.lead) : null; const cust = req.query.customer ? Number(req.query.customer) : null;
    if (lead) await seeLead(req, lead); else if (cust) await seeCust(req, cust); else throw new InputError('Choose the enquiry or customer');
    const [rows] = await db.query(`SELECT a.activity_id, a.kind, a.note, a.happened_at, a.emp_id FROM customer_activity a WHERE ${lead ? 'a.lead_id = ?' : 'a.customer_id = ?'} ORDER BY a.happened_at DESC, a.activity_id DESC`, [lead || cust]);
    const people = await sales.staffNames(db, rows.map((x) => x.emp_id));
    rows.forEach((x) => { x.by_name = people.get(x.emp_id) || x.emp_id; });
    const [[next]] = await db.query(`SELECT DATE_FORMAT(MIN(due_on), '%Y-%m-%d') AS d FROM follow_ups WHERE status = 'open' AND ${lead ? 'lead_id = ?' : 'customer_id = ?'}`, [lead || cust]);
    return { rows, next_on: next.d };
  }), G);
  route('post', '/sales/samples/:id/:step', 'any', wrap(async (req) => {
    if (!custOf(req)) throw new InputError('This needs edit on Leads and customers', 403);
    return tx((q) => sales.sampleStep(q, req.params.id, req.params.step, (req.body || {}).feedback, by(req)));
  }), G);
  route('post', '/sales/leads/:id/close', 'any', wrap(async (req) => {
    if (!custOf(req)) throw new InputError('This needs edit on Leads and customers', 403);
    await seeLead(req, req.params.id);
    return tx((q) => sales.leadClose(q, req.params.id, (req.body || {}).how === 'spam' ? 'spam' : 'lost', (req.body || {}).reason, by(req)));
  }), G);

  // ============================================================================================ credit limits
  route('get', '/sales/credit', 'customers:view', wrap(async (req) => {
    const [cw, cp] = custScope(req);
    const [rows] = await db.query(`SELECT c.customer_id, c.customer_no, c.name, c.type_key, ct.label AS ctype, c.status, c.hold_reason, c.credit_limit, c.credit_days,
        (SELECT COALESCE(SUM(o.amount_due), 0) FROM orders o WHERE o.customer_id = c.customer_id AND o.status NOT IN ('cancelled', 'draft') AND o.amount_due > 0) AS owes,
        (SELECT COALESCE(SUM(o.amount_due), 0) FROM invoices i JOIN orders o ON o.order_id = i.order_id WHERE o.customer_id = c.customer_id AND ${commerce.OVERDUE_SQL}) AS overdue,
        (SELECT JSON_OBJECT('id', a.approval_id, 'limit', JSON_EXTRACT(a.payload, '$.credit_limit'), 'days', JSON_EXTRACT(a.payload, '$.credit_days')) FROM approvals a WHERE a.kind = 'credit_raise' AND a.status = 'pending' AND a.ref_type = 'customer' AND CAST(a.ref_id AS UNSIGNED) = c.customer_id LIMIT 1) AS waiting
        FROM customers c JOIN customer_types ct ON ct.type_key = c.type_key WHERE c.merged_into IS NULL AND ${cw} ORDER BY c.name`, cp);
    return { rows: rows.map((r) => {
      const lim = Number(r.credit_limit); const owes = Number(r.owes); const od = Number(r.overdue);
      const why = [];
      if (r.status === 'hold') why.push('on hold'); if (r.status === 'blocked') why.push('blocked');
      if (od > 0.004) why.push(`overdue Rs ${od.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
      if (lim > 0 && owes > lim + 0.004) why.push(`over the limit by Rs ${(owes - lim).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`);
      const w = r.waiting ? (typeof r.waiting === 'string' ? JSON.parse(r.waiting) : r.waiting) : null;
      return { ...r, credit_limit: lim, owes, overdue: od, used_pct: lim > 0 ? Math.round((owes / lim) * 100) : null, free: Math.max(0, Math.round((lim - owes) * 100) / 100), would: why, waiting: w ? { approval_id: w.id, limit: Number(w.limit), days: Number(w.days) } : null };
    }), can: { edit: canDo(req, 'customers', 'edit') } };
  }), G);

  // ============================================================================================ customer types
  route('get', '/sales/customer-types', 'customers:view', wrap(async (req) => {
    const [rows] = await db.query(`SELECT t.type_key, t.label, t.list_key, t.default_credit_days, t.default_credit_limit, t.min_order_value, t.is_active, t.sort_order, COALESCE(l.name, d.name) AS list_name, t.list_key IS NULL AS on_default,
        (SELECT COUNT(*) FROM customers c WHERE c.type_key = t.type_key AND c.merged_into IS NULL) AS customers,
        (SELECT a.approval_id FROM approvals a WHERE a.kind = 'cust_change' AND a.status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(a.payload, '$.dk')) = CONCAT('ctype:', t.type_key) LIMIT 1) AS waiting
        FROM customer_types t LEFT JOIN price_lists l ON l.list_key = t.list_key JOIN price_lists d ON d.is_default = 1 ORDER BY t.sort_order, t.label`);
    const lists = (await pricing.lists(db)).filter((l) => l.is_active).map((l) => ({ key: l.key, name: l.label, is_default: Boolean(l.is_default) }));
    return { rows: rows.map((r) => ({ ...r, customers: Number(r.customers), is_active: Number(r.is_active) === 1, on_default: Number(r.on_default) === 1 })), lists,
      can: { edit: canDo(req, 'customers', 'edit'), move: customers.mayEase(req.admin) } };
  }), G);
  const saveType = (isNew) => wrap(async (req) => tx(async (q) => {
    const b = req.body || {};
    const fields = {};
    const label = String(b.label || '').trim().replace(/\s+/g, ' ');
    const key = isNew ? String(b.type_key || '').trim() : req.params.key;
    const [[was]] = isNew ? [[null]] : await q.query('SELECT * FROM customer_types WHERE type_key = ? FOR UPDATE', [key]);
    if (!isNew && !was) throw new InputError('Customer type not found', 404);
    if (label.length < 2) fields.label = 'Give the name.';
    else { const [[dup]] = await q.query('SELECT type_key FROM customer_types WHERE LOWER(label) = ? AND type_key <> ?', [label.toLowerCase(), key]); if (dup) fields.label = 'This type already exists.'; }
    if (isNew) { if (!/^[a-z]{2,20}$/.test(key)) fields.type_key = '2 to 20 lower case letters, no spaces.'; else { const [[t]] = await q.query('SELECT type_key FROM customer_types WHERE type_key = ?', [key]); if (t) fields.type_key = 'Taken.'; } }
    const days = Number(b.default_credit_days);
    if (!Number.isInteger(days) || days < 0 || days > 120) fields.default_credit_days = 'A whole number, 0 to 120.';
    const lists = await pricing.lists(q);
    const def = lists.find((l) => l.is_default);
    const li = String(b.list_key || '') || null;
    if (li && !lists.some((l) => l.key === li && l.is_active)) fields.list_key = 'Choose a price list in use.';
    if (Object.keys(fields).length) { const e = new InputError(Object.values(fields)[0]); e.code = 'fields'; e.fields = fields; throw e; }
    const wantList = li && li !== def.key ? li : null;
    const curList = was ? was.list_key || null : null;
    const moves = isNew ? Boolean(wantList) : wantList !== (curList && curList !== def.key ? curList : null);
    let note = '';
    if (moves) {
      // v23 C1: putting a type on another price list (a new type on any list but the standard one too) is Accounts or an Admin, with a second person
      if (!customers.mayEase(req.admin) && !(await approvals.needed(q, 'cust_change', {}))) fields.list_key = 'Moving a customer type to another price list is for Accounts or an Admin.';
      if (!isNew && !customers.mayEase(req.admin) && !fields.list_key) fields.list_key = 'Moving a customer type to another price list is for Accounts or an Admin.';
      if (Object.keys(fields).length) { const e = new InputError(fields.list_key, 403); e.code = 'fields'; e.fields = fields; throw e; }
    }
    if (isNew) await q.query('INSERT INTO customer_types (type_key, label, list_key, sort_order, default_credit_days, is_active) VALUES (?, ?, NULL, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM customer_types t2), ?, ?)', [key, label, days, b.is_active === false ? 0 : 1]);
    else await q.query('UPDATE customer_types SET label = ?, default_credit_days = ?, is_active = ? WHERE type_key = ?', [label, days, b.is_active === false ? 0 : 1, key]);
    if (moves) {
      if (await approvals.needed(q, 'cust_change', {})) {
        const [[w]] = await q.query("SELECT approval_id FROM approvals WHERE kind = 'cust_change' AND status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = ?", [`ctype:${key}`]);
        if (w) throw new InputError('A list change for this type already waits for approval.', 409);
        const from = curList ? (lists.find((l) => l.key === curList) || def).label : def.label;
        const to = wantList ? lists.find((l) => l.key === wantList).label : def.label;
        const aid = await approvals.request(q, { kind: 'cust_change', godownId: await godowns.defaultFor(q, req), refType: 'customer_type', refId: key,
          summary: isNew ? `New customer type ${label} on price list ${to} (it buys on ${from} until approved)` : `Customer type ${label}: price list ${from} to ${to} (every customer of this type)`,
          payload: { t: 'ctlist', dk: `ctype:${key}`, type_key: key, list_key: wantList } }, by(req));
        note = ` The list change waits for approval: ${await secondAdmin.waitingLine(q, aid)}`;
      } else await q.query('UPDATE customer_types SET list_key = ? WHERE type_key = ?', [wantList, key]);
    }
    const [[now]] = await q.query('SELECT COALESCE(l.name, d.name) AS list FROM customer_types t LEFT JOIN price_lists l ON l.list_key = t.list_key JOIN price_lists d ON d.is_default = 1 WHERE t.type_key = ?', [key]);
    await audit(q, { empId: by(req), action: isNew ? 'create' : 'update', entity: 'customer_type', entityId: key, before: was ? { label: was.label, list: was.list_key, days: was.default_credit_days, active: was.is_active } : null,
      after: { label, list: now.list, days, active: b.is_active !== false, waiting: Boolean(note) } });
    return { type_key: key, list: now.list, waiting: Boolean(note), message: `${label} buys on ${now.list}${!isNew && moves && !note ? ' from the next order' : ''}.${note}` };
  }));
  route('post', '/sales/customer-types', 'customers:edit', saveType(true), { ...G, status: 201 });
  route('put', '/sales/customer-types/:key', 'customers:edit', saveType(false), G);
  approvals.onApproved('cust_change', async (q, p, empId) => {
    if (!p || p.t !== 'ctlist') return;
    const [[t]] = await q.query('SELECT type_key, list_key FROM customer_types WHERE type_key = ? FOR UPDATE', [p.type_key]);
    if (!t) return;
    await q.query('UPDATE customer_types SET list_key = ? WHERE type_key = ?', [p.list_key, p.type_key]);
    await audit(q, { empId, action: 'update', entity: 'customer_type', entityId: p.type_key, before: { list: t.list_key }, after: { list: p.list_key, approved: true } });
  });
}

module.exports = { register };
