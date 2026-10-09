import AppKit
import OSLog
import YumiProtocol

/// Launch arguments for checking the UI by screenshot, in Debug builds only. For example:
///
///     open Yumi.app --args -YumiAppearance dark -YumiOpen settings -YumiSnapshotDir /tmp/shots
///
/// - `-YumiAppearance light|dark` forces the app's appearance without changing the system's.
/// - `-YumiStatus startingUp|ready|listening|working|paused` sets the menu's status line.
/// - `-YumiOpen settings|onboarding|error:<ErrorKind>` opens a window at launch instead of the
///   usual onboarding check. An error uses the sample last action "Clicked Export in Keynote".
/// - `-YumiPermissions mixed|granted` pretends permissions are in that state, without asking macOS.
///   `mixed` has the microphone allowed and the other two missing.
/// - `-YumiSnapshotDir <dir>` makes the opened window key and active, renders it to PNG files at
///   1x and 2x scale, then quits. If the window cannot become key, it writes nothing.
///   Yumi draws its own window, so this needs no Screen Recording permission. The window's
///   translucent materials may render flatter than on screen.
enum DebugLaunchOptions {
    static func permissionCenter() -> PermissionCenter {
        #if DEBUG
        if let fake = LaunchArguments.string("YumiPermissions") {
            return PermissionCenter(system: FakePermissionSystem(allGranted: fake == "granted"))
        }
        #endif
        return PermissionCenter()
    }

    /// Applies the options and returns true if they opened a window.
    @discardableResult
    static func apply(to app: AppDelegate) -> Bool {
        #if DEBUG
        let appearance = LaunchArguments.string("YumiAppearance")
        switch appearance {
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        default: break
        }

        if let status = LaunchArguments.string("YumiStatus").flatMap(AppStatus.init(rawValue:)) {
            app.model.statusOverride = status
        }

        let opened: (name: String, window: NSWindow)?
        switch LaunchArguments.string("YumiOpen") {
        case "settings": opened = ("settings", app.windows.showSettings())
        case "onboarding": opened = ("onboarding", app.windows.showOnboarding())
        case let value? where value.hasPrefix("error:"):
            let name = String(value.dropFirst("error:".count))
            opened = ErrorKind(rawValue: name).map {
                ("error-\(name)", app.showError(UserError(kind: $0, lastAction: "Clicked Export in Keynote")))
            }
        default: opened = nil
        }

        if let directory = LaunchArguments.string("YumiSnapshotDir"), let opened {
            let prefix = "\(opened.name)-\(appearance ?? "system")"
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                snapshotWhenKey(opened.window, to: URL(fileURLWithPath: directory), prefix: prefix, attemptsLeft: 10)
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

    /// Snapshots show the window as the user sees it while using it: key and active, so accent
    /// colors and selected states render. A launch through `open` may not get focus by itself.
    private static func makeKeyAndActive(_ window: NSWindow) {
        if !NSApp.isActive {
            // Deprecated, but the newer cooperative activate() is refused when launched via `open`.
            NSApp.activate(ignoringOtherApps: true)
        }
        window.makeKeyAndOrderFront(nil)
    }

    /// Activation from a background launch does not always stick on the first try, so this asks
    /// again every half second. A snapshot of an inactive window would pass for a check it is not,
    /// so if the window never becomes key, nothing is written.
    private static func snapshotWhenKey(_ window: NSWindow, to directory: URL, prefix: String, attemptsLeft: Int) {
        makeKeyAndActive(window)
        // Key state reaches SwiftUI asynchronously; give it a moment to redraw accents.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            if NSApp.isActive, window.isKeyWindow {
                snapshot(window, to: directory, prefix: prefix)
                NSApp.terminate(nil)
            } else if attemptsLeft > 1 {
                snapshotWhenKey(window, to: directory, prefix: prefix, attemptsLeft: attemptsLeft - 1)
            } else {
                let message = "Snapshot skipped: \(prefix) never became the key, active window"
                Logger(subsystem: "ph.appbuilders.yumi", category: "debug").error("\(message, privacy: .public)")
                FileHandle.standardError.write(Data((message + "\n").utf8))
                NSApp.terminate(nil)
            }
        }
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
