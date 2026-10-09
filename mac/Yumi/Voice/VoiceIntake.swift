import AppKit
import OSLog
import YumiProtocol

/// Push-to-talk from shortcut to goal (OBJ-15): hold the shortcut to record, release to stop, and
/// the transcript goes to the harness as a new goal. Audio stays in memory on this Mac and is
/// dropped once transcribed.
final class VoiceIntake: ReplyListening {
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
    /// Test aid: recordings played in place of the microphone for a goal and for a spoken answer.
    /// Debug builds read them from `-YumiVoiceFile` and `-YumiReplyFile`.
    var testRecordings: (goal: String?, reply: String?) = {
        #if DEBUG
        (LaunchArguments.string("YumiVoiceFile"), LaunchArguments.string("YumiReplyFile"))
        #else
        (nil, nil)
        #endif
    }()
    /// Whether the shortcut is down right now, so listening can start once a permission prompt is answered.
    private var isHeld = false
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "voice")

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
        guard let session = openMicrophone(promptIfNeeded: true, endpoint: nil) else { return }
        self.session = session
        phase = .listening
        log.notice("Listening")
    }

    func stopListening() {
        guard phase == .listening, let session else { return }
        closeMicrophone()
        releasedAt = .now
        phase = .transcribing
        Task { await finish(session) }
    }

    private func finish(_ session: RecognitionSession) async {
        defer {
            self.session = nil
            phase = .idle
        }
        let transcript: String
        do {
            transcript = try await session.finish().trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            log.error("Transcription failed: \(String(describing: error), privacy: .public)")
            dropCursor()
            showError(UserError(kind: .didNotCatchSpeech))
            return
        }
        if let releasedAt {
            log.notice("Transcript ready \((ContinuousClock.now - releasedAt).formatted(.units(allowed: [.milliseconds])), privacy: .public) after release")
        }
        guard !transcript.isEmpty else {
            dropCursor()
            showError(UserError(kind: .didNotCatchSpeech))
            return
        }
        log.notice("Heard a goal of \(transcript.count) characters")
        // Goal confirmation takes the main cursor from here (OBJ-17).
        spawnedCursor = false
        submit(transcript)
    }

    // MARK: After the wake word

    /// After the wake word (OBJ-16.4): the same microphone, recognizers, and indicator as
    /// push-to-talk, ended by the user stopping speaking. Nothing heard is quietly dropped, since a
    /// false wake-up should not show an error.
    func listenForGoalAfterWakeWord() async {
        guard phase == .idle else { return }
        guard let transcript = await listenForReply() else {
            dropCursor()
            return
        }
        log.notice("Heard a goal of \(transcript.count) characters after the wake word")
        spawnedCursor = false
        submit(transcript)
    }

    // MARK: Spoken answers

    /// Hands-free answer right after Yumi asks something (OBJ-17.5): the same microphone,
    /// recognizers, and indicator as push-to-talk, ended by a short silence instead of a key.
    func listenForReply() async -> String? {
        guard case .heard(let text) = await listenHandsFree(promptIfNeeded: false) else { return nil }
        return text
    }

    /// "Talk" in the menu bar panel: push-to-talk without a key to hold, ended by a short
    /// silence. Unlike the wake word, the user asked on purpose, so silence says "Didn't catch speech".
    func talk() async {
        guard phase == .idle else { return }
        switch await listenHandsFree(promptIfNeeded: true) {
        case .heard(let transcript):
            log.notice("Heard a goal of \(transcript.count) characters from Talk")
            spawnedCursor = false
            submit(transcript)
        case .nothing:
            dropCursor()
            showError(UserError(kind: .didNotCatchSpeech))
        case .notStarted:
            break
        }
    }

    private enum HandsFree {
        /// The microphone did not open; the reason was shown or logged.
        case notStarted
        case nothing
        case heard(String)
    }

    private func listenHandsFree(promptIfNeeded: Bool) async -> HandsFree {
        guard phase == .idle else { return .notStarted }
        let ended = Outcome<SpeechEndpoint.Outcome>()
        let endpoint = SpeechEndpoint { ended.resolve(.success($0)) }
        guard let session = openMicrophone(promptIfNeeded: promptIfNeeded, endpoint: endpoint) else { return .notStarted }
        self.session = session
        phase = .listening
        defer {
            self.session = nil
            phase = .idle
        }
        // Wall-clock cap too, in case the microphone delivers nothing at all.
        Task {
            try? await Task.sleep(for: .seconds(SpeechEndpoint.Timing().longest + 1))
            ended.resolve(.success(.tooLong))
        }
        let outcome = (try? await ended.value()) ?? .silent
        closeMicrophone()
        guard outcome != .silent else {
            session.cancel()
            log.notice("Nothing said")
            return .nothing
        }
        do {
            let text = try await session.finish().trimmingCharacters(in: .whitespacesAndNewlines)
            log.notice("Heard \(text.count) characters hands-free")
            return text.isEmpty ? .nothing : .heard(text)
        } catch {
            log.error("Not transcribed: \(String(describing: error), privacy: .public)")
            return .nothing
        }
    }

    // MARK: Microphone

    /// Whether the main cursor was spawned for this recording, so a failed one can take it away.
    private var spawnedCursor = false

    /// Checks the permissions, starts the recognizers and the microphone, and shows the listening
    /// indicator (SPEC-01 requirement 8). Nil when listening cannot start; the reason is shown or logged.
    private func openMicrophone(promptIfNeeded: Bool, endpoint: SpeechEndpoint?) -> RecognitionSession? {
        // Test aid: a recording played in place of the microphone, so no microphone permission.
        let testRecording = endpoint == nil ? testRecordings.goal : testRecordings.reply
        switch testRecording != nil ? .granted : model.permissions.check(.microphone) {
        case .granted:
            break
        case .notAsked:
            guard promptIfNeeded else { return nil }
            // macOS's own prompt. Listens if the shortcut is still held once it is answered.
            Task {
                await model.permissions.openSettings(for: .microphone)
                if isHeld, model.permissions.check(.microphone) == .granted { startListening() }
            }
            return nil
        case .missing:
            if promptIfNeeded { showError(UserError(kind: .microphonePermissionMissing)) }
            return nil
        }
        switch NativeRecognizer.authorized {
        case true?:
            break
        case nil:
            if promptIfNeeded { Task { await NativeRecognitionSession.requestAuthorization() } }
            return nil
        case false?:
            log.error("Speech recognition is turned off for Yumi")
            if promptIfNeeded { showError(UserError(kind: .didNotCatchSpeech)) }
            return nil
        }
        let session: RecognitionSession
        do {
            let recognizers = try FallbackRecognitionSession(order: RecognizerRule.order(
                speaksTaglish: model.settings.speaksTaglish,
                whisperReady: whisperReady
            ))
            session = endpoint.map { EndpointedSession(recognizers, endpoint: $0) } ?? recognizers
            // The words so far, live in the main cat's bubble while the user speaks.
            session.observePartials { [weak self] text in
                Task { @MainActor in
                    guard let self, self.model.isListening else { return }
                    self.overlay.update(GoalConfirmation.mainCursorId) { $0.transcript = text }
                }
            }
            if let testRecording {
                try MicrophoneCapture.feed(URL(fileURLWithPath: testRecording), to: session)
            } else {
                try microphone.start(feeding: session)
            }
        } catch {
            log.error("Could not start listening: \(String(describing: error), privacy: .public)")
            microphone.stop()
            if promptIfNeeded { showError(UserError(kind: .didNotCatchSpeech)) }
            return nil
        }
        model.isListening = true
        let mainCursor = GoalConfirmation.mainCursorId
        if overlay.clickPoint(of: mainCursor) == nil {
            overlay.spawn(id: mainCursor, kind: .main, label: nil, at: Self.nearPointer())
            spawnedCursor = true
        }
        overlay.update(mainCursor) { $0.state = .listening }
        return session
    }

    /// The microphone is off, so the indicator goes too (SPEC-01 requirement 8).
    private func closeMicrophone() {
        microphone.stop()
        model.isListening = false
        overlay.update(GoalConfirmation.mainCursorId) {
            $0.state = .thinking
            $0.transcript = nil
        }
    }

    /// Nothing usable was heard for a new goal: the cursor this recording brought goes away.
    private func dropCursor() {
        if spawnedCursor { overlay.fade(id: GoalConfirmation.mainCursorId) }
        spawnedCursor = false
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
