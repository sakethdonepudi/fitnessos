import SwiftUI
import Foundation
import HealthKit
import UIKit
import Security

/*
 Fitness OS — iPhone HealthKit companion (automatic sync).

 Build: create an iOS App (SwiftUI, iOS 17+) in Xcode, replace ContentView.swift
 with this file, add the HealthKit capability and the background-delivery
 entitlement, and run on a physical iPhone.

 The app keeps HealthKit anchors, a persisted upload queue and a revocable device
 token. It posts incremental samples to the Fitness OS Cloudflare Worker.

 iOS does not guarantee immediate background delivery. "Sync delayed" is a
 normal state; opening the app or the next HealthKit wake-up will flush it.
*/

@main
struct HealthBridgeApp: App {
    var body: some Scene {
        WindowGroup { ContentView() }
    }
}

// MARK: - Keychain

enum Keychain {
    static func set(_ value: String, for key: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.fitnessos.healthbridge",
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    static func get(_ key: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.fitnessos.healthbridge",
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(_ key: String) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "com.fitnessos.healthbridge",
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
    }
}

// MARK: - Payload models

struct StepSample: Codable {
    let id: String
    let start: String
    let end: String
    let steps: Int
    let source: String
    let device: String?
}

struct HeartRateSample: Codable {
    let id: String
    let start: String
    let bpm: Double
    let source: String
    let device: String?
}

struct WorkoutRecord: Codable {
    let id: String
    let type: String
    let start: String
    let end: String
    let durationSec: Double
    let distanceKm: Double?
    let avgHr: Double?
    let maxHr: Double?
    let activeCalories: Double?
    let source: String
    let device: String?
}

struct HealthPayload: Codable {
    let version: Int
    let source: String
    let syncedAt: String
    let samples: [StepSample]
    let workouts: [WorkoutRecord]
    let heartRateSamples: [HeartRateSample]
    let deletedSampleIds: [String]
    let deletedWorkoutIds: [String]
    let deletedHeartRateIds: [String]
    let deviceName: String

    var isEmpty: Bool {
        samples.isEmpty && workouts.isEmpty && heartRateSamples.isEmpty &&
        deletedSampleIds.isEmpty && deletedWorkoutIds.isEmpty && deletedHeartRateIds.isEmpty
    }
}

struct QueueItem: Codable, Identifiable {
    let id: String
    let createdAt: String
    let payload: HealthPayload
}

// MARK: - Persisted queue

final class UploadQueue {
    static let shared = UploadQueue()
    private let fileURL: URL
    private(set) var items: [QueueItem] = []

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("fitnessos-upload-queue.json")
        load()
    }

    private func load() {
        guard let data = try? Data(contentsOf: fileURL),
              let decoded = try? JSONDecoder().decode([QueueItem].self, from: data) else { return }
        items = decoded
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(items) {
            try? data.write(to: fileURL, options: .atomic)
        }
    }

    func append(_ payload: HealthPayload) {
        guard !payload.isEmpty else { return }
        items.append(QueueItem(id: UUID().uuidString, createdAt: ISO8601DateFormatter().string(from: Date()), payload: payload))
        persist()
    }

    func remove(_ id: String) {
        items.removeAll { $0.id == id }
        persist()
    }

    var count: Int { items.count }
}

// MARK: - Manager

@MainActor
final class HealthSyncManager: ObservableObject {
    private let store = HKHealthStore()
    private let defaults = UserDefaults.standard
    private var observers: [HKObserverQuery] = []
    private var syncing = false
    private var rerunRequested = false

    @Published var status: String = "Not connected"
    @Published var lastSync: Date?
    @Published var pending: Int = 0
    @Published var permissionGranted = false
    @Published var lastObserverEvent: Date?
    @Published var errorText: String?

    var tokenStored: Bool { !token.isEmpty }

    private var apiBase: String {
        let stored = UserDefaults.standard.string(forKey: "fos.apiUrl") ?? ""
        return stored.isEmpty ? "https://fitnessos-api.paralaxicmusic.workers.dev" : stored
    }
    private var token: String { Keychain.get("deviceToken") ?? "" }

