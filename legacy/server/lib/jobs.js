import { db, nowIso } from '../db.js';
import { localDateKey, todayKey, tzOffsetMinutes, addDaysKey } from './dates.js';
import { createCheckpoint, reconcileCheckpoint } from './checkpoint.js';
import { recomputeStepsForDate } from './sync.js';

const TARGET_HOUR = 23;
const TARGET_MINUTE = 55;

function zonedParts(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    hour: Number(parts.hour === '24' ? '0' : parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

function recordRun(name, runDate, status, detail, startedAt) {
  try {
    db.prepare(
      `INSERT INTO job_runs (name, run_date, started_at, finished_at, status, detail)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(name, run_date) DO UPDATE SET
         finished_at = excluded.finished_at,
         status = excluded.status,
         detail = excluded.detail`
    ).run(name, runDate, startedAt, nowIso(), status, detail ? String(detail).slice(0, 2000) : null);
  } catch (err) {
    console.error('[jobs] failed to record run', err);
  }
}

export function runDailyCloseout({ force = false } = {}) {
  const users = db.prepare(`SELECT * FROM users`).all();
  const results = [];
  for (const user of users) {
    const tz = user.timezone || 'Asia/Kolkata';
    const date = todayKey(tz);
    const started = nowIso();
    try {
      const { created, checkpoint } = createCheckpoint(user.id, date, tz, { force });
      recordRun('daily_checkpoint', `${date}:${user.id}`, 'ok', created ? 'created' : 'existing', started);
      results.push({ userId: user.id, date, created, id: checkpoint?.id });
    } catch (err) {
      recordRun('daily_checkpoint', `${date}:${user.id}`, 'error', err?.stack || String(err), started);
      results.push({ userId: user.id, date, error: String(err?.message || err) });
    }
  }
  return results;
}

/**
 * Reconciliation pass: fills in days whose checkpoint was pending because
 * Health had not synced, and recomputes step attribution for recent days.
 */
export function runReconciliation({ days = 7 } = {}) {
  const users = db.prepare(`SELECT * FROM users`).all();
  const results = [];
  for (const user of users) {
    const tz = user.timezone || 'Asia/Kolkata';
    const today = todayKey(tz);
    for (let i = 0; i < days; i += 1) {
      const date = addDaysKey(today, -i);
      const started = nowIso();
      try {
        recomputeStepsForDate(user.id, date, tz);
        const result = reconcileCheckpoint(user.id, date);
        recordRun(
          'reconcile',
          `${date}:${user.id}`,
          'ok',
          result.reconciled ? `changed:${result.changes.length}` : result.reason || 'no_checkpoint',
          started
        );
        results.push({ userId: user.id, date, ...result, checkpoint: undefined });
      } catch (err) {
        recordRun('reconcile', `${date}:${user.id}`, 'error', err?.stack || String(err), started);
        results.push({ userId: user.id, date, error: String(err?.message || err) });
      }
    }
  }
  return results;
}

let timer = null;
let lastRunKey = null;
let lastReconcileKey = null;

/**
 * A dependency-free scheduler. It wakes every 30 seconds and fires the
 * closeout once per local day when the clock reaches 23:55.
 */
export function startScheduler() {
  if (timer) return;
  console.log('[jobs] scheduler started (11:55 PM Asia/Kolkata closeout + reconciliation)');

  const tick = () => {
    try {
      const users = db.prepare(`SELECT DISTINCT timezone FROM users`).all();
      for (const { timezone } of users) {
        const tz = timezone || 'Asia/Kolkata';
        const now = new Date();
        const { hour, minute } = zonedParts(now, tz);
        const date = localDateKey(now, tz);
        const key = `${tz}:${date}`;
        if (hour === TARGET_HOUR && minute >= TARGET_MINUTE && lastRunKey !== key) {
          lastRunKey = key;
          runDailyCloseout();
        }
        const reconcileKey = `${tz}:${date}`;
        if (hour === 2 && lastReconcileKey !== reconcileKey) {
          lastReconcileKey = reconcileKey;
          runReconciliation({ days: 3 });
        }
      }
    } catch (err) {
      console.error('[jobs] tick error', err);
    }
  };

  tick();
  timer = setInterval(tick, 30_000);
  if (timer.unref) timer.unref();
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function listJobRuns(limit = 40) {
  return db.prepare(`SELECT * FROM job_runs ORDER BY started_at DESC LIMIT ?`).all(limit);
}

export function nextScheduledRun(timeZone = 'Asia/Kolkata') {
  const now = new Date();
  const offset = tzOffsetMinutes(now, timeZone);
  const local = new Date(now.getTime() + offset * 60_000);
  const target = new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      TARGET_HOUR,
      TARGET_MINUTE,
      0
    )
  );
  if (target.getTime() - offset * 60_000 <= now.getTime()) {
    target.setUTCDate(target.getUTCDate() + 1);
  }
  return new Date(target.getTime() - offset * 60_000).toISOString();
}
