@preconcurrency import AVFoundation
import Foundation
import Testing
@testable import Yumi

/// OBJ-58: "Hey Yumi" with the on-device recognizer, its sound-alikes, and the hand-over to the
/// goal capture.
@MainActor
struct PhraseSpotterTests {
    // MARK: The phrase

    @Test(arguments: [
        "Hey Yumi", "hey yumi", "Hey, Yumi.", "Hey you me", "Hey, you, me!", "Hey yummy", "Hey Umi",
        "A Yumi", "Hi Yumi", "Heyyumi", "Hey Yoomi", "so I said hey Yumi",
    ])
    func wakesOnTheSoundAlikes(_ heard: String) {
        #expect(WakePhrase.remainder(after: heard) != nil, "\(heard)")
    }

    @Test(arguments: [
        "", "Hey", "Yumi", "Hey you", "hey jarvis", "you me and him", "That was yummy", "Hey mommy",
        "Remind me to call Ana", "hey, you mean the other one",
    ])
    func ignoresEverythingElse(_ heard: String) {
        #expect(WakePhrase.remainder(after: heard) == nil, "\(heard)")
    }

    @Test func theGoalIsWhatComesAfterThePhrase() {
        #expect(WakePhrase.remainder(after: "Hey Yumi, open Notes.") == "Open Notes.")
        #expect(WakePhrase.remainder(after: "Hey you me open notes") == "Open notes")
        #expect(WakePhrase.remainder(after: "Remind me to call Ana. Hey Yumi. Open Notes") == "Open Notes")
        #expect(WakePhrase.remainder(after: "Hey Yumi") == "")
        #expect(WakePhrase.remainder(after: "Hey Yumi?") == "")
        #expect(WakePhrase.goal(in: "Hey Yumi, open Notes.") == "Open Notes.")
        // Written another way the second time: the whole recording is the goal.
        #expect(WakePhrase.goal(in: "Open Notes.") == "Open Notes.")
    }

    // MARK: The spotter

    /// A recognizer session the test speaks for.
    nonisolated final class FakeSession: RecognitionSession, @unchecked Sendable {
        let frames = Locked<Int>(0)
        let cancelled = Locked(false)
        private let handler = Locked<(@Sendable (String) -> Void)?>(nil)

        func append(_ buffer: AVAudioPCMBuffer) { frames.set(frames.get() + Int(buffer.frameLength)) }
        func finish() async throws -> String { "" }
        func cancel() { cancelled.set(true) }
        func observePartials(_ handler: @escaping @Sendable (String) -> Void) { self.handler.set(handler) }
        func guess(_ text: String) { handler.get()?(text) }
        var seconds: Double { Double(frames.get()) / 16_000 }
    }

    nonisolated final class Rig: @unchecked Sendable {
        let sessions = Locked<[FakeSession]>([])
        let heard = Locked<[Bool]>([])
        let spotter: PhraseSpotter

        init() {
            spotter = PhraseSpotter(makeSession: { [sessions] in
                let session = FakeSession()
                sessions.set(sessions.get() + [session])
                return session
            }, heard: { [heard] speaking in heard.set(heard.get() + [speaking]) })
        }

        /// `seconds` of audio in 0.1 s blocks at `level`.
        func play(seconds: Double, level: Float = 0.01) {
            let format = AVAudioFormat(standardFormatWithSampleRate: 16_000, channels: 1)!
            for _ in 0..<Int((seconds * 10).rounded()) {
                let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1600)!
                buffer.frameLength = 1600
                buffer.floatChannelData![0].update(repeating: level, count: 1600)
                spotter.receive(buffer)
            }
            spotter.flush()
        }

