import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeSteps } from '../server/lib/steps.js';
import { localDateKey, localDayBounds, addDaysKey, weekStartKey, daysBetween } from '../server/lib/dates.js';

test('localDayBounds is correct for Asia/Kolkata', () => {
  const { start, end } = localDayBounds('2026-10-19', 'Asia/Kolkata');
  assert.equal(start.toISOString(), '2026-10-18T18:30:00.000Z');
  assert.equal(end.toISOString(), '2026-10-19T18:30:00.000Z');
});

test('localDateKey respects timezone', () => {
  assert.equal(localDateKey(new Date('2026-10-19T18:00:00Z'), 'Asia/Kolkata'), '2026-10-19');
  assert.equal(localDateKey(new Date('2026-10-19T19:00:00Z'), 'Asia/Kolkata'), '2026-10-20');
});

test('addDays and weekStartKey handle Monday weeks', () => {
  assert.equal(addDaysKey('2026-10-31', 1), '2026-11-01');
  assert.equal(weekStartKey('2026-10-19'), '2026-10-19');
  assert.equal(weekStartKey('2026-10-25'), '2026-10-19');
  assert.equal(daysBetween('2026-10-19', '2026-12-01'), 43);
});

test('deduplicates overlapping iPhone and Watch samples instead of summing', () => {
  const start = '2026-10-19T07:00:00.000Z';
  const end = '2026-10-19T07:10:00.000Z';
  const samples = [
    { id: 'phone', start_time: start, end_time: end, steps: 100, source: 'iPhone' },
    { id: 'watch', start_time: start, end_time: end, steps: 104, source: 'Apple Watch' },
  ];
  const result = attributeSteps(samples, []);
  assert.equal(result.totalSteps, 104, 'one source per minute, not 204');
  assert.equal(result.qualifyingSteps, 104);
  assert.equal(result.treadmillSteps, 0);
  assert.equal(result.sources.length, 2);
  assert.ok(result.uncertaintyPct > 0, 'disagreement is surfaced as uncertainty');
});

test('attributes steps inside treadmill intervals and excludes them from qualifying', () => {
  const samples = [
    {
      id: 'walk',
      start_time: '2026-10-19T09:00:00.000Z',
      end_time: '2026-10-19T09:30:00.000Z',
      steps: 3000,
      source: 'Apple Watch',
    },
    {
      id: 'rest',
      start_time: '2026-10-19T12:00:00.000Z',
      end_time: '2026-10-19T12:30:00.000Z',
      steps: 1000,
      source: 'Apple Watch',
    },
  ];
  const result = attributeSteps(samples, [
    { start: new Date('2026-10-19T09:00:00Z').getTime(), end: new Date('2026-10-19T09:30:00Z').getTime() },
  ]);
  assert.equal(result.totalSteps, 4000);
  assert.equal(result.treadmillSteps, 3000);
  assert.equal(result.qualifyingSteps, 1000);
});

test('empty samples produce zeros, not an invented number', () => {
  const result = attributeSteps([], []);
  assert.equal(result.totalSteps, 0);
  assert.equal(result.treadmillSteps, 0);
  assert.equal(result.qualifyingSteps, 0);
  assert.equal(result.method, 'none');
});
