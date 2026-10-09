/// The Mac-side address of an element: its roles and their positions from a root, for example
/// `AXWindow/AXSheet[0]/AXGroup[1]/AXButton[2]` or
/// `AXMenuBar/AXMenuBarItem[3]/AXMenu[0]/AXMenuItem[5]`. Each step counts only siblings with the
/// same role, so an element added elsewhere in its group does not change the path.
///
/// Built by the tree reader, returned as `ResolvedElement.path`, and read back by
/// `readFieldValues` and cursor moves to an element (OBJ-44.1).
enum ElementPath {
    static let windowRoot = "AXWindow"
    static let menuBarRoot = "AXMenuBar"

    static func appending(_ role: String, index: Int, to path: String) -> String {
        "\(path)/\(role)[\(index)]"
    }

    struct Step: Equatable {
        let role: String
        let index: Int
    }

    /// The root and the steps under it, or nil when the path is not one this app built.
    static func parse(_ path: String) -> (root: String, steps: [Step])? {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard let root = parts.first, root == windowRoot || root == menuBarRoot else { return nil }
        var steps: [Step] = []
        for part in parts.dropFirst() {
            guard part.hasSuffix("]"), let open = part.lastIndex(of: "[") else { return nil }
            let role = String(part[..<open])
            guard !role.isEmpty, let index = Int(part[part.index(after: open)..<part.index(before: part.endIndex)]), index >= 0 else {
                return nil
            }
            steps.append(Step(role: role, index: index))
        }
        return (root, steps)
    }

    /// Follows `steps` down from `root`.
    @MainActor
    static func resolve<Node: TreeNode>(_ steps: [Step], from root: Node) -> Node? {
        var node = root
        for step in steps {
            let matches = node.children().filter { $0.info().role == step.role }
            guard step.index < matches.count else { return nil }
            node = matches[step.index]
        }
        return node
    }
}
