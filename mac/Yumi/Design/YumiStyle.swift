import AppKit
import SwiftUI

// The Mac app's shared look, built on the design tokens in `Yumi.swift` (character/design).
// Color rules: one ginger button per panel, never red, hush lavender for trouble, cocoa
// headings, panels on surface over paper.

/// The one ginger action of a panel ("ginger means go"). Drawn by hand, so it keeps its color in
/// floating panels that never become key, where AppKit would gray out a default button.
struct YumiPrimaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        YumiButtonBody(configuration: configuration, fill: YumiColor.accent, text: YumiColor.onAccent, border: nil)
    }
}

/// Every other button: a quiet raised fill with a hairline.
struct YumiSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        YumiButtonBody(configuration: configuration, fill: YumiColor.surfaceRaised, text: YumiColor.ink, border: YumiColor.line)
    }
}

private struct YumiButtonBody: View {
    let configuration: ButtonStyleConfiguration
    let fill: Color
    let text: Color
    let border: Color?
    @Environment(\.isEnabled) private var isEnabled

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: YumiRadius.control, style: .continuous)
        configuration.label
            .font(YumiFont.label)
            .foregroundStyle(text)
            .padding(.horizontal, YumiSpace.m)
            .padding(.vertical, 5)
            .background(fill, in: shape)
            .overlay { if let border { shape.strokeBorder(border) } }
            .contentShape(shape)
            .opacity(isEnabled ? 1 : 0.45)
            // A small, fast press: the button heard the click.
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .brightness(configuration.isPressed ? -0.04 : 0)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}

extension View {
    /// A floating card: surface on a hairline, with the panel radius. The panel adds the shadow.
    func yumiCard() -> some View {
        let shape = RoundedRectangle(cornerRadius: YumiRadius.panel, style: .continuous)
        return background(YumiColor.surface, in: shape)
            .overlay(shape.strokeBorder(YumiColor.line))
            .padding(1)
    }

    /// A recessed well inside a card or window, for lists such as files or permissions.
    func yumiWell() -> some View {
        let shape = RoundedRectangle(cornerRadius: YumiRadius.field, style: .continuous)
        return background(YumiColor.paperDeep, in: shape)
            .overlay(shape.strokeBorder(YumiColor.line))
    }

    /// A window's content: paper behind it, ink text, and ginger for system controls.
    func yumiWindow() -> some View {
        foregroundStyle(YumiColor.ink)
            .tint(YumiColor.accent)
            .background(YumiColor.paper)
    }
}

extension NSWindow {
    /// Paper all the way into the title bar, so the window reads as one sheet.
    func applyYumiStyle() {
        backgroundColor = NSColor(YumiColor.paper)
        titlebarAppearsTransparent = true
    }
}

/// The Yumi mark on a soft disc: the brand at the top of welcome and success screens.
struct YumiBadge: View {
    var size: CGFloat = 40
    /// Trouble shows on hush lavender, never red (SPEC-04, SPEC-11).
    var hush = false

    var body: some View {
        Image("YumiMark")
            .resizable()
            .interpolation(.high)
            .aspectRatio(contentMode: .fit)
            .padding(size * 0.16)
            .frame(width: size, height: size)
            .background(hush ? YumiColor.hush : YumiColor.halo, in: Circle())
            .accessibilityHidden(true)
    }
}

/// A small symbol on a tinted disc, for the leading icon of a floating card.
struct YumiSymbolBadge: View {
    let systemName: String
    var hush = false

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: 15, weight: .semibold))
            .foregroundStyle(hush ? YumiColor.onHush : YumiColor.brand)
            .frame(width: 32, height: 32)
            .background(hush ? YumiColor.hush : YumiColor.halo, in: Circle())
            .accessibilityHidden(true)
    }
}
