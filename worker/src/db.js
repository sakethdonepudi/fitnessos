import { nowIso, uuid, HttpError } from './util.js';

export const COLLECTIONS = new Set([
  'profile',
  'goals',
  'meals',
  'foods',
  'recipes',
  'water',
  'workouts',
  'treadmill_presets',
  'treadmill_sessions',
  'weigh_ins',
  'recovery',
  'steps_daily',
  'health_step_samples',
  'health_workouts',
  'heart_rate_samples',
  'health_imports',
  'photos',
  'progress_photos',
  'checkpoints',
  'summaries',
  'settings',
]);

export async function nextSeq(env, userId) {
  await env.DB.prepare(
    `INSERT INTO user_sequences (user_id, next_seq) VALUES (?, 0)
     ON CONFLICT(user_id) DO NOTHING`
  ).bind(userId).run();
  const row = await env.DB.prepare(
    `UPDATE user_sequences SET next_seq = next_seq + 1 WHERE user_id = ? RETURNING next_seq`
  ).bind(userId).first();
  return row?.next_seq || 1;
}

export function rowToRecord(row) {
  if (!row) return null;
  return {
    id: row.id,
    collection: row.collection,
    data: JSON.parse(row.data_json),
    fieldUpdatedAt: row.field_updated_at_json ? JSON.parse(row.field_updated_at_json) : {},
    updatedAt: row.updated_at,
    deleted: !!row.deleted,
    version: row.version,
    serverSeq: row.server_seq,
    serverUpdatedAt: row.server_updated_at,
  };
}

async function upsertRecord(env, userId, record) {
  const seq = await nextSeq(env, userId);
  await env.DB.prepare(
    `INSERT INTO sync_records
       (user_id, id, collection, data_json, field_updated_at_json, updated_at, server_updated_at, server_seq, deleted, version, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, id) DO UPDATE SET
       collection = excluded.collection,
       data_json = excluded.data_json,
       field_updated_at_json = excluded.field_updated_at_json,
       updated_at = excluded.updated_at,
       server_updated_at = excluded.server_updated_at,
       server_seq = excluded.server_seq,
       deleted = excluded.deleted,
       version = excluded.version,
       device_id = excluded.device_id`
  )
    .bind(
      userId,
      record.id,
      record.collection,
      JSON.stringify(record.data || {}),
      JSON.stringify(record.fieldUpdatedAt || {}),
      record.updatedAt,
      nowIso(),
      seq,
      record.deleted ? 1 : 0,
      record.version,
      record.deviceId || null
    )
    .run();
  return { ...record, serverSeq: seq, serverUpdatedAt: nowIso() };
}

export async function getRecord(env, userId, id) {
  const row = await env.DB.prepare(`SELECT * FROM sync_records WHERE user_id = ? AND id = ?`)
    .bind(userId, id)
    .first();
  return rowToRecord(row);
}

export async function listRecords(env, userId, collection) {
  const rows = await env.DB.prepare(
    `SELECT * FROM sync_records WHERE user_id = ? AND collection = ? AND deleted = 0 ORDER BY updated_at ASC`
  )
    .bind(userId, collection)
    .all();
  return (rows.results || []).map(rowToRecord);
}

export async function pullRecords(env, userId, sinceSeq = 0, limit = 1000) {
  const rows = await env.DB.prepare(
    `SELECT * FROM sync_records WHERE user_id = ? AND server_seq > ? ORDER BY server_seq ASC LIMIT ?`
  )
    .bind(userId, sinceSeq, limit)
    .all();
  return (rows.results || []).map(rowToRecord);
}

function mergeFields(existing, incoming) {
  const existingData = existing.data || {};
  const incomingData = incoming.data || {};
  const existingFieldAt = existing.fieldUpdatedAt || {};
  const incomingFieldAt = incoming.fieldUpdatedAt || {};
  const keys = new Set([...Object.keys(existingData), ...Object.keys(incomingData)]);
  const merged = {};
  const mergedFieldAt = {};
  const conflicts = [];

  for (const key of keys) {
    const inAt = incomingFieldAt[key] || incoming.updatedAt;
    const exAt = existingFieldAt[key] || existing.updatedAt;
    const inValue = incomingData[key];
    const exValue = existingData[key];
    const same = JSON.stringify(inValue) === JSON.stringify(exValue);

    if (same) {
      merged[key] = inValue;
      mergedFieldAt[key] = inAt > exAt ? inAt : exAt;
    } else if (inAt > exAt) {
      merged[key] = inValue;
      mergedFieldAt[key] = inAt;
    } else if (exAt > inAt) {
      merged[key] = exValue;
      mergedFieldAt[key] = exAt;
    } else {
      // Same logical timestamp with different values: keep the server copy and flag it.
      merged[key] = exValue;
      mergedFieldAt[key] = exAt;
      conflicts.push(key);
    }
  }
  return { data: merged, fieldUpdatedAt: mergedFieldAt, conflicts };
}

/**
 * Applies a client change with per-field conflict resolution.
 * Stale offline data can never overwrite fields it did not touch more recently.
 */
