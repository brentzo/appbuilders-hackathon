import AppKit
import OSLog
import YumiProtocol

/// Push-to-talk from shortcut to goal (OBJ-15): hold the shortcut to record, release to stop, and
/// the transcript goes to the harness as a new goal. Audio stays in memory on this Mac and is
/// dropped once transcribed.
final class VoiceIntake {
    enum Phase: Equatable {
        case idle, listening, transcribing
    }

    private(set) var phase: Phase = .idle

    private let model: AppModel
    private let overlay: CursorOverlay
    private let submit: (String) -> Void
    private let showError: (UserError) -> Void
    private let hotKey = PushToTalkHotKey()
    private let microphone = MicrophoneCapture()
    private var session: RecognitionSession?
    private var releasedAt: ContinuousClock.Instant?
    /// Whether the shortcut is down right now, so listening can start once a permission prompt is answered.
    private var isHeld = false
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "voice")

    /// The cursor that shows Yumi is listening (OBJ-15.2), next to the user's pointer.
    static let cursorId = "voice"

    init(model: AppModel, overlay: CursorOverlay, submit: @escaping (String) -> Void, showError: @escaping (UserError) -> Void) {
        self.model = model
        self.overlay = overlay
        self.submit = submit
        self.showError = showError
    }

    func start() {
        hotKey.onPress = { [weak self] in
            self?.isHeld = true
            self?.startListening()
        }
        hotKey.onRelease = { [weak self] in
            self?.isHeld = false
            self?.stopListening()
        }
        followShortcutSetting()
        followTaglishSetting()
        #if DEBUG
        observeDebugPushToTalk()
        #endif
        Task.detached { await NativeRecognizer.prepare() }
    }

    /// Whether Whisper is loaded, kept here so a press never waits on the model.
    private var whisperReady = false

    /// Loads Whisper when "I speak Taglish" is on, at launch or when the user turns it on. It stays
    /// loaded after that, as the fallback for Apple's recognizer.
    private func followTaglishSetting() {
        let speaksTaglish = withObservationTracking {
            model.settings.speaksTaglish
        } onChange: { [weak self] in
            Task { @MainActor in self?.followTaglishSetting() }
        }
        guard speaksTaglish, !whisperReady else { return }
        Task {
            await WhisperModel.shared.load()
            whisperReady = await WhisperModel.shared.isReady
        }
    }

    /// Registers the shortcut from settings, and again whenever the user changes it.
    private func followShortcutSetting() {
        withObservationTracking {
            hotKey.register(model.settings.pushToTalkShortcut)
        } onChange: { [weak self] in
            Task { @MainActor in self?.followShortcutSetting() }
        }
    }

    func startListening() {
        guard phase == .idle else { return }
        switch model.permissions.check(.microphone) {
        case .granted:
            break
        case .notAsked:
            // macOS's own prompt, or an instant answer if macOS already knows. Listens if still held.
            Task {
                await model.permissions.openSettings(for: .microphone)
                if isHeld, model.permissions.check(.microphone) == .granted { startListening() }
            }
            return
        case .missing:
            showError(UserError(kind: .microphonePermissionMissing))
            return
        }
        switch NativeRecognizer.authorized {
        case true?:
            break
        case nil:
            Task { await NativeRecognitionSession.requestAuthorization() }
            return
        case false?:
            log.error("Speech recognition is turned off for Yumi")
            showError(UserError(kind: .didNotCatchSpeech))
            return
        }
        do {
            let session = try FallbackRecognitionSession(order: RecognizerRule.order(
                speaksTaglish: model.settings.speaksTaglish,
                whisperReady: whisperReady
            ))
            #if DEBUG
            if let path = LaunchArguments.string("YumiVoiceFile") {
                // Test aid: plays a recording into the recognizer in place of the microphone.
                try MicrophoneCapture.feed(URL(fileURLWithPath: path), to: session)
            } else {
                try microphone.start(feeding: session)
            }
            #else
            try microphone.start(feeding: session)
            #endif
            self.session = session
        } catch {
            log.error("Could not start listening: \(String(describing: error), privacy: .public)")
            microphone.stop()
            showError(UserError(kind: .didNotCatchSpeech))
            return
        }
        phase = .listening
        model.isListening = true
        overlay.spawn(id: Self.cursorId, kind: .main, label: nil, at: Self.nearPointer())
        overlay.update(Self.cursorId) { $0.state = .listening }
        log.notice("Listening")
    }

    func stopListening() {
        guard phase == .listening, let session else { return }
        microphone.stop()
        releasedAt = .now
        phase = .transcribing
        // The microphone is off now, so the indicator goes too (SPEC-01 requirement 8).
        model.isListening = false
        overlay.update(Self.cursorId) { $0.state = .thinking }
        Task { await finish(session) }
    }

    private func finish(_ session: RecognitionSession) async {
        defer {
            self.session = nil
            phase = .idle
            overlay.fade(id: Self.cursorId)
        }
        let transcript: String
        do {
            transcript = try await session.finish().trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            log.error("Transcription failed: \(String(describing: error), privacy: .public)")
            showError(UserError(kind: .didNotCatchSpeech))
            return
        }
        if let releasedAt {
            log.notice("Transcript ready \((ContinuousClock.now - releasedAt).formatted(.units(allowed: [.milliseconds])), privacy: .public) after release")
        }
        guard !transcript.isEmpty else {
            showError(UserError(kind: .didNotCatchSpeech))
            return
        }
        log.notice("Heard a goal of \(transcript.count) characters")
        submit(transcript)
    }

    #if DEBUG
    /// Test aid: scripts press and release push-to-talk with the distributed notification
    /// `ph.appbuilders.yumi.debug.pushToTalk` and object `press` or `release`, because synthetic
    /// key events do not reliably reach a Carbon hot key.
    private func observeDebugPushToTalk() {
        DistributedNotificationCenter.default().addObserver(
            forName: Notification.Name("ph.appbuilders.yumi.debug.pushToTalk"), object: nil, queue: .main
        ) { [weak self] note in
            let press = note.object as? String == "press"
            MainActor.assumeIsolated {
                if press { self?.hotKey.onPress?() } else { self?.hotKey.onRelease?() }
            }
        }
    }
    #endif

    private static func nearPointer() -> CGPoint {
        let mouse = NSEvent.mouseLocation
        return CGPoint(x: mouse.x + 28, y: mouse.y - 28)
    }
}
