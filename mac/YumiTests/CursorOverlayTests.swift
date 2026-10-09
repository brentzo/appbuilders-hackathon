import AppKit
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
        #expect(CursorOverlay.moveDuration == 0.3)
    }
}
