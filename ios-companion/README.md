# Fitness OS — iPhone companion

A deliberately small HealthKit bridge. It reads step samples and workouts and
posts them to your private Fitness OS server. There is no third-party backend.

## Why a companion is required

A web app cannot read HealthKit directly. The companion needs the HealthKit
entitlement and the user's permission; it then syncs to the server over HTTPS
(or a private tunnel on your own network).

## Setup

1. In Xcode: **File → New → Project → iOS App**, SwiftUI, iOS 17+.
2. Replace the generated `ContentView.swift` with `HealthBridge.swift`.
3. Select the target → **Signing & Capabilities** → add **HealthKit**.
4. Add these keys to `Info.plist`:
   - `NSHealthShareUsageDescription` — “Fitness OS reads your steps, heart rate, energy and workouts to show your training record.”
   - (optional) `NSHealthUpdateUsageDescription` — only if you later add writing.
5. Run on a physical iPhone. HealthKit is limited on the simulator.
6. In Fitness OS: **Settings → Apple Health → Create device token**. Copy it.
7. In the companion: enter your server base URL and paste the token, then
   **Grant Health access → Sync now**.

## What is sent

```json
{
  "version": 1,
  "source": "iPhone+AppleWatch",
  "syncedAt": "2026-10-19T10:12:00Z",
  "stepSamples": [
    {
      "id": "healthkit-sample-uuid",
      "start": "2026-10-19T02:00:00Z",
      "end": "2026-10-19T02:15:00Z",
      "steps": 214,
      "source": "Apple Watch",
      "device": "Apple Watch Series 9"
    }
  ],
  "workouts": [
    {
      "id": "healthkit-workout-uuid",
      "type": "walking",
      "start": "2026-10-19T12:40:00Z",
      "end": "2026-10-19T13:10:00Z",
      "durationSec": 1800,
      "distanceKm": 1.92,
      "avgHr": 131,
      "maxHr": 149,
      "activeCalories": 214,
      "source": "Apple Watch",
      "device": "Apple Watch Series 9"
    }
  ]
}
```

The server is idempotent on HealthKit UUIDs, de-duplicates overlapping step
samples across iPhone and Watch, and links indoor-walking workouts to a logged
treadmill session that overlaps in time.

## What HealthKit cannot provide

- Treadmill belt speed
- Treadmill incline
- Who was physically on the machine

Those stay manual or come from a supported treadmill integration, and the UI
labels them accordingly. A console photo can corroborate the numbers shown on
the display, but never proves identity or completion.

## Security

- The sync endpoint accepts a hashed, revocable device token via
  `Authorization: Bearer …`.
- Use HTTPS. On a home server, use Tailscale, a Cloudflare Tunnel with an access
  policy, or a VPN. Do not expose the API directly to the public internet.
- Tokens are shown once and stored as SHA-256 hashes.
