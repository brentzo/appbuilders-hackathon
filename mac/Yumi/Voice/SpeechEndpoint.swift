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
    func observePartials(_ handler: @escaping @Sendable (String) -> Void) { inner.observePartials(handler) }
}

/// Finds where the user stopped talking, for hands-free replies (OBJ-17.5): there is no shortcut
/// to release, so listening ends after a short silence that follows speech, or when nothing is
/// said at all.
///
/// The noise floor is learned from the first moments of the recording, so a quiet room and a
/// noisy one both work. A sound counts as the user talking only once it lasts `minSpeech`, so a
/// click or the tail of Yumi's own voice does not end the listen before the user starts: on
/// 2026-10-10 (task 4ecaff1c) a blip right after the repeat-back ended it within 1.5 s, and
/// Brent's "Yes, in a note" was never heard. The user gets `waitForSpeech` to start talking.
/// Runs on the audio thread.
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
        /// How long a sound must last, in total, before it counts as the user talking.
        var minSpeech: TimeInterval = 0.25
        var waitForSpeech: TimeInterval = 8
        var longest: TimeInterval = 15
    }

    private let timing: Timing
    private let lock = NSLock()
    private var elapsed: TimeInterval = 0
    private var floorSum: Float = 0
    private var floorCount = 0
    private var heardSpeech = false
    /// Sound above the room since the last long quiet, before it counts as speech.
    private var voicedFor: TimeInterval = 0
    private var quietFor: TimeInterval = 0
    private var outcome: Outcome?
    private let ended: (Outcome) -> Void

    init(timing: Timing = Timing(), ended: @escaping (Outcome) -> Void) {
        self.timing = timing
        self.ended = ended
    }

    /// After "Hey Yumi" (OBJ-58) the user is often already talking, so the room's level comes from
    /// before the wake phrase instead of the first moments, and `speaking` says the goal has begun.
    convenience init(timing: Timing = Timing(), floor: Float, speaking: Bool, ended: @escaping (Outcome) -> Void) {
        var timing = timing
        timing.floorLearning = 0
        self.init(timing: timing, ended: ended)
        floorSum = floor
        floorCount = 1
        heardSpeech = speaking
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
                voicedFor += duration
                if voicedFor >= timing.minSpeech { heardSpeech = true }
                quietFor = 0
            } else {
                quietFor += duration
                // A short sound followed by quiet was not the user talking.
                if !heardSpeech, quietFor >= timing.silenceAfterSpeech { voicedFor = 0 }
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
