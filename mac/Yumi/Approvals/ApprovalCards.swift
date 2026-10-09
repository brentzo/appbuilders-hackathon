import Foundation
import OSLog
import YumiProtocol

/// Shows one approval card. The live one is `ApprovalPanel`.
@MainActor
protocol ApprovalPresenting: AnyObject {
    /// `tap` reports a button: true for "Send" or "Delete".
    func show(_ approval: Approval, tap: @escaping (Bool) -> Void)
    func close(approvalId: String)
}

/// The send and delete cards (OBJ-40.1 to 45.4, 45.6): what the harness's `showApprovalCard`
/// waits on. The card shows the harness's text as is, says its first sentence, and listens once.
/// Only "send it" approves by voice, and only a send; a delete needs a tap (SPEC-07 r11, r15).
@MainActor
final class ApprovalCards {
    private let speech: SpeechOutput
    private let listen: () async -> String?
    private let presenter: ApprovalPresenting
    private let overlay: CursorOverlay
    private var pending: [String: (approval: Approval, answer: CheckedContinuation<ApprovalDecision, Never>, cursorState: CursorState?)] = [:]
    /// Exact paths of deletes the user approved with a tap. `moveToTrash` refuses anything else.
    private(set) var approvedTrashPaths: Set<String> = []
    /// True while Yumi is stopped (OBJ-35): then nothing is moved to the Trash. Set by the app.
    var isStopped: () -> Bool = { false }
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "approvals")

    init(speech: SpeechOutput, listen: @escaping () async -> String?, presenter: ApprovalPresenting, overlay: CursorOverlay) {
        self.speech = speech
        self.listen = listen
        self.presenter = presenter
        self.overlay = overlay
    }

    var openApprovalIds: Set<String> { Set(pending.keys) }

    /// `showApprovalCard`: returns once the user decided, or the approval was cancelled.
    func show(_ approval: Approval) async -> ApprovalDecision {
        await withCheckedContinuation { continuation in
            let cursorState = overlay.cursors[GoalConfirmation.mainCursorId]?.state
            pending[approval.id] = (approval, continuation, cursorState)
            overlay.update(GoalConfirmation.mainCursorId) { $0.state = .waitingForUser }
            presenter.show(approval) { [weak self] approved in
                self?.decide(approval.id, approved: approved, method: .tap)
            }
            Task { await speakAndListen(approval) }
        }
    }

    /// `approvalCancelled`, or a pause (SPEC-06 r5): the card closes at once and a late tap does
    /// nothing. The harness no longer waits for this answer; it gets a decline, so nothing runs.
    func cancel(approvalId: String) {
        guard let entry = pending.removeValue(forKey: approvalId) else { return }
        close(entry.approval, cursorState: entry.cursorState)
        entry.answer.resume(returning: Self.decision(approved: false, method: .tap))
        log.notice("Approval \(approvalId, privacy: .public) cancelled")
    }

    /// A pause: every open card closes, and every approved delete is forgotten, so a
    /// `moveToTrash` on its way, or sent after resuming, cannot use it (SPEC-06 r5, SPEC-07 r12).
    func cancelAll() {
        for id in Array(pending.keys) { cancel(approvalId: id) }
        approvedTrashPaths.removeAll()
    }

    /// `moveToTrash`: only paths of a tapped delete approval, and each approval covers them once.
    func moveToTrash(_ paths: [String]) throws -> [String] {
        guard !isStopped() else { throw Trash.Failure.stopped }
        let trashed = try Trash.move(paths, approved: approvedTrashPaths)
        approvedTrashPaths.subtract(paths.map(Trash.expand))
        return trashed
    }

    private func speakAndListen(_ approval: Approval) async {
        await speech.speak(ApprovalCopy.firstSentence(approval.text))
        guard approval.kind == .send, pending[approval.id] != nil, let heard = await listen() else { return }
        switch ApprovalCopy.spokenSendReply(heard) {
        case .sendIt: decide(approval.id, approved: true, method: .voice)
        case .dontSend: decide(approval.id, approved: false, method: .voice)
        case .unclear: break // the card stays until a button is tapped
        }
    }

    private func decide(_ approvalId: String, approved: Bool, method: ApprovalMethod) {
        guard let entry = pending.removeValue(forKey: approvalId) else { return }
        let approval = entry.approval
        // A delete is approved only by a tap, whatever called this (SPEC-07 r11).
        let approved = approved && !(approval.kind == .delete && method != .tap)
        close(approval, cursorState: entry.cursorState)
        if approved, approval.kind == .delete, let files = approval.files {
            approvedTrashPaths.formUnion(files.allPaths.map(Trash.expand))
        }
        if !approved {
            Task { await speech.speak(ApprovalCopy.declined(approval)) }
        }
        entry.answer.resume(returning: Self.decision(approved: approved, method: method))
    }

    private func close(_ approval: Approval, cursorState: CursorState?) {
        presenter.close(approvalId: approval.id)
        if let cursorState {
            overlay.update(GoalConfirmation.mainCursorId) { $0.state = cursorState }
        }
    }

    static func decision(approved: Bool, method: ApprovalMethod) -> ApprovalDecision {
        ApprovalDecision(approved: approved, method: method, decidedAt: ISO8601DateFormatter().string(from: Date()))
    }
}

/// `moveToTrash` (OBJ-40.7): exact paths only, to the Trash only. Nothing is deleted permanently.
@MainActor
enum Trash {
    enum Failure: Error, Equatable {
        /// A wildcard or a relative path: refused before anything moves (second guard after the harness).
        case notAnExactPath(String)
        /// Yumi is stopped: nothing moves until the task resumes and asks again.
        case stopped
        /// A path no tapped delete approval covered (SPEC-07 r11, r12).
        case notApproved(String)
    }

    static func expand(_ path: String) -> String {
        URL(fileURLWithPath: NSString(string: path).expandingTildeInPath).standardizedFileURL.path
    }

    /// Checks every path first, then moves each to the Trash. Returns the paths that moved.
    static func move(_ paths: [String], approved: Set<String>, fileManager: FileManager = .default) throws -> [String] {
        for path in paths {
            guard !path.contains("*"), !path.contains("?"), path.hasPrefix("/") || path.hasPrefix("~/") else {
                throw Failure.notAnExactPath(path)
            }
            guard approved.contains(expand(path)) else { throw Failure.notApproved(path) }
        }
        var trashed: [String] = []
        for path in paths {
            do {
                try fileManager.trashItem(at: URL(fileURLWithPath: expand(path)), resultingItemURL: nil)
                trashed.append(path)
            } catch {
                // Gone or locked: it is left out of the result, and the harness reports it.
                Logger(subsystem: "ph.appbuilders.yumi", category: "approvals").error("Could not move a file to the Trash: \(String(describing: error), privacy: .public)")
            }
        }
        return trashed
    }
}
