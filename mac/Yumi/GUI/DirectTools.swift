import AppKit
import YumiProtocol

/// The typed direct tools the Mac app runs (OBJ-44.6, SPEC-05 r1): `open_app`, `open_file`,
/// `open_url`, and `reveal_in_finder`. Each takes only its schema arguments and goes through
/// `NSWorkspace`. There is no shell, AppleScript, or `Process` here, by design (SPEC-07 r3).
@MainActor
enum DirectTools {
    /// Where `open_app` looks for an app by name, when Launch Services has no bundle id for it.
    static let applicationFolders = [
        "/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities",
        NSString(string: "~/Applications").expandingTildeInPath,
    ]

    enum Failure: Error, Equatable {
        case appNotFound
        case fileNotFound
        case badURL
        case couldNotOpen
    }

    /// Runs the tool and returns one line saying what happened, for the step log.
    static func run(_ call: ToolCall) async throws -> String {
        switch call {
        case .openApp(let app):
            let url = try appURL(bundleId: app.bundleId, name: app.name)
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = true
            _ = try await open { try await NSWorkspace.shared.openApplication(at: url, configuration: configuration) }
            return "Opened \(url.deletingPathExtension().lastPathComponent)."
        case .openFile(let file):
            let url = try existingFile(file.path)
            if let bundleId = file.bundleId {
                let app = try appURL(bundleId: bundleId, name: nil)
                _ = try await open {
                    try await NSWorkspace.shared.open([url], withApplicationAt: app, configuration: NSWorkspace.OpenConfiguration())
                }
                return "Opened \(url.lastPathComponent) in \(app.deletingPathExtension().lastPathComponent)."
            }
            guard NSWorkspace.shared.open(url) else { throw Failure.couldNotOpen }
            return "Opened \(url.lastPathComponent)."
        case .openUrl(let link):
            guard let url = URL(string: link.url), ["http", "https"].contains(url.scheme?.lowercased()) else {
                throw Failure.badURL
            }
            guard NSWorkspace.shared.open(url) else { throw Failure.couldNotOpen }
            return "Opened \(url.host() ?? "the link") in the browser."
        case .revealInFinder(let item):
            let url = try existingFile(item.path)
            if (try? url.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) == true, !isPackage(url) {
                // A folder opens as itself, so "open the Downloads folder" shows its contents.
                guard NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: url.path) else { throw Failure.couldNotOpen }
                return "Opened the \(url.lastPathComponent) folder in Finder."
            }
            NSWorkspace.shared.activateFileViewerSelecting([url])
            return "Showed \(url.lastPathComponent) in Finder."
        default:
            // File tools, the Trash and the phone are the harness's (OBJ-42, OBJ-45).
            throw Failure.couldNotOpen
        }
    }

    /// Whether this app runs the tool, as opposed to the harness.
    static func runsHere(_ call: ToolCall) -> Bool {
        switch call {
        case .openApp, .openFile, .openUrl, .revealInFinder: true
        default: false
        }
    }

    static func appURL(bundleId: String?, name: String?) throws -> URL {
        if let bundleId {
            guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) else { throw Failure.appNotFound }
            return url
        }
        guard let name = name?.trimmingCharacters(in: .whitespaces), !name.isEmpty, !name.contains("/") else {
            throw Failure.appNotFound
        }
        let wanted = (name.lowercased().hasSuffix(".app") ? name : name + ".app").lowercased()
        for folder in applicationFolders {
            let entries = (try? FileManager.default.contentsOfDirectory(atPath: folder)) ?? []
            if let match = entries.first(where: { $0.lowercased() == wanted }) {
                return URL(fileURLWithPath: folder).appendingPathComponent(match)
            }
        }
        throw Failure.appNotFound
    }

    static func existingFile(_ path: String) throws -> URL {
        let url = URL(fileURLWithPath: NSString(string: path).expandingTildeInPath).standardizedFileURL
        guard FileManager.default.fileExists(atPath: url.path) else { throw Failure.fileNotFound }
        return url
    }

    private static func isPackage(_ url: URL) -> Bool {
        (try? url.resourceValues(forKeys: [.isPackageKey]).isPackage) == true
    }

    private static func open<T>(_ body: () async throws -> T) async throws -> T {
        do {
            return try await body()
        } catch {
            throw Failure.couldNotOpen
        }
    }
}
