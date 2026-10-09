import AppKit
import QuartzCore
import SwiftUI

/// The open thoughts panel of a cat or a helper chip (OBJ-53): the subtask, the lane and when it
/// last thought, what it sees, its last action, and the model's last decision and why. A card on
/// `surface` that follows the system's light or dark appearance, with a dot in the cat's own coat.
/// Over a cat it takes the bubble's place, with the same tail pointing at the cat.
final class ThoughtsCard {
    let layer = CALayer()
    private let shape = CAShapeLayer()
    private let text = CALayer()
    private var scale: CGFloat = 2
    /// What the text image shows now, so it is drawn again only when something changed.
    private var drawn: (content: ThoughtsContent, accent: NSColor, colors: Colors, scale: CGFloat)?

    static let width: CGFloat = 272
    static let padding = CGSize(width: YumiSpace.m, height: 10)
    static let labelColumn: CGFloat = 74
    static let titleFont = NSFont.systemFont(ofSize: 12, weight: .semibold)
    static let subtitleFont = NSFont.systemFont(ofSize: 10.5, weight: .medium)
    static let labelFont = NSFont.systemFont(ofSize: 11, weight: .semibold)
    static let valueFont = NSFont.systemFont(ofSize: 11, weight: .regular)
    static let dot: CGFloat = 7
    static let rowGap: CGFloat = 5
    static let tail = CursorBubble.tail

    init() {
        layer.anchorPoint = .zero
        layer.isHidden = true
        shape.lineWidth = 1
        shape.shadowColor = NSColor.black.cgColor
        shape.shadowOpacity = 0.18
        shape.shadowRadius = 8
        shape.shadowOffset = CGSize(width: 0, height: -2)
        text.contentsGravity = .topLeft
        layer.addSublayer(shape)
        layer.addSublayer(text)
    }

    func setScale(_ scale: CGFloat) {
        self.scale = scale
        for sublayer in [layer, shape, text] as [CALayer] { sublayer.contentsScale = scale }
    }

    var isShown: Bool { !layer.isHidden }

    /// The card's frame in its parent's coordinates, tail included. Zero while hidden.
    var frame: CGRect { layer.isHidden ? .zero : layer.frame }

    // MARK: Showing

    /// Over a cat: the tail tip at `anchor`, pointing down at the cat (or up at the paws when
    /// `below`), and the card moved `shift` points sideways so it stays on the display.
    func show(_ content: ThoughtsContent, accent: NSColor, anchor: CGPoint, below: Bool, shift: CGFloat) {
        let card = Self.cardSize(for: content)
        let total = CGSize(width: card.width, height: card.height + Self.tail.height)
        let origin = CGPoint(
            x: anchor.x - total.width / 2 + shift,
            y: below ? anchor.y - total.height - CursorBubble.gap : anchor.y + CursorBubble.gap
        )
        let path = Self.path(card: card, tail: below ? .top : .bottom, tailX: card.width / 2 - shift)
        place(content, accent: accent, frame: CGRect(origin: origin, size: total), path: path, textY: below ? 0 : Self.tail.height)
    }

    /// Under a helper chip: a plain card with its top-right corner at `topRight`.
    func show(_ content: ThoughtsContent, accent: NSColor, topRight: CGPoint) {
        let card = Self.cardSize(for: content)
        let frame = CGRect(x: topRight.x - card.width, y: topRight.y - card.height, width: card.width, height: card.height)
        place(content, accent: accent, frame: frame, path: Self.path(card: card, tail: nil, tailX: 0), textY: 0)
    }

    func hide() {
        layer.isHidden = true
        text.contents = nil
        drawn = nil
    }

    private func place(_ content: ThoughtsContent, accent: NSColor, frame: CGRect, path: CGPath, textY: CGFloat) {
        let size = Self.cardSize(for: content)
        let colors = Self.colors()
        let wasHidden = layer.isHidden
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.isHidden = false
        layer.frame = frame
        shape.frame = layer.bounds
        shape.path = path
        shape.fillColor = colors.fill.cgColor
        shape.strokeColor = colors.edge.cgColor
        text.frame = CGRect(x: 0, y: textY, width: size.width, height: size.height)
        CATransaction.commit()
        if drawn?.content != content || drawn?.accent != accent || drawn?.colors != colors || drawn?.scale != scale {
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            text.contents = Self.render(content, accent: accent, colors: colors, scale: scale)
            CATransaction.commit()
            drawn = (content, accent, colors, scale)
        }
        if wasHidden, !CursorMotion.reduceMotion {
            let grow = CABasicAnimation(keyPath: "opacity")
            grow.fromValue = 0
            grow.toValue = 1
            grow.duration = CursorBubble.resizeDuration
            layer.add(grow, forKey: "open")
        }
    }

    // MARK: Colors

    struct Colors: Equatable {
        let fill: NSColor
        let edge: NSColor
        let ink: NSColor
        let muted: NSColor
    }

    /// The design tokens, resolved for the system's appearance now. The overlay draws again when
    /// the appearance changes.
    static func colors(for appearance: NSAppearance = NSApp?.effectiveAppearance ?? NSAppearance(named: .aqua)!) -> Colors {
        var colors: Colors?
        appearance.performAsCurrentDrawingAppearance {
            func resolved(_ color: Color) -> NSColor {
                NSColor(color).usingColorSpace(.sRGB) ?? NSColor(color)
            }
            colors = Colors(
                fill: resolved(YumiColor.surface), edge: resolved(YumiColor.line),
                ink: resolved(YumiColor.ink), muted: resolved(YumiColor.muted)
            )
        }
        return colors!
    }

    // MARK: Layout

