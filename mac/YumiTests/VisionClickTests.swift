import CoreGraphics
import Testing
import YumiProtocol
@testable import Yumi

/// OBJ-75: the vision fallback's coordinate conversion (SPEC-05 r12) and the rule that decides a
/// window has no actionable content and needs a screenshot.
@MainActor
struct VisionClickTests {
    // MARK: Coordinate conversion (SPEC-05 r12)

    @Test func retinaImageMapsToPoints() {
        // A 2x display: a 1470x810 point window captured as 2940x1620 pixels.
        let frame = CGRect(x: 0, y: 34, width: 1470, height: 810)
        let center = GuiExecutor.screenPoint(imageX: 1470, imageY: 810, imageWidth: 2940, imageHeight: 1620, windowFrame: frame)
        #expect(center.x == 735)
        #expect(center.y == 439)
        let origin = GuiExecutor.screenPoint(imageX: 0, imageY: 0, imageWidth: 2940, imageHeight: 1620, windowFrame: frame)
        #expect(origin.x == 0)
        #expect(origin.y == 34)
    }

    @Test func aDisplayLeftOfTheMainOneHasANegativeOrigin() {
        // The window sits on a display to the left: the frame origin is negative.
        let frame = CGRect(x: -1200, y: 100, width: 1000, height: 700)
        let topLeft = GuiExecutor.screenPoint(imageX: 0, imageY: 0, imageWidth: 2000, imageHeight: 1400, windowFrame: frame)
        #expect(topLeft.x == -1200)
        #expect(topLeft.y == 100)
        let bottomRight = GuiExecutor.screenPoint(imageX: 2000, imageY: 1400, imageWidth: 2000, imageHeight: 1400, windowFrame: frame)
        #expect(bottomRight.x == -200)
        #expect(bottomRight.y == 800)
        let middle = GuiExecutor.screenPoint(imageX: 1000, imageY: 700, imageWidth: 2000, imageHeight: 1400, windowFrame: frame)
        #expect(middle.x == -700)
        #expect(middle.y == 450)
    }

    // MARK: Moved window (SPEC-05 r13)

    @Test func aFrameIsTheSameWithinHalfAPoint() {
        let frame = CGRect(x: 0, y: 34, width: 1470, height: 810)
        #expect(GuiExecutor.sameRect(frame, frame))
        #expect(GuiExecutor.sameRect(frame, CGRect(x: 0.4, y: 34.4, width: 1470.4, height: 810.4)))
        #expect(!GuiExecutor.sameRect(frame, CGRect(x: 1, y: 34, width: 1470, height: 810)))
        #expect(!GuiExecutor.sameRect(frame, CGRect(x: 0, y: 34, width: 1480, height: 810)))
    }

    // MARK: What counts as content (OBJ-75.2)

    @Test func windowChromeAndMenuBarAreNotContent() {
        #expect(!WindowReader.isContentActionable(role: .button, subrole: "AXCloseButton"))
        #expect(!WindowReader.isContentActionable(role: .button, subrole: "AXMinimizeButton"))
        #expect(!WindowReader.isContentActionable(role: .button, subrole: "AXZoomButton"))
        #expect(!WindowReader.isContentActionable(role: .button, subrole: "AXFullScreenButton"))
        #expect(!WindowReader.isContentActionable(role: .menuBarItem, subrole: nil))
        #expect(!WindowReader.isContentActionable(role: .menuItem, subrole: nil))
    }

    @Test func realControlsAreContent() {
        #expect(WindowReader.isContentActionable(role: .button, subrole: nil))
        #expect(WindowReader.isContentActionable(role: .textField, subrole: "AXSearchField"))
        #expect(WindowReader.isContentActionable(role: .row, subrole: nil))
        #expect(WindowReader.isContentActionable(role: .scrollArea, subrole: nil))
    }
}
