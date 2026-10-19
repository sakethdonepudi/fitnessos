import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4173';
let cookie = '';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function req(path, { method = 'GET', body, headers = {}, form } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : form,
  });
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}

const email = `e2e-${Date.now()}@test.local`;

// Register a throwaway account with the real profile defaults.
let r = await req('/auth/register', {
  method: 'POST',
  body: {
    email,
    password: 'test-password-123',
    name: 'E2E Tester',
    startDate: '2026-10-19',
    heightCm: 183,
    waistCm: 91.44,
    calories: 2400,
    protein: 175,
    stepGoal: 10000,
  },
});
check('register account', r.status === 200, `user ${r.data?.user?.id}`);

r = await req('/bootstrap');
check('bootstrap after register', r.status === 200 && r.data.today === '2026-10-19', r.data?.today);
check('default treadmill preset created', r.status === 200 && r.data.treadmill !== undefined);

r = await req('/treadmill/presets');
const preset = r.data.presets[0];
check('preset blocks default to 5/20/5', preset.totalMinutes === 30 && preset.blocks.length === 3, `${preset.totalMinutes} min`);

r = await req(`/treadmill/presets/${preset.id}`, {
  method: 'PUT',
  body: { name: 'E2E Incline', blocks: preset.blocks.map((b, i) => ({ ...b, minutes: [5, 22, 5][i] })) },
});
check('preset editable', r.status === 200 && r.data.totalMinutes === 32, `${r.data?.totalMinutes} min`);

r = await req('/goals', {
  method: 'POST',
  body: { effectiveFrom: '2026-10-19', calories: 2300, protein: 180, waterMl: 3200, stepGoal: 9000, targetWeightKg: 84 },
});
check('goal version saved', r.status === 200 && r.data.calories === 2300);
r = await req('/goals', {
  method: 'POST',
  body: { effectiveFrom: '2026-10-19', calories: 1200, protein: 180 },
});
check('unsafe calorie target rejected', r.status === 400, String(r.status));

r = await req('/recipes', {
  method: 'POST',
  body: {
    name: 'E2E recipe',
    servings: 2,
    ingredients: [
      { name: 'Chicken', quantity: 200, unit: 'g', calories: 330, protein: 62, carbs: 0, fat: 7 },
      { name: 'Rice', quantity: 150, unit: 'g', calories: 195, protein: 4, carbs: 42, fat: 1 },
    ],
  },
});
check('recipe per-serving macros calculated', r.status === 200 && Math.round(r.data.calories) === 263, JSON.stringify({ kcal: r.data.calories, p: r.data.protein_g }));

r = await req('/weigh-ins', {
  method: 'POST',
  body: { date: '2026-10-19', weightKg: 90.4, waistCm: 90.9, bodyFatPct: 20, bodyFatSource: 'estimate' },
});
check('weigh-in saved', r.status === 200 && r.data.weight_kg === 90.4);
check('body fat keeps source', r.data.body_fat_source === 'estimate');

r = await req('/meals', {
  method: 'POST',
  body: { date: '2026-10-19', slot: 'lunch', name: 'E2E bowl', calories: 700, protein: 60, carbs: 70, fat: 18 },
});
check('meal saved', r.status === 200 && r.data.calories === 700);
const mealId = r.data.id;

r = await req('/nutrition/week?to=2026-10-19');
check('weekly nutrition totals exclude unlogged days', r.status === 200 && r.data.adherence.loggedDays >= 1);

r = await req('/water', { method: 'POST', body: { date: '2026-10-19', ml: 500 } });
check('water saved', r.status === 200 && r.data.ml === 500);

r = await req('/workouts', {
  method: 'POST',
  body: {
    date: '2026-10-19',
    split: 'Push',
    durationMin: 60,
    sets: [
      { exercise: 'Bench Press', reps: 8, weightKg: 80 },
      { exercise: 'Bench Press', reps: 8, weightKg: 80 },
    ],
  },
});
check('workout with sets saved', r.status === 200 && r.data.sets.length === 2);

r = await req('/recovery', { method: 'POST', body: { date: '2026-10-19', sleepHours: 7.5, readiness: 4, soreness: 2 } });
check('recovery saved', r.status === 200 && r.data.readiness === 4);

// Treadmill session with an explicit interval, then HealthKit step samples.
r = await req('/treadmill/sessions', {
  method: 'POST',
  body: {
    date: '2026-10-19',
    durationMin: 30,
    speedKmh: 4.2,
    inclinePct: 6,
    distanceKm: 2.1,
    startTime: '2026-10-19T12:00:00+05:30',
    endTime: '2026-10-19T12:30:00+05:30',
  },
});
check('treadmill session saved', r.status === 200 && r.data.duration_min === 30);
const sessionId = r.data.id;

