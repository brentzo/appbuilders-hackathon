import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// OBJ-40 against SPEC-07: card text only from the harness, a delete only by tap, "send it" by
/// voice, the declined lines, cancelled cards ignoring late taps, the blocked-action buttons, and
/// `moveToTrash` moving only exact, approved paths to the Trash.
@MainActor
struct ApprovalCardsTests {
    final class FakeSpeech: SpeechOutput {
        var said: [String] = []
        func speak(_ text: String) async { said.append(text) }
    }

    final class FakeCard: ApprovalPresenting {
        var shown: [Approval] = []
        var closed: [String] = []
        var tap: ((Bool) -> Void)?
        func show(_ approval: Approval, tap: @escaping (Bool) -> Void) {
            shown.append(approval)
            self.tap = tap
        }
        func close(approvalId: String) { closed.append(approvalId) }
    }

    final class Heard {
        var replies: [String]
        var listens = 0
        init(_ replies: [String]) { self.replies = replies }
    }

    let speech = FakeSpeech()
    let card = FakeCard()
    let overlay = CursorOverlay(locator: WindowCenterLocator())

    func cards(hearing heard: Heard) -> ApprovalCards {
        overlay.spawn(id: "main", kind: .main, label: nil, at: .zero)
        overlay.update("main") { $0.state = .acting }
        return ApprovalCards(speech: speech, listen: {
            heard.listens += 1
            return heard.replies.isEmpty ? nil : heard.replies.removeFirst()
        }, presenter: card, overlay: overlay)
    }

    static let send = Approval(
        id: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a81", stepId: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", kind: .send,
        recipients: ["Ana Cruz <ana@example.com>"], text: "I'm about to send this email to Ana. Should I send it?",
        requestedAt: "2026-10-09T15:42:00+08:00", expiresAt: "2026-10-09T15:47:00+08:00"
    )
    static let delete = Approval(
        id: "4d5e6f7a-8b9c-4d0e-9f2a-3b4c5d6e7f80", stepId: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", kind: .delete,
        files: FileSummary(folder: "~/Downloads", count: 7, firstNames: ["a.pdf", "b.pdf", "c.pdf", "d.pdf", "e.pdf"],
                           allPaths: ["a", "b", "c", "d", "e", "f", "g"].map { "~/Downloads/\($0).pdf" }),
        text: "I'm about to move 7 files from Downloads to the Trash, starting with a.pdf. Should I delete them?",
        requestedAt: "2026-10-09T15:42:00+08:00", expiresAt: "2026-10-09T15:47:00+08:00"
    )

    /// Lets the card's speak-then-listen task run.
    func settle() async throws { try await Task.sleep(for: .milliseconds(50)) }

    @Test func sendingAnEmailIsApprovedBySayingSendIt() async throws {
        let heard = Heard(["send it"])
        let cards = cards(hearing: heard)
        let decision = await cards.show(Self.send)
        #expect(decision.approved && decision.method == .voice)
        #expect(card.shown == [Self.send], "the card shows the harness's approval as is")
        #expect(speech.said == ["I'm about to send this email to Ana."], "only the first sentence is spoken")
        #expect(card.closed == [Self.send.id])
        #expect(overlay.cursors["main"]?.state == .acting, "the cursor goes back after waiting for the user")
    }

    @Test func dontSendItByVoiceDeclines() async throws {
        let cards = cards(hearing: Heard(["don't send it"]))
        let decision = await cards.show(Self.send)
        #expect(!decision.approved)
        try await settle()
        #expect(speech.said.last == "Okay, I didn't send it. The draft is still there if you want to change anything.")
    }

    @Test func sayingYesIsNotEnoughToDelete() async throws {
        let heard = Heard(["yes", "delete them"])
        let cards = cards(hearing: heard)
        let answer = Task { await cards.show(Self.delete) }
        try await settle()
        #expect(heard.listens == 0, "a delete card does not take a voice answer")
        #expect(overlay.cursors["main"]?.state == .waitingForUser)
        #expect(cards.openApprovalIds == [Self.delete.id])

        card.tap?(true)
        let decision = await answer.value
        #expect(decision.approved && decision.method == .tap)
        #expect(cards.approvedTrashPaths.contains(Trash.expand("~/Downloads/g.pdf")))
    }

    @Test func userDeclinesADelete() async throws {
        let cards = cards(hearing: Heard([]))
        let answer = Task { await cards.show(Self.delete) }
        try await settle()
        card.tap?(false)
        #expect(!(await answer.value).approved)
        try await settle()
        #expect(speech.said.last == "Okay, I left the files alone. Want me to do anything else with them?")
        #expect(cards.approvedTrashPaths.isEmpty)

        var one = Self.delete
        one.files = FileSummary(folder: "~/Downloads", count: 1, firstNames: ["old-invoice.pdf"], allPaths: ["~/Downloads/old-invoice.pdf"])
        #expect(ApprovalCopy.declined(one) == "Okay, I left the file alone. Want me to do anything else with it?")
    }

    static let action = Approval(
        id: "6f7a8b9c-0d1e-4f2a-9b3c-4d5e6f7a8b92", stepId: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f", kind: .action,
        text: "I'm about to click Save in Finder. Should I allow it?",
        requestedAt: "2026-10-09T15:42:00+08:00", expiresAt: "2026-10-09T15:47:00+08:00"
    )

