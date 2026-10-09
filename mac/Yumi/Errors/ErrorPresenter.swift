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
    /// "Keep going": the task continues (OBJ-40.5).
    case resumeTask(String)
    /// Opens the pairing window ("Pair now").
    case pairPhone
    /// Opens the box for typing a goal ("Type instead").
    case typeGoal
    /// Loads Yumi's voice again ("Try again" on "Voice didn't load (Mac)", OBJ-51).
    case reloadVoice
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
        if error.kind == .androidPermissionMissing, error.permission?.isEmpty ?? true {
            // The copy cannot name the permission, and a raw placeholder must never show.
            log.error("androidPermissionMissing arrived without a permission name; showing Unexpected")
            return present(UserError(kind: .unexpected, taskId: error.taskId))
        }
        var copy = UserErrorCopy.copy(for: error.kind)
        if error.kind == .unexpected, error.lastAction?.isEmpty ?? true {
            copy = UserErrorCopy.unexpectedBeforeAnyAction
        }
        return PresentedError(
            kind: error.kind,
            message: fill(copy.message, lastAction: error.lastAction, permission: error.permission, step: error.step),
            detail: error.kind == .taskTookTooLong ? error.finishedSoFar : nil,
            buttons: copy.buttons.compactMap { button(for: $0, error: error) }
        )
    }

    private static func fill(_ template: String, lastAction: String?, permission: String?, step: String?) -> String {
        var text = template
        if text.hasPrefix("{device}") {
            text = otherDevice.prefix(1).uppercased() + otherDevice.dropFirst() + text.dropFirst("{device}".count)
        }
        text = text.replacingOccurrences(of: "{device}", with: otherDevice)
        if let lastAction {
            text = text.replacingOccurrences(of: "{last action}", with: lastAction)
        }
        if let permission {
            text = text.replacingOccurrences(of: "{permission}", with: permission)
        }
        if let step = step?.trimmingCharacters(in: .whitespaces.union(CharacterSet(charactersIn: "."))), !step.isEmpty {
            text = text.replacingOccurrences(of: "{step}", with: step)
        } else {
            // Without a step name, "I couldn't finish this step." is still a full sentence.
            text = text.replacingOccurrences(of: ": {step}", with: "")
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
        case "Pair now":
            action = .pairPhone
        case "Type instead":
            action = .typeGoal
        case "Try again" where error.kind == .voiceFailedToLoad:
            action = .reloadVoice
        case "Try again" where error.kind == .didNotCatchSpeech:
            // Push-to-talk: trying again is holding the shortcut again, so this only closes the error.
            action = .dismiss
        case "Cancel":
            action = error.taskId.map(ErrorButtonAction.cancelTask) ?? .dismiss
        case "Stop":
            action = error.taskId.map(ErrorButtonAction.cancelTask) ?? .notAvailableYet
        case "Keep going":
            action = error.taskId.map(ErrorButtonAction.resumeTask) ?? .notAvailableYet
        default:
            action = .notAvailableYet
        }
        return ErrorButton(label: label, action: action)
    }

    private static func permission(for kind: ErrorKind) -> Permission? {
        Permission.allCases.first { $0.missingErrorKind == kind }
    }
}
