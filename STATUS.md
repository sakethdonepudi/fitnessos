# Deployment status

Last verified: 2026-10-19

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

## Cloudflare Worker / D1 / R2 / Cron — implemented, not deployed ⛔

`npx wrangler whoami` reports **not authenticated** in this environment and no
`CLOUDFLARE_API_TOKEN` is available. Creating D1/R2 resources or deploying the
Worker would require account authorization, so no Worker URL, D1 database, R2
bucket or remote Cron Trigger is claimed as live.

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
