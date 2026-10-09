import AppKit
import YumiProtocol

#if DEBUG
/// The cursor demo's thoughts part (OBJ-53): with Debug mode on, the cats and a helper chip get
/// made-up thoughts, and the demo opens the main cat's panel, a ghost's, and the helper's in turn,
/// updates each one live, and closes the helper's when its subtask ends. Then the user gets a turn
/// to click a bubble. Debug mode is turned on for this part if it is off, and set back after.
extension CursorDebugActions {
    /// How long this part takes, for the steps after it.
    static let thoughtsDemoLength = 18.0

    static let demoHelperId = "demo-helper"

    /// The steps, starting `start` seconds into the demo.
    func thoughtsDemoSteps(start: Double) -> [(Double, () -> Void)] {
        let cats = ["main", "ghost-1", "ghost-2", "ghost-3"]
        var debugModeBefore = true
        func step(_ text: String?) {
            for id in cats { overlay.update(id) { $0.step = text } }
        }
        return [
            (start, {
                debugModeBefore = overlay.debugMode
                overlay.setDebugMode(true)
                for id in cats { overlay.apply(.setState(SetCursorState(cursorId: id, state: .thinking))) }
                step(nil)
                overlay.showHelperChip(id: Self.demoHelperId, text: "Helper working")
                for thought in Self.firstThoughts { overlay.receive(thought) }
            }),
            (start + 0.8, { overlay.toggleThoughts(.cursor("main")) }),
            (start + 2.4, {
                overlay.apply(.setState(SetCursorState(cursorId: "main", state: .acting)))
                overlay.receive(Self.thought(
                    "main", title: "Export the deck", lane: .main, cursorId: "main",
                    sees: "Keynote, \"Q3 Review\", with the Export sheet in front (14 elements)",
                    lastAction: "Clicked Export To in Keynote", decision: "Click \"Next…\" (element 9)",
                    reason: "PDF is already selected in the Export sheet, so Next moves on to saving the file."
                ))
            }),
            (start + 3.0, { overlay.apply(.setState(SetCursorState(cursorId: "main", state: .thinking))) }),
            (start + 4.4, {
                overlay.toggleThoughts(.cursor("main"))
                overlay.toggleThoughts(.cursor("ghost-2"))
            }),
            (start + 6.0, {
                overlay.receive(Self.thought(
                    "ghost-2", title: "Rename the invoices in Downloads", lane: .ghost, cursorId: "ghost-2",
                    sees: "Finder, \"Downloads\", with invoice-0412.pdf selected (31 elements)",
                    lastAction: "Renamed invoice-0411.pdf to Acme 2026-04.pdf in Finder",
                    decision: "Press Return on invoice-0412.pdf (element 17)",
                    reason: "The next invoice is selected, and Return starts editing its name."
                ))
            }),
            (start + 7.6, {
                overlay.toggleThoughts(.cursor("ghost-2"))
                overlay.toggleThoughts(.chip(Self.demoHelperId))
            }),
            (start + 9.2, {
                overlay.receive(Self.thought(
                    Self.demoHelperId, title: "Find the latest invoices", lane: .helper, cursorId: nil,
                    sees: "Files: invoice-2026-10.pdf has 2 pages, from Acme, dated October 3",
                    lastAction: "Read invoice-2026-10.pdf", decision: "Finish: the latest invoice is invoice-2026-10.pdf",
                    reason: "It is the newest invoice in Downloads, and the goal asked for the latest one."
                ))
            }),
            // The helper's subtask ends: its chip leaves and its panel closes with it.
            (start + 10.8, {
                overlay.subtaskEnded(Self.demoHelperId)
                overlay.removeHelperChip(id: Self.demoHelperId)
            }),
            (start + 11.4, { step("your turn: click my bubble") }),
            (start + Self.thoughtsDemoLength - 0.4, {
                step(nil)
                overlay.removeHelperChip(id: Self.demoHelperId)
                overlay.thoughts.clear()
                overlay.setDebugMode(debugModeBefore)
            }),
        ]
    }

