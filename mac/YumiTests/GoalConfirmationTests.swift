import AppKit
import Testing
import YumiProtocol
@testable import Yumi

/// The Mac half of OBJ-17 against SPEC-01: the cursor appears when a goal arrives, the harness's
/// repeat-back is said and shown, every answer goes to the harness, cancel says its line and
/// fades the cursor, an unclear answer is listened for once more, and nothing acts before a confirm.
@MainActor
struct GoalConfirmationTests {
    final class FakeSpeech: SpeechOutput {
        var said: [String] = []
        func speak(_ text: String) async { said.append(text) }
    }

    final class FakeListener: ReplyListening {
        var answers: [String?]
        var listens = 0
        init(_ answers: [String?]) { self.answers = answers }
        func listenForReply() async -> String? {
            listens += 1
            return answers.isEmpty ? nil : answers.removeFirst()
        }
    }

    final class FakePanel: ConfirmationPresenting {
        var shown: [String] = []
        var closed: [String] = []
        var choose: ((ConfirmationChoice) -> Void)?
        var isOpen: Bool { shown.count > closed.count }
        func show(taskId: String, text: String, choose: @escaping (ConfirmationChoice) -> Void) {
            shown.append(text)
            self.choose = choose
        }
        func close(taskId: String) { closed.append(taskId) }
    }

    static let taskId = "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8"
    static let restated = "You want me to rename the invoices in your Downloads folder by date. Should I go ahead?"
    static let corrected = "Got it. You want me to rename only the October invoices in your Downloads folder by date. Should I go ahead?"

    let speech = FakeSpeech()
    let panel = FakePanel()
    let overlay: CursorOverlay
    var replies: [ConfirmationReply] = []

    init() {
        overlay = CursorOverlay(locator: WindowCenterLocator())
        overlay.start()
    }

    final class Sent {
        var replies: [ConfirmationReply] = []
    }

    func confirmation(_ listener: FakeListener, sent: Sent) -> GoalConfirmation {
        GoalConfirmation(speech: speech, listener: listener, presenter: panel, overlay: overlay) { taskId, reply in
            #expect(taskId == Self.taskId)
            sent.replies.append(reply)
        }
    }

    @Test func userGivesAGoalAndConfirmsByVoice() async {
        let sent = Sent()
        let flow = confirmation(FakeListener(["yes"]), sent: sent)

        flow.goalSubmitted()
        let spawned = overlay.cursors[GoalConfirmation.mainCursorId]
        #expect(spawned?.kind == .main)
        // The harness's own spawn of the main cursor keeps it where it is.
        overlay.apply(.spawn(SpawnCursor(cursorId: "main", cursorKind: .main)))
        #expect(overlay.cursors["main"]?.position == spawned?.position)

        await flow.goalRestated(GoalRestated(taskId: Self.taskId, text: Self.restated))
        #expect(speech.said == [Self.restated])
        #expect(panel.shown == [Self.restated])
        #expect(sent.replies == [.spoken(SpokenReply(text: "yes"))])

        flow.taskStatusChanged(Self.taskId, .planning)
        #expect(!panel.isOpen)
        #expect(overlay.cursors["main"] != nil, "confirmed work keeps the cursor")
    }

    @Test func buttonsSendTheirChoice() async {
        let sent = Sent()
        let flow = confirmation(FakeListener([]), sent: sent)
        await flow.goalRestated(GoalRestated(taskId: Self.taskId, text: Self.restated))
        #expect([ConfirmationCopy.goAhead, ConfirmationCopy.changeIt, ConfirmationCopy.cancel] == ["Go ahead", "Change it", "Cancel"])

        await flow.choose(.goAhead, for: Self.taskId)
        #expect(sent.replies == [.button(ButtonReply(choice: .goAhead))])
        #expect(!panel.isOpen)
    }

    @Test func userCorrectsTheGoal() async {
        let sent = Sent()
        let flow = confirmation(FakeListener(["no, only the ones from October", "yes"]), sent: sent)
        await flow.goalRestated(GoalRestated(taskId: Self.taskId, text: Self.restated))
        await flow.goalRestated(GoalRestated(taskId: Self.taskId, text: Self.corrected))
        #expect(speech.said == [Self.restated, Self.corrected])
        #expect(panel.shown.last == Self.corrected)
        #expect(sent.replies == [.spoken(SpokenReply(text: "no, only the ones from October")), .spoken(SpokenReply(text: "yes"))])
    }

    @Test func userCancelsBeforeWorkStarts() async throws {
        let sent = Sent()
        let flow = confirmation(FakeListener([]), sent: sent)
        flow.goalSubmitted()
        await flow.goalRestated(GoalRestated(taskId: Self.taskId, text: Self.restated))

        await flow.choose(.cancel, for: Self.taskId)
        try await Task.sleep(for: .milliseconds(50))
        #expect(sent.replies == [.button(ButtonReply(choice: .cancel))])
        #expect(speech.said.last == "Okay, I won't do anything.")
        #expect(overlay.cursors["main"] == nil, "the cursor fades out")
        #expect(!panel.isOpen)

        // The harness then reports the cancel; the line is not said twice.
        flow.taskStatusChanged(Self.taskId, .cancelled)
        try await Task.sleep(for: .milliseconds(50))
        #expect(speech.said.filter { $0 == ConfirmationCopy.cancelled }.count == 1)
    }

    @Test func aSpokenCancelSaysTheLineWhenTheHarnessCancels() async throws {
        let sent = Sent()
        let flow = confirmation(FakeListener(["never mind"]), sent: sent)
        flow.goalSubmitted()
        await flow.goalRestated(GoalRestated(taskId: Self.taskId, text: Self.restated))
        flow.taskStatusChanged(Self.taskId, .cancelled)
        try await Task.sleep(for: .milliseconds(50))
        #expect(speech.said.last == "Okay, I won't do anything.")
        #expect(overlay.cursors["main"] == nil)
    }

