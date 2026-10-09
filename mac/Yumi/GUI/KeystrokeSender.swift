import Carbon.HIToolbox
import CoreGraphics

/// Where keyboard events go. The live poster sends them through the HID event tap, like a real
/// keyboard; tests record them.
@MainActor
protocol EventPosting {
    func post(_ event: CGEvent)
}

struct HIDEventPoster: EventPosting {
    func post(_ event: CGEvent) {
        event.post(tap: .cghidEventTap)
    }
}

/// Sends the main cursor's keystrokes (OBJ-39.5). Only `GuiExecutor` calls it, after the lane check.
///
/// Every event carries `eventTag` in `kCGEventSourceUserData`, so OBJ-35 can tell Yumi's input
/// from the user's (SPEC-06 r3). Text goes out in short chunks; between chunks the sender checks
/// the cancel flag and that focus has not moved to a password field (SPEC-06 r4, SPEC-05 r7).
@MainActor
final class KeystrokeSender {
    /// "YUMI" in ASCII.
    static let eventTag: Int64 = 0x5955_4D49
    static let chunkSize = 8
    static let pauseBetweenChunks: Duration = .milliseconds(40)
    static let pauseBetweenKeys: Duration = .milliseconds(6)

    struct TypingResult: Equatable {
        let typed: Int
        let total: Int
        var stopped: Bool { typed < total }
    }

    private let poster: EventPosting
    private let source: CGEventSource?
    private var cancelRequested = false

    init(poster: EventPosting = HIDEventPoster()) {
        self.poster = poster
        // A private state keeps the user's held modifier keys out of Yumi's events.
        source = CGEventSource(stateID: .privateState)
        source?.userData = Self.eventTag
    }

    /// Stops the typing in progress before its next chunk. OBJ-35 calls this when the user takes over.
    func cancelTyping() {
        cancelRequested = true
    }

    /// Types `text` into the focused element. `focusIsSecure` is asked before every character, so
    /// a Tab or Return that moves focus into a password field stops typing at once (SPEC-05 r7).
    /// The cancel flag is checked between chunks (SPEC-06 r4).
    func type(_ text: String, focusIsSecure: () -> Bool) async -> TypingResult {
        cancelRequested = false
        let characters = Array(text)
        var typed = 0
        for (index, character) in characters.enumerated() {
            if index.isMultiple(of: Self.chunkSize) {
                if index > 0 { try? await Task.sleep(for: Self.pauseBetweenChunks) }
                if cancelRequested { break }
            }
            if focusIsSecure() { break }
            send(character)
            typed += 1
            // A key that moves focus lands in the app a moment later; wait for it before the next check.
            try? await Task.sleep(for: Self.movesFocus(character) ? Self.settleAfterFocusKey : Self.pauseBetweenKeys)
        }
        return TypingResult(typed: typed, total: characters.count)
    }

    static let settleAfterFocusKey: Duration = .milliseconds(120)

    static func movesFocus(_ character: Character) -> Bool {
        character == "\t" || character == "\n" || character == "\r" || character == "\r\n"
    }

    /// Presses one combination, for example `cmd+shift+e`. Returns false for a combo outside the
    /// contract's pattern.
    func press(_ combo: String) -> Bool {
        guard let parsed = KeyCombo(combo) else { return false }
        sendKey(parsed.keyCode, flags: parsed.flags)
        return true
    }

    private func send(_ character: Character) {
        switch character {
        case "\n", "\r", "\r\n":
            sendKey(CGKeyCode(kVK_Return), flags: [])
        case "\t":
            sendKey(CGKeyCode(kVK_Tab), flags: [])
        default:
            let utf16 = Array(String(character).utf16)
            for keyDown in [true, false] {
                guard let event = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: keyDown) else { continue }
                event.flags = []
                event.keyboardSetUnicodeString(stringLength: utf16.count, unicodeString: utf16)
                post(event)
            }
        }
    }

    private func sendKey(_ keyCode: CGKeyCode, flags: CGEventFlags) {
        for keyDown in [true, false] {
            guard let event = CGEvent(keyboardEventSource: source, virtualKey: keyCode, keyDown: keyDown) else { continue }
            event.flags = flags
            post(event)
        }
    }

    private func post(_ event: CGEvent) {
        event.setIntegerValueField(.eventSourceUserData, value: Self.eventTag)
        poster.post(event)
    }
}

