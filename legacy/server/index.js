import express from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nowIso, audit, DATA_DIR, PHOTO_DIR } from './db.js';
import { createUser, requireAuth, createSession, destroySession, userFromRequest, verifyPassword, requireAuthOrToken, createHealthToken, listHealthTokens, revokeHealthToken } from './auth.js';
import { STATUS, STATUS_META, EVIDENCE_REQUIREMENTS } from './lib/evidence.js';
import {
  addDaysKey,
  eachDate,
  todayKey,
  weekStartKey,
  localDayBounds,
  formatTimeInZone,
  isStale,
} from './lib/dates.js';
import {
  adherenceWindow,
  currentGoal,
  getProfile,
  getTreadmillSessions,
  getWeighIns,
  getWorkouts,
  healthFreshness,
  mealsByDate,
  nutritionTotals,
  programProgress,
  projectWeight,
  recoveryForRange,
  recoveryTrend,
  rollingAverageSeries,
  stepsForDate,
  strengthRetention,
  treadmillMinutes,
  waterTotal,
} from './lib/metrics.js';
import { coach } from './lib/coach.js';
import {
  buildTimeline,
  cardioProgression,
  createPreset,
  deletePreset,
  ensureDefaultPreset,
  getPreset,
  listPresets,
  listSessions,
  serialisePreset,
  sessionStatus,
  treadmillTotals,
  updatePreset,
  weeklyScheduleFor,
  WEEKLY_CARDIO_PLAN,
} from './lib/treadmill.js';
import { ingestHealthSync, recentSyncs, recomputeStepsForDate, healthWorkouts, linkHealthWorkouts } from './lib/sync.js';
import { recogniseText, parseConsoleReadings, ocrAvailable } from './lib/console-ocr.js';
import { buildSnapshot, createCheckpoint, hydrate, listCheckpoints, reconcileCheckpoint } from './lib/checkpoint.js';
import { listJobRuns, nextScheduledRun, runDailyCloseout, runReconciliation, startScheduler } from './lib/jobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(cookieParser());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(file.mimetype)) {
      return cb(new Error('Only image uploads are allowed'));
    }
    cb(null, true);
  },
});

function tzOf(req) {
  return req.user?.timezone || 'Asia/Kolkata';
}

function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body || {};
  if (!email || !password || !name) return res.status(400).json({ error: 'email, password and name are required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (req.body.calories != null && Number(req.body.calories) < 1500) {
    return res.status(400).json({ error: 'Calorie targets below 1,500 kcal are not allowed in this app.' });
  }
  const exists = db.prepare(`SELECT id FROM users WHERE email = ?`).get(email);
  if (exists) return res.status(409).json({ error: 'An account with that email already exists' });

  const userId = createUser({ email, password, name });
  const tz = req.body.timezone || 'Asia/Kolkata';
  const start = req.body.startDate || todayKey(tz);
  db.prepare(`UPDATE users SET timezone = ? WHERE id = ?`).run(tz, userId);

  db.prepare(
    `INSERT INTO profiles (user_id, sex, birth_date, height_cm, start_date, checkpoint_date, waist_start_cm, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    req.body.sex || 'male',
    req.body.birthDate || null,
    Number(req.body.heightCm) || 183,
    start,
    req.body.checkpointDate || '2026-12-01',
    Number(req.body.waistCm) || 91.44,
    nowIso()
  );
  db.prepare(
    `INSERT INTO goals (user_id, effective_from, calories, protein_g, carbs_g, fat_g, water_ml, step_goal, treadmill_min_week, target_weight_kg, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    start,
    Number(req.body.calories) || 2400,
    Number(req.body.protein) || 175,
    Number(req.body.carbs) || 240,
    Number(req.body.fat) || 70,
    Number(req.body.waterMl) || 3000,
    Number(req.body.stepGoal) || 10000,
    Number(req.body.treadmillMinWeek) || 150,
    Number(req.body.targetWeightKg) || 84,
    nowIso()
  );
  ensureDefaultPreset(userId);

  const { token } = createSession(userId);
  res.cookie('fos_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 86_400_000,
  });
  res.json({ ok: true, user: { id: userId, email, name, timezone: tz } });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const { token } = createSession(user.id);
  res.cookie('fos_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 86_400_000,
  });
  res.json({ ok: true, user: { id: user.id, email: user.email, name: user.name, timezone: user.timezone, isDemo: !!user.is_demo } });
});

app.post('/api/auth/logout', (req, res) => {
  destroySession(req.cookies?.fos_session);
  res.clearCookie('fos_session');
  res.json({ ok: true });
});

