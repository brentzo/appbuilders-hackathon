import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ScreenCaptureKit

/// Captures a target window's image for the p1 vision fallback (SPEC-05 r1.3, r12, OBJ-75).
///
/// `CGWindowListCreateImage` is unavailable on current macOS, so this uses ScreenCaptureKit. It needs
/// Screen Recording permission, which is granted to Yumi once by the user; without it the capture is
/// refused and the app reports the `screenPermissionMissing` error.
@MainActor
enum VisionCapture {
    struct Captured {
        let image: CGImage
        let path: String
    }

    enum Failure: Error {
        case screenPermissionMissing
        case windowNotFound
        case captureFailed
    }

    static func capture(bundleId: String, windowId: Int, windowFrame: CGRect) async throws -> Captured {
        try requireScreenRecording()
        let content: SCShareableContent
        do {
            content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        } catch {
            throw Failure.captureFailed
        }
        guard let window = content.windows.first(where: { Int($0.windowID) == windowId }) else {
            throw Failure.windowNotFound
        }
        let filter = SCContentFilter(desktopIndependentWindow: window)
        let scale = scaleFactor(for: windowFrame)
        let configuration = SCStreamConfiguration()
        configuration.width = Int((window.frame.width * scale).rounded())
        configuration.height = Int((window.frame.height * scale).rounded())
        configuration.showsCursor = false
        let image: CGImage
        do {
            image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
        } catch {
            throw Failure.captureFailed
        }
        let url = url(bundleId: bundleId, windowId: windowId)
        do {
            try writePNG(image, to: url)
        } catch {
            throw Failure.captureFailed
        }
        return Captured(image: image, path: url.path)
    }

    /// Whether Yumi has Screen Recording permission, asking once for it if not.
    private static func requireScreenRecording() throws {
        if CGPreflightScreenCaptureAccess() { return }
        if CGRequestScreenCaptureAccess() { return }
        throw Failure.screenPermissionMissing
    }

    /// The highest backing scale factor of the screens the window is on, so the image is captured at
    /// native resolution and the conversion back to points is exact.
    private static func scaleFactor(for windowFrame: CGRect) -> CGFloat {
        let screens = NSScreen.screens
        let onScreen = screens.first { $0.frame.intersects(windowFrame) }
        return (onScreen ?? screens.first)?.backingScaleFactor ?? 2
    }

    /// `~/Library/Application Support/Yumi/vision/<bundle id>-<window id>-<seconds>.png`.
    private static func url(bundleId: String, windowId: Int) -> URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        let folder = base.appendingPathComponent("Yumi/vision", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        return folder.appendingPathComponent("\(bundleId)-\(windowId)-\(stamp).png")
    }

    private static func writePNG(_ image: CGImage, to url: URL) throws {
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, "public.png" as CFString, 1, nil) else {
            throw Failure.captureFailed
        }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw Failure.captureFailed }
    }
}
