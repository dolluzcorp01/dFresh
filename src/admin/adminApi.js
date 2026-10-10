// Admin API calls (cookie session, see backend auth.js). Every call resolves to `data` or throws an Error with
// the server's message and .status, so screens can show it as-is.
import { apiFetch } from '../utils/api';

const BASE = '/api/dfresh/admin';

async function handle(res) {
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.success) {
    const err = new Error((json && json.message) || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = json;
    throw err;
  }
  return json.data;
}

export const api = {
  get: (path) => apiFetch(`${BASE}${path}`).then(handle),
  send: (method, path, body) => apiFetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(handle),
  upload: (path, file, fields = {}) => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    fd.append('file', file);
    return apiFetch(`${BASE}${path}`, { method: 'POST', body: fd }).then(handle);
  },
  /** Downloads a file response (CSV, XLSX, PDF) through the browser. */
  download: async (path, fallbackName) => {
    const res = await apiFetch(`${BASE}${path}`);
    if (!res.ok) await handle(res);
    const name = (/filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || fallbackName;
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};

/** URL-safe id for composite keys (matches admin-entities parseId: parts joined with "~"). */
export const rowId = (keys, row) => keys.map((k) => encodeURIComponent(row[k])).join('~');
