import OSLog
import YumiProtocol

/// The words of the confirmation step (SPEC-01, OBJ-17). The repeat-back itself comes from the
/// harness (`goalRestated`); the app never writes it.
enum ConfirmationCopy {
    static let goAhead = "Go ahead"
    static let changeIt = "Change it"
    static let cancel = "Cancel"
    static let cancelled = "Okay, I won't do anything."
}

/// Shows the repeat-back with its three buttons. The live one is `ConfirmationPanel`.
@MainActor
protocol ConfirmationPresenting: AnyObject {
    func show(taskId: String, text: String, choose: @escaping (ConfirmationChoice) -> Void)
    func close(taskId: String)
}

/// The Mac half of goal confirmation (OBJ-17.3, 17.4, 17.6, 17.7): the main cursor appears when a
/// goal arrives, Yumi says the harness's repeat-back and shows it with "Go ahead", "Change it", and
/// "Cancel", listens for a spoken answer, and sends every answer to the harness. The harness decides
/// what an answer means; nothing here starts work.
@MainActor
final class GoalConfirmation {
    /// The id of the main cursor, shared with the harness's `spawn` (OBJ-18).
    static let mainCursorId = "main"
    /// A spoken answer is listened for at most twice per repeat-back: the first ask, and one
    /// more when the harness asks again because the answer was unclear. Then only buttons work.
    static let listensPerRestatement = 2

    typealias Reply = (_ taskId: String, _ reply: ConfirmationReply) async throws -> Void

    private let speech: SpeechOutput
    /// Voice intake (OBJ-15) sets its own; until then nothing is heard.
    var listener: ReplyListening
    private let presenter: ConfirmationPresenting
    private let overlay: CursorOverlay
    private let reply: Reply
    /// Tasks waiting for an answer, with the last repeat-back and how many listens it has left.
    private var waiting: [String: (text: String, listensLeft: Int)] = [:]
    /// Tasks whose cancel line was already said, so a later `cancelled` status does not repeat it.
    private var cancelHandled: Set<String> = []
    /// Tasks the harness reported an error for while confirming. The harness sends the error before
    /// the `cancelled` status, and the user hears only the error copy, not the cancel line.
    private var failed: Set<String> = []
    /// The task whose repeat-back was shown last, which push-to-talk answers.
    private var latest: String?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "confirmation")

    init(speech: SpeechOutput, listener: ReplyListening, presenter: ConfirmationPresenting, overlay: CursorOverlay, reply: @escaping Reply) {
        self.speech = speech
        self.listener = listener
        self.presenter = presenter
        self.overlay = overlay
        self.reply = reply
    }

    var waitingTaskIds: Set<String> { Set(waiting.keys) }

    /// A goal was spoken or typed: the main cursor appears next to the user's pointer right away,
    /// before the harness has restated it (OBJ-17.3, SPEC-04 r1).
    func goalSubmitted() {
        overlay.apply(.spawn(SpawnCursor(cursorId: Self.mainCursorId, cursorKind: .main)))
        overlay.update(Self.mainCursorId) { $0.state = .thinking }
    }

    /// `goalRestated`: say it, show it, then listen for the answer (OBJ-17.4, 17.5).
    func goalRestated(_ restated: GoalRestated) async {
        let taskId = restated.taskId
        let previous = waiting[taskId]
        // The same sentence again means the harness is asking again after an unclear answer.
        let listensLeft = previous?.text == restated.text ? previous!.listensLeft : Self.listensPerRestatement
        waiting[taskId] = (restated.text, listensLeft)
        latest = taskId
        presenter.show(taskId: taskId, text: restated.text) { [weak self] choice in
            Task { await self?.choose(choice, for: taskId) }
        }
        overlay.update(Self.mainCursorId) { $0.state = .listening }
        await speech.speak(restated.text)
        await listenOnce(for: taskId)
    }

    /// Speech from push-to-talk or the wake word while a repeat-back waits is the answer to it, not
    /// a new goal: the user may answer with the shortcut after the hands-free listen ended. Returns
    /// false when nothing waits, so the speech is a new goal.
    func takeSpokenAnswer(_ text: String) -> Bool {
        guard let taskId = latest, waiting[taskId] != nil else { return false }
        overlay.update(Self.mainCursorId) { $0.state = .thinking }
        Task { await send(.spoken(SpokenReply(text: text)), for: taskId) }
        return true
    }

    /// A button in the panel.
    func choose(_ choice: ConfirmationChoice, for taskId: String) async {
        guard waiting[taskId] != nil else { return }
        if choice == .cancel {
            finish(taskId, cancelled: true)
        } else if choice == .goAhead {
            presenter.close(taskId: taskId)
        }
        await send(.button(ButtonReply(choice: choice)), for: taskId)
        if choice == .changeIt {
            // The user is about to say the change; it goes to the harness as a spoken answer.
            waiting[taskId]?.listensLeft = Self.listensPerRestatement
            await listenOnce(for: taskId)
        }
    }

    /// `userError` for a task still being confirmed: the harness could not repeat it back or read
    /// the answer, and cancels it next. Only the error copy is said (Brent's decision, 2026-10-10).
    func userError(_ error: UserError) {
        guard let taskId = error.taskId, waiting[taskId] != nil else { return }
        failed.insert(taskId)
    }

    /// The task left `awaitingConfirmation`: confirmed (planning), or cancelled, possibly by voice.
    func taskStatusChanged(_ taskId: String, _ status: TaskStatus) {
        // Only a task still being confirmed: cancelling one that already runs has its own copy.
        guard status != .awaitingConfirmation, waiting[taskId] != nil else { return }
        finish(taskId, cancelled: status == .cancelled)
    }

    private func listenOnce(for taskId: String) async {
        guard let entry = waiting[taskId], entry.listensLeft > 0 else { return }
        waiting[taskId]?.listensLeft = entry.listensLeft - 1
        guard let heard = await listener.listenForReply()?.trimmingCharacters(in: .whitespacesAndNewlines), !heard.isEmpty,
              waiting[taskId] != nil
        else { return }
        await send(.spoken(SpokenReply(text: heard)), for: taskId)
    }

    private func send(_ answer: ConfirmationReply, for taskId: String) async {
        do {
            try await reply(taskId, answer)
        } catch {
            // The panel stays, so the user can answer again with a button.
            log.error("replyToConfirmation failed: \(String(describing: error), privacy: .public)")
        }
    }

    /// Closes the panel. A cancel also says the cancel line and fades the cursor (OBJ-17.6), but
    /// a cancel that came with an error only fades the cursor: the error copy says what happened.
    private func finish(_ taskId: String, cancelled: Bool) {
        waiting.removeValue(forKey: taskId)
        presenter.close(taskId: taskId)
        guard cancelled, cancelHandled.insert(taskId).inserted else { return }
        overlay.fade(id: Self.mainCursorId)
        guard failed.remove(taskId) == nil else { return }
        Task { await speech.speak(ConfirmationCopy.cancelled) }
    }
}
