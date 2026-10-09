import Foundation
import YumiProtocol

/// One window Yumi moved, and where it was before (OBJ-20.3).
struct SavedWindow: Codable, Equatable {
    let windowId: Int
    let bundleId: String
    /// The original frame, in global top-left coordinates. It also says which display it was on.
    let frame: Rect
}

/// The original frames of the windows Yumi tiled, by task id, kept in the app's own preferences so
/// they survive an app or harness restart (OBJ-20.6). The harness has no place for them.
struct TiledLayoutStore {
    static let key = "tiling.savedLayouts"
    let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    func load() -> [String: [SavedWindow]] {
        guard let data = defaults.data(forKey: Self.key) else { return [:] }
        return (try? JSONDecoder().decode([String: [SavedWindow]].self, from: data)) ?? [:]
    }

    func save(_ layouts: [String: [SavedWindow]]) {
        if layouts.isEmpty {
            defaults.removeObject(forKey: Self.key)
        } else if let data = try? JSONEncoder().encode(layouts) {
            defaults.set(data, forKey: Self.key)
        }
    }
}
