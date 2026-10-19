import Dexie from 'dexie';

export const db = new Dexie('fitness-os');

db.version(1).stores({
  records: 'id, collection, updatedAt, deleted, dirty, [collection+updatedAt]',
  photos: 'id, cachedAt',
  meta: 'key',
  outbox: '++seq, recordId, createdAt',
  syncLog: '++id, at, kind',
});

// v2 — sync metadata + local audit history. Dexie runs this upgrade for existing
// browsers and treats fresh installs as v2 automatically.
db.version(2)
  .stores({
    records: 'id, collection, updatedAt, deleted, dirty, lastSyncedAt, [collection+updatedAt]',
    photos: 'id, cachedAt, dirty, remote',
    meta: 'key',
    outbox: '++seq, recordId, createdAt',
    syncLog: '++id, at, kind, status',
    audit: '++id, at, action, entity',
  })
  .upgrade(async (tx) => {
    await tx.table('meta').put({
      key: 'schema',
      value: { version: 2, migratedAt: new Date().toISOString(), notes: 'Added sync metadata and local audit history' },
    });
  });

export const COLLECTIONS = [
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
];

export const nowIso = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();

export async function metaGet(key, fallback = null) {
  const row = await db.meta.get(key);
  return row ? row.value : fallback;
}

export async function metaSet(key, value) {
  await db.meta.put({ key, value });
  return value;
}

export async function getRecord(collection, id) {
  const row = await db.records.get(id);
  if (!row || row.collection !== collection || row.deleted) return null;
  return { ...row.data, id: row.id, _updatedAt: row.updatedAt, _version: row.version, _dirty: row.dirty };
}

export async function listRecords(collection, { includeDeleted = false } = {}) {
  const rows = await db.records.where('collection').equals(collection).toArray();
  return rows
    .filter((r) => includeDeleted || !r.deleted)
    .sort((a, b) => (a.updatedAt || '').localeCompare(b.updatedAt || ''))
    .map((r) => ({ ...r.data, id: r.id, _updatedAt: r.updatedAt, _version: r.version, _dirty: r.dirty }));
}

export async function putRecord(collection, data, { id = data?.id || uid(), skipOutbox = false, touch = true } = {}) {
  const existing = await db.records.get(id);
  const at = nowIso();
  const clean = { ...data, id };
  const fieldUpdatedAt = { ...(existing?.fieldUpdatedAt || {}) };
  if (!existing) {
    for (const key of Object.keys(clean)) fieldUpdatedAt[key] = at;
  } else if (touch) {
    for (const key of Object.keys(clean)) {
      if (JSON.stringify(existing.data?.[key]) !== JSON.stringify(clean[key])) fieldUpdatedAt[key] = at;
    }
    for (const key of Object.keys(existing.data || {})) {
      if (!(key in clean)) fieldUpdatedAt[key] = at;
    }
  }
  const record = {
    id,
    collection,
    data: clean,
    fieldUpdatedAt,
    updatedAt: at,
    deleted: false,
    dirty: true,
    version: existing?.version || 0,
    lastSyncedAt: existing?.lastSyncedAt || null,
    createdAt: existing?.createdAt || at,
  };
  await db.records.put(record);
  if (!skipOutbox) {
    await db.outbox.put({ recordId: id, collection, createdAt: at });
  }
  return { ...clean, _updatedAt: at, _version: record.version, _dirty: true };
}

export async function patchRecord(collection, id, patch) {
  const existing = await getRecord(collection, id);
  if (!existing) return null;
  return putRecord(collection, { ...existing, ...patch }, { id });
}

export async function removeRecord(collection, id, { skipOutbox = false } = {}) {
  const existing = await db.records.get(id);
  if (!existing) return { ok: true };
  const at = nowIso();
  await db.records.put({
    ...existing,
    deleted: true,
    dirty: true,
    updatedAt: at,
    fieldUpdatedAt: { ...(existing.fieldUpdatedAt || {}), __deleted: at },
  });
  if (!skipOutbox) await db.outbox.put({ recordId: id, collection, createdAt: at });
  return { ok: true };
}

export async function importRecord(record) {
  const existing = await db.records.get(record.id);
  const merged = {
    ...record,
    dirty: record.dirty ?? false,
    version: record.version ?? existing?.version ?? 0,
    lastSyncedAt: record.lastSyncedAt ?? existing?.lastSyncedAt ?? nowIso(),
  };
  await db.records.put(merged);
  return merged;
}

export async function markSynced(id, remote, { keepDirty = false } = {}) {
  const local = await db.records.get(id);
  if (!local) return;
  await db.records.put({
    ...local,
    version: remote.version,
    lastSyncedAt: nowIso(),
    dirty: keepDirty ? local.dirty : false,
    serverSeq: remote.serverSeq,
    fieldUpdatedAt: remote.fieldUpdatedAt || local.fieldUpdatedAt,
  });
  if (!keepDirty) {
    await db.outbox.where('recordId').equals(id).delete();
  }
}

export async function pendingChanges(limit = 250) {
  const outbox = await db.outbox.orderBy('seq').toArray();
  const ids = [...new Set(outbox.map((o) => o.recordId))].slice(0, limit);
  const records = await db.records.bulkGet(ids);
  return records.filter(Boolean);
}

export async function pendingCount() {
  return db.outbox.count();
}

export async function audit(action, entity, detail) {
  await db.audit.put({ action, entity, detail: detail || null, at: nowIso() });
}

export async function resetLocalData() {
  await db.transaction('rw', db.records, db.photos, db.outbox, db.syncLog, db.audit, db.meta, async () => {
    await Promise.all([
      db.records.clear(),
      db.photos.clear(),
      db.outbox.clear(),
      db.syncLog.clear(),
      db.audit.clear(),
      db.meta.clear(),
    ]);
  });
}

export async function seedDefaults() {
  const { DEFAULT_FOODS, DEFAULT_RECIPES, DEFAULT_PRESET_BLOCKS } = await import('../../shared/core.js');
  const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const existingFoods = await db.records.where('collection').equals('foods').count();
  if (!existingFoods) {
    for (const food of DEFAULT_FOODS) {
      await putRecord('foods', { ...food, source: 'default', editable: true }, { id: `food:${slug(food.name)}` });
    }
    for (const recipe of DEFAULT_RECIPES) {
      const totals = recipe.ingredients.reduce(
        (a, i) => ({
          calories: a.calories + i.calories,
          protein: a.protein + i.protein,
          carbs: a.carbs + i.carbs,
          fat: a.fat + i.fat,
        }),
        { calories: 0, protein: 0, carbs: 0, fat: 0 }
      );
      await putRecord(
        'recipes',
        {
          ...recipe,
          calories: totals.calories / recipe.servings,
          protein_g: totals.protein / recipe.servings,
          carbs_g: totals.carbs / recipe.servings,
          fat_g: totals.fat / recipe.servings,
          source: 'default',
        },
        { id: `recipe:${slug(recipe.name)}` }
      );
    }
  }
  const existingPreset = await db.records.where('collection').equals('treadmill_presets').count();
  if (!existingPreset) {
    await putRecord(
      'treadmill_presets',
      {
        name: 'Incline Fat-Loss Walk',
        description:
          '5 min warm-up, 20 min incline block, 5 min cooldown. Adjust to how you feel — the incline is not a magic fat-burning zone.',
        blocks: DEFAULT_PRESET_BLOCKS,
        is_default: 1,
      },
      { skipOutbox: true, id: 'preset:default' }
    );
  }
}
