import Observation

/// Everything the menu and windows read. Owned by `AppDelegate` for the life of the app.
@Observable
final class AppModel {
    /// What the harness's task events say Yumi is doing.
    var taskStatus: AppStatus = .ready
    /// True once the harness is up and answering.
    var harnessReady = false
    /// Set when the harness in use is the mock, so the menu says so.
    var mockHarnessName: String?
    var modelReadiness: ModelReadiness = .unknown
    /// Debug builds can force the status line for screenshots.
    var statusOverride: AppStatus?

    let settings: SettingsStore
    let permissions: PermissionCenter

    init(
        settings: SettingsStore = SettingsStore(sink: PendingHarnessSettingsSink()),
        permissions: PermissionCenter = PermissionCenter()
    ) {
        self.settings = settings
        self.permissions = permissions
    }

    var status: AppStatus {
        if let statusOverride { return statusOverride }
        return harnessReady ? taskStatus : .startingUp
    }
}
