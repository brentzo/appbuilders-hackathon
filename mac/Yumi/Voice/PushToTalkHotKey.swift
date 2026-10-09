import Carbon.HIToolbox
import OSLog

/// The global push-to-talk shortcut (OBJ-15.1, SPEC-01 requirement 9): calls `onPress` when the
/// shortcut goes down and `onRelease` when its key comes up, from any app.
///
/// A Carbon hot key, because it is the one global shortcut macOS delivers without the
/// Accessibility permission, reports the release too, and keeps the key from reaching the front app.
final class PushToTalkHotKey {
    var onPress: (() -> Void)?
    var onRelease: (() -> Void)?

    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "voice")

    /// Carbon calls back through a C function, which cannot capture; it finds the hot key here.
    private static weak var active: PushToTalkHotKey?
    fileprivate static let id = EventHotKeyID(signature: 0x59_55_4D_49 /* "YUMI" */, id: 1)

    /// Registers the shortcut, replacing the one registered before.
    func register(_ shortcut: KeyShortcut) {
        unregister()
        Self.active = self
        installHandlerOnce()
        let status = RegisterEventHotKey(
            UInt32(shortcut.keyCode), Self.carbonModifiers(shortcut.modifiers), Self.id,
            GetApplicationEventTarget(), 0, &hotKey
        )
        if status == noErr {
            log.notice("Push-to-talk is \(shortcut.displayText, privacy: .public)")
        } else {
            // Another app holds this shortcut. The settings window lets the user pick another.
            log.error("Could not register push-to-talk \(shortcut.displayText, privacy: .public): \(status)")
        }
    }

    func unregister() {
        if let hotKey { UnregisterEventHotKey(hotKey) }
        hotKey = nil
    }

    private func installHandlerOnce() {
        guard handler == nil else { return }
        var types = [
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed)),
            EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyReleased)),
        ]
        InstallEventHandler(GetApplicationEventTarget(), { _, event, _ in
            var id = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
            // Other hot keys (the stop shortcut) have their own handlers.
            guard id.signature == PushToTalkHotKey.id.signature, id.id == PushToTalkHotKey.id.id else {
                return OSStatus(eventNotHandledErr)
            }
            let kind = GetEventKind(event)
            // Carbon delivers hot key events on the main thread.
            MainActor.assumeIsolated {
                if kind == UInt32(kEventHotKeyPressed) {
                    PushToTalkHotKey.active?.onPress?()
                } else if kind == UInt32(kEventHotKeyReleased) {
                    PushToTalkHotKey.active?.onRelease?()
                }
            }
            return noErr
        }, types.count, &types, nil, &handler)
    }

    static func carbonModifiers(_ modifiers: KeyShortcut.Modifiers) -> UInt32 {
        var result = 0
        if modifiers.contains(.command) { result |= cmdKey }
        if modifiers.contains(.option) { result |= optionKey }
        if modifiers.contains(.control) { result |= controlKey }
        if modifiers.contains(.shift) { result |= shiftKey }
        return UInt32(result)
    }
}
