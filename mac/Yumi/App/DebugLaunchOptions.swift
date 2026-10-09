import AppKit
import OSLog

/// Launch arguments for checking the UI by screenshot, in Debug builds only. For example:
///
///     open Yumi.app --args -YumiAppearance dark -YumiOpen settings -YumiSnapshotDir /tmp/shots
///
/// - `-YumiAppearance light|dark` forces the app's appearance without changing the system's.
/// - `-YumiStatus ready|listening|working|paused` sets the menu's status line.
/// - `-YumiOpen settings|onboarding` opens a window at launch instead of the usual onboarding check.
/// - `-YumiPermissions mixed|granted` pretends permissions are in that state, without asking macOS.
///   `mixed` has the microphone allowed and the other two missing.
/// - `-YumiSnapshotDir <dir>` renders the opened window to PNG files at 1x and 2x scale, then quits.
///   Yumi draws its own window, so this needs no Screen Recording permission. The window's
///   translucent materials may render flatter than on screen.
enum DebugLaunchOptions {
    static func permissionCenter() -> PermissionCenter {
        #if DEBUG
        if let fake = UserDefaults.standard.string(forKey: "YumiPermissions") {
            return PermissionCenter(system: FakePermissionSystem(allGranted: fake == "granted"))
        }
        #endif
        return PermissionCenter()
    }

    /// Applies the options and returns true if they opened a window.
    @discardableResult
    static func apply(to app: AppDelegate) -> Bool {
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
        case "onboarding": opened = ("onboarding", app.windows.showOnboarding())
        default: opened = nil
        }

        if let directory = arguments.string(forKey: "YumiSnapshotDir"), let opened {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                let prefix = "\(opened.name)-\(appearance ?? "system")"
                snapshot(opened.window, to: URL(fileURLWithPath: directory), prefix: prefix)
                NSApp.terminate(nil)
            }
        }
        return opened != nil
        #else
        return false
        #endif
    }

    #if DEBUG
    private struct FakePermissionSystem: PermissionSystem {
        let allGranted: Bool
        func state(of permission: Permission) -> PermissionState {
            allGranted || permission == .microphone ? .granted : .missing
        }
        func request(_ permission: Permission) async {}
        func open(_ url: URL) { NSWorkspace.shared.open(url) }
    }

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
