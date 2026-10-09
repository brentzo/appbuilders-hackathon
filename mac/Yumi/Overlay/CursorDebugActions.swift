import AppKit
import YumiProtocol

/// The "Cursor debug" menu (OBJ-18.7). Each action builds the same `CursorCommand` the harness
/// sends, so it exercises the real path.
@MainActor
struct CursorDebugActions {
    let overlay: CursorOverlay

    func spawnMain() {
        overlay.apply(.spawn(SpawnCursor(cursorId: "main", cursorKind: .main)))
    }

    func spawnGhost() {
        let ghosts = overlay.cursors.values.filter { $0.kind == .ghost }.count
        let point = randomPoint(on: NSScreen.main)
        overlay.apply(.spawn(SpawnCursor(
            cursorId: "ghost-\(ghosts + 1)", cursorKind: .ghost, label: "Fill expense form", at: .point(point)
        )))
    }

    /// Moves every cursor to a new random point on the display it is on.
    func moveAll() {
        for cursor in overlay.cursors.values {
            let screen = NSScreen.screens.first { $0.frame.contains(cursor.position) } ?? NSScreen.main
            overlay.apply(.move(MoveCursor(cursorId: cursor.id, to: .point(randomPoint(on: screen)))))
        }
    }

    /// Moves the main cursor onto the next display ("Cursor works on a second display").
    func moveMainToNextDisplay() {
        guard let main = overlay.cursors["main"] else { return }
        let screens = NSScreen.screens
        let current = screens.firstIndex { $0.frame.contains(main.position) } ?? 0
        let next = screens[(current + 1) % screens.count]
        overlay.apply(.move(MoveCursor(cursorId: "main", to: .point(randomPoint(on: next)))))
    }

    /// Three cursors moving at once (OBJ-18 expectation).
    func threeAtOnce() {
        if overlay.cursors["main"] == nil { spawnMain() }
        while overlay.cursors.count < 3 { spawnGhost() }
        moveAll()
    }

    func setState(_ state: CursorState) {
        for id in overlay.cursors.keys {
            overlay.apply(.setState(SetCursorState(cursorId: id, state: state)))
        }
    }

    func setLabel() {
        overlay.apply(.setLabel(SetCursorLabel(cursorId: "main", label: "Export the deck")))
    }

    func toggleHelperChip() {
        if overlay.helperChipCount > 0 {
            overlay.removeHelperChip(id: "debug-helper")
        } else {
            overlay.showHelperChip(id: "debug-helper", text: "Helper working")
        }
    }

    func fadeAll() {
        for id in overlay.cursors.keys {
            overlay.apply(.fade(FadeCursor(cursorId: id)))
        }
        overlay.removeHelperChip(id: "debug-helper")
    }

    /// A random point well inside a display, in protocol (top-left) coordinates.
    private func randomPoint(on screen: NSScreen?) -> ScreenPoint {
        let frame = (screen ?? NSScreen.screens[0]).visibleFrame.insetBy(dx: 120, dy: 120)
        let appKit = CGPoint(x: .random(in: frame.minX...frame.maxX), y: .random(in: frame.minY...frame.maxY))
        let global = ScreenGeometry.globalTopLeftPoint(fromAppKit: appKit)
        return ScreenPoint(x: global.x, y: global.y)
    }
}
