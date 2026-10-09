import AppKit
import SwiftUI

/// The paused panel with "Resume" and "Cancel" (OBJ-35.5, SPEC-06 r6), at the top of the display
/// with the pointer. Like Yumi's other panels it never activates Yumi, and clicks on it are never
/// a take-over.
@MainActor
final class PausedPanel: PausedPresenting {
    private var panel: NSPanel?

    func show(text: String, resume: @escaping () -> Void, cancel: @escaping () -> Void) {
        close()
        let hosting = NSHostingView(rootView: PausedView(text: text, resume: resume, cancel: cancel))
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
    }

    func close() {
        panel?.close()
        panel = nil
    }
}

struct PausedView: View {
    let text: String
    let resume: () -> Void
    let cancel: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: "pause.circle.fill")
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(text)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 280, alignment: .leading)
            HStack(spacing: 8) {
                Button(PauseCopy.cancel, action: cancel)
                Button(PauseCopy.resume, action: resume)
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
