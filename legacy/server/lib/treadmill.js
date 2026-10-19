import { db, nowIso } from '../db.js';
import { audit } from '../db.js';
import { addDaysKey, todayKey, weekStartKey, localDayBounds } from './dates.js';
import { STATUS } from './evidence.js';

export const DEFAULT_PRESET_BLOCKS = [
  {
    id: 'warmup',
    label: 'Warm-up',
    minutes: 5,
    speedMin: 3.0,
    speedMax: 3.5,
    inclineMin: 0,
    inclineMax: 2,
    color: 'warmup',
    note: 'Easy start. Let breathing settle before adding incline.',
  },
  {
    id: 'main',
    label: 'Main block',
    minutes: 20,
    speedMin: 3.5,
    speedMax: 4.5,
    inclineMin: 5,
    inclineMax: 8,
    color: 'main',
    note: 'Steady incline walk at a pace you could hold a short conversation at.',
  },
  {
    id: 'cooldown',
    label: 'Cooldown',
    minutes: 5,
    speedMin: 3.0,
    speedMax: 3.0,
    inclineMin: 0,
    inclineMax: 0,
    color: 'cooldown',
    note: 'Flat and easy. Bring heart rate down gradually.',
  },
];

export const WEEKLY_CARDIO_PLAN = [
  {
    day: 'Monday',
    dow: 1,
    split: 'Push',
    treadmillMin: '25–30',
    minMinutes: 25,
    maxMinutes: 30,
    mode: 'Incline walk',
    intent: 'Moderate incline walk after push.',
    optional: false,
  },
  {
    day: 'Tuesday',
    dow: 2,
    split: 'Pull',
    treadmillMin: '25–30',
    minMinutes: 25,
    maxMinutes: 30,
    mode: 'Incline walk',
    intent: 'Moderate incline walk after pull.',
    optional: false,
  },
  {
    day: 'Wednesday',
    dow: 3,
    split: 'Legs',
    treadmillMin: '0–15',
    minMinutes: 0,
    maxMinutes: 15,
    mode: 'Very easy, optional',
    intent: 'Optional flush only. Legs are the priority today.',
    optional: true,
  },
  {
    day: 'Thursday',
    dow: 4,
    split: 'Recovery',
    treadmillMin: '25–35',
    minMinutes: 25,
    maxMinutes: 35,
    mode: 'Comfortable cardio',
    intent: 'Comfortable, conversational cardio.',
    optional: false,
  },
  {
    day: 'Friday',
    dow: 5,
    split: 'Shoulders',
    treadmillMin: '25–30',
    minMinutes: 25,
    maxMinutes: 30,
    mode: 'Incline walk',
    intent: 'Moderate incline walk after shoulders.',
    optional: false,
  },
  {
    day: 'Saturday',
    dow: 6,
    split: 'Arms',
    treadmillMin: '25–30',
    minMinutes: 25,
    maxMinutes: 30,
    mode: 'Incline walk',
    intent: 'Moderate incline walk after arms.',
    optional: false,
  },
  {
    day: 'Sunday',
    dow: 0,
    split: 'Rest',
    treadmillMin: '0',
    minMinutes: 0,
    maxMinutes: 0,
    mode: 'Optional gentle walking',
    intent: 'Full rest, or gentle outdoor walking if you feel like moving.',
    optional: true,
  },
];

