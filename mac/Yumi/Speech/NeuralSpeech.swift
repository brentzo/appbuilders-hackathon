import Foundation
import OSLog

/// Yumi's voice on the Mac (OBJ-51, SPEC-04 r20): a neural voice made on this Mac, never sent anywhere.
///
/// - Lines are said in the order `speak` was called, and each call returns once its line was heard.
/// - A line is made one sentence at a time, and the first sentence plays while the next is made,
///   so the first word comes quickly.
/// - The line that opens a conversation (`speakOpening`) starts with the cat's meow, unless
///   "Play sounds" is off. The voice gets the first sentence ready while the meow plays.
/// - If the voice cannot load, Yumi stays quiet: never the system voice, so it never sounds broken
///   (Brent's decision, 2026-10-10). `loadFailed` shows the "Voice didn't load (Mac)" warning,
///   whose "Try again" calls `reload()`. Why it failed goes to the log only.
@MainActor
final class NeuralSpeech: SpeechOutput {
    /// Silence between the meow fading and the first word.
    static let afterMeow: TimeInterval = 0.1

    enum LoadState: Equatable {
        case loading
        case ready
        case failed
    }

    private(set) var state: LoadState = .loading
    private var voice: Task<VoiceSynthesizing?, Never>?
    private let load: @Sendable () async throws -> VoiceSynthesizing
    private let player: SpeechPlaying
    private let soundsOn: () -> Bool
    private let loadFailed: () -> Void
    private var last: Task<Void, Never>?
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "speech")

    init(
        load: @escaping @Sendable () async throws -> VoiceSynthesizing,
        player: SpeechPlaying,
        soundsOn: @escaping () -> Bool,
        loadFailed: @escaping () -> Void
    ) {
        self.load = load
        self.player = player
        self.soundsOn = soundsOn
        self.loadFailed = loadFailed
        startLoading()
    }

    /// The app's voice: Kokoro from `KokoroVoice.folder`, the meow following the "Play sounds"
    /// setting, and the warning panel when the voice cannot load.
    static func yumi(defaults: UserDefaults = .standard) -> NeuralSpeech {
        var folder = KokoroVoice.folder
        #if DEBUG
        if let path = LaunchArguments.string("YumiVoiceFolder") { folder = URL(fileURLWithPath: path) }
        #endif
        let warning = VoiceWarningPanel()
        let speech = NeuralSpeech(
            load: { [folder] in try await KokoroVoice.load(from: folder) },
            player: SpeechPlayback(),
            soundsOn: { defaults.object(forKey: CatSounds.playSoundsKey) as? Bool ?? true },
            loadFailed: { warning.show() }
        )
        warning.tryAgain = { [weak speech] in speech?.reload() }
        #if DEBUG
        speech.sayLaunchArgument()
        #endif
        return speech
    }

    /// Loads the voice again after it failed. Does nothing while it is loading or ready.
    func reload() {
        guard state == .failed else { return }
        log.notice("Loading Yumi's voice again")
        startLoading()
    }

    func speak(_ text: String) async { await enqueue(text, opening: false) }

    func speakOpening(_ text: String) async { await enqueue(text, opening: true) }

    /// Ends the current line now and completes whatever waited on it, for a barge-in.
    func stop() { player.stop() }

    private func startLoading() {
        state = .loading
        let load = load
        voice = Task {
            let start = Date()
            do {
                let voice = try await load()
                state = .ready
                log.notice("Yumi's voice is ready in \(Int(Date().timeIntervalSince(start) * 1000), privacy: .public) ms")
                return voice
            } catch {
                state = .failed
                log.error("Yumi's voice could not load, so Yumi stays quiet: \(String(describing: error), privacy: .public)")
                loadFailed()
                return nil
            }
        }
    }

    private func enqueue(_ text: String, opening: Bool) async {
        let previous = last
        let line = Task {
            await previous?.value
            await say(text, opening: opening)
        }
        last = line
        await line.value
    }

    private func say(_ text: String, opening: Bool) async {
        let asked = Date()
        guard let voice = await voice?.value else {
            log.notice("A line of \(text.count, privacy: .public) characters stays unsaid: Yumi's voice is not loaded")
            return
        }
        let meowQuiet = opening && soundsOn() ? player.meow().map { asked + $0 + Self.afterMeow } : nil
        var heard: [Task<Void, Never>] = []
        for (index, sentence) in Self.sentences(in: text).enumerated() {
            do {
                let samples = try await voice.synthesize(sentence)
                if index == 0, let meowQuiet { await Self.sleep(until: meowQuiet) }
                heard.append(try schedule(samples, sampleRate: voice.sampleRate))
            } catch {
                // Saying half a line, or the rest in another voice, would sound broken; stop here.
                log.error("Yumi's voice could not say part of a line, so the rest stays unsaid: \(String(describing: error), privacy: .public)")
                break
            }
            if index == 0 {
                log.notice("First word after \(Int(Date().timeIntervalSince(asked) * 1000), privacy: .public) ms (meow first: \(meowQuiet != nil, privacy: .public))")
            }
        }
        for wait in heard { await wait.value }
        log.notice("Line heard \(Int(Date().timeIntervalSince(asked) * 1000), privacy: .public) ms after it was asked for")
    }

    /// Queues the samples now and returns a task that finishes once they were heard.
    private func schedule(_ samples: [Float], sampleRate: Double) throws -> Task<Void, Never> {
        let (heard, done) = AsyncStream<Void>.makeStream()
        try player.schedule(samples, sampleRate: sampleRate) { done.finish() }
        return Task { for await _ in heard {} }
    }

    private static func sleep(until date: Date) async {
        let seconds = date.timeIntervalSinceNow
        if seconds > 0 { try? await Task.sleep(for: .seconds(seconds)) }
    }

    /// Splits a line after each `.`, `!`, or `?` followed by a space, keeping the punctuation, so
    /// "3.5 GB" stays whole.
    nonisolated static func sentences(in text: String) -> [String] {
        var sentences: [String] = []
        var current = ""
        let characters = Array(text)
        for (index, character) in characters.enumerated() {
            current.append(character)
            let next = index + 1 < characters.count ? characters[index + 1] : nil
            if ".!?".contains(character), next.map({ $0.isWhitespace }) ?? true {
                current = current.trimmingCharacters(in: .whitespacesAndNewlines)
                if !current.isEmpty { sentences.append(current) }
                current = ""
            }
        }
        current = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !current.isEmpty { sentences.append(current) }
        return sentences
    }

    #if DEBUG
    /// `-YumiSay "<line>"` says the line once the voice is ready, and `-YumiSayOpening YES` says it
    /// as an opening line, with the meow (Debug builds). `-YumiVoiceFolder <path>` loads the voice
    /// from another folder, for example an empty one to see the warning. Timings are in the "speech" log.
    private func sayLaunchArgument() {
        guard let line = LaunchArguments.string("YumiSay") else { return }
        let opening = LaunchArguments.bool("YumiSayOpening")
        Task {
            // Wait for the voice first, so the logged timings are those of a running app.
            _ = await voice?.value
            if opening { await speakOpening(line) } else { await speak(line) }
        }
    }
    #endif
}
