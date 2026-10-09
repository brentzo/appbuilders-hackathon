@preconcurrency import AVFoundation
import OSLog
import Speech

/// The native recognizer on macOS 26 (OBJ-15.4): SpeechAnalyzer with SpeechTranscriber, which
/// always runs on the device. Its English model is downloaded once (`prepare`); audio is never sent.
/// Unlike `SFSpeechRecognizer`, it works with Siri and Dictation turned off.
@available(macOS 26, *)
nonisolated final class AnalyzerRecognitionSession: RecognitionSession, @unchecked Sendable {
    private static let log = Logger(subsystem: "ph.appbuilders.yumi", category: "voice")
    /// The analyzer's input format, known once the model is installed. Nil until then.
    private static let readyFormat = Locked<AVAudioFormat?>(nil)

    /// Installs the English model if needed, so the first push-to-talk does not wait for it.
    static func prepare() async {
        let transcriber = makeTranscriber()
        do {
            if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
                log.notice("Installing the on-device speech model")
                try await request.downloadAndInstall()
            }
            readyFormat.set(await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]))
            log.notice("On-device speech model ready")
        } catch {
            log.error("On-device speech model not ready: \(String(describing: error), privacy: .public)")
        }
    }

    private static func makeTranscriber(reporting: Set<SpeechTranscriber.ReportingOption> = [.volatileResults]) -> SpeechTranscriber {
        SpeechTranscriber(locale: NativeRecognitionSession.locale, transcriptionOptions: [], reportingOptions: reporting, attributeOptions: [])
    }

    private let analyzer: SpeechAnalyzer
    private let format: AVAudioFormat
    private var converter: AVAudioConverter?
    private let input: AsyncStream<AnalyzerInput>.Continuation
    private let started: Task<Void, Error>
    private let collected: Task<String, Error>
    private let partials = Locked<(@Sendable (String) -> Void)?>(nil)

    /// `contextualStrings` are words to expect, such as "Yumi", which is not in the dictionary.
    init(reporting: Set<SpeechTranscriber.ReportingOption> = [.volatileResults], contextualStrings: [String] = []) throws {
        guard let format = Self.readyFormat.get() else { throw RecognitionFailure.modelNotReady }
        let transcriber = Self.makeTranscriber(reporting: reporting)
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let (stream, input) = AsyncStream<AnalyzerInput>.makeStream()
        self.analyzer = analyzer
        self.format = format
        self.input = input
        // Audio appended before the analyzer starts waits in the stream.
        started = Task {
            if !contextualStrings.isEmpty {
                let context = AnalysisContext()
                context.contextualStrings[.general] = contextualStrings
                try? await analyzer.setContext(context)
            }
            try await analyzer.start(inputSequence: stream)
        }
        collected = Task { [partials] in
            // Final results add up to the transcript; a volatile one is the guess for the words
            // after them, shown while the user speaks and replaced as it firms up.
            var text = ""
            for try await result in transcriber.results {
                let words = String(result.text.characters)
                if result.isFinal {
                    text += words
                    partials.get()?(text)
                } else {
                    partials.get()?(text + words)
                }
            }
            return text
        }
    }

    /// Called on the audio thread, one buffer at a time.
    func append(_ buffer: AVAudioPCMBuffer) {
        if converter == nil { converter = AVAudioConverter(from: buffer.format, to: format) }
        guard let converter,
              let output = AVAudioPCMBuffer(
                pcmFormat: format,
                frameCapacity: AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate) + 32
              ) else { return }
        // The converter calls this block synchronously, inside `convert`.
        nonisolated(unsafe) var consumed = false
        nonisolated(unsafe) let source = buffer
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if consumed {
                status.pointee = .noDataNow
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return source
        }
        if output.frameLength > 0 { input.yield(AnalyzerInput(buffer: output)) }
    }

    func observePartials(_ handler: @escaping @Sendable (String) -> Void) {
        partials.set(handler)
    }

    func finish() async throws -> String {
        input.finish()
        try await started.value
        try await analyzer.finalizeAndFinishThroughEndOfInput()
        return try await collected.value
    }

    func cancel() {
        input.finish()
        Task { [analyzer] in await analyzer.cancelAndFinishNow() }
    }
}

/// A value shared between threads.
nonisolated final class Locked<Value: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var value: Value

    init(_ value: Value) { self.value = value }

    func get() -> Value { lock.withLock { value } }
    func set(_ newValue: Value) { lock.withLock { value = newValue } }
}

/// Picks Apple's on-device recognizer for this macOS version.
nonisolated enum NativeRecognizer {
    static func prepare() async {
        if #available(macOS 26, *) { await AnalyzerRecognitionSession.prepare() }
    }

    /// For goals and answers: expecting the demo's words (`GoalVocabulary`), so "export my Keynote
    /// deck" is not heard as "expert my keynote tech".
    static func makeSession() throws -> RecognitionSession {
        if #available(macOS 26, *) { return try AnalyzerRecognitionSession(contextualStrings: GoalVocabulary.contextualStrings) }
        return try NativeRecognitionSession(contextualStrings: GoalVocabulary.contextualStrings)
    }

    /// For spotting "Hey Yumi" (OBJ-58): the quickest guesses, expecting the word "Yumi".
    static func makeSpotterSession() throws -> RecognitionSession {
        if #available(macOS 26, *) {
            return try AnalyzerRecognitionSession(reporting: [.volatileResults, .fastResults], contextualStrings: WakePhrase.contextualStrings)
        }
        return try NativeRecognitionSession(contextualStrings: WakePhrase.contextualStrings)
    }

    /// SpeechAnalyzer needs no permission. `SFSpeechRecognizer` (macOS 15) does.
    static var authorized: Bool? {
        if #available(macOS 26, *) { return true }
        return NativeRecognitionSession.authorized
    }
}
