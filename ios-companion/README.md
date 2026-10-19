# Fitness OS — iPhone HealthKit companion

Automatic, incremental Apple Health sync to the Fitness OS Cloudflare Worker.
This is a native bridge because a browser cannot read HealthKit.

## What it does

- Reads **step count, walking/running distance, heart rate, active energy and
  workouts** with explicit HealthKit authorization.
- Uses `HKAnchoredObjectQuery` with **persisted anchors** so each sync sends only
  new or updated samples.
- Handles **deleted HealthKit samples** (tombstones sent to the Worker).
- Registers `HKObserverQuery` + `enableBackgroundDelivery` so iOS can wake the
  app when health data changes.
- Keeps a **persisted upload queue** in Application Support. Failed uploads are
  retried on launch, observer wake-up, foregrounding, or the next manual sync.
- Sends a revocable **device token** as a Bearer credential.
- Separates iPhone and Apple Watch sources and preserves HealthKit UUIDs, so
  re-sends are idempotent and overlapping activity is de-duplicated server-side.
- Never claims real-time delivery. The UI shows **Connected**, **Sync delayed**,
  **Permission required**, **Connection required** or **Sync error**.

## Build

1. In Xcode: **File → New → Project → iOS App**, SwiftUI, iOS 17+, physical
   iPhone target.
2. Replace the generated `ContentView.swift` with `HealthBridge.swift`.
3. Target → **Signing & Capabilities** → add **HealthKit**.
4. Add the HealthKit entitlement (`com.apple.developer.healthkit = YES`). The
   capability UI normally does this for you.
5. Add this `Info.plist` key:

```xml
<key>NSHealthShareUsageDescription</key>
<string>Fitness OS reads your steps, heart rate, energy and workouts so you can see your training record.</string>
```

6. Run on a **physical iPhone**. HealthKit background delivery and workout data
   are limited or unavailable in the simulator.

## Connect

1. In Fitness OS: **Settings → Cloud & Apple Health → Create device token**.
   Copy the token once.
2. In the companion: enter your Worker base URL (for example
   `https://fitnessos-api.your-subdomain.workers.dev`) and paste the token.
3. Tap **Save connection** → **Grant Health access**.
4. Tap **Sync now** once to establish anchors and send the initial backfill.
5. Background observers start automatically after permission is granted.

## Worker payload

`POST /api/health/sync` with `Authorization: Bearer fos_…`:

```json
{
  "version": 1,
  "source": "Saketh’s iPhone",
  "syncedAt": "2026-10-19T18:00:00Z",
  "samples": [
    {
      "id": "healthkit-uuid",
      "start": "2026-10-19T12:00:00Z",
      "end": "2026-10-19T12:15:00Z",
      "steps": 214,
      "source": "Apple Watch",
      "device": "Apple Watch Series 9"
    }
  ],
  "workouts": [
    {
      "id": "healthkit-uuid",
      "type": "indoor_walk",
      "start": "2026-10-19T12:00:00Z",
      "end": "2026-10-19T12:30:00Z",
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
      "start": "2026-10-19T12:05:00Z",
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

The Worker upserts by HealthKit UUID, stores source/device/import time, and
returns accepted counts. The browser sync engine pulls the records into
IndexedDB and recalculates the three daily step counters.

## What HealthKit cannot provide

- Treadmill belt speed
- Treadmill incline
- Whether a particular person was on the machine

Those stay manual (or come from a supported treadmill integration) and are
labelled accordingly in the web app.

## Signing and background-delivery caveats

- Running on a physical device requires Apple code signing and provisioning.
  Free personal teams expire after 7 days and may not support every capability;
  a paid Apple Developer Program membership may be required for reliable
  background delivery and long-lived provisioning.
- iOS schedules background wake-ups at its discretion. A delayed sync is normal.
  The persisted queue means nothing is lost while the device is offline.
- Background delivery must be tested on a real device with the HealthKit
  capability enabled. It cannot be verified from this repository or a simulator.
- Keep the device token in the Keychain (this code does) and revoke it in
  Fitness OS if the phone is lost.
