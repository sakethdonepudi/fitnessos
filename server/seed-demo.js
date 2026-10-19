/**
 * Demo seed.
 *
 * Creates a SEPARATE demo account (demo@fitness.local / demo12345) with
 * synthetic data. The demo account is flagged is_demo = 1 and the UI shows a
 * persistent banner. Nothing here is ever written to a real account.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, nowIso, audit, PHOTO_DIR } from './db.js';
import { createUser } from './auth.js';
import { addDaysKey, todayKey, weekStartKey } from './lib/dates.js';
import { ensureDefaultPreset } from './lib/treadmill.js';
import { recomputeStepsForDate } from './lib/sync.js';
import { createCheckpoint } from './lib/checkpoint.js';

const DEMO_EMAIL = 'demo@fitness.local';
const DEMO_PASSWORD = 'demo12345';

function resetDemo() {
  const user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(DEMO_EMAIL);
  if (!user) return null;
  db.prepare(`DELETE FROM users WHERE id = ?`).run(user.id);
  fs.rmSync(path.join(PHOTO_DIR, String(user.id)), { recursive: true, force: true });
  return user.id;
}

function rand(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export function seedDemo({ reset = false } = {}) {
  if (reset) resetDemo();

  let user = db.prepare(`SELECT * FROM users WHERE email = ?`).get(DEMO_EMAIL);
  let userId;
  if (!user) {
    userId = createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      name: 'Demo Athlete',
      timezone: 'Asia/Kolkata',
      isDemo: true,
    });
  } else {
    userId = user.id;
    db.prepare(`DELETE FROM meals WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM water_logs WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM weigh_ins WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM workout_sessions WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM treadmill_sessions WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM recovery_logs WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM steps_daily WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM health_step_samples WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM health_workouts WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM health_syncs WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM daily_checkpoints WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM progress_photos WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM photos WHERE user_id = ?`).run(userId);
    db.prepare(`DELETE FROM recipes WHERE user_id = ?`).run(userId);
  }

  const tz = 'Asia/Kolkata';
  const today = todayKey(tz);
  const start = addDaysKey(today, -27);

  db.prepare(
    `INSERT INTO profiles (user_id, sex, birth_date, height_cm, start_date, checkpoint_date, waist_start_cm, activity_level, notes, updated_at)
     VALUES (?, 'male', '2002-03-14', 183, ?, '2026-12-01', 91.44, 'moderate', 'Demo account — sample data only.', ?)
     ON CONFLICT(user_id) DO UPDATE SET start_date = excluded.start_date, updated_at = excluded.updated_at`
  ).run(userId, start, nowIso());

  db.prepare(`DELETE FROM goals WHERE user_id = ?`).run(userId);
  db.prepare(
    `INSERT INTO goals (user_id, effective_from, calories, protein_g, carbs_g, fat_g, water_ml, step_goal, treadmill_min_week, target_weight_kg, updated_at)
     VALUES (?, ?, 2400, 175, 240, 70, 3000, 10000, 150, 84, ?)`
  ).run(userId, start, nowIso());

  const preset = ensureDefaultPreset(userId);
  const rng = rand(20261019);

  const splits = ['Push', 'Pull', 'Legs', 'Recovery', 'Shoulders', 'Arms', 'Rest'];
  const exercises = {
    Push: ['Incline DB Press', 'Cable Fly', 'Overhead Press', 'Lateral Raise'],
    Pull: ['Lat Pulldown', 'Chest-Supported Row', 'Face Pull', 'Curl'],
    Legs: ['Hack Squat', 'Romanian Deadlift', 'Leg Extension', 'Calf Raise'],
    Recovery: [],
    Shoulders: ['Shoulder Press', 'Lateral Raise', 'Rear Delt Fly'],
    Arms: ['Curl', 'Triceps Pushdown', 'Hammer Curl'],
    Rest: [],
  };
  const weightBase = {
    'Incline DB Press': 26,
    'Cable Fly': 13,
    'Overhead Press': 36,
    'Lateral Raise': 8,
    'Lat Pulldown': 56,
    'Chest-Supported Row': 46,
    'Face Pull': 22,
    Curl: 14,
    'Hack Squat': 80,
    'Romanian Deadlift': 70,
    'Leg Extension': 45,
    'Calf Raise': 55,
    'Shoulder Press': 30,
    'Rear Delt Fly': 8,
    'Triceps Pushdown': 28,
    'Hammer Curl': 14,
  };

  const insertWeigh = db.prepare(
    `INSERT INTO weigh_ins (user_id, date, weight_kg, waist_cm, body_fat_pct, body_fat_source, source, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'self_reported', ?, ?)`
  );
  const insertMeal = db.prepare(
    `INSERT INTO meals (user_id, date, slot, name, calories, protein_g, carbs_g, fat_g, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'user_logged', ?)`
  );
  const insertWater = db.prepare(
    `INSERT INTO water_logs (user_id, date, ml, source, created_at) VALUES (?, ?, ?, 'self_reported', ?)`
  );
  const insertWorkout = db.prepare(
    `INSERT INTO workout_sessions (user_id, date, split, title, status, source, duration_min, notes, created_at)
     VALUES (?, ?, ?, ?, 'completed', 'user_logged', ?, 'Demo sample session', ?)`
  );
  const insertSet = db.prepare(
    `INSERT INTO exercise_sets (session_id, exercise, set_index, reps, weight_kg, rpe, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  const insertTread = db.prepare(
    `INSERT INTO treadmill_sessions (user_id, date, preset_id, title, start_time, end_time, duration_min,
       speed_kmh, incline_pct, distance_km, avg_hr, max_hr, active_calories, calories_source, difficulty,
       recovery_status, source, status, notes, created_at, updated_at)
     VALUES (?, ?, ?, 'Incline Fat-Loss Walk', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual_estimate', ?, ?, 'manual', 'logged', 'Demo sample session', ?, ?)`
  );
  const insertRecovery = db.prepare(
    `INSERT INTO recovery_logs (user_id, date, sleep_hours, resting_hr, soreness, readiness, stress, notes, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'Demo sample', 'self_reported', ?)`
  );
  const insertSample = db.prepare(
    `INSERT OR REPLACE INTO health_step_samples (id, user_id, start_time, end_time, steps, source, device, imported_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );

  let weight = 91.0;
  let waist = 91.44;
  const now = nowIso();

  const tx = db.transaction(() => {
    for (let i = 27; i >= 0; i -= 1) {
      const date = addDaysKey(today, -i);
      const dayIndex = 27 - i;
      const dow = new Date(`${date}T00:00:00Z`).getUTCDay();

      // Weight drifts down slowly with realistic noise.
      if (dayIndex % 1 === 0) {
        weight -= 0.055 + (rng() - 0.5) * 0.22;
        if (dayIndex % 7 === 0) waist -= 0.35;
        insertWeigh.run(
          userId,
          date,
          Math.round(weight * 10) / 10,
          Math.round(waist * 10) / 10,
          dayIndex % 7 === 0 ? Math.round((21.5 - dayIndex * 0.045) * 10) / 10 : null,
          dayIndex % 7 === 0 ? 'estimate' : null,
          'Demo sample weigh-in',
          now
        );
      }

      // Meals
      const breakfast = 520 + Math.round(rng() * 90);
      const lunch = 720 + Math.round(rng() * 120);
      const dinner = 760 + Math.round(rng() * 110);
      const snack = 260 + Math.round(rng() * 90);
      insertMeal.run(userId, date, 'breakfast', 'Greek yoghurt, oats and berries', breakfast, 42, 58, 14, now);
      insertMeal.run(userId, date, 'lunch', 'Chicken rice bowl', lunch, 58, 82, 18, now);
      insertMeal.run(userId, date, 'dinner', 'Salmon, potatoes and greens', dinner, 52, 64, 26, now);
      insertMeal.run(userId, date, 'snack', 'Protein shake and fruit', snack, 34, 34, 6, now);

      insertWater.run(userId, date, 500, now);
      insertWater.run(userId, date, 750, now);
      insertWater.run(userId, date, 500, now);
      insertWater.run(userId, date, 750, now);

      const split = splits[(dow + 6) % 7];
      if (split !== 'Rest' && split !== 'Recovery') {
        const info = insertWorkout.run(userId, date, split, split, 62, now);
        const list = exercises[split];
        list.forEach((exercise, ei) => {
          for (let s = 1; s <= 3; s += 1) {
            const base = weightBase[exercise] || 20;
            const load = base + s * 1.5 + (27 - dayIndex) * 0.09;
            insertSet.run(
              info.lastInsertRowid,
              exercise,
              ei * 3 + s,
              8 + Math.round(rng() * 4),
              Math.round(load * 2) / 2,
              7.5,
              now
            );
          }
        });

        if (dayIndex % 5 === 0) {
          const healthId = `demo-strength-${date}`;
          db.prepare(
            `INSERT OR REPLACE INTO health_workouts (id, user_id, type, start_time, end_time, duration_sec,
               distance_km, avg_hr, max_hr, active_calories, source, device, imported_at, linked_workout_id)
             VALUES (?, ?, 'traditional_strength_training', ?, ?, 3720, NULL, 118, 148, 240, 'Apple Watch',
               'Apple Watch Series 9', ?, ?)`
          ).run(
            healthId,
            userId,
            new Date(`${date}T17:00:00+05:30`).toISOString(),
            new Date(`${date}T18:02:00+05:30`).toISOString(),
            now,
            info.lastInsertRowid
          );
          db.prepare(
            `UPDATE workout_sessions SET health_workout_id = ?, source = 'healthkit' WHERE id = ?`
          ).run(healthId, info.lastInsertRowid);
        }
      }

      // Treadmill on non-leg days
      if (split !== 'Rest' && split !== 'Legs') {
        const duration = 26 + Math.round(rng() * 5);
        const startMin = 18 * 60 + 10;
        const endMin = startMin + duration;
        const fmt = (m) => new Date(`${date}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00+05:30`).toISOString();
        const startIso = fmt(startMin);
        const endIso = fmt(endMin);
        const treadInfo = insertTread.run(
          userId,
          date,
          preset.id,
          startIso,
          endIso,
          duration,
          Math.round((3.6 + rng() * 0.5) * 10) / 10,
          Math.round(5 + rng() * 2.5),
          Math.round((duration / 60) * 4.2 * 100) / 100,
          128 + Math.round(rng() * 12),
          152 + Math.round(rng() * 8),
          190 + Math.round(rng() * 40),
          rng() > 0.7 ? 'moderate' : 'comfortable',
          'good',
          now,
          now
        );

        if (dayIndex % 3 === 0) {
          const healthId = `demo-indoor-${date}`;
          db.prepare(
            `INSERT OR REPLACE INTO health_workouts (id, user_id, type, start_time, end_time, duration_sec,
               distance_km, avg_hr, max_hr, active_calories, source, device, imported_at, linked_treadmill_id)
             VALUES (?, ?, 'indoor_walk', ?, ?, ?, ?, ?, ?, ?, 'Apple Watch', 'Apple Watch Series 9', ?, ?)`
          ).run(
            healthId,
            userId,
            startIso,
            endIso,
            duration * 60,
            Math.round((duration / 60) * 4.2 * 100) / 100,
            130,
            152,
            210,
            now,
            treadInfo.lastInsertRowid
          );
          db.prepare(
            `UPDATE treadmill_sessions SET health_workout_id = ?, source = 'healthkit' WHERE id = ?`
          ).run(healthId, treadInfo.lastInsertRowid);
        }
      }

      insertRecovery.run(
        userId,
        date,
        6.6 + rng() * 1.4,
        56 + Math.round(rng() * 6),
        2 + Math.round(rng() * 2),
        3 + Math.round(rng() * 2),
        2 + Math.round(rng() * 2),
        now
      );

      // HealthKit-ish step samples, every 15 minutes from 07:00 to 22:00.
      const dayBase = new Date(`${date}T00:00:00+05:30`).getTime();
      for (let m = 7 * 60; m < 22 * 60; m += 15) {
        const startMs = dayBase + m * 60_000;
        const walking = m > 18 * 60 + 10 && m < 18 * 60 + 40 && split !== 'Rest' && split !== 'Legs';
        const steps = walking ? 380 + Math.round(rng() * 90) : 130 + Math.round(rng() * 120);
        insertSample.run(
          `${date}-${m}-phone`,
          userId,
          new Date(startMs).toISOString(),
          new Date(startMs + 15 * 60_000).toISOString(),
          steps,
          'iPhone',
          'iPhone 15 Pro',
          now
        );
        if (rng() > 0.35) {
          insertSample.run(
            `${date}-${m}-watch`,
            userId,
            new Date(startMs).toISOString(),
            new Date(startMs + 15 * 60_000).toISOString(),
            Math.round(steps * (0.92 + rng() * 0.16)),
            'Apple Watch',
            'Apple Watch Series 9',
            now
          );
        }
      }
    }

    const sampleCount = db.prepare(`SELECT COUNT(*) AS c FROM health_step_samples WHERE user_id = ?`).get(userId).c;
    const workoutCount = db.prepare(`SELECT COUNT(*) AS c FROM health_workouts WHERE user_id = ?`).get(userId).c;
    db.prepare(
      `INSERT INTO health_syncs (user_id, source, synced_at, received_at, step_samples_count, workouts_count, status, payload_json)
       VALUES (?, 'iPhone+AppleWatch', ?, ?, ?, ?, 'ok', ?)`
    ).run(userId, new Date(Date.now() - 20 * 60_000).toISOString(), now, sampleCount, workoutCount, JSON.stringify({ demo: true }));
  });
  tx();

  const recipeSeeds = [
    {
      name: 'Chicken rice bowl',
      servings: 2,
      instructions: 'Cook rice, sear chicken, combine with vegetables and sauce.',
      ingredients: [
        ['Chicken breast', 300, 'g', 495, 93, 0, 10],
        ['Cooked basmati rice', 300, 'g', 390, 8, 84, 3],
        ['Mixed vegetables', 200, 'g', 90, 5, 14, 1],
        ['Olive oil', 15, 'ml', 120, 0, 0, 14],
        ['Chilli sauce', 30, 'g', 40, 1, 8, 0],
      ],
    },
    {
      name: 'Greek yoghurt breakfast',
      servings: 1,
      instructions: 'Layer yoghurt, oats, berries and honey.',
      ingredients: [
        ['Greek yoghurt 0%', 200, 'g', 120, 20, 8, 0],
        ['Rolled oats', 50, 'g', 190, 7, 33, 4],
        ['Mixed berries', 100, 'g', 45, 1, 10, 0],
        ['Honey', 10, 'g', 30, 0, 8, 0],
      ],
    },
    {
      name: 'Salmon tray bake',
      servings: 2,
      instructions: 'Roast potatoes and salmon, add greens at the end.',
      ingredients: [
        ['Salmon fillet', 300, 'g', 620, 60, 0, 40],
        ['Potatoes', 400, 'g', 310, 8, 68, 1],
        ['Broccoli', 250, 'g', 85, 7, 10, 1],
        ['Olive oil', 10, 'ml', 80, 0, 0, 9],
      ],
    },
  ];

  const recipeInsert = db.prepare(
    `INSERT INTO recipes (user_id, name, servings, instructions, calories, protein_g, carbs_g, fat_g, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const ingredientInsert = db.prepare(
    `INSERT INTO recipe_ingredients (recipe_id, name, quantity, unit, calories, protein_g, carbs_g, fat_g)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const recipe of recipeSeeds) {
    const totals = recipe.ingredients.reduce(
      (a, i) => ({ c: a.c + i[3], p: a.p + i[4], cb: a.cb + i[5], f: a.f + i[6] }),
      { c: 0, p: 0, cb: 0, f: 0 }
    );
    const info = recipeInsert.run(
      userId,
      recipe.name,
      recipe.servings,
      recipe.instructions,
      totals.c / recipe.servings,
      totals.p / recipe.servings,
      totals.cb / recipe.servings,
      totals.f / recipe.servings,
      now
    );
    for (const [name, qty, unit, cal, protein, carbs, fat] of recipe.ingredients) {
      ingredientInsert.run(info.lastInsertRowid, name, qty, unit, cal, protein, carbs, fat);
    }
  }

  // Sample progress photos (clearly watermarked SAMPLE DATA)
  const assetDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'demo-assets');
  const userPhotoDir = path.join(PHOTO_DIR, String(userId));
  fs.rmSync(userPhotoDir, { recursive: true, force: true });
  fs.mkdirSync(userPhotoDir, { recursive: true });
  const weeks = [
    { weekStart: weekStartKey(addDaysKey(today, -14)), assetWeek: 1 },
    { weekStart: weekStartKey(addDaysKey(today, -7)), assetWeek: 2 },
  ];
  for (const week of weeks) {
    for (const angle of ['front', 'side', 'back']) {
      const source = path.join(assetDir, `demo-${week.assetWeek}-${angle}.png`);
      if (!fs.existsSync(source)) continue;
      const filename = `progress-demo-${week.assetWeek}-${angle}.png`;
      fs.copyFileSync(source, path.join(userPhotoDir, filename));
      const stat = fs.statSync(source);
      const photoInfo = db
        .prepare(
          `INSERT INTO photos (user_id, kind, filename, original_name, mime, size, taken_at, created_at)
           VALUES (?, 'progress', ?, ?, 'image/png', ?, ?, ?)`
        )
        .run(userId, filename, `sample-${week.assetWeek}-${angle}.png`, stat.size, null, now);
      db.prepare(
        `INSERT INTO progress_photos (user_id, week_start, angle, photo_id, created_at) VALUES (?, ?, ?, ?, ?)`
      ).run(userId, week.weekStart, angle, photoInfo.lastInsertRowid, now);
    }
  }

  for (let i = 27; i >= 0; i -= 1) {
    recomputeStepsForDate(userId, addDaysKey(today, -i), tz);
  }

  // Closeout snapshots for the last few days, including one pending-sync case.
  for (let i = 3; i >= 1; i -= 1) {
    createCheckpoint(userId, addDaysKey(today, -i), tz);
  }

  audit(userId, 'demo', null, 'seed', null, { start, today, days: 28 });

  return { userId, email: DEMO_EMAIL, password: DEMO_PASSWORD };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reset = process.argv.includes('--reset');
  const result = seedDemo({ reset });
  console.log('Demo account ready');
  console.log(`  email:    ${result.email}`);
  console.log(`  password: ${result.password}`);
  console.log('  All data is clearly labelled synthetic sample data.');
}
