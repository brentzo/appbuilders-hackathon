import SwiftUI

struct SettingsView: View {
    @Bindable var store: SettingsStore

    var body: some View {
        Form {
            Section("Voice") {
                Toggle(isOn: $store.wakeWordEnabled) {
                    Text("Listen for “Hey Yumi”")
                    Text("Push-to-talk always works, even with this off.")
                }
                LabeledContent("Push-to-talk shortcut") {
                    ShortcutRecorder(shortcut: $store.pushToTalkShortcut)
                }
            }

            Section("Cursors") {
                Picker(selection: $store.visibleCursorCap) {
                    ForEach(YumiSettings.visibleCursorCapRange, id: \.self) { count in
                        Text("\(count)").tag(count)
                    }
                } label: {
                    Text("Visible cursors at once")
                    Text("Extra tasks wait their turn.")
                }
                .pickerStyle(.segmented)
                .fixedSize()
            }

            PhoneSettingsSection(phone: .shared)

            Section("Demo") {
                Toggle(isOn: $store.demoModeEnabled) {
                    Text("Demo mode")
                    Text("Arrange windows side by side without asking first.")
                }
            }
        }
        .formStyle(.grouped)
        .frame(width: 460)
        .fixedSize(horizontal: false, vertical: true)
    }
}
