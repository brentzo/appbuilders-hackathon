import AppKit
import OSLog
import QuartzCore
import YumiProtocol

/// Draws Yumi's cursors over every display and moves them when the harness says so.
///
/// Every panel draws every cursor in its own coordinates and clips to its display, so a cursor
/// crossing from one display to another moves along one global path (OBJ-18.3).
@MainActor
final class CursorOverlay {
    /// About 300 ms on an eased curve (SPEC-04 r2).
    static let moveDuration: CFTimeInterval = 0.3
    static let fadeInDuration: CFTimeInterval = 0.2
    /// Well inside SPEC-04's 1 second.
    static let fadeOutDuration: CFTimeInterval = 0.6

    private(set) var cursors: [String: OverlayCursor] = [:]
    private var panels: [OverlayPanel] = []
    /// One layer per cursor per panel.
    private var layers: [String: [ObjectIdentifier: CursorLayer]] = [:]
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

    func spawn(id: String, kind: CursorKind, label: String?, at point: CGPoint) {
        if cursors[id] != nil { fade(id: id, immediately: true) }
        var palette = CatPalette.ginger
        if kind == .ghost {
            palette = CatPalette.ghosts[nextGhostColor % CatPalette.ghosts.count]
            nextGhostColor += 1
        }
        // Ghosts split out of the main cat when it is on screen (SPEC-04 "littermates").
        let parent = kind == .ghost ? cursors.values.first { $0.kind == .main }?.position : nil
        let cursor = OverlayCursor(id: id, kind: kind, state: .idle, label: label, palette: palette, position: point)
        cursors[id] = cursor
        for panel in panels { addLayer(for: cursor, to: panel, fadeIn: true, splitFrom: parent) }
        log.info("Spawned \(id, privacy: .public)")
    }

    func move(id: String, to point: CGPoint) {
        guard var cursor = cursors[id] else { return }
        let from = cursor.position
        cursor.position = point
        cursors[id] = cursor
        for panel in panels {
            guard let layer = layers[id]?[ObjectIdentifier(panel)] else { continue }
            // Starts from where the cursor is on screen now, so a new move mid-flight never jumps.
            let start = layer.root.presentation()?.position ?? panel.local(from)
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.root.position = panel.local(point)
            CATransaction.commit()
            layer.root.add(Self.leap(from: start, to: panel.local(point)), forKey: "move")
        }
    }

    /// A move from A to B (SPEC-04 r2): a short arc like a cat's leap, on the design's easing curve,
    /// in `moveDuration`. Never a jump. With Reduce Motion on, a straight glide (r17).
    static func leap(from start: CGPoint, to end: CGPoint) -> CAAnimation {
        let animation = CAKeyframeAnimation(keyPath: "position")
        animation.path = leapPath(from: start, to: end, arcs: !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
        animation.calculationMode = .paced
        animation.duration = moveDuration
        animation.timingFunction = easing
        return animation
    }

    /// The design token `motion.easing`, cubic-bezier(0.25, 0.85, 0.3, 1).
    static let easing = CAMediaTimingFunction(controlPoints: 0.25, 0.85, 0.3, 1)

    /// A cubic Bezier from `start` to `end`. Its control points sit a third and two thirds of the
    /// way along, pushed sideways (upward on screen where it can) by a fifth of the distance, at
    /// most 90 points, so the path arcs a little.
    static func leapPath(from start: CGPoint, to end: CGPoint, arcs: Bool = true) -> CGPath {
        let path = CGMutablePath()
        path.move(to: start)
        let dx = end.x - start.x, dy = end.y - start.y
        let distance = hypot(dx, dy)
        guard arcs, distance > 1 else {
            path.addLine(to: end)
            return path
        }
        // The unit normal, turned to point up (AppKit y grows upward).
        var nx = -dy / distance, ny = dx / distance
        if ny < 0 || (ny == 0 && nx < 0) { nx = -nx; ny = -ny }
        let lift = min(distance * 0.2, 90)
        let c1 = CGPoint(x: start.x + dx / 3 + nx * lift, y: start.y + dy / 3 + ny * lift)
        let c2 = CGPoint(x: start.x + dx * 2 / 3 + nx * lift, y: start.y + dy * 2 / 3 + ny * lift)
        path.addCurve(to: end, control1: c1, control2: c2)
        return path
    }

    func update(_ id: String, _ change: (inout OverlayCursor) -> Void) {
        guard var cursor = cursors[id] else { return }
        change(&cursor)
        cursors[id] = cursor
        for panel in panels {
            layers[id]?[ObjectIdentifier(panel)]?.apply(cursor, scale: panel.backingScaleFactor)
        }
    }

    func fade(id: String, immediately: Bool = false) {
        guard cursors.removeValue(forKey: id) != nil, let byPanel = layers.removeValue(forKey: id) else { return }
        for layer in byPanel.values {
            if immediately {
                layer.root.removeFromSuperlayer()
                continue
            }
            CATransaction.begin()
            CATransaction.setAnimationDuration(Self.fadeOutDuration)
            CATransaction.setCompletionBlock { layer.root.removeFromSuperlayer() }
            layer.root.opacity = 0
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
        panels = NSScreen.screens.map(OverlayPanel.init(screen:))
        layers = [:]
        for panel in panels {
            panel.orderFrontRegardless()
            for cursor in cursors.values { addLayer(for: cursor, to: panel, fadeIn: false) }
        }
        if let main = panels.first { chips.attach(to: main) }
        log.info("Overlay on \(self.panels.count) display(s)")
    }

    private func addLayer(for cursor: OverlayCursor, to panel: OverlayPanel, fadeIn: Bool, splitFrom parent: CGPoint? = nil) {
        let layer = CursorLayer()
        layer.setScale(panel.backingScaleFactor)
        layer.root.position = panel.local(cursor.position)
        layer.apply(cursor, scale: panel.backingScaleFactor)
        panel.rootLayer.addSublayer(layer.root)
        layers[cursor.id, default: [:]][ObjectIdentifier(panel)] = layer
        guard fadeIn else { return }
        let appear = CABasicAnimation(keyPath: "opacity")
        appear.fromValue = 0
        appear.toValue = 1
        appear.duration = Self.fadeInDuration
        // Grows out of the main cat (or out of its own spot) as it fades in.
        let grow = CABasicAnimation(keyPath: "transform.scale")
        grow.fromValue = 0.3
        grow.toValue = 1
        grow.duration = Self.moveDuration
        grow.timingFunction = Self.easing
        var animations: [CAAnimation] = [appear]
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion { animations.append(grow) }
        if let parent {
            animations.append(Self.leap(from: panel.local(parent), to: panel.local(cursor.position)))
        }
        let group = CAAnimationGroup()
        group.animations = animations
        group.duration = Self.moveDuration
        layer.root.add(group, forKey: "spawn")
    }
}
