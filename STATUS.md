# Deployment status

Last verified: 2026-10-19 20:52 UTC (2026-10-20 02:22 IST)

## Live services

| Service | Status | Detail |
|---|---|---|
| GitHub Pages | ✅ Live | https://sakethdonepudi.github.io/fitnessos/ |
| GitHub Actions | ✅ Passing | test → build → deploy on `main` |
| Cloudflare Worker | ✅ Live | https://fitnessos-api.paralaxicmusic.workers.dev |
| Cloudflare D1 | ✅ Live | `fitnessos` (`6eae433d-624a-45c4-af76-f46039ada26a`, APAC) |
| Daily Cron Trigger | ✅ Registered | `25 18 * * *` UTC = 23:55 IST |
| Cloudflare R2 | ⛔ Disabled | Billing/enablement avoided by request |
| Photo storage | Local-only | IndexedDB; metadata syncs to D1 |
| Apple Health companion | Code ready | Not built/tested on a physical device |

- Repository: https://github.com/sakethdonepudi/fitnessos (public, code only)
- Worker deployment version: `ffb091e1-06b9-4260-b95f-2c21c0a4ded1`
- Deployed source commit: `ea56868`
- Pages workflow: https://github.com/sakethdonepudi/fitnessos/actions/runs/39322084211

## Production account

- Owner account created on the Worker.
- Cloud sync passphrase is stored locally at `~/.fitnessos/cloud-passphrase` (0600).
- Worker URL is stored at `~/.fitnessos/cloud-url`.
- The one-time `SETUP_TOKEN` was deleted from this Mac after registration.
- D1 contains only the production profile/defaults: profile, goal, 8 foods,
  3 recipes and the treadmill preset. No demo progress, test meals, test
  water, test photos or test checkpoints remain.
- To connect a new browser: open the live app → **Connect account** → enter the
  passphrase from the file above. The Worker URL is prefilled by the Pages build.

## Photo storage (local-only)

`PHOTO_STORAGE="local-only"` is set in `worker/wrangler.toml`; the R2 binding is
removed. The R2 implementation remains in `worker/src/photos.js` behind a storage
adapter for future use.

- Photo bytes stay in the browser's IndexedDB.
- Only metadata (kind, MIME, size, dimensions, EXIF, storage mode) syncs to D1.
- The Worker refuses photo byte uploads with `409`.
- Other devices show “Photo file is on another device”; no broken photo URLs.
- Backup includes photo bytes; restore on the same browser keeps them viewable.
- To move photos between devices today, use the encrypted backup/restore flow.
- Enabling R2 later: add the binding, set `PHOTO_STORAGE="r2"`, redeploy. This
  requires enabling R2 (and possibly a billing profile) in Cloudflare.

## Verification results

- `npm test`: **31/31 passing**.
- Static/PWA end-to-end suite: **16/16 passing** (local preview + local Worker).
- Production Worker:
  - account creation and login ✅
  - D1 migration ✅; production profile/defaults present
  - meal logging synced to D1 ✅
  - water logging synced to D1 ✅
  - second-browser pull of profile, meal and water ✅
  - deletion propagation ✅
  - private photo bytes refused in local-only mode ✅
  - local photo upload/view ✅, second-browser “on another device” notice ✅
  - encrypted backup and restore with photo ✅
  - no browser page errors ✅
- Controlled scheduled-handler test:
  - temporarily registered a `*/2 * * * *` trigger,
  - Cloudflare invoked `scheduled` three times while the temporary trigger was
    being removed (`20:42:36`, `20:44:36`, `20:46:36` UTC),
  - each run completed `ok`, processed 1 user, created/reconciled the
    `2026-10-20` checkpoint and correctly skipped the two prior days with no
    data (the first run created it; later runs were idempotent),
  - the test checkpoint, summary and test cron-run rows were removed, and the
    daily `25 18 * * *` schedule was restored (verified via the Cloudflare API).
- The **real 23:55 IST checkpoint has not run yet**. The next scheduled run is
  2026-10-20 18:25 UTC (23:55 IST). Do not treat the controlled test as the
  daily production checkpoint.

## Free-tier / billing status

- No Cloudflare paid service, R2 subscription, billing profile or payment
  method was enabled.
- R2 is disabled; no R2 bucket exists.
- Workers Free and D1 Free are in use. Current data is ~14 records, far below
  free limits (Workers 100k requests/day; D1 5 GB and millions of reads/day).
- Cron Triggers are registered on the Worker; no paid cron product is involved.
- GitHub Pages/Actions are free for this public repo.
- PBKDF2 is capped at 100,000 iterations on Workers (platform limit); the web
  backup uses stronger browser PBKDF2.

## Apple Watch companion

A complete Xcode project is now available at:

```
/Users/sakethdonepudi/conductor/workspaces/fitnessos/brisbane/ios-companion/FitnessOSCompanion.xcodeproj
```

- App entry point, connection screen, HealthKit permission, device-token
  configuration (Keychain), manual Sync Now, background observers, persistent
  retry queue and diagnostics.
- HealthKit and Background Delivery entitlements, privacy usage string, app
  icon, shared scheme and automatic signing are configured.
- The deployed Worker URL is prefilled; no tokens or secrets are embedded.
- `swiftc -parse` passes; the `.xcodeproj` passes `plutil -lint`.
- **Not compiled with `xcodebuild`:** this Mac has only Command Line Tools and
  no installed Xcode/iOS SDK.
- **Not tested on a physical iPhone:** HealthKit authorization, background
  delivery and real workouts remain unverified until you run it on your device.

Remaining user steps:

1. Open the project in Xcode, select your Apple team, confirm the HealthKit and
   Background Delivery capabilities, and run on a physical iPhone.
2. Create a device token in Fitness OS → Settings → Cloud & Apple Health.
3. Paste the Worker URL + token, grant Health access, run Sync now.
4. Test background observer wake-ups on-device. iOS controls timing.
   A paid Apple Developer membership or device reprovisioning may be required;
   free personal-team provisioning normally expires after 7 days.
5. Treadmill incline/speed remain manual unless a treadmill integration supplies
   them.

## Known limitations

- Cloud photos do not cross devices until R2 is enabled (by design).
- Apple Health has not been tested on hardware.
- The app is single-user with a passphrase; there is no email/password recovery.
- Cloudflare cron timing is not guaranteed to the second; scheduled and actual
  timestamps are recorded.
- The GitHub repository is public to allow free GitHub Pages; it contains no
  health records, photos, backups, tokens or secrets.
