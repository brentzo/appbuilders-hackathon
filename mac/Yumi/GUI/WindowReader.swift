import AppKit
import ApplicationServices
import OSLog
import YumiProtocol

/// One look at a target window: the observation for the harness, and what the Mac side keeps to
/// act on an element by its number later (OBJ-39.1, OBJ-39.2).
@MainActor
struct WindowSnapshot {
    var observation: YumiProtocol.Observation
    /// Element `n` is at index `n - 1`.
    let elements: [KeptElement<LiveNode>]
    let app: NSRunningApplication
    /// The window's `CGWindowID`, so a screenshot can be taken of this exact window.
    let windowId: Int?
    /// The window's content has no actionable element (only its chrome and menu bar), so the model
    /// needs a screenshot and a vision click (SPEC-05 r1.3, r12).
    let needsVision: Bool
    /// Set once a screenshot was captured: what the vision coordinates are measured against.
    var screenshot: ScreenshotGeometry?

    func element(_ number: Int) -> KeptElement<LiveNode>? {
        elements.indices.contains(number - 1) ? elements[number - 1] : nil
    }
}

/// What a captured screenshot needs for coordinate conversion: the image the model saw, and the
/// window frame in global top-left points at the moment it was taken.
struct ScreenshotGeometry {
    let imageWidth: Int
    let imageHeight: Int
    let windowFrame: CGRect
    let path: String
}

/// Why a GUI method could not run. `userError` is what the harness and the user get (SPEC-11).
enum GuiFailure: Error, Equatable {
    case accessibilityMissing
    case screenPermissionMissing
    case appNotRunning
    case windowNotFound
    /// `setValue` or typing into a password field (SPEC-05 r7).
    case secureField
    /// `type` or `key` from a cursor that is not the main one (SPEC-03 r7).
    case notMainLane

    var userError: UserError {
        switch self {
        case .accessibilityMissing: UserError(kind: .accessibilityPermissionMissing)
        case .screenPermissionMissing: UserError(kind: .screenPermissionMissing)
        case .appNotRunning, .windowNotFound: UserError(kind: .stuckOnScreen)
        case .secureField, .notMainLane: UserError(kind: .blockedAction)
        }
    }

    /// A missing permission the user can grant, which the app shows with an "Open settings" button.
    var isPermission: Bool {
        switch self {
        case .accessibilityMissing, .screenPermissionMissing: true
        default: false
        }
    }
}

/// Finds the target app and window and reads its trimmed tree (OBJ-39.1).
///
/// What is read depends on what is in front (SPEC-05 r15):
/// - An open menu: only its items, then the items of any open submenu, so "Export To" then
///   "PDF…" in Keynote works. A menu bar item whose menu is open reports `AXSelected`, and so
///   does a menu item whose submenu is open.
/// - An open pop-up button, combo box, or menu button menu, such as "Where:" in a save panel: only
///   its items, so the next step can click one (`PopUpMenus`).
/// - A sheet: only the sheet.
/// - Otherwise the window (a dialog when its subrole says so), then the app's menu bar items,
///   so the model can open a menu.
@MainActor
enum WindowReader {
    private static let log = Logger(subsystem: "ph.appbuilders.yumi", category: "gui")

