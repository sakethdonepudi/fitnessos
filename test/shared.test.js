import test from 'node:test';
import assert from 'node:assert/strict';
import { addDaysKey, daysBetween, localDateKey, localDayBounds, weekStartKey } from '../shared/dates.js';
import { attributeSteps } from '../shared/steps.js';
import { computeDailySteps } from '../shared/health.js';
import { adherenceWindow, coach, projectWeight, rollingAverageSeries, WEEKLY_CARDIO_PLAN } from '../shared/core.js';
import { buildSnapshot, diffSnapshots } from '../shared/checkpoint.js';
import { legacyExportToRecords } from '../shared/legacy.js';

test('timezone boundaries are correct for Asia/Kolkata', () => {
  const { start, end } = localDayBounds('2026-10-19', 'Asia/Kolkata');
  assert.equal(start.toISOString(), '2026-10-18T18:30:00.000Z');
  assert.equal(end.toISOString(), '2026-10-19T18:30:00.000Z');
  assert.equal(localDateKey(new Date('2026-10-19T19:00:00Z'), 'Asia/Kolkata'), '2026-10-20');
  assert.equal(addDaysKey('2026-10-31', 1), '2026-11-01');
  assert.equal(weekStartKey('2026-10-25'), '2026-10-19');
  assert.equal(daysBetween('2026-10-19', '2026-12-01'), 43);
});

test('overlapping iPhone and Watch samples are not summed twice', () => {
  const samples = [
    { id: 'p', start_time: '2026-10-19T07:00:00Z', end_time: '2026-10-19T07:10:00Z', steps: 100, source: 'iPhone' },
    { id: 'w', start_time: '2026-10-19T07:00:00Z', end_time: '2026-10-19T07:10:00Z', steps: 104, source: 'Apple Watch' },
  ];
  const result = attributeSteps(samples, []);
  assert.equal(result.totalSteps, 104);
  assert.equal(result.qualifyingSteps, 104);
  assert.ok(result.uncertaintyPct > 0);
});

test('daily counters split treadmill steps from qualifying steps', () => {
  const result = computeDailySteps({
    date: '2026-10-19',
    sessions: [
      { start_time: '2026-10-19T12:00:00Z', end_time: '2026-10-19T12:30:00Z', duration_min: 30 },
    ],
    samples: [
      { id: '1', start_time: '2026-10-19T12:00:00Z', end_time: '2026-10-19T12:30:00Z', steps: 3000, source: 'Apple Watch' },
      { id: '2', start_time: '2026-10-19T13:00:00Z', end_time: '2026-10-19T13:30:00Z', steps: 1000, source: 'Apple Watch' },
    ],
  });
  assert.equal(result.total_steps, 4000);
  assert.equal(result.treadmill_steps, 3000);
  assert.equal(result.qualifying_steps, 1000);
  assert.equal(result.status, 'verified');
});

test('a session without times subtracts an explicit estimate and widens uncertainty', () => {
  const result = computeDailySteps({
    date: '2026-10-19',
    sessions: [{ duration_min: 30, id: 'manual' }],
    samples: [{ id: '1', start_time: '2026-10-19T12:00:00Z', end_time: '2026-10-19T12:30:00Z', steps: 3000, source: 'Apple Watch' }],
  });
  assert.equal(result.treadmill_steps, 3000);
  assert.equal(result.qualifying_steps, 0);
  assert.ok(result.method.includes('estimated'));
  assert.ok(result.uncertainty_pct >= 10);
});

test('weight projection returns a range with confidence', () => {
  const weighIns = [];
  for (let i = 0; i < 21; i += 1) {
    weighIns.push({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, weight_kg: 91 - i * 0.08 });
  }
  const projection = projectWeight({ weighIns, checkpointDate: '2026-12-01', today: '2026-09-21' });
  assert.equal(projection.status, 'ok');
  assert.ok(projection.weeklyRate < 0);
  assert.ok(projection.low < projection.high);
});

