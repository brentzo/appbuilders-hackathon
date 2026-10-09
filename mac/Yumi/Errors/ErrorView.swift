import SwiftUI

/// Shows one `PresentedError`: the copy, any detail, and its buttons, with the first available
/// button as the default (rightmost, as macOS places it).
struct ErrorView: View {
    let error: PresentedError
    let perform: (ErrorButtonAction) -> Void

    private var primaryLabel: String? {
        error.buttons.first { $0.action != .notAvailableYet }?.label
    }

    var body: some View {
        VStack(alignment: .leading, spacing: YumiSpace.xl) {
            HStack(alignment: .top, spacing: YumiSpace.l) {
                // Trouble is hush lavender, never red (SPEC-11, design README).
                YumiBadge(size: 44, hush: true)
                VStack(alignment: .leading, spacing: YumiSpace.s) {
                    Text(error.message)
                        .font(YumiFont.body)
                        .foregroundStyle(YumiColor.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    if let detail = error.detail {
                        Text(detail)
                            .font(YumiFont.body)
                            .foregroundStyle(YumiColor.muted)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.top, YumiSpace.xs)
            }

            HStack(spacing: YumiSpace.s) {
                Spacer()
                ForEach(error.buttons.reversed(), id: \.label) { button in
                    let available = button.action != .notAvailableYet
                    let isPrimary = button.label == primaryLabel
                    Button(button.label) { perform(button.action) }
                        .buttonStyle(YumiButtonStyle(primary: isPrimary))
                        .keyboardShortcut(isPrimary ? .defaultAction : nil)
                        .disabled(!available)
                        .help(available ? "" : "Not available yet")
                }
            }
        }
        .padding(YumiSpace.xl)
        .frame(width: 440)
        .yumiWindow()
        // Esc always closes the error, even when every button waits on a later objective.
        .onExitCommand { perform(.dismiss) }
        .fixedSize(horizontal: false, vertical: true)
    }
}
