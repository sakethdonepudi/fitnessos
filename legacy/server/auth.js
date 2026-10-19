import crypto from 'node:crypto';
import { db, nowIso } from './db.js';

const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, SCRYPT_KEYLEN).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [scheme, salt, hash] = String(stored).split(':');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, SCRYPT_KEYLEN);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const created = new Date();
  const expires = new Date(created.getTime() + 30 * 86_400_000);
  db.prepare(
    `INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)`
  ).run(token, userId, created.toISOString(), expires.toISOString());
  return { token, expiresAt: expires.toISOString() };
}

export function destroySession(token) {
  if (!token) return;
  db.prepare(`DELETE FROM sessions WHERE token = ?`).run(token);
}

export function userFromRequest(req) {
  const token = req.cookies?.fos_session;
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT s.token, s.expires_at, u.id, u.email, u.name, u.timezone, u.is_demo
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ?`
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    destroySession(token);
    return null;
  }
  return row;
}

export function requireAuth(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

/**
 * HealthKit companion sync accepts either a browser session or a device token.
 * Device tokens are hashed at rest and can be revoked individually.
 */
export function requireAuthOrToken(req, res, next) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const row = db
      .prepare(
        `SELECT t.id AS token_id, u.id, u.email, u.name, u.timezone, u.is_demo
         FROM health_tokens t JOIN users u ON u.id = t.user_id
         WHERE t.token_hash = ?`
      )
      .get(hash);
    if (!row) return res.status(401).json({ error: 'Invalid device token' });
    db.prepare(`UPDATE health_tokens SET last_used_at = ? WHERE id = ?`).run(new Date().toISOString(), row.token_id);
    req.user = row;
    req.deviceTokenId = row.token_id;
    return next();
  }
  return requireAuth(req, res, next);
}

export function createHealthToken(userId, label) {
  const token = `fos_${crypto.randomBytes(24).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  db.prepare(
    `INSERT INTO health_tokens (user_id, token_hash, label, created_at) VALUES (?, ?, ?, ?)`
  ).run(userId, hash, label || 'iPhone companion', nowIso());
  return token;
}

export function listHealthTokens(userId) {
  return db
    .prepare(
      `SELECT id, label, created_at, last_used_at FROM health_tokens WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(userId);
}

export function revokeHealthToken(userId, id) {
  return db.prepare(`DELETE FROM health_tokens WHERE id = ? AND user_id = ?`).run(id, userId);
}

export function createUser({ email, password, name, timezone = 'Asia/Kolkata', isDemo = false }) {
  const info = db
    .prepare(
      `INSERT INTO users (email, password_hash, name, timezone, is_demo, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(email, hashPassword(password), name, timezone, isDemo ? 1 : 0, nowIso());
  return info.lastInsertRowid;
}
