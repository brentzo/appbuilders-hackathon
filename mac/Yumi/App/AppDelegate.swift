import AppKit
import OSLog

final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel(permissions: DebugLaunchOptions.permissionCenter())
    private(set) lazy var windows = WindowCoordinator(model: model)
    /// Until OBJ-14.8 the harness is always the mock. `-YumiMockScript <name>` picks its event
    /// script (default `keynote-export`) and `-YumiMockFail method=kind,...` makes methods fail.
    private(set) lazy var harness = HarnessLink(
        model: model,
        launcher: MockHarnessLauncher(
            script: UserDefaults.standard.string(forKey: "YumiMockScript") ?? "keynote-export",
            failures: UserDefaults.standard.string(forKey: "YumiMockFail"),
            socketPath: HarnessSocket.defaultPath
        ),
        socketPath: HarnessSocket.defaultPath
    )
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
        harness.start()
        if DebugLaunchOptions.apply(to: self) { return }
        if !model.permissions.allGranted {
            windows.showOnboarding()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        harness.stop()
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
