import { localDateKey, addDaysKey, localDayBounds } from '../../shared/dates.js';
import { buildSnapshot, diffSnapshots } from '../../shared/checkpoint.js';
import { adherenceWindow, nutritionTotals, recoveryTrendFromLogs, strengthRetentionFromSessions } from '../../shared/core.js';
import { getRecord, rowToRecord, serverUpsert, audit, listRecords } from './db.js';
import { computeDailySteps } from '../../shared/health.js';
import { nowIso } from './util.js';

const TIMEZONE = 'Asia/Kolkata';

async function query(env, sql, ...binds) {
  const rows = await env.DB.prepare(sql).bind(...binds).all();
  return (rows.results || []).map(rowToRecord).filter(Boolean);
}

async function forDate(env, userId, collections, date) {
  const placeholders = collections.map(() => '?').join(',');
  return query(
    env,
    `SELECT * FROM sync_records
     WHERE user_id = ? AND deleted = 0 AND collection IN (${placeholders})
       AND json_extract(data_json, '$.date') = ?
     ORDER BY updated_at ASC`,
    userId,
    ...collections,
    date
  );
}

async function betweenDates(env, userId, collections, from, to) {
  const placeholders = collections.map(() => '?').join(',');
  return query(
    env,
    `SELECT * FROM sync_records
     WHERE user_id = ? AND deleted = 0 AND collection IN (${placeholders})
       AND json_extract(data_json, '$.date') BETWEEN ? AND ?
     ORDER BY updated_at ASC`,
    userId,
    ...collections,
    from,
    to
  );
}

async function loadContext(env, userId, date) {
  const [profileRows, goalRows, healthImports, weighIns] = await Promise.all([
    query(env, `SELECT * FROM sync_records WHERE user_id = ? AND deleted = 0 AND collection = 'profile' LIMIT 1`, userId),
    listRecords(env, userId, 'goals'),
    query(
      env,
      `SELECT * FROM sync_records WHERE user_id = ? AND deleted = 0 AND collection = 'health_imports'
       ORDER BY server_seq DESC LIMIT 10`,
      userId
    ),
    query(
      env,
      `SELECT * FROM sync_records WHERE user_id = ? AND deleted = 0 AND collection = 'weigh_ins'
       AND json_extract(data_json, '$.date') <= ? ORDER BY json_extract(data_json, '$.date') ASC`,
      userId,
      date
    ),
  ]);

  const profile = profileRows[0]?.data || null;
  const activeGoal =
    goalRows
      .filter((g) => g.data?.effective_from && g.data.effective_from <= date)
      .sort((a, b) => a.data.effective_from.localeCompare(b.data.effective_from))
      .at(-1)?.data || null;
  const lastImport =
    healthImports
      .map((i) => i.data?.received_at || i.data?.synced_at)
      .filter(Boolean)
      .sort()
      .at(-1) || null;

  return { profile, goal: activeGoal, weighIns: weighIns.map((w) => w.data), lastImport };
}

