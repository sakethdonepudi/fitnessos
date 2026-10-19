import {
  db,
  pendingChanges,
  pendingCount,
  markSynced,
  metaGet,
  metaSet,
  nowIso,
  importRecord,
} from './db.js';
import { remote, getSessionToken } from './remote.js';

const listeners = new Set();
let running = false;
let timer = null;
let debounce = null;
let started = false;

export const syncState = {
  status: 'idle', // idle | syncing | synced | offline | local | error
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  configured: false,
  authenticated: false,
  pending: 0,
  lastSync: null,
  error: null,
  conflicts: 0,
  cursor: 0,
};

function emit() {
  for (const fn of listeners) fn({ ...syncState });
}

export function subscribeSync(fn) {
  listeners.add(fn);
  fn({ ...syncState });
  return () => listeners.delete(fn);
}

function setState(partial) {
  Object.assign(syncState, partial);
  emit();
}

export async function initSync() {
  if (started) {
    setState({ authenticated: !!getSessionToken(), configured: remote.configured() });
    requestSync(0);
    return;
  }
  started = true;
  setState({
    configured: remote.configured(),
    authenticated: !!getSessionToken(),
    online: navigator.onLine,
    lastSync: await metaGet('lastSync', null),
    cursor: Number(await metaGet('syncCursor', 0)) || 0,
    pending: await pendingCount(),
    status: remote.configured() && getSessionToken() ? 'idle' : 'local',
  });
  window.addEventListener('online', () => {
    setState({ online: true });
    requestSync(0);
  });
  window.addEventListener('offline', () => {
    setState({ online: false, status: 'offline' });
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestSync(0);
  });
  if (timer) clearInterval(timer);
  timer = setInterval(() => requestSync(0), 45_000);
  requestSync(0);
}

export function stopSync() {
  if (timer) clearInterval(timer);
  if (debounce) clearTimeout(debounce);
  timer = null;
  debounce = null;
}

export function requestSync(delay = 1200) {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => syncNow().catch(() => {}), delay);
}

function mergeForConflict(local, incoming) {
  const localData = local.data || {};
  const remoteData = incoming.data || {};
  const localAt = local.fieldUpdatedAt || {};
  const remoteAt = incoming.fieldUpdatedAt || {};
  const keys = new Set([...Object.keys(localData), ...Object.keys(remoteData)]);
  const data = {};
  const fieldUpdatedAt = {};
  let conflict = false;
  for (const key of keys) {
    const l = localAt[key] || local.updatedAt;
    const r = remoteAt[key] || incoming.updatedAt;
    if (JSON.stringify(localData[key]) === JSON.stringify(remoteData[key])) {
      data[key] = localData[key];
      fieldUpdatedAt[key] = l > r ? l : r;
    } else if (l > r) {
      data[key] = localData[key];
      fieldUpdatedAt[key] = l;
    } else {
      data[key] = remoteData[key];
      fieldUpdatedAt[key] = r;
      if (l === r) conflict = true;
    }
  }
  return { data, fieldUpdatedAt, conflict };
}

async function applyRemote(remoteRecord) {
  const local = await db.records.get(remoteRecord.id);
  const base = {
    id: remoteRecord.id,
    collection: remoteRecord.collection,
    data: { ...(remoteRecord.data || {}), id: remoteRecord.id },
    fieldUpdatedAt: remoteRecord.fieldUpdatedAt || {},
    updatedAt: remoteRecord.updatedAt,
    deleted: !!remoteRecord.deleted,
    version: remoteRecord.version,
    serverSeq: remoteRecord.serverSeq,
    lastSyncedAt: nowIso(),
  };

  if (local?.dirty) {
    // Keep local edits that are newer at the field level, but adopt the server version.
    if (local.deleted || remoteRecord.deleted) {
      const localWins = (local.updatedAt || '') > (remoteRecord.updatedAt || '');
      const merged = localWins
        ? { ...base, data: local.data, deleted: local.deleted, fieldUpdatedAt: local.fieldUpdatedAt, dirty: true }
        : { ...base, dirty: false };
      await db.records.put(merged);
      if (!localWins) {
        await db.outbox.where('recordId').equals(remoteRecord.id).delete();
        if (remoteRecord.collection === 'photos' && remoteRecord.deleted) await db.photos.delete(remoteRecord.id);
      }
      return;
    }

    const merged = mergeForConflict(local, base);
    await db.records.put({
      ...base,
      data: { ...merged.data, id: remoteRecord.id },
      fieldUpdatedAt: merged.fieldUpdatedAt,
      dirty: true,
    });
    if (merged.conflict) {
      await db.syncLog.put({
        at: nowIso(),
        kind: 'conflict',
        status: 'warn',
        detail: { id: remoteRecord.id, collection: remoteRecord.collection },
      });
    }
    return;
  }

  await db.records.put({ ...base, dirty: false });
  if (remoteRecord.collection === 'photos' && remoteRecord.deleted) {
    await db.photos.delete(remoteRecord.id);
  }
}

