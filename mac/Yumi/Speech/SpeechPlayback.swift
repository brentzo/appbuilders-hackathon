import AVFoundation
import OSLog

/// Plays Yumi's voice and the meow that opens a conversation.
@MainActor
protocol SpeechPlaying: AnyObject {
    /// Queues samples right after anything already queued. `played` runs once they were heard.
    func schedule(_ samples: [Float], sampleRate: Double, played: @escaping @MainActor () -> Void) throws
    /// Starts the meow and returns how long until it is quiet, or nil if there is no meow.
    func meow() -> TimeInterval?
}

/// One audio engine for the voice: the voice runs through `AVAudioUnitTimePitch` for the last part
/// of Yumi's pitch (`KokoroVoice.playbackPitchCents`), and the meow plays unchanged beside it.
/// The engine runs only while there is something to play.
@MainActor
final class SpeechPlayback: SpeechPlaying {
    /// The meow is Patrick's cat sound (`Overlay/Sounds/cat-meow.mp3`), a little quieter than the voice.
    static let meowVolume: Float = 0.5
    /// Silence after each line, so the pitch unit's tail is heard before the engine pauses.
    static let tailSeconds = 0.15

    private let engine = AVAudioEngine()
    private let voice = AVAudioPlayerNode()
    private let pitch = AVAudioUnitTimePitch()
    private let meowNode = AVAudioPlayerNode()
    private let meowBuffer: AVAudioPCMBuffer?
    private let meowLength: TimeInterval?
    private var voiceFormat: AVAudioFormat?
    private var pending = 0
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "speech")

    init(bundle: Bundle = .main) {
        pitch.pitch = KokoroVoice.playbackPitchCents
        engine.attach(voice)
        engine.attach(pitch)
        engine.attach(meowNode)
        let meow = bundle.url(forResource: "cat-meow", withExtension: "mp3").flatMap(Self.read)
        meowBuffer = meow
        meowLength = meow.map(Self.audibleLength)
        if let meow {
            engine.connect(meowNode, to: engine.mainMixerNode, format: meow.format)
            meowNode.volume = Self.meowVolume
        } else {
            log.error("The meow sound is missing from the app, so Yumi's voice starts without it")
        }
    }

    func schedule(_ samples: [Float], sampleRate: Double, played: @escaping @MainActor () -> Void) throws {
        let format = try connectVoice(sampleRate: sampleRate)
        let tail = Int(Self.tailSeconds * sampleRate)
        guard let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples.count + tail)) else {
            throw PlaybackError.noBuffer
        }
        buffer.frameLength = buffer.frameCapacity
        let channel = buffer.floatChannelData![0]
        samples.withUnsafeBufferPointer { channel.update(from: $0.baseAddress!, count: samples.count) }
        (channel + samples.count).update(repeating: 0, count: tail)
        try startEngine()
        pending += 1
        voice.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { _ in
            Task { @MainActor in
                self.pending -= 1
                self.pauseIfIdle()
                played()
            }
        }
        if !voice.isPlaying { voice.play() }
    }

    func meow() -> TimeInterval? {
        guard let meowBuffer, let meowLength else { return nil }
        do {
            try startEngine()
        } catch {
            log.error("The meow could not play: \(String(describing: error), privacy: .public)")
            return nil
        }
        pending += 1
        meowNode.scheduleBuffer(meowBuffer, completionCallbackType: .dataPlayedBack) { _ in
            Task { @MainActor in
                self.pending -= 1
                self.pauseIfIdle()
            }
        }
        meowNode.play()
        return meowLength
    }

    enum PlaybackError: Error {
        case noBuffer
        case noFormat
    }

    private func connectVoice(sampleRate: Double) throws -> AVAudioFormat {
        if let voiceFormat, voiceFormat.sampleRate == sampleRate { return voiceFormat }
        guard let format = AVAudioFormat(standardFormatWithSampleRate: sampleRate, channels: 1) else { throw PlaybackError.noFormat }
        engine.connect(voice, to: pitch, format: format)
        engine.connect(pitch, to: engine.mainMixerNode, format: format)
        voiceFormat = format
        return format
    }

    /// The engine also stops by itself when the output device changes; starting it again picks up
    /// the new device.
    private func startEngine() throws {
        guard !engine.isRunning else { return }
        engine.prepare()
        try engine.start()
    }

    private func pauseIfIdle() {
        guard pending == 0 else { return }
        voice.stop()
        meowNode.stop()
        engine.pause()
    }

    private static func read(_ url: URL) -> AVAudioPCMBuffer? {
        guard let file = try? AVAudioFile(forReading: url),
              let buffer = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length)),
              (try? file.read(into: buffer)) != nil
        else { return nil }
        return buffer
    }

    /// Seconds until the sound falls below 1% of its peak for good: the meow file ends in silence.
    nonisolated static func audibleLength(_ buffer: AVAudioPCMBuffer) -> TimeInterval {
        guard let data = buffer.floatChannelData, buffer.frameLength > 0 else { return 0 }
        let frames = Int(buffer.frameLength), channels = Int(buffer.format.channelCount)
        let level = { (frame: Int) in (0..<channels).map { abs(data[$0][frame]) }.max() ?? 0 }
        let peak = (0..<frames).map(level).max() ?? 0
        let last = (0..<frames).last { level($0) > peak * 0.01 } ?? 0
        return Double(last + 1) / buffer.format.sampleRate
    }
}
