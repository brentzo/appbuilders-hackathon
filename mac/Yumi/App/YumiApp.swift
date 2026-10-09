import SwiftUI

/// Yumi's menu bar app. It has no Dock icon (`LSUIElement`), so the menu bar item is its only
/// permanent surface. Windows (onboarding, settings) are owned by `AppDelegate`.
@main
struct YumiApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        MenuBarExtra {
            MenuContent(model: appDelegate.model, windows: appDelegate.windows)
        } label: {
            // Stand-in until the Rive cat from OBJ-10/OBJ-19 provides a menu bar icon.
            Image(systemName: "cat")
                .accessibilityLabel("Yumi")
        }
        .menuBarExtraStyle(.menu)
    }
}
