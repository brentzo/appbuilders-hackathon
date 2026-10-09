import Observation

/// Everything the menu and windows read. Owned by `AppDelegate` for the life of the app.
@Observable
final class AppModel {
    var status: AppStatus = .ready
    let settings: SettingsStore
    let permissions: PermissionCenter

    init(
        settings: SettingsStore = SettingsStore(sink: PendingHarnessSettingsSink()),
        permissions: PermissionCenter = PermissionCenter()
    ) {
        self.settings = settings
        self.permissions = permissions
    }
}
