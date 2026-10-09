import AppKit
import Observation
import Testing
import YumiProtocol
@testable import Yumi

@MainActor
struct CursorOverlayTests {
    struct NoElements: ElementLocating {
        func locate(_ target: ElementTarget) -> CGPoint? { nil }
    }

    private func overlay() -> CursorOverlay {
        let overlay = CursorOverlay(locator: NoElements())
        overlay.start()
        return overlay
    }

    @Test func protocolPointsUseTopLeftGlobalCoordinates() {
        let height = ScreenGeometry.mainDisplayHeight
        // The top-left corner of the main display.
        #expect(ScreenGeometry.appKitPoint(fromGlobalTopLeft: .zero) == CGPoint(x: 0, y: height))
        // A display above the main one has negative protocol y.
        #expect(ScreenGeometry.appKitPoint(fromGlobalTopLeft: CGPoint(x: 10, y: -100)) == CGPoint(x: 10, y: height + 100))
        let round = ScreenGeometry.globalTopLeftPoint(fromAppKit: ScreenGeometry.appKitPoint(fromGlobalTopLeft: CGPoint(x: -300, y: 42)))
        #expect(round == CGPoint(x: -300, y: 42))
    }

    @Test func oneClickThroughPanelPerDisplay() {
        // "Overlay does not block the user".
        let overlay = overlay()
        defer { overlay.fadeAll() }
        #expect(overlay.panelCount == NSScreen.screens.count)
        #expect(overlay.isClickThrough)
    }

    @Test func harnessCommandsDriveTheCursors() {
        let overlay = overlay()
        defer { overlay.fadeAll() }

        overlay.apply(.spawn(SpawnCursor(cursorId: "main", cursorKind: .main)))
        overlay.apply(.spawn(SpawnCursor(cursorId: "g1", cursorKind: .ghost, label: "Fill expense form", at: .point(ScreenPoint(x: 100, y: 200)))))
        #expect(overlay.cursors["main"]?.accent == nil)
        // "Ghost cursors are labeled": its own color and the subtask title.
        #expect(overlay.cursors["g1"]?.accent != nil)
        #expect(overlay.cursors["g1"]?.label == "Fill expense form")
        #expect(overlay.clickPoint(of: "g1") == CGPoint(x: 100, y: 200))

        overlay.apply(.move(MoveCursor(cursorId: "g1", to: .point(ScreenPoint(x: 400, y: 300)))))
        #expect(overlay.clickPoint(of: "g1") == CGPoint(x: 400, y: 300))

        overlay.apply(.setState(SetCursorState(cursorId: "main", state: .thinking)))
        #expect(overlay.cursors["main"]?.state == .thinking)
        overlay.apply(.setLabel(SetCursorLabel(cursorId: "main", label: "Export the deck")))
        #expect(overlay.cursors["main"]?.label == "Export the deck")

        // An element the app cannot find leaves the cursor where it is.
        let element = CursorTarget.element(ElementTarget(target: Target(bundleId: "com.apple.iWork.Keynote", windowId: 1), elementPath: "AXApplication"))
        overlay.apply(.move(MoveCursor(cursorId: "g1", to: element)))
        #expect(overlay.clickPoint(of: "g1") == CGPoint(x: 400, y: 300))

        overlay.apply(.fade(FadeCursor(cursorId: "g1")))
        #expect(overlay.cursors["g1"] == nil)
    }

    @Test func cursorsLeaveWhenTheTaskEnds() {
        // "Cursors leave when the task ends": every cursor fades, well inside 1 second.
        let overlay = overlay()
        overlay.apply(.spawn(SpawnCursor(cursorId: "main", cursorKind: .main)))
        overlay.apply(.spawn(SpawnCursor(cursorId: "g1", cursorKind: .ghost)))
        overlay.showHelperChip(id: "h1", text: "Helper working")
        overlay.fadeAll()
        #expect(overlay.cursors.isEmpty)
        #expect(overlay.helperChipCount == 0)
        #expect(CursorOverlay.fadeOutDuration < 1)
        // Ghosts leap back into the island: their longest trip also ends within 1 second.
        #expect(CursorMotion.longestMove < 1)
    }

    @Test func movesArcLikeALeapAndEndOnTheTarget() {
        // SPEC-04 r2: never a jump; the path is a curve that lands exactly on the target.
        let start = CGPoint(x: 100, y: 100), end = CGPoint(x: 500, y: 100)
        var points: [CGPoint] = []
        CursorMotion.path(from: start, to: end).applyWithBlock { element in
            let count = element.pointee.type == .addCurveToPoint ? 3 : 1
            points += (0..<count).map { element.pointee.points[$0] }
        }
        #expect(points.first == start)
        #expect(points.last == end)
        #expect(points.count == 4, "one cubic Bezier")
        #expect(points[1].y > start.y && points[2].y > start.y, "arcs upward a little")
        #expect(CursorMotion.path(from: start, to: end, arcs: false).boundingBox.height == 0, "Reduce Motion glides straight")
        // The click point is the paw spot, inside the cat's image.
        #expect((0...1).contains(CursorLayer.hotspot.x) && (0...1).contains(CursorLayer.hotspot.y))
    }

