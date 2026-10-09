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
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 14) {
                Image(systemName: "cat.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 6) {
                    Text(error.message)
                        .font(.body)
                        .fixedSize(horizontal: false, vertical: true)
                    if let detail = error.detail {
                        Text(detail)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }

            HStack(spacing: 10) {
                Spacer()
                ForEach(error.buttons.reversed(), id: \.label) { button in
                    let available = button.action != .notAvailableYet
                    Button(button.label) { perform(button.action) }
                        .keyboardShortcut(button.label == primaryLabel ? .defaultAction : nil)
                        .disabled(!available)
                        .help(available ? "" : "Not available yet")
                }
            }
        }
        .padding(20)
        .frame(width: 440)
        // Esc always closes the error, even when every button waits on a later objective.
        .onExitCommand { perform(.dismiss) }
        .fixedSize(horizontal: false, vertical: true)
    }
}
