import AppKit
import AVFoundation
import SwiftUI

/// The tiling question as a small floating panel at the top of the task's display (OBJ-20.2).
/// It does not activate Yumi, so the user's app keeps focus until they answer.
@MainActor
final class TilingPanel {
    private var panel: NSPanel?
    private var taskId: String?

    func show(taskId: String, on screen: NSScreen?, answer: @escaping (Bool) -> Void) {
        close()
        let view = TilingQuestionView { [weak self] arrange in
            self?.close()
            answer(arrange)
        }
        let hosting = NSHostingView(rootView: view)
        let size = hosting.fittingSize
        let panel = NSPanel(
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
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        if let visible = (screen ?? NSScreen.main)?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: visible.midX - size.width / 2, y: visible.maxY - size.height - 12))
        }
        panel.orderFrontRegardless()
        self.panel = panel
        self.taskId = taskId
    }

    /// Closes the question of that task, for example when the task ended before the user answered.
    func dismiss(taskId: String) {
        if self.taskId == taskId { close() }
    }

    private func close() {
        panel?.close()
        panel = nil
        taskId = nil
    }
}

struct TilingQuestionView: View {
    let answer: (Bool) -> Void

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "rectangle.split.2x2")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(TilingCopy.question)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 260, alignment: .leading)
            HStack(spacing: 8) {
                Button(TilingCopy.leave) { answer(false) }
                Button(TilingCopy.arrange) { answer(true) }
                    .buttonStyle(AlwaysProminentButtonStyle())
            }
            .fixedSize()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.separator, lineWidth: 0.5))
        .padding(1)
    }
}

/// The panel never becomes key, so AppKit would draw a prominent button in its inactive gray.
/// This keeps the main choice in the accent color, like an active window's default button.
struct AlwaysProminentButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .padding(.horizontal, 10)
            .padding(.vertical, 3)
            .foregroundStyle(.white)
            .background(
                Color.accentColor.opacity(configuration.isPressed ? 0.8 : 1),
                in: RoundedRectangle(cornerRadius: 5, style: .continuous)
            )
    }
}

/// STAND-IN: says the question with the system voice until the `speak` interface from OBJ-17
/// exists. Replace it there; the tiler only needs a `(String) -> Void`.
@MainActor
final class TilingVoice {
    private let synthesizer = AVSpeechSynthesizer()

    func say(_ text: String) {
        synthesizer.speak(AVSpeechUtterance(string: text))
    }
}