    @Test func anUnclassifiedActionIsAllowedOnlyByATap() async throws {
        let heard = Heard(["allow", "yes"])
        let cards = cards(hearing: heard)
        let answer = Task { await cards.show(Self.action) }
        try await settle()
        #expect(heard.listens == 0, "an action card does not take a voice answer (SPEC-07 r6)")
        #expect(card.shown == [Self.action], "the card shows the harness's summary as is")
        #expect(ApprovalCardView.labels(for: .action) == (approve: "Allow", decline: "Don't allow"))
        #expect(ApprovalCardView.symbol(for: .action) == "hand.raised.fill")

        card.tap?(true)
        let decision = await answer.value
        #expect(decision.approved && decision.method == .tap)
        #expect(cards.approvedTrashPaths.isEmpty)
    }

    @Test func userDeclinesAnUnclassifiedAction() async throws {
        let cards = cards(hearing: Heard([]))
        let answer = Task { await cards.show(Self.action) }
        try await settle()
        card.tap?(false)
        #expect(!(await answer.value).approved)
        try await settle()
        #expect(speech.said.last == "Okay, I didn't do that. Want me to try something else?")
    }

    @Test func aCancelledCardClosesAndIgnoresALateTap() async throws {
        let cards = cards(hearing: Heard([]))
        let answer = Task { await cards.show(Self.delete) }
        try await settle()
        cards.cancel(approvalId: Self.delete.id)
        #expect(!(await answer.value).approved)
        #expect(card.closed == [Self.delete.id])
        card.tap?(true)
        #expect(cards.approvedTrashPaths.isEmpty, "a tap after the cancel does nothing")
    }

    @Test func voiceAndSentenceRules() {
        #expect(ApprovalCopy.spokenSendReply("Send it.") == .sendIt)
        #expect(ApprovalCopy.spokenSendReply("yes, send it please") == .sendIt)
        #expect(ApprovalCopy.spokenSendReply("don't send it") == .dontSend)
        #expect(ApprovalCopy.spokenSendReply("do not send it") == .dontSend)
        #expect(ApprovalCopy.spokenSendReply("yes") == .unclear)
        #expect(ApprovalCopy.firstSentence(Self.delete.text) == "I'm about to move 7 files from Downloads to the Trash, starting with a.pdf.")
        #expect(ApprovalCopy.andMore(7) == "and 7 more")
        #expect([ApprovalCopy.send, ApprovalCopy.dontSend, ApprovalCopy.delete, ApprovalCopy.dontDelete] == ["Send", "Don't send", "Delete", "Don't delete"])
    }

    @Test func theBlockedActionCardKeepsGoingOrStops() {
        let presented = ErrorPresenter.present(UserError(kind: .blockedAction, taskId: "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8"))
        // An older harness names no action: the message still reads as a sentence.
        #expect(presented.message == "I can't do that. It's blocked to keep your Mac safe, so I skipped it. Want me to keep going with the rest?")
        #expect(presented.buttons == [
            ErrorButton(label: "Keep going", action: .resumeTask("6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8")),
            ErrorButton(label: "Stop", action: .cancelTask("6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8")),
        ])
    }

    /// SPEC-07 r5: the card names what it skipped, from the harness's plain-language action.
    @Test func theBlockedActionCardNamesWhatItSkipped() throws {
        let data = try Data(contentsOf: ProtocolTypesTests.examples.appendingPathComponent("UserError.blocked-action-named.json"))
        let error = UserErrorDecoding.decode(data)
        #expect(error.skippedAction == "press Command-Q in Keynote")
        #expect(ErrorPresenter.present(error).message == "I can't press Command-Q in Keynote. It's blocked to keep your Mac safe, so I skipped it. Want me to keep going with the rest?")
        let file = ErrorPresenter.present(UserError(kind: .blockedAction, taskId: "t", skippedAction: "click File in Keynote"))
        #expect(file.message.hasPrefix("I can't click File in Keynote. It's blocked"))
        // A placeholder never reaches the user.
        #expect(!ErrorPresenter.present(UserError(kind: .blockedAction, skippedAction: " ")).message.contains("{"))
    }

    /// Records instead of touching the real Trash. FileManager is nonisolated, so this is too.
    nonisolated final class RecordingTrash: FileManager, @unchecked Sendable {
        nonisolated(unsafe) var trashed: [URL] = []
        override func trashItem(at url: URL, resultingItemURL outResultingURL: AutoreleasingUnsafeMutablePointer<NSURL?>?) throws {
            trashed.append(url)
        }
    }

    @Test func moveToTrashMovesOnlyExactApprovedPaths() throws {
        let approved: Set<String> = [Trash.expand("~/Downloads/a.pdf"), Trash.expand("~/Downloads/b.pdf")]
        let files = RecordingTrash()

        #expect(throws: Trash.Failure.notAnExactPath("~/Downloads/*.pdf")) {
            try Trash.move(["~/Downloads/*.pdf"], approved: approved, fileManager: files)
        }
        #expect(throws: Trash.Failure.notAnExactPath("Downloads/a.pdf")) {
            try Trash.move(["Downloads/a.pdf"], approved: approved, fileManager: files)
        }
        #expect(throws: Trash.Failure.notApproved("~/Documents/taxes.pdf")) {
            try Trash.move(["~/Downloads/a.pdf", "~/Documents/taxes.pdf"], approved: approved, fileManager: files)
        }
        #expect(files.trashed.isEmpty, "a refused call moves nothing")

        let moved = try Trash.move(["~/Downloads/a.pdf", "~/Downloads/b.pdf"], approved: approved, fileManager: files)
        #expect(moved == ["~/Downloads/a.pdf", "~/Downloads/b.pdf"])
        #expect(files.trashed.map(\.path) == approved.sorted())
    }
}
