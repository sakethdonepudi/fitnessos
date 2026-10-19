/**
 * Evidence status vocabulary shared across every goal in the app.
 *
 * These labels describe HOW a record came to exist — never whether a person
 * deserves credit for it. A missing photo is not evidence of a missed workout.
 */
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
    description: 'Imported from Apple Health / HealthKit with a recorded sync timestamp.',
  },
  [STATUS.LOGGED_USER]: {
    label: 'Logged by user',
    short: 'Logged',
    tone: 'logged',
    description: 'Entered manually. Accurate to the person’s own record, not device-measured.',
  },
  [STATUS.AI_ESTIMATED]: {
    label: 'AI estimated',
    short: 'Estimated',
    tone: 'estimated',
    description: 'Derived from an estimate (for example a food or console photo). Not a measurement.',
  },
  [STATUS.PENDING_SYNC]: {
    label: 'Pending sync',
    short: 'Pending',
    tone: 'pending',
    description: 'Apple Health has not delivered recent data for this metric yet.',
  },
  [STATUS.NEEDS_REVIEW]: {
    label: 'Needs review',
    short: 'Review',
    tone: 'review',
    description: 'Sources disagree or an import could not be reconciled. Requires a human decision.',
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
    rule: 'A linked HealthKit workout, or a completed exercise log with sets, reps and weights.',
    verifiedWhen: 'A matching HealthKit workout exists for the session window.',
    fallback: 'Self-reported exercise log — credited, labelled as logged by user.',
  },
  treadmill: {
    label: 'Treadmill',
    rule: 'Indoor-walking workout data, optionally corroborated by a console photo.',
    verifiedWhen: 'HealthKit indoor walk is linked to the session.',
    fallback: 'Manual session entry, optionally with console-photo corroboration.',
  },
  steps: {
    label: 'Steps',
    rule: 'HealthKit-derived, de-duplicated across iPhone and Apple Watch sources.',
    verifiedWhen: 'Fresh HealthKit step samples cover the day.',
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
    rule: 'A scale reading, optionally supported by a time-stamped scale photo or smart-scale import.',
    verifiedWhen: 'Imported from a compatible smart scale.',
    fallback: 'Manual scale reading — logged by user.',
  },
};

export function bodyFatStatus(pct, source) {
  if (pct == null) return STATUS.NOT_RECORDED;
  if (source === 'measured_scale' || source === 'dexa') return STATUS.VERIFIED_DEVICE;
  if (source === 'estimate' || source === 'ai_photo') return STATUS.AI_ESTIMATED;
  return STATUS.LOGGED_USER;
}

export function bodyFatLabel(pct, source) {
  if (pct == null) return null;
  if (source === 'dexa') return 'DEXA measured';
  if (source === 'measured_scale') return 'Scale measured';
  if (source === 'estimate' || source === 'ai_photo') return 'Estimated';
  return 'Self-reported';
}
