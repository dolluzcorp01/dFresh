// Admin API calls (cookie session, see backend auth.js). Every call resolves to `data` or throws an Error with
// the server's message and .status, so screens can show it as-is.
import { API_BASE, apiFetch } from '../utils/api';

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
