import Testing
@testable import Yumi

struct AppStatusTests {
    @Test func coversTheObjectiveStatesAndStartingUp() {
        #expect(AppStatus.allCases.map(\.rawValue) == ["startingUp", "ready", "listening", "working", "paused"])
    }

    @Test func startsUpUntilTheHarnessIsReady() {
        let model = AppModel(settings: SettingsStore(sink: PendingHarnessSettingsSink()))
        #expect(model.status == .startingUp)
        model.harnessReady = true
        #expect(model.status == .ready)
        model.taskStatus = .working
        #expect(model.status == .working)
        model.harnessReady = false
        #expect(model.status == .startingUp)
    }
}
