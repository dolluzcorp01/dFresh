// Sales > Orders > Back-orders (phase 19, v23 viewBack; API /sales/back-orders in sales-routes.js). What confirmed orders
// still owe because stock was short (switch "Part shipments and back-orders"), oldest order first. New stock on Good is
// held for them by itself, oldest first, right after the action that brought it in; "Hold now" takes what is free now;
// "Drop" takes what is owed off the order (prices kept, any wallet kept for it freed). While an order is being packed,
// its balance waits until that shipment leaves.
import { api } from './adminApi';
import { Loading, PageHead, Pill, Table, useAction, useConfirm, useLoad, useToast } from './ui';
import { ItemCell } from './buyShared';

export default function BackOrders() {
  const data = useLoad('/sales/back-orders');
  const act = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const d = data.data;
  const hold = (r) => act.run(async () => {
    const out = await api.send('POST', '/sales/back-orders/hold', { order_no: r.order_no, sku_code: r.sku_code });
    toast('good', `${out.held} held for ${r.order_no}`, out.still_owed ? `${out.still_owed} still owed.` : 'Nothing more owed on this line. Packing sends it.'); data.reload();
  });
  const drop = async (r) => {
    if (!(await confirm({ title: `Drop ${r.back_qty} ${r.sku_code} from ${r.order_no}?`, message: 'The order will no longer owe them. Packs already held stay as they are; any wallet kept for them is freed.', action: 'Drop', danger: true }))) return;
    act.run(async () => {
      const out = await api.send('POST', '/sales/back-orders/drop', { order_no: r.order_no, sku_code: r.sku_code });
      toast('good', 'Dropped', `${out.dropped} ${r.sku_code} no longer owed on ${r.order_no}.${out.wallet_freed > 0 ? ` Rs ${out.wallet_freed} kept from the wallet is free again.` : ''}`); data.reload();
    });
  };
  const cols = [
    { key: 'item', label: 'Item', render: (r) => <ItemCell name={r.name} code={r.sku_code} image={r.image} sub={r.kit_key ? `kit ${r.kit_key}` : null} /> },
    { key: 'order', label: 'Order', render: (r) => <><a href={`/admin/commerce/orders?open=${encodeURIComponent(r.order_no)}`}><b className="a-mono">{r.order_no}</b></a><small className="a-muted a-p15-sub">{r.customer} · {r.godown} · {r.status_label}</small></> },
    { key: 'back_qty', label: 'Owed', num: true, render: (r) => <b>{r.back_qty}</b> },
    { key: 'free_now', label: 'Free now', num: true },
    { key: 'state', label: 'State', render: (r) => (r.state === 'after' ? <Pill>After this shipment leaves</Pill> : r.state === 'arrived' ? <Pill tone="good">Stock arrived</Pill> : <Pill tone="warn">Waiting for stock</Pill>) },
    { key: 'act', label: '', render: (r) => (d.can.edit && r.state !== 'after' ? <span className="a-p17-pills">{r.free_now > 0 && <button type="button" className="a-btn a-btn-sm" disabled={act.busy} onClick={() => hold(r)}>Hold now</button>}
      <button type="button" className="a-btn a-btn-ghost a-btn-sm" disabled={act.busy} onClick={() => drop(r)}>Drop</button></span> : null) },
  ];
  return (
    <section>
      <PageHead sub="What confirmed orders still owe, oldest first" rules={['Oldest order is offered first', 'A new order cannot take stock owed here', 'Held by itself when stock arrives']} />
      {act.note}
      <Loading state={data}>
        {d && <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(r) => r.line_id} label="Back-orders" empty={{ icon: 'check', title: 'No back-order', text: 'Every confirmed order has its packs.' }} /></div>}
      </Loading>
    </section>
  );
}
