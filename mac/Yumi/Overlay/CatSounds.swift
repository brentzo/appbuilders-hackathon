import AVFoundation
import OSLog

/// The cat's sounds. A meow when a cat finishes its task and heads back to the island: loaded
/// ahead of time so it is never late, at a modest volume, at most once every 1.5 seconds (three
/// ghosts finishing together give one meow), and only while the "YumiPlaySounds" setting is on.
@MainActor
final class CatSounds {
    static let playSoundsKey = "YumiPlaySounds"
    static let meowGap: TimeInterval = 1.5
    static let volume: Float = 0.35

    private let meowPlayer: AVAudioPlayer?
    private var lastMeow: Date?
    private let defaults: UserDefaults
    private let log = Logger(subsystem: "ph.appbuilders.yumi", category: "overlay")

    init(defaults: UserDefaults = .standard, bundle: Bundle = .main) {
        self.defaults = defaults
        meowPlayer = bundle.url(forResource: "cat-meow", withExtension: "mp3").flatMap { try? AVAudioPlayer(contentsOf: $0) }
        meowPlayer?.volume = Self.volume
        meowPlayer?.prepareToPlay()
        if meowPlayer == nil { log.error("The meow sound is missing from the app") }
    }

    /// Sounds are on unless the user turned them off.
    var enabled: Bool { defaults.object(forKey: Self.playSoundsKey) as? Bool ?? true }

    /// Meows unless sounds are off or a meow played less than 1.5 seconds ago. Returns whether it did.
    @discardableResult
    func meow(now: Date = Date()) -> Bool {
        guard enabled else { return false }
        if let lastMeow, now.timeIntervalSince(lastMeow) < Self.meowGap { return false }
        lastMeow = now
        meowPlayer?.currentTime = 0
        meowPlayer?.play()
        return true
    }
}
