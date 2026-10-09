import SwiftUI
import YumiProtocol

/// The panel under Yumi's menu bar item: what Yumi is doing, each running cursor, and every
/// action, built on the design system. Every action has a key, and Escape closes the panel.
struct MenuPanel: View {
    let model: AppModel
    let windows: WindowCoordinator
    let harness: HarnessLink
    /// "Talk": push-to-talk without a key to hold.
    let talk: () -> Void
    /// "Type a goal": the typed-goal box.
    let typeGoal: () -> Void
    /// Closes the panel. The live panel passes its dismiss action; a snapshot window, its close.
    let close: () -> Void

    var body: some View {
        // The overlay is not observable, so the cursor rows re-read it while the panel is open.
        TimelineView(.periodic(from: .now, by: 0.5)) { _ in
            content(cursors: Self.sorted(harness.overlay.cursors.values))
        }
        .frame(width: 320)
        .background(YumiColor.paper)
        .foregroundStyle(YumiColor.ink)
        .tint(YumiColor.accent)
        .onExitCommand(perform: close)
    }

    private func content(cursors: [OverlayCursor]) -> some View {
        let somethingRuns = model.status == .working || !cursors.isEmpty
        return VStack(alignment: .leading, spacing: 0) {
            MenuPanelHeader(status: model.status, mainCursor: cursors.first { $0.kind == .main })
                .padding(YumiSpace.l)

            if !cursors.isEmpty {
                VStack(spacing: YumiSpace.xs) {
                    ForEach(cursors, id: \.id) { CursorRow(cursor: $0) }
                }
                .padding(.horizontal, YumiSpace.l)
                .padding(.bottom, YumiSpace.m)
            }

            HStack(spacing: YumiSpace.s) {
                Button {
                    close()
                    talk()
                } label: {
                    Label("Talk", systemImage: "mic.fill").frame(maxWidth: .infinity)
                }
                .buttonStyle(YumiSecondaryButtonStyle())
                .keyboardShortcut("t")
                .help("Talk (⌘T). Or hold \(model.settings.pushToTalkShortcut.displayText) anywhere.")

                Button {
                    close()
                    typeGoal()
                } label: {
                    Label("Type a goal", systemImage: "keyboard").frame(maxWidth: .infinity)
                }
                .buttonStyle(YumiPrimaryButtonStyle())
                .keyboardShortcut("n")
                .help("Type a goal (⌘N)")
            }
            .padding(.horizontal, YumiSpace.l)
            .padding(.bottom, YumiSpace.m)

            PanelDivider()

            VStack(spacing: 0) {
                if somethingRuns {
                    // Same as Control-Option-Escape: pauses every lane (SPEC-06 r1).
                    PanelRow(PauseCopy.stop, symbol: "pause.fill", key: ".", hush: true) {
                        harness.pause.stop(.menu)
                    }
                }
                if harness.tiler.state.hasSavedLayout {
                    // Windows go back on their own when the task ends; this is the user's way out before that.
                    PanelRow("Put windows back", symbol: "rectangle.on.rectangle", key: "b") {
                        harness.tiler.restoreAll()
                    }
                }
                PhoneRow(phone: .shared, close: close)
                if !model.permissions.allGranted {
                    PanelRow("Set up permissions…", symbol: "lock.shield", key: "p", modifiers: [.command, .shift]) {
                        close()
                        windows.showOnboarding()
                    }
                }
            }
            .padding(YumiSpace.xs)

            PanelDivider()

            #if DEBUG
            DebugRows(model: model, harness: harness, close: close)
            PanelDivider()
            #endif

            VStack(spacing: 0) {
                PanelRow("Settings…", symbol: "gearshape", key: ",") {
                    close()
                    windows.showSettings()
                }
                PanelRow("Quit Yumi", symbol: "power", key: "q") {
                    NSApp.terminate(nil)
                }
            }
            .padding(YumiSpace.xs)
        }
    }

    /// The main cursor first, then ghosts by label.
    static func sorted(_ cursors: some Sequence<OverlayCursor>) -> [OverlayCursor] {
        cursors.sorted { a, b in
            if (a.kind == .main) != (b.kind == .main) { return a.kind == .main }
            return (a.label ?? a.id) < (b.label ?? b.id)
        }
    }
}

// MARK: Header

/// The cat in its live state, and the status line.
private struct MenuPanelHeader: View {
    let status: AppStatus
    let mainCursor: OverlayCursor?

    var body: some View {
        HStack(spacing: YumiSpace.m) {
            Image("cat-ginger-\((mainCursor?.state ?? Self.catState(for: status)).rawValue)")
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
                .frame(width: 40, height: 40)
                .padding(YumiSpace.xs)
                .background(status == .paused ? YumiColor.hush : YumiColor.halo, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: YumiSpace.xxs) {
                Text("Yumi")
                    .font(YumiFont.headline)
                    .foregroundStyle(YumiColor.brand)
                Text(status.menuTitle)
                    .font(YumiFont.caption)
                    .foregroundStyle(YumiColor.muted)
            }
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }

    /// The cat's pose when no cursor is on screen.
    static func catState(for status: AppStatus) -> CursorState {
        switch status {
        case .listening: .listening
        case .working: .thinking
        case .paused: .paused
        case .ready, .startingUp: .idle
        }
    }
}

// MARK: Cursor rows

/// One running cursor: its cat in its own coat, what it works on, and its state.
private struct CursorRow: View {
    let cursor: OverlayCursor

