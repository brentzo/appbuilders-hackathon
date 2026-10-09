import Foundation

/// Shows a finished task's summary on screen, without buttons other than a close button. The live
/// one is `SummaryPanel`; tests record.
@MainActor
protocol SummaryPresenting: AnyObject {
    func show(taskId: String, text: String, close: @escaping () -> Void)
    func close(taskId: String)
}

/// When a task finishes, Yumi says its summary in its own voice and shows it in a small card
/// (SPEC-02 r9). The harness sends the summary as a `speak` event with the task's id; whatever
/// text arrives is said and shown as is, for every way a task can end.
///
/// The card closes on its own once the line is said and there was time to read it, when the user
/// closes it, or when a new goal starts.
@MainActor
final class TaskSummary {
    /// How long the card stays after the line is said: about long enough to read it again.
    static func readingTime(for text: String) -> Duration {
        let words = text.split(whereSeparator: \.isWhitespace).count
        return .seconds(min(max(4, Double(words) * 0.3), 12))
    }

    private let speech: SpeechOutput
    private let presenter: SummaryPresenting
    private let wait: (Duration) async -> Void
    /// The task whose card is up.
    private(set) var showing: String?

    init(
        speech: SpeechOutput,
        presenter: SummaryPresenting,
        wait: @escaping (Duration) async -> Void = { try? await Task.sleep(for: $0) }
    ) {
        self.speech = speech
        self.presenter = presenter
        self.wait = wait
    }

    /// The harness's summary of a finished task.
    func taskFinished(taskId: String, summary: String) async {
        let text = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        showing = taskId
        presenter.show(taskId: taskId, text: text) { [weak self] in self?.close(taskId) }
        await speech.speak(text)
        await wait(Self.readingTime(for: text))
        close(taskId)
    }

    /// A new goal takes the screen: the last summary goes.
    func goalSubmitted() {
        if let showing { close(showing) }
    }

    func close(_ taskId: String) {
        guard showing == taskId else { return }
        showing = nil
        presenter.close(taskId: taskId)
    }
}
