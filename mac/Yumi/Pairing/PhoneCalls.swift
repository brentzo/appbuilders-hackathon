import Foundation
import OSLog
import YumiProtocol

/// The harness calls behind `PhoneLink`: `startPairing`, `listPairedDevices`, and `unpair`.
/// A failed call goes to `report`, which shows it with the SPEC-11 error presenter; the caller
/// gets nil or false.
@MainActor
final class PhoneCalls {
    private let client: HarnessClient
    private let report: (Error, String) -> Void

    init(client: HarnessClient, report: @escaping (Error, String) -> Void) {
        self.client = client
        self.report = report
    }

    func startPairing() async -> PhoneLink.PairingCode? {
        do {
            let result = try await client.call(.startPairing, Empty(), returning: StartPairingResult.self)
            let expiry = ISO8601DateFormatter.flexible(result.expiresAt) ?? Date().addingTimeInterval(5 * 60)
            return PhoneLink.PairingCode(payload: result.qrPayload, expiresAt: expiry)
        } catch {
            report(error, "startPairing")
            return nil
        }
    }

    /// Nil when the list could not be read; the old list stays on screen.
    func pairedDevices() async -> [PhoneLink.Device]? {
        do {
            let list = try await client.call(.listPairedDevices, Empty(), returning: PairedDeviceList.self)
            return list.devices.map { PhoneLink.Device(id: $0.deviceId, name: $0.name) }
        } catch HarnessCallError.notConnected {
            return nil
        } catch {
            Logger(subsystem: "ph.appbuilders.yumi", category: "pairing")
                .error("listPairedDevices failed: \(String(describing: error), privacy: .public)")
            return nil
        }
    }

    func unpair(_ deviceId: String) async -> Bool {
        do {
            _ = try await client.call(.unpair, UnpairParams(deviceId: deviceId), returning: Empty.self)
            return true
        } catch {
            report(error, "unpair")
            return false
        }
    }
}

extension ISO8601DateFormatter {
    /// Parses a protocol timestamp with or without fractional seconds.
    static func flexible(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: text)
    }
}

extension PhoneLink.Connection {
    init(_ state: BridgeState) {
        switch state {
        case .connected: self = .connected
        case .reconnecting: self = .reconnecting
        case .offline: self = .offline
        }
    }
}
