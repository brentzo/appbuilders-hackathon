import AppKit
import QuartzCore

/// Helpers work without a cursor, so they show as small status chips in the top-right corner of
/// the main display (SPEC-04 r6).
@MainActor
final class HelperChips {
    private var container: CALayer?
    private var panelSize: CGSize = .zero
    private var scale: CGFloat = 2
    private var chips: [(id: String, layer: CALayer)] = []

    func attach(to panel: OverlayPanel) {
        let layer = CALayer()
        layer.frame = panel.rootLayer.bounds
        panel.rootLayer.addSublayer(layer)
        container = layer
        panelSize = panel.rootLayer.bounds.size
        scale = panel.backingScaleFactor
        let existing = chips
        chips = []
        for chip in existing { show(id: chip.id, text: (chip.layer.sublayers?.first as? CATextLayer)?.string as? String ?? "") }
    }

    func show(id: String, text: String) {
        remove(id: id, animated: false)
        let font = NSFont.systemFont(ofSize: 12, weight: .semibold)
        let width = ceil((text as NSString).size(withAttributes: [.font: font]).width) + 34
        let chip = CALayer()
        chip.bounds = CGRect(x: 0, y: 0, width: width, height: 24)
        chip.cornerRadius = 12
        chip.backgroundColor = NSColor.white.cgColor
        chip.borderColor = NSColor.black.cgColor
        chip.borderWidth = 1.5
        chip.contentsScale = scale
        let dot = CALayer()
        dot.frame = CGRect(x: 10, y: 8, width: 8, height: 8)
        dot.cornerRadius = 4
        dot.backgroundColor = NSColor.black.cgColor
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
        label.foregroundColor = NSColor.black.cgColor
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

    /// Stacked down from below the menu bar, right-aligned.
    private func layout() {
        var top = panelSize.height - 40
        for chip in chips {
            let size = chip.layer.bounds.size
            chip.layer.position = CGPoint(x: panelSize.width - 16 - size.width / 2, y: top - size.height / 2)
            top -= size.height + 6
        }
    }
}
