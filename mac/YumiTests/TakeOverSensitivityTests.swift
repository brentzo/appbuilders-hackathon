import AppKit
import Testing
import YumiProtocol
@testable import Yumi

/// SPEC-06 r2 as decided 2026-10-10: a take-over is a real click, a key press, a scroll, or a
/// deliberate pointer move (more than about 80 points within about half a second). Jiggles,
/// trackpad bumps, and reaching for Yumi's own bubbles, panels, chips, and windows never count.
@MainActor
struct TakeOverSensitivityTests {
    struct NoElements: ElementLocating {
        func locate(_ target: ElementTarget) -> CGPoint? { nil }
    }

    /// Feeds moves at 60 per second along `points`, starting at `start`. Returns the time after the last.
    @discardableResult
    private func move(_ reach: inout PointerReach, through points: [CGPoint], from start: TimeInterval = 0) -> TimeInterval {
        var time = start
        for point in points {
            reach.moved(to: point, at: time)
            time += 1.0 / 60
        }
        return time
    }

    private func line(from a: CGPoint, to b: CGPoint, steps: Int) -> [CGPoint] {
        (0...steps).map { i in
            let t = CGFloat(i) / CGFloat(steps)
            return CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
        }
    }

    @Test func aJiggleIsNotTakingOver() {
        var reach = PointerReach()
        // Back and forth by 6 points for 2 seconds: lots of travel, but never far.
        let jiggle = (0..<120).map { CGPoint(x: 500 + ($0 % 2 == 0 ? 0 : 6), y: 400) }
        let end = move(&reach, through: jiggle)
        #expect(reach.pending == nil)
        #expect(reach.settle(at: end + 1, overYumi: false) == nil)
    }

    @Test func aTrackpadBumpIsNotTakingOver() {
        var reach = PointerReach()
        let end = move(&reach, through: line(from: CGPoint(x: 500, y: 400), to: CGPoint(x: 540, y: 420), steps: 6))
        #expect(reach.settle(at: end + 1, overYumi: false) == nil)
    }

    @Test func aSlowDriftIsNotTakingOver() {
        var reach = PointerReach()
        // 150 points over 3 seconds: never 80 within half a second.
        let end = move(&reach, through: line(from: CGPoint(x: 100, y: 100), to: CGPoint(x: 250, y: 100), steps: 180))
        #expect(reach.pending == nil)
        #expect(reach.settle(at: end + 1, overYumi: false) == nil)
    }

    @Test func aDeliberateMoveIsTakingOverOnceThePointerRests() {
        var reach = PointerReach()
        // 400 points in a quarter second.
        let end = move(&reach, through: line(from: CGPoint(x: 100, y: 100), to: CGPoint(x: 500, y: 100), steps: 15))
        #expect(reach.pending != nil)
        // Still moving a moment ago: not judged yet.
        #expect(reach.settle(at: end, overYumi: false) == nil)
        #expect(reach.pending != nil)
        let distance = reach.settle(at: end + PointerReach.rest, overYumi: false)
        #expect((distance ?? 0) > PointerReach.distance)
        #expect(reach.pending == nil)
    }

    @Test func reachingForACatsBubbleIsNotTakingOver() {
        var reach = PointerReach()
        let end = move(&reach, through: line(from: CGPoint(x: 100, y: 100), to: CGPoint(x: 700, y: 500), steps: 20))
        // It ends on the bubble: as it arrives, or by the time it rests.
        reach.reachedYumi()
        #expect(reach.settle(at: end + 1, overYumi: true) == nil)

        var resting = PointerReach()
        let stop = move(&resting, through: line(from: CGPoint(x: 100, y: 100), to: CGPoint(x: 700, y: 500), steps: 20))
        #expect(resting.settle(at: stop + PointerReach.rest, overYumi: true) == nil)
    }

    @Test func aMoveThatNeverRestsIsJudgedSoon() {
        var reach = PointerReach()
        // Circling fast for a second.
        let circle = (0..<60).map { i in CGPoint(x: 500 + 150 * cos(Double(i) / 6), y: 500 + 150 * sin(Double(i) / 6)) }
        var time: TimeInterval = 0
        var judged: CGFloat?
        for point in circle where judged == nil {
            reach.moved(to: point, at: time)
            judged = reach.settle(at: time, overYumi: false)
            time += 1.0 / 60
        }
        #expect(judged != nil)
        #expect(time <= PointerReach.longest + PointerReach.window)
    }

    @Test func onlyDeliberateMovesAndRealInputCount() {
        func input(move: Bool = false, deliberate: Bool = false, overYumi: Bool = false, keyboard: Bool = false) -> TakeOverRule.Input {
            .init(tagged: false, isKeyboard: keyboard, overYumiWindow: overYumi, yumiHasKeyboard: false, isPointerMove: move, deliberate: deliberate)
        }
        #expect(!TakeOverRule.isTakeOver(input(move: true), uiLaneActing: true), "a small move")
        #expect(TakeOverRule.isTakeOver(input(move: true, deliberate: true), uiLaneActing: true), "a deliberate move")
        #expect(TakeOverRule.isTakeOver(input(), uiLaneActing: true), "a click or a scroll")
        #expect(TakeOverRule.isTakeOver(input(keyboard: true), uiLaneActing: true), "a key press")
        #expect(!TakeOverRule.isTakeOver(input(overYumi: true), uiLaneActing: true), "a click on Yumi's bubble or card")
        #expect(!TakeOverRule.isTakeOver(input(move: true, deliberate: true), uiLaneActing: false), "Yumi waits for the user")
    }

