import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_PATH = ':memory:';
process.env.FITNESS_DATA_DIR = '.context/test-data';

const { db, nowIso } = await import('../legacy/server/db.js');
const { createUser } = await import('../legacy/server/auth.js');
const { rollingAverageSeries, projectWeight, strengthRetention, adherenceWindow, currentGoal } = await import('../legacy/server/lib/metrics.js');
const { buildSnapshot, createCheckpoint, hydrate, reconcileCheckpoint } = await import('../legacy/server/lib/checkpoint.js');
const { ingestHealthSync, recomputeStepsForDate } = await import('../legacy/server/lib/sync.js');
const { coach } = await import('../legacy/server/lib/coach.js');

function makeUser(email, isDemo = false) {
  const id = createUser({ email, password: 'password123', name: 'Test User', timezone: 'Asia/Kolkata', isDemo });
  db.prepare(
    `INSERT INTO profiles (user_id, sex, birth_date, height_cm, start_date, checkpoint_date, waist_start_cm, updated_at)
     VALUES (?, 'male', '2002-01-01', 183, '2026-09-22', '2026-12-01', 91.4, ?)`
  ).run(id, nowIso());
  db.prepare(
    `INSERT INTO goals (user_id, effective_from, calories, protein_g, carbs_g, fat_g, water_ml, step_goal, treadmill_min_week, target_weight_kg, updated_at)
     VALUES (?, '2026-09-22', 2400, 175, 240, 70, 3000, 10000, 150, 84, ?)`
  ).run(id, nowIso());
  return id;
}

test('rolling average smooths daily weigh-ins', () => {
  const series = rollingAverageSeries([
    { date: '2026-10-01', weight_kg: 91 },
    { date: '2026-10-02', weight_kg: 90 },
    { date: '2026-10-03', weight_kg: 89 },
  ]);
  assert.equal(series.at(-1).rolling, 90);
  assert.equal(series.at(-1).weight, 89);
});

test('weight projection returns a range, not a single promise', () => {
  const weighIns = [];
  for (let i = 0; i < 21; i += 1) {
    const day = String(i + 1).padStart(2, '0');
    weighIns.push({ date: `2026-09-${day}`, weight_kg: 91 - i * 0.08 });
  }
  const projection = projectWeight({
    weighIns,
    checkpointDate: '2026-12-01',
    today: '2026-09-21',
  });
  assert.equal(projection.status, 'ok');
  assert.ok(projection.weeklyRate < 0);
  assert.ok(projection.low < projection.high);
  assert.ok(projection.low < projection.projectedWeight);
  assert.ok(projection.high > projection.projectedWeight);
});

test('projection refuses to invent data with too few weigh-ins', () => {
  const projection = projectWeight({
    weighIns: [{ date: '2026-10-01', weight_kg: 90 }],
    checkpointDate: '2026-12-01',
    today: '2026-10-19',
  });
  assert.equal(projection.status, 'insufficient_data');
});

test('strength retention compares two blocks and returns a score', () => {
  const userId = makeUser('strength@test.local');
  const insertSession = db.prepare(
    `INSERT INTO workout_sessions (user_id, date, split, status, source, created_at) VALUES (?, ?, 'Push', 'completed', 'user_logged', ?)`
  );
  const insertSet = db.prepare(
    `INSERT INTO exercise_sets (session_id, exercise, set_index, reps, weight_kg, created_at) VALUES (?, 'Bench Press', 1, ?, ?, ?)`
  );
  // Baseline: 80 kg x 8 → e1RM 101.3
  let info = insertSession.run(userId, '2026-09-25', nowIso());
  insertSet.run(info.lastInsertRowid, 8, 80, nowIso());
  // Recent: 82.5 kg x 8 → 104.5 (maintained)
  info = insertSession.run(userId, '2026-10-18', nowIso());
  insertSet.run(info.lastInsertRowid, 8, 82.5, nowIso());

  const result = strengthRetention(userId, { today: '2026-10-19', startDate: '2026-09-22' });
  assert.equal(result.status, 'ok');
  assert.equal(result.lifts.length, 1);
  assert.ok(result.score >= 100);
});

test('adherence ignores unlogged days rather than treating them as zero calories', () => {
  const userId = makeUser('adherence@test.local');
  db.prepare(
    `INSERT INTO meals (user_id, date, slot, name, calories, protein_g, carbs_g, fat_g, source, created_at)
     VALUES (?, '2026-10-19', 'lunch', 'Test meal', 2400, 180, 200, 70, 'user_logged', ?)`
  ).run(userId, nowIso());
  const result = adherenceWindow(userId, {
    goal: { calories: 2400, protein_g: 175 },
    from: '2026-10-18',
    to: '2026-10-19',
  });
  assert.equal(result.loggedDays, 1);
  assert.equal(result.unloggedDays, 1);
  assert.equal(result.calorieAdherencePct, 100);
  assert.equal(result.proteinConsistencyPct, 100);
});

