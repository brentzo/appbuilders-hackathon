import AppKit

/// The display where the task started (OBJ-20.4): the one with the main cursor, which appears next
/// to the user's pointer when a task starts (OBJ-18). Without a main cursor, the pointer's display.
@MainActor
enum TaskDisplay {
    static func screen(_ overlay: CursorOverlay) -> NSScreen? {
        let point = overlay.cursors.values.first { $0.kind == .main }?.position ?? NSEvent.mouseLocation
        return NSScreen.screens.first { $0.frame.contains(point) } ?? NSScreen.main
    }

    /// The visible part of that display, without the menu bar and Dock, in global top-left coordinates.
    static func area(_ overlay: CursorOverlay) -> CGRect? {
        screen(overlay).map { ScreenGeometry.globalTopLeftRect(fromAppKit: $0.visibleFrame) }
    }
}
