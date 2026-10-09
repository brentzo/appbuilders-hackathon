import AppKit
import QuartzCore

/// How cursors travel (SPEC-04 r2, r17): a short arc like a cat's leap, eased in and out, taking
/// longer for longer trips. Pure functions, so the timing can be checked without a screen.
enum CursorMotion {
    /// cubic-bezier(0.65, 0, 0.35, 1): a slow start, a quick middle, and a soft landing.
    static let easing = (x1: 0.65, y1: 0.0, x2: 0.35, y2: 1.0)
    static let shortestMove: CFTimeInterval = 0.35
    static let longestMove: CFTimeInterval = 0.7
    /// Keyframes per second for a move. Enough that the eased spacing reads as smooth motion.
    static let samplesPerSecond = 60.0

    /// 350 ms for short hops, growing by half a millisecond per point, up to 700 ms.
    static func duration(for distance: CGFloat) -> CFTimeInterval {
        min(max(shortestMove + Double(distance) * 0.0005, shortestMove), longestMove)
    }

    /// The share of the way travelled at `time` (both 0 to 1), on `easing`.
    static func eased(_ time: Double) -> Double {
        let t = min(max(time, 0), 1)
        // Find the curve parameter whose x is `t` (x grows monotonically), then return its y.
        var low = 0.0, high = 1.0
        for _ in 0..<40 {
            let mid = (low + high) / 2
            if bezier(mid, easing.x1, easing.x2) < t { low = mid } else { high = mid }
        }
        return bezier((low + high) / 2, easing.y1, easing.y2)
    }

    private static func bezier(_ s: Double, _ p1: Double, _ p2: Double) -> Double {
        let u = 1 - s
        return 3 * u * u * s * p1 + 3 * u * s * s * p2 + s * s * s
    }

    /// A cubic Bezier from `start` to `end`. Its control points sit a third and two thirds of the
    /// way along, pushed sideways (upward on screen where it can) by a fifth of the distance, at
    /// most 90 points, so the path arcs a little. Without `arcs`, a straight line.
    static func path(from start: CGPoint, to end: CGPoint, arcs: Bool = true) -> CGPath {
        let path = CGMutablePath()
        path.move(to: start)
        guard arcs, let (c1, c2) = controlPoints(from: start, to: end) else {
            path.addLine(to: end)
            return path
        }
        path.addCurve(to: end, control1: c1, control2: c2)
        return path
    }

    private static func controlPoints(from start: CGPoint, to end: CGPoint) -> (CGPoint, CGPoint)? {
        let dx = end.x - start.x, dy = end.y - start.y
        let distance = hypot(dx, dy)
        guard distance > 1 else { return nil }
        // The unit normal, turned to point up (AppKit y grows upward).
        var nx = -dy / distance, ny = dx / distance
        if ny < 0 || (ny == 0 && nx < 0) { nx = -nx; ny = -ny }
        let lift = min(distance * 0.2, 90)
        return (
            CGPoint(x: start.x + dx / 3 + nx * lift, y: start.y + dy / 3 + ny * lift),
            CGPoint(x: start.x + dx * 2 / 3 + nx * lift, y: start.y + dy * 2 / 3 + ny * lift)
        )
    }

    /// Positions at even time steps for a move: each is `eased(time)` of the way along the path,
    /// measured by length, so the cat starts slowly, speeds up, and lands softly on any curve.
    /// The first is `start` and the last is exactly `end`.
    static func positions(from start: CGPoint, to end: CGPoint, arcs: Bool, duration: CFTimeInterval) -> [CGPoint] {
        let steps = max(12, Int((duration * samplesPerSecond).rounded()))
        let (c1, c2) = (arcs ? controlPoints(from: start, to: end) : nil) ?? (start, end)
        func point(_ s: CGFloat) -> CGPoint {
            let u = 1 - s
            let a = u * u * u, b = 3 * u * u * s, c = 3 * u * s * s, d = s * s * s
            return CGPoint(
                x: a * start.x + b * c1.x + c * c2.x + d * end.x,
                y: a * start.y + b * c1.y + c * c2.y + d * end.y
            )
        }
        // A table of the path's length at fine parameter steps, to walk it by distance.
        let fine = 200
        var lengths: [CGFloat] = [0]
        var previous = start
        for i in 1...fine {
            let next = point(CGFloat(i) / CGFloat(fine))
            lengths.append(lengths[i - 1] + hypot(next.x - previous.x, next.y - previous.y))
            previous = next
        }
        let total = lengths[fine]
        return (0...steps).map { step in
            if step == steps { return end }
            let target = CGFloat(eased(Double(step) / Double(steps))) * total
            guard total > 0, let i = lengths.firstIndex(where: { $0 >= target }), i > 0 else { return start }
            let span = lengths[i] - lengths[i - 1]
            let s = (CGFloat(i - 1) + (span > 0 ? (target - lengths[i - 1]) / span : 0)) / CGFloat(fine)
            return point(s)
        }
    }

    /// A move as a Core Animation keyframe animation on `position`. The easing lives in the
    /// sampled positions, with even key times and linear steps between them, so it does not
    /// depend on how Core Animation combines a timing function with paced keyframes.
    static func animation(from start: CGPoint, to end: CGPoint, arcs: Bool, duration: CFTimeInterval) -> CAKeyframeAnimation {
        let points = positions(from: start, to: end, arcs: arcs, duration: duration)
        let animation = CAKeyframeAnimation(keyPath: "position")
        animation.values = points.map { NSValue(point: $0) }
        animation.keyTimes = (0..<points.count).map { NSNumber(value: Double($0) / Double(points.count - 1)) }
        animation.calculationMode = .linear
        animation.duration = duration
        return animation
    }

    static var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }
}
