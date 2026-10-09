import AppKit
import SwiftUI
import YumiProtocol

/// One cursor on the overlay (OBJ-18.2). `position` is the pointer tip, which is the click point,
/// in AppKit global coordinates.
struct OverlayCursor: Equatable {
    let id: String
    let kind: CursorKind
    var state: CursorState
    var label: String?
    /// The main cat is ginger; ghosts are littermates in their own coat (SPEC-04 r15).
    var palette: CatPalette = .ginger
    var position: CGPoint

    /// A ghost's color, for its label; nil for the main cursor.
    var accent: NSColor? { palette == .ginger ? nil : palette.fur }
}

extension CursorState {
    /// The SF Symbol shown in the state badge, next to the cat's pose for the state.
    var badgeSymbol: String? {
        switch self {
        case .idle, .moving: nil
        case .listening: "ear"
        case .thinking: "ellipsis"
        case .acting: "hand.tap"
        case .waitingForUser: "hourglass"
        case .paused: "pause.fill"
        case .done: "checkmark"
        // Gentle, never alarming (SPEC-04 "Stuck cat is gentle").
        case .stuck: "questionmark"
        }
    }
}

/// Which coat a cursor wears: the design's cat palettes (`YumiCatColors`).
enum CatPalette: String, CaseIterable {
    case ginger, mint, sky, slate

    /// The littermates, in the order ghosts take them.
    static let ghosts: [CatPalette] = [.mint, .sky, .slate]

    var colors: YumiCatPalette {
        switch self {
        case .ginger: YumiCatColors.ginger
        case .mint: YumiCatColors.mint
        case .sky: YumiCatColors.sky
        case .slate: YumiCatColors.slate
        }
    }

    var fur: NSColor { NSColor(colors.fur) }

    /// Text on the fur: the ghosts' label colors (`cat.labelText` in character/design/tokens.json,
    /// not in the generated Swift yet), and the ginger cat's cocoa line.
    var labelText: NSColor {
        switch self {
        case .ginger: NSColor(YumiCatColors.ginger.line)
        case .mint: Self.rgb(0x1F3D35)
        case .sky: Self.rgb(0x22324F)
        case .slate: Self.rgb(0x2A2E35)
        }
    }

    /// The cat's pose for a state, rendered by mac/scripts/render-cursor-cat.py.
    func image(for state: CursorState) -> NSImage? {
        NSImage(named: "cat-\(rawValue)-\(state.rawValue)")
    }

    private static func rgb(_ hex: UInt32) -> NSColor {
        NSColor(
            srgbRed: CGFloat(hex >> 16 & 0xFF) / 255, green: CGFloat(hex >> 8 & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: 1
        )
    }
}
