import AppKit
import OSLog

final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel(permissions: DebugLaunchOptions.permissionCenter())
    private(set) lazy var windows = WindowCoordinator(model: model)
    private var harness: HarnessSupervisor?
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
        startHarness()
        if DebugLaunchOptions.apply(to: self) { return }
        if !model.permissions.allGranted {
            windows.showOnboarding()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        harness?.stop()
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

    /// Until OBJ-14.8 the harness is always the mock. `-YumiMockScript <name>` picks its event
    /// script (default `keynote-export`) and `-YumiMockFail method=kind,...` makes methods fail.
    private func startHarness() {
        let defaults = UserDefaults.standard
        let launcher = MockHarnessLauncher(
            script: defaults.string(forKey: "YumiMockScript") ?? "keynote-export",
            failures: defaults.string(forKey: "YumiMockFail"),
            socketPath: HarnessSocket.defaultPath
        )
        model.mockHarnessName = launcher.isMock ? launcher.displayName : nil
        let supervisor = HarnessSupervisor(launcher: launcher)
        supervisor.onStateChange = { [weak self] state in
            guard let self else { return }
            if case .running = state { model.harnessReady = true } else { model.harnessReady = false }
        }
        harness = supervisor
        supervisor.start()
    }
}
