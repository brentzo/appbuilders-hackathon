import Foundation
import OSLog
import YumiProtocol

/// Everything between Yumi and the harness: the supervised process, the RPC client, and what the
/// harness's events mean for the app. It writes plain app values into `AppModel`.
@MainActor
final class HarnessLink {
    let model: AppModel
    private let supervisor: HarnessSupervisor
    let client: HarnessClient
    /// True while the harness is the mock. Mock-only aids such as the sample goal check it.
    let usesMock: Bool
    /// The last status the harness reported for each task.
    private var taskStatuses: [String: TaskStatus] = [:]
    private var eventsTask: Task<Void, Never>?
    /// Called with every error the user should see. `AppDelegate` shows it with the presenter.
    var onUserError: ((UserError) -> Void)?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "harness")

    /// The cursors the harness drives (OBJ-18).
    let overlay: CursorOverlay
    /// Reads and acts on other apps' windows for the harness (OBJ-39).
    let gui: GuiExecutor
    /// Arranges the task's windows with the user's yes, and puts them back (OBJ-20).
    let tiler: WindowTiler
    /// Everything Yumi says out loud (OBJ-17.4).
    let speech: SpeechOutput
    /// The repeat-back panel and the answers to it (OBJ-17).
    let confirmation: GoalConfirmation
    /// What Yumi heard and "On it.", in Auto mode (OBJ-50).
    let autoMode: AutoModeAcknowledgement
    /// The send and delete cards, and the Trash (OBJ-40).
    let approvals: ApprovalCards
    /// Stop, take-over, and the paused panel (OBJ-35).
    let pause: PauseController
    private var stopShortcut: StopShortcut?
    private var takeOverWatcher: TakeOverWatcher?
    /// Helper subtasks shown as chips, by subtask id.
    private var helperSubtasks: Set<String> = []
    /// True once the harness has looked at or acted on a window for a running task, until no task
    /// runs. Planning, and the moments after the user answers Yumi, are not a UI lane acting.
    private var uiLaneStarted = false

    init(model: AppModel, launcher: HarnessLauncher, socketPath: String, overlay: CursorOverlay = CursorOverlay()) {
        self.model = model
        self.overlay = overlay
        supervisor = HarnessSupervisor(launcher: launcher)
        client = HarnessClient(socketPath: socketPath)
        gui = GuiExecutor(overlay: overlay)
        let speech = TrackedSpeech(NeuralSpeech.yumi(), model: model)
        self.speech = speech
        let tilingPanel = TilingPanel()
        tiler = WindowTiler(
            demoMode: { model.settings.demoModeEnabled },
            taskArea: { TaskDisplay.area(overlay) },
            ask: { taskId, answer in tilingPanel.show(taskId: taskId, on: TaskDisplay.screen(overlay), answer: answer) },
            dismissQuestion: { tilingPanel.dismiss(taskId: $0) },
            say: { text in Task { await speech.speak(text) } }
        )
        tiler.carrier = CursorWindowCarrier(overlay: overlay)
        let confirmationPanel = ConfirmationPanel()
        confirmation = GoalConfirmation(
            speech: speech, listener: NoReplyListener(), presenter: confirmationPanel, overlay: overlay
        ) { [client] taskId, reply in
            _ = try await client.call(.replyToConfirmation, ReplyToConfirmationParams(taskId: taskId, reply: reply), returning: Empty.self)
        }
        autoMode = AutoModeAcknowledgement(speech: speech, presenter: confirmationPanel)
        let confirmation = self.confirmation
        approvals = ApprovalCards(
            speech: speech, listen: { await confirmation.listener.listenForReply() }, presenter: ApprovalPanel(), overlay: overlay
        )
        client.appMethods = AppMethodServer(gui: gui, approvals: approvals)
        pause = PauseController(
            speech: speech, listen: { await confirmation.listener.listenForReply() }, panel: PausedPanel(), overlay: overlay,
            keystrokes: gui.keystrokes, approvals: approvals, tasks: HarnessTaskControl(client: client)
        )
        usesMock = launcher.isMock
        model.mockHarnessName = launcher.isMock ? launcher.displayName : nil
    }

    func start() {
        overlay.start()
        gui.onUserError = { [weak self] error in self?.onUserError?(error) }
        gui.onWindowWork = { [weak self] in self?.uiLaneStarted = true }
        approvals.isStopped = { [pause] in pause.isStopped }
        gui.actionsAllowed = { [weak self] in
            guard let self else { return true }
            return !pause.isStopped && Self.actionsAllowed(for: Array(taskStatuses.values))
        }
        pause.activeTasks = { [weak self] in
            self?.taskStatuses.filter { !WindowTiler.finished.contains($0.value) && $0.value != .awaitingConfirmation }.map(\.key) ?? []
        }
        let shortcut = StopShortcut { [weak self] in self?.pause.stop(.shortcut) }
        shortcut.register()
        stopShortcut = shortcut
        let watcher = TakeOverWatcher(
            uiLaneActing: { [weak self] in self?.uiLaneActing ?? false },
            yumiShortcuts: { [model] in [model.settings.pushToTalkShortcut, StopShortcut.shortcut] },
            yumiFrames: { [overlay] in overlay.ownFrames },
            onTakeOver: { [weak self] in self?.pause.stop(.takeOver) }
        )
        watcher.start()
        takeOverWatcher = watcher
        client.onLinkStateChange = { [weak self] state in
            guard let self else { return }
            model.harnessReady = state == .connected
            // Without a harness no task is running, so no cursor may stay (SPEC-04 r9).
            if state != .connected { overlay.fadeAll() }
            if state == .connected {
                sendDebugMode()
                PhoneLink.shared.refreshDevices()
                restoreFinishedTilings()
            }
            log.notice("Status line: \(self.model.status.menuTitle, privacy: .public)")
        }
        eventsTask = Task { [weak self, client] in
            for await event in client.events {
                self?.handle(event)
            }
        }
        startDebugMode()
        PhoneLink.shared.calls = PhoneCalls(client: client) { [weak self] error, method in self?.report(error, from: method) }
        supervisor.start()
        client.start()
    }

    func stop() {
        client.stop()
        eventsTask?.cancel()
        supervisor.stop()
    }

    private func handle(_ event: HarnessEvent) {
        switch event {
        case .taskStatusChanged(let change):
            taskStatuses[change.taskId] = change.status
            if !taskStatuses.values.contains(.running) { uiLaneStarted = false }
            tiler.taskStatusChanged(change.taskId, change.status)
            confirmation.taskStatusChanged(change.taskId, change.status)
            autoMode.taskStatusChanged(change.taskId, change.status)
            pause.taskStatusChanged(change.taskId, change.status)
            model.taskStatus = Self.appStatus(for: Array(taskStatuses.values))
            if let subtaskId = change.subtaskId, let status = change.subtaskStatus, Self.finishedSubtask.contains(status) {
                overlay.subtaskEnded(subtaskId)
                if helperSubtasks.remove(subtaskId) != nil { overlay.removeHelperChip(id: subtaskId) }
            }
            // Cursors carry no task id, so when no task is active every cursor leaves (SPEC-04 r9).
            if model.taskStatus == .ready {
                overlay.fadeAll()
                helperSubtasks.removeAll()
            }
        case .cursorCommand(let command):
            overlay.apply(command)
        case .routeDecided(let route):
            if route.lane == .helper, helperSubtasks.insert(route.subtaskId).inserted {
                // The protocol gives no subtask title here, so the chip says what it is.
                overlay.showHelperChip(id: route.subtaskId, text: "Helper working")
            }
        case .userError(let error):
            log.notice("The harness reported \(error.kind.rawValue, privacy: .public)")
            confirmation.userError(error)
            onUserError?(error)
        case .goalRestated(let restated):
            Task { await confirmation.goalRestated(restated) }
        case .speak(let line):
            Task { await speech.speak(line.text) }
        case .approvalCancelled(let cancelled):
            approvals.cancel(approvalId: cancelled.approvalId)
        case .tilingSuggested(let suggestion):
            tiler.suggest(suggestion)
        case .bridgeStateChanged(let change):
            PhoneLink.shared.update(connection: PhoneLink.Connection(change.state))
        case .workerThought(let thought):
            overlay.receive(thought)
        default:
            // questionAsked, interruptedTaskFound and waitingForWindow are consumed in later objectives.
            log.info("Not handled yet: \(event.name, privacy: .public)")
        }
    }

    /// Windows tiled for a task that ended while Yumi or the harness was down go back now.
    private func restoreFinishedTilings() {
        guard tiler.state.hasSavedLayout else { return }
        Task {
            do {
                let list = try await client.call(.listTasks, ListTasksParams(limit: 50), returning: TaskList.self)
                let active = list.tasks.filter { !WindowTiler.finished.contains($0.status) }.map(\.id)
                tiler.restoreLayouts(exceptActive: Set(active))
            } catch {
                log.error("Could not list tasks to restore tiled windows: \(String(describing: error), privacy: .public)")
            }
        }
    }

    static let finishedSubtask: Set<SubtaskStatus> = [.done, .failed]

    /// The status line for all tasks together: working beats paused beats ready.
    static func appStatus(for statuses: [TaskStatus]) -> AppStatus {
        let active: Set<TaskStatus> = [.awaitingConfirmation, .queued, .planning, .running, .waitingForUser]
        if statuses.contains(where: active.contains) { return .working }
        if statuses.contains(.paused) { return .paused }
        return .ready
    }

    private var uiLaneActing: Bool {
        Self.uiLaneActing(
            stopped: pause.isStopped, statuses: Array(taskStatuses.values), hasCursors: !overlay.cursors.isEmpty,
            approvalOpen: !approvals.openApprovalIds.isEmpty, startedOnScreen: uiLaneStarted
        )
    }

    /// A cursor is working in a running task and Yumi is not waiting for the user: only then does
    /// the user's own input count as taking over (SPEC-06 r2). Helpers have no cursor. The main
    /// cursor appears as soon as a goal is spoken, so a UI lane counts as acting only once the
    /// harness has started on a window (`startedOnScreen`), not while it plans right after the user
    /// answered Yumi.
    static func uiLaneActing(
        stopped: Bool, statuses: [TaskStatus], hasCursors: Bool, approvalOpen: Bool, startedOnScreen: Bool
    ) -> Bool {
        !stopped && statuses.contains(.running) && hasCursors && !approvalOpen && startedOnScreen
    }

    /// Before any goal is confirmed nothing may act (OBJ-17.7): a goal waiting for its answer, with
    /// no task confirmed beside it, blocks every action the harness sends.
    static func actionsAllowed(for statuses: [TaskStatus]) -> Bool {
        let confirmed: Set<TaskStatus> = [.queued, .planning, .running, .waitingForUser]
        return !statuses.contains(.awaitingConfirmation) || statuses.contains(where: confirmed.contains)
    }

    /// Speech from push-to-talk or the wake word: the answer to a repeat-back that is waiting, or
    /// else a new goal (OBJ-17).
    func submitSpeech(_ transcript: String) {
        guard !confirmation.takeSpokenAnswer(transcript) else {
            log.notice("Speech taken as the answer to the repeat-back")
            return
        }
        submitGoal(transcript)
    }

    /// Sends a spoken or typed goal to the harness. The main cursor appears next to the pointer at
    /// once (OBJ-17.3); the harness then restates the goal, or in Auto mode starts it, and Yumi
    /// shows what it heard and says "On it." (OBJ-50). Voice intake (OBJ-15) calls this.
    func submitGoal(_ transcript: String) {
        confirmation.goalSubmitted()
        let autoMode = model.settings.autoMode
        Task {
            do {
                let result = try await client.submitGoal(Self.submitGoalParams(transcript, autoMode: autoMode))
                log.notice("Goal submitted, task \(result.taskId, privacy: .public), auto mode \(autoMode, privacy: .public)")
                if autoMode { await self.autoMode.goalStarted(taskId: result.taskId, heard: transcript) }
            } catch {
                overlay.fade(id: GoalConfirmation.mainCursorId)
                report(error, from: "submitGoal")
            }
        }
    }

    /// Every goal says whether Auto mode is on (SPEC-01 r14), so the harness never guesses.
    static func submitGoalParams(_ transcript: String, autoMode: Bool) -> SubmitGoalParams {
        SubmitGoalParams(transcript: transcript, originDeviceId: "mac-local", autoMode: autoMode)
    }

    /// Debug aid for the mock: submits a fixed goal so scripts that play on `submitGoal`
    /// (like keynote-export) run without speaking.
    func submitSampleGoal() {
        guard usesMock else {
            log.error("Ignored the sample goal: it is only for the mock harness")
            return
        }
        submitGoal("export my Keynote deck as a PDF")
    }

    func submitSampleGoalWhenConnected() {
        Task {
            while client.linkState != .connected {
                try? await Task.sleep(for: .milliseconds(200))
            }
            submitSampleGoal()
        }
    }

    /// "Keep going" on the blocked-action card (OBJ-40.5) and other errors that wait on the user.
    func resumeTask(_ taskId: String) {
        Task {
            do {
                _ = try await client.call(.resumeTask, TaskRef(taskId: taskId), returning: Empty.self)
            } catch {
                report(error, from: "resumeTask")
            }
        }
    }

    func cancelTask(_ taskId: String) {
        Task {
            do {
                try await client.cancelTask(taskId)
            } catch {
                report(error, from: "cancelTask")
            }
        }
    }

    /// A failed call the user started: log it, then show it. Only the structured kind travels on.
    private func report(_ error: Error, from method: String) {
        let userError = (error as? HarnessCallError)?.userError ?? UserError(kind: .unexpected)
        log.error("\(method, privacy: .public) failed: \(String(describing: error), privacy: .public)")
        onUserError?(userError)
    }
}
