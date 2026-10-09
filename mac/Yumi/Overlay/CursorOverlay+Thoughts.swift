import AppKit
import YumiProtocol

/// The thoughts panels on the overlay (OBJ-53, SPEC-07 r23): in Debug mode a click on a cat's
/// bubble or a helper chip opens what that worker sees, did, and decided, and why.
extension CursorOverlay {
    /// Debug mode, from Settings. Off, nothing is expandable and every panel closes.
    func setDebugMode(_ enabled: Bool) {
        thoughts.setEnabled(enabled)
        thoughtsClicks.setActive(enabled)
    }

    var debugMode: Bool { thoughts.isEnabled }

    /// A `workerThought` event from the harness.
    func receive(_ thought: WorkerThought) {
        thoughts.receive(thought)
    }

    /// The harness says a subtask is done or failed: its panel closes.
    func subtaskEnded(_ subtaskId: String) {
        thoughts.subtaskEnded(subtaskId)
    }

    /// Opens or closes a panel, the way a click does.
    func toggleThoughts(_ target: ThoughtTarget) {
        thoughts.toggle(target)
    }

    func wireThoughts() {
        thoughts.onChange = { [weak self] targets in self?.refreshThoughts(targets) }
        thoughtsClicks.targets = { [weak self] in self?.thoughtsTargets() ?? [] }
        thoughtsClicks.onClick = { [weak self] target in self?.thoughts.toggle(target) }
        // Panels use the system's light or dark colors; draw them again when it changes.
        appearanceObservation = NSApp?.observe(\.effectiveAppearance) { [weak self] _, _ in
            DispatchQueue.main.async {
                MainActor.assumeIsolated {
                    guard let self else { return }
                    self.refreshThoughts(self.thoughts.expanded)
                }
            }
        }
    }

    /// Draws the cats and chips whose thoughts changed again.
    func refreshThoughts(_ targets: Set<ThoughtTarget>) {
        for target in targets {
            switch target {
            case .cursor(let id):
                let title = thoughts.isEnabled ? thoughts.thought(for: target)?.title : nil
                update(id) { $0.thoughtTitle = title }
            case .chip(let id):
                let content = thoughts.isExpanded(target)
                    ? ThoughtsContent(thought: thoughts.thought(for: target), fallbackTitle: "Helper working", lane: .helper)
                    : nil
                showChipThoughts(content, for: id)
            }
        }
        thoughtsClicks.pointerMoved()
    }

    /// The open panel of a cat, if any, and where it goes: centered over the cat like its bubble
    /// but moved sideways to stay on the display, and below the paws when it would leave the top.
    func thoughtsLayout(for cursor: OverlayCursor, visible: CGRect) -> (content: ThoughtsContent, shift: CGFloat, below: Bool)? {
        let target = ThoughtTarget.cursor(cursor.id)
        guard thoughts.isExpanded(target) else { return nil }
        let content = ThoughtsContent(
            thought: thoughts.thought(for: target),
            fallbackTitle: cursor.label ?? ThoughtsContent.laneName(.main),
            lane: cursor.kind == .ghost ? .ghost : .main
        )
        let below = cursor.position.y + CursorLayer.bubbleAnchorAbove.y + ThoughtsCard.height(for: content) > visible.maxY
        let anchorX = cursor.position.x + (below ? CursorLayer.bubbleAnchorBelow.x : CursorLayer.bubbleAnchorAbove.x)
        let margin = YumiSpace.s
        let left = anchorX - ThoughtsCard.width / 2
        let right = anchorX + ThoughtsCard.width / 2
        var shift: CGFloat = 0
        if left < visible.minX + margin { shift = visible.minX + margin - left }
        if right > visible.maxX - margin { shift = visible.maxX - margin - right }
        return (content, shift, below)
    }

    /// What can be clicked now, in global AppKit coordinates: each cat's bubble or open panel
    /// where it is drawn (it may be hopping out of the pointer's way), and each chip.
    func thoughtsTargets() -> [(target: ThoughtTarget, frame: CGRect)] {
        guard thoughts.isEnabled else { return [] }
        var targets: [(target: ThoughtTarget, frame: CGRect)] = []
        for (id, cursor) in cursors {
            let drawings = drawings(of: id)
            guard let drawing = drawings.first(where: { $0.panel.screenFrame.contains(cursor.position) }) ?? drawings.first,
                  let frame = drawing.layer.thoughtsTapFrame else { continue }
            let position = drawing.layer.root.presentation()?.position ?? drawing.layer.root.position
            let origin = drawing.panel.screenFrame.origin
            targets.append((.cursor(id), frame.offsetBy(dx: position.x + origin.x, dy: position.y + origin.y)))
        }
        targets += chipTapFrames.map { (.chip($0.id), $0.frame) }
        return targets
    }

    /// Whether the pointer is on this cat's bubble or open panel in Debug mode. Then the cat stays
    /// put, so the user can click and read (the pointer avoider asks).
    func pointerIsOnThoughts(_ point: CGPoint, of id: String) -> Bool {
        thoughtsTargets().contains { $0.target == .cursor(id) && $0.frame.contains(point) }
    }
}
