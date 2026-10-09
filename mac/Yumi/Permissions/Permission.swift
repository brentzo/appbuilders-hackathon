import Foundation
import enum YumiProtocol.ErrorKind

/// The macOS privacy permissions Yumi needs.
enum Permission: String, CaseIterable, Identifiable, Sendable {
    case microphone
    case accessibility
    case screenRecording

    var id: String { rawValue }

    /// The name System Settings uses, so the user can find it there.
    var title: String {
        switch self {
        case .microphone: "Microphone"
        case .accessibility: "Accessibility"
        case .screenRecording: "Screen Recording"
        }
    }

    var symbolName: String {
        switch self {
        case .microphone: "mic"
        case .accessibility: "hand.raised"
        case .screenRecording: "rectangle.dashed.badge.record"
        }
    }

    /// The SPEC-11 row whose copy explains why Yumi needs this permission.
    var missingErrorKind: ErrorKind {
        switch self {
        case .microphone: .microphonePermissionMissing
        case .accessibility: .accessibilityPermissionMissing
        case .screenRecording: .screenPermissionMissing
        }
    }

    /// The Privacy & Security pane for this permission in System Settings.
    var settingsURL: URL {
        let anchor = switch self {
        case .microphone: "Privacy_Microphone"
        case .accessibility: "Privacy_Accessibility"
        case .screenRecording: "Privacy_ScreenCapture"
        }
        return URL(string: "x-apple.systempreferences:com.apple.preference.security?\(anchor)")!
    }
}

enum PermissionState: Equatable, Sendable {
    case granted
    /// macOS has never asked. Only the microphone reports this; it is granted from macOS's own prompt.
    case notAsked
    case missing
}
