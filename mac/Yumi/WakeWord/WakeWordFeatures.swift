/// One ONNX model call: flat float input with its shape in, flat float output out.
nonisolated protocol TensorModel: AnyObject {
    func run(_ input: [Float], shape: [Int]) throws -> [Float]
}

/// openWakeWord's audio feature step (OBJ-16.2), ported from `openwakeword.utils.AudioFeatures`
/// (version 0.6.0) so the Mac computes the same features as the Python reference.
///
/// 16 kHz 16-bit audio goes in 80 ms chunks (1,280 samples). Each chunk, with 480 samples of the
/// one before, becomes 8 mel spectrogram frames (the ONNX model's output, then `x / 10 + 2`). The
/// last 76 frames become one 96-value speech embedding. A wake word model scores the last 16
/// embeddings. Audio is held only in the rolling buffers below, never stored.
nonisolated final class WakeWordFeatures {
    static let sampleRate = 16_000
    static let chunk = 1_280
    static let overlap = 160 * 3
    static let melBins = 32
    static let melWindow = 76
    static let embeddingSize = 96
    static let maxMelFrames = 10 * 97
    static let maxEmbeddings = 120

    private let melspectrogram: TensorModel
    private let embedding: TensorModel
    /// The last 10 s of audio, as openWakeWord keeps it.
    private var raw: [Int16] = []
    private var pending: [Int16] = []
    /// Frames of 32 mel values, oldest first. Starts as 76 frames of ones, as in openWakeWord.
    private(set) var mel: [[Float]] = Array(repeating: Array(repeating: 1, count: melBins), count: melWindow)
    /// Embeddings, oldest first.
    private(set) var embeddings: [[Float]]

    init(melspectrogram: TensorModel, embedding: TensorModel, warmUp: [[Float]]) {
        self.melspectrogram = melspectrogram
        self.embedding = embedding
        embeddings = warmUp
    }

    /// Adds audio. Returns how many whole 80 ms chunks became new embeddings.
    @discardableResult
    func append(_ samples: [Int16]) throws -> Int {
        pending += samples
        var added = 0
        while pending.count >= Self.chunk {
            let chunk = pending.prefix(Self.chunk)
            pending.removeFirst(Self.chunk)
            raw += chunk
            if raw.count > Self.sampleRate * 10 { raw.removeFirst(raw.count - Self.sampleRate * 10) }
            try addMelFrames(Array(raw.suffix(Self.chunk + Self.overlap)))
            try addEmbedding()
            added += 1
        }
        return added
    }

    /// Drops the audio and mel history, as openWakeWord's reset does. The embedding history keeps
    /// its last 16 entries so scoring can go on at once.
    func reset() {
        raw = []
        pending = []
        mel = Array(repeating: Array(repeating: 1, count: Self.melBins), count: Self.melWindow)
    }

    /// The last `count` embeddings, flattened, for the wake word model.
    func lastEmbeddings(_ count: Int = 16) -> [Float] {
        embeddings.suffix(count).flatMap { $0 }
    }

    /// Mel frames of some audio, with openWakeWord's default transform.
    func melFrames(_ samples: [Int16]) throws -> [[Float]] {
        let output = try melspectrogram.run(samples.map(Float.init), shape: [1, samples.count])
        return stride(from: 0, to: output.count, by: Self.melBins).map { start in
            output[start..<start + Self.melBins].map { $0 / 10 + 2 }
        }
    }

    private func addMelFrames(_ samples: [Int16]) throws {
        mel += try melFrames(samples)
        if mel.count > Self.maxMelFrames { mel.removeFirst(mel.count - Self.maxMelFrames) }
    }

    private func addEmbedding() throws {
        guard mel.count >= Self.melWindow else { return }
        let window = mel.suffix(Self.melWindow).flatMap { $0 }
        embeddings.append(try embedding.run(window, shape: [1, Self.melWindow, Self.melBins, 1]))
        if embeddings.count > Self.maxEmbeddings { embeddings.removeFirst(embeddings.count - Self.maxEmbeddings) }
    }

    /// Embeddings of noise to fill the history before real audio arrives, as openWakeWord does with
    /// 4 s of random samples between -1000 and 1000.
    static func warmUp(melspectrogram: TensorModel, embedding: TensorModel) throws -> [[Float]] {
        var generator = SystemRandomNumberGenerator()
        let noise = (0..<sampleRate * 4).map { _ in Int16.random(in: -1000..<1000, using: &generator) }
        let probe = WakeWordFeatures(melspectrogram: melspectrogram, embedding: embedding, warmUp: [])
        let frames = try probe.melFrames(noise)
        return try stride(from: 0, through: frames.count - melWindow, by: 8).map { start in
            try embedding.run(frames[start..<start + melWindow].flatMap { $0 }, shape: [1, melWindow, melBins, 1])
        }
    }
}

/// Scores the last 16 embeddings with a wake word model (OBJ-16.1), one score per 80 ms chunk.
/// Used only on the wake word listener's detection queue, one call at a time.
nonisolated final class WakeWordScorer: @unchecked Sendable {
    private let features: WakeWordFeatures
    private let model: TensorModel
    private var scored = 0

    init(features: WakeWordFeatures, model: TensorModel) {
        self.features = features
        self.model = model
    }

    /// For the reference test: the feature step behind this scorer.
    var featuresForTesting: WakeWordFeatures { features }

    /// Starts over, for example after Yumi used the microphone for a goal.
    func reset() {
        features.reset()
        scored = 0
    }

    /// Adds audio and returns the score of each new chunk, 0 for the first 5 as openWakeWord does.
    func append(_ samples: [Int16]) throws -> [Float] {
        let chunks = try features.append(samples)
        guard chunks > 0 else { return [] }
        // openWakeWord scores once per call with the newest 16 embeddings; for one chunk per call
        // that is once per chunk.
        var scores: [Float] = []
        for _ in 0..<chunks {
            let score = try model.run(features.lastEmbeddings(16), shape: [1, 16, WakeWordFeatures.embeddingSize]).first ?? 0
            scored += 1
            scores.append(scored <= 5 ? 0 : score)
        }
        return scores
    }
}
