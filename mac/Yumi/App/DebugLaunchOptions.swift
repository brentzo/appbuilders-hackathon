import AppKit
import OSLog

/// Launch arguments for checking the UI by screenshot, in Debug builds only. For example:
///
///     open Yumi.app --args -YumiAppearance dark -YumiOpen settings -YumiSnapshotDir /tmp/shots
///
/// - `-YumiAppearance light|dark` forces the app's appearance without changing the system's.
/// - `-YumiStatus ready|listening|working|paused` sets the menu's status line.
/// - `-YumiOpen settings` opens a window at launch.
/// - `-YumiSnapshotDir <dir>` renders the opened window to PNG files at 1x and 2x scale, then quits.
///   Yumi draws its own window, so this needs no Screen Recording permission. The window's
///   translucent materials may render flatter than on screen.
enum DebugLaunchOptions {
    static func apply(to app: AppDelegate) {
        #if DEBUG
        let arguments = UserDefaults.standard
        let appearance = arguments.string(forKey: "YumiAppearance")
        switch appearance {
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        default: break
        }

        if let status = arguments.string(forKey: "YumiStatus").flatMap(AppStatus.init(rawValue:)) {
            app.model.status = status
        }

        let opened: (name: String, window: NSWindow)?
        switch arguments.string(forKey: "YumiOpen") {
        case "settings": opened = ("settings", app.windows.showSettings())
        default: opened = nil
        }

        if let directory = arguments.string(forKey: "YumiSnapshotDir"), let opened {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                let prefix = "\(opened.name)-\(appearance ?? "system")"
                snapshot(opened.window, to: URL(fileURLWithPath: directory), prefix: prefix)
                NSApp.terminate(nil)
            }
        }
        #endif
    }

    #if DEBUG
    private static func snapshot(_ window: NSWindow, to directory: URL, prefix: String) {
        let log = Logger(subsystem: "ph.appbuilders.yumi", category: "debug")
        guard let view = window.contentView?.superview else { return }
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        for scale in [1, 2] {
            let size = view.bounds.size
            guard let rep = NSBitmapImageRep(
                bitmapDataPlanes: nil,
                pixelsWide: Int(size.width) * scale,
                pixelsHigh: Int(size.height) * scale,
                bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
            ) else { continue }
            rep.size = size
            view.cacheDisplay(in: view.bounds, to: rep)
            let file = directory.appendingPathComponent("\(prefix)@\(scale)x.png")
            do {
                try rep.representation(using: .png, properties: [:])?.write(to: file)
                log.info("Snapshot written to \(file.path, privacy: .public)")
            } catch {
                log.error("Snapshot failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }
    #endif
}
