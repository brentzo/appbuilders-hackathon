import CoreGraphics
import Foundation

/// The menu of an open pop-up button, combo box, or menu button, such as "Where:" in a save panel
/// (2026-10-10: Keynote's export went to Documents because the opened menu was never in the tree).
///
/// That menu is not in the window's own layout. A closed pop-up has no children; once open it has
/// an `AXMenu` child whose items are on screen. Some apps put the open menu under the application
/// instead, like a context menu. `TreeTrimmer` notes an open one under a pop-up as it walks, and
/// `appMenu` finds one under the application; `WindowReader` then reads it as the `menu` layer, so
/// the next step can click an item. Generic over `TreeNode`, so tests can use a fake tree.
@MainActor
enum PopUpMenus {
    /// Elements whose menu opens on a click.
    static let ownerRoles: Set<String> = ["AXPopUpButton", "AXComboBox", "AXMenuButton"]
    /// The root of a path to a menu that hangs off the application rather than a window.
    static let appRoot = ElementPath.appRoot

    struct Found<Node> {
        /// The pop-up, combo box, or menu button. Nil for a menu under the application.
        let owner: Node?
        let menu: Node
        /// The menu's path (`ElementPath`), for its items' paths.
        let path: String
    }

    /// The open menu of a pop-up button, combo box, or menu button at `path`, if it is open.
    static func openMenu<Node: TreeNode>(of owner: Node, path: String) -> Found<Node>? {
        guard ownerRoles.contains(owner.info().role) else { return nil }
        let menus = owner.children().filter { $0.info().role == "AXMenu" }
        guard let index = menus.firstIndex(where: isOpen) else { return nil }
        return Found(owner: owner, menu: menus[index], path: ElementPath.appending("AXMenu", index: index, to: path))
    }

    /// A menu open directly under the application, such as a pop-up menu some apps show that way.
    static func appMenu<Node: TreeNode>(of app: Node) -> Found<Node>? {
        let menus = app.children().filter { $0.info().role == "AXMenu" }
        guard let index = menus.firstIndex(where: isOpen) else { return nil }
        return Found(owner: nil, menu: menus[index], path: ElementPath.appending("AXMenu", index: index, to: appRoot))
    }

    /// A menu is open when at least one of its items is on screen.
    static func isOpen<Node: TreeNode>(_ menu: Node) -> Bool {
        menu.children().contains { child in
            let info = child.info()
            guard info.role == "AXMenuItem", let frame = info.frame else { return false }
            return frame.width > 0 && frame.height > 0
        }
    }

    // MARK: Choosing an item by title

    /// The item of a pop-up's menu whose title matches `title`, ignoring case, spaces at the ends,
    /// and a trailing ellipsis ("Other…" matches "other"). An exact match wins over a prefix.
    static func item<Node: TreeNode>(titled title: String, in menu: Node) -> Node? {
        let wanted = normalized(title)
        guard !wanted.isEmpty else { return nil }
        let items = menu.children().filter { $0.info().role == "AXMenuItem" && $0.info().enabled }
        let titled = items.map { (node: $0, title: normalized($0.info().title ?? "")) }.filter { !$0.title.isEmpty }
        return titled.first { $0.title == wanted }?.node ?? titled.first { $0.title.hasPrefix(wanted) }?.node
    }

    /// What the model reads when no item matched: the items there are, so its next try can pick one.
    static func notFound<Node: TreeNode>(_ title: String, in menu: Node, owner: String) -> String {
        let titles = menu.children().filter { $0.info().role == "AXMenuItem" && $0.info().enabled }
            .compactMap { $0.info().title?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        let shown = titles.prefix(12).map { "\"\($0)\"" }.joined(separator: ", ")
        let more = titles.count > 12 ? ", and \(titles.count - 12) more" : ""
        let quoted = TreeTrimmer<Node>.clip(title, to: 80)
        return titles.isEmpty
            ? "There is no item \"\(quoted)\" in \(owner); its menu has no items to choose."
            : "There is no item \"\(quoted)\" in \(owner). Its items are \(shown)\(more)."
    }

    static func normalized(_ title: String) -> String {
        var text = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        for suffix in ["…", "..."] where text.hasSuffix(suffix) {
            text = String(text.dropLast(suffix.count)).trimmingCharacters(in: .whitespaces)
        }
        return text
    }
}
