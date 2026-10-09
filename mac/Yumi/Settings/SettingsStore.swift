import Foundation
import Observation
import OSLog

/// Keeps `YumiSettings` in `UserDefaults` and tells the harness sink about every change.
@Observable
final class SettingsStore {
    private(set) var settings: YumiSettings

    @ObservationIgnored private let defaults: UserDefaults
    @ObservationIgnored private let sink: HarnessSettingsSink
    @ObservationIgnored private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "settings")

    enum Key {
        static let wakeWordEnabled = "settings.wakeWordEnabled"
        static let pushToTalkShortcut = "settings.pushToTalkShortcut"
        static let speaksTaglish = "settings.speaksTaglish"
        static let autoMode = "settings.autoMode"
        static let demoModeEnabled = "settings.demoModeEnabled"
        static let visibleCursorCap = "settings.visibleCursorCap"
    }

    init(defaults: UserDefaults = .standard, sink: HarnessSettingsSink) {
        self.defaults = defaults
        self.sink = sink
        self.settings = Self.load(from: defaults)
    }

    var wakeWordEnabled: Bool {
        get { settings.wakeWordEnabled }
        set { update { $0.wakeWordEnabled = newValue } }
    }

    var pushToTalkShortcut: KeyShortcut {
        get { settings.pushToTalkShortcut }
        set { update { $0.pushToTalkShortcut = newValue } }
    }

    var speaksTaglish: Bool {
        get { settings.speaksTaglish }
        set { update { $0.speaksTaglish = newValue } }
    }

    var autoMode: Bool {
        get { settings.autoMode }
        set { update { $0.autoMode = newValue } }
    }

    var demoModeEnabled: Bool {
        get { settings.demoModeEnabled }
        set { update { $0.demoModeEnabled = newValue } }
    }

    var visibleCursorCap: Int {
        get { settings.visibleCursorCap }
        set { update { $0.visibleCursorCap = Self.clampCap(newValue) } }
    }

    private func update(_ change: (inout YumiSettings) -> Void) {
        var next = settings
        change(&next)
        guard next != settings else { return }
        settings = next
        save(next)
        sink.settingsDidChange(next)
    }

    private func save(_ settings: YumiSettings) {
        defaults.set(settings.wakeWordEnabled, forKey: Key.wakeWordEnabled)
        defaults.set(settings.speaksTaglish, forKey: Key.speaksTaglish)
        defaults.set(settings.autoMode, forKey: Key.autoMode)
        defaults.set(settings.demoModeEnabled, forKey: Key.demoModeEnabled)
        defaults.set(settings.visibleCursorCap, forKey: Key.visibleCursorCap)
        do {
            defaults.set(try JSONEncoder().encode(settings.pushToTalkShortcut), forKey: Key.pushToTalkShortcut)
        } catch {
            log.error("Could not save the push-to-talk shortcut: \(error.localizedDescription, privacy: .public)")
        }
    }

    private static func load(from defaults: UserDefaults) -> YumiSettings {
        let fallback = YumiSettings.defaults
        var shortcut = fallback.pushToTalkShortcut
        if let data = defaults.data(forKey: Key.pushToTalkShortcut),
           let stored = try? JSONDecoder().decode(KeyShortcut.self, from: data) {
            shortcut = stored
        }
        return YumiSettings(
            wakeWordEnabled: defaults.object(forKey: Key.wakeWordEnabled) as? Bool ?? fallback.wakeWordEnabled,
            pushToTalkShortcut: shortcut,
            speaksTaglish: defaults.object(forKey: Key.speaksTaglish) as? Bool ?? fallback.speaksTaglish,
            autoMode: defaults.object(forKey: Key.autoMode) as? Bool ?? fallback.autoMode,
            demoModeEnabled: defaults.object(forKey: Key.demoModeEnabled) as? Bool ?? fallback.demoModeEnabled,
            visibleCursorCap: clampCap(defaults.object(forKey: Key.visibleCursorCap) as? Int ?? fallback.visibleCursorCap)
        )
    }

    private static func clampCap(_ value: Int) -> Int {
        min(max(value, YumiSettings.visibleCursorCapRange.lowerBound), YumiSettings.visibleCursorCapRange.upperBound)
    }
}
