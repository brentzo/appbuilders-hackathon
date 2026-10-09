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

    /// `-YumiCursorDemo YES` (Debug builds): the main cat drops out of the island (the camera notch,
    /// or a pill under the menu bar) and goes through its states, three ghosts follow it out (one
    /// gets a move mid-spawn), everyone leaps around, the ghosts leap back into the island, and
    /// the main cat fades. For screen recordings.
    func playDemo() {
        guard let screen = NSScreen.main else { return }
        let frame = screen.visibleFrame
        func point(_ fx: CGFloat, _ fy: CGFloat) -> CursorTarget {
            let global = ScreenGeometry.globalTopLeftPoint(fromAppKit: CGPoint(x: frame.minX + frame.width * fx, y: frame.minY + frame.height * fy))
            return .point(ScreenPoint(x: global.x, y: global.y))
        }
        let ghosts = [("ghost-1", "Fill expense form", point(0.3, 0.7)), ("ghost-2", "Rename the invoices in Downloads by client and month, then file them", point(0.72, 0.68)), ("ghost-3", "Export the deck", point(0.62, 0.3))]
        func spawnGhost(_ index: Int) {
            let (id, label, spot) = ghosts[index]
            overlay.apply(.spawn(SpawnCursor(cursorId: id, cursorKind: .ghost, label: label, at: spot)))
        }
        let steps: [(Double, () -> Void)] = [
            (1.5, { overlay.apply(.spawn(SpawnCursor(cursorId: "main", cursorKind: .main, at: point(0.5, 0.5)))) }),
            (2.3, { overlay.apply(.setLabel(SetCursorLabel(cursorId: "main", label: "Export the deck"))) }),
            (2.7, { setState(.listening) }),
            (3.5, { setState(.thinking) }),
            (4.3, { spawnGhost(0) }),
            (4.6, { spawnGhost(1) }),
            (4.9, { spawnGhost(2) }),
            // Mid-spawn: this ghost changes course from wherever it is.
            (5.2, { overlay.apply(.move(MoveCursor(cursorId: "ghost-3", to: point(0.4, 0.25)))) }),
            (6.4, { setState(.moving); moveTo([point(0.2, 0.35), point(0.8, 0.45), point(0.45, 0.2), point(0.6, 0.8)]) }),
            (7.3, { setState(.acting); overlay.update("ghost-1") { $0.step = "typing the amount" } }),
            // Close under the top of the screen: the bubble flips below the paws.
            (7.8, { overlay.apply(.move(MoveCursor(cursorId: "ghost-3", to: point(0.5, 0.98)))) }),
            (8.1, { setState(.moving); moveTo([point(0.65, 0.55), point(0.35, 0.45), point(0.8, 0.25), point(0.5, 0.98)]) }),
            (9.0, { setState(.waitingForUser) }),
            (9.8, { setState(.stuck) }),
            (10.6, { setState(.done) }),
            (11.6, { for (id, _, _) in ghosts { overlay.apply(.fade(FadeCursor(cursorId: id))) } }),
            (12.8, { setState(.paused) }),
            (13.8, { fadeAll() }),
        ]
        for (delay, step) in steps {
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { MainActor.assumeIsolated { step() } }
        }
    }

    private func moveTo(_ targets: [CursorTarget]) {
        for (id, target) in zip(["main", "ghost-1", "ghost-2", "ghost-3"], targets) where overlay.cursors[id] != nil {
            overlay.apply(.move(MoveCursor(cursorId: id, to: target)))
        }
    }

    /// A random point well inside a display, in protocol (top-left) coordinates.
    private func randomPoint(on screen: NSScreen?) -> ScreenPoint {
        let frame = (screen ?? NSScreen.screens[0]).visibleFrame.insetBy(dx: 120, dy: 120)
        let appKit = CGPoint(x: .random(in: frame.minX...frame.maxX), y: .random(in: frame.minY...frame.maxY))
        let global = ScreenGeometry.globalTopLeftPoint(fromAppKit: appKit)
        return ScreenPoint(x: global.x, y: global.y)
    }
}
