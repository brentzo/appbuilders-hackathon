import AppKit
@preconcurrency import AVFoundation
import OSLog

/// Hands-free listening for the wake word (OBJ-16.3 to 16.5).
///
/// While the wake word setting is on, the microphone streams into the detector off the main
/// thread. Audio lives only in the detector's rolling buffers in memory and is never transcribed
/// or stored (SPEC-01 r10). On a detection Yumi plays a short sound and hands over to the same
/// capture path as push-to-talk, which ends when the user stops speaking. With the setting off the
/// microphone is not opened for the wake word at all (SPEC-01 r11).
@MainActor
final class WakeWordListener {
    /// Starts listening for a goal, the way push-to-talk does. Returns when the goal was heard
    /// (or nothing was), so wake word detection can start again.
    private let listenForGoal: () async -> Void
    /// False while push-to-talk or a spoken answer has the microphone.
    private let isMicrophoneFree: () -> Bool
    private let model: AppModel
    private let detection = DispatchQueue(label: "ph.appbuilders.yumi.wakeword", qos: .userInitiated)
    private var engine: AVAudioEngine?
    /// Test aid: a recording fed to the detector at real-time pace instead of the microphone.
    private var fileFeed: DispatchSourceTimer?
    /// Debug builds read `-YumiWakeWordFile <wav>`, and `-YumiWakeWordLoop YES` to repeat it.
    var testRecording: (path: String, loops: Bool)? = {
        #if DEBUG
        LaunchArguments.string("YumiWakeWordFile").map { ($0, LaunchArguments.bool("YumiWakeWordLoop")) }
        #else
        nil
        #endif
    }()
    private var scorer: WakeWordScorer?
    private(set) var phrase: String?
    private var handingOver = false
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "wakeword")

    init(model: AppModel, isMicrophoneFree: @escaping () -> Bool, listenForGoal: @escaping () async -> Void) {
        self.model = model
        self.isMicrophoneFree = isMicrophoneFree
        self.listenForGoal = listenForGoal
    }

    var isListening: Bool { engine != nil || fileFeed != nil }

    func start() {
        followSetting()
        // Microphone permission may be granted in System Settings while Yumi runs.
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.update() }
        }
    }

    private func followSetting() {
        withObservationTracking {
            update()
        } onChange: { [weak self] in
            Task { @MainActor in self?.followSetting() }
        }
    }

    /// Opens or closes the microphone to match the setting.
    func update() {
        let wanted = model.settings.wakeWordEnabled && !handingOver
        if wanted, !isListening {
            open()
        } else if !wanted, isListening {
            close()
        }
    }

    private func open() {
        guard testRecording != nil || model.permissions.check(.microphone) == .granted else {
            log.notice("Wake word waits for the microphone permission")
            return
        }
        do {
            if scorer == nil {
                guard let (loaded, choice) = try WakeWordModels.loadScorer() else {
                    log.notice("Wake word models are missing; run mac/scripts/fetch-wake-word-models.sh. Push-to-talk still works.")
                    return
                }
                scorer = loaded
                phrase = choice.phrase
                log.notice("Wake word is \"\(choice.phrase, privacy: .public)\"\(choice.isStandIn ? " (stand-in until OBJ-12)" : "", privacy: .public)")
            }
            guard let scorer else { return }
            // Runs off the main actor; only this hops back to it.
            let onWake: @Sendable (Float) -> Void = { [weak self] score in
                DispatchQueue.main.async { MainActor.assumeIsolated { self?.detected(score) } }
            }
            if let testRecording {
                fileFeed = try WakeWordAudio.feed(testRecording.path, loops: testRecording.loops, to: scorer, on: detection, onWake: onWake)
                log.notice("Listening for the wake word in \(testRecording.path, privacy: .public) (test aid)")
                return
            }
            engine = try WakeWordAudio.listen(to: scorer, on: detection, onWake: onWake)
            log.notice("Listening for the wake word")
        } catch {
            log.error("Could not listen for the wake word: \(String(describing: error), privacy: .public)")
        }
    }

    private func close() {
        fileFeed?.cancel()
        fileFeed = nil
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        // Drop every sample still held, so nothing from before stays in memory.
        let scorer = scorer
        detection.async { scorer?.reset() }
        log.notice("Stopped listening for the wake word")
    }

    /// The wake word was heard (OBJ-16.4): a short sound, then the push-to-talk capture path.
    private func detected(_ score: Float) {
        guard isListening, !handingOver, isMicrophoneFree() else { return }
        log.notice("Wake word heard (score \(score, format: .fixed(precision: 2)))")
        handingOver = true
        close()
        // Test aid: a recording played once wakes Yumi once.
        if testRecording?.loops == false { testRecording = nil }
        NSSound(named: "Tink")?.play()
        Task {
            await listenForGoal()
            handingOver = false
            update()
        }
    }
}

