import Foundation
import OSLog
import YumiProtocol

/// Everything between Yumi and the harness: the supervised process, the RPC client, and what the
/// harness's events mean for the app. It writes plain app values into `AppModel`.
@MainActor
final class HarnessLink {
    private let model: AppModel
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
    /// Reads and acts on other apps' windows for the harness (OBJ-44).
    let gui: GuiExecutor
    /// Arranges the task's windows with the user's yes, and puts them back (OBJ-20).
    let tiler: WindowTiler
    /// Helper subtasks shown as chips, by subtask id.
    private var helperSubtasks: Set<String> = []

    init(model: AppModel, launcher: HarnessLauncher, socketPath: String, overlay: CursorOverlay = CursorOverlay()) {
        self.model = model
        self.overlay = overlay
        supervisor = HarnessSupervisor(launcher: launcher)
        client = HarnessClient(socketPath: socketPath)
        gui = GuiExecutor(overlay: overlay)
        let tilingPanel = TilingPanel()
        let tilingVoice = TilingVoice()
        tiler = WindowTiler(
            demoMode: { model.settings.demoModeEnabled },
            taskArea: { TaskDisplay.area(overlay) },
            ask: { taskId, answer in tilingPanel.show(taskId: taskId, on: TaskDisplay.screen(overlay), answer: answer) },
            dismissQuestion: { tilingPanel.dismiss(taskId: $0) },
            say: { tilingVoice.say($0) }
        )
        client.appMethods = AppMethodServer(gui: gui)
        usesMock = launcher.isMock
        model.mockHarnessName = launcher.isMock ? launcher.displayName : nil
    }

    func start() {
        overlay.start()
        gui.onUserError = { [weak self] error in self?.onUserError?(error) }
        client.onLinkStateChange = { [weak self] state in
            guard let self else { return }
            model.harnessReady = state == .connected
            // Without a harness no task is running, so no cursor may stay (SPEC-04 r9).
            if state != .connected { overlay.fadeAll() }
            if state == .connected {
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
            tiler.taskStatusChanged(change.taskId, change.status)
            model.taskStatus = Self.appStatus(for: Array(taskStatuses.values))
            if let subtaskId = change.subtaskId, let status = change.subtaskStatus,
               Self.finishedSubtask.contains(status), helperSubtasks.remove(subtaskId) != nil {
                overlay.removeHelperChip(id: subtaskId)
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
            onUserError?(error)
        case .tilingSuggested(let suggestion):
            tiler.suggest(suggestion)
        case .bridgeStateChanged(let change):
            PhoneLink.shared.update(connection: PhoneLink.Connection(change.state))
        default:
            // goalRestated, questionAsked, speak (voice and confirmation), approvalCancelled,
            // interruptedTaskFound and waitingForWindow are consumed in later objectives.
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

    /// Debug aid for the mock: submits a fixed goal so scripts that play on `submitGoal`
    /// (like keynote-export) run without voice intake (OBJ-15).
    func submitSampleGoal() {
        guard usesMock else {
            log.error("Ignored the sample goal: it is only for the mock harness")
            return
        }
        Task {
            do {
                let result = try await client.submitGoal(
                    SubmitGoalParams(transcript: "export my Keynote deck as a PDF", originDeviceId: "mac-local")
                )
                log.notice("Sample goal submitted, task \(result.taskId, privacy: .public)")
            } catch {
                report(error, from: "submitGoal")
            }
        }
    }

    func submitSampleGoalWhenConnected() {
        Task {
            while client.linkState != .connected {
                try? await Task.sleep(for: .milliseconds(200))
            }
            submitSampleGoal()
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
