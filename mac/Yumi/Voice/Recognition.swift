import AVFoundation
import OSLog
import Speech

/// One push-to-talk recording on its way to text. The microphone tap calls `append` on the audio
/// thread while the shortcut is held; `finish` runs after the release and returns the transcript.
nonisolated protocol RecognitionSession: AnyObject, Sendable {
    func append(_ buffer: AVAudioPCMBuffer)
    /// The transcript, empty when nothing was said.
    func finish() async throws -> String
    func cancel()
    /// Reports the words heard so far while the user is still speaking, from any thread.
    /// Recognizers that cannot do that (Whisper) never call it.
    func observePartials(_ handler: @escaping @Sendable (String) -> Void)
}

nonisolated extension RecognitionSession {
    func observePartials(_ handler: @escaping @Sendable (String) -> Void) {}
}

nonisolated enum RecognitionFailure: Error, Equatable {
    /// The recognizer cannot run on this Mac for this language without the network.
    case onDeviceUnavailable
    /// The user turned speech recognition off for Yumi in System Settings.
    case notAuthorized
    /// The Whisper model is not loaded (yet, or it failed to load).
    case modelNotReady
}

/// Records the default input device while the shortcut is held. A new engine per recording, so a
/// microphone plugged in since the last one is picked up.
nonisolated final class MicrophoneCapture: @unchecked Sendable {
    private var engine: AVAudioEngine?
    private var player: DispatchSourceTimer?
    /// Where the audio goes. Cleared on `stop`, so nothing arrives after it.
    private let destination = Locked<(@Sendable (AVAudioPCMBuffer) -> Void)?>(nil)

    func start(feeding session: RecognitionSession) throws {
        try start { session.append($0) }
    }

    func start(sending: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws {
        destination.set(sending)
        let engine = AVAudioEngine()
        let input = engine.inputNode
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { [destination] buffer, _ in
            destination.get()?(buffer)
        }
        engine.prepare()
        try engine.start()
        self.engine = engine
    }

    /// Test aid for `-YumiWakeWordFile` (Debug builds): plays a recording at real-time pace, as the
    /// microphone would hear it, then silence, or the recording again with `loops`.
    func play(_ url: URL, loops: Bool, sending: @escaping @Sendable (AVAudioPCMBuffer) -> Void) throws {
        destination.set(sending)
        let file = try AVAudioFile(forReading: url)
        let frames: AVAudioFrameCount = 1024
        var buffers: [AVAudioPCMBuffer] = []
        while file.framePosition < file.length {
            guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames) else { break }
            try file.read(into: buffer)
            buffers.append(buffer)
        }
        guard let silence = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: frames) else { return }
        silence.frameLength = frames
        for channel in 0..<Int(silence.format.channelCount) {
            silence.floatChannelData?[channel].update(repeating: 0, count: Int(frames))
        }
        nonisolated(unsafe) var position = 0
        let timer = DispatchSource.makeTimerSource(queue: DispatchQueue(label: "ph.appbuilders.yumi.recording"))
        timer.schedule(deadline: .now(), repeating: Double(frames) / file.processingFormat.sampleRate)
        timer.setEventHandler { [destination] in
            if position == buffers.count, loops { position = 0 }
            destination.get()?(position < buffers.count ? buffers[position] : silence)
            position = min(position + 1, buffers.count)
        }
        timer.resume()
        player = timer
    }

    /// Test aid for `-YumiVoiceFile` and `-YumiReplyFile` (Debug builds): sends a whole recording,
    /// in microphone-sized buffers.
    static func feed(_ url: URL, to session: RecognitionSession) throws {
        let file = try AVAudioFile(forReading: url)
        while file.framePosition < file.length {
            guard let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 1024) else { return }
            try file.read(into: buffer)
            session.append(buffer)
        }
        // A second of silence after the words, as a microphone would hear before the user stops.
        for _ in 0..<Int(file.processingFormat.sampleRate / 1024) {
            guard let silence = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 1024) else { return }
            silence.frameLength = 1024
            for channel in 0..<Int(silence.format.channelCount) {
                silence.floatChannelData?[channel].update(repeating: 0, count: 1024)
            }
            session.append(silence)
        }
    }

    func stop() {
        destination.set(nil)
        player?.cancel()
        player = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
    }
}

