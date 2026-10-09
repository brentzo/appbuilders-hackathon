import AppKit
import ApplicationServices
import YumiProtocol

/// Opens a second window of an app, so a subtask can work beside another cursor (OBJ-27.2,
/// SPEC-03 r11). Every per-app strategy lives in `strategies`.
@MainActor
enum NewWindowOpener {
    /// The menu path that opens a new window, top-level menu first. English menu titles only.
    struct Strategy {
        let menuPath: [String]
    }

    static let strategies: [String: Strategy] = [
        "com.google.Chrome": Strategy(menuPath: ["File", "New Window"]),
        "com.apple.finder": Strategy(menuPath: ["File", "New Finder Window"]),
        "com.apple.mail": Strategy(menuPath: ["File", "New Message"]),
    ]

    static func open(bundleId: String) async throws -> OpenNewWindowResult {
        guard let strategy = strategies[bundleId],
              let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
            return OpenNewWindowResult(supported: false)
        }
        guard AXIsProcessTrusted() else { throw WindowService.Failure.accessibilityMissing }
        let app = try await AppLauncher.running(bundleId: bundleId, url: url)
        // A just-launched app may still be opening its first window; wait for it to settle.
        var before = Set(WindowService.windowIds(bundleId: bundleId))
        try? await Task.sleep(for: .milliseconds(300))
        before.formUnion(WindowService.windowIds(bundleId: bundleId))

        guard pressMenuItem(strategy.menuPath, in: app) else { return OpenNewWindowResult(supported: false) }
        for _ in 0..<30 {
            try? await Task.sleep(for: .milliseconds(100))
            if let id = WindowService.windowIds(bundleId: bundleId).first(where: { !before.contains($0) }) {
                return OpenNewWindowResult(supported: true, windowId: id)
            }
        }
        return OpenNewWindowResult(supported: false)
    }

    private static func pressMenuItem(_ path: [String], in app: NSRunningApplication) -> Bool {
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(appElement, 2)
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appElement, kAXMenuBarAttribute as CFString, &raw) == .success,
              let raw else { return false }
        var current = raw as! AXUIElement
        for title in path {
            guard let next = child(of: current, titled: title) else { return false }
            current = next
        }
        return AXUIElementPerformAction(current, kAXPressAction as CFString) == .success
    }

    /// Finds a titled item under a menu bar, menu bar item, or menu, looking through the menu
    /// that a menu bar item holds.
    private static func child(of element: AXUIElement, titled title: String) -> AXUIElement? {
        for item in children(of: element) {
            if WindowService.string(item, kAXTitleAttribute) == title { return item }
            if WindowService.string(item, kAXRoleAttribute) == "AXMenu",
               let found = children(of: item).first(where: { WindowService.string($0, kAXTitleAttribute) == title }) {
                return found
            }
        }
        return nil
    }

    private static func children(of element: AXUIElement) -> [AXUIElement] {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &raw) == .success else { return [] }
        return raw as? [AXUIElement] ?? []
    }
}
