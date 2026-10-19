import { db } from '../db.js';
import { STATUS } from './evidence.js';
import {
  addDaysKey,
  daysBetween,
  eachDate,
  isStale,
  todayKey,
  weekStartKey,
} from './dates.js';

export function getProfile(userId) {
  const profile = db.prepare(`SELECT * FROM profiles WHERE user_id = ?`).get(userId);
  const goals = db
    .prepare(`SELECT * FROM goals WHERE user_id = ? ORDER BY effective_from DESC`)
    .all(userId);
  return { profile, goals };
}

export function currentGoal(userId, dateKey) {
  const row = db
    .prepare(
      `SELECT * FROM goals WHERE user_id = ? AND effective_from <= ?
       ORDER BY effective_from DESC LIMIT 1`
    )
    .get(userId, dateKey);
  if (row) return row;
  return db
    .prepare(`SELECT * FROM goals WHERE user_id = ? ORDER BY effective_from ASC LIMIT 1`)
    .get(userId);
}

function round(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function getWeighIns(userId, { from, to } = {}) {
  let sql = `SELECT * FROM weigh_ins WHERE user_id = ?`;
  const params = [userId];
  if (from) {
    sql += ` AND date >= ?`;
    params.push(from);
  }
  if (to) {
    sql += ` AND date <= ?`;
    params.push(to);
  }
  sql += ` ORDER BY date ASC`;
  return db.prepare(sql).all(...params);
}

export function rollingAverageSeries(weighIns, { windowDays = 7 } = {}) {
  if (weighIns.length === 0) return [];
  const first = weighIns[0].date;
  const last = weighIns[weighIns.length - 1].date;
  const dates = eachDate(first, last);
  const byDate = new Map(weighIns.map((w) => [w.date, w]));
  const out = [];
  for (const date of dates) {
    const windowStart = addDaysKey(date, -(windowDays - 1));
    const slice = weighIns.filter((w) => w.date >= windowStart && w.date <= date);
    if (slice.length === 0) continue;
    const avg = slice.reduce((sum, w) => sum + w.weight_kg, 0) / slice.length;
    const entry = byDate.get(date);
    out.push({
      date,
      weight: entry?.weight_kg ?? null,
      waist: entry?.waist_cm ?? null,
      bodyFat: entry?.body_fat_pct ?? null,
      rolling: round(avg, 2),
      n: slice.length,
    });
  }
  return out;
}

function linearRegression(points) {
  const n = points.length;
  if (n < 2) return null;
  const sumX = points.reduce((s, p) => s + p.x, 0);
  const sumY = points.reduce((s, p) => s + p.y, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  const intercept = meanY - slope * meanX;
  let ssRes = 0;
  for (const p of points) {
    const pred = slope * p.x + intercept;
    ssRes += (p.y - pred) ** 2;
  }
  const residualStd = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
  return { slope, intercept, residualStd, n };
}

/**
 * Projects a range, never a single "guaranteed" number. Requires enough
 * weigh-ins to be meaningful; otherwise returns insufficient_data.
 */
export function projectWeight({ weighIns, checkpointDate, today }) {
  const series = rollingAverageSeries(weighIns);
  const recent = series.slice(-21).filter((s) => s.rolling != null);
  if (recent.length < 5) {
    return {
      status: 'insufficient_data',
      message: 'Log at least 5 weigh-ins to project a range.',
      sampleDays: recent.length,
    };
  }
  const baseDate = recent[0].date;
  const points = recent.map((s) => ({ x: daysBetween(baseDate, s.date), y: s.rolling }));
  const reg = linearRegression(points);
  if (!reg) return { status: 'insufficient_data', message: 'Not enough variation yet.' };

  const lastDate = recent[recent.length - 1].date;
  const daysToCheckpoint = Math.max(0, daysBetween(today, checkpointDate));
  const anchorX = daysBetween(baseDate, lastDate);
  const anchorY = reg.slope * anchorX + reg.intercept;
  const projected = anchorY + reg.slope * daysToCheckpoint;
  const margin = Math.max(0.4, 1.96 * reg.residualStd);
  const weeklyRate = reg.slope * 7;

  return {
    status: 'ok',
    currentAverage: round(anchorY, 2),
    weeklyRate: round(weeklyRate, 2),
    projectedWeight: round(projected, 1),
    low: round(projected - margin, 1),
    high: round(projected + margin, 1),
    confidence: recent.length >= 12 ? 'moderate' : 'low',
    sampleDays: recent.length,
    daysToCheckpoint,
    note:
      'Statistical projection from your logged weigh-ins, not a promise. Water, sodium and glycogen move the scale day to day.',
  };
}

export function mealsByDate(userId, from, to) {
  const rows = db
    .prepare(
      `SELECT * FROM meals WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date ASC, created_at ASC`
    )
    .all(userId, from, to);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.date)) map.set(row.date, []);
    map.get(row.date).push(row);
  }
  return map;
}

