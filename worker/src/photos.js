import { HttpError, nowIso, uuid } from './util.js';
import { audit } from './db.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
const MAX_BYTES = 12 * 1024 * 1024;

export async function uploadPhoto(env, userId, request, id) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw new HttpError(400, 'Invalid photo id');
  const contentType = request.headers.get('content-type') || '';
  let blob;
  let mime;
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('photo') || form.get('file');
    if (!file || typeof file === 'string') throw new HttpError(400, 'No photo uploaded');
    blob = file;
    mime = file.type;
  } else {
    mime = contentType.split(';')[0];
    blob = await request.blob();
  }
  if (!ALLOWED_MIME.has(mime)) throw new HttpError(415, 'Only JPEG, PNG, WEBP or HEIC images are allowed');
  if (blob.size > MAX_BYTES) throw new HttpError(413, 'Photo must be smaller than 12 MB');
  if (blob.size === 0) throw new HttpError(400, 'Empty photo');

  const key = `photos/${userId}/${id}`;
  await env.PHOTOS.put(key, await blob.arrayBuffer(), {
    httpMetadata: { contentType: mime },
    customMetadata: { userId, uploadedAt: nowIso() },
  });
  await env.DB.prepare(
    `INSERT INTO photos (id, user_id, object_key, mime, size, created_at, deleted)
     VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(user_id, id) DO UPDATE SET
       object_key = excluded.object_key, mime = excluded.mime, size = excluded.size, deleted = 0`
  ).bind(id, userId, key, mime, blob.size, nowIso()).run();
  await audit(env, userId, 'photo.upload', 'photos', { id, mime, size: blob.size });
  return { id, mime, size: blob.size, key };
}

export async function getPhoto(env, userId, id) {
  const row = await env.DB.prepare(
    `SELECT * FROM photos WHERE user_id = ? AND id = ? AND deleted = 0`
  ).bind(userId, id).first();
  if (!row) throw new HttpError(404, 'Photo not found');
  const object = await env.PHOTOS.get(row.object_key);
  if (!object) throw new HttpError(404, 'Photo object missing');
  return new Response(object.body, {
    status: 200,
    headers: {
      'content-type': row.mime,
      'content-length': String(row.size),
      'cache-control': 'private, max-age=300',
      etag: object.httpEtag,
    },
  });
}

export async function deletePhoto(env, userId, id) {
  const row = await env.DB.prepare(
    `SELECT * FROM photos WHERE user_id = ? AND id = ? AND deleted = 0`
  ).bind(userId, id).first();
  if (row) {
    await env.PHOTOS.delete(row.object_key).catch(() => {});
    await env.DB.prepare(`UPDATE photos SET deleted = 1 WHERE user_id = ? AND id = ?`).bind(userId, id).run();
    await audit(env, userId, 'photo.delete', 'photos', { id });
  }
  return { ok: true };
}

export async function exportPhoto(env, userId, id) {
  const row = await env.DB.prepare(`SELECT * FROM photos WHERE user_id = ? AND id = ? AND deleted = 0`).bind(userId, id).first();
  if (!row) return null;
  const object = await env.PHOTOS.get(row.object_key);
  if (!object) return null;
  const buffer = await object.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return { id, mime: row.mime, size: row.size, base64: btoa(binary) };
}

export function newPhotoId() {
  return uuid();
}