test('rolling average smooths daily noise and adherence ignores unlogged days', () => {
  const series = rollingAverageSeries([
    { date: '2026-10-01', weight_kg: 91 },
    { date: '2026-10-02', weight_kg: 90 },
    { date: '2026-10-03', weight_kg: 89 },
  ]);
  assert.equal(series.at(-1).rolling, 90);

  const meals = [{ date: '2026-10-19', calories: 2400, protein_g: 180, carbs_g: 200, fat_g: 70 }];
  const adherence = adherenceWindow({ meals, goal: { calories: 2400, protein_g: 175 }, from: '2026-10-18', to: '2026-10-19' });
  assert.equal(adherence.loggedDays, 1);
  assert.equal(adherence.unloggedDays, 1);
  assert.equal(adherence.calorieAdherencePct, 100);
});

test('checkpoint snapshot labels pending device data rather than zero', () => {
  const snapshot = buildSnapshot({
    date: '2026-10-19',
    profile: { start_date: '2026-10-19', checkpoint_date: '2026-12-01', height_cm: 183 },
    goal: { calories: 2400, protein_g: 175, water_ml: 3250, step_goal: 10000 },
    meals: [],
    waterMl: 0,
    workouts: [],
    treadmillSessions: [],
    steps: null,
    weighIns: [],
    recovery: null,
    healthLastImport: null,
  });
  assert.equal(snapshot.steps.status, 'pending_sync');
  assert.equal(snapshot.nutrition.status, 'not_recorded');
  assert.ok(snapshot.outstanding.some((o) => o.kind === 'health_sync'));
});

test('checkpoint diff preserves the original and reports appended values', () => {
  const original = { steps: { total: 1000, treadmill: 0, qualifying: 1000, status: 'pending_sync' }, treadmill: { minutes: 0 }, workout: { count: 0 }, health: { status: 'pending_sync' }, nutrition: { calories: 0 }, water: { ml: 0 } };
  const fresh = { ...original, steps: { total: 1500, treadmill: 500, qualifying: 1000, status: 'verified_device' }, health: { status: 'verified_device' } };
  const changes = diffSnapshots(original, fresh);
  assert.ok(changes.some((c) => c.path === 'steps.total' && c.after === 1500));
  assert.equal(original.steps.total, 1000);
});

test('weekly plan keeps the required five-day split and labels', () => {
  assert.equal(WEEKLY_CARDIO_PLAN.length, 7);
  assert.equal(WEEKLY_CARDIO_PLAN[2].split, 'Legs + Abs');
  assert.equal(WEEKLY_CARDIO_PLAN[5].split, 'Arms + Accessories');
  assert.equal(WEEKLY_CARDIO_PLAN.filter((d) => !d.optional).length, 5);
});

test('legacy export mapping uses stable, photo-safe IDs', () => {
  const mapped = legacyExportToRecords({
    profile: { start_date: '2026-10-19', name: 'Owner' },
    meals: [{ id: 1, date: '2026-10-19', name: 'Dal', calories: 500, protein_g: 20 }],
    photos: [{ id: 31, kind: 'progress', mime: 'image/jpeg', size: 10, filename: 'a.jpg' }],
    progressPhotos: [{ id: 5, week_start: '2026-10-13', angle: 'front', photo_id: 31 }],
    photosBase64: [{ id: 31, mime: 'image/jpeg', base64: 'AA==' }],
    checkpoints: [{ date: '2026-10-18', snapshot_json: '{"date":"2026-10-18"}', status: 'final' }],
  });
  assert.ok(mapped.records.some((r) => r.id === 'legacy:meal:1'));
  assert.ok(mapped.records.some((r) => r.id === 'legacy-photo-31'));
  assert.ok(mapped.records.some((r) => r.collection === 'progress_photos' && r.data.photo_id === 'legacy-photo-31'));
  assert.equal(mapped.photos[0].id, 'legacy-photo-31');
  assert.ok(mapped.records.some((r) => r.id === 'checkpoint:2026-10-18' && r.data.snapshot.date === '2026-10-18'));
});

test('coach refuses to change anything on sparse weight data', () => {
  const result = coach({
    profile: { start_date: '2026-10-18', checkpoint_date: '2026-12-01' },
    goal: { calories: 2400, protein_g: 175 },
    weighIns: [],
    workouts: [],
    recoveryRows: [],
    meals: [],
    today: '2026-10-19',
  });
  assert.equal(result.inputs.hasEnoughWeight, false);
  assert.ok(result.flags.includes('weight_data_sparse'));
  assert.match(result.recommendation, /sparse|logging/i);
});
