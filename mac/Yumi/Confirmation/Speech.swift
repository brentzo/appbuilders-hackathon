import AVFoundation

/// Everything Yumi says out loud on the Mac goes through here (OBJ-17.4): the repeat-back, the
/// cancel line, the tiling question, and the harness's `speak` events. A Kokoro voice can replace
/// the system voice later behind the same interface.
@MainActor
protocol SpeechOutput: AnyObject {
    /// Returns when the sentence has been said, so listening for a reply can start right after.
    func speak(_ text: String) async
}

/// The system voice, through `AVSpeechSynthesizer`. A new sentence waits for the one before it.
@MainActor
final class SystemSpeech: NSObject, SpeechOutput, AVSpeechSynthesizerDelegate {
    private let synthesizer = AVSpeechSynthesizer()
    private var finished: [ObjectIdentifier: CheckedContinuation<Void, Never>] = [:]

    override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String) async {
        let utterance = AVSpeechUtterance(string: text)
        await withCheckedContinuation { continuation in
            finished[ObjectIdentifier(utterance)] = continuation
            synthesizer.speak(utterance)
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in self.finished.removeValue(forKey: id)?.resume() }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        let id = ObjectIdentifier(utterance)
        Task { @MainActor in self.finished.removeValue(forKey: id)?.resume() }
    }
}
