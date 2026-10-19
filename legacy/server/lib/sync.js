import { db, nowIso, audit } from '../db.js';
import { attributeSteps, treadmillInterval } from './steps.js';
import { localDateKey, localDayBounds, addDaysKey } from './dates.js';
import { sessionStatus } from './treadmill.js';

/**
 * Ingests a HealthKit sync payload from the iPhone companion.
 *
 * Payload shape (versioned so the companion can evolve):
 * {
 *   version: 1,
 *   source: "iPhone+AppleWatch",
 *   syncedAt: ISO,
 *   stepSamples: [{ id, start, end, steps, source, device }],
 *   workouts: [{ id, type, start, end, durationSec, distanceKm, avgHr, maxHr, activeCalories, source, device }]
 * }
 *
 * Idempotency: samples and workouts are keyed by their HealthKit UUID, so a
 * re-send updates rather than duplicates.
 */
export function ingestHealthSync(userId, payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Invalid payload');
  }
  const syncedAt = payload.syncedAt || nowIso();
  const source = payload.source || 'HealthKit';
  const stepSamples = Array.isArray(payload.stepSamples) ? payload.stepSamples : [];
  const workouts = Array.isArray(payload.workouts) ? payload.workouts : [];
  const at = nowIso();

  const insertSample = db.prepare(
    `INSERT INTO health_step_samples (id, user_id, start_time, end_time, steps, source, device, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       steps = excluded.steps,
       source = excluded.source,
       device = excluded.device,
       imported_at = excluded.imported_at`
  );

  const insertWorkout = db.prepare(
    `INSERT INTO health_workouts (id, user_id, type, start_time, end_time, duration_sec, distance_km,
       avg_hr, max_hr, active_calories, source, device, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       type = excluded.type,
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       duration_sec = excluded.duration_sec,
       distance_km = excluded.distance_km,
       avg_hr = excluded.avg_hr,
       max_hr = excluded.max_hr,
       active_calories = excluded.active_calories,
       source = excluded.source,
       device = excluded.device,
       imported_at = excluded.imported_at`
  );

  const tx = db.transaction(() => {
    for (const s of stepSamples) {
      if (!s.id || !s.start || !s.end) continue;
      const startUtc = new Date(s.start);
      const endUtc = new Date(s.end);
      if (!Number.isFinite(startUtc.getTime()) || !Number.isFinite(endUtc.getTime())) continue;
      insertSample.run(
        String(s.id),
        userId,
        startUtc.toISOString(),
        endUtc.toISOString(),
        Math.max(0, Math.round(Number(s.steps) || 0)),
        s.source || source,
        s.device || null,
        at
      );
    }
    for (const w of workouts) {
      if (!w.id || !w.start || !w.end) continue;
      const startUtc = new Date(w.start);
      const endUtc = new Date(w.end);
      if (!Number.isFinite(startUtc.getTime()) || !Number.isFinite(endUtc.getTime())) continue;
      insertWorkout.run(
        String(w.id),
        userId,
        w.type || 'other',
        startUtc.toISOString(),
        endUtc.toISOString(),
        Number(w.durationSec) || null,
        Number(w.distanceKm) || null,
        Number(w.avgHr) || null,
        Number(w.maxHr) || null,
        Number(w.activeCalories) || null,
        w.source || source,
        w.device || null,
        at
      );
    }

    db.prepare(
      `INSERT INTO health_syncs (user_id, source, synced_at, received_at, step_samples_count, workouts_count, status, payload_json)
       VALUES (?, ?, ?, ?, ?, ?, 'ok', ?)`
    ).run(
      userId,
      source,
      syncedAt,
      at,
      stepSamples.length,
      workouts.length,
      JSON.stringify({ version: payload.version || 1, source, counts: { stepSamples: stepSamples.length, workouts: workouts.length } })
    );
  });
  tx();

  // Recompute affected days from the samples that arrived.
  const affectedDays = new Set();
  const tz = db.prepare(`SELECT timezone FROM users WHERE id = ?`).get(userId)?.timezone || 'Asia/Kolkata';
  for (const s of stepSamples) {
    if (!s.start) continue;
    affectedDays.add(localDateKey(new Date(s.start), tz));
    affectedDays.add(localDateKey(new Date(s.end), tz));
  }
  for (const w of workouts) {
    if (!w.start) continue;
    affectedDays.add(localDateKey(new Date(w.start), tz));
    if (w.end) affectedDays.add(localDateKey(new Date(w.end), tz));
  }

  const recomputed = [];
  for (const date of affectedDays) {
    recomputed.push(recomputeStepsForDate(userId, date, tz));
  }

  const linked = linkHealthWorkouts(userId);
  const linkedStrength = linkStrengthWorkouts(userId);

  audit(userId, 'health_sync', null, 'ingest', null, {
    source,
    syncedAt,
    stepSamples: stepSamples.length,
    workouts: workouts.length,
    days: recomputed.length,
    linked,
  });

  return {
    ok: true,
    syncedAt,
    stepSamples: stepSamples.length,
    workouts: workouts.length,
    daysRecomputed: recomputed,
    linkedWorkouts: linked,
    linkedStrengthWorkouts: linkedStrength,
  };
}

