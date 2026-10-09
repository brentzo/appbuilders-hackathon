import AppKit
import SwiftUI

/// "Type instead" (OBJ-15.7, SPEC-11): a small box to type the goal when speaking did not work.
struct TypeGoalView: View {
    let send: (String) -> Void
    let cancel: () -> Void
    @State private var goal = ""
    @FocusState private var focused: Bool

    private var trimmed: String { goal.trimmingCharacters(in: .whitespacesAndNewlines) }

    var body: some View {
        VStack(alignment: .leading, spacing: YumiSpace.m) {
            Text("What should I do?")
                .font(YumiFont.headline)
                .foregroundStyle(YumiColor.brand)
            TextField("For example: export my Keynote deck as a PDF", text: $goal, axis: .vertical)
                .lineLimit(2...4)
                .textFieldStyle(.roundedBorder)
                .focused($focused)
                .onSubmit { if !trimmed.isEmpty { send(trimmed) } }
            HStack {
                Spacer()
                Button("Cancel", action: cancel)
                    .buttonStyle(YumiSecondaryButtonStyle())
                    .keyboardShortcut(.cancelAction)
                Button("Send") { send(trimmed) }
                    .buttonStyle(YumiPrimaryButtonStyle())
                    .keyboardShortcut(.defaultAction)
                    .disabled(trimmed.isEmpty)
            }
        }
        .padding(YumiSpace.xl)
        .frame(width: 400)
        .yumiWindow()
        .onAppear { focused = true }
    }
}

/// Opens the typed-goal box, one at a time.
@MainActor
enum TypeGoalWindow {
    private static var window: NSWindow?

    @discardableResult
    static func show(send: @escaping (String) -> Void) -> NSWindow {
        if let window {
            NSApp.activate()
            window.makeKeyAndOrderFront(nil)
            return window
        }
        let created = NSWindow(contentViewController: NSHostingController(rootView: TypeGoalView(
            send: { goal in
                send(goal)
                TypeGoalWindow.window?.close()
            },
            cancel: { TypeGoalWindow.window?.close() }
        )))
        created.title = "Type your goal"
        created.styleMask = [.titled, .closable]
        created.isReleasedWhenClosed = false
        created.applyYumiStyle()
        created.center()
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: created, queue: .main) { _ in
            MainActor.assumeIsolated { TypeGoalWindow.window = nil }
        }
        window = created
        NSApp.activate()
        created.makeKeyAndOrderFront(nil)
        return created
    }
}
