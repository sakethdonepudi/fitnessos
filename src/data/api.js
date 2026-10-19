import {
  listRecords,
  getRecord,
  putRecord,
  patchRecord,
  removeRecord,
  seedDefaults,
  uid,
  nowIso,
  db,
  audit,
  metaGet,
  metaSet,
} from './db.js';
import {
  STATUS,
  STATUS_META,
  EVIDENCE_REQUIREMENTS,
  adherenceWindow,
  coach,
  nutritionTotals,
  projectWeight,
  recoveryTrendFromLogs,
  rollingAverageSeries,
  strengthRetentionFromSessions,
  WEEKLY_CARDIO_PLAN,
  cardioProgression,
  DEFAULT_PRESET_BLOCKS,
  round,
  programProgress,
} from '../../shared/core.js';
import { addDaysKey, eachDate, todayKey, weekStartKey, isStale, localDateKey, tzOffsetMinutes } from '../../shared/dates.js';
import { buildSnapshot, diffSnapshots } from '../../shared/checkpoint.js';
import { computeDailySteps } from '../../shared/health.js';
import { requestSync } from './sync.js';
import { getPhotoStorageMode } from './remote.js';

const TZ = 'Asia/Kolkata';

function shape(record) {
  if (!record) return null;
  return { ...record.data, id: record.id };
}

function dayKey(date = new Date(), timezone = TZ) {
  return localDateKey(date, timezone);
}

async function profile() {
  return getRecord('profile', 'profile');
}

async function goals() {
  const rows = await listRecords('goals');
  return rows
    .filter((g) => g.effective_from)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from));
}

async function currentGoal(date) {
  const all = await goals();
  return all.filter((g) => g.effective_from <= date).at(-1) || all[0] || null;
}

async function mealsFor(dateFrom, dateTo = dateFrom) {
  const rows = await listRecords('meals');
  return rows.filter((m) => m.date >= dateFrom && m.date <= dateTo).sort((a, b) => a.created_at?.localeCompare(b.created_at || '') || 0);
}

async function waterFor(date) {
  const rows = await listRecords('water');
  return rows.filter((w) => w.date === date);
}