    @Test func movesEaseInAndOutOverATimeThatGrowsWithDistance() {
        #expect(CursorMotion.duration(for: 0) == 0.35)
        #expect(CursorMotion.duration(for: 400) > 0.35 && CursorMotion.duration(for: 400) < 0.7)
        #expect(CursorMotion.duration(for: 3000) == 0.7)
        #expect(abs(CursorMotion.eased(0.5) - 0.5) < 1e-6, "symmetric")

        // The frames themselves: small steps at both ends, large in the middle, on the arc and on
        // the Reduce Motion line alike.
        for arcs in [true, false] {
            let points = CursorMotion.positions(from: CGPoint(x: 100, y: 100), to: CGPoint(x: 700, y: 300), arcs: arcs, duration: 0.6)
            let steps = zip(points, points.dropFirst()).map { hypot($1.x - $0.x, $1.y - $0.y) }
            let middle = steps[steps.count / 2]
            #expect(points.last == CGPoint(x: 700, y: 300))
            #expect(steps.first! < middle / 10, "slow start: \(steps.first!) vs \(middle)")
            #expect(steps.last! < middle / 10, "soft landing: \(steps.last!) vs \(middle)")
        }
    }

    @Test func theBubbleShowsTheTaskAndStepAndFlipsBelowNearTheTop() throws {
        var cursor = OverlayCursor(id: "g1", kind: .ghost, state: .acting, label: "Fill expense form", palette: .mint, position: CGPoint(x: 400, y: 400))
        #expect(cursor.bubbleText == "Fill expense form")
        cursor.step = "typing the amount"
        #expect(cursor.bubbleText == "Fill expense form · typing the amount")
        cursor.step = nil
        cursor.state = .waitingForUser
        #expect(cursor.bubbleText == "Fill expense form · waiting for you", "the state stands in for the step")
        cursor.transcript = "export my keynote"
        #expect(cursor.bubbleText == "export my keynote", "what the user says comes first")

        // At most two lines and 240 points wide.
        let long = String(repeating: "Rename the invoices in Downloads by client ", count: 4)
        let card = CursorBubble.cardSize(for: long)
        #expect(card.width <= CursorBubble.maxWidth)
        #expect(card.height < CursorBubble.cardSize(for: "Hi").height * 2)

        // Above the cat in the middle of the screen; below the paws right under the top edge.
        let visible = CGRect(x: 0, y: 0, width: 1440, height: 870)
        #expect(!CursorLayer.bubbleNeedsFlip("Export the deck", at: CGPoint(x: 700, y: 400), visible: visible))
        #expect(CursorLayer.bubbleNeedsFlip("Export the deck", at: CGPoint(x: 700, y: 850), visible: visible))

        // Optional picture for a human: TEST_RUNNER_YUMI_RENDER_DIR=<dir> writes the bubbles as PNG.
        if let directory = ProcessInfo.processInfo.environment["YUMI_RENDER_DIR"] {
            let samples: [(OverlayCursor, Bool)] = [
                (OverlayCursor(id: "m", kind: .main, state: .thinking, label: "Export the deck", position: .zero), false),
                (OverlayCursor(id: "a", kind: .ghost, state: .acting, label: "Fill expense form", step: "typing the amount", palette: .mint, position: .zero), false),
                (OverlayCursor(id: "b", kind: .ghost, state: .moving, label: long, palette: .sky, position: .zero), false),
                (OverlayCursor(id: "c", kind: .ghost, state: .waitingForUser, label: "Export the deck", palette: .slate, position: .zero), true),
                (OverlayCursor(id: "t", kind: .main, state: .listening, transcript: "export my keynote deck as a", position: .zero), false),
            ]
            try render(samples, to: URL(fileURLWithPath: directory).appendingPathComponent("bubbles@2x.png"))
        }
    }

    private func render(_ samples: [(OverlayCursor, Bool)], to file: URL) throws {
        let cell = CGSize(width: 300, height: 170), scale: CGFloat = 2
        let context = try #require(CGContext(
            data: nil, width: Int(cell.width * CGFloat(samples.count) * scale), height: Int(cell.height * scale),
            bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ))
        context.scaleBy(x: scale, y: scale)
        context.setFillColor(NSColor(srgbRed: 0.16, green: 0.17, blue: 0.2, alpha: 1).cgColor)
        context.fill(CGRect(x: 0, y: 0, width: cell.width * CGFloat(samples.count), height: cell.height))
        for (index, (cursor, below)) in samples.enumerated() {
            let layer = CursorLayer()
            layer.setScale(scale)
            layer.bubbleBelow = below
            layer.apply(cursor, scale: scale)
            context.saveGState()
            context.translateBy(x: cell.width * (CGFloat(index) + 0.5), y: below ? 110 : 45)
            layer.root.render(in: context)
            context.restoreGState()
        }
        let image = try #require(context.makeImage())
        try NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])?.write(to: file)
    }

    @Test func cursorChangesNotifyObservers() {
        // The menu panel reads `cursors` in SwiftUI instead of polling.
        let overlay = overlay()
        defer { overlay.fadeAll() }
        let changed = Locked(false)
        withObservationTracking { _ = overlay.cursors } onChange: { changed.set(true) }
        overlay.apply(.spawn(SpawnCursor(cursorId: "main", cursorKind: .main)))
        #expect(changed.get())
    }
}
