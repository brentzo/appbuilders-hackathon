import AppKit
import Carbon.HIToolbox
import OSLog

/// When the user's own input counts as taking over (OBJ-35.3, SPEC-06 r2 and r3).
enum TakeOverRule {
    struct Input {
        /// Carries Yumi's tag in `kCGEventSourceUserData` (OBJ-39).
        var tagged: Bool
        var isKeyboard: Bool
        /// A click or move over one of Yumi's own cards or panels.
        var overYumiWindow: Bool
        /// Typing goes to one of Yumi's windows.
        var yumiHasKeyboard: Bool
        /// A key press of Yumi's own shortcuts: push-to-talk or the stop shortcut. The user is
        /// talking to Yumi, not taking over.
        var isYumiShortcut = false
    }

    /// `uiLaneActing` is false while Yumi waits for the user (a card, a password it handed over)
    /// or is already paused: then no input pauses anything.
    static func isTakeOver(_ input: Input, uiLaneActing: Bool) -> Bool {
        guard uiLaneActing, !input.tagged, !input.isYumiShortcut else { return false }
        if input.isKeyboard { return !input.yumiHasKeyboard }
        return !input.overYumiWindow
    }
}

/// A listen-only event tap on mouse movement, clicks, scrolls, and key presses. It never changes
/// or blocks an event; it only tells Yumi the user took over.
@MainActor
final class TakeOverWatcher {
    private let uiLaneActing: () -> Bool
    /// Push-to-talk (as set now) and the stop shortcut.
    private let yumiShortcuts: () -> [KeyShortcut]
    private let onTakeOver: () -> Void
    private var tap: CFMachPort?
    private var secureInput = false
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "control")

    init(uiLaneActing: @escaping () -> Bool, yumiShortcuts: @escaping () -> [KeyShortcut], onTakeOver: @escaping () -> Void) {
        self.uiLaneActing = uiLaneActing
        self.yumiShortcuts = yumiShortcuts
        self.onTakeOver = onTakeOver
    }

    static let watched: [CGEventType] = [
        .mouseMoved, .leftMouseDown, .rightMouseDown, .otherMouseDown,
        .leftMouseDragged, .rightMouseDragged, .scrollWheel, .keyDown,
    ]

    func start() {
        guard tap == nil else { return }
        if !CGPreflightListenEventAccess() {
            // Accessibility may be enough on its own; if keys never arrive, Input Monitoring is missing.
            log.notice("Input Monitoring is not granted; key presses may not reach the take-over watcher")
        }
        let mask = Self.watched.reduce(CGEventMask(0)) { $0 | (1 << $1.rawValue) }
        let me = Unmanaged.passUnretained(self).toOpaque()
        tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly, eventsOfInterest: mask, callback: { _, type, event, userInfo in
            if let userInfo {
                let watcher = Unmanaged<TakeOverWatcher>.fromOpaque(userInfo).takeUnretainedValue()
                MainActor.assumeIsolated { watcher.handle(type, event) }
            }
            return Unmanaged.passUnretained(event)
        }, userInfo: me)
        guard let tap else {
            log.error("Could not watch for the user taking over: the event tap needs Accessibility or Input Monitoring")
            return
        }
        RunLoop.main.add(tap, forMode: .common)
        CGEvent.tapEnable(tap: tap, enable: true)
    }

    private func handle(_ type: CGEventType, _ event: CGEvent) {
        if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return
        }
        noteSecureInput()
        let point = ScreenGeometry.appKitPoint(fromGlobalTopLeft: event.location)
        let input = TakeOverRule.Input(
            tagged: event.getIntegerValueField(.eventSourceUserData) == KeystrokeSender.eventTag,
            isKeyboard: type == .keyDown,
            overYumiWindow: NSApp.windows.contains { $0.isVisible && !$0.ignoresMouseEvents && $0.frame.contains(point) },
            yumiHasKeyboard: NSApp.isActive || NSApp.keyWindow != nil,
            isYumiShortcut: type == .keyDown && Self.matches(
                keyCode: UInt16(event.getIntegerValueField(.keyboardEventKeycode)), flags: event.flags, any: yumiShortcuts()
            )
        )
        if TakeOverRule.isTakeOver(input, uiLaneActing: uiLaneActing()) {
            onTakeOver()
        }
    }

    /// Whether a key press is one of the shortcuts, with exactly its modifiers. Holding the
    /// push-to-talk key repeats this key press, and every repeat matches too.
    static func matches(keyCode: UInt16, flags: CGEventFlags, any shortcuts: [KeyShortcut]) -> Bool {
        var modifiers: KeyShortcut.Modifiers = []
        if flags.contains(.maskControl) { modifiers.insert(.control) }
        if flags.contains(.maskAlternate) { modifiers.insert(.option) }
        if flags.contains(.maskShift) { modifiers.insert(.shift) }
        if flags.contains(.maskCommand) { modifiers.insert(.command) }
        return shortcuts.contains { $0.keyCode == keyCode && $0.modifiers == modifiers }
    }

    /// While Secure Input is on, key presses never reach the tap; mouse movement still does
    /// (SPEC-06 r9). Logged so a missed key press can be explained.
    private func noteSecureInput() {
        let on = IsSecureEventInputEnabled()
        guard on != secureInput else { return }
        secureInput = on
        log.notice("Secure Input is \(on ? "on: key presses are not visible" : "off", privacy: .public)")
    }
}
