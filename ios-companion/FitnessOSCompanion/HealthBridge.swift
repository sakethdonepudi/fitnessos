import SwiftUI
import Foundation
import CryptoKit
import os
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

    /// Stable identity for queue deduplication. Excludes syncedAt so pressing
    /// Sync Now twice cannot duplicate the same HealthKit batch.
    var fingerprint: String {
        let ids = (
            samples.map(\.id) +
            workouts.map(\.id) +
            heartRateSamples.map(\.id) +
            deletedSampleIds +
            deletedWorkoutIds +
            deletedHeartRateIds
        ).sorted().joined(separator: "|")
        let digest = SHA256.hash(data: Data(ids.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
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
    static let chunkSize = 30

    private let fileURL: URL
    private(set) var items: [QueueItem] = []

    private init() {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        fileURL = dir.appendingPathComponent("fitnessos-upload-queue.json")
        load()
        rechunkExisting()
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

    /// Splits a large HealthKit payload into small batches. This keeps every
    /// Worker invocation inside the free plan's D1 query budget and lets old
    /// queued payloads drain after the app update.
    func split(_ payload: HealthPayload) -> [HealthPayload] {
        guard !payload.isEmpty else { return [] }
        let total = max(
            payload.samples.count,
            payload.workouts.count,
            payload.heartRateSamples.count,
            payload.deletedSampleIds.count,
            payload.deletedWorkoutIds.count,
            payload.deletedHeartRateIds.count
        )
        let chunkCount = max(1, Int(ceil(Double(total) / Double(Self.chunkSize))))
        var chunks: [HealthPayload] = []
        for index in 0..<chunkCount {
            let lower = index * Self.chunkSize
            let chunk = HealthPayload(
                version: payload.version,
                source: payload.source,
                syncedAt: payload.syncedAt,
                samples: slice(payload.samples, from: lower),
                workouts: slice(payload.workouts, from: lower),
                heartRateSamples: slice(payload.heartRateSamples, from: lower),
                deletedSampleIds: slice(payload.deletedSampleIds, from: lower),
                deletedWorkoutIds: slice(payload.deletedWorkoutIds, from: lower),
                deletedHeartRateIds: slice(payload.deletedHeartRateIds, from: lower),
                deviceName: payload.deviceName
            )
            if !chunk.isEmpty { chunks.append(chunk) }
        }
        return chunks
    }

    private func slice<T>(_ values: [T], from lower: Int) -> [T] {
        guard lower < values.count else { return [] }
        return Array(values[lower..<min(lower + Self.chunkSize, values.count)])
    }

    func append(_ payload: HealthPayload) {
        for chunk in split(payload) {
            guard !items.contains(where: { $0.payload.fingerprint == chunk.fingerprint }) else { continue }
            items.append(QueueItem(
                id: UUID().uuidString,
                createdAt: ISO8601DateFormatter().string(from: Date()),
                payload: chunk
            ))
        }
        persist()
    }

    /// Rechunks any large batches queued by an older build without discarding
    /// their data. Duplicate fingerprints are collapsed.
    func rechunkExisting() {
        guard !items.isEmpty else { return }
        var rebuilt: [QueueItem] = []
        for item in items {
            for chunk in split(item.payload) {
                guard !rebuilt.contains(where: { $0.payload.fingerprint == chunk.fingerprint }) else { continue }
                rebuilt.append(QueueItem(
                    id: UUID().uuidString,
                    createdAt: item.createdAt,
                    payload: chunk
                ))
            }
        }
        items = rebuilt
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
    private let log = Logger(subsystem: "com.sakethdonepudi.fitnessos.bridge", category: "sync")
    private var observers: [HKObserverQuery] = []
    private var syncing = false
    private var rerunRequested = false
    private var retryFailures = 0
    private var nextRetryAt: Date?

    @Published var status: String = "Not connected"
    @Published var lastSync: Date?
    @Published var pending: Int = 0
    @Published var permissionGranted = false
    @Published var lastObserverEvent: Date?
    @Published var errorText: String?
    @Published var lastRequest: String?
    @Published var lastHTTPStatus: Int?
    @Published var lastErrorCategory: String?

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
        Keychain.set(deviceToken.trimmingCharacters(in: .whitespacesAndNewlines), for: "deviceToken")
        refreshStatus()
    }

    func refreshStatus() {
        pending = UploadQueue.shared.count
        if apiBase.isEmpty || token.isEmpty {
            status = "Connection required"
        } else if errorText != nil && pending > 0 {
            status = "Sync error"
        } else if !permissionGranted {
            status = "Permission required"
        } else if let last = lastSync, Date().timeIntervalSince(last) < 3 * 3600 {
            status = "Connected"
        } else if lastSync != nil {
            status = "Sync delayed"
        } else {
            status = "Connected — waiting for first sync"
        }
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

    struct AuthCheck: Decodable {
        let ok: Bool
        let kind: String
        let deviceName: String?
    }

    func testConnection() async -> String {
        guard !token.isEmpty else { return "Enter a device token first." }
        guard let url = URL(string: apiBase + "/api/health/auth") else { return "Invalid Worker URL" }
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        lastRequest = "GET /api/health/auth"
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { return "Invalid response" }
            lastHTTPStatus = http.statusCode
            if http.statusCode == 401 {
                lastErrorCategory = "auth"
                log.warning("auth check rejected status=401")
                return "Device token rejected (401). Create a new device token in Fitness OS and save it."
            }
            guard (200..<300).contains(http.statusCode) else {
                lastErrorCategory = "http_\(http.statusCode)"
                return "Worker returned HTTP \(http.statusCode)"
            }
            let decoded = try JSONDecoder().decode(AuthCheck.self, from: data)
            lastErrorCategory = nil
            let name = decoded.deviceName.map { " (\($0))" } ?? ""
            lastRequest = "GET /api/health/auth → 200"
            return "Authenticated as \(decoded.kind)\(name)"
        } catch {
            lastErrorCategory = "network"
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

    func sync(reason: String = "manual", force: Bool = false) async {
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
        await flushQueue(force: force || reason == "manual")
        if UploadQueue.shared.count == 0 && errorText == nil {
            lastSync = Date()
            defaults.set(iso(lastSync!), forKey: "fos.lastSync")
        }
        pending = UploadQueue.shared.count
        refreshStatus()
        if reason == "manual" && errorText == nil {
            status = "Synced"
        }
    }

    private func flushQueue(force: Bool = false) async {
        if !force, let nextRetryAt, nextRetryAt > Date() {
            pending = UploadQueue.shared.count
            return
        }
        var remaining = UploadQueue.shared.items
        while let item = remaining.first {
            do {
                try await post(item)
                UploadQueue.shared.remove(item.id)
                remaining.removeFirst()
                lastSync = Date()
                defaults.set(iso(lastSync!), forKey: "fos.lastSync")
                pending = UploadQueue.shared.count
                retryFailures = 0
                nextRetryAt = nil
            } catch {
                retryFailures += 1
                let delay = min(300, 15 * pow(2, Double(retryFailures - 1)))
                nextRetryAt = Date().addingTimeInterval(delay)
                errorText = error.localizedDescription
                pending = UploadQueue.shared.count
                log.error("upload failed item=\(item.id, privacy: .public) category=auth_or_http retryIn=\(delay, privacy: .public)s")
                // Keep this item and every item behind it. Never drop queued data.
                break
            }
        }
    }

    private func post(_ item: QueueItem) async throws {
        let payload = item.payload
        guard let url = URL(string: apiBase + "/api/health/sync") else {
            throw SyncError.invalidURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 45
        request.httpBody = try JSONEncoder().encode(payload)
        lastRequest = "POST /api/health/sync (item \(item.id.prefix(8)))"
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw SyncError.badResponse }
            lastHTTPStatus = http.statusCode
            if (200..<300).contains(http.statusCode) {
                lastErrorCategory = nil
                lastRequest = "POST /api/health/sync → \(http.statusCode) (item \(item.id.prefix(8)))"
                log.info("upload ok item=\(item.id, privacy: .public) status=\(http.statusCode, privacy: .public) samples=\(payload.samples.count, privacy: .public) workouts=\(payload.workouts.count, privacy: .public) hr=\(payload.heartRateSamples.count, privacy: .public)")
                return
            }
            let message = (try? JSONDecoder().decode(ServerError.self, from: data))?.error
                ?? String(data: data, encoding: .utf8)?.prefix(160)
                ?? "No response body"
            if http.statusCode == 401 {
                lastErrorCategory = "auth"
                log.error("upload rejected item=\(item.id, privacy: .public) status=401 category=auth")
                throw SyncError.auth(String(message))
            }
            if http.statusCode == 413 {
                lastErrorCategory = "batch_too_large"
                throw SyncError.batchTooLarge(String(message))
            }
            lastErrorCategory = "http_\(http.statusCode)"
            log.error("upload failed item=\(item.id, privacy: .public) status=\(http.statusCode, privacy: .public) category=http")
            throw SyncError.server(http.statusCode, String(message))
        } catch let error as SyncError {
            throw error
        } catch {
            lastErrorCategory = "network"
            log.error("upload network error item=\(item.id, privacy: .public)")
            throw SyncError.network(error.localizedDescription)
        }
    }

    private struct ServerError: Decodable {
        let error: String
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
                distanceKm: workout.totalDistance?.doubleValue(for: HKUnit.meterUnit(with: .kilo)),
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
    case auth(String)
    case batchTooLarge(String)
    case server(Int, String)
    case network(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid Worker URL"
        case .badResponse: return "Invalid server response"
        case .auth(let message): return "Authentication failed (401): \(message). Create a new device token in Fitness OS and save it."
        case .batchTooLarge(let message): return "Upload batch too large (413): \(message)"
        case .server(let code, let body): return "Server \(code): \(body.prefix(180))"
        case .network(let message): return "Network error: \(message)"
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
                            connectionTest = "Saved to Keychain. Tap Test connection to verify the token."
                        }
                        .disabled(apiUrl.isEmpty || token.isEmpty)
                        Button("Test connection") {
                            manager.configure(apiUrl: apiUrl, deviceToken: token)
                            Task {
                                connectionTest = await manager.testConnection()
                            }
                        }
                        .disabled(apiUrl.isEmpty || token.isEmpty)
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
                        // Save the field first: this fixes the common case where a
                        // newly pasted token was never written to the Keychain.
                        manager.configure(apiUrl: apiUrl, deviceToken: token)
                        Task { await manager.sync(reason: "manual", force: true) }
                    }
                    .disabled(apiUrl.isEmpty || token.isEmpty)
                    Text("Sync Now saves the current Worker URL and token to the Keychain first.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
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
                    if let request = manager.lastRequest {
                        LabeledContent("Last request", value: request)
                    }
                    if let status = manager.lastHTTPStatus {
                        LabeledContent("Last HTTP status", value: "\(status)")
                    }
                    if let category = manager.lastErrorCategory {
                        LabeledContent("Error category", value: category)
                    }
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
                    manager.configure(apiUrl: apiUrl, deviceToken: token)
                    manager.startObservers()
                    await manager.sync(reason: "launch", force: true)
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active && !apiUrl.isEmpty && !token.isEmpty {
                    manager.configure(apiUrl: apiUrl, deviceToken: token)
                    Task { await manager.sync(reason: "foreground", force: true) }
                }
            }
        }
    }
}
