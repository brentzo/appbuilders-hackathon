import AppKit
import QuartzCore
import YumiProtocol

/// The rules for cats that never cover what the user is pointing at (SPEC-04 r21). Pure
/// functions, so they can be checked without a screen.
enum PointerAvoidance {
    /// Whether a cat lays its ears back while it fades, like a cat that does not want to be
    /// petted. Every cat fades in place and never moves away (Brent, 2026-10-10); idle, thinking,
    /// and paused cats also put their ears back. A cat a harness move, spawn, or pounce is carrying
    /// (`busy`) keeps its pose. A pose is not motion, so Reduce Motion changes nothing here.
    static func earsBack(for state: CursorState, busy: Bool) -> Bool {
        switch state {
        case .idle, .thinking, .paused: !busy
        case .listening, .moving, .acting, .waitingForUser, .done, .stuck: false
        }
    }

    /// The cat's drawn body around its click point (the paws), in AppKit points: the pose image
    /// (`CursorLayer.catSize`, placed by its hotspot) without the 12% margin the poses are framed
    /// with (render-ears-back-cat.py).
    static func body(at clickPoint: CGPoint) -> CGRect {
        let size = CursorLayer.catSize
        let hotspot = CursorLayer.hotspot
        let image = CGRect(
            x: clickPoint.x - size.width * hotspot.x, y: clickPoint.y - size.height * (1 - hotspot.y),
            width: size.width, height: size.height
        )
        let margin = size.width * 0.12 / 1.24
        return image.insetBy(dx: margin, dy: margin)
    }

    /// How far the pointer is from the body of a cat whose click point is `point`: 0 over it.
    static func distance(_ pointer: CGPoint, toCatAt point: CGPoint) -> CGFloat {
        let body = body(at: point)
        let dx = max(body.minX - pointer.x, 0, pointer.x - body.maxX)
        let dy = max(body.minY - pointer.y, 0, pointer.y - body.maxY)
        return hypot(dx, dy)
    }

    /// Whether the pointer is over a cat whose click point is `point`, or within `radius` of its body.
    static func isNear(_ pointer: CGPoint, catAt point: CGPoint, radius: CGFloat = YumiMotion.avoidRadius) -> Bool {
        distance(pointer, toCatAt: point) <= radius
    }

    /// Whether the pointer, moving from `previous` to `pointer`, comes at a cat whose click point
    /// is `point` (Brent's decision, 2026-10-10): it ends near the cat's body and got closer to it,
    /// or, already over the body, closer to its middle. A pointer that stands still, or moves away,
    /// never startles a cat, so a cat that appears next to a still pointer stays put.
    static func isApproaching(from previous: CGPoint?, to pointer: CGPoint, catAt point: CGPoint) -> Bool {
        guard let previous, isNear(pointer, catAt: point) else { return false }
        let before = distance(previous, toCatAt: point)
        let after = distance(pointer, toCatAt: point)
        if after < before { return true }
        guard before == 0, after == 0 else { return false }
        let body = body(at: point)
        let middle = CGPoint(x: body.midX, y: body.midY)
        return hypot(pointer.x - middle.x, pointer.y - middle.y) < hypot(previous.x - middle.x, previous.y - middle.y)
    }
}

/// Watches the user's pointer while cats are on screen and makes them avoid it (OBJ-54).
///
/// A cat only fades, in place (Brent, 2026-10-10): it never moves away, so its bubble stays
/// where the user reaches for it, and its click point is always where the harness put it. The pointer is watched with event monitors,
/// installed only while a cat is on screen, so a still pointer costs nothing. The overlay stays
/// click-through (SPEC-04 r7): watching never takes or changes an event.
///
/// A deliberate pointer move during a task also pauses it (SPEC-06 r2). The two never fight:
/// pausing only turns cats to the paused state, which fades like any other.
@MainActor
final class PointerAvoider {
    /// How one cat is answering the pointer right now.
    struct Dodge: Equatable {
        var faded = false
        var earsBack = false
    }

    private(set) var dodges: [String: Dodge] = [:]
    private weak var overlay: CursorOverlay?
    /// Cats a harness move, spawn, or pounce is carrying, until when. They keep their pose.
    private var busyUntil: [String: CFTimeInterval] = [:]
    /// Pending fade-backs, one per cat.
    private var returns: [String: DispatchWorkItem] = [:]
    private var monitors: [Any] = []
    /// Where the pointer was at the last move, to tell a pointer coming at a cat from one that
    /// stands still. Nil while no cat is on screen.
    private var lastPointer: CGPoint?

    // Replaced in tests.
    var now: () -> CFTimeInterval = { CACurrentMediaTime() }
    var pointer: () -> CGPoint = { NSEvent.mouseLocation }
    /// Whether to watch the pointer for real; tests drive `pointerMoved` themselves.
    var watchesPointer = true

    init(overlay: CursorOverlay) {
        self.overlay = overlay
    }

    var isWatching: Bool { !monitors.isEmpty }

    // MARK: What the overlay tells it

    /// A cursor's state or label changed, or it appeared: answer the pointer where it is now.
    func cursorChanged(_ id: String) {
        updateWatching()
        if lastPointer == nil { lastPointer = pointer() }
        evaluate(id)
    }

