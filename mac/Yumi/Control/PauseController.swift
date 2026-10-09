import OSLog
import YumiProtocol

/// The words of pausing (SPEC-06 r1, r6, OBJ-35.7).
enum PauseCopy {
    static let paused = "Paused. Say continue when you're ready, or cancel to stop for good."
    /// A take-over pause is silent; the panel shows only this (SPEC-06 r2).
    static let pausedSilently = "Paused."
    static let resume = "Resume"
    static let cancel = "Cancel"
    static let cancelled = "Okay, I stopped. Nothing else will happen."
    static let stop = "Stop"
}

/// Shows the paused panel with "Resume" and "Cancel". The live one is `PausedPanel`.
@MainActor
protocol PausedPresenting: AnyObject {
    func show(text: String, resume: @escaping () -> Void, cancel: @escaping () -> Void)
    func close()
}

/// What the harness does for a pause. The live one calls `pause`, `resumeTask`, and `cancelTask`.
@MainActor
protocol TaskControl: AnyObject {
    func pauseAll() async throws
    func resume(_ taskId: String) async throws
    func cancel(_ taskId: String) async throws
}

/// The harness's `pause`, `resumeTask`, and `cancelTask`.
@MainActor
final class HarnessTaskControl: TaskControl {
    private let client: HarnessClient

    init(client: HarnessClient) {
        self.client = client
    }

    func pauseAll() async throws {
        _ = try await client.call(.pause, PauseParams(), returning: Empty.self)
    }

    func resume(_ taskId: String) async throws {
        _ = try await client.call(.resumeTask, TaskRef(taskId: taskId), returning: Empty.self)
    }

    func cancel(_ taskId: String) async throws {
        try await client.cancelTask(taskId)
    }
}

/// Stop and take-over on the Mac (OBJ-35).
///
/// The local stop comes first and needs no harness: typing stops before its next chunk and
/// `executeAction` refuses everything, so a request already on its way does nothing (SPEC-06 r4).
/// Then the harness is told, every open card closes (r5), and the cursors freeze.
@MainActor
final class PauseController {
    enum Trigger {
        case shortcut, menu, takeOver
    }

    private(set) var isStopped = false
    private let speech: SpeechOutput
    private let listen: () async -> String?
    private let panel: PausedPresenting
    private let overlay: CursorOverlay
    private let keystrokes: KeystrokeSender
    private let approvals: ApprovalCards
    private let tasks: TaskControl
    /// Tasks still going when the pause came, from the harness's events. Set by the app.
    var activeTasks: () -> [String] = { [] }
    private var pausedTasks: Set<String> = []
    private var cancelling = false
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "control")

    init(speech: SpeechOutput, listen: @escaping () async -> String?, panel: PausedPresenting, overlay: CursorOverlay,
         keystrokes: KeystrokeSender, approvals: ApprovalCards, tasks: TaskControl) {
        self.speech = speech
        self.listen = listen
        self.panel = panel
        self.overlay = overlay
        self.keystrokes = keystrokes
        self.approvals = approvals
        self.tasks = tasks
    }

    func stop(_ trigger: Trigger) {
        guard !isStopped else { return }
        isStopped = true
        keystrokes.cancelTyping()
        approvals.cancelAll()
        pausedTasks = Set(activeTasks())
        cancelling = false
        for id in overlay.cursors.keys {
            overlay.update(id) { $0.state = .paused }
        }
        log.notice("Stopped by \(String(describing: trigger), privacy: .public)")
        // The protocol's pause has no "UI lanes only" scope yet, so a take-over pauses helpers too.
        Task {
            do { try await tasks.pauseAll() } catch { log.error("pause failed: \(String(describing: error), privacy: .public)") }
        }
        let spoken = trigger != .takeOver
        panel.show(text: spoken ? PauseCopy.paused : PauseCopy.pausedSilently,
                   resume: { [weak self] in self?.resume() },
                   cancel: { [weak self] in self?.cancel() })
        guard spoken else { return }
        Task {
            await speech.speak(PauseCopy.paused)
            guard isStopped, let heard = await listen() else { return }
            switch Self.spokenChoice(heard) {
            case .resume: resume()
            case .cancel: cancel()
            case nil: break // the panel's buttons still work
            }
        }
    }

    /// "Resume" or "continue": the harness resumes, and the local stop lifts only once it reports
    /// a paused task running again (OBJ-35.6).
    func resume() {
        guard isStopped, !cancelling else { return }
        panel.close()
        guard !pausedTasks.isEmpty else { return lift() }
        for taskId in pausedTasks {
            Task {
                do { try await tasks.resume(taskId) } catch { log.error("resumeTask failed: \(String(describing: error), privacy: .public)") }
            }
        }
    }

    /// "Cancel": every paused task is cancelled, every cursor fades, and nothing else happens (OBJ-35.7).
    func cancel() {
        guard isStopped, !cancelling else { return }
        cancelling = true
        panel.close()
        overlay.fadeAll()
        for taskId in pausedTasks {
            Task {
                do { try await tasks.cancel(taskId) } catch { log.error("cancelTask failed: \(String(describing: error), privacy: .public)") }
            }
        }
        Task { await speech.speak(PauseCopy.cancelled) }
        if pausedTasks.isEmpty { lift() }
    }

    func taskStatusChanged(_ taskId: String, _ status: TaskStatus) {
        guard isStopped, pausedTasks.contains(taskId) else { return }
        if status == .running, !cancelling {
            lift()
        } else if WindowTiler.finished.contains(status) {
            pausedTasks.remove(taskId)
            if pausedTasks.isEmpty { lift() }
        }
    }

    private func lift() {
        isStopped = false
        cancelling = false
        pausedTasks = []
        panel.close()
        log.notice("Local stop lifted")
    }

    enum SpokenChoice: Equatable {
        case resume, cancel
    }

    static func spokenChoice(_ heard: String) -> SpokenChoice? {
        let words = Set(heard.lowercased().split { !$0.isLetter }.map(String.init))
        if words.contains("cancel") { return .cancel }
        if words.contains("continue") || words.contains("resume") { return .resume }
        return nil
    }
}
