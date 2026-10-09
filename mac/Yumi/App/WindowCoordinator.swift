import AppKit
import SwiftUI

/// Opens Yumi's windows. Yumi has no Dock icon, so each window activates the app when shown,
/// otherwise it would open behind the frontmost app.
final class WindowCoordinator {
    private let model: AppModel
    private var settingsWindow: NSWindow?
    private var onboardingWindow: NSWindow?
    private var onboardingCloseObserver: NSObjectProtocol?
    private var errorWindow: NSWindow?

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
        if onboardingWindow == nil {
            onboardingCloseObserver = NotificationCenter.default.addObserver(
                forName: NSWindow.willCloseNotification, object: window, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated { self?.model.permissions.stopPolling() }
            }
        }
        onboardingWindow = window
        model.permissions.startPolling()
        present(window)
        return window
    }

    /// Shows an error, replacing any error already showing. `perform` runs a button's action; the
    /// window closes after every action.
    @discardableResult
    func showError(_ error: PresentedError, perform: @escaping (ErrorButtonAction) -> Void) -> NSWindow {
        errorWindow?.close()
        let window = makeWindow(
            title: "Yumi",
            content: ErrorView(error: error) { [weak self] action in
                perform(action)
                self?.errorWindow?.close()
            }
        )
        window.level = .floating
        errorWindow = window
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
