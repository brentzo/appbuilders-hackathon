import SwiftUI

struct SettingsView: View {
    @Bindable var store: SettingsStore
    /// Read where sounds play (the cats' meow). A plain defaults key, so any part of the app can
    /// check it without the settings store.
    @AppStorage(SettingsView.playSoundsKey) private var playSounds = true

    static let playSoundsKey = "YumiPlaySounds"

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
                Toggle(isOn: $store.speaksTaglish) {
                    Text("I speak Taglish")
                    Text("Yumi understands Tagalog and English mixed. It takes a moment longer.")
                }
                Toggle(isOn: $store.autoMode) {
                    Text("Auto mode")
                    Text("Start right away, without repeating your goal back. Yumi still asks before sending or deleting anything.")
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
                Toggle(isOn: $playSounds) {
                    Text("Play sounds")
                    Text("A cat meows when it finishes its task.")
                }
            }

            PhoneSettingsSection(phone: .shared)

            Section("Demo") {
                Toggle(isOn: $store.demoModeEnabled) {
                    Text("Demo mode")
                    Text("Arrange windows side by side without asking first.")
                }
            }

            Section("Troubleshooting") {
                Toggle(isOn: $store.debugMode) {
                    Text("Debug mode")
                    Text("Keep detailed logs on this Mac for 7 days, and click a cat's bubble or a helper to see what it's thinking.")
                }
            }
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .frame(width: 460)
        .yumiWindow()
        .fixedSize(horizontal: false, vertical: true)
    }
}
