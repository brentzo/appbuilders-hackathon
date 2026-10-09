import CoreGraphics
import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// OBJ-44.10, main paths: trimming, secure fields, the keystroke lane rule, event tagging,
/// typing stopping on the cancel flag, and the missing-permission error.
@MainActor
struct GuiExecutionTests {
    // MARK: Fixture tree

    /// A recorded-style accessibility element. Counts every read of a value, so a test can prove
    /// a secure field was never read.
    final class FixtureNode: TreeNode {
        let nodeInfo: NodeInfo
        let nodeValue: NodeValue?
        let kids: [FixtureNode]
        let reads: Reads

        final class Reads {
            var secure = 0
        }

        init(_ role: String, subrole: String? = nil, title: String? = nil, frame: CGRect? = CGRect(x: 10, y: 10, width: 80, height: 20),
             enabled: Bool = true, value: NodeValue? = nil, reads: Reads, children: [FixtureNode] = []) {
            var info = NodeInfo(role: role, subrole: subrole, title: title, enabled: enabled)
            info.frame = frame
            nodeInfo = info
            nodeValue = value
            kids = children
            self.reads = reads
        }

        func info() -> NodeInfo { nodeInfo }
        func children() -> [FixtureNode] { kids }
        func value() -> NodeValue? {
            if nodeInfo.isSecure { reads.secure += 1 }
            return nodeValue
        }
    }

    static let window = CGRect(x: 0, y: 0, width: 1200, height: 800)

    /// About 1,600 elements like a busy Keynote window: nested layout groups, many of them empty,
    /// static text, buttons on and off screen, a sign-in sheet with a password field, and a list.
    func bigWindow(reads: FixtureNode.Reads) -> FixtureNode {
        var groups: [FixtureNode] = []
        for g in 0..<130 {
            var items: [FixtureNode] = [
                FixtureNode("AXGroup", reads: reads), // empty layout group
                FixtureNode("AXStaticText", value: .text("Slide \(g)"), reads: reads),
                FixtureNode("AXImage", reads: reads),
            ]
            for b in 0..<5 {
                // Every other group is scrolled out of the window.
                let y = g.isMultiple(of: 2) ? CGFloat(20 + (g % 30) * 25) : 5000
                items.append(FixtureNode("AXButton", title: "Button \(g).\(b)", frame: CGRect(x: CGFloat(b) * 90, y: y, width: 80, height: 20), reads: reads))
            }
            items.append(FixtureNode("AXGroup", reads: reads, children: [FixtureNode("AXGroup", reads: reads), FixtureNode("AXGroup", reads: reads)]))
            groups.append(FixtureNode("AXGroup", reads: reads, children: items))
        }
        let sheet = FixtureNode("AXGroup", reads: reads, children: [
            FixtureNode("AXTextField", title: "Email", value: .text("ana@example.com"), reads: reads),
            FixtureNode("AXTextField", subrole: "AXSecureTextField", title: "Password", value: .text("hunter2"), reads: reads),
            FixtureNode("AXCheckBox", title: "Remember me", value: .number(1), reads: reads),
        ])
        return FixtureNode("AXWindow", frame: Self.window, reads: reads, children: [sheet] + groups)
    }

    func count(_ node: FixtureNode) -> Int {
        1 + node.children().map(count).reduce(0, +)
    }

    // MARK: Trimming (OBJ-44.1, OBJ-44.2)

    @Test func theModelSeesATrimmedTree() {
        let reads = FixtureNode.Reads()
        let root = bigWindow(reads: reads)
        #expect(count(root) > 1_500)

        var trimmer = TreeTrimmer<FixtureNode>()
        trimmer.walk(root, path: ElementPath.windowRoot, clip: Self.window)

        // At most 200, visible, actionable, and in the order the tree reads.
        #expect(trimmer.kept.count == 200)
        #expect(trimmer.kept.allSatisfy { $0.frame.map { $0.intersects(Self.window) } ?? true })
        #expect(!trimmer.kept.contains { $0.label.hasPrefix("Button 1.") }, "group 1 is off screen")
        #expect(trimmer.kept.prefix(3).map(\.role) == [.textField, .secureTextField, .checkbox])
        #expect(trimmer.kept[2].value == "on")
        // Every kept element's path leads back to it.
        for kept in trimmer.kept.prefix(20) {
            let steps = ElementPath.parse(kept.path)!.steps
            #expect(ElementPath.resolve(steps, from: root) === kept.node)
        }
    }

    @Test func aPasswordFieldIsListedButNeverRead() throws {
        let reads = FixtureNode.Reads()
        var trimmer = TreeTrimmer<FixtureNode>()
        trimmer.walk(bigWindow(reads: reads), path: ElementPath.windowRoot, clip: Self.window)

        let secure = try #require(trimmer.kept.first { $0.role == .secureTextField })
        #expect(secure.label == "Password")
        #expect(secure.value == nil)
        #expect(reads.secure == 0)
        // And the contract's element carries no value.
        let element = TreeElement(n: 2, role: secure.role, label: secure.label, value: secure.value, enabled: secure.enabled)
        let json = String(decoding: try JSONEncoder().encode(element), as: UTF8.self)
        #expect(!json.contains("value") && !json.contains("hunter2"))
    }

