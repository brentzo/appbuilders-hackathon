import AppKit
import OSLog
import SwiftUI
import YumiProtocol

/// "Voice didn't load (Mac)" (SPEC-11, OBJ-51): a small floating panel at the top of the main
/// display. It does not activate Yumi, so the user's app keeps focus, and it stays until answered.
/// The copy is never spoken: the voice is what failed.
@MainActor
final class VoiceWarningPanel {
    /// "Try again": loads the voice again.
    var tryAgain: () -> Void = {}
    private var panel: NSPanel?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "speech")

    var isShown: Bool { panel != nil }

    func show() {
        close()
        let error = ErrorPresenter.present(UserError(kind: .voiceFailedToLoad))
        log.notice("Showing the voiceFailedToLoad warning")
        let hosting = NSHostingView(rootView: VoiceWarningView(error: error) { [weak self] action in
            self?.close()
            if action == .reloadVoice { self?.tryAgain() }
        })
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
        panel.isMovableByWindowBackground = true
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        if let visible = NSScreen.main?.visibleFrame {
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

struct VoiceWarningView: View {
    let error: PresentedError
    let perform: (ErrorButtonAction) -> Void

    var body: some View {
        HStack(spacing: YumiSpace.m) {
            // Trouble is hush lavender, never red (SPEC-11, design README).
            YumiBadge(size: 32, hush: true)
            Text(error.message)
                .font(YumiFont.body)
                .foregroundStyle(YumiColor.ink)
                .fixedSize(horizontal: false, vertical: true)
                .frame(width: 300, alignment: .leading)
            HStack(spacing: YumiSpace.s) {
                // macOS order: the main action on the right.
                ForEach(error.buttons.reversed(), id: \.label) { button in
                    let isPrimary = button.action == .reloadVoice
                    Button(button.label) { perform(button.action) }
                        .buttonStyle(YumiButtonStyle(primary: isPrimary))
                }
            }
            .fixedSize()
        }
        .padding(.horizontal, YumiSpace.l)
        .padding(.vertical, YumiSpace.m)
        .yumiCard()
    }
}
