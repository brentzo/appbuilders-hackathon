import Foundation
import Testing
@testable import Yumi

struct AppStatusTests {
    /// An AppModel whose settings and permission flags live in a throwaway suite, and whose
    /// permissions never ask macOS, so tests leave the app's real preferences alone.
    static func isolatedModel() -> AppModel {
        let name = "yumi.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defaults.removePersistentDomain(forName: name)
        return AppModel(
            settings: SettingsStore(defaults: defaults, sink: PendingHarnessSettingsSink()),
            permissions: PermissionCenter(system: NoPermissions(), defaults: defaults)
        )
    }

    struct NoPermissions: PermissionSystem {
        func state(of permission: Permission) -> PermissionState { .missing }
        func request(_ permission: Permission) async {}
        func open(_ url: URL) {}
    }

    @Test func coversTheObjectiveStatesAndStartingUp() {
        #expect(AppStatus.allCases.map(\.rawValue) == ["startingUp", "ready", "listening", "working", "paused"])
    }

    @Test func startsUpUntilTheHarnessIsReady() {
        let model = Self.isolatedModel()
        #expect(model.status == .startingUp)
        model.harnessReady = true
        #expect(model.status == .ready)
        model.taskStatus = .working
        #expect(model.status == .working)
        model.harnessReady = false
        #expect(model.status == .startingUp)
    }
}

extension AppStatusTests {
    @Test func taskEventsDriveTheStatusLine() {
        #expect(HarnessLink.appStatus(for: []) == .ready)
        #expect(HarnessLink.appStatus(for: [.running]) == .working)
        #expect(HarnessLink.appStatus(for: [.paused, .done]) == .paused)
        #expect(HarnessLink.appStatus(for: [.paused, .planning]) == .working)
        #expect(HarnessLink.appStatus(for: [.done, .cancelled, .failed]) == .ready)
    }
}
