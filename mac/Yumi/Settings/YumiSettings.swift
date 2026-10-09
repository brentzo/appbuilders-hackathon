import Foundation

/// The user's settings, as one value. Stored locally by `SettingsStore`.
struct YumiSettings: Equatable, Sendable {
    /// Listen for "Hey Yumi" (SPEC-01 requirement 11). Push-to-talk works either way.
    var wakeWordEnabled: Bool
    /// The global shortcut held to talk (SPEC-01 requirement 9). Registering it is OBJ-15.
    var pushToTalkShortcut: KeyShortcut
    /// Transcribe every goal with Whisper, which understands Tagalog and English mixed (OBJ-15.5).
    /// Off: Apple's on-device recognizer, faster for English.
    var speaksTaglish: Bool
    /// Tile windows without asking first (SPEC-03 requirement 16).
    var demoModeEnabled: Bool
    /// How many cursors may be visible at once, `main` included (SPEC-03 requirement 6).
    var visibleCursorCap: Int

    /// SPEC-03 caps visible cursors at 3, so the setting can only lower it.
    static let visibleCursorCapRange = 1...3

    static let defaults = YumiSettings(
        wakeWordEnabled: true,
        pushToTalkShortcut: .defaultPushToTalk,
        speaksTaglish: false,
        demoModeEnabled: false,
        visibleCursorCap: 3
    )
}
