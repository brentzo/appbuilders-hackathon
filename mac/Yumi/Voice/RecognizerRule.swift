import AVFoundation
import OSLog

/// Which recognizer turns a recording into text (OBJ-15.5, SPEC-01 requirements 2 and 3).
///
/// - "I speak Taglish" on: Whisper, which handles Tagalog and English mixed. Apple's recognizer
///   only if Whisper is not loaded yet or fails.
/// - Off: Apple's on-device recognizer, which is faster for English commands. Whisper only if it
///   is loaded and Apple's recognizer cannot run or fails.
///
/// Both run on the device. Silence is not a failure: an empty transcript never falls back.
nonisolated enum RecognizerRule {
    enum Recognizer: String, Equatable, Sendable {
        case native, whisper
    }

    static func order(speaksTaglish: Bool, whisperReady: Bool) -> [Recognizer] {
        let preferred: [Recognizer] = speaksTaglish ? [.whisper, .native] : [.native, .whisper]
        return preferred.filter { $0 != .whisper || whisperReady }
    }
}

/// Records into every recognizer at once, then asks them in order until one answers. Recording
/// into the fallback costs only memory, and it means a failure never asks the user to repeat.
nonisolated final class FallbackRecognitionSession: RecognitionSession, @unchecked Sendable {
    private static let log = Logger(subsystem: "ph.appbuilders.yumi", category: "voice")
    private let sessions: [(RecognizerRule.Recognizer, RecognitionSession)]
    /// Which recognizer produced the last transcript, for the log.
    private(set) var usedRecognizer: RecognizerRule.Recognizer?

    /// Starts a session for each recognizer that can run, in order. Throws if none can.
    init(order: [RecognizerRule.Recognizer]) throws {
        var sessions: [(RecognizerRule.Recognizer, RecognitionSession)] = []
        var lastError: Error = RecognitionFailure.onDeviceUnavailable
        for recognizer in order {
            do {
                switch recognizer {
                case .native: sessions.append((.native, try NativeRecognizer.makeSession()))
                case .whisper: sessions.append((.whisper, WhisperRecognitionSession()))
                }
            } catch {
                Self.log.notice("\(recognizer.rawValue, privacy: .public) recognizer unavailable: \(String(describing: error), privacy: .public)")
                lastError = error
            }
        }
        guard !sessions.isEmpty else { throw lastError }
        self.sessions = sessions
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        for (_, session) in sessions { session.append(buffer) }
    }

    func finish() async throws -> String {
        var lastError: Error = RecognitionFailure.onDeviceUnavailable
        for (index, (recognizer, session)) in sessions.enumerated() {
            do {
                let text = try await session.finish()
                usedRecognizer = recognizer
                for (_, rest) in sessions.dropFirst(index + 1) { rest.cancel() }
                Self.log.notice("Transcribed with \(recognizer.rawValue, privacy: .public)")
                return text
            } catch {
                Self.log.error("\(recognizer.rawValue, privacy: .public) recognizer failed: \(String(describing: error), privacy: .public)")
                lastError = error
            }
        }
        throw lastError
    }

    func cancel() {
        for (_, session) in sessions { session.cancel() }
    }
}