    /// Where each piece of text goes, from the card's top-left corner, top-down.
    struct Line {
        let string: NSAttributedString
        let rect: CGRect
    }

    /// The text of a card laid out top-down: title, subtitle (after the coat dot), then one row per
    /// field with its label in a column and its value wrapping beside it.
    static func layout(_ content: ThoughtsContent, colors: Colors) -> (lines: [Line], dot: CGRect, height: CGFloat) {
        let inner = width - 2 * padding.width
        var lines: [Line] = []
        var y = padding.height

        let title = NSAttributedString(string: content.title, attributes: [.font: titleFont, .foregroundColor: colors.ink])
        let titleHeight = measure(title, width: inner)
        lines.append(Line(string: title, rect: CGRect(x: padding.width, y: y, width: inner, height: titleHeight)))
        y += titleHeight + 2

        let subtitle = NSAttributedString(string: content.subtitle, attributes: [.font: subtitleFont, .foregroundColor: colors.muted])
        let subtitleHeight = measure(subtitle, width: inner - dot - 5)
        let dotRect = CGRect(x: padding.width, y: y + (ceil(subtitleFont.ascender - subtitleFont.descender) - dot) / 2, width: dot, height: dot)
        lines.append(Line(string: subtitle, rect: CGRect(x: padding.width + dot + 5, y: y, width: inner - dot - 5, height: subtitleHeight)))
        y += subtitleHeight + 8

        for row in content.rows {
            let label = NSAttributedString(string: row.label, attributes: [.font: labelFont, .foregroundColor: colors.muted])
            var valueAttributes: [NSAttributedString.Key: Any] = [.font: valueFont, .foregroundColor: row.placeholder ? colors.muted : colors.ink]
            if row.placeholder { valueAttributes[.obliqueness] = 0.12 }
            let value = NSAttributedString(string: row.value, attributes: valueAttributes)
            let valueWidth = inner - labelColumn
            let height = max(measure(label, width: labelColumn), measure(value, width: valueWidth))
            lines.append(Line(string: label, rect: CGRect(x: padding.width, y: y, width: labelColumn - 6, height: height)))
            lines.append(Line(string: value, rect: CGRect(x: padding.width + labelColumn, y: y, width: valueWidth, height: height)))
            y += height + rowGap
        }
        return (lines, dotRect, ceil(y - rowGap + padding.height))
    }

    /// The card without its tail.
    static func cardSize(for content: ThoughtsContent) -> CGSize {
        CGSize(width: width, height: layout(content, colors: colors()).height)
    }

    /// The height a card needs above its anchor, tail included, to decide whether it fits there.
    static func height(for content: ThoughtsContent) -> CGFloat {
        cardSize(for: content).height + tail.height + CursorBubble.gap
    }

    private static func measure(_ string: NSAttributedString, width: CGFloat) -> CGFloat {
        ceil(string.boundingRect(with: CGSize(width: width, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading]).height)
    }

    enum TailEdge { case top, bottom }

    /// A rounded card, with a small tail on its top or bottom edge at `tailX`, kept clear of the corners.
    static func path(card: CGSize, tail edge: TailEdge?, tailX: CGFloat) -> CGPath {
        let body = CGRect(x: 0, y: edge == .bottom ? tail.height : 0, width: card.width, height: card.height)
        let r = min(YumiRadius.field, body.height / 2)
        let half = tail.width / 2
        let mid = min(max(tailX, body.minX + r + half), body.maxX - r - half)
        let path = CGMutablePath()
        path.move(to: CGPoint(x: body.minX + r, y: body.maxY))
        if edge == .top {
            path.addLine(to: CGPoint(x: mid - half, y: body.maxY))
            path.addLine(to: CGPoint(x: mid, y: body.maxY + tail.height))
            path.addLine(to: CGPoint(x: mid + half, y: body.maxY))
        }
        path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.maxY), tangent2End: CGPoint(x: body.maxX, y: body.minY), radius: r)
        path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.minY), tangent2End: CGPoint(x: body.minX, y: body.minY), radius: r)
        if edge == .bottom {
            path.addLine(to: CGPoint(x: mid + half, y: body.minY))
            path.addLine(to: CGPoint(x: mid, y: body.minY - tail.height))
            path.addLine(to: CGPoint(x: mid - half, y: body.minY))
        }
        path.addArc(tangent1End: CGPoint(x: body.minX, y: body.minY), tangent2End: CGPoint(x: body.minX, y: body.maxY), radius: r)
        path.addArc(tangent1End: CGPoint(x: body.minX, y: body.maxY), tangent2End: CGPoint(x: body.maxX, y: body.maxY), radius: r)
        path.closeSubpath()
        return path
    }

    /// The text drawn with AppKit at the display's scale, so it wraps exactly as `layout` measured it.
    static func render(_ content: ThoughtsContent, accent: NSColor, colors: Colors, scale: CGFloat) -> CGImage? {
        let layout = layout(content, colors: colors)
        let size = CGSize(width: width, height: layout.height)
        guard let context = CGContext(
            data: nil, width: Int(ceil(size.width * scale)), height: Int(ceil(size.height * scale)),
            bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }
        // The layout runs top-down, so draw in a flipped context.
        context.scaleBy(x: scale, y: scale)
        context.translateBy(x: 0, y: size.height)
        context.scaleBy(x: 1, y: -1)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
        context.setFillColor(accent.cgColor)
        context.fillEllipse(in: layout.dot)
        for line in layout.lines {
            line.string.draw(with: line.rect, options: [.usesLineFragmentOrigin, .usesFontLeading, .truncatesLastVisibleLine])
        }
        NSGraphicsContext.restoreGraphicsState()
        return context.makeImage()
    }
}
