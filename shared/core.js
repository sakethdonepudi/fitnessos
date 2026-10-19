import { addDaysKey, eachDate, daysBetween, weekStartKey } from './dates.js';

export const STATUS = {
  VERIFIED_DEVICE: 'verified_device',
  LOGGED_USER: 'logged_user',
  AI_ESTIMATED: 'ai_estimated',
  PENDING_SYNC: 'pending_sync',
  NEEDS_REVIEW: 'needs_review',
  NOT_RECORDED: 'not_recorded',
};

export const STATUS_META = {
  [STATUS.VERIFIED_DEVICE]: {
    label: 'Verified by device',
    short: 'Device',
    tone: 'verified',
    description: 'Imported from an Apple Health export with a recorded import timestamp.',
  },
  [STATUS.LOGGED_USER]: {
    label: 'Logged by user',
    short: 'Logged',
    tone: 'logged',
    description: 'Entered manually. Accurate to your own record, not device-measured.',
  },
  [STATUS.AI_ESTIMATED]: {
    label: 'AI estimated',
    short: 'Estimated',
    tone: 'estimated',
    description: 'Derived from an estimate. Never presented as a measurement.',
  },
  [STATUS.PENDING_SYNC]: {
    label: 'Pending sync',
    short: 'Pending',
    tone: 'pending',
    description: 'No recent Apple Health import covers this metric. It is not zero.',
  },
  [STATUS.NEEDS_REVIEW]: {
    label: 'Needs review',
    short: 'Review',
    tone: 'review',
    description: 'Sources disagree or an import needs a human decision.',
  },
  [STATUS.NOT_RECORDED]: {
    label: 'Not recorded',
    short: 'None',
    tone: 'empty',
    description: 'Nothing has been logged. This is not a judgement about whether it happened.',
  },
};

export const EVIDENCE_REQUIREMENTS = {
  workout: {
    label: 'Workout',
    rule: 'A linked Apple Health workout, or a completed exercise log with sets, reps and weights.',
    verifiedWhen: 'A matching imported Health workout exists for the session.',
    fallback: 'Self-reported exercise log — credited, labelled as logged by user.',
  },
  treadmill: {
    label: 'Treadmill',
    rule: 'Indoor-walking workout data, optionally corroborated by a console photo.',
    verifiedWhen: 'An imported Health workout is linked to the session.',
    fallback: 'Manual session entry, optionally with console-photo corroboration.',
  },
  steps: {
    label: 'Steps',
    rule: 'Apple Health step samples, de-duplicated across iPhone and Watch sources.',
    verifiedWhen: 'A fresh Apple Health import covers the day.',
    fallback: 'Estimated from partial samples, with uncertainty shown.',
  },
  nutrition: {
    label: 'Nutrition',
    rule: 'Meal log with quantities; product labels or food photos optional.',
    verifiedWhen: 'Never fully device-verified — food photos are estimates.',
    fallback: 'User meal log — logged by user.',
  },
  water: {
    label: 'Water',
    rule: 'Logged quantities. Always self-reported.',
    verifiedWhen: 'Not applicable.',
    fallback: 'Self-reported.',
  },
  bodyweight: {
    label: 'Body weight',
    rule: 'A scale reading, optionally supported by a time-stamped scale photo.',
    verifiedWhen: 'Imported from a compatible smart scale is not supported in the static build.',
    fallback: 'Manual scale reading — logged by user.',
  },
};

export function round(value, digits = 1) {
  if (value == null || !Number.isFinite(value)) return null;
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

export function rollingAverageSeries(weighIns, { windowDays = 7 } = {}) {
  if (!weighIns.length) return [];
  const sorted = [...weighIns].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0].date;
  const last = sorted[sorted.length - 1].date;
  const byDate = new Map(sorted.map((w) => [w.date, w]));
  const out = [];
  for (const date of eachDate(first, last)) {
    const windowStart = addDaysKey(date, -(windowDays - 1));
    const slice = sorted.filter((w) => w.date >= windowStart && w.date <= date && w.weight_kg != null);
    if (!slice.length) continue;
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
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;
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
    ssRes += (p.y - (slope * p.x + intercept)) ** 2;
  }
  return {
    slope,
    intercept,
    residualStd: n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0,
    n,
  };
}

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
    note: 'Statistical projection from your logged weigh-ins, not a promise. Water, sodium and glycogen move the scale day to day.',
  };
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

