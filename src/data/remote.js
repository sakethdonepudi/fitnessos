const API_KEY = 'fos.apiUrl';
const TOKEN_KEY = 'fos.sessionToken';
const DEVICE_KEY = 'fos.deviceId';

export function getApiBase() {
  const stored = localStorage.getItem(API_KEY);
  if (stored) return stored.replace(/\/$/, '');
  const env = import.meta.env.VITE_API_URL;
  return env ? String(env).replace(/\/$/, '') : '';
}

export function setApiBase(url) {
  const clean = String(url || '').trim().replace(/\/$/, '');
  if (clean) localStorage.setItem(API_KEY, clean);
  else localStorage.removeItem(API_KEY);
}

export function getSessionToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setSessionToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export function getDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
}

export class RemoteError extends Error {
  constructor(message, status, detail) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const base = getApiBase();
  if (!base) throw new RemoteError('No backend URL configured', 0);
  const token = getSessionToken();
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body && !(body instanceof FormData) ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? (body instanceof FormData || body instanceof Blob ? body : JSON.stringify(body)) : undefined,
  });
  if (raw) {
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}));
      throw new RemoteError(payload.error || `Request failed (${res.status})`, res.status, payload.detail);
    }
    return res;
  }
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new RemoteError(payload?.error || `Request failed (${res.status})`, res.status, payload?.detail);
  return payload;
}

export const remote = {
  configured: () => !!getApiBase(),
  config: () => request('/api/config'),
  setup: (passphrase, setupToken) =>
    request('/api/auth/setup', {
      method: 'POST',
      body: { passphrase },
      headers: { 'X-Setup-Token': setupToken },
    }),
  login: (passphrase) => request('/api/auth/login', { method: 'POST', body: { passphrase } }),
  me: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  devices: () => request('/api/devices'),
  createDevice: (name) => request('/api/devices', { method: 'POST', body: { name } }),
  revokeDevice: (id) => request(`/api/devices/${id}`, { method: 'DELETE' }),
  sync: ({ since = 0, changes = [] }) =>
    request('/api/sync', { method: 'POST', body: { since, deviceId: getDeviceId(), changes } }),
  pull: (since = 0) => request(`/api/sync?since=${since}`),
  healthStatus: () => request('/api/health/status'),
  jobs: () => request('/api/jobs'),
  runJob: (date) => request('/api/jobs/run', { method: 'POST', body: date ? { date } : {} }),
  audit: (limit = 100) => request(`/api/audit?limit=${limit}`),
  exportAccount: (includePhotos) => request(`/api/account/export${includePhotos ? '?photos=1' : ''}`),
  deleteAccount: (passphrase) =>
    request('/api/account', { method: 'DELETE', body: { confirm: 'DELETE', passphrase } }),
  uploadPhoto: (id, blob, filename) => {
    const form = new FormData();
    form.append('photo', blob, filename || `${id}.jpg`);
    return request(`/api/photos/${id}`, { method: 'POST', body: form });
  },
  async fetchPhoto(id) {
    const res = await request(`/api/photos/${id}`, { raw: true });
    return res.blob();
  },
  async deletePhoto(id) {
    return request(`/api/photos/${id}`, { method: 'DELETE' });
  },
};
