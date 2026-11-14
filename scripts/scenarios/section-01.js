// Section 1 - Products: the v23 Tests tab "1" (1.1 to 1.32) and the phase 14 extras (units of measure, "in steps of",
// the scan check in packing). Our dev data stands in for v23's sample: where a figure depends on the data (stock, the
// highest list price, cartons) the expected figure is worked out from ours with v23's rule and v23's is in the message.
// No photo is uploaded (nothing is written to media): a picture a test needs is a product_images row with a file name
// the app does not own (its delete never unlinks a file). Run: npm run scenarios -- 1
const path = require('path');

module.exports = {
  title: 'Products',
  async run(ctx) {
    const { api, ok, say, q1, qa, pool, T, fresh, run, decideAny, decide, today, base, cookie, P } = ctx;
    const ExcelJS = require(path.join(__dirname, '..', '..', 'node_modules', 'exceljs'));
    const catalogue = require(path.join(__dirname, '..', '..', 'src', 'backend_routes', 'catalogue.js'));
    const ean = (twelve) => { let s = 0; for (let i = 0; i < 12; i += 1) s += Number(twelve[i]) * (i % 2 ? 3 : 1); return twelve + ((10 - (s % 10)) % 10); };
    const fx = (r) => JSON.stringify(r.fields || r.msg || (r.data && r.data.message) || r.raw);
    const ready = async (codes) => { for (const c of codes) await pool.query('UPDATE skus SET weight_kg = COALESCE(weight_kg, 0.5) WHERE sku_code = ?', [c]); };
    const photo = (id, pos) => pool.query('INSERT INTO product_images (product_id, position, file_name, width, height) VALUES (?, ?, ?, 900, 900) ON DUPLICATE KEY UPDATE file_name = VALUES(file_name)', [id, pos, `scenario-photo-${pos}.webp`]).catch((e) => say('photo row:', e.message));
    const rulesSigned = async () => { for (const x of await qa("SELECT approval_id FROM approvals WHERE status = 'pending' AND kind = 'rule_change'")) await decideAny(x.approval_id); };
    // the products Excel: download, change cells, check (dry run) or apply
    const xl = async () => { const res = await fetch(`${base}/products/export.xlsx`, { headers: { Cookie: cookie('SH') } }); const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(await res.arrayBuffer())); return wb; };
    const cell = (wb, sku, col) => { const ws = wb.getWorksheet('SKUs'); let hr = 0; ws.eachRow((row, n) => { if (!hr && row.values.includes('sku')) hr = n; }); const h = ws.getRow(hr).values; let at = null; ws.eachRow((row, n) => { if (n > hr && row.getCell(h.indexOf('sku')).value === sku) at = row.getCell(h.indexOf(col)); }); return at; };
    // the apply sends the very bytes that passed the dry run: ExcelJS stamps the time into the file, so writing the same
    // workbook again a second or two later (a slow moment, e.g. scenario batches running side by side) gives another
    // file, its hash differs from the dry run's and the server rightly refuses the apply (that made 1.31 fail once)
    const bytes = new WeakMap();
    const dry = async (wb, apply = false, hash = '') => { const buf = apply && bytes.has(wb) ? bytes.get(wb) : await wb.xlsx.writeBuffer(); bytes.set(wb, buf); const fd = new FormData(); fd.append('file', new Blob([buf]), 'p.xlsx');
      const res = await fetch(`${base}/products/import${apply ? `?dryRun=0&hash=${hash}` : ''}`, { method: 'POST', headers: { Cookie: cookie('SH') }, body: fd }); const j = await res.json(); return { status: res.status, ...(j.data || j) }; };
    const sku = async (code, as = 'SH') => (await api(as, 'GET', `/catalogue/skus/${code}`)).data;

    if (run('1.1')) { await fresh(); T('1.1', 'A new product cannot go live until it is complete');
      // our dev data already has DZIND-DF050 "Kitchen Towels - 4 Pack" (archived), so the new one is DZIND-DF051 "Kitchen Towels - 4 Rolls"
      let r = await api('SH', 'POST', '/catalogue/products', { name: 'Kitchen Towels - 4 Rolls', product_id: 'DZIND-DF051', category_key: 'kitchen', first_pack: '4 rolls', source: 'made', specification: '2-ply · 4 rolls', one_liner: 'Four soft kitchen towel rolls.' });
      const st0 = (await api('SH', 'GET', '/catalogue/products/DZIND-DF051')).data;
      ok(r.status === 200 && r.data.sku_code === 'DF051-R4' && st0.status === 'draft', `created: ${r.data ? r.data.message : fx(r)} (status ${st0 && st0.status})`);
      const a1 = await api('SH', 'POST', '/catalogue/products/DZIND-DF051/status', { to: 'active' });
      ok(a1.status === 409 && /picture/.test(a1.msg) && /weight/.test(a1.msg) && /full description/.test(a1.msg) && /keywords/.test(a1.msg) && /best for/.test(a1.msg), `first Make active refused: "${a1.msg}"`);
      await photo('DZIND-DF051', 1);
      const s = await api('SH', 'PUT', '/catalogue/skus/DF051-R4', { weight_kg: '0.8', hsn_code: '48182000' });
      const w = await api('SH', 'PUT', '/catalogue/products/DZIND-DF051', { tr: { en: { keywords: 'kitchen, towels, rolls', description: 'Four rolls of soft 2-ply kitchen towel.', best_for: 'Home · Eateries' } } });
      r = await api('SH', 'POST', '/catalogue/products/DZIND-DF051/status', { to: 'active' });
      ok(s.status === 200 && w.status === 200 && r.status === 200 && /Active/.test(r.data.message), `a picture (a row, no upload), DF051-R4 weight 0.8 + HSN 48182000 (${s.status}), the English words (${w.status}); Make active: "${r.data ? r.data.message : r.msg}"`); }

    if (run('1.2')) { await fresh(); T('1.2', 'The last picture of an active product stays');
      // Toilet Roll (DZIND-DF016) as in v23; its rows get file names the app does not own, so no media file is touched
      await pool.query("UPDATE product_images SET file_name = CONCAT('scenario-photo-', position, '.webp') WHERE product_id = 'DZIND-DF016'");
      const n0 = (await q1("SELECT COUNT(*) n FROM product_images WHERE product_id = 'DZIND-DF016'")).n;
      const a = await api('SH', 'DELETE', '/products/DZIND-DF016/images/3'); const b = await api('SH', 'DELETE', '/products/DZIND-DF016/images/2');
      const c = await api('SH', 'DELETE', '/products/DZIND-DF016/images/1');
      ok(Number(n0) === 3 && a.status === 200 && b.status === 200 && c.status === 409 && /last picture/.test(c.msg), `Toilet Roll had ${n0} pictures: the first two go (${a.status}, ${b.status}); the last: ${c.status} "${c.msg}"`); }

    if (run('1.3')) { await fresh(); T('1.3', 'One barcode finds one SKU; a misread EAN is caught');
      const E = catalogue.eanOk('8901234500446') ? '8901234500446' : ean('890123450044');
      const s = await api('SH', 'POST', '/catalogue/skus/DF044-M100/barcodes', { barcode: E, kind: 'supplier' });
      const dup = await api('SH', 'POST', '/catalogue/skus/DF001-M100/barcodes', { barcode: E, kind: 'supplier' });
      const bad = `${E.slice(0, 12)}${(Number(E[12]) + 1) % 10}`;
      const mis = await api('SH', 'POST', '/catalogue/skus/DF001-M100/barcodes', { barcode: bad, kind: 'supplier' });
      ok(s.status === 200 && dup.status === 409 && /already belongs to DF044-M100/.test(dup.msg) && mis.status === 409 && /check digit/.test(mis.msg),
        `setup: ${E} is DF044-M100's supplier EAN${E !== '8901234500446' ? ' (v23 8901234500446 fails the EAN-13 check)' : ''}; on DF001-M100: "${dup.msg}"; ${bad}: "${mis.msg}"`); }

    if (run('1.4')) { await fresh(); T('1.4', 'Any barcode finds the SKU');
      const E = catalogue.eanOk('8901234500484') ? '8901234500484' : ean('890123450048');
      await api('SH', 'POST', '/catalogue/skus/DF048-BOX/barcodes', { barcode: E, kind: 'supplier' });
      const per = (await q1("SELECT packs FROM sku_cartons WHERE sku_code = 'DF037-M150' ORDER BY from_date DESC LIMIT 1")).packs;
      const c = await api('SH', 'POST', '/catalogue/scan', { code: 'DF037-M150#C' });
      const e = await api('SH', 'POST', '/catalogue/scan', { code: E });
      const l = await api('SH', 'POST', '/catalogue/scan', { code: 'df016-r1' });
      ok(c.data && c.data.sku === 'DF037-M150' && c.data.kind === 'carton' && c.data.packs === Number(per) && e.data && e.data.sku === 'DF048-BOX' && l.data && l.data.sku === 'DF016-R1',
        `DF037-M150#C: ${c.data && c.data.sku}, 1 scan = 1 carton = ${c.data && c.data.packs} packs (ours holds ${per}; v23 24); ${E}: ${e.data && e.data.sku} ${e.data && e.data.name}; df016-r1: ${l.data && l.data.sku}`); }

    if (run('1.5')) { await fresh(); T('1.5', 'Unknown barcode: the floor reports, the office links');
      const U = catalogue.eanOk('8907654321012') ? '8907654321012' : ean('890765432101');
      const m = await api('MU', 'POST', '/catalogue/scan', { code: U });
      const l1 = (await api('SH', 'GET', '/catalogue/barcodes')).data;
      const lk = await api('SH', 'POST', '/catalogue/barcodes/link', { barcode: U, sku_code: 'DF013-M50', kind: 'supplier' });
      const l2 = (await api('SH', 'GET', '/catalogue/barcodes')).data;
      const again = await api('SH', 'POST', '/catalogue/scan', { code: U });
      ok(m.data && m.data.unknown && m.data.noted && !m.data.can_link && l1.unknown.length === 1 && l1.unknown[0].barcode === U && l1.unknown[0].who && !/Shoban/.test(l1.unknown[0].who) && lk.status === 200 && l2.unknown.length === 0 && again.data.sku === 'DF013-M50',
        `${U}${U !== '8907654321012' ? ' (v23 8907654321012 fails the check digit)' : ''}: Murugan S (Warehouse, DZIND136) noted=${m.data && m.data.noted}, can link=${m.data && m.data.can_link}; Shoban sees ${l1.unknown.length} by ${l1.unknown[0] && l1.unknown[0].who}; linked (${lk.status}), list ${l2.unknown.length}; scanned again: ${again.data && again.data.sku}`); }

    if (run('1.6')) { await fresh(); T('1.6', 'A carton size change applies to new arrivals only');
      const per = Number((await q1("SELECT packs FROM sku_cartons WHERE sku_code = 'DF037-M150' ORDER BY from_date DESC LIMIT 1")).packs);
      const r = await api('SH', 'PUT', '/catalogue/skus/DF037-M150', { packs_per_carton: String(per - 2), weight_kg: '0.5' });
      const hist = r.data ? r.data.sku.cartons.map((c) => `${c.packs} packs from ${c.from_date}`).join(' · ') : '';
      ok(r.status === 200 && new RegExp(`cartons in stock keep ${per}`).test(r.data.message) && r.data.sku.cartons.length === 2 && new RegExp(`^${per} packs from \\d{4}-\\d\\d-\\d\\d · ${per - 2} packs from ${today()}$`).test(hist),
        `${per} -> ${per - 2} (v23 24 -> 20): "${r.data ? r.data.message : r.msg}"; history "${hist}"`); }

    if (run('1.7')) { await fresh(); T('1.7', 'Full-carton packs need carton multiples');
      const a = await api('SH', 'PUT', '/catalogue/skus/DF016-R1', { min_order_qty: '50', weight_kg: '0.2' });
      const b = await api('SH', 'PUT', '/catalogue/skus/DF016-R1', { min_order_qty: '96', weight_kg: '0.2' });
      ok(a.status === 400 && a.fields && /multiple of 48/.test(a.fields.min_order_qty) && b.status === 200, `50: "${a.fields && a.fields.min_order_qty}"; 96: ${b.status}`); }

    if (run('1.8')) { await fresh(); T('1.8', 'Anything that expires is batch tracked');
      const a = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { shelf_life_months: '12', track_batches: false, weight_kg: '0.3' });
      const b = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { shelf_life_months: '12', track_batches: true, near_expiry_days: '400', weight_kg: '0.3' });
      const c = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { shelf_life_months: '12', track_batches: true, near_expiry_days: '60', weight_kg: '0.3' });
      ok(a.status === 400 && /batch tracking must be on/.test(a.fields.track_batches) && b.status === 400 && /Longer than the 12-month shelf life/.test(b.fields.near_expiry_days) && c.status === 200,
        `batch Off: "${a.fields && a.fields.track_batches}"; 400 days: "${b.fields && b.fields.near_expiry_days}"; 60: ${c.status}`); }

    if (run('1.9')) { await fresh(); T('1.9', 'A pack takes its GST from its HSN code');
      const s0 = await sku('DF044-M100');
      const typed = await api('SH', 'PUT', '/catalogue/skus/DF044-M100', { gst_rate: 5 });
      const s1 = await sku('DF044-M100');
      const tom = new Date(Date.parse(`${today()}T00:00:00Z`) + 864e5).toISOString().slice(0, 10);
      const past = await api('SH', 'PUT', '/prices/hsn/33079090', { gst_rate: 5, effective_from: '2026-10-01' });
      const fut = await api('SH', 'PUT', '/prices/hsn/33079090', { gst_rate: 5, effective_from: tom });
      await rulesSigned();
      const h = (await api('SH', 'GET', '/prices/hsn')).data.codes.find((c) => c.hsn_code === '33079090');
      const s2 = await sku('DF044-M100');
      ok(s0.hsn_code === '33079090' && s0.gst_rate === 18 && s1.gst_rate === 18 && past.status === 400 && fut.status === 200 && h.next && h.next.rate === 5 && h.next.from === tom && s2.gst_rate === 18,
        `DF044-M100: HSN ${s0.hsn_code}, GST ${s0.gst_rate}% (a typed 5% is not taken: ${typed.status}, still ${s1.gst_rate}%); 5% from 2026-10-01: ${fx(past)}; from ${tom} (v23 2026-11-01): ${fut.status} "${fut.data && fut.data.message}"; the HSN shows next ${h.next && `${h.next.rate}% from ${h.next.from}`}; today still ${s2.gst_rate}%`); }

    if (run('1.10')) { await fresh(); T('1.10', 'Discontinued: sold until empty, then archived');
      const d = await api('SH', 'POST', '/catalogue/products/DZIND-DF014/status', { to: 'discontinued' });
      const ar = await api('SH', 'POST', '/catalogue/products/DZIND-DF014/status', { to: 'archived' });
      ok(d.status === 200 && ar.status === 409 && /still has \d+ packs/.test(ar.msg), `discontinued: "${d.data && d.data.message}"; Archive: "${ar.msg}" (v23 60 packs)`);
      // v23's "Sell the remaining sample stock" (a test helper there too): every pack of DF014-M100 leaves
      for (const x of await qa("SELECT location_id, stock_kind, batch_id, SUM(delta) n FROM stock_movements WHERE sku_code = 'DF014-M100' GROUP BY location_id, stock_kind, batch_id HAVING n <> 0")) {
        await pool.query("INSERT INTO stock_movements (sku_code, location_id, stock_kind, batch_id, delta, move_type, note, emp_id) VALUES ('DF014-M100', ?, ?, ?, ?, 'adjust', 'scenario: sample stock sold out', 'DZIND002')", [x.location_id, x.stock_kind, x.batch_id, -Number(x.n)]);
      }
      const n1 = await api('SH', 'POST', '/catalogue/nightly'); const n2 = await api('SH', 'POST', '/catalogue/nightly');
      const an = await api('AN', 'POST', '/catalogue/products/DZIND-DF014/status', { to: 'draft' });
      const pv = await api('PV', 'POST', '/catalogue/products/DZIND-DF014/status', { to: 'draft' });
      ok(n1.data && n1.data.archived.includes('DZIND-DF014') && n2.data.archived.length === 0 && an.status === 403 && /Only an Admin/.test(an.msg) && pv.status === 200 && /Draft/.test(pv.data.message),
        `stock 0: "${n1.data && n1.data.message}"; again: "${n2.data && n2.data.message}"; Anitha: ${an.status} "${an.msg}"; Pavithran: "${pv.data && pv.data.message}"`);
      // and Make active again on a discontinued product waits for a second Admin (phase 14)
      await api('SH', 'POST', '/catalogue/products/DZIND-DF002/status', { to: 'discontinued' });
      const back = await api('SH', 'POST', '/catalogue/products/DZIND-DF002/status', { to: 'active' });
      const w = await q1("SELECT approval_id FROM approvals WHERE status = 'pending' AND JSON_UNQUOTE(JSON_EXTRACT(payload, '$.dk')) = 'prodback:DZIND-DF002'");
      if (w) await decide('PV', w.approval_id);
      const st = await q1("SELECT status FROM products WHERE product_id = 'DZIND-DF002'");
      ok(back.data && back.data.waiting && w && st.status === 'active', `Make active again on discontinued DZIND-DF002: "${back.data ? back.data.message : back.msg}"; signed by Pavithran: ${st.status}`); }

    if (run('1.11')) { await fresh(); T('1.11', 'Kits follow stock in each godown');
      const k0 = (await api('SH', 'GET', '/catalogue/kits')).data.kits.find((k) => k.kit_key === 'hotels');
      await ready(k0.parts.map((x) => x.sku_code));
      const k = (await api('SH', 'GET', '/catalogue/kits')).data.kits.find((x) => x.kit_key === 'hotels');
      const per = [];
      for (const p of k.parts) per.push({ sku: p.sku_code, n: Math.floor((await ctx.shelf(p.sku_code, 'good', 1)) / p.qty) });
      const least = Math.min(...per.map((x) => x.n));
      ok(k.avail[1].n === least && k.avail[2].n === 0 && k.avail[2].why.length > 0,
        `Hotels & lodges at Kanchipuram: ${k.avail[1].n} can be sold = the part with least good stock (${per.map((x) => `${x.sku} ${x.n}`).join(', ')}); Chennai: ${k.avail[2].n}, "${k.avail[2].why.join('; ')}"`); }

    if (run('1.12')) { await fresh(); T('1.12', 'A kit needs two different, sellable packs');
      await ready(['DF001-M100', 'DF002-M100']);
      // the dev data already has a kit called "Test kit" (KIT-05), so this one is "Test kit 2"
      const kit = { name: { en: 'Test kit 2' }, tagline: { en: '' }, rep_product_id: 'DZIND-DF001', business_type: 'hotel', status: 'active', on_site: false };
      const a = await api('SH', 'POST', '/catalogue/kits', { ...kit, parts: [{ sku_code: 'DF001-M100', qty: 2 }] });
      const b = await api('SH', 'POST', '/catalogue/kits', { ...kit, parts: [{ sku_code: 'DF001-M100', qty: 2 }, { sku_code: 'DF001-M100', qty: 1 }] });
      const c = await api('SH', 'POST', '/catalogue/kits', { ...kit, parts: [{ sku_code: 'DF001-M100', qty: 2 }, { sku_code: 'DF002-M100', qty: 1 }] });
      ok(a.status === 400 && /at least two different packs/.test((a.fields || {})['parts.0']) && b.status === 400 && /already in the kit/.test((b.fields || {})['parts.1']) && c.status === 200 && /^KIT-\d+$/.test(c.data.kit.kit_code),
        `one part: "${(a.fields || {})['parts.0']}"; the same pack again: "${(b.fields || {})['parts.1']}"; third time: ${c.data ? c.data.kit.kit_code : fx(c)}`); }

    if (run('1.13')) { await fresh(); T('1.13', 'A kit on the website needs its words and photo');
      const off = (await api('SH', 'GET', '/catalogue/kits')).data.kits.find((k) => k.kit_key === 'offices');
      await ready(off.parts.map((x) => x.sku_code));
      const body = { parts: off.parts.map((x) => ({ sku_code: x.sku_code, qty: x.qty })), name: off.name, tagline: { ...off.tagline, en: '' }, rep_product_id: off.rep_product_id, business_type: off.business_type, status: off.status, price: '', on_site: true };
      const a = await api('SH', 'PUT', '/catalogue/kits/offices', body);
      const b = await api('SH', 'PUT', '/catalogue/kits/offices', { ...body, on_site: false });
      ok(a.status === 400 && /needs its English tagline/.test((a.fields || {})['tagline.en']) && b.status === 200, `tagline cleared: "${(a.fields || {})['tagline.en']}"; "Show on dfresh.us" off: ${b.status}`); }

    if (run('1.14')) { await fresh(); T('1.14', 'Category order waits for Save; a used category stays');
      const r = await api('SH', 'POST', '/catalogue/categories/towels/active', { on: false });
      ok(r.status === 409 && /Cannot hide .* active product/.test(r.msg), `switching off Hand Towels: "${r.msg}" (the "New order not saved" bar and Cancel are screen behaviour, not an API step)`); }

    if (run('1.15')) { await fresh(); T('1.15', 'Most loved: five places, taken places swap');
      const before = await qa("SELECT product_id, featured_order FROM products WHERE featured_order IS NOT NULL ORDER BY featured_order");
      const at1 = before.find((x) => Number(x.featured_order) === 1); const was = before.find((x) => x.product_id === 'DZIND-DF028');
      const r = await api('SH', 'PUT', '/catalogue/products/DZIND-DF028', { featured: 1 });
      const after = await qa("SELECT product_id, featured_order FROM products WHERE product_id IN ('DZIND-DF028', ?)", [at1.product_id]);
      const o = (id) => Number(after.find((x) => x.product_id === id).featured_order);
      ok(r.status === 200 && o('DZIND-DF028') === 1 && o(at1.product_id) === Number(was.featured_order), `Facial Tissue 100 Pulls (Most loved ${was.featured_order}) to 1; ${at1.product_id} (was 1) moves to ${o(at1.product_id)}: "${r.data ? r.data.message : r.msg}"`); }

    if (run('1.16')) { await fresh(); T('1.16', 'Import is checked row by row first');
      let wb = await xl();
      const ppc2 = cell(wb, 'DF002-M100', 'packs_per_carton').value;
      cell(wb, 'DF001-M100', 'gst').value = 12; cell(wb, 'DF002-M100', 'packs_per_carton').value = 0;
      const d1 = await dry(wb);
      // hsn belongs to the product: our DZIND-DF001 also has an archived DF001-M200 row, which must carry the same hsn
      wb = await xl(); for (const c of ['DF001-M100', 'DF001-M200']) if (cell(wb, c, 'hsn')) cell(wb, c, 'hsn').value = '4818';
      const d2 = await dry(wb);
      wb = await xl(); const hsn0 = cell(wb, 'DF001-M100', 'hsn').value; for (const c of ['DF001-M100', 'DF001-M200']) if (cell(wb, c, 'hsn')) cell(wb, c, 'hsn').value = '48182000';
      const d3 = await dry(wb);
      const ap = d3.ok ? await dry(wb, true, d3.fileHash) : null;
      const h1 = await q1("SELECT hsn_code FROM products WHERE product_id = 'DZIND-DF001'");
      const au = await q1("SELECT COUNT(*) n FROM audit_log WHERE entity_id IN ('DF001-M100', 'DZIND-DF001') AND action = 'import'");
      ok(d1.ok === false && d1.errors.length === 2 && d1.errors.some((e) => /gst 12 is refused/.test(e)) && d1.errors.some((e) => /packs_per_carton/.test(e)), `first check (gst 12, DF002 packs_per_carton ${ppc2} -> 0): ${d1.errors.length} errors, no Apply: ${d1.errors.join(' | ')}`);
      ok(d2.ok === false && d2.errors.length >= 1 && d2.errors.every((e) => /4818 is not in the HSN list/.test(e)), `second (hsn 4818): ${d2.errors.join(' | ')}`);
      ok(d3.ok && d3.skus.length >= 1 && d3.skus.every((x) => new RegExp(`hsn: ${hsn0} -> 48182000`).test(x.diff.join())) && ap && ap.dryRun === false && h1.hsn_code === '48182000' && Number(au.n) >= 1,
        `third: ${d3.ok ? 'no errors' : d3.errors.join(' | ')}, ${d3.skus && d3.skus.length} change(s) (${d3.skus && d3.skus.map((x) => `${x.sku || x.sku_code}: ${x.diff.join(', ')}`).join('; ')}); Apply: hsn now ${h1.hsn_code}, ${au.n} import row(s) in the audit log`); }

    if (run('1.17')) { await fresh(); T('1.17', 'Roles from Foundation decide who changes products');
      const res = [];
      for (const who of ['KU', 'DV']) {
        const g = await api(who, 'GET', '/catalogue/products'); const w = await api(who, 'PUT', '/catalogue/products/DZIND-DF001', { brand: 'X' }); const c = await api(who, 'POST', '/catalogue/products', { name: 'x' });
        res.push([who, g.status, w.status, c.status]);
      }
      const ra = await api('RA', 'GET', '/catalogue/products');
      ok(res.every((x) => x[1] === 200 && x[2] === 403 && x[3] === 403) && ra.status === 403, `view / save / new: ${res.map((x) => `${x[0]} ${x[1]}/${x[2]}/${x[3]}`).join(', ')}; Raja K (Delivery): ${ra.status} "${ra.msg}"`); }

    if (run('1.18')) { await fresh(); T('1.18', 'Labels print a barcode a scanner reads, in any language');
      const r = (await api('SH', 'GET', '/catalogue/labels')).data;
      const l = r.rows.find((x) => x.sku_code === 'DF037-M150');
      ok(r.words.ta.lb_carton_of === 'அட்டைப்பெட்டி' && l.carton_code === 'DF037-M150#C' && l.category.ta && l.packs_per_carton > 0,
        `Tamil carton label word "${r.words.ta.lb_carton_of}", category "${l.category.ta}", ${l.packs_per_carton} packs per carton (v23 24), barcode ${l.carton_code}, name "${l.name || l.product}"`); }

    if (run('1.19')) { await fresh(); T('1.19', 'A substitute is never itself and must be sold');
      const a = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { substitutes: ['DF001-M100'], weight_kg: '0.3' });
      const d = await api('SH', 'POST', '/catalogue/products/DZIND-DF014/status', { to: 'discontinued' });
      const b = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { substitutes: ['DF014-M100'], weight_kg: '0.3' });
      ok(a.status === 400 && /never its own/.test(a.fields.substitutes) && d.status === 200 && b.status === 400 && /DF014-M100 is not sold/.test(b.fields.substitutes), `itself: "${a.fields && a.fields.substitutes}"; Dispenser Napkins discontinued, then DF014-M100: "${b.fields && b.fields.substitutes}"`); }

    if (run('1.20')) { await fresh(); T('1.20', 'Missing translations are flagged');
      const hi = (await api('SH', 'GET', '/catalogue/products/DZIND-DF006')).data.tr.hi.one_liner;
      const r = await api('SH', 'PUT', '/catalogue/products/DZIND-DF006', { tr: { hi: { one_liner: '' } } });
      const row = (await api('SH', 'GET', '/catalogue/products')).data.products.find((x) => x.product_id === 'DZIND-DF006');
      const pan = (await api('SH', 'GET', '/catalogue/products/DZIND-DF006')).data;
      await api('SH', 'PUT', '/catalogue/products/DZIND-DF006', { tr: { hi: { one_liner: hi } } });
      const row2 = (await api('SH', 'GET', '/catalogue/products')).data.products.find((x) => x.product_id === 'DZIND-DF006');
      ok(r.status === 200 && row.lang_gaps.includes('HI') && pan.lang_gaps.includes('HI') && !row2.lang_gaps.includes('HI'), `Hindi short line cleared: saved; the row shows ${row.lang_gaps.join(', ')} missing, the panel knows; typed back: [${row2.lang_gaps.join(', ')}]`); }

    if (run('1.21')) { await fresh(); T('1.21', 'A SKU code is unique and locked');
      const a = await api('SH', 'POST', '/catalogue/products/DZIND-DF001/skus', { pack: 'Pack of 100' });
      // our dev data already has DF001-M200 (archived), so "Pack of 200" is added to Restaurant Napkins (DZIND-DF002)
      const b = await api('SH', 'POST', '/catalogue/products/DZIND-DF002/skus', { pack: 'Pack of 200' });
      const s = await sku('DF002-M200');
      ok(a.status === 409 && /DF001-M100 already exists/.test(a.msg) && b.status === 200 && s && s.product_id === 'DZIND-DF002' && s.ready === false,
        `"Pack of 100": "${a.msg}"; "Pack of 200" on DZIND-DF002: ${b.data ? b.data.message : fx(b)}, ready=${s && s.ready} until its weight is set`); }

    if (run('1.22')) { await fresh(); T('1.22', 'Units in use cannot be removed');
      const kg = await api('SH', 'DELETE', '/catalogue/units/kg');
      const add = await api('SH', 'POST', '/catalogue/units', { name: 'Dozen', unit_code: 'dozen' }); const rem = await api('SH', 'DELETE', '/catalogue/units/dozen');
      const raw = await api('SH', 'PUT', '/prices/lists/default/skus/RM-PR2', { price: 10, from: today() });
      ok(kg.status === 409 && /raw materials are counted in it/.test(kg.msg) && add.status === 200 && rem.status === 200 && raw.status >= 400,
        `Kilogram: "${kg.msg}"; Dozen added (${add.status}) and removed (${rem.status}); a raw material on a price list: ${raw.status} ${fx(raw)}`); }

    if (run('1.23')) { await fresh(); T('1.23', 'Every change is in the audit log');
      await api('SH', 'PUT', '/catalogue/skus/DF016-R1', { min_order_qty: '96', weight_kg: '0.2' });
      await api('SH', 'PUT', '/catalogue/products/DZIND-DF008-BLK', { order: '5.4' });
      await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { mrp: '65', weight_kg: '0.3' });
      const r = await api('SH', 'GET', '/audit?screen=products&limit=200');
      const rows = (r.data && r.data.rows) || [];
      const diff = rows.find((x) => x.changes && x.changes.some((c) => c.from !== null && c.to !== null));
      const ku = await api('KU', 'GET', '/audit/mine');
      ok(rows.length >= 3 && diff && ku.status === 200 && (ku.data.rows || []).every((x) => x.emp_id === P.KU),
        `Products screen: ${rows.length} rows, e.g. ${diff && `${diff.who} at ${diff.when || diff.at}: ${diff.changes[0].field} ${diff.changes[0].from} -> ${diff.changes[0].to}`}; Kumar's own: ${(ku.data.rows || []).length}, all his`); }

    if (run('1.24')) { await fresh(); T('1.24', 'Every word the live site has is here');
      const p = (await api('SH', 'GET', '/catalogue/products/DZIND-DF001')).data;
      ok(p.brand === 'dFresh' && p.show_for_home === true && p.order === '1' && p.specification && p.spec_status, `Basics: brand ${p.brand}, For Home ${p.show_for_home}, order ${p.order}, "${p.specification}", staff-only "${p.spec_status}"`);
      // the dev data has the Tamil and Hindi alt text and WhatsApp message empty (content, not code): the panel must carry the fields
      const F = ['keywords', 'description', 'best_for', 'alt_text', 'whatsapp_message'];
      const filled = (l) => F.filter((f) => p.tr[l][f]).join(', ');
      ok(['en', 'ta', 'hi'].every((l) => F.every((f) => f in p.tr[l]) && p.tr[l].keywords && p.tr[l].description && p.tr[l].best_for) && p.tr.en.alt_text && p.tr.en.whatsapp_message && p.tr.ta.name && p.tr.hi.name,
        `all 5 fields in EN/TA/HI; filled: EN ${filled('en')} | TA ${filled('ta')} | HI ${filled('hi')}; Tamil "${p.tr.ta.name}", Hindi "${p.tr.hi.name}"`); }

    if (run('1.25')) { await fresh(); T('1.25', 'Keywords are short and few');
      const a = await api('SH', 'PUT', '/catalogue/products/DZIND-DF001', { tr: { en: { keywords: 'a, b, c, d, e, f, g' } } });
      const b = await api('SH', 'PUT', '/catalogue/products/DZIND-DF001', { tr: { en: { keywords: 'napkins, , soft' } } });
      ok(a.status === 400 && /Up to 6 keywords/.test(a.fields['tr.en.keywords']) && b.status === 400 && /1 to 30 characters/.test(b.fields['tr.en.keywords']), `7 keywords: "${a.fields && a.fields['tr.en.keywords']}"; "napkins, , soft": "${b.fields && b.fields['tr.en.keywords']}" (the field key names the Website words tab)`); }

    if (run('1.26')) { await fresh(); T('1.26', 'An active product keeps its English words');
      const a = await api('SH', 'PUT', '/catalogue/products/DZIND-DF001', { tr: { en: { description: '' } } });
      const h = await api('SH', 'POST', '/catalogue/products/DZIND-DF001/status', { to: 'hidden' });
      const b = await api('SH', 'PUT', '/catalogue/products/DZIND-DF001', { tr: { en: { description: '' } } });
      const c = await api('SH', 'POST', '/catalogue/products/DZIND-DF001/status', { to: 'active' });
      ok(a.status === 400 && /active product needs its English full description/.test(a.fields['tr.en.description']) && h.status === 200 && b.status === 200 && c.status === 409 && /full description/.test(c.msg),
        `active: "${a.fields && a.fields['tr.en.description']}"; hidden, it saves (${b.status}); Make active: "${c.msg}"`); }

    if (run('1.27')) { await fresh(); T('1.27', 'A colour version stays next to its main product');
      const blk = (await api('SH', 'GET', '/catalogue/products/DZIND-DF008-BLK')).data;
      const a = await api('SH', 'PUT', '/catalogue/products/DZIND-DF008-BLK', { order: '7.1' });
      const b = await api('SH', 'PUT', '/catalogue/products/DZIND-DF008-BLK', { order: '5.4' });
      ok(a.status === 400 && /use 5\.1, 5\.2/.test(a.fields.order) && b.status === 200 && b.data.product.order === '5.4', `order ${blk.order} -> 7.1: "${a.fields && a.fields.order}"; 5.4: ${b.data && b.data.product.order}`); }

    if (run('1.28')) { await fresh(); T('1.28', 'MRP is the most anyone pays');
      const top = (await sku('DF001-M100')).max_price;
      const lo = Math.floor(top.inc) - 1; const hi = Math.ceil(top.inc) + 3;
      const a = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { mrp: String(lo), weight_kg: '0.3' });
      const b = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { mrp: String(hi), weight_kg: '0.3' });
      const panel = (await api('SH', 'GET', '/prices/lists/default/skus/DF001-M100')).data;
      const over = Math.ceil((hi / 1.18) + 1);
      const c = await api('SH', 'PUT', '/prices/lists/default/skus/DF001-M100', { price: over, from: today() });
      ok(a.status === 400 && new RegExp(`charges Rs ${top.inc.toFixed(2).replace('.', '\\.')} with GST`).test(a.fields.mrp) && b.status === 200 && b.data.sku.mrp === hi && Number(panel.mrp) === hi && c.status >= 400 && /Above the MRP/.test(fx(c)),
        `highest today Rs ${top.inc} (${top.list}; v23 62.00 on Retail): MRP ${lo}: "${a.fields && a.fields.mrp}"; ${hi} saved, the price panel shows MRP ${panel.mrp}; Default ${over} (${(over * 1.18).toFixed(2)} with GST): ${fx(c)}`); }

    if (run('1.29')) { await fresh(); T('1.29', 'Standard cost is for Admin and Sub-admin');
      const avg = Number((await q1("SELECT avg_cost FROM skus WHERE sku_code = 'DF001-M100'")).avg_cost);
      const hi = Math.ceil(avg) + 20;
      const a = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { std_cost: String(hi), weight_kg: '0.3' });
      const pnl = (await api('SH', 'GET', '/prices/lists/default/skus/DF001-M100')).data;
      const ku = await sku('DF001-M100', 'KU');
      const lo = Math.max(1, Math.floor(avg) - 5);
      const b = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { std_cost: String(lo), weight_kg: '0.3' });
      const mid = Number((await q1("SELECT std_cost FROM skus WHERE sku_code = 'DF001-M100'")).std_cost);
      await rulesSigned(); for (const x of await qa("SELECT approval_id FROM approvals WHERE status = 'pending' AND summary LIKE '%DF001-M100%'")) await decideAny(x.approval_id);
      const end = Number((await q1("SELECT std_cost FROM skus WHERE sku_code = 'DF001-M100'")).std_cost);
      ok(a.status === 200 && a.data.sku.std_cost === hi && !a.data.waiting && pnl && Number(pnl.std_cost) === hi && ku && !('std_cost' in ku) && ku.sees_cost === false,
        `Shoban: standard cost ${hi} saved at once (above the ${avg.toFixed(2)} average); the price panel shows cost ${pnl && pnl.std_cost} (Default ${pnl && (pnl.price || pnl.ex)}); Kumar: no standard cost (${Object.keys(ku || {}).filter((x) => /cost/.test(x)).join(', ')})`);
      ok(b.status === 200 && b.data.waiting && mid === hi && end === lo, `a lower cost ${lo} waits for a second Admin ("${b.data && b.data.message}"), ${mid} stays; signed: ${end}`); }

    if (run('1.30')) { await fresh(); T('1.30', 'Pack labels carry what the law asks');
      const r0 = (await api('SH', 'GET', '/catalogue/labels')).data;
      const top = (await sku('DF001-M100')).max_price.inc; const m = Math.ceil(top) + 3;
      await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { mrp: String(m), weight_kg: '0.3' });
      const r = (await api('SH', 'GET', '/catalogue/labels')).data;
      const l0 = r0.rows.find((x) => x.sku_code === 'DF001-M100'); const l1 = r.rows.find((x) => x.sku_code === 'DF001-M100'); const l2 = r.rows.find((x) => x.sku_code === 'DF002-M100');
      ok(l0.mrp === null && l1.mrp === m && l2.mrp === null && l1.brand === 'dFresh' && l1.origin === 'India' && r.company.name && r.company.phone && (l1.net_qty || l1.size_label),
        `before: DF001-M100 MRP ${l0.mrp === null ? 'not set' : l0.mrp}; after MRP ${m}: DF001-M100 ${l1.mrp}, DF002-M100 ${l2.mrp === null ? '"MRP not set"' : l2.mrp}; net "${l1.net_qty || l1.size_label}", brand ${l1.brand}, origin ${l1.origin}, packed by ${r.company.name}, care ${r.company.phone}`); }

    if (run('1.31')) { await fresh(); T('1.31', 'Import carries the MRP');
      const top = (await sku('DF001-M100')).max_price;
      let wb = await xl(); const m0 = cell(wb, 'DF001-M100', 'mrp');
      const lo = Math.floor(top.inc) - 1; const hi = Math.ceil(top.inc) + 8;
      m0.value = lo; const d1 = await dry(wb);
      wb = await xl(); cell(wb, 'DF001-M100', 'mrp').value = hi; const d2 = await dry(wb);
      const ap = d2.ok ? await dry(wb, true, d2.fileHash) : null;
      const mm = await q1("SELECT mrp FROM skus WHERE sku_code = 'DF001-M100'");
      ok(m0 !== null && !d1.ok && d1.errors.length === 1 && /below a price with GST/.test(d1.errors[0]) && d2.ok && d2.skus.length === 1 && new RegExp(`mrp: (empty|-|) ?-> ${hi}`).test(d2.skus[0].diff.join()) && ap && Number(mm.mrp) === hi,
        `mrp ${lo}: ${d1.errors.join(' | ')}; ${hi}: ${d2.ok ? `${d2.skus.length} change (${d2.skus[0].diff.join(', ')})` : d2.errors.join(' | ')}; applied: ${mm.mrp}`); }

    if (run('1.32')) { await fresh(); T('1.32', 'A mistake in another section of the panel is shown');
      const r = await api('SH', 'PUT', '/catalogue/products/DZIND-DF001', { specification: '' });
      ok(r.status === 400 && /specification is shown on every product card/.test(r.fields.specification), `refused, the field error names Specification (the panel jumps to Basics on the screen): "${r.fields && r.fields.specification}"`); }

    if (run('P14')) { await fresh(); T('P14', 'Phase 14 extras: "in steps of" and units of measure');
      const pr = require(path.join(__dirname, '..', '..', 'src', 'backend_routes', 'pricing.js'));
      const s = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { step_qty: '5', min_order_qty: '5', weight_kg: '0.3' });
      const bad = pr.qtyProblem({ sku_code: 'DF001-M100', packs_per_carton: 24, min_order_qty: 5, step_qty: 5, sell_unit: 'both' }, 12);
      const u = await api('SH', 'PUT', '/catalogue/skus/DF001-M100', { units: [{ unit_code: 'box', base_qty: '6' }], weight_kg: '0.3' });
      ok(s.status === 200 && bad !== null && u.status === 200 && u.data.sku.units[0].base_qty === 6, `steps of 5: 12 packs is refused ("${bad}"); 1 Box = ${u.data && u.data.sku.units[0].base_qty} packs on DF001-M100`); }

    if (run('SCAN')) { await fresh(); T('SCAN', 'Scan check in packing: a pack barcode, a supplier EAN and a carton code');
      await ready(['DF002-M100']);
      const eanP = ean('890123450099');
      await api('SH', 'POST', '/catalogue/skus/DF002-M100/barcodes', { barcode: eanP, kind: 'supplier' });
      await api('SH', 'POST', '/catalogue/skus/DF002-M100/barcodes', { barcode: 'CTN-DF002-24', kind: 'carton' });
      const no = await ctx.order(9, [{ sku_code: 'DF002-M100', qty: 48 }]);
      const pk = await api('SH', 'POST', '/fulfil/pick-lists', { order_nos: [no] });
      const res = [];
      for (const code of ['DF002-M100', eanP, 'CTN-DF002-24']) { const r = await api('SH', 'POST', `/commerce/packing/${no}/scan`, { code }); res.push(`${code}: ${r.status} ${r.data && (r.data.result || r.data.message)}`); }
      const line = ((await api('SH', 'GET', `/fulfil/packing/${no}`)).data.lines || []).find((l) => l.sku_code === 'DF002-M100');
      ok(no && pk.status < 300 && line && line.scanned === 1 + 1 + 24, `${no}: ${res.join('; ')}; DF002-M100 scanned ${line && line.scanned} (1 + 1 + a carton of 24)`); }
    void say;
  },
};
