import AppKit
import QuartzCore
import YumiProtocol

/// The rules for cats that never cover what the user is pointing at (SPEC-04 r21). Pure
/// functions, so they can be checked without a screen.
enum PointerAvoidance {
    /// How a cat answers the user's pointer coming near.
    struct Reaction: Equatable {
        /// Hops out of the way; otherwise it stays put and fades until the user can see through it.
        var moves: Bool
        /// Shows the ears-back pose, like a cat that does not want to be petted.
        var earsBack: Bool
    }

    /// Idle, thinking, and paused cats scoot away with their ears back. Any other cat is busy, or
    /// shows the user something where it stands, so it fades in place and its click point never
    /// changes. So does a cat a harness move or spawn is carrying (`busy`). With Reduce Motion on,
    /// every cat fades instead of moving (r17).
    static func reaction(for state: CursorState, busy: Bool, reduceMotion: Bool) -> Reaction {
        switch state {
        case .idle, .thinking, .paused:
            busy ? Reaction(moves: false, earsBack: false) : Reaction(moves: !reduceMotion, earsBack: true)
        case .listening, .moving, .acting, .waitingForUser, .done, .stuck:
            Reaction(moves: false, earsBack: false)
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

    /// Where a cat drawn `offset` away from its click point `home` hops to, as a new offset: `hop`
    /// points straight away from the pointer. When that spot would leave `visible` or still be
    /// under the pointer, it turns a little more each way until the whole cat fits.
    static func scootOffset(
        from offset: CGVector, home: CGPoint, pointer: CGPoint, visible: CGRect, hop: CGFloat = YumiMotion.avoidHop
    ) -> CGVector {
        let shown = CGPoint(x: home.x + offset.dx, y: home.y + offset.dy)
        let center = CGPoint(x: body(at: shown).midX, y: body(at: shown).midY)
        var angle = atan2(center.y - pointer.y, center.x - pointer.x)
        // Right under the pointer's tip: hop up, like a startled cat.
        if hypot(center.y - pointer.y, center.x - pointer.x) < 0.5 { angle = .pi / 2 }
        func candidate(_ turn: CGFloat) -> CGVector {
            CGVector(dx: offset.dx + cos(angle + turn) * hop, dy: offset.dy + sin(angle + turn) * hop)
        }
        let turns: [CGFloat] = [0, 30, -30, 60, -60, 90, -90, 120, -120, 150, -150, 180].map { $0 * .pi / 180 }
        for turn in turns {
            let next = candidate(turn)
            let spot = CGPoint(x: home.x + next.dx, y: home.y + next.dy)
            if visible.contains(body(at: spot)), !isNear(pointer, catAt: spot) { return next }
        }
        // Nowhere fits, such as a display smaller than a hop: stay on the display at least.
        let straight = candidate(0)
        let body = body(at: CGPoint(x: home.x + straight.dx, y: home.y + straight.dy))
        let dx = max(visible.minX - body.minX, 0) - max(body.maxX - visible.maxX, 0)
        let dy = max(visible.minY - body.minY, 0) - max(body.maxY - visible.maxY, 0)
        return CGVector(dx: straight.dx + dx, dy: straight.dy + dy)
    }
}

/// Watches the user's pointer while cats are on screen and makes them avoid it (OBJ-54).
///
/// Only the drawing moves or fades: a cursor's `position`, its click point, never changes, so
/// SPEC-05 clicks land where the harness put the cat. The pointer is watched with event monitors,
/// installed only while a cat is on screen, so a still pointer costs nothing. The overlay stays
/// click-through (SPEC-04 r7): watching never takes or changes an event.
///
/// Moving the pointer during a task also pauses it (SPEC-06 r2). The two never fight: pausing
/// only turns cats to the paused state, which scoots, and a scoot is a drawing offset that the
/// next harness move takes over from wherever the cat is on screen.
@MainActor
final class PointerAvoider {
    /// How one cat is answering the pointer right now.
    struct Dodge: Equatable {
        /// How far the drawing sits from the click point.
        var offset = CGVector.zero
        var faded = false
        var earsBack = false
    }

    private(set) var dodges: [String: Dodge] = [:]
    private weak var overlay: CursorOverlay?
    /// Cats a harness move, spawn, or pounce is carrying, until when. They fade instead of hopping.
    private var busyUntil: [String: CFTimeInterval] = [:]
    /// Pending drift-backs, one per cat.
    private var returns: [String: DispatchWorkItem] = [:]
    private var monitors: [Any] = []
    /// Where the pointer was at the last move, to tell a pointer coming at a cat from one that
    /// stands still. Nil while no cat is on screen.
    private var lastPointer: CGPoint?

    // Replaced in tests.
    var reduceMotion: () -> Bool = { CursorMotion.reduceMotion }
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

    /// The overlay is about to carry a cat for `duration`: a harness move or glide that starts
    /// from wherever the cat is drawn (`overlayMoves`), a spawn, or a pounce in place. Meanwhile
    /// it only fades; afterwards it answers the pointer from its new spot.
    func hold(_ id: String, for duration: CFTimeInterval, overlayMoves: Bool) {
        cancelReturn(id)
        busyUntil[id] = now() + duration
        if let dodge = dodges[id] {
            if dodge.earsBack { setEarsBack(false, id) }
            if overlayMoves {
                // It leaves this spot, from wherever it is drawn: nothing to come back to.
                if dodge.faded { setFaded(false, id) }
                dodges[id] = nil
            } else if dodge.offset != .zero {
                // A pounce in place: the paws go back on the click point first.
                goHome(id, duration: YumiMotion.avoidFade)
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

    /// Answers the pointer for one cat. Near means over the cat's drawing, where it is drawn now
    /// or at its click point. A cat starts dodging only when the pointer comes at it (moving from
    /// `pointerFrom`); one already dodging keeps answering, in the way its state asks.
    func evaluate(_ id: String, pointerFrom previous: CGPoint? = nil) {
        guard let cursor = overlay?.cursors[id] else { return }
        let point = pointer()
        // In Debug mode the user may be reaching for the cat's bubble to see its thoughts (OBJ-53):
        // it stays put while the pointer is on it.
        if overlay?.pointerIsOnThoughts(point, of: id) == true {
            cancelReturn(id)
            return
        }
        let dodge = dodges[id] ?? Dodge()
        let busy = (busyUntil[id] ?? 0) > now()
        let reaction = PointerAvoidance.reaction(for: cursor.state, busy: busy, reduceMotion: reduceMotion())
        let home = cursor.position
        let shown = CGPoint(x: home.x + dodge.offset.dx, y: home.y + dodge.offset.dy)
        let nearShown = PointerAvoidance.isNear(point, catAt: shown)
        let nearHome = PointerAvoidance.isNear(point, catAt: home)
        let dodging = dodge.faded || dodge.offset != .zero

        if reaction.moves {
            if dodge.faded { setFaded(false, id) }
            if nearShown, dodging || PointerAvoidance.isApproaching(from: previous, to: point, catAt: shown) {
                cancelReturn(id)
                scoot(id, home: home, pointer: point)
            } else if nearHome {
                // The pointer rests on the cat's spot: it keeps away.
                cancelReturn(id)
            } else if dodge != Dodge() {
                scheduleReturn(id)
            }
            return
        }

        // A cat that cannot move: its paws belong on its click point.
        if dodge.offset != .zero { goHome(id, duration: YumiMotion.avoidFade) }
        if nearHome, dodging || PointerAvoidance.isApproaching(from: previous, to: point, catAt: home) {
            cancelReturn(id)
            if !dodge.faded { setFaded(true, id) }
            if dodge.earsBack != reaction.earsBack { setEarsBack(reaction.earsBack, id) }
        } else if nearHome {
            // Next to a pointer that did not come at it: it stays as it is.
        } else {
            // For example a scooted cat that starts acting: its ears come forward at once.
            if dodge.earsBack, !reaction.earsBack { setEarsBack(false, id) }
            if dodge.faded { scheduleReturn(id) } else if dodges[id] == Dodge() { dodges[id] = nil }
        }
    }

    /// About a second after the pointer leaves, the cat drifts back to its spot and fades back.
    /// Internal so tests can run it without waiting.
    func settle(_ id: String) {
        cancelReturn(id)
        guard let dodge = dodges[id] else { return }
        if dodge.faded { setFaded(false, id) }
        if dodge.offset != .zero {
            let duration = goHome(id, duration: nil)
            // The ears come forward when it lands, unless the pointer chased it meanwhile.
            DispatchQueue.main.asyncAfter(deadline: .now() + duration) { [weak self] in
                MainActor.assumeIsolated {
                    guard let self, let dodge = self.dodges[id], dodge.offset == .zero, !dodge.faded else { return }
                    self.setEarsBack(false, id)
                    self.dodges[id] = nil
                }
            }
        } else {
            if dodge.earsBack { setEarsBack(false, id) }
            dodges[id] = nil
        }
    }

    // MARK: Drawing

    private func scoot(_ id: String, home: CGPoint, pointer point: CGPoint) {
        var dodge = dodges[id] ?? Dodge()
        let visible = NSScreen.screens.first { $0.frame.contains(home) }?.visibleFrame
            ?? NSScreen.screens.first?.visibleFrame ?? .infinite
        dodge.offset = PointerAvoidance.scootOffset(from: dodge.offset, home: home, pointer: point, visible: visible)
        dodges[id] = dodge
        if !dodge.earsBack { setEarsBack(true, id) }
        let target = CGPoint(x: home.x + dodge.offset.dx, y: home.y + dodge.offset.dy)
        // A startled hop: quicker than a move. The drift back takes a normal move's time.
        draw(id, to: target, arcs: true, duration: YumiMotion.avoidHopDuration)
    }

    /// Takes the drawing back to the click point. Returns how long that takes.
    @discardableResult
    private func goHome(_ id: String, duration: CFTimeInterval?) -> CFTimeInterval {
        guard let home = overlay?.cursors[id]?.position else { return 0 }
        dodges[id]?.offset = .zero
        // A drift, not a leap: straight back on the move curve.
        return draw(id, to: home, arcs: false, duration: duration)
    }

    /// Moves every drawing of a cat from where it is on screen now to `point`, on the move curve
    /// (SPEC-04 r2), never jumping. Without a `duration`, it takes as long as a move that far.
    @discardableResult
    private func draw(_ id: String, to point: CGPoint, arcs: Bool, duration: CFTimeInterval?) -> CFTimeInterval {
        var longest: CFTimeInterval = 0
        for (layer, panel) in overlay?.drawings(of: id) ?? [] {
            let end = panel.local(point)
            let start = layer.root.presentation()?.position ?? layer.root.position
            let time = duration ?? CursorMotion.duration(for: hypot(end.x - start.x, end.y - start.y))
            longest = max(longest, time)
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.root.position = end
            CATransaction.commit()
            layer.root.removeAnimation(forKey: CursorOverlay.spawnPath)
            layer.root.add(CursorMotion.animation(from: start, to: end, arcs: arcs, duration: time), forKey: "move")
        }
        return longest
    }

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
