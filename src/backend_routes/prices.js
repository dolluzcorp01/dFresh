// Masters > Prices and Masters > Tax and units > HSN and GST rates (phase 15, v23 section 2). Rights: the roles grid
// row "Prices and tax" (section prices): view = every page, create = a new list / a special price, edit = prices,
// lists, slabs, bulk changes, import, HSN codes, approve = price changes and special prices (on Home > Approvals),
// cancel = end a special price, export = the price Excel. The standard cost and the margin are only for See cost.
// - Price panel: a new price from a date (never backwards; the same date replaces), the lowest allowed price (Admin
//   only; lowering it waits for a second Admin and prices are checked against the old one until signed, v23 PR1) and
//   the pack's own quantity bands. One guard (pricing.guard / checkPrices): above MRP and below the lowest allowed
//   price are refused; below cost plus the margin floor is saved as a waiting change PC-001 (approval kind
//   margin_floor; never used for pricing until approved; nobody approves their own).
// - Lists: name, who it is for, typed with / without GST (switching keeps old rows as typed and adds today's price in
//   the new basis, v22), rounding, customer types (a type belongs to one list; putting a type on another list waits for
//   approval, rule cust_change, phase 16), one default list (never archived).
// - Slabs per list (each more packs, more off; the top slab is checked for every pack without its own bands),
//   change many prices with a preview, special prices (lower of the special and the normal price; more than the
//   allowed % below, raised by someone without Approve, or below cost plus margin waits), Check a price, rate card,
//   Excel per list (price-excel.js), HSN codes with dated rates (tax.js; a new rate waits for a second Admin).
const { audit } = require('./audit');
const pricing = require('./pricing');
const tax = require('./tax');
const approvals = require('./approvals');
const secondAdmin = require('./second-admin');
const priceExcel = require('./price-excel');
const theme = require('./excel-theme');
const godowns = require('./godowns');

const r2 = pricing.round2;
const money = pricing.money;
const SALES_ROLE = 6;

