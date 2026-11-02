// The v23 list table: sticky head (the table box scrolls inside the window on desktop, so the head stays in view),
// sortable columns, a row click (or Enter on a row) opens its drawer, number columns right-aligned, an empty state.
// columns: [{ key, label, num, sort (true = by row[key], or a function row -> value), render: row -> node,
//             className (the cells), thClassName (the head cell), hideSm (hidden under 900 px) }]
// rows: the rows to show (already filtered by the page); rowKey: row -> key; onRowClick: row -> void;
// rowClass: row -> extra class; empty: { title, text, icon, actions } shown when there are no rows.
import { useMemo, useState } from 'react';
import LIcon from './LIcon';
import { Empty } from './blocks';

const valueOf = (col, row) => (typeof col.sort === 'function' ? col.sort(row) : row[col.key]);

function compare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1; // empty last, whatever the direction
  if (b === null || b === undefined || b === '') return -1;
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });
}

export default function Table({ columns, rows, rowKey, onRowClick, rowClass, empty, label, className = '', initialSort = null, foot }) {
  const [sort, setSort] = useState(initialSort); // { key, dir: 1 | -1 }
  const sorted = useMemo(() => {
    if (!sort) return rows || [];
    const col = columns.find((c) => c.key === sort.key);
    if (!col) return rows || [];
    return [...(rows || [])].sort((a, b) => {
      const va = valueOf(col, a);
      const vb = valueOf(col, b);
      const c = compare(va, vb);
      // empties stay last in both directions
      if (va === null || va === undefined || va === '' || vb === null || vb === undefined || vb === '') return c;
      return c * sort.dir;
    });
  }, [rows, columns, sort]);

  const toggle = (key) => setSort((s) => (s && s.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));
  // a column's className is for its cells; its head cell gets thClassName (plus the number / phone classes)
  const cls = (c, base, isHead) => [base, c.num && 'a-num', c.hideSm && 'a-hide-sm', !isHead && c.className].filter(Boolean).join(' ') || undefined;

  if (!rows || rows.length === 0) {
    return empty ? <div className="a-card a-card-flush"><Empty icon={empty.icon} title={empty.title} actions={empty.actions}>{empty.text}</Empty></div> : null;
  }
  return (
    <div className={`a-tw${className ? ` ${className}` : ''}`}>
      <table className={`a-table${onRowClick ? ' a-hover' : ''}`} aria-label={label}>
        <thead>
          <tr>
            {columns.map((c) => {
              const on = sort && sort.key === c.key;
              return (
                <th key={c.key} className={cls(c, c.thClassName, true)} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined} scope="col">
                  {c.sort ? (
                    <button type="button" className="a-sort" onClick={() => toggle(c.key)}>
                      {c.label}
                      <LIcon name={on ? 'chevron-down' : 'arrow-up-down'} size="sm" className={on && sort.dir === -1 ? 'a-rot' : undefined} />
                    </button>
                  ) : c.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : i} className={[onRowClick && 'a-rowlink', rowClass && rowClass(r)].filter(Boolean).join(' ') || undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? (e) => { if (!e.target.closest('a, button, input, select, label, textarea')) onRowClick(r); } : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onRowClick(r); } : undefined}>
              {columns.map((c) => <td key={c.key} className={cls(c)}>{c.render ? c.render(r) : r[c.key]}</td>)}
            </tr>
          ))}
        </tbody>
        {foot && <tfoot>{foot}</tfoot>}
      </table>
    </div>
  );
}
