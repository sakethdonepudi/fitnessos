import { db, getRecord, listRecords, metaGet, metaSet, nowIso, audit } from './db.js';
import { addDaysKey, todayKey, tzOffsetMinutes } from '../../shared/dates.js';
import { createCheckpoint } from './api.js';
import { requestSync } from './sync.js';

const TZ = 'Asia/Kolkata';
let timer = null;
let running = false;

function localNow() {
  const now = new Date();
  const offset = tzOffsetMinutes(now, TZ);
  const local = new Date(now.getTime() + offset * 60_000);
  return { hour: local.getUTCHours(), minute: local.getUTCMinutes(), date: todayKey(TZ) };
}

async function hasAnyData(date) {
  for (const collection of ['meals', 'water', 'workouts', 'treadmill_sessions', 'weigh_ins', 'recovery', 'steps_daily']) {
    const rows = await listRecords(collection);
    if (rows.some((r) => r.date === date)) return true;
  }
  return false;
}

export async function catchUpCheckpoints() {
  if (running) return { skipped: true };
  const profile = await getRecord('profile', 'profile');
  if (!profile) return { skipped: true, reason: 'no_profile' };
  running = true;
  try {
    const today = todayKey(TZ);
    const { hour, minute } = localNow();
    const results = [];
    const start = profile.start_date || today;
    const earliest = addDaysKey(today, -29) > start ? addDaysKey(today, -29) : start;

    // Today, only once the local 23:55 boundary has passed while the app is open.
    if (hour > 23 || (hour === 23 && minute >= 55)) {
      const existing = await getRecord('checkpoints', `checkpoint:${today}`);
      if (!existing && (await hasAnyData(today))) {
        results.push(await createCheckpoint(today, { source: 'client', reconstructed: false }));
      } else if (existing) {
        results.push(await createCheckpoint(today, { source: existing.source || 'client' }));
      }
    }

    // Missed days: reconstruct from what is stored, labelled honestly.
    for (let d = earliest; d < today; d = addDaysKey(d, 1)) {
      const existing = await getRecord('checkpoints', `checkpoint:${d}`);
      if (existing) {
        // Fold in late records without touching the original snapshot.
        if (existing.status !== 'reconciled') results.push(await createCheckpoint(d, { source: existing.source || 'reconstructed' }));
        continue;
      }
      if (!(await hasAnyData(d))) continue;
      results.push(await createCheckpoint(d, { source: 'reconstructed', reconstructed: true }));
      await audit('checkpoint.reconstructed', 'checkpoints', { date: d, note: 'Rebuilt after the scheduled time; the app was not open at 23:55.' });
    }
    if (results.some((r) => r?.created || r?.reconciled)) requestSync();
    await metaSet('lastCheckpointScan', nowIso());
    return { ok: true, count: results.length, results };
  } finally {
    running = false;
  }
}

export function startCheckpointScheduler() {
  if (timer) clearInterval(timer);
  const tick = async () => {
    const { hour, minute, date } = localNow();
    if (hour === 23 && minute >= 55) {
      const key = await metaGet('lastLiveCheckpointDate', null);
      if (key !== date) {
        await metaSet('lastLiveCheckpointDate', date);
        await catchUpCheckpoints();
      }
    }
  };
  tick().catch(() => {});
  timer = setInterval(() => tick().catch(() => {}), 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') catchUpCheckpoints().catch(() => {});
  });
}

export function stopCheckpointScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function localCheckpointSummary() {
  const rows = await listRecords('checkpoints');
  return {
    today: todayKey(TZ),
    next: (() => {
      const now = new Date();
      const offset = tzOffsetMinutes(now, TZ) * 60_000;
      const local = new Date(now.getTime() + offset);
      let targetLocal = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 23, 55, 0);
      if (targetLocal - offset <= now.getTime()) targetLocal += 86_400_000;
      return new Date(targetLocal - offset).toISOString();
    })(),
    count: rows.length,
    last: rows.sort((a, b) => b.date.localeCompare(a.date))[0] || null,
  };
}
