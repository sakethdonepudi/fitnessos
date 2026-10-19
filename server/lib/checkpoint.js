import { db, nowIso, audit } from '../db.js';
import {
  adherenceWindow,
  currentGoal,
  healthFreshness,
  mealsByDate,
  nutritionTotals,
  recoveryForRange,
  rollingAverageSeries,
  stepsForDate,
  treadmillMinutes,
  getTreadmillSessions,
  getWeighIns,
  getWorkouts,
} from './metrics.js';
import { STATUS, STATUS_META } from './evidence.js';
import { addDaysKey, todayKey } from './dates.js';
import { sessionStatus } from './treadmill.js';

/**
 * Builds the 11:55 PM checkpoint snapshot from the latest available records.
 *
 * The snapshot is immutable once written. Later reconciliation adds a
 * `reconciled` block and never rewrites the original values, so history stays
 * honest about what was known at the time.
 */
export function buildSnapshot(userId, date, timezone) {
  const profile = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`).get(userId);
  const goal = currentGoal(userId, date);
  const meals = mealsByDate(userId, date, date).get(date) || [];
  const nutrition = nutritionTotals(meals);

  const water = db
    .prepare(`SELECT COALESCE(SUM(ml),0) AS ml FROM water_logs WHERE user_id = ? AND date = ?`)
    .get(userId, date).ml;

  const workouts = getWorkouts(userId, date, date);
  const treadmillSessions = getTreadmillSessions(userId, date, date).map((s) => ({
    ...s,
    evidence: sessionStatus(s),
  }));
  const treadmill = treadmillMinutes(userId, date, date);

  const steps = stepsForDate(userId, date);
  const health = healthFreshness(userId);
  const recovery = recoveryForRange(userId, date, date)[0] || null;

  const weighIns = getWeighIns(userId, { to: date });
  const series = rollingAverageSeries(weighIns);
  const lastWeighIn = weighIns.length ? weighIns[weighIns.length - 1] : null;
  const lastAvg = series.length ? series[series.length - 1] : null;

  // Device-dependent metrics are explicitly downgraded when Health has not synced.
  const stepsStale = !steps || health.stale;
  const stepsStatus = !steps
    ? STATUS.PENDING_SYNC
    : steps.status === 'pending_sync' || health.stale
      ? STATUS.PENDING_SYNC
      : steps.status === 'estimated'
        ? STATUS.AI_ESTIMATED
        : STATUS.VERIFIED_DEVICE;

  const workoutStatus = workouts.length
    ? workouts.some((w) => w.source === 'healthkit' || w.health_workout_id)
      ? STATUS.VERIFIED_DEVICE
      : STATUS.LOGGED_USER
    : STATUS.NOT_RECORDED;

  const treadmillStatus = treadmillSessions.length
    ? treadmillSessions.some((s) => s.evidence === STATUS.VERIFIED_DEVICE)
      ? STATUS.VERIFIED_DEVICE
      : treadmillSessions.some((s) => s.evidence === STATUS.NEEDS_REVIEW)
        ? STATUS.NEEDS_REVIEW
        : STATUS.LOGGED_USER
    : STATUS.NOT_RECORDED;

  const outstanding = [];
  if (health.stale) {
    outstanding.push({
      kind: 'health_sync',
      label: 'Apple Health has not synced recently',
      detail: health.lastSync
        ? `Last sync ${health.lastSync}. Device totals are marked pending.`
        : 'No sync has ever been received.',
    });
  }
  for (const s of treadmillSessions) {
    if (s.console_photo_id && !s.console_confirmed) {
      outstanding.push({
        kind: 'console_review',
        label: `Treadmill console photo needs confirmation (${s.date})`,
        detail: 'Extracted readings are waiting for you to confirm or correct them.',
      });
    }
    if (s.evidence === STATUS.NEEDS_REVIEW) {
      outstanding.push({
        kind: 'treadmill_discrepancy',
        label: 'Console photo and logged treadmill values disagree',
        detail: `Session #${s.id} on ${s.date}.`,
      });
    }
  }

  return {
    date,
    timezone,
    generatedAt: nowIso(),
    profile: profile
      ? {
          startDate: profile.start_date,
          checkpointDate: profile.checkpoint_date,
          heightCm: profile.height_cm,
        }
      : null,
    goal: goal
      ? {
          calories: goal.calories,
          protein: goal.protein_g,
          waterMl: goal.water_ml,
          stepGoal: goal.step_goal,
        }
      : null,
    nutrition: {
      calories: Math.round(nutrition.calories),
      protein: Math.round(nutrition.protein),
      carbs: Math.round(nutrition.carbs),
      fat: Math.round(nutrition.fat),
      mealCount: meals.length,
      status: meals.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
      calorieTarget: goal?.calories ?? null,
      proteinTarget: goal?.protein_g ?? null,
    },
    water: {
      ml: water,
      targetMl: goal?.water_ml ?? null,
      status: water > 0 ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
    },
    workout: {
      count: workouts.length,
      splits: workouts.map((w) => w.split),
      status: workoutStatus,
    },
    treadmill: {
      sessions: treadmillSessions.length,
      minutes: treadmill.minutes,
      status: treadmillStatus,
      detail: treadmillSessions.map((s) => ({
        id: s.id,
        minutes: s.duration_min,
        incline: s.incline_pct,
        speed: s.speed_kmh,
        evidence: s.evidence,
      })),
    },
    steps: {
      total: steps?.total_steps ?? null,
      treadmill: steps?.treadmill_steps ?? null,
      qualifying: steps?.qualifying_steps ?? null,
      method: steps?.method ?? 'none',
      uncertaintyPct: steps?.uncertainty_pct ?? null,
      goal: goal?.step_goal ?? 10000,
      status: stepsStatus,
      pendingBecause: stepsStale ? 'health_not_synced' : null,
    },
    body: {
      weightKg: lastWeighIn?.weight_kg ?? null,
      sevenDayAverage: lastAvg?.rolling ?? null,
      waistCm: lastWeighIn?.waist_cm ?? null,
      bodyFatPct: lastWeighIn?.body_fat_pct ?? null,
      bodyFatSource: lastWeighIn?.body_fat_source ?? null,
      status: lastWeighIn ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
      measuredOn: lastWeighIn?.date ?? null,
    },
    recovery: recovery
      ? {
          sleepHours: recovery.sleep_hours == null ? null : Math.round(recovery.sleep_hours * 10) / 10,
          readiness: recovery.readiness,
          soreness: recovery.soreness,
          status: STATUS.LOGGED_USER,
        }
      : { status: STATUS.NOT_RECORDED },
    health: {
      status: health.status,
      lastSync: health.lastSync,
      stale: health.stale,
    },
    outstanding,
    evidenceSummary: summariseEvidence({
      nutrition: meals.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
      water: water > 0 ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
      workout: workoutStatus,
      treadmill: treadmillStatus,
      steps: stepsStatus,
      body: lastWeighIn ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
    }),
  };
}

