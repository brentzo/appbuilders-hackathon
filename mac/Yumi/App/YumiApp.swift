import SwiftUI

/// Yumi's menu bar app. It has no Dock icon (`LSUIElement`), so the menu bar item is its only
/// permanent surface. Windows (onboarding, settings) are owned by `AppDelegate`.
@main
struct YumiApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        MenuBarExtra {
            // SwiftUI builds this at launch. The test host gets no panel: the panel makes the
            // harness link, which starts loading Yumi's voice, and a test run that ends while it
            // loads makes MLX fail at exit.
            if !TestHost.isActive {
                appDelegate.menuPanel {
                    // The menu bar panel is the key window while it is open.
                    NSApp.keyWindow?.close()
                }
            }
        } label: {
            // A template image, so macOS tints it for the menu bar's light, dark, and selected states.
            Image("MenuBarIcon")
                .renderingMode(.template)
                .accessibilityLabel("Yumi")
        }
        .menuBarExtraStyle(.window)
    }
}
