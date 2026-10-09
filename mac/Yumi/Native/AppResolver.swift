import AppKit

/// Finds an installed app by the name the user sees, for `resolveApp` and `open_app` by name
/// (OBJ-36, covering the `resolveApp` part of OBJ-39). The harness's router calls `resolveApp`
/// with the app a planned subtask names (`TargetApp.name`), then probes that bundle id.
///
/// It only answers with apps that are on this Mac: it reads the app bundles in the standard
/// application folders, and keeps one only if Launch Services knows its bundle id. A bundle id is
/// never guessed from the name, because the same app can change id between versions
/// (`com.apple.Keynote` now, `com.apple.iWork.Keynote` before).
///
/// A name matches what the user can see for the app, ignoring case and accents: its name in
/// Finder, its `CFBundleName` or `CFBundleDisplayName`, or its file name. On the demo Mac, Keynote's
/// bundle is "Keynote Creator Studio.app" and Finder shows it as "Keynote". Nothing is launched.
nonisolated enum AppResolver {
    /// Where apps are installed, in the order they are searched. The first match wins.
    static let applicationFolders = [
        "/Applications",
        "/Applications/Utilities",
        "/System/Applications",
        "/System/Applications/Utilities",
        NSString(string: "~/Applications").expandingTildeInPath,
        // Finder lives here, and "open the Downloads folder" works in Finder.
        "/System/Library/CoreServices",
    ]

    struct Found: Equatable, Sendable {
        let bundleId: String
        let url: URL
    }

    /// The installed app with this name, or nil when no installed app has it.
    ///
    /// `registered` returns where Launch Services has the app with a bundle id, or nil when it
    /// has none; tests pass their own.
    static func resolve(
        _ name: String,
        in folders: [String] = applicationFolders,
        registered: (String) -> URL? = { NSWorkspace.shared.urlForApplication(withBundleIdentifier: $0) }
    ) -> Found? {
        var wanted = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if wanted.lowercased().hasSuffix(".app") { wanted = String(wanted.dropLast(4)) }
        guard !wanted.isEmpty, !wanted.contains("/") else { return nil }

        for folder in folders {
            let entries = (try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? []
            for entry in entries.sorted() where entry.lowercased().hasSuffix(".app") {
                let url = URL(fileURLWithPath: folder).appendingPathComponent(entry)
                guard names(of: url).contains(where: { same($0, wanted) }),
                      let bundleId = Bundle(url: url)?.bundleIdentifier,
                      registered(bundleId) != nil
                else { continue }
                return Found(bundleId: bundleId, url: url)
            }
        }
        return nil
    }

    /// Every name the user can see for an app bundle.
    static func names(of url: URL) -> [String] {
        let info = Bundle(url: url)?.infoDictionary ?? [:]
        let shown = FileManager.default.displayName(atPath: url.path)
        return [
            withoutAppExtension(shown),
            info["CFBundleName"] as? String,
            info["CFBundleDisplayName"] as? String,
            url.deletingPathExtension().lastPathComponent,
        ].compactMap { $0 }
    }

    private static func withoutAppExtension(_ name: String) -> String {
        name.lowercased().hasSuffix(".app") ? String(name.dropLast(4)) : name
    }

    private static func same(_ a: String, _ b: String) -> Bool {
        a.compare(b, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
    }
}
