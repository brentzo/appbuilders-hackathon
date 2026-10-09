import AppKit
import QuartzCore

/// Where cats come from and go back to: a black pill at the camera notch, which grows as if the
/// notch opens, lets a cat out (or in), and shrinks back. Displays without a notch get the same
/// pill at the top center, just under the menu bar (SPEC-04 r19). One per overlay panel.
final class CursorIsland {
    /// Where a cat's paws start and end, in AppKit global coordinates: just under the pill.
    let mouth: CGPoint
    private let pill = CALayer()
    /// The pill at rest: exactly the notch, or a small pill that is hidden.
    private let restFrame: CGRect
    private let openFrame: CGRect
    private let hasNotch: Bool
    private var closing: DispatchWorkItem?

    static let openDuration: CFTimeInterval = 0.18
    static let closeDuration: CFTimeInterval = 0.25

    init(screen: NSScreen, in panel: OverlayPanel) {
        let geometry = Self.geometry(of: screen)
        hasNotch = geometry.hasNotch
        restFrame = Self.local(geometry.rest, in: panel)
        openFrame = Self.local(geometry.open, in: panel)
        mouth = CGPoint(x: geometry.open.midX, y: geometry.open.minY + 6)

        pill.backgroundColor = NSColor.black.cgColor
        pill.frame = restFrame
        pill.cornerRadius = min(restFrame.height, restFrame.width) / 2
        pill.opacity = 0
        pill.zPosition = -1
        panel.rootLayer.addSublayer(pill)
    }

    /// The pill's rest and open frames in AppKit global coordinates.
    static func geometry(of screen: NSScreen) -> (rest: CGRect, open: CGRect, hasNotch: Bool) {
        let frame = screen.frame
        let top = screen.safeAreaInsets.top
        if top > 0, let left = screen.auxiliaryTopLeftArea, let right = screen.auxiliaryTopRightArea {
            // The notch is the gap between the two usable areas beside it.
            let notch = CGRect(x: frame.minX + left.width, y: frame.maxY - top, width: frame.width - left.width - right.width, height: top)
            let open = CGRect(x: notch.minX - 24, y: notch.minY - 26, width: notch.width + 48, height: top + 26)
            return (notch, open, true)
        }
        let menuBarBottom = screen.visibleFrame.maxY
        let open = CGRect(x: frame.midX - 70, y: menuBarBottom - 6 - 34, width: 140, height: 34)
        let rest = CGRect(x: frame.midX - 20, y: open.maxY - 12, width: 40, height: 12)
        return (rest, open, false)
    }

    private static func local(_ rect: CGRect, in panel: OverlayPanel) -> CGRect {
        CGRect(origin: panel.local(rect.origin), size: rect.size)
    }

    /// Opens the pill and keeps it open for `seconds`, then closes it. Calls while it is open
    /// only push the closing back, so several cats can come and go through one opening.
    func open(for seconds: CFTimeInterval) {
        closing?.cancel()
        if CursorMotion.reduceMotion, pill.opacity == 0 {
            // No growing: the open pill only fades in.
            setFrame(openFrame, animated: false)
        }
        CATransaction.begin()
        CATransaction.setAnimationDuration(Self.openDuration)
        CATransaction.setAnimationTimingFunction(Self.timing)
        setFrame(openFrame, animated: true)
        pill.opacity = 1
        CATransaction.commit()

        let work = DispatchWorkItem { [weak self] in self?.close() }
        closing = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    private static let timing = CAMediaTimingFunction(
        controlPoints: Float(YumiMotion.easing.0), Float(YumiMotion.easing.1), Float(YumiMotion.easing.2), Float(YumiMotion.easing.3)
    )

    /// Animated changes run in the caller's transaction, with its duration and timing.
    private func setFrame(_ frame: CGRect, animated: Bool) {
        if !animated { CATransaction.begin(); CATransaction.setDisableActions(true) }
        pill.frame = frame
        pill.cornerRadius = min(frame.height, frame.width) / 2
        if !animated { CATransaction.commit() }
    }

    private func close() {
        closing = nil
        CATransaction.begin()
        CATransaction.setAnimationDuration(Self.closeDuration)
        CATransaction.setAnimationTimingFunction(Self.timing)
        CATransaction.setCompletionBlock { [weak self] in
            // Over a notch the closed pill is the notch itself, so it hides once it is back.
            guard let self, self.closing == nil else { return }
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            self.pill.opacity = 0
            CATransaction.commit()
            self.setFrame(self.restFrame, animated: false)
        }
        if CursorMotion.reduceMotion || !hasNotch { pill.opacity = 0 }
        if !CursorMotion.reduceMotion { setFrame(restFrame, animated: true) }
        CATransaction.commit()
    }

    func remove() {
        closing?.cancel()
        pill.removeFromSuperlayer()
    }
}
