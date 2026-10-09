import AppKit
import Carbon.HIToolbox
import OSLog

/// When the user's own input counts as taking over (OBJ-35.3, SPEC-06 r2 and r3).
enum TakeOverRule {
    struct Input {
        /// Carries Yumi's tag in `kCGEventSourceUserData` (OBJ-39).
        var tagged: Bool
        var isKeyboard: Bool
        /// A click or move over one of Yumi's own windows, cards, bubbles, thoughts panels, or chips.
        var overYumiWindow: Bool
        /// A drag whose press began on one of Yumi's windows: still the user using Yumi, even
        /// once the pointer leaves it or the panel closes.
        var pressBeganOverYumi = false
        /// Typing goes to one of Yumi's windows.
        var yumiHasKeyboard: Bool
        /// A key press of Yumi's own shortcuts: push-to-talk or the stop shortcut. The user is
        /// talking to Yumi, not taking over.
        var isYumiShortcut = false
        /// A pointer move or drag, rather than a click, a scroll, or a key press. It counts only
        /// once `PointerReach` calls it deliberate.
        var isPointerMove = false
        /// A pointer move `PointerReach` judged deliberate: far and fast, and not ending on Yumi.
        var deliberate = false
    }

    /// `uiLaneActing` is false while Yumi waits for the user (a card, a password it handed over)
    /// or is already paused: then no input pauses anything.
    static func isTakeOver(_ input: Input, uiLaneActing: Bool) -> Bool {
        guard uiLaneActing, !input.tagged, !input.isYumiShortcut else { return false }
        if input.isKeyboard { return !input.yumiHasKeyboard }
        if input.isPointerMove, !input.deliberate { return false }
        return !input.overYumiWindow && !input.pressBeganOverYumi
    }
}

/// Tells a deliberate pointer move from a jiggle or a trackpad bump (SPEC-06 r2): more than about
/// 80 points from where the pointer was within the last half second. A deliberate move is judged
/// when the pointer comes to rest, so a reach that ends on one of Yumi's bubbles, panels, chips,
/// or windows is the user using Yumi, not taking over. Pure, so tests can feed it times and points.
struct PointerReach {
    static let distance: CGFloat = 80
    static let window: TimeInterval = 0.5
    /// The pointer counts as resting after this long without a move.
    static let rest: TimeInterval = 0.15
    /// A move that never rests (circling around) is judged after at most this long.
    static let longest: TimeInterval = 0.8

    private var samples: [(time: TimeInterval, point: CGPoint)] = []
    /// When the move became deliberate, and how far it had gone then. Nil while it is not.
    private(set) var pending: (since: TimeInterval, distance: CGFloat)?
    private var lastMove: TimeInterval = 0

    /// The user's own pointer moved to `point` (in a spot that is not Yumi's).
    mutating func moved(to point: CGPoint, at time: TimeInterval) {
        lastMove = time
        samples.removeAll { time - $0.time > Self.window }
        samples.append((time, point))
        let farthest = samples.map { hypot($0.point.x - point.x, $0.point.y - point.y) }.max() ?? 0
        if pending == nil, farthest > Self.distance { pending = (time, farthest) }
    }

    /// The pointer is on one of Yumi's own things: whatever it was doing, it was reaching for Yumi.
    mutating func reachedYumi() {
        samples = []
        pending = nil
    }

    /// Checked while a move is pending. Returns the deliberate move's distance once the pointer
    /// rests (or after `longest`) away from Yumi, and nil otherwise.
    mutating func settle(at time: TimeInterval, overYumi: Bool) -> CGFloat? {
        guard let pending, time - lastMove >= Self.rest || time - pending.since >= Self.longest else { return nil }
        let judged = overYumi ? nil : pending.distance
        reset()
        return judged
    }

    mutating func reset() {
        samples = []
        pending = nil
    }
}

