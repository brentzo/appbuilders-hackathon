import AppKit

/// One borderless, transparent, click-through panel covering one display (OBJ-18.1).
final class OverlayPanel: NSPanel {
    let screenFrame: CGRect
    /// The display without the menu bar and the Dock.
    let visibleFrame: CGRect

    init(screen: NSScreen) {
        screenFrame = screen.frame
        visibleFrame = screen.visibleFrame
        super.init(contentRect: screen.frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        // Never takes a click: the user's own clicks reach the app underneath (SPEC-04 r7).
        ignoresMouseEvents = true
        isReleasedWhenClosed = false
        // Above normal windows and the Dock, below the system's own pointer.
        level = .screenSaver
        // On every Space, and over full-screen apps.
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        let view = NSView(frame: CGRect(origin: .zero, size: screen.frame.size))
        view.wantsLayer = true
        view.layer?.masksToBounds = true
        contentView = view
        setFrame(screen.frame, display: false)
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    var rootLayer: CALayer { contentView!.layer! }

    /// A global AppKit point in this panel's own coordinates.
    func local(_ point: CGPoint) -> CGPoint {
        CGPoint(x: point.x - screenFrame.minX, y: point.y - screenFrame.minY)
    }
}