async function workoutsFor(from, to) {
  const rows = await listRecords('workouts');
  return rows
    .filter((w) => w.date >= from && w.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((w) => ({ ...w, sets: w.sets || [] }));
}

async function treadmillFor(from, to) {
  const rows = await listRecords('treadmill_sessions');
  return rows
    .filter((s) => s.date >= from && s.date <= to)
    .sort((a, b) => (a.date + (a.start_time || '')).localeCompare(b.date + (b.start_time || '')));
}

async function weighInsAll() {
  return (await listRecords('weigh_ins')).sort((a, b) => a.date.localeCompare(b.date));
}

async function stepsFor(date) {
  return getRecord('steps_daily', `steps:${date}`);
}

async function recoveryFor(date) {
  return getRecord('recovery', `recovery:${date}`);
}

async function healthImports() {
  return (await listRecords('health_imports')).sort((a, b) => (a.received_at || '').localeCompare(b.received_at || ''));
}

async function healthSamples() {
  return listRecords('health_step_samples');
}

async function healthWorkouts() {
  return listRecords('health_workouts');
}

export async function lastHealthImport() {
  const imports = await healthImports();
  const latest = imports.at(-1);
  return latest?.received_at || latest?.synced_at || null;
}

function sessionEvidence(session) {
  if (session.status === 'skipped') return STATUS.NOT_RECORDED;
  if (session.health_workout_id) return STATUS.VERIFIED_DEVICE;
  if (session.console_photo_id && !session.console_confirmed) return STATUS.NEEDS_REVIEW;
  return STATUS.LOGGED_USER;
}

async function decorateSessions(sessions) {
  const imports = await healthImports();
  const importedAt = new Map(
    imports
      .filter((i) => i.device_id)
      .map((i) => [i.id, i.received_at])
  );
  return sessions.map((s) => ({
    ...s,
    evidence: sessionEvidence(s),
    health_imported_at: s.health_workout_id ? importedAt.get(s.health_workout_id) || null : null,
  }));
}

async function treadmillTotals(from, to) {
  const rows = await treadmillFor(from, to);
  const live = rows.filter((s) => s.status !== 'skipped');
  return {
    minutes: Math.round(live.reduce((s, t) => s + (t.duration_min || 0), 0)),
    distance: round(live.reduce((s, t) => s + (t.distance_km || 0), 0), 2),
    sessions: live.length,
    calories: Math.round(live.reduce((s, t) => s + (t.active_calories || 0), 0)),
  };
}

async function recoveryRowsFor(from, to) {
  return (await listRecords('recovery')).filter((r) => r.date >= from && r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
}

export async function recomputeSteps(date) {
  const [samples, sessions, existing] = await Promise.all([
    healthSamples(),
    treadmillFor(date, date),
    stepsFor(date),
  ]);
  const result = computeDailySteps({ samples, sessions, date, timezone: TZ });
  if (!samples.length) return existing || null;
  const row = await putRecord('steps_daily', { ...result, synced_at: await lastHealthImport() }, { id: `steps:${date}` });
  requestSync();
  return row;
}

async function linkHealthData() {
  const [workouts, treadSessions, healthW] = await Promise.all([
    listRecords('workouts'),
    listRecords('treadmill_sessions'),
    healthWorkouts(),
  ]);
  const affected = new Set();
  for (const health of healthW) {
    if (!health.start_time || !health.end_time) continue;
    const start = new Date(health.start_time).getTime();
    const end = new Date(health.end_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const date = dayKey(new Date(health.start_time));
    const type = String(health.type || '').toLowerCase();
    if (type.includes('walk') || type.includes('treadmill')) {
      const candidates = treadSessions.filter(
        (s) => s.date === date && !s.health_workout_id && s.start_time && s.end_time
      );
      let best = null;
      for (const session of candidates) {
        const s = new Date(session.start_time).getTime();
        const e = new Date(session.end_time).getTime();
        const overlap = Math.min(end, e) - Math.max(start, s);
        if (overlap <= 0) continue;
        const ratio = overlap / Math.min(end - start, e - s);
        if (ratio >= 0.5 && (!best || overlap > best.overlap)) best = { session, overlap };
      }
      if (best) {
        await putRecord(
          'treadmill_sessions',
          {
            ...best.session,
            health_workout_id: health.id,
            source: 'healthkit',
            duration_min: best.session.duration_min || round(health.duration_sec / 60, 1),
            distance_km: best.session.distance_km ?? health.distance_km,
            avg_hr: best.session.avg_hr ?? health.avg_hr,
            max_hr: best.session.max_hr ?? health.max_hr,
            active_calories: best.session.active_calories ?? health.active_calories,
            calories_source: best.session.calories_source || 'healthkit_estimate',
          },
          { id: best.session.id }
        );
        affected.add(date);
        const linkedIdx = treadSessions.findIndex((s) => s.id === best.session.id);
        if (linkedIdx >= 0) treadSessions[linkedIdx] = { ...treadSessions[linkedIdx], health_workout_id: health.id };
      }
    }
    if (type.includes('strength')) {
      const existing = workouts.find((w) => w.date === date && !w.health_workout_id && w.source !== 'healthkit');
      if (existing) {
        await putRecord(
          'workouts',
          {
            ...existing,
            health_workout_id: health.id,
            source: 'healthkit',
            duration_min: existing.duration_min || round(health.duration_sec / 60, 1),
          },
          { id: existing.id }
        );
        affected.add(date);
        const linkedWorkoutIdx = workouts.findIndex((w) => w.id === existing.id);
        if (linkedWorkoutIdx >= 0) workouts[linkedWorkoutIdx] = { ...workouts[linkedWorkoutIdx], health_workout_id: health.id };
      } else {
        await putRecord(
          'workouts',
          {
            date,
            split: 'Imported',
            title: 'Strength training (Apple Health)',
            status: 'completed',
            source: 'healthkit',
            health_workout_id: health.id,
            duration_min: health.duration_sec ? round(health.duration_sec / 60, 1) : null,
            sets: [],
            notes: 'Imported from Apple Health. No sets were recorded in the app.',
            created_at: nowIso(),
          },
          { id: `health-workout:${date}:${Math.round(start / 1000)}` }
        );
        affected.add(date);
      }
    }
  }
  for (const date of affected) await recomputeSteps(date);
  return [...affected];
}

async function gatherDay(date) {
  const [p, goal, meals, water, workouts, tread, steps, recovery, weighIns, imported] = await Promise.all([
    profile(),
    currentGoal(date),
    mealsFor(date),
    waterFor(date),
    workoutsFor(date, date),
    treadmillFor(date, date),
    stepsFor(date),
    recoveryFor(date),
    weighInsAll(),
    lastHealthImport(),
  ]);
  return { p, goal, meals, water, workouts, tread, steps, recovery, weighIns, imported };
}

export async function createCheckpoint(date, { force = false, source = 'client', reconstructed = false } = {}) {
  const id = `checkpoint:${date}`;
  const existing = await getRecord('checkpoints', id);
  const { p, goal, meals, water, workouts, tread, steps, recovery, weighIns, imported } = await gatherDay(date);
  const snapshot = buildSnapshot({
    date,
    timezone: TZ,
    profile: p,
    goal,
    meals,
    waterMl: water.reduce((s, w) => s + (w.ml || 0), 0),
    workouts,
    treadmillSessions: tread.map((s) => ({ ...s, discrepancy: s.console_discrepancy || false })),
    steps,
    weighIns,
    recovery,
    healthLastImport: imported,
  });

  if (existing) {
    const original = existing.snapshot || existing.snapshot_json;
    const changes = original ? diffSnapshots(original, snapshot) : [];
    if (!changes.length && !force) return { created: false, checkpoint: existing };
    await putRecord(
      'checkpoints',
      {
        ...existing,
        status: 'reconciled',
        snapshot: original,
        reconciled: {
          at: nowIso(),
          changes,
          note: 'Original snapshot preserved. Values appended when delayed records arrived.',
        },
        last_checked_at: nowIso(),
      },
      { id }
    );
    return { created: false, reconciled: true, changes, checkpoint: await getRecord('checkpoints', id) };
  }

  const scheduled = `${date}T23:55:00+05:30`;
  const row = await putRecord(
    'checkpoints',
    {
      date,
      source,
      reconstructed,
      reconstructed_at: reconstructed ? nowIso() : null,
      scheduled_for: scheduled,
      executed_at: nowIso(),
      status: 'final',
      snapshot,
      reconciled: null,
    },
    { id }
  );
  await audit('checkpoint.create', 'checkpoints', { date, source, reconstructed });
  requestSync();
  return { created: true, checkpoint: row };
}

export async function reconcileCheckpoint(date) {
  const existing = await getRecord('checkpoints', `checkpoint:${date}`);
  if (!existing) return { reconciled: false, reason: 'no_checkpoint' };
  return createCheckpoint(date, { source: existing.source || 'client' });
}

function evidenceFor(date, { p, goal, meals, water, workouts, tread, steps, recovery, weighIns, imported }) {
  const stale = !imported || isStale(imported, 36);
  const stepsStatus = !steps ? STATUS.PENDING_SYNC : stale ? STATUS.PENDING_SYNC : steps.status === 'estimated' ? STATUS.AI_ESTIMATED : STATUS.VERIFIED_DEVICE;
  const workoutStatus = workouts.length
    ? workouts.some((w) => w.health_workout_id) ? STATUS.VERIFIED_DEVICE : STATUS.LOGGED_USER
    : STATUS.NOT_RECORDED;
  const treadmillStatus = tread.length
    ? tread.some((s) => s.health_workout_id)
      ? STATUS.VERIFIED_DEVICE
      : tread.some((s) => s.console_photo_id && !s.console_confirmed)
        ? STATUS.NEEDS_REVIEW
        : STATUS.LOGGED_USER
    : STATUS.NOT_RECORDED;
  return {
    date,
    requirements: EVIDENCE_REQUIREMENTS,
    statusMeta: STATUS_META,
    goals: {
      nutrition: { status: meals.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED, detail: `${meals.length} meal${meals.length === 1 ? '' : 's'} logged` },
      water: { status: water.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED, detail: `${water.reduce((s, w) => s + w.ml, 0)} ml logged, self-reported` },
      workout: { status: workoutStatus, detail: workouts.length ? `${workouts.length} session(s)` : 'No session logged' },
      treadmill: {
        status: treadmillStatus,
        detail: tread.length ? `${tread.reduce((s, t) => s + (t.duration_min || 0), 0)} min logged` : 'No treadmill session logged',
      },
      steps: {
        status: stepsStatus,
        detail: steps
          ? `${steps.qualifying_steps} qualifying · ${steps.treadmill_steps} treadmill · ${steps.total_steps} total`
          : 'No Apple Health import covers today',
      },
      bodyweight: {
        status: weighIns.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
        detail: weighIns.length ? `${weighIns.at(-1).weight_kg} kg on ${weighIns.at(-1).date}` : 'No weigh-in yet',
      },
    },
    health: { status: stale ? STATUS.PENDING_SYNC : STATUS.VERIFIED_DEVICE, lastSync: imported, stale },
  };
}

async function bootstrap() {
  const today = todayKey(TZ);
  const [p, goal, allGoals, steps, meals, water, workouts, tread, weighIns, imported, health] = await Promise.all([
    profile(),
    currentGoal(today),
    goals(),
    stepsFor(today),
    mealsFor(today),
    waterFor(today),
    workoutsFor(today, today),
    treadmillFor(today, today),
    weighInsAll(),
    lastHealthImport(),
    healthImports(),
  ]);
  if (!p) {
    const err = new Error('No profile yet');
    err.status = 401;
    throw err;
  }
  const nutrition = nutritionTotals(meals);
  const decorated = await decorateSessions(tread);
  const recoveryRows = await recoveryRowsFor(addDaysKey(today, -27), today);
  const recovery = recoveryTrendFromLogs(recoveryRows);
  const strength = strengthRetentionFromSessions(workouts, { today, startDate: p?.start_date || today });
  const coachOut = coach({
    profile: p,
    goal,
    weighIns,
    workouts,
    recoveryRows,
    meals: await mealsFor(addDaysKey(today, -6), today),
    today,
  });
  return {
    today,
    timezone: TZ,
    user: { id: 1, name: p?.name || 'Owner', email: null, isDemo: false },
    profile: p,
    goal,
    goals: allGoals,
    steps: steps || { total_steps: null, treadmill_steps: null, qualifying_steps: null, method: 'none', uncertainty_pct: 0, status: 'pending_sync' },
    health: { status: !imported ? STATUS.PENDING_SYNC : isStale(imported, 36) ? STATUS.PENDING_SYNC : STATUS.VERIFIED_DEVICE, lastSync: imported, stale: !imported || isStale(imported, 36), source: health.at(-1)?.source || null },
    nutrition: { totals: { calories: Math.round(nutrition.calories), protein: Math.round(nutrition.protein), carbs: Math.round(nutrition.carbs), fat: Math.round(nutrition.fat) }, meals, status: meals.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED },
    water: { ml: water.reduce((s, w) => s + w.ml, 0), target: goal?.water_ml ?? 3250, status: water.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED },
    workout: { sessions: workouts, status: workouts.length ? (workouts.some((w) => w.health_workout_id) ? STATUS.VERIFIED_DEVICE : STATUS.LOGGED_USER) : STATUS.NOT_RECORDED },
    treadmill: { sessions: decorated, totals: await treadmillTotals(today, today) },
    weight: { latest: weighIns.at(-1) || null, series: rollingAverageSeries(weighIns), projection: projectWeight({ weighIns, checkpointDate: p?.checkpoint_date || '2026-12-01', today }), status: weighIns.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED },
    strength,
    recovery,
    coach: coachOut,
    progress: programProgress(p?.start_date || today, p?.checkpoint_date || '2026-12-01', today),
    statusMeta: STATUS_META,
    evidenceRequirements: EVIDENCE_REQUIREMENTS,
    ocrAvailable: false,
    nextCloseout: nextCloseoutIso(),
  };
}

function nextCloseoutIso() {
  const now = new Date();
  const offset = tzOffsetMinutes(now, TZ) * 60_000;
  const local = new Date(now.getTime() + offset);
  let targetLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 23, 55, 0);
  if (targetLocal - offset <= now.getTime()) targetLocal += 86_400_000;
  return new Date(targetLocal - offset).toISOString();
}

async function transformation() {
  const today = todayKey(TZ);
  const [p, goal, allGoals, weighIns, imported, workouts, tread, stepToday, recoveryRows] = await Promise.all([
    profile(),
    currentGoal(today),
    goals(),
    weighInsAll(),
    lastHealthImport(),
    workoutsFor(addDaysKey(today, -90), today),
    treadmillFor(addDaysKey(today, -90), today),
    stepsFor(today),
    recoveryRowsFor(addDaysKey(today, -27), today),
  ]);
  const startDate = p?.start_date || today;
  const checkpoint = p?.checkpoint_date || '2026-12-01';
  const series = rollingAverageSeries(weighIns);
  const projection = projectWeight({ weighIns, checkpointDate: checkpoint, today });
  const strength = strengthRetentionFromSessions(workouts, { today, startDate });
  const latest = weighIns.at(-1) || null;
  const latestBodyFat = [...weighIns].reverse().find((w) => w.body_fat_pct != null) || null;
  const totalWeeks = Math.ceil((new Date(checkpoint).getTime() - new Date(startDate).getTime()) / (7 * 86_400_000));
  const mealsWeek = await mealsFor(addDaysKey(today, -6), today);
  const allMeals = await mealsFor(addDaysKey(startDate, -7), today);
  const weeks = [];
  for (let i = 0; i < totalWeeks; i += 1) {
    const start = addDaysKey(startDate, i * 7);
    const end = addDaysKey(start, 6);
    const weekWeigh = weighIns.filter((w) => w.date >= start && w.date <= end);
    const weekMeals = allMeals.filter((m) => m.date >= start && m.date <= end);
    const weekTread = tread.filter((t) => t.date >= start && t.date <= end);
    const weekRec = recoveryRows.filter((r) => r.date >= start && r.date <= end);
    const adherence = adherenceWindow({ meals: weekMeals, goal, from: start, to: end > today ? today : end });
    weeks.push({
      week: i + 1,
      start,
      end,
      isCurrent: today >= start && today <= end,
      isFuture: start > today,
      weightAvg: weekWeigh.length ? round(weekWeigh.reduce((s, w) => s + w.weight_kg, 0) / weekWeigh.length, 1) : null,
      waist: weekWeigh.find((w) => w.waist_cm != null)?.waist_cm ?? null,
      calories: adherence.calorieAdherencePct,
      protein: adherence.proteinConsistencyPct,
      loggedDays: adherence.loggedDays,
      treadmillMinutes: Math.round(weekTread.reduce((s, t) => s + (t.duration_min || 0), 0)),
      sleep: weekRec.filter((r) => r.sleep_hours != null).length
        ? round(weekRec.reduce((s, r) => s + (r.sleep_hours || 0), 0) / weekRec.filter((r) => r.sleep_hours != null).length, 1)
        : null,
      readiness: weekRec.filter((r) => r.readiness != null).length
        ? round(weekRec.reduce((s, r) => s + (r.readiness || 0), 0) / weekRec.filter((r) => r.readiness != null).length, 1)
        : null,
    });
  }
  const photos = (await listRecords('progress_photos')).sort((a, b) => a.week_start.localeCompare(b.week_start));
  const coachOut = coach({
    profile: p,
    goal,
    weighIns,
    workouts,
    recoveryRows,
    meals: mealsWeek,
    today,
  });
  return {
    startDate,
    checkpoint,
    today,
    profile: p,
    goal,
    goals: allGoals,
    first: weighIns[0] || null,
    latest,
    latestBodyFat,
    series,
    projection,
    strength,
    weeks,
    photos,
    progress: programProgress(startDate, checkpoint, today),
    coach: coachOut,
    adherence: adherenceWindow({ meals: mealsWeek, goal, from: addDaysKey(today, -6), to: today }),
    treadmill: await treadmillTotals(addDaysKey(today, -6), today),
    steps: stepToday,
    recovery: recoveryTrendFromLogs(recoveryRows),
    health: { status: !imported ? STATUS.PENDING_SYNC : isStale(imported, 36) ? STATUS.PENDING_SYNC : STATUS.VERIFIED_DEVICE, lastSync: imported, stale: !imported || isStale(imported, 36) },
  };
}

async function treadmillSchedule() {
  const today = todayKey(TZ);
  const p = await profile();
  const goal = await currentGoal(today);
  const sessions = await treadmillFor(addDaysKey(today, -6), today);
  const weekStart = weekStartKey(today);
  const days = WEEKLY_CARDIO_PLAN.map((day) => {
    const offset = (day.dow + 6) % 7;
    const date = addDaysKey(weekStart, offset);
    const daySessions = sessions.filter((s) => s.date === date);
    const completedMinutes = daySessions.reduce((s, x) => s + (x.duration_min || 0), 0);
    return { ...day, date, isToday: date === today, completedMinutes, sessions: daySessions, met: daySessions.length > 0 && completedMinutes >= day.minMinutes };
  });
  const weeks = [];
  for (let i = 5; i >= 0; i -= 1) {
    const start = addDaysKey(weekStart, -7 * i);
    const end = addDaysKey(start, 6);
    const totals = await treadmillTotals(start, end > today ? today : end);
    weeks.push({ weekStart: start, minutes: totals.minutes, sessions: totals.sessions, prescribedMinutes: WEEKLY_CARDIO_PLAN.filter((d) => !d.optional).reduce((s, d) => s + d.minMinutes, 0) });
  }
  return {
    weekStart,
    today,
    days,
    progression: cardioProgression(weeks),
    totals: await treadmillTotals(weekStart, today),
    goal,
    startDate: p?.start_date,
  };
}

async function treadmillWeekly() {
  const today = todayKey(TZ);
  const weeks = [];
  for (let i = 7; i >= 0; i -= 1) {
    const start = addDaysKey(weekStartKey(today), -7 * i);
    const end = addDaysKey(start, 6);
    weeks.push({ start, end, ...(await treadmillTotals(start, end > today ? today : end)) });
  }
  return { weeks };
}

async function presets() {
  await seedDefaults();
  return (await listRecords('treadmill_presets'))
    .map((p) => ({
      ...p,
      blocks: Array.isArray(p.blocks) ? p.blocks : DEFAULT_PRESET_BLOCKS,
      totalMinutes: (Array.isArray(p.blocks) ? p.blocks : DEFAULT_PRESET_BLOCKS).reduce((s, b) => s + (b.minutes || 0), 0),
    }))
    .sort((a, b) => (b.is_default ? 1 : 0) - (a.is_default ? 1 : 0));
}

async function savePhoto(file, kind, extra = {}) {
  let blob = file;
  let mime = file.type || 'image/jpeg';
  let width = null;
  let height = null;
  let metadata = null;
  try {
    const exifr = (await import('exifr')).default;
    metadata = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate', 'Make', 'Model', 'Orientation']);
  } catch {
    metadata = null;
  }
  try {
    const bitmap = await createImageBitmap(file);
    width = bitmap.width;
    height = bitmap.height;
    const maxDim = 1800;
    if (Math.max(width, height) > maxDim) {
      const scale = maxDim / Math.max(width, height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const converted = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
      if (converted) {
        blob = converted;
        mime = 'image/jpeg';
      }
    }
    bitmap.close?.();
  } catch {
    // HEIC and some formats cannot be decoded in every browser; keep the original.
  }
  const id = extra.id || uid();
  await db.photos.put({
    id,
    blob,
    mime,
    filename: file.name || `${id}.jpg`,
    cachedAt: nowIso(),
    remote: false,
    dirty: true,
    width,
    height,
    metadata,
  });
  const record = await putRecord(
    'photos',
    {
      kind,
      mime,
      size: blob.size,
      filename: file.name || null,
      width,
      height,
      taken_at: metadata?.DateTimeOriginal ? new Date(metadata.DateTimeOriginal).toISOString() : null,
      camera: metadata?.Model || null,
      metadata: metadata
        ? {
            DateTimeOriginal: metadata.DateTimeOriginal || null,
            CreateDate: metadata.CreateDate || null,
            Make: metadata.Make || null,
            Model: metadata.Model || null,
          }
        : null,
      storage: getPhotoStorageMode(),
      ...extra,
    },
    { id }
  );
  requestSync();
  return record;
}

export async function photoBlob(id) {
  const cached = await db.photos.get(id);
  if (cached?.blob) return cached;
  return null;
}

async function importHealthPayload(payload, fileName, counts = {}) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid Apple Health payload');
  const samples = Array.isArray(payload.samples) ? payload.samples : Array.isArray(payload.stepSamples) ? payload.stepSamples : [];
  const workouts = Array.isArray(payload.workouts) ? payload.workouts : [];
  const deletedSamples = Array.isArray(payload.deletedSampleIds) ? payload.deletedSampleIds : [];
  const deletedWorkouts = Array.isArray(payload.deletedWorkoutIds) ? payload.deletedWorkoutIds : [];
  let acceptedSamples = 0;
  let acceptedWorkouts = 0;
  const affected = new Set();
  const errors = [];
  const importedAt = payload.syncedAt || nowIso();

  for (const sample of samples) {
    if (!sample?.id) {
      errors.push('Sample missing id');
      continue;
    }
    const start = new Date(sample.start || sample.start_time);
    const end = new Date(sample.end || sample.end_time);
    const steps = Number(sample.steps);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      errors.push(`Sample ${sample.id} has invalid timestamps`);
      continue;
    }
    if (!Number.isFinite(steps) || steps < 0 || steps > 200000) {
      errors.push(`Sample ${sample.id} has an invalid step count`);
      continue;
    }
    await putRecord(
      'health_step_samples',
      {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        steps: Math.round(steps),
        source: String(sample.source || payload.source || 'Apple Health').slice(0, 120),
        device: sample.device ? String(sample.device).slice(0, 120) : null,
        imported_at: importedAt,
      },
      { id: String(sample.id) }
    );
    affected.add(dayKey(start));
    if (dayKey(end) !== dayKey(start)) affected.add(dayKey(end));
    acceptedSamples += 1;
  }

  for (const workout of workouts) {
    if (!workout?.id) {
      errors.push('Workout missing id');
      continue;
    }
    const start = new Date(workout.start || workout.start_time);
    const end = new Date(workout.end || workout.end_time);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      errors.push(`Workout ${workout.id} has invalid timestamps`);
      continue;
    }
    await putRecord(
      'health_workouts',
      {
        type: String(workout.type || 'other').slice(0, 80),
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        duration_sec: Number(workout.durationSec ?? workout.duration_sec) || Math.round((end - start) / 1000),
        distance_km: workout.distanceKm == null ? null : Number(workout.distanceKm),
        avg_hr: workout.avgHr == null ? null : Number(workout.avgHr),
        max_hr: workout.maxHr == null ? null : Number(workout.maxHr),
        active_calories: workout.activeCalories == null ? null : Number(workout.activeCalories),
        source: String(workout.source || payload.source || 'Apple Health').slice(0, 120),
        device: workout.device ? String(workout.device).slice(0, 120) : null,
        imported_at: importedAt,
      },
      { id: String(workout.id) }
    );
    affected.add(dayKey(start));
    acceptedWorkouts += 1;
  }

  for (const id of deletedSamples) {
    const existing = await getRecord('health_step_samples', String(id));
    if (existing) await removeRecord('health_step_samples', String(id));
  }
  for (const id of deletedWorkouts) {
    const existing = await getRecord('health_workouts', String(id));
    if (existing) await removeRecord('health_workouts', String(id));
  }

  const insertedWorkouts = await healthWorkouts();
  for (const workout of insertedWorkouts) {
    const start = new Date(workout.start_time);
    if (Number.isFinite(start.getTime())) affected.add(dayKey(start));
  }

  await putRecord(
    'health_imports',
    {
      source: payload.source || 'Apple Health',
      file_name: fileName || null,
      synced_at: payload.syncedAt || importedAt,
      received_at: nowIso(),
      samples: acceptedSamples || counts.samples || 0,
      workouts: acceptedWorkouts || counts.workouts || 0,
      deleted: deletedSamples.length + deletedWorkouts.length,
      status: errors.length ? 'partial' : 'ok',
      errors: errors.slice(0, 20),
    },
    { id: `import:${uid()}` }
  );

  const linkedDays = await linkHealthData();
  for (const d of linkedDays) affected.add(d);
  for (const d of affected) {
    await recomputeSteps(d);
    await createCheckpoint(d, { source: 'import', reconstructed: d < todayKey(TZ) });
  }
  await audit('health.import', 'health', { file: fileName, samples: acceptedSamples, workouts: acceptedWorkouts });
  requestSync();
  return {
    ok: true,
    samples: acceptedSamples,
    workouts: acceptedWorkouts,
    days: [...affected].sort(),
    errors,
    warnings: errors.length,
  };
}

