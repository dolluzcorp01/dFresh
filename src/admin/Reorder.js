// Inventory > Reorder (phase 18, v23 viewReorder; API /inventory/reorder in inventory-routes.js). Packs and raw
// materials below their reorder level, per godown, counted on free stock plus what is coming (QC hold, open purchase
// orders, indents, planned and running runs). The suggestion is twice the level less free and coming, rounded up to
// whole cartons or the supplier's minimum. Made packs: Plan a run (Production runs, the plan filled in); bought items:
// Ask to buy (an indent in Purchase > Indents). Indents for all to buy / Runs for all to make do every row at once.
import { useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { LIcon, Loading, PageHead, Pill, Table, useAction, useLoad, useToast } from './ui';
import { ItemCell, addDays, today } from './buyShared';

export default function Reorder() {
  const data = useLoad('/inventory/reorder');
  const nav = useNavigate();
  const act = useAction();
  const toast = useToast();
  const d = data.data;
  const ask = (r) => act.run(async () => {
    const out = await api.send('POST', '/buying/indents', { godown_id: String(r.godown_id), need_by: addDays(today(), 7), reason: 'From the Reorder page', lines: [{ sku_code: r.sku_code, qty: String(r.suggest) }] });
    toast('good', `${out.indent_no} sent`, `${r.suggest} ${r.sku_code} asked for. It is in Purchase > Indents for approval.`);
    data.reload();
  });
  const allBuy = () => act.run(async () => { const out = await api.send('POST', '/buying/indents/reorder-check'); toast(out.made.length ? 'good' : 'info', out.made.length ? 'Indents made' : 'Nothing to buy', out.message); data.reload(); });
  const allMake = () => act.run(async () => { const out = await api.send('POST', '/production/runs/plan-low'); toast(out.tone, out.title, out.message); data.reload(); });
  const cols = [
    { key: 'item', label: 'Item', render: (r) => <ItemCell name={r.name} code={r.sku_code} image={r.image} /> },
    { key: 'godown', label: 'Godown' },
    { key: 'free', label: 'Free', num: true, render: (r) => <b className="a-bad">{r.free}</b> },
    { key: 'coming', label: 'Coming', num: true },
    { key: 'level', label: 'Reorder level', num: true },
    { key: 'suggest', label: 'Suggest', num: true, render: (r) => <><b>{r.suggest}</b>{r.cartons !== null && <small className="a-muted a-p15-sub">{r.cartons} carton{r.cartons === 1 ? '' : 's'}</small>}</> },
    { key: 'how', label: 'How', render: (r) => (r.how === 'make' ? <Pill tone="info">Make</Pill> : <Pill>Buy</Pill>) },
    { key: 'act', label: '', render: (r) => (r.how === 'buy' ? (d.can.buy ? <button type="button" className="a-btn a-btn-ghost a-btn-sm" disabled={act.busy} onClick={() => ask(r)}>Ask to buy</button> : null)
      : !r.recipe ? <small className="a-muted">No recipe</small>
        : d.can.make ? <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => nav(`/admin/production-runs?plan=${encodeURIComponent(r.sku_code)}&qty=${r.suggest}&godown=${r.godown_id}`)}>Plan a run</button> : null) },
  ];
  return (
    <section>
      <PageHead sub="What to buy or make before it runs out" rules={['Counted on free stock, per godown', 'What is coming counts: QC hold, open orders, runs, indents', "Rounded up to whole cartons or the supplier's minimum"]}
        actions={d && <>{d.can.buy && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={allBuy}><LIcon name="shopping-cart" size="sm" />Indents for all to buy</button>}
          {d.can.make && <button type="button" className="a-btn a-btn-ghost" disabled={act.busy} onClick={allMake}><LIcon name="factory" size="sm" />Runs for all to make</button>}</>} />
      {act.note}
      <Loading state={data}>
        {d && <div className="a-listcard"><Table columns={cols} rows={d.rows} rowKey={(r) => `${r.sku_code}-${r.godown_id}`} label="Reorder" empty={{ icon: 'check', title: 'Nothing is low', text: 'Everything is at or above its reorder level, counting what is coming.' }} /></div>}
      </Loading>
    </section>
  );
}