    @Test func pushToTalkWhileARepeatBackWaitsIsTheAnswer() async throws {
        let sent = Sent()
        // The hands-free listen hears nothing; the user then holds the shortcut and answers.
        let flow = confirmation(FakeListener([nil]), sent: sent)
        flow.goalSubmitted()
        await flow.goalRestated(GoalRestated(taskId: Self.taskId, text: Self.restated))
        #expect(flow.takeSpokenAnswer("no, only the ones from October"))
        try await Task.sleep(for: .milliseconds(50))
        #expect(sent.replies == [.spoken(SpokenReply(text: "no, only the ones from October"))])
        #expect(overlay.cursors["main"]?.state == .thinking)
        #expect(flow.waitingTaskIds == [Self.taskId], "the same task is still being confirmed")
    }

    /// Task 4ecaff1c (2026-10-10): the hands-free listen after the note offer heard nothing, and
    /// the task waited forever. The panel stays with its buttons, the cat shows it waits, and
    /// "Hey Yumi, yes in a note" answers it.
    @Test func whenNothingIsHeardThePanelStaysAndTheWakeWordAnswersIt() async throws {
        let sent = Sent()
        let flow = confirmation(FakeListener([nil]), sent: sent)
        flow.goalSubmitted()
        let offer = "You want me to list the files in your Downloads folder. Want it in a note too?"
        await flow.goalRestated(GoalRestated(taskId: Self.taskId, text: offer))
        #expect(sent.replies.isEmpty)
        #expect(panel.isOpen, "the buttons still work")
        #expect(overlay.cursors[GoalConfirmation.mainCursorId]?.state == .waitingForUser)

        #expect(flow.takeSpokenAnswer("yes, in a note"))
        try await Task.sleep(for: .milliseconds(50))
        #expect(sent.replies == [.spoken(SpokenReply(text: "yes, in a note"))])
    }

    @Test func pushToTalkWithNothingWaitingIsANewGoal() async throws {
        let sent = Sent()
        let flow = confirmation(FakeListener([]), sent: sent)
        #expect(!flow.takeSpokenAnswer("rename the invoices in Downloads by date"))
        // Nor once the repeat-back was answered.
        flow.goalSubmitted()
        await flow.goalRestated(GoalRestated(taskId: Self.taskId, text: Self.restated))
        flow.taskStatusChanged(Self.taskId, .cancelled)
        #expect(!flow.takeSpokenAnswer("rename the invoices in Downloads by date"))
        try await Task.sleep(for: .milliseconds(50))
        #expect(sent.replies.isEmpty)
    }

    @Test func aCancelThatCameWithAnErrorSaysOnlyTheError() async throws {
        let sent = Sent()
        let flow = confirmation(FakeListener([]), sent: sent)
        flow.goalSubmitted()
        await flow.goalRestated(GoalRestated(taskId: Self.taskId, text: Self.restated))
        // The harness could not read the answer: the error first, then the cancelled status.
        flow.userError(UserError(kind: .modelFailedToLoad, taskId: Self.taskId))
        flow.taskStatusChanged(Self.taskId, .cancelled)
        try await Task.sleep(for: .milliseconds(50))
        #expect(!speech.said.contains(ConfirmationCopy.cancelled), "only the error copy is said")
        #expect(overlay.cursors["main"] == nil, "the cursor still fades out")
        #expect(!panel.isOpen)
    }

    @Test func anErrorForAnotherTaskDoesNotSilenceTheCancelLine() async throws {
        let sent = Sent()
        let flow = confirmation(FakeListener([]), sent: sent)
        flow.goalSubmitted()
        await flow.goalRestated(GoalRestated(taskId: Self.taskId, text: Self.restated))
        flow.userError(UserError(kind: .unexpected, taskId: "00000000-0000-4000-8000-000000000000"))
        flow.userError(UserError(kind: .unexpected))
        flow.taskStatusChanged(Self.taskId, .cancelled)
        try await Task.sleep(for: .milliseconds(50))
        #expect(speech.said.last == "Okay, I won't do anything.")
    }

    @Test func anUnclearAnswerIsAskedOnceMoreThenOnlyButtonsWork() async {
        let sent = Sent()
        let listener = FakeListener(["umm", "hmm", "yes"])
        let flow = confirmation(listener, sent: sent)
        // The harness repeats the same sentence after each unclear answer.
        for _ in 0..<3 {
            await flow.goalRestated(GoalRestated(taskId: Self.taskId, text: Self.restated))
        }
        #expect(listener.listens == 2)
        #expect(panel.isOpen, "the panel waits for a button")
    }

    @Test func nothingActsBeforeAConfirm() async throws {
        #expect(!HarnessLink.actionsAllowed(for: [.awaitingConfirmation]))
        #expect(HarnessLink.actionsAllowed(for: [.awaitingConfirmation, .running]))
        #expect(HarnessLink.actionsAllowed(for: [.planning]))
        #expect(HarnessLink.actionsAllowed(for: []))

        let gui = GuiExecutor(overlay: overlay, isTrusted: { true })
        gui.actionsAllowed = { false }
        let result = try await gui.executeAction(ExecuteActionParams(
            stepId: UUID().uuidString.lowercased(),
            target: Target(bundleId: "com.apple.iWork.Keynote"),
            action: RecordedAction(action: .click(ClickAction(element: 1)), element: ResolvedElement(path: "AXWindow/AXButton[0]", role: .button, label: "Export"), permission: .allowed),
            cursorId: "main"
        ))
        #expect(result.outcome == .blocked)
    }
}
