import Carbon.HIToolbox
import OSLog

/// Control-Option-Escape, whichever app is in front (OBJ-35.1, SPEC-06 r1). A Carbon hot key needs
/// no permission. The handler passes on every other hot key, so push-to-talk's still works.
@MainActor
final class StopShortcut {
    /// Control-Option-Escape, as a shortcut the take-over watcher recognizes.
    static let shortcut = KeyShortcut(keyCode: UInt16(kVK_Escape), modifiers: [.control, .option], keyLabel: "Esc")
    /// "YSTP".
    private static let signature: OSType = 0x5953_5450
    private let action: () -> Void
    private var hotKey: EventHotKeyRef?
    private var handler: EventHandlerRef?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "control")

    init(action: @escaping () -> Void) {
        self.action = action
    }

    func register() {
        guard hotKey == nil else { return }
        var pressed = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let me = Unmanaged.passUnretained(self).toOpaque()
        InstallEventHandler(GetApplicationEventTarget(), { _, event, userData in
            var id = EventHotKeyID()
            GetEventParameter(event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size, nil, &id)
            guard id.signature == StopShortcut.signature, let userData else { return OSStatus(eventNotHandledErr) }
            let shortcut = Unmanaged<StopShortcut>.fromOpaque(userData).takeUnretainedValue()
            MainActor.assumeIsolated { shortcut.action() }
            return noErr
        }, 1, &pressed, me, &handler)
        let status = RegisterEventHotKey(
            UInt32(kVK_Escape), UInt32(controlKey | optionKey), EventHotKeyID(signature: Self.signature, id: 1),
            GetApplicationEventTarget(), 0, &hotKey
        )
        if status != noErr {
            log.error("Could not register Control-Option-Escape: \(status)")
        }
    }
}
