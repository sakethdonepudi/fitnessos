import {
  json,
  HttpError,
  nowIso,
  uuid,
  readJson,
  corsHeaders,
  rateLimit,
  clientIp,
  validateString,
  validateDateKey,
} from './util.js';
import {
  firstRunStatus,
  setupUser,
  login,
  verifyPassphrase,
  createSession,
  requireSession,
  revokeSession,
  createDevice,
  listDevices,
  revokeDevice,
  requireDeviceOrSession,
  verifySession,
  bearerToken,
} from './auth.js';
import {
  applyChange,
  pullRecords,
  getRecord,
  serverUpsert,
  audit,
  deleteUserData,
  listRecords,
  rowToRecord,
} from './db.js';
import { createPhotoStorage } from './photos.js';
import { runCloseout, listCronRuns } from './cron.js';

const API_VERSION = '1';

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(request, env) });

  if (path === '/api/healthz' && method === 'GET') {
    return json({ ok: true, service: 'fitnessos-api', version: API_VERSION, time: nowIso() });
  }

  if (path === '/api/config' && method === 'GET') {
    const status = await firstRunStatus(env);
    const storage = createPhotoStorage(env);
    return json({
      ...status,
      version: API_VERSION,
      timezone: 'Asia/Kolkata',
      photoStorage: storage.mode,
      features: { sync: true, photos: storage.mode === 'r2', photoMetadata: true, cron: true, healthSync: true },
      serverTime: nowIso(),
    });
  }

  if (path === '/api/auth/setup' && method === 'POST') {
    await rateLimit(env, `setup:${clientIp(request)}`, 5, 3600);
    const setupToken = request.headers.get('X-Setup-Token') || '';
    if (!env.SETUP_TOKEN) throw new HttpError(503, 'SETUP_TOKEN is not configured on the Worker');
    if (setupToken !== env.SETUP_TOKEN) throw new HttpError(403, 'Invalid setup token');
    const body = await readJson(request);
    const { userId } = await setupUser(env, body.passphrase);
    const session = await createSession(env, userId);
    return json({ ok: true, ...session, user: { id: userId } });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    await rateLimit(env, `login:${clientIp(request)}`, 8, 900);
    const body = await readJson(request);
    const session = await login(env, body.passphrase);
    return json({ ok: true, ...session });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    const token = bearerToken(request);
    if (token) await revokeSession(env, token);
    return json({ ok: true });
  }

  if (path === '/api/auth/me' && method === 'GET') {
    const token = bearerToken(request);
    const session = await verifySession(env, token);
    if (!session) throw new HttpError(401, 'Not authenticated');
    const devices = await listDevices(env, session.userId);
    return json({ user: { id: session.userId, name: 'Owner' }, session: { expiresAt: null }, devices });
  }

  if (path === '/api/devices' && method === 'GET') {
    const { userId } = await requireSession(env, request);
    return json({ devices: await listDevices(env, userId) });
  }

  if (path === '/api/devices' && method === 'POST') {
    const { userId } = await requireSession(env, request);
    const body = await readJson(request);
    const name = validateString(body.name || 'iPhone companion', 'name', { max: 80 });
    const device = await createDevice(env, userId, name);
    await audit(env, userId, 'device.create', 'devices', { name });
    return json(device, 201);
  }

  const deviceMatch = path.match(/^\/api\/devices\/([^/]+)$/);
  if (deviceMatch && method === 'DELETE') {
    const { userId } = await requireSession(env, request);
    await revokeDevice(env, userId, deviceMatch[1]);
    await audit(env, userId, 'device.revoke', 'devices', { id: deviceMatch[1] });
    return json({ ok: true });
  }

  if (path === '/api/sync' && method === 'GET') {
    const { userId } = await requireSession(env, request);
    const since = Number(url.searchParams.get('since') || 0);
    const records = await pullRecords(env, userId, since, 1000);
    const cursor = records.length ? records[records.length - 1].serverSeq : since;
    return json({ records, cursor, serverTime: nowIso() });
  }

  if (path === '/api/sync' && method === 'POST') {
    const { userId } = await requireSession(env, request);
    await rateLimit(env, `sync:${userId}`, 180, 60);
    const body = await readJson(request, 4_000_000);
    const since = Number(body.since || 0);
    const deviceId = typeof body.deviceId === 'string' ? body.deviceId.slice(0, 100) : null;
    const changes = Array.isArray(body.changes) ? body.changes : [];
    if (changes.length > 250) throw new HttpError(413, 'Send at most 250 changes per batch');
    const results = [];
    const conflicts = [];
    for (const change of changes) {
      const result = await applyChange(env, userId, change, deviceId);
      results.push({ id: change.id, record: result.record, conflict: result.conflict, reason: result.reason || null });
      if (result.conflict) {
        conflicts.push({ id: change.id, collection: change.collection, reason: result.reason || 'concurrent_edit', fields: result.conflictFields || [] });
      }
    }
    const records = await pullRecords(env, userId, since, 1000);
    const maxPushed = results.reduce((max, r) => Math.max(max, r.record?.serverSeq || 0), since);
    const maxPulled = records.reduce((max, r) => Math.max(max, r.serverSeq || 0), maxPushed);
    return json({ results, records, conflicts, cursor: maxPulled, serverTime: nowIso() });
  }

  if (path === '/api/health/sync' && method === 'POST') {
    const auth = await requireDeviceOrSession(env, request);
    await rateLimit(env, `health:${auth.userId}:${auth.deviceId || 'session'}`, 240, 3600);
    const body = await readJson(request, 8_000_000);
    const samples = Array.isArray(body.samples)
      ? body.samples
      : Array.isArray(body.stepSamples)
        ? body.stepSamples
        : [];
    const workouts = Array.isArray(body.workouts) ? body.workouts : [];
    const heartRateSamples = Array.isArray(body.heartRateSamples) ? body.heartRateSamples : [];
    const deletedSamples = Array.isArray(body.deletedSampleIds) ? body.deletedSampleIds : [];
    const deletedWorkouts = Array.isArray(body.deletedWorkoutIds) ? body.deletedWorkoutIds : [];
    const deletedHeartRate = Array.isArray(body.deletedHeartRateIds) ? body.deletedHeartRateIds : [];
    if (samples.length > 3000 || workouts.length > 300) throw new HttpError(413, 'Too many records in one batch');

    let acceptedSamples = 0;
    let acceptedWorkouts = 0;
    let deleted = 0;
    let acceptedHeartRate = 0;
    const source = validateString(body.source || 'iPhone+AppleWatch', 'source', { max: 80 });
    const at = nowIso();

    for (const sample of samples) {
      if (!sample || typeof sample.id !== 'string' || !sample.id) continue;
      const start = new Date(sample.start || sample.start_time);
      const end = new Date(sample.end || sample.end_time);
      const steps = Number(sample.steps);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) continue;
      if (!Number.isFinite(steps) || steps < 0 || steps > 200000) continue;
      await serverUpsert(env, auth.userId, 'health_step_samples', sample.id.slice(0, 120), {
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        steps: Math.round(steps),
        source: String(sample.source || source).slice(0, 120),
        device: sample.device ? String(sample.device).slice(0, 120) : null,
        imported_at: at,
      });
      acceptedSamples += 1;
    }

    for (const workout of workouts) {
      if (!workout || typeof workout.id !== 'string' || !workout.id) continue;
      const start = new Date(workout.start || workout.start_time);
      const end = new Date(workout.end || workout.end_time);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) continue;
      await serverUpsert(env, auth.userId, 'health_workouts', workout.id.slice(0, 120), {
        type: String(workout.type || 'other').slice(0, 80),
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        duration_sec: Number(workout.durationSec ?? workout.duration_sec) || Math.round((end - start) / 1000),
        distance_km: workout.distanceKm == null ? null : Number(workout.distanceKm),
        avg_hr: workout.avgHr == null ? null : Number(workout.avgHr),
        max_hr: workout.maxHr == null ? null : Number(workout.maxHr),
        active_calories: workout.activeCalories == null ? null : Number(workout.activeCalories),
        source: String(workout.source || source).slice(0, 120),
        device: workout.device ? String(workout.device).slice(0, 120) : null,
        imported_at: at,
      });
      acceptedWorkouts += 1;
    }

    for (const hr of heartRateSamples) {
      if (!hr || typeof hr.id !== 'string' || !hr.id) continue;
      const at = new Date(hr.start || hr.timestamp);
      const bpm = Number(hr.bpm ?? hr.value);
      if (!Number.isFinite(at.getTime()) || !Number.isFinite(bpm) || bpm <= 0 || bpm > 300) continue;
      await serverUpsert(env, auth.userId, 'heart_rate_samples', hr.id.slice(0, 120), {
        timestamp: at.toISOString(),
        bpm: Math.round(bpm),
        source: String(hr.source || source).slice(0, 120),
        device: hr.device ? String(hr.device).slice(0, 120) : null,
        imported_at: at.toISOString(),
      });
      acceptedHeartRate += 1;
    }

    for (const id of deletedSamples.slice(0, 1000)) {
      const existing = await getRecord(env, auth.userId, String(id));
      if (existing && !existing.deleted) {
        await serverUpsert(env, auth.userId, 'health_step_samples', String(id), existing.data, { deleted: true });
        deleted += 1;
      }
    }
    for (const id of deletedHeartRate.slice(0, 1000)) {
      const existing = await getRecord(env, auth.userId, String(id));
      if (existing && !existing.deleted) {
        await serverUpsert(env, auth.userId, 'heart_rate_samples', String(id), existing.data, { deleted: true });
        deleted += 1;
      }
    }
    for (const id of deletedWorkouts.slice(0, 500)) {
      const existing = await getRecord(env, auth.userId, String(id));
      if (existing && !existing.deleted) {
        await serverUpsert(env, auth.userId, 'health_workouts', String(id), existing.data, { deleted: true });
        deleted += 1;
      }
    }

    const importId = `import:${uuid()}`;
    await serverUpsert(env, auth.userId, 'health_imports', importId, {
      source,
      device_id: auth.deviceId || 'session',
      device_name: body.deviceName || null,
      synced_at: body.syncedAt || at,
      received_at: at,
      samples: acceptedSamples,
      workouts: acceptedWorkouts,
      heart_rate: acceptedHeartRate,
      deleted,
      version: Number(body.version) || 1,
    });
    await audit(env, auth.userId, 'health.sync', 'health', {
      deviceId: auth.deviceId || 'session',
      samples: acceptedSamples,
      workouts: acceptedWorkouts,
      heart_rate: acceptedHeartRate,
      deleted,
    });
    return json({
      ok: true,
      accepted: { samples: acceptedSamples, workouts: acceptedWorkouts, heartRate: acceptedHeartRate, deleted },
      serverTime: at,
      importId,
    });
  }

  if (path === '/api/health/status' && method === 'GET') {
    const { userId } = await requireSession(env, request);
    const imports = await listRecords(env, userId, 'health_imports');
    const devices = await listDevices(env, userId);
    const latest = imports.at(-1)?.data || null;
    return json({
      lastImport: latest?.received_at || latest?.synced_at || null,
      imports: imports.slice(-10).reverse().map((r) => ({ id: r.id, ...r.data })),
      devices,
      stale: !latest || Date.now() - new Date(latest.received_at || latest.synced_at).getTime() > 36 * 3600_000,
    });
  }

  const photoMatch = path.match(/^\/api\/photos\/([^/]+)$/);
  if (photoMatch) {
    const { userId } = await requireSession(env, request);
    const storage = createPhotoStorage(env);
    if (method === 'POST') {
      if (storage.mode !== 'r2') {
        return json(
          { error: 'Cloud photo storage is disabled. Photos remain in this browser; only metadata syncs.', mode: storage.mode },
          409
        );
      }
      await rateLimit(env, `photo:${userId}`, 300, 3600);
      const result = await storage.upload(userId, request, photoMatch[1]);
      return json(result, 201);
    }
    if (method === 'GET') {
      return storage.get(userId, photoMatch[1]);
    }
    if (method === 'DELETE') {
      return json(await storage.delete(userId, photoMatch[1]));
    }
  }

  if (path === '/api/jobs' && method === 'GET') {
    await requireSession(env, request);
    const runs = await listCronRuns(env, 30);
    const now = new Date();
    const target = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      18,
      25,
      0
    ));
    if (target <= now) target.setUTCDate(target.getUTCDate() + 1);
    return json({ runs, nextRun: target.toISOString(), timezone: 'Asia/Kolkata', schedule: '25 18 * * *' });
  }

  if (path === '/api/jobs/run' && method === 'POST') {
    const { userId } = await requireSession(env, request);
    await rateLimit(env, `jobs:${userId}`, 20, 3600);
    const body = await readJson(request);
    const date = body.date ? validateDateKey(body.date) : undefined;
    const result = await runCloseout(env, { scheduledTime: Date.now(), manualDates: date ? [date] : null });
    return json(result);
  }

  if (path === '/api/audit' && method === 'GET') {
    const { userId } = await requireSession(env, request);
    const limit = Math.min(200, Number(url.searchParams.get('limit') || 50));
    const rows = await env.DB.prepare(
      `SELECT * FROM audit_log WHERE user_id = ? ORDER BY at DESC LIMIT ?`
    ).bind(userId, limit).all();
    return json({ rows: rows.results || [] });
  }

  if (path === '/api/account/export' && method === 'GET') {
    const { userId } = await requireSession(env, request);
    await rateLimit(env, `export:${userId}`, 10, 3600);
    const rows = await env.DB.prepare(
      `SELECT * FROM sync_records WHERE user_id = ? AND deleted = 0 ORDER BY collection, updated_at`
    ).bind(userId).all();
    const storage = createPhotoStorage(env);
    const includePhotos = url.searchParams.get('photos') === '1' && storage.mode === 'r2';
    let photos = [];
    if (includePhotos) {
      const photoRows = await env.DB.prepare(
        `SELECT id FROM photos WHERE user_id = ? AND deleted = 0 ORDER BY created_at`
      ).bind(userId).all();
      for (const p of photoRows.results || []) {
        const exported = await storage.export(userId, p.id);
        if (exported) photos.push(exported);
      }
    }
    await audit(env, userId, 'account.export', 'account', { photos: includePhotos });
    return json({
      format: 'fitness-os-export',
      version: 1,
      exportedAt: nowIso(),
      timezone: 'Asia/Kolkata',
      records: (rows.results || []).map(rowToRecord),
      photos,
      photoStorage: storage.mode,
      photosNote: storage.mode === 'local-only' ? 'Photo bytes stay on the originating device. Only metadata is stored in D1.' : null,
    });
  }

  if (path === '/api/account' && method === 'DELETE') {
    const { userId } = await requireSession(env, request);
    const body = await readJson(request);
    if (body.confirm !== 'DELETE') throw new HttpError(400, 'Confirmation required');
    await verifyPassphrase(env, body.passphrase || '');
    await deleteUserData(env, userId);
    return json({ ok: true });
  }

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    try {
      const response = await route(request, env);
      for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
      return response;
    } catch (err) {
      const status = err?.status || 500;
      if (status >= 500) console.error('[worker]', err);
      const payload = { error: err?.message || 'Internal error' };
      if (err?.detail) payload.detail = err.detail;
      const response = json(payload, status);
      for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
      return response;
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      runCloseout(env, { scheduledTime: controller.scheduledTime }).catch((err) => {
        console.error('[cron] closeout failed', err);
      })
    );
  },
};
