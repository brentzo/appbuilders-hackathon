import Foundation

/// Where the wake word models live and which one is used (OBJ-16.1).
///
/// The files are not in git: `mac/scripts/fetch-wake-word-models.sh` downloads them, with their
/// checksums, into `~/Library/Application Support/Yumi/Models/WakeWord`. Without them the wake
/// word is off and push-to-talk still works (SPEC-01 r11).
nonisolated enum WakeWordModels {
    static var folder: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Yumi/Models/WakeWord", isDirectory: true)
    }

    static let melspectrogram = "melspectrogram.onnx"
    static let embedding = "embedding_model.onnx"
    /// The real model from OBJ-12. Used as soon as the file is in the folder.
    static let heyYumi = "hey_yumi.onnx"
    /// STAND-IN until OBJ-12's "Hey Yumi" model exists: openWakeWord's pre-trained "hey jarvis"
    /// (openWakeWord v0.5.1 release). Say "Hey Jarvis" to wake Yumi while this is in use.
    static let standIn = "hey_jarvis_v0.1.onnx"

    /// openWakeWord's default threshold, until OBJ-12 picks one for "Hey Yumi".
    static let threshold: Float = 0.5

    struct Choice: Equatable {
        let file: String
        let phrase: String
        let isStandIn: Bool
    }

    static func choice(in folder: URL = folder) -> Choice? {
        let has = { FileManager.default.fileExists(atPath: folder.appendingPathComponent($0).path) }
        guard has(melspectrogram), has(embedding) else { return nil }
        if has(heyYumi) { return Choice(file: heyYumi, phrase: "Hey Yumi", isStandIn: false) }
        if has(standIn) { return Choice(file: standIn, phrase: "Hey Jarvis", isStandIn: true) }
        return nil
    }

    /// Loads the three models into a scorer, ready for audio.
    static func loadScorer(from folder: URL = folder) throws -> (WakeWordScorer, Choice)? {
        guard let choice = choice(in: folder) else { return nil }
        let mel = try OnnxModel(contentsOf: folder.appendingPathComponent(melspectrogram))
        let embedding = try OnnxModel(contentsOf: folder.appendingPathComponent(embedding))
        let wake = try OnnxModel(contentsOf: folder.appendingPathComponent(choice.file))
        let features = WakeWordFeatures(
            melspectrogram: mel, embedding: embedding,
            warmUp: try WakeWordFeatures.warmUp(melspectrogram: mel, embedding: embedding)
        )
        return (WakeWordScorer(features: features, model: wake), choice)
    }
}