function summariseEvidence(statuses) {
  const counts = {};
  for (const status of Object.values(statuses)) {
    counts[status] = (counts[status] || 0) + 1;
  }
  return {
    statuses,
    counts,
    verified: counts[STATUS.VERIFIED_DEVICE] || 0,
    logged: counts[STATUS.LOGGED_USER] || 0,
    pending: counts[STATUS.PENDING_SYNC] || 0,
    review: counts[STATUS.NEEDS_REVIEW] || 0,
  };
}

export function createCheckpoint(userId, date, timezone, { force = false } = {}) {
  const existing = db
    .prepare(`SELECT * FROM daily_checkpoints WHERE user_id = ? AND date = ?`)
    .get(userId, date);
  if (existing && !force) return { created: false, checkpoint: hydrate(existing) };

  const snapshot = buildSnapshot(userId, date, timezone);
  const at = nowIso();

  if (existing) {
    // Force re-run replaces the snapshot only when explicitly requested;
    // the default path is immutable.
    db.prepare(
      `UPDATE daily_checkpoints SET snapshot_json = ?, status = 'final', created_at = ? WHERE id = ?`
    ).run(JSON.stringify(snapshot), at, existing.id);
    audit(userId, 'checkpoint', existing.id, 'recreate', hydrate(existing).snapshot, snapshot);
    return { created: true, checkpoint: hydrate(db.prepare(`SELECT * FROM daily_checkpoints WHERE id = ?`).get(existing.id)) };
  }

  const info = db
    .prepare(
      `INSERT INTO daily_checkpoints (user_id, date, snapshot_json, status, created_at)
       VALUES (?, ?, ?, 'final', ?)`
    )
    .run(userId, date, JSON.stringify(snapshot), at);
  audit(userId, 'checkpoint', info.lastInsertRowid, 'create', null, { date });
  return {
    created: true,
    checkpoint: hydrate(db.prepare(`SELECT * FROM daily_checkpoints WHERE id = ?`).get(info.lastInsertRowid)),
  };
}

