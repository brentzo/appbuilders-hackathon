import AppKit
import CoreGraphics
import YumiProtocol

/// Finds where an `ElementTarget` is on screen, in AppKit global coordinates.
protocol ElementLocating {
    @MainActor func locate(_ target: ElementTarget) -> CGPoint?
}

/// Points at the center of the element at `elementPath`, resolved through the Accessibility API
/// (OBJ-39). When the path does not resolve, for example without Accessibility permission, it
/// falls back to the window's center.
struct AccessibilityElementLocator: ElementLocating {
    var fallback: ElementLocating = WindowCenterLocator()

    func locate(_ target: ElementTarget) -> CGPoint? {
        if let node = try? WindowReader.resolve(target.elementPath, in: target.target), let frame = node.frame {
            return ScreenGeometry.appKitPoint(fromGlobalTopLeft: CGPoint(x: frame.midX, y: frame.midY))
        }
        return fallback.locate(target)
    }
}

/// Points at the center of the target window, or of the app's frontmost window when that window
/// id is not on screen. Window bounds need no Screen Recording permission.
struct WindowCenterLocator: ElementLocating {
    func locate(_ target: ElementTarget) -> CGPoint? {
        let bounds = target.target.windowId.flatMap(Self.bounds(ofWindow:))
            ?? Self.frontmostWindowBounds(ofApp: target.target.bundleId)
        guard let bounds else { return nil }
        let rect = ScreenGeometry.appKitRect(fromGlobalTopLeft: bounds)
        return CGPoint(x: rect.midX, y: rect.midY)
    }

    private static func bounds(ofWindow id: Int) -> CGRect? {
        let info = CGWindowListCopyWindowInfo([.optionIncludingWindow], CGWindowID(id)) as? [[String: Any]]
        return info?.first.flatMap(rect(of:))
    }

    /// Windows come front to back, so the first normal window of the app is its frontmost.
    private static func frontmostWindowBounds(ofApp bundleId: String) -> CGRect? {
        guard let pid = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first?.processIdentifier,
              let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]]
        else { return nil }
        return windows.first {
            ($0[kCGWindowOwnerPID as String] as? Int32) == pid && ($0[kCGWindowLayer as String] as? Int) == 0
        }.flatMap(rect(of:))
    }

    private static func rect(of window: [String: Any]) -> CGRect? {
        guard let dict = window[kCGWindowBounds as String] as? NSDictionary else { return nil }
        return CGRect(dictionaryRepresentation: dict as CFDictionary)
    }
}
