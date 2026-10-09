/// The SPEC-11 error copy, in the one place the app keeps it (SPEC-11 requirement 7).
/// `UserErrorCopyTests` checks every entry against the table in `specs/11-user-facing-errors.md`.
///
/// Only the rows the app shell uses so far are here. The error presenter (OBJ-14.6) adds the rest
/// and maps the harness's structured error kinds to them, once the protocol defines those kinds.
/// TEMPORARY: copy keys for the app shell until OBJ-01 defines the protocol's `ErrorKind` and its
/// generated Swift type exists. This is not a contract type and must not grow into one.
/// OBJ-14.6 maps the generated `ErrorKind` onto these copy entries (or replaces this enum with it)
/// rather than adding a second error-kind enum next to it.
enum UserErrorKind: CaseIterable, Sendable {
    case screenPermissionMissing
    case accessibilityPermissionMissing
    case microphonePermissionMissing
    case unexpected
}

struct UserErrorCopy: Equatable, Sendable {
    /// The row's name in the SPEC-11 "Failure" column. Never shown to the user.
    let specRow: String
    /// What the user hears and sees. `{last action}` is filled in before showing.
    let message: String
    let buttons: [String]

    static func copy(for kind: UserErrorKind) -> UserErrorCopy {
        switch kind {
        case .screenPermissionMissing:
            UserErrorCopy(
                specRow: "Screen permission missing (Mac)",
                message: "I need permission to see your screen before I can help with this.",
                buttons: ["Open settings", "Not now"]
            )
        case .accessibilityPermissionMissing:
            UserErrorCopy(
                specRow: "Accessibility permission missing (Mac)",
                message: "I need permission to control your Mac before I can help with this.",
                buttons: ["Open settings", "Not now"]
            )
        case .microphonePermissionMissing:
            UserErrorCopy(
                specRow: "Microphone permission missing",
                message: "I need permission to use the microphone so I can hear you.",
                buttons: ["Open settings", "Type instead"]
            )
        case .unexpected:
            UserErrorCopy(
                specRow: "Unexpected",
                message: "Something went wrong and I stopped to be safe. Here's the last thing I did: {last action}.",
                buttons: ["Show what I did", "Try again", "Stop"]
            )
        }
    }
}