export function nutritionTotals(meals) {
  return meals.reduce(
    (acc, m) => {
      acc.calories += m.calories || 0;
      acc.protein += m.protein_g || 0;
      acc.carbs += m.carbs_g || 0;
      acc.fat += m.fat_g || 0;
      return acc;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 }
  );
}

export function waterTotal(userId, date) {
  const row = db
    .prepare(`SELECT COALESCE(SUM(ml),0) AS ml FROM water_logs WHERE user_id = ? AND date = ?`)
    .get(userId, date);
  return row?.ml || 0;
}

export function getTreadmillSessions(userId, from, to) {
  return db
    .prepare(
      `SELECT * FROM treadmill_sessions WHERE user_id = ? AND date >= ? AND date <= ?
       ORDER BY date ASC, COALESCE(start_time, created_at) ASC`
    )
    .all(userId, from, to);
}

export function getWorkouts(userId, from, to) {
  const sessions = db
    .prepare(
      `SELECT * FROM workout_sessions WHERE user_id = ? AND date >= ? AND date <= ?
       ORDER BY date ASC, created_at ASC`
    )
    .all(userId, from, to);
  const sets = sessions.length
    ? db
        .prepare(
          `SELECT * FROM exercise_sets WHERE session_id IN (${sessions
            .map(() => '?')
            .join(',')}) ORDER BY set_index ASC`
        )
        .all(...sessions.map((s) => s.id))
    : [];
  const bySession = new Map();
  for (const set of sets) {
    if (!bySession.has(set.session_id)) bySession.set(set.session_id, []);
    bySession.get(set.session_id).push(set);
  }
  return sessions.map((s) => ({ ...s, sets: bySession.get(s.id) || [] }));
}