async function buildForDate(env, userId, date) {
  const collections = ['meals', 'water', 'workouts', 'treadmill_sessions', 'steps_daily', 'recovery'];
  const day = localDayBounds(date, TIMEZONE);
  const [daily, ctx, healthSamples, healthWorkoutRows] = await Promise.all([
    forDate(env, userId, collections, date),
    loadContext(env, userId, date),
    query(
      env,
      `SELECT * FROM sync_records WHERE user_id = ? AND deleted = 0
         AND collection = 'health_step_samples'
         AND json_extract(data_json, '$.start_time') < ?
         AND json_extract(data_json, '$.end_time') > ?`,
      userId,
      day.end.toISOString(),
      day.start.toISOString()
    ),
    query(
      env,
      `SELECT * FROM sync_records WHERE user_id = ? AND deleted = 0
         AND collection = 'health_workouts'
         AND json_extract(data_json, '$.start_time') < ?
         AND json_extract(data_json, '$.end_time') > ?`,
      userId,
      day.end.toISOString(),
      day.start.toISOString()
    ),
  ]);
  const healthImported = [...healthSamples, ...healthWorkoutRows];
  const by = (name) => daily.filter((r) => r.collection === name).map((r) => ({ ...r.data, id: r.data.id || r.id }));

  const meals = by('meals');
  const water = by('water').reduce((s, w) => s + (Number(w.ml) || 0), 0);
  let workouts = by('workouts');
  let treadmillSessions = by('treadmill_sessions');
  const samples = healthImported.filter((r) => r.collection === 'health_step_samples').map((r) => r.data);
  const healthWorkoutRecords = healthImported.filter((r) => r.collection === 'health_workouts').map((r) => ({ ...r.data, id: r.data.id || r.id }));

  // Link imported workouts to manually logged sessions before evidence is scored.
  const linked = await linkWorkouts(env, userId, date, workouts, treadmillSessions, healthWorkoutRecords);
  workouts = linked.workouts;
  treadmillSessions = linked.treadmillSessions;

  const computedSteps = computeDailySteps({ samples, sessions: treadmillSessions, date, timezone: TIMEZONE });
  let steps = by('steps_daily')[0] || null;
  if (samples.length > 0) {
    steps = computedSteps;
    // Server-side step accounting is authoritative for the cron snapshot.
    await serverUpsert(env, userId, 'steps_daily', `steps:${date}`, computedSteps);
  }
  const recovery = by('recovery')[0] || null;

  const snapshot = buildSnapshot({
    date,
    timezone: TIMEZONE,
    profile: ctx.profile,
    goal: ctx.goal,
    meals,
    waterMl: water,
    workouts,
    treadmillSessions,
    steps,
    weighIns: ctx.weighIns,
    recovery,
    healthLastImport: ctx.lastImport,
  });
  return { snapshot, ctx, meals, workouts, treadmillSessions, steps, recovery, water };
}

