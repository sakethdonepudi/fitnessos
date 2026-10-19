import { db, COLLECTIONS, listRecords, metaGet, metaSet } from './db.js';
import { requestSync } from './sync.js';
import { legacyExportToRecords } from '../../shared/legacy.js';

const FORMAT = 'fitness-os-backup';
const VERSION = 2;

function toBase64(bytes) {
  let binary = '';
  const view = new Uint8Array(bytes);
  const chunk = 0x8000;
  for (let i = 0; i < view.length; i += chunk) binary += String.fromCharCode(...view.subarray(i, i + chunk));
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveKey(passphrase, salt, iterations = 250_000) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function blobToBase64(blob) {
  return toBase64(await blob.arrayBuffer());
}

export async function createBackup({ passphrase = '', includePhotos = true } = {}) {
  const records = await db.records.toArray();
  const photos = [];
  if (includePhotos) {
    for (const photo of await db.photos.toArray()) {
      if (!photo.blob) continue;
      photos.push({
        id: photo.id,
        mime: photo.mime || photo.blob.type || 'image/jpeg',
        filename: photo.filename || null,
        base64: await blobToBase64(photo.blob),
      });
    }
  }
  const payload = {
    schemaVersion: 2,
    records,
    photos,
    meta: {
      lastSync: await metaGet('lastSync', null),
      exportedCollections: COLLECTIONS,
    },
  };
  const canon = JSON.stringify(payload);
  const checksum = await sha256(canon);
  const file = {
    format: FORMAT,
    version: VERSION,
    createdAt: new Date().toISOString(),
    encrypted: !!passphrase,
    checksum,
  };
  if (!passphrase) {
    return { ...file, payload };
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(canon));
  return {
    ...file,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 250_000, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    ciphertext: toBase64(ciphertext),
  };
}

export async function readBackupFile(file, passphrase = '') {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('This is not a valid Fitness OS backup file.');
  }
  return decodeBackup(data, passphrase);
}

export async function decodeBackup(data, passphrase = '') {
  if (!data || data.format !== FORMAT) throw new Error('Not a Fitness OS backup.');
  if (data.version > VERSION) throw new Error('This backup was created by a newer app version.');
  let payload;
  if (data.encrypted) {
    if (!passphrase) throw new Error('This backup is encrypted. Enter its passphrase.');
    const salt = fromBase64(data.kdf.salt);
    const iv = fromBase64(data.cipher.iv);
    const key = await deriveKey(passphrase, salt, data.kdf.iterations);
    try {
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromBase64(data.ciphertext));
      payload = JSON.parse(new TextDecoder().decode(plain));
    } catch {
      throw new Error('Could not decrypt this backup. Check the passphrase.');
    }
  } else {
    payload = data.payload;
  }
  if (!payload || !Array.isArray(payload.records)) throw new Error('Backup payload is missing records.');
  const checksum = await sha256(JSON.stringify(payload));
  if (data.checksum && checksum !== data.checksum) {
    throw new Error('Backup integrity check failed. The file may be corrupted or modified.');
  }
  return validatePayload(payload);
}

function validatePayload(payload) {
  const allowed = new Set(COLLECTIONS);
  const seen = new Set();
  for (const record of payload.records) {
    if (!record || typeof record.id !== 'string' || !record.id) throw new Error('Backup contains a record without an id.');
    if (!allowed.has(record.collection)) throw new Error(`Backup contains an unknown collection: ${record.collection}`);
    if (!record.data || typeof record.data !== 'object') throw new Error(`Backup record ${record.id} has invalid data.`);
    if (seen.has(record.id)) throw new Error(`Backup contains a duplicate record id: ${record.id}`);
    seen.add(record.id);
  }
  for (const photo of payload.photos || []) {
    if (!photo?.id || typeof photo.base64 !== 'string') throw new Error('Backup contains an invalid photo entry.');
  }
  return {
    records: payload.records,
    photos: payload.photos || [],
    schemaVersion: payload.schemaVersion || 1,
  };
}

