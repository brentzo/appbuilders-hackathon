import AppKit
import OSLog
import YumiProtocol

/// Window frames for tiling. The live one is OBJ-27's `WindowService`; tests use a fake.
@MainActor
protocol WindowFrames {
    func frame(of windowId: Int) throws -> Rect
    func setFrame(of windowId: Int, to rect: Rect) throws
    func windowIds(bundleId: String) -> [Int]
}

struct LiveWindowFrames: WindowFrames {
    func frame(of windowId: Int) throws -> Rect { try WindowService.frame(of: windowId) }
    func setFrame(of windowId: Int, to rect: Rect) throws { try WindowService.setFrame(of: windowId, to: rect) }
    func windowIds(bundleId: String) -> [Int] { WindowService.windowIds(bundleId: bundleId) }
}

/// A cursor that can carry windows while they move: the overlay's cat in the app, nothing in
/// tests (then windows jump, as before).
@MainActor
protocol WindowCarrier {
    func cursorId() -> String?
    /// Leaps to a point and returns how long the leap takes.
    func leap(_ cursorId: String, to point: CGPoint) -> TimeInterval
    /// Rides in a straight line to a point over `duration`, on the move easing.
    func ride(_ cursorId: String, to point: CGPoint, duration: TimeInterval)
    func pounce(_ cursorId: String)
}

/// The words of the tiling question (SPEC-03 r14). Kept word for word.
enum TilingCopy {
    static let question = "Want me to arrange your windows so you can watch all of us work?"
    static let arrange = "Arrange windows"
    static let leave = "Leave them"
}

/// Arranges a task's windows so the user can watch every cursor, only with their yes (or in demo
/// mode), and puts every moved window back when the task ends (SPEC-03 r14-r16, OBJ-20).
@MainActor
final class WindowTiler {
    /// Shows the consent panel for a task and reports the answer: true for "Arrange windows".
    typealias Ask = (_ taskId: String, _ answer: @escaping (Bool) -> Void) -> Void

