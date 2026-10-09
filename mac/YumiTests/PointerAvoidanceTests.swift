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

    /// The pointer and the clock, set by each test.
    final class World {
        var pointer = CGPoint.zero
        var time: CFTimeInterval = 0
    }

    private func overlay(_ world: World) -> CursorOverlay {
        let overlay = CursorOverlay(locator: NoElements())
        overlay.avoider.watchesPointer = false
        overlay.avoider.pointer = { world.pointer }
        overlay.avoider.now = { world.time }
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

    @Test func idleThinkingAndPausedCatsPutTheirEarsBack() {
        for state in [CursorState.idle, .thinking, .paused] {
            #expect(PointerAvoidance.earsBack(for: state, busy: false))
        }
        for state in [CursorState.listening, .moving, .acting, .waitingForUser, .done, .stuck] {
            #expect(!PointerAvoidance.earsBack(for: state, busy: false))
        }
        // A cat a harness move is carrying keeps its pose.
        #expect(!PointerAvoidance.earsBack(for: .idle, busy: true))
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

    // MARK: The overlay

    @Test func inDebugModeACatFadesInPlaceAndItsBubbleStaysClickable() throws {
        let world = World()
        let overlay = overlay(world)
        overlay.thoughtsClicks.watchesPointer = false
        overlay.setDebugMode(true)
        defer { overlay.fadeAll() }
        overlay.spawn(id: "ghost-1", kind: .ghost, label: "Fill expense form", at: middle)
        world.time += 5
        overlay.update("ghost-1") { $0.state = .thinking }
        let bubble = try #require(overlay.thoughtsTargets().first?.frame)

        // The pointer comes up through the cat on its way to the bubble: the cat fades, but never hops.
        world.pointer = bodyCenter(middle)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["ghost-1"]?.faded == true)

        // On the bubble: the cat shows at full strength and stays put, so the click lands.
        world.pointer = CGPoint(x: bubble.midX, y: bubble.midY)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["ghost-1"]?.faded != true)
        #expect(overlay.thoughtsTargets().first?.frame == bubble)
    }

    /// Where a cat is drawn, in its panel, and how see-through it is.
    private func drawn(_ id: String, on overlay: CursorOverlay) -> (position: CGPoint?, home: CGPoint?, opacity: Float?) {
        let drawing = overlay.drawings(of: id).first
        let home = overlay.cursors[id].map { drawing?.panel.local($0.position) } ?? nil
        return (drawing?.layer.root.position, home, drawing?.layer.root.opacity)
    }

    @Test(arguments: CursorState.allCases)
    func everyCatFadesInPlaceAndNeverMovesAway(state: CursorState) {
        // No hopping at all, in every state (Brent, 2026-10-10).
        let world = World()
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("main", state, at: middle, on: overlay, world)
        let click = overlay.clickPoint(of: "main")

        world.pointer = bodyCenter(middle)
        overlay.avoider.pointerMoved()
        let dodge = overlay.avoider.dodges["main"]
        #expect(dodge?.faded == true)
        #expect(dodge?.earsBack == PointerAvoidance.earsBack(for: state, busy: false))
        #expect(overlay.clickPoint(of: "main") == click)
        let shown = drawn("main", on: overlay)
        #expect(shown.position == shown.home)
        #expect(shown.opacity == Float(YumiMotion.avoidFadeOpacity))
        #expect(overlay.drawings(of: "main").first?.layer.root.animation(forKey: "move") == nil)

        // The pointer rests on it: it stays faded where it is.
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["main"]?.faded == true)

        // The pointer leaves; a second later the cat fades back, ears forward.
        world.pointer = CGPoint(x: middle.x - 400, y: middle.y - 300)
        overlay.avoider.pointerMoved()
        overlay.avoider.settle("main")
        #expect(overlay.avoider.dodges["main"] == nil)
        #expect(drawn("main", on: overlay).opacity == 1)
        #expect(drawn("main", on: overlay).position == shown.home)
    }

    @Test func aCatThatAppearsNextToAStillPointerStaysPut() {
        // SPEC-04 r1 spawns the main cat right beside the pointer: it stays solid until the pointer
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
        #expect(overlay.avoider.dodges["main"]?.faded == true, "now it comes at the cat")
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

    @Test func fadingAndPausingDoNotFight() {
        // The user's pointer reaches an acting cat, and the same movement pauses the task (SPEC-06
        // r2): the cat stays faded in place, now with its ears back, its click point unchanged.
        let world = World()
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("main", .acting, at: middle, on: overlay, world)
        let click = overlay.clickPoint(of: "main")
        world.pointer = bodyCenter(middle)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["main"]?.faded == true)

        overlay.update("main") { $0.state = .paused }
        #expect(overlay.avoider.dodges["main"]?.faded == true)
        #expect(overlay.avoider.dodges["main"]?.earsBack == true)
        #expect(overlay.clickPoint(of: "main") == click)

        // Resumed straight into a click where it stands: ears forward, still faded.
        overlay.update("main") { $0.state = .acting }
        #expect(overlay.avoider.dodges["main"]?.faded == true)
        #expect(overlay.avoider.dodges["main"]?.earsBack == false)
    }

    @Test func aHarnessMoveTakesTheCatOnSolid() {
        let world = World()
        let overlay = overlay(world)
        defer { overlay.fadeAll() }
        cat("main", .idle, at: middle, on: overlay, world)
        world.pointer = bodyCenter(middle)
        overlay.avoider.pointerMoved()
        #expect(overlay.avoider.dodges["main"]?.faded == true)

        let target = CGPoint(x: middle.x + 200, y: middle.y + 100)
        overlay.move(id: "main", to: target)
        #expect(overlay.avoider.dodges["main"] == nil)
        #expect(drawn("main", on: overlay).opacity == 1)
        let shown = drawn("main", on: overlay)
        #expect(shown.position == shown.home)
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
