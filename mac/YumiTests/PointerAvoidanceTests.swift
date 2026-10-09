import AppKit
import Testing
import YumiProtocol
@testable import Yumi

/// SPEC-04 r21: cats never cover what the user is pointing at (OBJ-54).
@MainActor
struct PointerAvoidanceTests {
    struct NoElements: ElementLocating {
        func locate(_ target: ElementTarget) -> CGPoint? { nil }
    }

    /// The pointer, the clock, and Reduce Motion, set by each test.
    final class World {
        var pointer = CGPoint.zero
        var time: CFTimeInterval = 0
        var reduceMotion = false
    }

    private func overlay(_ world: World) -> CursorOverlay {
        let overlay = CursorOverlay(locator: NoElements())
        overlay.avoider.watchesPointer = false
        overlay.avoider.pointer = { world.pointer }
        overlay.avoider.now = { world.time }
        overlay.avoider.reduceMotion = { world.reduceMotion }
        overlay.start()
        return overlay
    }

    /// The middle of the main display, in AppKit coordinates.
    private var middle: CGPoint {
        let frame = NSScreen.screens[0].visibleFrame
        return CGPoint(x: frame.midX, y: frame.midY)
    }

    /// Spawns a cat at `point` in `state` and lets its spawn finish.
    private func cat(_ id: String, _ state: CursorState, at point: CGPoint, on overlay: CursorOverlay, _ world: World) {
        overlay.spawn(id: id, kind: id == "main" ? .main : .ghost, label: nil, at: point)
        world.time += 5
        overlay.update(id) { $0.state = state }
    }

    private func bodyCenter(_ point: CGPoint) -> CGPoint {
        let body = PointerAvoidance.body(at: point)
        return CGPoint(x: body.midX, y: body.midY)
    }

    // MARK: Rules

    @Test func idleThinkingAndPausedCatsScootWithTheirEarsBack() {
        for state in [CursorState.idle, .thinking, .paused] {
            #expect(PointerAvoidance.reaction(for: state, busy: false, reduceMotion: false) == .init(moves: true, earsBack: true))
        }
    }

    @Test func everyOtherCatFadesInPlace() {
        for state in [CursorState.listening, .moving, .acting, .waitingForUser, .done, .stuck] {
            #expect(PointerAvoidance.reaction(for: state, busy: false, reduceMotion: false) == .init(moves: false, earsBack: false))
        }
        // A cat a harness move is carrying is in the middle of an action too.
        #expect(PointerAvoidance.reaction(for: .idle, busy: true, reduceMotion: false).moves == false)
    }

    @Test func reduceMotionFadesEveryCat() {
        for state in CursorState.allCases {
            #expect(PointerAvoidance.reaction(for: state, busy: false, reduceMotion: true).moves == false)
        }
        // The pose still says "don't pet me"; a pose is not motion.
        #expect(PointerAvoidance.reaction(for: .idle, busy: false, reduceMotion: true).earsBack)
    }

    @Test func nearMeansOverTheCatOrWithinTheRadius() {
        let paws = CGPoint(x: 500, y: 500)
        let body = PointerAvoidance.body(at: paws)
        #expect(body.width > 30 && body.width < 48)
        #expect(PointerAvoidance.isNear(bodyCenter(paws), catAt: paws))
        #expect(PointerAvoidance.isNear(CGPoint(x: body.maxX + YumiMotion.avoidRadius - 1, y: body.midY), catAt: paws))
        #expect(!PointerAvoidance.isNear(CGPoint(x: body.maxX + YumiMotion.avoidRadius + 1, y: body.midY), catAt: paws))
        // Measured from the body, not its middle: about 24 points (Brent's decision, 2026-10-10).
        #expect(YumiMotion.avoidRadius == 24)
        #expect(PointerAvoidance.distance(CGPoint(x: body.midX, y: body.maxY + 10), toCatAt: paws) == 10)
    }

