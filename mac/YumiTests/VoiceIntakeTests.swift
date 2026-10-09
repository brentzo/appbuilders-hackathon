import Carbon.HIToolbox
import Foundation
import Testing
import YumiProtocol
@testable import Yumi

/// Voice intake (OBJ-15): the push-to-talk shortcut and the "Didn't catch speech" buttons.
@MainActor
struct VoiceIntakeTests {
    @Test func defaultShortcutIsOptionSpace() {
        let shortcut = KeyShortcut.defaultPushToTalk
        #expect(shortcut.keyCode == UInt16(kVK_Space))
        #expect(PushToTalkHotKey.carbonModifiers(shortcut.modifiers) == UInt32(optionKey))
        #expect(PushToTalkHotKey.carbonModifiers([.command, .shift]) == UInt32(cmdKey | shiftKey))
    }

    @Test func didNotCatchSpeechOffersTryAgainAndTyping() {
        let presented = ErrorPresenter.present(UserError(kind: .didNotCatchSpeech))
        #expect(presented.message == "Sorry, I didn't catch that. Could you say it again?")
        #expect(presented.buttons == [
            ErrorButton(label: "Try again", action: .dismiss),
            ErrorButton(label: "Type instead", action: .typeGoal),
        ])
    }

    @Test func recognizerRule() {
        #expect(RecognizerRule.order(speaksTaglish: false, whisperReady: true) == [.native, .whisper])
        #expect(RecognizerRule.order(speaksTaglish: false, whisperReady: false) == [.native])
        #expect(RecognizerRule.order(speaksTaglish: true, whisperReady: true) == [.whisper, .native])
        // Until Whisper is loaded, Taglish speakers still get Apple's recognizer.
        #expect(RecognizerRule.order(speaksTaglish: true, whisperReady: false) == [.native])
    }

    @Test func endpointEndsAfterSilenceThatFollowsSpeech() {
        var outcomes: [SpeechEndpoint.Outcome] = []
        let endpoint = SpeechEndpoint { outcomes.append($0) }
        // 0.3 s of a quiet room, 1 s of speech, then silence in 0.1 s blocks.
        for _ in 0..<3 { endpoint.measure(level: 0.002, duration: 0.1) }
        for _ in 0..<10 { endpoint.measure(level: 0.1, duration: 0.1) }
        for _ in 0..<8 { endpoint.measure(level: 0.002, duration: 0.1) }
        #expect(outcomes.isEmpty)
        for _ in 0..<5 { endpoint.measure(level: 0.002, duration: 0.1) }
        #expect(outcomes == [.spoke])
    }

    @Test func endpointGivesUpWhenNothingIsSaid() {
        var outcomes: [SpeechEndpoint.Outcome] = []
        let endpoint = SpeechEndpoint { outcomes.append($0) }
        for _ in 0..<79 { endpoint.measure(level: 0.002, duration: 0.1) }
        #expect(outcomes.isEmpty, "a person gets 8 seconds to start talking")
        for _ in 0..<2 { endpoint.measure(level: 0.002, duration: 0.1) }
        #expect(outcomes == [.silent])
    }

    /// Task 4ecaff1c (2026-10-10): a blip right after the repeat-back ended the listen within
    /// 1.5 s with nothing transcribed, so "Yes, in a note" said a moment later was never heard.
    @Test func endpointIgnoresAShortSoundAndWaitsForTheAnswer() {
        var outcomes: [SpeechEndpoint.Outcome] = []
        let endpoint = SpeechEndpoint { outcomes.append($0) }
        for _ in 0..<3 { endpoint.measure(level: 0.002, duration: 0.1) }
        endpoint.measure(level: 0.1, duration: 0.1)
        for _ in 0..<20 { endpoint.measure(level: 0.002, duration: 0.1) }
        #expect(outcomes.isEmpty, "a click is not an answer")
        // The user starts talking 2.5 s in and says "yes, in a note" for a second.
        for _ in 0..<10 { endpoint.measure(level: 0.1, duration: 0.1) }
        for _ in 0..<10 { endpoint.measure(level: 0.002, duration: 0.1) }
        #expect(outcomes == [.spoke])
    }

    /// OBJ-17.5 with the real listener: after the repeat-back, a spoken "yes" is transcribed on the
    /// device and goes to the harness as the answer, and the microphone is off again afterwards.
    @Test func aSpokenAnswerReachesTheHarness() async throws {
        let clip = FileManager.default.temporaryDirectory.appending(path: "yumi-yes-\(UUID().uuidString).aiff")
        defer { try? FileManager.default.removeItem(at: clip) }
        let say = try Process.run(URL(fileURLWithPath: "/usr/bin/say"), arguments: ["-o", clip.path, "[[slnc 700]] Yes, go ahead."])
        say.waitUntilExit()
        await NativeRecognizer.prepare()

        let model = AppModel()
        let overlay = CursorOverlay(locator: WindowCenterLocator())
        overlay.start()
        let voice = VoiceIntake(model: model, overlay: overlay, submit: { _ in }, showError: { _ in })
        voice.testRecordings = (nil, clip.path)
        let sent = GoalConfirmationTests.Sent()
        let flow = GoalConfirmation(
            speech: GoalConfirmationTests.FakeSpeech(), listener: voice,
            presenter: GoalConfirmationTests.FakePanel(), overlay: overlay
        ) { _, reply in sent.replies.append(reply) }

        await flow.goalRestated(GoalRestated(taskId: "task-1", text: "You want me to export your Keynote deck as a PDF. Should I go ahead?"))
        guard case .spoken(let answer)? = sent.replies.first else {
            Issue.record("no spoken answer was sent: \(sent.replies)")
            return
        }
        #expect(answer.text.lowercased().contains("yes"))
        #expect(!model.isListening)
    }

    @Test func listeningShowsInTheStatusLine() {
        let model = AppModel()
        model.harnessReady = true
        model.isListening = true
        #expect(model.status == .listening)
        model.isListening = false
        #expect(model.status == .ready)
    }
}
