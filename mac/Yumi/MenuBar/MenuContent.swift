import SwiftUI

/// The menu shown when the user clicks Yumi in the menu bar.
struct MenuContent: View {
    let model: AppModel
    let windows: WindowCoordinator

    var body: some View {
        // A plain Text is shown as a disabled menu item: information, not an action.
        Text(model.status.menuTitle)

        Divider()

        if !model.permissions.allGranted {
            Button("Set up permissions…") {
                windows.showOnboarding()
            }
        }

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
