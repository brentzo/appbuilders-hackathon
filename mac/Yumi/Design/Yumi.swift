// Generated from character/design/tokens.json by character/design/build.py. Do not edit by hand.
// Copied into the Mac app with one change: every declaration is `nonisolated`, because the app
// target defaults to the main actor and AppKit resolves the dynamic colors off the main thread.
import AppKit
import SwiftUI

/// Yumi's colors. Each one follows the system appearance (light or dark) on its own.
nonisolated public enum YumiColor {
    /// Page and window background.
    public static let paper = dynamicColor(light: 0xF9F6E7, dark: 0x17120F)
    /// Recessed areas: stages, wells, sidebars.
    public static let paperDeep = dynamicColor(light: 0xF3EDDA, dark: 0x1F1814)
    /// Cards and panels on paper.
    public static let surface = dynamicColor(light: 0xFFFDF6, dark: 0x261E19)
    /// Hover and pressed fills, secondary buttons.
    public static let surfaceRaised = dynamicColor(light: 0xF4ECDA, dark: 0x2F2620)
    /// Hairlines and card borders.
    public static let line = dynamicColor(light: 0xE7DCC4, dark: 0x3E322A)
    /// Body text and icons on paper and surface.
    public static let ink = dynamicColor(light: 0x3A2620, dark: 0xF7EEDF)
    /// Secondary text on paper and surface.
    public static let muted = dynamicColor(light: 0x6F5A4F, dark: 0xC4B3A2)
    /// Placeholders and captions at 18 px or larger only; below 4.5:1 for small text.
    public static let faint = dynamicColor(light: 0x9A887C, dark: 0x8E7D6F)
    /// The wordmark and headings: the cat's cocoa line.
    public static let brand = dynamicColor(light: 0x6E413E, dark: 0xF0A76A)
    /// The one action color: primary buttons, listening, progress. Ginger means go.
    public static let accent = dynamicColor(light: 0xF0A76A, dark: 0xF0A76A)
    /// Text and icons on accent.
    public static let onAccent = dynamicColor(light: 0x3A2018, dark: 0x3A2018)
    /// Accent-colored text and links on paper.
    public static let accentText = dynamicColor(light: 0x9A4F17, dark: 0xF0A76A)
    /// The click point only, plus the cat's cheeks.
    public static let coral = dynamicColor(light: 0xED8770, dark: 0xED8770)
    /// The soft disc behind the cat.
    public static let halo = dynamicColor(light: 0xF3E6CA, dark: 0x2B221C)
    /// Stuck and paused. Trouble is lavender, never red.
    public static let hush = dynamicColor(light: 0xB7A8E8, dark: 0xB7A8E8)
    /// Text on hush.
    public static let onHush = dynamicColor(light: 0x2A2440, dark: 0x2A2440)
}

/// One cat's colors. The main cat is always ginger; ghost littermates use their own.
nonisolated public struct YumiCatPalette: Sendable {
    public let fur: Color
    public let markings: Color
    public let line: Color
    public let cheeks: Color
}

nonisolated public enum YumiCatColors {
    public static let ginger = YumiCatPalette(fur: rgbColor(0xF0A76A), markings: rgbColor(0xF6DBB5), line: rgbColor(0x6E413E), cheeks: rgbColor(0xED8770))
    public static let mint = YumiCatPalette(fur: rgbColor(0x86D6BE), markings: rgbColor(0xDDF3EA), line: rgbColor(0x2F5A50), cheeks: rgbColor(0xEE9A86))
    public static let sky = YumiCatPalette(fur: rgbColor(0x93BCF0), markings: rgbColor(0xE0EBFB), line: rgbColor(0x30466B), cheeks: rgbColor(0xEE9A86))
    public static let slate = YumiCatPalette(fur: rgbColor(0xAEB4BE), markings: rgbColor(0xEEF0F3), line: rgbColor(0x3B4049), cheeks: rgbColor(0xEE9A86))
    /// Ghost cursors take these in order.
    public static let littermates = [mint, sky, slate]
}

/// Text styles. Mac panels use the system font so they feel native.
nonisolated public enum YumiFont {
    /// Hero lines and the wordmark.
    public static let display = Font.system(size: 40, weight: .heavy)
    /// Screen and card titles.
    public static let title = Font.system(size: 24, weight: .bold)
    /// Section headings, Yumi's spoken line on screen.
    public static let headline = Font.system(size: 19, weight: .semibold)
    /// Body copy.
    public static let body = Font.system(size: 15, weight: .regular)
    /// Buttons and chips.
    public static let label = Font.system(size: 13, weight: .semibold)
    /// Captions and timestamps.
    public static let caption = Font.system(size: 12, weight: .regular)
    /// Times, states, and other values.
    public static let data = Font.system(size: 12, weight: .regular, design: .monospaced)
}

nonisolated public enum YumiSpace {
    public static let xxs: CGFloat = 2
    public static let xs: CGFloat = 4
    public static let s: CGFloat = 8
    public static let m: CGFloat = 12
    public static let l: CGFloat = 16
    public static let xl: CGFloat = 24
    public static let xxl: CGFloat = 32
    public static let xxxl: CGFloat = 48
}

nonisolated public enum YumiRadius {
    public static let control: CGFloat = 7
    public static let field: CGFloat = 10
    public static let panel: CGFloat = 16
    public static let card: CGFloat = 24
    public static let pill: CGFloat = 999
}

nonisolated public enum YumiMotion {
    public static let move: Double = 0.3
    public static let pounce: Double = 0.3
    public static let fadeOut: Double = 1.0
    public static let panel: Double = 0.35
    /// The cursor's eased move. With Reduce Motion on, use a plain glide instead.
    public static let moveAnimation = Animation.timingCurve(0.25, 0.85, 0.3, 1, duration: move)
}

nonisolated private func nsColor(_ hex: UInt32) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
}

nonisolated private func rgbColor(_ hex: UInt32) -> Color { Color(nsColor: nsColor(hex)) }

nonisolated private func dynamicColor(light: UInt32, dark: UInt32) -> Color {
    Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua ? nsColor(dark) : nsColor(light)
    })
}
