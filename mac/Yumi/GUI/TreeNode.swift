import CoreGraphics

/// One accessibility element as the tree reader sees it. The live implementation wraps an
/// `AXUIElement` (`LiveNode`); tests use recorded fixtures.
///
/// `value()` is the only way to read an element's contents. The tree reader never calls it on a
/// secure text field (SPEC-05 r7).
@MainActor
protocol TreeNode {
    /// Role, subrole, labels, state and frame, read in one go.
    func info() -> NodeInfo
    func children() -> [Self]
    func value() -> NodeValue?
}

struct NodeInfo: Equatable, Sendable {
    /// The macOS role, for example `AXButton`.
    var role: String
    var subrole: String?
    var title: String?
    var description: String?
    var placeholder: String?
    var help: String?
    var enabled: Bool = true
    var selected: Bool = false
    /// Top-left global coordinates, the accessibility convention. Nil when the element has none.
    var frame: CGRect?

    var isSecure: Bool {
        role == "AXSecureTextField" || subrole == "AXSecureTextField"
    }
}

enum NodeValue: Equatable, Sendable {
    case text(String)
    case number(Double)
}
