import AppKit
import SwiftUI

/// Opens Yumi's windows. Yumi has no Dock icon, so each window activates the app when shown,
/// otherwise it would open behind the frontmost app.
final class WindowCoordinator {
    private let model: AppModel
    private var settingsWindow: NSWindow?
    private var onboardingWindow: NSWindow?

    init(model: AppModel) {
        self.model = model
    }

    @discardableResult
    func showSettings() -> NSWindow {
        let window = settingsWindow ?? makeWindow(
            title: "Yumi Settings",
            content: SettingsView(store: model.settings)
        )
        settingsWindow = window
        present(window)
        return window
    }

    @discardableResult
    func showOnboarding() -> NSWindow {
        let window = onboardingWindow ?? makeWindow(
            title: "Welcome to Yumi",
            content: OnboardingView(permissions: model.permissions) { [weak self] in
                self?.onboardingWindow?.close()
            }
        )
        onboardingWindow = window
        present(window)
        return window
    }

    private func makeWindow(title: String, content: some View) -> NSWindow {
        let window = NSWindow(contentViewController: NSHostingController(rootView: content))
        window.title = title
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.center()
        return window
    }

    private func present(_ window: NSWindow) {
        NSApp.activate()
        window.makeKeyAndOrderFront(nil)
    }
}
