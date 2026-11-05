// Production > Recipes (phase 17, v23 viewRecipes / DRAWERS.recipe; API /production/recipes in production-routes.js).
// One recipe per made pack: one batch makes n packs (whole cartons) from raw materials (the first is the reel, in kg);
// the wastage allowed on top; labour and power per pack. Dated versions: a change starts tomorrow at the earliest and
// waits for approval (rule "Change a recipe"); runs use the version in force on their day. The made cost per pack
// (materials at average cost with the wastage, labour, power) and "Use as standard cost" show only to See cost.
import { useState } from 'react';
import { api } from './adminApi';
import { Alert, Drawer, LIcon, Loading, PageHead, Pill, Table, useAction, useAdmin, useCan, useLoad, useToast } from './ui';
import { In, ItemCell, ViewOnlyB, addDays, bm, fe, fieldsOf, useOpenParam, useSkuImages } from './buyShared';
import { mediaUrl } from '../utils/api';

export default function Recipes() {
  const data = useLoad('/production/recipes');
  const { me } = useAdmin();
  const canEdit = useCan('production', 'edit');
  const [open, setOpen] = useState(null);
  const d = data.data;
  useOpenParam(Boolean(d), (id) => setOpen(id));
  const cols = [
    { key: 'pack', label: 'Pack', render: (s) => <ItemCell name={s.name} code={s.sku_code} /> },
    { key: 'out', label: 'One batch', render: (s) => (s.cur ? <>{s.cur.out} packs<small className="a-muted a-p15-sub">{s.cur.cartons} cartons</small></> : '-') },
    { key: 'uses', label: 'Uses', hideSm: true, render: (s) => (s.cur ? s.cur.uses : '-') },
    { key: 'waste', label: 'Waste', num: true, render: (s) => (s.cur ? `${s.cur.waste}%` : '-') },
    { key: 'made', label: 'Made cost', num: true, render: (s) => <><b>{s.cur ? bm(s.made_cost) : '-'}</b><small className="a-muted a-p15-sub">per pack</small></> },
    { key: 'std', label: 'Standard cost', num: true, hideSm: true, render: (s) => (s.std_cost === null && d && d.see_cost ? <span className="a-muted">not set</span> : bm(s.std_cost)) },
    { key: 'ver', label: 'Version', render: (s) => <span className="a-p17-pills">{s.cur && <Pill tone="good">v{s.cur.ver} from {s.cur.from}</Pill>}{s.next && <Pill tone="info">v{s.next.ver} from {s.next.from}</Pill>}{s.waiting && <Pill tone="warn">v{s.waiting.ver} waiting</Pill>}</span> },
  ];
  const ncols = [
    { key: 'pack', label: 'Pack', render: (s) => <ItemCell name={s.name} code={s.sku_code} /> },
    { key: 'source', label: 'Source', hideSm: true },
    { key: 'act', label: '', render: (s) => (canEdit ? <button type="button" className="a-btn a-btn-sm" onClick={(e) => { e.stopPropagation(); setOpen(s.sku_code); }}><LIcon name="plus" size="sm" />Add recipe</button> : null) },
  ];
  return (
    <section>
      <PageHead sub="What each made pack uses, and what it costs" rules={['One recipe per made pack', 'Dated versions; a change needs approval', 'Made cost from average costs, labour and power']} />
      {!canEdit && <ViewOnlyB me={me} what="recipes" />}
      <Loading state={data}>
        {d && (
          <>
            <div className="a-card a-p16-qcard">
              <div className="a-p15-cardhead"><h2 className="a-p16-h2">Made packs with a recipe</h2><Pill>{d.with.length}</Pill></div>
              <Table columns={cols} rows={d.with} rowKey={(s) => s.sku_code} label="Made packs with a recipe" onRowClick={(s) => setOpen(s.sku_code)} empty={{ icon: 'inbox', title: 'No recipe yet', text: 'Add the recipe of a made pack below.' }} />
            </div>
            <div className="a-card a-p16-qcard">
              <div className="a-p15-cardhead"><h2 className="a-p16-h2">Made packs with no recipe</h2><Pill tone={d.without.length ? 'warn' : 'gray'}>{d.without.length}</Pill><span className="a-p15-sp" /><small className="a-muted">A run cannot be planned until the pack has a recipe.</small></div>
              <Table columns={ncols} rows={d.without} rowKey={(s) => s.sku_code} label="Made packs with no recipe" onRowClick={canEdit ? (s) => setOpen(s.sku_code) : undefined} empty={{ icon: 'check', title: 'All set', text: 'Every made pack has a recipe.' }} />
            </div>
          </>
        )}
      </Loading>
      {open && <RecipeDrawer sku={open} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); data.reload(); }} onChanged={() => data.reload()} />}
    </section>
  );
}

