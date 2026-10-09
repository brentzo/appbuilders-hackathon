import AppKit
import ApplicationServices
import OSLog
import YumiProtocol

/// The Mac side of every GUI step (OBJ-44): `observeWindow`, `executeAction`, and
/// `readFieldValues`, with the protocol's own types.
///
/// Element numbers resolve against the last observation of the same window. Before every
/// element action the cursor moves to the element and the action runs once it has arrived; the
/// real mouse pointer never moves, because elements are pressed through the accessibility API
/// (SPEC-05 r3).
@MainActor
final class GuiExecutor {
    let keystrokes: KeystrokeSender
    /// Shows a failure to the user through the error presenter (OBJ-44.8). Set by the app.
    var onUserError: ((UserError) -> Void)?

    private let overlay: CursorOverlay?
    private var snapshots: [String: WindowSnapshot] = [:]
    private var lastPermissionPrompt: Date?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "gui")

    init(overlay: CursorOverlay?, keystrokes: KeystrokeSender = KeystrokeSender()) {
        self.overlay = overlay
        self.keystrokes = keystrokes
    }

    // MARK: observeWindow (OBJ-44.2)

    func observeWindow(_ params: ObserveWindowParams) throws -> YumiProtocol.Observation {
        try reporting {
            let snapshot = try WindowReader.observe(params.target)
            snapshots[Self.key(params.target)] = snapshot
            return snapshot.observation
        }
    }

    /// The last look at a window, for the debug window.
    func lastSnapshot(of target: Target) -> WindowSnapshot? {
        snapshots[Self.key(target)]
    }

    // MARK: executeAction (OBJ-44.3 to OBJ-44.6)

    func executeAction(_ params: ExecuteActionParams) async throws -> ExecuteActionResult {
        try await reporting {
            switch params.action.action {
            case .click(let click):
                return try await onElement(click.element, params) { kept in try self.click(kept) }
            case .setValue(let set):
                return try await onElement(set.element, params) { kept in try self.setValue(set.text, on: kept, params: params) }
            case .scroll(let scroll):
                return try await onElement(scroll.element, params) { kept in try self.scroll(kept, scroll.direction) }
            case .type(let text):
                return try await type(text.text, params)
            case .key(let key):
                return try await press(key.combo, params)
            case .tool(let tool):
                return await run(tool.call)
            case .ask, .finish:
                return Self.result(.invalidOutput, "The harness handles ask and finish, not the Mac app.")
            case .clickAt:
                return Self.result(.invalidOutput, "Clicking at coordinates is not available yet.")
            }
        }
    }

    /// Resolves the number, checks it is still the element the harness resolved, moves the cursor
    /// there, then acts.
    private func onElement(
        _ number: Int, _ params: ExecuteActionParams, perform: (KeptElement<LiveNode>) throws -> String
    ) async throws -> ExecuteActionResult {
        try WindowReader.requireAccessibility()
        guard let kept = snapshots[Self.key(params.target)]?.element(number) else {
            return Self.result(.error, "Element \(number) is not in the last look at this window.")
        }
        if let expected = params.action.element, expected.role != kept.role {
            return Self.result(.error, "Element \(number) is no longer a \(expected.role.rawValue).")
        }
        guard let frame = kept.node.frame ?? kept.frame else {
            return Self.result(.error, "Element \(number) is no longer on screen.")
        }
        if kept.role == .menuBarItem || kept.role == .menuItem {
            // A menu only opens in the active app.
            try await activate(params.target)
        }
        await moveCursor(params.cursorId, toTopLeft: CGPoint(x: frame.midX, y: frame.midY))
        do {
            return Self.result(.ok, try perform(kept))
        } catch let error as AXError {
            return Self.result(.error, Self.describe(error, kept))
        }
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
        guard let area = node, area.info().role == kAXScrollAreaRole else { throw AXError.actionUnsupported }
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

    // MARK: Keystrokes (OBJ-44.5)

    /// The lane comes from the cursor's kind, set when the harness spawned it: the main cursor is
    /// the main lane. An unknown cursor is not the main lane (SPEC-03 r7).
    func isMainLane(_ cursorId: String) -> Bool {
        overlay?.cursors[cursorId]?.kind == .main
    }

    private func type(_ text: String, _ params: ExecuteActionParams) async throws -> ExecuteActionResult {
        guard isMainLane(params.cursorId) else { throw GuiFailure.notMainLane }
        try WindowReader.requireAccessibility()
        let app = try WindowReader.runningApp(params.target.bundleId)
        let appNode = WindowReader.appNode(app)
        if focusIsSecure(appNode) { throw GuiFailure.secureField }
        try await activate(params.target)
        if let frame = appNode.element(kAXFocusedUIElementAttribute).flatMap({ LiveNode(element: $0).frame }) {
            await moveCursor(params.cursorId, toTopLeft: CGPoint(x: frame.midX, y: frame.midY))
        }
        let typed = await keystrokes.type(text) { focusIsSecure(appNode) }
        if typed.stopped {
            return Self.result(.blocked, "Stopped typing after \(typed.typed) of \(typed.total) characters.")
        }
        return Self.result(.ok, "Typed \(typed.total) characters.")
    }

    private func press(_ combo: String, _ params: ExecuteActionParams) async throws -> ExecuteActionResult {
        guard isMainLane(params.cursorId) else { throw GuiFailure.notMainLane }
        try WindowReader.requireAccessibility()
        guard KeyCombo(combo) != nil else { return Self.result(.invalidOutput, "\(combo) is not a key combination Yumi knows.") }
        try await activate(params.target)
        _ = keystrokes.press(combo)
        return Self.result(.ok, "Pressed \(combo).")
    }

    private func focusIsSecure(_ app: LiveNode) -> Bool {
        app.element(kAXFocusedUIElementAttribute).map { LiveNode(element: $0).info().isSecure } ?? false
    }

    // MARK: Direct tools (OBJ-44.6)

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

    // MARK: readFieldValues (OBJ-44.7)

    /// Reads real field values, for example a Mail draft's To and Cc, so the send approval is built
    /// from the screen and never from model text (SPEC-07 r13). A secure field is never read.
    func readFieldValues(_ params: ReadFieldValuesParams) throws -> ReadFieldValuesResult {
        try reporting {
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
        overlay.move(id: cursorId, to: ScreenGeometry.appKitPoint(fromGlobalTopLeft: point))
        try? await Task.sleep(for: .seconds(CursorOverlay.moveDuration + 0.05))
    }

    private func activate(_ target: Target) async throws {
        let app = try WindowReader.runningApp(target.bundleId)
        guard !app.isActive else { return }
        app.activate()
        for _ in 0..<20 where !app.isActive {
            try? await Task.sleep(for: .milliseconds(50))
        }
    }

    /// Shows the Accessibility error to the user (at most once a minute while a task keeps
    /// trying), then passes every failure on to the caller as a structured kind.
    private func reporting<T>(_ body: () async throws -> T) async throws -> T {
        do {
            return try await body()
        } catch GuiFailure.accessibilityMissing {
            showPermissionError()
            throw GuiFailure.accessibilityMissing
        }
    }

    private func reporting<T>(_ body: () throws -> T) throws -> T {
        do {
            return try body()
        } catch GuiFailure.accessibilityMissing {
            showPermissionError()
            throw GuiFailure.accessibilityMissing
        }
    }

    private func showPermissionError() {
        if let last = lastPermissionPrompt, Date().timeIntervalSince(last) < 60 { return }
        lastPermissionPrompt = Date()
        onUserError?(GuiFailure.accessibilityMissing.userError)
    }

    private func check(_ error: AXError, _ kept: KeptElement<LiveNode>) throws {
        switch error {
        case .success:
            return
        case .cannotComplete where kept.role == .menuBarItem || kept.role == .menuItem:
            // The app is busy showing what the press opened: a menu, sheet or dialog.
            return
        case .apiDisabled, .notImplemented where !AXIsProcessTrusted():
            throw GuiFailure.accessibilityMissing
        default:
            throw error
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

    static func result(_ outcome: StepOutcome, _ text: String) -> ExecuteActionResult {
        ExecuteActionResult(outcome: outcome, observation: String(text.prefix(300)))
    }

    private static func key(_ target: Target) -> String {
        "\(target.bundleId)#\(target.windowId.map(String.init) ?? "front")"
    }
}

extension AXError: @retroactive Error {}
