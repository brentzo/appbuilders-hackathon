import Testing
@testable import Yumi

struct AppStatusTests {
    @Test func coversTheFourObjectiveStates() {
        #expect(AppStatus.allCases.map(\.rawValue) == ["ready", "listening", "working", "paused"])
    }

    @Test func startsReady() {
        #expect(AppModel(settings: SettingsStore(sink: PendingHarnessSettingsSink())).status == .ready)
    }
}