async function preparePhotoUploads(records) {
  const uploadable = [];
  for (const record of records) {
    if (record.collection !== 'photos') {
      uploadable.push(record);
      continue;
    }
    if (record.deleted) {
      await remote.deletePhoto(record.id).catch(() => {});
      uploadable.push(record);
      continue;
    }
    const cached = await db.photos.get(record.id);
    if (cached?.blob && !cached.remote) {
      try {
        await remote.uploadPhoto(record.id, cached.blob, cached.filename || `${record.id}.jpg`);
        await db.photos.put({ ...cached, remote: true, dirty: false, cachedAt: nowIso() });
        uploadable.push(record);
      } catch (err) {
        // Keep the record dirty; the next sync retries the binary upload.
        await db.syncLog.put({
          at: nowIso(),
          kind: 'photo_upload',
          status: 'error',
          detail: { id: record.id, message: err.message },
        });
      }
    } else {
      uploadable.push(record);
    }
  }
  return uploadable;
}

export async function syncNow() {
  if (running) return { skipped: true };
  if (!remote.configured()) {
    setState({ status: 'local', configured: false, online: navigator.onLine });
    return { skipped: true, reason: 'not_configured' };
  }
  if (!getSessionToken()) {
    setState({ status: 'local', configured: true, authenticated: false });
    return { skipped: true, reason: 'not_authenticated' };
  }
  if (!navigator.onLine) {
    setState({ status: 'offline', online: false, pending: await pendingCount() });
    return { skipped: true, reason: 'offline' };
  }

  running = true;
  setState({ status: 'syncing', error: null, online: true, pending: await pendingCount() });
  let cursor = Number(await metaGet('syncCursor', 0)) || 0;
  let conflicts = 0;

  try {
    for (let batch = 0; batch < 8; batch += 1) {
      const pending = await pendingChanges(200);
      const prepared = await preparePhotoUploads(pending);
      if (!prepared.length && batch === 0) break;
      if (!prepared.length) break;

      const changes = prepared.map((record) => ({
        id: record.id,
        collection: record.collection,
        data: record.data,
        updatedAt: record.updatedAt,
        deleted: !!record.deleted,
        baseVersion: record.version,
        fieldUpdatedAt: record.fieldUpdatedAt || {},
      }));
      const res = await remote.sync({ since: cursor, changes });

      for (const result of res.results || []) {
        if (result.conflict) conflicts += 1;
        if (result.record) {
          await applyRemote(result.record);
          await markSynced(result.id, result.record);
        }
      }
      for (const record of res.records || []) await applyRemote(record);
      cursor = Math.max(cursor, res.cursor || 0, ...res.records.map((r) => r.serverSeq || 0));
      if (prepared.length < 200) break;
    }

    // Drain any remaining pull pages even when nothing was pushed.
    for (let page = 0; page < 8; page += 1) {
      const res = await remote.sync({ since: cursor, changes: [] });
      const records = res.records || [];
      for (const record of records) await applyRemote(record);
      cursor = Math.max(cursor, res.cursor || 0, ...records.map((r) => r.serverSeq || 0));
      if (records.length < 200) break;
    }

    await metaSet('syncCursor', cursor);
    await metaSet('lastSync', nowIso());
    const pending = await pendingCount();
    await db.syncLog.put({
      at: nowIso(),
      kind: 'sync',
      status: conflicts ? 'warn' : 'ok',
      detail: { cursor, pending, conflicts },
    });
    setState({
      status: pending > 0 ? 'syncing' : 'synced',
      pending,
      lastSync: nowIso(),
      cursor,
      conflicts,
      error: null,
    });
    return { ok: true, cursor, conflicts, pending };
  } catch (err) {
    await db.syncLog.put({ at: nowIso(), kind: 'sync', status: 'error', detail: { message: err.message } });
    setState({ status: 'error', error: err.message, pending: await pendingCount() });
    return { ok: false, error: err.message };
  } finally {
    running = false;
  }
}

export async function lastSyncInfo() {
  const lastSync = await metaGet('lastSync', null);
  const pending = await pendingCount();
  return { lastSync, pending };
}

export async function clearSyncState() {
  await metaSet('syncCursor', 0);
  await metaSet('lastSync', null);
  setState({ cursor: 0, lastSync: null, conflicts: 0 });
}

export { importRecord };