/// A listen-only event tap on mouse movement, clicks, scrolls, and key presses. It never changes
/// or blocks an event; it only tells Yumi the user took over.
@MainActor
final class TakeOverWatcher {
    private let uiLaneActing: () -> Bool
    /// Push-to-talk (as set now) and the stop shortcut.
    private let yumiShortcuts: () -> [KeyShortcut]
    /// Yumi's own bubbles, thoughts panels, and helper chips on the overlay, which never take a
    /// click themselves, in global AppKit coordinates.
    private let yumiFrames: () -> [CGRect]
    private let onTakeOver: () -> Void
    private var reach = PointerReach()
    private var reachCheck: Timer?
    private var tap: CFMachPort?
    private var secureInput = false
    /// Set while a mouse button that went down on one of Yumi's windows is held.
    private var pressOverYumi = false
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "control")

    init(
        uiLaneActing: @escaping () -> Bool, yumiShortcuts: @escaping () -> [KeyShortcut],
        yumiFrames: @escaping () -> [CGRect] = { [] }, onTakeOver: @escaping () -> Void
    ) {
        self.uiLaneActing = uiLaneActing
        self.yumiShortcuts = yumiShortcuts
        self.yumiFrames = yumiFrames
        self.onTakeOver = onTakeOver
    }

    static let watched: [CGEventType] = [
        .mouseMoved, .leftMouseDown, .rightMouseDown, .otherMouseDown,
        .leftMouseDragged, .rightMouseDragged, .otherMouseDragged, .scrollWheel, .keyDown,
        .leftMouseUp, .rightMouseUp, .otherMouseUp,
    ]

    static let presses: Set<CGEventType> = [.leftMouseDown, .rightMouseDown, .otherMouseDown]
    static let releases: Set<CGEventType> = [.leftMouseUp, .rightMouseUp, .otherMouseUp]
    static let drags: Set<CGEventType> = [.leftMouseDragged, .rightMouseDragged, .otherMouseDragged]

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
        // A release only ends a press; letting go of the button is not taking over.
        if Self.releases.contains(type) {
            pressOverYumi = false
            return
        }
        let point = ScreenGeometry.appKitPoint(fromGlobalTopLeft: event.location)
        let overYumiWindow = isOverYumi(point)
        if Self.presses.contains(type) { pressOverYumi = overYumiWindow }
        let tagged = event.getIntegerValueField(.eventSourceUserData) == KeystrokeSender.eventTag
        let isPointerMove = type == .mouseMoved || Self.drags.contains(type)
        if isPointerMove, !tagged {
            trackReach(to: point, overYumi: overYumiWindow || (Self.drags.contains(type) && pressOverYumi))
            return
        }
        let input = TakeOverRule.Input(
            tagged: tagged,
            isKeyboard: type == .keyDown,
            overYumiWindow: overYumiWindow,
            pressBeganOverYumi: Self.drags.contains(type) && pressOverYumi,
            yumiHasKeyboard: NSApp.isActive || NSApp.keyWindow != nil,
            isYumiShortcut: type == .keyDown && Self.matches(
                keyCode: UInt16(event.getIntegerValueField(.keyboardEventKeycode)), flags: event.flags, any: yumiShortcuts()
            )
        )
        if TakeOverRule.isTakeOver(input, uiLaneActing: uiLaneActing()) {
            takeOver(because: Self.describe(type))
        }
    }

    private func isOverYumi(_ point: CGPoint) -> Bool {
        NSApp.windows.contains { $0.isVisible && !$0.ignoresMouseEvents && $0.frame.contains(point) }
            || yumiFrames().contains { $0.contains(point) }
    }

    /// The user's own pointer moved. Small moves never count; a deliberate one is judged when the
    /// pointer rests, so a reach that ends on Yumi's bubble or card does not pause anything.
    private func trackReach(to point: CGPoint, overYumi: Bool) {
        guard uiLaneActing() else {
            reach.reset()
            return
        }
        if overYumi {
            reach.reachedYumi()
        } else {
            reach.moved(to: point, at: CACurrentMediaTime())
        }
        guard reach.pending != nil, reachCheck == nil else { return }
        reachCheck = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.checkReach() }
        }
    }

    private func checkReach() {
        guard reach.pending != nil, uiLaneActing() else {
            reach.reset()
            stopReachCheck()
            return
        }
        guard let distance = reach.settle(at: CACurrentMediaTime(), overYumi: isOverYumi(NSEvent.mouseLocation)) else {
            if reach.pending == nil { stopReachCheck() }
            return
        }
        stopReachCheck()
        let input = TakeOverRule.Input(
            tagged: false, isKeyboard: false, overYumiWindow: false, yumiHasKeyboard: false, isPointerMove: true, deliberate: true
        )
        if TakeOverRule.isTakeOver(input, uiLaneActing: true) {
            takeOver(because: "a pointer move of \(Int(distance)) points")
        }
    }

    private func stopReachCheck() {
        reachCheck?.invalidate()
        reachCheck = nil
    }

    private func takeOver(because cause: String) {
        reach.reset()
        stopReachCheck()
        log.notice("The user took over: \(cause, privacy: .public)")
        onTakeOver()
    }

    /// The event that triggered a take-over, for the log.
    static func describe(_ type: CGEventType) -> String {
        switch type {
        case .leftMouseDown: "a click"
        case .rightMouseDown: "a right click"
        case .otherMouseDown: "a click of another mouse button"
        case .scrollWheel: "a scroll"
        case .keyDown: "a key press"
        default: "event \(type.rawValue)"
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

    /// While Secure Input is on, key presses never reach the tap; clicks and pointer moves still do
    /// (SPEC-06 r9). Logged so a missed key press can be explained.
    private func noteSecureInput() {
        let on = IsSecureEventInputEnabled()
        guard on != secureInput else { return }
        secureInput = on
        log.notice("Secure Input is \(on ? "on: key presses are not visible" : "off", privacy: .public)")
    }
}
