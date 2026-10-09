import Foundation
import OSLog
import YumiProtocol

/// Turns a `UserError` from the harness into the generated type, never failing.
///
/// A kind this app does not know yet (a newer harness) or a malformed error becomes `unexpected`,
/// so the user sees the SPEC-11 "Unexpected" copy instead of nothing. The fields that fill the copy
/// are kept when they are present. Details go to the log.
enum UserErrorDecoding {
    private static let log = Logger(subsystem: "ph.appbuilders.yumi", category: "harness")

    static func decode(_ data: Data?) -> UserError {
        guard let data else {
            log.error("An error from the harness had no UserError data")
            return UserError(kind: .unexpected)
        }
        if let error = try? JSONDecoder().decode(UserError.self, from: data) {
            return error
        }
        let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        let kind = object?["kind"] as? String ?? "(none)"
        log.error("The harness sent an error this app cannot read (kind \(kind, privacy: .public)); showing Unexpected")
        return UserError(
            kind: .unexpected,
            taskId: object?["taskId"] as? String,
            lastAction: object?["lastAction"] as? String
        )
    }
}
