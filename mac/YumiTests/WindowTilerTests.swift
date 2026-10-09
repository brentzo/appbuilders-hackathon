import CoreGraphics
import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// OBJ-20, the SPEC-03 "Window tiling" scenarios: ask first, tile on yes, move nothing on no,
/// restore exactly, survive a restart, and tile without asking in demo mode.
@MainActor
struct WindowTilerTests {
    final class FakeWindows: WindowFrames {
        var frames: [Int: Rect]
        var moves: [(Int, Rect)] = []

        init(_ frames: [Int: Rect]) {
            self.frames = frames
        }

        func frame(of windowId: Int) throws -> Rect {
            guard let frame = frames[windowId] else { throw WindowService.Failure.windowNotFound }
            return frame
        }

        func setFrame(of windowId: Int, to rect: Rect) throws {
            guard frames[windowId] != nil else { throw WindowService.Failure.windowNotFound }
            frames[windowId] = rect
            moves.append((windowId, rect))
        }

        func windowIds(bundleId: String) -> [Int] { [] }
    }

    static let area = CGRect(x: 0, y: 34, width: 1710, height: 971)
    static let originals: [Int: Rect] = [
        4182: Rect(x: 120, y: 80, width: 900, height: 600),
        977: Rect(x: 300, y: 150, width: 1100, height: 700),
        51: Rect(x: -1600, y: 20, width: 800, height: 500),
    ]

    let defaults: UserDefaults
    let suite = "ph.appbuilders.yumi.tests.tiling.\(UUID().uuidString.prefix(8))"

    init() {
        defaults = UserDefaults(suiteName: suite)!
    }

    final class Prompt {
        var asked: [String] = []
        var spoken: [String] = []
        var dismissed: [String] = []
        var answer: ((Bool) -> Void)?
    }

    func tiler(_ windows: FakeWindows, demo: Bool = false, prompt: Prompt = Prompt()) -> WindowTiler {
        WindowTiler(
            frames: windows,
            store: TiledLayoutStore(defaults: defaults),
            demoMode: { demo },
            taskArea: { Self.area },
            ask: { taskId, answer in prompt.asked.append(taskId); prompt.answer = answer },
            dismissQuestion: { prompt.dismissed.append($0) },
            say: { prompt.spoken.append($0) }
        )
    }

    let suggestion = TilingSuggested(taskId: "task-1", windows: [
        Target(bundleId: "com.apple.iWork.Keynote", windowId: 4182),
        Target(bundleId: "com.google.Chrome", windowId: 977),
        Target(bundleId: "com.apple.mail", windowId: 51),
    ])

    @Test func yumiAsksBeforeTilingAndMovesNothingOnNo() {
        defer { defaults.removePersistentDomain(forName: suite) }
        let windows = FakeWindows(Self.originals)
        let prompt = Prompt()
        let tiler = tiler(windows, prompt: prompt)

        tiler.suggest(suggestion)
        #expect(prompt.asked == ["task-1"])
        #expect(prompt.spoken == ["Want me to arrange your windows so you can watch all of us work?"])
        #expect(TilingCopy.arrange == "Arrange windows" && TilingCopy.leave == "Leave them")
        #expect(windows.moves.isEmpty, "nothing moves before a yes")

        prompt.answer?(false)
        #expect(windows.moves.isEmpty)
        #expect(!tiler.state.hasSavedLayout)
    }

    @Test func yesTilesEveryWindowAndTheTaskEndPutsThemBackExactly() throws {
        defer { defaults.removePersistentDomain(forName: suite) }
        let windows = FakeWindows(Self.originals)
        let prompt = Prompt()
        let tiler = tiler(windows, prompt: prompt)
        tiler.suggest(suggestion)
        prompt.answer?(true)

        // Saved before anything moved, and kept in the app's own storage.
        #expect(TiledLayoutStore(defaults: defaults).load()["task-1"]?.map(\.frame) == [4182, 977, 51].map { Self.originals[$0]! })
        let tiled = [4182, 977, 51].map { CGRect(windows.frames[$0]!) }
        #expect(tiled == TilingLayout.frames(count: 3, in: Self.area))
        #expect(tiled.allSatisfy { Self.area.contains($0) })

        tiler.taskStatusChanged("task-1", .running)
        #expect(windows.frames != Self.originals)
        tiler.taskStatusChanged("task-1", .cancelled)
        #expect(windows.frames == Self.originals)
        #expect(!tiler.state.hasSavedLayout)
        #expect(TiledLayoutStore(defaults: defaults).load().isEmpty)
    }

