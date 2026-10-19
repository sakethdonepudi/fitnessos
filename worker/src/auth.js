import { HttpError, constantTimeEqual, randomToken, sha256Hex, toBase64, fromBase64, nowIso, uuid } from './util.js';

// Cloudflare Workers WebCrypto rejects PBKDF2 iteration counts above 100,000.
const ITERATIONS = 100_000;

async function derive(passphrase, saltB64, iterations = ITERATIONS) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: fromBase64(saltB64),
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  );
  return toBase64(new Uint8Array(bits));
}

export function validatePassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12) {
    throw new HttpError(400, 'Passphrase must be at least 12 characters');
  }
  if (passphrase.length > 200) throw new HttpError(400, 'Passphrase is too long');
  return passphrase;
}

export async function firstRunStatus(env) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM users`).first();
  return { setupRequired: (row?.count || 0) === 0 };
}

export async function setupUser(env, passphrase) {
  validatePassphrase(passphrase);
  const existing = await env.DB.prepare(`SELECT COUNT(*) AS count FROM users`).first();
  if ((existing?.count || 0) > 0) throw new HttpError(409, 'This instance already has an owner account');

  const userId = uuid();
  const salt = toBase64(crypto.getRandomValues(new Uint8Array(16)));
  const hash = await derive(passphrase, salt);
  const at = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, passphrase_hash, passphrase_salt, iterations, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(userId, hash, salt, ITERATIONS, at, at),
    env.DB.prepare(`INSERT INTO user_sequences (user_id, next_seq) VALUES (?, 0)`).bind(userId),
    env.DB.prepare(
      `INSERT INTO audit_log (user_id, action, entity, detail, at) VALUES (?, 'account.setup', 'user', 'Owner account created', ?)`
    ).bind(userId, at),
  ]);
  return { userId };
}

export async function verifyPassphrase(env, passphrase) {
  const user = await env.DB.prepare(`SELECT * FROM users LIMIT 1`).first();
  if (!user) throw new HttpError(404, 'No owner account exists yet');
  const hash = await derive(passphrase, user.passphrase_salt, user.iterations);
  if (!constantTimeEqual(hash, user.passphrase_hash)) {
    await env.DB.prepare(
      `INSERT INTO audit_log (user_id, action, entity, detail, at) VALUES (?, 'auth.failed', 'session', 'Invalid passphrase', ?)`
    ).bind(user.id, nowIso()).run().catch(() => {});
    throw new HttpError(401, 'Invalid passphrase');
  }
  return user;
}

export async function login(env, passphrase) {
  const user = await verifyPassphrase(env, passphrase);
  return createSession(env, user.id);
}

export async function createSession(env, userId) {
  const raw = randomToken(32);
  const tokenHash = await sha256Hex(`${raw}:${env.SESSION_SECRET || 'dev-secret'}`);
  const id = uuid();
  const created = new Date();
  const expires = new Date(created.getTime() + 30 * 86_400_000);
  await env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, userId, tokenHash, created.toISOString(), expires.toISOString(), created.toISOString()).run();
  return { token: raw, expiresAt: expires.toISOString(), userId };
}

export async function verifySession(env, token) {
  if (!token) return null;
  const tokenHash = await sha256Hex(`${token}:${env.SESSION_SECRET || 'dev-secret'}`);
  const row = await env.DB.prepare(
    `SELECT s.id AS session_id, s.user_id, s.expires_at, s.last_seen_at, u.id
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked = 0 AND s.expires_at > ?`
  )
    .bind(tokenHash, nowIso())
    .first();
  if (!row) return null;
  if (!row.last_seen_at || Date.now() - new Date(row.last_seen_at).getTime() > 10 * 60_000) {
    env.DB.prepare(`UPDATE sessions SET last_seen_at = ? WHERE id = ?`).bind(nowIso(), row.session_id).run().catch(() => {});
  }
  return { userId: row.user_id, sessionId: row.session_id };
}

export async function revokeSession(env, token) {
  const tokenHash = await sha256Hex(`${token}:${env.SESSION_SECRET || 'dev-secret'}`);
  await env.DB.prepare(`UPDATE sessions SET revoked = 1 WHERE token_hash = ?`).bind(tokenHash).run();
}

export function bearerToken(request) {
  const header = request.headers.get('Authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null;
}

export async function requireSession(env, request) {
  const auth = await verifySession(env, bearerToken(request));
  if (!auth) throw new HttpError(401, 'Not authenticated');
  return auth;
}

export async function createDevice(env, userId, name) {
  const raw = `fos_${randomToken(30)}`;
  const tokenHash = await sha256Hex(`${raw}:${env.SESSION_SECRET || 'dev-secret'}`);
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO devices (id, user_id, name, token_hash, created_at) VALUES (?, ?, ?, ?, ?)`
  ).bind(id, userId, name, tokenHash, nowIso()).run();
  return { id, token: raw, name, createdAt: nowIso() };
}

export async function listDevices(env, userId) {
  const rows = await env.DB.prepare(
    `SELECT id, name, created_at, last_used_at, revoked FROM devices WHERE user_id = ? ORDER BY created_at DESC`
  ).bind(userId).all();
  return rows.results || [];
}

export async function revokeDevice(env, userId, id) {
  await env.DB.prepare(`UPDATE devices SET revoked = 1 WHERE user_id = ? AND id = ?`).bind(userId, id).run();
}

export async function verifyDevice(env, raw) {
  if (!raw || !raw.startsWith('fos_')) return null;
  const tokenHash = await sha256Hex(`${raw}:${env.SESSION_SECRET || 'dev-secret'}`);
  const row = await env.DB.prepare(
    `SELECT d.id AS device_id, d.user_id, d.name FROM devices d
     WHERE d.token_hash = ? AND d.revoked = 0`
  ).bind(tokenHash).first();
  if (!row) return null;
  env.DB.prepare(`UPDATE devices SET last_used_at = ? WHERE id = ?`).bind(nowIso(), row.device_id).run().catch(() => {});
  return row;
}

export async function requireDeviceOrSession(env, request) {
  const token = bearerToken(request);
  if (!token) throw new HttpError(401, 'Missing bearer token');
  if (token.startsWith('fos_')) {
    const device = await verifyDevice(env, token);
    if (!device) throw new HttpError(401, 'Device token invalid or revoked');
    return { userId: device.user_id, deviceId: device.device_id, kind: 'device' };
  }
  const session = await verifySession(env, token);
  if (session) return { userId: session.userId, kind: 'session' };
  throw new HttpError(401, 'Session expired or invalid');
}