/**
 * After a sync pull, fold newly arrived HealthKit records into step counters and
 * checkpoints. The Worker cron does the same server-side; this keeps the open
 * browser accurate immediately.
 */
export async function processHealthUpdates() {
  const imports = await healthImports();
  if (!imports.length) return { processed: false };
  const latest = imports[imports.length - 1];
  const key = `${latest.id}:${latest.received_at || ''}`;
  const previous = await metaGet('lastHealthImportProcessed', null);
  if (previous === key) return { processed: false };

  const today = todayKey(TZ);
  const affected = new Set();
  for (let i = 0; i < 10; i += 1) affected.add(addDaysKey(today, -i));
  const cutoff = latest.received_at || latest.synced_at || nowIso();
  for (const sample of await healthSamples()) {
    if ((sample.imported_at || '') >= cutoff) affected.add(dayKey(new Date(sample.start_time)));
  }
  for (const workout of await healthWorkouts()) {
    if ((workout.imported_at || '') >= cutoff) affected.add(dayKey(new Date(workout.start_time)));
  }

  const linkedDays = await linkHealthData();
  for (const d of linkedDays) affected.add(d);
  for (const d of affected) {
    await recomputeSteps(d);
    const day = await gatherDay(d);
    const hasData =
      day.meals.length ||
      day.water.length ||
      day.workouts.length ||
      day.tread.length ||
      day.steps ||
      day.recovery ||
      day.weighIns.some((w) => w.date === d);
    if (hasData) await createCheckpoint(d, { source: 'sync', reconstructed: d < today });
  }
  await metaSet('lastHealthImportProcessed', key);
  requestSync(500);
  return { processed: true, days: [...affected].sort() };
}

