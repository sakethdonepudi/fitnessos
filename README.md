# Fitness OS

A private, single-user fitness operating system for an October 19 → December 1
transformation block. Built to track a real programme honestly: treadmill work
is separated from daily walking, evidence is labelled by provenance, and the
coach refuses to recommend crash dieting.

> Not medical advice. This is a personal tracking tool, not a diagnosis.

## What is implemented

- **Dedicated treadmill module** — separate from the 10,000-step walking
  dashboard. Editable `Incline Fat-Loss Walk` preset (5 min warm-up / 20 min
  incline / 5 min cooldown), interactive block planner, live timeline, guided
  session timer, weekly cardio schedule, progressive volume, and history.
- **Apple Health / HealthKit sync** — a minimal iPhone companion
  (`ios-companion/`) posts step samples and workouts to a token-authenticated
  endpoint. Indoor-walk workouts link to treadmill sessions; strength workouts
  link to (or create) gym sessions. Incline and belt speed are explicitly manual.
- **Three step counters** — A total HealthKit steps, B treadmill-attributed
  steps, C qualifying non-treadmill steps. Only C advances the 10,000-step goal.
  Overlapping iPhone/Watch samples are de-duplicated per minute and the observed
  disagreement is shown as uncertainty.
- **Treadmill console photos** — upload a photo; macOS Vision OCR extracts
  speed, incline, time, distance and calories, shows them for confirmation, and
  flags discrepancies against the session. A photo is never treated as proof of
  identity or completion.
- **Nutrition** — meals with macros, recipe library with ingredient-level
  calculations, water logs, daily/weekly adherence, protein consistency.
  Unlogged days are “not recorded”, never zero intake.
- **Training** — Push/Pull/Legs/Recovery/Shoulders/Arms/Rest split, workout
  logging with sets/reps/weights, estimated-1RM progression, strength-retention
  score, recovery check-ins and trends.
- **Transformation dashboard** — current weight, 7-day rolling average, waist,
  body fat only when measured or explicitly estimated, projected Dec 1 range
  with confidence, weekly adherence, treadmill minutes, qualifying steps,
  recovery, weekly progress photos and an animated milestone timeline.
- **Evidence engine** — every goal carries one of: Verified by device, Logged by
  user, AI estimated, Pending sync, Needs review, Not recorded. Requirements and
  fallbacks are shown in the UI.
- **Smart coaching** — 7-day average weight, waist, strength and recovery drive
  conservative recommendations. No starvation, no dehydration, no punishing
  cardio for a missed session, no deadline-driven crash cuts.
- **Daily closeout at 11:55 PM Asia/Kolkata** — immutable snapshot, then a
  separate reconciliation layer when late HealthKit data arrives. The original
  snapshot is never rewritten.
- **Real persistence** — SQLite, scrypt passwords, HttpOnly sessions, private
  photo storage behind auth, audit log, versioned goals, repeatable jobs.

## Stack

- Node 20 + Express + `better-sqlite3`
- React 18 + Vite (custom CSS, no UI framework)
- macOS Vision OCR helper (optional; falls back to manual entry)
- HealthKit via the Swift companion in `ios-companion/`

## Quick start

```bash
npm install
npm run build:ocr     # macOS only; compiles the Vision OCR helper
npm run seed:demo     # optional: creates a clearly-labelled demo account
npm run dev           # API :4173 + Vite :5173
```

Open <http://localhost:5173>.

- Create a real account on the first screen. No progress data is invented.
- Or choose **Explore with sample data**. Demo credentials:
  `demo@fitness.local` / `demo12345`. A persistent banner marks all data as
  synthetic.

Production-style run:

```bash
npm run build
npm start             # serves dist + API on :4173
```

Reset the demo workspace:

```bash
npm run reset:demo
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4173` | API / production server port |
| `FITNESS_DATA_DIR` | `./data` | SQLite + private photo storage |
| `DB_PATH` | `$FITNESS_DATA_DIR/fitness.db` | Override database file |
| `NODE_ENV` | — | `production` enables secure cookies (use HTTPS) |

Back up your data by copying `data/fitness.db` and `data/photos/`.

## Daily checkpoint

The scheduler runs inside the API process. It wakes every 30 seconds and fires
the closeout once per local day at 23:55 in the user's timezone
(default `Asia/Kolkata`). A reconciliation pass runs at 02:00 and fills in days
where Health had not synced.

Manual equivalents (same code path, used by the UI and tests):

```bash
curl -X POST localhost:4173/api/checkpoints -b cookies.txt \
  -H 'content-type: application/json' -d '{"date":"2026-10-19"}'

curl -X POST localhost:4173/api/checkpoints/2026-10-19/reconcile -b cookies.txt
```

Keep the process running (or use launchd/systemd) for automatic closeouts.

## HealthKit sync

1. Open the companion in Xcode (`ios-companion/README.md`).
2. In Fitness OS → **Settings → Apple Health**, create a device token.
3. Paste the token + base URL into the companion, grant Health access, sync.

The endpoint is `POST /api/health/sync` with
`Authorization: Bearer <device-token>`. Payload schema and limitations are in
`ios-companion/README.md`.

For sync outside your LAN, use Tailscale, a Cloudflare Tunnel with an access
policy, or a VPN. Do not expose it publicly without TLS and access control.

## Console photo OCR

`npm run build:ocr` compiles `tools/ocr-vision.swift` with macOS Vision. Without
the binary, uploads still work but extraction returns “unavailable”, and you can
enter the values manually. OCR output always requires confirmation and is
cross-checked against the logged session; a photo never upgrades a session to
“verified by device”.

## Tests

```bash
npm test
```

Covers timezone boundaries, step de-duplication and treadmill attribution,
weight projection ranges, strength retention, adherence semantics, checkpoint
immutability + reconciliation, pending-sync behaviour, and coaching guardrails.

## Project layout

```
server/
  index.js            Express API
  db.js               SQLite schema + migrations
  auth.js             scrypt auth, sessions, device tokens
  seed-demo.js        labelled synthetic demo workspace
  lib/
    dates.js          timezone-safe day keys
    metrics.js        rolling averages, projection, adherence, strength
    steps.js          de-dup + treadmill attribution
    coach.js          conservative coaching rules
    checkpoint.js     immutable snapshots + reconciliation
    sync.js           HealthKit ingestion / linking
    jobs.js           scheduler + job history
    console-ocr.js    Vision OCR + discrepancy parsing
src/
  pages/              Today, Transformation, Treadmill, Training,
                      Nutrition, Photos, Evidence, Settings
  components/         custom charts, timeline, rings, forms
  styles/             dark-first design system
ios-companion/        SwiftUI HealthKit bridge
tools/                Vision OCR source + build script
test/                 node:test suites
```

## Design notes

- Dark-first, custom SVG charts, glass panels, tabular numerals, reduced-motion
  support, mobile bottom navigation with a full menu.
- Every metric carries a source label. “Not recorded” is used literally.
- Projections are ranges with confidence, never promises.
- Body fat is only shown when measured or explicitly marked estimated. No AI
  photo body-fat claims.
- Demo data is watermarked and banner-labelled; it never touches a real account.
