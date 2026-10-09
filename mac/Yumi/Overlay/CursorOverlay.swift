import AppKit
import OSLog
import QuartzCore
import YumiProtocol

/// Draws Yumi's cursors over every display and moves them when the harness says so.
///
/// Every panel draws every cursor in its own coordinates and clips to its display, so a cursor
/// crossing from one display to another moves along one global path (OBJ-18.3).
///
/// Observable: SwiftUI views that read `cursors` (the menu panel) update when a cursor changes.
@MainActor
final class CursorOverlay {
    static let fadeInDuration: CFTimeInterval = 0.2
    /// Well inside SPEC-04's 1 second.
    static let fadeOutDuration: CFTimeInterval = 0.6

    /// Every cursor on screen. Reading it in a SwiftUI view (the menu panel) tracks changes.
    private(set) var cursors: [String: OverlayCursor] {
        get { roster.cursors }
        set { roster.cursors = newValue }
    }
    private let roster = CursorRoster()
    private let sounds = CatSounds()
    private var panels: [OverlayPanel] = []
    /// One layer per cursor per panel.
    private var layers: [String: [ObjectIdentifier: CursorLayer]] = [:]
    /// Where cats come from and go back to, one per panel.
    private var islands: [ObjectIdentifier: CursorIsland] = [:]
    private let chips = HelperChips()
    private var nextGhostColor = 0
    private var screenObserver: NSObjectProtocol?
    private let locator: ElementLocating
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "overlay")

    init(locator: ElementLocating = AccessibilityElementLocator()) {
        self.locator = locator
    }

    func start() {
        rebuildPanels()
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.rebuildPanels() }
        }
        #if DEBUG
        if LaunchArguments.bool("YumiCursorDemo") { CursorDebugActions(overlay: self).playDemo() }
        #endif
    }

    var isClickThrough: Bool { panels.allSatisfy(\.ignoresMouseEvents) }
    var panelCount: Int { panels.count }

    // MARK: Harness commands (OBJ-18.7)

    func apply(_ command: CursorCommand) {
        switch command {
        case .spawn(let spawn):
            if spawn.at == nil, cursors[spawn.cursorId]?.kind == spawn.cursorKind {
                // Already on screen, for example the main cursor the app spawned when the goal
                // arrived (OBJ-17.3): keep it where it is instead of blinking it back in.
                update(spawn.cursorId) { $0.label = spawn.label }
                return
            }
            let point = spawn.at.flatMap(resolve) ?? nearUserPointer()
            self.spawn(id: spawn.cursorId, kind: spawn.cursorKind, label: spawn.label, at: point)
        case .move(let move):
            guard let point = resolve(move.to) else {
                log.notice("Could not place \(move.cursorId, privacy: .public) on its target; it stays where it is")
                return
            }
            self.move(id: move.cursorId, to: point)
        case .setState(let change):
            update(change.cursorId) { $0.state = change.state }
        case .setLabel(let change):
            update(change.cursorId) { $0.label = change.label }
        case .fade(let fade):
            self.fade(id: fade.cursorId)
        }
    }

    // MARK: Cursor operations

    /// A new cat drops out of the island (the camera notch, or a pill under the menu bar) in its
    /// moving pose and leaps to `point`, while the island opens and closes behind it (SPEC-04 r1,
    /// r19). With Reduce Motion on it fades in at the island and glides straight (r17).
    func spawn(id: String, kind: CursorKind, label: String?, at point: CGPoint) {
        if cursors[id] != nil { fade(id: id, immediately: true) }
        var palette = CatPalette.ginger
        if kind == .ghost {
            palette = CatPalette.ghosts[nextGhostColor % CatPalette.ghosts.count]
            nextGhostColor += 1
        }
        let cursor = OverlayCursor(id: id, kind: kind, state: .idle, label: label, palette: palette, position: point)
        cursors[id] = cursor
        guard let island = island(near: point) else { return }
        let duration = CursorMotion.duration(for: hypot(point.x - island.mouth.x, point.y - island.mouth.y))
        island.open(for: CursorIsland.openDuration + duration * 0.5)
        for panel in panels {
            addLayer(for: cursor, to: panel, arrival: (from: island.mouth, delay: CursorIsland.openDuration, duration: duration))
        }
        log.info("Spawned \(id, privacy: .public)")
    }

    /// Moves a cursor along an eased arc. Returns how long the move takes, so a click can wait
    /// for the paws to land.
    @discardableResult
    func move(id: String, to point: CGPoint) -> CFTimeInterval {
        guard var cursor = cursors[id] else { return 0 }
        let from = cursor.position
        cursor.position = point
        cursors[id] = cursor
        var duration = CursorMotion.shortestMove
        for panel in panels {
            guard let layer = layers[id]?[ObjectIdentifier(panel)] else { continue }
            // Starts from where the cursor is on screen now, so a new move mid-flight (or
            // mid-spawn) never jumps.
            let start = layer.root.presentation()?.position ?? panel.local(from)
            let end = panel.local(point)
            duration = CursorMotion.duration(for: hypot(end.x - start.x, end.y - start.y))
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.root.position = end
            CATransaction.commit()
            layer.root.removeAnimation(forKey: Self.spawnPath)
            layer.root.add(Self.leap(from: start, to: end, duration: duration), forKey: "move")
            draw(cursor, with: layer, on: panel)
        }
        return duration
    }

    /// Rides along with something moving in a straight line, such as a window's title bar while
    /// Yumi carries the window: the given `duration`, on the same easing as a move.
    func glide(id: String, to point: CGPoint, duration: CFTimeInterval) {
        guard var cursor = cursors[id] else { return }
        let from = cursor.position
        cursor.position = point
        cursors[id] = cursor
        for panel in panels {
            guard let layer = layers[id]?[ObjectIdentifier(panel)] else { continue }
            let start = layer.root.presentation()?.position ?? panel.local(from)
            let end = panel.local(point)
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.root.position = end
            CATransaction.commit()
            layer.root.removeAnimation(forKey: Self.spawnPath)
            layer.root.add(CursorMotion.animation(from: start, to: end, arcs: false, duration: duration), forKey: "move")
            draw(cursor, with: layer, on: panel)
        }
    }

    /// A pounce in place, for example to grab a window or to hide the jump of a resize. The
    /// cursor's own state comes back afterwards.
    func pounce(id: String) {
        guard cursors[id] != nil else { return }
        for panel in panels {
            guard let layer = layers[id]?[ObjectIdentifier(panel)] else { continue }
            layer.showPose(.acting)
            DispatchQueue.main.asyncAfter(deadline: .now() + YumiMotion.pounce) { [weak self, weak layer] in
                MainActor.assumeIsolated {
                    guard let self, let layer, let current = self.cursors[id] else { return }
                    layer.endPose(current, scale: panel.backingScaleFactor)
                    self.draw(current, with: layer, on: panel)
                }
            }
        }
    }

    /// A move from A to B (SPEC-04 r2): a short arc like a cat's leap, eased in and out. Never a
    /// jump. With Reduce Motion on, a straight glide on the same easing (r17).
    private static let spawnPath = "spawn-path"

    static func leap(from start: CGPoint, to end: CGPoint, duration: CFTimeInterval) -> CAAnimation {
        CursorMotion.animation(from: start, to: end, arcs: !CursorMotion.reduceMotion, duration: duration)
    }

    func update(_ id: String, _ change: (inout OverlayCursor) -> Void) {
        guard var cursor = cursors[id] else { return }
        change(&cursor)
        cursors[id] = cursor
        for panel in panels {
            guard let layer = layers[id]?[ObjectIdentifier(panel)] else { continue }
            draw(cursor, with: layer, on: panel)
        }
    }

    /// Redraws a cursor, with its bubble below the paws when there is no room for it above on the
    /// display where the cursor rests.
    private func draw(_ cursor: OverlayCursor, with layer: CursorLayer, on panel: OverlayPanel) {
        let home = panels.first { $0.screenFrame.contains(cursor.position) } ?? panel
        layer.bubbleBelow = CursorLayer.bubbleNeedsFlip(cursor.bubbleText, at: cursor.position, visible: home.visibleFrame)
        layer.apply(cursor, scale: panel.backingScaleFactor)
    }

    /// Every cat, the main one too, leaps back into the island and vanishes; with Reduce Motion on
    /// it fades where it is. Either way the cursor is gone within 1 second (SPEC-04 r9). A cat
    /// that finished its task meows as it goes.
    func fade(id: String, immediately: Bool = false) {
        guard let cursor = cursors.removeValue(forKey: id), let byPanel = layers.removeValue(forKey: id) else { return }
        // A cat that finished its task meows as it heads home.
        if !immediately, cursor.state == .done { sounds.meow() }
        let island = !CursorMotion.reduceMotion ? self.island(near: cursor.position) : nil
        if let island { island.open(for: CursorMotion.longestMove * 0.6) }
        for (panelId, layer) in byPanel {
            if immediately {
                layer.root.removeFromSuperlayer()
                continue
            }
            guard let island, let panel = panels.first(where: { ObjectIdentifier($0) == panelId }) else {
                CATransaction.begin()
                CATransaction.setAnimationDuration(Self.fadeOutDuration)
                CATransaction.setCompletionBlock { layer.root.removeFromSuperlayer() }
                layer.root.opacity = 0
                CATransaction.commit()
                continue
            }
            let start = layer.root.presentation()?.position ?? panel.local(cursor.position)
            let end = panel.local(island.mouth)
            let duration = CursorMotion.duration(for: hypot(end.x - start.x, end.y - start.y))
            layer.showPose(.moving)
            let shrink = CAKeyframeAnimation(keyPath: "transform.scale")
            shrink.values = [1, 1, 0.3]
            shrink.keyTimes = [0, 0.6, 1]
            shrink.duration = duration
            let vanish = CAKeyframeAnimation(keyPath: "opacity")
            vanish.values = [1, 1, 0]
            vanish.keyTimes = [0, 0.75, 1]
            vanish.duration = duration
            let group = CAAnimationGroup()
            group.animations = [Self.leap(from: start, to: end, duration: duration), shrink, vanish]
            group.duration = duration
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.root.position = end
            layer.root.opacity = 0
            CATransaction.setCompletionBlock { layer.root.removeFromSuperlayer() }
            layer.root.removeAllAnimations()
            layer.root.add(group, forKey: "return")
            CATransaction.commit()
        }
        log.info("Faded \(id, privacy: .public)")
    }

    /// No cursor may outlive its task (SPEC-04 r9). Used when no task is active or the harness is gone.
    func fadeAll() {
        for id in Array(cursors.keys) { fade(id: id) }
        chips.removeAll()
    }

    /// Where the pointer tip of a cursor is, in protocol (top-left) coordinates. SPEC-05 clicks here.
    func clickPoint(of id: String) -> CGPoint? {
        cursors[id].map { ScreenGeometry.globalTopLeftPoint(fromAppKit: $0.position) }
    }

    // MARK: Helper chips (OBJ-18.5)

    func showHelperChip(id: String, text: String) {
        chips.show(id: id, text: text)
    }

    func removeHelperChip(id: String) {
        chips.remove(id: id)
    }

    var helperChipCount: Int { chips.count }

    #if DEBUG
    /// Renders each display's overlay over a white and a black background into PNG files, so the
    /// drawing can be checked without Screen Recording permission. Returns the files written.
    func debugRender(to directory: URL) -> [URL] {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var files: [URL] = []
        for (index, panel) in panels.enumerated() {
            let scale = panel.backingScaleFactor
            let size = panel.rootLayer.bounds.size
            for (name, background) in [("light", NSColor.white), ("dark", NSColor.black)] {
                guard let context = CGContext(
                    data: nil, width: Int(size.width * scale), height: Int(size.height * scale),
                    bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
                ) else { continue }
                context.scaleBy(x: scale, y: scale)
                context.setFillColor(background.cgColor)
                context.fill(CGRect(origin: .zero, size: size))
                panel.rootLayer.render(in: context)
                guard let image = context.makeImage() else { continue }
                let file = directory.appendingPathComponent("overlay-display\(index + 1)-\(name)@\(Int(scale))x.png")
                let rep = NSBitmapImageRep(cgImage: image)
                try? rep.representation(using: .png, properties: [:])?.write(to: file)
                files.append(file)
            }
        }
        return files
    }
    #endif

    // MARK: Placement

    private func resolve(_ target: CursorTarget) -> CGPoint? {
        switch target {
        case .point(let point):
            ScreenGeometry.appKitPoint(fromGlobalTopLeft: CGPoint(x: point.x, y: point.y))
        case .element(let element):
            locator.locate(element)
        }
    }

    /// SPEC-04 r1: the main cursor appears next to the user's own pointer.
    private func nearUserPointer() -> CGPoint {
        let mouse = NSEvent.mouseLocation
        return CGPoint(x: mouse.x + 28, y: mouse.y - 28)
    }

    // MARK: Panels

    private func rebuildPanels() {
        for panel in panels { panel.orderOut(nil) }
        for island in islands.values { island.remove() }
        let screens = NSScreen.screens
        panels = screens.map(OverlayPanel.init(screen:))
        layers = [:]
        islands = [:]
        for (screen, panel) in zip(screens, panels) {
            panel.orderFrontRegardless()
            islands[ObjectIdentifier(panel)] = CursorIsland(screen: screen, in: panel)
            for cursor in cursors.values { addLayer(for: cursor, to: panel, arrival: nil) }
        }
        if let main = panels.first { chips.attach(to: main) }
        log.info("Overlay on \(self.panels.count) display(s)")
    }

    /// The island on the display that holds `point`, or the first display's.
    private func island(near point: CGPoint) -> CursorIsland? {
        let panel = panels.first { $0.screenFrame.contains(point) } ?? panels.first
        return panel.flatMap { islands[ObjectIdentifier($0)] }
    }

    /// Adds a cursor's drawing to a panel. With an `arrival`, the cat comes out of the island: it
    /// waits inside while the island opens, then leaps out in its moving pose, growing as it goes.
    private func addLayer(
        for cursor: OverlayCursor, to panel: OverlayPanel,
        arrival: (from: CGPoint, delay: CFTimeInterval, duration: CFTimeInterval)?
    ) {
        let layer = CursorLayer()
        layer.setScale(panel.backingScaleFactor)
        layer.root.position = panel.local(cursor.position)
        draw(cursor, with: layer, on: panel)
        panel.rootLayer.addSublayer(layer.root)
        layers[cursor.id, default: [:]][ObjectIdentifier(panel)] = layer
        guard let arrival else { return }

        let reduceMotion = CursorMotion.reduceMotion
        let appear = CAKeyframeAnimation(keyPath: "opacity")
        appear.values = [0, 1, 1]
        appear.keyTimes = reduceMotion ? [0, 0.4, 1] : [0, 0.15, 1]
        var animations: [String: CAAnimation] = [
            Self.spawnPath: Self.leap(from: panel.local(arrival.from), to: panel.local(cursor.position), duration: arrival.duration),
            "spawn-appear": appear,
        ]
        if !reduceMotion {
            let grow = CAKeyframeAnimation(keyPath: "transform.scale")
            grow.values = [0.3, 1, 1]
            grow.keyTimes = [0, 0.45, 1]
            animations["spawn-grow"] = grow
            layer.showPose(.moving)
        }
        // Separate animations, so a move that arrives mid-spawn can take over the path alone.
        let begin = layer.root.convertTime(CACurrentMediaTime(), from: nil) + arrival.delay
        for (key, animation) in animations {
            animation.duration = arrival.duration
            animation.beginTime = begin
            // Holds the first frame (inside the island, unseen) until the island has opened.
            animation.fillMode = .backwards
            layer.root.add(animation, forKey: key)
        }

        // Back to the cursor's own pose once it lands, with whatever state arrived meanwhile.
        let id = cursor.id
        DispatchQueue.main.asyncAfter(deadline: .now() + arrival.delay + arrival.duration) { [weak self, weak layer] in
            MainActor.assumeIsolated {
                guard let self, let layer, let current = self.cursors[id] else { return }
                layer.endPose(current, scale: panel.backingScaleFactor)
                self.draw(current, with: layer, on: panel)
            }
        }
    }
}