app.get('/api/auth/me', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  const profile = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`).get(user.id);
  const goal = currentGoal(user.id, todayKey(user.timezone));
  res.json({ user: { ...user, isDemo: !!user.is_demo }, profile, goal });
});

/* ------------------------------------------------------------------ */
/* Bootstrap / dashboard                                               */
/* ------------------------------------------------------------------ */

app.get('/api/bootstrap', requireAuth, wrap((req, res) => {
  const tz = tzOf(req);
  const today = todayKey(tz);
  const { profile, goals } = getProfile(req.user.id);
  const goal = currentGoal(req.user.id, today);
  const weighIns = getWeighIns(req.user.id);
  const health = healthFreshness(req.user.id);
  const steps = stepsForDate(req.user.id, today);
  const meals = mealsByDate(req.user.id, today, today).get(today) || [];
  const nutrition = nutritionTotals(meals);
  const workouts = getWorkouts(req.user.id, today, today);
  const treadmill = getTreadmillSessions(req.user.id, today, today).map((s) => ({
    ...s,
    evidence: sessionStatus(s),
  }));
  const projection = projectWeight({
    weighIns,
    checkpointDate: profile?.checkpoint_date || '2026-12-01',
    today,
  });
  const strength = strengthRetention(req.user.id, {
    today,
    startDate: profile?.start_date || today,
  });
  const recovery = recoveryTrend(req.user.id, { today });
  const coachOut = coach({
    userId: req.user.id,
    profile: profile || { start_date: today, checkpoint_date: '2026-12-01' },
    goal,
    weighIns,
    today,
  });

  res.json({
    today,
    timezone: tz,
    user: { id: req.user.id, name: req.user.name, email: req.user.email, isDemo: !!req.user.is_demo },
    profile,
    goal,
    goals,
    steps: steps || { total_steps: null, treadmill_steps: null, qualifying_steps: null, method: 'none', uncertainty_pct: 0, status: 'pending_sync' },
    health,
    nutrition: {
      totals: {
        calories: Math.round(nutrition.calories),
        protein: Math.round(nutrition.protein),
        carbs: Math.round(nutrition.carbs),
        fat: Math.round(nutrition.fat),
      },
      meals,
      status: meals.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
    },
    water: { ml: waterTotal(req.user.id, today), target: goal?.water_ml ?? 3000, status: waterTotal(req.user.id, today) > 0 ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED },
    workout: { sessions: workouts, status: workouts.length ? (workouts.some((w) => w.health_workout_id) ? STATUS.VERIFIED_DEVICE : STATUS.LOGGED_USER) : STATUS.NOT_RECORDED },
    treadmill: { sessions: treadmill, totals: treadmillTotals(req.user.id, today, today) },
    weight: {
      latest: weighIns.length ? weighIns[weighIns.length - 1] : null,
      series: rollingAverageSeries(weighIns),
      projection,
      status: weighIns.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
    },
    strength,
    recovery,
    coach: coachOut,
    progress: programProgress(profile?.start_date || today, profile?.checkpoint_date || '2026-12-01', today),
    statusMeta: STATUS_META,
    evidenceRequirements: EVIDENCE_REQUIREMENTS,
    ocrAvailable: ocrAvailable(),
    nextCloseout: nextScheduledRun(tz),
  });
}));

/* ------------------------------------------------------------------ */
/* Profile & goals                                                     */
/* ------------------------------------------------------------------ */

app.get('/api/profile', requireAuth, (req, res) => {
  res.json(getProfile(req.user.id));
});

app.put('/api/profile', requireAuth, (req, res) => {
  const before = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`).get(req.user.id);
  const b = req.body || {};
  db.prepare(
    `UPDATE profiles SET sex = COALESCE(?, sex), birth_date = COALESCE(?, birth_date),
       height_cm = COALESCE(?, height_cm), start_date = COALESCE(?, start_date),
       checkpoint_date = COALESCE(?, checkpoint_date), waist_start_cm = COALESCE(?, waist_start_cm),
       activity_level = COALESCE(?, activity_level), notes = COALESCE(?, notes), updated_at = ?
     WHERE user_id = ?`
  ).run(
    b.sex ?? null,
    b.birthDate ?? null,
    b.heightCm == null ? null : Number(b.heightCm),
    b.startDate ?? null,
    b.checkpointDate ?? null,
    b.waistStartCm == null ? null : Number(b.waistStartCm),
    b.activityLevel ?? null,
    b.notes ?? null,
    nowIso(),
    req.user.id
  );
  if (b.timezone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: b.timezone });
      db.prepare(`UPDATE users SET timezone = ? WHERE id = ?`).run(b.timezone, req.user.id);
    } catch {
      return res.status(400).json({ error: 'Unknown timezone' });
    }
  }
  if (b.name) {
    db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(String(b.name).slice(0, 80), req.user.id);
  }
  const after = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`).get(req.user.id);
  audit(req.user.id, 'profile', req.user.id, 'update', before, after);
  res.json(after);
});

app.post('/api/goals', requireAuth, (req, res) => {
  const b = req.body || {};
  const effectiveFrom = b.effectiveFrom || todayKey(tzOf(req));
  if (Number(b.calories) && Number(b.calories) < 1500) {
    return res.status(400).json({
      error: 'Calorie targets below 1,500 kcal are not allowed in this app. This is a safety guardrail, not a prescription.',
    });
  }
  const existing = db
    .prepare(`SELECT * FROM goals WHERE user_id = ? AND effective_from = ?`)
    .get(req.user.id, effectiveFrom);

  const values = [
    Number(b.calories) || 2400,
    Number(b.protein) || 175,
    b.carbs == null ? null : Number(b.carbs),
    b.fat == null ? null : Number(b.fat),
    Number(b.waterMl) || 3000,
    Number(b.stepGoal) || 10000,
    Number(b.treadmillMinWeek) || 150,
    b.targetWeightKg == null ? null : Number(b.targetWeightKg),
    nowIso(),
  ];

  if (existing) {
    db.prepare(
      `UPDATE goals SET calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, water_ml = ?,
         step_goal = ?, treadmill_min_week = ?, target_weight_kg = ?, updated_at = ?
       WHERE id = ?`
    ).run(...values, existing.id);
    audit(req.user.id, 'goal', existing.id, 'update', existing, { ...b, effectiveFrom });
  } else {
    db.prepare(
      `INSERT INTO goals (user_id, effective_from, calories, protein_g, carbs_g, fat_g, water_ml, step_goal, treadmill_min_week, target_weight_kg, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.user.id, effectiveFrom, ...values);
    audit(req.user.id, 'goal', effectiveFrom, 'create', null, b);
  }
  res.json(currentGoal(req.user.id, effectiveFrom));
});

/* ------------------------------------------------------------------ */
/* Weigh-ins & body                                                    */
/* ------------------------------------------------------------------ */

app.get('/api/weigh-ins', requireAuth, (req, res) => {
  const from = req.query.from || addDaysKey(todayKey(tzOf(req)), -120);
  const to = req.query.to || todayKey(tzOf(req));
  const rows = getWeighIns(req.user.id, { from, to });
  res.json({ rows, series: rollingAverageSeries(rows) });
});

