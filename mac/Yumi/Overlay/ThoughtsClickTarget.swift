import AppKit
import OSLog

/// Lets the user click a cat's bubble, a helper chip, or an open thoughts panel in Debug mode,
/// while the overlay itself stays click-through everywhere (SPEC-04 r7, OBJ-53).
///
/// The overlay panels never take a click. Instead, while the pointer is over one of these targets,
/// a small transparent panel the size of that target sits under it and takes the click. Anywhere
/// else, it is gone. It never activates Yumi, never becomes key, and it counts as one of Yumi's own
/// windows, so clicking it is not the user taking over (SPEC-06 r2).
@MainActor
final class ThoughtsClickTarget {
    /// The targets on screen now, in global AppKit coordinates.
    var targets: () -> [(target: ThoughtTarget, frame: CGRect)] = { [] }
    var onClick: (ThoughtTarget) -> Void = { _ in }
    // Replaced in tests.
    var pointer: () -> CGPoint = { NSEvent.mouseLocation }
    /// Whether to watch the pointer and show the click panel for real; tests call `pointerMoved`.
    var watchesPointer = true

    /// The target under the pointer, which the click panel covers.
    private(set) var hovered: (target: ThoughtTarget, frame: CGRect)?
    private(set) var isActive = false
    private lazy var panel = ClickPanel { [weak self] in self?.click() }
    private var monitors: [Any] = []
    /// While the click panel shows: the pointer inside it sends no events to the monitors, and the
    /// target can move away from under a resting pointer, so it checks again on a timer.
    private var timer: Timer?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "overlay")

    /// Watches the pointer only in Debug mode. Off, nothing on the overlay takes a click.
    func setActive(_ active: Bool) {
        guard active != isActive else { return }
        isActive = active
        if active, watchesPointer {
            let watched: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]
            let global = NSEvent.addGlobalMonitorForEvents(matching: watched) { [weak self] _ in
                MainActor.assumeIsolated { self?.pointerMoved() }
            }
            let local = NSEvent.addLocalMonitorForEvents(matching: watched) { [weak self] event in
                MainActor.assumeIsolated { self?.pointerMoved() }
                return event
            }
            monitors = [global, local].compactMap { $0 }
        } else {
            for monitor in monitors { NSEvent.removeMonitor(monitor) }
            monitors = []
        }
        pointerMoved()
    }

    /// Puts the click panel under the pointer if it is over a target, and takes it away otherwise.
    func pointerMoved() {
        let point = pointer()
        let next = isActive ? targets().first { $0.frame.contains(point) } : nil
        hovered = next
        guard watchesPointer else { return }
        if let next {
            panel.setFrame(next.frame, display: false)
            if !panel.isVisible { panel.orderFrontRegardless() }
            if timer == nil {
                timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 30, repeats: true) { [weak self] _ in
                    MainActor.assumeIsolated { self?.pointerMoved() }
                }
            }
        } else {
            if panel.isVisible { panel.orderOut(nil) }
            timer?.invalidate()
            timer = nil
        }
    }

    /// A click on the hovered target. Internal so tests can click without a screen.
    func click() {
        guard let target = hovered?.target else { return }
        log.info("Thoughts panel clicked")
        onClick(target)
        // The bubble became a panel, or the panel a bubble: cover the new shape.
        pointerMoved()
    }

    /// Covers one target and takes its clicks. Transparent, but it takes events everywhere in its
    /// frame because `ignoresMouseEvents` is set to false explicitly.
    private final class ClickPanel: NSPanel {
        init(onClick: @escaping () -> Void) {
            super.init(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
            isOpaque = false
            backgroundColor = .clear
            hasShadow = false
            ignoresMouseEvents = false
            isReleasedWhenClosed = false
            hidesOnDeactivate = false
            // The overlay's level; ordered in front of it whenever it shows.
            level = .screenSaver
            collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
            contentView = ClickView(onClick: onClick)
        }

        override var canBecomeKey: Bool { false }
        override var canBecomeMain: Bool { false }
    }

    private final class ClickView: NSView {
        let onClick: () -> Void

        init(onClick: @escaping () -> Void) {
            self.onClick = onClick
            super.init(frame: .zero)
        }

        @available(*, unavailable)
        required init?(coder: NSCoder) { fatalError("not used") }

        // Yumi is never the active app here, so the first click has to count.
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

        override func mouseDown(with event: NSEvent) {
            onClick()
        }
    }
}
