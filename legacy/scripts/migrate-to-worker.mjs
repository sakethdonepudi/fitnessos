/**
 * Repeatable, audited migration: legacy SQLite export → Cloudflare D1 + R2.
 *
 * 1) Export first:
 *      DB_PATH=./data/fitness.db node legacy/scripts/export-legacy.mjs
 * 2) Get a session token (log in to the Worker):
 *      curl -s -X POST "$FITNESS_API_URL/api/auth/login" \
 *        -H 'content-type: application/json' \
 *        -d '{"passphrase":"…"}' | jq -r .token
 * 3) Run:
 *      FITNESS_API_URL=https://…workers.dev \
 *      FITNESS_SESSION_TOKEN=… \
 *      node legacy/scripts/migrate-to-worker.mjs
 *
 * Stable IDs make re-runs idempotent. The script writes an audit manifest with
 * input hash, counts, conflicts and uploaded photo IDs.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { legacyExportToRecords } from '../../shared/legacy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const input = process.env.LEGACY_EXPORT || path.join(root, 'migration', 'legacy-export.json');
const apiUrl = (process.env.FITNESS_API_URL || '').replace(/\/$/, '');
const token = process.env.FITNESS_SESSION_TOKEN || '';

if (!apiUrl || !token) {
  console.error('Set FITNESS_API_URL and FITNESS_SESSION_TOKEN.');
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error(`No export at ${input}. Run export-legacy.mjs first.`);
  process.exit(1);
}

const raw = fs.readFileSync(input);
const sha256 = crypto.createHash('sha256').update(raw).digest('hex');
const data = JSON.parse(raw.toString('utf8'));
const mapped = legacyExportToRecords(data);
const startedAt = new Date().toISOString();

async function post(pathname, body, headers = {}) {
  const res = await fetch(`${apiUrl}${pathname}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${payload.error || 'request failed'}`);
  return payload;
}

console.log(`Migrating ${mapped.records.length} records and ${mapped.photos.length} photos from ${input}`);
let pushed = 0;
const conflicts = [];
for (let i = 0; i < mapped.records.length; i += 100) {
  const batch = mapped.records.slice(i, i + 100);
  const res = await post('/api/sync', {
    since: 0,
    changes: batch.map((r) => ({
      id: r.id,
      collection: r.collection,
      data: r.data,
      updatedAt: r.updatedAt,
      deleted: r.deleted,
      baseVersion: 0,
      fieldUpdatedAt: r.fieldUpdatedAt,
    })),
  });
  pushed += batch.length;
  for (const c of res.conflicts || []) conflicts.push(c);
  console.log(`  pushed ${pushed}/${mapped.records.length} records`);
  await new Promise((resolve) => setTimeout(resolve, 350));
}

let photosUploaded = 0;
for (const photo of mapped.photos) {
  const bytes = Buffer.from(photo.base64, 'base64');
  const form = new FormData();
  form.append('photo', new Blob([bytes], { type: photo.mime || 'image/jpeg' }), photo.filename || `${photo.id}.jpg`);
  const res = await fetch(`${apiUrl}/api/photos/${photo.id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(`Photo ${photo.id}: ${res.status} ${payload.error || ''}`);
  }
  photosUploaded += 1;
  console.log(`  uploaded photo ${photosUploaded}/${mapped.photos.length}`);
  await new Promise((resolve) => setTimeout(resolve, 150));
}

const audit = {
  startedAt,
  finishedAt: new Date().toISOString(),
  input,
  inputSha256: sha256,
  apiUrl,
  records: { total: mapped.records.length, pushed },
  photos: { total: mapped.photos.length, uploaded: photosUploaded },
  collections: mapped.counts,
  conflicts,
};
fs.mkdirSync(path.join(root, 'migration'), { recursive: true });
const auditPath = path.join(root, 'migration', `migration-audit-${Date.now()}.json`);
fs.writeFileSync(auditPath, JSON.stringify(audit, null, 2));
console.log(`Migration complete. Audit: ${auditPath}`);
if (conflicts.length) console.warn(`WARNING: ${conflicts.length} conflict(s) were reported; inspect the audit file.`);
