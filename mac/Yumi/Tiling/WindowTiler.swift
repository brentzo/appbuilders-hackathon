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
        for (window, target) in zip(saved, TilingLayout.frames(count: saved.count, in: area)) {
            do {
                try frames.setFrame(of: window.windowId, to: Rect(target))
            } catch {
                log.error("Could not move window \(window.windowId) of \(window.bundleId, privacy: .public): \(String(describing: error), privacy: .public)")
            }
        }
        log.notice("Tiled \(saved.count) windows for task \(taskId, privacy: .public)")
    }

    private func restore(_ taskId: String) {
        guard let saved = layouts.removeValue(forKey: taskId) else { return }
        for window in saved {
            do {
                try frames.setFrame(of: window.windowId, to: window.frame)
            } catch {
                // The app quit or closed the window: there is nothing left to put back.
                log.notice("Could not restore window \(window.windowId) of \(window.bundleId, privacy: .public): \(String(describing: error), privacy: .public)")
            }
        }
        persist()
        log.notice("Restored \(saved.count) windows for task \(taskId, privacy: .public)")
    }

    private func persist() {
        store.save(layouts)
        state.hasSavedLayout = !layouts.isEmpty
    }
}
