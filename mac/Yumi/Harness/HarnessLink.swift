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
    /// The last status the harness reported for each task.
    private var taskStatuses: [String: TaskStatus] = [:]
    private var eventsTask: Task<Void, Never>?
    /// Called with every error the user should see. `AppDelegate` shows it with the presenter.
    var onUserError: ((UserError) -> Void)?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "harness")

    init(model: AppModel, launcher: HarnessLauncher, socketPath: String) {
        self.model = model
        supervisor = HarnessSupervisor(launcher: launcher)
        client = HarnessClient(socketPath: socketPath)
        model.mockHarnessName = launcher.isMock ? launcher.displayName : nil
    }

    func start() {
        client.onLinkStateChange = { [weak self] state in
            guard let self else { return }
            model.harnessReady = state == .connected
            log.notice("Status line: \(self.model.status.menuTitle, privacy: .public)")
        }
        eventsTask = Task { [weak self, client] in
            for await event in client.events {
                self?.handle(event)
            }
        }
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
            model.taskStatus = Self.appStatus(for: Array(taskStatuses.values))
        case .userError(let error):
            log.notice("The harness reported \(error.kind.rawValue, privacy: .public)")
            onUserError?(error)
        default:
            // Voice, confirmation, cursors, approvals and tiling consume these in later objectives.
            log.info("Not handled yet: \(event.name, privacy: .public)")
        }
    }

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