/// The audio side of wake word listening. Nonisolated, because the microphone tap and the test
/// feed run on audio and detection threads, never on the main actor.
nonisolated enum WakeWordAudio {
    static var target: AVAudioFormat? {
        AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: Double(WakeWordFeatures.sampleRate), channels: 1, interleaved: true)
    }

    /// Opens the default microphone and scores everything it hears on `queue`.
    static func listen(to scorer: WakeWordScorer, on queue: DispatchQueue, onWake: @escaping @Sendable (Float) -> Void) throws -> AVAudioEngine? {
        let engine = AVAudioEngine()
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)
        guard let target, let converter = AVAudioConverter(from: inputFormat, to: target) else { return nil }
        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat) { buffer, _ in
            guard let samples = Self.convert(buffer, with: converter, to: target) else { return }
            queue.async { score(samples, with: scorer, onWake: onWake) }
        }
        engine.prepare()
        try engine.start()
        return engine
    }

    /// Test aid: feeds a recording in 80 ms chunks every 80 ms, as the microphone would.
    static func feed(_ path: String, loops: Bool, to scorer: WakeWordScorer, on queue: DispatchQueue,
                     onWake: @escaping @Sendable (Float) -> Void) throws -> DispatchSourceTimer? {
        let file = try AVAudioFile(forReading: URL(fileURLWithPath: path))
        guard let target, let converter = AVAudioConverter(from: file.processingFormat, to: target),
              let whole = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: AVAudioFrameCount(file.length))
        else { return nil }
        try file.read(into: whole)
        guard let samples = convert(whole, with: converter, to: target) else { return nil }
        let chunk = WakeWordFeatures.chunk
        nonisolated(unsafe) var position = 0
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(80))
        timer.setEventHandler { [weak timer] in
            if position + chunk > samples.count {
                guard loops else { timer?.cancel(); return }
                position = 0
            }
            score(Array(samples[position..<position + chunk]), with: scorer, onWake: onWake)
            position += chunk
        }
        timer.resume()
        return timer
    }

    private static func score(_ samples: [Int16], with scorer: WakeWordScorer, onWake: @Sendable (Float) -> Void) {
        guard let scores = try? scorer.append(samples), let best = scores.max(), best >= WakeWordModels.threshold else { return }
        onWake(best)
    }

    /// Microphone audio, any rate and channel count, to 16 kHz mono 16-bit samples.
    static func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter, to format: AVAudioFormat) -> [Int16]? {
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * format.sampleRate / buffer.format.sampleRate) + 1
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else { return nil }
        // The input block runs synchronously inside `convert`, once per call here.
        nonisolated(unsafe) var consumed = false
        nonisolated(unsafe) let input = buffer
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if consumed {
                status.pointee = .noDataNow
                return nil
            }
            consumed = true
            status.pointee = .haveData
            return input
        }
        guard error == nil, let channel = output.int16ChannelData else { return nil }
        return Array(UnsafeBufferPointer(start: channel[0], count: Int(output.frameLength)))
    }
}
