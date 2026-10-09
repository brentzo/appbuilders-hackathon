import YumiProtocol

/// The words of Auto mode (SPEC-01 requirement 14, OBJ-50).
enum AutoModeCopy {
    static let acknowledgement = "On it."
}

/// Shows Auto mode's acknowledgement: Yumi's line and what it heard, with no buttons. The live one
/// is `ConfirmationPanel`, the same panel the repeat-back uses.
@MainActor
protocol HeardPresenting: AnyObject {
    func showHeard(taskId: String, line: String, heard: String)
    func close(taskId: String)
}

/// The Mac half of Auto mode (OBJ-50.4): once the harness has started a goal without a repeat-back,
/// Yumi shows what it heard and says "On it." while the cursor heads off. The panel closes after
/// `shownFor`, or sooner if the task ends. Nothing here waits for the user; the stop shortcut works
/// as always, and approvals for sends and deletes still ask (SPEC-07).
@MainActor
final class AutoModeAcknowledgement {
    /// About long enough to read a sentence, without staying in the way of the work.
    static let shownFor: Duration = .seconds(3)

    private let speech: SpeechOutput
    private let presenter: HeardPresenting
    private let wait: (Duration) async -> Void
    /// The task whose panel is up.
    private var showing: String?

    init(
        speech: SpeechOutput,
        presenter: HeardPresenting,
        wait: @escaping (Duration) async -> Void = { try? await Task.sleep(for: $0) }
    ) {
        self.speech = speech
        self.presenter = presenter
        self.wait = wait
    }

    /// `submitGoal` with Auto mode returned: the task is already planning.
    func goalStarted(taskId: String, heard: String) async {
        showing = taskId
        presenter.showHeard(
            taskId: taskId, line: AutoModeCopy.acknowledgement,
            heard: heard.trimmingCharacters(in: .whitespacesAndNewlines)
        )
        let speech = speech
        let saying = Task { await speech.speak(AutoModeCopy.acknowledgement) }
        await wait(Self.shownFor)
        close(taskId)
        await saying.value
    }

    /// A task that ends (done, failed, cancelled by Stop) takes its panel with it.
    func taskStatusChanged(_ taskId: String, _ status: TaskStatus) {
        if WindowTiler.finished.contains(status) { close(taskId) }
    }

    private func close(_ taskId: String) {
        guard showing == taskId else { return }
        showing = nil
        presenter.close(taskId: taskId)
    }
}