export function ensureDefaultPreset(userId) {
  const existing = db
    .prepare(`SELECT * FROM treadmill_presets WHERE user_id = ? AND is_default = 1`)
    .get(userId);
  if (existing) return existing;
  const at = nowIso();
  const info = db
    .prepare(
      `INSERT INTO treadmill_presets (user_id, name, description, blocks_json, is_default, updated_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .run(
      userId,
      'Incline Fat-Loss Walk',
      '5 min warm-up, 20 min incline block, 5 min cooldown. Adjust to how you feel — the incline is not a magic fat-burning zone.',
      JSON.stringify(DEFAULT_PRESET_BLOCKS),
      at
    );
  return db.prepare(`SELECT * FROM treadmill_presets WHERE id = ?`).get(info.lastInsertRowid);
}

export function listPresets(userId) {
  ensureDefaultPreset(userId);
  return db
    .prepare(`SELECT * FROM treadmill_presets WHERE user_id = ? ORDER BY is_default DESC, id ASC`)
    .all(userId)
    .map(serialisePreset);
}

export function serialisePreset(row) {
  let blocks = [];
  try {
    blocks = JSON.parse(row.blocks_json);
  } catch {
    blocks = [];
  }
  return {
    ...row,
    blocks,
    totalMinutes: blocks.reduce((s, b) => s + (b.minutes || 0), 0),
  };
}

export function getPreset(userId, id) {
  const row = db
    .prepare(`SELECT * FROM treadmill_presets WHERE user_id = ? AND id = ?`)
    .get(userId, id);
  return row ? serialisePreset(row) : null;
}

export function createPreset(userId, body) {
  const at = nowIso();
  const blocks = normaliseBlocks(body.blocks);
  const info = db
    .prepare(
      `INSERT INTO treadmill_presets (user_id, name, description, blocks_json, is_default, updated_at)
       VALUES (?, ?, ?, ?, 0, ?)`
    )
    .run(userId, body.name, body.description || null, JSON.stringify(blocks), at);
  audit(userId, 'treadmill_preset', info.lastInsertRowid, 'create', null, body);
  return getPreset(userId, info.lastInsertRowid);
}

export function updatePreset(userId, id, body) {
  const before = getPreset(userId, id);
  if (!before) return null;
  const blocks = body.blocks ? normaliseBlocks(body.blocks) : before.blocks;
  db.prepare(
    `UPDATE treadmill_presets SET name = ?, description = ?, blocks_json = ?, updated_at = ?
     WHERE user_id = ? AND id = ?`
  ).run(
    body.name ?? before.name,
    body.description ?? before.description,
    JSON.stringify(blocks),
    nowIso(),
    userId,
    id
  );
  const after = getPreset(userId, id);
  audit(userId, 'treadmill_preset', id, 'update', before, after);
  return after;
}

export function deletePreset(userId, id) {
  const before = getPreset(userId, id);
  if (!before || before.is_default) return { ok: false, reason: 'default' };
  db.prepare(`DELETE FROM treadmill_presets WHERE user_id = ? AND id = ?`).run(userId, id);
  audit(userId, 'treadmill_preset', id, 'delete', before, null);
  return { ok: true };
}

function normaliseBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return DEFAULT_PRESET_BLOCKS;
  return blocks.map((b, i) => ({
    id: b.id || `block-${i + 1}`,
    label: String(b.label || `Block ${i + 1}`).slice(0, 60),
    minutes: clamp(Number(b.minutes) || 1, 1, 120),
    speedMin: clamp(Number(b.speedMin) || 0, 0, 25),
    speedMax: clamp(Number(b.speedMax) || Number(b.speedMin) || 0, 0, 25),
    inclineMin: clamp(Number(b.inclineMin) || 0, 0, 30),
    inclineMax: clamp(Number(b.inclineMax) || Number(b.inclineMin) || 0, 0, 30),
    color: b.color || (i === 0 ? 'warmup' : i === blocks.length - 1 ? 'cooldown' : 'main'),
    note: b.note ? String(b.note).slice(0, 240) : null,
  }));
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function buildTimeline(preset) {
  let cursor = 0;
  const blocks = preset.blocks.map((b) => {
    const start = cursor;
    cursor += b.minutes;
    return {
      ...b,
      startMin: start,
      endMin: cursor,
      avgSpeed: Math.round(((b.speedMin + b.speedMax) / 2) * 10) / 10,
      avgIncline: Math.round(((b.inclineMin + b.inclineMax) / 2) * 10) / 10,
    };
  });
  return { blocks, totalMinutes: cursor };
}

/**
 * Progressive cardio plan: a suggestion only. It never ratchets up on its own
 * and never reacts to missed sessions or the checkpoint date.
 */
export function cardioProgression(userId, { today }) {
  const weekStart = weekStartKey(today);
  const weeks = [];
  for (let i = 5; i >= 0; i -= 1) {
    const start = addDaysKey(weekStart, -7 * i);
    const end = addDaysKey(start, 6);
    const row = db
      .prepare(
        `SELECT COALESCE(SUM(duration_min),0) AS mins, COUNT(*) AS sessions
         FROM treadmill_sessions
         WHERE user_id = ? AND date >= ? AND date <= ? AND status != 'skipped'`
      )
      .get(userId, start, end);
    const prescribed = WEEKLY_CARDIO_PLAN.filter((d) => !d.optional).reduce(
      (s, d) => s + d.minMinutes,
      0
    );
    weeks.push({
      weekStart: start,
      minutes: Math.round(row.mins || 0),
      sessions: row.sessions || 0,
      prescribedMinutes: prescribed,
    });
  }

  const completedWeeks = weeks.filter((w) => w.minutes > 0);
  const avg = completedWeeks.length
    ? completedWeeks.reduce((s, w) => s + w.minutes, 0) / completedWeeks.length
    : 0;

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
    weeklyPrescribedMinutes: WEEKLY_CARDIO_PLAN.filter((d) => !d.optional).reduce(
      (s, d) => s + d.minMinutes,
      0
    ),
    rules: [
      'Duration rises only when recovery, joint comfort and strength allow.',
      'A missed session is never repaid with extra incline, speed or duration.',
      'The December checkpoint never changes the prescribed volume.',
    ],
  };
}

export function sessionStatus(session) {
  if (session.status === 'skipped') return STATUS.NOT_RECORDED;
  if (session.health_workout_id) return STATUS.VERIFIED_DEVICE;
  if (session.console_photo_id && !session.console_confirmed) return STATUS.NEEDS_REVIEW;
  return STATUS.LOGGED_USER;
}

export function listSessions(userId, { from, to, limit = 100 } = {}) {
  const rows = db
    .prepare(
      `SELECT ts.*, hw.imported_at AS health_imported_at, hw.source AS health_source,
              hw.avg_hr AS health_avg_hr, hw.max_hr AS health_max_hr,
              hw.active_calories AS health_calories
       FROM treadmill_sessions ts
       LEFT JOIN health_workouts hw ON hw.id = ts.health_workout_id
       WHERE ts.user_id = ? AND ts.date >= ? AND ts.date <= ?
       ORDER BY ts.date DESC, COALESCE(ts.start_time, ts.created_at) DESC LIMIT ?`
    )
    .all(userId, from, to, limit);
  return rows.map((r) => ({
    ...r,
    evidence: sessionStatus(r),
    console_extracted: r.console_extracted_json ? JSON.parse(r.console_extracted_json) : null,
  }));
}

export function treadmillTotals(userId, from, to) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(duration_min),0) AS minutes,
              COALESCE(SUM(distance_km),0) AS distance,
              COUNT(*) AS sessions,
              COALESCE(SUM(active_calories),0) AS calories
       FROM treadmill_sessions
       WHERE user_id = ? AND date >= ? AND date <= ? AND status != 'skipped'`
    )
    .get(userId, from, to);
  return {
    minutes: Math.round(row.minutes || 0),
    distance: Math.round((row.distance || 0) * 100) / 100,
    sessions: row.sessions || 0,
    calories: Math.round(row.calories || 0),
  };
}

export function weeklyScheduleFor(today) {
  const [y, m, d] = today.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKLY_CARDIO_PLAN.map((day) => ({ ...day, isToday: day.dow === dow }));
}
