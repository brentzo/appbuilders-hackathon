import AppKit
import QuartzCore
import YumiProtocol

/// The drawing for one cursor on one display: the Yumi cat in its pose for the cursor state, in
/// its palette (ginger for the main cursor, a littermate's coat for a ghost), a state badge, and a
/// label pill. Static poses with small Core Animation motion stand in for the Rive cat (OBJ-19).
///
/// The layer's position is the click point: the spot between the cat's front paws (SPEC-04 r13).
final class CursorLayer {
    /// The layer added to a panel. Its position is the click point.
    let root = CALayer()
    private let cat = CALayer()
    private let badge = CALayer()
    private let badgeIcon = CALayer()
    private let labelPill = CALayer()
    private let labelText = CATextLayer()

    /// The whole pose image on screen, in points. Matches POINTS in mac/scripts/render-cursor-cat.py.
    static let catSize = CGSize(width: 48, height: 48)
    /// Where the paws land in the pose image, from its top-left corner, as a fraction of its size
    /// (character/assets/manifest.json: 229.6, 434.3 of 512).
    static let hotspot = CGPoint(x: 229.6 / 512, y: 434.3 / 512)

    private var shownState: CursorState?
    private var shownPalette: CatPalette?

    init() {
        root.anchorPoint = .zero
        root.bounds = CGRect(origin: .zero, size: .zero)
        root.masksToBounds = false

        // Anchored at the paws, so the pose sits on the click point and squashes and tilts around it.
        cat.bounds = CGRect(origin: .zero, size: Self.catSize)
        cat.anchorPoint = CGPoint(x: Self.hotspot.x, y: 1 - Self.hotspot.y)
        cat.position = .zero
        cat.contentsGravity = .resizeAspect
        cat.shadowColor = NSColor.black.cgColor
        cat.shadowOpacity = 0.22
        cat.shadowRadius = 2
        cat.shadowOffset = CGSize(width: 0, height: -1)

        // Top right of the cat, clear of the paws.
        let catTop = Self.catSize.height * Self.hotspot.y
        badge.bounds = CGRect(x: 0, y: 0, width: 18, height: 18)
        badge.cornerRadius = 9
        badge.backgroundColor = Self.surface.cgColor
        badge.borderWidth = 1.5
        badge.position = CGPoint(x: Self.catSize.width * (1 - Self.hotspot.x) - 2, y: catTop - 4)
        badge.isHidden = true
        badgeIcon.frame = badge.bounds.insetBy(dx: 4, dy: 4)
        badgeIcon.contentsGravity = .resizeAspect
        badge.addSublayer(badgeIcon)

        labelPill.cornerRadius = 10
        labelPill.borderWidth = 1
        labelPill.isHidden = true
        labelText.fontSize = 12
        labelText.font = NSFont.systemFont(ofSize: 12, weight: .semibold)
        labelText.alignmentMode = .left
        labelText.truncationMode = .end
        labelPill.addSublayer(labelText)

        root.addSublayer(cat)
        root.addSublayer(badge)
        root.addSublayer(labelPill)
    }

    /// Cards and chips on paper (design token `surface`).
    private static let surface = NSColor(srgbRed: 1, green: 0.992, blue: 0.965, alpha: 1)

    private static var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    /// Sharp at every display scale: poses, text, and icons drawn at the display's scale.
    func setScale(_ scale: CGFloat) {
        for layer in [root, cat, badge, badgeIcon, labelPill, labelText] as [CALayer] {
            layer.contentsScale = scale
        }
        if let shownPalette, let shownState {
            cat.contents = shownPalette.image(for: shownState)?.layerContents(forContentsScale: scale)
        }
        badgeIcon.contents = badgeImage.flatMap { image(for: $0, scale: scale) }
    }

    private var badgeImage: String?
    private var badgeColor = NSColor.black

