import SwiftUI

/// The menu shown when the user clicks Yumi in the menu bar.
struct MenuContent: View {
    let model: AppModel
    let windows: WindowCoordinator
    let harness: HarnessLink

    var body: some View {
        // A plain Text is shown as a disabled menu item: information, not an action.
        Text(model.status.menuTitle)
        if let mock = model.mockHarnessName {
            // Debug label: a mock must never pass for the real thing in a demo.
            Text("Using the \(mock)")
        }

        PhoneMenuItems(phone: .shared)

        Divider()

        if !model.permissions.allGranted {
            Button("Set up permissions…") {
                windows.showOnboarding()
            }
        }

        if harness.tiler.state.hasSavedLayout {
            // Windows go back on their own when the task ends; this is the user's way out before that.
            Button("Put windows back") {
                harness.tiler.restoreAll()
            }
        }

        if model.mockHarnessName != nil {
            // Debug aid: plays scripts that start on submitGoal, until voice intake exists (OBJ-15).
            Button("Send sample goal to the mock") {
                harness.submitSampleGoal()
            }
            .disabled(!model.harnessReady)

            CursorDebugMenu(actions: CursorDebugActions(overlay: harness.overlay))
        }

        #if DEBUG
        // Debug aid: reads and presses other apps' elements by hand (OBJ-39.9), with either harness.
        Button("GUI debug…") {
            GuiDebugWindow.show(executor: harness.gui, overlay: harness.overlay)
        }
        #endif

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
