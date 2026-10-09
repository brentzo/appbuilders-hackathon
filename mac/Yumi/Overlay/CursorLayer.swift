import AppKit
import QuartzCore
import YumiProtocol

/// The drawing for one cursor on one display: the Yumi cat in its pose for the cursor state, in
/// its palette (ginger for the main cursor, a littermate's coat for a ghost), a state badge, and a
/// speech bubble. Static poses with small Core Animation motion stand in for the Rive cat (OBJ-19).
///
/// The layer's position is the click point: the spot between the cat's front paws (SPEC-04 r13).
final class CursorLayer {
    /// The layer added to a panel. Its position is the click point.
    let root = CALayer()
    private let cat = CALayer()
    private let badge = CALayer()
    private let badgeIcon = CALayer()
    private let bubble = CursorBubble()
    /// The open thoughts panel, in the bubble's place (OBJ-53).
    private let thoughtsCard = ThoughtsCard()
    /// Set by the overlay when there is no room above the cat on its display.
    var bubbleBelow = false
    /// Set by the overlay while the cat's thoughts panel is open (Debug mode, OBJ-53), with how far
    /// the panel moves sideways to stay on the display.
    var thoughts: (content: ThoughtsContent, shift: CGFloat)?

    /// The whole pose image on screen, in points. Matches POINTS in mac/scripts/render-cursor-cat.py.
    static let catSize = CGSize(width: 48, height: 48)
    /// Where the paws land in the pose image, from its top-left corner, as a fraction of its size
    /// (character/assets/manifest.json: 229.6, 434.3 of 512).
    static let hotspot = CGPoint(x: 229.6 / 512, y: 434.3 / 512)

    private var shownState: CursorState?
    private var shownPalette: CatPalette?
    /// A pose held for a while instead of the cursor's state, such as moving while it leaps out of
    /// or back into the island.
    private var heldPose: CursorState?
    /// Ears back over whatever pose it has, while it dodges the user's pointer (SPEC-04 r21).
    private var earsBack = false
    private var last: (cursor: OverlayCursor, scale: CGFloat)?

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

        root.addSublayer(cat)
        root.addSublayer(badge)
        root.addSublayer(bubble.layer)
        root.addSublayer(thoughtsCard.layer)
    }

    /// What a click opens or closes the thoughts panel on, around the click point: the open panel,
    /// or else the bubble. Nil when neither shows.
    var thoughtsTapFrame: CGRect? {
        if thoughtsCard.isShown { return thoughtsCard.frame }
        return bubble.layer.isHidden ? nil : bubble.layer.frame
    }

    /// The bubble's tail tip: just over the cat's head, or just under the paws.
    static let bubbleAnchorAbove = CGPoint(x: catSize.width * (0.5 - hotspot.x), y: catSize.height * hotspot.y + 4)
    static let bubbleAnchorBelow = CGPoint(x: 0, y: -4)

    /// Whether a bubble with `text` over a cat at `point` (global) would leave the top of `visible`.
    static func bubbleNeedsFlip(_ text: String?, at point: CGPoint, visible: CGRect) -> Bool {
        guard let text else { return false }
        return point.y + bubbleAnchorAbove.y + CursorBubble.height(for: text) > visible.maxY
    }

    /// Cards and chips on paper (design token `surface`).
    private static let surface = NSColor(srgbRed: 1, green: 0.992, blue: 0.965, alpha: 1)

    private static var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    /// Sharp at every display scale: poses, text, and icons drawn at the display's scale.
    func setScale(_ scale: CGFloat) {
        for layer in [root, cat, badge, badgeIcon] as [CALayer] {
            layer.contentsScale = scale
        }
        bubble.setScale(scale)
        thoughtsCard.setScale(scale)
        if let shownPalette, let shownState {
            let image = earsBack ? shownPalette.earsBackImage : shownPalette.image(for: shownState)
            cat.contents = image?.layerContents(forContentsScale: scale)
        }
        badgeIcon.contents = badgeImage.flatMap { image(for: $0, scale: scale) }
    }

    private var badgeImage: String?
    private var badgeColor = NSColor.black

    /// Shows `pose` until `endPose`, keeping any state that arrives meanwhile for then.
    func showPose(_ pose: CursorState) {
        heldPose = pose
        // Plays the pose's motion again even when it is already showing, such as a second pounce.
        shownState = nil
        if let last { apply(last.cursor, scale: last.scale) }
    }

    func setEarsBack(_ on: Bool) {
        guard on != earsBack else { return }
        earsBack = on
        shownState = nil
        if let last { apply(last.cursor, scale: last.scale) }
    }

    func endPose(_ cursor: OverlayCursor, scale: CGFloat) {
        heldPose = nil
        apply(cursor, scale: scale)
    }

    func apply(_ cursor: OverlayCursor, scale: CGFloat) {
        last = (cursor, scale)
        let state = heldPose ?? cursor.state
        let stateChanged = state != shownState
        CATransaction.begin()
        CATransaction.setDisableActions(true)

        if stateChanged || cursor.palette != shownPalette {
            let image = earsBack ? cursor.palette.earsBackImage : cursor.palette.image(for: state)
            cat.contents = image?.layerContents(forContentsScale: scale)
            shownState = state
            shownPalette = cursor.palette
        }

        badgeColor = cursor.palette.labelText
        badge.borderColor = cursor.palette.fur.cgColor
        badgeImage = state.badgeSymbol
        badge.isHidden = badgeImage == nil
        badgeIcon.contents = badgeImage.flatMap { image(for: $0, scale: scale) }

        CATransaction.commit()

        // Ghost bubbles wear the ghost's fur; the main cursor's sits on surface.
        let ghost = cursor.palette != .ginger
        let anchor = bubbleBelow ? Self.bubbleAnchorBelow : Self.bubbleAnchorAbove
        if let thoughts {
            thoughtsCard.show(thoughts.content, accent: cursor.palette.fur, anchor: anchor, below: bubbleBelow, shift: thoughts.shift)
        } else {
            thoughtsCard.hide()
        }
        bubble.show(
            thoughts == nil ? cursor.bubbleText : nil, anchor: anchor, below: bubbleBelow,
            fill: ghost ? cursor.palette.fur : Self.surface,
            edge: ghost ? cursor.palette.labelText.withAlphaComponent(0.25) : cursor.palette.fur,
            textColor: cursor.palette.labelText, live: cursor.transcript != nil
        )

        if stateChanged { animate(state) }
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
