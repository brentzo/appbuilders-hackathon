import Foundation
import Testing
@testable import Yumi

@MainActor
struct SettingsStoreTests {
    final class RecordingSink: HarnessSettingsSink {
        var received: [YumiSettings] = []
        func settingsDidChange(_ settings: YumiSettings) { received.append(settings) }
    }

    private func freshDefaults() -> UserDefaults {
        let name = "yumi.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return defaults
    }

    @Test func startsWithSpecDefaults() {
        let store = SettingsStore(defaults: freshDefaults(), sink: RecordingSink())
        #expect(store.settings == .defaults)
        #expect(store.demoModeEnabled == false) // SPEC-03 requirement 16: off by default
        #expect(store.visibleCursorCap == 3) // SPEC-03 requirement 6
    }

    @Test func persistsAcrossLaunches() {
        let defaults = freshDefaults()
        let first = SettingsStore(defaults: defaults, sink: RecordingSink())
        first.wakeWordEnabled = false
        first.demoModeEnabled = true
        first.visibleCursorCap = 2
        first.pushToTalkShortcut = KeyShortcut(keyCode: 3, modifiers: [.control, .command], keyLabel: "F")

        let second = SettingsStore(defaults: defaults, sink: RecordingSink())
        #expect(second.settings == first.settings)
        #expect(second.pushToTalkShortcut.displayText == "⌃⌘F")
    }

    @Test func cursorCapNeverExceedsSpecCap() {
        let defaults = freshDefaults()
        let store = SettingsStore(defaults: defaults, sink: RecordingSink())
        store.visibleCursorCap = 7
        #expect(store.visibleCursorCap == 3)
        store.visibleCursorCap = 0
        #expect(store.visibleCursorCap == 1)

        defaults.set(9, forKey: SettingsStore.Key.visibleCursorCap)
        #expect(SettingsStore(defaults: defaults, sink: RecordingSink()).visibleCursorCap == 3)
    }

    @Test func tellsTheSinkOnlyAboutRealChanges() {
        let sink = RecordingSink()
        let store = SettingsStore(defaults: freshDefaults(), sink: sink)
        store.demoModeEnabled = false // unchanged
        store.demoModeEnabled = true
        #expect(sink.received.count == 1)
        #expect(sink.received.last?.demoModeEnabled == true)
    }

    @Test func shortcutNeedsARealModifier() {
        #expect(KeyShortcut.Modifiers([.shift]).isUsableForGlobalShortcut == false)
        #expect(KeyShortcut.Modifiers([.shift, .option]).isUsableForGlobalShortcut)
        #expect(KeyShortcut.defaultPushToTalk.displayText == "⌥Space")
    }
}
