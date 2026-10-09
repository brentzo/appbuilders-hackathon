import AppKit
import Combine
import SwiftUI
import YumiProtocol

/// Debug aid (OBJ-39.9): shows the trimmed tree of an app's front window with its numbers, and
/// runs real `executeAction` calls on it as the main lane, with a debug main cursor. This is how
/// Keynote, Mail and Notes are checked by hand.
///
/// It is a floating panel that does not activate Yumi when clicked, so a menu Yumi opened in
/// the target app stays open while the next item is pressed.
@MainActor
final class GuiDebugWindow {
    static let cursorId = "gui-debug"
    private static var panel: NSPanel?
    private static var model: GuiDebugModel?

    static func show(executor: GuiExecutor, overlay: CursorOverlay) {
        if let panel {
            panel.orderFrontRegardless()
            return
        }
        let model = GuiDebugModel(executor: executor, overlay: overlay)
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 560, height: 680),
            styleMask: [.titled, .closable, .resizable, .utilityWindow, .nonactivatingPanel],
            backing: .buffered, defer: false
        )
        panel.title = "GUI debug"
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.isMovableByWindowBackground = true
        panel.isReleasedWhenClosed = false
        panel.contentView = NSHostingView(rootView: GuiDebugView(model: model))
        panel.center()
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: panel, queue: .main) { _ in
            MainActor.assumeIsolated {
                overlay.fade(id: cursorId)
                Self.panel = nil
                Self.model = nil
            }
        }
        self.panel = panel
        self.model = model
        panel.orderFrontRegardless()
        model.start()
    }
}

@MainActor
final class GuiDebugModel: ObservableObject {
    struct AppChoice: Hashable {
        let bundleId: String
        let name: String
    }

    struct Row: Identifiable {
        let element: TreeElement
        let path: String
        var id: Int { element.n }
    }

    @Published var apps: [AppChoice] = []
    @Published var bundleId = ""
    @Published var header = "Pick an app and press Read."
    @Published var rows: [Row] = []
    @Published var focused: Int?
    @Published var selected: Int?
    @Published var number = ""
    @Published var text = ""
    @Published var combo = "escape"
    @Published var status = ""
    @Published var busy = false

    private let executor: GuiExecutor
    private let overlay: CursorOverlay

    init(executor: GuiExecutor, overlay: CursorOverlay) {
        self.executor = executor
        self.overlay = overlay
    }

    func start() {
        refreshApps()
        let front = NSWorkspace.shared.frontmostApplication?.bundleIdentifier
        bundleId = apps.first { $0.bundleId == front }?.bundleId ?? apps.first?.bundleId ?? ""
        if overlay.cursors[GuiDebugWindow.cursorId] == nil {
            let mouse = NSEvent.mouseLocation
            overlay.spawn(id: GuiDebugWindow.cursorId, kind: .main, label: "GUI debug", at: CGPoint(x: mouse.x + 28, y: mouse.y - 28))
        }
        Task { await read() }
    }

