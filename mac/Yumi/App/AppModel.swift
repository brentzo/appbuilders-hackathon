import Observation

/// Everything the menu and windows read. Owned by `AppDelegate` for the life of the app.
@Observable
final class AppModel {
    var status: AppStatus = .ready
    let settings: SettingsStore

    init(settings: SettingsStore = SettingsStore(sink: PendingHarnessSettingsSink())) {
        self.settings = settings
    }
}
