export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });

export const nowIso = () => new Date().toISOString();

export function uuid() {
  return crypto.randomUUID();
}

export function randomToken(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

export function toBase64(bytes) {
  let binary = '';
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += 1) binary += String.fromCharCode(view[i]);
  return btoa(binary);
}

export function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function readJson(request, maxBytes = 2_000_000) {
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'Payload too large');
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

export class HttpError extends Error {
  constructor(status, message, detail = null) {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

export function validateString(value, name, { min = 1, max = 200 } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${name} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new HttpError(400, `${name} must be between ${min} and ${max} characters`);
  }
  return trimmed;
}

export function validateNumber(value, name, { min = -1e9, max = 1e9, optional = false } = {}) {
  if (value == null && optional) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} is out of range`);
  return n;
}

export function validateDateKey(value, name = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${name} must be YYYY-MM-DD`);
  }
  return value;
}

export function corsHeaders(request, env) {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  const ok = allowed.includes(origin) || (env.ENVIRONMENT === 'development' && /^http:\/\/localhost:\d+$/.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || 'null',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type,X-Setup-Token,X-Device-Id',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function rateLimit(env, key, limit, windowSeconds) {
  const windowStart = Math.floor(Date.now() / 1000 / windowSeconds) * windowSeconds;
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
     RETURNING count`
  )
    .bind(key, windowStart)
    .first();
  const count = row?.count || 1;
  if (count === 1) {
    // Opportunistic cleanup; keeps the free-tier table small.
    await env.DB.prepare(`DELETE FROM rate_limits WHERE window_start < ?`)
      .bind(windowStart - windowSeconds * 4)
      .run()
      .catch(() => {});
  }
  if (count > limit) {
    throw new HttpError(429, 'Too many requests. Try again shortly.');
  }
}

export function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function safeJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
