/**
 * Converts the legacy Node/SQLite JSON export into sync records.
 * Shared by the browser importer and the Node migration script.
 */
export function legacyExportToRecords(data) {
  const now = new Date().toISOString();
  const records = [];
  const add = (collection, id, payload) => {
    records.push({
      id,
      collection,
      data: { ...payload, id },
      fieldUpdatedAt: Object.fromEntries(Object.keys(payload).map((k) => [k, now])),
      updatedAt: now,
      deleted: false,
      dirty: true,
      version: 0,
      lastSyncedAt: null,
    });
  };

  if (data.profile) add('profile', 'profile', data.profile);
  for (const g of data.goals || []) add('goals', `goal:${g.effective_from}`, g);
  for (const w of data.weighIns || []) add('weigh_ins', `weigh:${w.date}`, w);
  for (const m of data.meals || []) add('meals', `legacy:meal:${m.id}`, m);
  for (const w of data.water || []) add('water', `legacy:water:${w.id}`, w);

  const setsBySession = new Map();
  for (const s of data.exerciseSets || []) {
    if (!setsBySession.has(s.session_id)) setsBySession.set(s.session_id, []);
    setsBySession.get(s.session_id).push({
      id: `legacy:set:${s.id}`,
      exercise: s.exercise,
      set_index: s.set_index,
      reps: s.reps,
      weight_kg: s.weight_kg,
      rpe: s.rpe,
    });
  }
  for (const w of data.workouts || []) {
    add('workouts', `legacy:workout:${w.id}`, { ...w, sets: setsBySession.get(w.id) || [] });
  }

  for (const p of data.treadmillPresets || []) {
    let blocks = [];
    try {
      blocks = JSON.parse(p.blocks_json || '[]');
    } catch {
      blocks = [];
    }
    add('treadmill_presets', `legacy:preset:${p.id}`, { ...p, blocks, is_default: !!p.is_default });
  }

  const healthIdMap = new Map();
  for (const h of data.healthWorkouts || []) {
    healthIdMap.set(h.id, `legacy:healthw:${h.id}`);
  }
  for (const h of data.healthWorkouts || []) {
    add('health_workouts', healthIdMap.get(h.id), h);
  }
  for (const t of data.treadmillSessions || []) {
    add('treadmill_sessions', `legacy:treadmill:${t.id}`, {
      ...t,
      health_workout_id: t.health_workout_id ? healthIdMap.get(t.health_workout_id) || t.health_workout_id : null,
    });
  }
  for (const s of data.stepsDaily || []) add('steps_daily', `steps:${s.date}`, s);
  for (const r of data.recovery || []) add('recovery', `recovery:${r.date}`, r);

  const recipeIngredients = new Map();
  for (const i of data.recipeIngredients || []) {
    if (!recipeIngredients.has(i.recipe_id)) recipeIngredients.set(i.recipe_id, []);
    recipeIngredients.get(i.recipe_id).push(i);
  }
  for (const r of data.recipes || []) {
    add('recipes', `legacy:recipe:${r.id}`, { ...r, ingredients: recipeIngredients.get(r.id) || [] });
  }

  const photoIdMap = new Map();
  for (const p of data.photos || []) {
    photoIdMap.set(p.id, `legacy-photo-${p.id}`);
    add('photos', `legacy-photo-${p.id}`, {
      kind: p.kind,
      mime: p.mime,
      size: p.size,
      filename: p.filename,
      original_name: p.original_name,
      taken_at: p.taken_at,
      created_at: p.created_at,
      legacy_id: p.id,
    });
  }
  for (const p of data.progressPhotos || []) {
    add('progress_photos', `progress:${p.week_start}:${p.angle}`, {
      week_start: p.week_start,
      angle: p.angle,
      photo_id: photoIdMap.get(p.photo_id) || `legacy-photo-${p.photo_id}`,
      created_at: p.created_at,
    });
  }

  for (const c of data.checkpoints || []) {
    let snapshot = null;
    let reconciled = null;
    try {
      snapshot = JSON.parse(c.snapshot_json || 'null');
    } catch {
      snapshot = null;
    }
    try {
      reconciled = JSON.parse(c.reconciled_json || 'null');
    } catch {
      reconciled = null;
    }
    add('checkpoints', `checkpoint:${c.date}`, {
      date: c.date,
      source: 'legacy',
      status: c.status || 'final',
      snapshot,
      reconciled,
      executed_at: c.created_at,
      reconstructed: true,
      reconstructed_at: c.created_at,
      scheduled_for: `${c.date}T23:55:00+05:30`,
    });
  }

  const photos = (data.photosBase64 || []).map((p) => ({
    id: photoIdMap.get(p.id) || `legacy-photo-${p.id}`,
    mime: p.mime || 'image/jpeg',
    filename: p.filename || null,
    base64: p.base64,
  }));

  return {
    records,
    photos,
    counts: records.reduce((acc, r) => {
      acc[r.collection] = (acc[r.collection] || 0) + 1;
      return acc;
    }, {}),
  };
}
