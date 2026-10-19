import { addDaysKey, daysBetween, isStale } from './dates.js';
import { STATUS } from './core.js';
import { rollingAverageSeries } from './core.js';

/**
 * Builds the daily checkpoint snapshot from plain records.
 * Shared by the browser fallback and the Cloudflare cron handler.
 */
export function buildSnapshot({
  date,
  timezone = 'Asia/Kolkata',
  profile,
  goal,
  meals = [],
  waterMl = 0,
  workouts = [],
  treadmillSessions = [],
  steps,
  weighIns = [],
  recovery,
  healthLastImport,
}) {
  const totals = meals.reduce(
    (acc, m) => {
      acc.calories += m.calories || 0;
      acc.protein += m.protein_g || 0;
      acc.carbs += m.carbs_g || 0;
      acc.fat += m.fat_g || 0;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );

  const healthStale = !healthLastImport || isStale(healthLastImport, 36);
  const stepsStatus = !steps
    ? STATUS.PENDING_SYNC
    : healthStale
      ? STATUS.PENDING_SYNC
      : steps.status === 'estimated'
        ? STATUS.AI_ESTIMATED
        : STATUS.VERIFIED_DEVICE;

  const workoutStatus = workouts.length
    ? workouts.some((w) => w.health_workout_id) ? STATUS.VERIFIED_DEVICE : STATUS.LOGGED_USER
    : STATUS.NOT_RECORDED;

  const treadmillStatus = treadmillSessions.length
    ? treadmillSessions.some((s) => s.health_workout_id)
      ? STATUS.VERIFIED_DEVICE
      : treadmillSessions.some((s) => s.console_photo_id && !s.console_confirmed)
        ? STATUS.NEEDS_REVIEW
        : STATUS.LOGGED_USER
    : STATUS.NOT_RECORDED;

  const weighInsUpTo = [...weighIns].filter((w) => w.date <= date).sort((a, b) => a.date.localeCompare(b.date));
  const latestWeighIn = weighInsUpTo.length ? weighInsUpTo[weighInsUpTo.length - 1] : null;
  const series = rollingAverageSeries(weighInsUpTo);
  const lastAverage = series.length ? series[series.length - 1] : null;

  const outstanding = [];
  if (healthStale) {
    outstanding.push({
      kind: 'health_sync',
      label: 'No recent Apple Health sync',
      detail: healthLastImport
        ? `Last import ${healthLastImport}. Device totals are pending.`
        : 'No Apple Health import has been received.',
    });
  }
  for (const session of treadmillSessions) {
    if (session.console_photo_id && !session.console_confirmed) {
      outstanding.push({
        kind: 'console_review',
        label: `Treadmill console photo needs confirmation (${session.date})`,
        detail: 'Extracted readings are waiting for confirmation.',
      });
    }
    if (session.discrepancy) {
      outstanding.push({
        kind: 'treadmill_discrepancy',
        label: 'Console photo and logged treadmill values disagree',
        detail: `Session ${session.title || session.id} on ${session.date}.`,
      });
    }
  }

  const statuses = {
    nutrition: meals.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
    water: waterMl > 0 ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
    workout: workoutStatus,
    treadmill: treadmillStatus,
    steps: stepsStatus,
    body: latestWeighIn ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
  };
  const counts = {};
  for (const status of Object.values(statuses)) counts[status] = (counts[status] || 0) + 1;

  return {
    date,
    timezone,
    generatedAt: new Date().toISOString(),
    profile: profile
      ? { startDate: profile.start_date, checkpointDate: profile.checkpoint_date, heightCm: profile.height_cm }
      : null,
    goal: goal
      ? { calories: goal.calories, protein: goal.protein_g, waterMl: goal.water_ml, stepGoal: goal.step_goal }
      : null,
    nutrition: {
      calories: Math.round(totals.calories),
      protein: Math.round(totals.protein),
      carbs: Math.round(totals.carbs),
      fat: Math.round(totals.fat),
      mealCount: meals.length,
      status: statuses.nutrition,
      calorieTarget: goal?.calories ?? null,
      proteinTarget: goal?.protein_g ?? null,
    },
    water: {
      ml: waterMl,
      targetMl: goal?.water_ml ?? null,
      status: statuses.water,
    },
    workout: {
      count: workouts.length,
      splits: workouts.map((w) => w.split),
      status: workoutStatus,
    },
    treadmill: {
      sessions: treadmillSessions.length,
      minutes: treadmillSessions.reduce((s, t) => s + (t.duration_min || 0), 0),
      status: treadmillStatus,
      detail: treadmillSessions.map((s) => ({
        id: s.id,
        minutes: s.duration_min,
        incline: s.incline_pct,
        speed: s.speed_kmh,
        evidence: s.health_workout_id ? STATUS.VERIFIED_DEVICE : s.console_photo_id ? STATUS.NEEDS_REVIEW : STATUS.LOGGED_USER,
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
      pendingBecause: healthStale ? 'health_not_synced' : null,
    },
    body: {
      weightKg: latestWeighIn?.weight_kg ?? null,
      sevenDayAverage: lastAverage?.rolling ?? null,
      waistCm: latestWeighIn?.waist_cm ?? null,
      bodyFatPct: latestWeighIn?.body_fat_pct ?? null,
      bodyFatSource: latestWeighIn?.body_fat_source ?? null,
      status: latestWeighIn ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
      measuredOn: latestWeighIn?.date ?? null,
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
      status: healthStale ? STATUS.PENDING_SYNC : STATUS.VERIFIED_DEVICE,
      lastSync: healthLastImport || null,
      stale: healthStale,
    },
    outstanding,
    evidenceSummary: {
      statuses,
      counts,
      verified: counts[STATUS.VERIFIED_DEVICE] || 0,
      logged: counts[STATUS.LOGGED_USER] || 0,
      pending: counts[STATUS.PENDING_SYNC] || 0,
      review: counts[STATUS.NEEDS_REVIEW] || 0,
    },
  };
}

export function diffSnapshots(original, fresh) {
  const changes = [];
  const paths = [
    ['steps.total', original.steps?.total, fresh.steps?.total],
    ['steps.treadmill', original.steps?.treadmill, fresh.steps?.treadmill],
    ['steps.qualifying', original.steps?.qualifying, fresh.steps?.qualifying],
    ['steps.status', original.steps?.status, fresh.steps?.status],
    ['treadmill.minutes', original.treadmill?.minutes, fresh.treadmill?.minutes],
    ['workout.count', original.workout?.count, fresh.workout?.count],
    ['health.status', original.health?.status, fresh.health?.status],
    ['nutrition.calories', original.nutrition?.calories, fresh.nutrition?.calories],
    ['water.ml', original.water?.ml, fresh.water?.ml],
  ];
  for (const [path, before, after] of paths) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      changes.push({ path, before: before ?? null, after: after ?? null });
    }
  }
  return changes;
}

export function programWindow(profile, today) {
  const start = profile?.start_date || today;
  const checkpoint = profile?.checkpoint_date || '2026-12-01';
  const total = Math.max(1, daysBetween(start, checkpoint));
  const elapsed = Math.min(total, Math.max(0, daysBetween(start, today)));
  return {
    start,
    checkpoint,
    totalDays: total,
    elapsedDays: elapsed,
    remainingDays: Math.max(0, total - elapsed),
    pct: Math.round((elapsed / total) * 100),
  };
}

export function lastNDates(today, n) {
  return Array.from({ length: n }, (_, i) => addDaysKey(today, -(n - 1 - i)));
}
