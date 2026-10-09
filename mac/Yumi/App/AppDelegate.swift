import AppKit
import OSLog

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "app")

    func applicationDidFinishLaunching(_ notification: Notification) {
        log.info("Yumi launched")
    }
}