export function epley1RM(weightKg, reps) {
  if (!weightKg || !reps) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/**
 * Strength retention compares best estimated 1RM per lift in the most recent
 * 14 days against the earliest 14 days of the program. 100 = maintained.
 */
export function strengthRetention(userId, { today, startDate }) {
  const sessions = getWorkouts(userId, addDaysKey(startDate, -7), today);
  if (sessions.length === 0) {
    return { status: 'no_data', score: null, lifts: [] };
  }

  const baselineEnd = addDaysKey(startDate, 13);
  const recentStart = addDaysKey(today, -13);
  const baseline = new Map();
  const recent = new Map();

  for (const session of sessions) {
    for (const set of session.sets) {
      const e1rm = epley1RM(set.weight_kg, set.reps);
      if (!e1rm) continue;
      const key = set.exercise.toLowerCase();
      const target = session.date <= baselineEnd ? baseline : recent;
      if (session.date >= recentStart) {
        const prev = target.get(key);
        target.set(key, { name: set.exercise, value: Math.max(prev?.value || 0, e1rm) });
      } else if (session.date <= baselineEnd) {
        const prev = target.get(key);
        target.set(key, { name: set.exercise, value: Math.max(prev?.value || 0, e1rm) });
      }
    }
  }

  const lifts = [];
  for (const [key, base] of baseline) {
    const current = recent.get(key);
    if (!current || base.value <= 0) continue;
    lifts.push({
      exercise: base.name,
      baseline: round(base.value, 1),
      current: round(current.value, 1),
      retention: round((current.value / base.value) * 100, 0),
    });
  }

  if (lifts.length === 0) {
    return {
      status: 'building',
      score: null,
      lifts: [],
      message: 'Needs a baseline block and a recent block with the same lifts.',
    };
  }
  const score = Math.round(lifts.reduce((s, l) => s + l.retention, 0) / lifts.length);
  return { status: 'ok', score, lifts, label: retentionLabel(score) };
}

function retentionLabel(score) {
  if (score >= 100) return 'Strength maintained or improving';
  if (score >= 95) return 'Essentially maintained';
  if (score >= 90) return 'Slight decline — watch recovery';
  return 'Meaningful decline — review deficit and training load';
}

/**
 * Calorie + protein adherence over a window. Only days with at least one meal
 * count; unlogged days are reported separately, never treated as zero intake.
 */
export function adherenceWindow(userId, { goal, from, to }) {
  const meals = mealsByDate(userId, from, to);
  let loggedDays = 0;
  let calorieAdherentDays = 0;
  let proteinAdherentDays = 0;
  let unloggedDays = 0;
  const calorieTolerance = Math.max(150, goal.calories * 0.08);
  const proteinTolerance = goal.protein_g * 0.9;

  for (const date of eachDate(from, to)) {
    const dayMeals = meals.get(date) || [];
    if (dayMeals.length === 0) {
      unloggedDays += 1;
      continue;
    }
    loggedDays += 1;
    const totals = nutritionTotals(dayMeals);
    if (Math.abs(totals.calories - goal.calories) <= calorieTolerance) calorieAdherentDays += 1;
    if (totals.protein >= proteinTolerance) proteinAdherentDays += 1;
  }

  return {
    from,
    to,
    loggedDays,
    unloggedDays,
    calorieAdherencePct: loggedDays ? Math.round((calorieAdherentDays / loggedDays) * 100) : null,
    proteinConsistencyPct: loggedDays ? Math.round((proteinAdherentDays / loggedDays) * 100) : null,
    calorieAdherentDays,
    proteinAdherentDays,
  };
}

export function stepsForRange(userId, from, to) {
  const rows = db
    .prepare(`SELECT * FROM steps_daily WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`)
    .all(userId, from, to);
  return rows;
}

export function stepsForDate(userId, date) {
  return db.prepare(`SELECT * FROM steps_daily WHERE user_id = ? AND date = ?`).get(userId, date);
}

export function recoveryForRange(userId, from, to) {
  return db
    .prepare(
      `SELECT * FROM recovery_logs WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`
    )
    .all(userId, from, to);
}

export function recoveryTrend(userId, { today }) {
  const from = addDaysKey(today, -27);
  const rows = recoveryForRange(userId, from, today);
  if (rows.length === 0) {
    return { status: 'no_data', avgSleep: null, avgReadiness: null, trend: null, days: 0 };
  }
  const sleep = rows.filter((r) => r.sleep_hours != null);
  const readiness = rows.filter((r) => r.readiness != null);
  const avg = (arr, key) => (arr.length ? arr.reduce((s, r) => s + r[key], 0) / arr.length : null);

  const half = Math.floor(rows.length / 2);
  const earlier = rows.slice(0, half);
  const later = rows.slice(half);
  let trend = 'steady';
  if (earlier.length >= 3 && later.length >= 3) {
    const e = avg(earlier.filter((r) => r.readiness != null), 'readiness');
    const l = avg(later.filter((r) => r.readiness != null), 'readiness');
    if (e != null && l != null) {
      if (l - e > 0.5) trend = 'improving';
      else if (e - l > 0.5) trend = 'declining';
    }
  }

  return {
    status: 'ok',
    avgSleep: round(avg(sleep, 'sleep_hours'), 1),
    avgReadiness: round(avg(readiness, 'readiness'), 1),
    avgSoreness: round(avg(rows.filter((r) => r.soreness != null), 'soreness'), 1),
    trend,
    days: rows.length,
  };
}

export function treadmillMinutes(userId, from, to) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(duration_min),0) AS mins, COUNT(*) AS sessions
       FROM treadmill_sessions WHERE user_id = ? AND date >= ? AND date <= ? AND status != 'skipped'`
    )
    .get(userId, from, to);
  return { minutes: Math.round(row?.mins || 0), sessions: row?.sessions || 0 };
}

export function healthFreshness(userId) {
  const row = db
    .prepare(
      `SELECT * FROM health_syncs WHERE user_id = ? ORDER BY received_at DESC LIMIT 1`
    )
    .get(userId);
  if (!row) {
    return { status: STATUS.NOT_RECORDED, lastSync: null, stale: true, source: null };
  }
  const stale = isStale(row.synced_at, 26);
  return {
    status: stale ? STATUS.PENDING_SYNC : STATUS.VERIFIED_DEVICE,
    lastSync: row.synced_at,
    receivedAt: row.received_at,
    stale,
    source: row.source,
  };
}

export function daysSinceStart(startDate, today) {
  return Math.max(0, daysBetween(startDate, today));
}

export function programProgress(startDate, checkpointDate, today) {
  const total = Math.max(1, daysBetween(startDate, checkpointDate));
  const elapsed = Math.min(total, Math.max(0, daysBetween(startDate, today)));
  return {
    totalDays: total,
    elapsedDays: elapsed,
    remainingDays: Math.max(0, total - elapsed),
    pct: Math.round((elapsed / total) * 100),
  };
}

export function currentWeek(userId, today) {
  return weekStartKey(today);
}
