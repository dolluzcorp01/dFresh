// Product pickers with photos, used wherever the admin picks products:
// - ProductSelect: one product (kit / category "Photo from product", size picker, Settings door products, a colour
//   version's main product). A button showing the pick; it opens a search box over a list of photo + ID + name rows.
//   Keyboard: Enter / Space / Down opens, type to filter, Up / Down move, Enter picks, Esc closes (the drawer stays).
//   Optional `top` group (e.g. the kit's own products, "In this kit") above all the others.
// - KitProducts: a kit's product list: tick rows (colour versions under their main product, filter), then drag the
//   selected ones into the order the site shows.
// - RepPreview: the larger photo under a "Photo from product" picker, from the unsaved value.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { mediaUrl } from '../utils/api';

export const thumbUrl = (p) => (p && p.images && p.images[0] ? mediaUrl(`/media/products/400/${p.images[0].file_name}`) : null);

export const productName = (p) => {
  const name = p.tr?.en?.name ?? '';
  const colour = p.variant_of ? p.tr?.en?.colour_name : null; // most colour versions already carry it in the name
  return colour && !name.toLowerCase().includes(colour.toLowerCase()) ? `${name} (${colour})` : name;
};

export function Thumb({ p, size = 40 }) {
  return thumbUrl(p)
    ? <img className="a-thumb" src={thumbUrl(p)} alt="" width={size} height={size} style={{ width: size, height: size }} />
    : <span className="a-thumb a-thumb-none" style={{ width: size, height: size }} aria-hidden="true" />;
}

/** Main products in the given order, each followed by its colour versions (flag variant: true). */
function withVariants(list) {
  const ids = new Set(list.map((p) => p.product_id));
  const rows = [];
  for (const m of list.filter((p) => !p.variant_of || !ids.has(p.variant_of))) {
    rows.push({ p: m, variant: Boolean(m.variant_of) });
    for (const v of list.filter((x) => x.variant_of === m.product_id)) rows.push({ p: v, variant: true });
  }
  return rows;
}

const matches = (p, f) => !f || p.product_id.toLowerCase().includes(f) || productName(p).toLowerCase().includes(f);

