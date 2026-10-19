import { adherenceWindow, rollingAverageSeries, strengthRetention, treadmillMinutes, recoveryTrend, projectWeight } from './metrics.js';
import { addDaysKey, daysBetween } from './dates.js';

/**
 * Coaching rules.
 *
 * The engine is deliberately conservative. It can recommend *maintaining*,
 * *reviewing* or a *small* adjustment. It will never recommend a crash cut,
 * extra cardio as a punishment for a missed session, or anything tied to a
 * deadline.
 */
export function coach({ userId, profile, goal, weighIns, today }) {
  const checkpoint = profile.checkpoint_date;
  const start = profile.start_date;
  const series = rollingAverageSeries(weighIns);
  const recent = series.filter((s) => s.rolling != null).slice(-14);

  const weekAgoKey = addDaysKey(today, -7);
  const twoWeeksAgoKey = addDaysKey(today, -14);

  const currentAvg = recent.length ? recent[recent.length - 1].rolling : null;
  const weekAgoPoint = [...series].reverse().find((s) => s.date <= weekAgoKey && s.rolling != null);
  const twoWeekPoint = [...series]
    .reverse()
    .find((s) => s.date <= twoWeeksAgoKey && s.rolling != null);

  const weeklyChange =
    currentAvg != null && weekAgoPoint?.rolling != null ? currentAvg - weekAgoPoint.rolling : null;
  const twoWeekChange =
    currentAvg != null && twoWeekPoint?.rolling != null ? currentAvg - twoWeekPoint.rolling : null;

  const strength = strengthRetention(userId, { today, startDate: start });
  const recovery = recoveryTrend(userId, { today });

  const waistEntries = weighIns.filter((w) => w.waist_cm != null);
  const latestWaist = waistEntries.length ? waistEntries[waistEntries.length - 1] : null;
  const waistBaseline =
    [...waistEntries].reverse().find((w) => w.date <= addDaysKey(today, -14)) ||
    waistEntries[0] ||
    null;
  const waistChange =
    latestWaist && waistBaseline && latestWaist !== waistBaseline
      ? Math.round((latestWaist.waist_cm - waistBaseline.waist_cm) * 10) / 10
      : null;
  let waistNote = null;
  if (waistChange != null && waistChange <= -1) {
    waistNote = `Waist is down ${Math.abs(waistChange).toFixed(1)} cm across your measured entries — consistent with the weight trend.`;
  } else if (waistChange != null && waistChange >= 1) {
    waistNote = 'Waist has moved up while you are in a deficit. Re-measure at the same time of day before changing calories; measurement variance is common.';
    flags.push('waist_up');
  }
  const treadmill = treadmillMinutes(userId, addDaysKey(today, -6), today);
  const nutrition = adherenceWindow(userId, {
    goal,
    from: addDaysKey(today, -6),
    to: today,
  });
  const projection = projectWeight({ weighIns, checkpointDate: checkpoint, today });

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
    recommendation =
      'Your rate of loss is in the 0.4–0.8 kg/week range. Hold the current plan and keep protein high.';
    flags.push('on_track');
  } else if (weeklyChange < -0.15) {
    tone = 'good';
    headline = 'Steady progress';
    recommendation =
      'Loss is a little slower than the target band but still moving. Hold the plan unless the trend stalls for two full weeks.';
    flags.push('slow_but_positive');
  } else {
    tone = 'neutral';
    headline = 'Scale is noisy this week';
    recommendation =
      'This week’s average moved less than the scale’s normal noise. Keep the plan and look at the two-week trend instead.';
    flags.push('noise');
  }

  // Safety overrides — these outrank weight-loss recommendations.
  if (strength.status === 'ok' && strength.score != null && strength.score < 92) {
    flags.push('strength_decline');
    if (tone !== 'warning') {
      tone = 'warning';
      headline = 'Strength is slipping';
      recommendation = `${strength.label}. Before cutting further, review sleep, protein (target ${goal.protein_g} g) and session quality. Easing the deficit slightly is usually better than adding cardio.`;
      action = { type: 'ease_deficit', calorieDelta: 150 };
    }
  }
  if (recovery.status === 'ok' && recovery.avgReadiness != null && recovery.avgReadiness < 2.5) {
    flags.push('low_readiness');
    tone = 'warning';
    recommendation =
      'Readiness has averaged below 2.5/5 this block. Prioritise sleep and keep treadmill work conversational until it recovers.';
  }
  if (nutrition.loggedDays <= 2) {
    flags.push('tracking_gap');
  }
  if (treadmill.minutes > 240) {
    flags.push('high_cardio_volume');
    recommendation =
      'Treadmill volume is high this week. More cardio is not the lever for a faster result — protect recovery and strength instead.';
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
      weeklyChange: weeklyChange == null ? null : Math.round(weeklyChange * 100) / 100,
      twoWeekChange: twoWeekChange == null ? null : Math.round(twoWeekChange * 100) / 100,
      currentAverage: currentAvg == null ? null : Math.round(currentAvg * 100) / 100,
      strength,
      recovery,
      treadmill,
      nutrition,
      waist: {
        current: latestWaist?.waist_cm ?? null,
        change: waistChange,
        measuredOn: latestWaist?.date ?? null,
      },
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