export function adherenceWindow({ meals, goal, from, to }) {
  const tolerance = Math.max(150, (goal?.calories || 2400) * 0.08);
  const proteinTolerance = (goal?.protein_g || 175) * 0.9;
  const byDate = new Map();
  for (const meal of meals) {
    if (!byDate.has(meal.date)) byDate.set(meal.date, []);
    byDate.get(meal.date).push(meal);
  }
  let loggedDays = 0;
  let unloggedDays = 0;
  let calorieAdherentDays = 0;
  let proteinAdherentDays = 0;
  for (const date of eachDate(from, to)) {
    const dayMeals = byDate.get(date) || [];
    if (!dayMeals.length) {
      unloggedDays += 1;
      continue;
    }
    loggedDays += 1;
    const totals = nutritionTotals(dayMeals);
    if (Math.abs(totals.calories - (goal?.calories || 0)) <= tolerance) calorieAdherentDays += 1;
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

export function epley1RM(weightKg, reps) {
  if (!weightKg || !reps) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export function strengthRetentionFromSessions(sessions, { today, startDate }) {
  const relevant = sessions.filter(
    (s) => s.date >= addDaysKey(startDate, -7) && s.date <= today && Array.isArray(s.sets)
  );
  if (!relevant.length) return { status: 'no_data', score: null, lifts: [] };

  const baselineEnd = addDaysKey(startDate, 13);
  const recentStart = addDaysKey(today, -13);
  const baseline = new Map();
  const recent = new Map();

  for (const session of relevant) {
    for (const set of session.sets) {
      const e1rm = epley1RM(set.weight_kg, set.reps);
      if (!e1rm) continue;
      const key = String(set.exercise).toLowerCase();
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
  if (!lifts.length) {
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

export function recoveryTrendFromLogs(rows) {
  if (!rows.length) return { status: 'no_data', avgSleep: null, avgReadiness: null, trend: null, days: 0 };
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

export function coach({ profile, goal, weighIns, workouts, recoveryRows, meals, today }) {
  const start = profile?.start_date || today;
  const checkpoint = profile?.checkpoint_date || '2026-12-01';
  const series = rollingAverageSeries(weighIns);
  const recent = series.filter((s) => s.rolling != null).slice(-14);

  const currentAvg = recent.length ? recent[recent.length - 1].rolling : null;
  const weekAgoPoint = [...series].reverse().find((s) => s.date <= addDaysKey(today, -7) && s.rolling != null);
  const twoWeekPoint = [...series].reverse().find((s) => s.date <= addDaysKey(today, -14) && s.rolling != null);

  const weeklyChange = currentAvg != null && weekAgoPoint?.rolling != null ? currentAvg - weekAgoPoint.rolling : null;
  const twoWeekChange = currentAvg != null && twoWeekPoint?.rolling != null ? currentAvg - twoWeekPoint.rolling : null;

  const strength = strengthRetentionFromSessions(workouts, { today, startDate: start });
  const recovery = recoveryTrendFromLogs(recoveryRows);
  const weekTreadmill = workouts.filter((w) => w.date >= addDaysKey(today, -6));
  const treadmillMinutes = 0; // caller can attach treadmill minutes separately

  const nutrition = adherenceWindow({ meals, goal, from: addDaysKey(today, -6), to: today });
  const projection = projectWeight({ weighIns, checkpointDate: checkpoint, today });

  const waistEntries = weighIns.filter((w) => w.waist_cm != null);
  const latestWaist = waistEntries.length ? waistEntries[waistEntries.length - 1] : null;
  const waistBaseline =
    [...waistEntries].reverse().find((w) => w.date <= addDaysKey(today, -14)) || waistEntries[0] || null;
  const waistChange =
    latestWaist && waistBaseline && latestWaist !== waistBaseline
      ? Math.round((latestWaist.waist_cm - waistBaseline.waist_cm) * 10) / 10
      : null;

  const flags = [];
  let headline = 'Keep building the baseline';
  let recommendation = 'Log consistently for another week before changing anything.';
  let action = null;
  let tone = 'neutral';
  const hasEnoughWeight = recent.length >= 5;

  if (!hasEnoughWeight) {
    flags.push('weight_data_sparse');
    recommendation =
      'Weigh in at a similar time each morning. Early data is too sparse for a coaching decision — that is expected in the first week.';
  } else if (weeklyChange == null) {
    recommendation = 'Keep logging weigh-ins so a weekly trend can be calculated.';
  } else if (weeklyChange <= -1.0) {
    tone = 'warning';
    headline = 'Losing faster than planned';
    recommendation =
      'Your seven-day average dropped more than about 1 kg. Consider adding roughly 150–250 kcal back and keeping cardio where it is. Do not add more treadmill work to compensate.';
    action = { type: 'ease_deficit', calorieDelta: 200 };
    flags.push('too_fast');
  } else if (weeklyChange >= -0.15 && twoWeekChange != null && Math.abs(twoWeekChange) < 0.3) {
    tone = 'attention';
    headline = 'Progress has been flat for two weeks';
    recommendation =
      nutrition.loggedDays < 5
        ? 'Progress looks flat, but only a few days were logged. Tighten tracking before changing calories — under-logging is the most common cause.'
        : 'Progress has been flat for two weeks with consistent logging. A conservative adjustment of about 100–150 kcal, or 10 extra minutes of easy walking, is reasonable — one change at a time.';
    action = { type: 'conservative_adjustment', calorieDelta: -125, treadmillDeltaMin: 10 };
    flags.push('flat_two_weeks');
  } else if (weeklyChange < -0.4 && weeklyChange > -0.8) {
    tone = 'good';
    headline = 'On track';
    recommendation = 'Your rate of loss is in the 0.4–0.8 kg/week range. Hold the current plan and keep protein high.';
    flags.push('on_track');
  } else if (weeklyChange < -0.15) {
    tone = 'good';
    headline = 'Steady progress';
    recommendation =
      'Loss is a little slower than the target band but still moving. Hold the plan unless the trend stalls for two full weeks.';
    flags.push('slow_but_positive');
  } else {
    headline = 'Scale is noisy this week';
    recommendation =
      'This week’s average moved less than the scale’s normal noise. Keep the plan and look at the two-week trend instead.';
    flags.push('noise');
  }

  if (strength.status === 'ok' && strength.score != null && strength.score < 92) {
    flags.push('strength_decline');
    if (tone !== 'warning') {
      tone = 'warning';
      headline = 'Strength is slipping';
      recommendation = `${strength.label}. Before cutting further, review sleep, protein (target ${goal?.protein_g || 175} g) and session quality. Easing the deficit slightly is usually better than adding cardio.`;
      action = { type: 'ease_deficit', calorieDelta: 150 };
    }
  }
  if (recovery.status === 'ok' && recovery.avgReadiness != null && recovery.avgReadiness < 2.5) {
    flags.push('low_readiness');
    tone = 'warning';
    recommendation =
      'Readiness has averaged below 2.5/5 this block. Prioritise sleep and keep treadmill work conversational until it recovers.';
  }
  if (nutrition.loggedDays <= 2) flags.push('tracking_gap');

  let waistNote = null;
  if (waistChange != null && waistChange <= -1) {
    waistNote = `Waist is down ${Math.abs(waistChange).toFixed(1)} cm across your measured entries — consistent with the weight trend.`;
  } else if (waistChange != null && waistChange >= 1) {
    waistNote =
      'Waist has moved up while you are in a deficit. Re-measure at the same time of day before changing calories; measurement variance is common.';
    flags.push('waist_up');
  }

  const remaining = Math.max(0, daysBetween(today, checkpoint));
  const deadlineNote =
    remaining <= 21
      ? 'The checkpoint is close. Keep the deficit moderate; a crash cut now would cost muscle and rebound later.'
      : null;

  return {
    headline,
    recommendation,
    tone,
    flags,
    action,
    deadlineNote,
    waistNote,
    inputs: {
      weeklyChange: weeklyChange == null ? null : round(weeklyChange, 2),
      twoWeekChange: twoWeekChange == null ? null : round(twoWeekChange, 2),
      currentAverage: currentAvg == null ? null : round(currentAvg, 2),
      strength,
      recovery,
      treadmill: { minutes: treadmillMinutes, sessions: weekTreadmill.length },
      nutrition,
      waist: { current: latestWaist?.waist_cm ?? null, change: waistChange, measuredOn: latestWaist?.date ?? null },
      projection,
      daysToCheckpoint: remaining,
      hasEnoughWeight,
    },
    guardrails: [
      'No starvation or sub-1,500 kcal targets.',
      'No automatic increases for missed sessions or deadline pressure.',
      'No dehydration or water cutting.',
      'Strength and recovery outrank scale weight.',
    ],
  };
}

export const WEEKLY_CARDIO_PLAN = [
  { day: 'Monday', dow: 1, split: 'Push', treadmillMin: '25–30', minMinutes: 25, maxMinutes: 30, mode: 'Incline walk', intent: 'Moderate incline walk after push.', optional: false },
  { day: 'Tuesday', dow: 2, split: 'Pull', treadmillMin: '25–30', minMinutes: 25, maxMinutes: 30, mode: 'Incline walk', intent: 'Moderate incline walk after pull.', optional: false },
  { day: 'Wednesday', dow: 3, split: 'Legs + Abs', treadmillMin: '0–15', minMinutes: 0, maxMinutes: 15, mode: 'Very easy, optional', intent: 'Optional flush only. Legs and abs are the priority today.', optional: true },
  { day: 'Thursday', dow: 4, split: 'Recovery', treadmillMin: '25–35', minMinutes: 25, maxMinutes: 35, mode: 'Comfortable cardio', intent: 'Comfortable, conversational cardio.', optional: false },
  { day: 'Friday', dow: 5, split: 'Shoulders', treadmillMin: '25–30', minMinutes: 25, maxMinutes: 30, mode: 'Incline walk', intent: 'Moderate incline walk after shoulders.', optional: false },
  { day: 'Saturday', dow: 6, split: 'Arms + Accessories', treadmillMin: '25–30', minMinutes: 25, maxMinutes: 30, mode: 'Incline walk', intent: 'Moderate incline walk after arms and accessories.', optional: false },
  { day: 'Sunday', dow: 0, split: 'Rest', treadmillMin: '0', minMinutes: 0, maxMinutes: 0, mode: 'Optional gentle walking', intent: 'Full rest, or gentle outdoor walking if you feel like moving.', optional: true },
];

export function weeklyScheduleFor(today) {
  const [y, m, d] = today.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKLY_CARDIO_PLAN.map((day) => ({ ...day, isToday: day.dow === dow }));
}

export function cardioProgression(weeks) {
  const completed = weeks.filter((w) => w.minutes > 0);
  const avg = completed.length ? completed.reduce((s, w) => s + w.minutes, 0) / completed.length : 0;
  let stage = 'Foundation';
  let suggestion = 'Complete 3–4 sessions at 25–30 minutes before extending duration.';
  if (avg >= 140) {
    stage = 'Building';
    suggestion =
      'You are averaging over 140 minutes a week. If recovery and strength are stable, add 5 minutes to one main block — not to every session.';
  }
  if (avg >= 170) {
    stage = 'Established';
    suggestion =
      'Volume is established. Hold it. Only extend if sleep, joints and strength are all stable for two consecutive weeks.';
  }
  if (avg === 0) {
    stage = 'Starting';
    suggestion = 'Begin with 20 minutes at the easy end of the incline range and build from there.';
  }
  return {
    weeks,
    stage,
    suggestion,
    weeklyPrescribedMinutes: WEEKLY_CARDIO_PLAN.filter((d) => !d.optional).reduce((s, d) => s + d.minMinutes, 0),
    rules: [
      'Duration rises only when recovery, joint comfort and strength allow.',
      'A missed session is never repaid with extra incline, speed or duration.',
      'The December checkpoint never changes the prescribed volume.',
    ],
  };
}

export const DEFAULT_PRESET_BLOCKS = [
  { id: 'warmup', label: 'Warm-up', minutes: 5, speedMin: 3.0, speedMax: 3.5, inclineMin: 0, inclineMax: 2, color: 'warmup', note: 'Easy start. Let breathing settle before adding incline.' },
  { id: 'main', label: 'Main block', minutes: 20, speedMin: 3.5, speedMax: 4.5, inclineMin: 5, inclineMax: 8, color: 'main', note: 'Steady incline walk at a pace you could hold a short conversation at.' },
  { id: 'cooldown', label: 'Cooldown', minutes: 5, speedMin: 3.0, speedMax: 3.0, inclineMin: 0, inclineMax: 0, color: 'cooldown', note: 'Flat and easy. Bring heart rate down gradually.' },
];

export const DEFAULT_FOODS = [
  { name: 'Cooked rice', serving: '150 g', calories: 195, protein_g: 4, carbs_g: 42, fat_g: 0.4, category: 'Staple' },
  { name: 'Dal tadka (cooked)', serving: '150 g', calories: 180, protein_g: 9, carbs_g: 24, fat_g: 5, category: 'Staple' },
  { name: 'Mixed vegetable curry', serving: '150 g', calories: 140, protein_g: 4, carbs_g: 16, fat_g: 7, category: 'Staple' },
  { name: 'Whey protein', serving: '30 g', calories: 120, protein_g: 24, carbs_g: 3, fat_g: 1.5, category: 'Protein' },
  { name: 'Curd (full fat)', serving: '150 g', calories: 90, protein_g: 5, carbs_g: 7, fat_g: 5, category: 'Protein' },
  { name: 'Air-fryer paneer', serving: '100 g', calories: 265, protein_g: 18, carbs_g: 3, fat_g: 20, category: 'Protein' },
  { name: 'Tofu', serving: '100 g', calories: 144, protein_g: 15, carbs_g: 3, fat_g: 9, category: 'Protein' },
  { name: 'Soya chunks (cooked)', serving: '100 g', calories: 170, protein_g: 25, carbs_g: 12, fat_g: 2, category: 'Protein' },
];

export const DEFAULT_RECIPES = [
  {
    name: 'Dal rice bowl',
    servings: 2,
    instructions: 'Cook rice and dal, combine, finish with a little ghee or curd.',
    ingredients: [
      { name: 'Cooked rice', quantity: 300, unit: 'g', calories: 390, protein: 8, carbs: 84, fat: 1 },
      { name: 'Dal tadka', quantity: 300, unit: 'g', calories: 360, protein: 18, carbs: 48, fat: 10 },
      { name: 'Curd', quantity: 100, unit: 'g', calories: 60, protein: 3, carbs: 5, fat: 3 },
    ],
  },
  {
    name: 'Paneer vegetable plate',
    servings: 1,
    instructions: 'Air-fry paneer, serve with vegetable curry and a small portion of rice.',
    ingredients: [
      { name: 'Air-fryer paneer', quantity: 120, unit: 'g', calories: 318, protein: 22, carbs: 4, fat: 24 },
      { name: 'Mixed vegetable curry', quantity: 200, unit: 'g', calories: 187, protein: 5, carbs: 21, fat: 9 },
      { name: 'Cooked rice', quantity: 100, unit: 'g', calories: 130, protein: 3, carbs: 28, fat: 0 },
    ],
  },
  {
    name: 'Soya tofu protein bowl',
    servings: 2,
    instructions: 'Sauté soya and tofu, add vegetables and a measured portion of rice.',
    ingredients: [
      { name: 'Soya chunks', quantity: 150, unit: 'g', calories: 255, protein: 38, carbs: 18, fat: 3 },
      { name: 'Tofu', quantity: 150, unit: 'g', calories: 216, protein: 23, carbs: 5, fat: 14 },
      { name: 'Mixed vegetables', quantity: 200, unit: 'g', calories: 90, protein: 5, carbs: 14, fat: 1 },
    ],
  },
];
