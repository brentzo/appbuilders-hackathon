import AppKit
import OSLog
import SwiftUI
import YumiProtocol

/// Launch arguments for checking the UI by screenshot, in Debug builds only. For example:
///
///     open Yumi.app --args -YumiAppearance dark -YumiOpen settings -YumiSnapshotDir /tmp/shots
///
/// - `-YumiAppearance light|dark` forces the app's appearance without changing the system's.
/// - `-YumiStatus startingUp|ready|listening|working|paused` sets the menu's status line.
/// - `-YumiVoiceFile <path>` makes push-to-talk transcribe that recording instead of the microphone.
/// - `-YumiReplyFile <path>` makes the spoken answer after a repeat-back transcribe that recording.
/// - `-YumiOpen settings|onboarding|pairing|pairing-code|type-goal|menu|menu-busy|approval-send|approval-delete|paused|tiling|chips|error:<ErrorKind>` opens a window at launch instead of the
///   usual onboarding check. An error uses the sample last action "Clicked Export in Keynote".
/// - `-YumiPermissions mixed|granted` pretends permissions are in that state, without asking macOS.
///   `mixed` has the microphone allowed and the other two missing.
/// - `-YumiOverlayDemo <dir>` shows sample cursors and writes the overlay as PNG files, then quits.
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

        if let directory = LaunchArguments.string("YumiOverlayDemo") {
            runOverlayDemo(app.harness.overlay, writingTo: URL(fileURLWithPath: directory))
            return true
        }
        if LaunchArguments.string("YumiOpen") == "chips", let directory = LaunchArguments.string("YumiSnapshotDir") {
            runChipsDemo(app.harness.overlay, writingTo: URL(fileURLWithPath: directory))
            return true
        }

        let opened: (name: String, window: NSWindow)?
        switch LaunchArguments.string("YumiOpen") {
        case "settings": opened = ("settings", app.windows.showSettings())
        case "onboarding": opened = ("onboarding", app.windows.showOnboarding())
        case "pairing": opened = ("pairing", PairingWindow.show())
        case "type-goal": opened = ("type-goal", app.showTypeGoal())
        case "menu":
            opened = ("menu", sampleWindow(app.menuPanel {}))
        case "menu-busy":
            showSampleCursors(app.harness.overlay)
            app.model.statusOverride = .working
            app.harness.tiler.state.hasSavedLayout = true
            opened = ("menu-busy", sampleWindow(app.menuPanel {}))
        case "approval-send":
            opened = ("approval-send", sampleWindow(card(ApprovalCardView(approval: sampleSend) { _ in })))
        case "approval-delete":
            opened = ("approval-delete", sampleWindow(card(ApprovalCardView(approval: sampleDelete) { _ in })))
        case "paused":
            opened = ("paused", sampleWindow(card(PausedView(text: PauseCopy.paused, resume: {}, cancel: {}))))
        case "tiling":
            opened = ("tiling", sampleWindow(card(TilingQuestionView { _ in })))
        case "pairing-code":
            PhoneLink.shared.showSampleCode(.init(payload: "yumi-pair:sample", expiresAt: Date().addingTimeInterval(300)))
            opened = ("pairing-code", PairingWindow.show())
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

    /// A snapshot window for a view that normally lives in a menu bar panel or a floating panel.
    private static func sampleWindow(_ view: some View) -> NSWindow {
        let window = NSWindow(contentViewController: NSHostingController(rootView: view))
        window.styleMask = [.titled, .closable]
        window.title = ""
        window.isReleasedWhenClosed = false
        window.applyYumiStyle()
        window.center()
        return window
    }

    /// A floating card on a desktop-like backdrop, so its edge and corners show.
    private static func card(_ view: some View) -> some View {
        view.padding(YumiSpace.xl).background(YumiColor.paperDeep)
    }

    private static let sampleSend = Approval(
        id: "sample-send", stepId: "step-1", kind: .send, recipients: ["Ana Reyes <ana@example.com>"],
        text: "I'm about to send this email to Ana Reyes (ana@example.com) with the subject \"Q3 report\". Should I send it?",
        requestedAt: "", expiresAt: ""
    )

    private static let sampleDelete = Approval(
        id: "sample-delete", stepId: "step-2", kind: .delete,
        files: FileSummary(
            folder: "~/Downloads", count: 12,
            firstNames: ["old-invoice.pdf", "Q3 Report final final (Ana's edits) v7 - do not share outside the team.pdf", "receipt-0412.pdf", "scan.png", "notes.txt"],
            allPaths: ["~/Downloads/old-invoice.pdf"]
        ),
        text: "I'm about to move 12 files from Downloads to the Trash, starting with old-invoice.pdf. Should I delete them?",
        requestedAt: "", expiresAt: ""
    )

    /// A main cursor and two labeled ghosts, off to the side, for the busy menu panel.
    private static func showSampleCursors(_ overlay: CursorOverlay) {
        guard let screen = NSScreen.screens.first else { return }
        let corner = CGPoint(x: screen.frame.minX + 80, y: screen.frame.minY + 120)
        overlay.spawn(id: "main", kind: .main, label: "Export my Keynote deck as a PDF", at: corner)
        overlay.update("main") { $0.state = .acting }
        overlay.spawn(id: "ghost-1", kind: .ghost, label: "Fill expense form", at: corner)
        overlay.update("ghost-1") { $0.state = .thinking }
        overlay.spawn(id: "ghost-2", kind: .ghost, label: "Rename the invoices in Downloads by date", at: corner)
        overlay.update("ghost-2") { $0.state = .waitingForUser }
    }

    /// `-YumiOpen chips -YumiSnapshotDir <dir>`: three helper chips, one per littermate, rendered
    /// with the overlay over white and black, then quits.
    private static func runChipsDemo(_ overlay: CursorOverlay, writingTo directory: URL) {
        overlay.showHelperChip(id: "helper-1", text: "Checking the weather")
        overlay.showHelperChip(id: "helper-2", text: "Summarizing the PDF in Downloads")
        overlay.showHelperChip(id: "helper-3", text: "Helper working")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            for file in overlay.debugRender(to: directory) {
                print("Chips snapshot: \(file.path)")
            }
            NSApp.terminate(nil)
        }
    }

    /// `-YumiOverlayDemo <dir>`: a main cursor and two labeled ghosts in different states plus a
    /// helper chip, rendered to PNG files over white and black, then quits.
    private static func runOverlayDemo(_ overlay: CursorOverlay, writingTo directory: URL) {
        guard let screen = NSScreen.screens.first else { return }
        let center = CGPoint(x: screen.frame.midX, y: screen.frame.midY)
        overlay.spawn(id: "main", kind: .main, label: nil, at: center)
        overlay.update("main") { $0.state = .thinking }
        overlay.spawn(id: "ghost-1", kind: .ghost, label: "Fill expense form", at: CGPoint(x: center.x - 260, y: center.y + 140))
        overlay.update("ghost-1") { $0.state = .acting }
        overlay.spawn(id: "ghost-2", kind: .ghost, label: "Rename invoices in Downloads", at: CGPoint(x: center.x + 220, y: center.y - 160))
        overlay.update("ghost-2") { $0.state = .waitingForUser }
        overlay.showHelperChip(id: "helper", text: "Helper working")
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            for file in overlay.debugRender(to: directory) {
                print("Overlay snapshot: \(file.path)")
            }
            NSApp.terminate(nil)
        }
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