export function ProductSelect({ id, products, value, onChange, disabled, allowEmpty = true, top = null, labelledBy }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [active, setActive] = useState(0);
  const boxRef = useRef(null);
  const searchRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const current = products.find((p) => p.product_id === value) || null;

  const f = filter.trim().toLowerCase();
  const options = useMemo(() => {
    const topIds = top && top.ids ? top.ids.filter((x) => products.some((p) => p.product_id === x)) : [];
    const head = topIds.map((x) => products.find((p) => p.product_id === x)).filter((p) => matches(p, f))
      .map((p) => ({ p, variant: false, group: top.label }));
    const rest = withVariants(products.filter((p) => !topIds.includes(p.product_id)))
      .filter((r) => matches(r.p, f)).map((r) => ({ ...r, group: topIds.length ? 'All other products' : null }));
    return [...(allowEmpty && !f ? [{ p: null, group: null }] : []), ...head, ...rest];
  }, [products, top, f, allowEmpty]);

  const close = (focusButton) => {
    setOpen(false);
    setFilter('');
    if (focusButton && buttonRef.current) buttonRef.current.focus();
  };
  const pick = (o) => {
    onChange(o.p ? o.p.product_id : null);
    close(true);
  };
  const show = () => {
    if (disabled) return;
    const at = options.findIndex((o) => (o.p ? o.p.product_id : null) === (value ?? null));
    setActive(at < 0 ? 0 : at);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return undefined;
    if (searchRef.current) searchRef.current.focus();
    const away = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) { setOpen(false); setFilter(''); }
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  useEffect(() => { setActive((a) => Math.min(a, Math.max(options.length - 1, 0))); }, [options.length]);
  useEffect(() => {
    const el = open && listRef.current && listRef.current.querySelector(`[data-i="${active}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); if (options[active]) pick(options[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close(false);
  };

  const label = (p) => (
    <>
      <Thumb p={p} size={32} />
      <code>{p.product_id}</code>
      <span className="a-ps-name">{productName(p)}{p.is_active ? '' : ' (not active)'}</span>
    </>
  );
  let lastGroup = null;
  return (
    <div className={`a-ps${open ? ' a-ps-open' : ''}`} ref={boxRef}>
      <button ref={buttonRef} id={id} type="button" className="a-ps-btn" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        aria-labelledby={labelledBy ? `${labelledBy} ${id}` : undefined}
        onClick={() => (open ? close(false) : show())}
        onKeyDown={(e) => { if (!open && ['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); show(); } }}>
        {current ? label(current) : <span className="a-ps-name a-muted">{value ? `${value} (not found)` : '- none -'}</span>}
        <span className="a-ps-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="a-ps-pop">
          <input ref={searchRef} type="search" placeholder="Type an ID or a name" aria-label="Filter products" value={filter}
            role="combobox" aria-expanded="true" aria-controls={`${uid}-list`} aria-autocomplete="list"
            aria-activedescendant={options[active] ? `${uid}-o${active}` : undefined}
            onChange={(e) => { setFilter(e.target.value); setActive(0); }} onKeyDown={onKey} />
          <ul ref={listRef} id={`${uid}-list`} role="listbox" aria-label="Products">
            {options.map((o, i) => {
              const head = o.group && o.group !== lastGroup ? <li key={`g-${o.group}`} role="presentation" className="a-ps-group">{o.group}</li> : null;
              lastGroup = o.group;
              const selected = (o.p ? o.p.product_id : null) === (value ?? null);
              return [head, (
                <li key={o.p ? o.p.product_id : '-'} id={`${uid}-o${i}`} data-i={i} role="option" aria-selected={selected}
                  className={`a-ps-opt${o.variant ? ' a-ps-var' : ''}${i === active ? ' a-ps-active' : ''}${o.p && !o.p.is_active ? ' a-off' : ''}`}
                  onPointerMove={() => setActive(i)} onClick={() => pick(o)}>
                  {o.p ? label(o.p) : <span className="a-ps-name a-muted">- none -</span>}
                </li>
              )];
            })}
            {!options.length && <li className="a-ps-none" role="presentation">No product matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

/** A labelled ProductSelect in the admin's field layout (label above, help below). */
export function ProductField({ name, label, help, products, value, onChange, disabled, allowEmpty, top, required }) {
  const id = `f-${name}`;
  return (
    <div className="a-field">
      <span id={`${id}-l`}>{label}{required && ' *'}</span>
      <ProductSelect id={id} labelledBy={`${id}-l`} products={products} value={value} onChange={onChange} disabled={disabled} allowEmpty={allowEmpty} top={top} />
      {help && <small className="a-muted">{help}</small>}
    </div>
  );
}

// "Photo from product": the picked product's main photo, from the unsaved value.
export function RepPreview({ product }) {
  if (!product) return <p className="a-muted a-rep">No product picked.</p>;
  return (
    <div className="a-rep">
      <Thumb p={product} size={72} />
      <span>{thumbUrl(product) ? 'Main photo of' : 'No photo yet for'} <code>{product.product_id}</code><br />{productName(product)}</span>
    </div>
  );
}

// A kit's products: tick rows (colour versions under their main product, filter), then drag the selected ones into
// order. value = product IDs in order (saved as kit_products.sort_order).
export function KitProducts({ all, value, onChange, disabled }) {
  const [filter, setFilter] = useState('');
  const [drag, setDrag] = useState(null);
  const byId = new Map(all.map((p) => [p.product_id, p]));
  const f = filter.trim().toLowerCase();
  const rows = withVariants(all);
  const shown = rows.filter((r) => matches(r.p, f) || (r.variant && r.p.variant_of && byId.has(r.p.variant_of) && matches(byId.get(r.p.variant_of), f))
    || (!r.variant && all.some((v) => v.variant_of === r.p.product_id && matches(v, f))));
  const toggle = (pid) => onChange(value.includes(pid) ? value.filter((x) => x !== pid) : [...value, pid]);
  const move = (from, to) => {
    if (from === null || to < 0 || to >= value.length || from === to) return;
    const next = [...value];
    next.splice(to, 0, next.splice(from, 1)[0]);
    onChange(next);
  };
  return (
    <div className="a-kitpick">
      <h3>Products (in order)</h3>
      <p className="a-muted a-kitpick-hint">
        Shown as chips on this kit&apos;s card in the For Business section, in this order, and pre-selected in the quote form
        when a visitor opens it from this kit.
      </p>
      <input type="search" placeholder="Filter by ID or name" aria-label="Filter products" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="a-pick-list" role="group" aria-label="Products to include">
        {shown.map(({ p, variant }) => (
          <label key={p.product_id} className={`a-pick${variant ? ' a-pick-var' : ''}${p.is_active ? '' : ' a-off'}`}>
            <input type="checkbox" checked={value.includes(p.product_id)} disabled={disabled} onChange={() => toggle(p.product_id)} />
            <Thumb p={p} size={40} />
            <code>{p.product_id}</code>
            <span className="a-pick-name">{productName(p)}{p.is_active ? '' : ' (not active)'}</span>
          </label>
        ))}
        {!shown.length && <p className="a-muted a-pick-none">No product matches.</p>}
      </div>
      <h4 className="a-chosen-h">Selected (in order)</h4>
      <p className="a-muted a-pick-note">{value.length ? `${value.length} selected.${disabled ? '' : ' Drag to change the order on the site.'}` : 'Nothing ticked yet.'}</p>
      <ol className="a-chosen">
        {value.map((pid, i) => {
          const p = byId.get(pid);
          return (
            <li key={pid} draggable={!disabled} className={drag === i ? 'a-dragging' : undefined}
              onDragStart={() => setDrag(i)} onDragOver={(e) => { if (drag !== null) e.preventDefault(); }}
              onDrop={(e) => { e.preventDefault(); move(drag, i); setDrag(null); }} onDragEnd={() => setDrag(null)}>
              {!disabled && <span className="a-handle" aria-hidden="true">⠿</span>}
              <span className="a-num">{i + 1}</span>
              {p ? <Thumb p={p} size={40} /> : <span className="a-thumb a-thumb-none" style={{ width: 40, height: 40 }} aria-hidden="true" />}
              <code>{pid}</code>
              <span className="a-chosen-name">{p ? productName(p) : '(unknown product)'}</span>
              {!disabled && (
                <span className="a-chosen-btns">
                  <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label={`Move ${pid} up`}>↑</button>
                  <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => move(i, i + 1)} disabled={i === value.length - 1} aria-label={`Move ${pid} down`}>↓</button>
                  <button type="button" className="a-btn a-btn-sm a-btn-ghost" onClick={() => toggle(pid)} aria-label={`Remove ${pid}`}>×</button>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
