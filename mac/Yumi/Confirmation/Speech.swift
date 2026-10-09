/// Everything Yumi says out loud on the Mac goes through here (OBJ-17.4): the repeat-back, the
/// cancel line, the tiling question, and the harness's `speak` events. The app speaks with
/// `NeuralSpeech`, Yumi's Kokoro voice (OBJ-51), and never with the system voice (SPEC-04 r20).
@MainActor
protocol SpeechOutput: AnyObject {
    /// Returns when the sentence has been said, so listening for a reply can start right after.
    func speak(_ text: String) async
    /// The line that opens a conversation: the first repeat-back of a goal. Yumi's voice meows
    /// first (OBJ-51). Other outputs just say it.
    func speakOpening(_ text: String) async
}

extension SpeechOutput {
    func speakOpening(_ text: String) async { await speak(text) }
}
