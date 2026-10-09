import Carbon.HIToolbox
import CoreGraphics
import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// OBJ-35 against SPEC-06: tagged input never pauses, the user's input does unless it is on
/// Yumi's own windows or Yumi waits for the user, the local stop lands before the next action
/// and between typing chunks, a pause closes open cards, and resume and cancel.
@MainActor
struct PauseControllerTests {
    final class FakeSpeech: SpeechOutput {
        var said: [String] = []
        func speak(_ text: String) async { said.append(text) }
    }

    final class FakePanel: PausedPresenting, ApprovalPresenting {
        var shownText: [String] = []
        var resume: (() -> Void)?
        var cancel: (() -> Void)?
        var isOpen = false
        func show(text: String, resume: @escaping () -> Void, cancel: @escaping () -> Void) {
            shownText.append(text)
            self.resume = resume
            self.cancel = cancel
            isOpen = true
        }
        func close() { isOpen = false }
        func show(_ approval: Approval, tap: @escaping (Bool) -> Void) {}
        func close(approvalId: String) {}
    }

    final class FakeTasks: TaskControl {
        var paused = 0
        var resumed: [String] = []
        var cancelled: [String] = []
        func pauseAll() async throws { paused += 1 }
        func resume(_ taskId: String) async throws { resumed.append(taskId) }
        func cancel(_ taskId: String) async throws { cancelled.append(taskId) }
    }

    final class Poster: EventPosting {
        var events = 0
        var onPost: (() -> Void)?
        func post(_ event: CGEvent) {
            events += 1
            onPost?()
        }
    }

    static let taskId = "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8"
    let speech = FakeSpeech()
    let panel = FakePanel()
    let tasks = FakeTasks()
    let overlay = CursorOverlay(locator: WindowCenterLocator())
    let poster = Poster()
    let keystrokes: KeystrokeSender
    let approvals: ApprovalCards
    let pause: PauseController

    init() {
        keystrokes = KeystrokeSender(poster: poster)
        approvals = ApprovalCards(speech: speech, listen: { nil }, presenter: panel, overlay: overlay)
        pause = PauseController(
            speech: speech, listen: { "continue" }, panel: panel, overlay: overlay,
            keystrokes: keystrokes, approvals: approvals, tasks: tasks
        )
        pause.activeTasks = { [Self.taskId] }
        overlay.spawn(id: "main", kind: .main, label: nil, at: .zero)
        overlay.spawn(id: "ghost-1", kind: .ghost, label: "Fill expense form", at: .zero)
    }

    func settle() async throws { try await Task.sleep(for: .milliseconds(50)) }

    /// Waits for work Yumi starts in its own tasks (speak, then listen, then answer), at most 2 s.
    func waitUntil(_ condition: () -> Bool) async throws {
        for _ in 0..<100 where !condition() {
            try await Task.sleep(for: .milliseconds(20))
        }
    }

    @Test func onlyTheUsersOwnInputOutsideYumiCountsAsTakingOver() {
        func input(tagged: Bool = false, keyboard: Bool = false, overYumi: Bool = false, yumiKeyboard: Bool = false) -> TakeOverRule.Input {
            .init(tagged: tagged, isKeyboard: keyboard, overYumiWindow: overYumi, yumiHasKeyboard: yumiKeyboard)
        }
        #expect(TakeOverRule.isTakeOver(input(), uiLaneActing: true), "the user moves their mouse")
        #expect(TakeOverRule.isTakeOver(input(keyboard: true), uiLaneActing: true), "the user types")
        #expect(!TakeOverRule.isTakeOver(input(tagged: true), uiLaneActing: true), "Yumi's own input")
        #expect(!TakeOverRule.isTakeOver(input(tagged: true, keyboard: true), uiLaneActing: true))
        #expect(!TakeOverRule.isTakeOver(input(overYumi: true), uiLaneActing: true), "clicking Yumi's own card")
        #expect(!TakeOverRule.isTakeOver(input(keyboard: true, yumiKeyboard: true), uiLaneActing: true))
        #expect(!TakeOverRule.isTakeOver(input(keyboard: true), uiLaneActing: false), "typing a password Yumi asked for")
    }