    @Test func setValueOnAPasswordFieldIsRefused() async {
        let gui = GuiExecutor(overlay: nil, isTrusted: { true })
        let params = ExecuteActionParams(
            stepId: UUID().uuidString.lowercased(),
            target: Target(bundleId: "com.example.app"),
            action: RecordedAction(
                action: .setValue(SetValueAction(element: 2, text: "hunter2")),
                element: ResolvedElement(path: "AXWindow/AXTextField[1]", role: .secureTextField, label: "Password"),
                permission: .allowed
            ),
            cursorId: "main"
        )
        await #expect(throws: GuiFailure.secureField) { try await gui.executeAction(params) }
        #expect(GuiFailure.secureField.userError.kind == .blockedAction)
    }

    // MARK: Keystrokes (OBJ-44.5)

    func keystrokeParams(_ action: ModelAction, cursor: String) -> ExecuteActionParams {
        ExecuteActionParams(
            stepId: UUID().uuidString.lowercased(),
            target: Target(bundleId: "com.apple.TextEdit"),
            action: RecordedAction(action: action, permission: .allowed),
            cursorId: cursor
        )
    }

    @Test func onlyTheMainLaneSendsKeystrokes() async {
        let overlay = CursorOverlay(locator: WindowCenterLocator())
        overlay.spawn(id: "main", kind: .main, label: nil, at: .zero)
        overlay.spawn(id: "ghost-1", kind: .ghost, label: "Fill expense form", at: .zero)
        let gui = GuiExecutor(overlay: overlay, isTrusted: { true })

        #expect(gui.isMainLane("main"))
        for cursor in ["ghost-1", "not-spawned"] {
            await #expect(throws: GuiFailure.notMainLane) {
                try await gui.executeAction(keystrokeParams(.type(TypeTextAction(text: "hello")), cursor: cursor))
            }
            await #expect(throws: GuiFailure.notMainLane) {
                try await gui.executeAction(keystrokeParams(.key(KeyAction(combo: "cmd+a")), cursor: cursor))
            }
        }
    }

    final class RecordingPoster: EventPosting {
        var events: [CGEvent] = []
        var onPost: (() -> Void)?

        func post(_ event: CGEvent) {
            events.append(event)
            onPost?()
        }
    }

    @Test func everyEventYumiSendsIsTagged() async {
        let poster = RecordingPoster()
        let sender = KeystrokeSender(poster: poster)
        let result = await sender.type("Hi Ana,\nhere it is.", focusIsSecure: { false })
        #expect(!result.stopped)
        #expect(sender.press("cmd+shift+e"))
        #expect(poster.events.count == 2 * 19 + 2)
        #expect(poster.events.allSatisfy { $0.getIntegerValueField(.eventSourceUserData) == KeystrokeSender.eventTag })
        let combo = poster.events.suffix(2)
        #expect(combo.allSatisfy { $0.flags.contains([.maskCommand, .maskShift]) })
    }

    @Test func typingStopsBeforeTheNextChunk() async {
        let poster = RecordingPoster()
        let sender = KeystrokeSender(poster: poster)
        // The user takes over while the first chunk is going out (OBJ-40 sets the flag).
        poster.onPost = { [unowned sender] in sender.cancelTyping() }
        let stopped = await sender.type("This sentence is longer than one chunk.", focusIsSecure: { false })
        #expect(stopped.typed == KeystrokeSender.chunkSize)
        #expect(stopped.stopped)

        // Focus moving to a password field also stops it.
        let secure = await KeystrokeSender(poster: RecordingPoster()).type("secret", focusIsSecure: { true })
        #expect(secure.typed == 0)
    }

    @Test func keyCombosFollowTheContract() {
        #expect(KeyCombo("cmd+shift+e")?.flags == [.maskCommand, .maskShift])
        #expect(KeyCombo("return") != nil && KeyCombo("pageDown") != nil && KeyCombo("f19") != nil)
        #expect(KeyCombo("cmd+") == nil)
        #expect(KeyCombo("hyper+a") == nil)
        #expect(KeyCombo("Cmd+S") == nil, "the harness normalizes aliases; the app takes the canonical form only")
    }

    // MARK: Missing permission (OBJ-44.8)

    @Test func missingAccessibilityShowsTheSpec11Error() async throws {
        let gui = GuiExecutor(overlay: nil, isTrusted: { false })
        var shown: [UserError] = []
        gui.onUserError = { shown.append($0) }
        let server = AppMethodServer(gui: gui)

        for method in ["observeWindow", "readFieldValues"] {
            let params = method == "observeWindow"
                ? #"{"target":{"bundleId":"com.apple.iWork.Keynote"}}"#
                : #"{"target":{"bundleId":"com.apple.mail"},"elementPaths":["AXWindow/AXTextField[0]"]}"#
            guard case .failed(let error, _) = await server.serve(method, params: Data(params.utf8)) else {
                Issue.record("\(method) did not fail"); continue
            }
            #expect(error.kind == .accessibilityPermissionMissing)
        }
        // Shown once, not once per failed call.
        #expect(shown.map(\.kind) == [.accessibilityPermissionMissing])
        let presented = ErrorPresenter.present(shown[0])
        #expect(presented.message == "I need permission to control your Mac before I can help with this.")
        #expect(presented.buttons.first == ErrorButton(label: "Open settings", action: .openSettings(.accessibility)))
    }

    // MARK: Safety of the code itself (OBJ-44.6)

    @Test func noShellOrAppleScriptInGuiExecution() throws {
        let folder = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("Yumi/GUI")
        let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "swift" }
        #expect(files.count >= 8)
        for file in files {
            let source = try String(contentsOf: file, encoding: .utf8)
            for banned in ["Process(", "NSTask", "NSAppleScript", "OSAScript", "/bin/sh", "/bin/zsh", "system("] {
                #expect(!source.contains(banned), "\(file.lastPathComponent) contains \(banned)")
            }
        }
    }
}
