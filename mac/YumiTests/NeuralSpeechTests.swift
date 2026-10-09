import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// OBJ-51 against SPEC-04 r20 and SPEC-11 "Voice didn't load (Mac)": lines are said in the order
/// they were asked for, the opening line meows first, and a voice that did not load stays quiet,
/// warns once, logs why, and loads again on "Try again".
@MainActor
struct NeuralSpeechTests {
    /// Makes one tiny buffer per sentence, tagged with the sentence's index in `made`.
    actor FakeVoice: VoiceSynthesizing {
        nonisolated let sampleRate = 24_000.0
        private(set) var made: [String] = []
        let failOn: String?
        init(failOn: String? = nil) { self.failOn = failOn }

        func synthesize(_ text: String) async throws -> [Float] {
            if text == failOn { throw KokoroVoice.LoadError.missingFile("render") }
            made.append(text)
            try await Task.sleep(for: .milliseconds(5))
            return [Float(made.count)]
        }
    }

    /// Records what was played, and "hears" each buffer a moment after it was queued.
    final class FakePlayer: SpeechPlaying {
        var events: [String] = []
        var meowLength: TimeInterval? = 0.05

        func schedule(_ samples: [Float], sampleRate: Double, played: @escaping @MainActor () -> Void) throws {
            events.append("play \(Int(samples[0]))")
            Task {
                try? await Task.sleep(for: .milliseconds(10))
                played()
            }
        }

        func meow() -> TimeInterval? {
            events.append("meow")
            return meowLength
        }
    }

    let player = FakePlayer()

    func speech(voice: FakeVoice = FakeVoice(), soundsOn: Bool = true, failed: @escaping () -> Void = {}) -> NeuralSpeech {
        NeuralSpeech(load: { voice }, player: player, soundsOn: { soundsOn }, loadFailed: failed)
    }

    @Test func linesAreSaidInTheOrderTheyWereAskedFor() async {
        let voice = FakeVoice()
        let speech = speech(voice: voice)
        var finished: [String] = []
        // Callers fire and forget, as HarnessLink does for the harness's `speak` events.
        let first = Task { await speech.speak("First line. It has two sentences."); finished.append("first") }
        let second = Task { await speech.speak("Second line."); finished.append("second") }
        let third = Task { await speech.speak("Third line."); finished.append("third") }
        await first.value
        await second.value
        await third.value
        #expect(await voice.made == ["First line.", "It has two sentences.", "Second line.", "Third line."])
        #expect(player.events == ["play 1", "play 2", "play 3", "play 4"])
        #expect(finished == ["first", "second", "third"])
    }

    @Test func speakReturnsOnlyOnceTheLineWasHeard() async {
        let speech = speech()
        await speech.speak("On it.")
        #expect(player.events == ["play 1"])
        // A second line starts only after the first one, so nothing is played over it.
        await speech.speak("Okay, I won't do anything.")
        #expect(player.events == ["play 1", "play 2"])
    }

    @Test func theOpeningLineMeowsFirst() async {
        let speech = speech()
        await speech.speakOpening("You want me to rename the invoices in your Downloads folder by date. Should I go ahead?")
        #expect(player.events == ["meow", "play 1", "play 2"])
        await speech.speak("On it.")
        #expect(player.events.filter { $0 == "meow" }.count == 1, "only the opening line meows")
    }

    @Test func noMeowWithSoundsOff() async {
        let speech = speech(soundsOn: false)
        await speech.speakOpening("You want me to rename the invoices in your Downloads folder by date.")
        #expect(player.events == ["play 1"])
    }

    /// The real loader, pointed at a folder without the model, throws the error the app sees when
    /// the voice files were never fetched.
    @Test func aVoiceThatDidNotLoadStaysQuietAndWarnsOnce() async throws {
        let empty = FileManager.default.temporaryDirectory.appending(path: "yumi-no-voice-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: empty, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: empty) }
        await #expect(throws: KokoroVoice.LoadError.missingFile(KokoroVoice.modelFile)) {
            _ = try await KokoroVoice.load(from: empty)
        }

        var warnings = 0
        let speech = NeuralSpeech(
            load: { try await KokoroVoice.load(from: empty) }, player: player, soundsOn: { true }, loadFailed: { warnings += 1 }
        )
        await speech.speakOpening("You want me to rename the invoices in your Downloads folder by date. Should I go ahead?")
        await speech.speak("On it.")
        #expect(player.events.isEmpty, "no meow and no voice: nothing that sounds broken")
        #expect(speech.state == .failed)
        #expect(warnings == 1)
    }

