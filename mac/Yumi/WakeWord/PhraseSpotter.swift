@preconcurrency import AVFoundation
import OSLog

/// "Hey Yumi" and the sound-alikes Yumi accepts on purpose (OBJ-58.1, SPEC-01 Decisions): "hey
/// you me", "hey yummy", "hey umi", "a yumi", and the like.
nonisolated enum WakePhrase {
    /// Words the recognizer should expect. "Yumi" is not in its dictionary.
    static let contextualStrings = ["Yumi", "Hey Yumi"]

    /// "Hey", and what the recognizer writes for it.
    static let greetings: Set<String> = ["hey", "hay", "hi", "a", "ay", "eh", "hei"]
    /// "Yumi" as the recognizer writes it, in one word or two.
    static let names: [[String]] = [
        ["yumi"], ["yummy"], ["yummi"], ["umi"], ["yumie"], ["yumee"], ["yoomi"], ["yoomee"], ["youmi"],
        ["yuumi"], ["umee"], ["you", "me"], ["you", "mi"], ["u", "me"], ["yu", "me"], ["yu", "mi"],
    ]
    /// The whole phrase as one word.
    static let joined: Set<String> = ["heyyumi", "heyumi", "hayumi", "heyyummy", "heyyoumi"]

    /// What was said after the first "Hey Yumi" in `text`, without the punctuation that follows
    /// the phrase. Empty when nothing came after it yet; nil when the phrase is not in `text`.
    static func remainder(after text: String) -> String? {
        let words = words(in: text)
        for (index, word) in words.enumerated() {
            var end: String.Index?
            if joined.contains(word.text) {
                end = word.range.upperBound
            } else if greetings.contains(word.text) {
                for name in names where index + name.count < words.count
                    && zip(name, words[(index + 1)...]).allSatisfy({ $0 == $1.text }) {
                    end = words[index + name.count].range.upperBound
                    break
                }
            }
            guard let end else { continue }
            let rest = text[end...].drop { $0.isWhitespace || $0.isPunctuation }
            return rest.prefix(1).uppercased() + rest.dropFirst()
        }
        return nil
    }

    /// The goal in a recording that starts with "Hey Yumi": the words after it. If the recognizer
    /// wrote the phrase some other way this time, a "Hey" or "Yumi" left at the start goes, and the
    /// rest is the goal (live, "Hey Yumi, open Notes" once came out as "Hey, open Notes.").
    static func goal(in transcript: String) -> String {
        if let rest = remainder(after: transcript) { return rest }
        var start = transcript.startIndex
        for word in words(in: transcript).prefix(2) {
            guard leftovers.contains(word.text), transcript[start..<word.range.lowerBound].allSatisfy({ $0.isWhitespace || $0.isPunctuation }) else { break }
            start = word.range.upperBound
        }
        let rest = transcript[start...].drop { $0.isWhitespace || $0.isPunctuation }
        return rest.prefix(1).uppercased() + rest.dropFirst()
    }

    /// Words that can be left of the phrase at the start of the goal recording.
    private static let leftovers: Set<String> = ["hey", "hi", "hay", "yumi", "yummy", "umi"]

    private static func words(in text: String) -> [(text: String, range: Range<String.Index>)] {
        text.ranges(of: #/[\p{L}\p{N}']+/#).map { range in
            (text[range].lowercased().replacingOccurrences(of: "'", with: ""), range)
        }
    }
}

