import AppKit
import QuartzCore

/// The speech bubble over a cat: a rounded card with a small tail pointing at the cat, holding
/// the task and its current step, or what the user is saying while Yumi listens. At most two
/// lines, truncated at the end. It sits above the cat, or below the paws when there is no room
/// above (for example just under the island).
final class CursorBubble {
    let layer = CALayer()
    private let shape = CAShapeLayer()
    private let text = CATextLayer()

    static let font = NSFont.systemFont(ofSize: 12, weight: .semibold)
    static let maxWidth: CGFloat = 240
    static let padding = CGSize(width: 10, height: 6)
    static let tail = CGSize(width: 12, height: 6)
    static let cornerRadius: CGFloat = 10
    /// The gap between the tail's tip and the cat (above) or the paws (below).
    static let gap: CGFloat = 2

    private var shown: String?
    private var below: Bool?

    init() {
        layer.anchorPoint = .zero
        layer.isHidden = true
        shape.lineWidth = 1
        shape.shadowColor = NSColor.black.cgColor
        shape.shadowOpacity = 0.12
        shape.shadowRadius = 3
        shape.shadowOffset = CGSize(width: 0, height: -1)
        text.font = Self.font
        text.fontSize = Self.font.pointSize
        text.alignmentMode = .left
        text.isWrapped = true
        text.truncationMode = .end
        layer.addSublayer(shape)
        layer.addSublayer(text)
    }

    func setScale(_ scale: CGFloat) {
        for sublayer in [layer, shape, text] as [CALayer] { sublayer.contentsScale = scale }
    }

    /// The size of the card (without the tail) for some text: one or two lines, at most `maxWidth`.
    static func cardSize(for string: String) -> CGSize {
        let inner = maxWidth - 2 * padding.width
        let line = ceil(font.ascender - font.descender + font.leading)
        let measured = (string as NSString).boundingRect(
            with: CGSize(width: inner, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin], attributes: [.font: font]
        )
        let lines: CGFloat = measured.height > line * 1.5 ? 2 : 1
        let width = lines == 2 ? inner : min(ceil(measured.width) + 1, inner)
        return CGSize(width: width + 2 * padding.width, height: line * lines + 2 * padding.height)
    }

    /// The height the bubble needs above its anchor, tail included, to decide whether it fits.
    static func height(for string: String) -> CGFloat {
        cardSize(for: string).height + tail.height + gap
    }

    /// Shows `string` with its tail tip at `anchor` (in the cursor's coordinates), pointing down at
    /// the cat, or up at the paws when `below`. Text changes crossfade and the card eases to its
    /// new size; `live` text (a transcript) only resizes, so fast updates never blur.
    func show(_ string: String?, anchor: CGPoint, below: Bool, fill: NSColor, edge: NSColor, textColor: NSColor, live: Bool) {
        guard let string, !string.isEmpty else {
            layer.isHidden = true
            shown = nil
            return
        }
        let card = Self.cardSize(for: string)
        let total = CGSize(width: card.width, height: card.height + Self.tail.height)
        // Centered over the anchor; the tail is at the bubble's middle.
        let origin = CGPoint(x: anchor.x - total.width / 2, y: below ? anchor.y - total.height - Self.gap : anchor.y + Self.gap)
        let path = Self.path(card: card, below: below)
        let textFrame = CGRect(
            x: Self.padding.width, y: (below ? 0 : Self.tail.height) + Self.padding.height,
            width: card.width - 2 * Self.padding.width, height: card.height - 2 * Self.padding.height
        )
        let wasHidden = layer.isHidden
        let changed = string != shown

        CATransaction.begin()
        CATransaction.setDisableActions(wasHidden || below != self.below)
        CATransaction.setAnimationDuration(Self.resizeDuration)
        CATransaction.setAnimationTimingFunction(Self.timing)
        layer.isHidden = false
        layer.frame = CGRect(origin: origin, size: total)
        shape.frame = layer.bounds
        shape.path = path
        shape.fillColor = fill.cgColor
        shape.strokeColor = edge.cgColor
        text.foregroundColor = textColor.cgColor
        text.frame = textFrame
        CATransaction.commit()

        if changed {
            if !wasHidden, !live, !CursorMotion.reduceMotion {
                let fade = CATransition()
                fade.type = .fade
                fade.duration = Self.resizeDuration
                text.add(fade, forKey: "crossfade")
            }
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            text.string = string
            CATransaction.commit()
        }
        shown = string
        self.below = below
    }

    /// Size and text changes ease on the design's move curve, a little quicker than a move.
    static let resizeDuration: CFTimeInterval = YumiMotion.moveMin * 0.6
    private static let timing = CAMediaTimingFunction(
        controlPoints: Float(YumiMotion.easing.0), Float(YumiMotion.easing.1), Float(YumiMotion.easing.2), Float(YumiMotion.easing.3)
    )

    /// A rounded card with a small tail at the middle of its bottom edge (or top edge when `below`).
    static func path(card: CGSize, below: Bool) -> CGPath {
        let body = CGRect(x: 0, y: below ? 0 : tail.height, width: card.width, height: card.height)
        let r = min(cornerRadius, body.height / 2)
        let mid = body.midX
        let half = tail.width / 2
        let path = CGMutablePath()
        if below {
            // Clockwise from the top-left corner, with the tail on the top edge pointing up.
            path.move(to: CGPoint(x: body.minX + r, y: body.maxY))
            path.addLine(to: CGPoint(x: mid - half, y: body.maxY))
            path.addLine(to: CGPoint(x: mid, y: body.maxY + tail.height))
            path.addLine(to: CGPoint(x: mid + half, y: body.maxY))
            path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.maxY), tangent2End: CGPoint(x: body.maxX, y: body.minY), radius: r)
            path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.minY), tangent2End: CGPoint(x: body.minX, y: body.minY), radius: r)
            path.addArc(tangent1End: CGPoint(x: body.minX, y: body.minY), tangent2End: CGPoint(x: body.minX, y: body.maxY), radius: r)
            path.addArc(tangent1End: CGPoint(x: body.minX, y: body.maxY), tangent2End: CGPoint(x: body.maxX, y: body.maxY), radius: r)
        } else {
            // From the top-left corner, with the tail on the bottom edge pointing down.
            path.move(to: CGPoint(x: body.minX + r, y: body.maxY))
            path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.maxY), tangent2End: CGPoint(x: body.maxX, y: body.minY), radius: r)
            path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.minY), tangent2End: CGPoint(x: body.minX, y: body.minY), radius: r)
            path.addLine(to: CGPoint(x: mid + half, y: body.minY))
            path.addLine(to: CGPoint(x: mid, y: body.minY - tail.height))
            path.addLine(to: CGPoint(x: mid - half, y: body.minY))
            path.addArc(tangent1End: CGPoint(x: body.minX, y: body.minY), tangent2End: CGPoint(x: body.minX, y: body.maxY), radius: r)
            path.addArc(tangent1End: CGPoint(x: body.minX, y: body.maxY), tangent2End: CGPoint(x: body.maxX, y: body.maxY), radius: r)
        }
        path.closeSubpath()
        return path
    }
}
