import CoreGraphics
import Testing
@testable import Yumi

/// `observeWindow` finds the window the router claimed by its window server id, never by frame,
/// so a window that was just opened or is moving is still found.
@MainActor
struct WindowIdMatchTests {
    struct FakeWindow: Equatable {
        let id: CGWindowID?
        let frame: CGRect?
    }

    @Test func findsTheWindowByItsIdWhateverItsFrame() {
        let claimed = FakeWindow(id: 32275, frame: nil) // just opened: no frame yet
        let other = FakeWindow(id: 100, frame: CGRect(x: 0, y: 0, width: 800, height: 600))
        let moving = FakeWindow(id: 200, frame: CGRect(x: 13.5, y: 40.25, width: 801, height: 599))
        let windows = [other, FakeWindow(id: nil, frame: nil), claimed, moving]
        #expect(WindowReader.window(32275, among: windows, idOf: \.id) == claimed)
        #expect(WindowReader.window(200, among: windows, idOf: \.id) == moving)
        #expect(WindowReader.window(7, among: windows, idOf: \.id) == nil)
    }
}
