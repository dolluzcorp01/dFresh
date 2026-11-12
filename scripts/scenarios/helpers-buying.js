// The v23 buying sample (addBuyState) rebuilt on our dev data, for the section 3 scenarios. The dev data already has the
// suppliers (Velan Converters, Kaveri Tissue Mills blocked, Sri Balaji Packaging, Greenleaf Hygiene), the raw materials
// and its own walk-through orders; this adds what v23's tests open, through the API where there is one:
// - supplier items and prices as v23 (Velan reel 72 / cores 6.50, Balaji film 185 / cartons 22, Greenleaf wet wipes 58 /
//   bamboo tissue 64, Kaveri reel 69); Velan MSME (Small); Greenleaf in Karnataka (29) as in v23; the packs v23 buys
//   (DF013-M50, DF028-M100, DF044-M100, DF048-BOX) set to Bought; wet wipes 24 months shelf life; raw reorder level 200
// - indents i4 (reel 1200, approved, made into p44), i5 (cores 3000, approved), i6 (cartons 2000, open)
// - POs p41 (Greenleaf, DF044-M100 240 at 58, freight 600), p42 (Balaji film 100 + cartons 1500), p43 (Velan reel 800 at
//   72 + cores 2000 at 6.50, freight 1400), p11 (Balaji, Chennai, cartons 500), p44 (Velan reel 1200 from i4, raised by
//   Pavithran, waiting for a second person)
// - goods in g16 (p41, 240 wipes, batch WW2610, in QC hold), g17 (p42, checked), g18 (p43, reel 800 of which 20 wet +
//   cores 1200, checked: claim open), and the bill of g17
// Everything older (the dev walk-through and the sample except p44) is dated a week back, as v23's sample is, so it does
// not count with today's orders. v23's numbers map to ours: 0041..0044 -> p41..p44, C/0011 -> p11, 0016..0018 -> g16..g18.
module.exports = (ctx) => {
  const { api, pool, q1, decideAny, say } = ctx;
  const ids = {};
  const must = (r, what) => { if (!r || r.status >= 300) say(`sample ${what}: ${r && r.status} ${JSON.stringify((r && (r.fields || r.msg)) || '')}`); return r && r.data; };
  async function sample() {
    const S = {};
    for (const s of await ctx.qa('SELECT supplier_id, name FROM suppliers')) S[s.name] = s.supplier_id;
    const VELAN = S['Velan Converters']; const BALAJI = S['Sri Balaji Packaging']; const GREEN = S['Greenleaf Hygiene']; const KAVERI = S['Kaveri Tissue Mills'];
    const item = (sid, sku, their, price, lead, moq, gsm = null) => pool.query(`INSERT INTO supplier_items (supplier_id, sku_code, their_code, price, lead_days, moq, spec_gsm, spec_ply, spec_width) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE their_code = VALUES(their_code), price = VALUES(price), lead_days = VALUES(lead_days), moq = VALUES(moq), spec_gsm = VALUES(spec_gsm), spec_ply = VALUES(spec_ply), spec_width = VALUES(spec_width)`,
    [sid, sku, their, price, lead, moq, gsm, gsm ? 2 : null, gsm ? 2600 : null]);
    await item(VELAN, 'RM-PR2', 'JR-2P-17', 72, 7, 500, 17); await item(VELAN, 'RM-CORE', 'CR-3IN', 6.5, 5, 1000);
    await item(BALAJI, 'RM-FILM', 'LDPE-40', 185, 3, 50); await item(BALAJI, 'RM-CTN', '5PLY-STD', 22, 4, 500);
    await item(GREEN, 'DF044-M100', 'GL-WW-100', 58, 10, 240); await item(GREEN, 'DF048-BOX', 'GL-BMB-BX', 64, 10, 96);
    await item(KAVERI, 'RM-PR2', 'KTM-2P', 69, 6, 1000, 17);
    await pool.query("UPDATE suppliers SET msme_type = 'Small', udyam = COALESCE(udyam, 'UDYAM-TN-03-0045121') WHERE supplier_id = ?", [VELAN]);
    await pool.query("UPDATE suppliers SET state_code = '29', gstin = '29AAGCG5521Q1Z1' WHERE supplier_id = ?", [GREEN]);
    await pool.query("UPDATE skus SET source = 'bought', weight_kg = COALESCE(weight_kg, 0.5) WHERE sku_code IN ('DF013-M50', 'DF028-M100', 'DF044-M100', 'DF048-BOX')");
    await pool.query("UPDATE products p JOIN skus s ON s.product_id = p.product_id SET p.shelf_life_months = 24, p.track_batches = 1 WHERE s.sku_code = 'DF044-M100'");
    for (const c of ['RM-PR2', 'RM-CORE', 'RM-FILM', 'RM-CTN']) await pool.query('INSERT INTO stock_levels (sku_code, location_id, reorder_level, reorder_qty) VALUES (?, 1, 200, 0) ON DUPLICATE KEY UPDATE reorder_level = 200', [c]);
    // the dev walk-through is a week old, as v23's sample history is
    await pool.query("UPDATE approvals SET requested_at = requested_at - INTERVAL 7 DAY WHERE kind IN ('po', 'supplier_pay')");
    await pool.query('UPDATE purchase_orders SET po_date = po_date - INTERVAL 7 DAY WHERE po_no IS NOT NULL');
    // indents
    const ind = async (who, lines, why) => must(await api(who, 'POST', '/buying/indents', { godown_id: 1, need_by: ctx.today(), reason: why, lines }), 'indent').indent_id;
    ids.i4 = await ind('KU', [{ sku_code: 'RM-PR2', qty: 1200 }], 'Reel stock for November napkin runs');
    ids.i5 = await ind('KU', [{ sku_code: 'RM-CORE', qty: 3000 }], 'Cores running low');
    ids.i6 = await ind('MU', [{ sku_code: 'RM-CTN', qty: 2000 }], 'Cartons for the Deepavali dispatch');
    await api('PV', 'POST', `/buying/indents/${ids.i4}/approve`, {}); await api('PV', 'POST', `/buying/indents/${ids.i5}/approve`, {});
    // purchase orders
    const po = async (who, body) => {
      const d = must(await api(who, 'POST', '/buying/pos', { action: 'raise', godown_id: 1, expected_on: ctx.today(), ...body }), 'PO');
      if (d && d.waiting) { const a = await q1("SELECT approval_id FROM approvals WHERE status = 'pending' AND kind = 'po' AND ref_id = ?", [d.po_no]); if (a) await decideAny(a.approval_id); }
      return d;
    };
    ids.p41 = await po('PV', { supplier_id: GREEN, freight: 600, terms: 'Batch and expiry printed on every carton.', lines: [{ sku_code: 'DF044-M100', qty: 240, rate: 58 }] });
    ids.p42 = await po('SH', { supplier_id: BALAJI, lines: [{ sku_code: 'RM-FILM', qty: 100, rate: 185 }, { sku_code: 'RM-CTN', qty: 1500, rate: 22 }] });
    ids.p43 = await po('SH', { supplier_id: VELAN, freight: 1400, terms: 'Delivered to our Kanchipuram godown.', lines: [{ sku_code: 'RM-PR2', qty: 800, rate: 72 }, { sku_code: 'RM-CORE', qty: 2000, rate: 6.5 }] });
    ids.p11 = await po('PV', { supplier_id: BALAJI, godown_id: 2, lines: [{ sku_code: 'RM-CTN', qty: 500, rate: 22 }] });
    // goods in
    const gi = async (body) => must(await api('MU', 'POST', '/buying/goods-in', body), 'goods in');
    ids.g16 = await gi({ po_id: ids.p41.po_id, challan_no: 'GL/INV/5521', vehicle_no: 'KA 51 AB 7720', lines: [{ sku_code: 'DF044-M100', recv: 240, cartons: 20, batch_no: 'WW2610', mfg_date: '2026-10-01' }] });
    ids.g17 = await gi({ po_id: ids.p42.po_id, challan_no: 'SBP/774', vehicle_no: 'TN 05 BQ 1180', lines: [{ sku_code: 'RM-FILM', recv: 100, batch_no: 'F2510' }, { sku_code: 'RM-CTN', recv: 1500, batch_no: 'C2510' }] });
    must(await api('KU', 'POST', `/buying/goods-in/${ids.g17.grn_id}/qc`, { lines: [{ acc: 100, rej: 0 }, { acc: 1500, rej: 0 }] }), 'QC g17');
    ids.g18 = await gi({ po_id: ids.p43.po_id, challan_no: 'VC/DC/3410', vehicle_no: 'TN 21 AX 4402', lines: [{ sku_code: 'RM-PR2', recv: 800, reels: 4, batch_no: 'VR1027' }, { sku_code: 'RM-CORE', recv: 1200, batch_no: 'VC1027' }] });
    const q18 = must(await api('KU', 'POST', `/buying/goods-in/${ids.g18.grn_id}/qc`, { lines: [{ acc: 780, rej: 20, reason: 'Wet or damp', gsm: 17.2 }, { acc: 1200, rej: 0 }], note: 'One reel wet on the outer 20 kg.' }), 'QC g18');
    ids.cl1 = q18 && q18.claim ? q18.claim.claim_id : (await q1("SELECT claim_id FROM claims ORDER BY claim_id DESC LIMIT 1")).claim_id;
    ids.b17 = must(await api('PV', 'POST', '/buying/bills', { supplier_id: BALAJI, supplier_bill_no: 'SBP/774', bill_date: ctx.today(), total: 60770,
      lines: [{ grn_id: ids.g17.grn_id, sku_code: 'RM-FILM', qty: 100, rate: 185 }, { grn_id: ids.g17.grn_id, sku_code: 'RM-CTN', qty: 1500, rate: 22 }] }), 'bill SBP/774');
    // p44: raised by Pavithran from indent i4, 1,200 kg of reel: waits for a second person
    const pre = (await api('PV', 'GET', `/buying/indents/${ids.i4}/po-draft`)).data;
    ids.p44 = must(await api('PV', 'POST', '/buying/pos', { action: 'raise', godown_id: 1, expected_on: ctx.today(), supplier_id: VELAN, indent_id: ids.i4, terms: 'Delivered to our Kanchipuram godown. Reels wrapped, GSM 17 +/- 1.', lines: pre.lines }), 'PO p44');
    // the sample happened before today (v23's dates): it does not count with today's orders and payments
    // p44's request too (in v23 it was raised before the tests' day): 3 days back, out of the 3-day window yet not expired
    await pool.query("UPDATE approvals SET requested_at = requested_at - INTERVAL 7 DAY WHERE kind IN ('po', 'supplier_pay') AND NOT (kind = 'po' AND ref_id = ?)", [ids.p44.po_no]);
    await pool.query("UPDATE approvals SET requested_at = requested_at - INTERVAL 3 DAY WHERE kind = 'po' AND ref_id = ?", [ids.p44.po_no]);
    await pool.query('UPDATE purchase_orders SET po_date = po_date - INTERVAL 3 DAY WHERE po_id = ?', [ids.p44.po_id]);
    await pool.query("UPDATE approval_directs SET done_at = done_at - INTERVAL 7 DAY WHERE kind IN ('po', 'supplier_pay')").catch(() => {});
    await pool.query('UPDATE purchase_orders SET po_date = po_date - INTERVAL 7 DAY WHERE po_no IS NOT NULL AND po_id IN (?)', [[ids.p41.po_id, ids.p42.po_id, ids.p43.po_id, ids.p11.po_id]]);
    await pool.query("UPDATE goods_ins SET qc_at = qc_at - INTERVAL 7 DAY, received_on = received_on - INTERVAL 7 DAY WHERE status = 'done' AND grn_id IN (?)", [[ids.g17.grn_id, ids.g18.grn_id]]);
    return { S, VELAN, BALAJI, GREEN, KAVERI, ids };
  }
  const avg = async (sku) => Math.round(Number((await q1('SELECT avg_cost FROM skus WHERE sku_code = ?', [sku])).avg_cost) * 100) / 100;
  const stockOf = async (sku, kind = 'good') => Number((await q1('SELECT COALESCE(SUM(delta), 0) n FROM stock_movements WHERE sku_code = ? AND stock_kind = ?', [sku, kind])).n);
  return { sample, avg, stockOf };
};
