import AppKit
import ApplicationServices
import OSLog
import YumiProtocol

/// The Mac side of every GUI step (OBJ-39): `observeWindow`, `executeAction`, and
/// `readFieldValues`, with the protocol's own types.
///
/// Element numbers resolve against the last observation of the same window. Before every
/// element action the cursor moves to the element and the action runs once it has arrived; the
/// real mouse pointer never moves, because elements are pressed through the accessibility API
/// (SPEC-05 r3).
@MainActor
final class GuiExecutor {
    let keystrokes: KeystrokeSender
    /// Shows a failure to the user through the error presenter (OBJ-39.8). Set by the app.
    var onUserError: ((UserError) -> Void)?
    /// False while a goal waits for its confirmation and no task is confirmed (OBJ-17.7), and while
    /// Yumi is stopped (OBJ-35.2): then nothing acts, whatever the harness sends. Set by the app.
    /// Checked when a request arrives and again right before acting, so a pause that lands while
    /// the cursor is still moving wins.
    var actionsAllowed: () -> Bool = { true }
    /// Called when the harness looks at or acts on a window, so the app knows a UI lane has
    /// started acting (take-over, SPEC-06 r2). Set by the app.
    var onWindowWork: (() -> Void)?

    private let overlay: CursorOverlay?
    private let isTrusted: () -> Bool
    private var snapshots: [String: WindowSnapshot] = [:]
    private var lastPermissionPrompt: Date?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "gui")

    init(overlay: CursorOverlay?, keystrokes: KeystrokeSender = KeystrokeSender(), isTrusted: @escaping () -> Bool = { AXIsProcessTrusted() }) {
        self.overlay = overlay
        self.keystrokes = keystrokes
        self.isTrusted = isTrusted
    }

    private func requireAccessibility() throws {
        guard isTrusted() else { throw GuiFailure.accessibilityMissing }
        try WindowReader.requireAccessibility()
    }

    // MARK: observeWindow (OBJ-39.2)

    func observeWindow(_ params: ObserveWindowParams) async throws -> YumiProtocol.Observation {
        onWindowWork?()
        return try await reporting {
            try requireAccessibility()
            var snapshot = try WindowReader.observe(params.target)
            if snapshot.needsVision, let windowId = snapshot.windowId, let frame = snapshot.observation.windowFrame {
                let windowFrame = CGRect(x: frame.x, y: frame.y, width: frame.width, height: frame.height)
                let captured: VisionCapture.Captured
                do {
                    captured = try await VisionCapture.capture(
                        bundleId: params.target.bundleId,
                        windowId: windowId
                    )
                } catch VisionCapture.Failure.screenPermissionMissing {
                    throw GuiFailure.screenPermissionMissing
                } catch {
                    // A window that cannot be captured (gone, minimized, or the capture itself failed)
                    // is reported the way a missing window is, so the harness treats it as stuck on
                    // screen rather than as an unexpected error.
                    throw GuiFailure.windowNotFound
                }
                snapshot.observation.screenshotPath = captured.path
                snapshot.observation.screenshotWidth = captured.image.width
                snapshot.observation.screenshotHeight = captured.image.height
                snapshot.screenshot = ScreenshotGeometry(
                    imageWidth: captured.image.width,
                    imageHeight: captured.image.height,
                    windowFrame: windowFrame,
                    path: captured.path
                )
            }
            snapshots[Self.key(params.target)] = snapshot
            return snapshot.observation
        }
    }

    /// The last look at a window, for the debug window.
    func lastSnapshot(of target: Target) -> WindowSnapshot? {
        snapshots[Self.key(target)]
    }

    // MARK: executeAction (OBJ-39.3 to OBJ-39.6)

    func executeAction(_ params: ExecuteActionParams) async throws -> ExecuteActionResult {
        onWindowWork?()
        return try await reporting {
            guard actionsAllowed() else { return Self.notAllowed }
            // A password field is never filled, whatever else is true (SPEC-05 r7).
            if params.action.element?.role == .secureTextField {
                switch params.action.action {
                case .setValue, .type: throw GuiFailure.secureField
                default: break
                }
            }
            switch params.action.action {
            case .click(let click):
                return try await onElement(click.element, params) { kept in try self.click(kept) }
            case .setValue(let set):
                return try await onElement(set.element, params) { kept in
                    // A pop-up's value is one of its items: choose it by title.
                    if kept.role == .popUpButton || kept.role == .menuButton {
                        return try await self.choose(set.text, in: kept, target: params.target)
                    }
                    return try self.setValue(set.text, on: kept, params: params)
                }
            case .scroll(let scroll):
                return try await onElement(scroll.element, params) { kept in try self.scroll(kept, scroll.direction) }
            case .type(let text):
                return try await type(text.text, params)
            case .key(let key):
                return try await press(key.combo, params)
            case .tool(let tool):
                return await run(tool.call)
            case .clickAt(let point):
                return try await clickAt(point, params)
            case .ask, .finish:
                return Self.result(.invalidOutput, "The harness handles ask and finish, not the Mac app.")
            }
        }
    }

    /// Resolves the number, checks it is still the element the harness resolved, moves the cursor
    /// there, then acts.
    private func onElement(
        _ number: Int, _ params: ExecuteActionParams, perform: (KeptElement<LiveNode>) async throws -> String
    ) async throws -> ExecuteActionResult {
        try requireAccessibility()
        guard let kept = snapshots[Self.key(params.target)]?.element(number) else {
            return Self.result(.error, "Element \(number) is not in the last look at this window.")
        }
        if let expected = params.action.element, expected.role != kept.role {
            return Self.result(.error, "Element \(number) is no longer a \(expected.role.rawValue).")
        }
        guard let frame = kept.node.frame ?? kept.frame else {
            return Self.result(.error, "Element \(number) is no longer on screen.")
        }
        if [.menuBarItem, .menuItem, .popUpButton, .menuButton].contains(kept.role) {
            // A menu only opens in the active app, a pop-up's menu too.
            try await activate(params.target)
        }
        await moveCursor(params.cursorId, toTopLeft: CGPoint(x: frame.midX, y: frame.midY))
        guard actionsAllowed() else { return Self.notAllowed }
        do {
            return Self.result(.ok, try await perform(kept))
        } catch let error as AXFailure {
            return Self.result(.error, Self.describe(error.code, kept))
        } catch let error as PopUpChoiceFailure {
            return Self.result(.error, error.observation)
        }
    }

    /// A vision click (SPEC-05 r12): the model answered with pixel coordinates in the screenshot it
    /// saw, so convert them to a global screen point with the captured image size and window frame,
    /// then move the real mouse there and click. The window must not have moved since the screenshot
    /// (SPEC-05 r13); the harness checks this too, right before it sends the action.
    private func clickAt(_ point: ClickAtAction, _ params: ExecuteActionParams) async throws -> ExecuteActionResult {
        try requireAccessibility()
        guard let snapshot = snapshots[Self.key(params.target)], let shot = snapshot.screenshot else {
            return Self.result(.error, "There is no screenshot of this window to click in.")
        }
        guard point.x <= shot.imageWidth, point.y <= shot.imageHeight, shot.windowFrame.width > 0, shot.windowFrame.height > 0 else {
            return Self.result(.error, "That point is outside the window.")
        }
        let appNode = WindowReader.appNode(try WindowReader.runningApp(params.target.bundleId))
        guard let window = WindowReader.window(of: appNode, windowId: params.target.windowId), let current = window.info().frame else {
            throw GuiFailure.windowNotFound
        }
        guard Self.sameRect(current, shot.windowFrame) else {
            return Self.result(.error, "The window moved before the click, so it was not clicked. Looking again.")
        }
        let global = Self.screenPoint(
            imageX: point.x,
            imageY: point.y,
            imageWidth: shot.imageWidth,
            imageHeight: shot.imageHeight,
            windowFrame: shot.windowFrame
        )
        try await activate(params.target)
        await moveCursor(params.cursorId, toTopLeft: global)
        guard actionsAllowed() else { return Self.notAllowed }
        Self.clickMouse(at: global)
        return Self.result(.ok, "Clicked at \(point.x), \(point.y).")
    }

    /// The global top-left screen point for a pixel in a screenshot of `windowFrame`, at the captured
    /// image's own scale (SPEC-05 r12). The image may be larger than the frame in points (a Retina
    /// display), and the frame's origin may be negative on a display left of or above the main one.
    static func screenPoint(imageX: Int, imageY: Int, imageWidth: Int, imageHeight: Int, windowFrame: CGRect) -> CGPoint {
        let scaleX = CGFloat(imageWidth) / windowFrame.width
        let scaleY = CGFloat(imageHeight) / windowFrame.height
        return CGPoint(x: windowFrame.minX + CGFloat(imageX) / scaleX, y: windowFrame.minY + CGFloat(imageY) / scaleY)
    }

    /// Moves the real mouse to a global top-left point and clicks the left button there. A vision
    /// click moves the real mouse, which is why only the main lane is offered it (SPEC-03 r7). Every
    /// event carries Yumi's tag, so the take-over watcher never reads Yumi's own click as the user
    /// taking over and pausing the task (SPEC-06 r3; Brent's run, 2026-10-10).
    private static func clickMouse(at point: CGPoint) {
        CGWarpMouseCursorPosition(point)
        let source = CGEventSource(stateID: .hidSystemState)
        source?.userData = KeystrokeSender.eventTag
        for type in [CGEventType.leftMouseDown, CGEventType.leftMouseUp] {
            let event = CGEvent(mouseEventSource: source, mouseType: type, mouseCursorPosition: point, mouseButton: .left)
            event?.setIntegerValueField(.eventSourceUserData, value: KeystrokeSender.eventTag)
            event?.post(tap: .cghidEventTap)
        }
    }

    /// Whether two window frames are the same, within half a point: an accessibility frame can shift
    /// by a fraction without the window having moved.
    static func sameRect(_ a: CGRect, _ b: CGRect) -> Bool {
        abs(a.minX - b.minX) < 0.5 && abs(a.minY - b.minY) < 0.5
            && abs(a.width - b.width) < 0.5 && abs(a.height - b.height) < 0.5
    }

    private func click(_ kept: KeptElement<LiveNode>) throws -> String {
        let element = kept.node.element
        switch kept.role {
        case .row, .cell:
            // Rows usually cannot be pressed; selecting is what a click does (SPEC-05 r1).
            try check(AXUIElementSetAttributeValue(element, kAXSelectedAttribute as CFString, kCFBooleanTrue), kept)
            return "Selected \(Self.name(kept))."
        case .textField, .textArea, .comboBox, .secureTextField:
            try check(AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue), kept)
            return "Put the cursor in \(Self.name(kept))."
        default:
            try check(AXUIElementPerformAction(element, kAXPressAction as CFString), kept)
            return "Clicked \(Self.name(kept))."
        }
    }

    private func setValue(_ text: String, on kept: KeptElement<LiveNode>, params: ExecuteActionParams) throws -> String {
        // Checked three ways: the observed role, the role the harness resolved, and the element now.
        if kept.role == .secureTextField || params.action.element?.role == .secureTextField || kept.node.info().isSecure {
            throw GuiFailure.secureField
        }
        let element = kept.node.element
        _ = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        try check(AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, text as CFString), kept)
        return "Set the text of \(Self.name(kept))."
    }

    /// Chooses the item titled `title` in a pop-up button's menu: opens the menu if it is closed,
    /// presses the item, or closes the menu again and says which items there are. Some apps hang the
    /// open menu off the application instead of the pop-up, so both are looked at.
    private func choose(_ title: String, in kept: KeptElement<LiveNode>, target: Target) async throws -> String {
        let app = WindowReader.appNode(try WindowReader.runningApp(target.bundleId))
        func openMenu() -> LiveNode? {
            (PopUpMenus.openMenu(of: kept.node, path: kept.path) ?? PopUpMenus.appMenu(of: app))?.menu
        }
        var menu = openMenu()
        if menu == nil {
            try check(AXUIElementPerformAction(kept.node.element, kAXPressAction as CFString), kept)
            for _ in 0..<10 where menu == nil {
                try? await Task.sleep(for: .milliseconds(50))
                menu = openMenu()
            }
        }
        guard let menu else {
            throw PopUpChoiceFailure(observation: "\(Self.capitalized(Self.name(kept))) did not open a menu to choose from.")
        }
        guard let item = PopUpMenus.item(titled: title, in: menu) else {
            _ = AXUIElementPerformAction(menu.element, kAXCancelAction as CFString)
            throw PopUpChoiceFailure(observation: PopUpMenus.notFound(title, in: menu, owner: Self.name(kept)))
        }
        let chosen = item.info().title ?? title
        try check(AXUIElementPerformAction(item.element, kAXPressAction as CFString), kept)
        return "Chose \"\(TreeTrimmer<LiveNode>.clip(chosen, to: 80))\" in \(Self.name(kept))."
    }

    private func scroll(_ kept: KeptElement<LiveNode>, _ direction: ScrollDirection) throws -> String {
        let vertical = direction == .up || direction == .down
        let forward = direction == .down || direction == .right
        // The element itself, or the scroll area around a table, list or outline.
        var node: LiveNode? = kept.node
        for _ in 0..<3 {
            guard let current = node else { break }
            if current.info().role == kAXScrollAreaRole { break }
            node = current.element(kAXParentAttribute).map(LiveNode.init)
        }
        guard let area = node, area.info().role == kAXScrollAreaRole else { throw AXFailure(code: .actionUnsupported) }
        let barAttribute = vertical ? kAXVerticalScrollBarAttribute : kAXHorizontalScrollBarAttribute
        if let bar = area.element(barAttribute), let position = LiveNode(element: bar).copy(kAXValueAttribute) as? NSNumber {
            let next = min(1, max(0, position.doubleValue + (forward ? 0.25 : -0.25)))
            try check(AXUIElementSetAttributeValue(bar, kAXValueAttribute as CFString, next as CFNumber), kept)
        } else {
            let action = ["up": "AXScrollUpByPage", "down": "AXScrollDownByPage", "left": "AXScrollLeftByPage", "right": "AXScrollRightByPage"][direction.rawValue]!
            try check(AXUIElementPerformAction(area.element, action as CFString), kept)
        }
        return "Scrolled \(Self.name(kept)) \(direction.rawValue)."
    }

    // MARK: Keystrokes (OBJ-39.5)

    /// The lane comes from the cursor's kind, set when the harness spawned it: the main cursor is
    /// the main lane. An unknown cursor is not the main lane (SPEC-03 r7).
    func isMainLane(_ cursorId: String) -> Bool {
        overlay?.cursors[cursorId]?.kind == .main
    }

    private func type(_ text: String, _ params: ExecuteActionParams) async throws -> ExecuteActionResult {
        guard isMainLane(params.cursorId) else { throw GuiFailure.notMainLane }
        try requireAccessibility()
        let app = try WindowReader.runningApp(params.target.bundleId)
        let appNode = WindowReader.appNode(app)
        if focusIsSecure(appNode) { throw GuiFailure.secureField }
        try await activate(params.target)
        if let frame = appNode.element(kAXFocusedUIElementAttribute).flatMap({ LiveNode(element: $0).frame }) {
            await moveCursor(params.cursorId, toTopLeft: CGPoint(x: frame.midX, y: frame.midY))
        }
        guard actionsAllowed() else { return Self.notAllowed }
        let typed = await keystrokes.type(text) { focusIsSecure(appNode) }
        if typed.stopped {
            return Self.result(.blocked, "Stopped typing after \(typed.typed) of \(typed.total) characters.")
        }
        return Self.result(.ok, "Typed \(typed.total) characters.")
    }

    private func press(_ combo: String, _ params: ExecuteActionParams) async throws -> ExecuteActionResult {
        guard isMainLane(params.cursorId) else { throw GuiFailure.notMainLane }
        try requireAccessibility()
        guard KeyCombo(combo) != nil else { return Self.result(.invalidOutput, "\(combo) is not a key combination Yumi knows.") }
        try await activate(params.target)
        guard actionsAllowed() else { return Self.notAllowed }
        _ = keystrokes.press(combo)
        return Self.result(.ok, "Pressed \(combo).")
    }

    private func focusIsSecure(_ app: LiveNode) -> Bool {
        app.element(kAXFocusedUIElementAttribute).map { LiveNode(element: $0).info().isSecure } ?? false
    }

    // MARK: Direct tools (OBJ-39.6)

    private func run(_ call: ToolCall) async -> ExecuteActionResult {
        guard DirectTools.runsHere(call) else {
            return Self.result(.invalidOutput, "This tool runs in the harness, not the Mac app.")
        }
        do {
            return Self.result(.ok, try await DirectTools.run(call))
        } catch let failure as DirectTools.Failure {
            let text = switch failure {
            case .appNotFound: "That app is not on this Mac."
            case .fileNotFound: "That file or folder does not exist."
            case .badURL: "That is not a web link."
            case .couldNotOpen: "macOS did not open it."
            }
            return Self.result(.error, text)
        } catch {
            return Self.result(.error, "macOS did not open it.")
        }
    }

    // MARK: readFieldValues (OBJ-39.7)

    /// Reads real field values, for example a Mail draft's To and Cc, so the send approval is built
    /// from the screen and never from model text (SPEC-07 r13). A secure field is never read.
    func readFieldValues(_ params: ReadFieldValuesParams) throws -> ReadFieldValuesResult {
        try reporting {
            try requireAccessibility()
            var fields: [FieldValue] = []
            for path in params.elementPaths {
                guard let node = try WindowReader.resolve(path, in: params.target), !node.info().isSecure else {
                    fields.append(FieldValue(elementPath: path))
                    continue
                }
                fields.append(FieldValue(elementPath: path, value: Self.fieldText(node)))
            }
            return ReadFieldValuesResult(fields: fields)
        }
    }

    /// A field's text. Mail's address fields show each recipient as a token, which reads as an
    /// object replacement character, so then the tokens' own text is used.
    static func fieldText(_ node: LiveNode) -> String {
        let raw: String
        if case .text(let text)? = node.value() { raw = text } else { raw = "" }
        let visible = raw.replacingOccurrences(of: "\u{FFFC}", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !visible.isEmpty, !raw.contains("\u{FFFC}") { return visible }
        let tokens = node.children().compactMap { child -> String? in
            let info = child.info()
            guard !info.isSecure else { return nil }
            if let title = info.title ?? info.description, !title.isEmpty { return title }
            if case .text(let text)? = child.value(), !text.isEmpty { return text }
            return nil
        }
        return tokens.isEmpty ? visible : tokens.joined(separator: ", ")
    }

    // MARK: Helpers

    /// Moves the cursor and waits for it to arrive. Without that cursor the action still runs.
    private func moveCursor(_ cursorId: String, toTopLeft point: CGPoint) async {
        guard let overlay, overlay.cursors[cursorId] != nil else {
            log.notice("No cursor \(cursorId, privacy: .public) to move; acting without the animation")
            return
        }
        let duration = overlay.move(id: cursorId, to: ScreenGeometry.appKitPoint(fromGlobalTopLeft: point))
        try? await Task.sleep(for: .seconds(duration + 0.05))
    }

    private func activate(_ target: Target) async throws {
        let app = try WindowReader.runningApp(target.bundleId)
        guard !app.isActive else { return }
        app.activate()
        for _ in 0..<20 where !app.isActive {
            try? await Task.sleep(for: .milliseconds(50))
        }
    }

    /// Shows the permission error to the user (at most once a minute while a task keeps trying),
    /// then passes the failure on to the caller as a structured kind.
    private func reporting<T>(_ body: () async throws -> T) async throws -> T {
        do {
            return try await body()
        } catch let failure as GuiFailure where failure.isPermission {
            showPermissionError(failure.userError)
            throw failure
        }
    }

    private func reporting<T>(_ body: () throws -> T) throws -> T {
        do {
            return try body()
        } catch let failure as GuiFailure where failure.isPermission {
            showPermissionError(failure.userError)
            throw failure
        }
    }

    private func showPermissionError(_ error: UserError) {
        if let last = lastPermissionPrompt, Date().timeIntervalSince(last) < 60 { return }
        lastPermissionPrompt = Date()
        onUserError?(error)
    }

    private func check(_ error: AXError, _ kept: KeptElement<LiveNode>) throws {
        switch error {
        case .success:
            return
        case .cannotComplete where kept.role == .menuBarItem || kept.role == .menuItem:
            // The app is busy showing what the press opened: a menu, sheet or dialog.
            return
        case .apiDisabled:
            throw GuiFailure.accessibilityMissing
        case .notImplemented where !AXIsProcessTrusted():
            throw GuiFailure.accessibilityMissing
        default:
            throw AXFailure(code: error)
        }
    }

    private static func describe(_ error: AXError, _ kept: KeptElement<LiveNode>) -> String {
        switch error {
        case .invalidUIElement: "\(capitalized(name(kept))) is no longer on screen."
        case .actionUnsupported, .attributeUnsupported: "\(capitalized(name(kept))) does not support that."
        default: "The app did not accept the action on \(name(kept))."
        }
    }

    /// For example `the button "Export"`.
    static func name(_ kept: KeptElement<LiveNode>) -> String {
        kept.label.isEmpty ? "the \(kept.role.rawValue)" : "the \(kept.role.rawValue) \"\(kept.label.prefix(80))\""
    }

    private static func capitalized(_ text: String) -> String {
        text.prefix(1).uppercased() + text.dropFirst()
    }

    static let notAllowed = result(.blocked, "Nothing ran: Yumi is paused, or the goal is not confirmed yet.")

    static func result(_ outcome: StepOutcome, _ text: String) -> ExecuteActionResult {
        ExecuteActionResult(outcome: outcome, observation: String(text.prefix(300)))
    }

    private static func key(_ target: Target) -> String {
        "\(target.bundleId)#\(target.windowId.map(String.init) ?? "front")"
    }
}

/// An accessibility call the other app refused.
nonisolated struct AXFailure: Error {
    let code: AXError
}

/// A pop-up had no item to choose by that title. `observation` is for the model's next step.
nonisolated struct PopUpChoiceFailure: Error {
    let observation: String
}
