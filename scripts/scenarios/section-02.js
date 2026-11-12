// Section 2 - Prices: the v23 Tests tab "2" (2.1 to 2.29), the section 2 fix items the phase 15 script had (H.17, G.18,
// H.47, H.48, H.49, H.50, H.73 PR1, H.88 Y4) and Products 1.9 / 1.16 again (they needed the HSN list). Our dev data
// stands in for v23's: the v23 Shop (default) list is our Default / Home list; Hotel Kanchi Residency is Demo Hotel
// Sangam (1, hotel); Kamatchi Stores is Demo Home Priya (9, home); Sri Devi Clinic is Demo Care Clinic (4, hospital);
// Annapoorna Caterers is Demo Restaurant Anjappar (12, hotel). Each test starts from the dev data plus v23's section 2
// seed (sample() below): lowest allowed prices at 80% of the Default price, list slabs, a hotel pack's own bands,
// special price SP-001, a customer type "Other" with no list, and the v23 grid's Prices view for the Supervisor.
// Run: npm run scenarios -- 2
const path = require('path');

module.exports = {
  title: 'Prices',
  async run(ctx) {
    const { api, ok, say, q1, qa, pool, T, fresh, run, decide, decideAny, pendingOf, today, base, cookie } = ctx;
    const ExcelJS = require(path.join(__dirname, '..', '..', 'node_modules', 'exceljs'));
    const TODAY = today();
    const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
    const FUT = addDays(TODAY, 6); const PAST = addDays(TODAY, -10);
    const HOTEL = 1; const HOME = 9; const CLINIC = 4; const REST = 12;
    const check = (as, q) => api(as, 'GET', `/prices/check?${new URLSearchParams(q)}`);
    const steps = (r) => (r.data ? r.data.steps.map((s) => `${s.t}: ${s.d}`).join(' | ') : r.msg);
    const js = (x) => JSON.stringify(x);
    const pend = async (kind, like = '%') => q1("SELECT approval_id, requested_by, summary FROM approvals WHERE status = 'pending' AND kind = ? AND summary LIKE ? ORDER BY approval_id DESC LIMIT 1", [kind, like]);
    const sample = async () => {
      await pool.query("INSERT INTO role_permissions (role_id, section, can_view) VALUES (32, 'prices', 1) ON DUPLICATE KEY UPDATE can_view = 1");
      for (const d of await qa("SELECT sku_code, price FROM sku_prices WHERE list_key = 'default' AND effective_from <= ? AND sku_code IN ('DF001-M100','DF002-M100','DF007-M100','DF028-M100','DF030-M200','DF037-M150')", [TODAY])) {
        await pool.query('UPDATE skus SET min_price = ? WHERE sku_code = ?', [Math.round(Number(d.price) * 0.8), d.sku_code]);
      }
      const s1 = await api('SH', 'PUT', '/prices/slabs/default', { slabs: [{ min: 10, pct: 3 }, { min: 50, pct: 6 }] });
      const s2 = await api('SH', 'PUT', '/prices/slabs/hotel', { slabs: [{ min: 20, pct: 4 }, { min: 100, pct: 8 }] });
      // our DF001-M100 has a standard cost (31.02), so the hotel top slab puts it below cost plus margin: that waits; a second person signs
      for (const x of await qa("SELECT approval_id FROM approvals WHERE status = 'pending' AND kind = 'margin_floor' AND ref_type = 'price_slabs'")) await decideAny(x.approval_id);
      const b = await api('SH', 'PUT', '/prices/lists/hotel/skus/DF030-M200', { bands: [{ min: 24, price: 66 }, { min: 96, price: 63 }] });
      const sp = await api('SH', 'POST', '/prices/specials', { customer_id: HOTEL, sku_code: 'DF007-M100', price: 60, valid_from: TODAY, valid_to: '2027-03-31', reason: 'Yearly contract, 40 cartons a month' });
      await api('SH', 'POST', '/commerce-settings/lists/customer_types', { type_key: 'other', label: 'Other', min_order_value: 0, default_credit_days: 0, default_credit_limit: 0, is_active: 1 });
      await pool.query("UPDATE customer_types SET list_key = NULL WHERE type_key = 'other'");
      if ([s1, s2, b, sp].some((x) => x.status >= 300)) say('sample:', [s1, s2, b, sp].map((x) => `${x.status} ${x.msg || ''}`).join(' / '));
      return sp.data && sp.data.sp_no;
    };
    const start = async () => { await fresh(); return sample(); };

    if (run('2.1')) { const sp = await start(); T('2.1', 'The price check explains itself');
      const r = await check('SH', { customer: HOTEL, sku: 'DF007-M100', qty: 24, date: TODAY, pos: '33' });
      ok(r.status === 200 && /Hotel \(for Hotel\)/.test(steps(r)) && /20\+: 4% off/.test(steps(r)) && new RegExp(`${sp}.*lower, so it wins`).test(steps(r)) && /18%/.test(steps(r)), `Hotel list 64, the 20+ slab (4% off), ${sp} (60) because it is lower, GST 18% (v23 76 on 82): ${steps(r)}`); }

    if (run('2.2')) { await start(); T('2.2', 'A type without its own list uses the default');
      const r = await check('SH', { type: 'other', sku: 'DF001-M100', qty: 1, date: TODAY });
      ok(r.status === 200 && /Default \(default: Other has no list of its own\)/.test(steps(r)) && r.data.ex === 40, `${steps(r)}; price ${r.data && r.data.ex}`); }

    if (run('2.3')) { await start(); T('2.3', 'A price cannot start in the past');
      const r = await api('SH', 'PUT', '/prices/lists/home/skus/DF001-M100', { price: 50, from: PAST });
      ok(r.status === 400 && /Cannot start in the past\. Quotes and orders already made keep their price/.test(js(r.fields || r.msg)), `50 from ${PAST}: ${js(r.fields || r.msg)}`); }

    if (run('2.4')) { await start(); T('2.4', 'A future price waits for its date');
      const r = await api('SH', 'PUT', '/prices/lists/home/skus/DF001-M100', { price: 50, from: FUT });
      const row = (await api('SH', 'GET', '/prices/lists/home')).data.rows.find((x) => x.sku_code === 'DF001-M100');
      const a1 = await check('SH', { customer: HOME, sku: 'DF001-M100', qty: 1, date: addDays(FUT, -1) });
      const a2 = await check('SH', { customer: HOME, sku: 'DF001-M100', qty: 1, date: FUT });
      ok(r.status === 200 && row.next && row.next.price === 50 && row.next.from === FUT && a1.data.ex === 40 && a2.data.ex === 50, `the list shows "${row.next && row.next.price} from ${row.next && row.next.from}"; the day before ${a1.data.ex}, on the day ${a2.data.ex} (v23 48 then 50)`); }

    if (run('2.5')) { await start(); T('2.5', 'Nothing below the lowest allowed price');
      const r = await api('SH', 'PUT', '/prices/lists/home/skus/DF001-M100', { price: 30, from: TODAY });
      ok(r.status === 400 && /Below the lowest allowed price \(Rs 32\.00 without GST\)/.test(js(r.fields)), `Home list, DF001-M100 (lowest allowed 32; v23 38), 30: ${js(r.fields || r.msg)}`); }

    if (run('2.6')) { await start(); T('2.6', 'A list typed with GST');
      const a = await api('SH', 'PUT', '/prices/lists/home', { typed: 'inc' });
      const inc = (await api('SH', 'GET', '/prices/lists/home')).data.rows.find((x) => x.sku_code === 'DF001-M100');
      const b = await api('SH', 'PUT', '/prices/lists/home', { typed: 'ex' });
      const ex = (await api('SH', 'GET', '/prices/lists/home')).data.rows.find((x) => x.sku_code === 'DF001-M100');
      ok(a.status === 200 && inc.typed === 47.2 && inc.ex === 40 && b.status === 200 && ex.typed === 40 && ex.inc === 47.2, `typed with GST: ${inc.typed}, without GST ${inc.ex}; back to without GST: typed ${ex.typed}, the customer still pays ${ex.inc} ("${a.data && a.data.message}")`); }

    if (run('2.7')) { await start(); T('2.7', 'Change many prices with a preview');
      const r = await api('SH', 'POST', '/prices/lists/home/bulk', { category_key: 'napkins', mode: 'pct', value: 5, from: FUT });
      const pv = (r.data && r.data.preview) || [];
      const ap = await api('SH', 'POST', '/prices/lists/home/bulk', { category_key: 'napkins', mode: 'pct', value: 5, from: FUT, apply: true });
      const t7 = await check('SH', { customer: HOME, sku: 'DF002-M100', qty: 1, date: TODAY });
      const f7 = await check('SH', { customer: HOME, sku: 'DF002-M100', qty: 1, date: FUT });
      ok(r.status === 200 && pv.length > 0 && pv.every((x) => x.skip || Number.isInteger(x.next)) && ap.status === 200 && t7.data.ex === 45 && f7.data.ex === 47,
        `preview ${pv.length} napkin packs, e.g. ${pv.slice(0, 3).map((x) => `${x.sku_code} ${x.old} -> ${x.next}`).join(', ')}; Apply: "${ap.data && ap.data.message}"; DF002-M100 today ${t7.data.ex}, from ${FUT} ${f7.data.ex}`); }

    if (run('2.8')) { await start(); T('2.8', 'One default list, always');
      const a = await api('SH', 'PUT', '/prices/lists/default', { is_default: false });
      const b = await api('SH', 'PUT', '/prices/lists/default', { status: 'archived' });
      ok(a.status === 400 && /There must always be a default list/.test(js(a.fields)) && b.status === 400 && /default list cannot be archived/.test(js(b.fields)), `${js(a.fields)} / ${js(b.fields)}`); }

    if (run('2.9')) { await start(); T('2.9', 'A customer type belongs to one list');
      const r = await api('SH', 'PUT', '/prices/lists/distributor', { types: ['distributor', 'hotel'] });
      // since v21 a change of customer types waits for a second person; the note comes when it is signed
      const w = await q1("SELECT approval_id FROM approvals WHERE status = 'pending' ORDER BY approval_id DESC LIMIT 1");
      const d = r.data && r.data.waiting !== false && w ? await decideAny(w.approval_id) : null;
      const c = await check('SH', { customer: HOTEL, sku: 'DF001-M100', qty: 1, date: TODAY });
      const au = await q1("SELECT after_json FROM audit_log WHERE entity_id IN ('distributor', 'hotel') ORDER BY audit_id DESC LIMIT 1");
      const note = `${r.data && r.data.message} ${d && d.data ? d.data.message || '' : ''} ${js(au && au.after_json)}`;
      ok(r.status === 200 && /Hotel/.test(note) && /Distributor \(for Hotel\)/.test(steps(c)), `"${r.data && r.data.message}"; signed (${d && d.status}): ${d && d.data && d.data.message}; Demo Hotel Sangam now: ${c.data && c.data.steps[0].d}`); }

    if (run('2.10')) { await start(); T('2.10', 'A new list copies another');
      const r = await api('SH', 'POST', '/prices/lists', { name: 'Event caterers', copy_from: 'hotel', adjust: -5, types: [] });
      const ev = await api('SH', 'GET', `/prices/lists/${r.data && r.data.list_key}`);
      const e1 = ev.data && ev.data.rows.find((x) => x.sku_code === 'DF002-M100');
      // a pack is skipped when 5% off its Hotel price, rounded, falls below its lowest allowed price; count them from our data
      const lo = await q1("SELECT COUNT(*) n FROM sku_prices p JOIN skus s ON s.sku_code = p.sku_code WHERE p.list_key = 'hotel' AND p.effective_from = (SELECT MAX(x.effective_from) FROM sku_prices x WHERE x.sku_code = p.sku_code AND x.list_key = 'hotel' AND x.effective_from <= ?) AND s.min_price IS NOT NULL AND ROUND(p.price * 0.95) < s.min_price", [TODAY]);
      const n = Number(lo.n);
      ok(r.status === 200 && (n ? new RegExp(`${n} skipped`).test(r.data.message) : !/skipped/.test(r.data.message)) && e1 && e1.typed === 39, `"${r.data && r.data.message}" (${n} pack(s) would go below the lowest allowed price); DF002-M100 Hotel 41 -> ${e1 && e1.typed} (5% lower, rounded)`); }

    if (run('2.11')) { await start(); T('2.11', 'Slabs must make sense');
      const a = await api('SH', 'PUT', '/prices/slabs/default', { slabs: [{ min: 10, pct: 5 }, { min: 5, pct: 8 }] });
      const b = await api('SH', 'PUT', '/prices/slabs/default', { slabs: [{ min: 10, pct: 5 }, { min: 50, pct: 3 }] });
      const c = await api('SH', 'PUT', '/prices/slabs/default', { slabs: [{ min: 10, pct: 5 }, { min: 50, pct: 8 }] });
      ok(a.status === 400 && /Each slab starts at more packs/.test(js(a.fields)) && b.status === 400 && /More packs must get more off than 5%/.test(js(b.fields)) && c.status === 200, `${js(a.fields)} / ${js(b.fields)} / "${c.data && c.data.message}"`); }

    if (run('2.12')) { await start(); T('2.12', 'A pack can have its own quantity prices');
      const r = await check('SH', { customer: HOTEL, sku: 'DF030-M200', qty: 30, date: TODAY });
      const b = await api('SH', 'PUT', '/prices/lists/hotel/skus/DF030-M200', { bands: [{ min: 24, price: 66 }, { min: 96, price: 67 }] });
      ok(/reach the 24\+ band: Rs 66\.00/.test(steps(r)) && b.status === 400 && /More packs must cost less per pack than Rs 66\.00/.test(js(b.fields)), `30 packs: ${r.data && r.data.steps[2] && r.data.steps[2].d} (v23 88); 96+ at 67: ${js(b.fields)}`); }

    if (run('2.13')) { await start(); T('2.13', 'Special price: small discount goes live');
      const r = await api('SH', 'POST', '/prices/specials', { customer_id: HOME, sku_code: 'DF028-M100', price: 43, valid_from: TODAY, reason: 'trial' });
      ok(r.status === 200 && !r.data.waiting && /4\.4% below their list price/.test(r.data.message), `Demo Home Priya, DF028-M100 at 43 (list 45; v23 52 = 5.5%): "${r.data ? r.data.message : js(r.fields)}"`); }

    if (run('2.14')) { await start(); T('2.14', 'Special price: big discount waits');
      const r = await api('SH', 'POST', '/prices/specials', { customer_id: CLINIC, sku_code: 'DF037-M150', price: 56.5, valid_from: TODAY, reason: 'hospital tender' });
      const a = await pend('special_price', `${r.data && r.data.sp_no}%`);
      const own = a ? await decide('SH', a.approval_id) : null; const pv = a ? await decide('PV', a.approval_id) : null;
      const s = await q1('SELECT status FROM special_prices WHERE sp_no = ?', [r.data && r.data.sp_no]);
      ok(r.status === 200 && r.data.waiting && own && own.status >= 400 && pv && pv.status === 200 && s.status === 'active', `${r.data && r.data.sp_no} at 56.50 (list 63): "${r.data && r.data.message}"; Shoban: ${own && own.status} "${own && own.msg}"; Pavithran: ${pv && pv.status}; now ${s && s.status}`); }

    if (run('2.15')) { await start(); T('2.15', 'Sales can only propose');
      const r = await api('DV', 'POST', '/prices/specials', { customer_id: REST, sku_code: 'DF002-M100', price: 40, valid_from: TODAY, reason: 'festival order' });
      const l = await api('DV', 'GET', '/prices/specials');
      ok(r.status === 200 && r.data.waiting && l.data.can.approve === false && !/cost/i.test(r.raw), `Divya, DF002-M100 at 40 (list 41, a small discount): "${r.data ? r.data.message : js(r.fields || r.msg)}"; Approve offered: ${l.data && l.data.can.approve}; no cost figure reaches her`); }

    if (run('2.16')) { const sp = await start(); T('2.16', 'Special prices cannot overlap or go too low');
      const a = await api('SH', 'POST', '/prices/specials', { customer_id: HOTEL, sku_code: 'DF007-M100', price: 62, valid_from: TODAY, reason: 'x' });
      const b = await api('SH', 'POST', '/prices/specials', { customer_id: HOME, sku_code: 'DF001-M100', price: 30, valid_from: TODAY, reason: 'x' });
      ok(a.status === 400 && new RegExp(`${sp} already covers these dates`).test(js(a.fields)) && b.status === 400 && /Below the lowest allowed price \(Rs 32\.00\)/.test(js(b.fields)), `${js(a.fields)} / ${js(b.fields)}`); }

    if (run('2.17')) { const sp = await start(); T('2.17', 'The customer pays the lower price');
      const r = await check('SH', { customer: HOTEL, sku: 'DF007-M100', qty: 120, date: TODAY });
      ok(r.data && r.data.ex === 59 && new RegExp(`${sp} is Rs 60\\.00, not lower than Rs 59\\.00; the lower price stays`).test(steps(r)), `the 100+ slab gives 59 (8% off 64; v23 75 of 82), lower than ${sp} (60): ${steps(r)}`); }

    if (run('2.18')) { await start(); T('2.18', 'A GST rate change follows its date');
      const r = await api('SH', 'PUT', '/prices/hsn/48183000', { gst_rate: 5, effective_from: FUT });
      const a = await pend('rule_change', 'HSN 48183000%');
      const d = a ? await decide('PV', a.approval_id) : null;
      const h = (await api('SH', 'GET', '/prices/hsn')).data.codes.find((c) => c.hsn_code === '48183000');
      const g1 = await check('SH', { customer: HOME, sku: 'DF001-M100', qty: 1, date: addDays(FUT, -1) });
      const g2 = await check('SH', { customer: HOME, sku: 'DF001-M100', qty: 1, date: FUT });
      ok(r.status === 200 && r.data.waiting && d && d.status === 200 && h.next && h.next.rate === 5 && g1.data.rate === 18 && g2.data.rate === 5, `"${r.data && r.data.message}"; Pavithran signs; the HSN shows ${h.next && `${h.next.rate}% from ${h.next.from}`}; the check: ${g1.data.rate}% the day before, ${g2.data.rate}% on ${FUT}`); }

    if (run('2.19')) { await start(); T('2.19', 'A pack needs an HSN code from the list');
      const r = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { hsn_code: '48189999', weight_kg: '0.3' });
      const g = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { gst_rate: 5, weight_kg: '0.3' });
      const pg = await q1("SELECT p.gst_rate FROM products p JOIN skus s ON s.product_id = p.product_id WHERE s.sku_code = 'DF001-M100'");
      ok(r.status === 400 && /Not in the HSN list\. Add it in Masters > Tax and units > HSN and GST rates first/.test(js(r.fields || r.msg)) && Number(pg.gst_rate) === 18, `48189999: ${js(r.fields || r.msg)}; a typed GST 5% (${g.status}) is not taken: still ${Number(pg.gst_rate)}%`); }

    if (run('2.20')) { await start(); T('2.20', 'GST rates in use stay');
      const r = await api('SH', 'DELETE', '/prices/gst-rates/18');
      const add = await api('SH', 'POST', '/prices/gst-rates', { rate: 28 }); const rem = await api('SH', 'DELETE', '/prices/gst-rates/28');
      ok(r.status === 409 && /18% is used by an HSN code/.test(r.msg) && add.status === 200 && rem.status === 200, `18%: "${r.msg}"; 28% added (${add.status}) and removed (${rem.status}) - 12% is already on our list unused, so 28% stands in for v23's 12%`); }

    if (run('2.21')) { await start(); T('2.21', 'Roles from Foundation decide who changes prices');
      const k1 = await api('KU', 'GET', '/prices/lists/home'); const k2 = await api('KU', 'PUT', '/prices/lists/home/skus/DF001-M100', { price: 41, from: TODAY });
      const m1 = await api('MU', 'GET', '/prices/lists');
      ok(k1.status === 200 && k1.data.can.edit === false && k2.status === 403 && m1.status === 403, `Kumar (Supervisor, v23 grid Prices View): sees ${k1.status}, edit offered ${k1.data && k1.data.can.edit}, save ${k2.status}; Murugan (Warehouse): ${m1.status} "${m1.msg}"`); }

    if (run('2.22')) { await start(); T('2.22', 'Every price change is in the audit log');
      await api('SH', 'PUT', '/prices/lists/home/skus/DF001-M100', { price: 50, from: FUT });
      await api('SH', 'PUT', '/prices/lists/distributor', { about: 'Distributors in Vellore and Ambur' });
      await api('SH', 'PUT', '/prices/hsn/48183000', { gst_rate: 5, effective_from: FUT });
      const p = await api('SH', 'GET', '/audit?screen=prices&limit=50'); const t = await api('SH', 'GET', '/audit?screen=tax&limit=50');
      const rp = (p.data && (p.data.rows || p.data)) || []; const rt = (t.data && (t.data.rows || t.data)) || [];
      const d = rp.find((x) => x.changes && x.changes.some((c) => c.from !== null && c.to !== null));
      ok(p.status === 200 && rp.length >= 3 && rt.length >= 1 && d, `Prices screen: ${rp.length} rows, Tax: ${rt.length}; e.g. ${d && `${d.who}: ${d.changes[0].field} ${d.changes[0].from} -> ${d.changes[0].to}`}`); }

    if (run('2.23')) { await start(); T('2.23', 'Carton price and margin in every list');
      await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { std_cost: '34', weight_kg: '0.3' });
      const l = (await api('SH', 'GET', '/prices/lists/default')).data.rows.find((x) => x.sku_code === 'DF001-M100');
      const k = (await api('KU', 'GET', '/prices/lists/default')).data;
      ok(l.carton_inc === 1132.8 && l.per_carton === 24 && l.margin === 15 && l.margin_tone === 'good' && k.seeCost === false && !('margin' in k.rows[0]) && !('std_cost' in k.rows[0]),
        `Carton Rs ${l.carton_inc} for ${l.per_carton} packs (v23 1,920.00 for 40); cost 34: margin ${l.margin}% ${l.margin_tone} (v23 16.7% on 40); Kumar sees cost: ${k.seeCost}`); }

    if (run('2.24')) { await start(); T('2.24', 'A price below cost plus margin waits for a second person');
      await api('SH', 'PUT', '/catalogue/skus/DF002-M100', { std_cost: '37', weight_kg: '0.3' });
      const r = await api('SH', 'PUT', '/prices/lists/home/skus/DF002-M100', { price: 40, from: FUT });
      const b = await check('SH', { customer: HOME, sku: 'DF002-M100', qty: 1, date: FUT });
      const row = (await api('SH', 'GET', '/prices/lists/home')).data.rows.find((x) => x.sku_code === 'DF002-M100');
      const a = await pend('margin_floor', 'PC-%');
      const self = a ? await decide('SH', a.approval_id) : null; const pv = a ? await decide('PV', a.approval_id) : null;
      const af = await check('SH', { customer: HOME, sku: 'DF002-M100', qty: 1, date: FUT });
      ok(r.status === 200 && r.data.waiting && /PC-\d+ waits for approval: Below cost plus the margin floor \(Rs 40\.70 without GST\)/.test(r.data.message) && row.waiting && row.waiting.price === 40 && b.data.ex === 45 && self && self.status >= 400 && pv && pv.status === 200 && af.data.ex === 40,
        `cost 37 (floor 40.70; v23 45 / 49.50): "${r.data && r.data.message}"; the list shows ${row.waiting && `${row.waiting.price} from ${row.waiting.from}, waiting`}; the check still ${b.data.ex}; Shoban: ${self && self.status}; Pavithran: ${pv && pv.status}; then ${af.data.ex}`); }

    if (run('2.25')) { await start(); T('2.25', 'The margin rule can be switched off');
      await api('SH', 'PUT', '/catalogue/skus/DF028-M100', { std_cost: '40', weight_kg: '0.3' });
      const r = await api('SH', 'PUT', '/approval-rules/margin_floor', { is_on: false });
      const a = await pend('rule_change', '%margin%');
      const d = a ? await decide('PV', a.approval_id) : null;
      const s = await api('SH', 'PUT', '/prices/lists/home/skus/DF028-M100', { price: 43, from: FUT });
      const au = await q1("SELECT COUNT(*) n FROM audit_log WHERE entity_id IN ('margin_floor', 'DF028-M100') AND created_at >= NOW() - INTERVAL 5 MINUTE").catch(() => ({ n: -1 }));
      ok(r.status === 200 && a && d && d.status === 200 && s.status === 200 && !s.data.waiting && new RegExp(`The new price starts on ${FUT}`).test(s.data.message),
        `switch off: "${r.data && r.data.message}" (waits: ${Boolean(a)}); signed by Pavithran; DF028-M100 at 43 below cost 40 + margin: "${s.data ? s.data.message : js(s.fields)}"; audit rows ${au.n}`); }

    if (run('2.26')) { await start(); T('2.26', 'Prices come in from Excel, checked first');
      const buf = Buffer.from(await (await fetch(`${base}/prices/lists/home/export.xlsx`, { headers: { Cookie: cookie('SH') } })).arrayBuffer());
      const up = async (b, q) => { const fd = new FormData(); fd.append('file', new Blob([b]), 'p.xlsx'); const res = await fetch(`${base}/prices/lists/home/import?${q}`, { method: 'POST', headers: { Cookie: cookie('SH') }, body: fd }); const j = await res.json(); return { status: res.status, data: j.data, msg: j.message }; };
      // blank = true empties price and from on every other row (the Read_Me's "leave them empty to leave that pack as it is")
      const edit = async (ch, blank = false) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); const ws = wb.getWorksheet('Prices'); let hr = 0; ws.eachRow((row, n) => { if (!hr && row.values.includes('sku')) hr = n; });
        const hd = ws.getRow(hr).values; const col = (h) => hd.indexOf(h);
        ws.eachRow((row, n) => { if (n <= hr) return; const c = ch[row.getCell(col('sku')).value]; if (c) { row.getCell(col('price')).value = c[0]; row.getCell(col('from')).value = c[1]; } else if (blank) { row.getCell(col('price')).value = null; row.getCell(col('from')).value = null; } });
        return Buffer.from(await wb.xlsx.writeBuffer()); };
      // v23: the current list copied in, two rows changed -> only the bad row is an error (rows left as exported are unchanged)
      const s1 = await up(await edit({ 'DF001-M100': [50, FUT], 'DF002-M100': [0, FUT] }), 'dryRun=1');
      ok(s1.data && s1.data.errors.length === 1 && /price must be more than 0/.test(s1.data.errors[0]),
        `the exported file with DF001-M100 50 from ${FUT} and DF002-M100 0: ${s1.data && s1.data.errors.length} error(s): ${js(s1.data && s1.data.errors.slice(0, 3))}${s1.data && s1.data.errors.length > 3 ? ' ...' : ''}`);
      // the rest of v23's steps on a file whose other rows are left empty
      const f1 = await up(await edit({ 'DF001-M100': [50, FUT], 'DF002-M100': [0, FUT] }, true), 'dryRun=1');
      const f2 = await up(await edit({ 'DF001-M100': [50, FUT], 'DF002-M100': [57, PAST] }, true), 'dryRun=1');
      const good = await edit({ 'DF001-M100': [50, FUT], 'DF002-M100': [57, FUT] }, true);
      const f3 = await up(good, 'dryRun=1');
      const f4 = f3.data && f3.data.ok ? await up(good, `dryRun=0&hash=${f3.data.fileHash}`) : null;
      const nx = await qa("SELECT sku_code, price FROM sku_prices WHERE list_key = 'home' AND effective_from = ? AND sku_code IN ('DF001-M100', 'DF002-M100')", [FUT]);
      ok(f1.data && f1.data.errors.length === 1 && /price must be more than 0/.test(f1.data.errors[0]) && f2.data.errors.length === 1 && /is in the past/.test(f2.data.errors[0]) && f3.data.ok && f3.data.changes.length === 2 && f4 && f4.status === 200 && f4.data.applied === 2 && nx.length === 2,
        `1: ${js(f1.data && f1.data.errors)}; 2: ${js(f2.data && f2.data.errors)}; 3: ${f3.data && f3.data.summary}; Apply: "${f4 && f4.data && f4.data.message}" (${nx.map((x) => `${x.sku_code} ${x.price}`).join(', ')} from ${FUT})`); }

    if (run('2.27')) { await start(); T('2.27', 'A rate card to share');
      const r = await api('SH', 'GET', '/prices/lists/hotel/rate-card');
      const rc = r.data && r.data.rows[0];
      ok(r.status === 200 && rc && ['product', 'pack', 'per_carton', 'ex', 'rate', 'inc', 'carton_inc', 'mrp'].every((k) => k in rc) && r.data.slabs.length === 2 && r.data.company.brand,
        `${r.data && r.data.rows.length} priced packs, e.g. ${rc && `${rc.product} ${rc.pack}: ${rc.per_carton}/carton, ${rc.ex} + ${rc.rate}% = ${rc.inc}, carton ${rc.carton_inc}, MRP ${rc.mrp}`}; slabs ${js(r.data && r.data.slabs)} (printing alone is a screen check)`); }

    if (run('2.28')) { await start(); T('2.28', 'GST splits by place of supply');
      const tn = await check('SH', { customer: HOTEL, sku: 'DF007-M100', qty: 24, date: TODAY, pos: '33' });
      const ka = await check('SH', { customer: HOTEL, sku: 'DF007-M100', qty: 24, date: TODAY, pos: '29' });
      ok(/CGST 9% .* \+ SGST 9% .* \(same state\)/.test(steps(tn)) && /IGST 18% .* \(another state\)/.test(steps(ka)) && tn.data.inc === ka.data.inc, `Tamil Nadu: ${tn.data.steps.slice(-1)[0].d}; Karnataka: ${ka.data.steps.slice(-1)[0].d}; both ${tn.data.inc}`); }

    if (run('2.29')) { await start(); T('2.29', 'Each list says who it is for');
      const r = await api('SH', 'PUT', '/prices/lists/distributor', { about: 'Distributors in Vellore and Ambur' });
      const l = (await api('SH', 'GET', '/prices/lists')).data.lists.find((x) => x.key === 'distributor');
      const one = (await api('SH', 'GET', '/prices/lists/distributor')).data;
      const au = await q1("SELECT COUNT(*) n FROM audit_log WHERE entity_id = 'distributor' AND after_json LIKE '%Vellore%'");
      ok(r.status === 200 && l.about === 'Distributors in Vellore and Ambur' && JSON.stringify(one).includes('Vellore and Ambur') && Number(au.n) >= 1, `card: "${l.about}"; the list page has it; audit rows ${au.n}`); }

    // ---------------------------------------------------------------- fix items (section 2)
    if (run('H.17')) { await start(); T('H.17', 'Prices are guarded everywhere');
      await api('SH', 'PUT', '/prices/slabs/default', { slabs: [{ min: 10, pct: 5 }, { min: 50, pct: 8 }] });
      const r = await api('SH', 'PUT', '/prices/slabs/default', { slabs: [{ min: 10, pct: 5 }, { min: 50, pct: 8 }, { min: 100, pct: 25 }] });
      // customer 10 (Demo Home Arun) buys on the Home list: it gets slabs too, so the quantity changes the price
      await api('SH', 'PUT', '/prices/slabs/home', { slabs: [{ min: 10, pct: 3 }, { min: 50, pct: 6 }] });
      const prev = (qty) => api('SH', 'POST', '/commerce/orders/preview', { customer_id: 10, items: [{ sku_code: 'DF002-M100', qty, price: '' }], payment_terms: 'cod' });
      const o60 = await prev(60); const o20 = await prev(20);
      const lp = (o) => o.data && (o.data.lines || o.data.items || []).find((x) => x.sku_code === 'DF002-M100');
      ok(r.status === 400 && /these go below their lowest allowed price/.test(r.msg), `a 100+ slab at 25%: "${r.msg}"`);
      ok(o60.status === 200 && lp(o60) && lp(o20) && lp(o60).price !== lp(o20).price, `an order line priced again when the quantity changes: 60 packs ${lp(o60) && lp(o60).price}, 20 packs ${lp(o20) && lp(o20).price} (${o60.status} ${o60.msg || ''})`); }

    if (run('G.18')) { await start(); T('G.18', 'Switching a list to "with GST" keeps old prices');
      await api('SH', 'PUT', '/prices/lists/office', { typed: 'inc' });
      const h = (await api('SH', 'GET', '/prices/lists/office/skus/DF001-M100')).data.history;
      ok(h.some((x) => x.basis === 'ex' && x.price === 38) && h.some((x) => x.basis === 'inc' && x.from === TODAY && x.price === 44.84), `history: ${h.map((x) => `${x.price} ${x.basis} from ${x.from}`).join(' · ')}`); }

    if (run('H.47')) { await start(); T('H.47', 'HSN from the drawer keeps the MRP');
      await api('SH', 'POST', '/prices/gst-rates', { rate: 40 });
      await api('SH', 'POST', '/prices/hsn', { hsn_code: '22021010', description: 'Test 40% code', gst_rate: 40, effective_from: TODAY });
      await api('SH', 'PUT', '/prices/lists/home/skus/DF001-M100', { price: 55, from: TODAY });
      const m = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { mrp: '65', weight_kg: '0.3' });
      const r = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { hsn_code: '22021010', weight_kg: '0.3' });
      ok(m.status === 200 && r.status === 400 && /At HSN 22021010 the price goes above MRP/.test(js(r.fields)), `MRP 65, Home 55 (64.90 with 18%): a 40% code: ${js(r.fields || r.msg)}`); }

    if (run('H.48')) { await start(); T('H.48', 'A lower base price is checked at every slab');
      await api('SH', 'PUT', '/prices/slabs/default', { slabs: [{ min: 10, pct: 5 }, { min: 50, pct: 8 }] });
      const r = await api('SH', 'PUT', '/prices/lists/default/skus/DF001-M100', { price: 34, from: TODAY });
      ok(r.status === 400 && /At 50\+ packs \(8% slab\) this becomes Rs 31\.00 without GST, below the lowest allowed Rs 32\.00/.test(js(r.fields)), js(r.fields || r.msg)); }

    if (run('H.49')) { await start(); T('H.49', 'The invoice uses the invoice-date rate');
      await api('SH', 'PUT', '/prices/hsn/48183000', { gst_rate: 5, effective_from: FUT });
      const a = await pend('rule_change', 'HSN 48183000%'); if (a) await decide('PV', a.approval_id);
      const no = await ctx.order(9, [{ sku_code: 'DF001-M100', qty: 10 }]);
      const invoices = require(path.join(__dirname, '..', '..', 'src', 'backend_routes', 'invoices.js'));
      const c = await pool.getConnection();
      try {
        await c.beginTransaction();
        const [[o]] = await c.query('SELECT order_id FROM orders WHERE order_no = ?', [no]);
        const [[l0]] = await c.query("SELECT gst_rate FROM order_items WHERE order_id = ? AND hsn = '48183000' LIMIT 1", [o.order_id]);
        const inv = await invoices.issue(c, o.order_id, 'DZIND002', { at: `${FUT}T06:00:00Z` });
        const [[l1]] = await c.query("SELECT gst_rate FROM order_items WHERE order_id = ? AND hsn = '48183000' LIMIT 1", [o.order_id]);
        const [[iv]] = await c.query('SELECT total FROM invoices WHERE invoice_id = ?', [inv.invoice_id]);
        const [[ot]] = await c.query('SELECT total FROM orders WHERE order_id = ?', [o.order_id]);
        ok(Number(l0.gst_rate) === 18 && Number(l1.gst_rate) === 5 && Number(iv.total) === Number(ot.total), `${no} priced at ${Number(l0.gst_rate)}%, invoiced on ${FUT}: the napkin line takes ${Number(l1.gst_rate)}%; invoice ${iv.total} = order ${ot.total}`);
      } finally { await c.rollback(); c.release(); } }

    if (run('H.50')) { await start(); T('H.50', 'Cost only with See cost');
      await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { std_cost: '34', weight_kg: '0.3' });
      const p = await api('KU', 'GET', '/prices/lists/default/skus/DF001-M100');
      const c = await check('KU', { customer: HOME, sku: 'DF001-M100', qty: 1 });
      ok(p.status === 200 && !('std_cost' in p.data) && !('need' in p.data) && c.status === 200 && !/cost/i.test(js(c.data.warn)), `Kumar: price panel keys ${Object.keys(p.data || {}).filter((k) => /cost|need/.test(k)).join(', ') || 'none with cost'}; check warnings ${js(c.data && c.data.warn)}`); }

    if (run('H.73')) { await start(); T('H.73', 'Lowering the lowest allowed price waits (PR1)');
      const a = await api('PV', 'PUT', '/prices/lists/default/skus/DF001-M100', { min_price: 1, price: 30, from: TODAY });
      const f1 = await q1("SELECT min_price FROM skus WHERE sku_code = 'DF001-M100'"); const w1 = await pend('rule_change', 'DF001-M100: lowest allowed price%');
      const b = await api('PV', 'PUT', '/prices/lists/default/skus/DF001-M100', { min_price: 1 });
      const w2 = await pend('rule_change', 'DF001-M100: lowest allowed price%'); const f2 = await q1("SELECT min_price FROM skus WHERE sku_code = 'DF001-M100'");
      ok(a.status === 400 && /Below the lowest allowed price \(Rs 32\.00 without GST\)/.test(js(a.fields)) && !w1 && Number(f1.min_price) === 32, `floor 1 and price 30 in one save: ${js(a.fields)}; floor stays ${f1.min_price}`);
      ok(b.status === 200 && b.data.waiting && w2 && Number(f2.min_price) === 32, `the floor change alone: "${b.data && b.data.message}"; floor still ${f2.min_price} until signed`); }

    if (run('H.88')) { await start(); T('H.88', 'A lower standard cost waits (Y4)');
      await api('SH', 'PUT', '/catalogue/skus/DF002-M100', { std_cost: '37', weight_kg: '0.3' });
      const r = await api('AN', 'PUT', '/catalogue/skus/DF002-M100', { std_cost: '30', weight_kg: '0.3' });
      const c = await q1("SELECT std_cost FROM skus WHERE sku_code = 'DF002-M100'");
      const sp = await api('SH', 'POST', '/prices/specials', { customer_id: 11, sku_code: 'DF002-M100', price: 39, valid_from: TODAY, reason: 'y4' });
      ok(r.status === 200 && /waits for a second Admin/.test(r.data.message) && Number(c.std_cost) === 37 && sp.data && sp.data.waiting, `Anitha 37 -> 30: "${r.data && r.data.message}", cost stays ${c.std_cost}; a special at 39 (below 40.70 on the old cost): "${sp.data ? sp.data.message : js(sp.fields)}"`); }

    if (run('1.9b')) { await start(); T('1.9b', 'Products 1.9 again: GST locked to the HSN code');
      const r = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { hsn_code: '4818', weight_kg: '0.3' });
      const s = (await api('SH', 'GET', '/catalogue/skus/DF001-M100')).data;
      ok(r.status === 400 && /Not in the HSN list/.test(js(r.fields)) && Number(s.gst_rate) === 18, `4818: ${js(r.fields)}; the pack shows ${s.gst_rate}% from HSN ${s.hsn_code}`); }

    if (run('1.16b')) { await start(); T('1.16b', 'Products 1.16 again: gst 12 refused, 4818 not in the HSN list');
      const buf = Buffer.from(await (await fetch(`${base}/products/export.xlsx`, { headers: { Cookie: cookie('SH') } })).arrayBuffer());
      const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf); const ws = wb.getWorksheet('SKUs');
      let hr = 0; ws.eachRow((row, n) => { if (!hr && row.values.includes('sku')) hr = n; }); const hd = ws.getRow(hr).values; const col = (h) => hd.indexOf(h);
      ws.eachRow((row, n) => { if (n <= hr) return; const s = row.getCell(col('sku')).value; if (s === 'DF002-M100') row.getCell(col('gst')).value = 12; if (s === 'DF007-M100') row.getCell(col('hsn')).value = '4818'; });
      const fd = new FormData(); fd.append('file', new Blob([Buffer.from(await wb.xlsx.writeBuffer())]), 'p.xlsx');
      const j = await (await fetch(`${base}/products/import`, { method: 'POST', headers: { Cookie: cookie('SH') }, body: fd })).json();
      const e = js(j.data || j);
      ok(/gst 12 is refused: the GST rate comes from the HSN code/.test(e) && /HSN 4818 is not in the HSN list/.test(e), js((j.data && j.data.errors) || j.message)); }
    void decideAny; void pendingOf;
  },
};
