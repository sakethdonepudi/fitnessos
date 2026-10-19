# Fitness OS

A private, local-first fitness OS with optional automatic cloud sync:

- **Frontend:** React/Vite PWA on GitHub Pages (`/fitnessos/`)
- **API:** Cloudflare Worker (free tier)
- **Database:** Cloudflare D1 (authoritative), IndexedDB (offline cache)
- **Photos:** local IndexedDB by default; optional private Cloudflare R2 when enabled
- **Nightly processing:** Cloudflare Cron Trigger at `25 18 * * *` UTC (11:55 PM Asia/Kolkata)
- **Apple Health:** native SwiftUI companion with anchored queries, background delivery and a persisted retry queue

The existing Express/SQLite implementation is preserved under `legacy/` for
migration and reference. The production app never starts a Node server.

## What works

- Today dashboard, treadmill planner/runner, training split, vegetarian food &
  recipe library, water, weight/waist, progress photos, evidence, checkpoints,
  transformation timeline and weekly analytics — all preserved.
- Local-first records in IndexedDB. Every add/edit/delete survives refresh and
  works offline.
- Bidirectional sync with stable IDs, versions, tombstones, per-field conflict
  resolution, an offline outbox, retries and conflict logging.
- Encrypted backups (PBKDF2 + AES-GCM), merge/replace restore, CSV exports and
  legacy JSON import.
- PWA install, offline app shell, cached static assets, update prompt and
  online/offline indicators.
- Server-side 11:55 PM checkpoint with idempotency, late-record reconciliation
  and cron run history.
- Three step counters: total, treadmill-attributed and qualifying non-treadmill.
  Only qualifying steps advance the 10,000-step goal.

## Local development

```bash
npm install
npm run dev                # http://localhost:5173/fitnessos/
```

The app works without a backend. Create a local profile, log data, refresh and
go offline. Cloud sync is optional and configured in Settings.

To run the Worker locally:

```bash
cp worker/.dev.vars.example worker/.dev.vars   # or create it yourself
npm run worker:migrate:local
npm run worker:dev                             # http://localhost:8787
```

`worker/.dev.vars` needs:

```
SETUP_TOKEN=choose-a-one-time-setup-token
SESSION_SECRET=choose-a-long-random-secret
ENVIRONMENT=development
ALLOWED_ORIGINS=http://localhost:5173,http://localhost:4173,https://sakethdonepudi.github.io
```

Then in the app: **Settings → Cloud & Apple Health → Connect cloud account**,
enter `http://localhost:8787`, a 12+ character passphrase, and the setup token
for the very first account. Subsequent devices only need the passphrase.

## Tests

```bash
npm test          # 31 unit tests (shared logic + legacy backend)
npm run test:e2e  # Playwright end-to-end (requires preview + local Worker)
```

## Deploy

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the exact GitHub Pages and
Cloudflare commands, free-tier limits, blockers, and Apple Health signing notes.

Quick summary:

1. Push to `main`; the GitHub Actions workflow tests, builds and deploys the PWA.
2. Create D1 + R2 and deploy the Worker with Wrangler.
3. Set the Worker URL in the app (or as the `VITE_API_URL` repository variable).
4. Create a device token, paste it into the iOS companion.

## Privacy

- No analytics, no third-party AI, no external database.
- Photos are local-only in the current deployment. If R2 is enabled later, they are private and served only through authenticated Worker requests.
- Sync passphrases are hashed with PBKDF2-SHA-256 on the Worker; session and
  device tokens are stored hashed and are revocable.
- The GitHub repository and Pages artifact contain code only — never health
  records or photographs.
- Local-only mode is fully usable; cloud sync is opt-in.

## Known limitations (honest list)

- **Cloudflare is not authenticated in this build environment.** The Worker is
  implemented and tested locally, but D1/R2/cron are not deployed. You must run
  `wrangler login` and create the resources. See DEPLOYMENT.md.
- **Private GitHub repositories may not offer Pages on a free plan.** GitHub
  Pages for private repos generally requires GitHub Pro/Team/Enterprise. If the
  Pages deployment is rejected, either make this code-only repository public or
  enable GitHub Pro. No private health data is in the repo.
- **Apple Health cannot be tested here.** The Swift companion requires Xcode, an
  Apple signing identity, a physical iPhone and HealthKit permission. Background
  delivery timing is controlled by iOS and is never guaranteed to be real-time.
- **Cloud photo bytes are disabled.** The current deployment uses local-only
  photo storage; photos sync across devices only via an encrypted backup file.
  R2 remains available in the source for future use.
- **No treadmill incline/speed from HealthKit.** Those stay manual unless a
  supported treadmill integration supplies them.
- **No server-side OCR.** The static browser build keeps photos and supports
  manual console-reading confirmation; the legacy macOS OCR tool is under
  `legacy/tools/`.
- **Free-tier limits:** Workers 100k requests/day, D1 5 GB and ~5M row reads /
  100k writes per day, R2 10 GB. These are far above a single user's usage, but
  cron and sync should not be polled aggressively. Stay inside the limits.

## Layout

```
src/                 React app (pages, components, styles)
src/data/            Dexie schema, local API, sync engine, backup, Health import
shared/              Pure date/steps/analytics/checkpoint/legacy logic
worker/              Cloudflare Worker, D1 schema, cron
ios-companion/       SwiftUI HealthKit bridge
legacy/              Original Express/SQLite backend + migration tooling
.github/workflows/   GitHub Pages deployment
public/              PWA icons, favicon
```
