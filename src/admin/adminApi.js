// Admin API calls (cookie session, see backend auth.js). Every call resolves to `data` or throws an Error with
// the server's message and .status, so screens can show it as-is.
import { API_BASE, apiFetch } from '../utils/api';

const BASE = '/api/dfresh/admin';

// The header godown picker (phase 12a): when one godown is picked, every call says so (header X-Godown) and the API
// narrows its lists and figures to it; null = "All godowns" (all of the person's own). The API ignores a godown the
// person does not work at.
let godown = null;
export function setGodown(id) { godown = id ? Number(id) : null; }
const withGodown = (headers = {}) => (godown ? { ...headers, 'X-Godown': String(godown) } : headers);
const fetchAdmin = (path, options = {}) => apiFetch(`${BASE}${path}`, { ...options, headers: withGodown(options.headers) });

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
  get: (path) => fetchAdmin(path).then(handle),
  send: (method, path, body) => fetchAdmin(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(handle),
  /**
   * POST one file (field "file") + fields. XMLHttpRequest, not fetch: only it reports upload progress.
   * onProgress({ phase: 'uploading', pct }) while the bytes go up, then { phase: 'processing' } until the answer.
   * Errors as for every call (server message, .status); network / stopped / nginx's 413 page get a plain sentence.
   */
  upload: (path, file, fields = {}, { onProgress } = {}) => new Promise((resolve, reject) => {
    const fd = new FormData();
    Object.entries(fields).forEach(([k, v]) => fd.append(k, v));
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${API_BASE}${BASE}${path}`);
    xhr.withCredentials = true;
    if (godown) xhr.setRequestHeader('X-Godown', String(godown));
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress({ phase: 'uploading', pct: Math.min(99, Math.floor((e.loaded / e.total) * 100)) });
      };
      xhr.upload.onload = () => onProgress({ phase: 'processing', pct: 100 });
    }
    const fail = (message, status, json = null) => reject(Object.assign(new Error(message), { status, data: json }));
    xhr.onload = () => {
      let json = null;
      try { json = JSON.parse(xhr.responseText); } catch { /* not JSON, e.g. nginx's own error page */ }
      if (xhr.status >= 200 && xhr.status < 300 && json && json.success) { resolve(json.data); return; }
      const size = `${(file.size / 1024 / 1024).toFixed(1)} MB`;
      if (xhr.status === 413) { fail(`${(json && json.message) || 'The file is too large'} (${file.name}, ${size}).`, 413, json); return; }
      fail((json && json.message) || `Upload failed (HTTP ${xhr.status}).`, xhr.status, json);
    };
    xhr.onerror = () => fail('Network error: the upload did not reach the server. Check the connection and try again.', 0);
    xhr.onabort = () => fail('The upload was stopped.', 0);
    xhr.send(fd);
  }),
  /** Downloads a file response (CSV, XLSX, PDF) through the browser. body: sent as a JSON POST (e.g. Export and lock). */
  download: async (path, fallbackName, body) => {
    const res = await fetchAdmin(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
  /** Opens a file response (a photo) in a new tab, with the session cookie. false when pop-ups are blocked. */
  open: async (path) => {
    const w = window.open('', '_blank');
    if (!w) return false;
    const res = await fetchAdmin(path);
    if (!res.ok) { w.close(); await handle(res); }
    w.location.href = URL.createObjectURL(await res.blob());
    return true;
  },
};

/** URL-safe id for composite keys (matches admin-entities parseId: parts joined with "~"). */
export const rowId = (keys, row) => keys.map((k) => encodeURIComponent(row[k])).join('~');
