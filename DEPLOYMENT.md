# Deployment

Target:

- Frontend: `https://sakethdonepudi.github.io/fitnessos/`
- Worker: `https://fitnessos-api.<your-subdomain>.workers.dev`
- D1 database: `fitnessos`
- R2 bucket: `fitnessos-photos`
- Cron: `25 18 * * *` UTC = 23:55 Asia/Kolkata

Nothing here requires a paid plan. Do not enable automatic paid upgrades.

---

## 1. GitHub Pages

The app is already configured for the `/fitnessos/` subpath (`vite.config.js`
`base`, manifest `scope`/`start_url`, HashRouter). The workflow is
`.github/workflows/deploy.yml`.

```bash
# from the repository root
git checkout main
git push origin main
```

Then in GitHub:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. **Actions → Deploy Fitness OS to GitHub Pages → Run workflow** (or push).
3. Wait for the `deploy` job and open the `page_url` output.

If the API should be preconfigured for all devices, add a repository variable:

**Settings → Secrets and variables → Actions → Variables → New variable**

```
VITE_API_URL = https://fitnessos-api.<your-subdomain>.workers.dev
```

The app still lets you set the URL at runtime in Settings.

### Private repository blocker

GitHub Pages for **private** repositories is generally limited to paid GitHub
plans (Pro/Team/Enterprise). If the workflow is rejected with a Pages
permission/plan error, either:

- make this code-only repository public (it contains no fitness data or
  photographs), or
- enable GitHub Pro, then re-run the workflow.

This environment could not verify your GitHub plan. The repository is currently
private; the Pages API returned `404` before setup.

---

## 2. Cloudflare Worker + D1 + R2

Requires a Cloudflare account (free). Wrangler is already a dev dependency.

```bash
npx wrangler login
npx wrangler whoami
```

Create the database:

```bash
npx wrangler d1 create fitnessos
# copy the printed database_id into worker/wrangler.toml
```

R2 is **optional**. The current deployment uses `PHOTO_STORAGE="local-only"`
and has no R2 binding. Skip R2 entirely if you do not want to enable it:

```bash
# optional, requires enabling R2 in Cloudflare (may require a billing profile)
npx wrangler r2 bucket create fitnessos-photos --storage-class Standard
# then restore the [[r2_buckets]] binding and set PHOTO_STORAGE="r2"
```

Apply the schema:

```bash
npx wrangler d1 migrations apply fitnessos --remote --config worker/wrangler.toml
```

Set secrets (each command prompts for the value):

```bash
npx wrangler secret put SESSION_SECRET --config worker/wrangler.toml
npx wrangler secret put SETUP_TOKEN --config worker/wrangler.toml
```

- `SESSION_SECRET`: random 32+ bytes. It peppers session/device token hashes.
- `SETUP_TOKEN`: one-time bootstrap token. The first account must supply it.
  Delete/rotate it after setup if you want to lock down initialization.

Deploy:

```bash
npm run build
npx wrangler deploy --config worker/wrangler.toml
```

Copy the printed Worker URL. Test:

```bash
curl https://<worker>/api/healthz
curl https://<worker>/api/config
```

`setupRequired: true` means no owner account exists yet.

Register the cron trigger automatically from `worker/wrangler.toml` (the
`[triggers]` section). Confirm in **Workers → your worker → Triggers**.

### First account

Open the GitHub Pages app:

1. Create a local profile.
2. **Settings → Cloud & Apple Health → Connect cloud account**.
3. Worker URL, 12+ character passphrase, and the `SETUP_TOKEN`.
4. The app pushes local records and pulls the empty cloud set.

On another device, choose **Connect account** at first launch and enter only the
Worker URL + passphrase. It pulls the profile and records.

---

## 3. Apple Health companion

Follow `ios-companion/README.md`.

Summary:

1. Create an iOS App in Xcode, add `HealthBridge.swift`, add the **HealthKit**
   capability and `NSHealthShareUsageDescription`.
