import SwiftUI
import HealthKit
import Foundation

/*
 Fitness OS — minimal iPhone companion.

 Create a new iOS App (SwiftUI, iOS 17+) in Xcode, replace ContentView.swift
 with this file, add HealthKit capability, and paste the Info.plist keys from
 README.md. Enter the server base URL and a device token from
 Fitness OS → Settings → Apple Health.
*/

@main
struct HealthBridgeApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

@MainActor
final class HealthBridge: ObservableObject {
    @Published var status = "Not synced yet"
    @Published var busy = false
    @Published var log: [String] = []

    private let store = HKHealthStore()

    private var readTypes: Set<HKObjectType> {
        [
            HKObjectType.quantityType(forIdentifier: .stepCount)!,
            HKObjectType.quantityType(forIdentifier: .heartRate)!,
            HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!,
            HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)!,
            HKObjectType.workoutType(),
        ]
    }

    func requestAccess() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            status = "HealthKit is unavailable on this device."
            return
        }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            status = "Health access granted. Ready to sync."
        } catch {
            status = "Health access failed: \(error.localizedDescription)"
        }
    }

    func sync(baseURL: String, token: String) async {
        guard let url = URL(string: baseURL.trimmingCharacters(in: .whitespacesAndNewlines) + "/api/health/sync") else {
            status = "Enter a valid base URL."
            return
        }
        guard !token.isEmpty else {
            status = "Paste a device token from Settings."
            return
        }

        busy = true
        defer { busy = false }
        log = []

        let calendar = Calendar.current
        let now = Date()
        let from = calendar.date(byAdding: .day, value: -3, to: now) ?? now.addingTimeInterval(-259_200)

        do {
            async let stepSamples = fetchStepSamples(from: from, to: now)
            async let workouts = fetchWorkouts(from: from, to: now)

            let payload: [String: Any] = [
                "version": 1,
                "source": "iPhone+AppleWatch",
                "syncedAt": ISO8601DateFormatter().string(from: now),
                "stepSamples": try await stepSamples,
                "workouts": try await workouts,
            ]

            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            request.httpBody = try JSONSerialization.data(withJSONObject: payload)

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw SyncError.badResponse }

            if http.statusCode == 200 {
                let body = String(data: data, encoding: .utf8) ?? ""
                status = "Synced at \(Date().formatted(date: .omitted, time: .shortened))"
                log.append(body)
            } else {
                let body = String(data: data, encoding: .utf8) ?? ""
                status = "Server returned \(http.statusCode)"
                log.append(body)
            }
        } catch {
            status = "Sync failed: \(error.localizedDescription)"
        }
    }

    private func fetchStepSamples(from: Date, to: Date) async throws -> [[String: Any]] {
        guard let type = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return [] }

        return try await withCheckedThrowingContinuation { continuation in
            var results: [[String: Any]] = []
            let query = HKSampleQuery(
                sampleType: type,
                predicate: HKQuery.predicateForSamples(withStart: from, end: to, options: .strictStartDate),
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { _, samples, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                for case let sample as HKQuantitySample in samples ?? [] {
                    let steps = sample.quantity.doubleValue(for: HKUnit.count())
                    results.append([
                        "id": sample.uuid.uuidString,
                        "start": ISO8601DateFormatter().string(from: sample.startDate),
                        "end": ISO8601DateFormatter().string(from: sample.endDate),
                        "steps": Int(steps.rounded()),
                        "source": sample.sourceRevision.source.name,
                        "device": sample.device?.name ?? "iPhone",
                    ])
                }
                continuation.resume(returning: results)
            }
            store.execute(query)
        }
    }

    private func fetchWorkouts(from: Date, to: Date) async throws -> [[String: Any]] {
        let predicate = HKQuery.predicateForSamples(withStart: from, end: to, options: .strictStartDate)
        return try await withCheckedThrowingContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: .workoutType(),
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
            ) { [weak self] _, samples, error in
                guard let self else { return }
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                Task {
                    var results: [[String: Any]] = []
                    for case let workout as HKWorkout in samples ?? [] {
                        var dict: [String: Any] = [
                            "id": workout.uuid.uuidString,
                            "type": Self.typeName(workout.workoutActivityType),
                            "start": ISO8601DateFormatter().string(from: workout.startDate),
                            "end": ISO8601DateFormatter().string(from: workout.endDate),
                            "durationSec": workout.duration,
                            "source": workout.sourceRevision.source.name,
                            "device": workout.device?.name ?? "Apple Watch",
                        ]
                        if let distance = workout.totalDistance {
                            dict["distanceKm"] = distance.doubleValue(for: HKUnit.km())
                        }
                        if let energy = workout.totalEnergyBurned {
                            dict["activeCalories"] = energy.doubleValue(for: HKUnit.kilocalorie())
                        }
                        let hr = await self.heartRateStats(for: workout)
                        if let avg = hr.avg { dict["avgHr"] = avg }
                        if let max = hr.max { dict["maxHr"] = max }
                        results.append(dict)
                    }
                    continuation.resume(returning: results)
                }
            }
            store.execute(query)
        }
    }

    private func heartRateStats(for workout: HKWorkout) async -> (avg: Double?, max: Double?) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return (nil, nil) }
        let predicate = HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate, options: .strictStartDate)
        return await withCheckedContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: [.discreteAverage, .discreteMax]
            ) { _, stats, _ in
                let unit = HKUnit.count().unitDivided(by: .minute())
                continuation.resume(returning: (
                    stats?.averageQuantity()?.doubleValue(for: unit),
                    stats?.maximumQuantity()?.doubleValue(for: unit)
                ))
            }
            store.execute(query)
        }
    }

    private static func typeName(_ type: HKWorkoutActivityType) -> String {
        switch type {
        case .walking: return "walking"
        case .running: return "running"
        case .cycling: return "cycling"
        case .traditionalStrengthTraining, .functionalStrengthTraining: return "traditional_strength_training"
        case .highIntensityIntervalTraining: return "hiit"
        case .yoga: return "yoga"
        case .other: return "other"
        default: return "other"
        }
    }
}

private enum SyncError: LocalizedError {
    case badResponse
    var errorDescription: String? { "The server returned an invalid response." }
}

struct ContentView: View {
    @StateObject private var bridge = HealthBridge()
    @AppStorage("fos.baseURL") private var baseURL = ""
    @AppStorage("fos.token") private var token = ""

    var body: some View {
        NavigationStack {
            Form {
                Section("Server") {
                    TextField("https://fitness.example.com", text: $baseURL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    SecureField("Device token", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                Section("Apple Health") {
                    Button("Grant Health access") {
                        Task { await bridge.requestAccess() }
                    }
                    Button("Sync now") {
                        Task { await bridge.sync(baseURL: baseURL, token: token) }
                    }
                    .disabled(bridge.busy || baseURL.isEmpty || token.isEmpty)
                }

                Section("Status") {
                    Text(bridge.status).font(.footnote)
                    ForEach(bridge.log, id: \.self) { line in
                        Text(line)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                    }
                }

                Section {
                    Text("Incline and belt speed are not exposed by HealthKit. Log those in Fitness OS or use a supported treadmill integration. Active calories are estimates reported by Apple Health.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Fitness OS Bridge")
        }
    }
}
