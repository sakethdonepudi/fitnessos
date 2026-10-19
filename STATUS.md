# Deployment status

Last verified: 2026-10-19 19:10 UTC

## GitHub Pages — deployed ✅

- Repository: <https://github.com/sakethdonepudi/fitnessos>
- Live site: <https://sakethdonepudi.github.io/fitnessos/>
- Workflow: `.github/workflows/deploy.yml`
- Verified: HTTP 200, app shell loads, HashRouter deep link
  (`/#/treadmill`) reloads, PWA manifest served, service worker active, zero
  localhost requests.
- The repository was changed from private to **public** because GitHub Pages on
  a private repository requires a paid GitHub plan. The repo contains code and
  synthetic demo assets only; `data/`, migration exports, photos, backups and
  real fitness records are gitignored and were never committed.
- Pages source is **GitHub Actions**.

## Cloudflare deployment — D1 created, R2 blocked, Worker not deployed ⛔

Cloudflare authentication is now confirmed (`paralaxicmusic@gmail.com`).

Completed:

- **D1 created:** `fitnessos` (`6eae433d-624a-45c4-af76-f46039ada26a`, APAC).
  - Remote migration `0001_init.sql` applied.
  - Verified 0 users, 0 sync records, 0 photos.
  - Database ID written into `worker/wrangler.toml`.
- **Worker secrets configured:** `SESSION_SECRET` and `SETUP_TOKEN` uploaded
  without printing them.
  - Setup token is stored on this Mac at `~/.fitnessos/setup-token` with
    `0600` permissions. Read it with `cat ~/.fitnessos/setup-token`, use it for
    the first registration, then delete it.
- **Dry-run bundle:** `wrangler deploy --dry-run` succeeds with the D1 binding
  and cron config.

Blocked:

- **R2 is not enabled on the account.** `wrangler r2 bucket create
  fitnessos-photos --storage-class Standard --location apac` fails with
  `code 10042: Please enable R2 through the Cloudflare Dashboard`.
- Cloudflare may require a billing profile/subscription checkout to enable R2,
  even for the free tier. **No billing was enabled and no payment details were
  entered.** The private photo bucket, Worker deployment, Pages→Worker
  connection, cloud account creation and production cron are therefore **not
  live**.
- The current Wrangler OAuth token also did not list an R2 scope. After R2 is
  enabled, re-run `npx wrangler login` if bucket commands still return a
  permission error.

Enable R2 here (no billing is changed by us):

<https://dash.cloudflare.com/847199152bdf1dd0b38a0adc76deb1d5/r2/overview>

Then continue with:

```bash
npx wrangler r2 bucket create fitnessos-photos --storage-class Standard --location apac
npx wrangler deploy --config worker/wrangler.toml
```

After the Worker URL exists, set it as the GitHub Actions repository variable
`VITE_API_URL` (or enter it in Settings on each device) and re-run the Pages
workflow. Create the first cloud account with the setup token from
`~/.fitnessos/setup-token`.

What *was* verified locally with `wrangler dev --local` (simulated D1 + R2):

- Setup/login/session auth with PBKDF2.
- Device token creation and revocation.
- Bidirectional sync, per-field conflict merge, tombstones, idempotent re-sends.
- Private photo upload/read through R2.
- Health sync payload ingestion (steps, workouts, HR, deletions).
- Cron closeout (`/__scheduled?cron=25+18+*+*+*`), server-side step accounting,
  late-record reconciliation and weekly summary generation.
- D1 schema migration applies cleanly.

Exact next steps are in [DEPLOYMENT.md](./DEPLOYMENT.md). Summary:

```bash
npx wrangler login
npx wrangler d1 create fitnessos
npx wrangler r2 bucket create fitnessos-photos
# put the printed database_id into worker/wrangler.toml
npx wrangler d1 migrations apply fitnessos --remote --config worker/wrangler.toml
npx wrangler secret put SESSION_SECRET --config worker/wrangler.toml
npx wrangler secret put SETUP_TOKEN --config worker/wrangler.toml
npx wrangler deploy --config worker/wrangler.toml
```

Then set the Worker URL in the app (Settings → Cloud & Apple Health) or add a
`VITE_API_URL` Actions repository variable and re-run the Pages workflow.

## Apple Health — companion implemented, on-device build not verified ⚠️

- `ios-companion/HealthBridge.swift` now uses `HKObserverQuery`,
  `HKAnchoredObjectQuery`, background delivery, persisted anchors, deleted-sample
  tombstones, a persisted retry queue and revocable device tokens.
- Not built or tested here: this workspace has no Xcode/iOS SDK or physical
  iPhone, and no Apple signing identity. HealthKit background delivery timing
  cannot be verified from a simulator or CI.
- A paid Apple Developer membership or device reprovisioning may be required.

## Test results

- `npm test`: **31/31 passing** (shared timezone/step/checkpoint/coach logic +
  legacy backend).
- `npm run test:e2e` with local Worker: **16/16 checks passing** — profile,
  persistence, encrypted backup, PWA offline reload, cloud sync, second-device
  pull, mobile overflow and no page errors.
- Live Pages smoke test: pass.

## Free-tier usage

- GitHub Pages: free.
- GitHub Actions: free for this small public repo.
- Cloudflare Workers/D1/R2/Cron: designed for the free tier; nothing is
  deployed, so no usage or billing exists yet. Do not enable paid overages.
