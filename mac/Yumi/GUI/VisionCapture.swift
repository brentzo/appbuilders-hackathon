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

    static func capture(bundleId: String, windowId: Int) async throws -> Captured {
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
        let size = Self.imageSize(for: window.frame)
        let configuration = SCStreamConfiguration()
        configuration.width = size.width
        configuration.height = size.height
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

    /// The longest side of the image the model sees. A full Retina capture is about 4.8 million
    /// pixels, which the model server turns into roughly 5,000 vision tokens and a minute before the
    /// first token (Brent's run, 2026-10-10: a worker step hit that and was cut off at 52 s). At this
    /// size the window is still legible and a worker step stays quick.
    static let maxImageSide = 1280

    /// The pixel size to capture, keeping the window's shape and never enlarging it.
    static func imageSize(for frame: CGRect) -> (width: Int, height: Int) {
        let longSide = max(frame.width, frame.height)
        guard longSide > 0 else { return (maxImageSide, maxImageSide) }
        let factor = min(1, CGFloat(maxImageSide) / longSide)
        return (max(1, Int((frame.width * factor).rounded())), max(1, Int((frame.height * factor).rounded())))
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
