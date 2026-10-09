//
//  Yumi addition: one voice, ready to speak, without exposing MLX to the app.
//
import Foundation
import MLX

/// A Kokoro model with one voice style loaded, so apps can make speech without importing MLX.
/// Not thread safe: call it from one thread or serial queue.
public final class KokoroSpeaker {
  public enum LoadError: Error, Equatable {
    /// The voice file has no `voice` tensor.
    case badVoiceFile
  }

  /// Audio sampling rate in Hz.
  public static let sampleRate = KokoroTTS.Constants.samplingRate

  private let tts: KokoroTTS
  private let voice: MLXArray

  /// Loads the model weights (a safetensors file) and a voice style (a safetensors file holding a
  /// `voice` tensor). `cacheLimitBytes` caps the buffers MLX keeps for reuse.
  public init(modelURL: URL, voiceURL: URL, cacheLimitBytes: Int) throws {
    Memory.cacheLimit = cacheLimitBytes
    tts = try KokoroTTS(modelPath: modelURL, g2p: .misaki)
    guard let voice = try MLX.loadArrays(url: voiceURL)["voice"] else { throw LoadError.badVoiceFile }
    self.voice = voice
  }

  /// American English speech for `text`, as samples at `sampleRate`.
  public func speak(_ text: String, speed: Float, pitchShift: Float, intonation: Float) throws -> [Float] {
    try tts.generateAudio(voice: voice, language: .enUS, text: text, speed: speed, pitchShift: pitchShift, intonation: intonation).0
  }
}