const STRENGTH_TYPES = [
  'traditional_strength_training',
  'functional_strength_training',
  'strength',
  'strength_training',
  'traditionalStrengthTraining',
  'functionalStrengthTraining',
];

/**
 * Links HealthKit strength workouts to a same-day logged session, or creates a
 * device-verified session when one was not logged in the app.
 */
export function linkStrengthWorkouts(userId) {
  const workouts = db
    .prepare(
      `SELECT * FROM health_workouts WHERE user_id = ?
       AND type IN (${STRENGTH_TYPES.map(() => '?').join(',')})
       ORDER BY start_time ASC`
    )
    .all(userId, ...STRENGTH_TYPES);

  const tz = db.prepare(`SELECT timezone FROM users WHERE id = ?`).get(userId)?.timezone || 'Asia/Kolkata';
  let linked = 0;

  for (const workout of workouts) {
    if (workout.linked_workout_id) continue;
    const date = localDateKey(new Date(workout.start_time), tz);
    const candidates = db
      .prepare(
        `SELECT * FROM workout_sessions WHERE user_id = ? AND date = ? AND health_workout_id IS NULL
         ORDER BY created_at ASC`
      )
      .all(userId, date);

    if (candidates.length > 0) {
      const session = candidates[0];
      db.prepare(
        `UPDATE workout_sessions SET health_workout_id = ?, source = 'healthkit',
           duration_min = COALESCE(duration_min, ?),
           notes = COALESCE(notes, 'Linked Apple Health strength workout')
         WHERE id = ?`
      ).run(
        workout.id,
        workout.duration_sec ? Math.round((workout.duration_sec / 60) * 10) / 10 : null,
        session.id
      );
      db.prepare(`UPDATE health_workouts SET linked_workout_id = ? WHERE id = ?`).run(session.id, workout.id);
      linked += 1;
    } else {
      const info = db
        .prepare(
          `INSERT INTO workout_sessions (user_id, date, split, title, status, source, health_workout_id, duration_min, notes, created_at)
           VALUES (?, ?, 'Imported', 'Strength training (HealthKit)', 'completed', 'healthkit', ?, ?, 'Imported from Apple Health. No sets were recorded in the app.', ?)`
        )
        .run(
          userId,
          date,
          workout.id,
          workout.duration_sec ? Math.round((workout.duration_sec / 60) * 10) / 10 : null,
          nowIso()
        );
      db.prepare(`UPDATE health_workouts SET linked_workout_id = ? WHERE id = ?`).run(info.lastInsertRowid, workout.id);
      linked += 1;
    }
  }
  return linked;
}

