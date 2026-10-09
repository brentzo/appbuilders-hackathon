import AppKit
import SwiftUI
import struct YumiProtocol.FoundList

/// The finished task's card: a small floating panel in the top-right corner of the display with
/// the user's pointer, just under the menu bar, like the other cards it never activates Yumi, so
/// the user's app keeps focus. Out of the way of the repeat-back, which sits at the top center.
@MainActor
final class SummaryPanel: SummaryPresenting {
    private var panel: NSPanel?
    private var taskId: String?

    func show(taskId: String, text: String, list: FoundList?, close: @escaping () -> Void, save: (() -> Void)?) {
        self.close()
        let hosting = NSHostingView(rootView: SummaryView(text: text, list: list, close: close, save: save))
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

/// What Yumi said when the task finished, on screen as it is said, with a close button. When the
/// task found a list, all of it under the line, scrollable, with "Save to Notes" or, once the list
/// is in a note, a line saying so (SPEC-02 r13).
struct SummaryView: View {
    let text: String
    var list: FoundList?
    let close: () -> Void
    var save: (() -> Void)?

    static let closeLabel = "Close"
    static let saveLabel = "Save to Notes"
    static let savedLabel = "Saved in a new note"

    var body: some View {
        VStack(alignment: .leading, spacing: YumiSpace.m) {
            line
            // Under the line, beside the badge, as wide as the line and its close button.
            if let list { SummaryListView(list: list, save: save).padding(.leading, 32 + YumiSpace.m) }
        }
        .padding(YumiSpace.l)
        .yumiCard()
    }

    private var line: some View {
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
    }
}

/// The full list on the summary card: its title, every item in a well that scrolls past about a
/// dozen rows, and the note button or the saved line.
struct SummaryListView: View {
    let list: FoundList
    let save: (() -> Void)?

    static let rowHeight: CGFloat = 20
    static let visibleRows = 12

    /// "and 12 more" under the items, when the listing stopped at its limit.
    static func moreLine(_ more: Int?) -> String? {
        guard let more, more > 0 else { return nil }
        return "and \(more) more"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: YumiSpace.s) {
            Text(list.title)
                .font(YumiFont.label)
                .foregroundStyle(YumiColor.ink)
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                        Text(row)
                            .font(YumiFont.caption)
                            .foregroundStyle(YumiColor.ink)
                            .lineLimit(1)
                            .truncationMode(.middle)
                            .frame(maxWidth: .infinity, minHeight: Self.rowHeight, alignment: .leading)
                    }
                }
                .padding(.horizontal, YumiSpace.s)
                .padding(.vertical, YumiSpace.xs)
            }
            .frame(width: 334, height: CGFloat(min(rows.count, Self.visibleRows)) * Self.rowHeight + YumiSpace.s)
            .yumiWell()
            HStack {
                Spacer()
                if let save {
                    Button(SummaryView.saveLabel, action: save)
                        .buttonStyle(YumiPrimaryButtonStyle())
                } else if list.inNote {
                    Label(SummaryView.savedLabel, systemImage: "checkmark")
                        .font(YumiFont.caption)
                        .foregroundStyle(YumiColor.muted)
                }
            }
        }
    }

    private var rows: [String] {
        list.items + (Self.moreLine(list.more).map { [$0] } ?? [])
    }
}
