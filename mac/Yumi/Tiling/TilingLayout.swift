import CoreGraphics

/// Where each task window goes when Yumi tiles them (OBJ-20.4).
///
/// A grid on one display's visible area (without the menu bar and Dock): 2 windows side by side,
/// 3 and 4 in two rows. A last row with fewer windows stretches them, so no cell is left empty and
/// every window is fully visible. Frames are in global top-left coordinates, like window frames.
enum TilingLayout {
    /// Space between windows and around the edges.
    static let gap: CGFloat = 8

    static func frames(count: Int, in area: CGRect) -> [CGRect] {
        guard count > 0 else { return [] }
        let columns = Int(Double(count).squareRoot().rounded(.up))
        let rows = Int((Double(count) / Double(columns)).rounded(.up))
        let height = (area.height - gap * CGFloat(rows + 1)) / CGFloat(rows)
        var frames: [CGRect] = []
        for row in 0..<rows {
            let inRow = min(columns, count - row * columns)
            let width = (area.width - gap * CGFloat(inRow + 1)) / CGFloat(inRow)
            for column in 0..<inRow {
                frames.append(CGRect(
                    x: (area.minX + gap + CGFloat(column) * (width + gap)).rounded(),
                    y: (area.minY + gap + CGFloat(row) * (height + gap)).rounded(),
                    width: width.rounded(.down),
                    height: height.rounded(.down)
                ))
            }
        }
        return frames
    }
}
