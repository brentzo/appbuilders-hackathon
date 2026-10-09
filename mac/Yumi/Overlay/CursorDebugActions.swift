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

    /// `-YumiCursorDemo YES` (Debug builds): the main cat appears, goes through its states, three
    /// ghosts split out of it and leap around, then everyone fades. For screen recordings.
    func playDemo() {
        guard let screen = NSScreen.main else { return }
        let frame = screen.visibleFrame
        func point(_ fx: CGFloat, _ fy: CGFloat) -> CursorTarget {
            let global = ScreenGeometry.globalTopLeftPoint(fromAppKit: CGPoint(x: frame.minX + frame.width * fx, y: frame.minY + frame.height * fy))
            return .point(ScreenPoint(x: global.x, y: global.y))
        }
        let ghosts = ["ghost-1": "Fill expense form", "ghost-2": "Rename invoices", "ghost-3": "Export the deck"]
        let steps: [(Double, () -> Void)] = [
            (0.5, { overlay.apply(.spawn(SpawnCursor(cursorId: "main", cursorKind: .main, at: point(0.5, 0.5)))) }),
            (1.5, { setState(.listening) }),
            (2.5, { setState(.thinking) }),
            (3.5, {
                for (index, id) in ghosts.keys.sorted().enumerated() {
                    let spot = [point(0.3, 0.7), point(0.72, 0.68), point(0.62, 0.3)][index]
                    overlay.apply(.spawn(SpawnCursor(cursorId: id, cursorKind: .ghost, label: ghosts[id], at: spot)))
                }
            }),
            (4.5, { setState(.moving); moveTo([point(0.2, 0.35), point(0.8, 0.45), point(0.45, 0.2), point(0.6, 0.8)]) }),
            (5.3, { setState(.acting) }),
            (6.3, { setState(.moving); moveTo([point(0.65, 0.55), point(0.35, 0.45), point(0.8, 0.25), point(0.25, 0.75)]) }),
            (7.1, { setState(.waitingForUser) }),
            (8.1, { setState(.stuck) }),
            (9.1, { setState(.done) }),
            (10.1, { for id in ghosts.keys { overlay.apply(.fade(FadeCursor(cursorId: id))) } }),
            (10.8, { setState(.paused) }),
            (11.8, { fadeAll() }),
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
