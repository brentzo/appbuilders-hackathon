import AppKit
import QuartzCore

/// The placeholder drawing for one cursor on one display: a black pointer with a white outline
/// (the cat is black and white, SPEC-04), a ghost's accent ring, a state badge, and a label pill.
/// The Rive cat (OBJ-19) replaces this behind the same position and state.
///
/// The layer's position is the pointer tip, which is the click point.
final class CursorLayer {
    /// The layer added to a panel. Its position is the pointer tip.
    let root = CALayer()
    private let pointer = CAShapeLayer()
    private let badge = CALayer()
    private let badgeIcon = CALayer()
    private let labelPill = CALayer()
    private let labelText = CATextLayer()

    static let pointerSize = CGSize(width: 22, height: 30)

    init() {
        root.anchorPoint = .zero
        root.bounds = CGRect(origin: .zero, size: .zero)
        root.masksToBounds = false

        // The arrow's tip is at (0, 0); it points up and to the left, like the system pointer.
        let path = CGMutablePath()
        let h = Self.pointerSize.height, w = Self.pointerSize.width
        path.move(to: .zero)
        path.addLine(to: CGPoint(x: 0, y: -h))
        path.addLine(to: CGPoint(x: w * 0.30, y: -h * 0.74))
        path.addLine(to: CGPoint(x: w * 0.52, y: -h * 1.0 + 1))
        path.addLine(to: CGPoint(x: w * 0.68, y: -h * 0.93))
        path.addLine(to: CGPoint(x: w * 0.46, y: -h * 0.68))
        path.addLine(to: CGPoint(x: w * 0.82, y: -h * 0.66))
        path.closeSubpath()
        pointer.path = path
        pointer.fillColor = NSColor.black.cgColor
        pointer.strokeColor = NSColor.white.cgColor
        pointer.lineWidth = 1.6
        pointer.lineJoin = .round
        pointer.shadowColor = NSColor.black.cgColor
        pointer.shadowOpacity = 0.35
        pointer.shadowRadius = 2
        pointer.shadowOffset = CGSize(width: 0, height: -1)

        badge.bounds = CGRect(x: 0, y: 0, width: 20, height: 20)
        badge.cornerRadius = 10
        badge.backgroundColor = NSColor.white.cgColor
        badge.borderColor = NSColor.black.cgColor
        badge.borderWidth = 1.5
        badge.position = CGPoint(x: Self.pointerSize.width + 10, y: -Self.pointerSize.height * 0.45)
        badge.isHidden = true
        badgeIcon.frame = badge.bounds.insetBy(dx: 4, dy: 4)
        badgeIcon.contentsGravity = .resizeAspect
        badge.addSublayer(badgeIcon)

        labelPill.backgroundColor = NSColor.white.cgColor
        labelPill.borderColor = NSColor.black.cgColor
        labelPill.borderWidth = 1.5
        labelPill.cornerRadius = 9
        labelPill.isHidden = true
        labelText.fontSize = 12
        labelText.font = NSFont.systemFont(ofSize: 12, weight: .semibold)
        labelText.foregroundColor = NSColor.black.cgColor
        labelText.alignmentMode = .left
        labelText.truncationMode = .end
        labelPill.addSublayer(labelText)

        root.addSublayer(pointer)
        root.addSublayer(badge)
        root.addSublayer(labelPill)
    }

    /// Sharp at every display scale: vector shapes, and text and icons drawn at the display's scale.
    func setScale(_ scale: CGFloat) {
        for layer in [root, pointer, badge, badgeIcon, labelPill, labelText] as [CALayer] {
            layer.contentsScale = scale
        }
        badgeIcon.contents = badgeImage.flatMap { image(for: $0, scale: scale) }
    }

    private var badgeImage: String?

    func apply(_ cursor: OverlayCursor, scale: CGFloat) {
        CATransaction.begin()
        CATransaction.setDisableActions(true)

        // Ghosts keep the black body and wear their color as the outline and label border.
        if let accent = cursor.accent {
            pointer.strokeColor = accent.cgColor
            pointer.lineWidth = 2.4
            labelPill.borderColor = accent.cgColor
        } else {
            pointer.strokeColor = NSColor.white.cgColor
            pointer.lineWidth = 1.6
            labelPill.borderColor = NSColor.black.cgColor
        }

        badgeImage = cursor.state.badgeSymbol
        badge.isHidden = badgeImage == nil
        badgeIcon.contents = badgeImage.flatMap { image(for: $0, scale: scale) }

        if let label = cursor.label, !label.isEmpty {
            labelText.string = label
            let size = (label as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: 12, weight: .semibold)])
            let width = min(ceil(size.width) + 18, 240)
            labelPill.frame = CGRect(x: 6, y: -Self.pointerSize.height - 26, width: width, height: 20)
            labelText.frame = CGRect(x: 9, y: 2, width: width - 18, height: 16)
            labelPill.isHidden = false
        } else {
            labelPill.isHidden = true
        }
        CATransaction.commit()

        // Thinking pulses its badge, so a slow step never looks frozen (SPEC-04 r4).
        badge.removeAnimation(forKey: "pulse")
        if cursor.state == .thinking {
            let pulse = CABasicAnimation(keyPath: "opacity")
            pulse.fromValue = 1
            pulse.toValue = 0.3
            pulse.duration = 0.6
            pulse.autoreverses = true
            pulse.repeatCount = .infinity
            badge.add(pulse, forKey: "pulse")
        }
    }

    private func image(for symbol: String, scale: CGFloat) -> CGImage? {
        guard let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)?
            .withSymbolConfiguration(
                NSImage.SymbolConfiguration(pointSize: 11, weight: .bold).applying(.init(paletteColors: [.black]))
            ) else { return nil }
        var rect = CGRect(origin: .zero, size: image.size)
        let rep = image.cgImage(forProposedRect: &rect, context: nil, hints: [.ctm: AffineTransform(scale: scale)])
        return rep
    }
}
