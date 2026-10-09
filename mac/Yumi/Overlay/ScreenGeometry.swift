import AppKit

/// Converts between the protocol's global screen coordinates and AppKit's.
///
/// The protocol's `ScreenPoint` is in points with the origin at the top-left of the main display
/// and y growing down (the Quartz and Accessibility convention: "negative on displays left of or
/// above the main one"). AppKit puts the origin at the bottom-left of the main display with y up.
enum ScreenGeometry {
    /// The display with the menu bar, whose frame defines both coordinate systems' origin.
    static var mainDisplayHeight: CGFloat {
        NSScreen.screens.first?.frame.height ?? 0
    }

    static func appKitPoint(fromGlobalTopLeft point: CGPoint) -> CGPoint {
        CGPoint(x: point.x, y: mainDisplayHeight - point.y)
    }

    static func globalTopLeftPoint(fromAppKit point: CGPoint) -> CGPoint {
        CGPoint(x: point.x, y: mainDisplayHeight - point.y)
    }

    /// A rectangle from Quartz window bounds (top-left origin) in AppKit coordinates.
    static func appKitRect(fromGlobalTopLeft rect: CGRect) -> CGRect {
        CGRect(x: rect.minX, y: mainDisplayHeight - rect.maxY, width: rect.width, height: rect.height)
    }
}