    static func requireAccessibility() throws {
        guard AXIsProcessTrusted() else { throw GuiFailure.accessibilityMissing }
        // Another app's slow answer must not freeze Yumi for the default 6 seconds.
        AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), 1.5)
    }

    static func runningApp(_ bundleId: String) throws -> NSRunningApplication {
        guard let app = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first else {
            throw GuiFailure.appNotRunning
        }
        return app
    }

    static func appNode(_ app: NSRunningApplication) -> LiveNode {
        LiveNode(element: AXUIElementCreateApplication(app.processIdentifier))
    }

    /// The window with that CGWindowID, or the app's focused window.
    static func window(of app: LiveNode, windowId: Int?) -> LiveNode? {
        let windows = (app.elements(kAXWindowsAttribute) ?? []).map(LiveNode.init)
        if let windowId {
            return window(windowId, among: windows) { WindowService.windowId(of: $0.element) }
        }
        let focused = app.element(kAXFocusedWindowAttribute) ?? app.element(kAXMainWindowAttribute)
        return focused.map(LiveNode.init) ?? windows.first
    }

    /// Matched by the window server's id, the one the router claimed (`WindowService`), never by
    /// frame: a window that was just opened or is moving has no settled frame to compare.
    static func window<Node>(_ windowId: Int, among windows: [Node], idOf: (Node) -> CGWindowID?) -> Node? {
        windows.first { idOf($0).map(Int.init) == windowId }
    }

    static func observe(_ target: Target, limit: Int = TreeTrimmer<LiveNode>.defaultLimit) throws -> WindowSnapshot {
        try requireAccessibility()
        let app = try runningApp(target.bundleId)
        let appNode = appNode(app)
        guard let window = window(of: appNode, windowId: target.windowId) else { throw GuiFailure.windowNotFound }
        let windowInfo = window.info()

        var elements: [KeptElement<LiveNode>] = []
        var layer = Layer(kind: .window)
        var layerNode = window
        var popUp: PopUpMenus.Found<LiveNode>?

        if let menu = openMenu(of: appNode) {
            layer = Layer(kind: .menu, title: menu.title)
            var trimmer = TreeTrimmer<LiveNode>(limit: limit)
            for (node, path) in menu.menus {
                walkItems(of: node, path: path, into: &trimmer)
            }
            elements = trimmer.kept
        } else if let (sheet, path) = sheet(of: window) {
            layer = Layer(kind: .sheet, title: nonEmpty(sheet.info().title))
            layerNode = sheet
            var trimmer = TreeTrimmer<LiveNode>(limit: limit)
            trimmer.walk(sheet, path: path, clip: sheet.frame)
            elements = trimmer.kept
            popUp = trimmer.openMenu
        } else {
            let isDialog = windowInfo.subrole == kAXDialogSubrole || windowInfo.subrole == kAXSystemDialogSubrole
            layer = Layer(kind: isDialog ? .dialog : .window, title: isDialog ? nonEmpty(windowInfo.title) : nil)
            var bar = TreeTrimmer<LiveNode>(limit: limit)
            if !isDialog, let menuBar = appNode.element(kAXMenuBarAttribute) {
                walkItems(of: LiveNode(element: menuBar), path: ElementPath.menuBarRoot, into: &bar)
            }
            var trimmer = TreeTrimmer<LiveNode>(limit: max(0, limit - bar.kept.count))
            trimmer.walk(window, path: ElementPath.windowRoot, clip: windowInfo.frame)
            elements = trimmer.kept + bar.kept
            popUp = trimmer.openMenu
        }
        // A pop-up's open menu covers what is under it, like any menu: read only its items.
        if layer.kind != .menu, let open = popUp ?? PopUpMenus.appMenu(of: appNode) {
            let owner = open.owner.map { node in
                TreeTrimmer<LiveNode>.label(of: node.info(), node: node, role: TreeTrimmer<LiveNode>.role(of: node.info()) ?? .popUpButton)
            }
            layer = Layer(kind: .menu, title: owner.flatMap(nonEmpty))
            var items = TreeTrimmer<LiveNode>(limit: limit)
            walkItems(of: open.menu, path: open.path, into: &items)
            elements = items.kept
        }

        let needsVision = layer.kind != .menu && !elements.contains(where: isContentActionable)
        // A window whose content is not in the tree offers nothing worth pressing: the model gets the
        // screenshot and a vision click only. Keeping the chrome and menu bar would give it useless
        // numbers to press, and it pressed Close and Minimize (Brent's run, 2026-10-10). With no
        // elements, the harness also drops click, setValue, and scroll from the schema, so clickAt is
        // the only way to act in the window.
        let shown = needsVision ? [] : elements
        let focused = shown.isEmpty ? nil : appNode.element(kAXFocusedUIElementAttribute).flatMap { number(of: $0, in: shown) }
        if layer.kind != .menu, !shown.isEmpty {
            layer.defaultButton = layerNode.element(kAXDefaultButtonAttribute).flatMap { number(of: $0, in: shown) }
            layer.cancelButton = layerNode.element(kAXCancelButtonAttribute).flatMap { number(of: $0, in: shown) }
        }
        let frame = windowInfo.frame
        let observation = YumiProtocol.Observation(
            app: nonEmpty(app.localizedName),
            windowTitle: windowInfo.title ?? "",
            focused: focused,
            layer: layer,
            elements: shown.enumerated().map { index, kept in
                TreeElement(n: index + 1, role: kept.role, label: kept.label, value: kept.value, enabled: kept.enabled)
            },
            screenshotPath: nil,
            windowFrame: frame.map { Frame(x: Double($0.minX), y: Double($0.minY), width: Double($0.width), height: Double($0.height)) }
        )
        // Counts only: labels and values are screen data and stay out of the log.
        log.info("Observed \(target.bundleId, privacy: .public): \(shown.count) elements, layer \(layer.kind.rawValue, privacy: .public)\(needsVision ? ", no content, needs vision" : "", privacy: .public)")
        return WindowSnapshot(
            observation: observation,
            elements: shown,
            app: app,
            windowId: target.windowId ?? WindowService.windowId(of: window.element).map(Int.init),
            needsVision: needsVision,
            screenshot: nil
        )
    }

    /// Whether an element is real content the model can act on: not a menu bar item and not the
    /// window's own close, minimize, or zoom button. A window whose only kept elements are those has
    /// no content in its accessibility tree, so the model must see a screenshot (Spotify, 2026-10-10).
    static func isContentActionable(_ kept: KeptElement<LiveNode>) -> Bool {
        isContentActionable(role: kept.role, subrole: kept.subrole)
    }

    /// Whether a role and subrole are real content the model can act on: not a menu bar item and not
    /// the window's own close, minimize, or zoom button. A window whose only kept elements are those
    /// has no content in its accessibility tree, so the model must see a screenshot (Spotify, 2026-10-10).
    static func isContentActionable(role: AXRole, subrole: String?) -> Bool {
        if let subrole, AppCapabilityProbe.windowChromeSubroles.contains(subrole) { return false }
        switch role {
        case .menuBarItem, .menuItem: return false
        default: return true
        }
    }

    /// Resolves a path built by the tree reader, against the target's window, its menu bar, or the
    /// app itself (a menu that hangs off the app).
    static func resolve(_ path: String, in target: Target) throws -> LiveNode? {
        try requireAccessibility()
        let app = appNode(try runningApp(target.bundleId))
        guard let (root, steps) = ElementPath.parse(path) else { return nil }
        let rootNode: LiveNode?
        if root == ElementPath.menuBarRoot {
            rootNode = app.element(kAXMenuBarAttribute).map(LiveNode.init)
        } else if root == ElementPath.appRoot {
            rootNode = app
        } else {
            rootNode = window(of: app, windowId: target.windowId)
        }
        return rootNode.flatMap { ElementPath.resolve(steps, from: $0) }
    }

    // MARK: Layers

    private struct OpenMenu {
        let title: String?
        /// The open menu, then each open submenu, with their paths.
        let menus: [(LiveNode, String)]
    }

    private static func openMenu(of app: LiveNode) -> OpenMenu? {
        guard let menuBar = app.element(kAXMenuBarAttribute) else { return nil }
        let items = LiveNode(element: menuBar).children().filter { $0.info().role == kAXMenuBarItemRole }
        guard let index = items.firstIndex(where: { $0.bool(kAXSelectedAttribute) }) else { return nil }
        let barItem = items[index]
        var path = ElementPath.appending(kAXMenuBarItemRole, index: index, to: ElementPath.menuBarRoot)
        var menus: [(LiveNode, String)] = []
        var current = barItem
        // Follow the chain of open submenus, a few levels at most.
        for _ in 0..<4 {
            guard let menu = current.children().first(where: { $0.info().role == kAXMenuRole }) else { break }
            path = ElementPath.appending(kAXMenuRole, index: 0, to: path)
            menus.append((menu, path))
            let menuItems = menu.children().filter { $0.info().role == kAXMenuItemRole }
            guard let open = menuItems.firstIndex(where: { $0.bool(kAXSelectedAttribute) && hasOpenSubmenu($0) }) else { break }
            path = ElementPath.appending(kAXMenuItemRole, index: open, to: path)
            current = menuItems[open]
        }
        guard !menus.isEmpty else { return nil }
        return OpenMenu(title: nonEmpty(barItem.info().title), menus: menus)
    }

    private static func hasOpenSubmenu(_ item: LiveNode) -> Bool {
        guard let menu = item.children().first(where: { $0.info().role == kAXMenuRole }) else { return false }
        return menu.children().contains { ($0.frame?.width ?? 0) > 0 }
    }

    private static func sheet(of window: LiveNode) -> (LiveNode, String)? {
        let sheets = window.children().filter { $0.info().role == kAXSheetRole }
        guard let sheet = sheets.first else { return nil }
        return (sheet, ElementPath.appending(kAXSheetRole, index: 0, to: ElementPath.windowRoot))
    }

    /// Walks the menu items (or menu bar items) directly under `node`, keeping their paths.
    static func walkItems<Node: TreeNode>(of node: Node, path: String, into trimmer: inout TreeTrimmer<Node>) {
        var counts: [String: Int] = [:]
        for child in node.children() {
            let role = child.info().role
            let index = counts[role, default: 0]
            counts[role] = index + 1
            guard role == kAXMenuItemRole || role == kAXMenuBarItemRole else { continue }
            trimmer.walk(child, path: ElementPath.appending(role, index: index, to: path), clip: nil)
        }
    }

    private static func number(of element: AXUIElement, in elements: [KeptElement<LiveNode>]) -> Int? {
        elements.firstIndex { $0.node.isSame(as: element) }.map { $0 + 1 }
    }

    private static func nonEmpty(_ text: String?) -> String? {
        guard let text, !text.isEmpty else { return nil }
        return text
    }
}
