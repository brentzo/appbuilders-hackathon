import AppKit
import ApplicationServices
import YumiProtocol

/// What an app supports for background control (OBJ-27.1, SPEC-03 r3 and r4).
@MainActor
enum AppCapabilityProbe {
    enum Failure: Error, Equatable {
        case accessibilityMissing
        case appNotInstalled
    }

    /// Chromium browsers. They speak the DevTools protocol when started with a debugging port, so
    /// the harness can drive them in the background.
    static let chromiumBrowsers: Set<String> = [
        "com.google.Chrome", "com.google.Chrome.beta", "com.google.Chrome.canary", "org.chromium.Chromium",
        "com.microsoft.edgemac", "com.brave.Browser", "company.thebrowser.Browser", "com.vivaldi.Vivaldi",
        "com.operasoftware.Opera",
    ]

    /// Roles the model can act on (SPEC-05 r2). One of them inside a window means the app can be
    /// driven through the accessibility tree.
    static let actionableRoles: Set<String> = [
        "AXButton", "AXMenuItem", "AXTextField", "AXTextArea", "AXLink", "AXCheckBox", "AXPopUpButton",
        "AXComboBox", "AXMenuButton", "AXRadioButton",
    ]

    static func probe(bundleId: String) async throws -> AppCapability {
        guard AXIsProcessTrusted() else { throw Failure.accessibilityMissing }
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else {
            throw Failure.appNotInstalled
        }
        let app = try await AppLauncher.running(bundleId: bundleId, url: url)
        return AppCapability(
            bundleId: bundleId,
            appVersion: version(of: url),
            accessibility: await hasActionableWindowContent(app),
            devtools: chromiumBrowsers.contains(bundleId),
            probedAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    /// The marketing version plus the build, so the harness re-probes after any update.
    static func version(of url: URL) -> String {
        let info = Bundle(url: url)?.infoDictionary ?? [:]
        let short = info["CFBundleShortVersionString"] as? String ?? "?"
        let build = info["CFBundleVersion"] as? String ?? "?"
        return "\(short) (\(build))"
    }

    /// Looks inside the app's windows, not its menu bar: every app has menu items, but background
    /// control needs actionable content in the window itself.
    private static func hasActionableWindowContent(_ app: NSRunningApplication) async -> Bool {
        let element = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(element, 1)
        // Chromium and Electron build their accessibility tree only when asked.
        AXUIElementSetAttributeValue(element, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        for attempt in 0..<10 {
            if attempt > 0 { try? await Task.sleep(for: .milliseconds(300)) }
            var value: CFTypeRef?
            guard AXUIElementCopyAttributeValue(element, kAXWindowsAttribute as CFString, &value) == .success,
                  let windows = value as? [AXUIElement], !windows.isEmpty else { continue }
            var budget = 2000
            if windows.contains(where: { containsActionable($0, depth: 0, budget: &budget) }) { return true }
        }
        return false
    }

    private static func containsActionable(_ element: AXUIElement, depth: Int, budget: inout Int) -> Bool {
        budget -= 1
        guard budget > 0, depth < 25 else { return false }
        if let role = WindowService.string(element, kAXRoleAttribute), depth > 0, actionableRoles.contains(role) {
            return true
        }
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &value) == .success,
              let children = value as? [AXUIElement] else { return false }
        return children.contains { containsActionable($0, depth: depth + 1, budget: &budget) }
    }
}

/// Starts an app without bringing it to the front, and waits until it is running.
@MainActor
enum AppLauncher {
    enum Failure: Error { case didNotStart }

    static func running(bundleId: String, url: URL) async throws -> NSRunningApplication {
        if let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first {
            return app
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        let app = try await NSWorkspace.shared.openApplication(at: url, configuration: configuration)
        for _ in 0..<50 where !app.isFinishedLaunching {
            try? await Task.sleep(for: .milliseconds(100))
        }
        guard app.isFinishedLaunching else { throw Failure.didNotStart }
        return app
    }
}
