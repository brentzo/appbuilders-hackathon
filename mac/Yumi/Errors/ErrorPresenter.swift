import Foundation
import OSLog
import YumiProtocol

/// A user error ready to show: SPEC-11 copy with its placeholders filled, and its buttons.
struct PresentedError: Equatable, Sendable {
    let kind: ErrorKind
    let message: String
    /// Extra plain-language text from the harness, such as what was finished so far.
    let detail: String?
    let buttons: [ErrorButton]
}

struct ErrorButton: Equatable, Sendable {
    let label: String
    let action: ErrorButtonAction
}

enum ErrorButtonAction: Equatable, Sendable {
    case openSettings(Permission)
    /// Closes the error and changes nothing ("Not now", "Okay", "Wait").
    case dismiss
    case cancelTask(String)
    /// The feature behind this button is built in a later objective. Shown disabled.
    case notAvailableYet
}

/// The one place that turns a structured `UserError` into what the user sees (SPEC-11).
///
/// It never sees raw error text: callers hand it a `UserError` (kind plus the fields that fill
/// the copy), and the JSON-RPC message, status codes and exception text stay in the log.
enum ErrorPresenter {
    /// SPEC-11 requirement 8: on the Mac, the other device is the phone.
    static let otherDevice = "your phone"

    private static let log = Logger(subsystem: "ph.appbuilders.yumi", category: "errors")

    static func present(_ error: UserError) -> PresentedError {
        let copy = UserErrorCopy.copy(for: error.kind)
        return PresentedError(
            kind: error.kind,
            message: fill(copy.message, lastAction: error.lastAction),
            detail: error.kind == .taskTookTooLong ? error.finishedSoFar : nil,
            buttons: copy.buttons.compactMap { button(for: $0, error: error) }
        )
    }

    private static func fill(_ template: String, lastAction: String?) -> String {
        var text = template
        if text.hasPrefix("{device}") {
            text = otherDevice.prefix(1).uppercased() + otherDevice.dropFirst() + text.dropFirst("{device}".count)
        }
        text = text.replacingOccurrences(of: "{device}", with: otherDevice)
        if text.contains("{last action}") {
            if let lastAction, !lastAction.isEmpty {
                text = text.replacingOccurrences(of: "{last action}", with: lastAction)
            } else {
                // SPEC-11 has no copy for an unknown last action. Keep the first sentence rather
                // than show a placeholder or claim that nothing happened. Raised with Patrick.
                log.error("An Unexpected error arrived without lastAction")
                text = String(text[..<text.range(of: ". ")!.lowerBound]) + "."
            }
        }
        return text
    }

    private static func button(for label: String, error: UserError) -> ErrorButton? {
        let action: ErrorButtonAction
        switch label {
        case "Depends on the request":
            // Placeholder in SPEC-11 for request-specific alternatives; there are none to offer yet.
            return nil
        case "Open settings":
            action = permission(for: error.kind).map(ErrorButtonAction.openSettings) ?? .notAvailableYet
        case "Not now", "Okay", "Wait":
            action = .dismiss
        case "Cancel":
            action = error.taskId.map(ErrorButtonAction.cancelTask) ?? .dismiss
        default:
            action = .notAvailableYet
        }
        return ErrorButton(label: label, action: action)
    }

    private static func permission(for kind: ErrorKind) -> Permission? {
        Permission.allCases.first { $0.missingErrorKind == kind }
    }
}
