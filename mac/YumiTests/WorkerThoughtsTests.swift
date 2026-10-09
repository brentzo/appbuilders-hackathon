import AppKit
import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// The thoughts panels of OBJ-53 (SPEC-07 r23): what is kept, what opens and closes, what the
/// panel says, and that the overlay takes clicks only on bubbles, chips, and open panels.
@MainActor
struct WorkerThoughtsTests {
    struct NoElements: ElementLocating {
        func locate(_ target: ElementTarget) -> CGPoint? { nil }
    }

    /// The protocol's own examples, decoded the way `HarnessEvent` decodes the real event.
    static func example(_ name: String) throws -> WorkerThought {
        let data = try Data(contentsOf: ProtocolTypesTests.examples.appendingPathComponent("WorkerThought.\(name).json"))
        guard case .workerThought(let thought) = try HarnessEvent.decode(name: "workerThought", payload: data) else {
            throw CancellationError()
        }
        return thought
    }

    static func thought(_ subtaskId: String, cursorId: String?, lane: Lane = .ghost, decision: String? = "Click OK") -> WorkerThought {
        WorkerThought(
            taskId: "t1", subtaskId: subtaskId, cursorId: cursorId, title: "Subtask \(subtaskId)", lane: lane,
            sees: "Finder", lastAction: nil, decision: decision, reason: nil, at: "2026-10-10T15:42:07+08:00"
        )
    }

    // MARK: The view model

    @Test func keepsNothingWithDebugModeOff() {
        let thoughts = WorkerThoughts(enabled: false)
        thoughts.receive(Self.thought("s1", cursorId: "main", lane: .main))
        #expect(thoughts.thought(for: .cursor("main")) == nil)
        #expect(thoughts.toggle(.cursor("main")) == false)
        #expect(thoughts.expanded.isEmpty)
    }

    @Test func eachThoughtReplacesTheLastOfItsSubtask() throws {
        let thoughts = WorkerThoughts(enabled: true)
        let main = try Self.example("main-export")
        let helper = try Self.example("helper-reading")
        thoughts.receive(main)
        thoughts.receive(helper)
        // A cat by its cursor id, a helper chip by its subtask id.
        #expect(thoughts.thought(for: .cursor("main")) == main)
        #expect(thoughts.thought(for: .chip(helper.subtaskId)) == helper)

        var next = main
        next.decision = "Click Save (element 3)"
        thoughts.receive(next)
        #expect(thoughts.thought(for: .cursor("main"))?.decision == "Click Save (element 3)")

        // The main cat moved on to a new subtask: its panel shows the newest one.
        thoughts.receive(Self.thought("s2", cursorId: "main", lane: .main, decision: "Open Mail"))
        #expect(thoughts.thought(for: .cursor("main"))?.subtaskId == "s2")
    }

    @Test func togglesOpenAndClosedOnClick() {
        let thoughts = WorkerThoughts(enabled: true)
        var changed: [Set<ThoughtTarget>] = []
        thoughts.onChange = { changed.append($0) }
        #expect(thoughts.toggle(.cursor("ghost-1")) == true)
        #expect(thoughts.isExpanded(.cursor("ghost-1")))
        #expect(thoughts.toggle(.cursor("ghost-1")) == false)
        #expect(changed == [[.cursor("ghost-1")], [.cursor("ghost-1")]])
    }

    @Test func closesWhenItsSubtaskEnds() {
        let thoughts = WorkerThoughts(enabled: true)
        thoughts.receive(Self.thought("s1", cursorId: "ghost-1"))
        thoughts.receive(Self.thought("h1", cursorId: nil, lane: .helper))
        thoughts.toggle(.cursor("ghost-1"))
        thoughts.toggle(.chip("h1"))
        thoughts.toggle(.cursor("main"))

        thoughts.subtaskEnded("s1")
        #expect(!thoughts.isExpanded(.cursor("ghost-1")))
        #expect(thoughts.thought(for: .cursor("ghost-1")) == nil)
        // Others stay open.
        #expect(thoughts.isExpanded(.chip("h1")))
        #expect(thoughts.isExpanded(.cursor("main")))

        thoughts.subtaskEnded("h1")
        #expect(!thoughts.isExpanded(.chip("h1")))
    }

