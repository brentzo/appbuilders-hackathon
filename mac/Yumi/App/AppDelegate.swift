import AppKit
import OSLog
import YumiProtocol

final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel(permissions: DebugLaunchOptions.permissionCenter())
    private(set) lazy var windows = WindowCoordinator(model: model)
    /// The real harness (OBJ-03) by default. `-YumiMockHarness YES` uses the mock harness instead,
    /// and so does any mock option: `-YumiMockScript <name>` picks its event script (default
    /// `keynote-export`), `-YumiMockFail method=kind,...` makes methods fail, and
    /// `-YumiSendSampleGoal YES` submits the sample goal once connected. All are read from the launch
    /// arguments only, and work in Release too, which is what smoke tests run.
    private(set) lazy var harness = HarnessLink(
        model: model,
        launcher: Self.usesMockHarness
            ? MockHarnessLauncher(
                script: LaunchArguments.string("YumiMockScript") ?? "keynote-export",
                failures: LaunchArguments.string("YumiMockFail"),
                socketPath: HarnessSocket.defaultPath
            )
            : RealHarnessLauncher(),
        socketPath: HarnessSocket.defaultPath
    )

    static var usesMockHarness: Bool {
        LaunchArguments.bool("YumiMockHarness") || LaunchArguments.bool("YumiSendSampleGoal")
            || LaunchArguments.string("YumiMockScript") != nil || LaunchArguments.string("YumiMockFail") != nil
    }
    private var terminationSignal: DispatchSourceSignal?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "app")

    /// True when the app is only hosting unit tests, so it should not open windows.
    private var isHostingTests: Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        log.info("Yumi launched")
        guard !isHostingTests else { return }

        model.permissions.observeActivation()
        quitCleanlyOnSIGTERM()
        harness.onUserError = { [weak self] error in self?.showError(error) }
        harness.start()
        if LaunchArguments.bool("YumiSendSampleGoal") {
            harness.submitSampleGoalWhenConnected()
        }
        if DebugLaunchOptions.apply(to: self) { return }
        if !model.permissions.allGranted {
            windows.showOnboarding()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        harness.stop()
    }

    /// Shows an error from the harness or a failed call, through the one error presenter.
    @discardableResult
    func showError(_ error: UserError) -> NSWindow {
        log.notice("Showing the \(error.kind.rawValue, privacy: .public) error")
        return windows.showError(ErrorPresenter.present(error)) { [weak self] action in
            self?.perform(action)
        }
    }

    private func perform(_ action: ErrorButtonAction) {
        switch action {
        case .openSettings(let permission):
            Task { await model.permissions.openSettings(for: permission) }
        case .cancelTask(let taskId):
            harness.cancelTask(taskId)
        case .pairPhone:
            PairingWindow.show()
        case .dismiss, .notAvailableYet:
            break
        }
    }

    /// `kill` and logout send SIGTERM, which would end Yumi without `applicationWillTerminate`
    /// and leave the harness running. Turn it into a normal quit instead.
    private func quitCleanlyOnSIGTERM() {
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        source.setEventHandler {
            NSApp.terminate(nil)
        }
        source.resume()
        terminationSignal = source
    }
}
