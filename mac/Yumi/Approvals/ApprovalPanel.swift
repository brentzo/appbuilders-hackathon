import AppKit
import SwiftUI
import YumiProtocol

/// The approval card (OBJ-40.1, 45.2): a floating panel at the top of the display with the user's
/// pointer, which never activates Yumi. Everything it shows comes from the harness's `Approval`.
@MainActor
final class ApprovalPanel: ApprovalPresenting {
    private var panels: [String: NSPanel] = [:]

    func show(_ approval: Approval, tap: @escaping (Bool) -> Void) {
        close(approvalId: approval.id)
        let hosting = NSHostingView(rootView: ApprovalCardView(approval: approval, tap: tap))
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
        panels[approval.id] = panel
    }

    func close(approvalId: String) {
        panels.removeValue(forKey: approvalId)?.close()
    }
}

struct ApprovalCardView: View {
    let approval: Approval
    let tap: (Bool) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(approval.text)
                .fixedSize(horizontal: false, vertical: true)
                .frame(width: 400, alignment: .leading)
            if approval.kind == .delete, let files = approval.files {
                FileList(files: files)
            }
            HStack(spacing: 8) {
                Spacer()
                if approval.kind == .send {
                    Button(ApprovalCopy.dontSend) { tap(false) }
                    Button(ApprovalCopy.send) { tap(true) }
                        .buttonStyle(AlwaysProminentButtonStyle())
                } else {
                    Button(ApprovalCopy.dontDelete) { tap(false) }
                    Button(ApprovalCopy.delete) { tap(true) }
                        .buttonStyle(AlwaysProminentButtonStyle(color: .red))
                }
            }
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.separator, lineWidth: 0.5))
        .padding(1)
    }
}

/// The folder, the first 5 names, and "and N more" (SPEC-07 r10).
struct FileList: View {
    let files: FileSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Label(files.folder, systemImage: "folder")
                .font(.callout.weight(.medium))
                .lineLimit(1)
                .truncationMode(.middle)
            ForEach(Array(files.firstNames.prefix(5).enumerated()), id: \.offset) { _, name in
                Label(name, systemImage: "doc")
                    .font(.callout)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            let more = files.count - min(files.firstNames.count, 5)
            if more > 0 {
                Text(ApprovalCopy.andMore(more))
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 26)
            }
        }
        .frame(width: 400, alignment: .leading)
        .padding(10)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}
