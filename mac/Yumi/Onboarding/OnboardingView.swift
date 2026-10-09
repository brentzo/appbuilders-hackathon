import SwiftUI

/// Asks for the three permissions, one row each, with the SPEC-11 sentence for why.
struct OnboardingView: View {
    let permissions: PermissionCenter
    let close: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: YumiSpace.xl) {
            HStack(spacing: YumiSpace.m) {
                YumiBadge(size: 48)
                Text("Before Yumi can help")
                    .font(YumiFont.title)
                    .foregroundStyle(YumiColor.brand)
            }

            VStack(spacing: 0) {
                ForEach(Array(Permission.allCases.enumerated()), id: \.element) { index, permission in
                    if index > 0 {
                        Rectangle().fill(YumiColor.line).frame(height: 1)
                    }
                    PermissionRow(permission: permission, permissions: permissions)
                }
            }
            .background(YumiColor.surface, in: RoundedRectangle(cornerRadius: YumiRadius.panel, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: YumiRadius.panel, style: .continuous).strokeBorder(YumiColor.line))

            HStack {
                Spacer()
                Button(permissions.allGranted ? "Done" : "Not now", action: close)
                    .buttonStyle(YumiButtonStyle(primary: permissions.allGranted))
                    .keyboardShortcut(permissions.allGranted ? .defaultAction : .cancelAction)
            }
        }
        .padding(YumiSpace.xl)
        .frame(width: 520)
        .yumiWindow()
        .fixedSize(horizontal: false, vertical: true)
    }
}

private struct PermissionRow: View {
    let permission: Permission
    let permissions: PermissionCenter

    var body: some View {
        let granted = permissions.state(of: permission) == .granted
        HStack(alignment: .center, spacing: 14) {
            YumiSymbolBadge(systemName: permission.symbolName)

            VStack(alignment: .leading, spacing: YumiSpace.xxs) {
                Text(permission.title)
                    .font(YumiFont.label)
                    .foregroundStyle(YumiColor.ink)
                Text(UserErrorCopy.copy(for: permission.missingErrorKind).message)
                    .font(YumiFont.caption)
                    .foregroundStyle(YumiColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 12)

            // A fixed-width trailing column, so the text wraps the same in every row.
            Group {
                if granted {
                    Label("Allowed", systemImage: "checkmark.circle.fill")
                        .labelStyle(.titleAndIcon)
                        .font(YumiFont.label)
                        .foregroundStyle(YumiColor.accentText)
                        .accessibilityLabel("\(permission.title) allowed")
                } else {
                    Button("Open settings") {
                        Task { await permissions.openSettings(for: permission) }
                    }
                    .buttonStyle(YumiSecondaryButtonStyle())
                    .accessibilityHint("Opens \(permission.title) in System Settings")
                }
            }
            .frame(width: 120, alignment: .trailing)
        }
        .padding(.horizontal, YumiSpace.l)
        .padding(.vertical, YumiSpace.m)
    }
}
