import AppKit
import SwiftUI
import struct YumiProtocol.QuestionAsked

/// The question card: a floating panel at the top of the display with the user's pointer, like the
/// approval card. It never activates Yumi, but it can take typing when the user clicks its box.
@MainActor
final class QuestionPanel: QuestionPresenting {
    private var panels: [String: NSPanel] = [:]

    func show(_ question: QuestionAsked, password: Bool, choose: @escaping (QuestionChoice) -> Void) {
        close(subtaskId: question.subtaskId)
        let hosting = NSHostingView(rootView: QuestionCardView(question: question.question, password: password, choose: choose))
        let size = hosting.fittingSize
        let panel = TypingPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        panel.contentView = hosting
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .floating
        panel.isReleasedWhenClosed = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        let pointer = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(pointer) } ?? NSScreen.main
        if let visible = screen?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: visible.midX - size.width / 2, y: visible.maxY - size.height - 12))
        }
        panel.orderFrontRegardless()
        panels[question.subtaskId] = panel
    }

    func close(subtaskId: String) {
        panels.removeValue(forKey: subtaskId)?.close()
    }

    /// A borderless panel only takes typing if it may become key; it still never activates Yumi.
    private final class TypingPanel: NSPanel {
        override var canBecomeKey: Bool { true }
    }
}

struct QuestionCardView: View {
    let question: String
    /// The password card: the user types into the app, so it has no box, only "Done" and "Stop".
    let password: Bool
    let choose: (QuestionChoice) -> Void
    @State private var answer = ""

    private var trimmed: String { answer.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: YumiSpace.m) {
            HStack(alignment: .top, spacing: YumiSpace.m) {
                YumiSymbolBadge(systemName: password ? "key.fill" : "questionmark.bubble.fill")
                Text(question)
                    .font(YumiFont.body)
                    .foregroundStyle(YumiColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(width: 400, alignment: .leading)
            }
            if !password {
                TextField(QuestionCopy.placeholder, text: $answer, axis: .vertical)
                    .lineLimit(1...3)
                    .textFieldStyle(.roundedBorder)
                    .onSubmit { if !trimmed.isEmpty { choose(.answer(trimmed)) } }
            }
            HStack(spacing: YumiSpace.s) {
                Spacer()
                Button(QuestionCopy.stop) { choose(.stop) }
                    .buttonStyle(YumiSecondaryButtonStyle())
                if password {
                    Button(QuestionCopy.done) { choose(.answer(QuestionCopy.doneAnswer)) }
                        .buttonStyle(YumiPrimaryButtonStyle())
                } else {
                    Button(QuestionCopy.answer) { choose(.answer(trimmed)) }
                        .buttonStyle(YumiPrimaryButtonStyle())
                        .disabled(trimmed.isEmpty)
                }
            }
        }
        .padding(YumiSpace.l)
        .yumiCard()
    }
}
