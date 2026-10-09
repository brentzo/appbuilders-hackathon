import Foundation
import Testing
@testable import Yumi

/// OBJ-16.2: the Swift feature step matches openWakeWord 0.6.0 on a fixed clip, and the stand-in
/// model wakes on it. The models are not in git: run `mac/scripts/fetch-wake-word-models.sh`.
/// Without them these tests are skipped, and say so.
@MainActor
struct WakeWordTests {
    struct Reference: Decodable {
        let samples: Int
        let chunk: Int
        let embeddings: [[Float]]
        let scores: [Float]
    }

    nonisolated static let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
        .appendingPathComponent("Fixtures/WakeWord", isDirectory: true)
    nonisolated static let modelsPresent = WakeWordModels.choice() != nil

    func clip() throws -> [Int16] {
        let data = try Data(contentsOf: Self.fixtures.appendingPathComponent("hey-jarvis-clip.wav"))
        // A plain 44-byte WAVE header, then 16-bit little-endian samples.
        return data.dropFirst(44).withUnsafeBytes { Array($0.bindMemory(to: Int16.self)) }
    }

    @Test(.enabled(if: modelsPresent, "Wake word models missing: run mac/scripts/fetch-wake-word-models.sh"))
    func swiftFeaturesMatchThePythonReference() throws {
        let reference = try JSONDecoder().decode(Reference.self, from: Data(contentsOf: Self.fixtures.appendingPathComponent("reference.json")))
        let samples = Array(try clip().prefix(reference.samples))
        let (scorer, choice) = try #require(try WakeWordModels.loadScorer(from: WakeWordModels.folder))
        let features = scorer.featuresForTesting
        try #require(choice.file == WakeWordModels.standIn || choice.file == WakeWordModels.heyYumi)

        var worstEmbedding: Float = 0
        var worstScore: Float = 0
        var scores: [Float] = []
        for (index, start) in stride(from: 0, to: samples.count, by: reference.chunk).enumerated() {
            let chunkScores = try scorer.append(Array(samples[start..<start + reference.chunk]))
            scores += chunkScores
            let embedding = try #require(features.embeddings.last)
            worstEmbedding = max(worstEmbedding, zip(embedding, reference.embeddings[index]).map { abs($0 - $1) }.max() ?? 0)
            // The first 16 scores also use openWakeWord's random warm-up embeddings.
            if index >= 16, choice.file == WakeWordModels.standIn {
                worstScore = max(worstScore, abs(chunkScores[0] - reference.scores[index]))
            }
        }
        #expect(scores.count == reference.scores.count)
        #expect(worstEmbedding < 1e-3, "largest embedding difference \(worstEmbedding)")
        if choice.file == WakeWordModels.standIn {
            #expect(worstScore < 1e-3, "largest score difference \(worstScore)")
            #expect((scores.max() ?? 0) > WakeWordModels.threshold, "\"Hey Jarvis\" wakes the stand-in")
        }
        print("Wake word: largest embedding difference \(worstEmbedding), largest score difference \(worstScore)")
    }

    @Test(.enabled(if: modelsPresent, "Wake word models missing: run mac/scripts/fetch-wake-word-models.sh"))
    func silenceNeverWakes() throws {
        let (scorer, _) = try #require(try WakeWordModels.loadScorer(from: WakeWordModels.folder))
        let scores = try scorer.append(Array(repeating: 0, count: 16_000 * 3))
        #expect((scores.max() ?? 0) < WakeWordModels.threshold)
    }

    /// SPEC-01 "Wake word turned off": with the setting off, nothing listens for the wake word.
    /// The recording test aid stands in for the microphone, so no permission is needed.
    @Test(.enabled(if: modelsPresent, "Wake word models missing: run mac/scripts/fetch-wake-word-models.sh"))
    func theSettingOpensAndClosesWakeWordListening() throws {
        let suite = "ph.appbuilders.yumi.tests.wakeword.\(UUID().uuidString.prefix(8))"
        let defaults = try #require(UserDefaults(suiteName: suite))
        defer { defaults.removePersistentDomain(forName: suite) }
        let model = AppModel(settings: SettingsStore(defaults: defaults, sink: PendingHarnessSettingsSink()))
        let listener = WakeWordListener(model: model, detector: .openWakeWord, isMicrophoneFree: { true }, listenForGoal: { _ in })
        listener.testRecording = (Self.fixtures.appendingPathComponent("hey-jarvis-clip.wav").path, false)

        model.settings.wakeWordEnabled = false
        listener.update()
        #expect(!listener.isListening, "off: the microphone is not opened for the wake word")

        model.settings.wakeWordEnabled = true
        listener.update()
        #expect(listener.isListening)
        #expect(listener.phrase == "Hey Yumi", "the product name, even on the stand-in model")

        model.settings.wakeWordEnabled = false
        listener.update()
        #expect(!listener.isListening)
    }
}
