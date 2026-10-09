import SwiftUI

/// The menu shown when the user clicks Yumi in the menu bar.
struct MenuContent: View {
    var body: some View {
        Button("Quit Yumi") {
            NSApp.terminate(nil)
        }
        .keyboardShortcut("q")
    }
}
