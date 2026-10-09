import AppKit
import ApplicationServices
import YumiProtocol

/// The private call every window manager uses to get a window's `CGWindowID` from its
/// accessibility element. There is no public way to connect the two.
@_silgen_name("_AXUIElementGetWindow")
private func _AXUIElementGetWindow(_ element: AXUIElement, _ windowId: UnsafeMutablePointer<CGWindowID>) -> AXError

/// Windows of other apps through the Accessibility API (OBJ-27.3).
///
/// Frames are in global screen coordinates, in points, with the origin at the top-left corner of
/// the main display and y growing downward. These are the coordinates the Accessibility API and
/// `CGWindowListCopyWindowInfo` use, so x and y are negative on displays left of or above the main one.
/// The window id is the `CGWindowID`, the same id `CGWindowList` and screen capture use.
@MainActor
enum WindowService {
    enum Failure: Error, Equatable {
        case accessibilityMissing
        case windowNotFound
        case frameNotSettable
    }

    static func listWindows(bundleId: String?) throws -> [WindowInfo] {
        guard AXIsProcessTrusted() else { throw Failure.accessibilityMissing }
        return runningApps(bundleId: bundleId).flatMap { app in
            windows(of: app).compactMap { info(for: $0.element, id: $0.id, app: app) }
        }
    }

    static func frame(of windowId: Int) throws -> Rect {
        let window = try find(windowId)
        guard let frame = frame(of: window.element) else { throw Failure.windowNotFound }
        return Rect(frame)
    }

    /// Moves and resizes the window. Apps may round the size to their own minimum or grid, so the
    /// frame read back is the one the app accepted.
    static func setFrame(of windowId: Int, to rect: Rect) throws {
        let window = try find(windowId)
        var origin = CGPoint(x: rect.x, y: rect.y)
        var size = CGSize(width: rect.width, height: rect.height)
        guard let position = AXValueCreate(.cgPoint, &origin), let dimensions = AXValueCreate(.cgSize, &size) else {
            throw Failure.frameNotSettable
        }
        // Size, then position, then size again: moving to another display can clamp the size to the
        // old display first, and resizing near an edge can push the origin.
        let first = AXUIElementSetAttributeValue(window.element, kAXSizeAttribute as CFString, dimensions)
        let moved = AXUIElementSetAttributeValue(window.element, kAXPositionAttribute as CFString, position)
        let second = AXUIElementSetAttributeValue(window.element, kAXSizeAttribute as CFString, dimensions)
        guard moved == .success, first == .success || second == .success else { throw Failure.frameNotSettable }
    }

    /// Window ids of one app, in the order the app lists them.
    static func windowIds(bundleId: String) -> [Int] {
        runningApps(bundleId: bundleId).flatMap { app in windows(of: app).map { Int($0.id) } }
    }

    // MARK: Accessibility

    struct Window {
        let element: AXUIElement
        let id: CGWindowID
        let app: NSRunningApplication
    }

    static func find(_ windowId: Int) throws -> Window {
        guard AXIsProcessTrusted() else { throw Failure.accessibilityMissing }
        for app in runningApps(bundleId: nil) {
            if let match = windows(of: app).first(where: { Int($0.id) == windowId }) {
                return Window(element: match.element, id: match.id, app: app)
            }
        }
        throw Failure.windowNotFound
    }

    private static func runningApps(bundleId: String?) -> [NSRunningApplication] {
        NSWorkspace.shared.runningApplications.filter { app in
            app.activationPolicy == .regular && app.bundleIdentifier != nil
                && (bundleId == nil || app.bundleIdentifier == bundleId)
        }
    }

    private static func windows(of app: NSRunningApplication) -> [(element: AXUIElement, id: CGWindowID)] {
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        AXUIElementSetMessagingTimeout(appElement, 1)
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appElement, kAXWindowsAttribute as CFString, &value) == .success,
              let elements = value as? [AXUIElement] else { return [] }
        return elements.compactMap { element in windowId(of: element).map { (element, $0) } }
    }

    /// The window server's id for an accessibility window: the id the router claims and the
    /// harness sends back in every `Target`.
    static func windowId(of element: AXUIElement) -> CGWindowID? {
        var id: CGWindowID = 0
        guard _AXUIElementGetWindow(element, &id) == .success, id != 0 else { return nil }
        return id
    }

    private static func info(for element: AXUIElement, id: CGWindowID, app: NSRunningApplication) -> WindowInfo? {
        guard let frame = frame(of: element), let bundleId = app.bundleIdentifier else { return nil }
        return WindowInfo(
            windowId: Int(id),
            bundleId: bundleId,
            appName: app.localizedName ?? bundleId,
            title: string(element, kAXTitleAttribute) ?? "",
            frame: Rect(frame),
            minimized: bool(element, kAXMinimizedAttribute) ?? false
        )
    }

    private static func frame(of element: AXUIElement) -> CGRect? {
        guard let position = axValue(element, kAXPositionAttribute, type: .cgPoint),
              let size = axValue(element, kAXSizeAttribute, type: .cgSize) else { return nil }
        var origin = CGPoint.zero
        var dimensions = CGSize.zero
        guard AXValueGetValue(position, .cgPoint, &origin), AXValueGetValue(size, .cgSize, &dimensions) else { return nil }
        return CGRect(origin: origin, size: dimensions)
    }

    private static func axValue(_ element: AXUIElement, _ attribute: String, type: AXValueType) -> AXValue? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &raw) == .success,
              let raw, CFGetTypeID(raw) == AXValueGetTypeID() else { return nil }
        let value = raw as! AXValue
        return AXValueGetType(value) == type ? value : nil
    }

    static func string(_ element: AXUIElement, _ attribute: String) -> String? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &raw) == .success else { return nil }
        return raw as? String
    }

    private static func bool(_ element: AXUIElement, _ attribute: String) -> Bool? {
        var raw: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &raw) == .success else { return nil }
        return raw as? Bool
    }
}

extension Rect {
    init(_ frame: CGRect) {
        self.init(x: frame.origin.x, y: frame.origin.y, width: frame.size.width, height: frame.size.height)
    }
}
