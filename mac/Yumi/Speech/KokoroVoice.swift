import Foundation
import KokoroSwift

/// Turns one sentence into audio samples, off the main thread.
nonisolated protocol VoiceSynthesizing: AnyObject, Sendable {
    var sampleRate: Double { get }
    func synthesize(_ text: String) async throws -> [Float]
}

/// Yumi's voice (OBJ-51, SPEC-04 r20): Kokoro-82M with the af_heart voice, run by MLX on this Mac.
///
/// The files are not in git and never downloaded by the app: `mac/scripts/fetch-voice-model.sh`
/// puts them, with their checksums, into `~/Library/Application Support/Yumi/Models/Voice`.
/// Brent picked the sound on 2026-10-10 ("heart-blend-plus7"): af_heart at speed 1.1, its
/// pitch raised 4 semitones inside the model with livelier intonation, then 3 more semitones by
/// `SpeechPlayback`, which also lifts the formants a little so the voice sounds smaller.
nonisolated final class KokoroVoice: VoiceSynthesizing, @unchecked Sendable {
    static var folder: URL {
        URL.applicationSupportDirectory.appending(path: "Yumi/Models/Voice", directoryHint: .isDirectory)
    }

    static let modelFile = "kokoro-v1_0.safetensors"
    static let voiceFile = "af_heart.safetensors"
    static let speed: Float = 1.1
    static let pitchShift: Float = 4
    static let intonation: Float = 1.3
    /// The rest of the pitch, added on playback (`AVAudioUnitTimePitch`, in cents).
    static let playbackPitchCents: Float = 300
    /// MLX keeps freed buffers for reuse; a small cap keeps Yumi light next to the planning model.
    static let cacheLimitBytes = 64 * 1024 * 1024

    enum LoadError: Error, Equatable {
        case missingFile(String)
    }

    let sampleRate = Double(KokoroSpeaker.sampleRate)

    // Touched only on `queue`: MLX work for this voice runs one sentence at a time on one thread.
    private let speaker: KokoroSpeaker
    private let queue: DispatchQueue

    private init(speaker: KokoroSpeaker, queue: DispatchQueue) {
        self.speaker = speaker
        self.queue = queue
    }

    /// Loads the model and voice from `folder` and says one short word to itself, so the first real
    /// sentence does not pay for compiling the GPU kernels.
    static func load(from folder: URL = folder) async throws -> KokoroVoice {
        let queue = DispatchQueue(label: "ph.appbuilders.yumi.voice", qos: .userInitiated)
        return try await withCheckedThrowingContinuation { continuation in
            queue.async {
                continuation.resume(with: Result {
                    for file in [modelFile, voiceFile] where !FileManager.default.fileExists(atPath: folder.appending(path: file).path) {
                        throw LoadError.missingFile(file)
                    }
                    let speaker = try KokoroSpeaker(
                        modelURL: folder.appending(path: modelFile), voiceURL: folder.appending(path: voiceFile),
                        cacheLimitBytes: cacheLimitBytes
                    )
                    let loaded = KokoroVoice(speaker: speaker, queue: queue)
                    _ = try loaded.render("Hi.")
                    return loaded
                })
            }
        }
    }

    func synthesize(_ text: String) async throws -> [Float] {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                continuation.resume(with: Result { try self.render(text) })
            }
        }
    }

    private func render(_ text: String) throws -> [Float] {
        try speaker.speak(text, speed: Self.speed, pitchShift: Self.pitchShift, intonation: Self.intonation)
    }
}
