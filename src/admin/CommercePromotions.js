// dFresh Commerce (DEMO, database dfresh_commerce): promotions. Coupons (percent or fixed, minimum order, expiry,
// usage limit, on / off; applied in Orders > New order) and the cashback rule (pct % of a delivered order to the
// customer's wallet, usable on the next order).
import { useEffect, useState } from 'react';
import { api } from './adminApi';
import { InfoCard, Loading, useAction, useCan, useLoad } from './ui';
import { rs } from './CommerceReturns';

const EMPTY = { code: '', kind: 'percent', value: '', min_order: '0', expires_on: '', usage_limit: '', is_active: true };

export default function CommercePromotions() {
  const data = useLoad('/commerce/promotions');
  const canEdit = useCan('promotions', 'edit');
  const canCreate = useCan('promotions', 'create');
  const act = useAction();
  const [form, setForm] = useState(EMPTY);
  const [cb, setCb] = useState(null);
  const d = data.data;
  useEffect(() => { if (d) setCb({ pct: String(Number(d.cashback.pct)), min_order: String(Number(d.cashback.min_order)), is_active: Number(d.cashback.is_active) === 1 }); }, [d]);

  const add = (e) => {
    e.preventDefault();
    act.run(async () => { await api.send('POST', '/commerce/coupons', form); setForm(EMPTY); data.reload(); }, `Coupon ${form.code.toUpperCase()} added`);
  };
  const toggle = (c) => act.run(async () => {
    await api.send('PUT', `/commerce/coupons/${c.code}`, { ...c, is_active: !Number(c.is_active) });
    data.reload();
  }, `${c.code} switched ${Number(c.is_active) ? 'off' : 'on'}`);
  const saveCb = () => act.run(async () => { await api.send('PUT', '/commerce/cashback', cb); data.reload(); }, 'Cashback rule saved');
  const cbDirty = d && cb && (Number(cb.pct) !== Number(d.cashback.pct) || Number(cb.min_order) !== Number(d.cashback.min_order) || cb.is_active !== (Number(d.cashback.is_active) === 1));

  return (
    <section>
      <h1>Promotions</h1>
      <InfoCard title="Commerce demo - coupons and cashback">
        <ul>
          <li>Coupons are applied in Orders &gt; New order: the server checks on / off, expiry, minimum order and usage limit.</li>
          <li>Cashback: when an order is marked Delivered, a share of it (after the coupon, before GST) goes to the customer&apos;s wallet.</li>
          <li>Wallet credit can be used on the next order (New order &gt; Use wallet).</li>
        </ul>
      </InfoCard>
      {act.note}
      <Loading state={data}>
        {d && cb && (
          <>
            <div className="a-card">
              <h2>Cashback</h2>
              <div className="a-toolbar">
                <label className="a-inline">Cashback %<input type="number" min="0" max="50" step="0.5" className="a-qty" value={cb.pct} disabled={!canEdit} onChange={(e) => setCb({ ...cb, pct: e.target.value })} /></label>
                <label className="a-inline">Minimum order Rs<input type="number" min="0" step="100" className="a-price" value={cb.min_order} disabled={!canEdit} onChange={(e) => setCb({ ...cb, min_order: e.target.value })} /></label>
                <label className="a-inline"><input type="checkbox" checked={cb.is_active} disabled={!canEdit} onChange={(e) => setCb({ ...cb, is_active: e.target.checked })} /> On</label>
                {canEdit && <button type="button" className="a-btn" disabled={act.busy || !cbDirty} onClick={saveCb}>Save</button>}
              </div>
              <p className="a-muted">Given so far: <b>{rs(d.cashbackGiven.total)}</b> on {d.cashbackGiven.n} delivered order(s).</p>
            </div>
            <h2>Coupons</h2>
            <div className="a-scroll">
              <table className="a-table">
                <thead><tr><th>Code</th><th>Discount</th><th className="a-num">Min order</th><th>Expires</th><th className="a-num">Used</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {d.coupons.map((c) => (
                    <tr key={c.code}>
                      <td><code>{c.code}</code></td>
                      <td>{c.kind === 'percent' ? `${Number(c.value)} %` : rs(c.value)}</td>
                      <td className="a-num">{rs(c.min_order)}</td>
                      <td>{c.expires_on || 'never'}{c.expired ? <span className="a-status a-status-bad"> expired</span> : null}</td>
                      <td className="a-num">{c.used}{c.usage_limit ? ` of ${c.usage_limit}` : ''}</td>
                      <td><span className={`a-status ${Number(c.is_active) && !c.expired ? 'a-status-on' : 'a-status-off'}`}>{Number(c.is_active) ? 'On' : 'Off'}</span></td>
                      <td>{canEdit && <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={() => toggle(c)}>Switch {Number(c.is_active) ? 'off' : 'on'}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {canCreate && (
              <form className="a-card a-moveform" onSubmit={add}>
                <h2>Add a coupon</h2>
                <div className="a-toolbar">
                  <label className="a-inline">Code<input required value={form.code} maxLength={20} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="e.g. DIWALI15" /></label>
                  <label className="a-inline">Type<select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="percent">Percent</option><option value="fixed">Fixed Rs</option></select></label>
                  <label className="a-inline">{form.kind === 'percent' ? '%' : 'Rs'}<input required type="number" min="1" step="1" className="a-qty" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></label>
                  <label className="a-inline">Min order Rs<input type="number" min="0" step="100" className="a-price" value={form.min_order} onChange={(e) => setForm({ ...form, min_order: e.target.value })} /></label>
                  <label className="a-inline">Expires<input type="date" value={form.expires_on} onChange={(e) => setForm({ ...form, expires_on: e.target.value })} /></label>
                  <label className="a-inline">Usage limit<input type="number" min="1" step="1" className="a-qty" value={form.usage_limit} onChange={(e) => setForm({ ...form, usage_limit: e.target.value })} placeholder="none" /></label>
                  <button type="submit" className="a-btn" disabled={act.busy}>Add coupon</button>
                </div>
              </form>
            )}
          </>
        )}
      </Loading>
    </section>
  );
}