export async function restoreBackup(backup, { mode = 'merge' } = {}) {
  if (!backup?.records) throw new Error('Nothing to restore.');
  if (mode !== 'merge' && mode !== 'replace') throw new Error('Restore mode must be merge or replace.');
  let imported = 0;
  let duplicates = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  await db.transaction('rw', db.records, db.photos, db.outbox, async () => {
    if (mode === 'replace') {
      await db.records.clear();
      await db.photos.clear();
      await db.outbox.clear();
    }
    for (const record of backup.records) {
      const existing = await db.records.get(record.id);
      if (existing) {
        duplicates += 1;
        if (mode === 'merge' && (existing.updatedAt || '') >= (record.updatedAt || '')) {
          skipped += 1;
          continue;
        }
      }
      const next = {
        ...record,
        dirty: true,
        lastSyncedAt: null,
        version: existing?.version || record.version || 0,
        restoredAt: now,
      };
      await db.records.put(next);
      await db.outbox.put({ recordId: next.id, collection: next.collection, createdAt: now });
      imported += 1;
    }
    for (const photo of backup.photos || []) {
      const existing = await db.photos.get(photo.id);
      if (existing && mode === 'merge' && existing.cachedAt) {
        duplicates += 1;
        skipped += 1;
        continue;
      }
      await db.photos.put({
        id: photo.id,
        blob: new Blob([fromBase64(photo.base64)], { type: photo.mime || 'image/jpeg' }),
        mime: photo.mime || 'image/jpeg',
        filename: photo.filename || null,
        cachedAt: now,
        remote: false,
        dirty: true,
      });
    }
  });
  requestSync(500);
  return { mode, imported, duplicates, skipped, photos: backup.photos?.length || 0, records: backup.records.length };
}

export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function toCsv(headers, rows) {
  return [headers.join(','), ...rows.map((row) => row.map(csvEscape).join(','))].join('\n');
}

export async function exportCsv(kind) {
  if (kind === 'workouts') {
    const workouts = await listRecords('workouts');
    const rows = [];
    for (const w of workouts) {
      for (const set of w.sets || []) {
        rows.push([w.date, w.split, w.duration_min ?? '', set.exercise, set.set_index, set.reps, set.weight_kg, w.source || '']);
      }
    }
    return { filename: `fitness-os-workouts-${dateStamp()}.csv`, content: toCsv(['date', 'split', 'duration_min', 'exercise', 'set', 'reps', 'weight_kg', 'source'], rows) };
  }
  if (kind === 'nutrition') {
    const meals = await listRecords('meals');
    const rows = meals.map((m) => [m.date, m.slot, m.name, m.calories, m.protein_g, m.carbs_g, m.fat_g, m.source || '']);
    return { filename: `fitness-os-nutrition-${dateStamp()}.csv`, content: toCsv(['date', 'slot', 'name', 'calories', 'protein_g', 'carbs_g', 'fat_g', 'source'], rows) };
  }
  if (kind === 'weight') {
    const weigh = (await listRecords('weigh_ins')).sort((a, b) => a.date.localeCompare(b.date));
    const rows = weigh.map((w) => [w.date, w.weight_kg, w.waist_cm, w.body_fat_pct, w.body_fat_source, w.source || '']);
    return { filename: `fitness-os-weight-${dateStamp()}.csv`, content: toCsv(['date', 'weight_kg', 'waist_cm', 'body_fat_pct', 'body_fat_source', 'source'], rows) };
  }
  throw new Error('Unknown CSV export');
}

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

export async function exportLocalJson() {
  const records = await db.records.toArray();
  const photos = [];
  for (const photo of await db.photos.toArray()) {
    if (photo.blob) photos.push({ id: photo.id, mime: photo.mime, base64: await blobToBase64(photo.blob) });
  }
  return { format: 'fitness-os-local-export', version: 2, exportedAt: new Date().toISOString(), records, photos };
}

export async function deleteAllLocalData() {
  await db.delete();
  location.reload();
}

/**
 * Imports the legacy Node/SQLite JSON export (GET /api/export). This is for the
 * one-time migration to D1. Records are written dirty so they sync on connect.
 */
export async function importLegacyExport(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('The legacy export is not valid JSON.');
  }
  if (!data || (!data.profile && !data.meals && !data.weighIns)) {
    throw new Error('This does not look like a legacy Fitness OS export.');
  }
  const mapped = legacyExportToRecords(data);
  const now = new Date().toISOString();
  await db.transaction('rw', db.records, db.photos, db.outbox, async () => {
    for (const record of mapped.records) {
      await db.records.put(record);
      await db.outbox.put({ recordId: record.id, collection: record.collection, createdAt: now });
    }
    for (const photo of mapped.photos) {
      await db.photos.put({
        id: photo.id,
        blob: new Blob([fromBase64(photo.base64)], { type: photo.mime || 'image/jpeg' }),
        mime: photo.mime || 'image/jpeg',
        filename: photo.filename || null,
        cachedAt: now,
        remote: false,
        dirty: true,
      });
    }
  });
  requestSync(500);
  return { imported: mapped.records.length, collections: Object.keys(mapped.counts).length, photos: mapped.photos.length, counts: mapped.counts };
}