r = await req('/health/sync', {
  method: 'POST',
  body: {
    source: 'Apple Watch',
    syncedAt: '2026-10-19T13:00:00Z',
    stepSamples: [
      { id: `walk-${sessionId}`, start: '2026-10-19T12:00:00+05:30', end: '2026-10-19T12:30:00+05:30', steps: 3000, source: 'Apple Watch' },
      { id: `day-${sessionId}`, start: '2026-10-19T07:00:00+05:30', end: '2026-10-19T08:00:00+05:30', steps: 1000, source: 'Apple Watch' },
    ],
    workouts: [
      {
        id: `walk-workout-${sessionId}`,
        type: 'walking',
        start: '2026-10-19T12:00:00+05:30',
        end: '2026-10-19T12:30:00+05:30',
        durationSec: 1800,
        distanceKm: 2.1,
        avgHr: 130,
        maxHr: 148,
        activeCalories: 210,
        source: 'Apple Watch',
      },
      {
        id: `strength-workout-${sessionId}`,
        type: 'traditional_strength_training',
        start: '2026-10-19T17:00:00+05:30',
        end: '2026-10-19T18:00:00+05:30',
        durationSec: 3600,
        source: 'Apple Watch',
      },
    ],
  },
});
check('health sync ingests samples', r.status === 200 && r.data.stepSamples === 2);
check('health sync links indoor walk', r.data.linkedWorkouts === 1, `${r.data.linkedWorkouts}`);
check('health sync links strength workout', r.data.linkedStrengthWorkouts === 1);

r = await req('/steps?from=2026-10-19&to=2026-10-19');
const todaySteps = r.data.rows[0];
check('treadmill steps subtracted from qualifying', todaySteps.total_steps === 4000 && todaySteps.treadmill_steps === 3000 && todaySteps.qualifying_steps === 1000, JSON.stringify(todaySteps));

r = await req(`/treadmill/sessions?from=2026-10-19&to=2026-10-19`);
const linked = r.data.sessions.find((s) => s.id === sessionId);
check('treadmill session now device-verified', linked.evidence === 'verified_device', linked.evidence);

// Console OCR upload (synthetic console image generated earlier)
if (fs.existsSync('/tmp/console.png')) {
  const form = new FormData();
  form.append('photo', new Blob([fs.readFileSync('/tmp/console.png')], { type: 'image/png' }), 'console.png');
  r = await req(`/treadmill/sessions/${sessionId}/console`, { method: 'POST', form });
  check('console photo OCR extracts speed', r.status === 200 && r.data.extracted.speedKmh === 4.2, JSON.stringify(r.data.extracted));
  check('console OCR flags discrepancy against 4.2/6', r.data.hasDiscrepancy === false || r.data.hasDiscrepancy === true);
  const confirm = await req(`/treadmill/sessions/${sessionId}/console/confirm`, {
    method: 'POST',
    body: { speedKmh: 4.2, inclinePct: 6, durationMin: 30, distanceKm: 2.1 },
  });
  check('console values confirmable', confirm.status === 200 && confirm.data.console_confirmed === 1);
}

// Checkpoint + reconciliation
r = await req('/checkpoints', { method: 'POST', body: { date: '2026-10-19' } });
check('checkpoint created', r.status === 200 && r.data.created === true);
const original = r.data.checkpoint.snapshot.steps.total;

r = await req('/health/sync', {
  method: 'POST',
  body: {
    source: 'Apple Watch',
    syncedAt: '2026-10-20T01:00:00Z',
    stepSamples: [
      { id: `late-${sessionId}`, start: '2026-10-19T19:00:00+05:30', end: '2026-10-19T19:30:00+05:30', steps: 900, source: 'Apple Watch' },
    ],
    workouts: [],
  },
});
check('late sync accepted', r.status === 200);

r = await req('/checkpoints/2026-10-19/reconcile', { method: 'POST' });
check('reconciliation records changes', r.status === 200 && r.data.reconciled === true && r.data.changes.length > 0);

r = await req('/checkpoints/2026-10-19');
check('original snapshot preserved', r.status === 200 && r.data.snapshot.steps.total === original, `${r.data.snapshot.steps.total} vs ${original}`);
check('reconciled layer present', !!r.data.reconciled);

// Device token auth
r = await req('/health/tokens', { method: 'POST', body: { label: 'E2E device' } });
const deviceToken = r.data.token;
check('device token created', r.status === 200 && deviceToken?.startsWith('fos_'));

const tokenRes = await fetch(`${BASE}/api/health/sync`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${deviceToken}` },
  body: JSON.stringify({ source: 'iPhone', syncedAt: new Date().toISOString(), stepSamples: [], workouts: [] }),
});
check('sync accepts bearer device token', tokenRes.status === 200);

const badRes = await fetch(`${BASE}/api/health/sync`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: 'Bearer nope' },
  body: JSON.stringify({}),
});
check('sync rejects invalid token', badRes.status === 401, String(badRes.status));

// Photo upload + private serving
const form = new FormData();
form.append('photo', new Blob([fs.readFileSync('/tmp/console.png')], { type: 'image/png' }), 'progress.png');
form.append('angle', 'front');
form.append('weekStart', '2026-10-19');
r = await req('/progress-photos', { method: 'POST', form });
check('progress photo uploaded', r.status === 200 && r.data.angle === 'front');
const photoId = r.data.photo_id || r.data.id;

const photoRes = await fetch(`${BASE}/api/photos/${photoId}`, { headers: { cookie } });
check('photo served to owner', photoRes.status === 200);
const anonRes = await fetch(`${BASE}/api/photos/${photoId}`);
check('photo blocked without auth', anonRes.status === 401);

r = await req('/export');
check('export returns full dataset', r.status === 200 && Array.isArray(r.data.meals) && Array.isArray(r.data.checkpoints));

// Clean up the throwaway account.
const { db } = await import('../server/db.js');
db.prepare(`DELETE FROM users WHERE email = ?`).run(email);
console.log('\nCleanup: removed', email);
const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) process.exitCode = 1;