    @Test func layoutIsRestoredAfterARestart() {
        defer { defaults.removePersistentDomain(forName: suite) }
        let windows = FakeWindows(Self.originals)
        let prompt = Prompt()
        // The app keeps its tiler for its whole life; the answer goes to a live one.
        let beforeRestart = tiler(windows, prompt: prompt)
        beforeRestart.suggest(suggestion)
        prompt.answer?(true)

        // Yumi restarts: a new tiler reads the saved layout, keeps it while the task still runs,
        // and restores it once the harness no longer lists the task as active.
        let restarted = tiler(windows)
        #expect(restarted.state.hasSavedLayout)
        restarted.restoreLayouts(exceptActive: ["task-1"])
        #expect(windows.frames != Self.originals)
        restarted.restoreLayouts(exceptActive: [])
        #expect(windows.frames == Self.originals)
    }

    @Test func demoModeTilesWithoutAsking() {
        defer { defaults.removePersistentDomain(forName: suite) }
        let windows = FakeWindows(Self.originals)
        let prompt = Prompt()
        let tiler = tiler(windows, demo: true, prompt: prompt)
        tiler.suggest(suggestion)
        #expect(prompt.asked.isEmpty && prompt.spoken.isEmpty)
        #expect(windows.moves.count == 3)
        tiler.taskStatusChanged("task-1", .done)
        #expect(windows.frames == Self.originals)
    }

    @Test func aTaskThatEndsWhileAskingClosesTheQuestion() {
        defer { defaults.removePersistentDomain(forName: suite) }
        let windows = FakeWindows(Self.originals)
        let prompt = Prompt()
        let tiler = tiler(windows, prompt: prompt)
        tiler.suggest(suggestion)
        tiler.taskStatusChanged("task-1", .done)
        #expect(prompt.dismissed == ["task-1"])
        prompt.answer?(true)
        #expect(windows.moves.isEmpty, "a late yes does nothing")
    }

    @Test func gridsForTwoThreeAndFourWindowsFitWithoutOverlapping() {
        for count in 2...4 {
            let frames = TilingLayout.frames(count: count, in: Self.area)
            #expect(frames.count == count)
            #expect(frames.allSatisfy { Self.area.contains($0) })
            for i in frames.indices {
                for j in frames.indices where i < j {
                    #expect(!frames[i].intersects(frames[j]))
                }
            }
        }
        // Three windows: two on top, the third stretched across the bottom.
        let three = TilingLayout.frames(count: 3, in: Self.area)
        #expect(three[2].width > three[0].width * 1.9)
    }

    final class FakeCarrier: WindowCarrier {
        var events: [String] = []
        func cursorId() -> String? { "main" }
        func leap(_ cursorId: String, to point: CGPoint) -> TimeInterval { events.append("leap"); return 0 }
        func ride(_ cursorId: String, to point: CGPoint, duration: TimeInterval) { events.append("ride") }
        func pounce(_ cursorId: String) { events.append("pounce") }
    }

    @Test func theCatCarriesEachWindowInEasedStepsThenResizesOnce() async {
        defer { defaults.removePersistentDomain(forName: suite) }
        let two = [4182: Self.originals[4182]!, 977: Self.originals[977]!]
        let windows = FakeWindows(two)
        let carrier = FakeCarrier()
        let tiler = tiler(windows, demo: true)
        tiler.carrier = carrier
        tiler.suggest(TilingSuggested(taskId: "task-1", windows: Array(suggestion.windows.prefix(2))))
        // Saved before anything moved (OBJ-20.3).
        #expect(TiledLayoutStore(defaults: defaults).load()["task-1"]?.count == 2)
        #expect(windows.moves.isEmpty)
        await tiler.waitForMoves()

        let first = windows.moves.filter { $0.0 == 4182 }.map(\.1)
        let target = Rect(TilingLayout.frames(count: 2, in: Self.area)[0])
        #expect(first.count == WindowTiler.carrySteps + 1)
        #expect(first.dropLast().allSatisfy { $0.width == 900 && $0.height == 600 }, "position only while carried")
        #expect(first.last == target, "one resize at the end")
        #expect(carrier.events.prefix(4) == ["leap", "pounce", "ride", "pounce"])
    }
}

extension CGRect {
    init(_ rect: Rect) {
        self.init(x: rect.x, y: rect.y, width: rect.width, height: rect.height)
    }
}