    @Test func aCatOnANewerSubtaskStaysOpenWhenAnOldOneEnds() {
        let thoughts = WorkerThoughts(enabled: true)
        thoughts.receive(Self.thought("s1", cursorId: "main", lane: .main))
        thoughts.receive(Self.thought("s2", cursorId: "main", lane: .main))
        thoughts.toggle(.cursor("main"))
        thoughts.subtaskEnded("s1")
        #expect(thoughts.isExpanded(.cursor("main")))
        #expect(thoughts.thought(for: .cursor("main"))?.subtaskId == "s2")
    }

    @Test func turningDebugModeOffClosesAndForgetsEverything() {
        let thoughts = WorkerThoughts(enabled: true)
        var changed: Set<ThoughtTarget> = []
        thoughts.onChange = { changed.formUnion($0) }
        thoughts.receive(Self.thought("s1", cursorId: "ghost-1"))
        thoughts.toggle(.cursor("main"))
        changed = []
        thoughts.setEnabled(false)
        #expect(thoughts.expanded.isEmpty)
        #expect(thoughts.thought(for: .cursor("ghost-1")) == nil)
        // Every cat and chip that showed something is drawn again.
        #expect(changed == [.cursor("main"), .cursor("ghost-1"), .chip("s1")])
    }

    // MARK: What the panel says