    /// The overlay is about to carry a cat for `duration`: a harness move or glide (`overlayMoves`),
    /// a spawn, or a pounce in place. Its ears come forward; afterwards it answers the pointer from
    /// its new spot.
    func hold(_ id: String, for duration: CFTimeInterval, overlayMoves: Bool) {
        cancelReturn(id)
        busyUntil[id] = now() + duration
        if let dodge = dodges[id] {
            if dodge.earsBack { setEarsBack(false, id) }
            if overlayMoves {
                // It leaves this spot: nothing to fade back at.
                if dodge.faded { setFaded(false, id) }
                dodges[id] = nil
            }
        }
        updateWatching()
        DispatchQueue.main.asyncAfter(deadline: .now() + duration) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, let until = self.busyUntil[id], until <= self.now() else { return }
                self.busyUntil[id] = nil
                self.evaluate(id)
            }
        }
    }

    /// The cat is leaving. Its ears come forward so it leaves in its own pose.
    func forget(_ id: String) {
        cancelReturn(id)
        if dodges[id]?.earsBack == true { setEarsBack(false, id) }
        dodges[id] = nil
        busyUntil[id] = nil
        updateWatching(leaving: id)
    }

    /// The panels were rebuilt with fresh drawings at each cursor's click point.
    func forgetAll() {
        for id in Array(returns.keys) { cancelReturn(id) }
        dodges = [:]
        busyUntil = [:]
        lastPointer = nil
        updateWatching()
    }

    // MARK: The pointer

    func pointerMoved() {
        guard let overlay else { return }
        let previous = lastPointer
        lastPointer = pointer()
        for id in overlay.cursors.keys { evaluate(id, pointerFrom: previous) }
    }

    /// Answers the pointer for one cat: it fades in place once the pointer comes at it (moving from
    /// `pointerFrom`), and fades back a second after the pointer leaves. It never moves.
    func evaluate(_ id: String, pointerFrom previous: CGPoint? = nil) {
        guard let cursor = overlay?.cursors[id] else { return }
        let point = pointer()
        // In Debug mode the user may be reaching for the cat's bubble to see its thoughts (OBJ-53):
        // while the pointer is on its bubble or panel, the cat shows at full strength.
        if overlay?.pointerIsOnThoughts(point, of: id) == true {
            cancelReturn(id)
            if dodges[id]?.faded == true { setFaded(false, id) }
            return
        }
        let dodge = dodges[id] ?? Dodge()
        let busy = (busyUntil[id] ?? 0) > now()
        let earsBack = PointerAvoidance.earsBack(for: cursor.state, busy: busy)
        let home = cursor.position
        let near = PointerAvoidance.isNear(point, catAt: home)

        if near, dodge.faded || PointerAvoidance.isApproaching(from: previous, to: point, catAt: home) {
            cancelReturn(id)
            if !dodge.faded { setFaded(true, id) }
            if dodge.earsBack != earsBack { setEarsBack(earsBack, id) }
        } else if near {
            // Next to a pointer that did not come at it: it stays as it is.
        } else {
            // For example a faded cat that starts acting: its ears come forward at once.
            if dodge.earsBack, !earsBack { setEarsBack(false, id) }
            if dodge.faded { scheduleReturn(id) } else if dodges[id] == Dodge() { dodges[id] = nil }
        }
    }

    /// About a second after the pointer leaves, the cat fades back with its ears forward.
    /// Internal so tests can run it without waiting.
    func settle(_ id: String) {
        cancelReturn(id)
        guard let dodge = dodges[id] else { return }
        if dodge.faded { setFaded(false, id) }
        if dodge.earsBack { setEarsBack(false, id) }
        dodges[id] = nil
    }

    // MARK: Drawing

    private func setFaded(_ faded: Bool, _ id: String) {
        dodges[id, default: Dodge()].faded = faded
        for (layer, _) in overlay?.drawings(of: id) ?? [] {
            CATransaction.begin()
            CATransaction.setAnimationDuration(YumiMotion.avoidFade)
            layer.root.opacity = faded ? Float(YumiMotion.avoidFadeOpacity) : 1
            CATransaction.commit()
        }
    }

    private func setEarsBack(_ on: Bool, _ id: String) {
        dodges[id, default: Dodge()].earsBack = on
        for (layer, _) in overlay?.drawings(of: id) ?? [] { layer.setEarsBack(on) }
    }

    private func scheduleReturn(_ id: String) {
        guard returns[id] == nil else { return }
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                self?.returns[id] = nil
                self?.settle(id)
            }
        }
        returns[id] = work
        DispatchQueue.main.asyncAfter(deadline: .now() + YumiMotion.avoidReturn, execute: work)
    }

    private func cancelReturn(_ id: String) {
        returns.removeValue(forKey: id)?.cancel()
    }

    // MARK: Watching

    /// Mouse moves and drags, over other apps (global) and over Yumi's own windows (local). Only
    /// while a cat is on screen, so the pointer costs nothing otherwise.
    private static let watched: NSEvent.EventTypeMask = [.mouseMoved, .leftMouseDragged, .rightMouseDragged, .otherMouseDragged]

    /// `leaving`: a cursor that is on its way out and does not count.
    private func updateWatching(leaving: String? = nil) {
        let catsShown = overlay?.cursors.keys.contains { $0 != leaving } == true
        if !catsShown { lastPointer = nil }
        let wanted = watchesPointer && catsShown
        if wanted, monitors.isEmpty {
            let global = NSEvent.addGlobalMonitorForEvents(matching: Self.watched) { [weak self] _ in
                MainActor.assumeIsolated { self?.pointerMoved() }
            }
            let local = NSEvent.addLocalMonitorForEvents(matching: Self.watched) { [weak self] event in
                MainActor.assumeIsolated { self?.pointerMoved() }
                return event
            }
            monitors = [global, local].compactMap { $0 }
        } else if !wanted, !monitors.isEmpty {
            for monitor in monitors { NSEvent.removeMonitor(monitor) }
            monitors = []
        }
    }
}

extension CatPalette {
    /// The ears-back pose, rendered by mac/scripts/render-ears-back-cat.py.
    var earsBackImage: NSImage? { NSImage(named: "cat-\(rawValue)-earsBack") }
}