    private var readTypes: Set<HKObjectType> {
        [
            HKObjectType.quantityType(forIdentifier: .stepCount)!,
            HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)!,
            HKObjectType.quantityType(forIdentifier: .heartRate)!,
            HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!,
            HKObjectType.workoutType(),
        ]
    }

    init() {
        if let raw = defaults.string(forKey: "fos.lastSync"), let date = ISO8601DateFormatter().date(from: raw) {
            lastSync = date
        }
        pending = UploadQueue.shared.count
        refreshStatus()
    }

    func configure(apiUrl: String, deviceToken: String) {
        UserDefaults.standard.set(apiUrl.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "fos.apiUrl")
        Keychain.set(deviceToken.trimmingCharacters(in: .whitespacesAndNewlines), forKey: "deviceToken")
        refreshStatus()
    }

    func refreshStatus() {
        if apiBase.isEmpty || token.isEmpty {
            status = "Connection required"
        } else if !permissionGranted {
            status = "Permission required"
        } else if let last = lastSync, Date().timeIntervalSince(last) < 3 * 3600 {
            status = "Connected"
        } else if lastSync != nil {
            status = "Sync delayed"
        } else {
            status = "Connected — waiting for first sync"
        }
        pending = UploadQueue.shared.count
    }

    func requestAuthorization() async {
        guard HKHealthStore.isHealthDataAvailable() else {
            status = "HealthKit unavailable"
            return
        }
        do {
            try await store.requestAuthorization(toShare: [], read: readTypes)
            permissionGranted = store.authorizationStatus(for: HKObjectType.quantityType(forIdentifier: .stepCount)!) == .sharingAuthorized
                || store.authorizationStatus(for: HKObjectType.quantityType(forIdentifier: .stepCount)!) == .sharingDenied
            // HealthKit does not reveal read authorization; a successful query is the real proof.
            permissionGranted = true
            refreshStatus()
            startObservers()
            await sync(reason: "authorization")
        } catch {
            status = "Permission error"
            errorText = error.localizedDescription
        }
    }

    func startObservers() {
        guard observers.isEmpty else { return }
        let types: [(HKSampleType, HKUpdateFrequency)] = [
            (HKObjectType.quantityType(forIdentifier: .stepCount)!, .immediate),
            (HKObjectType.quantityType(forIdentifier: .distanceWalkingRunning)!, .hourly),
            (HKObjectType.quantityType(forIdentifier: .heartRate)!, .hourly),
            (HKObjectType.quantityType(forIdentifier: .activeEnergyBurned)!, .hourly),
            (HKObjectType.workoutType(), .immediate),
        ]
        for (type, frequency) in types {
            let query = HKObserverQuery(sampleType: type, predicate: nil) { [weak self] _, completion, _ in
                Task { @MainActor in
                    self?.lastObserverEvent = Date()
                    self?.refreshStatus()
                    await self?.sync(reason: "observer")
                    completion()
                }
            }
            store.execute(query)
            observers.append(query)
            store.enableBackgroundDelivery(for: type, frequency: frequency) { success, error in
                if !success {
                    Task { @MainActor in self.errorText = "Background delivery: \(error?.localizedDescription ?? "unavailable")" }
                }
            }
        }
    }

    func testConnection() async -> String {
        guard let url = URL(string: apiBase + "/api/healthz") else { return "Invalid Worker URL" }
        do {
            let (_, response) = try await URLSession.shared.data(from: url)
            guard let http = response as? HTTPURLResponse else { return "Invalid response" }
            return http.statusCode == 200 ? "Worker reachable (HTTP 200)" : "Worker returned HTTP \(http.statusCode)"
        } catch {
            return "Connection failed: \(error.localizedDescription)"
        }
    }

    func resetAnchors() {
        for key in ["anchor.steps", "anchor.distance", "anchor.heartRate", "anchor.activeEnergy", "anchor.workouts"] {
            defaults.removeObject(forKey: key)
        }
        lastSync = nil
        defaults.removeObject(forKey: "fos.lastSync")
        status = "Anchors reset — run Sync now"
        errorText = nil
    }

    func sync(reason: String = "manual") async {
        if syncing {
            rerunRequested = true
            return
        }
        guard !apiBase.isEmpty, !token.isEmpty else {
            status = "Connection required"
            return
        }
        syncing = true
        defer {
            syncing = false
            if rerunRequested {
                rerunRequested = false
                Task { await self.sync(reason: "queued") }
            }
        }
        status = "Syncing…"
        errorText = nil

        var samples: [StepSample] = []
        var heartRates: [HeartRateSample] = []
        var deletedSampleIds: [String] = []
        var deletedHeartRateIds: [String] = []
        var workouts: [WorkoutRecord] = []
        var deletedWorkoutIds: [String] = []

        do {
            let stepData = try await fetchQuantity(type: .stepCount, unit: .count(), key: "anchor.steps")
            for item in stepData.added {
                guard let sample = item as? HKQuantitySample else { continue }
                samples.append(StepSample(
                    id: sample.uuid.uuidString,
                    start: iso(sample.startDate),
                    end: iso(sample.endDate),
                    steps: Int(sample.quantity.doubleValue(for: .count()).rounded()),
                    source: sample.sourceRevision.source.name,
                    device: sample.device?.name
                ))
            }
            deletedSampleIds = stepData.deleted

            let hrData = try await fetchQuantity(type: .heartRate, unit: HKUnit.count().unitDivided(by: .minute()), key: "anchor.heartRate")
            for item in hrData.added {
                guard let sample = item as? HKQuantitySample else { continue }
                heartRates.append(HeartRateSample(
                    id: sample.uuid.uuidString,
                    start: iso(sample.startDate),
                    bpm: sample.quantity.doubleValue(for: HKUnit.count().unitDivided(by: .minute())),
                    source: sample.sourceRevision.source.name,
                    device: sample.device?.name
                ))
            }
            deletedHeartRateIds = hrData.deleted

            let workoutData = try await fetchWorkouts()
            workouts = workoutData.added
            deletedWorkoutIds = workoutData.deleted
        } catch {
            status = "Sync error"
            errorText = error.localizedDescription
            refreshStatus()
            return
        }

        let payload = HealthPayload(
            version: 1,
            source: UIDevice.current.name,
            syncedAt: iso(Date()),
            samples: samples,
            workouts: workouts,
            heartRateSamples: heartRates,
            deletedSampleIds: deletedSampleIds,
            deletedWorkoutIds: deletedWorkoutIds,
            deletedHeartRateIds: deletedHeartRateIds,
            deviceName: UIDevice.current.name
        )
        if !payload.isEmpty {
            UploadQueue.shared.append(payload)
        }
        await flushQueue()
        refreshStatus()
        if reason == "manual" && errorText == nil {
            status = "Synced"
        }
    }

    private func flushQueue() async {
        var remaining = UploadQueue.shared.items
        while let item = remaining.first {
            do {
                try await post(item.payload)
                UploadQueue.shared.remove(item.id)
                remaining.removeFirst()
                lastSync = Date()
                defaults.set(iso(lastSync!), forKey: "fos.lastSync")
                pending = UploadQueue.shared.count
            } catch {
                errorText = error.localizedDescription
                pending = UploadQueue.shared.count
                // Keep the item for the next launch/observer. Do not advance past it.
                break
            }
        }
    }

    private func post(_ payload: HealthPayload) async throws {
        guard let url = URL(string: apiBase + "/api/health/sync") else {
            throw SyncError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 30
        request.httpBody = try JSONEncoder().encode(payload)
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SyncError.badResponse }
        guard (200..<300).contains(http.statusCode) else {
            let body = String(data: data, encoding: .utf8) ?? ""
            throw SyncError.server(http.statusCode, body)
        }
    }

    // MARK: Anchored queries

    private struct QuantityResult {
        let added: [HKSample]
        let deleted: [String]
    }

    private func fetchQuantity(type identifier: HKQuantityTypeIdentifier, unit: HKUnit, key: String) async throws -> QuantityResult {
        guard let type = HKQuantityType.quantityType(forIdentifier: identifier) else {
            return QuantityResult(added: [], deleted: [])
        }
        let anchorData = defaults.data(forKey: key)
        let anchor = anchorData.flatMap { try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: $0) }
        let start = lastSync ?? Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        let predicate = HKQuery.predicateForSamples(withStart: start, end: nil, options: .strictStartDate)

        return try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(type: type, predicate: predicate, anchor: anchor, limit: HKObjectQueryNoLimit) { _, samples, deleted, newAnchor, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                if let newAnchor, let data = try? NSKeyedArchiver.archivedData(withRootObject: newAnchor, requiringSecureCoding: true) {
                    Task { @MainActor in self.defaults.set(data, forKey: key) }
                }
                let deletedIds = (deleted ?? []).map { $0.uuid.uuidString }
                continuation.resume(returning: QuantityResult(added: samples ?? [], deleted: deletedIds))
            }
            store.execute(query)
        }
    }

    private struct WorkoutResult {
        let added: [WorkoutRecord]
        let deleted: [String]
    }

    private func fetchWorkouts() async throws -> WorkoutResult {
        let anchorData = defaults.data(forKey: "anchor.workouts")
        let anchor = anchorData.flatMap { try? NSKeyedUnarchiver.unarchivedObject(ofClass: HKQueryAnchor.self, from: $0) }
        let start = lastSync ?? Calendar.current.date(byAdding: .day, value: -7, to: Date()) ?? Date()
        let predicate = HKQuery.predicateForSamples(withStart: start, end: nil, options: .strictStartDate)

        let result: ([HKWorkout], [String], HKQueryAnchor?) = try await withCheckedThrowingContinuation { continuation in
            let query = HKAnchoredObjectQuery(type: .workoutType(), predicate: predicate, anchor: anchor, limit: HKObjectQueryNoLimit) { _, samples, deleted, newAnchor, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }
                let workouts = (samples ?? []).compactMap { $0 as? HKWorkout }
                let deletedIds = (deleted ?? []).map { $0.uuid.uuidString }
                continuation.resume(returning: (workouts, deletedIds, newAnchor))
            }
            store.execute(query)
        }

        if let anchor = result.2, let data = try? NSKeyedArchiver.archivedData(withRootObject: anchor, requiringSecureCoding: true) {
            defaults.set(data, forKey: "anchor.workouts")
        }

        var records: [WorkoutRecord] = []
        for workout in result.0 {
            var dict = WorkoutRecord(
                id: workout.uuid.uuidString,
                type: workoutType(workout),
                start: iso(workout.startDate),
                end: iso(workout.endDate),
                durationSec: workout.duration,
                distanceKm: workout.totalDistance?.doubleValue(for: .kilometer()),
                avgHr: nil,
                maxHr: nil,
                activeCalories: workout.totalEnergyBurned?.doubleValue(for: .kilocalorie()),
                source: workout.sourceRevision.source.name,
                device: workout.device?.name
            )
            let hr = await heartRateStats(for: workout)
            dict = WorkoutRecord(
                id: dict.id, type: dict.type, start: dict.start, end: dict.end,
                durationSec: dict.durationSec, distanceKm: dict.distanceKm,
                avgHr: hr.avg, maxHr: hr.max, activeCalories: dict.activeCalories,
                source: dict.source, device: dict.device
            )
            records.append(dict)
        }
        return WorkoutResult(added: records, deleted: result.1)
    }

    private func workoutType(_ workout: HKWorkout) -> String {
        let indoor = (workout.metadata?[HKMetadataKeyIndoorWorkout] as? NSNumber)?.boolValue ?? false
        switch workout.workoutActivityType {
        case .walking: return indoor ? "indoor_walk" : "walking"
        case .running: return indoor ? "indoor_run" : "running"
        case .traditionalStrengthTraining, .functionalStrengthTraining: return "traditional_strength_training"
        case .highIntensityIntervalTraining: return "hiit"
        case .cycling: return "cycling"
        case .yoga: return "yoga"
        default: return "other"
        }
    }

    private func heartRateStats(for workout: HKWorkout) async -> (avg: Double?, max: Double?) {
        guard let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return (nil, nil) }
        let predicate = HKQuery.predicateForSamples(withStart: workout.startDate, end: workout.endDate, options: .strictStartDate)
        return await withCheckedContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: [.discreteAverage, .discreteMax]) { _, stats, _ in
                let unit = HKUnit.count().unitDivided(by: .minute())
                continuation.resume(returning: (
                    stats?.averageQuantity()?.doubleValue(for: unit),
                    stats?.maximumQuantity()?.doubleValue(for: unit)
                ))
            }
            store.execute(query)
        }
    }

    private func iso(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }
}

