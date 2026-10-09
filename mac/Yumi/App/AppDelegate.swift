import AppKit
import OSLog

final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel()
    private(set) lazy var windows = WindowCoordinator(model: model)
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "app")

    func applicationDidFinishLaunching(_ notification: Notification) {
        log.info("Yumi launched")
        DebugLaunchOptions.apply(to: self)
    }
}