    var body: some View {
        HStack(spacing: YumiSpace.m) {
            Image("cat-\(cursor.palette.rawValue)-\(cursor.state.rawValue)")
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
                .frame(width: 26, height: 26)
                .accessibilityHidden(true)
            Text(cursor.label ?? (cursor.kind == .main ? "Main task" : "Helper task"))
                .font(YumiFont.label)
                .foregroundStyle(YumiColor.ink)
                .lineLimit(2)
                .truncationMode(.tail)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: YumiSpace.s)
            Text(Self.stateText(cursor.state))
                .font(YumiFont.caption)
                .foregroundStyle(Color(cursor.palette.labelText))
                .padding(.horizontal, YumiSpace.s)
                .padding(.vertical, YumiSpace.xxs)
                .background(Color(cursor.palette.fur), in: Capsule())
                .fixedSize()
        }
        .padding(.horizontal, YumiSpace.s)
        .padding(.vertical, YumiSpace.xs)
        .background(YumiColor.surface, in: RoundedRectangle(cornerRadius: YumiRadius.field, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    /// Plain words for a cursor's state. Stuck is gentle (SPEC-04).
    static func stateText(_ state: CursorState) -> String {
        switch state {
        case .idle: "Ready"
        case .moving: "Moving"
        case .listening: "Listening"
        case .thinking: "Thinking"
        case .acting: "Working"
        case .waitingForUser: "Waiting for you"
        case .paused: "Paused"
        case .done: "Done"
        case .stuck: "Needs a hand"
        }
    }
}

// MARK: Rows

/// A full-width action row like a menu item: icon, title, and its key on the right.
private struct PanelRow: View {
    let title: String
    let symbol: String
    let key: KeyEquivalent
    let modifiers: EventModifiers
    let hush: Bool
    let action: () -> Void

    init(_ title: String, symbol: String, key: KeyEquivalent, modifiers: EventModifiers = .command, hush: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.symbol = symbol
        self.key = key
        self.modifiers = modifiers
        self.hush = hush
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            HStack(spacing: YumiSpace.s) {
                Image(systemName: symbol)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(hush ? YumiColor.onHush : YumiColor.muted)
                    .frame(width: 22, height: 22)
                    .background(hush ? YumiColor.hush : Color.clear, in: Circle())
                Text(title)
                    .font(YumiFont.body)
                Spacer()
                Text(Self.keyText(key, modifiers))
                    .font(YumiFont.caption)
                    .foregroundStyle(YumiColor.muted)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(PanelRowStyle())
        .keyboardShortcut(key, modifiers: modifiers)
    }

    static func keyText(_ key: KeyEquivalent, _ modifiers: EventModifiers) -> String {
        var text = ""
        if modifiers.contains(.control) { text += "⌃" }
        if modifiers.contains(.option) { text += "⌥" }
        if modifiers.contains(.shift) { text += "⇧" }
        if modifiers.contains(.command) { text += "⌘" }
        return text + String(key.character).uppercased()
    }
}

/// A row's hover and press: a raised fill, shown at once with no animation, since rows are used
/// many times a day.
private struct PanelRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        PanelRowBody(configuration: configuration)
    }
}

private struct PanelRowBody: View {
    let configuration: ButtonStyleConfiguration
    @State private var hovering = false

    var body: some View {
        configuration.label
            .padding(.horizontal, YumiSpace.s)
            .padding(.vertical, 5)
            .background(
                hovering || configuration.isPressed ? YumiColor.surfaceRaised : Color.clear,
                in: RoundedRectangle(cornerRadius: YumiRadius.control, style: .continuous)
            )
            .onHover { hovering = $0 }
    }
}

private struct PanelDivider: View {
    var body: some View {
        Rectangle().fill(YumiColor.line).frame(height: 1)
    }
}

/// The phone's status, and pairing when there is no phone (OBJ-27.6).
private struct PhoneRow: View {
    let phone: PhoneLink
    let close: () -> Void

    var body: some View {
        if phone.pairedDevice == nil {
            PanelRow("Pair your phone…", symbol: "iphone", key: "j") {
                close()
                PairingWindow.show(phone: phone)
            }
        } else {
            HStack(spacing: YumiSpace.s) {
                Image(systemName: "iphone")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(YumiColor.muted)
                    .frame(width: 22, height: 22)
                Text(PhoneMenuItems.statusLine(connection: phone.connection, device: phone.pairedDevice))
                    .font(YumiFont.body)
                    .foregroundStyle(YumiColor.muted)
                Spacer()
            }
            .padding(.horizontal, YumiSpace.s)
            .padding(.vertical, 5)
        }
    }
}

#if DEBUG
/// Debug aids, grouped quietly behind one disclosure.
private struct DebugRows: View {
    let model: AppModel
    let harness: HarnessLink
    let close: () -> Void
    @State private var open = false

    var body: some View {
        DisclosureGroup(isExpanded: $open) {
            VStack(alignment: .leading, spacing: YumiSpace.xs) {
                if let mock = model.mockHarnessName {
                    Text("Using the \(mock)")
                        .font(YumiFont.caption)
                        .foregroundStyle(YumiColor.muted)
                    Button("Send sample goal to the mock") { harness.submitSampleGoal() }
                        .disabled(!model.harnessReady)
                }
                Button("GUI debug…") {
                    close()
                    GuiDebugWindow.show(executor: harness.gui, overlay: harness.overlay)
                }
                CursorDebugMenu(actions: CursorDebugActions(overlay: harness.overlay))
                    .fixedSize()
            }
            .buttonStyle(.link)
            .font(YumiFont.caption)
            .padding(.top, YumiSpace.xs)
        } label: {
            Text("Debug")
                .font(YumiFont.caption)
                .foregroundStyle(YumiColor.muted)
        }
        .padding(.horizontal, YumiSpace.m)
        .padding(.vertical, YumiSpace.s)
    }
}
#endif
