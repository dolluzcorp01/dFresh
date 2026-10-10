// Audit log (spec F 12, admin): who changed what, with before / after.
import { useState } from 'react';
import { Loading, fmtDate, useLoad } from './ui';

const asObj = (v) => (typeof v === 'string' ? JSON.parse(v) : v);

/** Only the fields that differ between before and after (whole objects for create / delete). */
function changes(before, after) {
  const b = asObj(before) || {};
  const a = asObj(after) || {};
  if (!before || !after) return null;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys.filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k])).map((k) => [k, b[k], a[k]]);
}

const short = (v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s && s.length > 300 ? `${s.slice(0, 300)}...` : s;
};

export default function AuditLog() {
  const [f, setF] = useState({ entity: '', emp: '', page: 1 });
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v)).toString();
  const list = useLoad(`/audit?${q}&limit=50`);
  const d = list.data;
  return (
    <section>
      <h1>Audit log</h1>
      <div className="a-toolbar">
        <input placeholder="Entity (product, ui_text, lead...)" aria-label="Entity" value={f.entity} onChange={(e) => setF({ ...f, entity: e.target.value.trim(), page: 1 })} />
        <input placeholder="emp_id" aria-label="emp_id" value={f.emp} onChange={(e) => setF({ ...f, emp: e.target.value.trim(), page: 1 })} />
      </div>
      <Loading state={list}>
        {d && (
          <>
            <p className="a-muted">{d.total} entries</p>
            <div className="a-scroll">
              <table className="a-table">
                <thead><tr><th>When</th><th>Who</th><th>Action</th><th>What</th><th>Change</th></tr></thead>
                <tbody>
                  {d.rows.map((r) => {
                    const diff = changes(r.before_json, r.after_json);
                    return (
                      <tr key={r.audit_id}>
                        <td>{fmtDate(r.created_at)}</td>
                        <td><code>{r.emp_id}</code></td>
                        <td>{r.action}</td>
                        <td>{r.entity_type} <code>{r.entity_id || ''}</code></td>
                        <td className="a-diff">
                          {diff ? diff.map(([k, b, a]) => <div key={k}><strong>{k}</strong>: <del>{short(b)}</del> → <ins>{short(a)}</ins></div>)
                            : <code>{short(asObj(r.after_json) || asObj(r.before_json))}</code>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="a-pager">
              <button type="button" className="a-btn a-btn-ghost" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>Previous</button>
              <span>Page {f.page}</span>
              <button type="button" className="a-btn a-btn-ghost" disabled={f.page * 50 >= d.total} onClick={() => setF({ ...f, page: f.page + 1 })}>Next</button>
            </div>
          </>
        )}
      </Loading>
    </section>
  );
}
