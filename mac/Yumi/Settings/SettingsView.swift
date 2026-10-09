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
        }
        .formStyle(.grouped)
        .scrollContentBackground(.hidden)
        .frame(width: 460)
        .yumiWindow()
        .fixedSize(horizontal: false, vertical: true)
    }
}
