import CoreGraphics
import YumiProtocol

/// One element kept in the trimmed tree, with what the Mac side needs to act on it later.
struct KeptElement<Node> {
    var role: AXRole
    var label: String
    var value: String?
    var enabled: Bool
    /// The element's accessibility path (`ElementPath`). Stays on the Mac side.
    var path: String
    var frame: CGRect?
    var node: Node
}

/// Walks an accessibility tree and keeps only what the model may act on (SPEC-05 r2, OBJ-39.1):
/// visible elements with an actionable role, plus the containers that scroll. Layout groups are
/// walked through but never listed, so empty ones disappear. Stops at `limit` elements.
@MainActor
struct TreeTrimmer<Node: TreeNode> {
    static var defaultLimit: Int { 200 }
    /// Guards against huge or cyclic trees: a Keynote window has about 1,500 elements.
    static var maxVisited: Int { 8000 }
    static var maxDepth: Int { 60 }
    static var maxLabelLength: Int { 120 }
    static var maxValueLength: Int { 300 }

    var limit = TreeTrimmer.defaultLimit
    private(set) var kept: [KeptElement<Node>] = []
    private(set) var visited = 0

    init(limit: Int = TreeTrimmer.defaultLimit) {
        self.limit = limit
    }

    var isFull: Bool { kept.count >= limit }

    /// Walks `node` and its descendants. `clip` is the visible area: the window, narrowed by every
    /// scroll area on the way down. Nil means no clipping, as for an open menu.
    mutating func walk(_ node: Node, path: String, clip: CGRect?, depth: Int = 0) {
        guard !isFull, visited < Self.maxVisited, depth <= Self.maxDepth else { return }
        visited += 1
        let info = node.info()
        if let frame = info.frame, !Self.isVisible(frame, in: clip) {
            return
        }
        let role = Self.role(of: info)
        if let role {
            let label = Self.label(of: info, node: node, role: role)
            if role == .menuItem, label.isEmpty {
                return // a separator
            }
            kept.append(KeptElement(
                role: role,
                label: label,
                // Never read for a secure text field, not even to drop it afterwards.
                value: role == .secureTextField ? nil : Self.value(of: node, role: role),
                enabled: info.enabled,
                path: path,
                frame: info.frame,
                node: node
            ))
        }
        guard Self.walksChildren(of: role) else { return }
        var childClip = clip
        if role == .scrollArea, let frame = info.frame {
            childClip = clip.map { $0.intersection(frame) } ?? frame
        }
        var counts: [String: Int] = [:]
        for child in node.children() {
            guard !isFull else { return }
            let childRole = child.info().role
            let index = counts[childRole, default: 0]
            counts[childRole] = index + 1
            walk(child, path: ElementPath.appending(childRole, index: index, to: path), clip: childClip, depth: depth + 1)
        }
    }

    // MARK: Rules

    /// AXRole from kAXRoleAttribute and kAXSubroleAttribute (protocol action.json, AXRole).
    static func role(of info: NodeInfo) -> AXRole? {
        if info.isSecure { return .secureTextField }
        switch info.role {
        case "AXButton": return .button
        case "AXMenuItem": return .menuItem
        case "AXMenuBarItem": return .menuBarItem
        case "AXTextField", "AXSearchField": return .textField
        case "AXTextArea": return .textArea
        case "AXLink": return .link
        case "AXCheckBox": return .checkbox
        case "AXRadioButton": return .radioButton
        case "AXPopUpButton": return .popUpButton
        case "AXComboBox": return .comboBox
        case "AXMenuButton": return .menuButton
        case "AXDisclosureTriangle": return .disclosureTriangle
        case "AXRow": return .row
        case "AXCell": return .cell
        case "AXScrollArea": return .scrollArea
        case "AXTable": return .table
        case "AXList": return .list
        case "AXOutline": return .outline
        default: return nil
        }
    }

    /// Only containers are walked into. A row is listed once, labelled with its text, instead of
    /// listing every cell in it. Menus are read by `WindowReader` only when they are open.
    static func walksChildren(of role: AXRole?) -> Bool {
        switch role {
        case nil, .scrollArea, .table, .list, .outline, .cell: true
        default: false
        }
    }

    static func isVisible(_ frame: CGRect, in clip: CGRect?) -> Bool {
        guard frame.width > 0, frame.height > 0 else { return false }
        guard let clip else { return true }
        return frame.intersects(clip)
    }

    static func label(of info: NodeInfo, node: Node, role: AXRole) -> String {
        let own = [info.title, info.description, info.placeholder, info.help]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first { !$0.isEmpty }
        if let own { return clip(own, to: maxLabelLength) }
        if let name = info.subrole.flatMap({ windowButtonNames[$0] }) { return name }
        switch role {
        case .row, .cell, .button, .link, .radioButton, .checkbox, .menuButton, .popUpButton:
            var texts: [String] = []
            collectText(in: node, into: &texts, depth: 0)
            return clip(texts.joined(separator: " "), to: maxLabelLength)
        default:
            return ""
        }
    }

    /// The title bar buttons have no title or description, only a subrole.
    static var windowButtonNames: [String: String] {
        ["AXCloseButton": "close", "AXMinimizeButton": "minimize", "AXZoomButton": "zoom", "AXFullScreenButton": "full screen"]
    }

    /// The visible text inside a row, cell or unlabelled button, from its static text children.
    private static func collectText(in node: Node, into texts: inout [String], depth: Int) {
        guard depth < 4, texts.joined().count < maxLabelLength else { return }
        for child in node.children() {
            let info = child.info()
            if info.isSecure { continue }
            if info.role == "AXStaticText", case .text(let text)? = child.value() {
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty { texts.append(trimmed) }
            } else if let title = info.title ?? info.description, !title.isEmpty, info.role != "AXImage" {
                texts.append(title)
            } else {
                collectText(in: child, into: &texts, depth: depth + 1)
            }
        }
    }

    static func value(of node: Node, role: AXRole) -> String? {
        switch role {
        case .textField, .textArea, .comboBox, .popUpButton, .menuButton:
            guard case .text(let text)? = node.value(), !text.isEmpty else { return nil }
            return clip(text, to: maxValueLength)
        case .checkbox, .radioButton, .disclosureTriangle:
            guard case .number(let number)? = node.value() else { return nil }
            return number == 0 ? "off" : "on"
        default:
            return nil
        }
    }

    static func clip(_ text: String, to length: Int) -> String {
        let flat = text.replacingOccurrences(of: "\n", with: " ")
        return flat.count <= length ? flat : String(flat.prefix(length - 1)) + "…"
    }
}