app.post('/api/weigh-ins', requireAuth, (req, res) => {
  const b = req.body || {};
  const date = b.date || todayKey(tzOf(req));
  if (b.weightKg == null && b.waistCm == null && b.bodyFatPct == null) {
    return res.status(400).json({ error: 'Provide at least a weight, waist or body-fat reading' });
  }
  const existing = db
    .prepare(`SELECT * FROM weigh_ins WHERE user_id = ? AND date = ?`)
    .get(req.user.id, date);

  const payload = {
    weight_kg: b.weightKg == null ? null : Number(b.weightKg),
    waist_cm: b.waistCm == null ? null : Number(b.waistCm),
    body_fat_pct: b.bodyFatPct == null ? null : Number(b.bodyFatPct),
    body_fat_source: b.bodyFatSource || (b.bodyFatPct != null ? 'estimate' : null),
    source: b.source || 'self_reported',
    photo_id: b.photoId || null,
    note: b.note || null,
  };

  if (existing) {
    db.prepare(
      `UPDATE weigh_ins SET weight_kg = COALESCE(?, weight_kg), waist_cm = COALESCE(?, waist_cm),
         body_fat_pct = COALESCE(?, body_fat_pct), body_fat_source = COALESCE(?, body_fat_source),
         source = ?, photo_id = COALESCE(?, photo_id), note = COALESCE(?, note)
       WHERE id = ?`
    ).run(
      payload.weight_kg,
      payload.waist_cm,
      payload.body_fat_pct,
      payload.body_fat_source,
      payload.source,
      payload.photo_id,
      payload.note,
      existing.id
    );
    audit(req.user.id, 'weigh_in', existing.id, 'update', existing, payload);
  } else {
    db.prepare(
      `INSERT INTO weigh_ins (user_id, date, weight_kg, waist_cm, body_fat_pct, body_fat_source, source, photo_id, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      req.user.id,
      date,
      payload.weight_kg,
      payload.waist_cm,
      payload.body_fat_pct,
      payload.body_fat_source,
      payload.source,
      payload.photo_id,
      payload.note,
      nowIso()
    );
    audit(req.user.id, 'weigh_in', date, 'create', null, payload);
  }
  res.json(db.prepare(`SELECT * FROM weigh_ins WHERE user_id = ? AND date = ?`).get(req.user.id, date));
});

app.delete('/api/weigh-ins/:date', requireAuth, (req, res) => {
  const before = db
    .prepare(`SELECT * FROM weigh_ins WHERE user_id = ? AND date = ?`)
    .get(req.user.id, req.params.date);
  db.prepare(`DELETE FROM weigh_ins WHERE user_id = ? AND date = ?`).run(req.user.id, req.params.date);
  audit(req.user.id, 'weigh_in', req.params.date, 'delete', before, null);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Nutrition                                                           */
/* ------------------------------------------------------------------ */

app.get('/api/meals', requireAuth, (req, res) => {
  const date = req.query.date || todayKey(tzOf(req));
  const rows = mealsByDate(req.user.id, date, date).get(date) || [];
  const goal = currentGoal(req.user.id, date);
  res.json({ date, meals: rows, totals: nutritionTotals(rows), goal });
});

app.post('/api/meals', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const date = b.date || todayKey(tzOf(req));
  const info = db
    .prepare(
      `INSERT INTO meals (user_id, date, slot, name, calories, protein_g, carbs_g, fat_g, source, photo_id, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      date,
      b.slot || 'meal',
      b.name,
      Number(b.calories) || 0,
      Number(b.protein) || 0,
      Number(b.carbs) || 0,
      Number(b.fat) || 0,
      b.photoId ? 'photo_estimate' : b.source || 'user_logged',
      b.photoId || null,
      b.notes || null,
      nowIso()
    );
  audit(req.user.id, 'meal', info.lastInsertRowid, 'create', null, b);
  res.json(db.prepare(`SELECT * FROM meals WHERE id = ?`).get(info.lastInsertRowid));
});

app.delete('/api/meals/:id', requireAuth, (req, res) => {
  const before = db.prepare(`SELECT * FROM meals WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
  db.prepare(`DELETE FROM meals WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  audit(req.user.id, 'meal', req.params.id, 'delete', before, null);
  res.json({ ok: true });
});

app.get('/api/nutrition/week', requireAuth, (req, res) => {
  const tz = tzOf(req);
  const end = req.query.to || todayKey(tz);
  const start = req.query.from || addDaysKey(end, -6);
  const goal = currentGoal(req.user.id, end);
  const meals = mealsByDate(req.user.id, start, end);
  const days = eachDate(start, end).map((date) => {
    const rows = meals.get(date) || [];
    const totals = nutritionTotals(rows);
    return {
      date,
      calories: Math.round(totals.calories),
      protein: Math.round(totals.protein),
      carbs: Math.round(totals.carbs),
      fat: Math.round(totals.fat),
      mealCount: rows.length,
      logged: rows.length > 0,
    };
  });
  res.json({
    start,
    end,
    goal,
    days,
    adherence: adherenceWindow(req.user.id, { goal, from: start, to: end }),
  });
});

app.get('/api/recipes', requireAuth, (req, res) => {
  const recipes = db.prepare(`SELECT * FROM recipes WHERE user_id = ? ORDER BY name`).all(req.user.id);
  const ingredients = db
    .prepare(
      `SELECT ri.* FROM recipe_ingredients ri JOIN recipes r ON r.id = ri.recipe_id WHERE r.user_id = ?`
    )
    .all(req.user.id);
  const byRecipe = new Map();
  for (const ing of ingredients) {
    if (!byRecipe.has(ing.recipe_id)) byRecipe.set(ing.recipe_id, []);
    byRecipe.get(ing.recipe_id).push(ing);
  }
  res.json(recipes.map((r) => ({ ...r, ingredients: byRecipe.get(r.id) || [] })));
});

app.post('/api/recipes', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: 'name is required' });
  const servings = Number(b.servings) || 1;
  const ingredients = Array.isArray(b.ingredients) ? b.ingredients : [];
  const totals = ingredients.reduce(
    (acc, i) => {
      acc.calories += Number(i.calories) || 0;
      acc.protein += Number(i.protein) || 0;
      acc.carbs += Number(i.carbs) || 0;
      acc.fat += Number(i.fat) || 0;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
  const info = db
    .prepare(
      `INSERT INTO recipes (user_id, name, servings, instructions, calories, protein_g, carbs_g, fat_g, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      b.name,
      servings,
      b.instructions || null,
      totals.calories / servings,
      totals.protein / servings,
      totals.carbs / servings,
      totals.fat / servings,
      nowIso()
    );
  const insert = db.prepare(
    `INSERT INTO recipe_ingredients (recipe_id, name, quantity, unit, calories, protein_g, carbs_g, fat_g)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const i of ingredients) {
    insert.run(
      info.lastInsertRowid,
      i.name || 'Ingredient',
      Number(i.quantity) || 0,
      i.unit || 'g',
      Number(i.calories) || 0,
      Number(i.protein) || 0,
      Number(i.carbs) || 0,
      Number(i.fat) || 0
    );
  }
  audit(req.user.id, 'recipe', info.lastInsertRowid, 'create', null, b);
  res.json(db.prepare(`SELECT * FROM recipes WHERE id = ?`).get(info.lastInsertRowid));
});

app.delete('/api/recipes/:id', requireAuth, (req, res) => {
  db.prepare(`DELETE FROM recipes WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Water                                                               */
/* ------------------------------------------------------------------ */

app.get('/api/water', requireAuth, (req, res) => {
  const date = req.query.date || todayKey(tzOf(req));
  const logs = db
    .prepare(`SELECT * FROM water_logs WHERE user_id = ? AND date = ? ORDER BY created_at`)
    .all(req.user.id, date);
  res.json({ date, logs, total: logs.reduce((s, l) => s + l.ml, 0) });
});

app.post('/api/water', requireAuth, (req, res) => {
  const ml = Number(req.body?.ml);
  if (!ml || ml <= 0 || ml > 5000) return res.status(400).json({ error: 'ml must be between 1 and 5000' });
  const date = req.body.date || todayKey(tzOf(req));
  const info = db
    .prepare(`INSERT INTO water_logs (user_id, date, ml, source, created_at) VALUES (?, ?, ?, 'self_reported', ?)`)
    .run(req.user.id, date, Math.round(ml), nowIso());
  audit(req.user.id, 'water', info.lastInsertRowid, 'create', null, { date, ml });
  res.json(db.prepare(`SELECT * FROM water_logs WHERE id = ?`).get(info.lastInsertRowid));
});

app.delete('/api/water/:id', requireAuth, (req, res) => {
  db.prepare(`DELETE FROM water_logs WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Workouts                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/workouts', requireAuth, (req, res) => {
  const tz = tzOf(req);
  const to = req.query.to || todayKey(tz);
  const from = req.query.from || addDaysKey(to, -60);
  const rows = getWorkouts(req.user.id, from, to);
  res.json({ from, to, sessions: rows.map((s) => ({ ...s, evidence: s.health_workout_id ? STATUS.VERIFIED_DEVICE : STATUS.LOGGED_USER })) });
});

app.post('/api/workouts', requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.split) return res.status(400).json({ error: 'split is required' });
  const date = b.date || todayKey(tzOf(req));
  const info = db
    .prepare(
      `INSERT INTO workout_sessions (user_id, date, split, title, status, source, duration_min, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      date,
      b.split,
      b.title || b.split,
      b.status || 'completed',
      b.source || 'user_logged',
      b.durationMin == null ? null : Number(b.durationMin),
      b.notes || null,
      nowIso()
    );
  const sets = Array.isArray(b.sets) ? b.sets : [];
  const insertSet = db.prepare(
    `INSERT INTO exercise_sets (session_id, exercise, set_index, reps, weight_kg, rpe, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  sets.forEach((s, i) => {
    insertSet.run(
      info.lastInsertRowid,
      s.exercise || 'Exercise',
      i + 1,
      Number(s.reps) || 0,
      Number(s.weightKg) || 0,
      s.rpe == null ? null : Number(s.rpe),
      nowIso()
    );
  });
  audit(req.user.id, 'workout', info.lastInsertRowid, 'create', null, b);
  const session = db.prepare(`SELECT * FROM workout_sessions WHERE id = ?`).get(info.lastInsertRowid);
  const savedSets = db.prepare(`SELECT * FROM exercise_sets WHERE session_id = ? ORDER BY set_index`).all(session.id);
  res.json({ ...session, sets: savedSets });
});

app.delete('/api/workouts/:id', requireAuth, (req, res) => {
  db.prepare(`DELETE FROM workout_sessions WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.get('/api/workouts/strength', requireAuth, (req, res) => {
  const tz = tzOf(req);
  const today = todayKey(tz);
  const profile = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`).get(req.user.id);
  res.json(strengthRetention(req.user.id, { today, startDate: profile?.start_date || today }));
});

/* ------------------------------------------------------------------ */
/* Recovery                                                            */
/* ------------------------------------------------------------------ */

app.get('/api/recovery', requireAuth, (req, res) => {
  const tz = tzOf(req);
  const to = req.query.to || todayKey(tz);
  const from = req.query.from || addDaysKey(to, -27);
  res.json({ rows: recoveryForRange(req.user.id, from, to), trend: recoveryTrend(req.user.id, { today: to }) });
});

app.post('/api/recovery', requireAuth, (req, res) => {
  const b = req.body || {};
  const date = b.date || todayKey(tzOf(req));
  const existing = db.prepare(`SELECT * FROM recovery_logs WHERE user_id = ? AND date = ?`).get(req.user.id, date);
  const values = [
    b.sleepHours == null ? null : Number(b.sleepHours),
    b.restingHr == null ? null : Number(b.restingHr),
    b.soreness == null ? null : Number(b.soreness),
    b.readiness == null ? null : Number(b.readiness),
    b.stress == null ? null : Number(b.stress),
    b.notes || null,
    b.source || 'self_reported',
  ];
  if (existing) {
    db.prepare(
      `UPDATE recovery_logs SET sleep_hours = COALESCE(?, sleep_hours), resting_hr = COALESCE(?, resting_hr),
         soreness = COALESCE(?, soreness), readiness = COALESCE(?, readiness), stress = COALESCE(?, stress),
         notes = COALESCE(?, notes), source = ? WHERE id = ?`
    ).run(...values, existing.id);
  } else {
    db.prepare(
      `INSERT INTO recovery_logs (user_id, date, sleep_hours, resting_hr, soreness, readiness, stress, notes, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(req.user.id, date, ...values, nowIso());
  }
  res.json(db.prepare(`SELECT * FROM recovery_logs WHERE user_id = ? AND date = ?`).get(req.user.id, date));
});

/* ------------------------------------------------------------------ */
/* Treadmill                                                           */
/* ------------------------------------------------------------------ */

app.get('/api/treadmill/presets', requireAuth, (req, res) => {
  res.json({ presets: listPresets(req.user.id) });
});

app.post('/api/treadmill/presets', requireAuth, (req, res) => {
  const preset = createPreset(req.user.id, req.body || {});
  res.json(preset);
});

app.put('/api/treadmill/presets/:id', requireAuth, (req, res) => {
  const preset = updatePreset(req.user.id, req.params.id, req.body || {});
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json(preset);
});

app.delete('/api/treadmill/presets/:id', requireAuth, (req, res) => {
  res.json(deletePreset(req.user.id, req.params.id));
});

app.get('/api/treadmill/timeline/:id', requireAuth, (req, res) => {
  const preset = getPreset(req.user.id, req.params.id);
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json({ preset, timeline: buildTimeline(preset) });
});

app.get('/api/treadmill/sessions', requireAuth, (req, res) => {
  const tz = tzOf(req);
  const to = req.query.to || todayKey(tz);
  const from = req.query.from || addDaysKey(to, -90);
  res.json({
    from,
    to,
    sessions: listSessions(req.user.id, { from, to }),
    totals: treadmillTotals(req.user.id, from, to),
  });
});

app.post('/api/treadmill/sessions', requireAuth, (req, res) => {
  const b = req.body || {};
  const date = b.date || todayKey(tzOf(req));
  const at = nowIso();
  const info = db
    .prepare(
      `INSERT INTO treadmill_sessions (user_id, date, preset_id, title, planned_start, start_time, end_time,
         duration_min, speed_kmh, incline_pct, distance_km, avg_hr, max_hr, active_calories, calories_source,
         difficulty, recovery_status, source, status, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      req.user.id,
      date,
      b.presetId || null,
      b.title || 'Incline Fat-Loss Walk',
      b.plannedStart || null,
      b.startTime ? new Date(b.startTime).toISOString() : null,
      b.endTime ? new Date(b.endTime).toISOString() : null,
      b.durationMin == null ? null : Number(b.durationMin),
      b.speedKmh == null ? null : Number(b.speedKmh),
      b.inclinePct == null ? null : Number(b.inclinePct),
      b.distanceKm == null ? null : Number(b.distanceKm),
      b.avgHr == null ? null : Number(b.avgHr),
      b.maxHr == null ? null : Number(b.maxHr),
      b.activeCalories == null ? null : Number(b.activeCalories),
      b.activeCalories == null ? null : 'manual_estimate',
      b.difficulty || null,
      b.recoveryStatus || null,
      b.source || 'manual',
      b.status || 'logged',
      b.notes || null,
      at,
      at
    );
  audit(req.user.id, 'treadmill_session', info.lastInsertRowid, 'create', null, b);
  if (b.startTime) {
    recomputeStepsForDate(req.user.id, date, tzOf(req));
  }
  const row = db.prepare(`SELECT * FROM treadmill_sessions WHERE id = ?`).get(info.lastInsertRowid);
  res.json({ ...row, evidence: sessionStatus(row) });
});

app.put('/api/treadmill/sessions/:id', requireAuth, (req, res) => {
  const before = db
    .prepare(`SELECT * FROM treadmill_sessions WHERE id = ? AND user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!before) return res.status(404).json({ error: 'Session not found' });
  const b = req.body || {};
  db.prepare(
    `UPDATE treadmill_sessions SET
       date = COALESCE(?, date), title = COALESCE(?, title), start_time = COALESCE(?, start_time),
       end_time = COALESCE(?, end_time), duration_min = COALESCE(?, duration_min),
       speed_kmh = COALESCE(?, speed_kmh), incline_pct = COALESCE(?, incline_pct),
       distance_km = COALESCE(?, distance_km), avg_hr = COALESCE(?, avg_hr), max_hr = COALESCE(?, max_hr),
       active_calories = COALESCE(?, active_calories), difficulty = COALESCE(?, difficulty),
       recovery_status = COALESCE(?, recovery_status), status = COALESCE(?, status),
       notes = COALESCE(?, notes), updated_at = ?
     WHERE id = ? AND user_id = ?`
  ).run(
    b.date ?? null,
    b.title ?? null,
    b.startTime ? new Date(b.startTime).toISOString() : null,
    b.endTime ? new Date(b.endTime).toISOString() : null,
    b.durationMin == null ? null : Number(b.durationMin),
    b.speedKmh == null ? null : Number(b.speedKmh),
    b.inclinePct == null ? null : Number(b.inclinePct),
    b.distanceKm == null ? null : Number(b.distanceKm),
    b.avgHr == null ? null : Number(b.avgHr),
    b.maxHr == null ? null : Number(b.maxHr),
    b.activeCalories == null ? null : Number(b.activeCalories),
    b.difficulty ?? null,
    b.recoveryStatus ?? null,
    b.status ?? null,
    b.notes ?? null,
    nowIso(),
    req.params.id,
    req.user.id
  );
  const after = db.prepare(`SELECT * FROM treadmill_sessions WHERE id = ?`).get(req.params.id);
  audit(req.user.id, 'treadmill_session', req.params.id, 'update', before, after);
  if (before.date || after.date) {
    recomputeStepsForDate(req.user.id, before.date, tzOf(req));
    if (after.date !== before.date) recomputeStepsForDate(req.user.id, after.date, tzOf(req));
  }
  res.json({ ...after, evidence: sessionStatus(after) });
});

app.delete('/api/treadmill/sessions/:id', requireAuth, (req, res) => {
  const before = db
    .prepare(`SELECT * FROM treadmill_sessions WHERE id = ? AND user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!before) return res.status(404).json({ error: 'Session not found' });
  db.prepare(`DELETE FROM treadmill_sessions WHERE id = ? AND user_id = ?`).run(req.params.id, req.user.id);
  if (before.console_photo_id) removePhoto(req.user.id, before.console_photo_id);
  audit(req.user.id, 'treadmill_session', req.params.id, 'delete', before, null);
  recomputeStepsForDate(req.user.id, before.date, tzOf(req));
  res.json({ ok: true });
});

app.get('/api/treadmill/schedule', requireAuth, wrap((req, res) => {
  const tz = tzOf(req);
  const today = todayKey(tz);
  const profile = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`).get(req.user.id);
  const sessions = listSessions(req.user.id, { from: addDaysKey(today, -6), to: today });
  const weekStart = weekStartKey(today);

  const days = WEEKLY_CARDIO_PLAN.map((day) => {
    const dateOffset = (day.dow + 6) % 7; // Monday = 0
    const date = addDaysKey(weekStart, dateOffset);
    const daySessions = sessions.filter((s) => s.date === date);
    return {
      ...day,
      date,
      isToday: date === today,
      completedMinutes: daySessions.reduce((sum, s) => sum + (s.duration_min || 0), 0),
      sessions: daySessions,
      met: daySessions.length > 0 && daySessions.reduce((sum, s) => sum + (s.duration_min || 0), 0) >= day.minMinutes,
    };
  });

  res.json({
    weekStart,
    today,
    days,
    progression: cardioProgression(req.user.id, { today }),
    totals: treadmillTotals(req.user.id, weekStart, today),
    goal: currentGoal(req.user.id, today),
    startDate: profile?.start_date,
  });
}));

app.get('/api/treadmill/weekly', requireAuth, (req, res) => {
  const tz = tzOf(req);
  const today = todayKey(tz);
  const weeks = [];
  for (let i = 7; i >= 0; i -= 1) {
    const start = addDaysKey(weekStartKey(today), -7 * i);
    const end = addDaysKey(start, 6);
    weeks.push({ start, end, ...treadmillTotals(req.user.id, start, end > today ? today : end) });
  }
  res.json({ weeks });
});

/* ------------------------------------------------------------------ */
/* Photos                                                              */
/* ------------------------------------------------------------------ */

function removePhoto(userId, photoId) {
  if (!photoId) return;
  const photo = db.prepare(`SELECT * FROM photos WHERE id = ? AND user_id = ?`).get(photoId, userId);
  if (!photo) return;
  const file = path.join(PHOTO_DIR, String(userId), photo.filename);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch (err) {
    console.warn('[photos] could not remove file', file, err.message);
  }
  db.prepare(`DELETE FROM photos WHERE id = ?`).run(photoId);
}

function savePhoto(userId, file, kind) {
  const ext = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/heic': '.heic',
    'image/heif': '.heif',
  }[file.mimetype] || '.jpg';
  const userDir = path.join(PHOTO_DIR, String(userId));
  fs.mkdirSync(userDir, { recursive: true });
  const filename = `${kind}-${crypto.randomUUID()}${ext}`;
  fs.writeFileSync(path.join(userDir, filename), file.buffer);
  const info = db
    .prepare(
      `INSERT INTO photos (user_id, kind, filename, original_name, mime, size, taken_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(userId, kind, filename, file.originalname, file.mimetype, file.size, null, nowIso());
  return db.prepare(`SELECT * FROM photos WHERE id = ?`).get(info.lastInsertRowid);
}

app.post('/api/photos', requireAuth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
  const kind = req.body.kind || 'general';
  const photo = savePhoto(req.user.id, req.file, kind);
  audit(req.user.id, 'photo', photo.id, 'upload', null, { kind, size: photo.size });
  res.json(photo);
});

app.get('/api/photos/:id', requireAuth, (req, res) => {
  const photo = db.prepare(`SELECT * FROM photos WHERE id = ? AND user_id = ?`).get(req.params.id, req.user.id);
  if (!photo) return res.status(404).json({ error: 'Not found' });
  const file = path.join(PHOTO_DIR, String(req.user.id), photo.filename);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'File missing' });
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.type(photo.mime);
  res.sendFile(file);
});

app.get('/api/progress-photos', requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT pp.*, p.mime, p.size FROM progress_photos pp
       JOIN photos p ON p.id = pp.photo_id
       WHERE pp.user_id = ? ORDER BY pp.week_start DESC, pp.angle ASC`
    )
    .all(req.user.id);
  res.json({ photos: rows });
});

app.post('/api/progress-photos', requireAuth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
  const angle = ['front', 'side', 'back'].includes(req.body.angle) ? req.body.angle : 'front';
  const weekStart = req.body.weekStart || weekStartKey(todayKey(tzOf(req)));
  const photo = savePhoto(req.user.id, req.file, 'progress');

  const existing = db
    .prepare(`SELECT * FROM progress_photos WHERE user_id = ? AND week_start = ? AND angle = ?`)
    .get(req.user.id, weekStart, angle);

  if (existing) {
    removePhoto(req.user.id, existing.photo_id);
    db.prepare(`UPDATE progress_photos SET photo_id = ?, created_at = ? WHERE id = ?`).run(
      photo.id,
      nowIso(),
      existing.id
    );
  } else {
    db.prepare(
      `INSERT INTO progress_photos (user_id, week_start, angle, photo_id, created_at) VALUES (?, ?, ?, ?, ?)`
    ).run(req.user.id, weekStart, angle, photo.id, nowIso());
  }
  audit(req.user.id, 'progress_photo', photo.id, existing ? 'replace' : 'create', existing || null, {
    weekStart,
    angle,
  });
  res.json({ ...photo, weekStart, angle });
});

app.delete('/api/progress-photos/:id', requireAuth, (req, res) => {
  const row = db
    .prepare(`SELECT * FROM progress_photos WHERE id = ? AND user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  db.prepare(`DELETE FROM progress_photos WHERE id = ?`).run(req.params.id);
  const photo = db.prepare(`SELECT * FROM photos WHERE id = ?`).get(row.photo_id);
  if (photo) {
    const file = path.join(PHOTO_DIR, String(req.user.id), photo.filename);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    db.prepare(`DELETE FROM photos WHERE id = ?`).run(photo.id);
  }
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Treadmill console photo analysis                                    */
/* ------------------------------------------------------------------ */

app.post('/api/treadmill/sessions/:id/console', requireAuth, upload.single('photo'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
  const session = db
    .prepare(`SELECT * FROM treadmill_sessions WHERE id = ? AND user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const photo = savePhoto(req.user.id, req.file, 'console');
  if (session.console_photo_id) removePhoto(req.user.id, session.console_photo_id);
  const filePath = path.join(PHOTO_DIR, String(req.user.id), photo.filename);

  const ocr = await recogniseText(filePath);
  const parsed = parseConsoleReadings(ocr.lines, session);

  db.prepare(
    `UPDATE treadmill_sessions SET console_photo_id = ?, console_extracted_json = ?, console_confirmed = 0, updated_at = ?
     WHERE id = ?`
  ).run(photo.id, JSON.stringify({ ...parsed, ocr: { ok: ocr.ok, reason: ocr.reason || null, lineCount: ocr.lines.length } }), nowIso(), session.id);

  audit(req.user.id, 'treadmill_session', session.id, 'console_photo', null, {
    photoId: photo.id,
    extracted: parsed.extracted,
    discrepancy: parsed.hasDiscrepancy,
  });

  res.json({
    photo,
    ocrAvailable: ocr.ok,
    ocrReason: ocr.reason || null,
    recognisedLines: ocr.lines.map((l) => l.text),
    ...parsed,
  });
}));

app.post('/api/treadmill/sessions/:id/console/confirm', requireAuth, (req, res) => {
  const session = db
    .prepare(`SELECT * FROM treadmill_sessions WHERE id = ? AND user_id = ?`)
    .get(req.params.id, req.user.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const b = req.body || {};
  const updates = [];
  const params = [];
  const map = {
    speedKmh: 'speed_kmh',
    inclinePct: 'incline_pct',
    durationMin: 'duration_min',
    distanceKm: 'distance_km',
    activeCalories: 'active_calories',
  };
  for (const [key, col] of Object.entries(map)) {
    if (b[key] != null && Number.isFinite(Number(b[key]))) {
      updates.push(`${col} = ?`);
      params.push(Number(b[key]));
    }
  }
  if (updates.length) {
    db.prepare(
      `UPDATE treadmill_sessions SET ${updates.join(', ')}, console_confirmed = 1, updated_at = ? WHERE id = ?`
    ).run(...params, nowIso(), session.id);
  } else {
    db.prepare(`UPDATE treadmill_sessions SET console_confirmed = 1, updated_at = ? WHERE id = ?`).run(
      nowIso(),
      session.id
    );
  }
  audit(req.user.id, 'treadmill_session', session.id, 'console_confirm', session, b);
  const after = db.prepare(`SELECT * FROM treadmill_sessions WHERE id = ?`).get(session.id);
  res.json({ ...after, evidence: sessionStatus(after) });
});

/* ------------------------------------------------------------------ */
/* Health sync                                                         */
/* ------------------------------------------------------------------ */

app.post('/api/health/sync', requireAuthOrToken, wrap((req, res) => {
  const result = ingestHealthSync(req.user.id, req.body || {});
  res.json(result);
}));

app.get('/api/health/tokens', requireAuth, (req, res) => {
  res.json({ tokens: listHealthTokens(req.user.id) });
});

app.post('/api/health/tokens', requireAuth, (req, res) => {
  const token = createHealthToken(req.user.id, req.body?.label || 'iPhone companion');
  audit(req.user.id, 'health_token', null, 'create', null, { label: req.body?.label || 'iPhone companion' });
  res.json({ token, label: req.body?.label || 'iPhone companion' });
});

app.delete('/api/health/tokens/:id', requireAuth, (req, res) => {
  revokeHealthToken(req.user.id, req.params.id);
  res.json({ ok: true });
});

app.get('/api/export', requireAuth, (req, res) => {
  const uid = req.user.id;
  const data = {
    exportedAt: nowIso(),
    user: db.prepare(`SELECT id, email, name, timezone, created_at FROM users WHERE id = ?`).get(uid),
    profile: db.prepare(`SELECT * FROM profiles WHERE user_id = ?`).get(uid),
    goals: db.prepare(`SELECT * FROM goals WHERE user_id = ?`).all(uid),
    weighIns: db.prepare(`SELECT * FROM weigh_ins WHERE user_id = ?`).all(uid),
    meals: db.prepare(`SELECT * FROM meals WHERE user_id = ?`).all(uid),
    water: db.prepare(`SELECT * FROM water_logs WHERE user_id = ?`).all(uid),
    workouts: db.prepare(`SELECT * FROM workout_sessions WHERE user_id = ?`).all(uid),
    exerciseSets: db
      .prepare(`SELECT es.* FROM exercise_sets es JOIN workout_sessions ws ON ws.id = es.session_id WHERE ws.user_id = ?`)
      .all(uid),
    treadmillPresets: db.prepare(`SELECT * FROM treadmill_presets WHERE user_id = ?`).all(uid),
    treadmillSessions: db.prepare(`SELECT * FROM treadmill_sessions WHERE user_id = ?`).all(uid),
    stepsDaily: db.prepare(`SELECT * FROM steps_daily WHERE user_id = ?`).all(uid),
    healthSyncs: db.prepare(`SELECT * FROM health_syncs WHERE user_id = ?`).all(uid),
    healthWorkouts: db.prepare(`SELECT * FROM health_workouts WHERE user_id = ?`).all(uid),
    recovery: db.prepare(`SELECT * FROM recovery_logs WHERE user_id = ?`).all(uid),
    checkpoints: db.prepare(`SELECT * FROM daily_checkpoints WHERE user_id = ?`).all(uid),
    audit: db.prepare(`SELECT * FROM audit_log WHERE user_id = ? ORDER BY at`).all(uid),
  };
  res.setHeader('Content-Disposition', `attachment; filename="fitness-os-export-${todayKey(tzOf(req))}.json"`);
  res.json(data);
});

app.get('/api/health/status', requireAuth, (req, res) => {
  const tz = tzOf(req);
  const today = todayKey(tz);
  res.json({
    freshness: healthFreshness(req.user.id),
    syncs: recentSyncs(req.user.id, 10),
    workouts: healthWorkouts(req.user.id, 20),
    stepsToday: stepsForDate(req.user.id, today),
  });
});

app.get('/api/steps', requireAuth, (req, res) => {
  const tz = tzOf(req);
  const to = req.query.to || todayKey(tz);
  const from = req.query.from || addDaysKey(to, -29);
  const rows = db
    .prepare(`SELECT * FROM steps_daily WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`)
    .all(req.user.id, from, to);
  const health = healthFreshness(req.user.id);
  res.json({ from, to, rows, health });
});

app.post('/api/steps/recompute', requireAuth, wrap((req, res) => {
  const tz = tzOf(req);
  const date = req.body?.date || todayKey(tz);
  res.json(recomputeStepsForDate(req.user.id, date, tz));
}));

/* ------------------------------------------------------------------ */
/* Checkpoints                                                         */
/* ------------------------------------------------------------------ */

app.get('/api/checkpoints', requireAuth, (req, res) => {
  res.json({ checkpoints: listCheckpoints(req.user.id, Number(req.query.limit) || 30) });
});

app.get('/api/checkpoints/preview', requireAuth, wrap((req, res) => {
  const tz = tzOf(req);
  const date = req.query.date || todayKey(tz);
  res.json(buildSnapshot(req.user.id, date, tz));
}));

app.get('/api/checkpoints/:date', requireAuth, (req, res) => {
  const row = db
    .prepare(`SELECT * FROM daily_checkpoints WHERE user_id = ? AND date = ?`)
    .get(req.user.id, req.params.date);
  if (!row) return res.status(404).json({ error: 'No checkpoint for that date' });
  res.json(hydrate(row));
});

app.post('/api/checkpoints', requireAuth, wrap((req, res) => {
  const tz = tzOf(req);
  const date = req.body?.date || todayKey(tz);
  const result = createCheckpoint(req.user.id, date, tz, { force: !!req.body?.force });
  res.json(result);
}));

app.post('/api/checkpoints/:date/reconcile', requireAuth, wrap((req, res) => {
  res.json(reconcileCheckpoint(req.user.id, req.params.date));
}));

/* ------------------------------------------------------------------ */
/* Analytics / dashboard series                                        */
/* ------------------------------------------------------------------ */

app.get('/api/dashboard', requireAuth, wrap((req, res) => {
  const tz = tzOf(req);
  const today = todayKey(tz);
  const range = Math.min(120, Math.max(7, Number(req.query.days) || 60));
  const from = addDaysKey(today, -range);
  const { profile } = getProfile(req.user.id);
  const goal = currentGoal(req.user.id, today);
  const weighIns = getWeighIns(req.user.id, { from, to: today });
  const meals = mealsByDate(req.user.id, from, today);
  const stepRows = db
    .prepare(`SELECT * FROM steps_daily WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`)
    .all(req.user.id, from, today);
  const treadRows = getTreadmillSessions(req.user.id, from, today);
  const recoveryRows = recoveryForRange(req.user.id, from, today);
  const workouts = getWorkouts(req.user.id, from, today);

  const days = eachDate(from, today).map((date) => {
    const dayMeals = meals.get(date) || [];
    const totals = nutritionTotals(dayMeals);
    const steps = stepRows.find((s) => s.date === date);
    const tread = treadRows.filter((t) => t.date === date);
    const recovery = recoveryRows.find((r) => r.date === date);
    return {
      date,
      calories: Math.round(totals.calories),
      protein: Math.round(totals.protein),
      carbs: Math.round(totals.carbs),
      fat: Math.round(totals.fat),
      mealCount: dayMeals.length,
      totalSteps: steps?.total_steps ?? null,
      treadmillSteps: steps?.treadmill_steps ?? null,
      qualifyingSteps: steps?.qualifying_steps ?? null,
      stepsMethod: steps?.method ?? 'none',
      stepsUncertainty: steps?.uncertainty_pct ?? null,
      treadmillMinutes: tread.reduce((s, t) => s + (t.duration_min || 0), 0),
      treadmillSessions: tread.length,
      sleepHours: recovery?.sleep_hours ?? null,
      readiness: recovery?.readiness ?? null,
      soreness: recovery?.soreness ?? null,
      workoutCount: workouts.filter((w) => w.date === date).length,
    };
  });

  res.json({
    from,
    to: today,
    days,
    goal,
    profile,
    weight: {
      weighIns,
      series: rollingAverageSeries(getWeighIns(req.user.id)),
      projection: projectWeight({
        weighIns: getWeighIns(req.user.id),
        checkpointDate: profile?.checkpoint_date || '2026-12-01',
        today,
      }),
    },
    adherence: adherenceWindow(req.user.id, { goal, from, to: today }),
    treadmillTotals: treadmillTotals(req.user.id, from, today),
    stepsTotals: {
      total: stepRows.reduce((s, r) => s + (r.total_steps || 0), 0),
      treadmill: stepRows.reduce((s, r) => s + (r.treadmill_steps || 0), 0),
      qualifying: stepRows.reduce((s, r) => s + (r.qualifying_steps || 0), 0),
    },
    strength: strengthRetention(req.user.id, { today, startDate: profile?.start_date || today }),
    recovery: recoveryTrend(req.user.id, { today }),
    health: healthFreshness(req.user.id),
  });
}));

app.get('/api/transformation', requireAuth, wrap((req, res) => {
  const tz = tzOf(req);
  const today = todayKey(tz);
  const { profile, goals } = getProfile(req.user.id);
  const goal = currentGoal(req.user.id, today);
  const weighIns = getWeighIns(req.user.id);
  const startDate = profile?.start_date || today;
  const checkpoint = profile?.checkpoint_date || '2026-12-01';

  const first = weighIns[0] || null;
  const latest = weighIns.length ? weighIns[weighIns.length - 1] : null;
  const latestBodyFat = [...weighIns].reverse().find((w) => w.body_fat_pct != null) || null;
  const series = rollingAverageSeries(weighIns);
  const projection = projectWeight({ weighIns, checkpointDate: checkpoint, today });
  const strength = strengthRetention(req.user.id, { today, startDate });

  const weeks = [];
  const totalWeeks = Math.ceil(
    (new Date(checkpoint).getTime() - new Date(startDate).getTime()) / (7 * 86_400_000)
  );
  for (let i = 0; i < totalWeeks; i += 1) {
    const start = addDaysKey(startDate, i * 7);
    const end = addDaysKey(start, 6);
    const nutrition = adherenceWindow(req.user.id, { goal, from: start, to: end });
    const tread = treadmillTotals(req.user.id, start, end);
    const recovery = recoveryForRange(req.user.id, start, end);
    const weekWeighIns = weighIns.filter((w) => w.date >= start && w.date <= end);
    weeks.push({
      week: i + 1,
      start,
      end,
      isCurrent: today >= start && today <= end,
      isFuture: start > today,
      weightAvg: weekWeighIns.length
        ? Math.round((weekWeighIns.reduce((s, w) => s + w.weight_kg, 0) / weekWeighIns.length) * 10) / 10
        : null,
      waist: weekWeighIns.find((w) => w.waist_cm != null)?.waist_cm ?? null,
      calories: nutrition.calorieAdherencePct,
      protein: nutrition.proteinConsistencyPct,
      loggedDays: nutrition.loggedDays,
      treadmillMinutes: tread.minutes,
      sleep: recovery.filter((r) => r.sleep_hours != null).length
        ? Math.round((recovery.reduce((s, r) => s + (r.sleep_hours || 0), 0) / recovery.filter((r) => r.sleep_hours != null).length) * 10) / 10
        : null,
      readiness: recovery.filter((r) => r.readiness != null).length
        ? Math.round((recovery.reduce((s, r) => s + (r.readiness || 0), 0) / recovery.filter((r) => r.readiness != null).length) * 10) / 10
        : null,
    });
  }

  const photos = db
    .prepare(
      `SELECT pp.* FROM progress_photos pp WHERE pp.user_id = ? ORDER BY pp.week_start ASC`
    )
    .all(req.user.id);

  res.json({
    startDate,
    checkpoint,
    today,
    profile,
    goal,
    goals,
    first,
    latest,
    latestBodyFat,
    series,
    projection,
    strength,
    weeks,
    photos,
    progress: programProgress(startDate, checkpoint, today),
    coach: coach({
      userId: req.user.id,
      profile: profile || { start_date: startDate, checkpoint_date: checkpoint },
      goal,
      weighIns,
      today,
    }),
    adherence: adherenceWindow(req.user.id, { goal, from: addDaysKey(today, -6), to: today }),
    treadmill: treadmillTotals(req.user.id, addDaysKey(today, -6), today),
    steps: stepsForDate(req.user.id, today),
    recovery: recoveryTrend(req.user.id, { today }),
    health: healthFreshness(req.user.id),
  });
}));

app.get('/api/evidence', requireAuth, (req, res) => {
  const tz = tzOf(req);
  const today = todayKey(tz);
  const goal = currentGoal(req.user.id, today);
  const meals = mealsByDate(req.user.id, today, today).get(today) || [];
  const water = waterTotal(req.user.id, today);
  const workouts = getWorkouts(req.user.id, today, today);
  const tread = getTreadmillSessions(req.user.id, today, today);
  const steps = stepsForDate(req.user.id, today);
  const weighIns = getWeighIns(req.user.id, { to: today });
  const health = healthFreshness(req.user.id);

  res.json({
    date: today,
    requirements: EVIDENCE_REQUIREMENTS,
    statusMeta: STATUS_META,
    goals: {
      nutrition: {
        status: meals.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
        detail: `${meals.length} meal${meals.length === 1 ? '' : 's'} logged`,
      },
      water: {
        status: water > 0 ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
        detail: `${water} ml logged, self-reported`,
      },
      workout: {
        status: workouts.length
          ? workouts.some((w) => w.health_workout_id)
            ? STATUS.VERIFIED_DEVICE
            : STATUS.LOGGED_USER
          : STATUS.NOT_RECORDED,
        detail: workouts.length ? `${workouts.length} session(s)` : 'No session logged',
      },
      treadmill: {
        status: tread.length
          ? tread.some((s) => s.health_workout_id)
            ? STATUS.VERIFIED_DEVICE
            : tread.some((s) => s.console_photo_id)
              ? STATUS.NEEDS_REVIEW
              : STATUS.LOGGED_USER
          : STATUS.NOT_RECORDED,
        detail: tread.length
          ? `${tread.reduce((s, t) => s + (t.duration_min || 0), 0)} min logged`
          : 'No treadmill session logged',
      },
      steps: {
        status: !steps
          ? STATUS.PENDING_SYNC
          : health.stale
            ? STATUS.PENDING_SYNC
            : steps.status === 'estimated'
              ? STATUS.AI_ESTIMATED
              : STATUS.VERIFIED_DEVICE,
        detail: steps
          ? `${steps.qualifying_steps} qualifying · ${steps.treadmill_steps} treadmill · ${steps.total_steps} total`
          : 'No step data received',
      },
      bodyweight: {
        status: weighIns.length ? STATUS.LOGGED_USER : STATUS.NOT_RECORDED,
        detail: weighIns.length
          ? `${weighIns[weighIns.length - 1].weight_kg} kg on ${weighIns[weighIns.length - 1].date}`
          : 'No weigh-in yet',
      },
    },
    health,
  });
});

app.get('/api/audit', requireAuth, (req, res) => {
  const rows = db
    .prepare(`SELECT * FROM audit_log WHERE user_id = ? ORDER BY at DESC LIMIT ?`)
    .all(req.user.id, Math.min(500, Number(req.query.limit) || 100));
  res.json({ rows });
});

app.get('/api/jobs', requireAuth, (req, res) => {
  res.json({
    runs: listJobRuns(30),
    nextCloseout: nextScheduledRun(tzOf(req)),
    timezone: tzOf(req),
  });
});

/* ------------------------------------------------------------------ */
/* Demo mode                                                           */
/* ------------------------------------------------------------------ */

app.post('/api/demo/reset', requireAuth, wrap((req, res) => {
  if (!req.user.is_demo) return res.status(403).json({ error: 'Demo reset is only available in demo mode' });
  res.json({ ok: true, message: 'Use `npm run reset:demo` from the project root.' });
}));

/* ------------------------------------------------------------------ */
/* Static + errors                                                     */
/* ------------------------------------------------------------------ */

const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error('[api] error', err);
  res.status(err.status || 500).json({ error: err.message || 'Internal error' });
});

const PORT = Number(process.env.PORT) || 4173;
export function startServer() {
  startScheduler();
  return app.listen(PORT, () => {
    console.log(`[fitness-os] http://localhost:${PORT}`);
  });
}

if (process.argv[1] && process.argv[1].endsWith('index.js')) {
  startServer();
}

export { app };
