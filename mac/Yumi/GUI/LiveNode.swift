import ApplicationServices
import CoreGraphics

/// A real accessibility element (OBJ-39.1). Every call is a message to the other app, so `info()`
/// reads all the attributes the tree reader needs in one request.
struct LiveNode: TreeNode {
    let element: AXUIElement

    private static let infoAttributes = [
        kAXRoleAttribute, kAXSubroleAttribute, kAXTitleAttribute, kAXDescriptionAttribute,
        kAXPlaceholderValueAttribute, kAXHelpAttribute, kAXEnabledAttribute, kAXSelectedAttribute,
        kAXPositionAttribute, kAXSizeAttribute,
    ] as CFArray

    func info() -> NodeInfo {
        var values: CFArray?
        guard AXUIElementCopyMultipleAttributeValues(element, Self.infoAttributes, [], &values) == .success,
              let array = values as? [AnyObject], array.count == 10
        else {
            return NodeInfo(role: "")
        }
        var info = NodeInfo(role: array[0] as? String ?? "")
        info.subrole = array[1] as? String
        info.title = array[2] as? String
        info.description = array[3] as? String
        info.placeholder = array[4] as? String
        info.help = array[5] as? String
        info.enabled = (array[6] as? Bool) ?? true
        info.selected = (array[7] as? Bool) ?? false
        if let position = Self.point(array[8]), let size = Self.size(array[9]) {
            info.frame = CGRect(origin: position, size: size)
        }
        return info
    }

    func children() -> [LiveNode] {
        // A table or outline in Mail can hold thousands of rows; only the visible ones matter.
        let role = string(kAXRoleAttribute)
        if role == kAXTableRole || role == kAXOutlineRole, let rows = elements(kAXVisibleRowsAttribute), !rows.isEmpty {
            return rows.map(LiveNode.init)
        }
        return (elements(kAXChildrenAttribute) ?? []).map(LiveNode.init)
    }

    func value() -> NodeValue? {
        // The last line of defense: a secure text field's value is never requested.
        let info = info()
        guard !info.isSecure else { return nil }
        guard let raw = copy(kAXValueAttribute) else { return nil }
        if let text = raw as? String { return .text(text) }
        if let number = raw as? NSNumber { return .number(number.doubleValue) }
        return nil
    }

    // MARK: Attribute helpers

    func copy(_ attribute: String) -> AnyObject? {
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return nil }
        return value
    }

    func string(_ attribute: String) -> String? {
        copy(attribute) as? String
    }

    func element(_ attribute: String) -> AXUIElement? {
        guard let value = copy(attribute), CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    func elements(_ attribute: String) -> [AXUIElement]? {
        copy(attribute) as? [AXUIElement]
    }

    func bool(_ attribute: String) -> Bool {
        (copy(attribute) as? Bool) ?? false
    }

    var frame: CGRect? { info().frame }

    func isSame(as other: AXUIElement) -> Bool {
        CFEqual(element, other)
    }

    private static func point(_ value: AnyObject) -> CGPoint? {
        guard CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var point = CGPoint.zero
        return AXValueGetValue(value as! AXValue, .cgPoint, &point) ? point : nil
    }

    private static func size(_ value: AnyObject) -> CGSize? {
        guard CFGetTypeID(value) == AXValueGetTypeID() else { return nil }
        var size = CGSize.zero
        return AXValueGetValue(value as! AXValue, .cgSize, &size) ? size : nil
    }
}
