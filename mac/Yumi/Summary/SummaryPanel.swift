import AppKit
import SwiftUI

/// The finished task's card: a small floating panel in the top-right corner of the display with
/// the user's pointer, just under the menu bar, like the other cards it never activates Yumi, so
/// the user's app keeps focus. Out of the way of the repeat-back, which sits at the top center.
@MainActor
final class SummaryPanel: SummaryPresenting {
    private var panel: NSPanel?
    private var taskId: String?

    func show(taskId: String, text: String, close: @escaping () -> Void) {
        self.close()
        let hosting = NSHostingView(rootView: SummaryView(text: text, close: close))
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
            panel.setFrameOrigin(NSPoint(x: visible.maxX - size.width - 12, y: visible.maxY - size.height - 12))
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

/// What Yumi said when the task finished, on screen as it is said, with a close button.
struct SummaryView: View {
    let text: String
    let close: () -> Void

    static let closeLabel = "Close"

    var body: some View {
        HStack(alignment: .top, spacing: YumiSpace.m) {
            YumiBadge(size: 32)
            Text(text)
                .font(YumiFont.body)
                .foregroundStyle(YumiColor.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(width: 300, alignment: .leading)
                .padding(.top, 6)
            Button(action: close) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(YumiColor.muted)
                    .frame(width: 22, height: 22)
                    .background(YumiColor.surfaceRaised, in: Circle())
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Self.closeLabel)
            .help(Self.closeLabel)
        }
        .padding(YumiSpace.l)
        .yumiCard()
    }
}