    @Test func theLogNamesTheEvent() {
        #expect(TakeOverWatcher.describe(.leftMouseDown) == "a click")
        #expect(TakeOverWatcher.describe(.scrollWheel) == "a scroll")
        #expect(TakeOverWatcher.describe(.keyDown) == "a key press")
    }

    @Test func catsBubblesAndChipsAreYumisOwnInAnyMode() {
        let overlay = CursorOverlay(locator: NoElements())
        overlay.avoider.watchesPointer = false
        overlay.thoughtsClicks.watchesPointer = false
        overlay.start()
        defer { overlay.fadeAll() }
        let frame = NSScreen.screens[0].visibleFrame
        overlay.spawn(id: "ghost-1", kind: .ghost, label: "Fill expense form", at: CGPoint(x: frame.midX, y: frame.midY))
        overlay.showHelperChip(id: "h1", text: "Helper working")
        // Debug mode off: nothing is clickable, but the pointer on them is still the user using Yumi.
        #expect(!overlay.debugMode)
        #expect(overlay.thoughtsTargets().isEmpty)
        #expect(overlay.ownFrames.count == 3, "the cat, its bubble, and the chip")
        #expect(overlay.ownFrames.allSatisfy { !$0.isEmpty })
    }
}

/// The live check of 2026-10-10: Brent resumed a Keynote export, its ghost leapt out of the island
/// again, he clicked that cat, and the task paused again, over and over ("The user took over: a
/// click" right after each routeDecided). The cat itself is Yumi's own, like its bubble.
@MainActor
struct ResumeTakeOverTests {
    struct NoElements: ElementLocating {
        func locate(_ target: ElementTarget) -> CGPoint? { nil }
    }

    @Test func clickingTheCatThatAppearsOnResumeIsNotTakingOver() throws {
        let overlay = CursorOverlay(locator: NoElements())
        overlay.avoider.watchesPointer = false
        overlay.thoughtsClicks.watchesPointer = false
        overlay.start()
        defer { overlay.fadeAll() }
        let frame = NSScreen.screens[0].visibleFrame
        let spot = CGPoint(x: frame.midX, y: frame.midY)
        // Resume: the harness spawns the task's ghost again, labelled with its subtask.
        overlay.spawn(id: "ghost-1", kind: .ghost, label: "Export the deck as a PDF", at: spot)
        let drawn = try #require(overlay.drawings(of: "ghost-1").first)
        // Where the cat lands, in global coordinates (its spawn leap is drawn there now).
        let paws = CGPoint(x: drawn.layer.root.position.x + drawn.panel.screenFrame.minX, y: drawn.layer.root.position.y + drawn.panel.screenFrame.minY)
        let body = PointerAvoidance.body(at: paws)
        let onCat = CGPoint(x: body.midX, y: body.midY)

        let overYumi = overlay.ownFrames.contains { $0.contains(onCat) }
        #expect(overYumi, "the cat's own body is Yumi's")
        let click = TakeOverRule.Input(tagged: false, isKeyboard: false, overYumiWindow: overYumi, yumiHasKeyboard: false)
        #expect(!TakeOverRule.isTakeOver(click, uiLaneActing: true))

        // A reach that comes to rest on the cat is the user using Yumi too.
        var reach = PointerReach()
        reach.moved(to: CGPoint(x: onCat.x - 300, y: onCat.y - 200), at: 0)
        reach.moved(to: onCat, at: 0.2)
        #expect(reach.settle(at: 0.2 + PointerReach.rest, overYumi: overYumi) == nil)

        // Off the cat, a click is still the user's own (SPEC-06 r2).
        let away = CGPoint(x: body.maxX + 120, y: body.midY)
        #expect(!overlay.ownFrames.contains { $0.contains(away) })
    }
}

/// Brent's second live check, 2026-10-10 (task 110cedcd): every Resume paused again 0.25 to 0.9 s
/// after the local stop lifted, with "The user took over: a pointer move of 81 to 128 points". His
/// hand was just leaving the Resume button on the paused panel, which is Yumi's own.
struct LeavingYumiTests {
    @Test func theHandLeavingTheResumeButtonIsNotTakingOver() {
        var reach = PointerReach()
        let resume = CGPoint(x: 756, y: 900)
        // The pointer is on the paused panel and presses Resume: Yumi's own window.
        reach.reachedYumi(at: 0)
        // The stop lifts a moment later and the hand moves away, 120 points in a quarter second.
        var time: TimeInterval = 0.3
        for step in 1...15 {
            reach.moved(to: CGPoint(x: resume.x + CGFloat(step) * 6, y: resume.y - CGFloat(step) * 5), at: time)
            time += 1.0 / 60
        }
        #expect(reach.settle(at: time + PointerReach.rest, overYumi: false) == nil)
    }

    @Test func aDeliberateMoveLaterStillCounts() {
        var reach = PointerReach()
        reach.reachedYumi(at: 0)
        var time = PointerReach.leavingYumi + 0.5
        for step in 0...15 {
            reach.moved(to: CGPoint(x: 100 + CGFloat(step) * 20, y: 300), at: time)
            time += 1.0 / 60
        }
        #expect((reach.settle(at: time + PointerReach.rest, overYumi: false) ?? 0) > PointerReach.distance)
    }

    @Test func aMoveThatKeepsGoingPastTheGraceCountsFromThere() {
        var reach = PointerReach()
        reach.reachedYumi(at: 0)
        // Slow-ish but long: inside the grace nothing counts, after it 80 points in half a second do.
        var time: TimeInterval = 0.2
        var x: CGFloat = 0
        while time < PointerReach.leavingYumi + 0.6 {
            reach.moved(to: CGPoint(x: x, y: 0), at: time)
            x += 4
            time += 1.0 / 60
        }
        #expect(reach.pending != nil, "about 140 points in the half second after the grace")
    }
}
