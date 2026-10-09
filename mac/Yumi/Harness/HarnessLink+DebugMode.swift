import Foundation
import Observation
import OSLog
import struct YumiProtocol.Empty
import struct YumiProtocol.SetDebugModeParams

/// Debug mode (SPEC-07 r22 and r23, OBJ-53): the setting turns the harness's detailed log, its
/// `workerThought` events, and the model's reasons on and off together, and makes the cats and
/// helper chips expandable on the overlay.
extension HarnessLink {
    /// Applies the setting now and whenever it changes.
    func startDebugMode() {
        let enabled = model.settings.debugMode
        overlay.setDebugMode(enabled)
        withObservationTracking {
            _ = model.settings.debugMode
        } onChange: { [weak self] in
            // Called before the change lands: apply it on the next turn.
            Task { @MainActor in
                guard let self else { return }
                self.startDebugMode()
                self.sendDebugMode()
            }
        }
    }

    /// Tells the harness. Sent after every hello and on every change; until the first one, the
    /// harness uses its own default. A failure is only logged: the next connection sends it again.
    func sendDebugMode() {
        guard client.linkState == .connected else { return }
        let enabled = model.settings.debugMode
        Task {
            do {
                _ = try await client.call(.setDebugMode, SetDebugModeParams(enabled: enabled), returning: Empty.self)
                debugModeLog.notice("Debug mode \(enabled ? "on" : "off", privacy: .public) sent to the harness")
            } catch {
                debugModeLog.error("Could not send Debug mode to the harness: \(String(describing: error), privacy: .public)")
            }
        }
    }
}

private let debugModeLog = Logger(subsystem: "ph.appbuilders.yumi", category: "harness")
