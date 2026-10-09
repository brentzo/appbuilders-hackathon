@preconcurrency import AVFoundation
import Foundation
import OSLog
@preconcurrency import WhisperKit

/// Whisper on the Mac (OBJ-15.3, SPEC-01 requirement 3), for Taglish and long dictation.
///
/// The model is downloaded once into Yumi's support folder, loaded once, and kept ready. Audio is
/// only ever passed to it in memory.
actor WhisperModel {
    static let shared = WhisperModel()

    /// Whisper large-v3-turbo, the stand-in until OBJ-11 picks the Mac model. OpenAI's turbo
    /// release is `large-v3-v20240930` in WhisperKit's naming; `_632MB` is its quantized Core ML
    /// build, picked so it fits next to Qwen3.5-9B on the 16 GB Mac.
    static let modelName = "openai_whisper-large-v3-v20240930_turbo_632MB"

    private static let log = Logger(subsystem: "ph.appbuilders.yumi", category: "voice")
    private var whisper: WhisperKit?
    private var isLoading = false

    var isReady: Bool { whisper != nil }

    static var folder: URL {
        URL.applicationSupportDirectory.appending(path: "Yumi/Models", directoryHint: .isDirectory)
    }

    /// Downloads the model if needed and loads it, once. A call while it loads returns at once.
    func load() async {
        guard whisper == nil, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        let start = ContinuousClock.now
        Self.log.notice("Loading Whisper \(Self.modelName, privacy: .public)")
        do {
            let config = WhisperKitConfig(
                model: Self.modelName,
                downloadBase: Self.folder,
                verbose: false,
                prewarm: true,
                load: true,
                download: true
            )
            whisper = try await WhisperKit(config)
            Self.log.notice("Whisper ready in \((ContinuousClock.now - start).formatted(.units(allowed: [.seconds])), privacy: .public)")
        } catch {
            Self.log.error("Whisper did not load: \(String(describing: error), privacy: .public)")
        }
    }

    /// Transcribes 16 kHz mono samples. The language is detected, so Taglish stays as spoken. The
    /// demo's words go in as Whisper's prompt (`GoalVocabulary`), so it spells them the way goals use them.
    func transcribe(_ samples: [Float]) async throws -> String {
        guard let whisper else { throw RecognitionFailure.modelNotReady }
        let options = DecodingOptions(
            verbose: false,
            task: .transcribe,
            detectLanguage: true,
            skipSpecialTokens: true,
            withoutTimestamps: true,
            promptTokens: whisper.tokenizer.map { Self.promptTokens(GoalVocabulary.whisperPrompt, tokenizer: $0) }
        )
        let results = try await whisper.transcribe(audioArray: samples, decodeOptions: options)
        return results.map(\.text).joined(separator: " ")
    }
}

extension WhisperModel {
    /// The prompt's text tokens, with a leading space as Whisper expects for earlier text. Special
    /// tokens are dropped; WhisperKit puts the "previous text" marker in front itself.
    static func promptTokens(_ prompt: String, tokenizer: WhisperTokenizer) -> [Int] {
        tokenizer.encode(text: " " + prompt.trimmingCharacters(in: .whitespaces))
            .filter { $0 < tokenizer.specialTokens.specialTokenBegin }
    }
}

/// One recording for Whisper: the microphone's audio converted to 16 kHz mono as it arrives.
nonisolated final class WhisperRecognitionSession: RecognitionSession, @unchecked Sendable {
    private static let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!
    private let lock = NSLock()
    private var samples: [Float] = []
    private var converter: AVAudioConverter?
    private var cancelled = false

    /// Called on the audio thread, one buffer at a time.
    func append(_ buffer: AVAudioPCMBuffer) {
        let format = Self.format
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
        guard let channel = output.floatChannelData?[0], output.frameLength > 0 else { return }
        let chunk = UnsafeBufferPointer(start: channel, count: Int(output.frameLength))
        lock.withLock { samples.append(contentsOf: chunk) }
    }

    func finish() async throws -> String {
        let samples = lock.withLock { cancelled ? [] : self.samples }
        // Under half a second is a tap on the shortcut, not a goal.
        guard samples.count > 8_000 else { return "" }
        return try await WhisperModel.shared.transcribe(samples)
    }

    func cancel() {
        lock.withLock {
            cancelled = true
            samples = []
        }
    }
}
