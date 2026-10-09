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
    private(set) lazy var voice = VoiceIntake(
        model: model,
        overlay: harness.overlay,
        submit: { [weak self] speech in self?.harness.submitSpeech(speech) },
        showError: { [weak self] error in self?.showError(error) }
    )
    /// "Hey Yumi" hands-free (OBJ-16), handing over to the same capture path as push-to-talk.
    private(set) lazy var wakeWord = WakeWordListener(
        model: model,
        isMicrophoneFree: { [weak self] in self?.voice.phase == .idle },
        listenForGoal: { [weak self] in await self?.voice.listenForGoalAfterWakeWord() }
    )
    private var terminationSignal: DispatchSourceSignal?
    /// False when this launch gave way to a Yumi that was already running, so quitting leaves its
    /// harness alone.
    private var started = false
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "app")

    /// True when the app is only hosting unit tests, so it should not open windows or start the
    /// harness.
    private var isHostingTests: Bool { TestHost.isActive }

    func applicationDidFinishLaunching(_ notification: Notification) {
        log.info("Yumi launched")
        guard !isHostingTests else { return }
        if let first = SingleInstance.runningYumiToDeferTo() {
            log.notice("Yumi is already running (pid \(first.processIdentifier)); quitting this launch")
            first.activate()
            NSApp.terminate(nil)
            return
        }
        started = true

        model.permissions.observeActivation()
        quitCleanlyOnSIGTERM()
        harness.onUserError = { [weak self] error in self?.showError(error) }
        harness.start()
        voice.start()
        harness.confirmation.listener = voice
        wakeWord.start()
        if LaunchArguments.bool("YumiSendSampleGoal") {
            harness.submitSampleGoalWhenConnected()
        }
        if DebugLaunchOptions.apply(to: self) { return }
        if !model.permissions.allGranted {
            windows.showOnboarding()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        guard started else { return }
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
        case .resumeTask(let taskId):
            harness.resumeTask(taskId)
        case .pairPhone:
            PairingWindow.show()
        case .typeGoal:
            showTypeGoal()
        case .dismiss, .notAvailableYet:
            break
        }
    }

    /// The menu bar panel's content, also used by the `-YumiOpen menu` snapshot.
    func menuPanel(close: @escaping () -> Void) -> MenuPanel {
        MenuPanel(
            model: model, windows: windows, harness: harness,
            talk: { [weak self] in Task { await self?.voice.talk() } },
            typeGoal: { [weak self] in self?.showTypeGoal() },
            close: close
        )
    }

    @discardableResult
    func showTypeGoal() -> NSWindow {
        TypeGoalWindow.show { [weak self] goal in
            self?.harness.submitGoal(goal)
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
