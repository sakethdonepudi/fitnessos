import { attributeSteps, treadmillInterval } from './steps.js';
import { localDayBounds } from './dates.js';

/**
 * Computes the three daily step counters from imported HealthKit samples.
 * A: total de-duplicated steps, B: treadmill steps, C: qualifying steps.
 */
export function computeDailySteps({ samples = [], sessions = [], date, timezone = 'Asia/Kolkata' }) {
  const { start, end } = localDayBounds(date, timezone);
  const inDay = samples.filter((sample) => {
    const s = new Date(sample.start_time || sample.start).getTime();
    const e = new Date(sample.end_time || sample.end).getTime();
    return s < end.getTime() && e > start.getTime();
  });

  if (!inDay.length) {
    return {
      date,
      total_steps: 0,
      treadmill_steps: 0,
      qualifying_steps: 0,
      method: 'none',
      uncertainty_pct: 0,
      sample_resolution_sec: null,
      sources: [],
      source_totals: {},
      status: 'pending_sync',
    };
  }

  const normalized = inDay.map((s) => ({
    id: s.id,
    start_time: s.start_time || s.start,
    end_time: s.end_time || s.end,
    steps: s.steps,
    source: s.source,
    device: s.device,
  }));

  const intervals = sessions
    .filter((s) => s.start_time && s.end_time && s.status !== 'skipped')
    .map((s) => ({ start: new Date(s.start_time).getTime(), end: new Date(s.end_time).getTime() }));
  const untimed = sessions.filter((s) => !(s.start_time && s.end_time) && bpmDuration(s));

  const result = attributeSteps(normalized, intervals);

  const estimated = untimed.reduce((sum, s) => sum + Math.round((s.duration_min || 0) * 105), 0);
  let treadmill = result.treadmillSteps;
  let qualifying = result.qualifyingSteps;
  let uncertainty = result.uncertaintyPct;
  let method = result.method;
  if (estimated > 0) {
    treadmill = Math.min(result.totalSteps, treadmill + estimated);
    qualifying = Math.max(0, result.totalSteps - treadmill);
    uncertainty = Math.min(20, Math.max(uncertainty, 10));
    method = method === 'none' ? 'estimated_attribution' : `${method}_estimated_attribution`;
  }

  return {
    date,
    total_steps: result.totalSteps,
    treadmill_steps: treadmill,
    qualifying_steps: qualifying,
    method,
    uncertainty_pct: uncertainty,
    sample_resolution_sec: medianSpan(inDay),
    sources: result.sources,
    source_totals: result.sourceTotals,
    contested_minutes: result.contestedMinutes,
    status: method.includes('estimated') || uncertainty > 5 ? 'estimated' : 'verified',
  };
}

function bpmDuration(session) {
  return (session.duration_min || 0) > 0;
}

function medianSpan(samples) {
  const spans = samples
    .map((s) => (new Date(s.end_time || s.end) - new Date(s.start_time || s.start)) / 1000)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  return spans.length ? Math.round(spans[Math.floor(spans.length / 2)]) : null;
}