/// Apple's recognizer, forced on-device (OBJ-15.4, SPEC-01 requirement 2): if this Mac has no
/// on-device model for the language, it fails instead of using Apple's servers.
nonisolated final class NativeRecognitionSession: RecognitionSession, @unchecked Sendable {
    /// English commands only (SPEC-01 requirement 2). Taglish goes to Whisper.
    static let locale = Locale(identifier: "en-US")

    private let request = SFSpeechAudioBufferRecognitionRequest()
    private var task: SFSpeechRecognitionTask?
    private let outcome = Outcome<String>()
    private let partials = Locked<(@Sendable (String) -> Void)?>(nil)

    /// `contextualStrings` are words to expect, such as "Yumi", which is not in the dictionary.
    init(contextualStrings: [String] = []) throws {
        guard let recognizer = SFSpeechRecognizer(locale: Self.locale), recognizer.supportsOnDeviceRecognition else {
            throw RecognitionFailure.onDeviceUnavailable
        }
        request.requiresOnDeviceRecognition = true
        request.contextualStrings = contextualStrings
        request.shouldReportPartialResults = true
        request.addsPunctuation = true
        task = recognizer.recognitionTask(with: request) { [outcome, partials] result, error in
            if let result, result.isFinal {
                outcome.resolve(.success(result.bestTranscription.formattedString))
            } else if let result {
                partials.get()?(result.bestTranscription.formattedString)
            } else if let error {
                // "No speech detected" arrives as an error; to the user that is silence, not a failure.
                outcome.resolve(Self.isNoSpeech(error) ? .success("") : .failure(Self.isOffline(error) ? RecognitionFailure.onDeviceUnavailable : error))
            }
        }
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        request.append(buffer)
    }

    func observePartials(_ handler: @escaping @Sendable (String) -> Void) {
        partials.set(handler)
    }

    func finish() async throws -> String {
        request.endAudio()
        return try await outcome.value()
    }

    func cancel() {
        task?.cancel()
        outcome.resolve(.success(""))
    }

    static func isNoSpeech(_ error: Error) -> Bool {
        let error = error as NSError
        // kAFAssistantErrorDomain 1110: no speech detected. 203: retry, sent for an empty recording.
        return error.domain == "kAFAssistantErrorDomain" && [1110, 203].contains(error.code)
    }

    /// kLSRErrorDomain 201: on-device recognition needs Siri or Dictation turned on.
    static func isOffline(_ error: Error) -> Bool {
        let error = error as NSError
        return error.domain == "kLSRErrorDomain" && error.code == 201
    }

    /// Speech recognition needs its own permission, even when it runs on the device.
    static var authorized: Bool? {
        switch SFSpeechRecognizer.authorizationStatus() {
        case .authorized: true
        case .notDetermined: nil
        default: false
        }
    }

    /// Shows macOS's prompt for speech recognition.
    static func requestAuthorization() async {
        await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { _ in continuation.resume() }
        }
    }
}

/// A result that arrives once, from any thread, for one waiter.
nonisolated final class Outcome<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var result: Result<Value, Error>?
    private var waiter: CheckedContinuation<Value, Error>?

    func resolve(_ result: Result<Value, Error>) {
        lock.lock()
        guard self.result == nil else { lock.unlock(); return }
        self.result = result
        let waiter = self.waiter
        self.waiter = nil
        lock.unlock()
        waiter?.resume(with: result)
    }

    func value() async throws -> Value {
        try await withCheckedThrowingContinuation { continuation in
            lock.lock()
            if let result {
                lock.unlock()
                continuation.resume(with: result)
            } else {
                waiter = continuation
                lock.unlock()
            }
        }
    }
}
