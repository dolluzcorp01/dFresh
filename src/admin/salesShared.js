// Sales screens (phase 19, v23 sections 6 and 7): the parts the quote, order and standing order screens share. The line
// editor (a pack or a kit per row with its photo, quantity, price, free with its reason; the hint under each row comes
// from the server's preview: list price, kept or priced again, % below the list, free at the godown, cartons), the
// totals box, the "who is it for" picker and the options (/sales/options).
import { api } from './adminApi';
import { Alert, LIcon, Pill, money, useLoad } from './ui';
import { In, ItemPic } from './buyShared';

export function useSalesOptions() { return useLoad('/sales/options'); }
export const blankLine = () => ({ key: Math.random().toString(36).slice(2), item: '', qty: '', price: '', auto: true, is_free: false, free_why: '', kept: false });
/** form rows -> the items the API takes */
export const itemsOf = (rows) => rows.filter((r) => r.item).map((r) => (r.item.startsWith('KIT:') ? { kit_key: r.item.slice(4), qty: r.qty, price: r.auto ? '' : r.price }
  : { sku_code: r.item, qty: r.qty, price: r.is_free ? '' : r.auto ? '' : r.price, is_free: r.is_free, free_why: r.free_why, kept: r.kept }));
/** a document's lines -> form rows (kits as one row) */
export function rowsOf(lines, { keep = false } = {}) {
  const out = []; const kits = new Set();
  for (const l of lines || []) {
    if (l.kit_key) {
      if (kits.has(l.kit_key)) continue; kits.add(l.kit_key);
      out.push({ ...blankLine(), item: `KIT:${l.kit_key}`, qty: String(l.kit_qty || 1), price: l.kit_price !== undefined && l.kit_price !== null ? String(l.kit_price) : '', auto: l.kit_price === undefined || l.kit_price === null });
      continue;
    }
    out.push({ ...blankLine(), item: l.sku_code, qty: String(l.qty), price: l.is_free ? '' : String(Number(l.price)), auto: !keep && Math.abs(Number(l.price) - Number(l.list_price)) < 0.005, is_free: Boolean(l.is_free), free_why: l.free_why || '', kept: keep && !l.is_free });
  }
  return out.length ? out : [blankLine()];
}

/** the rows of a document: pack or kit, quantity, price (none for a standing order), free with why */
export function LinesEditor({ o, rows, setRows, preview, errors = {}, noPrice = false, godownName = '' }) {
  const set = (i, patch) => setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)));
  const pv = (preview && preview.lines) || [];
  const byItem = (r) => (r.item.startsWith('KIT:') ? pv.filter((l) => l.kit_key === r.item.slice(4)) : pv.filter((l) => l.sku_code === r.item && !l.kit_key && Boolean(l.is_free) === Boolean(r.is_free)));
  const pack = (code) => o.packs.find((p) => p.sku_code === code);
  return (
    <div className="a-p19-lines">
      {rows.map((r, i) => {
        const hit = byItem(r);
        const kit = r.item.startsWith('KIT:') ? o.kits.find((k) => k.kit_key === r.item.slice(4)) : null;
        const p = !kit && r.item ? pack(r.item) : null;
        const l = hit[0];
        const free = preview && preview.free_now && p ? preview.free_now[p.sku_code] : null;
        const back = preview && preview.backs ? preview.backs.find((b) => b.sku_code === r.item) : null;
        const hint = [];
        if (l && !kit && !r.is_free) {
          hint.push(`List ${money(l.list_price)}${l.kept === 'kept' ? ' (kept from when it was made)' : l.kept === 'repriced' ? ' (priced again from today\'s list: the quote has expired)' : ''}${l.gst_rate !== undefined ? ` · GST ${Number(l.gst_rate)}%` : ''}`);
          const pr = Number(l.entered !== undefined ? l.entered : l.price);
          if (l.list_price && pr < l.list_price - 0.004) hint.push(<b key="b" className="a-bad">{Math.round(((l.list_price - pr) / l.list_price) * 1000) / 10}% below the list</b>);
        }
        if (kit && hit.length) hint.push(`Kit of ${hit.length} packs: ${hit.map((x) => `${x.sku_code} ${x.qty}`).join(', ')}`);
        if (free !== null && free !== undefined && !noPrice) hint.push(back ? <b key="f" className="a-bad">{free} free{godownName ? ` at ${godownName}` : ''} · {back.back} would go on back-order</b> : `${free} free${godownName ? ` at ${godownName}` : ''}`);
        if (p && p.packs_per_carton > 1 && Number(r.qty) >= p.packs_per_carton) hint.push(`${Math.floor(Number(r.qty) / p.packs_per_carton)} carton${Math.floor(Number(r.qty) / p.packs_per_carton) === 1 ? '' : 's'}${Number(r.qty) % p.packs_per_carton ? ` + ${Number(r.qty) % p.packs_per_carton} loose` : ''}`);
        if (p && p.status === 'discontinued') hint.push(<Pill key="d" tone="warn">Discontinued: sold from stock only</Pill>);
        const e = (k) => errors[`items.${i}.${k}`];
        return (
          <div key={r.key} className="a-p19-line">
            <span className="a-p19-pic">{kit ? <span className="a-p16-ic"><LIcon name="package-open" /></span> : <ItemPic code={r.item} image={p ? p.image : null} />}</span>
            <In label={kit ? 'Kit' : 'Item'} error={e('sku_code')} box="a-p19-item">
              <select value={r.item} onChange={(ev) => set(i, { item: ev.target.value, auto: true, kept: false, price: '' })}><option value="">Choose...</option>
                <optgroup label="Packs">{o.packs.map((x) => <option key={x.sku_code} value={x.sku_code}>{x.sku_code} · {x.name}{x.size_label ? ` ${x.size_label}` : ''}</option>)}</optgroup>
                {o.kits.length > 0 && <optgroup label="Kits (one line, stock from their parts)">{o.kits.map((k) => <option key={k.kit_key} value={`KIT:${k.kit_key}`}>{k.kit_code} · {k.name} kit</option>)}</optgroup>}
              </select>
            </In>
            <In label={kit ? 'Kits' : 'Packs'} type="number" min="1" step="1" value={r.qty} error={e('qty')} onChange={(ev) => set(i, { qty: ev.target.value, kept: false })} box="a-p19-qty" />
            {!noPrice && <In label={kit ? 'Price per kit (Rs, no GST)' : 'Price (Rs, no GST)'} type="number" min="0" step="0.01" error={e('price')} box="a-p19-price"
              value={r.is_free ? '' : r.auto && kit && preview && preview.kits ? String((preview.kits.find((k) => k.kit_key === kit.kit_key) || {}).price ?? '') : r.auto && l ? String(l.entered ?? l.price) : r.price}
              disabled={r.is_free} onChange={(ev) => set(i, { price: ev.target.value, auto: ev.target.value === '', kept: false })} />}
            {!noPrice && !kit && <label className="a-check a-p19-free"><input type="checkbox" checked={r.is_free} onChange={(ev) => set(i, { is_free: ev.target.checked })} /> Free</label>}
            {!noPrice && <span className="a-p19-amt">{r.is_free ? 'Free' : hit.length ? money(hit.reduce((a, x) => a + Number(x.price) * x.qty, 0)) : '-'}</span>}
            <button type="button" className="a-iconbtn" aria-label="Remove this row" onClick={() => setRows(rows.length > 1 ? rows.filter((_, n) => n !== i) : [blankLine()])}><LIcon name="trash-2" size="sm" /></button>
            {r.is_free && <In label="Why free" value={r.free_why} error={e('free_why')} placeholder="e.g. Trial pack with the first order" onChange={(ev) => set(i, { free_why: ev.target.value })} box="a-p19-why" />}
            {hint.length > 0 && <p className="a-p19-hint">{hint.map((h, n) => <span key={n}>{n ? ' · ' : ''}{h}</span>)}</p>}
          </div>
        );
      })}
      <button type="button" className="a-btn a-btn-ghost a-btn-sm" onClick={() => setRows([...rows, blankLine()])}><LIcon name="plus" size="sm" />Add an item</button>
    </div>
  );
}

