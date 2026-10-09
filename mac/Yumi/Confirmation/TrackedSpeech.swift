/// Says everything through `inner`, and marks `AppModel.isSpeaking` while it talks, so the wake
/// word pauses and Yumi never wakes itself (OBJ-58.4).
@MainActor
final class TrackedSpeech: SpeechOutput {
    let inner: SpeechOutput
    private let model: AppModel
    private var sentences = 0

    init(_ inner: SpeechOutput, model: AppModel) {
        self.inner = inner
        self.model = model
    }

    func speak(_ text: String) async {
        await tracking { await inner.speak(text) }
    }

    /// Passed on as is, so the voice still meows first (OBJ-51).
    func speakOpening(_ text: String) async {
        await tracking { await inner.speakOpening(text) }
    }

    /// Ends the voice now; the `speaking` flag clears when the line's `tracking` returns.
    func stop() {
        inner.stop()
    }

    private func tracking(_ say: () async -> Void) async {
        sentences += 1
        model.isSpeaking = true
        await say()
        sentences -= 1
        model.isSpeaking = sentences > 0
    }
}