2. Run on a **physical iPhone**.
3. In Fitness OS: **Settings → Cloud & Apple Health → Create device token**.
4. Paste the Worker URL and token into the companion, grant Health access.
5. The companion uses anchored queries and background delivery, with a persisted
   queue. If iOS delays delivery, the app shows **Sync delayed**; opening the
   app flushes the queue.

This cannot be built or tested from this workspace (no Xcode/iOS device). Apple
signing/provisioning and the HealthKit capability must be verified on-device.

---

## 4. Data migration from the old SQLite backend

The original server is preserved at `legacy/server/`.

```bash
npm install
DB_PATH=./data/fitness.db node legacy/scripts/export-legacy.mjs
# -> migration/legacy-export.json + export-manifest.json (includes photo blobs)
```

Then either:

**A. Import in the app (recommended, audited in the UI):**

**Settings → Data & Backup → Import legacy JSON**. Records are written to
IndexedDB and queued for D1/R2 sync.

**B. Push directly to the Worker:**

```bash
# get a session token
curl -s -X POST "$FITNESS_API_URL/api/auth/login" \
  -H 'content-type: application/json' \
  -d '{"passphrase":"..."}' | jq -r .token

FITNESS_API_URL=https://<worker> \
FITNESS_SESSION_TOKEN=<token> \
node legacy/scripts/migrate-to-worker.mjs
```

The script writes `migration/migration-audit-<timestamp>.json` with the input
SHA-256, counts, conflicts and uploaded photo IDs. Stable IDs make re-runs
idempotent. Photos are uploaded to private R2.

> The legacy export contains private health data. `migration/*.json` is
> gitignored. Do not commit it.

---

## 5. Verification checklist

```bash
npm test
npm run build
npm run preview
# http://localhost:4173/fitnessos/
```

- Create a profile; add a meal/water/weigh-in; refresh.
- Go offline (DevTools → Network → Offline), edit, confirm the offline banner,
  go online, confirm sync and worker receipt.
- Connect Worker; open a second browser profile; sign in; confirm the same data.
- Import the companion JSON in Settings; confirm step counters split.
- Create an encrypted backup, modify data, restore merge/replace.
- Install the PWA and reopen offline.
- Run the Worker closeout manually:

```bash
curl -X POST https://<worker>/api/jobs/run \
  -H "Authorization: Bearer <session-token>" \
  -H 'content-type: application/json' -d '{"date":"2026-10-19"}'
```

- Confirm `GET /api/jobs` shows scheduled/actual timestamps.
- Confirm a second run with the same scheduled key is skipped.

---

## 6. Free-tier notes

- **Workers Free:** 100,000 requests/day; CPU time limited per invocation.
  PBKDF2 login (210k iterations) is the heaviest operation and happens only on
  login.
- **D1 Free:** 5 GB storage, 5M row reads/day, 100k row writes/day. A single
  user's sync traffic is tiny. The cron reads one day + two reconciliation days
  per run.
- **R2 Free (not enabled):** 10 GB storage if you opt in. The current
  deployment stores photos locally in IndexedDB and syncs only metadata.
- **Cron Triggers:** included with Workers Free.
- Do not enable paid overages. The architecture avoids paid services.

---

## 7. Security notes

- All private API endpoints require a session or device token.
- Session tokens expire after 30 days and are revocable; device tokens are
  revocable individually.
- Passphrases are never stored; PBKDF2 hashes are stored in D1.
- CORS is restricted to the Pages origin and localhost development.
- Login/setup/sync/photo/job endpoints are rate-limited in D1.
- R2 has no public access; photos are proxied only to authenticated requests.
- Backups are encrypted with AES-GCM and PBKDF2-SHA-256 (250k iterations).
- The GitHub Pages bundle contains no secrets. `VITE_API_URL` is not a secret.
- `SETUP_TOKEN` is a Worker secret, never a build variable.
- Account export/delete endpoints require the session (and passphrase for
  deletion) and audit the operation.