    @Test func tryAgainLoadsTheVoiceAgain() async {
        let voice = FakeVoice()
        let attempts = Attempts()
        var warnings = 0
        let speech = NeuralSpeech(
            load: {
                guard await attempts.next() > 1 else { throw KokoroVoice.LoadError.missingFile(KokoroVoice.modelFile) }
                return voice
            },
            player: player, soundsOn: { true }, loadFailed: { warnings += 1 }
        )
        await speech.speak("On it.")
        #expect(speech.state == .failed)
        #expect(player.events.isEmpty)

        speech.reload()
        #expect(speech.state == .loading)
        await speech.speak("On it.")
        #expect(speech.state == .ready)
        #expect(player.events == ["play 1"])
        #expect(warnings == 1)
        speech.reload()
        #expect(await attempts.count == 2, "a voice that is ready is not loaded again")
    }

    actor Attempts {
        private(set) var count = 0
        func next() -> Int {
            count += 1
            return count
        }
    }

    @Test func aSentenceThatFailsEndsTheLineQuietly() async {
        let speech = speech(voice: FakeVoice(failOn: "It has two sentences."))
        await speech.speak("First line. It has two sentences. And a third.")
        #expect(player.events == ["play 1"], "half a line in another voice would sound broken")
        await speech.speak("Next line.")
        #expect(player.events == ["play 1", "play 2"], "the next line is said as usual")
    }

    @Test func linesSplitIntoSentences() {
        #expect(NeuralSpeech.sentences(in: "You want me to rename the invoices. Should I go ahead?") == ["You want me to rename the invoices.", "Should I go ahead?"])
        #expect(NeuralSpeech.sentences(in: "The file is 3.5 GB! Keep it?") == ["The file is 3.5 GB!", "Keep it?"])
        #expect(NeuralSpeech.sentences(in: "On it") == ["On it"])
        #expect(NeuralSpeech.sentences(in: "  ") == [])
    }

    @Test func theWarningButtonsLoadTheVoiceAgainOrClose() {
        let presented = ErrorPresenter.present(UserError(kind: .voiceFailedToLoad))
        #expect(presented.buttons == [ErrorButton(label: "Try again", action: .reloadVoice), ErrorButton(label: "Not now", action: .dismiss)])
    }

    /// The first repeat-back of a goal opens the conversation; asking again after an unclear answer does not.
    @Test func onlyTheFirstRepeatBackOpensTheConversation() async {
        final class Speech: SpeechOutput {
            var said: [String] = []
            func speak(_ text: String) async { said.append(text) }
            func speakOpening(_ text: String) async { said.append("opening: " + text) }
        }
        final class Listener: ReplyListening {
            func listenForReply() async -> String? { nil }
        }
        final class Panel: ConfirmationPresenting {
            func show(taskId: String, text: String, choose: @escaping (ConfirmationChoice) -> Void) {}
            func close(taskId: String) {}
        }
        let speech = Speech()
        let overlay = CursorOverlay(locator: WindowCenterLocator())
        let flow = GoalConfirmation(speech: speech, listener: Listener(), presenter: Panel(), overlay: overlay) { _, _ in }
        let taskId = "6f1d2c3b-4a5e-4f60-8172-93a4b5c6d7e8"
        await flow.goalRestated(GoalRestated(taskId: taskId, text: "You want me to rename the invoices. Should I go ahead?"))
        await flow.goalRestated(GoalRestated(taskId: taskId, text: "Got it. You want me to rename only the October invoices. Should I go ahead?"))
        #expect(speech.said == [
            "opening: You want me to rename the invoices. Should I go ahead?",
            "Got it. You want me to rename only the October invoices. Should I go ahead?",
        ])
    }
}
