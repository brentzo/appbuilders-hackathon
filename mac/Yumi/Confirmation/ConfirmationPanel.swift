import AppKit
import SwiftUI
import YumiProtocol

/// The repeat-back panel (OBJ-17.4): a small floating panel at the top of the display with the
/// user's pointer. Like the tiling question, it never activates Yumi, so the user's app keeps focus.
/// In Auto mode (OBJ-50) the same panel shows what Yumi heard, without buttons.
@MainActor
final class ConfirmationPanel: ConfirmationPresenting, HeardPresenting {
    private var panel: NSPanel?
    private var taskId: String?

    func show(taskId: String, text: String, choose: @escaping (ConfirmationChoice) -> Void) {
        present(ConfirmationView(text: text, choose: choose), for: taskId)
    }

    func showHeard(taskId: String, line: String, heard: String) {
        present(HeardView(line: line, heard: heard), for: taskId)
    }

    private func present(_ view: some View, for taskId: String) {
        close()
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
        VStack(alignment: .leading, spacing: YumiSpace.l) {
            HStack(alignment: .top, spacing: YumiSpace.m) {
                YumiBadge(size: 32)
                // Yumi's spoken line, on screen as it is said.
                Text(text)
                    .font(YumiFont.headline)
                    .foregroundStyle(YumiColor.ink)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(width: 360, alignment: .leading)
            }
            HStack(spacing: YumiSpace.s) {
                Button(ConfirmationCopy.cancel) { choose(.cancel) }
                    .buttonStyle(YumiSecondaryButtonStyle())
                Spacer()
                Button(ConfirmationCopy.changeIt) { choose(.changeIt) }
                    .buttonStyle(YumiSecondaryButtonStyle())
                Button(ConfirmationCopy.goAhead) { choose(.goAhead) }
                    .buttonStyle(YumiPrimaryButtonStyle())
            }
        }
        .padding(YumiSpace.l)
        .yumiCard()
    }
}

/// Auto mode's acknowledgement (OBJ-50.4): Yumi's line, and what it heard under it.
struct HeardView: View {
    let line: String
    let heard: String

    var body: some View {
        HStack(alignment: .top, spacing: YumiSpace.m) {
            YumiBadge(size: 32)
            VStack(alignment: .leading, spacing: YumiSpace.xs) {
                Text(line)
                    .font(YumiFont.headline)
                    .foregroundStyle(YumiColor.ink)
                Text("“\(heard)”")
                    .font(YumiFont.body)
                    .foregroundStyle(YumiColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: 360, alignment: .leading)
        }
        .padding(YumiSpace.l)
        .yumiCard()
    }
}
