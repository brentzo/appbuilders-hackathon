@preconcurrency import AVFoundation

/// A recording whose audio also goes to a `SpeechEndpoint`, so it knows when the user stopped.
nonisolated final class EndpointedSession: RecognitionSession, @unchecked Sendable {
    private let inner: RecognitionSession
    private let endpoint: SpeechEndpoint

    init(_ inner: RecognitionSession, endpoint: SpeechEndpoint) {
        self.inner = inner
        self.endpoint = endpoint
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        inner.append(buffer)
        endpoint.append(buffer)
    }

    func finish() async throws -> String { try await inner.finish() }
    func cancel() { inner.cancel() }
}

/// Finds where the user stopped talking, for hands-free replies (OBJ-17.5): there is no shortcut
/// to release, so listening ends after a short silence that follows speech, or when nothing is
/// said at all.
///
/// The noise floor is learned from the first moments of the recording, so a quiet room and a
/// noisy one both work. Runs on the audio thread.
nonisolated final class SpeechEndpoint: @unchecked Sendable {
    enum Outcome: Equatable {
        /// Speech, then enough silence.
        case spoke
        /// Nothing louder than the room before the wait ran out.
        case silent
        /// Still talking at the longest allowed reply.
        case tooLong
    }

    struct Timing {
        var floorLearning: TimeInterval = 0.3
        var silenceAfterSpeech: TimeInterval = 0.9
        var waitForSpeech: TimeInterval = 5
        var longest: TimeInterval = 10
    }

    private let timing: Timing
    private let lock = NSLock()
    private var elapsed: TimeInterval = 0
    private var floorSum: Float = 0
    private var floorCount = 0
    private var heardSpeech = false
    private var quietFor: TimeInterval = 0
    private var outcome: Outcome?
    private let ended: (Outcome) -> Void

    init(timing: Timing = Timing(), ended: @escaping (Outcome) -> Void) {
        self.timing = timing
        self.ended = ended
    }

    func append(_ buffer: AVAudioPCMBuffer) {
        guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return }
        var sum: Float = 0
        for index in 0..<Int(buffer.frameLength) { sum += channel[index] * channel[index] }
        let level = (sum / Float(buffer.frameLength)).squareRoot()
        measure(level: level, duration: Double(buffer.frameLength) / buffer.format.sampleRate)
    }

    /// One block of audio: its RMS level and how long it lasted.
    func measure(level: Float, duration: TimeInterval) {
        lock.lock()
        guard outcome == nil else { lock.unlock(); return }
        elapsed += duration
        var result: Outcome?
        if elapsed <= timing.floorLearning {
            floorSum += level
            floorCount += 1
        } else {
            let floor = floorCount > 0 ? floorSum / Float(floorCount) : 0
            // Speech is clearly above the room: three times its level, and never below -40 dBFS.
            let isSpeech = level > max(floor * 3, 0.01)
            if isSpeech {
                heardSpeech = true
                quietFor = 0
            } else {
                quietFor += duration
            }
            if heardSpeech, quietFor >= timing.silenceAfterSpeech {
                result = .spoke
            } else if !heardSpeech, elapsed >= timing.waitForSpeech {
                result = .silent
            } else if elapsed >= timing.longest {
                result = .tooLong
            }
        }
        outcome = result
        lock.unlock()
        if let result { ended(result) }
    }
}