    let state = TilingState()
    private let frames: WindowFrames
    private let store: TiledLayoutStore
    private let demoMode: () -> Bool
    /// The visible area of the display where the task started, in global top-left coordinates.
    private let taskArea: () -> CGRect?
    private let ask: Ask
    private let dismissQuestion: (_ taskId: String) -> Void
    private let say: (String) -> Void
    private var layouts: [String: [SavedWindow]]
    /// Tasks whose question is showing.
    private var asking: Set<String> = []
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "tiling")
    /// The cat that carries windows. Without one (or with Reduce Motion on) windows jump.
    var carrier: WindowCarrier?
    /// Window moves run one after another, so a put-back never races a tiling still under way.
    private var carrying: Task<Void, Never>?

    init(
        frames: WindowFrames = LiveWindowFrames(),
        store: TiledLayoutStore = TiledLayoutStore(),
        demoMode: @escaping () -> Bool,
        taskArea: @escaping () -> CGRect?,
        ask: @escaping Ask,
        dismissQuestion: @escaping (String) -> Void,
        say: @escaping (String) -> Void
    ) {
        self.frames = frames
        self.store = store
        self.demoMode = demoMode
        self.taskArea = taskArea
        self.ask = ask
        self.dismissQuestion = dismissQuestion
        self.say = say
        layouts = store.load()
        state.hasSavedLayout = !layouts.isEmpty
    }

    // MARK: Harness events

    /// `tilingSuggested` (OBJ-20.1): ask, or tile right away in demo mode (OBJ-20.7).
    func suggest(_ suggestion: TilingSuggested) {
        let taskId = suggestion.taskId
        guard layouts[taskId] == nil, !asking.contains(taskId) else { return }
        let windows = resolve(suggestion.windows)
        guard windows.count > 1 else {
            log.notice("Tiling suggested, but only \(windows.count) of its windows are on screen; nothing to arrange")
            return
        }
        if demoMode() {
            tile(taskId, windows)
            return
        }
        asking.insert(taskId)
        say(TilingCopy.question)
        ask(taskId) { [weak self] arrange in
            guard let self, asking.remove(taskId) != nil else { return }
            // "Leave them" moves nothing; ghosts work in covered windows anyway (OBJ-20.5).
            if arrange { tile(taskId, windows) }
        }
    }

    /// A task changed status: when it is over, its windows go back (OBJ-20.6).
    func taskStatusChanged(_ taskId: String, _ status: TaskStatus) {
        guard Self.finished.contains(status) else { return }
        if asking.remove(taskId) != nil { dismissQuestion(taskId) }
        restore(taskId)
    }

    /// After connecting, puts back the windows of tasks that are no longer running, for example
    /// after Yumi or the harness restarted while a task was tiled.
    func restoreLayouts(exceptActive active: Set<String>) {
        for taskId in layouts.keys where !active.contains(taskId) {
            restore(taskId)
        }
    }

    /// Puts every window Yumi moved back, for every task. The menu's "Put windows back".
    func restoreAll() {
        for taskId in layouts.keys { restore(taskId) }
    }

    static let finished: Set<TaskStatus> = [.done, .failed, .cancelled]

    // MARK: Tiling

    private func resolve(_ targets: [Target]) -> [(windowId: Int, bundleId: String)] {
        var seen: Set<Int> = []
        var windows: [(Int, String)] = []
        for target in targets {
            guard let id = target.windowId ?? frames.windowIds(bundleId: target.bundleId).first,
                  seen.insert(id).inserted, (try? frames.frame(of: id)) != nil else { continue }
            windows.append((id, target.bundleId))
        }
        return windows
    }

    private func tile(_ taskId: String, _ windows: [(windowId: Int, bundleId: String)]) {
        guard let area = taskArea() else { return }
        // Save every original frame before moving anything (OBJ-20.3).
        let saved = windows.compactMap { window in
            (try? frames.frame(of: window.windowId)).map { SavedWindow(windowId: window.windowId, bundleId: window.bundleId, frame: $0) }
        }
        layouts[taskId] = saved
        persist()
        let moves = zip(saved, TilingLayout.frames(count: saved.count, in: area)).map { window, target in
            Move(window: window, from: window.frame, to: Rect(target))
        }
        carry(moves)
        log.notice("Tiling \(saved.count) windows for task \(taskId, privacy: .public)")
    }

    private func restore(_ taskId: String) {
        guard let saved = layouts.removeValue(forKey: taskId) else { return }
        persist()
        // Where each window is now; one the app closed has nothing left to put back.
        let moves = saved.compactMap { window in
            (try? frames.frame(of: window.windowId)).map { Move(window: window, from: $0, to: window.frame) }
        }
        carry(moves)
        log.notice("Putting back \(saved.count) windows for task \(taskId, privacy: .public)")
    }

    // MARK: Carrying

    struct Move {
        let window: SavedWindow
        let from: Rect
        let to: Rect
    }

    /// Position-only steps per carried window; the size changes once at the end.
    static let carrySteps = 10

    /// Moves windows to their frames. With a cat and without Reduce Motion, the cat carries them
    /// one by one; otherwise each window jumps, as before.
    private func carry(_ moves: [Move]) {
        guard let carrier, !CursorMotion.reduceMotion else {
            for move in moves { jump(move) }
            return
        }
        let previous = carrying
        carrying = Task { [weak self] in
            await previous?.value
            for move in moves {
                guard let self else { return }
                await self.carry(move, with: carrier)
            }
        }
    }

    /// Waits until every window move started so far has finished.
    func waitForMoves() async {
        await carrying?.value
    }

    private func jump(_ move: Move) {
        do {
            try frames.setFrame(of: move.window.windowId, to: move.to)
        } catch {
            log.notice("Could not move window \(move.window.windowId) of \(move.window.bundleId, privacy: .public): \(String(describing: error), privacy: .public)")
        }
    }

    /// The cat leaps to the title bar and pounces, the window moves in eased position-only steps
    /// with the cat riding its title bar on the same curve, and one resize at the end hides under
    /// a second pounce. A step that fails falls back to one jump for this window.
    private func carry(_ move: Move, with carrier: WindowCarrier) async {
        guard let cursorId = carrier.cursorId() else { return jump(move) }
        let from = move.from, to = move.to
        await pause(carrier.leap(cursorId, to: Self.titleBar(of: from)))
        carrier.pounce(cursorId)
        await pause(YumiMotion.pounce)

        let dx = to.x - from.x, dy = to.y - from.y
        let duration = CursorMotion.duration(for: CGFloat(hypot(dx, dy)))
        let riding = Rect(x: to.x, y: to.y, width: from.width, height: from.height)
        carrier.ride(cursorId, to: Self.titleBar(of: riding), duration: duration)
        let start = ContinuousClock.now
        for step in 1...Self.carrySteps {
            let time = Double(step) / Double(Self.carrySteps)
            try? await Task.sleep(until: start + .milliseconds(Int(duration * time * 1000)))
            let progress = CursorMotion.eased(time)
            let rect = Rect(x: from.x + dx * progress, y: from.y + dy * progress, width: from.width, height: from.height)
            do {
                try frames.setFrame(of: move.window.windowId, to: rect)
            } catch {
                log.notice("Window \(move.window.windowId) refused a step; it jumps instead")
                return jump(move)
            }
        }
        carrier.pounce(cursorId)
        jump(move)
        await pause(YumiMotion.pounce)
    }

    private func pause(_ seconds: TimeInterval) async {
        try? await Task.sleep(for: .milliseconds(Int(seconds * 1000)))
    }

    /// The middle of a window's title bar, where the cat grabs it.
    static func titleBar(of frame: Rect) -> CGPoint {
        CGPoint(x: frame.x + frame.width / 2, y: frame.y + 14)
    }

    private func persist() {
        store.save(layouts)
        state.hasSavedLayout = !layouts.isEmpty
    }
}