test('checkpoint snapshot is immutable and reconciliation preserves the original', async () => {
  const userId = makeUser('checkpoint@test.local');
  const date = '2026-10-19';

  const first = createCheckpoint(userId, date, 'Asia/Kolkata');
  assert.equal(first.created, true);
  const originalSteps = first.checkpoint.snapshot.steps.total;

  // A late HealthKit import arrives after the snapshot.
  ingestHealthSync(userId, {
    source: 'Apple Watch',
    syncedAt: '2026-10-19T19:00:00.000Z',
    stepSamples: [
      {
        id: 'late-1',
        start: '2026-10-19T02:00:00.000Z',
        end: '2026-10-19T02:30:00.000Z',
        steps: 2000,
        source: 'Apple Watch',
      },
    ],
    workouts: [],
  });
  recomputeStepsForDate(userId, date, 'Asia/Kolkata');

  const afterReconcile = reconcileCheckpoint(userId, date);
  assert.equal(afterReconcile.reconciled, true);
  assert.ok(afterReconcile.changes.some((c) => c.path === 'steps.total'));

  const row = db
    .prepare(`SELECT * FROM daily_checkpoints WHERE user_id = ? AND date = ?`)
    .get(userId, date);
  const hydrated = hydrate(row);
  assert.equal(hydrated.snapshot.steps.total, originalSteps, 'original snapshot untouched');
  assert.ok(hydrated.reconciled, 'reconciled layer stored');
  assert.equal(hydrated.reconciled.changes.length > 0, true);
});

test('checkpoint marks device totals pending when Health has not synced', () => {
  const userId = makeUser('pending@test.local');
  const snapshot = buildSnapshot(userId, '2026-10-19', 'Asia/Kolkata');
  assert.equal(snapshot.steps.status, 'pending_sync');
  assert.equal(snapshot.health.stale, true);
  assert.ok(snapshot.outstanding.some((o) => o.kind === 'health_sync'));
});

test('coach refuses to react to sparse data and recommends consistency', () => {
  const userId = makeUser('coach@test.local');
  const today = '2026-10-19';
  const result = coach({
    userId,
    profile: { start_date: '2026-10-18', checkpoint_date: '2026-12-01' },
    goal: { calories: 2400, protein_g: 175 },
    weighIns: [],
    today,
  });
  assert.equal(result.inputs.hasEnoughWeight, false);
  assert.ok(result.flags.includes('weight_data_sparse'));
  assert.ok(result.recommendation.toLowerCase().includes('sparse') || result.recommendation.toLowerCase().includes('logging'));
});

test('a treadmill session without start/end times subtracts an explicit step estimate', () => {
  const userId = makeUser('estimated-steps@test.local');
  const date = '2026-10-18';
  db.prepare(
    `INSERT INTO treadmill_sessions (user_id, date, title, duration_min, status, source, created_at, updated_at)
     VALUES (?, ?, 'Manual walk', 30, 'logged', 'manual', ?, ?)`
  ).run(userId, date, nowIso(), nowIso());
  db.prepare(
    `INSERT INTO health_step_samples (id, user_id, start_time, end_time, steps, source, imported_at)
     VALUES (?, ?, ?, ?, 3000, 'Apple Watch', ?)`
  ).run(
    'estimated-sample',
    userId,
    '2026-10-18T03:00:00.000Z',
    '2026-10-18T04:00:00.000Z',
    nowIso()
  );

  const result = recomputeStepsForDate(userId, date, 'Asia/Kolkata');
  assert.equal(result.total, 3000);
  assert.equal(result.treadmill, 3000, 'estimate is clamped to available steps');
  assert.equal(result.qualifying, 0);
  assert.ok(result.method.includes('estimated'));
  assert.ok(result.uncertaintyPct >= 10);
});

test('goal versions apply from their effective date', () => {
  const userId = makeUser('goals@test.local');
  db.prepare(
    `INSERT INTO goals (user_id, effective_from, calories, protein_g, water_ml, step_goal, treadmill_min_week, updated_at)
     VALUES (?, '2026-10-19', 2200, 170, 2800, 9000, 140, ?)`
  ).run(userId, nowIso());
  const before = db.prepare(`SELECT * FROM goals WHERE user_id = ? AND effective_from = '2026-09-22'`).get(userId);
  assert.equal(before.calories, 2400);
  assert.equal(currentGoal(userId, '2026-10-18').calories, 2400);
  assert.equal(currentGoal(userId, '2026-10-19').calories, 2200);
});