        func guess(_ text: String, in index: Int = -1) {
            let all = sessions.get()
            all[index < 0 ? all.count + index : index].guess(text)
            spotter.flush()
        }
    }

    @Test func firesOnceWithWhetherTheGoalHadBegun() {
        let rig = Rig()
        rig.play(seconds: 1)
        rig.guess("remind me to call Ana")
        #expect(rig.heard.get().isEmpty)
        rig.guess("remind me to call Ana hey Yumi open")
        rig.guess("remind me to call Ana hey Yumi open Notes")
        #expect(rig.heard.get() == [true])
        #expect(rig.sessions.get()[0].cancelled.get(), "the recognizer stops at the phrase")
    }

    @Test func aPhraseAloneSaysTheGoalHasNotBegun() {
        let rig = Rig()
        rig.play(seconds: 1)
        rig.guess("Hey Yumi.")
        #expect(rig.heard.get() == [false])
    }

    @Test func aNewSessionEveryFewSecondsStartsWithTheLastTwo() {
        let rig = Rig()
        rig.play(seconds: 7.5)
        #expect(rig.sessions.get().count == 1)
        rig.play(seconds: 1)
        let sessions = rig.sessions.get()
        #expect(sessions.count == 2)
        #expect(sessions[0].cancelled.get(), "what the old one heard is dropped")
        #expect(abs(sessions[1].seconds - 2.5) < 0.15, "2 s kept, then 0.5 s more: \(sessions[1].seconds)")
        // A late guess from the old session does not count.
        rig.guess("hey yumi", in: 0)
        #expect(rig.heard.get().isEmpty)
        rig.guess("hey yumi", in: 1)
        #expect(rig.heard.get() == [false])
    }

    @Test func rearmingStartsOverWithNothingKept() {
        let rig = Rig()
        rig.play(seconds: 1)
        rig.guess("hey yumi")
        rig.spotter.rearm()
        rig.play(seconds: 0.1)
        let sessions = rig.sessions.get()
        #expect(sessions.count == 2)
        #expect(abs(sessions[1].seconds - 0.1) < 0.01, "nothing from before the rearm: \(sessions[1].seconds)")
        rig.guess("hey yumi")
        #expect(rig.heard.get() == [false, false])
    }

    /// OBJ-58.2: the goal capture gets the audio from before the phrase, everything since, and
    /// the microphone from then on, with the listening sound kept away from the silence detector.
    @Test func theHandOverLosesNoAudio() {
        let rig = Rig()
        rig.play(seconds: 3, level: 0.001)
        rig.guess("hey yumi")
        rig.play(seconds: 0.5, level: 0.2)
        let handover = rig.spotter.handOver(speaking: true)
        #expect(handover.speaking)
        #expect(abs(handover.floor - 0.001) < 1e-6, "the room's level, from before the phrase")
        let recognizer = FakeSession()
        let live = FakeSession()
        handover.attach(recognizer: recognizer, live: live)
        #expect(abs(recognizer.seconds - 2.5) < 0.05, "2 s before the phrase and 0.5 s after: \(recognizer.seconds)")
        rig.play(seconds: 1)
        #expect(abs(recognizer.seconds - 2.9) < 0.05, "the listening sound goes to the recognizer only")
        #expect(abs(live.seconds - 0.6) < 0.05)
        handover.stop()
        rig.play(seconds: 1)
        #expect(abs(live.seconds - 0.6) < 0.05, "nothing after stop")
    }

    @Test func anEndpointThatKnowsTheRoomEndsAfterTheGoal() {
        var outcomes: [SpeechEndpoint.Outcome] = []
        let endpoint = SpeechEndpoint(floor: 0.002, speaking: true) { outcomes.append($0) }
        // Speech from the first block: nothing to learn the room from.
        for _ in 0..<5 { endpoint.measure(level: 0.1, duration: 0.1) }
        for _ in 0..<8 { endpoint.measure(level: 0.002, duration: 0.1) }
        #expect(outcomes.isEmpty)
        for _ in 0..<2 { endpoint.measure(level: 0.002, duration: 0.1) }
        #expect(outcomes == [.spoke])
    }

    // MARK: Yumi's own voice

    final class RecordingVoice: SpeechOutput {
        var said: [String] = []
        var speakingWhileSaying: [Bool] = []
        let model: AppModel
        init(model: AppModel) { self.model = model }
        func speak(_ text: String) async {
            speakingWhileSaying.append(model.isSpeaking)
            said.append("speak: \(text)")
        }
        func speakOpening(_ text: String) async {
            speakingWhileSaying.append(model.isSpeaking)
            said.append("opening: \(text)")
        }
    }

    /// OBJ-58.4: Yumi counts as speaking while its voice talks, and the opening line still goes
    /// to the voice's own `speakOpening`, so the meow is kept (OBJ-51).
    @Test func yumiSpeakingIsTrackedAndTheOpeningLineIsPassedOn() async {
        let model = AppModel()
        let voice = RecordingVoice(model: model)
        let speech = TrackedSpeech(voice, model: model)
        await speech.speakOpening("You want me to open Notes?")
        await speech.speak("Okay.")
        #expect(voice.said == ["opening: You want me to open Notes?", "speak: Okay."])
        #expect(voice.speakingWhileSaying == [true, true])
        #expect(!model.isSpeaking)
    }

    // MARK: End to end

    /// OBJ-58.5 with the real on-device recognizer: a recording of "Remind me to call Ana. Hey
    /// Yumi, open Notes." wakes Yumi, and only "open Notes" reaches the harness.
    @Test(arguments: [
        "[[slnc 1500]] Remind me to call Ana. [[slnc 900]] Hey Yumi, open Notes. [[slnc 300]]",
        "[[slnc 1500]] Hey Yumi. [[slnc 1200]] Open Notes. [[slnc 300]]",
    ])
    func heyYumiThenAGoalReachesTheHarness(_ script: String) async throws {
        let clip = FileManager.default.temporaryDirectory.appending(path: "yumi-hey-\(UUID().uuidString).wav")
        defer { try? FileManager.default.removeItem(at: clip) }
        let say = try Process.run(URL(fileURLWithPath: "/usr/bin/say"),
                                  arguments: ["-v", "Samantha", "--data-format=LEF32@16000", "-o", clip.path, script])
        say.waitUntilExit()
        await NativeRecognizer.prepare()

        let suite = "ph.appbuilders.yumi.tests.wakephrase.\(UUID().uuidString.prefix(8))"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = AppModel(settings: SettingsStore(defaults: defaults, sink: PendingHarnessSettingsSink()))
        model.settings.wakeWordEnabled = true
        let overlay = CursorOverlay(locator: WindowCenterLocator())
        overlay.start()
        var goals: [String] = []
        let voice = VoiceIntake(model: model, overlay: overlay, submit: { goals.append($0) }, showError: { _ in })
        let listener = WakeWordListener(model: model, detector: .recognizer, isMicrophoneFree: { voice.phase == .idle }) {
            await voice.listenForGoalAfterWakeWord($0)
        }
        listener.testRecording = (clip.path, false)
        listener.update()
        #expect(listener.isListening)
        #expect(listener.phrase == "Hey Yumi")

        let deadline = ContinuousClock.now + .seconds(30)
        while goals.isEmpty, ContinuousClock.now < deadline {
            try await Task.sleep(for: .milliseconds(100))
        }
        let goal = try #require(goals.first, "no goal after the wake phrase")
        #expect(goal.lowercased().contains("open notes"), "\(goal)")
        #expect(!goal.lowercased().contains("yumi"), "\(goal)")
        #expect(!goal.lowercased().contains("ana"), "nothing from before the phrase: \(goal)")
        listener.update()
        #expect(!model.isListening)
    }

    /// OBJ-58: CPU while spotting, with speech that never says the phrase. Run on demand with
    /// `TEST_RUNNER_YUMI_MEASURE_WAKE_CPU=1 xcodebuild ... test -only-testing:YumiTests/PhraseSpotterTests/cpuWhileSpotting`.
    @Test(.enabled(if: ProcessInfo.processInfo.environment["YUMI_MEASURE_WAKE_CPU"] != nil))
    func cpuWhileSpotting() async throws {
        let clip = FileManager.default.temporaryDirectory.appending(path: "yumi-talk-\(UUID().uuidString).wav")
        defer { try? FileManager.default.removeItem(at: clip) }
        let say = try Process.run(URL(fileURLWithPath: "/usr/bin/say"), arguments: [
            "-v", "Samantha", "--data-format=LEF32@16000", "-o", clip.path,
            "I went to the market this morning and bought some mangoes. [[slnc 600]] The traffic on the way back was terrible, so I listened to a podcast about whales. [[slnc 1500]]",
        ])
        say.waitUntilExit()
        await NativeRecognizer.prepare()
        let wakes = Locked(0)
        let spotter = PhraseSpotter { _ in wakes.set(wakes.get() + 1) }
        try spotter.start(testRecording: (clip.path, true))
        try await Task.sleep(for: .seconds(5))
        let before = Self.cpuSeconds()
        let seconds = 60.0
        try await Task.sleep(for: .seconds(seconds))
        let used = Self.cpuSeconds() - before
        spotter.stop()
        print("Wake phrase CPU: \(String(format: "%.1f", used / seconds * 100))% of one core over \(Int(seconds)) s, \(wakes.get()) wake-ups")
        #expect(wakes.get() == 0)
    }

    nonisolated static func cpuSeconds() -> Double {
        var usage = rusage()
        getrusage(RUSAGE_SELF, &usage)
        return Double(usage.ru_utime.tv_sec + usage.ru_stime.tv_sec) + Double(usage.ru_utime.tv_usec + usage.ru_stime.tv_usec) / 1e6
    }
}
