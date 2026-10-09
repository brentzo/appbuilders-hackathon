import Carbon.HIToolbox
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

    @Test func listeningShowsInTheStatusLine() {
        let model = AppModel()
        model.harnessReady = true
        model.isListening = true
        #expect(model.status == .listening)
        model.isListening = false
        #expect(model.status == .ready)
    }
}
