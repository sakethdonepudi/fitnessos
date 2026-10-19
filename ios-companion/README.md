# Fitness OS — iPhone HealthKit companion

A complete SwiftUI Xcode project that reads Apple Health and syncs it to the
deployed Fitness OS Worker.

**Xcode project path**

```
/Users/sakethdonepudi/conductor/workspaces/fitnessos/brisbane/ios-companion/FitnessOSCompanion.xcodeproj
```

(relative: `ios-companion/FitnessOSCompanion.xcodeproj`)

## What it does

- Connection screen with the deployed Worker URL prefilled:
  `https://fitnessos-api.paralaxicmusic.workers.dev`
- Device-token configuration; the token is stored in the **iOS Keychain**, never
  in source code, `UserDefaults`, or the repository.
- HealthKit authorization for step count, walking/running distance, heart rate,
  active energy and workouts.
- `HKAnchoredObjectQuery` with persisted anchors for incremental sync.
- `HKObserverQuery` + `enableBackgroundDelivery` where iOS supports it.
- Deleted HealthKit samples are sent as tombstones.
- Persistent JSON upload queue in Application Support with retries on launch,
  observer wake-up, foregrounding and manual sync.
- Manual **Sync now** and **Test connection** actions.
- Diagnostics: status, last sync, queued uploads, last HealthKit wake, Keychain
  token presence, Worker URL and errors.
- HealthKit anchors can be reset for a full resync.
- Treadmill incline/belt speed are not available from HealthKit; those remain
  manual in the web app.

## Open and sign

1. Open the `.xcodeproj` path above in Xcode.
2. Select the **FitnessOSCompanion** target → **Signing & Capabilities**.
3. Choose your **Team** under Signing (Automatic signing is enabled; no team is
   committed).
4. If `com.sakethdonepudi.fitnessos.bridge` is already registered to another
   team, change **Bundle Identifier** to something unique for your account.
5. Confirm the **HealthKit** capability is present and **Background Delivery** is
   enabled. The project already contains:
   - `com.apple.developer.healthkit`
   - `com.apple.developer.healthkit.background-delivery`
6. Connect a physical iPhone, select it as the run destination, and Run.
7. On the iPhone, trust the developer certificate if prompted:
   **Settings → General → VPN & Device Management → Developer App**.

The entitlement keys are in
`FitnessOSCompanion/FitnessOSCompanion.entitlements`; the capability is also set
in the project's target attributes. `Info.plist` contains
`NSHealthShareUsageDescription`.

## Connect to Fitness OS

1. On the web app: **Settings → Cloud & Apple Health → Create device token**.
   Copy it once.
2. In the companion:
   - Worker URL is prefilled (change it if your Worker URL differs).
   - Paste the device token.
   - **Save connection** → **Test connection**.
   - **Grant Health access**.
   - **Sync now**.
3. Background observers start after permission is granted.

Expected states: **Connected**, **Sync delayed**, **Permission required**,
**Connection required**, **Sync error**. A delayed state is normal; iOS decides
when to wake the app.

## XcodeGen

The project is generated from `project.yml` and checked in. To regenerate:

```bash
cd ios-companion
./scripts/regenerate-project.sh
```

The script also re-applies the HealthKit capability and `Apple Development`
signing identity that XcodeGen does not serialize as a nested capability.

## Verification status

- Swift syntax check passed with `swiftc -parse`.
- The Xcode project file passes `plutil -lint`, contains the Swift source,
  asset catalog, Info.plist, entitlements, HealthKit capability and shared
  scheme.
- **Not compiled with `xcodebuild`**: this Mac has only Command Line Tools and no
  installed Xcode/iOS SDK.
- **Not tested on a physical iPhone**: HealthKit authorization, automatic
  background delivery and real workouts cannot be verified from this environment.
  Do not consider background delivery confirmed until tested on your device.

## Apple signing / membership limitations

- HealthKit requires the HealthKit capability in the provisioning profile.
  Automatic signing should create it after you select your team.
- A **paid Apple Developer Program membership** may be required for reliable
  background-delivery provisioning and long-lived builds. Free personal-team
  provisioning normally expires after 7 days and may not support every
  capability. If Xcode reports that HealthKit or Background Delivery is
  unavailable for your team, use a paid team or enroll.
- A physical iPhone is required. The simulator cannot validate HealthKit
  background delivery or real Apple Watch data.
- iOS does not guarantee immediate background uploads. The persisted queue keeps
  data and retries later.

## Worker payload

`POST /api/health/sync` with `Authorization: Bearer fos_…`:

```json
{
  "version": 1,
  "source": "iPhone",
  "syncedAt": "2026-10-20T02:30:00Z",
  "samples": [
    {
      "id": "healthkit-uuid",
      "start": "2026-10-20T02:00:00Z",
      "end": "2026-10-20T02:15:00Z",
      "steps": 214,
      "source": "Apple Watch",
      "device": "Apple Watch Series 9"
    }
  ],
  "workouts": [
    {
      "id": "healthkit-uuid",
      "type": "indoor_walk",
      "start": "2026-10-20T02:00:00Z",
      "end": "2026-10-20T02:30:00Z",
      "durationSec": 1800,
      "distanceKm": 2.1,
      "avgHr": 130,
      "maxHr": 148,
      "activeCalories": 210,
      "source": "Apple Watch",
      "device": "Apple Watch Series 9"
    }
  ],
  "heartRateSamples": [
    {
      "id": "healthkit-uuid",
      "start": "2026-10-20T02:05:00Z",
      "bpm": 128,
      "source": "Apple Watch",
      "device": "Apple Watch Series 9"
    }
  ],
  "deletedSampleIds": [],
  "deletedWorkoutIds": [],
  "deletedHeartRateIds": []
}
```

The Worker upserts by HealthKit UUID. The web sync engine pulls the records into
IndexedDB and recalculates the three daily step counters. Photo bytes are not
uploaded because the deployed Worker uses `PHOTO_STORAGE="local-only"`.

## Files

```
FitnessOSCompanion.xcodeproj/   checked-in Xcode project + shared scheme
FitnessOSCompanion/
  HealthBridge.swift            app entry, HealthKit manager, queue, connection UI
  Info.plist                    privacy strings and launch config
  FitnessOSCompanion.entitlements
  Assets.xcassets/AppIcon...    1024 px app icon
project.yml                     XcodeGen spec
scripts/regenerate-project.sh   regenerate + reapply capability
scripts/patch-pbxproj.py        capability/signing patch
```
