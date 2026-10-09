import Foundation
import struct YumiProtocol.FoundList

/// Shows a finished task's summary on screen, with a close button, and the full list when the
/// task found one, with "Save to Notes" when `save` is given. The live one is `SummaryPanel`;
/// tests record.
@MainActor
protocol SummaryPresenting: AnyObject {
    func show(taskId: String, text: String, list: FoundList?, close: @escaping () -> Void, save: (() -> Void)?)
    func close(taskId: String)
}

/// When a task finishes, Yumi says its summary in its own voice and shows it in a small card
/// (SPEC-02 r9). The harness sends the summary as a `speak` event with the task's id; whatever
/// text arrives is said and shown as is, for every way a task can end.
///
/// The card closes on its own once the line is said and there was time to read it, when the user
/// closes it, or when a new goal starts.
///
/// When the task found a list, the card shows all of it, scrollable (SPEC-02 r13). Unless the task
/// already put it in a new note, the card has "Save to Notes", and saying "save it" while the card
/// is up does the same: both start a short follow-up task through `save` (OBJ-74). Such a card
/// stays until the user closes it, saves, or starts a new goal, since a list takes longer to read.
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
    /// The task whose card is up with a list that can still go into a note.
    private(set) var savable: String?
    /// Starts the follow-up task that puts a task's list in a new note (`saveListToNote`).
    var save: ((String) -> Void)?

    init(
        speech: SpeechOutput,
        presenter: SummaryPresenting,
        wait: @escaping (Duration) async -> Void = { try? await Task.sleep(for: $0) }
    ) {
        self.speech = speech
        self.presenter = presenter
        self.wait = wait
    }

    /// The harness's summary of a finished task, with the list it found, if any.
    func taskFinished(taskId: String, summary: String, list: FoundList? = nil) async {
        let text = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        let list = list.flatMap { $0.items.isEmpty ? nil : $0 }
        showing = taskId
        savable = list.map { $0.inNote ? nil : taskId } ?? nil
        presenter.show(
            taskId: taskId, text: text, list: list,
            close: { [weak self] in self?.close(taskId) },
            save: savable == nil ? nil : { [weak self] in self?.saveList(taskId) }
        )
        await speech.speak(text)
        // A list stays up until the user is done with it.
        guard list == nil else { return }
        await wait(Self.readingTime(for: text))
        close(taskId)
    }

    /// "Save it" while a card with a list is up: saves that list. True when the speech was this.
    func takeSpokenSave(_ transcript: String) -> Bool {
        guard let savable, Self.isSaveRequest(transcript) else { return false }
        saveList(savable)
        return true
    }

    /// What counts as asking to save the list: "save it", "save it to Notes", "yes, save the list".
    static func isSaveRequest(_ transcript: String) -> Bool {
        let words = transcript.lowercased()
            .components(separatedBy: CharacterSet.letters.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        let pattern = #"^((yes|ok|okay|sure|please|yumi|hey yumi) )*save( it| that| this| the list)?( to| in| into)?( a)?( new)?( notes?)?( please)?$"#
        return words.range(of: pattern, options: .regularExpression) != nil
    }

    private func saveList(_ taskId: String) {
        guard savable == taskId else { return }
        savable = nil
        save?(taskId)
        close(taskId)
    }

    /// A new goal takes the screen: the last summary goes.
    func goalSubmitted() {
        if let showing { close(showing) }
    }

    func close(_ taskId: String) {
        guard showing == taskId else { return }
        showing = nil
        savable = nil
        presenter.close(taskId: taskId)
    }
}
