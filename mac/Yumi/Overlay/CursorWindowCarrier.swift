import AppKit

/// Lets a cat carry windows while Yumi tiles them (OBJ-20): the task's cursor leaps to a title
/// bar, pounces, and rides it to the window's tile. Points are global top-left coordinates, like
/// window frames.
@MainActor
struct CursorWindowCarrier: WindowCarrier {
    let overlay: CursorOverlay

    /// The main cat when it is on screen, otherwise a ghost. Cursors do not say which task they
    /// belong to, so this is the best guess for "the task's cursor".
    func cursorId() -> String? {
        if overlay.cursors["main"] != nil { return "main" }
        return overlay.cursors.values.filter { $0.kind == .ghost }.map(\.id).sorted().first
    }

    func leap(_ cursorId: String, to point: CGPoint) -> TimeInterval {
        overlay.move(id: cursorId, to: ScreenGeometry.appKitPoint(fromGlobalTopLeft: point))
    }

    func ride(_ cursorId: String, to point: CGPoint, duration: TimeInterval) {
        overlay.glide(id: cursorId, to: ScreenGeometry.appKitPoint(fromGlobalTopLeft: point), duration: duration)
    }

    func pounce(_ cursorId: String) {
        overlay.pounce(id: cursorId)
    }
}
