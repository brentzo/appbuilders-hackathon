import AppKit
import Carbon.HIToolbox

/// A key plus modifiers, as recorded in the settings window.
///
/// `keyCode` is the hardware key code, so the shortcut follows the physical key across keyboard
/// layouts. `keyLabel` is what that key showed when it was recorded, used only for display.
struct KeyShortcut: Codable, Equatable, Sendable {
    var keyCode: UInt16
    var modifiers: Modifiers
    var keyLabel: String

    struct Modifiers: OptionSet, Codable, Equatable, Sendable {
        let rawValue: UInt8
        static let control = Modifiers(rawValue: 1 << 0)
        static let option = Modifiers(rawValue: 1 << 1)
        static let shift = Modifiers(rawValue: 1 << 2)
        static let command = Modifiers(rawValue: 1 << 3)

        init(rawValue: UInt8) { self.rawValue = rawValue }

        init(_ flags: NSEvent.ModifierFlags) {
            var result: Modifiers = []
            if flags.contains(.control) { result.insert(.control) }
            if flags.contains(.option) { result.insert(.option) }
            if flags.contains(.shift) { result.insert(.shift) }
            if flags.contains(.command) { result.insert(.command) }
            self = result
        }

        /// Shift alone is not enough: Shift plus a letter is just typing.
        var isUsableForGlobalShortcut: Bool {
            !intersection([.control, .option, .command]).isEmpty
        }

        /// Symbols in the order macOS menus use: Control, Option, Shift, Command.
        var symbols: String {
            var text = ""
            if contains(.control) { text += "⌃" }
            if contains(.option) { text += "⌥" }
            if contains(.shift) { text += "⇧" }
            if contains(.command) { text += "⌘" }
            return text
        }
    }

    static let defaultPushToTalk = KeyShortcut(
        keyCode: UInt16(kVK_Space),
        modifiers: [.option],
        keyLabel: "Space"
    )

    var displayText: String { modifiers.symbols + keyLabel }

    /// Builds a shortcut from a key press, or returns nil if it has no usable modifier.
    init?(event: NSEvent) {
        let modifiers = Modifiers(event.modifierFlags)
        guard modifiers.isUsableForGlobalShortcut else { return nil }
        self.init(
            keyCode: event.keyCode,
            modifiers: modifiers,
            keyLabel: Self.label(forKeyCode: event.keyCode, characters: event.charactersIgnoringModifiers)
        )
    }

    init(keyCode: UInt16, modifiers: Modifiers, keyLabel: String) {
        self.keyCode = keyCode
        self.modifiers = modifiers
        self.keyLabel = keyLabel
    }

    private static let namedKeys: [Int: String] = [
        kVK_Space: "Space", kVK_Return: "Return", kVK_Tab: "Tab", kVK_Delete: "Delete",
        kVK_ForwardDelete: "⌦", kVK_Escape: "Esc", kVK_LeftArrow: "←", kVK_RightArrow: "→",
        kVK_UpArrow: "↑", kVK_DownArrow: "↓", kVK_Home: "Home", kVK_End: "End",
        kVK_PageUp: "Page Up", kVK_PageDown: "Page Down",
        kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4", kVK_F5: "F5", kVK_F6: "F6",
        kVK_F7: "F7", kVK_F8: "F8", kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11", kVK_F12: "F12",
    ]

    static func label(forKeyCode keyCode: UInt16, characters: String?) -> String {
        if let name = namedKeys[Int(keyCode)] { return name }
        let trimmed = (characters ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? "Key \(keyCode)" : trimmed.uppercased()
    }
}