    @Test func onlyAPointerComingAtACatStartlesIt() {
        let paws = CGPoint(x: 500, y: 500)
        let body = PointerAvoidance.body(at: paws)
        let beside = CGPoint(x: body.maxX + 12, y: body.midY)
        let closer = CGPoint(x: body.maxX + 4, y: body.midY)
        let farther = CGPoint(x: body.maxX + 20, y: body.midY)
        #expect(PointerAvoidance.isApproaching(from: beside, to: closer, catAt: paws))
        #expect(!PointerAvoidance.isApproaching(from: beside, to: beside, catAt: paws), "a still pointer")
        #expect(!PointerAvoidance.isApproaching(from: beside, to: farther, catAt: paws), "moving away")
        #expect(!PointerAvoidance.isApproaching(from: nil, to: closer, catAt: paws), "no move yet")
        #expect(!PointerAvoidance.isApproaching(
            from: CGPoint(x: body.maxX + 60, y: body.midY), to: CGPoint(x: body.maxX + 30, y: body.midY), catAt: paws
        ), "closer, but still out of reach")
        // Over the body already: deeper toward its middle counts, sliding out does not.
        let edge = CGPoint(x: body.maxX - 2, y: body.midY)
        let deeper = CGPoint(x: body.midX + 2, y: body.midY)
        #expect(PointerAvoidance.isApproaching(from: edge, to: deeper, catAt: paws))
        #expect(!PointerAvoidance.isApproaching(from: deeper, to: edge, catAt: paws))
    }

    @Test func aScootHopsAwayFromThePointerAndStaysOnTheDisplay() {
        let visible = CGRect(x: 0, y: 0, width: 1440, height: 900)
        let home = CGPoint(x: 700, y: 400)
        // The pointer comes from the left of the cat's middle: the cat hops right.
        let pointer = CGPoint(x: bodyCenter(home).x - 10, y: bodyCenter(home).y)
        let offset = PointerAvoidance.scootOffset(from: .zero, home: home, pointer: pointer, visible: visible)
        #expect(offset.dx > 60)
        #expect(abs(offset.dy) < 1)
        #expect(abs(hypot(offset.dx, offset.dy) - YumiMotion.avoidHop) < 0.01)

        // Against the right edge it turns instead of leaving the display.
        let edge = CGPoint(x: 1440 - 25, y: 400)
        let turned = PointerAvoidance.scootOffset(
            from: .zero, home: edge, pointer: CGPoint(x: bodyCenter(edge).x - 10, y: bodyCenter(edge).y), visible: visible
        )
        let spot = CGPoint(x: edge.x + turned.dx, y: edge.y + turned.dy)
        #expect(visible.contains(PointerAvoidance.body(at: spot)))
        #expect(!PointerAvoidance.isNear(CGPoint(x: bodyCenter(edge).x - 10, y: bodyCenter(edge).y), catAt: spot))
    }

    // MARK: The overlay

    @Test func anIdleCatScootsAwayAndComesBack() {
        // "Moving the pointer onto an idle or paused cat makes it scoot away and come back afterwards."
        let world = World()
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("main", .idle, at: middle, on: overlay, world)
        let click = overlay.clickPoint(of: "main")

        world.pointer = bodyCenter(middle)
        overlay.avoider.pointerMoved()
        let dodge = overlay.avoider.dodges["main"]
        #expect(dodge?.offset != .zero)
        #expect(dodge?.earsBack == true)
        #expect(dodge?.faded == false)
        // Only the drawing moved: the click point is where the harness put the cat.
        #expect(overlay.clickPoint(of: "main") == click)
        let drawn = overlay.drawings(of: "main").first?.layer.root.position
        let panel = overlay.drawings(of: "main").first?.panel
        #expect(drawn != panel?.local(middle))

        // The pointer rests on the cat's old spot: it keeps away.
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["main"]?.offset == dodge?.offset)

        // The pointer leaves; a second later the cat drifts back.
        world.pointer = CGPoint(x: middle.x - 400, y: middle.y - 300)
        overlay.avoider.pointerMoved()
        overlay.avoider.settle("main")
        #expect(overlay.avoider.dodges["main"]?.offset == .zero)
        #expect(overlay.drawings(of: "main").first?.layer.root.position == panel?.local(middle))
    }

    @Test func aCatThatAppearsNextToAStillPointerStaysPut() {
        // SPEC-04 r1 spawns the main cat right beside the pointer: it sits there until the pointer
        // comes at it (Brent's decision, 2026-10-10).
        let world = World()
        let body = PointerAvoidance.body(at: middle)
        world.pointer = CGPoint(x: body.maxX + 10, y: body.midY)
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("main", .idle, at: middle, on: overlay, world)
        #expect(overlay.avoider.dodges["main"] == nil)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["main"] == nil, "the pointer did not move")
        world.pointer = CGPoint(x: body.maxX + 20, y: body.midY)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["main"] == nil, "the pointer moved away")
        world.pointer = CGPoint(x: body.maxX + 5, y: body.midY)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["main"]?.offset != .zero, "now it comes at the cat")
    }

    @Test func anActingCatBesideAStillPointerStaysSolid() {
        let world = World()
        let body = PointerAvoidance.body(at: middle)
        world.pointer = CGPoint(x: body.midX, y: body.midY)
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("main", .acting, at: middle, on: overlay, world)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["main"] == nil)
        #expect(overlay.drawings(of: "main").first?.layer.root.opacity == 1)
    }

    @Test func theHopIsAStartledHopAndTheDriftBackIsAMove() {
        let world = World()
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("main", .idle, at: middle, on: overlay, world)
        world.pointer = bodyCenter(middle)
        overlay.avoider.pointerMoved()
        let root = overlay.drawings(of: "main").first?.layer.root
        #expect(YumiMotion.avoidHopDuration == 0.2)
        #expect(root?.animation(forKey: "move")?.duration == YumiMotion.avoidHopDuration)

        world.pointer = CGPoint(x: middle.x - 400, y: middle.y - 300)
        overlay.avoider.pointerMoved()
        overlay.avoider.settle("main")
        let drift = root?.animation(forKey: "move")?.duration ?? 0
        #expect(drift >= YumiMotion.moveMin, "the normal move curve and time")
    }

    @Test func aPausedCatScootsToo() {
        let world = World()
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("g1", .paused, at: middle, on: overlay, world)
        world.pointer = bodyCenter(middle)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["g1"]?.offset != .zero)
    }

    @Test func anActingCatFadesWithoutMoving() {
        // "Moving the pointer onto an acting cat makes it see-through without moving it, so its
        // click point is unchanged."
        let world = World()
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("main", .acting, at: middle, on: overlay, world)
        let click = overlay.clickPoint(of: "main")

        world.pointer = bodyCenter(middle)
        overlay.avoider.pointerMoved()
        let dodge = overlay.avoider.dodges["main"]
        #expect(dodge?.faded == true)
        #expect(dodge?.offset == .zero)
        #expect(dodge?.earsBack == false)
        #expect(overlay.clickPoint(of: "main") == click)
        let drawing = overlay.drawings(of: "main").first
        #expect(drawing?.layer.root.position == drawing?.panel.local(middle))
        #expect(drawing?.layer.root.opacity == Float(YumiMotion.avoidFadeOpacity))

        // It fades back after the pointer leaves.
        world.pointer = CGPoint(x: middle.x - 400, y: middle.y - 300)
        overlay.avoider.pointerMoved()
        overlay.avoider.settle("main")
        #expect(overlay.avoider.dodges["main"] == nil)
        #expect(drawing?.layer.root.opacity == 1)
    }

    @Test func withReduceMotionEveryCatFades() {
        let world = World()
        world.reduceMotion = true
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("main", .idle, at: middle, on: overlay, world)
        world.pointer = bodyCenter(middle)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["main"]?.offset == .zero)
        #expect(overlay.avoider.dodges["main"]?.faded == true)
    }

    @Test func dodgingAndPausingDoNotFight() {
        // The user's pointer reaches an acting cat, and the same movement pauses the task (SPEC-06
        // r2): the cat stops fading and scoots, at full opacity, with its click point unchanged.
        let world = World()
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("main", .acting, at: middle, on: overlay, world)
        let click = overlay.clickPoint(of: "main")
        world.pointer = bodyCenter(middle)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["main"]?.faded == true)

        overlay.update("main") { $0.state = .paused }
        let dodge = overlay.avoider.dodges["main"]
        #expect(dodge?.faded == false)
        #expect(dodge?.offset != .zero)
        #expect(overlay.drawings(of: "main").first?.layer.root.opacity == 1)
        #expect(overlay.clickPoint(of: "main") == click)

        // Resumed straight into a click where it stands: the paws go back on the click point.
        overlay.update("main") { $0.state = .acting }
        #expect(overlay.avoider.dodges["main"]?.offset == .zero)
        #expect(overlay.avoider.dodges["main"]?.faded == true)
        #expect(overlay.avoider.dodges["main"]?.earsBack == false)
    }

    @Test func aHarnessMoveTakesOverFromAScoot() {
        let world = World()
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("main", .idle, at: middle, on: overlay, world)
        world.pointer = bodyCenter(middle)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["main"]?.offset != .zero)

        let target = CGPoint(x: middle.x + 200, y: middle.y + 100)
        overlay.move(id: "main", to: target)
        #expect(overlay.avoider.dodges["main"] == nil)
        let drawing = overlay.drawings(of: "main").first
        #expect(drawing?.layer.root.position == drawing?.panel.local(target))
        // While the move carries it, it fades instead of hopping off its path.
        world.pointer = bodyCenter(target)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["main"]?.offset == .zero)
        #expect(overlay.avoider.dodges["main"]?.faded == true)
    }

    @Test func theOverlayStaysClickThrough() {
        // "Overlay does not block the user", with cats dodging.
        let world = World()
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("main", .idle, at: middle, on: overlay, world)
        world.pointer = bodyCenter(middle)
        overlay.avoider.pointerMoved()
        #expect(overlay.isClickThrough)
    }

    @Test func thePointerIsWatchedOnlyWhileCatsAreOnScreen() {
        let overlay = CursorOverlay(locator: NoElements())
        overlay.start()
        #expect(!overlay.avoider.isWatching)
        overlay.spawn(id: "main", kind: .main, label: nil, at: middle)
        #expect(overlay.avoider.isWatching)
        overlay.fadeAll()
        #expect(!overlay.avoider.isWatching)
    }

    @Test func everyCoatHasAnEarsBackPose() {
        for palette in CatPalette.allCases {
            #expect(palette.earsBackImage != nil)
        }
    }
}