    /// `-YumiOpen thoughts -YumiSnapshotDir <dir>`: open panels on the main cat, on a ghost at the
    /// right edge (the panel moves to stay on the display), on a ghost under the top of the display
    /// (the panel goes below the paws), and on a helper chip, rendered with the overlay over white
    /// and black, then quits. With `-YumiAppearance dark` the panels use their dark colors.
    static func runThoughtsSnapshot(_ overlay: CursorOverlay, writingTo directory: URL) {
        guard let screen = NSScreen.screens.first else { return }
        let visible = screen.visibleFrame
        overlay.setDebugMode(true)
        overlay.spawn(id: "main", kind: .main, label: nil, at: CGPoint(x: visible.midX - 200, y: visible.midY - 120))
        overlay.spawn(id: "ghost-1", kind: .ghost, label: "Fill expense form", at: CGPoint(x: visible.maxX - 40, y: visible.midY - 60))
        overlay.spawn(id: "ghost-2", kind: .ghost, label: "Rename the invoices in Downloads", at: CGPoint(x: visible.midX + 80, y: visible.maxY - 30))
        overlay.showHelperChip(id: demoHelperId, text: "Helper working")
        overlay.showHelperChip(id: "helper-2", text: "Helper working")
        for thought in firstThoughts where thought.subtaskId != "ghost-3" { overlay.receive(thought) }
        for target in [ThoughtTarget.cursor("main"), .cursor("ghost-1"), .cursor("ghost-2"), .chip(demoHelperId)] {
            overlay.toggleThoughts(target)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
            for file in overlay.debugRender(to: directory) {
                print("Thoughts snapshot: \(file.path)")
            }
            NSApp.terminate(nil)
        }
    }

    private static var firstThoughts: [WorkerThought] {
        [
            thought(
                "main", title: "Export the deck", lane: .main, cursorId: "main",
                sees: "Keynote, \"Q3 Review\", with the File menu open (22 elements)",
                lastAction: "Opened the File menu in Keynote", decision: "Click \"Export To\" (element 14)",
                reason: "Export To is where Keynote keeps PDF export."
            ),
            thought(
                "ghost-1", title: "Fill expense form", lane: .ghost, cursorId: "ghost-1",
                sees: "Safari, \"Expenses\", with the Amount field focused (40 elements)",
                lastAction: "Clicked Amount in Safari", decision: "Type the amount into Amount (element 23)",
                reason: "The receipt says 1,250 pesos and the field is empty."
            ),
            thought(
                "ghost-2", title: "Rename the invoices in Downloads", lane: .ghost, cursorId: "ghost-2",
                sees: "Finder, \"Downloads\", with invoice-0411.pdf selected (31 elements)",
                lastAction: nil, decision: "Press Return on invoice-0411.pdf (element 16)",
                reason: "Return starts editing the selected file's name."
            ),
            thought(
                "ghost-3", title: "Export the deck", lane: .ghost, cursorId: "ghost-3",
                sees: "Keynote, \"Q3 Review\" (60 elements)", lastAction: nil, decision: nil, reason: nil
            ),
            thought(
                demoHelperId, title: "Find the latest invoices", lane: .helper, cursorId: nil,
                sees: "Files: the folder Downloads has 12 items", lastAction: "Looked in the folder Downloads",
                decision: "Read invoice-2026-10.pdf", reason: nil
            ),
        ]
    }

    /// A made-up thought, shaped like the harness's.
    private static func thought(
        _ subtaskId: String, title: String, lane: Lane, cursorId: String?,
        sees: String, lastAction: String?, decision: String?, reason: String?
    ) -> WorkerThought {
        WorkerThought(
            taskId: "demo", subtaskId: subtaskId, cursorId: cursorId, title: title, lane: lane, sees: sees,
            lastAction: lastAction, decision: decision, reason: reason, at: ISO8601DateFormatter().string(from: Date())
        )
    }
}
#endif