/// Spots "Hey Yumi" with Apple's speech recognizer, always on the device (OBJ-58.1, SPEC-01 r10).
///
/// The microphone streams into a recognizer session that is replaced every few seconds, and each
/// guess is checked for the phrase and dropped at once. Nothing it hears is logged, stored, or
/// sent; only whether the phrase was heard leaves this class. The last 2 seconds of audio stay in
/// memory, so the goal said right after "Hey Yumi" is not lost while the capture takes over.
nonisolated final class PhraseSpotter: @unchecked Sendable {
    /// A new recognizer session after this much audio, so it never holds more than a few seconds.
    static let sessionLength: TimeInterval = 8
    /// Audio kept for the next session and for the goal capture.
    static let preRoll: TimeInterval = 2
    /// Where the room's level is learned, for knowing when the user stops speaking.
    static let floorWindow: TimeInterval = 5

    private static let log = Logger(subsystem: "ph.appbuilders.yumi", category: "wakeword")
    private let queue = DispatchQueue(label: "ph.appbuilders.yumi.wakephrase", qos: .userInitiated)
    private let microphone = MicrophoneCapture()
    private let makeSession: () throws -> RecognitionSession
    /// Called on the spotter's queue when the phrase is heard, with whether words came after it.
    private let heard: @Sendable (_ speaking: Bool) -> Void

    // Everything below is used only on `queue`.
    private var session: RecognitionSession?
    private var sessionAudio: TimeInterval = 0
    private var clock: TimeInterval = 0
    private var nextAttempt: TimeInterval = 0
    private var recent: [AVAudioPCMBuffer] = []
    private var recentLength: TimeInterval = 0
    private var levels: [(level: Float, duration: TimeInterval)] = []
    private var fired = false
    private var stopped = false
    private var handedOver: (recognizer: RecognitionSession, live: RecognitionSession, liveAfter: TimeInterval)?

    init(makeSession: @escaping () throws -> RecognitionSession = NativeRecognizer.makeSpotterSession,
         heard: @escaping @Sendable (_ speaking: Bool) -> Void) {
        self.makeSession = makeSession
        self.heard = heard
    }

    /// Opens the microphone, or plays `testRecording` in its place.
    func start(testRecording: (path: String, loops: Bool)? = nil) throws {
        let send: @Sendable (AVAudioPCMBuffer) -> Void = { [weak self] in self?.receive($0) }
        if let testRecording {
            try microphone.play(URL(fileURLWithPath: testRecording.path), loops: testRecording.loops, sending: send)
        } else {
            try microphone.start(sending: send)
        }
    }

    /// Closes the microphone and drops everything heard.
    func stop() {
        microphone.stop()
        queue.async { [self] in
            stopped = true
            dropSession()
            recent = []
            levels = []
            handedOver = nil
        }
    }

    /// The phrase was heard at a moment Yumi could not listen: start over with nothing kept.
    func rearm() {
        queue.async { [self] in
            fired = false
            dropSession()
            recent = []
            recentLength = 0
        }
    }

    /// Hands the running microphone to the goal capture, after the phrase was heard.
    func handOver(speaking: Bool) -> WakeHandover {
        let floor = queue.sync { Self.floor(of: levels) }
        return WakeHandover(spotter: self, floor: floor, speaking: speaking)
    }

    /// From now on the audio goes to the goal capture: first the audio kept since before the
    /// phrase, to `recognizer` only, then the microphone, to `live` once `liveAfter` has passed (so
    /// the listening sound does not count as speech) and to `recognizer` before that.
    fileprivate func attach(recognizer: RecognitionSession, live: RecognitionSession, liveAfter: TimeInterval) {
        queue.sync {
            for buffer in recent { recognizer.append(buffer) }
            recent = []
            recentLength = 0
            handedOver = (recognizer, live, liveAfter)
        }
    }

    /// One block of audio from the microphone, on its thread.
    func receive(_ buffer: AVAudioPCMBuffer) {
        // The engine may reuse its buffer once the tap returns.
        guard let copy = Self.copy(buffer) else { return }
        nonisolated(unsafe) let owned = copy
        queue.async { self.hear(owned) }
    }

    /// Waits until everything received so far was handled. For tests.
    func flush() {
        queue.sync {}
    }

    private func hear(_ buffer: AVAudioPCMBuffer) {
        guard !stopped else { return }
        let duration = Double(buffer.frameLength) / buffer.format.sampleRate
        if let target = handedOver {
            if target.liveAfter > 0 {
                handedOver?.liveAfter -= duration
                target.recognizer.append(buffer)
            } else {
                target.live.append(buffer)
            }
            return
        }
        clock += duration
        levels.append((Self.level(of: buffer), duration))
        trim(&levels, to: Self.floorWindow) { $0.duration }
        recent.append(buffer)
        recentLength += duration
        // After the phrase, keep everything until the capture takes it.
        guard !fired else { return }
        trimRecent()
        sessionAudio += duration
        if session == nil || sessionAudio >= Self.sessionLength {
            replaceSession()
        } else {
            session?.append(buffer)
        }
    }

    /// A fresh session that starts with the last 2 seconds, so a phrase said across the switch
    /// is still heard whole.
    private func replaceSession() {
        dropSession()
        guard clock >= nextAttempt else { return }
        let fresh: RecognitionSession
        do {
            fresh = try makeSession()
        } catch {
            // The on-device model may still be installing. Try again in a few seconds.
            if nextAttempt == 0 { Self.log.notice("Wake phrase recognizer not ready yet: \(String(describing: error), privacy: .public)") }
            nextAttempt = clock + 3
            return
        }
        let id = ObjectIdentifier(fresh)
        fresh.observePartials { [weak self] text in
            // Checked here and dropped: only whether it held the phrase goes on.
            guard let self, let rest = WakePhrase.remainder(after: text) else { return }
            let speaking = !rest.isEmpty
            queue.async { self.matched(in: id, speaking: speaking) }
        }
        for buffer in recent { fresh.append(buffer) }
        session = fresh
        sessionAudio = recentLength
    }

    private func matched(in id: ObjectIdentifier, speaking: Bool) {
        guard !fired, !stopped, let session, ObjectIdentifier(session) == id else { return }
        fired = true
        dropSession()
        heard(speaking)
    }

    private func dropSession() {
        session?.cancel()
        session = nil
        sessionAudio = 0
    }

    private func trimRecent() {
        while recent.count > 1, recentLength - Double(recent[0].frameLength) / recent[0].format.sampleRate >= Self.preRoll {
            recentLength -= Double(recent[0].frameLength) / recent[0].format.sampleRate
            recent.removeFirst()
        }
    }

    private func trim<T>(_ items: inout [T], to length: TimeInterval, duration: (T) -> TimeInterval) {
        var total = items.reduce(0) { $0 + duration($1) }
        while let first = items.first, total - duration(first) >= length {
            total -= duration(first)
            items.removeFirst()
        }
    }

    /// The room's level: quieter than 90% of the last few seconds, which hold the phrase too.
    static func floor(of levels: [(level: Float, duration: TimeInterval)]) -> Float {
        let sorted = levels.map(\.level).sorted()
        guard !sorted.isEmpty else { return 0 }
        return sorted[sorted.count / 10]
    }

    static func level(of buffer: AVAudioPCMBuffer) -> Float {
        guard let channel = buffer.floatChannelData?[0], buffer.frameLength > 0 else { return 0 }
        var sum: Float = 0
        for index in 0..<Int(buffer.frameLength) { sum += channel[index] * channel[index] }
        return (sum / Float(buffer.frameLength)).squareRoot()
    }

    static func copy(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
        guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else { return nil }
        copy.frameLength = buffer.frameLength
        let source = UnsafeMutableAudioBufferListPointer(UnsafeMutablePointer(mutating: buffer.audioBufferList))
        let target = UnsafeMutableAudioBufferListPointer(copy.mutableAudioBufferList)
        for (from, to) in zip(source, target) {
            guard let data = from.mData, let into = to.mData else { continue }
            memcpy(into, data, Int(min(from.mDataByteSize, to.mDataByteSize)))
        }
        return copy
    }
}

/// The microphone that heard "Hey Yumi", handed to the goal capture (OBJ-58.2) so the words said
/// right after the phrase are kept, with what the capture needs to know when the user stops.
nonisolated final class WakeHandover: @unchecked Sendable {
    /// The room's level from just before the phrase.
    let floor: Float
    /// Whether the user was already saying the goal when the phrase was heard.
    let speaking: Bool
    private let spotter: PhraseSpotter

    fileprivate init(spotter: PhraseSpotter, floor: Float, speaking: Bool) {
        self.spotter = spotter
        self.floor = floor
        self.speaking = speaking
    }

    /// See `PhraseSpotter.attach`. The listening sound lasts about a third of a second.
    func attach(recognizer: RecognitionSession, live: RecognitionSession) {
        spotter.attach(recognizer: recognizer, live: live, liveAfter: 0.35)
    }

    /// Closes the microphone.
    func stop() {
        spotter.stop()
    }
}