/* ------------------------------------------------------------------ */
/* Route dispatcher                                                   */
/* ------------------------------------------------------------------ */

async function handle(pathname, method, body) {
  const today = todayKey(TZ);

  if (pathname === '/auth/me') {
    const p = await profile();
    if (!p) {
      const err = new Error('Not authenticated');
      err.status = 401;
      throw err;
    }
    return { user: { id: 1, name: p.name || 'Owner', isDemo: false }, profile: p, goal: await currentGoal(today) };
  }

  if (pathname === '/bootstrap') return bootstrap();
  if (pathname === '/transformation') return transformation();
  if (pathname === '/profile' && method === 'GET') {
    return { profile: await profile(), goals: await goals() };
  }
  if (pathname === '/profile' && method === 'PUT') {
    const existing = (await profile()) || {};
    const next = {
      ...existing,
      sex: body.sex ?? existing.sex ?? 'male',
      birth_date: body.birthDate ?? existing.birth_date ?? null,
      height_cm: body.heightCm == null ? existing.height_cm ?? 183 : Number(body.heightCm),
      start_date: body.startDate ?? existing.start_date ?? today,
      checkpoint_date: body.checkpointDate ?? existing.checkpoint_date ?? '2026-12-01',
      waist_start_cm: body.waistStartCm == null ? existing.waist_start_cm ?? 91.44 : Number(body.waistStartCm),
      activity_level: body.activityLevel ?? existing.activity_level ?? 'moderate',
      notes: body.notes ?? existing.notes ?? null,
      name: body.name ?? existing.name ?? 'Owner',
      timezone: TZ,
      updated_at: nowIso(),
    };
    await putRecord('profile', next, { id: 'profile' });
    await audit('profile.update', 'profile', next);
    requestSync();
    return next;
  }
  if (pathname === '/goals' && method === 'POST') {
    if (Number(body.calories) < 1500) {
      const err = new Error('Calorie targets below 1,500 kcal are not allowed in this app. This is a safety guardrail, not a prescription.');
      err.status = 400;
      throw err;
    }
    const effective = body.effectiveFrom || today;
    const row = {
      effective_from: effective,
      calories: Number(body.calories) || 2400,
      protein_g: Number(body.protein) || 175,
      carbs_g: body.carbs == null ? null : Number(body.carbs),
      fat_g: body.fat == null ? null : Number(body.fat),
      water_ml: Number(body.waterMl) || 3250,
      step_goal: Number(body.stepGoal) || 10000,
      treadmill_min_week: Number(body.treadmillMinWeek) || 150,
      target_weight_kg: body.targetWeightKg == null ? 84 : Number(body.targetWeightKg),
      updated_at: nowIso(),
    };
    await putRecord('goals', row, { id: `goal:${effective}` });
    await audit('goal.update', 'goals', row);
    requestSync();
    return row;
  }
  if (pathname === '/goals' && method === 'GET') return { goals: await goals(), goal: await currentGoal(today) };

  if (pathname === '/weigh-ins' && method === 'GET') {
    const rows = await weighInsAll();
    return { rows, series: rollingAverageSeries(rows) };
  }
  if (pathname === '/weigh-ins' && method === 'POST') {
    const date = body.date || today;
    const existing = await getRecord('weigh_ins', `weigh:${date}`);
    if (body.weightKg == null && body.waistCm == null && body.bodyFatPct == null) {
      const err = new Error('Provide at least a weight, waist or body-fat reading');
      err.status = 400;
      throw err;
    }
    const row = await putRecord(
      'weigh_ins',
      {
        date,
        weight_kg: body.weightKg == null ? null : Number(body.weightKg),
        waist_cm: body.waistCm == null ? null : Number(body.waistCm),
        body_fat_pct: body.bodyFatPct == null ? null : Number(body.bodyFatPct),
        body_fat_source: body.bodyFatSource || (body.bodyFatPct != null ? 'estimate' : null),
        source: body.source || 'self_reported',
        photo_id: body.photoId || null,
        note: body.note || null,
        created_at: existing?.created_at || nowIso(),
      },
      { id: `weigh:${date}` }
    );
    await audit(existing ? 'weigh_in.update' : 'weigh_in.create', 'weigh_ins', row);
    requestSync();
    return row;
  }
  if (pathname.startsWith('/weigh-ins/') && method === 'DELETE') {
    await removeRecord('weigh_ins', `weigh:${pathname.split('/').pop()}`);
    requestSync();
    return { ok: true };
  }

  if (pathname === '/meals' && method === 'GET') {
    const date = new URLSearchParams(body?.__query || '').get('date') || today;
    const meals = await mealsFor(date);
    return { date, meals, totals: nutritionTotals(meals), goal: await currentGoal(date) };
  }
  if (pathname === '/meals' && method === 'POST') {
    if (!body.name) {
      const err = new Error('name is required');
      err.status = 400;
      throw err;
    }
    const date = body.date || today;
    const row = await putRecord('meals', {
      date,
      slot: body.slot || 'meal',
      name: body.name,
      calories: Number(body.calories) || 0,
      protein_g: Number(body.protein) || 0,
      carbs_g: Number(body.carbs) || 0,
      fat_g: Number(body.fat) || 0,
      source: body.photoId ? 'photo_estimate' : body.source || 'user_logged',
      photo_id: body.photoId || null,
      notes: body.notes || null,
      created_at: nowIso(),
    });
    await audit('meal.create', 'meals', row);
    requestSync();
    return row;
  }
  if (pathname.startsWith('/meals/') && method === 'DELETE') {
    await removeRecord('meals', pathname.split('/').pop());
    requestSync();
    return { ok: true };
  }
  if (pathname === '/nutrition/week') {
    const to = today;
    const from = addDaysKey(to, -6);
    const goal = await currentGoal(to);
    const meals = await mealsFor(from, to);
    const days = eachDate(from, to).map((date) => {
      const rows = meals.filter((m) => m.date === date);
      const totals = nutritionTotals(rows);
      return { date, calories: Math.round(totals.calories), protein: Math.round(totals.protein), carbs: Math.round(totals.carbs), fat: Math.round(totals.fat), mealCount: rows.length, logged: rows.length > 0 };
    });
    return { start: from, end: to, goal, days, adherence: adherenceWindow({ meals, goal, from, to }) };
  }

  if (pathname === '/foods' && method === 'GET') return { foods: await listRecords('foods') };
  if (pathname === '/foods' && method === 'POST') {
    const row = await putRecord('foods', { ...body, source: 'user', editable: true, updated_at: nowIso() });
    await audit('food.create', 'foods', row);
    requestSync();
    return row;
  }
  if (pathname.startsWith('/foods/') && method === 'PUT') {
    const id = pathname.split('/').pop();
    const row = await patchRecord('foods', id, { ...body, updated_at: nowIso() });
    requestSync();
    return row;
  }
  if (pathname.startsWith('/foods/') && method === 'DELETE') {
    await removeRecord('foods', pathname.split('/').pop());
    requestSync();
    return { ok: true };
  }

  if (pathname === '/recipes' && method === 'GET') return await listRecords('recipes');
  if (pathname === '/recipes' && method === 'POST') {
    const ingredients = Array.isArray(body.ingredients) ? body.ingredients : [];
    const servings = Number(body.servings) || 1;
    const totals = ingredients.reduce(
      (a, i) => ({ calories: a.calories + (Number(i.calories) || 0), protein: a.protein + (Number(i.protein) || 0), carbs: a.carbs + (Number(i.carbs) || 0), fat: a.fat + (Number(i.fat) || 0) }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 }
    );
    const row = await putRecord('recipes', {
      name: body.name,
      servings,
      instructions: body.instructions || null,
      calories: totals.calories / servings,
      protein_g: totals.protein / servings,
      carbs_g: totals.carbs / servings,
      fat_g: totals.fat / servings,
      ingredients,
      created_at: nowIso(),
    });
    await audit('recipe.create', 'recipes', row);
    requestSync();
    return row;
  }
  if (pathname.startsWith('/recipes/') && method === 'DELETE') {
    await removeRecord('recipes', pathname.split('/').pop());
    requestSync();
    return { ok: true };
  }

  if (pathname === '/water' && method === 'GET') {
    const date = new URLSearchParams(body?.__query || '').get('date') || today;
    const logs = await waterFor(date);
    return { date, logs, total: logs.reduce((s, w) => s + w.ml, 0) };
  }
  if (pathname === '/water' && method === 'POST') {
    const ml = Number(body.ml);
    if (!ml || ml <= 0 || ml > 5000) {
      const err = new Error('ml must be between 1 and 5000');
      err.status = 400;
      throw err;
    }
    const row = await putRecord('water', { date: body.date || today, ml: Math.round(ml), source: 'self_reported', created_at: nowIso() });
    requestSync();
    return row;
  }
  if (pathname.startsWith('/water/') && method === 'DELETE') {
    await removeRecord('water', pathname.split('/').pop());
    requestSync();
    return { ok: true };
  }

  if (pathname === '/workouts' && method === 'GET') {
    const to = today;
    const from = addDaysKey(to, -90);
    const sessions = await workoutsFor(from, to);
    return { from, to, sessions: sessions.map((s) => ({ ...s, evidence: s.health_workout_id ? STATUS.VERIFIED_DEVICE : STATUS.LOGGED_USER })) };
  }
  if (pathname === '/workouts' && method === 'POST') {
    if (!body.split) {
      const err = new Error('split is required');
      err.status = 400;
      throw err;
    }
    const sets = Array.isArray(body.sets) ? body.sets : [];
    const row = await putRecord('workouts', {
      date: body.date || today,
      split: body.split,
      title: body.title || body.split,
      status: body.status || 'completed',
      source: body.source || 'user_logged',
      health_workout_id: body.health_workout_id || null,
      duration_min: body.durationMin == null ? null : Number(body.durationMin),
      notes: body.notes || null,
      sets: sets.map((s, i) => ({ id: s.id || uid(), exercise: s.exercise || 'Exercise', set_index: i + 1, reps: Number(s.reps) || 0, weight_kg: Number(s.weightKg ?? s.weight_kg) || 0, rpe: s.rpe == null ? null : Number(s.rpe) })),
      created_at: nowIso(),
    });
    await audit('workout.create', 'workouts', row);
    requestSync();
    return row;
  }
  if (pathname.startsWith('/workouts/') && method === 'DELETE') {
    await removeRecord('workouts', pathname.split('/').pop());
    requestSync();
    return { ok: true };
  }
  if (pathname === '/workouts/strength') {
    const sessions = await workoutsFor(addDaysKey(today, -60), today);
    return strengthRetentionFromSessions(sessions, { today, startDate: (await profile())?.start_date || today });
  }

  if (pathname === '/recovery' && method === 'GET') {
    const rows = await recoveryRowsFor(addDaysKey(today, -27), today);
    return { rows, trend: recoveryTrendFromLogs(rows) };
  }
  if (pathname === '/recovery' && method === 'POST') {
    const date = body.date || today;
    const row = await putRecord(
      'recovery',
      {
        date,
        sleep_hours: body.sleepHours == null ? null : Number(body.sleepHours),
        resting_hr: body.restingHr == null ? null : Number(body.restingHr),
        soreness: body.soreness == null ? null : Number(body.soreness),
        readiness: body.readiness == null ? null : Number(body.readiness),
        stress: body.stress == null ? null : Number(body.stress),
        notes: body.notes || null,
        source: 'self_reported',
        created_at: nowIso(),
      },
      { id: `recovery:${date}` }
    );
    requestSync();
    return row;
  }

  if (pathname === '/treadmill/presets' && method === 'GET') return { presets: await presets() };
  if (pathname === '/treadmill/presets' && method === 'POST') {
    const row = await putRecord('treadmill_presets', { name: body.name || 'Custom walk', description: body.description || null, blocks: body.blocks || DEFAULT_PRESET_BLOCKS, is_default: 0, updated_at: nowIso() });
    await audit('preset.create', 'treadmill_presets', row);
    requestSync();
    return row;
  }
  if (pathname.startsWith('/treadmill/presets/') && method === 'PUT') {
    const id = pathname.split('/').pop();
    const row = await patchRecord('treadmill_presets', id, { name: body.name, description: body.description, blocks: body.blocks, updated_at: nowIso() });
    requestSync();
    return row;
  }
  if (pathname.startsWith('/treadmill/presets/') && method === 'DELETE') {
    const id = pathname.split('/').pop();
    if (id === 'preset:default') return { ok: false, reason: 'default' };
    await removeRecord('treadmill_presets', id);
    requestSync();
    return { ok: true };
  }
  if (pathname.startsWith('/treadmill/timeline/')) {
    const id = pathname.split('/').pop();
    const preset = await getRecord('treadmill_presets', id);
    if (!preset) {
      const err = new Error('Preset not found');
      err.status = 404;
      throw err;
    }
    return { preset, timeline: buildTimeline(preset) };
  }
  if (pathname === '/treadmill/sessions' && method === 'GET') {
    const rows = await treadmillFor(addDaysKey(today, -90), today);
    return { from: addDaysKey(today, -90), to: today, sessions: await decorateSessions(rows.sort((a, b) => (b.date + (b.start_time || '')).localeCompare(a.date + (a.start_time || '')))), totals: await treadmillTotals(addDaysKey(today, -90), today) };
  }
  if (pathname === '/treadmill/sessions' && method === 'POST') {
    const date = body.date || today;
    const row = await putRecord('treadmill_sessions', {
      date,
      preset_id: body.presetId || null,
      title: body.title || 'Incline Fat-Loss Walk',
      planned_start: body.plannedStart || null,
      start_time: body.startTime ? new Date(body.startTime).toISOString() : null,
      end_time: body.endTime ? new Date(body.endTime).toISOString() : null,
      duration_min: body.durationMin == null ? null : Number(body.durationMin),
      speed_kmh: body.speedKmh == null ? null : Number(body.speedKmh),
      incline_pct: body.inclinePct == null ? null : Number(body.inclinePct),
      distance_km: body.distanceKm == null ? null : Number(body.distanceKm),
      avg_hr: body.avgHr == null ? null : Number(body.avgHr),
      max_hr: body.maxHr == null ? null : Number(body.maxHr),
      active_calories: body.activeCalories == null ? null : Number(body.activeCalories),
      calories_source: body.activeCalories == null ? null : 'manual_estimate',
      difficulty: body.difficulty || null,
      recovery_status: body.recoveryStatus || null,
      source: body.source || 'manual',
      status: body.status || 'logged',
      notes: body.notes || null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    await recomputeSteps(date);
    await createCheckpoint(date, { source: 'client' });
    requestSync();
    return { ...row, evidence: sessionEvidence(row) };
  }
  if (pathname.startsWith('/treadmill/sessions/') && method === 'PUT' && !pathname.includes('/console')) {
    const id = pathname.split('/')[3];
    const existing = await getRecord('treadmill_sessions', id);
    if (!existing) {
      const err = new Error('Session not found');
      err.status = 404;
      throw err;
    }
    const row = await putRecord(
      'treadmill_sessions',
      {
        ...existing,
        date: body.date || existing.date,
        title: body.title || existing.title,
        start_time: body.startTime ? new Date(body.startTime).toISOString() : existing.start_time,
        end_time: body.endTime ? new Date(body.endTime).toISOString() : existing.end_time,
        duration_min: body.durationMin ?? existing.duration_min,
        speed_kmh: body.speedKmh ?? existing.speed_kmh,
        incline_pct: body.inclinePct ?? existing.incline_pct,
        distance_km: body.distanceKm ?? existing.distance_km,
        avg_hr: body.avgHr ?? existing.avg_hr,
        max_hr: body.maxHr ?? existing.max_hr,
        active_calories: body.activeCalories ?? existing.active_calories,
        difficulty: body.difficulty ?? existing.difficulty,
        recovery_status: body.recoveryStatus ?? existing.recovery_status,
        status: body.status ?? existing.status,
        notes: body.notes ?? existing.notes,
        updated_at: nowIso(),
      },
      { id }
    );
    await recomputeSteps(existing.date);
    if (row.date !== existing.date) await recomputeSteps(row.date);
    requestSync();
    return { ...row, evidence: sessionEvidence(row) };
  }
  if (pathname.startsWith('/treadmill/sessions/') && method === 'DELETE') {
    const id = pathname.split('/')[3];
    const existing = await getRecord('treadmill_sessions', id);
    await removeRecord('treadmill_sessions', id);
    if (existing) await recomputeSteps(existing.date);
    requestSync();
    return { ok: true };
  }
  if (pathname === '/treadmill/schedule') return treadmillSchedule();
  if (pathname === '/treadmill/weekly') return treadmillWeekly();

  if (pathname === '/steps' && method === 'GET') {
    return { from: addDaysKey(today, -29), to: today, rows: (await listRecords('steps_daily')).sort((a, b) => a.date.localeCompare(b.date)), health: { lastSync: await lastHealthImport(), stale: isStale(await lastHealthImport(), 36) } };
  }
  if (pathname === '/steps/recompute' && method === 'POST') return recomputeSteps(body?.date || today);
  if (pathname === '/health/status') {
    const imports = (await healthImports()).slice(-10).reverse();
    const devices = [];
    return {
      freshness: { lastSync: await lastHealthImport(), stale: isStale(await lastHealthImport(), 36), status: isStale(await lastHealthImport(), 36) ? STATUS.PENDING_SYNC : STATUS.VERIFIED_DEVICE },
      syncs: imports.map((i) => ({ id: i.id, received_at: i.received_at, source: i.source || 'Apple Health', step_samples_count: i.samples || 0, workouts_count: i.workouts || 0 })),
      workouts: (await healthWorkouts()).slice(-20).reverse(),
      stepsToday: await stepsFor(today),
      devices,
    };
  }
  if (pathname === '/health/import' && method === 'POST') {
    return importHealthPayload(body.payload, body.fileName, body);
  }
  if (pathname === '/evidence') {
    const { p, goal, meals, water, workouts, tread, steps, recovery, weighIns, imported } = await gatherDay(today);
    return evidenceFor(today, { p, goal, meals, water, workouts, tread, steps, recovery, weighIns, imported });
  }
  if (pathname === '/checkpoints' && method === 'GET') {
    return { checkpoints: (await listRecords('checkpoints')).sort((a, b) => b.date.localeCompare(a.date)).map((c) => ({ ...c, snapshot: c.snapshot, reconciled: c.reconciled || null })) };
  }
  if (pathname === '/checkpoints' && method === 'POST') {
    return createCheckpoint(body?.date || today, { force: !!body?.force, source: body?.source || 'client', reconstructed: false });
  }
  if (pathname === '/checkpoints/preview') {
    const previewDate = new URLSearchParams(body?.__query || '').get('date') || today;
    return buildSnapshot({ ...(await previewArgs(previewDate)) });
  }
  if (pathname.startsWith('/checkpoints/') && pathname.endsWith('/reconcile') && method === 'POST') {
    return reconcileCheckpoint(pathname.split('/')[2]);
  }
  if (pathname.startsWith('/checkpoints/') && method === 'GET') {
    const date = pathname.split('/')[2];
    const row = await getRecord('checkpoints', `checkpoint:${date}`);
    if (!row) {
      const err = new Error('No checkpoint for that date');
      err.status = 404;
      throw err;
    }
    return row;
  }

  if (pathname === '/progress-photos' && method === 'GET') {
    const rows = await listRecords('progress_photos');
    const photos = await listRecords('photos');
    const byId = new Map(photos.map((p) => [p.id, p]));
    return { photos: rows.map((r) => ({ ...r, mime: byId.get(r.photo_id)?.mime || null, size: byId.get(r.photo_id)?.size || null })).sort((a, b) => b.week_start.localeCompare(a.week_start)) };
  }
  if (pathname === '/progress-photos' && method === 'POST') {
    const { file } = body;
    const angle = body.angle || 'front';
    const weekStart = body.weekStart || weekStartKey(today);
    if (!file) {
      const err = new Error('No photo uploaded');
      err.status = 400;
      throw err;
    }
    const existing = await getRecord('progress_photos', `progress:${weekStart}:${angle}`);
    if (existing?.photo_id) {
      await removeRecord('photos', existing.photo_id);
      await db.photos.delete(existing.photo_id);
    }
    const photo = await savePhoto(file, 'progress');
    const row = await putRecord(
      'progress_photos',
      { week_start: weekStart, angle, photo_id: photo.id, created_at: nowIso() },
      { id: `progress:${weekStart}:${angle}` }
    );
    await audit('progress_photo.create', 'progress_photos', row);
    requestSync();
    return { ...photo, progress_id: row.id, week_start: row.week_start, angle: row.angle, photo_id: photo.id };
  }
  if (pathname.startsWith('/progress-photos/') && method === 'DELETE') {
    const id = pathname.split('/').pop();
    const row = await getRecord('progress_photos', id);
    if (row?.photo_id) {
      await removeRecord('photos', row.photo_id);
      await db.photos.delete(row.photo_id);
    }
    await removeRecord('progress_photos', id);
    requestSync();
    return { ok: true };
  }

  if (pathname.startsWith('/treadmill/sessions/') && pathname.endsWith('/console') && method === 'POST') {
    const id = pathname.split('/')[3];
    const session = await getRecord('treadmill_sessions', id);
    if (!session) {
      const err = new Error('Session not found');
      err.status = 404;
      throw err;
    }
    if (!body.file) {
      const err = new Error('No photo uploaded');
      err.status = 400;
      throw err;
    }
    const photo = await savePhoto(body.file, 'console');
    const metaTime = photo.taken_at ? new Date(photo.taken_at).getTime() : null;
    const sessionTime = session.start_time ? new Date(session.start_time).getTime() : null;
    const hoursOff = metaTime && sessionTime ? Math.abs(metaTime - sessionTime) / 3600000 : null;
    const timestampConflict = hoursOff != null && hoursOff > 24;
    const extracted = {
      speedKmh: null,
      inclinePct: null,
      durationMin: null,
      distanceKm: null,
      activeCalories: null,
    };
    const comparisons = timestampConflict
      ? [
          {
            field: 'timestamp',
            label: 'Photo timestamp',
            extracted: photo.taken_at,
            logged: session.start_time,
            delta: round(hoursOff, 1),
            status: 'discrepancy',
            message: `The photo was taken about ${Math.round(hoursOff)} hours from the logged session start.`,
          },
        ]
      : [];
    const result = {
      photo,
      ocrAvailable: false,
      ocrReason: 'On-device OCR is not enabled in this browser build. Enter the console readings manually.',
      recognisedLines: [],
      extracted,
      comparisons,
      foundCount: 0,
      hasDiscrepancy: timestampConflict,
      confidence: 'none',
      disclaimer:
        'A console photo corroborates displayed numbers only. It does not prove who used the machine or that the session was completed as logged.',
    };
    await putRecord(
      'treadmill_sessions',
      { ...session, console_photo_id: photo.id, console_extracted: result, console_confirmed: 0, console_discrepancy: timestampConflict, updated_at: nowIso() },
      { id }
    );
    requestSync();
    return result;
  }
  if (pathname.startsWith('/treadmill/sessions/') && pathname.endsWith('/console/confirm') && method === 'POST') {
    const id = pathname.split('/')[3];
    const session = await getRecord('treadmill_sessions', id);
    if (!session) {
      const err = new Error('Session not found');
      err.status = 404;
      throw err;
    }
    const values = body || {};
    const row = await putRecord(
      'treadmill_sessions',
      {
        ...session,
        speed_kmh: values.speedKmh != null ? Number(values.speedKmh) : session.speed_kmh,
        incline_pct: values.inclinePct != null ? Number(values.inclinePct) : session.incline_pct,
        duration_min: values.durationMin != null ? Number(values.durationMin) : session.duration_min,
        distance_km: values.distanceKm != null ? Number(values.distanceKm) : session.distance_km,
        active_calories: values.activeCalories != null ? Number(values.activeCalories) : session.active_calories,
        console_confirmed: 1,
        updated_at: nowIso(),
      },
      { id }
    );
    await recomputeSteps(row.date);
    requestSync();
    return { ...row, evidence: sessionEvidence(row) };
  }

  if (pathname === '/audit') {
    const rows = await db.audit.orderBy('at').reverse().limit(200).toArray();
    return { rows };
  }

  if (pathname === '/jobs') {
    return { runs: [], nextCloseout: nextCloseoutIso(), timezone: TZ, local: true };
  }

  if (pathname === '/export') {
    const rows = await listRecords('profile');
    void rows;
    const all = {};
    for (const collection of ['profile', 'goals', 'meals', 'foods', 'recipes', 'water', 'workouts', 'treadmill_presets', 'treadmill_sessions', 'weigh_ins', 'recovery', 'steps_daily', 'health_step_samples', 'health_workouts', 'health_imports', 'photos', 'progress_photos', 'checkpoints', 'summaries', 'settings']) {
      all[collection] = await listRecords(collection);
    }
    return { exportedAt: nowIso(), records: all };
  }

  const err = new Error(`Unknown local endpoint: ${method} ${pathname}`);
  err.status = 404;
  throw err;
}

async function previewArgs(date) {
  const { p, goal, meals, water, workouts, tread, steps, recovery, weighIns, imported } = await gatherDay(date);
  return {
    date,
    timezone: TZ,
    profile: p,
    goal,
    meals,
    waterMl: water.reduce((s, w) => s + w.ml, 0),
    workouts,
    treadmillSessions: tread,
    steps,
    weighIns,
    recovery,
    healthLastImport: imported,
  };
}

function buildTimeline(preset) {
  let cursor = 0;
  const blocks = (preset.blocks || DEFAULT_PRESET_BLOCKS).map((b) => {
    const start = cursor;
    cursor += b.minutes || 0;
    return { ...b, startMin: start, endMin: cursor, avgSpeed: round(((b.speedMin || 0) + (b.speedMax || 0)) / 2, 1), avgIncline: round(((b.inclineMin || 0) + (b.inclineMax || 0)) / 2, 1) };
  });
  return { blocks, totalMinutes: cursor };
}

function parsePath(path) {
  const [pathname, query = ''] = path.split('?');
  return { pathname, query };
}

export const api = {
  async get(path) {
    const { pathname, query } = parsePath(path);
    return handle(pathname, 'GET', { __query: query });
  },
  async post(path, body) {
    const { pathname } = parsePath(path);
    return handle(pathname, 'POST', body || {});
  },
  async put(path, body) {
    const { pathname } = parsePath(path);
    return handle(pathname, 'PUT', body || {});
  },
  async del(path) {
    const { pathname } = parsePath(path);
    return handle(pathname, 'DELETE', {});
  },
  async upload(path, formData) {
    const { pathname } = parsePath(path);
    if (pathname === '/progress-photos') {
      const file = formData.get('photo');
      const angle = formData.get('angle');
      const weekStart = formData.get('weekStart');
      return handle('/progress-photos', 'POST', { file, angle, weekStart });
    }
    const consoleMatch = pathname.match(/^\/treadmill\/sessions\/([^/]+)\/console$/);
    if (consoleMatch) {
      const file = formData.get('photo');
      return handle(pathname, 'POST', { file });
    }
    throw new Error('Unsupported upload endpoint');
  },
};

export async function createLocalProfile(payload) {
  const start = payload.startDate || todayKey(TZ);
  const profileRow = {
    name: payload.name || 'Owner',
    sex: payload.sex || 'male',
    birth_date: payload.birthDate || null,
    height_cm: Number(payload.heightCm) || 183,
    start_date: start,
    checkpoint_date: payload.checkpointDate || '2026-12-01',
    waist_start_cm: Number(payload.waistCm) || 91.44,
    activity_level: payload.activityLevel || 'moderate',
    notes: null,
    timezone: TZ,
    updated_at: nowIso(),
  };
  await putRecord('profile', profileRow, { id: 'profile' });
  await putRecord(
    'goals',
    {
      effective_from: start,
      calories: Number(payload.calories) || 2400,
      protein_g: Number(payload.protein) || 175,
      carbs_g: Number(payload.carbs) || 240,
      fat_g: Number(payload.fat) || 70,
      water_ml: Number(payload.waterMl) || 3250,
      step_goal: Number(payload.stepGoal) || 10000,
      treadmill_min_week: 150,
      target_weight_kg: Number(payload.targetWeightKg) || 84,
      updated_at: nowIso(),
    },
    { id: `goal:${start}` }
  );
  await seedDefaults();
  await audit('profile.create', 'profile', { start });
  requestSync(200);
  return profileRow;
}

export { STATUS, STATUS_META, EVIDENCE_REQUIREMENTS, buildTimeline };
