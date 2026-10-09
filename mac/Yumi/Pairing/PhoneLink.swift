import Foundation
import Observation

/// The phone as the Mac app sees it (OBJ-27.5 and 27.6, SPEC-08): the bridge connection state,
/// the paired phone, and an open pairing code. The harness owns pairing and the bridge (OBJ-21);
/// this only shows them and asks the harness to act.
///
/// Plain values only: an `@Observable` file cannot import the protocol module whole, because its
/// `Observation` type shadows Apple's. `PhoneCalls` talks to the harness with the protocol types.
@MainActor
@Observable
final class PhoneLink {
    static let shared = PhoneLink()

    enum Connection: String, Equatable, Sendable {
        case connected, reconnecting, offline
    }

    struct Device: Equatable, Identifiable, Sendable {
        let id: String
        let name: String
    }

    struct PairingCode: Equatable, Sendable {
        let payload: String
        let expiresAt: Date
    }

    /// Nil until the harness reports the bridge state.
    private(set) var connection: Connection?
    private(set) var devices: [Device] = []
    /// The code the pairing window shows. Nil when no pairing is in progress.
    private(set) var pairingCode: PairingCode?
    private(set) var isStartingPairing = false

    @ObservationIgnored var calls: PhoneCalls?

    var pairedDevice: Device? { devices.first }

    func update(connection: Connection) {
        self.connection = connection
        refreshDevices()
    }

    func refreshDevices() {
        guard let calls else { return }
        Task {
            if let devices = await calls.pairedDevices() {
                self.devices = devices
                if !devices.isEmpty { pairingCode = nil }
            }
        }
    }

    func startPairing() {
        guard let calls, !isStartingPairing else { return }
        isStartingPairing = true
        Task {
            pairingCode = await calls.startPairing()
            isStartingPairing = false
        }
    }

    func cancelPairing() {
        pairingCode = nil
    }

    func unpair(_ device: Device) {
        guard let calls else { return }
        Task {
            if await calls.unpair(device.id) { refreshDevices() }
        }
    }
}