    func apply(_ cursor: OverlayCursor, scale: CGFloat) {
        let stateChanged = cursor.state != shownState
        CATransaction.begin()
        CATransaction.setDisableActions(true)

        if stateChanged || cursor.palette != shownPalette {
            cat.contents = cursor.palette.image(for: cursor.state)?.layerContents(forContentsScale: scale)
            shownState = cursor.state
            shownPalette = cursor.palette
        }

        badgeColor = cursor.palette.labelText
        badge.borderColor = cursor.palette.fur.cgColor
        badgeImage = cursor.state.badgeSymbol
        badge.isHidden = badgeImage == nil
        badgeIcon.contents = badgeImage.flatMap { image(for: $0, scale: scale) }

        if let label = cursor.label, !label.isEmpty {
            // Ghost labels wear the ghost's fur; the main cursor's label sits on surface.
            let ghost = cursor.palette != .ginger
            labelPill.backgroundColor = (ghost ? cursor.palette.fur : Self.surface).cgColor
            labelPill.borderColor = (ghost ? cursor.palette.labelText.withAlphaComponent(0.25) : cursor.palette.fur).cgColor
            labelText.foregroundColor = cursor.palette.labelText.cgColor
            labelText.string = label
            let size = (label as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 12, weight: .semibold)])
            let width = min(ceil(size.width) + 20, 240)
            // Under the paws, starting a little left of the click point.
            labelPill.frame = CGRect(x: -12, y: -28, width: width, height: 20)
            labelText.frame = CGRect(x: 10, y: 2, width: width - 20, height: 16)
            labelPill.isHidden = false
        } else {
            labelPill.isHidden = true
        }
        CATransaction.commit()

        if stateChanged { animate(cursor.state) }
    }

    /// Small motion for the pose: breathing while it waits, a pounce on a click, a happy hop when
    /// done, and a gentle confused tilt when stuck. Reduce Motion keeps the still pose.
    private func animate(_ state: CursorState) {
        cat.removeAllAnimations()
        badge.removeAnimation(forKey: "pulse")
        // Thinking pulses its badge, so a slow step never looks frozen (SPEC-04 r4).
        if state == .thinking {
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 1
            pulse.toValue = 0.3
            pulse.duration = 0.6
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            badge.add(pulse, forKey: "pulse")
        }
        guard !Self.reduceMotion else { return }
        switch state {
        case .idle, .listening, .thinking, .waitingForUser, .paused:
            let breathe = CABasicAnimation(keyPath: "transform.scale.y")
            breathe.fromValue = 1
            breathe.toValue = state == .paused ? 1.035 : 1.025
            breathe.duration = state == .paused ? 1.7 : 1.2
            breathe.autoreverses = true
            breathe.repeatCount = .infinity
            breathe.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            cat.add(breathe, forKey: "breathe")
        case .acting:
            // A pounce: crouch, stretch, land. The paws stay on the click point throughout.
            let pounce = CAKeyframeAnimation(keyPath: "transform")
            pounce.values = [
                CATransform3DIdentity, CATransform3DMakeScale(1.08, 0.86, 1),
                CATransform3DMakeScale(0.94, 1.1, 1), CATransform3DIdentity,
            ].map { NSValue(caTransform3D: $0) }
            pounce.keyTimes = [0, 0.3, 0.65, 1]
            pounce.duration = 0.3
            cat.add(pounce, forKey: "pounce")
        case .done:
            let hop = CAKeyframeAnimation(keyPath: "transform.translation.y")
            hop.values = [0, 7, 0, 3, 0]
            hop.keyTimes = [0, 0.3, 0.55, 0.75, 1]
            hop.duration = 0.6
            cat.add(hop, forKey: "hop")
        case .stuck:
            let tilt = CAKeyframeAnimation(keyPath: "transform.rotation.z")
            tilt.values = [0, 0.07, -0.05, 0.03, 0]
            tilt.duration = 1.2
            tilt.repeatCount = .infinity
            cat.add(tilt, forKey: "tilt")
        case .moving:
            break
        }
    }

    private func image(for symbol: String, scale: CGFloat) -> CGImage? {
        guard let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
            .withSymbolConfiguration(
                NSImage.SymbolConfiguration(pointSize: 10, weight: .bold).applying(.init(paletteColors: [badgeColor]))
            ) else { return nil }
        var rect = CGRect(origin: .zero, size: image.size)
        let rep = image.cgImage(forProposedRect: &rect, context: nil, hints: [.ctm: AffineTransform(scale: scale)])
        return rep
    }
}
