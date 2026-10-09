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

    init(locator: ElementLocating = WindowCenterLocator()) {
        self.locator = locator
    }

    func start() {
        rebuildPanels()
        screenObserver = NotificationCenter.default.addObserver(
            forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated { self?.rebuildPanels() }
        }
    }

    var isClickThrough: Bool { panels.allSatisfy(\.ignoresMouseEvents) }
    var panelCount: Int { panels.count }

    // MARK: Harness commands (OBJ-18.7)

    func apply(_ command: CursorCommand) {
        switch command {
        case .spawn(let spawn):
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
        var accent: NSColor?
        if kind == .ghost {
            accent = GhostColors.palette[nextGhostColor % GhostColors.palette.count]
            nextGhostColor += 1
        }
        let cursor = OverlayCursor(id: id, kind: kind, state: .idle, label: label, accent: accent, position: point)
        cursors[id] = cursor
        for panel in panels { addLayer(for: cursor, to: panel, fadeIn: true) }
        log.info("Spawned \(id, privacy: .public)")
    }

    func move(id: String, to point: CGPoint) {
        guard var cursor = cursors[id] else { return }
        let from = cursor.position
        cursor.position = point
        cursors[id] = cursor
        for panel in panels {
            guard let layer = layers[id]?[ObjectIdentifier(panel)] else { continue }
            let animation = CABasicAnimation(keyPath: "position")
            // Starts from where the cursor is on screen now, so a new move mid-flight never jumps.
            animation.fromValue = NSValue(point: layer.root.presentation()?.position ?? panel.local(from))
            animation.toValue = NSValue(point: panel.local(point))
            animation.duration = Self.moveDuration
            animation.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            layer.root.position = panel.local(point)
            CATransaction.commit()
            layer.root.add(animation, forKey: "move")
        }
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

    private func addLayer(for cursor: OverlayCursor, to panel: OverlayPanel, fadeIn: Bool) {
        let layer = CursorLayer()
        layer.setScale(panel.backingScaleFactor)
        layer.root.position = panel.local(cursor.position)
        layer.apply(cursor, scale: panel.backingScaleFactor)
        panel.rootLayer.addSublayer(layer.root)
        layers[cursor.id, default: [:]][ObjectIdentifier(panel)] = layer
        if fadeIn {
            let animation = CABasicAnimation(keyPath: "opacity")
            animation.fromValue = 0
            animation.toValue = 1
            animation.duration = Self.fadeInDuration
            layer.root.add(animation, forKey: "fadeIn")
        }
    }
}