enum SyncError: LocalizedError {
    case invalidURL
    case badResponse
    case server(Int, String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid Worker URL"
        case .badResponse: return "Invalid server response"
        case .server(let code, let body): return "Server \(code): \(body.prefix(180))"
        }
    }
}

// MARK: - UI

@MainActor
struct ContentView: View {
    @StateObject private var manager = HealthSyncManager()
    @AppStorage("fos.apiUrl") private var apiUrl = "https://fitnessos-api.paralaxicmusic.workers.dev"
    @State private var token = ""
    @State private var connectionTest = ""
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            Form {
                Section("Fitness OS connection") {
                    TextField("https://fitnessos-api.…workers.dev", text: $apiUrl)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                    SecureField("Device token (fos_…)", text: $token)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    HStack {
                        Button("Save connection") {
                            manager.configure(apiUrl: apiUrl, deviceToken: token)
                        }
                        .disabled(apiUrl.isEmpty || token.isEmpty)
                        Button("Test connection") {
                            Task {
                                connectionTest = await manager.testConnection()
                            }
                        }
                        .disabled(apiUrl.isEmpty)
                    }
                    if !connectionTest.isEmpty {
                        Text(connectionTest).font(.caption).foregroundStyle(.secondary)
                    }
                }

                Section("Apple Health") {
                    Button("Grant Health access") {
                        Task { await manager.requestAuthorization() }
                    }
                    Button("Sync now") {
                        Task { await manager.sync(reason: "manual") }
                    }
                    .disabled(apiUrl.isEmpty || token.isEmpty)
                    Button("Enable background observers") {
                        manager.startObservers()
                    }
                    Button("Reset HealthKit anchors (full resync)") {
                        manager.resetAnchors()
                    }
                }

                Section("Status") {
                    LabeledContent("Status", value: manager.status)
                    LabeledContent("Last sync", value: manager.lastSync?.formatted(date: .abbreviated, time: .shortened) ?? "Never")
                    LabeledContent("Queued uploads", value: "\(manager.pending)")
                    LabeledContent("Last HealthKit wake", value: manager.lastObserverEvent?.formatted(date: .omitted, time: .shortened) ?? "—")
                    LabeledContent("Device token", value: manager.tokenStored ? "Stored in Keychain" : "Missing")
                    LabeledContent("Worker URL", value: apiUrl.isEmpty ? "Missing" : apiUrl)
                    if let error = manager.errorText {
                        Text(error).font(.caption).foregroundStyle(.red)
                    }
                }

                Section {
                    Text("iOS does not guarantee real-time HealthKit background uploads. If a sync is delayed, the queue is kept and retried on the next wake-up or when you open the app. Treadmill incline and belt speed are not available from HealthKit — log them in Fitness OS.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Fitness OS Bridge")
            .task {
                token = Keychain.get("deviceToken") ?? ""
                manager.refreshStatus()
                if !apiUrl.isEmpty && !token.isEmpty {
                    manager.startObservers()
                    await manager.sync(reason: "launch")
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active {
                    Task { await manager.sync(reason: "foreground") }
                }
            }
        }
    }
}
