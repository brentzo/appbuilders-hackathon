import SwiftUI

/// The menu shown when the user clicks Yumi in the menu bar.
struct MenuContent: View {
    let model: AppModel
    let windows: WindowCoordinator

    var body: some View {
        Button("Settings…") {
            windows.showSettings()
        }
        .keyboardShortcut(",")

        Divider()

        Button("Quit Yumi") {
            NSApp.terminate(nil)
        }
        .keyboardShortcut("q")
    }
}