async function linkWorkouts(env, userId, date, workouts, treadmillSessions, healthWorkouts) {
  const nextWorkouts = [...workouts];
  const nextTreadmill = [...treadmillSessions];
  for (const health of healthWorkouts) {
    const start = new Date(health.start_time).getTime();
    const end = new Date(health.end_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const type = String(health.type || '').toLowerCase();
    const isWalk = type.includes('walk') || type.includes('treadmill');
    const isStrength = type.includes('strength');

    if (isWalk) {
      let best = null;
      for (const session of nextTreadmill) {
        if (session.health_workout_id || !session.start_time || !session.end_time) continue;
        const s = new Date(session.start_time).getTime();
        const e = new Date(session.end_time).getTime();
        const overlap = Math.min(end, e) - Math.max(start, s);
        if (overlap <= 0) continue;
        const ratio = overlap / Math.min(end - start, e - s);
        if (ratio >= 0.5 && (!best || overlap > best.overlap)) best = { session, overlap };
      }
      if (best) {
        const updated = {
          ...best.session,
          health_workout_id: health.id || `${health.start_time}`,
          source: 'healthkit',
          duration_min: best.session.duration_min || Math.round((health.duration_sec / 60) * 10) / 10,
          distance_km: best.session.distance_km ?? health.distance_km,
          avg_hr: best.session.avg_hr ?? health.avg_hr,
          max_hr: best.session.max_hr ?? health.max_hr,
          active_calories: best.session.active_calories ?? health.active_calories,
          calories_source: best.session.calories_source || 'healthkit_estimate',
        };
        await serverUpsert(env, userId, 'treadmill_sessions', updated.id, updated);
        const idx = nextTreadmill.findIndex((s) => s.id === updated.id);
        if (idx >= 0) nextTreadmill[idx] = updated;
      }
      continue;
    }

    if (isStrength) {
      const linkedSession = nextWorkouts.find(
        (w) => w.source !== 'healthkit' && !w.health_workout_id
      );
      if (linkedSession) {
        const updated = {
          ...linkedSession,
          health_workout_id: health.id || `${health.start_time}`,
          source: 'healthkit',
          duration_min: linkedSession.duration_min || Math.round((health.duration_sec / 60) * 10) / 10,
        };
        await serverUpsert(env, userId, 'workouts', updated.id, updated);
        const idx = nextWorkouts.findIndex((w) => w.id === updated.id);
        if (idx >= 0) nextWorkouts[idx] = updated;
      } else {
        const id = `health-workout:${date}:${Math.round(start / 1000)}`;
        const created = {
          id,
          date,
          split: 'Imported',
          title: 'Strength training (Apple Health)',
          status: 'completed',
          source: 'healthkit',
          health_workout_id: health.id || `${health.start_time}`,
          duration_min: health.duration_sec ? Math.round((health.duration_sec / 60) * 10) / 10 : null,
          sets: [],
          notes: 'Imported from Apple Health. No sets were recorded in the app.',
        };
        await serverUpsert(env, userId, 'workouts', id, created);
        nextWorkouts.push(created);
      }
    }
  }
  return { workouts: nextWorkouts, treadmillSessions: nextTreadmill };
}

async function upsertCheckpoint(env, userId, date, scheduledFor, { forceReconcile = false, createIfMissing = true } = {}) {
  const id = `checkpoint:${date}`;
  const existing = await getRecord(env, userId, id);
  if (!existing && !createIfMissing) {
    return { created: false, reconciled: false, skipped: true, changes: [] };
  }
  const { snapshot } = await buildForDate(env, userId, date);
  const at = nowIso();

  if (!existing) {
    await serverUpsert(env, userId, 'checkpoints', id, {
      date,
      source: 'cron',
      scheduled_for: scheduledFor,
      executed_at: at,
      status: 'final',
      snapshot,
      reconciled: null,
    });
    return { created: true, reconciled: false, changes: [] };
  }

  const original = existing.data?.snapshot || existing.data?.snapshot_json || null;
  const changes = original ? diffSnapshots(original, snapshot) : [];
  const reconciled = existing.data?.reconciled || null;
  const alreadySame = reconciled ? reconciled.changes?.length === changes.length && changes.length === 0 : changes.length === 0;

  if (alreadySame && !forceReconcile) {
    return { created: false, reconciled: false, changes: [] };
  }
  if (changes.length === 0) {
    return { created: false, reconciled: false, changes: [] };
  }

  await serverUpsert(env, userId, 'checkpoints', id, {
    ...existing.data,
    status: 'reconciled',
    // The original snapshot is preserved exactly as it was.
    snapshot: original,
    reconciled: {
      at,
      scheduled_for: scheduledFor,
      changes,
      note: 'Original snapshot preserved. Values appended when delayed records arrived.',
    },
    last_checked_at: at,
  });
  return { created: false, reconciled: true, changes };
}

async function buildWeeklySummary(env, userId, date) {
  const from = addDaysKey(date, -6);
  const daily = await betweenDates(env, userId, ['meals', 'treadmill_sessions', 'steps_daily', 'weigh_ins'], from, date);
  const ctx = await loadContext(env, userId, date);
  const meals = daily.filter((r) => r.collection === 'meals').map((r) => r.data);
  const tread = daily.filter((r) => r.collection === 'treadmill_sessions').map((r) => r.data);
  const steps = daily.filter((r) => r.collection === 'steps_daily').map((r) => r.data);
  const weighIns = ctx.weighIns;
  const workouts = await betweenDates(env, userId, ['workouts'], from, date);
  const recoveryRows = await betweenDates(env, userId, ['recovery'], from, date);

  const adherence = adherenceWindow({ meals, goal: ctx.goal, from, to: date });
  const weeklyTreadmill = tread.reduce((s, t) => s + (t.duration_min || 0), 0);
  const weeklySteps = steps.reduce((s, x) => s + (x.qualifying_steps || 0), 0);
  const strength = strengthRetentionFromSessions(
    workouts.map((r) => ({ ...r.data, sets: r.data.sets || [] })),
    { today: date, startDate: ctx.profile?.start_date || date }
  );
  const recovery = recoveryTrendFromLogs(recoveryRows.map((r) => r.data));

  // Logging streak: consecutive days ending at `date` with any recorded activity.
  let streak = 0;
  for (let i = 0; i < 120; i += 1) {
    const d = addDaysKey(date, -i);
    const dayRecords = await forDate(env, userId, ['meals', 'water', 'workouts', 'treadmill_sessions', 'weigh_ins'], d);
    if (!dayRecords.length) break;
    streak += 1;
  }

  const totals = nutritionTotals(meals);
  const data = {
    date,
    week_start: from,
    generated_at: nowIso(),
    calories: Math.round(totals.calories),
    protein: Math.round(totals.protein),
    treadmill_minutes: Math.round(weeklyTreadmill),
    qualifying_steps: weeklySteps,
    calorie_adherence_pct: adherence.calorieAdherencePct,
    protein_consistency_pct: adherence.proteinConsistencyPct,
    logged_days: adherence.loggedDays,
    strength,
    recovery,
    streak_days: streak,
  };
  await serverUpsert(env, userId, 'summaries', `summary:${date}`, data);
  return data;
}

/**
 * Runs the 11:55 PM IST checkpoint. Once per cron fire, idempotent.
 * Also reconciles the previous two days so delayed HealthKit uploads are folded
 * into history without rewriting the original snapshot.
 */
export async function runCloseout(env, { scheduledTime = Date.now(), manualDates = null } = {}) {
  const scheduledFor = new Date(scheduledTime).toISOString();
  const runKey = manualDates ? `manual:${scheduledFor}` : scheduledFor;

  const existing = await env.DB.prepare(`SELECT * FROM cron_runs WHERE scheduled_for = ?`).bind(runKey).first();
  if (existing && existing.status === 'ok') {
    return { skipped: true, run: existing };
  }

  const startedAt = nowIso();
  if (!existing) {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO cron_runs (scheduled_for, started_at, status) VALUES (?, ?, 'running')`
    ).bind(runKey, startedAt).run();
  } else {
    await env.DB.prepare(`UPDATE cron_runs SET started_at = ?, status = 'running' WHERE scheduled_for = ?`)
      .bind(startedAt, runKey)
      .run();
  }

  try {
    const users = await env.DB.prepare(`SELECT id FROM users`).all();
    let processed = 0;
    const details = [];
    for (const user of users.results || []) {
      const date = manualDates?.[0] || localDateKey(new Date(scheduledTime), TIMEZONE);
      const dates = manualDates || [date, addDaysKey(date, -1), addDaysKey(date, -2)];
      for (const d of dates) {
        const createIfMissing = !!manualDates || d === date;
        const result = await upsertCheckpoint(env, user.id, d, scheduledFor, {
          forceReconcile: !!manualDates,
          createIfMissing,
        });
        details.push({ date: d, ...result });
        if (!result.skipped) await buildWeeklySummary(env, user.id, d);
      }
      processed += 1;
    }
    const finishedAt = nowIso();
    await env.DB.prepare(
      `UPDATE cron_runs SET finished_at = ?, status = 'ok', detail = ?, users_processed = ? WHERE scheduled_for = ?`
    ).bind(finishedAt, JSON.stringify(details).slice(0, 4000), processed, runKey).run();
    return { ok: true, scheduledFor, startedAt, finishedAt, processed, details };
  } catch (err) {
    await env.DB.prepare(
      `UPDATE cron_runs SET finished_at = ?, status = 'error', detail = ? WHERE scheduled_for = ?`
    ).bind(nowIso(), String(err?.stack || err).slice(0, 4000), runKey).run();
    throw err;
  }
}

export async function listCronRuns(env, limit = 20) {
  const rows = await env.DB.prepare(`SELECT * FROM cron_runs ORDER BY started_at DESC LIMIT ?`).bind(limit).all();
  return rows.results || [];
}