export function hydrate(row) {
  if (!row) return null;
  return {
    ...row,
    snapshot: JSON.parse(row.snapshot_json),
    reconciled: row.reconciled_json ? JSON.parse(row.reconciled_json) : null,
  };
}

/**
 * Reconciliation runs later (e.g. after Health syncs) and appends what changed.
 * The original snapshot is never mutated.
 */
export function reconcileCheckpoint(userId, date) {
  const row = db
    .prepare(`SELECT * FROM daily_checkpoints WHERE user_id = ? AND date = ?`)
    .get(userId, date);
  if (!row) return { reconciled: false, reason: 'no_checkpoint' };

  const checkpoint = hydrate(row);
  const fresh = buildSnapshot(userId, date, checkpoint.snapshot.timezone || 'Asia/Kolkata');

  const changes = [];
  const orig = checkpoint.snapshot;

  compare('steps.total', orig.steps?.total, fresh.steps?.total, changes);
  compare('steps.treadmill', orig.steps?.treadmill, fresh.steps?.treadmill, changes);
  compare('steps.qualifying', orig.steps?.qualifying, fresh.steps?.qualifying, changes);
  compare('steps.status', orig.steps?.status, fresh.steps?.status, changes);
  compare('treadmill.minutes', orig.treadmill?.minutes, fresh.treadmill?.minutes, changes);
  compare('workout.count', orig.workout?.count, fresh.workout?.count, changes);
  compare('health.status', orig.health?.status, fresh.health?.status, changes);

  if (changes.length === 0) {
    return { reconciled: false, reason: 'no_changes', checkpoint };
  }

  const reconciled = {
    at: nowIso(),
    changes,
    resolvedStatus: fresh.steps?.status,
    outstanding: fresh.outstanding,
    note: 'Original snapshot preserved. These values were added when delayed records arrived.',
  };

  db.prepare(
    `UPDATE daily_checkpoints SET reconciled_json = ?, reconciled_at = ?, status = 'reconciled'
     WHERE id = ?`
  ).run(JSON.stringify(reconciled), reconciled.at, row.id);

  audit(userId, 'checkpoint', row.id, 'reconcile', null, reconciled);

  return {
    reconciled: true,
    changes,
    checkpoint: hydrate(db.prepare(`SELECT * FROM daily_checkpoints WHERE id = ?`).get(row.id)),
  };
}

function compare(path, before, after, out) {
  const same = JSON.stringify(before) === JSON.stringify(after);
  if (!same) out.push({ path, before: before ?? null, after: after ?? null });
}

export function listCheckpoints(userId, limit = 30) {
  return db
    .prepare(
      `SELECT * FROM daily_checkpoints WHERE user_id = ? ORDER BY date DESC LIMIT ?`
    )
    .all(userId, limit)
    .map(hydrate);
}