/**
 * Links imported indoor-walking workouts to treadmill sessions that overlap in
 * time and do not already have a device record.
 */
export function linkHealthWorkouts(userId) {
  const workouts = db
    .prepare(
      `SELECT * FROM health_workouts WHERE user_id = ? AND type IN ('indoor_walk','walking','indoor_walking','treadmill')
       ORDER BY start_time ASC`
    )
    .all(userId);

  let linked = 0;
  for (const workout of workouts) {
    if (workout.linked_treadmill_id) continue;
    const wStart = new Date(workout.start_time).getTime();
    const wEnd = new Date(workout.end_time).getTime();

    const candidates = db
      .prepare(
        `SELECT * FROM treadmill_sessions
         WHERE user_id = ? AND health_workout_id IS NULL AND start_time IS NOT NULL AND end_time IS NOT NULL`
      )
      .all(userId);

    let best = null;
    for (const c of candidates) {
      const cStart = new Date(c.start_time).getTime();
      const cEnd = new Date(c.end_time).getTime();
      const overlap = Math.min(wEnd, cEnd) - Math.max(wStart, cStart);
      if (overlap > 0) {
        const ratio = overlap / Math.min(wEnd - wStart, cEnd - cStart);
        if (ratio >= 0.5 && (!best || overlap > best.overlap)) best = { session: c, overlap };
      }
    }

    if (best) {
      const s = best.session;
      const durationMin = workout.duration_sec ? workout.duration_sec / 60 : s.duration_min;
      db.prepare(
        `UPDATE treadmill_sessions SET
           health_workout_id = ?,
           duration_min = COALESCE(?, duration_min),
           distance_km = COALESCE(distance_km, ?),
           avg_hr = COALESCE(avg_hr, ?),
           max_hr = COALESCE(max_hr, ?),
           active_calories = COALESCE(active_calories, ?),
           calories_source = CASE WHEN active_calories IS NULL THEN 'healthkit_estimate' ELSE calories_source END,
           source = 'healthkit',
           updated_at = ?
         WHERE id = ?`
      ).run(
        workout.id,
        durationMin,
        workout.distance_km,
        workout.avg_hr,
        workout.max_hr,
        workout.active_calories,
        nowIso(),
        s.id
      );
      db.prepare(`UPDATE health_workouts SET linked_treadmill_id = ? WHERE id = ?`).run(
        s.id,
        workout.id
      );
      linked += 1;
    }
  }
  return linked;
}

/**
 * Recomputes the three step counters for one day.
 *
 * A: total HealthKit steps (de-duplicated across devices)
 * B: steps attributed to treadmill intervals
 * C: qualifying non-treadmill steps — the only counter that advances the goal
 */