/** value without GST, GST, delivery, round off, total */
export function TotalsBox({ t }) {
  if (!t) return null;
  const rows = [['Value without GST', t.taxable - (t.delivery_charge || 0)], t.delivery_charge ? ['Delivery charge', t.delivery_charge] : null,
    ...(t.igst ? [['IGST', t.igst]] : [['CGST', t.cgst], ['SGST', t.sgst]]), t.round_off ? ['Round off', t.round_off] : null].filter(Boolean);
  return (
    <dl className="a-p19-tot">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{money(v)}</dd></div>)}<div className="a-p19-grand"><dt>Total</dt><dd>{money(t.total)}</dd></div></dl>
  );
}

/** the approvals a document will need, as the save will raise them; or "no approval needed" */
export function NeedsBox({ needs, priceNote, okText, waitText }) {
  return (
    <>
      {priceNote && <Alert tone="info" title="Prices are also checked against cost when you save.">It may then wait for a price check.</Alert>}
      {needs && needs.length ? <Alert tone="warn" title={waitText}>{needs.map((n) => `${n.label}: ${n.what}.`).join(' ')}</Alert>
        : <Alert tone="good" title={priceNote ? 'No other approval needed.' : 'No approval needed.'}>{okText}</Alert>}
    </>
  );
}

/** a customer or an enquiry: "C:<id>" / "L:<id>" */
export function WhoSelect({ o, value, onChange, leads = true, disabled = false, error }) {
  return (
    <In label="For *" error={error} hint={leads ? 'A quote can go to an enquiry before it is a customer.' : 'Blocked customers cannot be chosen.'}>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}><option value="">Choose...</option>
        <optgroup label="Customers">{o.customers.map((c) => <option key={c.customer_id} value={`C:${c.customer_id}`} disabled={c.status === 'blocked'}>{c.customer_no} · {c.name}{c.status === 'hold' ? ' (on hold)' : c.status === 'blocked' ? ' (blocked)' : ''}</option>)}</optgroup>
        {leads && <optgroup label="Enquiries, not yet customers">{o.leads.map((l) => <option key={l.lead_id} value={`L:${l.lead_id}`}>{l.lead_ref} · {l.name}</option>)}</optgroup>}
      </select>
    </In>
  );
}
export const whoBody = (w) => (w.startsWith('C:') ? { customer_id: w.slice(2) } : w.startsWith('L:') ? { lead_id: w.slice(2) } : {});

/** preview a document as it is typed (debounced by the caller) */
export const previewOf = (path, body) => api.send('POST', path, body);
