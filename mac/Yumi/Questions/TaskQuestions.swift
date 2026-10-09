import Foundation
import OSLog
import struct YumiProtocol.AnswerQuestionParams
import struct YumiProtocol.QuestionAsked
import enum YumiProtocol.TaskStatus

/// The words of a question card that are not the harness's own question, in one place.
enum QuestionCopy {
    static let answer = "Answer"
    static let stop = "Stop"
    /// SPEC-07 "Draft copy", "Asking the user to type a password": its buttons.
    static let done = "Done"
    static let placeholder = "Type your answer, or just say it"
    /// What "Done" on the password card sends back: the user typed it themselves.
    static let doneAnswer = "done"
    /// The harness's password question (harness/src/gui/copy.ts, from SPEC-07 "Draft copy"). The
    /// user types the password into the app, never into Yumi, so this card has no answer box.
    static let passwordQuestion = "This needs your password, so please type it yourself. I won't read it. Tell me when you're done."
}

/// What the user chose on a question card.
enum QuestionChoice: Equatable {
    case answer(String)
    case stop
}

/// Shows a question card. The live one is `QuestionPanel`; tests record.
@MainActor
protocol QuestionPresenting: AnyObject {
    func show(_ question: QuestionAsked, password: Bool, choose: @escaping (QuestionChoice) -> Void)
    func close(subtaskId: String)
}

/// A worker's question to the user (`questionAsked`, OBJ-36.9): Yumi says it, shows it in a card
/// with a box to type the answer, and listens for a spoken one. The answer goes back with
/// `answerQuestion`; "Stop" cancels the task. The card closes once answered, or when the task stops
/// waiting (cancelled, paused, done).
///
/// Before this, the Mac dropped the event ("Not handled yet"), so a task that asked waited forever
/// with nothing on screen (Brent's live check, 2026-10-10, task d608891a).
@MainActor
final class TaskQuestions {
    private let speech: SpeechOutput
    private let listen: () async -> String?
    private let presenter: QuestionPresenting
    private let send: (AnswerQuestionParams) async throws -> Void
    /// "Stop": cancels the task (`cancelTask`).
    var cancel: (String) -> Void = { _ in }
    /// The answer could not reach the harness: shown through the error presenter.
    var failed: (Error) -> Void = { _ in }
    /// The questions waiting on the user, by subtask.
    private(set) var open: [String: QuestionAsked] = [:]
    /// How many answers reached the harness.
    private(set) var sent = 0
    var presenterForTests: QuestionPresenting { presenter }
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "questions")

    init(
        speech: SpeechOutput, listen: @escaping () async -> String?, presenter: QuestionPresenting,
        send: @escaping (AnswerQuestionParams) async throws -> Void
    ) {
        self.speech = speech
        self.listen = listen
        self.presenter = presenter
        self.send = send
    }

    func asked(_ question: QuestionAsked) async {
        open[question.subtaskId] = question
        // Only the length: the question can quote what is on the user's screen.
        log.notice("Question for the user, \(question.question.count, privacy: .public) characters")
        presenter.show(question, password: question.question == QuestionCopy.passwordQuestion) { [weak self] choice in
            self?.answered(question, choice)
        }
        await speech.speak(question.question)
        // Said out loud too: the card's box and buttons still work while Yumi listens.
        guard isOpen(question), let heard = await listen(), isOpen(question) else { return }
        let text = heard.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        answered(question, .answer(text))
    }

    /// The task stopped waiting: its cards go.
    func taskStatusChanged(_ taskId: String, _ status: TaskStatus) {
        guard status != .waitingForUser else { return }
        for question in open.values where question.taskId == taskId {
            open[question.subtaskId] = nil
            presenter.close(subtaskId: question.subtaskId)
        }
    }

    private func isOpen(_ question: QuestionAsked) -> Bool {
        open[question.subtaskId] == question
    }

    private func answered(_ question: QuestionAsked, _ choice: QuestionChoice) {
        guard isOpen(question) else { return }
        open[question.subtaskId] = nil
        presenter.close(subtaskId: question.subtaskId)
        switch choice {
        case .stop:
            log.notice("Question answered with Stop: cancelling the task")
            cancel(question.taskId)
        case .answer(let text):
            log.notice("Question answered, \(text.count, privacy: .public) characters")
            let params = AnswerQuestionParams(taskId: question.taskId, subtaskId: question.subtaskId, answer: text)
            Task {
                do {
                    try await send(params)
                    sent += 1
                } catch {
                    failed(error)
                }
            }
        }
    }
}
