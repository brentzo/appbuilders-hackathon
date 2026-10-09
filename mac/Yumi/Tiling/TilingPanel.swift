import AppKit
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
        HStack(spacing: YumiSpace.m) {
            YumiSymbolBadge(systemName: "rectangle.split.2x2")
            Text(TilingCopy.question)
                .font(YumiFont.body)
                .foregroundStyle(YumiColor.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 260, alignment: .leading)
            HStack(spacing: YumiSpace.s) {
                Button(TilingCopy.leave) { answer(false) }
                    .buttonStyle(YumiSecondaryButtonStyle())
                Button(TilingCopy.arrange) { answer(true) }
                    .buttonStyle(YumiPrimaryButtonStyle())
            }
            .fixedSize()
        }
        .padding(.horizontal, YumiSpace.l)
        .padding(.vertical, YumiSpace.m)
        .yumiCard()
    }
}