    func refreshApps() {
        let own = Bundle.main.bundleIdentifier
        apps = NSWorkspace.shared.runningApplications
            .filter { $0.activationPolicy == .regular && $0.bundleIdentifier != nil && $0.bundleIdentifier != own }
            .map { AppChoice(bundleId: $0.bundleIdentifier!, name: $0.localizedName ?? $0.bundleIdentifier!) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private var target: Target { Target(bundleId: bundleId) }

    func read(after delay: Duration = .zero) async {
        guard !bundleId.isEmpty else { return }
        busy = true
        defer { busy = false }
        if delay > .zero {
            status = "Reading in \(delay.components.seconds) seconds…"
            try? await Task.sleep(for: delay)
        }
        do {
            let observation = try await executor.observeWindow(ObserveWindowParams(target: target))
            let paths = executor.lastSnapshot(of: target)?.elements.map(\.path) ?? []
            rows = observation.elements.enumerated().map { index, element in
                Row(element: element, path: paths.indices.contains(index) ? paths[index] : "")
            }
            focused = observation.focused
            var parts = ["\(observation.app ?? bundleId): \"\(observation.windowTitle)\"", "\(rows.count) elements"]
            if let layer = observation.layer {
                parts.append("front: \(layer.kind.rawValue)\(layer.title.map { " \"\($0)\"" } ?? "")")
                if let n = layer.defaultButton { parts.append("default \(n)") }
                if let n = layer.cancelButton { parts.append("cancel \(n)") }
            }
            if let focused { parts.append("focus \(focused)") }
            header = parts.joined(separator: " · ")
            if delay > .zero { status = "" }
        } catch {
            rows = []
            header = "Could not read \(bundleId)."
            status = Self.describe(error)
        }
    }

    func click(_ n: Int) { run(.click(ClickAction(element: n)), element: n) }

    func setValue() {
        guard let n = Int(number) else { status = "Enter an element number."; return }
        run(.setValue(SetValueAction(element: n, text: text)), element: n)
    }

    func scroll(_ direction: ScrollDirection) {
        guard let n = Int(number) else { status = "Enter an element number."; return }
        run(.scroll(ScrollAction(element: n, direction: direction)), element: n)
    }

    func type() {
        guard !text.isEmpty else { status = "Enter text to type."; return }
        run(.type(TypeTextAction(text: text)), element: nil)
    }

    func pressKey() { run(.key(KeyAction(combo: combo)), element: nil) }

    func revealDownloads() {
        run(.tool(ToolAction(call: .revealInFinder(RevealInFinderCall(path: "~/Downloads")))), element: nil)
    }

    /// readFieldValues on the selected row, as the harness does for a Mail draft's To and Cc.
    func readSelectedValue() {
        guard let n = selected, let row = rows.first(where: { $0.id == n }) else { status = "Select a row first."; return }
        do {
            let result = try executor.readFieldValues(ReadFieldValuesParams(target: target, elementPaths: [row.path]))
            status = "Value of \(n): \(result.fields.first?.value.map { "\"\($0)\"" } ?? "none")"
        } catch {
            status = Self.describe(error)
        }
    }

    private func run(_ action: ModelAction, element n: Int?) {
        let resolved = n.flatMap { n in rows.first { $0.id == n } }.map {
            ResolvedElement(path: $0.path, role: $0.element.role, label: $0.element.label)
        }
        let params = ExecuteActionParams(
            stepId: UUID().uuidString.lowercased(),
            target: target,
            action: RecordedAction(action: action, element: resolved, permission: .allowed),
            cursorId: GuiDebugWindow.cursorId
        )
        Task {
            busy = true
            do {
                let result = try await executor.executeAction(params)
                status = "\(result.outcome.rawValue): \(result.observation)"
            } catch {
                status = Self.describe(error)
            }
            busy = false
            try? await Task.sleep(for: .milliseconds(500))
            await read()
        }
    }

    private static func describe(_ error: Error) -> String {
        if let failure = error as? GuiFailure {
            return "Refused with \(failure.userError.kind.rawValue) (\(failure))."
        }
        return "Failed: \(error)"
    }
}

struct GuiDebugView: View {
    @ObservedObject var model: GuiDebugModel

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Picker("App", selection: $model.bundleId) {
                    ForEach(model.apps, id: \.bundleId) { app in
                        Text(app.name).tag(app.bundleId)
                    }
                }
                .fixedSize()
                Button("Read") { Task { await model.read() } }
                Button("Read in 3 s") { Task { await model.read(after: .seconds(3)) } }
                    .help("Open a menu or sheet by hand meanwhile")
                Spacer()
                if model.busy { ProgressView().controlSize(.small) }
            }
            Text(model.header)
                .font(.callout)
                .foregroundStyle(.secondary)
                .lineLimit(2)

            List(model.rows, selection: $model.selected) { row in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("\(row.element.n)")
                        .monospacedDigit()
                        .frame(width: 30, alignment: .trailing)
                        .foregroundStyle(row.element.n == model.focused ? Color.accentColor : .secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 6) {
                            Text(row.element.role.rawValue).font(.caption).foregroundStyle(.secondary)
                            Text(row.element.label.isEmpty ? "(no label)" : row.element.label)
                                .foregroundStyle(row.element.enabled ? .primary : .tertiary)
                                .lineLimit(1)
                        }
                        if let value = row.element.value {
                            Text("= \(value)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                        if model.selected == row.id {
                            Text(row.path).font(.caption2.monospaced()).foregroundStyle(.secondary).textSelection(.enabled)
                        }
                    }
                    Spacer()
                    Button("Click") { model.click(row.element.n) }
                        .controlSize(.small)
                        .disabled(model.busy)
                }
                .tag(row.id)
            }
            .listStyle(.inset)
            .frame(minHeight: 280)

            Grid(alignment: .leading, horizontalSpacing: 8, verticalSpacing: 8) {
                GridRow {
                    TextField("Element", text: $model.number).frame(width: 70)
                    TextField("Text for Set value or Type", text: $model.text)
                }
                GridRow {
                    Color.clear.frame(width: 70, height: 1)
                    HStack {
                        Button("Set value") { model.setValue() }
                        Button("Scroll up") { model.scroll(.up) }
                        Button("Scroll down") { model.scroll(.down) }
                        Button("Type") { model.type() }
                    }
                }
                GridRow {
                    TextField("Key", text: $model.combo).frame(width: 70)
                    HStack {
                        Button("Press key") { model.pressKey() }
                        Button("Read value of selected") { model.readSelectedValue() }
                        Button("Show Downloads") { model.revealDownloads() }
                    }
                }
            }
            .disabled(model.busy)

            Text(model.status.isEmpty ? " " : model.status)
                .font(.callout)
                .textSelection(.enabled)
                .lineLimit(3)
        }
        .padding(14)
        .frame(minWidth: 520, minHeight: 560)
    }
}
