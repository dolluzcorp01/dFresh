// All browser calls to the API go through apiFetch (Inside D pattern): one base URL, cookies always sent.
export const API_BASE =
  process.env.NODE_ENV === 'production' ? process.env.REACT_APP_API : 'http://localhost:4012';

export async function apiFetch(endpoint, options = {}) {
  return fetch(`${API_BASE}${endpoint}`, { credentials: 'include', ...options });
}

// GET a public JSON endpoint and return its `data`; anything else (network, HTTP, success:false) throws.
export async function getJSON(endpoint) {
  const res = await apiFetch(endpoint);
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || !json.success) throw new Error(`${endpoint} -> HTTP ${res.status}`);
  return json.data;
}

// /media is served by the API server, which is a different origin from the site in dev and production.
export function mediaUrl(path) {
  return `${API_BASE}${path}`;
}
