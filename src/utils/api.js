// All browser calls to the API go through apiFetch (Inside D pattern): one base URL, cookies always sent.
export const API_BASE =
  process.env.NODE_ENV === 'production' ? process.env.REACT_APP_API : 'http://localhost:4012';

export async function apiFetch(endpoint, options = {}) {
  return fetch(`${API_BASE}${endpoint}`, { credentials: 'include', ...options });
}