/// A `KeyAction.combo` in the contract's canonical form: modifiers joined with +, then one key.
struct KeyCombo: Equatable {
    let keyCode: CGKeyCode
    let flags: CGEventFlags

    init?(_ combo: String) {
        var parts = combo.split(separator: "+", omittingEmptySubsequences: false).map(String.init)
        // "cmd++" would split into an empty key; the contract has no + key.
        guard let key = parts.popLast(), let code = Self.keyCodes[key] else { return nil }
        var flags: CGEventFlags = []
        for modifier in parts {
            guard let flag = Self.modifiers[modifier] else { return nil }
            flags.insert(flag)
        }
        keyCode = CGKeyCode(code)
        self.flags = flags
    }

    private static let modifiers: [String: CGEventFlags] = [
        "cmd": .maskCommand, "ctrl": .maskControl, "opt": .maskAlternate, "shift": .maskShift, "fn": .maskSecondaryFn,
    ]

    /// US ANSI key codes (Carbon HIToolbox Events.h).
    private static let keyCodes: [String: Int] = [
        "a": kVK_ANSI_A, "b": kVK_ANSI_B, "c": kVK_ANSI_C, "d": kVK_ANSI_D, "e": kVK_ANSI_E, "f": kVK_ANSI_F,
        "g": kVK_ANSI_G, "h": kVK_ANSI_H, "i": kVK_ANSI_I, "j": kVK_ANSI_J, "k": kVK_ANSI_K, "l": kVK_ANSI_L,
        "m": kVK_ANSI_M, "n": kVK_ANSI_N, "o": kVK_ANSI_O, "p": kVK_ANSI_P, "q": kVK_ANSI_Q, "r": kVK_ANSI_R,
        "s": kVK_ANSI_S, "t": kVK_ANSI_T, "u": kVK_ANSI_U, "v": kVK_ANSI_V, "w": kVK_ANSI_W, "x": kVK_ANSI_X,
        "y": kVK_ANSI_Y, "z": kVK_ANSI_Z,
        "0": kVK_ANSI_0, "1": kVK_ANSI_1, "2": kVK_ANSI_2, "3": kVK_ANSI_3, "4": kVK_ANSI_4,
        "5": kVK_ANSI_5, "6": kVK_ANSI_6, "7": kVK_ANSI_7, "8": kVK_ANSI_8, "9": kVK_ANSI_9,
        "-": kVK_ANSI_Minus, "=": kVK_ANSI_Equal, "[": kVK_ANSI_LeftBracket, "]": kVK_ANSI_RightBracket,
        ";": kVK_ANSI_Semicolon, "'": kVK_ANSI_Quote, ",": kVK_ANSI_Comma, ".": kVK_ANSI_Period,
        "/": kVK_ANSI_Slash, "\\": kVK_ANSI_Backslash, "`": kVK_ANSI_Grave,
        "f1": kVK_F1, "f2": kVK_F2, "f3": kVK_F3, "f4": kVK_F4, "f5": kVK_F5, "f6": kVK_F6, "f7": kVK_F7,
        "f8": kVK_F8, "f9": kVK_F9, "f10": kVK_F10, "f11": kVK_F11, "f12": kVK_F12, "f13": kVK_F13,
        "f14": kVK_F14, "f15": kVK_F15, "f16": kVK_F16, "f17": kVK_F17, "f18": kVK_F18, "f19": kVK_F19,
        "return": kVK_Return, "enter": kVK_ANSI_KeypadEnter, "tab": kVK_Tab, "space": kVK_Space,
        "escape": kVK_Escape, "delete": kVK_Delete, "forwardDelete": kVK_ForwardDelete,
        "up": kVK_UpArrow, "down": kVK_DownArrow, "left": kVK_LeftArrow, "right": kVK_RightArrow,
        "home": kVK_Home, "end": kVK_End, "pageUp": kVK_PageUp, "pageDown": kVK_PageDown,
    ]
}
