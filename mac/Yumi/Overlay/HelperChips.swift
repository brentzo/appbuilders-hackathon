import AppKit
import QuartzCore
import SwiftUI

/// Helpers work without a cursor, so they show as small status chips in the top-right corner of
/// the main display (SPEC-04 r6).
@MainActor
final class HelperChips {
    private var container: CALayer?
    private var panelSize: CGSize = .zero
    private var scale: CGFloat = 2
    private var chips: [(id: String, layer: CALayer)] = []
    private var nextColor = 0
    /// Where the panel sits on the screens, to give frames in global coordinates.
    private var panelOrigin: CGPoint = .zero
    /// Open thoughts panels under their chips, by chip id (OBJ-53).
    private var cards: [String: ThoughtsCard] = [:]

    /// A chip's colors: a littermate's fur, its line for the dot and edge, and its label text.
    struct ChipColors {
        let fill: NSColor
        let line: NSColor
        let text: NSColor
    }

    /// The littermates in order (mint, sky, slate), as the design README gives ghost labels.
    /// The label colors are `cat.labelText` in character/design/tokens.json, which the generated
    /// Swift does not carry yet.
    static let palette: [ChipColors] = [
        chipColors(YumiCatColors.mint, text: 0x1F3D35),
        chipColors(YumiCatColors.sky, text: 0x22324F),
        chipColors(YumiCatColors.slate, text: 0x2A2E35),
    ]

    private static func chipColors(_ cat: YumiCatPalette, text: UInt32) -> ChipColors {
        let red = CGFloat((text >> 16) & 0xFF) / 255
        let green = CGFloat((text >> 8) & 0xFF) / 255
        let blue = CGFloat(text & 0xFF) / 255
        return ChipColors(fill: NSColor(cat.fur), line: NSColor(cat.line), text: NSColor(srgbRed: red, green: green, blue: blue, alpha: 1))
    }

    func attach(to panel: OverlayPanel) {
        let layer = CALayer()
        layer.frame = panel.rootLayer.bounds
        panel.rootLayer.addSublayer(layer)
        container = layer
        panelSize = panel.rootLayer.bounds.size
        panelOrigin = panel.screenFrame.origin
        scale = panel.backingScaleFactor
        for card in cards.values { card.layer.removeFromSuperlayer() }
        cards = [:]
        let existing = chips
        chips = []
        for chip in existing {
            show(id: chip.id, text: (chip.layer.sublayers?.first as? CATextLayer)?.string as? String ?? "", colors: chip.layer.value(forKey: "colors") as? Int)
        }
    }

    func show(id: String, text: String) {
        show(id: id, text: text, colors: nil)
    }

    private func show(id: String, text: String, colors index: Int?) {
        remove(id: id, animated: false)
        let colorIndex = index ?? {
            defer { nextColor += 1 }
            return nextColor % Self.palette.count
        }()
        let colors = Self.palette[colorIndex]
        let font = NSFont.systemFont(ofSize: 12, weight: .semibold)
        let width = ceil((text as NSString).size(withAttributes: [.font: font]).width) + 34
        let chip = CALayer()
        chip.bounds = CGRect(x: 0, y: 0, width: width, height: 24)
        chip.cornerRadius = 12
        chip.backgroundColor = colors.fill.cgColor
        chip.borderColor = colors.line.withAlphaComponent(0.35).cgColor
        chip.borderWidth = 1
        chip.shadowColor = colors.line.cgColor
        chip.shadowOpacity = 0.18
        chip.shadowRadius = 6
        chip.shadowOffset = CGSize(width: 0, height: -2)
        chip.contentsScale = scale
        chip.setValue(colorIndex, forKey: "colors")
        let dot = CALayer()
        dot.frame = CGRect(x: 10, y: 8, width: 8, height: 8)
        dot.cornerRadius = 4
        dot.backgroundColor = colors.line.cgColor
        let pulse = CABasicAnimation(keyPath: "opacity")
        pulse.fromValue = 1
        pulse.toValue = 0.25
        pulse.duration = 0.7
        pulse.autoreverses = true
        pulse.repeatCount = .infinity
        dot.add(pulse, forKey: "pulse")
        let label = CATextLayer()
        label.string = text
        label.font = font
        label.fontSize = 12
        label.foregroundColor = colors.text.cgColor
        label.contentsScale = scale
        label.frame = CGRect(x: 24, y: 4, width: width - 30, height: 16)
        chip.addSublayer(label)
        chip.addSublayer(dot)
        container?.addSublayer(chip)
        chips.append((id, chip))
        layout()
    }

    func remove(id: String, animated: Bool = true) {
        guard let index = chips.firstIndex(where: { $0.id == id }) else { return }
        cards.removeValue(forKey: id)?.layer.removeFromSuperlayer()
        let layer = chips.remove(at: index).layer
        if animated {
            CATransaction.begin()
            CATransaction.setAnimationDuration(0.4)
            CATransaction.setCompletionBlock { layer.removeFromSuperlayer() }
            layer.opacity = 0
            CATransaction.commit()
        } else {
            layer.removeFromSuperlayer()
        }
        layout()
    }

    func removeAll() {
        for chip in chips { remove(id: chip.id) }
    }

    var count: Int { chips.count }

    /// Opens a chip's thoughts panel under it, pushing the chips below it down, or closes it with nil.
    func setThoughts(_ content: ThoughtsContent?, for id: String) {
        guard let chip = chips.first(where: { $0.id == id }) else { return }
        if let content {
            let card = cards[id] ?? {
                let card = ThoughtsCard()
                card.setScale(scale)
                container?.addSublayer(card.layer)
                cards[id] = card
                return card
            }()
            let colors = Self.palette[chip.layer.value(forKey: "colors") as? Int ?? 0]
            card.show(content, accent: colors.fill, topRight: .zero)
        } else {
            cards.removeValue(forKey: id)?.layer.removeFromSuperlayer()
        }
        layout()
    }

    /// Each chip with its open panel, in global AppKit coordinates, for clicks in Debug mode.
    var tapFrames: [(id: String, frame: CGRect)] {
        chips.map { chip in
            var frame = chip.layer.frame
            if let card = cards[chip.id], card.isShown { frame = frame.union(card.frame) }
            return (chip.id, frame.offsetBy(dx: panelOrigin.x, dy: panelOrigin.y))
        }
    }

    /// Stacked down from below the menu bar, right-aligned, each open panel under its chip.
    private func layout() {
        var top = panelSize.height - 40
        for chip in chips {
            let size = chip.layer.bounds.size
            chip.layer.position = CGPoint(x: panelSize.width - 16 - size.width / 2, y: top - size.height / 2)
            top -= size.height + 6
            if let card = cards[chip.id], card.isShown {
                CATransaction.begin()
                CATransaction.setDisableActions(true)
                card.layer.frame.origin = CGPoint(x: panelSize.width - 16 - card.frame.width, y: top - card.frame.height)
                CATransaction.commit()
                top -= card.frame.height + 6
            }
        }
    }
}
