import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConsoleReadings } from '../legacy/server/lib/console-ocr.js';

const lines = [
  { text: 'SPEED 4.2 km/h' },
  { text: 'INCLINE 8.0 %' },
  { text: 'TIME 28:00' },
  { text: 'DISTANCE 1.85 km' },
  { text: 'CALORIES 245 kcal' },
];

test('console OCR extracts speed, incline, duration, distance and calories', () => {
  const result = parseConsoleReadings(lines, null);
  assert.equal(result.extracted.speedKmh, 4.2);
  assert.equal(result.extracted.inclinePct, 8);
  assert.equal(result.extracted.durationMin, 28);
  assert.equal(result.extracted.distanceKm, 1.85);
  assert.equal(result.extracted.activeCalories, 245);
  assert.equal(result.confidence, 'high');
});

test('console OCR flags an incline discrepancy against the log', () => {
  const result = parseConsoleReadings(lines, {
    speed_kmh: 4.2,
    incline_pct: 5.0,
    duration_min: 28,
    distance_km: 1.85,
    active_calories: 245,
  });
  assert.equal(result.hasDiscrepancy, true);
  const incline = result.comparisons.find((c) => c.field === 'inclinePct');
  assert.equal(incline.status, 'discrepancy');
  assert.equal(incline.extracted, 8);
  assert.equal(incline.logged, 5);
});

test('console OCR never claims the photo proves session completion', () => {
  const result = parseConsoleReadings(lines, null);
  assert.match(result.disclaimer, /does not prove/i);
  assert.match(result.disclaimer, /completed/i);
});

test('console OCR marks fields missing from the log for review', () => {
  const result = parseConsoleReadings(lines, { speed_kmh: 4.2 });
  assert.ok(result.comparisons.some((c) => c.status === 'missing_logged'));
});
