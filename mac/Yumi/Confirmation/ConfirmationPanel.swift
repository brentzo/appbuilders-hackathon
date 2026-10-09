import AppKit
import SwiftUI
import YumiProtocol

/// The repeat-back panel (OBJ-17.4): a small floating panel at the top of the display with the
/// user's pointer. Like the tiling question, it never activates Yumi, so the user's app keeps focus.
@MainActor
final class ConfirmationPanel: ConfirmationPresenting {
    private var panel: NSPanel?
    private var taskId: String?

    func show(taskId: String, text: String, choose: @escaping (ConfirmationChoice) -> Void) {
        close()
        let hosting = NSHostingView(rootView: ConfirmationView(text: text, choose: choose))
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
        let pointer = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(pointer) } ?? NSScreen.main
        if let visible = screen?.visibleFrame {
            panel.setFrameOrigin(NSPoint(x: visible.midX - size.width / 2, y: visible.maxY - size.height - 12))
        }
        panel.orderFrontRegardless()
        self.panel = panel
        self.taskId = taskId
    }

    func close(taskId: String) {
        if self.taskId == taskId { close() }
    }

    private func close() {
        panel?.close()
        panel = nil
        taskId = nil
    }
}

struct ConfirmationView: View {
    let text: String
    let choose: (ConfirmationChoice) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(text)
                .font(.body)
                .fixedSize(horizontal: false, vertical: true)
                .frame(width: 380, alignment: .leading)
            HStack(spacing: 8) {
                Button(ConfirmationCopy.cancel) { choose(.cancel) }
                Spacer()
                Button(ConfirmationCopy.changeIt) { choose(.changeIt) }
                Button(ConfirmationCopy.goAhead) { choose(.goAhead) }
                    .buttonStyle(AlwaysProminentButtonStyle())
            }
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.separator, lineWidth: 0.5))
        .padding(1)
    }
}
