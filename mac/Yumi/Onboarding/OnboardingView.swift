import SwiftUI

/// Asks for the three permissions, one row each, with the SPEC-11 sentence for why.
struct OnboardingView: View {
    let permissions: PermissionCenter
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 12) {
                Image(systemName: "cat.fill")
                    .font(.system(size: 28))
                    .foregroundStyle(.tint)
                    .accessibilityHidden(true)
                Text("Before Yumi can help")
                    .font(.title2.weight(.semibold))
            }

            VStack(spacing: 0) {
                ForEach(Array(Permission.allCases.enumerated()), id: \.element) { index, permission in
                    if index > 0 { Divider() }
                    PermissionRow(permission: permission, permissions: permissions)
                }
            }
            .background(.background.secondary, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(.separator))

            HStack {
                Spacer()
                Button(permissions.allGranted ? "Done" : "Not now", action: close)
                    .keyboardShortcut(permissions.allGranted ? .defaultAction : .cancelAction)
            }
        }
        .padding(24)
        .frame(width: 520)
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct PermissionRow: View {
    let permission: Permission
    let permissions: PermissionCenter

    var body: some View {
        let granted = permissions.state(of: permission) == .granted
        HStack(alignment: .center, spacing: 14) {
            Image(systemName: permission.symbolName)
                .font(.title2)
                .foregroundStyle(.secondary)
                .frame(width: 28)
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 3) {
                Text(permission.title)
                    .font(.headline)
                Text(UserErrorCopy.copy(for: permission.missingErrorKind).message)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 12)

            // A fixed-width trailing column, so the text wraps the same in every row.
            Group {
                if granted {
                    Label("Allowed", systemImage: "checkmark.circle.fill")
                        .labelStyle(.titleAndIcon)
                        .foregroundStyle(.green)
                        .accessibilityLabel("\(permission.title) allowed")
                } else {
                    Button("Open settings") {
                        Task { await permissions.openSettings(for: permission) }
                    }
                    .accessibilityHint("Opens \(permission.title) in System Settings")
                }
            }
            .frame(width: 120, alignment: .trailing)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }
}