export function recomputeStepsForDate(userId, date, timezone = 'Asia/Kolkata') {
  const { start, end } = localDayBounds(date, timezone);
  const samples = db
    .prepare(
      `SELECT * FROM health_step_samples
       WHERE user_id = ? AND start_time < ? AND end_time > ?`
    )
    .all(userId, end.toISOString(), start.toISOString());

  const sessions = db
    .prepare(
      `SELECT * FROM treadmill_sessions
       WHERE user_id = ? AND date = ? AND status != 'skipped'`
    )
    .all(userId, date);

  const intervals = sessions.map(treadmillInterval).filter(Boolean);
  const untimedSessions = sessions.filter((s) => !treadmillInterval(s) && s.duration_min > 0);
  // Walking cadence at 3.5–4.5 km/h is roughly 100–115 steps/min. When a
  // session has no start/end time we cannot know which samples belong to it, so
  // we subtract an explicit estimate and widen the uncertainty.
  const estimatedTreadmillSteps = untimedSessions.reduce(
    (sum, s) => sum + Math.round((s.duration_min || 0) * 105),
    0
  );

  if (samples.length === 0) {
    const existing = db
      .prepare(`SELECT * FROM steps_daily WHERE user_id = ? AND date = ?`)
      .get(userId, date);
    const row = {
      total: 0,
      treadmill: 0,
      qualifying: 0,
      method: 'none',
      uncertaintyPct: 0,
      status: 'pending_sync',
      sources: [],
    };
    db.prepare(
      `INSERT INTO steps_daily (user_id, date, total_steps, treadmill_steps, qualifying_steps, method,
         uncertainty_pct, sample_resolution_sec, sources_json, synced_at, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, date) DO UPDATE SET
         total_steps = excluded.total_steps,
         treadmill_steps = excluded.treadmill_steps,
         qualifying_steps = excluded.qualifying_steps,
         method = excluded.method,
         uncertainty_pct = excluded.uncertainty_pct,
         sources_json = excluded.sources_json,
         status = excluded.status`
    ).run(userId, date, 0, 0, 0, 'none', 0, null, JSON.stringify([]), existing?.synced_at ?? null, 'pending_sync');
    return { date, ...row, sourceTotals: {} };
  }

  const result = attributeSteps(samples, intervals);
  if (estimatedTreadmillSteps > 0) {
    result.treadmillSteps = Math.min(result.totalSteps, result.treadmillSteps + estimatedTreadmillSteps);
    result.qualifyingSteps = Math.max(0, result.totalSteps - result.treadmillSteps);
    result.uncertaintyPct = Math.min(20, Math.max(result.uncertaintyPct, 10));
    result.method = result.method === 'none' ? 'estimated_attribution' : `${result.method}_estimated_attribution`;
  }

  const resolution = computeResolution(samples);
  const status =
    result.method.includes('estimated') || result.uncertaintyPct > 5 ? 'estimated' : 'verified';

  const lastSync = db
    .prepare(`SELECT received_at FROM health_syncs WHERE user_id = ? ORDER BY received_at DESC LIMIT 1`)
    .get(userId);

  db.prepare(
    `INSERT INTO steps_daily (user_id, date, total_steps, treadmill_steps, qualifying_steps, method,
       uncertainty_pct, sample_resolution_sec, sources_json, synced_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET
       total_steps = excluded.total_steps,
       treadmill_steps = excluded.treadmill_steps,
       qualifying_steps = excluded.qualifying_steps,
       method = excluded.method,
       uncertainty_pct = excluded.uncertainty_pct,
       sample_resolution_sec = excluded.sample_resolution_sec,
       sources_json = excluded.sources_json,
       synced_at = excluded.synced_at,
       status = excluded.status`
  ).run(
    userId,
    date,
    result.totalSteps,
    result.treadmillSteps,
    result.qualifyingSteps,
    result.method,
    result.uncertaintyPct,
    resolution,
    JSON.stringify(result.sources),
    lastSync?.received_at ?? null,
    status
  );

  return {
    date,
    total: result.totalSteps,
    treadmill: result.treadmillSteps,
    qualifying: result.qualifyingSteps,
    method: result.method,
    uncertaintyPct: result.uncertaintyPct,
    sourceTotals: result.sourceTotals,
    status,
  };
}

function computeResolution(samples) {
  const spans = samples
    .map((s) => (new Date(s.end_time) - new Date(s.start_time)) / 1000)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  if (spans.length === 0) return null;
  const median = spans[Math.floor(spans.length / 2)];
  return Math.round(median);
}

export function recentSyncs(userId, limit = 10) {
  return db
    .prepare(`SELECT * FROM health_syncs WHERE user_id = ? ORDER BY received_at DESC LIMIT ?`)
    .all(userId, limit);
}

export function healthWorkouts(userId, limit = 30) {
  return db
    .prepare(`SELECT * FROM health_workouts WHERE user_id = ? ORDER BY start_time DESC LIMIT ?`)
    .all(userId, limit);
}
