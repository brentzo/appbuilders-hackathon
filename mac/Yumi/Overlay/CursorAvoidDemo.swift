import AppKit
import OSLog
import YumiProtocol

#if DEBUG
/// The cursor demo's "don't pet me" part (OBJ-54.6): the four cats line up, idle, thinking, paused,
/// and acting, and the real pointer visits each one from below. Each fades in place so the user can
/// see through it and never moves away (Brent, 2026-10-10); the first three also lay their ears
/// back. Each fades back a second after the pointer leaves. Then the pointer parks, the main cat
/// lands right beside it and stays solid, since the pointer is still, until the pointer moves at it.
/// Then the user gets a turn.
extension CursorDebugActions {
    /// How long this part takes, for the steps after it.
    static let avoidDemoLength = 21.0

    /// The steps, starting `start` seconds into the demo, with the row across `frame`.
    func avoidDemoSteps(start: Double, frame: CGRect) -> [(Double, () -> Void)] {
        let cats: [(id: String, state: CursorState, x: CGFloat)] = [
            ("main", .thinking, 0.2), ("ghost-1", .idle, 0.4), ("ghost-2", .paused, 0.6), ("ghost-3", .acting, 0.8),
        ]
        let rowY = frame.minY + frame.height * 0.45
        func spot(_ x: CGFloat) -> CGPoint { CGPoint(x: frame.minX + frame.width * x, y: rowY) }
        func target(_ point: CGPoint) -> CursorTarget {
            let global = ScreenGeometry.globalTopLeftPoint(fromAppKit: point)
            return .point(ScreenPoint(x: global.x, y: global.y))
        }
        func step(_ text: String?) {
            for cat in cats { overlay.update(cat.id) { $0.step = text } }
        }
        // The pointer comes up from under each cat to its middle, waits, and goes on to the next.
        var tour: [DemoPointer.Leg] = [.init(to: CGPoint(x: spot(cats[0].x).x, y: rowY - 140), duration: 0.6)]
        for (index, cat) in cats.enumerated() {
            let paws = spot(cat.x)
            let body = PointerAvoidance.body(at: paws)
            tour.append(.init(to: CGPoint(x: paws.x, y: rowY - 90), duration: 0.35))
            tour.append(.init(to: CGPoint(x: body.midX, y: body.midY), duration: 0.45, hold: 0.9))
            if index + 1 < cats.count {
                tour.append(.init(to: CGPoint(x: paws.x, y: rowY - 90), duration: 0.3))
            }
        }
        // A cat that lands beside a still pointer stays solid; it fades once the pointer comes at it.
        let park = CGPoint(x: frame.midX, y: rowY + 170)
        let beside = CGPoint(x: park.x + 28, y: park.y - 28)
        let besideBody = PointerAvoidance.body(at: beside)
        tour.append(.init(to: park, duration: 0.6, hold: 2.6))
        let parked = tour.dropLast().reduce(0) { $0 + $1.duration + $1.hold } + 0.6
        tour.append(.init(to: CGPoint(x: besideBody.midX, y: besideBody.midY), duration: 0.35, hold: 0.8))
        tour.append(.init(to: CGPoint(x: frame.midX, y: frame.minY + frame.height * 0.15), duration: 0.6))

        return [
            (start, {
                for cat in cats { overlay.apply(.move(MoveCursor(cursorId: cat.id, to: target(spot(cat.x))))) }
            }),
            (start + 0.9, {
                for cat in cats { overlay.apply(.setState(SetCursorState(cursorId: cat.id, state: cat.state))) }
                step("watch my pointer")
            }),
            (start + 1.6, { DemoPointer.shared.play(tour) }),
            (start + 1.6 + parked + 0.2, {
                overlay.apply(.setState(SetCursorState(cursorId: "main", state: .idle)))
                overlay.apply(.move(MoveCursor(cursorId: "main", to: target(beside))))
                step("a still pointer: I stay put")
            }),
            (start + 14.4, { step("your turn: try to pet me") }),
            (start + Self.avoidDemoLength - 0.3, { step(nil) }),
        ]
    }
}

/// Moves the real pointer along a few legs for the demo, by posting mouse moves the way a mouse
/// does, so the overlay sees them through its normal event monitors. Each move carries Yumi's tag,
/// so the take-over watcher never mistakes it for the user. Posting needs Accessibility; without
/// it the tour is skipped and the user can still try it by hand.
@MainActor
final class DemoPointer {
    static let shared = DemoPointer()

    struct Leg {
        var to: CGPoint
        var duration: CFTimeInterval
        var hold: CFTimeInterval = 0
    }

    private typealias Key = (time: CFTimeInterval, from: CGPoint, to: CGPoint, duration: CFTimeInterval)
    private var timer: Timer?
    private var keys: [Key] = []
    private var start: CFTimeInterval = 0
    private var total: CFTimeInterval = 0
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "overlay")

    func play(_ legs: [Leg]) {
        timer?.invalidate()
        guard AXIsProcessTrusted() else {
            log.notice("The cursor demo cannot move the pointer without Accessibility; try petting the cats by hand")
            return
        }
        // The whole tour as one timeline, eased per leg like a hand would move.
        keys = []
        var time: CFTimeInterval = 0
        var from = NSEvent.mouseLocation
        for leg in legs {
            keys.append((time, from, leg.to, leg.duration))
            time += leg.duration + leg.hold
            from = leg.to
        }
        start = CACurrentMediaTime()
        total = time
        timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
    }

    private func tick() {
        let now = CACurrentMediaTime() - start
        guard now < total, let key = keys.last(where: { $0.time <= now }) else {
            timer?.invalidate()
            timer = nil
            return
        }
        let t = key.duration > 0 ? CGFloat(CursorMotion.eased(min((now - key.time) / key.duration, 1))) : 1
        Self.post(CGPoint(x: key.from.x + (key.to.x - key.from.x) * t, y: key.from.y + (key.to.y - key.from.y) * t))
    }

    private static func post(_ point: CGPoint) {
        let quartz = ScreenGeometry.globalTopLeftPoint(fromAppKit: point)
        guard let event = CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: quartz, mouseButton: .left) else { return }
        event.setIntegerValueField(.eventSourceUserData, value: KeystrokeSender.eventTag)
        event.post(tap: .cghidEventTap)
    }
}
#endif
