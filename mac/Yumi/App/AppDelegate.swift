import AppKit
import OSLog

final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel(permissions: DebugLaunchOptions.permissionCenter())
    private(set) lazy var windows = WindowCoordinator(model: model)
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "app")

    /// True when the app is only hosting unit tests, so it should not open windows.
    private var isHostingTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        log.info("Yumi launched")
        guard !isHostingTests else { return }

        model.permissions.observeActivation()
        if DebugLaunchOptions.apply(to: self) { return }
        if !model.permissions.allGranted {
            windows.showOnboarding()
        }
    }
}