    @Test func thePanelSaysWhatItSeesDidAndDecidedAndWhy() throws {
        let content = ThoughtsContent(thought: try Self.example("main-export"), fallbackTitle: "Main cat", lane: .main, timeZone: TimeZone(secondsFromGMT: 8 * 3600)!)
        #expect(content.title == "Export the deck as a PDF")
        // Times shown to users use am/pm.
        #expect(content.subtitle == "Main cat · 3:42:07 pm")
        #expect(content.rows == [
            .init(label: "Sees", value: "Keynote, \"Q3 Review\", with the Export sheet in front (14 elements)"),
            .init(label: "Last action", value: "Clicked Export To in Keynote"),
            .init(label: "Decided", value: "Click \"Next…\" (element 9)"),
            .init(label: "Why", value: "PDF is already selected in the Export sheet, so Next moves on to saving the file."),
        ])
    }

    @Test func missingFieldsSaySo() throws {
        let content = ThoughtsContent(thought: try Self.example("helper-reading"), fallbackTitle: "Helper working", lane: .helper)
        #expect(content.subtitle.hasPrefix("Helper · "))
        #expect(content.rows.last == .init(label: "Why", value: "No reason given", placeholder: true))

        let empty = ThoughtsContent(thought: nil, fallbackTitle: "Fill expense form", lane: .ghost)
        #expect(empty.title == "Fill expense form")
        #expect(empty.subtitle == "Ghost")
        #expect(empty.rows.allSatisfy { $0.placeholder })
    }

    @Test func readsTimesWithAndWithoutFractions() {
        let utc = TimeZone(secondsFromGMT: 0)!
        #expect(ThoughtsContent.time("2026-10-10T07:42:07.123Z", timeZone: utc) == "7:42:07 am")
        #expect(ThoughtsContent.time("2026-10-10T19:05:00Z", timeZone: utc) == "7:05:00 pm")
        #expect(ThoughtsContent.time("yesterday", timeZone: utc) == nil)
    }

    @Test func theCardFitsTheLongestThoughtTheProtocolAllows() {
        let long = String(repeating: "word ", count: 40)
        let thought = WorkerThought(
            taskId: "t", subtaskId: "s", cursorId: "main", title: String(long.prefix(60)), lane: .main,
            sees: String(long.prefix(200)), lastAction: String(long.prefix(200)), decision: String(long.prefix(200)),
            reason: String(long.prefix(200)), at: "2026-10-10T07:42:07Z"
        )
        let size = ThoughtsCard.cardSize(for: ThoughtsContent(thought: thought, fallbackTitle: "", lane: .main))
        #expect(size.width == ThoughtsCard.width)
        // Short enough to stay on a 13-inch display above or below the cat.
        #expect(size.height < 500)
        #expect(ThoughtsCard.render(ThoughtsContent(thought: thought, fallbackTitle: "", lane: .main), accent: .orange, colors: ThoughtsCard.colors(), scale: 2) != nil)
    }

    @Test func colorsFollowLightAndDarkMode() {
        let light = ThoughtsCard.colors(for: NSAppearance(named: .aqua)!)
        let dark = ThoughtsCard.colors(for: NSAppearance(named: .darkAqua)!)
        #expect(light.fill != dark.fill)
        #expect(light.ink != dark.ink)
        // Ink is dark on the light card and light on the dark one.
        #expect(light.ink.brightnessComponent < 0.4)
        #expect(dark.ink.brightnessComponent > 0.8)
    }

    // MARK: On the overlay

    private func overlay() -> CursorOverlay {
        let overlay = CursorOverlay(locator: NoElements())
        overlay.avoider.watchesPointer = false
        overlay.thoughtsClicks.watchesPointer = false
        overlay.start()
        return overlay
    }

    private var middle: CGPoint {
        let frame = NSScreen.screens[0].visibleFrame
        return CGPoint(x: frame.midX, y: frame.midY)
    }

    @Test func withDebugModeOffNothingIsExpandable() throws {
        // "Overlay does not block the user", and nothing opens.
        let overlay = overlay()
        defer { overlay.fadeAll() }
        overlay.spawn(id: "ghost-1", kind: .ghost, label: "Fill expense form", at: middle)
        overlay.showHelperChip(id: "h1", text: "Helper working")
        overlay.receive(Self.thought("s1", cursorId: "ghost-1"))
        #expect(overlay.thoughtsTargets().isEmpty)
        #expect(!overlay.thoughtsClicks.isActive)
        overlay.toggleThoughts(.cursor("ghost-1"))
        #expect(overlay.thoughts.expanded.isEmpty)
        #expect(overlay.isClickThrough)
    }

    @Test func theMainCatGetsABubbleToClickInDebugMode() throws {
        let overlay = overlay()
        defer { overlay.fadeAll() }
        overlay.setDebugMode(true)
        overlay.spawn(id: "main", kind: .main, label: nil, at: middle)
        // No label and no thought yet: no bubble, nothing to click.
        #expect(overlay.cursors["main"]?.bubbleText == nil)
        #expect(overlay.thoughtsTargets().isEmpty)

        overlay.receive(try Self.example("main-export"))
        #expect(overlay.cursors["main"]?.bubbleText == "Export the deck as a PDF")
        #expect(overlay.thoughtsTargets().map(\.target) == [.cursor("main")])

        overlay.setDebugMode(false)
        #expect(overlay.cursors["main"]?.bubbleText == nil)
    }

    @Test func aClickOnTheBubbleOpensThePanelAndAnotherClosesIt() throws {
        let overlay = overlay()
        defer { overlay.fadeAll() }
        overlay.setDebugMode(true)
        overlay.spawn(id: "ghost-1", kind: .ghost, label: "Fill expense form", at: middle)
        overlay.receive(Self.thought("s1", cursorId: "ghost-1"))
        let bubble = try #require(overlay.thoughtsTargets().first { $0.target == .cursor("ghost-1") }?.frame)

        // The pointer on the bubble: the click panel covers it.
        let clicks = overlay.thoughtsClicks
        clicks.pointer = { CGPoint(x: bubble.midX, y: bubble.midY) }
        clicks.pointerMoved()
        #expect(clicks.hovered?.target == .cursor("ghost-1"))
        clicks.click()
        #expect(overlay.thoughts.isExpanded(.cursor("ghost-1")))
        // The panel is bigger than the bubble, and the click panel now covers the panel.
        let panel = try #require(overlay.thoughtsTargets().first?.frame)
        #expect(panel.height > bubble.height * 3)
        #expect(clicks.hovered?.frame == panel)
        // The cat stays put while the pointer is on its panel.
        #expect(overlay.pointerIsOnThoughts(CGPoint(x: panel.midX, y: panel.midY), of: "ghost-1"))

        clicks.click()
        #expect(!overlay.thoughts.isExpanded(.cursor("ghost-1")))

        // Anywhere else nothing is covered: the click reaches the app underneath.
        clicks.pointer = { CGPoint(x: bubble.minX - 200, y: bubble.minY - 200) }
        clicks.pointerMoved()
        #expect(clicks.hovered == nil)
        #expect(overlay.isClickThrough)
    }

    @Test func thePanelUpdatesLiveAndClosesWhenTheSubtaskEnds() throws {
        let overlay = overlay()
        defer { overlay.fadeAll() }
        overlay.setDebugMode(true)
        overlay.spawn(id: "ghost-1", kind: .ghost, label: "Fill expense form", at: middle)
        overlay.receive(Self.thought("s1", cursorId: "ghost-1", decision: "Click OK"))
        overlay.toggleThoughts(.cursor("ghost-1"))
        let before = try #require(overlay.thoughtsTargets().first?.frame)

        overlay.receive(Self.thought("s1", cursorId: "ghost-1", decision: String(repeating: "Type the amount into the Amount field ", count: 4)))
        let after = try #require(overlay.thoughtsTargets().first?.frame)
        #expect(after.height > before.height)

        overlay.subtaskEnded("s1")
        #expect(!overlay.thoughts.isExpanded(.cursor("ghost-1")))
    }

    @Test func aHelperChipOpensUnderItselfAndClosesWhenItLeaves() throws {
        let overlay = overlay()
        defer { overlay.fadeAll() }
        overlay.setDebugMode(true)
        overlay.showHelperChip(id: "h1", text: "Helper working")
        overlay.showHelperChip(id: "h2", text: "Helper working")
        overlay.receive(try Self.example("helper-reading"))
        let chips = overlay.chipTapFrames
        let first = try #require(chips.first { $0.id == "h1" }?.frame)
        let second = try #require(chips.first { $0.id == "h2" }?.frame)

        overlay.toggleThoughts(.chip("h1"))
        let open = try #require(overlay.chipTapFrames.first { $0.id == "h1" }?.frame)
        let pushed = try #require(overlay.chipTapFrames.first { $0.id == "h2" }?.frame)
        #expect(open.height > first.height * 3)
        // The chip below moves down to make room.
        #expect(pushed.maxY < second.maxY)
        #expect(pushed.maxY < open.minY)

        overlay.removeHelperChip(id: "h1")
        #expect(!overlay.thoughts.isExpanded(.chip("h1")))
    }

    @Test func aCatThatLeavesTakesItsPanelWithIt() {
        let overlay = overlay()
        overlay.setDebugMode(true)
        overlay.spawn(id: "ghost-1", kind: .ghost, label: "Fill expense form", at: middle)
        overlay.toggleThoughts(.cursor("ghost-1"))
        overlay.fade(id: "ghost-1")
        #expect(overlay.thoughts.expanded.isEmpty)
        overlay.toggleThoughts(.cursor("main"))
        overlay.fadeAll()
        #expect(overlay.thoughts.expanded.isEmpty)
    }

    // MARK: The setting

    @Test func debugModeIsOnInDebugBuildsAndSaved() {
        let name = "yumi.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let store = SettingsStore(defaults: defaults, sink: PendingHarnessSettingsSink())
        #if DEBUG
        #expect(store.debugMode == true)
        #else
        #expect(store.debugMode == false)
        #endif
        store.debugMode = false
        #expect(SettingsStore(defaults: defaults, sink: PendingHarnessSettingsSink()).debugMode == false)
    }
}