function RecipeDrawer({ sku, onClose, onSaved, onChanged }) {
  const one = useLoad(`/production/recipes/${encodeURIComponent(sku)}`);
  const r = one.data;
  if (!r) return <Drawer title="Recipe" onClose={onClose}><Loading state={one}>{null}</Loading></Drawer>;
  return <RecipeForm r={r} onClose={onClose} onSaved={onSaved} onChanged={() => { one.reload(); onChanged(); }} />;
}

const r2 = (n) => Math.round(n * 100) / 100;
function RecipeForm({ r, onClose, onSaved, onChanged }) {
  const act = useAction();
  const toast = useToast();
  const imgs = useSkuImages();
  const base = r.cur || { out: r.per_carton * 10, waste: 3, labour: 0, power: 0, lines: [] };
  const start = { out_packs: String(base.out), from_date: r.cur ? addDays(r.today, 1) : r.today, waste_pct: String(base.waste), labour: String(base.labour), power: String(base.power),
    lines: base.lines.length ? base.lines.map((l) => ({ sku_code: l.sku_code, qty: String(l.qty) })) : [{ sku_code: '', qty: '' }] };
  const [f, setF] = useState(start);
  const [copy, setCopy] = useState('');
  const [err, setErr] = useState({});
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const setL = (i, k, v) => setF((x) => ({ ...x, lines: x.lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)) }));
  const ed = r.can.edit;
  const dirty = JSON.stringify(f) !== JSON.stringify(start);
  const save = () => act.run(async () => {
    setErr({});
    try { const out = await api.send('POST', `/production/recipes/${encodeURIComponent(r.sku_code)}`, f); toast(!out.changed ? 'info' : out.waiting ? 'warn' : 'good', out.title || 'Nothing changed', out.message); if (out.changed) onSaved(); }
    catch (e) { setErr(fieldsOf(e)); throw e; }
  });
  const useCost = () => act.run(async () => { const out = await api.send('POST', `/production/recipes/${encodeURIComponent(r.sku_code)}/use-cost`); toast(out.waiting ? 'warn' : 'good', out.title, out.message); onChanged(); });
  // the made cost as you type (See cost only: the average costs come with the recipe)
  let calc = null;
  if (r.avg) {
    const ls = f.lines.filter((l) => l.sku_code && Number(l.qty) > 0);
    const out = Number(f.out_packs);
    if (ls.length && out > 0) {
      let mat = 0; const miss = [];
      ls.forEach((l) => { const a = r.avg[l.sku_code]; if (a === null || a === undefined) miss.push(l.sku_code); else mat += Number(l.qty) * a; });
      mat = (mat / out) * (1 + (Number(f.waste_pct) || 0) / 100);
      calc = { mat: r2(mat), lab: Number(f.labour) || 0, pow: Number(f.power) || 0, miss };
      calc.unit = r2(calc.mat + calc.lab + calc.pow);
    }
  }
  const copyFrom = (code) => { setCopy(code); const x = r.copy_from.find((c) => c.sku_code === code); if (x) setF((y) => ({ ...y, lines: x.lines.map((l) => ({ sku_code: l.sku_code, qty: String(l.qty) })) })); };
  const money = (v) => `Rs ${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return (
    <Drawer title={`Recipe: ${r.name}`} pill={<Pill>{r.sku_code}</Pill>} onClose={onClose} dirty={ed && dirty} thumb={imgs[r.sku_code] ? mediaUrl(`/media/products/400/${imgs[r.sku_code]}`) : <LIcon name="clipboard-list" />}
      status={<>{r.cur ? <Pill tone="good">v{r.cur.ver} from {r.cur.from}</Pill> : <Pill tone="warn">No recipe yet</Pill>}{r.waiting && <Pill tone="warn">v{r.waiting.ver} waiting for approval</Pill>}<span className="a-p15-sp" /><small className="a-muted">{r.per_carton} packs per carton</small></>}
      footer={<><span className="a-p15-sp" /><button type="button" className="a-btn a-btn-ghost" onClick={onClose}>{ed ? 'Cancel' : 'Close'}</button>
        {ed && <button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />{r.cur ? `Save as v${r.next_ver}` : 'Save recipe'}</button>}</>}>
      {act.note}
      {r.waiting && <Alert tone="warn" title="A change is waiting.">v{r.waiting.ver} from {r.waiting.from}: {r.waiting.uses}. {r.waiting.wait_line} Until it is approved, v{r.cur ? r.cur.ver : '-'} is used.</Alert>}
      {r.cur && r.made && (
        <dl className="a-kv">
          <dt>Made cost per pack</dt><dd>{money(r.made.unit)} = materials {money(r.made.mat)} + labour {money(r.made.lab)} + power {money(r.made.pow)}{r.made.miss.length ? ` (no average cost yet for ${r.made.miss.join(', ')})` : ''}</dd>
          <dt>Standard cost in Products</dt><dd>{r.std_cost === null ? 'not set' : money(r.std_cost)}
            {r.can.use_cost && <> <button type="button" className="a-btn a-btn-sm a-btn-ghost" disabled={act.busy} onClick={useCost}>Use {money(r.made.unit)} as standard cost</button></>}</dd>
        </dl>
      )}
      {ed && (
        <>
          <h3 className="a-h3s">{r.cur ? `Change the recipe (new version v${r.next_ver})` : 'Add the recipe'}</h3>
          {r.change_waits && <p className="a-hint-s a-p16-mt0">A change waits for a second person (Approval rules). Runs already started keep their version.</p>}
          <div className="a-grid2">
            <In label="One batch makes (packs) *" type="number" min="1" step="1" value={f.out_packs} error={err.out_packs} hint={`${r2(Number(f.out_packs) / r.per_carton) || 0} cartons of ${r.per_carton}.`} onChange={(e) => set('out_packs')(e.target.value)} />
            <In label="Starts on *" type="date" min={r.cur ? addDays(r.today, 1) : r.today} value={f.from_date} error={err.from_date} hint={r.cur ? 'Tomorrow or later. Runs from that day use it.' : 'Today or later.'} onChange={(e) => set('from_date')(e.target.value)} />
            <In label="Copy materials from" hint="Fills the materials below from a similar pack."><select value={copy} onChange={(e) => copyFrom(e.target.value)}><option value="">-</option>{r.copy_from.map((c) => <option key={c.sku_code} value={c.sku_code}>{c.sku_code} · {c.name}</option>)}</select></In>
            <In label="Allowed wastage (%) *" type="number" min="0" max="30" step="0.5" value={f.waste_pct} error={err.waste_pct} hint="On top of the materials. More than this, by the Approval rules margin, waits for approval." onChange={(e) => set('waste_pct')(e.target.value)} />
            <In label="Labour per pack (Rs) *" type="number" min="0" step="0.01" value={f.labour} error={err.labour} onChange={(e) => set('labour')(e.target.value)} />
            <In label="Power per pack (Rs) *" type="number" min="0" step="0.01" value={f.power} error={err.power} onChange={(e) => set('power')(e.target.value)} />
          </div>
          {f.lines.map((l, i) => (
            <div key={i} className="a-p16-lrow a-p16-qrow">
              <In label={i === 0 ? 'Main material (the reel, kg)' : 'Material'} wide error={fe(err, `lines.${i}.sku_code`)}><select value={l.sku_code} onChange={(e) => setL(i, 'sku_code', e.target.value)}><option value="">Choose...</option>
                {r.raws.map((x) => <option key={x.sku_code} value={x.sku_code}>{x.sku_code} · {x.name} ({x.unit})</option>)}</select></In>
              <In label="Per batch" type="number" min="0" step="0.01" value={l.qty} error={fe(err, `lines.${i}.qty`)} onChange={(e) => setL(i, 'qty', e.target.value)} />
              <button type="button" className="a-iconbtn a-p16-del" aria-label="Remove this row" onClick={() => setF((x) => ({ ...x, lines: x.lines.length > 1 ? x.lines.filter((_, j) => j !== i) : [{ sku_code: '', qty: '' }] }))}><LIcon name="trash-2" size="sm" /></button>
            </div>
          ))}
          <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => setF((x) => ({ ...x, lines: [...x.lines, { sku_code: '', qty: '' }] }))}><LIcon name="plus" size="sm" />Add a material</button>
          {calc && <Alert tone="info" title={`Made cost ${money(calc.unit)} per pack.`}>Materials {money(calc.mat)} (average costs, with the wastage), labour {money(calc.lab)}, power {money(calc.pow)}.{calc.miss.length ? ` No average cost yet for ${calc.miss.join(', ')}.` : ''}</Alert>}
        </>
      )}
      {r.versions.length > 0 && (
        <>
          <h3 className="a-h3s">Versions</h3>
          <ul className="a-p17-vers">{r.versions.map((v) => <li key={v.ver}>v{v.ver} · from {v.from} · {v.out} packs: {v.uses} · waste {v.waste}% · {v.status} · {v.by}</li>)}</ul>
        </>
      )}
    </Drawer>
  );
}