function register({ route, tx, db, by, InputError, canDo, commerceGate, upload, exportedBy, seesCost }) {
  const G = { before: [commerceGate] };
  const fieldsErr = (fields, msg = 'Fix the fields marked in red') => { const e = new InputError(msg); e.code = 'fields'; e.fields = fields; return e; };
  const asErr = (e) => {
    if (e instanceof pricing.PricingError) { const x = new InputError(e.message, e.status); if (e.errors) { x.code = 'fields'; x.fields = e.errors; } return x; }
    if (e instanceof tax.TaxError) { const x = new InputError(e.message, e.status); if (e.fields) { x.code = 'fields'; x.fields = e.fields; } return x; }
    return e;
  };
  const wrap = (fn) => async (req, res) => { try { return await fn(req, res); } catch (e) { throw asErr(e); } };
  const isAdmin = (req) => Boolean(req.admin && req.admin.is_admin);
  const listOr404 = async (q, key) => {
    const l = (await pricing.lists(q)).find((x) => x.key === key);
    if (!l) throw new InputError('No such price list', 404);
    return l;
  };
  const today = () => pricing.istToday();
  const seq = (prefix, id) => `${prefix}-${String(id).padStart(3, '0')}`;

  // ------------------------------------------------------------------------------------------------ lists overview
  route('get', '/prices/lists', 'prices:view', wrap(async (req) => {
    const ls = await pricing.lists(db);
    const [types] = await db.query('SELECT type_key, label, list_key, is_active FROM customer_types ORDER BY sort_order, label');
    const skus = (await pricing.skuRows(db)).filter((s) => s.product_status !== 'draft');
    const rows = await pricing.rowsOn(db, today());
    const [slabs] = await db.query('SELECT list_key, COUNT(*) AS n FROM list_slabs GROUP BY list_key');
    const [waits] = await db.query("SELECT list_key, COUNT(*) AS n FROM price_requests WHERE status = 'pending' GROUP BY list_key");
    const [tw] = await db.query("SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$.key')) AS k FROM approvals WHERE kind = 'cust_change' AND status = 'pending'");
    return {
      lists: ls.map((l) => ({ ...l, type_labels: types.filter((t) => t.list_key === l.key).map((t) => t.label),
        priced: skus.filter((s) => (rows.get(s.sku_code) || {})[l.key] && rows.get(s.sku_code)[l.key].price !== null).length, packs: skus.length,
        slabs: Number((slabs.find((x) => x.list_key === l.key) || {}).n || 0), waiting: Number((waits.find((x) => x.list_key === l.key) || {}).n || 0), types_waiting: tw.some((x) => x.k === l.key) })),
      types: types.map((t) => ({ type_key: t.type_key, label: t.label, list_key: t.list_key, is_active: Number(t.is_active) === 1 })),
      can: { create: canDo(req, 'prices', 'create'), edit: canDo(req, 'prices', 'edit'), export: canDo(req, 'prices', 'export'), approve: canDo(req, 'prices', 'approve'), admin: isAdmin(req), seeCost: seesCost(req) },
    };
  }), G);

  // ------------------------------------------------------------------------------------------------ one list
  route('get', '/prices/lists/:key', 'prices:view', wrap(async (req) => {
    const l = await listOr404(db, req.params.key);
    const day = today();
    const see = seesCost(req);
    const rows = await priceExcel.listRows(db, l);
    const up = await pricing.upcoming(db, day);
    const [bands] = await db.query('SELECT DISTINCT sku_code FROM sku_bands WHERE list_key = ?', [l.key]);
    const [waits] = await db.query("SELECT request_no, sku_code, price, effective_from FROM price_requests WHERE list_key = ? AND status = 'pending'", [l.key]);
    const rule = await pricing.marginRule(db);
    const [cats] = await db.query("SELECT c.category_key, COALESCE(t.name, c.category_key) AS name FROM categories c LEFT JOIN category_translations t ON t.category_key = c.category_key AND t.lang_code = 'en' ORDER BY c.sort_order");
    return {
      list: l, today: day, slabs: await pricing.slabsOf(db, l.key), categories: cats, seeCost: see,
      can: { edit: canDo(req, 'prices', 'edit'), export: canDo(req, 'prices', 'export'), admin: isAdmin(req) },
      rows: rows.map((r) => {
        const s = r.s;
        const next = (up.get(s.sku_code) || []).find((x) => x.list_key === l.key) || null;
        const w = waits.find((x) => x.sku_code === s.sku_code);
        const need = pricing.marginNeed(s.std_cost, rule);
        const margin = see && r.ex !== null && s.std_cost !== null && r.ex > 0 ? Math.round(((r.ex - s.std_cost) / r.ex) * 1000) / 10 : null;
        return {
          sku_code: s.sku_code, name: s.name, size_label: s.size_label, category_key: s.category_key, typed: r.typed, from: r.from, ex: r.ex, inc: r.inc, rate: r.rate,
          fallback: r.fallback, per_carton: s.packs_per_carton, carton_inc: r.inc === null ? null : r2(r.inc * s.packs_per_carton), min_price: s.min_price,
          below_floor: s.min_price !== null && r.ex !== null && r.ex < s.min_price - 0.004, own_bands: bands.some((b) => b.sku_code === s.sku_code),
          next: next ? { price: next.price, basis: next.basis, from: next.effective_from } : null,
          waiting: w ? { no: w.request_no, price: Number(w.price), from: pricing.ymd(w.effective_from) } : null,
          ...(see ? { std_cost: s.std_cost, margin, margin_tone: margin === null ? null : need !== null && r.ex < need - 0.004 ? 'bad' : margin < 10 ? 'warn' : 'good' } : {}),
        };
      }),
    };
  }), G);

  // a new list: copies another's prices today moved by a %, rounded; packs that would break a rule are skipped
  route('post', '/prices/lists', 'prices:create', wrap(async (req) => tx(async (q) => {
    const b = req.body || {};
    const ls = await pricing.lists(q);
    const f = {};
    const name = String(b.name || '').trim().slice(0, 40);
    if (!name) f.name = 'Give the list a name.';
    else if (ls.some((l) => l.name.toLowerCase() === name.toLowerCase())) f.name = 'Another list has this name.';
    const adj = Number(b.adjust || 0);
    if (!Number.isFinite(adj) || adj < -50 || adj > 50) f.adjust = 'Between -50 and 50.';
    const src = b.copy_from ? ls.find((l) => l.key === b.copy_from) : null;
    if (b.copy_from && !src) f.copy_from = 'Choose a list to copy.';
    const typed = b.typed === 'inc' ? 'inc' : 'ex';
    const round = [0, 0.5, 1].includes(Number(b.round_to)) ? Number(b.round_to) : 1;
    if (Object.keys(f).length) throw fieldsErr(f);
    let key = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 20) || 'list';
    const taken = new Set(ls.map((l) => l.key));
    for (let i = 2; taken.has(key); i += 1) key = `${key.slice(0, 17)}_${i}`;
    await q.query('INSERT INTO price_lists (list_key, name, about, typed, round_to, sort_order, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [key, name, String(b.about || '').trim().slice(0, 120) || null, typed, round, ls.length + 1, by(req)]);
    const note = await askTypes(q, req, key, name, Array.isArray(b.types) ? b.types : [], []);
    let copied = 0; let skipped = 0;
    if (src) {
      const rows = await priceExcel.listRows(q, src);
      const changes = [];
      for (const r of rows.filter((x) => x.ex !== null && !x.fallback)) {
        const ex = r.ex * (1 + adj / 100);
        const typedP = pricing.roundTo(pricing.fromEx(ex, typed, r.rate), round);
        const [chk] = (await pricing.checkPrices(q, [{ sku_code: r.s.sku_code, list_key: key, price: typedP }], today())).values();
        if (chk.hard || chk.soft) { skipped += 1; continue; }
        changes.push({ sku_code: r.s.sku_code, list_key: key, price: typedP });
      }
      if (changes.length) copied = (await pricing.setPrices(q, changes, { source: 'copy', empId: by(req), checked: true })).changed.length;
      const [sl] = await q.query('SELECT min_qty, pct FROM list_slabs WHERE list_key = ?', [src.key]);
      for (const s of sl) await q.query('INSERT INTO list_slabs (list_key, min_qty, pct) VALUES (?, ?, ?)', [key, s.min_qty, s.pct]);
    }
    await audit(q, { empId: by(req), action: 'create', entity: 'price_list', entityId: key, after: { name, typed, copy_from: src ? src.name : null, adjust: adj, copied, skipped } });
    return { list_key: key, message: `${name}${src ? `: ${copied} prices from ${src.name}${adj ? ` ${adj > 0 ? '+' : ''}${adj}%` : ''}` : ''}${skipped ? `, ${skipped} packs skipped: below their lowest allowed price or cost plus margin, or above MRP` : ''}.${note}` };
  })), G);

  /**
   * phase 16 (carry-over of phase 15, v23 cust_change): putting customer types on another price list waits for approval
   * by someone with Approve on Customers (Accounts or an Admin), also when an Admin asks: a second person decides. With
   * the rule switched off it is done at once. One change waits per list -> the note for the message
   */
  async function askTypes(q, req, key, listName, wanted, current) {
    const want = [...new Set(wanted.map(String))].sort();
    if (want.length === current.length && want.every((t) => current.includes(t))) return '';
    if (!(await approvals.needed(q, 'cust_change', {}))) return moveTypes(q, key, want, by(req));
    const [[w]] = await q.query("SELECT approval_id FROM approvals WHERE kind = 'cust_change' AND status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = ?", [`listtypes:${key}`]);
    if (w) return ` A customer types change already waits for approval on this list: ${await secondAdmin.waitingLine(q, w.approval_id)}`;
    const [types] = await q.query('SELECT type_key, label FROM customer_types');
    const label = (k) => (types.find((t) => t.type_key === k) || { label: k }).label;
    const aid = await approvals.request(q, { kind: 'cust_change', godownId: await godowns.defaultFor(q, req), refType: 'price_list', refId: key,
      summary: `Price list ${listName}: customer types ${current.map(label).join(', ') || 'none'} to ${want.map(label).join(', ') || 'none'}`, payload: { t: 'listtypes', dk: `listtypes:${key}`, key, types: want } }, by(req));
    await audit(q, { empId: by(req), action: 'request', entity: 'price_list', entityId: key, after: { customer_types: want.map(label), waiting: true } });
    return ` The customer types change waits for approval: ${await secondAdmin.waitingLine(q, aid)}`;
  }
  approvals.onApproved('cust_change', async (q, p, empId) => {
    if (!p || p.t !== 'listtypes') return;
    const [[l]] = await q.query('SELECT list_key FROM price_lists WHERE list_key = ?', [p.key]);
    if (l) await moveTypes(q, p.key, p.types, empId);
  });
  approvals.onRecheck('cust_change', async (q, p) => {
    if (!p || p.t !== 'listtypes') return '';
    const [[l]] = await q.query('SELECT status FROM price_lists WHERE list_key = ?', [p.key]);
    if (!l) return 'The price list is gone.';
    if (l.status === 'archived' && p.types.length) return 'The price list is archived now.';
    return '';
  });

  /** customer types ticked for a list: each leaves its old list -> the note */
  async function moveTypes(q, key, wanted, empId) {
    const [types] = await q.query('SELECT type_key, label, list_key FROM customer_types FOR UPDATE');
    const ls = await pricing.lists(q);
    const want = new Set(wanted.map(String));
    const notes = [];
    for (const t of types) {
      if (want.has(t.type_key) && t.list_key !== key) {
        if (t.list_key) notes.push(` Note: customer type ${t.label} left the ${(ls.find((l) => l.key === t.list_key) || { name: t.list_key }).name} list.`);
        await q.query('UPDATE customer_types SET list_key = ? WHERE type_key = ?', [key, t.type_key]);
        await audit(q, { empId, action: 'update', entity: 'price_list', entityId: key, before: { [`type ${t.label}`]: t.list_key || 'default' }, after: { [`type ${t.label}`]: key } });
      } else if (!want.has(t.type_key) && t.list_key === key) {
        await q.query('UPDATE customer_types SET list_key = NULL WHERE type_key = ?', [t.type_key]);
        await audit(q, { empId, action: 'update', entity: 'price_list', entityId: key, before: { [`type ${t.label}`]: key }, after: { [`type ${t.label}`]: 'default list' } });
      }
    }
    return notes.join('');
  }

  // list settings
  route('put', '/prices/lists/:key', 'prices:edit', wrap(async (req) => tx(async (q) => {
    const b = req.body || {};
    const [[l]] = await q.query('SELECT list_key, name, about, typed, round_to, is_default, status FROM price_lists WHERE list_key = ? FOR UPDATE', [req.params.key]);
    if (!l) throw new InputError('No such price list', 404);
    const ls = await pricing.lists(q);
    const f = {};
    const name = b.name === undefined ? l.name : String(b.name || '').trim().slice(0, 40);
    if (!name) f.name = 'Give the list a name.';
    else if (ls.some((x) => x.key !== l.list_key && x.name.toLowerCase() === name.toLowerCase())) f.name = 'Another list has this name.';
    const isDef = b.is_default === undefined ? Number(l.is_default) === 1 : Boolean(b.is_default);
    const status = b.status === 'archived' ? 'archived' : b.status === 'active' ? 'active' : l.status;
    if (Number(l.is_default) === 1 && !isDef) f.is_default = 'There must always be a default list. Make another list the default instead.';
    if ((isDef || Number(l.is_default) === 1) && status === 'archived') f.status = 'The default list cannot be archived.';
    const types = Array.isArray(b.types) ? b.types.map(String) : null;
    const mine = ls.find((x) => x.key === l.list_key).types;
    if (status === 'archived' && (types || mine).length) f.status = 'Untick its customer types first; they will use the default list.';
    const typed = b.typed === 'inc' || b.typed === 'ex' ? b.typed : l.typed;
    const round = b.round_to !== undefined && [0, 0.5, 1].includes(Number(b.round_to)) ? Number(b.round_to) : Number(l.round_to);
    if (Object.keys(f).length) throw fieldsErr(f);
    const about = b.about === undefined ? l.about : String(b.about || '').trim().slice(0, 120) || null;
    const ch = [];
    const before = {}; const after = {};
    const put = (k, a, v, label) => { if (String(a ?? '') !== String(v ?? '')) { before[label] = a; after[label] = v; ch.push(label); } };
    put('name', l.name, name, 'name'); put('about', l.about, about, 'who it is for'); put('round_to', Number(l.round_to), round, 'rounding'); put('status', l.status, status, 'status');
    put('is_default', Number(l.is_default) === 1, isDef, 'default');
    await q.query('UPDATE price_lists SET name = ?, about = ?, round_to = ?, status = ?, updated_by = ?, updated_at = UTC_TIMESTAMP() WHERE list_key = ?', [name, about, round, status, by(req), l.list_key]);
    if (isDef && Number(l.is_default) !== 1) {
      await q.query('UPDATE price_lists SET is_default = 0 WHERE is_default = 1');
      await q.query('UPDATE price_lists SET is_default = 1 WHERE list_key = ?', [l.list_key]);
    }
    let basisMsg = '';
    if (typed !== l.typed) { basisMsg = await switchBasis(q, l.list_key, l.typed, typed, by(req)); put('typed', l.typed === 'inc' ? 'with GST' : 'without GST', typed === 'inc' ? 'with GST' : 'without GST', 'prices typed'); }
    const note = types ? await askTypes(q, req, l.list_key, name, types, mine) : '';
    if (ch.length) await audit(q, { empId: by(req), action: 'update', entity: 'price_list', entityId: l.list_key, before, after });
    const typesDone = note && !/waits for approval/.test(note) ? 1 : 0;
    return { waiting: /waits for approval/.test(note), message: `${ch.length + typesDone} change${ch.length + typesDone === 1 ? '' : 's'}.${basisMsg}${note}` };
  })), G);

  /**
   * v21 / v22: switching how a list's prices are typed keeps every old row as typed (shown converted) and adds today's
   * price in the new basis (converted so the customer pays the same); a row already starting today is converted in
   * place. The pack's own bands are converted in place.
   */
  async function switchBasis(q, key, from, to, empId) {
    const day = today();
    const rates = await tax.ratesOn(q, day);
    const [skus] = await q.query('SELECT s.sku_code, p.hsn_code FROM skus s JOIN products p ON p.product_id = s.product_id');
    const rateOf = new Map(skus.map((s) => [s.sku_code, rates.get(s.hsn_code)]));
    const rows = await pricing.rowsOn(q, day);
    let n = 0;
    for (const [sku, per] of rows) {
      const r = per[key];
      const rate = rateOf.get(sku);
      if (!r || r.price === null || rate === undefined || r.basis === to) continue;
      const price = pricing.fromEx(pricing.toEx(r.price, r.basis, rate), to, rate);
      await q.query(`INSERT INTO sku_prices (sku_code, list_key, effective_from, price, basis, created_by) VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE price = VALUES(price), basis = VALUES(basis), created_by = VALUES(created_by), created_at = UTC_TIMESTAMP()`, [sku, key, day, price, to, empId]);
      await q.query('INSERT INTO price_changes (sku_code, list_key, old_price, new_price, basis, effective_from, source, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [sku, key, r.price, price, to, day, 'basis', empId]);
      n += 1;
    }
    const [bands] = await q.query('SELECT sku_code, min_qty, price FROM sku_bands WHERE list_key = ?', [key]);
    for (const bd of bands) {
      const rate = rateOf.get(bd.sku_code);
      if (rate === undefined) continue;
      await q.query('UPDATE sku_bands SET price = ? WHERE list_key = ? AND sku_code = ? AND min_qty = ?', [pricing.fromEx(pricing.toEx(Number(bd.price), from, rate), to, rate), key, bd.sku_code, bd.min_qty]);
    }
    await q.query('UPDATE price_lists SET typed = ? WHERE list_key = ?', [to, key]);
    return ` Prices are now typed ${to === 'inc' ? 'with' : 'without'} GST: ${n} price${n === 1 ? '' : 's'} converted from today so the customer pays the same; older prices stay as they were typed.`;
  }

  // ------------------------------------------------------------------------------------------------ one pack on a list
  route('get', '/prices/lists/:key/skus/:sku', 'prices:view', wrap(async (req) => {
    const l = await listOr404(db, req.params.key);
    const sku = String(req.params.sku).toUpperCase();
    const facts = await pricing.packFacts(db, sku);
    if (!facts) throw new InputError('No such pack', 404);
    const see = seesCost(req);
    const [hist] = await db.query('SELECT effective_from, price, basis, created_by, created_at FROM sku_prices WHERE sku_code = ? AND list_key = ? ORDER BY effective_from', [sku, l.key]);
    const [[w]] = await db.query("SELECT request_no, price, effective_from, why, raised_by FROM price_requests WHERE sku_code = ? AND list_key = ? AND status = 'pending'", [sku, l.key]);
    const rate = await tax.rateOn(db, facts.hsn_code, today());
    const rule = await pricing.marginRule(db);
    const [[fl]] = await db.query("SELECT approval_id, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.value')) AS v FROM approvals WHERE status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = ?", [`pricefloor:${sku}`]);
    const row = (await priceExcel.listRows(db, l)).find((r) => r.s.sku_code === sku);
    return {
      list: l, sku, name: row ? `${row.s.name} ${row.s.size_label || ''}`.trim() : sku, today: today(), rate, mrp: facts.mrp, min_price: facts.min_price, hsn: facts.hsn_code,
      floor_waiting: fl ? { approval_id: fl.approval_id, value: fl.v === 'null' || fl.v === null ? null : Number(fl.v) } : null,
      now: row ? { typed: row.typed, ex: row.ex, inc: row.inc, from: row.from, fallback: row.fallback } : null,
      history: hist.map((h) => ({ from: pricing.ymd(h.effective_from), price: h.price === null ? null : Number(h.price), basis: h.basis, by: h.created_by })),
      waiting: w ? { no: w.request_no, price: Number(w.price), from: pricing.ymd(w.effective_from), why: w.why, raised_by: w.raised_by, mine: w.raised_by === by(req) } : null,
      bands: await pricing.bandsOf(db, l.key, sku),
      ...(see ? { std_cost: facts.std_cost, need: pricing.marginNeed(facts.std_cost, rule) } : {}),
      can: { edit: canDo(req, 'prices', 'edit'), admin: isAdmin(req) },
    };
  }), G);

  route('put', '/prices/lists/:key/skus/:sku', 'prices:edit', wrap(async (req) => tx(async (q) => {
    const l = await listOr404(q, req.params.key);
    const sku = String(req.params.sku).toUpperCase();
    const facts = await pricing.packFacts(q, sku);
    if (!facts) throw new InputError('No such pack', 404);
    await q.query('SELECT sku_code FROM skus WHERE sku_code = ? FOR UPDATE', [sku]);
    const b = req.body || {};
    const f = {};
    const out = [];
    let waiting = false;
    // the lowest allowed price (Admin only); a lower or empty one waits for a second Admin, checks use the old one
    let floorFor;
    if (b.min_price !== undefined && String(b.min_price ?? '') !== String(facts.min_price ?? '')) {
      const p = pricing.parsePrice(b.min_price);
      if (!isAdmin(req)) f.min_price = 'Only an Admin sets the lowest allowed price.';
      else if (p.error || (p.value !== null && p.value < 0)) f.min_price = '0 or more, or leave empty.';
      else if (facts.min_price !== null && (p.value === null || p.value < facts.min_price)) {
        floorFor = facts.min_price;
        if (!Object.keys(f).length) {
          const r = await secondAdmin.ask(q, { t: 'pricefloor', dk: `pricefloor:${sku}`, summary: `${sku}: lowest allowed price ${money(facts.min_price)} to ${p.value === null ? 'none' : money(p.value)}`,
            payload: { sku, value: p.value, label: 'Lower the lowest allowed price' } }, by(req));
          out.push(`Lowering the lowest allowed price waits for a second Admin: ${r.message}`);
          waiting = true;
        }
      } else {
        await q.query('UPDATE skus SET min_price = ? WHERE sku_code = ?', [p.value, sku]);
        await audit(q, { empId: by(req), action: 'update', entity: 'sku_price', entityId: `${sku}/floor`, before: { 'lowest allowed price': facts.min_price === null ? 'none' : money(facts.min_price) }, after: { 'lowest allowed price': money(p.value) } });
        facts.min_price = p.value;
        out.push(`Lowest allowed price ${money(p.value)}.`);
      }
    }
    // a new price from a date
    if (b.price !== undefined && String(b.price ?? '').trim() !== '') {
      const p = pricing.parsePrice(b.price);
      const from = String(b.from || '').trim();
      if (p.error || p.value === null || p.value <= 0) f.price = p.error && /2 decimals/.test(p.error) ? 'At most 2 decimals (paise).' : 'A price more than 0.';
      if (!from) f.from = 'Pick the start date.';
      else if (!pricing.isDate(from)) f.from = 'A date like 2026-11-01.';
      else if (from < today()) f.from = 'Cannot start in the past. Quotes and orders already made keep their price.';
      if (!f.price && !f.from) {
        const [res] = (await pricing.checkPrices(q, [{ sku_code: sku, list_key: l.key, price: p.value }], from, { floors: floorFor === undefined ? {} : { [sku]: floorFor } })).values();
        const [[w]] = await q.query("SELECT request_no, price, effective_from FROM price_requests WHERE sku_code = ? AND list_key = ? AND status = 'pending'", [sku, l.key]);
        if (res.hard) f.price = res.hard;
        else if (res.soft) {
          if (w) f.price = `A change for this pack (${money(w.price)} from ${pricing.ymd(w.effective_from)}) already waits for approval. It is decided first.`;
          else if (!((await pricing.marginRule(q)).on)) {
            const r = await pricing.setPrices(q, [{ sku_code: sku, list_key: l.key, price: p.value }], { effective: from, source: 'grid', empId: by(req), checked: true });
            out.push(r.changed.length ? `${from > today() ? `The new price starts on ${from}.` : 'Saved.'}` : 'Price unchanged.');
          } else {
            const [ins] = await q.query("INSERT INTO price_requests (request_no, sku_code, list_key, price, basis, effective_from, why, raised_by) VALUES ('', ?, ?, ?, ?, ?, ?, ?)",
              [sku, l.key, p.value, l.typed, from, res.soft.slice(0, 255), by(req)]);
            const no = seq('PC', ins.insertId);
            const aid = await approvals.request(q, { kind: 'margin_floor', godownId: 1, refType: 'price_request', refId: no, target: `sku:${sku}`,
              summary: `${no}: ${sku} on ${l.name} ${money(p.value)} ${l.typed === 'inc' ? 'with' : 'without'} GST from ${from}: ${res.soft}`, payload: { t: 'price', no } }, by(req));
            await q.query('UPDATE price_requests SET request_no = ?, approval_id = ? WHERE request_id = ?', [no, aid, ins.insertId]);
            await audit(q, { empId: by(req), action: 'request', entity: 'sku_price', entityId: `${sku}/${l.key}`, after: { request: no, price: p.value, from, why: 'price below cost plus margin' } });
            out.push(`${no} waits for approval: ${res.soft.replace(/\.$/, '')}.`);
            waiting = true;
          }
        } else {
          const r = await pricing.setPrices(q, [{ sku_code: sku, list_key: l.key, price: p.value }], { effective: from, source: 'grid', empId: by(req), checked: true });
          out.push(r.changed.length ? `${from > today() ? `The new price starts on ${from}.` : 'Saved.'}` : 'Price unchanged.');
        }
      }
    }
    // the pack's own quantity bands on this list
    if (Array.isArray(b.bands)) {
      const bands = b.bands.filter((x) => String(x.min ?? '').trim() !== '' || String(x.price ?? '').trim() !== '');
      const base = (await priceExcel.listRows(q, l)).find((r) => r.s.sku_code === sku);
      const basePrice = base ? base.typed : null;
      const rate = await tax.rateOn(q, facts.hsn_code, today());
      const rule = await pricing.marginRule(q);
      let prevMin = 1; let prevPrice = basePrice;
      const clean = [];
      for (const [i, x] of bands.entries()) {
        const k = `bands.${i}`;
        const min = Number(x.min); const p = pricing.parsePrice(x.price);
        if (!Number.isInteger(min) || min < 2) { f[k] = 'From 2 packs or more, a whole number.'; break; }
        if (p.error || p.value === null || p.value <= 0) { f[k] = 'Give the price for this band.'; break; }
        if (min <= prevMin) { f[k] = 'Each band starts at more packs than the one before.'; break; }
        if (prevPrice !== null && p.value >= prevPrice) { f[k] = `More packs must cost less per pack than ${money(prevPrice)}.`; break; }
        const g = await pricing.guard(q, facts, pricing.toEx(p.value, l.typed, rate || 0), today(), { rule, floor: floorFor });
        if (g.floor) { f[k] = 'Below the lowest allowed price.'; break; }
        if (g.margin) { f[k] = `Below cost plus the margin floor (${money(g.need)} without GST). A band cannot wait for approval: use a special price instead.`; break; }
        clean.push({ min, price: p.value }); prevMin = min; prevPrice = p.value;
      }
      if (!Object.keys(f).length) {
        const old = await pricing.bandsOf(q, l.key, sku);
        if (JSON.stringify(old) !== JSON.stringify(clean)) {
          await q.query('DELETE FROM sku_bands WHERE list_key = ? AND sku_code = ?', [l.key, sku]);
          for (const x of clean) await q.query('INSERT INTO sku_bands (list_key, sku_code, min_qty, price) VALUES (?, ?, ?, ?)', [l.key, sku, x.min, x.price]);
          await audit(q, { empId: by(req), action: 'update', entity: 'sku_price', entityId: `${sku}/${l.key}`, before: { 'own quantity prices': old.map((x) => `${x.min}+ ${x.price}`).join(', ') || 'none' }, after: { 'own quantity prices': clean.map((x) => `${x.min}+ ${x.price}`).join(', ') || 'none' } });
          out.push(clean.length ? 'Own quantity prices saved.' : 'Own quantity prices removed: the list slabs apply.');
        }
      }
    }
    if (Object.keys(f).length) throw fieldsErr(f, Object.values(f)[0]);
    return { message: out.join(' ') || 'Nothing changed.', waiting };
  })), G);

  // a waiting price change, approved / rejected on Home > Approvals (nobody approves their own: the engine)
  approvals.onApproved('margin_floor', async (q, p, empId) => {
    if (p.t === 'slabs') { await saveSlabs(q, p.list_key, p.slabs, empId, true); return; }
    const [[r]] = await q.query("SELECT * FROM price_requests WHERE request_no = ? AND status = 'pending' FOR UPDATE", [p.no]);
    if (!r) return;
    await pricing.setPrices(q, [{ sku_code: r.sku_code, list_key: r.list_key, price: Number(r.price), basis: r.basis }], { effective: pricing.ymd(r.effective_from) < today() ? today() : pricing.ymd(r.effective_from), source: 'approval', empId, checked: true });
    await q.query("UPDATE price_requests SET status = 'approved', decided_by = ?, decided_at = UTC_TIMESTAMP() WHERE request_id = ?", [empId, r.request_id]);
    await audit(q, { empId, action: 'approve', entity: 'sku_price', entityId: `${r.sku_code}/${r.list_key}`, after: { request: r.request_no, price: Number(r.price), from: pricing.ymd(r.effective_from) } });
  });
  approvals.onRecheck('margin_floor', async (q, p) => {
    if (p.t !== 'price') return '';
    const [[r]] = await q.query('SELECT sku_code, price, basis, effective_from FROM price_requests WHERE request_no = ?', [p.no]);
    if (!r) return '';
    const facts = await pricing.packFacts(q, r.sku_code);
    const day = pricing.ymd(r.effective_from) < today() ? today() : pricing.ymd(r.effective_from);
    const rate = await tax.rateOn(q, facts.hsn_code, day);
    const g = await pricing.guard(q, facts, pricing.toEx(Number(r.price), r.basis, rate || 0), day);
    return g.mrp ? `It is now above the MRP (${money(facts.mrp)}).` : g.floor ? 'It is now below the lowest allowed price.' : '';
  });
  approvals.onClosed('margin_floor', async (q, p, status, empId) => {
    if (p.t !== 'price') return;
    await q.query("UPDATE price_requests SET status = 'rejected', decided_by = ?, decided_at = UTC_TIMESTAMP() WHERE request_no = ? AND status = 'pending'", [empId, p.no]);
  });
  secondAdmin.on('pricefloor', {
    async apply(q, p, empId) {
      const [[s]] = await q.query('SELECT min_price FROM skus WHERE sku_code = ? FOR UPDATE', [p.sku]);
      if (!s) return;
      await q.query('UPDATE skus SET min_price = ? WHERE sku_code = ?', [p.value, p.sku]);
      await audit(q, { empId, action: 'update', entity: 'sku_price', entityId: `${p.sku}/floor`, before: { 'lowest allowed price': s.min_price === null ? 'none' : money(s.min_price) }, after: { 'lowest allowed price': p.value === null ? 'none' : money(p.value), approved: true } });
    },
  });

  // ------------------------------------------------------------------------------------------------ change many prices
  route('post', '/prices/lists/:key/bulk', 'prices:edit', wrap(async (req) => tx(async (q) => {
    const l = await listOr404(q, req.params.key);
    const b = req.body || {};
    const mode = b.mode === 'amount' ? 'amount' : 'pct';
    const v = Number(String(b.value ?? '').trim());
    if (!String(b.value ?? '').trim() || !Number.isFinite(v) || v === 0) throw new InputError('Type how much to change, not 0.');
    if (mode === 'pct' && (v < -50 || v > 100)) throw new InputError('A percent change between -50 and 100.');
    const from = String(b.from || '').trim();
    if (!pricing.isDate(from) || from < today()) throw new InputError('Wrong start date: today or later.');
    const rows = (await priceExcel.listRows(q, l)).filter((r) => r.typed !== null && !r.fallback && (!b.category_key || r.s.category_key === b.category_key));
    const [waits] = await q.query("SELECT sku_code FROM price_requests WHERE list_key = ? AND status = 'pending'", [l.key]);
    const plan = [];
    for (const r of rows) {
      const next = pricing.roundTo(mode === 'pct' ? r.typed * (1 + v / 100) : r.typed + v, l.round_to);
      const row = { sku_code: r.s.sku_code, name: `${r.s.name} ${r.s.size_label || ''}`.trim(), old: r.typed, next, skip: '' };
      if (next <= 0) row.skip = 'would be 0 or less';
      else if (waits.some((w) => w.sku_code === r.s.sku_code)) row.skip = 'a change already waits for approval';
      else {
        const [c] = (await pricing.checkPrices(q, [{ sku_code: r.s.sku_code, list_key: l.key, price: next }], from)).values();
        if (c.hard) row.skip = /MRP/.test(c.hard) ? 'above MRP' : /slab/.test(c.hard) ? 'top slab below lowest allowed' : 'below lowest allowed';
        else if (c.soft) row.skip = /At \d+\+/.test(c.soft) && !/^Below cost/.test(c.soft) ? 'top slab below cost + margin, change it alone' : 'below cost + margin, change it alone';
      }
      if (next !== r.typed || row.skip) plan.push(row);
    }
    if (!b.apply) return { preview: plan, from, list: l.name };
    const go = plan.filter((x) => !x.skip && x.next !== x.old);
    if (!go.length) throw new InputError('Nothing to change.');
    await pricing.setPrices(q, go.map((x) => ({ sku_code: x.sku_code, list_key: l.key, price: x.next })), { effective: from, source: 'bulk', empId: by(req), checked: true });
    await audit(q, { empId: by(req), action: 'bulk', entity: 'price_list', entityId: l.key, after: { change: `${mode === 'pct' ? `${v}%` : money(v)}`, category: b.category_key || 'all', from, prices: go.length } });
    return { message: `${go.length} prices changed. They start on ${from}. Quotes and orders already made keep their price.`, changed: go.length };
  })), G);

  // ------------------------------------------------------------------------------------------------ quantity slabs
  /** check slabs -> { fields, hard, soft: [sku] } ; save when asked */
  async function checkSlabs(q, l, slabs) {
    const fields = {};
    let prev = null;
    for (const [i, s] of slabs.entries()) {
      if (!Number.isInteger(s.min) || s.min < 2) { fields[`slabs.${i}`] = 'From 2 packs or more, a whole number.'; break; }
      if (!Number.isFinite(s.pct) || s.pct <= 0 || s.pct > 50) { fields[`slabs.${i}`] = 'Percent off between 0 and 50.'; break; }
      if (prev && s.min <= prev.min) { fields[`slabs.${i}`] = 'Each slab starts at more packs than the one before.'; break; }
      if (prev && s.pct <= prev.pct) { fields[`slabs.${i}`] = `More packs must get more off than ${prev.pct}%.`; break; }
      prev = s;
    }
    if (Object.keys(fields).length || !slabs.length) return { fields, hard: [], soft: [] };
    const rows = (await priceExcel.listRows(q, l)).filter((r) => r.typed !== null);
    const [own] = await q.query('SELECT DISTINCT sku_code FROM sku_bands WHERE list_key = ?', [l.key]);
    const hard = []; const soft = [];
    const rule = await pricing.marginRule(q);
    for (const r of rows.filter((x) => !own.some((o) => o.sku_code === x.s.sku_code))) {
      const facts = await pricing.packFacts(q, r.s.sku_code);
      const t = await pricing.topSlabCheck(q, facts, l, r.typed, today(), { rule, slabs });
      if (t.hard) hard.push(r.s.sku_code); else if (t.soft) soft.push(r.s.sku_code);
    }
    return { fields, hard, soft };
  }
  async function saveSlabs(q, key, slabs, empId, approved = false) {
    const old = await pricing.slabsOf(q, key);
    await q.query('DELETE FROM list_slabs WHERE list_key = ?', [key]);
    for (const s of slabs) await q.query('INSERT INTO list_slabs (list_key, min_qty, pct) VALUES (?, ?, ?)', [key, s.min, s.pct]);
    await audit(q, { empId, action: 'update', entity: 'price_list', entityId: key, before: { slabs: old.map((s) => `${s.min}+ ${s.pct}%`).join(', ') || 'none' }, after: { slabs: slabs.map((s) => `${s.min}+ ${s.pct}%`).join(', ') || 'none', ...(approved ? { approved: true } : {}) } });
  }
  route('get', '/prices/slabs/:key', 'prices:view', wrap(async (req) => {
    const l = await listOr404(db, req.params.key);
    const [own] = await db.query('SELECT b.sku_code, GROUP_CONCAT(CONCAT(b.min_qty, \'+ \', b.price) ORDER BY b.min_qty SEPARATOR \', \') AS bands FROM sku_bands b WHERE b.list_key = ? GROUP BY b.sku_code', [l.key]);
    const [[w]] = await db.query("SELECT approval_id, summary FROM approvals WHERE kind = 'margin_floor' AND status = 'pending' AND ref_type = 'price_slabs' AND ref_id = ?", [l.key]);
    return { list: l, lists: (await pricing.lists(db)).map((x) => ({ key: x.key, name: x.name })), slabs: await pricing.slabsOf(db, l.key), own, waiting: w || null, can: { edit: canDo(req, 'prices', 'edit') } };
  }), G);
  route('put', '/prices/slabs/:key', 'prices:edit', wrap(async (req) => tx(async (q) => {
    const l = await listOr404(q, req.params.key);
    const slabs = (Array.isArray((req.body || {}).slabs) ? req.body.slabs : []).filter((s) => String(s.min ?? '').trim() !== '' || String(s.pct ?? '').trim() !== '')
      .map((s) => ({ min: Number(s.min), pct: Number(s.pct) }));
    const old = await pricing.slabsOf(q, l.key);
    if (JSON.stringify(old) === JSON.stringify(slabs)) return { message: 'Nothing changed' };
    const c = await checkSlabs(q, l, slabs);
    if (Object.keys(c.fields).length) throw fieldsErr(c.fields, 'Not saved: fix the slab marked in red.');
    const top = slabs[slabs.length - 1];
    if (c.hard.length) throw new InputError(`Not saved: at ${top.min}+ packs (${top.pct}% off) these go below their lowest allowed price: ${c.hard.slice(0, 4).join(', ')}${c.hard.length > 4 ? ` and ${c.hard.length - 4} more` : ''}. Lower the % or set a quantity band for those packs.`);
    if (c.soft.length && (await pricing.marginRule(q)).on) {
      const aid = await approvals.request(q, { kind: 'margin_floor', godownId: 1, refType: 'price_slabs', refId: l.key, summary: `${l.name} slabs ${slabs.map((s) => `${s.min}+ ${s.pct}%`).join(', ')}: at the top slab ${c.soft.length} pack(s) go below cost plus margin`,
        payload: { t: 'slabs', list_key: l.key, slabs } }, by(req));
      await audit(q, { empId: by(req), action: 'request', entity: 'price_list', entityId: l.key, after: { slabs: slabs.map((s) => `${s.min}+ ${s.pct}%`).join(', '), approval_id: aid } });
      return { waiting: true, message: `At the top slab ${c.soft.length} pack(s) go below cost plus margin. The old slabs stay until it is signed. ${await secondAdmin.waitingLine(q, aid)}` };
    }
    await saveSlabs(q, l.key, slabs, by(req));
    return { message: `${l.name}: ${slabs.map((s) => `${s.min}+ ${s.pct}%`).join(', ') || 'no slabs'}.` };
  })), G);

  // ------------------------------------------------------------------------------------------------ special prices
  const SP_COLS = `sp.sp_id, sp.sp_no, sp.customer_id, c.customer_no, c.name AS customer, c.type_key, sp.sku_code, sp.price, sp.valid_from, sp.valid_to, sp.reason, sp.status,
    sp.approval_id, sp.raised_by, sp.raised_at, sp.decided_by, sp.decided_at, sp.ended_by, sp.ended_at`;
  async function spOut(q, rows) {
    const out = [];
    for (const r of rows) {
      // their list price for one pack today, before any special price (quote's listEx)
      const lq = await pricing.quote(q, { customerId: r.customer_id, sku: r.sku_code, qty: 1, date: today() }).catch(() => null);
      const lp = lq && lq.listEx !== undefined ? lq.listEx : null;
      out.push({ ...r, price: Number(r.price), valid_from: pricing.ymd(r.valid_from), valid_to: r.valid_to ? pricing.ymd(r.valid_to) : null, list: lq ? lq.list.name : '',
        list_price: lp, below_pct: lp ? Math.round(((lp - Number(r.price)) / lp) * 1000) / 10 : null,
        shown: r.status === 'active' && pricing.ymd(r.valid_from) > today() ? `Starts ${pricing.ymd(r.valid_from)}` : null });
    }
    return out;
  }
  route('get', '/prices/specials', 'prices:view', wrap(async (req) => {
    const [rows] = await db.query(`SELECT ${SP_COLS} FROM special_prices sp JOIN customers c ON c.customer_id = sp.customer_id ORDER BY sp.sp_id DESC`);
    const [custs] = await db.query("SELECT customer_id, customer_no, name, type_key FROM customers WHERE status NOT IN ('blocked', 'merged') AND merged_into IS NULL ORDER BY name");
    const skus = (await pricing.skuRows(db)).filter((s) => s.is_active && s.status === 'active' && s.product_status === 'active');
    const [[rule]] = await db.query("SELECT is_on, limit_value FROM approval_rules WHERE kind = 'special_price'");
    return { rows: await spOut(db, rows), customers: custs, skus: skus.map((s) => ({ sku_code: s.sku_code, name: `${s.name} ${s.size_label || ''}`.trim(), min_price: s.min_price })),
      limit: rule && Number(rule.is_on) === 1 ? Number(rule.limit_value) : null, me: by(req),
      can: { create: canDo(req, 'prices', 'create'), approve: canDo(req, 'prices', 'approve'), cancel: canDo(req, 'prices', 'cancel') } };
  }), G);
  // what this customer pays now for a pack (the New special price info box)
  route('get', '/prices/specials/now', 'prices:view', wrap(async (req) => {
    const cid = Number(req.query.customer); const sku = String(req.query.sku || '').toUpperCase();
    const qt = await pricing.quote(db, { customerId: cid, sku, qty: 1, date: today() });
    const facts = await pricing.packFacts(db, sku);
    return { list: qt.list.name, list_price: qt.listEx === undefined ? null : qt.listEx, min_price: facts ? facts.min_price : null };
  }), G);
  route('post', '/prices/specials', 'prices:create', wrap(async (req) => tx(async (q) => {
    const b = req.body || {};
    const f = {};
    const cid = Number(b.customer_id);
    const [[c]] = cid ? await q.query('SELECT customer_id, customer_no, name, type_key, godown_id FROM customers WHERE customer_id = ?', [cid]) : [[null]];
    if (!c) f.customer_id = 'Choose the customer.';
    const sku = String(b.sku_code || '').trim().toUpperCase();
    const facts = sku ? await pricing.packFacts(q, sku) : null;
    if (!facts) f.sku_code = 'Choose the pack.';
    else if (!(Number(facts.is_active) === 1 && facts.status === 'active' && facts.product_status === 'active')) f.sku_code = `${sku} is not for sale yet (its product is a draft or it is not active).`;
    const p = pricing.parsePrice(b.price);
    const from = String(b.valid_from || '').trim();
    const to = String(b.valid_to || '').trim() || null;
    if (p.error || p.value === null || p.value <= 0) f.price = 'A price more than 0.';
    if (!pricing.isDate(from) || from < today()) f.valid_from = 'Today or later.';
    if (to && (!pricing.isDate(to) || to < from)) f.valid_to = 'Ends before it starts.';
    const reason = String(b.reason || '').trim().slice(0, 200);
    if (!reason) f.reason = 'Say why; the approver reads it.';
    let lp = null; let g = null;
    if (c && facts && !f.sku_code && !f.price) {
      const lst = await pricing.quote(q, { customerId: cid, sku, qty: 1, date: from && pricing.isDate(from) ? from : today() });
      lp = lst.listEx === undefined ? null : lst.listEx;
      if (lp === null) f.price = `This pack has no price in ${lst.list.name}.`;
      else if (p.value >= lp - 0.004) f.price = `Not lower than their list price (${money(lp)}), so it changes nothing.`;
      else {
        g = await pricing.guard(q, facts, p.value, from && pricing.isDate(from) ? from : today());
        if (g.floor) f.price = `Below the lowest allowed price (${money(facts.min_price)}).`;
        else if (g.mrp) f.price = g.mrp;
      }
      if (!Object.keys(f).length) {
        const [[ov]] = await q.query(`SELECT sp_no FROM special_prices WHERE customer_id = ? AND sku_code = ? AND status IN ('active', 'pending')
          AND valid_from <= COALESCE(?, '9999-12-31') AND COALESCE(valid_to, '9999-12-31') >= ?`, [cid, sku, to, from]);
        if (ov) f.price = `${ov.sp_no} already covers these dates for this customer and pack.`;
      }
    }
    if (Object.keys(f).length) throw fieldsErr(f, Object.values(f)[0]);
    const pct = Math.round(((lp - p.value) / lp) * 1000) / 10;
    const below = Boolean(g && g.margin);
    const mustWait = await approvals.needed(q, 'special_price', { pct }) || !canDo(req, 'prices', 'approve') || Number(req.admin.role_id) === SALES_ROLE || (below && (await pricing.marginRule(q)).on);
    const [ins] = await q.query(`INSERT INTO special_prices (sp_no, customer_id, sku_code, price, valid_from, valid_to, reason, status, raised_by, decided_by, decided_at)
      VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [cid, sku, p.value, from, to, `${reason}${below ? ' [Below cost plus margin]' : ''}`, mustWait ? 'pending' : 'active', by(req), mustWait ? null : by(req), mustWait ? null : new Date()]);
    const no = seq('SP', ins.insertId);
    await q.query('UPDATE special_prices SET sp_no = ? WHERE sp_id = ?', [no, ins.insertId]);
    let msg = `${no}: ${pct}% below their list price.`;
    if (mustWait) {
      const aid = await approvals.request(q, { kind: 'special_price', godownId: c.godown_id || 1, refType: 'special_price', refId: no, target: `cust:${cid}`,
        summary: `${no}: ${c.name}, ${sku} at ${money(p.value)} without GST from ${from} (${pct}% below their list price${below ? ', below cost plus margin' : ''}): ${reason}`, payload: { no } }, by(req));
      await q.query('UPDATE special_prices SET approval_id = ? WHERE sp_id = ?', [aid, ins.insertId]);
      msg += ' An Admin or Sub-admin other than you must approve it.';
    }
    await audit(q, { empId: by(req), action: 'create', entity: 'special_price', entityId: no, after: { customer: c.customer_no, sku, price: p.value, from, to, reason, status: mustWait ? 'waiting for approval' : 'active' } });
    return { sp_no: no, waiting: mustWait, message: msg };
  })), G);
  route('post', '/prices/specials/:no/end', 'prices:cancel', wrap(async (req) => tx(async (q) => {
    const [[s]] = await q.query("SELECT sp_id, sp_no, status, valid_from, valid_to FROM special_prices WHERE sp_no = ? FOR UPDATE", [req.params.no]);
    if (!s) throw new InputError('No such special price', 404);
    if (s.status !== 'active') throw new InputError('Only an active special price can be ended.', 409);
    const end = pricing.ymd(s.valid_from) > today() ? null : today();
    await q.query("UPDATE special_prices SET status = 'ended', valid_to = COALESCE(?, valid_to), ended_by = ?, ended_at = UTC_TIMESTAMP() WHERE sp_id = ?", [end, by(req), s.sp_id]);
    await audit(q, { empId: by(req), action: 'end', entity: 'special_price', entityId: s.sp_no, before: { status: 'active' }, after: { status: 'ended', ended_on: today() } });
    return { message: `${s.sp_no} ends today. From tomorrow the customer pays their normal price.` };
  })), G);
  approvals.onRecheck('special_price', async (q, p) => {
    const [[s]] = await q.query('SELECT sku_code, price, valid_from FROM special_prices WHERE sp_no = ?', [p.no]);
    if (!s) return '';
    const facts = await pricing.packFacts(q, s.sku_code);
    const g = await pricing.guard(q, facts, Number(s.price), pricing.ymd(s.valid_from) < today() ? today() : pricing.ymd(s.valid_from));
    return g.floor ? 'It is now below the lowest allowed price.' : '';
  });
  approvals.onApproved('special_price', async (q, p, empId) => {
    await q.query("UPDATE special_prices SET status = 'active', decided_by = ?, decided_at = UTC_TIMESTAMP() WHERE sp_no = ? AND status = 'pending'", [empId, p.no]);
    await audit(q, { empId, action: 'approve', entity: 'special_price', entityId: p.no, after: { status: 'active' } });
  });
  approvals.onClosed('special_price', async (q, p, status, empId) => {
    await q.query("UPDATE special_prices SET status = 'rejected', decided_by = ?, decided_at = UTC_TIMESTAMP() WHERE sp_no = ? AND status = 'pending'", [empId, p.no]);
  });

  // ------------------------------------------------------------------------------------------------ check a price, rate card
  route('get', '/prices/check', 'prices:view', wrap(async (req) => {
    const qy = req.query;
    const sku = String(qy.sku || '').toUpperCase();
    const qty = Math.max(1, Number(qy.qty) || 1);
    const date = pricing.isDate(String(qy.date || '')) ? String(qy.date) : today();
    const co = await require('./company').facts(db); // eslint-disable-line global-require
    const r = await pricing.quote(db, { customerId: qy.customer ? Number(qy.customer) : null, typeKey: qy.customer ? null : String(qy.type || ''), sku, qty, date, pos: qy.pos || null, sellerState: co.state_code, seeCost: seesCost(req) });
    return { ...r, qty, date, total_inc: r.inc === null ? null : r2(r.inc * qty) };
  }), G);
  route('get', '/prices/check-options', 'prices:view', wrap(async () => {
    const [custs] = await db.query("SELECT customer_id, customer_no, name, type_key FROM customers WHERE merged_into IS NULL ORDER BY name");
    const [types] = await db.query('SELECT type_key, label FROM customer_types ORDER BY sort_order');
    const { GST_STATES } = require('../shared/gstStates'); // eslint-disable-line global-require
    const co = await require('./company').facts(db); // eslint-disable-line global-require
    return { customers: custs, types, skus: (await pricing.skuRows(db)).filter((s) => s.product_status !== 'draft').map((s) => ({ sku_code: s.sku_code, name: `${s.name} ${s.size_label || ''}`.trim() })),
      states: GST_STATES.map(([v, l]) => ({ value: v, label: l })), seller_state: co.state_code, today: today() };
  }), G);
  route('get', '/prices/lists/:key/rate-card', 'prices:view', wrap(async (req) => {
    const l = await listOr404(db, req.params.key);
    const rows = (await priceExcel.listRows(db, l)).filter((r) => r.typed !== null && r.s.is_active);
    const co = await require('./company').facts(db); // eslint-disable-line global-require
    await audit(db, { empId: by(req), action: 'view', entity: 'price_list', entityId: l.key, after: { opened: 'rate card' } });
    return { list: l, today: today(), company: { name: co.name, brand: co.brand, phone: co.phone, email: co.email }, slabs: await pricing.slabsOf(db, l.key),
      rows: rows.map((r) => ({ product: r.s.name, pack: r.s.size_label, per_carton: r.s.packs_per_carton, ex: r.ex, rate: r.rate, inc: r.inc, carton_inc: r2(r.inc * r.s.packs_per_carton), mrp: r.s.mrp })) };
  }), G);

  // ------------------------------------------------------------------------------------------------ Excel per list
  route('get', '/prices/lists/:key/export.xlsx', 'prices:export', wrap(async (req, res) => {
    const l = await listOr404(db, req.params.key);
    const wb = await priceExcel.buildWorkbook(db, l, { who: await exportedBy(req) });
    await audit(db, { empId: by(req), action: 'export', entity: 'price_list', entityId: l.key, after: { downloaded: 'price list' } });
    await theme.send(res, wb, `dfresh-prices-${l.key}-${today()}.xlsx`);
  }), G);
  route('post', '/prices/lists/:key/import', 'prices:edit', wrap(async (req) => {
    if (!req.file) throw new InputError('Choose the Excel file');
    const l = await listOr404(db, req.params.key);
    const fileHash = require('crypto').createHash('sha256').update(req.file.buffer).digest('hex'); // eslint-disable-line global-require
    if (req.query.dryRun !== '0') {
      const { plan, ...report } = await priceExcel.diffWorkbook(db, req.file.buffer, l);
      void plan;
      return { dryRun: true, fileHash, ...report };
    }
    if (req.query.hash !== fileHash) throw new InputError('Check this exact file first (the file changed since the check)');
    return tx(async (q) => {
      const { plan, ...report } = await priceExcel.diffWorkbook(q, req.file.buffer, l);
      if (!report.ok) throw new InputError(`Fix the ${report.errors.length} error(s) first: ${report.errors.slice(0, 3).join(' | ')}`);
      const n = await priceExcel.applyPlan(q, plan, { empId: by(req) });
      await audit(q, { empId: by(req), action: 'import', entity: 'price_list', entityId: l.key, after: { prices: n } });
      return { dryRun: false, applied: n, message: `${n} prices saved, each in the audit log.`, ...report };
    });
  }), { before: [commerceGate, upload(5)] });

  // ------------------------------------------------------------------------------------------------ HSN and GST rates
  /** prices above MRP if `code` were `rate`% from `from` (today's and every later price, in every list) */
  async function mrpAtRate(q, code, rate, from) {
    const [skus] = await q.query("SELECT s.sku_code, s.mrp FROM skus s JOIN products p ON p.product_id = s.product_id WHERE p.hsn_code = ? AND s.mrp IS NOT NULL", [code]);
    const bad = [];
    const ls = await pricing.lists(q);
    for (const s of skus) {
      const [rows] = await q.query('SELECT list_key, effective_from, price, basis FROM sku_prices WHERE sku_code = ? AND price IS NOT NULL ORDER BY effective_from', [s.sku_code]);
      const on = await pricing.rowsOn(q, from, [s.sku_code]);
      const check = [...Object.entries(on.get(s.sku_code) || {}).map(([k, r]) => ({ list_key: k, price: r.price, basis: r.basis, from })),
        ...rows.filter((r) => pricing.ymd(r.effective_from) > from).map((r) => ({ list_key: r.list_key, price: Number(r.price), basis: r.basis, from: pricing.ymd(r.effective_from) }))];
      for (const c of check) {
        if (c.price === null) continue;
        const inc = r2(pricing.toEx(c.price, c.basis, rate) * (1 + rate / 100));
        if (inc > Number(s.mrp) + 0.004) bad.push(`${s.sku_code} in ${(ls.find((l) => l.key === c.list_key) || { name: c.list_key }).name} from ${c.from}: ${money(inc)} with GST, MRP ${money(s.mrp)}`);
      }
    }
    return bad;
  }
  route('get', '/prices/hsn', 'prices:view', wrap(async (req) => ({ ...(await tax.hsnPage(db)), can: { edit: canDo(req, 'prices', 'edit'), create: canDo(req, 'prices', 'create') } })), G);
  route('post', '/prices/hsn', 'prices:edit', wrap(async (req) => tx(async (q) => tax.addCode(q, req.body || {}, by(req)))), G);
  route('put', '/prices/hsn/:code', 'prices:edit', wrap(async (req) => tx(async (q) => tax.changeCode(q, String(req.params.code), req.body || {}, by(req), { ask: secondAdmin.ask, checkMrp: mrpAtRate }))), G);
  route('post', '/prices/gst-rates', 'prices:edit', wrap(async (req) => tx(async (q) => tax.addRate(q, (req.body || {}).rate, by(req)))), G);
  route('delete', '/prices/gst-rates/:rate', 'prices:edit', wrap(async (req) => tx(async (q) => tax.removeRate(q, req.params.rate, by(req)))), G);
  secondAdmin.on('hsnrate', { apply: tax.applyRate, closed: tax.closeRate });
}

module.exports = { register };
