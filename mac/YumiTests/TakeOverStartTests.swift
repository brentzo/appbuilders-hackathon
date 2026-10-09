import Testing
import YumiProtocol
@testable import Yumi

/// Clicks and typing in Yumi's own windows never count as taking over (SPEC-06 r2), including the
/// moments after the user answers Yumi: on 2026-10-10, moving the mouse after "Go ahead" paused a
/// task that had only planned, before any cursor moved.
@MainActor
struct TakeOverStartTests {
    @Test func aTaskThatHasNotStartedOnScreenIsNotActing() {
        func acting(stopped: Bool = false, statuses: [TaskStatus] = [.running], cursors: Bool = true, approval: Bool = false, started: Bool = true) -> Bool {
            HarnessLink.uiLaneActing(stopped: stopped, statuses: statuses, hasCursors: cursors, approvalOpen: approval, startedOnScreen: started)
        }
        #expect(acting(), "a cursor works in a running task")
        #expect(!acting(started: false), "running, but the harness has not looked at or acted on a window yet")
        #expect(!acting(statuses: [.planning]), "planning right after Go ahead")
        #expect(!acting(stopped: true))
        #expect(!acting(cursors: false), "only helpers")
        #expect(!acting(approval: true), "Yumi waits on a card")
    }

    @Test func aDragThatBeganOnYumisPanelIsNotTakingOver() {
        let drag = TakeOverRule.Input(tagged: false, isKeyboard: false, overYumiWindow: false, pressBeganOverYumi: true, yumiHasKeyboard: false)
        #expect(!TakeOverRule.isTakeOver(drag, uiLaneActing: true), "the pointer slid off the panel while pressing Go ahead")
        let away = TakeOverRule.Input(tagged: false, isKeyboard: false, overYumiWindow: false, yumiHasKeyboard: false)
        #expect(TakeOverRule.isTakeOver(away, uiLaneActing: true), "the user's own mouse, elsewhere")
    }

    @Test func releasesArePartOfThePressNotAnInputOfTheirOwn() {
        #expect(TakeOverWatcher.watched.contains(.leftMouseUp))
        #expect(TakeOverWatcher.releases.isDisjoint(with: TakeOverWatcher.presses))
        #expect(TakeOverWatcher.drags.isSubset(of: Set(TakeOverWatcher.watched)))
    }

    @Test func windowWorkMarksTheUILaneAsStarted() async throws {
        let gui = GuiExecutor(overlay: nil, isTrusted: { false })
        var started = 0
        gui.onWindowWork = { started += 1 }
        _ = try? await gui.observeWindow(ObserveWindowParams(target: Target(bundleId: "com.apple.finder", windowId: 1)))
        #expect(started == 1)
    }
}
