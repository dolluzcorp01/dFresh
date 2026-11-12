// Shared steps for the returns, promotions and wallet scenarios (sections 12 to 14): a return on a delivered order
// (each pack split over the batches it was delivered from, as the screen lists them), scanning it in, and the reads
// of the promotions page and the wallets.
module.exports = (ctx) => {
  const { api, q1 } = ctx;
  const reasonId = async () => (await q1('SELECT reason_id FROM return_reasons WHERE is_active = 1 ORDER BY sort_order, reason_id LIMIT 1')).reason_id;
  const newReturn = async (no, want, extra = {}, as = 'SH') => {
    const src = (await api(as, 'GET', `/commerce/orders/${no}/returnable`)).data;
    const lines = [];
    for (const w of want) {
      let left = w.qty;
      for (const l of (src ? src.lines : []).filter((x) => x.sku_code === w.sku_code)) { if (left <= 0) break; const t = Math.min(left, l.qty); if (t > 0) { lines.push({ sku_code: w.sku_code, batch_id: l.batch_id, qty: t }); left -= t; } }
      if (left > 0) lines.push({ sku_code: w.sku_code, batch_id: null, qty: left });
    }
    return api(as, 'POST', `/commerce/orders/${no}/returns`, { reason_id: await reasonId(), collection: 'bring', lines, ...extra });
  };
  const ret = async (rno) => (await api('SH', 'GET', `/commerce/returns/${rno}`)).data;
  const receive = async (rno) => { const d = await ret(rno); for (const l of d.lines) for (let i = 0; i < l.qty; i += 1) await api('SH', 'POST', `/commerce/returns/${rno}/scan`, { code: l.batch_no ? `${l.sku_code}/${l.batch_no}` : l.sku_code }); };
  const promos = async (as = 'SH') => (await api(as, 'GET', '/commerce/promotions')).data;
  const wal = async (cid) => (await api('SH', 'GET', `/commerce/customers/${cid}/wallet`)).data;
  const wrow = async (cid, as = 'SH') => ((await api(as, 'GET', '/marketing/wallets')).data.rows || []).find((x) => x.customer_id === cid);
  return { reasonId, newReturn, ret, receive, promos, wal, wrow };
};
