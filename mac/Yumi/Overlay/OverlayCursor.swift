import AppKit
import YumiProtocol

/// One cursor on the overlay (OBJ-18.2). `position` is the pointer tip, which is the click point,
/// in AppKit global coordinates.
struct OverlayCursor: Equatable {
    let id: String
    let kind: CursorKind
    var state: CursorState
    var label: String?
    /// Ghosts get an accent color; the main cursor is plain black and white.
    var accent: NSColor?
    var position: CGPoint
}

extension CursorState {
    /// The SF Symbol shown in the state badge. Placeholder until the Rive cat's poses (OBJ-19).
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

enum GhostColors {
    /// Accents that read on light and dark backgrounds and on each other. None is red, so a ghost
    /// never looks like an error.
    static let palette: [NSColor] = [.systemTeal, .systemOrange, .systemPurple, .systemGreen, .systemBlue, .systemPink]
}
