// Masters > Prices > Quantity slabs (phase 15, v23 viewSlabs; API /prices/slabs in prices.js): a list's slabs (from
// how many packs, % off; each slab more packs and more off; the highest slab reached prices the whole line) and the
// packs that have their own quantity prices on that list (a row opens the list on that pack). The server checks the
// top slab for every pack without its own prices: below the lowest allowed price is refused; below cost plus the
// margin floor waits for approval and the old slabs stay until it is signed.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from './adminApi';
import { ViewOnly } from './Prices';
import { Alert, Field, LIcon, Loading, PageHead, useAction, useAdmin, useCan, useLoad, useToast } from './ui';

export default function QuantitySlabs() {
  const [key, setKey] = useState('default');
  const data = useLoad(`/prices/slabs/${encodeURIComponent(key)}`);
  const { me } = useAdmin();
  const canEdit = useCan('prices', 'edit');
  const act = useAction();
  const toast = useToast();
  const nav = useNavigate();
  const d = data.data;
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState({});
  useEffect(() => {
    if (!d) return;
    const r = d.slabs.map((s) => ({ min: String(s.min), pct: String(s.pct) }));
    while (r.length < 3) r.push({ min: '', pct: '' });
    setRows(r); setErr({});
  }, [d]);
  const filled = rows.filter((r) => r.min !== '' || r.pct !== '');
  const example = filled.length ? `Example with these slabs: ${filled.map((r) => `${r.min}+ packs: ${r.pct}% off`).join(', ')}.` : 'No slabs: every quantity pays the list price.';
  const save = () => act.run(async () => {
    setErr({});
    try {
      const out = await api.send('PUT', `/prices/slabs/${encodeURIComponent(key)}`, { slabs: filled });
      toast(out.waiting ? 'warn' : 'good', out.waiting ? 'Waiting for approval' : out.message === 'Nothing changed' ? 'Nothing changed' : 'Slabs saved', out.message);
      data.reload();
    } catch (e) { if (e.data && e.data.fields) setErr(e.data.fields); throw e; }
  });
  const set = (i, k, v) => setRows((x) => x.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <section>
      <PageHead sub="Lower price for bigger quantity" />
      {!canEdit && <ViewOnly me={me} />}
      <Loading state={data}>
        {d && (
          <>
            <div className="a-card a-p15-filters">
              <Field def={{ name: 'slab-list', label: 'Price list', type: 'select', allowEmpty: false, options: d.lists.map((l) => ({ value: l.key, label: l.name })) }} value={key} onChange={setKey} />
            </div>
            <p className="a-hint-s">Buy more, pay less per pack. The highest slab reached prices the whole line.</p>
            {d.waiting && <Alert tone="warn" title="A slab change waits for approval.">{d.waiting.summary}. The old slabs stay until it is signed.</Alert>}
            <div className="a-card a-p15-slabs">
              <h3 className="a-p14-fsec">Slabs for every pack in {d.list.name}</h3>
              {act.note}
              {rows.map((r, i) => (
                <div key={i} className={`a-field a-p14-kitrow${err[`slabs.${i}`] ? ' a-err' : ''}`}>
                  <span>Slab {i + 1}: from how many packs, and % off</span>
                  <div className="a-p14-kr">
                    <input type="number" min="2" step="1" value={r.min} disabled={!canEdit} placeholder="Packs" aria-label={`Slab ${i + 1} from packs`} onChange={(e) => set(i, 'min', e.target.value)} />
                    <input type="number" min="0" max="50" step="0.5" value={r.pct} disabled={!canEdit} placeholder="% off" aria-label={`Slab ${i + 1} percent off`} onChange={(e) => set(i, 'pct', e.target.value)} />
                  </div>
                  {err[`slabs.${i}`] && <small className="a-emsg" role="alert">{err[`slabs.${i}`]}</small>}
                </div>
              ))}
              <p className="a-hint-s">{example}</p>
              {canEdit && (
                <div className="a-p15-row">
                  <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => setRows((x) => [...x, { min: '', pct: '' }])}><LIcon name="plus" size="sm" />Add a slab</button>
                  <span className="a-sp" />
                  <button type="button" className="a-btn" disabled={act.busy} onClick={save}><LIcon name="check" size="sm" />Save slabs</button>
                </div>
              )}
            </div>
            <div className="a-card a-p15-slabs">
              <h3 className="a-p14-fsec">Packs with their own quantity prices</h3>
              {d.own.length ? (
                <ul className="a-p15-hist">
                  {d.own.map((o) => <li key={o.sku_code}><button type="button" className="a-link" onClick={() => nav(`/admin/prices?list=${encodeURIComponent(key)}`)}>{o.sku_code}</button> <span className="a-muted">{o.bands}</span></li>)}
                </ul>
              ) : <p className="a-hint-s">None. Open a pack in the price list to give it its own quantity prices.</p>}
            </div>
          </>
        )}
      </Loading>
    </section>
  );
}
