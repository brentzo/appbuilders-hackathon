import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// A worker's question reaches the user and its answer reaches the harness (OBJ-36.9). In Brent's
/// live check (task d608891a, 2026-10-10) the Mac logged "Not handled yet: questionAsked", so the
/// task waited for an answer nobody could give.
@MainActor
struct TaskQuestionTests {
    final class FakeSpeech: SpeechOutput {
        var said: [String] = []
        func speak(_ text: String) async { said.append(text) }
        func speakOpening(_ text: String) async { said.append(text) }
    }

    final class FakePanel: QuestionPresenting {
        var shown: [(question: QuestionAsked, password: Bool)] = []
        var closed: [String] = []
        var choose: ((QuestionChoice) -> Void)?
        func show(_ question: QuestionAsked, password: Bool, choose: @escaping (QuestionChoice) -> Void) {
            shown.append((question, password))
            self.choose = choose
        }
        func close(subtaskId: String) { closed.append(subtaskId) }
    }

    final class Sent {
        var params: [AnswerQuestionParams] = []
    }

    static let question = QuestionAsked(taskId: "t1", subtaskId: "s1", question: "Which deck should I export?")

    private func make(heard: String? = nil) -> (TaskQuestions, FakePanel, FakeSpeech, Sent) {
        let panel = FakePanel()
        let speech = FakeSpeech()
        let sent = Sent()
        let questions = TaskQuestions(speech: speech, listen: { heard }, presenter: panel, send: { sent.params.append($0) })
        return (questions, panel, speech, sent)
    }

    private func settle(_ condition: () -> Bool) async throws {
        for _ in 0..<100 where !condition() { try await Task.sleep(for: .milliseconds(10)) }
    }

    @Test func theQuestionEventIsHandled() throws {
        // The real event, decoded the way the app decodes it.
        let data = try Data(contentsOf: ProtocolTypesTests.examples.appendingPathComponent("QuestionAsked.which-deck.json"))
        guard case .questionAsked(let question) = try HarnessEvent.decode(name: "questionAsked", payload: data) else {
            Issue.record("not a questionAsked event")
            return
        }
        #expect(!question.question.isEmpty)
    }

    @Test func aTypedAnswerGoesBackAndTheCardCloses() async throws {
        let (questions, panel, speech, sent) = make()
        await questions.asked(Self.question)
        #expect(panel.shown.map(\.question) == [Self.question])
        #expect(panel.shown.first?.password == false)
        #expect(speech.said == [Self.question.question])

        panel.choose?(.answer("Q3 Report"))
        try await settle { !sent.params.isEmpty }
        #expect(sent.params == [AnswerQuestionParams(taskId: "t1", subtaskId: "s1", answer: "Q3 Report")])
        #expect(panel.closed == ["s1"])
        #expect(questions.open.isEmpty)
        // A second tap does nothing.
        panel.choose?(.answer("again"))
        try await Task.sleep(for: .milliseconds(30))
        #expect(sent.params.count == 1)
    }

    @Test func aSpokenAnswerGoesBackToo() async throws {
        let (questions, panel, _, sent) = make(heard: "  the one in Yumi smoke test  ")
        await questions.asked(Self.question)
        try await settle { !sent.params.isEmpty }
        #expect(sent.params.map(\.answer) == ["the one in Yumi smoke test"])
        #expect(panel.closed == ["s1"])
    }

    @Test func stopCancelsTheTask() async throws {
        let (questions, panel, _, sent) = make()
        var cancelled: [String] = []
        questions.cancel = { cancelled.append($0) }
        await questions.asked(Self.question)
        panel.choose?(.stop)
        #expect(cancelled == ["t1"])
        #expect(sent.params.isEmpty)
        #expect(panel.closed == ["s1"])
    }

    @Test func theCardGoesWhenTheTaskStopsWaiting() async {
        let (questions, panel, _, sent) = make()
        await questions.asked(Self.question)
        questions.taskStatusChanged("t1", .waitingForUser)
        #expect(panel.closed.isEmpty)
        questions.taskStatusChanged("t1", .cancelled)
        #expect(panel.closed == ["s1"])
        panel.choose?(.answer("late"))
        #expect(sent.params.isEmpty, "a late answer is not sent")
    }

    @Test func thePasswordQuestionHasDoneAndStopAndNoBox() async throws {
        // The copy must match what the harness sends (harness/src/gui/copy.ts).
        let source = try String(contentsOf: ProtocolTypesTests.examples
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("harness/src/gui/copy.ts"), encoding: .utf8)
        #expect(source.contains("\"\(QuestionCopy.passwordQuestion)\""))

        let (questions, panel, _, sent) = make()
        await questions.asked(QuestionAsked(taskId: "t1", subtaskId: "s2", question: QuestionCopy.passwordQuestion))
        #expect(panel.shown.first?.password == true)
        panel.choose?(.answer(QuestionCopy.doneAnswer))
        try await settle { !sent.params.isEmpty }
        #expect(sent.params.map(\.answer) == ["done"])
    }

    @Test func aFailedAnswerIsReported() async throws {
        let panel = FakePanel()
        struct Down: Error {}
        let questions = TaskQuestions(speech: FakeSpeech(), listen: { nil }, presenter: panel, send: { _ in throw Down() })
        var failures = 0
        questions.failed = { _ in failures += 1 }
        await questions.asked(Self.question)
        panel.choose?(.answer("Q3 Report"))
        try await settle { failures > 0 }
        #expect(failures == 1)
    }
}