export async function applyChange(env, userId, change, deviceId) {
  if (!change || typeof change !== 'object') throw new HttpError(400, 'Invalid change');
  if (typeof change.id !== 'string' || !change.id || change.id.length > 120) {
    throw new HttpError(400, 'Each change needs a stable string id');
  }
  if (!COLLECTIONS.has(change.collection)) throw new HttpError(400, `Unknown collection: ${change.collection}`);
  const data = change.data == null ? {} : change.data;
  if (typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Record data must be an object');
  const serialized = JSON.stringify(data);
  if (serialized.length > 200_000) throw new HttpError(413, 'Record is too large');

  const updatedAt = typeof change.updatedAt === 'string' ? change.updatedAt : nowIso();
  const existing = await getRecord(env, userId, change.id);
  const baseVersion = Number(change.baseVersion) || 0;
  const incoming = {
    id: change.id,
    collection: change.collection,
    data,
    fieldUpdatedAt: change.fieldUpdatedAt && typeof change.fieldUpdatedAt === 'object' ? change.fieldUpdatedAt : {},
    updatedAt,
    deleted: !!change.deleted,
    version: existing ? existing.version + 1 : 1,
    deviceId,
  };

  if (!existing) {
    const saved = await upsertRecord(env, userId, incoming);
    return { record: saved, conflict: false };
  }

  if (baseVersion >= existing.version) {
    const saved = await upsertRecord(env, userId, incoming);
    return { record: saved, conflict: false };
  }

  // Concurrent edit: merge fields and report conflicts for review.
  if (incoming.deleted || existing.deleted) {
    // Deletion vs edit. Keep the deletion only if it is not older than the edit.
    if (incoming.deleted && updatedAt >= existing.updatedAt) {
      const saved = await upsertRecord(env, userId, incoming);
      return { record: saved, conflict: true, reason: 'delete_won' };
    }
    return { record: existing, conflict: true, reason: 'deleted_elsewhere' };
  }

  const merged = mergeFields(existing, incoming);
  const saved = await upsertRecord(env, userId, {
    ...incoming,
    data: merged.data,
    fieldUpdatedAt: merged.fieldUpdatedAt,
  });
  if (merged.conflicts.length) {
    await audit(env, userId, 'sync.conflict', change.collection, {
      id: change.id,
      fields: merged.conflicts,
      deviceId,
    });
  }
  return {
    record: saved,
    conflict: merged.conflicts.length > 0,
    conflictFields: merged.conflicts,
  };
}

export async function serverUpsert(env, userId, collection, id, data, { deleted = false } = {}) {
  const existing = await getRecord(env, userId, id);
  if (
    existing &&
    existing.deleted === !!deleted &&
    JSON.stringify(existing.data || {}) === JSON.stringify(data || {})
  ) {
    return existing;
  }
  const at = nowIso();
  const fieldUpdatedAt = Object.fromEntries(Object.keys(data || {}).map((k) => [k, at]));
  return upsertRecord(env, userId, {
    id,
    collection,
    data,
    fieldUpdatedAt,
    updatedAt: at,
    deleted,
    version: existing ? existing.version + 1 : 1,
  });
}

/**
 * Batch-upserts many records with one sequence allocation and chunked D1
 * batches. Used by the HealthKit endpoint so a large initial backfill does not
 * exceed the Workers/D1 per-invocation query limit.
 */
export async function serverUpsertMany(env, userId, records, { deviceId = null } = {}) {
  if (!records.length) return [];
  const at = nowIso();
  const seqRow = await env.DB.prepare(
    `INSERT INTO user_sequences (user_id, next_seq) VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET next_seq = next_seq + ?
     RETURNING next_seq`
  )
    .bind(userId, records.length, records.length)
    .first();
  const end = seqRow?.next_seq || records.length;
  const start = end - records.length + 1;

  const statement = env.DB.prepare(
    `INSERT INTO sync_records
       (user_id, id, collection, data_json, field_updated_at_json, updated_at, server_updated_at, server_seq, deleted, version, device_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON CONFLICT(user_id, id) DO UPDATE SET
       collection = excluded.collection,
       data_json = CASE WHEN excluded.deleted = 1 THEN sync_records.data_json ELSE excluded.data_json END,
       field_updated_at_json = excluded.field_updated_at_json,
       updated_at = excluded.updated_at,
       server_updated_at = excluded.server_updated_at,
       server_seq = excluded.server_seq,
       deleted = excluded.deleted,
       version = sync_records.version + 1,
       device_id = excluded.device_id`
  );

  for (let i = 0; i < records.length; i += 100) {
    const chunk = records.slice(i, i + 100);
    const statements = chunk.map((record, offset) => {
      const data = record.deleted ? {} : record.data || {};
      const fieldUpdatedAt = record.fieldUpdatedAt
        || Object.fromEntries(Object.keys(data).map((key) => [key, record.updatedAt || at]));
      return statement.bind(
        userId,
        record.id,
        record.collection,
        JSON.stringify(data),
        JSON.stringify(fieldUpdatedAt),
        record.updatedAt || at,
        at,
        start + i + offset,
        record.deleted ? 1 : 0,
        deviceId
      );
    });
    await env.DB.batch(statements);
  }

  return records.map((record, index) => ({
    ...record,
    version: 1,
    serverSeq: start + index,
    serverUpdatedAt: at,
  }));
}

export async function touchRecord(env, userId, id, updater) {
  const existing = await getRecord(env, userId, id);
  if (!existing) return null;
  const next = updater(existing);
  if (!next) return existing;
  return upsertRecord(env, userId, next);
}

export async function audit(env, userId, action, entity, detail) {
  await env.DB.prepare(
    `INSERT INTO audit_log (user_id, action, entity, detail, at) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(userId, action, entity || null, detail == null ? null : JSON.stringify(detail).slice(0, 4000), nowIso())
    .run()
    .catch(() => {});
}

export async function deleteUserData(env, userId) {
  const photos = await env.DB.prepare(`SELECT object_key FROM photos WHERE user_id = ?`).bind(userId).all();
  for (const p of photos.results || []) {
    await env.PHOTOS.delete(p.object_key).catch(() => {});
  }
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM sync_records WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM photos WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM devices WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM user_sequences WHERE user_id = ?`).bind(userId),
    env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(userId),
  ]);
  await audit(env, userId, 'account.delete', 'user', 'All account data deleted');
}

export { uuid };
