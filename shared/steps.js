/**
 * Step de-duplication and treadmill attribution.
 *
 * HealthKit can surface the same physical steps from more than one device
 * (iPhone + Apple Watch). Raw samples therefore overlap. We bucket samples into
 * fixed windows, choose one sample per bucket by source priority, and record how
 * much of the day had competing sources. That competition is reported as
 * uncertainty instead of being hidden.
 */

const SOURCE_PRIORITY = [
  { match: /watch/i, score: 3, label: 'Apple Watch' },
  { match: /iphone/i, score: 2, label: 'iPhone' },
  { match: /third|garmin|fitbit|peloton/i, score: 1, label: 'Third-party' },
];

export function sourceScore(source = '') {
  for (const entry of SOURCE_PRIORITY) {
    if (entry.match.test(source)) return entry.score;
  }
  return 0;
}

const BUCKET_MS = 60_000;

function bucketKey(ms) {
  return Math.floor(ms / BUCKET_MS);
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * @param {Array<{id:string,start_time:string,end_time:string,steps:number,source:string,device?:string}>} samples
 * @param {Array<{start:number,end:number}>} treadmillIntervals  epoch ms ranges
 */
export function attributeSteps(samples, treadmillIntervals = []) {
  const buckets = new Map();

  for (const sample of samples) {
    const start = new Date(sample.start_time).getTime();
    const end = new Date(sample.end_time).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    const steps = Number(sample.steps) || 0;
    if (steps <= 0) continue;

    const span = end - start;
    const stepMs = Math.max(BUCKET_MS, Math.min(span, BUCKET_MS));
    const slices = Math.max(1, Math.round(span / stepMs));
    const per = steps / slices;

    for (let i = 0; i < slices; i += 1) {
      const s = start + i * stepMs;
      const e = Math.min(end, s + stepMs);
      const key = bucketKey(s);
      const existing = buckets.get(key);
      const candidate = {
        start: s,
        end: e,
        steps: per,
        source: sample.source || 'unknown',
        device: sample.device || null,
        score: sourceScore(sample.source || ''),
      };
      if (!existing) {
        buckets.set(key, { chosen: candidate, competitors: [] });
      } else if (candidate.score > existing.chosen.score) {
        existing.competitors.push(existing.chosen);
        existing.chosen = candidate;
      } else {
        existing.competitors.push(candidate);
      }
    }
  }

  let totalSteps = 0;
  let treadmillSteps = 0;
  let contestedSteps = 0;
  let contestedMinutes = 0;
  let divergenceSteps = 0;
  const sourceTotals = new Map();

  for (const [, bucket] of buckets) {
    const { chosen, competitors } = bucket;
    totalSteps += chosen.steps;

    const label = chosen.source;
    sourceTotals.set(label, (sourceTotals.get(label) || 0) + chosen.steps);

    const isTreadmill = treadmillIntervals.some((iv) =>
      overlaps(chosen.start, chosen.end, iv.start, iv.end)
    );
    if (isTreadmill) treadmillSteps += chosen.steps;

    if (competitors.length > 0) {
      contestedMinutes += 1;
      // Count only the *extra* duplicate steps as contested volume.
      contestedSteps += Math.max(...competitors.map((c) => c.steps));
      // Real disagreement between sources bounds the possible dedup error.
      divergenceSteps += Math.max(
        ...competitors.map((c) => Math.abs(c.steps - chosen.steps))
      );
    }
  }

  const qualifyingSteps = Math.max(0, Math.round(totalSteps - treadmillSteps));
  const totalRounded = Math.round(totalSteps);

  // Uncertainty is the measured divergence between competing sources, relative
  // to the day's volume. Dedup picks the higher-priority source, so this is an
  // upper bound on the error introduced by choosing one source per minute.
  const divergenceShare = totalSteps > 0 ? divergenceSteps / totalSteps : 0;
  const uncertaintyPct = Math.min(20, Math.round(divergenceShare * 100));

  const sources = [...new Set(samples.map((s) => s.source).filter(Boolean))];

  let method = 'deduped';
  if (samples.length === 0) method = 'none';
  else if (contestedMinutes > 0) method = 'deduped_contested';
  else if (sources.length > 1) method = 'deduped_multi_source';

  return {
    totalSteps: totalRounded,
    treadmillSteps: Math.round(treadmillSteps),
    qualifyingSteps,
    method,
    uncertaintyPct,
    contestedMinutes,
    contestedSteps: Math.round(contestedSteps),
    sampleCount: samples.length,
    sources,
    sourceTotals: Object.fromEntries(
      [...sourceTotals.entries()].map(([k, v]) => [k, Math.round(v)])
    ),
  };
}

/**
 * Treadmill sessions store wall-clock times. HealthKit workouts store ISO
 * timestamps. This resolves a session to an epoch interval when possible.
 */
export function treadmillInterval(session) {
  const startIso = session.start_time;
  const endIso = session.end_time;
  if (startIso && endIso) {
    return { start: new Date(startIso).getTime(), end: new Date(endIso).getTime() };
  }
  return null;
}