    @Test func pushToTalkAndTheStopShortcutAreNotTakingOver() {
        let yumi = [KeyShortcut.defaultPushToTalk, StopShortcut.shortcut]
        let space = UInt16(kVK_Space)
        #expect(TakeOverWatcher.matches(keyCode: space, flags: .maskAlternate, any: yumi), "Option-Space")
        #expect(TakeOverWatcher.matches(keyCode: UInt16(kVK_Escape), flags: [.maskControl, .maskAlternate], any: yumi))
        #expect(!TakeOverWatcher.matches(keyCode: space, flags: [], any: yumi), "a plain space is typing")
        #expect(!TakeOverWatcher.matches(keyCode: space, flags: [.maskAlternate, .maskShift], any: yumi))
        // A push-to-talk key the user chose in settings.
        let custom = KeyShortcut(keyCode: UInt16(kVK_ANSI_Y), modifiers: [.command, .shift], keyLabel: "Y")
        #expect(TakeOverWatcher.matches(keyCode: UInt16(kVK_ANSI_Y), flags: [.maskCommand, .maskShift], any: [custom]))

        let pushToTalk = TakeOverRule.Input(tagged: false, isKeyboard: true, overYumiWindow: false, yumiHasKeyboard: false, isYumiShortcut: true)
        #expect(!TakeOverRule.isTakeOver(pushToTalk, uiLaneActing: true))
    }

    @Test func stopShortcutStopsLocallyAtOnceThenTellsTheHarness() async throws {
        let gui = GuiExecutor(overlay: overlay, isTrusted: { true })
        gui.actionsAllowed = { [pause] in !pause.isStopped }

        pause.stop(.shortcut)
        #expect(pause.isStopped)
        #expect(overlay.cursors.values.allSatisfy { $0.state == .paused }, "both cursors freeze")
        let refused = try await gui.executeAction(ExecuteActionParams(
            stepId: UUID().uuidString.lowercased(), target: Target(bundleId: "com.apple.TextEdit"),
            action: RecordedAction(action: .type(TypeTextAction(text: "hello")), permission: .allowed), cursorId: "main"
        ))
        #expect(refused.outcome == .blocked, "no further actions are sent")
        try await settle()
        #expect(tasks.paused == 1)
        #expect(panel.shownText == ["Paused. Say continue when you're ready, or cancel to stop for good."])
        #expect(speech.said == ["Paused. Say continue when you're ready, or cancel to stop for good."])
    }

    @Test func typingStopsBeforeTheNextChunk() async {
        // The user takes the mouse while the first chunk goes out.
        poster.onPost = { [pause] in pause.stop(.takeOver) }
        let typed = await keystrokes.type("This sentence is longer than one chunk of typing.", focusIsSecure: { false })
        #expect(typed.typed == KeystrokeSender.chunkSize)
        #expect(pause.isStopped)
    }

    @Test func takingOverPausesSilently() async throws {
        pause.stop(.takeOver)
        try await settle()
        #expect(speech.said.isEmpty, "Yumi says nothing")
        #expect(panel.shownText == ["Paused."])
        #expect(panel.isOpen)
        #expect([PauseCopy.resume, PauseCopy.cancel] == ["Resume", "Cancel"])
    }

    @Test func pauseCancelsAPendingApproval() async throws {
        let card = Task { [approvals] in
            await approvals.show(Approval(
                id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a81", stepId: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", kind: .send,
                recipients: ["Ana"], text: "I'm about to send this email to Ana. Should I send it?",
                requestedAt: "2026-10-09T15:42:00+08:00", expiresAt: "2026-10-09T15:47:00+08:00"
            ))
        }
        try await settle()
        pause.stop(.shortcut)
        #expect(!(await card.value).approved)
        #expect(approvals.openApprovalIds.isEmpty)
    }

    @Test func userResumesBySayingContinue() async throws {
        pause.stop(.shortcut)
        try await waitUntil { !tasks.resumed.isEmpty }
        #expect(tasks.resumed == [Self.taskId], "\"continue\" resumes")
        #expect(pause.isStopped, "the local stop stays until the harness reports running")
        pause.taskStatusChanged(Self.taskId, .running)
        #expect(!pause.isStopped)
        #expect(!panel.isOpen)
        #expect(PauseController.spokenChoice("resume") == .resume)
        #expect(PauseController.spokenChoice("cancel it") == .cancel)
        #expect(PauseController.spokenChoice("hmm") == nil)
    }

    @Test func userCancelsAPausedTask() async throws {
        pause.stop(.takeOver)
        panel.cancel?()
        try await settle()
        #expect(tasks.cancelled == [Self.taskId])
        #expect(overlay.cursors.isEmpty, "every cursor fades out")
        #expect(speech.said == ["Okay, I stopped. Nothing else will happen."])
        #expect(pause.isStopped, "nothing runs until the harness reports the cancel")
        pause.taskStatusChanged(Self.taskId, .cancelled)
        #expect(!pause.isStopped)
    }
}
